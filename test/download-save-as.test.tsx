// @vitest-environment jsdom
/*
 * Owner, 2026-11-08, after "exporting a character dosent work": "it works but the user dosent see the file
 * explorer to let him chose the name and location he wants to put the file in (the name is the name of the
 * character but maybe he want to change it)".
 *
 * Every export saved straight into Downloads through an anchor, with no window. src/sheet/download.ts now
 * opens the system "Save as" window (`showSaveFilePicker`) wherever the browser has one — the PC app's
 * WebView2, Chrome and Edge on a PC — with the file's name filled in, and writes the text where the player
 * picked. A browser without the window (jsdom here, Firefox, Safari, phone browsers) keeps the anchor; the
 * Android app keeps its own Save to folder / Share chooser (test/download-platform-route.test.tsx).
 *
 * The window itself is faked: jsdom has none, and the real one is a native window no test can press. What
 * is real: downloadText, the roster's Export button and its dialog, and the import of the written file.
 */
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderDom } from './_render';
import { build, content } from './_content';
import { downloadText, type DownloadOutcome } from '../src/sheet/download';
import { RosterScreen } from '../src/sheet/RosterScreen';
import { importCharacter } from '../src/data/transfer';
import type { SavedChar } from '../src/data/storage';

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

const FILE = 'synthetic-wren.codex.json';
const TEXT = '{"app":"wanderers-codex","kind":"character"}';

/** The fake "Save as" window: what it was asked, what was written, and how it answers. */
let picker: ReturnType<typeof vi.fn>;
let written: string[];
let closed: number;
let anchors: string[];
const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;

function domError(name: string, message: string): Error {
  const e = new Error(message);
  e.name = name;
  return e;
}

beforeEach(() => {
  document.body.innerHTML = '';
  shell.tauri = true; // the PC app, unless a leg says otherwise
  shell.mobile = false;
  native.save.mockReset();
  native.writeTextFile.mockReset();
  native.invoke.mockReset();
  written = [];
  closed = 0;
  anchors = [];
  picker = vi.fn(async () => ({
    createWritable: async () => ({
      write: async (data: string) => void written.push(data),
      close: async () => void closed++,
    }),
  }));
  (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = picker;
  URL.createObjectURL = vi.fn(() => 'blob:test') as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    anchors.push(this.download);
  });
});
afterEach(() => {
  delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
  vi.restoreAllMocks();
});

const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
async function until(done: () => boolean, what: string) {
  for (let i = 0; i < 400 && !done(); i++) await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
  expect(done(), `timed out waiting for ${what}`).toBe(true);
}

