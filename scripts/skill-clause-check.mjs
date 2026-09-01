/*
 * GUARD: THE "ALREADY TRAINED IN BOTH" CLAUSE MUST BE MODELLED, NOT JUST PRINTED.
 *
 * Fourteen records print a version of *"You become trained in X or Y; if you were already trained in
 * both, you instead …"*. The clause has two payoffs and they need different fields:
 *
 *   (a) "…you instead become trained in ANOTHER skill of your choice"  → `redundantFallback`
 *   (b) "…you become an EXPERT in one of them instead"                 → the slot's `conditionalRank`
 *
 * Where the slot has neither, a character already trained in both options simply loses the grant.
 * Jalmeri Heavenseeker and Guerrilla both printed (b) while their exact sibling Nantambu Chime-Ringer
 * modelled it, which is what makes it an oversight rather than a ruling.
 *
 * ⚠ (a) IS SATISFIED BY EITHER PLACEMENT. The reader is `slot.redundantFallback ?? g.redundantFallback`
 * — the record-wide flag cascades into the choice slots, and the per-slot one only overrides it. An
 * older comment in featGrants.ts still describes the record-wide flag as reaching static `skills`
 * only, which was true when it was written; a guard built from that comment rather than from the
 * reader called three correctly-modelled records defects. Read the reader, not the note about it.
 *
 *   jiti scripts/skill-clause-check.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEAT_GRANTS } from '../src/rules/featGrants';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const descs = JSON.parse(readFileSync(join(ROOT, 'public/core-descriptions.json'), 'utf8'));

/** "…already trained in both…" / "…already an expert in both…" */
const BOTH = /already\s+(?:been\s+)?(?:trained|an?\s+expert)\s+in\s+(?:both|all)\b/i;
/** Which payoff the sentence promises. Nantambu prints it BEFORE the condition — *"trained in Arcana
 *  or Occultism, or an expert in one of these skills if you are already trained in both"* — so the
 *  whole sentence has to be read, not the tail after the match. */
const EXPERT_INSTEAD = /\b(?:an?\s+)?expert\s+in\s+(?:one|that|these|those|it)\b/i;
/** The same clause exists for weapons and armour; those are a different lane with different fields. */
const NOT_SKILLS = /\b(?:weapons?|armou?r|shields?)\b/i;
/** The sentence the clause lives in — the unit both tests should read. */
const clauseSentence = (d) => {
  const at = d.search(BOTH);
  const start = d.lastIndexOf('.', at) + 1;
  const end = d.indexOf('.', at);
  return d.slice(start, end === -1 ? undefined : end + 1);
};

/* The clause only makes sense where the training itself is a CHOICE; a static grant with no options
 * has nothing to redirect. Records whose grant is expressed via `choiceGrants` are excluded for the
 * reason spelled out on battle-harbinger-dedication: the fallback cannot fire through that field, and
 * the record states the clause in its `note` instead. */
const problems = [];
for (const bucket of Object.keys(descs)) {
  for (const [id, entry] of Object.entries(descs[bucket] ?? {})) {
    const d = String(entry?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    if (!BOTH.test(d)) continue;
    const sentence = clauseSentence(d);
    if (NOT_SKILLS.test(sentence)) continue;
    const g = FEAT_GRANTS[id];
    if (!g || g.choiceGrants) continue;

    const wantsExpert = EXPERT_INSTEAD.test(sentence);
    const slots = g.skillChoices ?? [];
    if (!slots.length) {
      if (g.skills && !wantsExpert && g.redundantFallback) continue;
      /* A three-step ladder ends in one pick owed to ALL the conditional skills at once, not to a
       * choice slot — Pure Legion Enforcer. `conditionalSkillsFallback` is that step. */
      if (g.conditionalSkillsFallback && g.conditionalSkills) continue;
      problems.push({ id, why: `prints "${wantsExpert ? 'expert in one instead' : 'trained in another skill'}" but has no skill-choice slot to hang it on` });
      continue;
    }
    if (slots.some((s) => (wantsExpert ? s.conditionalRank : s.redundantFallback ?? g.redundantFallback))) continue;

    problems.push({ id, why: `the slot is missing ${wantsExpert ? '`conditionalRank: { base, upgraded }`' : '`redundantFallback: true`'}` });
  }
}

if (!problems.length) {
  console.log('skill-clause: ok — every "already trained in both" clause is modelled where its reader looks');
  process.exit(0);
}
console.log(`skill-clause: FAIL — ${problems.length} record(s) print the clause and cannot deliver it:\n`);
for (const p of problems) console.log(`   ${p.id.padEnd(38)} ${p.why}`);
process.exit(1);
