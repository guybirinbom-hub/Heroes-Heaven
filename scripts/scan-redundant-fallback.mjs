/*
 * WHICH SKILL GRANTS PRINT THE REDUNDANCY CLAUSE, AND WHICH ONES SAY SO IN THE DATA.
 *
 *   node scripts/scan-redundant-fallback.mjs           # the counts
 *   node scripts/scan-redundant-fallback.mjs --list    # every id, both ways
 *
 * A great many feats print some form of:
 *
 *   "If you are already trained in <skill>, you instead become trained in a skill of your choice."
 *
 * The app expresses that with one boolean, `redundantFallback`, on the record's FEAT_SKILL_GRANTS
 * entry — read at build.ts, surfaced as Character.skillFallbacks, and rendered by the builder as a
 * "choose another skill" picker. Without the flag the grant simply collides with the training the
 * character already has and the player silently loses a skill they were owed.
 *
 * The audit found six of these by reading six feats. The clause has a SHAPE, so the rest are a scan.
 *
 * ⚠ SAFE TO ACT ON ONLY BECAUSE the serialiser in scripts/aon-verify/apply-reviewed.ts is now
 * lossless. Until today it emitted four keys and dropped everything else, so it would have deleted
 * `redundantFallback` from every record carrying it the next time anyone ran it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FEAT_SKILL_GRANTS } from '../src/rules/featGrantsAuto.ts';
import { FEAT_LANE_GRANTS } from '../src/rules/featGrantsLane.ts';

/*
 * BOTH auto tables, not one. FEAT_LANE_GRANTS was outside this scan for its whole life, so its 62
 * entries were never checked — and two of them print the clause. A guard that reads one of two
 * tables reports zero and means nothing, which is how gildedsoul kept a printed clause and no
 * mechanic while the suite stayed green. Hand-authored FEAT_GRANTS wins the merge in featGrants.ts,
 * so the same precedence is used here.
 */
const GRANTS = { ...FEAT_SKILL_GRANTS, ...FEAT_LANE_GRANTS };

/*
 * SATISFIED STRUCTURALLY, because the flag has TWO readers of different shapes.
 *
 * `redundantFallback` on the GRANT fires per static `skills` entry (build.ts). A record whose only
 * training is a `skillChoices` slot has no static entry, so the record-wide flag there would be
 * authored, counted as modelled, and inert — the exact failure this scan exists to prevent. Such a
 * record carries the flag on the SLOT instead.
 *
 * An `options: 'any'` slot is EXEMPT: the player picks from all sixteen skills, so the grant is
 * redundant only for a character trained in every one of them, and the clause has no reachable case.
 * `free-heart` is the only such record (its own `choice` already carries the note explaining that
 * the two open pickers are Heroes Heaven's stand-in for a background package it cannot apply).
 * Exempting it is not the same as ignoring it — a BOUNDED slot is never exempt.
 */
/*
 * …INCLUDING the slots inside `choiceGrants`.
 *
 * A record whose training depends on an answer it asks itself has no top-level `skillChoices` at all —
 * every slot sits under the branch that answer selects. Swashbuckler Dedication is the case: *"you
 * become trained in Acrobatics and the skill associated with your chosen style… If you were already
 * trained in one of these skills, you become trained in a skill of your choice"*, six style branches,
 * six slots, none of them top-level. Reading only `g.skillChoices` therefore saw NO slots, could not
 * observe the flag wherever it was authored, and reported the record as missing the clause forever —
 * and a guard that cannot be satisfied is one people learn to route around.
 */
const slotsOf = (g) => [...(g.skillChoices ?? []), ...Object.values(g.choiceGrants ?? {}).flatMap((b) => b?.skillChoices ?? [])];
const boundedSlots = (g) => slotsOf(g).filter((s) => s.options !== 'any');
const satisfied = (g) =>
  !!g.redundantFallback || (boundedSlots(g).length > 0 && boundedSlots(g).every((s) => s.redundantFallback));
const exempt = (g) => !g.skills && slotsOf(g).length > 0 && boundedSlots(g).length === 0;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));

const textOf = (id) =>
  String(core.feats?.[id]?.description ?? desc.feats?.[id]?.d ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');

/*
 * ANCHORED ON THE OUTCOME, not on the condition.
 *
 * The condition is written half a dozen ways — "if you were already trained in Crafting", "if you're
 * already trained in Society", "If you would automatically become trained in one of those skills (from
 * your background or class, for example)" — and a first attempt at matching the condition found 34
 * records when 72 already carry the flag, i.e. it missed most of them.
 *
 * The OUTCOME is near-invariant, because it is the mechanic: you end up trained in a skill of your
 * choice. That is what `redundantFallback` means, so that is what to look for.
 *
 * ⚠ EXCLUDED: "if you were already trained in that skill, you become an EXPERT instead". Same shape of
 * sentence, different mechanic — an upgrade of the same skill, which the engine expresses as
 * `conditionalSkills`/`conditionalRank`, not as a fallback to a different skill. Matching on "instead"
 * would have swept these in and authored the wrong lane onto them.
 */
const OUTCOME = /(?:instead become trained in|become trained in) (?:a|another) skill of your choice|(?:or )?another skill of your choice,? if you(?:'re| are| were) already trained/i;
const UPGRADE_NOT_FALLBACK = /you become an expert instead/i;
const prints = (t) => OUTCOME.test(t) && !UPGRADE_NOT_FALLBACK.test(t);

/** EXPORTED so the guard test and the applier use this detector rather than copies of it. */
export function audit() {
  const has = [];
  const missing = [];
  const noText = [];
  /* The other direction, and it matters just as much: a flag on a record whose text does NOT print the
   * clause is the app inventing a choice the book never offered. */
  const spurious = [];
  for (const [id, grant] of Object.entries(GRANTS)) {
    const t = textOf(id);
    if (!t) { noText.push(id); continue; }
    if (!prints(t)) { if (grant.redundantFallback) spurious.push(id); continue; }
    if (exempt(grant)) continue;
    (satisfied(grant) ? has : missing).push(id);
  }
  return { has, missing, noText, spurious };
}

const { has, missing, noText, spurious } = audit();

console.log(`FEAT_SKILL_GRANTS + FEAT_LANE_GRANTS ${Object.keys(GRANTS).length}`);
console.log(`  print the redundancy clause      ${has.length + missing.length}`);
console.log(`    …and carry redundantFallback   ${has.length}`);
console.log(`    …and DO NOT                    ${missing.length}   <- the player silently loses a skill`);
if (noText.length) console.log(`  no description found             ${noText.length}`);
if (spurious.length) {
  console.log(`\n  FLAGGED but print no such clause  ${spurious.length}   <- the app offers a choice the book doesn't`);
  for (const id of spurious) console.log(`     ${id}`);
}

if (LIST) {
  console.log('\nMISSING the flag:');
  for (const id of missing) console.log(`  ${id}`);
  console.log('\nalready flagged:');
  for (const id of has) console.log(`  ${id}`);
} else if (missing.length) {
  console.log(`\ne.g. ${missing.slice(0, 8).join(', ')}`);
  console.log('\n--list for all of them. Apply with scripts/apply-redundant-fallback.mjs.');
}
