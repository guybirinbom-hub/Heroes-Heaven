#!/usr/bin/env node
/*
 * THE FRESHNESS RULE FOR THE WEB BUILD'S SERVICE WORKER (2026-10-16) — part of `npm run verify`.
 *
 * A phone ran new code on months-old rules data because a runtime-cache route served a FIXED URL
 * CacheFirst: CacheFirst never asks the network again for a URL it holds (the route dates from the
 * web version's first commit, 2026-07-07). The tracker's /data/ files had the milder form
 * (StaleWhileRevalidate at fixed URLs: one open behind after every update). The rule:
 *   - a route may be CacheFirst / StaleWhileRevalidate / CacheOnly ONLY if it is declared in VERSIONED
 *     below AND the code that builds its URLs still puts the file's version in them;
 *   - every other route must be NetworkFirst or NetworkOnly (fresh online, cached copy offline).
 * Adding a keep-a-copy route without a versioned URL fails this check. test/sw-freshness.test.ts
 * proves it rejects v0.1.44's real config.
 *
 *   node scripts/sw-freshness-check.mjs        # exit 1 and the reasons on a violation
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Routes allowed to answer from cache without asking the network, and how their URLs are versioned. */
export const VERSIONED = [
  {
    // the rules data: dataFileUrl() appends ?v=<sha1 of the file's bytes>
    pattern: /\\\/core\(-descriptions\)\?\\\.json\$/,
    versionedBy: { file: 'src/data/index.ts', mustContain: /return tauri \|\| !v \? path : `\$\{path\}\?v=\$\{v\}`/ },
  },
];
const KEEPS = new Set(['CacheFirst', 'StaleWhileRevalidate', 'CacheOnly']);
const FRESH = new Set(['NetworkFirst', 'NetworkOnly']);

/** Every runtimeCaching route of a vite.config.ts text: its urlPattern source and its handler. */
export function routes(config) {
  const block = config.slice(config.indexOf('runtimeCaching:'));
  const out = [];
  const re = /urlPattern:\s*([^\n]+)\n[\s\S]*?handler:\s*'([A-Za-z]+)'/g;
  for (let m = re.exec(block); m; m = re.exec(block)) out.push({ pattern: m[1].trim(), handler: m[2] });
  return out;
}

/** The violations of the rule for a config text plus a way to read the repo's source files. */
export function violations(config, read) {
  const bad = [];
  const found = routes(config);
  if (!found.length) bad.push('no runtimeCaching routes found — the parser no longer matches vite.config.ts');
  for (const r of found) {
    if (FRESH.has(r.handler)) continue;
    if (!KEEPS.has(r.handler)) {
      bad.push(`unknown handler ${r.handler} on ${r.pattern}`);
      continue;
    }
    const v = VERSIONED.find((x) => x.pattern.test(r.pattern));
    if (!v) bad.push(`${r.handler} on ${r.pattern} keeps a copy at a URL that is not versioned — make it NetworkFirst, or version its URLs and declare it in scripts/sw-freshness-check.mjs`);
    else if (!v.versionedBy.mustContain.test(read(v.versionedBy.file))) bad.push(`${r.pattern} is ${r.handler} but ${v.versionedBy.file} no longer puts the version in its URL`);
  }
  return bad;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const read = (f) => readFileSync(join(ROOT, f), 'utf8');
  const bad = violations(read('vite.config.ts'), read);
  if (bad.length) {
    console.error(`sw-freshness-check: ${bad.length} route(s) can keep a device on an old copy:\n${bad.map((b) => `  - ${b}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`sw-freshness-check: OK (${routes(read('vite.config.ts')).length} service-worker routes, every one fresh or versioned)`);
}
