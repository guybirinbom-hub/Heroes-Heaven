/**
 * OWNS the tradition of every innate grant whose own sentence names one and whose data did not.
 *
 *   node scripts/apply-innate-tradition-sweep.mjs --dry   # what it would write
 *   node scripts/apply-innate-tradition-sweep.mjs         # writes core.json + the overlay
 *
 * The audit named ONE record in this shape (Awakened Jewel's pick). `npm run scan:traditions` reads
 * every innate grant in every bucket and finds ELEVEN more, none of which anyone had read — and FIVE
 * of those show a tradition on the sheet today that the record's own sentence contradicts, because
 * `buildCharacter` falls back to the SPELL's first listed tradition when the grant carries none:
 *
 *     Heroes' Call     "innate occult spell"  → the app showed Divine
 *     Elemental Wrath  "innate primal spell"  → the app showed Arcane
 *     Sense Thoughts   "innate occult spell"  → the app showed Arcane
 *     Brilliant Vision "innate occult spell"  → the app showed Arcane
 *     Replicate        "innate occult spell"  → the app showed Arcane
 *
 * The other six were right by luck (the spell's first tradition happened to match) and are authored
 * anyway, because "right until the importer reorders a spell's traditions" is not right.
 *
 * ⚠ Each entry quotes the sentence it comes from, and the script REFUSES to write unless that
 * sentence is still in the record's printed text AND still names that one tradition. So this cannot
 * drift away from the book: if the text changes, it stops rather than reasserting a stale value.
 * Every value here was additionally checked against the AoN mirror at
 * C:/wonderers guide/aon-2e-archive/data/by-category/feat (ground truth; Foundry is not).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';
import { audit, textOf, traditionsNamed } from './scan-innate-traditions.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (f) => join(ROOT, f);
const DRY = process.argv.includes('--dry');

const raw = readFileSync(p('public/core.json'), 'utf8');
const core = JSON.parse(raw);
/* A full parse→stringify of the minified core.json must be byte-identical, or this script is silently
 * reformatting the file it was only meant to edit. Asserted, not assumed. */
if (JSON.stringify(core) !== raw) {
  console.error('public/core.json does not round-trip through JSON.parse/stringify — REFUSING to rewrite it.');
  process.exit(1);
}

/** key → { spellId → { tradition, quote } }. The quote is a fragment of the record's own sentence. */
const WRITES = {
  'feats/irriseni-ice-witch': { 'wall-of-ice': { tradition: 'arcane', quote: 'Wall of Ice as an innate arcane spell once per day' } },
  'feats/heroes-call': { heroism: { tradition: 'occult', quote: 'Heroism as a 3rd-rank innate occult spell' } },
  'feats/elemental-wrath': { 'acid-splash': { tradition: 'primal', quote: 'Acid Splash cantrip as an innate primal spell at will' } },
  'feats/sense-thoughts': { 'mind-reading': { tradition: 'occult', quote: 'Mind Reading as an innate occult spell once per day' } },
  'feats/dig-up-secrets': { hypercognition: { tradition: 'occult', quote: 'as an innate occult spell once per day' } },
  'feats/astral-blink': { translocate: { tradition: 'arcane', quote: 'Translocate once per hour as a 4th-rank innate arcane spell' } },
  'feats/reimagine': { 'dreaming-potential': { tradition: 'occult', quote: 'Dreaming Potential as an innate occult spell' } },
  'feats/mentor-of-legends': { heroism: { tradition: 'divine', quote: 'cast Heroism as an innate divine spell' } },
  'feats/siphon-torment': { 'claim-curse': { tradition: 'divine', quote: 'cast Claim Curse as an innate divine spell' } },
  'feats/brilliant-vision': { 'see-the-unseen': { tradition: 'occult', quote: 'See the Unseen as an innate occult spell once per day' } },
  'feats/replicate': { 'illusory-disguise': { tradition: 'occult', quote: 'Illusory Disguise once per day as an innate occult spell' } },
};

