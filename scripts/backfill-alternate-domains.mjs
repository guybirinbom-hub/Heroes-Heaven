/*
 * Deity domain lists — the primary ones, the alternates, and the one feat that needs both.
 *
 * The importer kept only each deity's PRIMARY domains (AoN's `domain_primary`), so the alternates —
 * 401 deities have them — never shipped. Splinter Faith says "chosen from among your deity's domains,
 * your deity's alternate domains, and up to one domain that isn't on either list", and with no
 * alternates in the data the widest thing that feat could offer was the same four domains every
 * cleric already had.
 *
 * Alternates are computed as `domain` minus `domain_primary`, both straight from the mirror; where
 * AoN gives no `domain_primary` there is nothing to subtract and the deity is left alone.
 *
 * SHORT PRIMARY LISTS. A PF2e deity stat block prints four domains — demigods included. Three of
 * AoN's 719 deity docs print only three, and the printed book gives every one of those three a
 * fourth that AoN simply does not carry:
 *
 *     deity-156 Lissala  AoN [fate, glyph, magic]   book adds `toil`   (Divine Mysteries)
 *     deity-260 Haagenti AoN [change, might, wealth] book adds `toil`  (Divine Mysteries)
 *     deity-732 Alocer   AoN [nature, pain, zeal]   book adds `might`  (One-Shot #2: Lionlodge)
 *
 * This is not cosmetic. Splinter Faith asks for FOUR DISTINCT domains out of the deity's own list
 * plus its alternates, so a three-domain deity dead-ends the builder — the picker can never be
 * completed. Lissala and Haagenti carried their fourth domain from the original Foundry-sourced
 * core; a delta import re-read Alocer straight from AoN and dropped `might`, which is what turned
 * the latent gap into a live one. Restoring it here means the next re-import cannot repeat it.
 *
 * The repair is deliberately narrow. Foundry is NOT treated as authoritative in general — it still
 * carries the legacy domain names (void/delirium/wyrmkin) and lags the remaster on deities like
 * Desna, so a blanket sync would corrupt 22 records. It is consulted ONLY where AoN's own printed
 * list is short of four, and it may only ADD.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/deity';
/** The Foundry pf2e system's deity pack — the community's transcription of the printed stat blocks. */
const FOUNDRY = '.import-src/pf2e/packs/pf2e/deities';
/** Every PF2e deity stat block prints this many domains; fewer means AoN under-reported. */
const PRINTED_DOMAINS = 4;

if (!existsSync(MIRROR)) {
  console.error(`No AoN mirror at ${MIRROR} — refusing to invent domain lists.`);
  process.exit(1);
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** deity name (lowercased) → alternate domain slugs. */
const alternates = new Map();
/** deity name (lowercased) → how many domains AoN prints. Max across name collisions, so a
 *  same-named companion doc can never make a healthy deity look short. */
const printedDomains = new Map();
for (const f of readdirSync(MIRROR)) {
  let j;
  try {
    j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  } catch {
    continue;
  }
  for (const r of Array.isArray(j) ? j : [j]) {
    if (!r.name || !Array.isArray(r.domain)) continue;
    const name = String(r.name).toLowerCase();
    printedDomains.set(name, Math.max(printedDomains.get(name) ?? 0, r.domain.length));
    if (!Array.isArray(r.domain_primary)) continue;
    const primary = new Set(r.domain_primary.map(slug));
    const alt = r.domain.map(slug).filter((d) => !primary.has(d));
    if (alt.length) alternates.set(name, alt);
  }
}
console.log(`[domains] ${alternates.size} deities have alternate domains in the mirror`);

/** deity name (lowercased) → the primary domains the printed book gives it, or null with no source. */
function foundryPrimaryByName() {
  if (!existsSync(FOUNDRY)) return null;
  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!e.name.endsWith('.json')) continue;
      let j;
      try {
        j = JSON.parse(readFileSync(p, 'utf8'));
      } catch {
        continue;
      }
      if (j?.type === 'deity' && j.name) out.set(String(j.name).toLowerCase(), (j.system?.domains?.primary ?? []).map(slug));
    }
  };
  walk(FOUNDRY);
  return out;
}

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];

// Repair short primary lists BEFORE the alternates pass, which subtracts a deity's own domains.
const bookPrimary = foundryPrimaryByName();
let repaired = 0;
if (!bookPrimary) {
  console.warn(`[domains] no printed-stat-block source at ${FOUNDRY} — skipping the short-list repair; the rows already in the overlay still stand`);
} else {
  for (const [id, deity] of Object.entries(core.deities)) {
    const name = String(deity.name ?? '').toLowerCase();
    const printed = printedDomains.get(name);
    // Untouched unless AoN itself under-reports. A deity with NO domains is a philosophy or pantheon
    // that genuinely has none, so 0 is left alone too.
    if (!printed || printed >= PRINTED_DOMAINS) continue;
    const book = bookPrimary.get(name);
    if (!book?.length) continue;
    const own = deity.domains ?? [];
    const restored = book.filter((d) => !own.includes(d));
    if (!restored.length) continue;
    const value = [...own, ...restored].sort();
    deity.domains = value;
    entries.push({ category: 'deities', id, field: 'domains', value });
    console.log(`[domains] ${id}: AoN prints ${printed}, restored ${restored.join(', ')} from the stat block → ${value.join(', ')}`);
    repaired++;
  }
}
console.log(`[domains] ${repaired} deities had a domain AoN drops restored`);

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
// Rewrite each row WHERE IT ALREADY SITS and append only genuinely new keys. Dropping every row and
// re-appending it moved 331 unchanged alternate-domain rows to the end of the file, so a one-row
// change read as a 3,000-line diff — the exact unreviewability lib/write-backfill.mjs exists to stop.
const pending = new Map(entries.map((e) => [key(e), e]));
const placed = new Set();
const next = [];
for (const row of backfill) {
  const k = key(row);
  if (!pending.has(k)) {
    next.push(row);
    continue;
  }
  if (placed.has(k)) continue; // a duplicate of a row already replaced above
  next.push(pending.get(k));
  placed.add(k);
}
for (const e of entries) if (!placed.has(key(e))) next.push(e);
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`wrote ${entries.length} entries (backfill ${backfill.length} → ${next.length})`);
