/** App version from package.json, injected at build time (`define` in vite.config.ts). The typeof
 *  guard keeps consumers outside Vite/Vitest (plain tsc, a bare test runner) from crashing. */
export const APP_VERSION: string = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';

/** Each rules-data file's own version (the first 12 hex of the sha1 of its bytes; vite.config.ts). It is
 *  part of the URL the file is fetched from, so the web build's CacheFirst service worker treats new
 *  data as a new file instead of serving the first visit's copy forever, and the loader checks what it
 *  received against it (src/data/dataFreshness.ts). Stamped by `vite build` only; empty on the dev
 *  server and in tests, where the data is fetched at its plain path and not checked. */
export const DATA_VERSIONS: Readonly<Record<string, string>> = typeof __DATA_VERSIONS__ !== 'undefined' ? __DATA_VERSIONS__ : {};
