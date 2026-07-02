/** Trigger a browser download of a text file via a temporary object-URL anchor. This is the one
 *  download mechanism the app uses — it works in a browser tab, the Tauri desktop window, and the
 *  Android WebView alike. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
