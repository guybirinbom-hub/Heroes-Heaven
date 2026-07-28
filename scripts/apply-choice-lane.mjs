/*
 * Apply verified choice-lane specs to public/core.json.
 *
 * Targeted and idempotent, like scripts/import-companions.mjs — it edits ONLY the `choice` field of
 * the records listed below and leaves everything else byte-identical. The full importer is never run
 * (a wholesale regeneration has wiped curated work before).
 *
 * Specs come from work/choice-lane/spec.json, produced by the classification pass and adversarially
 * verified. Only records whose spec is 'high' confidence AND needs no engine work are applied here;
 * everything else stays in the ledger for its own lane of work.
 *
 *   node scripts/apply-choice-lane.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corePath = join(root, 'public/core.json');
const db = JSON.parse(readFileSync(corePath, 'utf8'));
const dry = process.argv.includes('--dry-run');

/**
 * Batch 1 — "choose a skill you're trained in".
 *
 * These use kind 'skills', resolved from the CHARACTER at build time (Builder.tsx →
 * trainedSkillOptions). The eligible set depends on the build and grows with it, so enumerating
 * skills on the record cannot work — which is why Assurance shipped with no choice at all and the
 * feat did nothing.
 *
 * Deliberately NOT included: feats whose skill pick is already handled by FEAT_SKILL_GRANTS /
 * featGrantsAuto (Eldritch Researcher, Dual Studies, Adroit Manipulation…). Verification caught
 * those — adding a choice here would show the player a SECOND prompt for the same grant.
 */
const SKILL_CHOICES = [
  { id: 'assurance', flag: 'assuredSkill', prompt: 'Skill', minRank: 'trained' },
  { id: 'automatic-knowledge', flag: 'autoKnowledgeSkill', prompt: 'Skill', minRank: 'expert' },
  { id: 'expert-longevity', flag: 'longevitySkill', prompt: 'Skill', minRank: 'trained' },
];

let changed = 0;
const applied = [];
const skipped = [];

for (const spec of SKILL_CHOICES) {
  const feat = db.feats?.[spec.id];
  if (!feat) { skipped.push(`${spec.id} — not in core.json`); continue; }
  const next = { flag: spec.flag, prompt: spec.prompt, kind: 'skills', ...(spec.minRank !== 'trained' ? { minRank: spec.minRank } : {}) };
  if (JSON.stringify(feat.choice) === JSON.stringify(next)) { skipped.push(`${spec.id} — already applied`); continue; }
  if (feat.choice) { skipped.push(`${spec.id} — ALREADY HAS a different choice, left alone: ${JSON.stringify(feat.choice)}`); continue; }
  feat.choice = next;
  applied.push(`${spec.id} (${feat.name}) -> kind 'skills'${spec.minRank !== 'trained' ? `, min ${spec.minRank}` : ''}`);
  changed++;
}

console.log(`applied ${applied.length}:`);
applied.forEach((a) => console.log('   ' + a));
if (skipped.length) {
  console.log(`skipped ${skipped.length}:`);
  skipped.forEach((s) => console.log('   ' + s));
}

if (dry) { console.log('\n--dry-run: core.json NOT written'); process.exit(0); }
if (!changed) { console.log('\nnothing to change (idempotent re-run)'); process.exit(0); }
writeFileSync(corePath, JSON.stringify(db, null, 1));
console.log('\ncore.json written');
