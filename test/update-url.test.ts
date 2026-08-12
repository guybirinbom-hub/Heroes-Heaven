import { describe, it, expect } from 'vitest';
import { RELEASES_PAGE, updateDownloadUrl } from '../src/data/updateCheck';

/*
 * "Get the update" used to send every platform to the releases PAGE. On a phone that page opens inside
 * the app's own WebView, and tapping the .apk on it does nothing at all — a WebView doesn't download
 * files. The link has to hand the OS the asset itself.
 */
describe('where "Get the update" points', () => {
  it('a phone gets the APK directly, never the releases page', () => {
    const url = updateDownloadUrl({ isTauri: true, isMobile: true });
    expect(url).toMatch(/\.apk$/);
    expect(url).not.toBe(RELEASES_PAGE);
  });

  it('the desktop app gets the installer directly', () => {
    expect(updateDownloadUrl({ isTauri: true, isMobile: false })).toMatch(/\.exe$/);
  });

  it('a browser keeps the releases page — it can download from it perfectly well', () => {
    expect(updateDownloadUrl({ isTauri: false, isMobile: false })).toBe(RELEASES_PAGE);
    expect(updateDownloadUrl({ isTauri: false, isMobile: true })).toBe(RELEASES_PAGE);
  });

  it('uses the version-independent "latest/download" path, so it never goes stale', () => {
    for (const m of [true, false]) {
      expect(updateDownloadUrl({ isTauri: true, isMobile: m })).toContain('/releases/latest/download/');
    }
  });
});
