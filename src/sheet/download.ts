/** Trigger a browser download of a text file via a temporary object-URL anchor. This is the one
 *  download mechanism the app uses: a browser tab and the Tauri desktop window (WebView2) both save the
 *  file under `filename`. The Android APK's WebView has no download listener, so there it saves nothing
 *  yet — a native save/share route for Android is a separate job.
 *
 *  ONE named-arguments object, never two positional strings. With `(filename: string, text: string)`
 *  the Homebrew page passed `(text, filename)` from v0.1.9 until 2026-10 and tsc accepted it: every
 *  homebrew file it saved was NAMED after the JSON and HELD only the 27 characters of its own name.
 *  `{ filename, text }` cannot be swapped, and assertDownloadFilename refuses a name that looks like
 *  file content at run time as well (test/download-filename-guard.test.ts). */
export interface DownloadFile {
  filename: string;
  text: string;
  /** The Blob's media type. Every file the app saves today is JSON. */
  mime?: string;
}

export function downloadText({ filename, text, mime = 'application/json' }: DownloadFile): void {
  assertDownloadFilename(filename);
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
