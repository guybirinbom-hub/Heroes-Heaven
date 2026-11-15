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

/** Hand a URL to the OS from a Tauri shell, through tauri-plugin-opener: the default browser on the PC,
 *  and on Android the browser's download manager (the only thing there that can fetch an .apk). The
 *  plugin refuses every URL unless capabilities/default.json grants a URL scope next to
 *  opener:allow-open-url (it grants opener:allow-default-urls: http, https, mailto, tel); without it,
 *  every app link opened nothing (Guy, 2026-11-08; test/update-button.test.tsx). */
export async function openInOs(url: string): Promise<void> {
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } catch {
    window.open(url, '_blank', 'noreferrer');
  }
}

/** A `target="_blank"` anchor's click, for the Tauri shells: their WebView swallows the navigation, so
 *  the URL goes to the OS through openInOs. In a browser this does nothing and the anchor opens its tab. */
export async function openExternal(e: { preventDefault: () => void }, url: string): Promise<void> {
  if (!isTauri) return;
  e.preventDefault();
  await openInOs(url);
}