const catOf = (k) => k.slice(0, k.indexOf('/'));
const idOf = (k) => k.slice(k.indexOf('/') + 1);
const problems = [];

for (const [key, spells] of Object.entries(WRITES)) {
  const rec = core[catOf(key)]?.[idOf(key)];
  if (!rec) {
    problems.push(`${key} is not in core.json`);
    continue;
  }
  const text = textOf(catOf(key), idOf(key));
  for (const [spellId, { tradition, quote }] of Object.entries(spells)) {
    const g = (rec.innateSpells ?? []).find((x) => x.spellId === spellId);
    if (!g) problems.push(`${key} does not grant ${spellId}`);
    // Never clobber another lane: a grant that already names a tradition is not this script's.
    else if (g.tradition && g.tradition !== tradition) problems.push(`${key} ${spellId} already says ${g.tradition}, not ${tradition}`);
    if (!text.includes(quote)) problems.push(`${key} no longer prints "${quote}"`);
    const named = traditionsNamed(text);
    if (!(named.length === 1 && named[0] === tradition))
      problems.push(`${key} text now names [${named.join('/') || 'nothing'}], not just ${tradition}`);
    // A tradition the spell is not even on would be a typo that silently mislabels the entry.
    if (!(core.spells?.[spellId]?.traditions ?? []).includes(tradition))
      problems.push(`${key} → ${spellId} is not on the ${tradition} list (${(core.spells?.[spellId]?.traditions ?? []).join('/') || 'no traditions'})`);
  }
}

/* The corpus decides the SCOPE, not this table: if content grows a twelfth record in the same shape,
 * this refuses rather than quietly under-covering — the same guard `apply-innate-cantrip-lane.mjs`
 * uses for Bone Magic's Special clause. */
const found = audit()
  .todo.map((x) => `${x.key}|${x.spellId}|${x.tradition}`)
  .sort();
const table = Object.entries(WRITES)
  .flatMap(([key, spells]) => Object.entries(spells).map(([spellId, v]) => `${key}|${spellId}|${v.tradition}`))
  .sort();
const missingFromTable = found.filter((x) => !table.includes(x));
if (missingFromTable.length && !process.argv.includes('--allow-partial'))
  problems.push(`scan:traditions finds records this table does not author: ${missingFromTable.join(', ')}`);

if (problems.length) {
  console.log('REFUSING TO WRITE:');
  problems.forEach((m) => console.log('  ' + m));
  process.exit(1);
}

const rows = [];
for (const [key, spells] of Object.entries(WRITES)) {
  const rec = core[catOf(key)][idOf(key)];
  // WHOLE-VALUE, field-level: every other field of every other grant is copied through untouched.
  const value = rec.innateSpells.map((g) => (spells[g.spellId] ? { ...g, tradition: spells[g.spellId].tradition } : g));
  rows.push({ category: catOf(key), id: idOf(key), field: 'innateSpells', value });
}

console.log(`${rows.length} records · ${table.length} grants gain a tradition`);
for (const [key, spells] of Object.entries(WRITES))
  for (const [spellId, v] of Object.entries(spells)) console.log(`  ${key} ${spellId} → ${v.tradition}`);
if (DRY) {
  console.log('\n--dry: nothing written');
  process.exit(0);
}

for (const r of rows) core[r.category][r.id][r.field] = r.value;
writeFileSync(p('public/core.json'), JSON.stringify(core)); // MINIFIED — pretty-printing it costs 4 MB

const overlay = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const r of rows) {
  const at = overlay.findIndex((x) => x.category === r.category && x.id === r.id && x.field === r.field && !x.path && !x.create);
  if (at >= 0) {
    overlay[at].value = r.value;
    updated++;
  } else {
    overlay.push({ category: r.category, id: r.id, field: r.field, value: r.value });
    added++;
  }
}
writeBackfill(ROOT, overlay);
console.log(`\noverlay: ${added} added, ${updated} refreshed (now ${overlay.length} rows)`);
console.log('written: public/core.json, scripts/data/effect-backfill.json');
