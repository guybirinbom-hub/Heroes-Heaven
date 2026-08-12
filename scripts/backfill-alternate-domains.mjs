/*
 * Alternate domains, and the one feat that needs them.
 *
 * The importer kept only each deity's PRIMARY domains (AoN's `domain_primary`), so the alternates —
 * 401 deities have them — never shipped. Splinter Faith says "chosen from among your deity's domains,
 * your deity's alternate domains, and up to one domain that isn't on either list", and with no
 * alternates in the data the widest thing that feat could offer was the same four domains every
 * cleric already had.
 *
 * Alternates are computed as `domain` minus `domain_primary`, both straight from the mirror; where
 * AoN gives no `domain_primary` there is nothing to subtract and the deity is left alone.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/deity';

if (!existsSync(MIRROR)) {
  console.error(`No AoN mirror at ${MIRROR} — refusing to invent domain lists.`);
  process.exit(1);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** deity name (lowercased) → alternate domain slugs. */
const alternates = new Map();
for (const f of readdirSync(MIRROR)) {
  let j;
  try {
    j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  } catch {
    continue;
  }
  for (const r of Array.isArray(j) ? j : [j]) {
    if (!r.name || !Array.isArray(r.domain) || !Array.isArray(r.domain_primary)) continue;
    const primary = new Set(r.domain_primary.map(slug));
    const alt = r.domain.map(slug).filter((d) => !primary.has(d));
    if (alt.length) alternates.set(String(r.name).toLowerCase(), alt);
  }
}
console.log(`[domains] ${alternates.size} deities have alternate domains in the mirror`);

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
let matched = 0;
for (const [id, deity] of Object.entries(core.deities)) {
  const alt = alternates.get(String(deity.name ?? '').toLowerCase());
  if (!alt) continue;
  // Only write domains the app can actually resolve to a focus spell / label.
  const own = new Set(deity.domains ?? []);
  const fresh = alt.filter((d) => !own.has(d));
  if (!fresh.length) continue;
  deity.alternateDomains = fresh;
  entries.push({ category: 'deities', id, field: 'alternateDomains', value: fresh });
  matched++;
}
console.log(`[domains] ${matched} shipped deities gained an alternate list`);

// Splinter Faith: the four-domain pick that needed them.
const SPLINTER = {
  flag: 'splinterDomains',
  prompt: 'Splinter faith domains',
  kind: 'domains',
  domainPool: 'deity+alternate',
  picks: 4,
  distinct: true,
  // The third source the feat allows cannot be offered safely: nothing in the data marks a domain
  // anathematic to a deity, and the heightening penalty for an off-list domain is not modelled.
  // Stated rather than silently ignored — this is what `note` is for.
  note:
    'You may also take up to ONE domain from outside both lists, so long as it is not anathematic to your deity — pick it here only if your GM agrees. A domain spell from a domain on neither list is always heightened to 1 rank lower than usual.',
};
if (!core.feats['splinter-faith']) {
  console.error('splinter-faith is not a feat in core.json — its choice was not written.');
} else if (core.feats['splinter-faith'].choice) {
  console.error(`splinter-faith already carries a choice (${core.feats['splinter-faith'].choice.flag}) — not replacing it.`);
} else {
  core.feats['splinter-faith'].choice = SPLINTER;
  entries.push({ category: 'feats', id: 'splinter-faith', field: 'choice', value: SPLINTER });
  console.log('[domains] splinter-faith now asks for four domains');
}

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wrote ${entries.length} entries (backfill ${backfill.length} → ${next.length})`);
