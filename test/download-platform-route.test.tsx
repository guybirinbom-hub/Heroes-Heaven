// @vitest-environment jsdom
/*
 * Item 8, the Android half (owner, 2026-10: "on android have both options").
 *
 * The Android APK saved NOTHING from any export: its WebView has no download listener, so the anchor
 * route the web and the PC app use is ignored there. src/sheet/download.ts now asks, on the Android app
 * only, in the app's own dialog: "Save to folder" (the system save picker through tauri-plugin-dialog,
 * then tauri-plugin-fs writes into what was picked) or "Share" (the share_text_file command in
 * src-tauri/src/lib.rs, which hands the file to the system share sheet). A browser tab, the PWA and the
 * PC app keep the anchor, unchanged. A Cancel anywhere saves nothing and says nothing.
 *
 * The plugins and the command are faked (jsdom has no Tauri); everything else is real: the dialog, the
 * anchor route, and the Settings page's "Export everything". The native halves — the picker, the
 * content:// write, the share sheet — run only on a phone; the last describe pins the wiring that
 * makes them reachable (permissions, Android-only registration, the command name, the plugin pins).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDom } from './_render';
import { build } from './_content';
import { downloadText, type DownloadOutcome } from '../src/sheet/download';
import { SettingsPage } from '../src/sheet/SettingsPage';
import { HomebrewPage } from '../src/sheet/HomebrewPage';
import { RosterScreen } from '../src/sheet/RosterScreen';
import type { SavedChar } from '../src/data/storage';
import type { ContentDatabase } from '../src/rules/types';

/* Which shell the app thinks it runs in. download.ts reads these at call time. */
const shell = vi.hoisted(() => ({ tauri: false, mobile: false }));
vi.mock('../src/platform', async (orig) => {
  const real = await orig<typeof import('../src/platform')>();
  return {
    ...real,
    get isTauri() {
      return shell.tauri;
    },
    get isMobilePlatform() {
      return shell.mobile;
    },
    get isDesktopApp() {
      return shell.tauri && !shell.mobile;
    },
  };
});
const native = vi.hoisted(() => ({ save: vi.fn(), writeTextFile: vi.fn(), invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: native.save }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: native.writeTextFile }));
vi.mock('@tauri-apps/api/core', async (orig) => ({
  ...(await orig<typeof import('@tauri-apps/api/core')>()),
  invoke: native.invoke,
}));

const FILE = 'heroes-heaven-backup-2026-10-13.json';
const TEXT = '{"app":"heroes-heaven","kind":"backup"}';
/** What the Android "save as" picker answers with: a content:// address, not a path. */
const PICKED = 'content://com.android.externalstorage.documents/document/primary%3ADownload%2Fheroes-heaven-backup-2026-10-13.json';

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
/** Every file name the anchor route "downloaded". */
let anchors: string[];

beforeEach(() => {
  document.body.innerHTML = '';
  shell.tauri = false;
  shell.mobile = false;
  native.save.mockReset();
  native.writeTextFile.mockReset();
  native.invoke.mockReset();
  native.writeTextFile.mockResolvedValue(undefined);
  native.invoke.mockResolvedValue(undefined);
  anchors = [];
  URL.createObjectURL = vi.fn(() => 'blob:test') as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    anchors.push(this.download);
  });
});
afterEach(() => {
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  vi.restoreAllMocks();
});

