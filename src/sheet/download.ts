import { createElement, Fragment } from 'react';
import { isMobilePlatform, isTauri } from '../platform';
import { chooseDialog, type DialogStyle } from './confirm';

/** Save a text file the player asked for. One helper for every export in the app (backup, roster
 *  character, GM character, homebrew), with one route per shell:
 *   - the PC app (WebView2) and a PC browser that has one (Chrome, Edge) open the system "Save as"
 *     window, with the file's name filled in: the player picks the folder and may change the name
 *     (owner, 2026-11-08: "the user dosent see the file explorer to let him chose the name and location").
 *     Cancel there saves nothing and says nothing (`'cancelled'`);
 *   - a browser without that window (Firefox, Safari, phone browsers, the PWA on a phone) downloads it
 *     through a temporary object-URL anchor (`'saved'`; the browser puts it in Downloads). So does the
 *     PC route when the browser refuses to open its window (no recent click), so a file is never lost;
 *   - the ANDROID app's WebView has no download listener, so an anchor saves nothing there. Instead
 *     the app's own dialog offers "Save to folder" (the system file picker, then tauri-plugin-fs
 *     writes into what was picked) and "Share" (the `share_text_file` command in src-tauri/src/lib.rs
 *     hands the file to the system share sheet). Owner, 2026-10: "on android have both options".
 *     A Cancel anywhere along the way saves nothing and says nothing (`'cancelled'`).
 *
 *  ONE named-arguments object, never two positional strings. With `(filename: string, text: string)`
 *  the Homebrew page passed `(text, filename)` from v0.1.9 until 2026-10 and tsc accepted it: every
 *  homebrew file it saved was NAMED after the JSON and HELD only the 27 characters of its own name.
 *  `{ filename, text }` cannot be swapped, and assertDownloadFilename refuses a name that looks like
 *  file content at run time as well (test/download-filename-guard.test.ts).
 *
 *  NOT an `async function`, on purpose: a bad name throws SYNCHRONOUSLY, before anything opens or is
 *  awaited, and the browser route clicks its anchor inside the caller's own click. Callers `await` it
 *  inside their try/catch, so a refused name and a failed save or share both reach their notice, always
 *  as an Error with words in its message. */
export interface DownloadFile {
  filename: string;
  text: string;
  /** The file's media type. Every file the app saves today is JSON. */
  mime?: string;
  /** The Android chooser's overlay style (confirm.tsx `DialogStyle`): the campaign tracker's exports pass
   *  the tracker's look and a z-index above its windows — a pop-up opened in the tracker wears the
   *  tracker's colours (owner, 2026-10-01). Omitted → the app's look, as every other export. The web and
   *  PC route raises no dialog and ignores it. */
  style?: DialogStyle;
}

/** What became of the file: saved (anchor download or the picked folder), handed to the share sheet,
 *  or nothing at all because the player cancelled. */
export type DownloadOutcome = 'saved' | 'shared' | 'cancelled';

export function downloadText({ filename, text, mime = 'application/json', style }: DownloadFile): Promise<DownloadOutcome> {
  assertDownloadFilename(filename);
  if (isTauri && isMobilePlatform) return saveOrShareOnPhone(filename, text, mime, style).catch(rejectAsError);
  const picker = savePicker();
  if (picker) return saveWithPicker(picker, filename, text, mime);
  anchorDownload(filename, text, mime);
  return Promise.resolve('saved');
}

/** The browser's "Save as" window (the File System Access API's `showSaveFilePicker`), when it has one.
 *  Chrome and Edge on a PC and the PC app's WebView2 do; Firefox, Safari and most phone browsers do not. */
