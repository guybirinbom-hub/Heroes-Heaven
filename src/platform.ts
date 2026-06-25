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