const android = () => {
  shell.tauri = true;
  shell.mobile = true;
};
/** Let promises and the dialog's deferred mount/teardown settle inside act. */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
const dialog = () => document.body.querySelector('.confirm-modal');
const choices = () => [...(dialog()?.querySelectorAll('.confirm-actions button') ?? [])].map((b) => (b.textContent ?? '').trim());
async function press(label: string | RegExp) {
  const b = [...document.querySelectorAll('.confirm-actions button')].find((x) => {
    const t = (x.textContent ?? '').trim();
    return typeof label === 'string' ? t === label : label.test(t);
  });
  expect(b, `no "${label}" button in the open dialog`).toBeTruthy();
  await act(async () => {
    b!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}
/** Settle until `done()` holds. The phone route loads its plugin with a dynamic import, and on a
 *  loaded machine (a 20-file run) that takes more than one tick: one `settle()` let a Share leg's
 *  command land in the NEXT test, failing both. */
async function until(done: () => boolean, what: string) {
  for (let i = 0; i < 400 && !done(); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
  expect(done(), `timed out waiting for ${what}`).toBe(true);
}

/** Watches a download's promise from the moment it exists, so a rejection is never "unhandled". */
function track(p: Promise<DownloadOutcome>) {
  const s: { done: boolean; value?: DownloadOutcome; error?: Error } = { done: false };
  p.then(
    (v) => Object.assign(s, { done: true, value: v }),
    (e: Error) => Object.assign(s, { done: true, error: e }),
  );
  return s;
}
async function start(filename = FILE, text = TEXT) {
  let s!: ReturnType<typeof track>;
  await act(async () => {
    s = track(downloadText({ filename, text }));
  });
  await settle();
  return s;
}

describe('a browser tab, the PWA and the PC app keep the anchor download', () => {
  for (const [where, tauri, mobile] of [
    ['a browser tab', false, false],
    ['a phone browser or the installed web app (PWA)', false, true],
    ['the PC app', true, false],
  ] as const) {
    it(`${where}: the anchor saves the file at once — no chooser, no plugin, no command`, async () => {
      shell.tauri = tauri;
      shell.mobile = mobile;
      const out = downloadText({ filename: FILE, text: TEXT });
      // Synchronously, inside the caller's own click, exactly as before.
      expect(anchors).toEqual([FILE]);
      await expect(out).resolves.toBe('saved');
      await settle();
      expect(dialog()).toBeNull();
      expect(native.save).not.toHaveBeenCalled();
      expect(native.writeTextFile).not.toHaveBeenCalled();
      expect(native.invoke).not.toHaveBeenCalled();
    });
  }
});

describe('the Android app offers Save to folder and Share, in the app dialog', () => {
  it('opens the chooser with exactly those two choices, naming the file, and saves nothing yet', async () => {
    // MUTATION PROOF (tried 2026-10-13): delete `if (isTauri && isMobilePlatform) return
    // saveOrShareOnPhone(...)` from downloadText and the anchor fires on the phone, where it saves
    // nothing: AssertionError: expected [ Array(1) ] to deeply equal []  (and six more legs fail).
    android();
    const s = await start();
    expect(anchors).toEqual([]);
    expect(dialog(), 'no chooser opened on the Android app').toBeTruthy();
    expect(choices()).toEqual(['Save to folder', 'Share']);
    expect(dialog()!.textContent).toContain(FILE);
    expect(s.done).toBe(false);
    await act(async () => {
      dialog()!.querySelector<HTMLButtonElement>('.picker-close')!.click();
    });
    await settle();
    expect(s).toMatchObject({ done: true, value: 'cancelled' });
  });

  it('Save to folder: the system picker gets the name and a JSON filter, then the text is written where the player picked', async () => {
    android();
    native.save.mockResolvedValue(PICKED);
    const s = await start();
    await press('Save to folder');
    await until(() => s.done, 'the save to finish');
    expect(native.save).toHaveBeenCalledTimes(1);
    expect(native.save).toHaveBeenCalledWith({ defaultPath: FILE, filters: [{ name: 'JSON', extensions: ['json'] }] });
    expect(native.writeTextFile).toHaveBeenCalledTimes(1);
    expect(native.writeTextFile).toHaveBeenCalledWith(PICKED, TEXT);
    expect(native.invoke).not.toHaveBeenCalled();
    expect(anchors).toEqual([]);
    expect(dialog()).toBeNull();
    expect(s).toMatchObject({ done: true, value: 'saved' });
  });

  it('Cancel in the system picker saves nothing and says nothing', async () => {
    // MUTATION PROOF (tried 2026-10-13): drop `if (!target) return 'cancelled';` and the write runs
    // with no target: AssertionError: expected "vi.fn()" to not be called at all, but actually been called 1 times.
    android();
    native.save.mockResolvedValue(null);
    const s = await start();
    await press('Save to folder');
    await until(() => s.done, 'the cancelled save to finish');
    await settle();
    expect(native.save).toHaveBeenCalledTimes(1);
    expect(native.writeTextFile).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(s).toMatchObject({ done: true, value: 'cancelled' });
  });

  it('Share: the file goes to the share_text_file command with its name, its text and its type', async () => {
    android();
    const s = await start();
    await press('Share');
    await until(() => s.done, 'the share to finish');
    expect(native.invoke).toHaveBeenCalledTimes(1);
    expect(native.invoke).toHaveBeenCalledWith('share_text_file', { filename: FILE, text: TEXT, mime: 'application/json' });
    expect(native.save).not.toHaveBeenCalled();
    expect(native.writeTextFile).not.toHaveBeenCalled();
    expect(anchors).toEqual([]);
    expect(s).toMatchObject({ done: true, value: 'shared' });
  });

  it('closing the chooser by Escape or a tap outside saves and shares nothing', async () => {
    android();
    let s = await start();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();
    expect(dialog()).toBeNull();
    expect(s).toMatchObject({ done: true, value: 'cancelled' });

    s = await start();
    await act(async () => {
      document.querySelector<HTMLElement>('.picker-overlay')!.click();
    });
    await settle();
    expect(dialog()).toBeNull();
    expect(s).toMatchObject({ done: true, value: 'cancelled' });
    expect(native.save).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
    expect(anchors).toEqual([]);
  });

  it('a failed picker, write or share REJECTS with an Error that carries the phone’s own words', async () => {
    // Tauri's invoke — and so the picker, the write and the share command — rejects with the native
    // error as a plain STRING (Result<_, String> commands; plugin-fs and plugin-dialog serialize theirs
    // with serialize_str). Every caller's catch reads `(e as Error).message`, so a string reached the
    // phone as "Export failed: undefined" (refuter, round 1).
    // MUTATION PROOF (tried 2026-10-13): drop `.catch(rejectAsError)` from downloadText —
    // AssertionError: the write (a string): expected 'failed to open file…' to be an instance of Error
    // (and the three caller legs below fail with "undefined" or an empty notice).
    android();
    const cases: { what: string; choose: 'Save to folder' | 'Share'; arrange: () => void; says: string }[] = [
      {
        what: 'the write (an Error)',
        choose: 'Save to folder',
        arrange: () => {
          native.save.mockResolvedValue(PICKED);
          native.writeTextFile.mockRejectedValue(new Error('No space left on the device.'));
        },
        says: 'No space left on the device.',
      },
      {
        what: 'the write (a string)',
        choose: 'Save to folder',
        arrange: () => {
          native.save.mockResolvedValue(PICKED);
          native.writeTextFile.mockRejectedValue('failed to open file at path: content://picked with mode wt');
        },
        says: 'failed to open file at path: content://picked with mode wt',
      },
      {
        what: 'the save picker (a string)',
        choose: 'Save to folder',
        arrange: () => native.save.mockRejectedValue('No app on this phone can create the document.'),
        says: 'No app on this phone can create the document.',
      },
      {
        what: 'the share command (a string)',
        choose: 'Share',
        arrange: () => native.invoke.mockRejectedValue('No app on this phone can receive the file.'),
        says: 'No app on this phone can receive the file.',
      },
      {
        what: 'the share command (an object with a message)',
        choose: 'Share',
        arrange: () => native.invoke.mockRejectedValue({ code: 'busy', message: 'The share sheet is already open.' }),
        says: 'The share sheet is already open.',
      },
      {
        what: 'the share command (no words at all)',
        choose: 'Share',
        arrange: () => native.invoke.mockRejectedValue(undefined),
        says: 'The phone could not save or share the file.',
      },
    ];
    for (const c of cases) {
      native.save.mockReset();
      native.writeTextFile.mockReset();
      native.invoke.mockReset();
      c.arrange();
      const s = await start();
      await press(c.choose);
      await until(() => s.done, `${c.what} to fail`);
      expect(s.value, `${c.what} resolved instead of rejecting`).toBeUndefined();
      expect(s.error, c.what).toBeInstanceOf(Error);
      expect(s.error?.message, c.what).toBe(c.says);
    }
  });

  it('a name that is really file content still throws SYNCHRONOUSLY, before the chooser opens', async () => {
    // MUTATION PROOF (tried 2026-10-13): make downloadText an `async function` and the refusal turns
    // into a rejected promise — AssertionError: expected [Function] to throw an error (here and in three
    // legs of test/download-filename-guard.test.ts), with four unhandled rejections reported.
    android();
    expect(() => downloadText({ filename: TEXT, text: FILE })).toThrow(/is not a file name/);
    const swapped = downloadText as unknown as (a: string, b: string) => Promise<DownloadOutcome>;
    expect(() => swapped(TEXT, FILE)).toThrow(/is not a file name/);
    await settle();
    expect(dialog()).toBeNull();
    expect(native.save).not.toHaveBeenCalled();
    expect(native.invoke).not.toHaveBeenCalled();
  });
});

describe('the exports wait for the phone’s save or share inside their own catch', () => {
  it('Settings → Export everything on the Android app: a failed save opens "Export failed", a Cancel opens nothing', async () => {
    // MUTATION PROOF (tried 2026-10-13): drop the `await` before downloadText in SettingsPage's
    // doExport and the rejection escapes the catch: no notice opens —
    // AssertionError: a failed save opened no notice: expected null to be truthy — and vitest reports
    // the unhandled rejection (the source sweep below fails too).
    android();
    const r = renderDom(createElement(SettingsPage, { onClose: () => undefined }));
    const nav = [...r.host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Backup');
    r.click(nav ?? null);
    const exportAll = () => [...r.host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Export everything')) ?? null;

    native.save.mockResolvedValue(null);
    r.click(exportAll());
    await settle();
    expect(choices()).toEqual(['Save to folder', 'Share']);
    await press('Save to folder');
    await until(() => native.save.mock.calls.length === 1, 'the system picker');
    await settle();
    expect(dialog(), 'a Cancel in the picker opened a notice').toBeNull();

    native.save.mockResolvedValue(PICKED);
    native.writeTextFile.mockRejectedValue(new Error('The folder is read-only.'));
    r.click(exportAll());
    await settle();
    await press('Save to folder');
    await until(() => native.writeTextFile.mock.calls.length === 1, 'the write');
    await settle();
    await settle();
    expect(native.save).toHaveBeenCalledWith({ defaultPath: expect.stringMatching(/^heroes-heaven-backup-\d{4}-\d{2}-\d{2}\.json$/), filters: [{ name: 'JSON', extensions: ['json'] }] });
    expect(native.writeTextFile).toHaveBeenCalledWith(PICKED, expect.stringContaining('"app": "heroes-heaven"'));
    expect(dialog(), 'a failed save opened no notice').toBeTruthy();
    expect(dialog()!.getAttribute('aria-label')).toBe('Export failed');
    expect(dialog()!.textContent).toContain('The folder is read-only.');
    await press('OK');
    r.stop();
  });

  /* The phone's failures arrive as STRINGS (Tauri's invoke rejects with the serialized native error).
   * These three legs drive the real pages with exactly that, and read the notice the player sees.
   * MUTATION PROOF (tried 2026-10-13): drop `.catch(rejectAsError)` from downloadText and all three fail —
   * Settings shows "Export failed: undefined", Homebrew a notice with no reason, the roster
   * "Export failed: undefined". */
  const REFUSED = 'No app on this phone can receive the file.';

  it('Settings → Export everything → Share the phone refuses: the notice gives the phone’s reason, never "undefined"', async () => {
    android();
    native.invoke.mockRejectedValue(REFUSED);
    const r = renderDom(createElement(SettingsPage, { onClose: () => undefined }));
    r.click([...r.host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Backup') ?? null);
    r.click([...r.host.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Export everything')) ?? null);
    await settle();
    await press('Share');
    await until(() => dialog()?.getAttribute('aria-label') === 'Export failed', 'the Export failed notice');
    expect(native.invoke).toHaveBeenCalledWith('share_text_file', {
      filename: expect.stringMatching(/^heroes-heaven-backup-\d{4}-\d{2}-\d{2}\.json$/),
      text: expect.stringContaining('"app": "heroes-heaven"'),
      mime: 'application/json',
    });
    expect(dialog()!.textContent).toContain(`Export failed: ${REFUSED}`);
    expect(dialog()!.textContent).not.toContain('undefined');
    await press('OK');
    r.stop();
  });

  it('Homebrew → Export → Share the phone refuses: the notice gives the phone’s reason', async () => {
    android();
    native.invoke.mockRejectedValue(REFUSED);
    const r = renderDom(createElement(HomebrewPage, { content: {} as ContentDatabase, onChanged: () => undefined, onClose: () => undefined }));
    r.click([...r.host.querySelectorAll('.settings-nav .hb-io-row button')].find((b) => (b.textContent ?? '').includes('Export')) ?? null);
    await settle();
    expect(choices()).toEqual(['Save to folder', 'Share']);
    await press('Share');
    await until(() => dialog()?.getAttribute('aria-label') === 'Export failed', 'the Export failed notice');
    expect(native.invoke).toHaveBeenCalledWith('share_text_file', {
      filename: expect.stringMatching(/^heroes-heaven-homebrew-\d{4}-\d{2}-\d{2}\.json$/),
      text: expect.stringContaining('"kind": "homebrew"'),
      mime: 'application/json',
    });
    expect(dialog()!.textContent, 'the notice gives no reason').toContain(REFUSED);
    await press('OK');
    r.stop();
  });

  it('Roster → Export → Heroes Heaven file → Save to folder the phone refuses: an "Export failed" notice with the phone’s reason', async () => {
    // The roster's notice also said "Import failed" over an export's failure.
    // MUTATION PROOF (tried 2026-10-13): put back the fixed "Import failed" heading in RosterScreen's
    // notice — AssertionError: expected 'Import failed' to be 'Export failed'.
    android();
    const WRITE_REFUSED = 'failed to open file at path: content://picked with mode wt';
    native.save.mockResolvedValue(PICKED);
    native.writeTextFile.mockRejectedValue(WRITE_REFUSED);
    const roster: SavedChar[] = [{ id: 'syn-1', character: build('fighter', 1, { name: 'Synthetic Wren' }) }];
    const noop = () => undefined;
    const r = renderDom(
      createElement(RosterScreen, {
        roster,
        activeId: 'syn-1',
        content: null,
        onOpen: noop,
        onNew: noop,
        onImport: noop as never,
        onDuplicate: noop,
        onArchive: noop,
        onDelete: noop,
      }),
    );
    r.click(r.host.querySelector('.rcard-actions button[title="Export"]'));
    await settle();
    await press(/Heroes Heaven file/);
    await until(() => [...document.querySelectorAll('.confirm-actions button')].some((b) => (b.textContent ?? '').trim() === 'Save to folder'), 'the phone chooser');
    await press('Save to folder');
    const notice = () => r.host.querySelector('.confirm-modal');
    await until(() => notice() !== null, 'the roster’s notice');
    expect((notice()!.querySelector('.picker-head')?.textContent ?? '').trim()).toBe('Export failed');
    expect(native.save).toHaveBeenCalledWith({ defaultPath: 'synthetic-wren.codex.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    expect(native.writeTextFile).toHaveBeenCalledWith(PICKED, expect.stringContaining('"kind": "character"'));
    expect(notice()!.querySelector('.confirm-body')?.textContent).toBe(`Export failed: ${WRITE_REFUSED}`);
    r.click(notice()!.querySelector('.confirm-actions button'));
    expect(notice()).toBeNull();
    r.stop();
  });

  it('every caller of downloadText awaits it (a source sweep, so a new export cannot forget)', () => {
    // MUTATION PROOF (tried 2026-10-13): remove `await ` before downloadText in GmEditSheet.tsx —
    // AssertionError: expected [ { …(2) } ] to deeply equal []   (the entry names src/sheet/GmEditSheet.tsx).
    const calls: { file: string; awaited: boolean }[] = [];
    for (const rel of readdirSync('src', { recursive: true }) as string[]) {
      if (!/\.(ts|tsx)$/.test(rel) || rel.replace(/\\/g, '/') === 'sheet/download.ts') continue;
      const src = readFileSync(join('src', rel), 'utf8');
      for (const m of src.matchAll(/(\bawait\s+)?\bdownloadText\(/g)) {
        calls.push({ file: `src/${rel.replace(/\\/g, '/')}`, awaited: Boolean(m[1]) });
      }
    }
    expect([...new Set(calls.map((c) => c.file))].sort()).toEqual([
      'src/sheet/GmEditSheet.tsx',
      'src/sheet/HomebrewPage.tsx',
      'src/sheet/RosterScreen.tsx',
      'src/sheet/SettingsPage.tsx',
    ]);
    expect(calls.filter((c) => !c.awaited)).toEqual([]);
  });
});

describe('the native wiring the phone needs (read from the files the APK is built from)', () => {
  type Capability = {
    identifier: string;
    windows?: string[];
    webviews?: string[];
    remote?: unknown;
    platforms?: string[];
    permissions: (string | { identifier: string })[];
  };
  const caps = JSON.parse(readFileSync('src-tauri/capabilities/default.json', 'utf8')) as { capabilities: Capability[] };
  const cargo = readFileSync('src-tauri/Cargo.toml', 'utf8');
  const lib = readFileSync('src-tauri/src/lib.rs', 'utf8');

  it('grants the two plugins exactly save + write-text-file, and only on Android', () => {
    // Never dialog:allow-ask / allow-confirm / allow-message / default: the app shows no native dialog,
    // and this holds it at the permission level. MUTATION PROOF (tried 2026-10-13): grant
    // "dialog:default" instead of "dialog:allow-save" — AssertionError: expected [ { …(2) }, { …(2) } ]
    // to deeply equal [ { …(2) }, { …(2) } ]. Dropping `"platforms": ["android"]` breaks the same equality.
    const grants = caps.capabilities.flatMap((c) =>
      c.permissions
        .map((p) => (typeof p === 'string' ? p : p.identifier))
        .filter((p) => /^(dialog|fs):/.test(p))
        .map((p) => ({ permission: p, platforms: c.platforms ?? 'all' })),
    );
    expect(grants).toEqual([
      { permission: 'dialog:allow-save', platforms: ['android'] },
      { permission: 'fs:allow-write-text-file', platforms: ['android'] },
    ]);
  });

  it('binds those grants to the app’s own window, the one the default capability and tauri.conf.json name', () => {
    // Tauri allows a plugin command only for a window or webview its capability names (tauri
    // src/ipc/authority.rs): without "windows" the grants match nothing and the PHONE denies the picker
    // and the write, where no other test can see it (refuter, round 1). The app's one window has no
    // label in tauri.conf.json, so it is Tauri's default "main" (lib.rs looks it up by that name).
    // MUTATION PROOF (tried 2026-10-13): delete `"windows": ["main"]` from the android-export
    // capability — AssertionError: expected undefined to deeply equal [ 'main' ].
    const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as { app: { windows: { label?: string }[] } };
    const labels = conf.app.windows.map((w) => w.label ?? 'main');
    expect(labels).toEqual(['main']);
    expect(lib).toContain('get_webview_window("main")');
    const byId = (id: string) => caps.capabilities.find((c) => c.identifier === id);
    expect(byId('default')?.windows).toEqual(labels);
    const phone = byId('android-export');
    expect(phone, 'the android-export capability is gone').toBeTruthy();
    expect(phone!.windows).toEqual(labels);
    // Local pages only: no per-webview binding that could miss the window, no remote-URL grant.
    expect(phone!.webviews).toBeUndefined();
    expect(phone!.remote).toBeUndefined();
  });

  it('builds and registers the dialog and fs plugins for Android only', () => {
    // On desktop the dialog plugin's init script replaces window.alert / window.confirm; the PC app
    // must not carry it. MUTATION PROOF (tried 2026-10-13): add `tauri-plugin-dialog` to the plain
    // [dependencies] table — AssertionError: expected '[package]\nname = "app"\nversion = "0…' not to
    // match /tauri-plugin-(dialog|fs)/.
    const androidTable = `[target.'cfg(target_os = "android")'.dependencies]`;
    expect(cargo.slice(0, cargo.indexOf(androidTable))).not.toMatch(/tauri-plugin-(dialog|fs)/);
    expect(cargo.slice(cargo.indexOf(androidTable))).toMatch(/^tauri-plugin-dialog = "/m);
    expect(cargo.slice(cargo.indexOf(androidTable))).toMatch(/^tauri-plugin-fs = "/m);
    expect(lib).toMatch(
      /#\[cfg\(target_os = "android"\)\]\s*let builder = builder\s*\.plugin\(tauri_plugin_dialog::init\(\)\)\s*\.plugin\(tauri_plugin_fs::init\(\)\);/,
    );
    expect(lib.match(/tauri_plugin_(dialog|fs)::init\(\)/g)).toHaveLength(2);
  });

  it('Share calls a command the app really registers', () => {
    // MUTATION PROOF (tried 2026-10-13): take share_text_file out of generate_handler! —
    // AssertionError: expected '/// Ask Android to uninstall this app…' to match /generate_handler!\[[^\]]*\bshare_text…/
    expect(lib).toMatch(/generate_handler!\[[^\]]*\bshare_text_file\b/);
    expect(lib).toMatch(/\basync fn share_text_file\(\s*app: tauri::AppHandle,\s*filename: String,\s*text: String,\s*mime: String,/);
    expect(readFileSync('src/sheet/download.ts', 'utf8')).toContain(`invoke('share_text_file', { filename, text, mime })`);
  });

  it('the npm plugin packages and the crates sit on the same minor (the Tauri CLI refuses a build otherwise)', () => {
    // MUTATION PROOF (tried 2026-10-13): pin `tauri-plugin-fs = "~2.6.0"` in Cargo.toml —
    // AssertionError: expected '~2.5.2' to match /^~2\.6\.\d+$/.
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
    const lock = readFileSync('src-tauri/Cargo.lock', 'utf8');
    for (const name of ['dialog', 'fs']) {
      const pin = cargo.match(new RegExp(`^tauri-plugin-${name} = "~(\\d+\\.\\d+)\\.\\d+"`, 'm'))?.[1];
      expect(pin, `tauri-plugin-${name} is not pinned to a minor in Cargo.toml`).toBeTruthy();
      expect(pkg.dependencies[`@tauri-apps/plugin-${name}`]).toMatch(new RegExp(`^~${pin!.replace('.', '\\.')}\\.\\d+$`));
      const installed = (JSON.parse(readFileSync(`node_modules/@tauri-apps/plugin-${name}/package.json`, 'utf8')) as { version: string }).version;
      expect(installed.split('.').slice(0, 2).join('.')).toBe(pin);
      const locked = lock.match(new RegExp(`name = "tauri-plugin-${name}"\\r?\\nversion = "(\\d+\\.\\d+)\\.`))?.[1];
      expect(locked, `tauri-plugin-${name} is not in Cargo.lock`).toBe(pin);
    }
  });
});
