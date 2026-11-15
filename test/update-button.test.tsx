// @vitest-environment jsdom
/*
 * The update banner's button (Guy, 2026-11-08: "the current button that tells the user to get the new
 * version doesn't actually link to the repo. it doesn't open at all, can you make that button install the
 * newest version or must we make it link to the repo?").
 *
 * Why it opened nothing: capabilities/default.json granted tauri-plugin-opener's open_url COMMAND
 * (opener:allow-open-url) but no URL SCOPE, and the plugin refuses every URL outside its scope. The
 * refusal fell to window.open, which the app's WebView swallows. The same hole killed every link in the
 * apps (Archives links, the tracker's links). Fix: opener:allow-default-urls (http, https, mailto, tel).
 *
 * What the button does now: the Windows app installs the update itself (src/data/selfUpdate.ts through
 * tauri-plugin-updater, signature-checked against the pubkey in tauri.conf.json); unsaved work gets the
 * app's own question first; anything that fails opens the installer link instead. The phone keeps its
 * APK download link (an APK can't install itself). The release writes latest.json through
 * scripts/make-update-manifest.mjs, which refuses a signature that doesn't verify.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDom } from './_render';

/* The app's two Tauri shells: __TAURI_INTERNALS__ makes platform.ts's isTauri true at load, as in the
 * real app; the shell (PC or phone) is switched per test through the getters below. */
const shell = vi.hoisted(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  return { mobile: false };
});
vi.mock('../src/platform', async (orig) => {
  const real = await orig<typeof import('../src/platform')>();
  return {
    ...real,
    get isMobilePlatform() {
      return shell.mobile;
    },
    get isDesktopApp() {
      return real.isTauri && !shell.mobile;
    },
  };
});
const native = vi.hoisted(() => ({
  openUrl: vi.fn(async (_url: string) => undefined),
  check: vi.fn(),
  flush: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: native.openUrl }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: native.check }));
vi.mock('../src/data/persist', async (orig) => ({
  ...(await orig<typeof import('../src/data/persist')>()),
  flushPersist: native.flush,
}));
/* The banner's own GitHub check: a newer release exists (no network in tests). */
vi.mock('../src/data/updateCheck', async (orig) => ({
  ...(await orig<typeof import('../src/data/updateCheck')>()),
  checkForUpdate: () => Promise.resolve('v0.1.99'),
}));

