/*
 * "Whenever you Refocus, completely refill your focus pool."
 *
 * The Refocus control restored exactly one point and no field could say otherwise, so every feat in
 * this family was inert. The feat audit surfaced five of them; this finds them all by reading the
 * printed text, because five was never the real number.
 *
 * Only an UPGRADE counts. The standard clause every focus-pool feature carries — "you can regain
 * 1 Focus Point by spending 10 minutes using the Refocus activity to <flavour>" — describes HOW you
 * Refocus, not how much, and several dedications phrase it as "…and refill your focus pool", which
 * reads like an upgrade and is not one.
 *
 * Usage: node scripts/backfill-refocus.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

/** The upgrade wordings, in priority order. Anything else is the ordinary 1-point clause. */
const ALL = /(completely refill your focus pool|regain all your Focus Points|refill your focus pool) *(instead of 1)?/i;
const N = /recover (\d+) Focus Points? when you Refocus(?: instead of 1)?/i;

const found = [];
for (const [id, r] of Object.entries(core.feats)) {
  const t = clean(r.description);
  if (!/Refocus/i.test(t)) continue;
  // Only sentences that mention Refocus — a "refill during daily preparations" clause elsewhere in
  // the same feat must not be mistaken for a Refocus upgrade.
  const sentences = (t.match(/[^.]*Refocus[^.]*\./gi) ?? []).join(' ');

  const num = sentences.match(N);
  if (num) { found.push({ id, name: r.name, value: Number(num[1]), why: num[0] }); continue; }

  // "…refill your focus pool" only counts when it is what Refocus DOES, not how you perform it.
  // "You can Refocus by meditating … to refill your focus pool" is the ordinary clause.
  if (ALL.test(sentences) && !/you can Refocus by|using the Refocus activity/i.test(sentences)) {
    found.push({ id, name: r.name, value: 'all', why: sentences.match(ALL)[0] });
  }
}

// A suppressed duplicate scrape can never be taken, so patching it is dead data.
const live = found.filter((f) => !(f.id.startsWith('aon-') && core.feats[f.id.slice(4)]));

console.log(`records whose text CHANGES what Refocus restores: ${live.length}`);
for (const f of live.sort((a, b) => String(a.value).localeCompare(String(b.value)) || a.id.localeCompare(b.id))) {
  console.log(`  ${String(f.value).padEnd(4)} ${f.id.padEnd(28)} ${f.why.trim().slice(0, 70)}`);
}
const skipped = found.length - live.length;
if (skipped) console.log(`(${skipped} suppressed aon- duplicates not patched)`);

if (!WRITE) { console.log('\n--write to apply'); process.exit(0); }

const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let added = 0;
for (const f of live) {
  core.feats[f.id].refocusRestore = f.value;
  if (!overlay.some((x) => x.category === 'feats' && x.id === f.id && x.field === 'refocusRestore')) {
    overlay.push({ category: 'feats', id: f.id, field: 'refocusRestore', value: f.value });
    added++;
  }
}
writeFileSync(p('public/core.json'), JSON.stringify(core));
writeFileSync(OVERLAY, JSON.stringify(overlay, null, 2) + '\n');
console.log(`\nwrote ${live.length} records; ${added} new overlay entries`);
