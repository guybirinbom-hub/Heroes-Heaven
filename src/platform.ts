/*
 * Platform detection. The app runs in three shells: a browser tab, the Tauri DESKTOP window
 * (Windows/macOS/Linux — with custom min/max/close chrome), and a Tauri MOBILE WebView (Android/iOS,
 * no OS window chrome). `isTauri` is true for BOTH Tauri shells, so anything window-chrome- or
 * desktop-only must gate on `isDesktopApp`, not `isTauri`.
 */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
/** A touch/phone platform (Android or iOS WebView). */
export const isMobilePlatform = /android|iphone|ipad|ipod/i.test(ua);
/** The Tauri DESKTOP shell — the only place with an OS window to minimize/maximize/close. */
export const isDesktopApp = isTauri && !isMobilePlatform;

/** A `target="_blank"` anchor's click, for the Tauri shells: their WebView swallows the navigation, so
 *  the URL goes to the OS through tauri-plugin-opener (the same route as UpdateNotice). In a browser
 *  this does nothing and the anchor opens its tab. */
export async function openExternal(e: { preventDefault: () => void }, url: string): Promise<void> {
  if (!isTauri) return;
  e.preventDefault();
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noreferrer');
  }
}
