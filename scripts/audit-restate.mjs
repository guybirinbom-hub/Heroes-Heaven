/*
 * RESTATE — do the audit's headline findings still hold against the CURRENT data?
 *
 * Every number the feat audit produced was measured before the Archives migration rewrote core.json.
 * A finding that has since been fixed, or that has moved, must not be carried forward as if it were
 * still true. This re-derives each headline claim from the files as they stand right now.
 *
 *   node scripts/audit-restate.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const db = JSON.parse(read('public/core.json'));
const desc = JSON.parse(read('public/core-descriptions.json'));

const hidden = new Set([...(db.duplicateIds ?? []), ...(db.umbrellaIds ?? [])]);
const live = (coll, id, r) =>
  r?.name && !hidden.has(id) && !id.startsWith('aon-') && r.edition !== 'superseded';
const textOf = (coll, id) => String(desc[coll]?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const line = (label, was, now, ok) =>
  console.log(`  ${label.padEnd(42)} was ${String(was).padStart(5)}   now ${String(now).padStart(5)}   ${ok ? 'unchanged' : '*** MOVED ***'}`);

console.log('=== A. Corpus shape ===');
const liveFeats = Object.entries(db.feats ?? {}).filter(([id, r]) => live('feats', id, r) && textOf('feats', id));
line('live feats with text', 6206, liveFeats.length, liveFeats.length === 6206);

console.log('\n=== B. The die-format bug (granted strikes render 11d8) ===');
let dieBad = [];
for (const coll of ['feats', 'classFeatures', 'heritages', 'ancestries', 'items']) {
  for (const [id, r] of Object.entries(db[coll] ?? {})) {
    for (const g of r?.grantedStrikes ?? []) if (/^\d+d\d+$/.test(String(g.die ?? ''))) dieBad.push(`${coll}/${id}`);
  }
}
line('grantedStrikes with a baked dice count', 16, dieBad.length, dieBad.length === 16);
const rs = db.feats?.['razorsharp-bite']?.grantedStrikes?.[0]?.die;
console.log(`  razorsharp-bite die value: ${JSON.stringify(rs)}  ${rs === '1d8' ? '(still malformed)' : '(changed)'}`);

console.log('\n=== C. Built-in runes: items whose text says +N striking/resilient ===');
const runeRe = /\+[123]\s+(\w+\s+){0,3}(striking|resilient)/i;
const runeItems = Object.entries(db.items ?? {}).filter(([id, r]) => live('items', id, r) && runeRe.test(textOf('items', id)));
const runeFields = runeItems.filter(([, r]) => r.runes || r.potency || r.striking || r.builtInRunes);
line('items declaring built-in runes', 551, runeItems.length, runeItems.length === 551);
console.log(`  of those, now carrying rune data: ${runeFields.length} ${runeFields.length ? '<-- A LANE APPEARED' : '(still none — no field exists)'}`);

console.log('\n=== D. Armour prose on non-armour records ===');
const armourish = Object.entries(db.items ?? {}).filter(([id, r]) =>
  live('items', id, r) && /\bBase Armor\b|\busage\s+worn armor\b/i.test(textOf('items', id)) && r.itemType !== 'armor');
line('armour text stored as non-armour', 65, armourish.length, armourish.length === 65);
const wt = db.items?.['winged-terror'];
console.log(`  winged-terror itemType: ${JSON.stringify(wt?.itemType)}  acBonus: ${JSON.stringify(wt?.acBonus)}`);

console.log('\n=== E. Feats whose whole text is "You gain the benefits." ===');
const fwd = liveFeats.filter(([id]) => /^you gain the (archetype )?benefits\.?$/i.test(textOf('feats', id)));
const recorded = JSON.parse(read('scripts/audit/feat-text-defects.json')).featIds ?? [];
line('pure forward-reference feats', recorded.length, fwd.length, fwd.length === recorded.length);

console.log('\n=== F. Degree-of-success: is there a FIELD yet? ===');
const types = read('src/rules/types.ts');
const hasField = /degreeOfSuccess|oneDegreeBetter|degreeAdjust|successBecomes/.test(types);
console.log(`  a structured field in types.ts: ${hasField ? 'YES — a lane appeared' : 'NO — still display-only prose'}`);

console.log('\n=== G. The 14 residual findings — do they still reproduce? ===');
const findings = JSON.parse(read('scripts/audit/residual-findings.json')).findings ?? [];
let gone = 0, still = 0;
for (const f of findings) {
  const rec = db[f.collection]?.[f.id];
  if (!rec) { console.log(`  ${f.id.padEnd(34)} RECORD NO LONGER PRESENT`); gone++; continue; }
  still++;
}
console.log(`  records still present: ${still} / ${findings.length}${gone ? `   (${gone} vanished)` : ''}`);
const wand = db.items?.['wand-of-toxic-blades-8th-rank']?.heldSpells;
console.log(`  wand-of-toxic-blades-8th-rank heldSpells: ${JSON.stringify(wand)}  ${wand && Object.keys(wand)[0] === '8' ? '(FIXED)' : '(still wrong rank)'}`);

console.log('\n=== H. Is the Foundry pack still on disk? (lane-gap-diff depends on it) ===');
const fp = join(root, '.import-src/pf2e/packs/pf2e/feats');
console.log(`  ${existsSync(fp) ? 'present' : 'ABSENT — lane-gap-diff.mjs can no longer run'}`);

console.log('\n=== I. Evidence packs ===');
const ev = join(root, 'scripts/audit/feat-500-evidence.json');
console.log(`  ${existsSync(ev) ? 'present, but built from the PRE-migration core.json — regenerate before reuse' : 'absent (regenerate with feat-evidence.mjs)'}`);