describe('the PC app and a PC browser open the "Save as" window', () => {
  for (const [where, tauri] of [
    ['the PC app', true],
    ['a PC browser (Chrome, Edge)', false],
  ] as const) {
    it(`${where}: the window opens at once with the name filled in, and the text is written where the player picked`, async () => {
      // MUTATION PROOF (tried 2026-11-08): drop the `if (picker) return saveWithPicker(...)` line from
      // downloadText and every leg here goes red — the anchor fires instead of the window
      // (AssertionError: expected [ 'synthetic-wren.codex.json' ] to deeply equal []).
      shell.tauri = tauri;
      const out = downloadText({ filename: FILE, text: TEXT });
      // Synchronously, inside the player's own click: the browser refuses the window later than that.
      expect(picker).toHaveBeenCalledTimes(1);
      await expect(out).resolves.toBe('saved');
      expect(picker).toHaveBeenCalledWith({
        suggestedName: FILE,
        id: 'heroes-heaven-export',
        startIn: 'downloads',
        types: [{ description: 'JSON file', accept: { 'application/json': ['.json'] } }],
      });
      expect(written).toEqual([TEXT]);
      expect(closed).toBe(1);
      expect(anchors, 'the old download fired as well').toEqual([]);
      expect(native.save).not.toHaveBeenCalled();
      expect(native.invoke).not.toHaveBeenCalled();
    });
  }

  it('Cancel in the window saves nothing, downloads nothing and says nothing', async () => {
    picker.mockRejectedValueOnce(domError('AbortError', 'The user aborted a request.'));
    await expect(downloadText({ filename: FILE, text: TEXT })).resolves.toBe('cancelled');
    expect(written).toEqual([]);
    expect(anchors).toEqual([]);
  });

  it('a browser that refuses to open the window (no recent click) still saves the file the old way', async () => {
    // MUTATION PROOF (tried 2026-11-08): treat every refusal as a Cancel (return 'cancelled' for any
    // error) — AssertionError: expected 'cancelled' to be 'saved'; the player would get no file at all.
    picker.mockRejectedValueOnce(domError('SecurityError', 'Must be handling a user gesture to show a file picker.'));
    await expect(downloadText({ filename: FILE, text: TEXT })).resolves.toBe('saved');
    expect(anchors).toEqual([FILE]);
  });

  it('a write that fails rejects with an Error that carries the reason (the caller shows "Export failed")', async () => {
    picker.mockResolvedValueOnce({
      createWritable: async () => ({
        write: async () => {
          throw domError('NoModificationAllowedError', 'The folder is read-only.');
        },
        close: async () => undefined,
      }),
    });
    await expect(downloadText({ filename: FILE, text: TEXT })).rejects.toThrow('The folder is read-only.');
    expect(anchors).toEqual([]);
  });

  it('a name that is really file content still throws before any window opens', () => {
    expect(() => downloadText({ filename: TEXT, text: FILE })).toThrow(/is not a file name/);
    expect(picker).not.toHaveBeenCalled();
  });

  it('the Android app keeps its own Save to folder / Share chooser, even where the window exists', async () => {
    shell.mobile = true;
    const out = downloadText({ filename: FILE, text: TEXT });
    out.catch(() => undefined);
    await settle();
    expect(picker).not.toHaveBeenCalled();
    expect(document.body.querySelector('.confirm-modal'), 'the phone chooser did not open').toBeTruthy();
    expect(anchors).toEqual([]);
  });

  it('a browser with no window (Firefox, Safari, a phone browser) keeps the download into Downloads', async () => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    shell.tauri = false;
    const out: Promise<DownloadOutcome> = downloadText({ filename: FILE, text: TEXT });
    expect(anchors).toEqual([FILE]);
    await expect(out).resolves.toBe('saved');
  });
});

describe('Characters page → Export, as the player does it on a PC', () => {
  for (const [choice, ext, kind] of [
    [/Heroes Heaven file/, '.codex.json', 'Heroes Heaven'],
    [/Wanderer/, '.wg.json', 'Wanderer’s Guide'],
  ] as const) {
    it(`${kind}: the window offers the character's name, and the file it writes imports back as that character`, async () => {
      // The page drawn as in a PC browser: its window buttons need a real Tauri window. The PC app takes
      // the very same route through downloadText (the first describe runs it as the PC app).
      shell.tauri = false;
      const db = content();
      const roster: SavedChar[] = [{ id: 'syn-1', character: build('fighter', 3, { name: 'Synthetic Wren' }) }];
      const noop = () => undefined;
      const r = renderDom(
        createElement(RosterScreen, {
          roster,
          activeId: 'syn-1',
          content: db,
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
      const pick = [...document.querySelectorAll('.confirm-actions button')].find((b) => choice.test(b.textContent ?? ''));
      expect(pick, 'no such export choice').toBeTruthy();
      await act(async () => void pick!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await until(() => closed === 1, 'the file written through the window');
      expect(picker.mock.calls[0][0].suggestedName).toBe(`synthetic-wren${ext}`);
      expect(anchors).toEqual([]);
      expect(r.host.querySelector('.confirm-modal'), 'an Export failed notice opened').toBeNull();
      const back = importCharacter(written[0], db);
      expect(back.saved.character.name).toBe('Synthetic Wren');
      expect(back.saved.character.level).toBe(3);
      expect(back.report.source).toBe(kind);
      r.stop();
    });
  }
});
