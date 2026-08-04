/*
 * The FULL item audit input: every item a player can buy that carries no mechanic, no registry entry,
 * and has never been given a verdict.
 *
 * Same selection rule as the feat audit (scripts/build-feat-audit.mjs): pick by what a record HAS,
 * never by what its description says. Text-pattern selection is what left 48% of the corpus unlooked-at.
 *
 * Items differ from feats in three ways that matter here:
 *   - A weapon/armor/shield's numbers live in `damage`/`acBonus`/`dexCap`/…, which the strike and AC
 *     code read directly. Those are mechanical by construction, so the base gear is NOT the gap.
 *   - Umbrella summaries ("Bag of Holding" as a parent of four) are display rows a player never buys.
 *   - An item only does something when WORN/INVESTED/held, so its lane is usually `passiveEffects`,
 *     an item MODE (modes keyed by fromItemId), `situational`, or `effectChoices`.
 *
 * Usage: node scripts/build-item-audit.mjs [chunkSize]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const CHUNK = Number(process.argv[2]) || 60;
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const read = (f) => readFileSync(p(f), 'utf8');

/** Registry keys, read from the source that ships. */
const keysIn = (t) => new Set([...t.matchAll(/^\s{0,2}["']?([a-z0-9-]+)["']?\s*:/gm)].map((m) => m[1]));
const REGISTERED = new Set([...keysIn(read('src/rules/situationalBonuses.ts'))]);
// An item mode is keyed by the item it comes from, not by the mode's own id.
for (const m of Object.values(core.modes ?? {})) {
  if (m.fromItemId) REGISTERED.add(m.fromItemId);
  REGISTERED.add(m.id);
}
for (const x of JSON.parse(read('scripts/data/effect-backfill.json'))) REGISTERED.add(x.id);

/**
 * Fields that make an ITEM do something. Derived from types.ts rather than memorised, then filtered
 * to the ones an item can carry — `damage`/`acBonus`/`runes` are what make a sword a sword, so gear
 * whose whole content is its statistics is correctly "covered" and not a gap.
 */
const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const types = read('src/rules/types.ts');

/**
 * An EFFECT field: the record does something to the character.
 *
 * Deliberately NOT in this list: hardness, hp, bulk, group, range, reload, material, dexCap,
 * checkPenalty, strength, consumableType, value. Those are descriptive statistics every ordinary item
 * carries — counting `consumableType` as a mechanic excluded 1,829 of 1,912 consumables in the first
 * cut, which is exactly the "cleared by never being asked" failure this audit exists to undo.
 */
const EFFECT = new Set(
  [...types.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]).filter((f) =>
    /^(passiveEffects|effectChoices|choice|situational|innateSpells|heldSpells|spellSlot|spellSlotBonus|uses|limitedUses|counters|grantedStrikes|grantsFeats|resistances|weaknesses|immunities|senses|speeds|speedPenalty|negativeHealing|maxHpBonus|apexAttribute|dynamicSkillBonus|strikeDamage)$/.test(f),
  ),
);
const hasEffect = (r) => Object.keys(r ?? {}).some((k) => EFFECT.has(k) && r[k] != null && (!Array.isArray(r[k]) || r[k].length));

/**
 * Base gear whose STATISTICS are its whole content — a longsword's damage/group/traits really is
 * everything a longsword does, and the strike code reads them directly. Such an item is covered.
 *
 * A magical one is not: a +1 flaming longsword's runes are modelled, but "Whenever you critically hit
 * with this blade…" is a claim the stat block does not carry. So mundane gear is excluded and
 * anything claiming to DO something — a magical/invested trait, a usage, an activation — is kept.
 */
const CLAIMS_MORE = /^(magical|invested|arcane|divine|occult|primal|cursed|artifact|intelligent|relic|structure)$/;
const statBlockIsAll = (it) => {
  // Treasure is worth money and does nothing else — an agate with a 5sp value and an empty
  // description has no mechanic to be missing.
  if (it.itemType === 'treasure' && (it.value || it.price) && !clean(it.description)) return true;
  if (!['weapon', 'armor', 'shield', 'container'].includes(it.itemType)) return false;
  if (it.activationCost || it.frequency) return false;
  if ((it.traits ?? []).some((t) => CLAIMS_MORE.test(String(t).toLowerCase()))) return false;
  const stats = it.itemType === 'container' ? it.capacity != null || it.ignoredBulk != null : it.damage != null || it.acBonus != null;
  return !!stats;
};

/**
 * Umbrella summaries: a parent row with kin (`bag-of-holding` above `bag-of-holding-type-i`…), no
 * price and no mechanics. A player never buys one, so it is not part of the goal. Same rule as
 * scripts/measure-goal.mjs, kept in step with it deliberately.
 */
const umbrella = (() => {
  const MECH = ['passiveEffects', 'effectChoices', 'situational', 'uses', 'spell', 'runes', 'damage', 'acBonus', 'capacity', 'value', 'heldSpells'];
  const KEEP = new Set(['judgement-thurible', 'spore-shepherds-staff', 'razmiri-mask', 'inspiring']);
  const ids = Object.keys(core.items).sort();
  const out = new Set(['aon-magical-medals']);
  for (let i = 0; i < ids.length; i++) {
    const it = core.items[ids[i]];
    if (KEEP.has(ids[i]) || (it.price && Object.values(it.price).some(Boolean)) || MECH.some((k) => it[k] != null && (!Array.isArray(it[k]) || it[k].length))) continue;
    let kin = 0;
    for (let j = i + 1; j < ids.length && ids[j].startsWith(ids[i] + '-'); j++) kin++;
    if (kin >= 2) out.add(ids[i]);
  }
  return out;
})();

/** Everything already carrying a recorded verdict, from every pass so far. */
const judged = new Set();
for (const b of ['b1', 'b2', 'b3']) {
  const f = p(`work/sweep/${b}/result.json`);
  if (existsSync(f)) for (const r of JSON.parse(readFileSync(f, 'utf8')).records ?? []) judged.add(r.id);
}
const TRIAGE = p('work/escalation-triage');
if (existsSync(TRIAGE)) {
  for (const f of readdirSync(TRIAGE).filter((n) => /^encoded-\d+\.json$/.test(n))) {
    for (const x of JSON.parse(readFileSync(path.join(TRIAGE, f), 'utf8')).fixes ?? []) judged.add(x.id);
  }
}


const out = [];
for (const [id, it] of Object.entries(core.items)) {
  if (it?.edition === 'superseded') continue;                 // no player can buy it
  if (id.startsWith('aon-') && core.items[id.slice(4)]) continue; // duplicate scrape
  if (umbrella.has(id)) continue;                             // a display summary, not a purchase
  if (hasEffect(it) || REGISTERED.has(id)) continue;          // already does something
  if (statBlockIsAll(it)) continue;                           // mundane gear: its stats ARE its content
  if (judged.has(id)) continue;                               // already has a stated reason
  out.push({
    id,
    name: it.name,
    level: it.level,
    itemType: it.itemType,
    traits: it.traits ?? [],
    usage: it.usage,
    activationCost: it.activationCost,
    frequency: it.frequency,
    price: it.price,
    text: clean(it.description).slice(0, 1500),
  });
}
out.sort((a, b) => a.id.localeCompare(b.id));

const DIR = p('work/itemaudit');
mkdirSync(DIR, { recursive: true });
const chunks = [];
for (let i = 0; i < out.length; i += CHUNK) chunks.push(out.slice(i, i + CHUNK));
chunks.forEach((c, i) => writeFileSync(path.join(DIR, `i${i}.json`), JSON.stringify(c, null, 1)));
writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify({ records: out.length, chunkSize: CHUNK, chunks: chunks.length }, null, 1));

console.log(`items never examined and carrying nothing: ${out.length}`);
console.log(`  -> ${chunks.length} chunks of ${CHUNK} in work/itemaudit/`);
const byType = {};
for (const r of out) byType[r.itemType ?? '?'] = (byType[r.itemType ?? '?'] ?? 0) + 1;
console.log('  by type:', JSON.stringify(byType));
const usage = {};
for (const r of out) usage[r.usage ?? '(none)'] = (usage[r.usage ?? '(none)'] ?? 0) + 1;
console.log('  top usages:', JSON.stringify(Object.fromEntries(Object.entries(usage).sort((a, b) => b[1] - a[1]).slice(0, 8))));
