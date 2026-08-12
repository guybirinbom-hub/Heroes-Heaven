/*
 * The FULL class-feature + heritage audit input: every one a player can reach that carries no
 * mechanic, no registry entry, and has never been given a verdict.
 *
 * Same selection rule as the feat and item audits — pick by what a record HAS, never by what its
 * description says.
 *
 * These two collections differ from feats in a way that matters to the judging: a feat is CHOSEN, so
 * a player notices when it does nothing. A class feature is granted automatically at a level and a
 * heritage at character creation, so an inert one is invisible — the player never picked it and has
 * no expectation to compare against. They are also the two collections where a record most often
 * exists purely to NAME a subclass ("Bloodline: Draconic"), whose content lives on its options.
 *
 * Usage: node scripts/build-feature-audit.mjs [chunkSize]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const CHUNK = Number(process.argv[2]) || 60;
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const read = (f) => readFileSync(p(f), 'utf8');
const clean = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();

const keysIn = (t) => new Set([...t.matchAll(/^\s{0,2}["']?([a-z0-9-]+)["']?\s*:/gm)].map((m) => m[1]));
const REGISTERED = new Set([
  ...keysIn(read('src/rules/situationalBonuses.ts')),
  ...keysIn(read('src/rules/companionGrants.ts')),
]);
for (const m of Object.values(core.modes ?? {})) for (const f of m.feats ?? []) REGISTERED.add(f);
for (const s of Object.keys(core.stances ?? {})) REGISTERED.add(s);
for (const x of JSON.parse(read('scripts/data/effect-backfill.json'))) REGISTERED.add(x.id);
/**
 * Which features a class grants automatically, and at what level. NOT an exclusion: a proficiency
 * feature (Fighter Expertise) really is delivered by CLASS_ADVANCEMENT rather than by a field on its
 * own record, but that table is keyed by class, not by feature id, so there is no predicate here that
 * can tell "delivered by the pipeline" from "inert". The judges are told the rule and asked to say
 * ALREADY_OK — which is the verdict that exists for exactly this.
 *
 * It IS worth passing along, because it changes what the record is: an auto-granted feature arrives
 * whether the player wants it or not, while a subclass option was picked.
 */
const autoGranted = new Map();
for (const cls of Object.values(core.classes ?? {})) {
  for (const f of cls.features ?? []) if (f.featureId) autoGranted.set(f.featureId, { className: cls.name, level: f.level });
}

const types = read('src/rules/types.ts');
const EFFECT = new Set(
  [...types.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]).filter((f) =>
    /^(resistances|weaknesses|immunities|senses|speeds|speedPenalty|landSpeedBonus|landSpeedMin|effectChoices|choice|choiceResistance|situational|innateSpells|focusSpells|focusPoolBonus|spellcastingGrant|spellSlotBonus|grantedFeatId|grantsFeats|grantsGeneralFeat|grantedStrikes|trainedSkill|trainedLore|trainedSkillChoice|loreChoices|dynamicSkillBonus|classDcGrant|classDcRank|specialStatistic|limitedUses|usesUpgrade|critSpec|conditionalSenses|senseIfFeat|speedsIf|negativeHealing|grantsLanguages|darkvisionIfAncestryLowLight|maxHpBonus|strikeDamage|mapReduction|whileActive|unarmedTraits|refocusRestore|sizeOverride|reach)$/.test(f),
  ),
);
const hasEffect = (r) => Object.keys(r ?? {}).some((k) => EFFECT.has(k) && r[k] != null && (!Array.isArray(r[k]) || r[k].length));

/** Subclass options (Magus hybrid studies, sorcerer bloodlines) — 159 of the 160 are ALSO class
 *  feature records, so they are judged here on their own merits. Worth flagging to the judge: this
 *  one was PICKED, and its class-level header carries no mechanics by design. */
const subclassOption = new Map();
for (const cls of Object.values(core.classes ?? {})) {
  for (const o of cls.subclass?.options ?? []) subclassOption.set(o.id, { className: cls.name, kind: cls.subclass.name });
}

/** Everything already carrying a recorded verdict from every pass so far. */
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
for (const coll of ['classFeatures', 'heritages']) {
  for (const [id, r] of Object.entries(core[coll])) {
    if (r?.edition === 'superseded') continue;
    if (id.startsWith('aon-') && core[coll][id.slice(4)]) continue;
    if (hasEffect(r) || REGISTERED.has(id)) continue;
    if (judged.has(id)) continue;
    const text = clean(r.description);
    if (!text) continue; // nothing to judge; an empty stub is a data gap, not a mechanics gap
    const auto = autoGranted.get(id);
    const sub = subclassOption.get(id);
    out.push({
      id,
      collection: coll,
      name: r.name,
      level: r.level,
      ancestryId: r.ancestryId,
      traits: r.traits ?? [],
      actionCost: r.actionCost,
      // How the player GETS this, which decides whether an inert record is even visible to them.
      ...(auto ? { grantedBy: `${auto.className} automatically at level ${auto.level}` } : {}),
      ...(sub ? { chosenAs: `${sub.className} ${sub.kind}` } : {}),
      text: text.slice(0, 1500),
    });
  }
}
out.sort((a, b) => a.collection.localeCompare(b.collection) || a.id.localeCompare(b.id));

const DIR = p('work/featureaudit');
mkdirSync(DIR, { recursive: true });
const chunks = [];
for (let i = 0; i < out.length; i += CHUNK) chunks.push(out.slice(i, i + CHUNK));
chunks.forEach((c, i) => writeFileSync(path.join(DIR, `f${i}.json`), JSON.stringify(c, null, 1)));
writeFileSync(path.join(DIR, 'manifest.json'), JSON.stringify({ records: out.length, chunkSize: CHUNK, chunks: chunks.length }, null, 1));

console.log(`class features + heritages never examined and carrying nothing: ${out.length}`);
console.log(`  -> ${chunks.length} chunks of ${CHUNK} in work/featureaudit/`);
const byColl = {};
for (const r of out) byColl[r.collection] = (byColl[r.collection] ?? 0) + 1;
console.log('  by collection:', JSON.stringify(byColl));
