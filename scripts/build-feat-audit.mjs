/*
 * The FULL feat audit input: every reachable feat that carries no mechanic, no registry entry, and
 * has never been given a verdict.
 *
 * The previous sweep selected candidates by matching nine regexes against the description text,
 * which recognised only 52% of the corpus — so a feat whose wording did not match a pattern was
 * never a candidate, never judged, and silently counted as fine. This selects by what a record HAS,
 * not by how it is worded, so nothing can hide behind its phrasing.
 *
 * Usage: node scripts/build-feat-audit.mjs [chunkSize]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const CHUNK = Number(process.argv[2]) || 60;
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const read = (f) => readFileSync(p(f), 'utf8');

const keysIn = (t) => new Set([...t.matchAll(/^\s{2}["']?([a-z0-9-]+)["']?\s*:/gm)].map((m) => m[1]));
const REGISTERED = new Set([
  ...keysIn(read('src/rules/situationalBonuses.ts')),
  ...keysIn(read('src/rules/featGrants.ts')),
  ...keysIn(read('src/rules/featGrantsAuto.ts')),
  ...keysIn(read('src/rules/featGrantsLane.ts')),
  ...keysIn(read('src/rules/featFeatGrants.ts')),
  ...keysIn(read('src/rules/featPickGrants.ts')),
  ...keysIn(read('src/rules/featCantripGrants.ts')),
  ...keysIn(read('src/rules/companionGrants.ts')),
]);
for (const m of Object.values(core.modes ?? {})) for (const f of m.feats ?? []) REGISTERED.add(f);
for (const s of Object.keys(core.stances ?? {})) REGISTERED.add(s);
for (const x of JSON.parse(read('scripts/data/effect-backfill.json'))) REGISTERED.add(x.id);

const types = read('src/rules/types.ts');
const MECHANICAL = new Set(
  [...types.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]).filter((f) =>
    /^(resistances|weaknesses|immunities|senses|speeds|speedPenalty|landSpeedBonus|landSpeedMin|passiveEffects|effectChoices|choice|situational|innateSpells|focusSpells|focusPoolBonus|spellcastingGrant|spellSlotBonus|grantedFeatId|grantsFeats|grantedFeatByChoice|grantedStrikes|trainedSkill|trainedLore|trainedSkillChoice|trainedLoreChoice|trainedLoreOptions|dynamicSkillBonus|classDcGrant|limitedUses|usesUpgrade|critSpec|conditionalSenses|choiceResistance|senseIfFeat|speedsIf|negativeHealing|grantsLanguages)$/.test(f),
  ),
);
const hasMechanic = (r) => Object.keys(r ?? {}).some((k) => MECHANICAL.has(k) && r[k] != null && (!Array.isArray(r[k]) || r[k].length));

/** Everything that already carries a recorded verdict, from every pass so far. */
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

const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const out = [];
for (const [id, f] of Object.entries(core.feats)) {
  if (f?.edition === 'superseded') continue;              // no player can take it
  if (id.startsWith('aon-') && core.feats[id.slice(4)]) continue; // duplicate scrape
  if (hasMechanic(f) || REGISTERED.has(id)) continue;     // already does something
  if (judged.has(id)) continue;                           // already has a stated reason
  out.push({
    id,
    name: f.name,
    level: f.level,
    category: f.category,
    traits: f.traits ?? [],
    prerequisites: f.prerequisites ?? [],
    actionCost: f.actionCost,
    text: clean(f.description).slice(0, 1500),
  });
}
out.sort((a, b) => a.id.localeCompare(b.id));

const DIR = p('work/feataudit');
mkdirSync(DIR, { recursive: true });
const chunks = [];
for (let i = 0; i < out.length; i += CHUNK) chunks.push(out.slice(i, i + CHUNK));
chunks.forEach((c, i) => writeFileSync(path.join(DIR, `f${i}.json`), JSON.stringify(c, null, 1)));
writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify({ records: out.length, chunkSize: CHUNK, chunks: chunks.length }, null, 1));

console.log(`feats never examined and carrying nothing: ${out.length}`);
console.log(`  -> ${chunks.length} chunks of ${CHUNK} in work/feataudit/`);
const byCat = {};
for (const r of out) byCat[r.category ?? '?'] = (byCat[r.category ?? '?'] ?? 0) + 1;
console.log('  by category:', JSON.stringify(byCat));
