/*
 * READ LIVE ARCHIVES PAGES into scripts/data/live-pages.json (see scripts/lib/live-pages.mjs for why).
 *
 * Per page: the heading's name and level, the rarity trait printed under it, and whether it carries
 * the "Legacy Content" banner. The page URL comes from the Archives' search index (the same proxy
 * scripts/aon-delta-fetch.mjs uses); the facts come from the page itself, because the index and the
 * page disagree on exactly the facts this file exists for.
 *
 * A page with no heading of its own (a class feature is a section of its CLASS page) is reported and
 * not written — a guessed fact is worse than none.
 *
 *   node scripts/read-live-pages.mjs --created              # every page scripts/migration/out/player-created.json names
 *   node scripts/read-live-pages.mjs feat-4380 background-40
 *
 * Network, so it is not part of `npm run data`; scripts/player-coverage-check.mjs fails while a
 * created record's page has not been read.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_PAGES } from './lib/live-pages.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ES = 'https://elasticsearch.aonprd.com/aon/_search';
const SITE = 'https://2e.aonprd.com';
const argv = process.argv.slice(2);

const ids = new Set(argv.filter((a) => !a.startsWith('--')));
if (argv.includes('--created')) {
  const created = JSON.parse(readFileSync(join(ROOT, 'scripts/migration/out/player-created.json'), 'utf8'));
  for (const m of Object.values(created)) for (const { doc } of Object.values(m ?? {})) ids.add(String(doc));
}
if (!ids.size) { console.error('usage: node scripts/read-live-pages.mjs [--created] [doc-id ...]'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, init) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url, { ...init, headers: { 'User-Agent': 'Mozilla/5.0', ...(init?.headers ?? {}) } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    } catch (e) {
      if (i === 2) throw e;
      await sleep(1500 * (i + 1)); // the site is not ours to hammer
    }
  }
}

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&rsquo;/g, '’')
  .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The facts of one page's own heading, or { error }. The heading is the one linking to the page
 * itself (a familiar ability's link carries `&Abilities=true`); a page whose heading links nowhere
 * (the Travel Guide's "Silver (Ingot)") is matched by the index's name instead.
 */
const RIGHT = /<span style="margin-left:auto[^"]*">([^<]*)<\/span>/;
function parsePage(html, url, indexName) {
  const path = url.replace(/^\//, '').toLowerCase();
  let found = null;
  for (const m of html.matchAll(/<h1 class="title">([\s\S]*?)<\/h1>/g)) {
    const inner = m[1];
    const own = [...inner.matchAll(/<a href="\/?([^"]*)">([\s\S]*?)<\/a>/g)]
      .find((a) => { const h = a[1].toLowerCase(); return h === path || h.startsWith(`${path}&`); });
    const name = own ? decode(own[2]) : decode(inner.replace(RIGHT, ''));
    if (own || name.replace(/[’‘]/g, "'").toLowerCase() === String(indexName ?? '').replace(/[’‘]/g, "'").toLowerCase()) {
      found = { m, name, inner };
      break;
    }
  }
  if (!found) return { error: `no heading of its own on ${url}` };
  const end = found.m.index + found.m[0].length;
  const src = html.indexOf('<b>Source</b>', end);
  const head = html.slice(end, src > end ? src : end + 4000);
  const level = /(-?\d+)\s*$/.exec(RIGHT.exec(found.inner)?.[1] ?? '')?.[1];
  return {
    name: found.name,
    level: level == null ? null : Number(level),
    rarity: /class="trait(uncommon|rare|unique)"/i.exec(head)?.[1]?.toLowerCase() ?? 'common',
    legacy: head.includes('legacy-content-warning'),
  };
}

const hits = (await (await get(ES, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ size: ids.size, _source: ['url', 'name'], query: { ids: { values: [...ids] } } }),
})).json()).hits?.hits ?? [];
const urlOf = new Map(hits.map((h) => [h._id, h._source?.url]));
const nameOf = new Map(hits.map((h) => [h._id, h._source?.name]));

const file = join(ROOT, LIVE_PAGES);
const out = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
out._ = 'Facts read off the LIVE Archives pages (the house rule: the live page wins) — scripts/read-live-pages.mjs writes, scripts/lib/live-pages.mjs reads.';
out.pages ??= {};
const read = new Date().toISOString().slice(0, 10);
let n = 0;
for (const id of [...ids].sort()) {
  const url = urlOf.get(id);
  if (!url) { console.log(`  skip ${id}: not in the Archives' index`); continue; }
  const facts = parsePage(await (await get(SITE + url)).text(), url, nameOf.get(id));
  if (facts.error) { console.log(`  skip ${id}: ${facts.error}`); continue; }
  out.pages[id] = { ...facts, read };
  n++;
  console.log(`  ${id.padEnd(22)} ${facts.name} · level ${facts.level ?? '-'} · ${facts.rarity}${facts.legacy ? ' · Legacy Content' : ''}`);
  await sleep(300);
}
out.pages = Object.fromEntries(Object.entries(out.pages).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(file, `${JSON.stringify(out, null, 1)}\n`);
console.log(`${n} page(s) read -> ${LIVE_PAGES}`);