import { UpdateNotice } from '../src/sheet/UpdateNotice';
import { downloadUpdate, installDownloaded, DOWNLOAD_TIMEOUT_MS, type DownloadableUpdate, type InstallDeps, type InstallStage } from '../src/data/selfUpdate';
import { registerUnsavedWork, _resetUnsavedWorkForTests } from '../src/data/unsavedWork';
import { RELEASES_PAGE, updateDownloadUrl } from '../src/data/updateCheck';
import { openExternal } from '../src/platform';
import { verifyMinisign, makeManifest, buildManifest, REPO as MANIFEST_REPO, WINDOWS_ASSET } from '../scripts/make-update-manifest.mjs';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/* ------------------------------------------------------------------------------------------------ */
describe('the app may open web links (the reason the button opened nothing)', () => {
  type Cap = { identifier: string; platforms?: string[]; permissions: (string | { identifier: string })[] };
  const caps = (JSON.parse(read('src-tauri/capabilities/default.json')) as { capabilities: Cap[] }).capabilities;
  const ids = (c: Cap) => c.permissions.map((p) => (typeof p === 'string' ? p : p.identifier));
  /** Every capability that grants the open_url command also grants a URL scope that covers https. */
  const openUrlHasScope = (list: Cap[]) =>
    list
      .filter((c) => ids(c).some((p) => p === 'opener:allow-open-url' || p === 'opener:default'))
      .every((c) => ids(c).some((p) => p === 'opener:allow-default-urls' || p === 'opener:default'));

  it('grants opener:allow-default-urls beside opener:allow-open-url', () => {
    expect(caps.some((c) => ids(c).includes('opener:allow-open-url')), 'nothing grants open_url').toBe(true);
    expect(openUrlHasScope(caps)).toBe(true);
  });
  it('the check fails on the July shape: the command without a scope', () => {
    // Planted bad case, in memory only: the default capability as it was from v0.1.6 to v0.1.45.
    // (tauri-plugin-opener 2.5.4 permissions/allow-default-urls.toml allows mailto:*, tel:*, http://*, https://*.)
    const planted = caps.map((c) => ({ ...c, permissions: c.permissions.filter((p) => p !== 'opener:allow-default-urls') }));
    expect(openUrlHasScope(planted)).toBe(false);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('the Windows self-install is wired, and only for the PC', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  type Cap = { identifier: string; platforms?: string[]; permissions: string[] };
  const caps = (JSON.parse(read('src-tauri/capabilities/default.json')) as { capabilities: Cap[] }).capabilities;

  it('the update permission lives in a desktop-only capability with exactly check, download, install', () => {
    const upd = caps.filter((c) => c.permissions.some((p) => p.startsWith('updater:')));
    expect(upd.map((c) => c.identifier)).toEqual(['desktop-update']);
    expect(upd[0].platforms).toEqual(['windows', 'macOS', 'linux']);
    expect([...upd[0].permissions].sort()).toEqual(['updater:allow-check', 'updater:allow-download', 'updater:allow-install']);
  });
  it('tauri.conf.json: signed update files, the GitHub latest.json, passive install, a minisign pubkey', () => {
    expect(conf.bundle.createUpdaterArtifacts).toBe(true);
    expect(conf.plugins.updater.endpoints).toEqual([`https://github.com/${MANIFEST_REPO}/releases/latest/download/latest.json`]);
    expect(conf.plugins.updater.windows.installMode).toBe('passive');
    expect(Buffer.from(conf.plugins.updater.pubkey, 'base64').toString('utf8')).toMatch(/^untrusted comment: minisign public key: [0-9A-F]{16}\n/);
  });
  it('the manifest script, the banner and the release use the same repo and asset name', () => {
    expect(read('src/data/updateCheck.ts')).toContain(`const REPO = '${MANIFEST_REPO}'`);
    expect(read('src/data/updateCheck.ts')).toContain(`const WINDOWS_ASSET = '${WINDOWS_ASSET}'`);
    expect(read('.claude/skills/hh-release/SKILL.md')).toContain('make-update-manifest.mjs');
    expect(read('.claude/skills/hh-release/SKILL.md')).toContain('latest.json');
  });
  it('the crate is desktop-only and on the npm package’s minor (the Tauri CLI refuses a mismatch)', () => {
    const cargo = read('src-tauri/Cargo.toml');
    const block = cargo.split(`[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`)[1] ?? '';
    const crate = /tauri-plugin-updater = "~(\d+\.\d+)\.\d+"/.exec(block.split('\n[')[0]);
    expect(crate, 'tauri-plugin-updater is not in the desktop-only block').not.toBeNull();
    const npm = /~(\d+\.\d+)\.\d+/.exec(JSON.parse(read('package.json')).dependencies['@tauri-apps/plugin-updater']);
    expect(npm?.[1]).toBe(crate![1]);
    expect(read('src-tauri/src/lib.rs')).toMatch(/#\[cfg\(desktop\)\]\s*let builder = builder\.plugin\(tauri_plugin_updater::Builder::new\(\)\.build\(\)\);/);
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('the install steps (data/selfUpdate.ts)', () => {
  function fakeUpdate(opts: { downloadFails?: boolean; installFails?: boolean } = {}) {
    const calls: string[] = [];
    const update: DownloadableUpdate = {
      async download(onEvent, options) {
        calls.push('download');
        expect(options?.timeout, 'the download has no time limit').toBe(DOWNLOAD_TIMEOUT_MS);
        if (opts.downloadFails) throw new Error('signature mismatch');
        onEvent?.({ event: 'Started', data: { contentLength: 200 } });
        onEvent?.({ event: 'Progress', data: { chunkLength: 50 } });
        onEvent?.({ event: 'Progress', data: { chunkLength: 150 } });
        onEvent?.({ event: 'Finished' });
      },
      async install() {
        calls.push('install');
        if (opts.installFails) throw new Error('installer would not start');
      },
    };
    return { update, calls };
  }
  function deps(over: Partial<InstallDeps> = {}) {
    const log: string[] = [];
    const stages: InstallStage[] = [];
    const d: InstallDeps = {
      check: async () => null,
      hasUnsavedWork: () => false,
      askInstallAnyway: async () => {
        log.push('ask');
        return true;
      },
      flush: () => log.push('flush'),
      resume: () => log.push('resume'),
      openInBrowser: async () => {
        log.push('browser');
      },
      onStage: (s) => stages.push(s),
      ...over,
    };
    return { d, log, stages };
  }
  /** Both banner clicks in a row: "Install the update" (download), then "Install now". */
  async function installUpdate(d: InstallDeps) {
    const update = await downloadUpdate(d);
    return update === 'browser' ? 'browser' : installDownloaded(update, d);
  }

  it('an update: downloads with progress, flushes, then installs', async () => {
    const { update, calls } = fakeUpdate();
    const { d, log, stages } = deps({ check: async () => update });
    expect(await installUpdate(d)).toBe('installing');
    expect(calls).toEqual(['download', 'install']);
    expect(log).toEqual(['flush']); // nothing unsaved → no question
    expect(stages.map((s) => (s.kind === 'downloading' ? `downloading ${s.percent}` : s.kind))).toEqual([
      'checking',
      'downloading null',
      'downloading 25',
      'downloading 100',
      'downloaded',
      'installing',
    ]);
  });
  it('unsaved work: asks first; "Keep editing" installs nothing and flushes nothing', async () => {
    const { update, calls } = fakeUpdate();
    const { d, log, stages } = deps({ check: async () => update, hasUnsavedWork: () => true, askInstallAnyway: async () => (log.push('ask'), false) });
    expect(await installUpdate(d)).toBe('kept-editing');
    expect(calls).toEqual(['download']);
    expect(log).toEqual(['ask']);
    expect(stages.at(-1)).toEqual({ kind: 'downloaded' });
    // The next click installs the same download, without downloading again.
    const again = deps({ hasUnsavedWork: () => false });
    expect(await installDownloaded(update, again.d)).toBe('installing');
    expect(calls).toEqual(['download', 'install']);
    expect(again.log).toEqual(['flush']);
  });
  it('unsaved work + "Install anyway": flushes, then installs', async () => {
    const { update, calls } = fakeUpdate();
    const { d, log } = deps({ check: async () => update, hasUnsavedWork: () => true });
    expect(await installUpdate(d)).toBe('installing');
    expect(log).toEqual(['ask', 'flush']);
    expect(calls).toEqual(['download', 'install']);
  });
  it.each([
    ['no latest.json on that release (check throws)', { check: async () => { throw new Error('404'); } }],
    ['latest.json names nothing newer (check is null)', { check: async () => null }],
  ])('%s → the installer link goes to the browser', async (_name, over) => {
    const { d, log, stages } = deps(over as Partial<InstallDeps>);
    expect(await installUpdate(d)).toBe('browser');
    expect(log).toEqual(['browser']);
    expect(stages.at(-1)).toEqual({ kind: 'browser' });
  });
  it('a failed download (a bad signature) never installs; the link goes to the browser', async () => {
    const { update, calls } = fakeUpdate({ downloadFails: true });
    const { d, log } = deps({ check: async () => update });
    expect(await downloadUpdate(d)).toBe('browser');
    expect(calls).toEqual(['download']);
    expect(log).toEqual(['browser']);
  });
  it('an installer that won’t start → live sync resumes, then the browser link', async () => {
    const { update } = fakeUpdate({ installFails: true });
    const { d, log } = deps({ check: async () => update });
    expect(await installUpdate(d)).toBe('browser');
    expect(log).toEqual(['flush', 'resume', 'browser']);
  });
  it('a successful install never resumes (the app is closing)', async () => {
    const { update } = fakeUpdate();
    const { d, log } = deps({ check: async () => update });
    expect(await installUpdate(d)).toBe('installing');
    expect(log).not.toContain('resume');
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('the banner on screen', () => {
  async function settle() {
    for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
  }
  const linkByText = (host: HTMLElement, text: string) =>
    [...host.querySelectorAll('a')].find((a) => a.textContent?.trim() === text) ?? null;
  beforeEach(() => {
    native.openUrl.mockClear();
    native.check.mockReset();
    native.flush.mockClear();
    _resetUnsavedWorkForTests();
    shell.mobile = false;
  });
  afterEach(() => {
    document.querySelectorAll('.confirm-overlay').forEach((n) => n.parentElement?.remove());
  });

  it('PC app: "Install the update" only downloads; "Install now" saves everything, then installs', async () => {
    const calls: string[] = [];
    native.check.mockResolvedValue({
      download: async () => void calls.push('download'),
      install: async () => void calls.push('install'),
    });
    // The close-time savers (App's flush, cloud sync, the tracker) listen for pagehide.
    let pagehides = 0;
    const onHide = () => {
      pagehides++;
      calls.push(`pagehide (flushPersist ${native.flush.mock.calls.length})`);
    };
    window.addEventListener('pagehide', onHide);
    const ui = renderDom(createElement(UpdateNotice));
    await settle();
    expect(ui.host.textContent).toContain('v0.1.99 is available');
    ui.click(linkByText(ui.host, 'Install the update'));
    await settle();
    expect(native.check).toHaveBeenCalledTimes(1);
    expect(native.check).toHaveBeenCalledWith({ timeout: 30_000 }); // never stuck on "Downloading…"
    // Downloaded, nothing installed, nothing flushed: the app must not close by itself.
    expect(calls).toEqual(['download']);
    expect(native.flush).not.toHaveBeenCalled();
    expect(pagehides).toBe(0);
    expect(ui.host.textContent).toContain('downloaded and ready to install');
    ui.click(linkByText(ui.host, 'Install now'));
    await settle();
    expect(calls).toEqual(['download', 'pagehide (flushPersist 1)', 'install']);
    expect(native.flush).toHaveBeenCalledTimes(1);
    expect(native.check).toHaveBeenCalledTimes(1); // no second check or download
    expect(native.openUrl).not.toHaveBeenCalled();
    expect(ui.host.textContent).toContain('The app closes and opens again by itself');
    window.removeEventListener('pagehide', onHide);
    ui.stop();
  });
  it('PC app, unsaved work: the app’s own question; "Keep editing" leaves an "Install now" button', async () => {
    const calls: string[] = [];
    native.check.mockResolvedValue({
      download: async () => void calls.push('download'),
      install: async () => void calls.push('install'),
    });
    const off = registerUnsavedWork(() => true);
    const ui = renderDom(createElement(UpdateNotice));
    await settle();
    ui.click(linkByText(ui.host, 'Install the update'));
    await settle();
    expect(document.querySelector('[role="alertdialog"]'), 'the download alone must not ask').toBeNull();
    ui.click(linkByText(ui.host, 'Install now'));
    await settle();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.getAttribute('aria-label')).toBe('Install without saving?');
    const keep = [...document.querySelectorAll('.confirm-actions button')].find((b) => b.textContent === 'Keep editing');
    // The close question's settings: a stray Enter keeps the work, and no tracker layer hides it.
    expect(document.activeElement, 'Enter right after the click would throw the work away').toBe(keep);
    expect((dialog!.closest('.confirm-overlay') as HTMLElement).style.zIndex).toBe('40000');
    act(() => keep!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(calls).toEqual(['download']);
    expect(native.flush).not.toHaveBeenCalled();
    expect(linkByText(ui.host, 'Install now')).not.toBeNull();
    off();
    ui.click(linkByText(ui.host, 'Install now'));
    await settle();
    expect(calls).toEqual(['download', 'install']); // no second download
    ui.stop();
  });
  it('PC app, the installer is blocked: live sync gets its pageshow back, then the browser link', async () => {
    native.check.mockResolvedValue({
      download: async () => undefined,
      install: async () => {
        throw new Error('the installer was blocked');
      },
    });
    const events: string[] = [];
    const onHide = () => events.push('pagehide');
    const onShow = () => events.push('pageshow');
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    const ui = renderDom(createElement(UpdateNotice));
    await settle();
    ui.click(linkByText(ui.host, 'Install the update'));
    await settle();
    ui.click(linkByText(ui.host, 'Install now'));
    await settle();
    expect(events).toEqual(['pagehide', 'pageshow']);
    expect(native.openUrl).toHaveBeenCalledWith(updateDownloadUrl({ isTauri: true, isMobile: false }));
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('pageshow', onShow);
    ui.stop();
  });
  it('PC app, a release without latest.json: the installer link opens in the browser', async () => {
    native.check.mockRejectedValue(new Error('Could not fetch a valid release JSON from the remote'));
    const ui = renderDom(createElement(UpdateNotice));
    await settle();
    ui.click(linkByText(ui.host, 'Install the update'));
    await settle();
    expect(native.openUrl).toHaveBeenCalledWith(updateDownloadUrl({ isTauri: true, isMobile: false }));
    expect(ui.host.textContent).toContain('opened in your browser');
    ui.stop();
  });
  it('phone: "Get the update" goes to the OS (no updater); "release notes" too', async () => {
    shell.mobile = true;
    const ui = renderDom(createElement(UpdateNotice));
    await settle();
    expect(linkByText(ui.host, 'Install the update')).toBeNull();
    ui.click(linkByText(ui.host, 'Get the update'));
    await settle();
    expect(native.check).not.toHaveBeenCalled();
    expect(native.openUrl).toHaveBeenCalledTimes(1);
    ui.click(linkByText(ui.host, 'release notes'));
    await settle();
    expect(native.openUrl).toHaveBeenLastCalledWith(RELEASES_PAGE);
    ui.stop();
  });
  it('the phone’s link is the APK itself, the PC’s the installer', () => {
    expect(updateDownloadUrl({ isTauri: true, isMobile: true })).toMatch(/\/releases\/latest\/download\/Heroes-Heaven-Android\.apk$/);
    expect(updateDownloadUrl({ isTauri: true, isMobile: false })).toMatch(/\/releases\/latest\/download\/Heroes-Heaven-Setup\.exe$/);
  });
  it('every app link (Archives, tracker) takes the same route to the OS', async () => {
    const e = { preventDefault: vi.fn() };
    await openExternal(e, 'https://2e.aonprd.com/Feats.aspx?ID=1');
    expect(e.preventDefault).toHaveBeenCalled();
    expect(native.openUrl).toHaveBeenCalledWith('https://2e.aonprd.com/Feats.aspx?ID=1');
  });
});

/* ------------------------------------------------------------------------------------------------ */
describe('scripts/make-update-manifest.mjs refuses a latest.json the app would reject', () => {
  // A throwaway key signed this fixture with the real `tauri signer sign` (2026-11-08); the key itself
  // was thrown away. The app's own key is never in the repo.
  const dir = 'test/fixtures/self-update';
  const payload = readFileSync(join(ROOT, dir, 'payload.bin'));
  const sig = read(`${dir}/payload.bin.sig`);
  const pub = read(`${dir}/throwaway-key.pub`);
  const appPub = JSON.parse(read('src-tauri/tauri.conf.json')).plugins.updater.pubkey;

  it('a real tauri signature verifies', () => {
    expect(verifyMinisign(payload, sig, pub)).toEqual({ ok: true });
  });
  it('one changed byte → refused', () => {
    const changed = Buffer.from(payload);
    changed[0] ^= 1;
    expect(verifyMinisign(changed, sig, pub)).toMatchObject({ ok: false, why: expect.stringContaining('does not match') });
  });
  it('signed with another key (the app’s pubkey here) → refused', () => {
    expect(verifyMinisign(payload, sig, appPub)).toMatchObject({ ok: false, why: expect.stringContaining('different key') });
  });
  it('an edited trusted comment → refused', () => {
    const text = Buffer.from(sig, 'base64').toString('utf8').replace('file:payload.bin', 'file:other.bin');
    expect(verifyMinisign(payload, Buffer.from(text).toString('base64'), pub)).toMatchObject({ ok: false, why: expect.stringContaining('trusted comment') });
  });
  it('the manifest names the versioned installer under the version’s own tag', () => {
    expect(buildManifest({ version: '0.1.46', signature: ' abc \n', pubDate: '2026-11-08T00:00:00.000Z' })).toEqual({
      version: '0.1.46',
      notes: '',
      pub_date: '2026-11-08T00:00:00.000Z',
      platforms: {
        'windows-x86_64': {
          signature: 'abc',
          url: 'https://github.com/guybirinbom-hub/Heroes-Heaven/releases/download/v0.1.46/Heroes-Heaven-Setup.exe',
        },
      },
    });
  });
  it('an installer from another version, or missing, is refused before anything is written', () => {
    const conf = { version: '0.1.46', plugins: { updater: { pubkey: pub } } };
    expect(() => makeManifest({ exePath: join(ROOT, dir, 'payload.bin'), conf })).toThrow(/not version 0\.1\.46/);
    expect(() => makeManifest({ exePath: join(ROOT, dir, 'missing_0.1.46_x64-setup.exe'), conf })).toThrow(/no installer/);
  });
  describe('with a built installer on disk (a temp copy of the signed fixture)', () => {
    let tmp = '';
    let exe = '';
    beforeEach(() => {
      tmp = mkdtempSync(join(tmpdir(), 'hh-manifest-'));
      exe = join(tmp, 'Heroes Heaven_0.1.46_x64-setup.exe');
      copyFileSync(join(ROOT, dir, 'payload.bin'), exe);
    });
    afterEach(() => rmSync(tmp, { recursive: true, force: true }));
    const conf = () => ({ version: '0.1.46', plugins: { updater: { pubkey: pub } } });

    it('signed by the key in tauri.conf.json → the manifest, with the .sig text and the version’s link', () => {
      copyFileSync(join(ROOT, dir, 'payload.bin.sig'), `${exe}.sig`);
      const m = makeManifest({ exePath: exe, conf: conf(), now: new Date('2026-11-08T00:00:00.000Z'), notes: 'n' });
      expect(m).toEqual(buildManifest({ version: '0.1.46', signature: sig, pubDate: '2026-11-08T00:00:00.000Z', notes: 'n' }));
    });
    it('built without the signing key (no .sig beside it) → refused, naming the variable the build reads', () => {
      expect(() => makeManifest({ exePath: exe, conf: conf() })).toThrow(/no .*\.sig beside the installer: build with TAURI_SIGNING_PRIVATE_KEY set/);
    });
    it('a .sig from another key, or an empty one → refused', () => {
      copyFileSync(join(ROOT, dir, 'payload.bin.sig'), `${exe}.sig`);
      expect(() => makeManifest({ exePath: exe, conf: { ...conf(), plugins: { updater: { pubkey: appPub } } } })).toThrow(/different key/);
      writeFileSync(`${exe}.sig`, '\n');
      expect(() => makeManifest({ exePath: exe, conf: conf() })).toThrow(/is empty/);
    });
  });
});
