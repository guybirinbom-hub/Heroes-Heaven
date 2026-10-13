import { createElement, Fragment } from 'react';
import { isMobilePlatform, isTauri } from '../platform';
import { chooseDialog } from './confirm';

/** Save a text file the player asked for. One helper for every export in the app (backup, roster
 *  character, GM character, homebrew), with one route per shell:
 *   - a browser tab, the PWA and the PC app (WebView2) download it through a temporary object-URL
 *     anchor, exactly as before (`'saved'`; the browser or WebView2 puts it in Downloads);
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
}

/** What became of the file: saved (anchor download or the picked folder), handed to the share sheet,
 *  or nothing at all because the player cancelled. */
export type DownloadOutcome = 'saved' | 'shared' | 'cancelled';

export function downloadText({ filename, text, mime = 'application/json' }: DownloadFile): Promise<DownloadOutcome> {
  assertDownloadFilename(filename);
  if (isTauri && isMobilePlatform) return saveOrShareOnPhone(filename, text, mime).catch(rejectAsError);
  anchorDownload(filename, text, mime);
  return Promise.resolve('saved');
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
async function saveOrShareOnPhone(filename: string, text: string, mime: string): Promise<DownloadOutcome> {
  const how = await chooseDialog({
    title: 'Export',
    message: filename,
    buttons: [
      { value: 'save', primary: true, label: withIcon('ti-folder-down', 'Save to folder') },
      { value: 'share', label: withIcon('ti-share', 'Share') },
    ],
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