type SavePicker = (options: {
  suggestedName: string;
  id?: string;
  startIn?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }>;

function savePicker(): SavePicker | null {
  const w = typeof window !== 'undefined' ? (window as unknown as { showSaveFilePicker?: SavePicker }) : undefined;
  return typeof w?.showSaveFilePicker === 'function' ? w.showSaveFilePicker.bind(window) : null;
}

/** Opens the "Save as" window with the file's name filled in, then writes the text where the player
 *  picked. `id` makes the window open in the folder the player used last time (Downloads the first time).
 *  The window opens before the first `await`, so it still counts as part of the player's click. */
async function saveWithPicker(picker: SavePicker, filename: string, text: string, mime: string): Promise<DownloadOutcome> {
  const ext = filename.slice(filename.lastIndexOf('.'));
  let handle: Awaited<ReturnType<SavePicker>>;
  try {
    handle = await picker({
      suggestedName: filename,
      id: 'heroes-heaven-export',
      startIn: 'downloads',
      types: [{ description: `${ext.slice(1).toUpperCase()} file`, accept: { [mime]: [ext] } }],
    });
  } catch (e) {
    // Cancel (or closing the window) is an AbortError: no file, no notice.
    if ((e as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled';
    // The browser would not open the window (no recent click, a blocked frame): the old download instead.
    anchorDownload(filename, text, mime);
    return 'saved';
  }
  try {
    const out = await handle.createWritable();
    await out.write(text);
    await out.close();
  } catch (e) {
    throw e instanceof Error ? e : new Error(typeof e === 'string' && e.trim() ? e : 'The file could not be saved there.');
  }
  return 'saved';
}

/** Every caller's notice reads `(e as Error).message`. Tauri's invoke — and so the save picker, the
 *  write and the share command — rejects with the native error as a plain STRING (`Result<_, String>`
 *  commands; plugin-fs and plugin-dialog serialize theirs with serialize_str), which has no `.message`:
 *  the phone showed "Export failed: undefined", or a bare "Export failed". Whatever the phone rejects
 *  with leaves here as an Error that carries its words (test/download-platform-route.test.tsx). */
function rejectAsError(e: unknown): never {
  throw asError(e);
}

function asError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string' && e.trim()) return new Error(e);
  const message = typeof e === 'object' && e !== null ? (e as { message?: unknown }).message : undefined;
  return new Error(typeof message === 'string' && message.trim() ? message : 'The phone could not save or share the file.');
}

/** The web + PC route: a temporary object-URL anchor, clicked at once. */
function anchorDownload(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The Android route. Both choices sit in the app's own dialog (never a native prompt), and the
 *  plugins load only here, the way platform.ts openExternal loads the opener: the web bundle does not
 *  carry them. */
async function saveOrShareOnPhone(filename: string, text: string, mime: string, style?: DialogStyle): Promise<DownloadOutcome> {
  const how = await chooseDialog({
    title: 'Export',
    message: filename,
    buttons: [
      { value: 'save', primary: true, label: withIcon('ti-folder-down', 'Save to folder') },
      { value: 'share', label: withIcon('ti-share', 'Share') },
    ],
    style,
  });
  if (how === 'save') {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const ext = filename.slice(filename.lastIndexOf('.') + 1);
    // The system "save as" picker. On Android it answers with a content:// address for the document
    // the player created, which tauri-plugin-fs writes through Android's own content resolver.
    const target = await save({ defaultPath: filename, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!target) return 'cancelled';
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(target, text);
    return 'saved';
  }
  if (how === 'share') {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('share_text_file', { filename, text, mime });
    return 'shared';
  }
  return 'cancelled';
}

function withIcon(icon: string, label: string) {
  return createElement(Fragment, null, createElement('i', { className: `ti ${icon}`, 'aria-hidden': 'true' }), ` ${label}`);
}

/** Throws unless `filename` can be a name the app meant: no line break, no `{` and no `"` (those are
 *  JSON text, not a name), and an extension after at least one character. */
function assertDownloadFilename(filename: unknown): void {
  if (typeof filename !== 'string' || /[\r\n{"]/.test(filename) || !/.\.[A-Za-z0-9]{1,10}$/.test(filename)) {
    const shown = String(filename).replace(/\s+/g, ' ').slice(0, 40);
    throw new Error(`"${shown}" is not a file name, so nothing was saved.`);
  }
}

/** A name as a file-name stem: lower case, runs of anything but letters and digits become one '-'.
 *  An empty result falls back to 'character'. Shared by the roster's and the GM sheet's exports. */
export function fileSlug(name: string): string {
  return (name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
}
