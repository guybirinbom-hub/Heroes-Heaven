import { describe, it, expect } from 'vitest';
import { sanitizeImportedPortrait, MAX_RAW_PORTRAIT_CHARS } from '../src/sheet/imageUtil';

/*
 * The canvas/Image APIs don't exist in the node test environment, so the downscale attempt itself
 * always fails here — which is exactly the failure path we need to pin down: what gets STORED when
 * an imported portrait can't be re-encoded. The happy path (an actual decode + canvas re-encode)
 * is the same code the in-app upload uses (downscaleImage → downscaleDataUrl).
 */
describe('WG-import portrait sanitizing (decision logic)', () => {
  const big = 'A'.repeat(MAX_RAW_PORTRAIT_CHARS + 1);

  it('absent/empty portraits stay absent', async () => {
    expect(await sanitizeImportedPortrait(undefined)).toBeUndefined();
    expect(await sanitizeImportedPortrait('')).toBeUndefined();
  });

  it('plain http(s) URLs pass through untouched', async () => {
    const url = 'https://example.com/portrait.png';
    expect(await sanitizeImportedPortrait(url)).toBe(url);
  });

  it('a small un-re-encodable data URL is kept as-is', async () => {
    const url = 'data:image/png;base64,iVBORw0KGgo=';
    expect(await sanitizeImportedPortrait(url)).toBe(url);
  });

  it('a huge un-re-encodable data URL is dropped rather than stored raw', async () => {
    expect(await sanitizeImportedPortrait(`data:image/png;base64,${big}`)).toBeUndefined();
  });

  it('small SVG/GIF pass through (canvas cannot faithfully re-encode them)', async () => {
    const svg = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    const gif = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    expect(await sanitizeImportedPortrait(svg)).toBe(svg);
    expect(await sanitizeImportedPortrait(gif)).toBe(gif);
  });

  it('a huge GIF is not passed through — it gets the downscale attempt (dropped when that fails)', async () => {
    expect(await sanitizeImportedPortrait(`data:image/gif;base64,${big}`)).toBeUndefined();
  });
});
