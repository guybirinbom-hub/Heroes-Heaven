import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Workbox's OWN lookup code (what the service worker runs), not a copy of it.
import { generateURLVariations } from 'workbox-precaching/utils/generateURLVariations.js';

/**
 * 2026-10-20: offline, the website showed every icon as a blank box. The icon font IS precached by the
 * service worker, but Tabler's CSS asks for it as `tabler-icons.woff2?v3.44.0`, and the precache only
 * matches a request whose query parameters are all stripped by `ignoreURLParametersMatching` — `v3.44.0`
 * was not, so the lookup missed and the request went to the (absent) network.
 *
 * This holds the config against the CSS the app actually imports, so a Tabler update that changes its
 * tag (or a config edit that drops the pattern) goes red here instead of on someone's phone at the table.
 */

const ROOT = path.join(__dirname, '..');
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8');

/** The regexes in vite.config.ts's `ignoreURLParametersMatching: [...]`, built as the service worker builds them. */
function ignoredParams(config: string): RegExp[] {
  const m = config.match(/ignoreURLParametersMatching:\s*\[([^\]]*)\]/);
  if (!m) return [];
  return [...m[1].matchAll(/\/((?:\\\/|[^/])+)\/([a-z]*)/g)].map((r) => new RegExp(r[1], r[2]));
}

/** Every URL workbox-precaching tries for a request, in order — its own generator, run as the worker runs it. */
function precacheTries(url: string, ignore: RegExp[]): string[] {
  vi.stubGlobal('location', { href: 'https://hh.test/' });
  return [...generateURLVariations(new URL(url, 'https://hh.test/assets/').href, { ignoreURLParametersMatching: ignore })];
}

afterEach(() => vi.unstubAllGlobals());

describe('the icon font is found in the precache offline', () => {
  const main = read('src/main.tsx');
  const cssImport = main.match(/import '(@tabler\/icons-webfont\/[^']+\.css)'/)?.[1];

  it('the app imports the Tabler CSS this test reads', () => {
    expect(cssImport).toBeTruthy();
  });

  // mutation-proof: drop /^v\d/ from vite.config.ts and this goes red.
  it("the browser's first choice of font file (woff2) resolves to the precached file, with no query left", () => {
    const css = read(`node_modules/${cssImport}`);
    const face = css.match(/font-family:\s*"tabler-icons";[^}]*?src:\s*url\("([^"]+)"\)\s*format\("woff2"\)/);
    expect(face, 'the plain tabler-icons @font-face with woff2 first').toBeTruthy();
    const asked = face![1];
    const tries = precacheTries(asked, ignoredParams(read('vite.config.ts')));
    expect(
      tries.some((t) => t.endsWith('tabler-icons.woff2')),
      `${asked} is looked up as ${tries.join(' | ')}`,
    ).toBe(true);
  });

  it("workbox's defaults alone miss it — the case this guards", () => {
    const css = read(`node_modules/${cssImport}`);
    const asked = css.match(/url\("([^"]*tabler-icons\.woff2\?[^"]+)"\)/)![1];
    expect(precacheTries(asked, [/^utm_/, /^fbclid$/]).some((t) => t.endsWith('tabler-icons.woff2'))).toBe(false);
  });

  it('the parser reads the patterns workbox gets', () => {
    expect(ignoredParams('ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v\\d/],').map(String)).toEqual(['/^utm_/', '/^fbclid$/', '/^v\\d/']);
  });
});
