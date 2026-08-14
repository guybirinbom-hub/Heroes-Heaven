/*
 * WHICH FEATS HAND OUT `additional-lore`, AND WHICH OF THEM SAY WHICH LORE.
 *
 *   npm run scan:lore              # the counts
 *   npm run scan:lore -- --list    # every id, with the clause it prints
 *
 * (`jiti`, not `node` — it imports featFeatGrants.ts.)
 *
 * 52 records grant the Additional Lore feat through FEAT_FEAT_GRANTS, and most of them name the
 * subject in the same sentence:
 *
 *   "You also gain the Additional Lore general feat FOR CATFOLK LORE."
 *
 * A GRANTED feat never reaches the builder's Lore text box — that box is rendered only for a feat
 * PICKED into a slot (Builder.tsx) — so before `fixedLore` existed the subject could not be recorded
 * anywhere, and the granted Additional Lore trained nothing and carried no rank ladder. The vehicle
 * matters even where the granter ALSO trains the Lore directly, because Additional Lore is what
 * supplies *"at 3rd, 7th, and 15th levels … an additional skill increase you can apply only to the
 * chosen Lore subcategory"* — i.e. expert/master/legendary. Without it a level-20 catfolk's Catfolk
 * Lore sits at trained forever.
 *
 * ⚠ ANCHORED ON THE OUTCOME — the Lore the sentence NAMES — not on the phrasing around it. The
 * phrasing varies ("You also gain the Additional Lore general feat for X", "You gain the Additional
 * Lore skill feat for X", "the Additional Lore feat for a special Lore skill subcategory—X"), and a
 * detector keyed on any one of those wordings finds a third of the corpus.
 *
 * The classes this reports:
 *   named    — exactly one Lore named outright  → wants a `fixedLore` binding
 *   multi    — two Lores named                  → wants a `fixedLore` binding with both
 *   choice   — the player picks between named Lores ("either Astrology Lore or Lizardfolk Lore")
 *   open     — the subject is a fact about the character the app has no field for ("a Lore
 *              subcategory of a plane to which you trace your lineage")
 *   bound    — the granter's OWN Lore answer decides it (Gnome Obsession) → `loreChoice`
 *   no-text  — no description in the data
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FEAT_FEAT_GRANTS, FEAT_GRANT_BOUND_CHOICE } from '../src/rules/featFeatGrants.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');
const desc = JSON.parse(readFileSync(join(root, 'public/core-descriptions.json'), 'utf8'));
const core = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));

const textOf = (id) =>
  String(core.feats?.[id]?.description ?? desc.feats?.[id]?.d ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');

/** The sentence that hands the feat over — everything from "Additional Lore" to the next full stop. */
const CLAUSE = /Additional Lore[^.]*\./i;

/* A Lore NAME is Title Case followed by the word "Lore": "Catfolk Lore", "Awakened Animal Lore",
 * "Sailing Lore". Lower-case leaders ("a Lore subcategory", "the Lore corresponding to") are exactly
 * what marks the open cases, so the capitalisation is the signal, not decoration.
 *
 * ⚠ The feat's OWN name is "Additional Lore", which this matches. A first run of this scan reported
 * 43 two-Lore records and one single because every clause was scored as naming "Additional" plus the
 * real subject. The phrase is stripped before the match, not filtered afterwards, so a record that
 * genuinely names two ("both Devil Lore and Hellknight Lore") still counts two. */
const NAMED = /\b((?:[A-Z][a-z']+ )+)Lore\b/g;

/** Wordings that mean "the player still chooses", however many Lores the sentence goes on to name. */
const IS_CHOICE = /\beither\b|\bchoosing from among\b|Lore or (?:for|a)\b|\bor a Lore\b/i;
/** Wordings that mean "a Lore the app cannot name" — a plane, a settlement, a culture, a past life.
 *  `such as` / `for instance` mark an ILLUSTRATIVE Lore, which is open however capitalised it is. */
const IS_OPEN = /\ba Lore (?:skill )?subcategory\b|\bthe Lore (?:skill )?(?:for|corresponding)\b|\bchosen ancestry.?s Lore\b|\bsuch as\b|\bfor instance\b/i;
/** …except when the em dash then names it outright: "a special Lore skill subcategory—Incarnation Lore". */
const NAMED_ANYWAY = /subcategory\s*[—–-]\s*[A-Z]/;
/** Gnome Obsession: the granter asked its own Lore question and this feat inherits the answer. */
const IS_BOUND_TO_GRANTER = /\bfor the chosen Lore\b/i;

/** EXPORTED so the guard test uses this detector rather than a copy of it. */
export function audit() {
  const out = { named: [], multi: [], choice: [], open: [], boundToGranter: [], noText: [], noClause: [] };
  for (const [granter, granted] of Object.entries(FEAT_FEAT_GRANTS)) {
    if (!granted.includes('additional-lore')) continue;
    const t = textOf(granter);
    if (!t) { out.noText.push(granter); continue; }
    const clause = t.match(CLAUSE)?.[0];
    if (!clause) { out.noClause.push(granter); continue; }
    const bound = FEAT_GRANT_BOUND_CHOICE[granter]?.['additional-lore'];
    const row = { granter, clause, bound: bound?.kind };
    const stripped = clause.replace(/Additional Lore/gi, ' ');
    const names = [...new Set([...stripped.matchAll(NAMED)].map((m) => m[1].trim()))];
    if (IS_BOUND_TO_GRANTER.test(clause)) { out.boundToGranter.push(row); continue; }
    if (IS_CHOICE.test(clause)) { out.choice.push({ ...row, names }); continue; }
    if (IS_OPEN.test(clause) && !NAMED_ANYWAY.test(clause)) { out.open.push(row); continue; }
    // No Lore named and no open wording either — "the Additional Lore skill feat as a bonus feat",
    // which is the plain feat with its own free question. Same lane as `open`: nothing to bind.
    if (!names.length) { out.open.push(row); continue; }
    (names.length > 1 ? out.multi : out.named).push({ ...row, names });
  }
  return out;
}

/** The named/multi granters that still have no binding — the defect this scan exists to count. */
export function unbound() {
  const a = audit();
  return [...a.named, ...a.multi].filter((r) => r.bound !== 'fixedLore').map((r) => r.granter);
}

/* Printed only when RUN. `test/granted-lore-lane.test.ts` imports `audit`/`unbound` from here so the
 * guard and the report share one detector; under vitest argv[1] is the runner, not this file. */
const RUN_DIRECTLY = !!process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (RUN_DIRECTLY) {
  const a = audit();
  const total = Object.values(a).reduce((n, v) => n + v.length, 0);
  console.log(`feats granting additional-lore     ${total}`);
  console.log(`  name one Lore outright           ${a.named.length}`);
  console.log(`  name two                         ${a.multi.length}`);
  console.log(`  offer the player a choice        ${a.choice.length}`);
  console.log(`  name a Lore the app can't        ${a.open.length}`);
  console.log(`  follow the granter's own answer  ${a.boundToGranter.length}`);
  if (a.noText.length) console.log(`  no description                   ${a.noText.length}  (${a.noText.join(', ')})`);
  if (a.noClause.length) console.log(`  no "Additional Lore" sentence    ${a.noClause.length}  (${a.noClause.join(', ')})`);
  const miss = unbound();
  console.log(`\n  named/multi WITHOUT a binding    ${miss.length}   <- the granted feat trains no Lore`);
  if (miss.length && !LIST) console.log(`     e.g. ${miss.slice(0, 8).join(', ')}`);
  if (LIST) {
    for (const k of ['named', 'multi', 'choice', 'open', 'boundToGranter']) {
      console.log(`\n${k.toUpperCase()}`);
      for (const r of a[k]) console.log(`  ${r.granter.padEnd(42)} ${r.bound ?? '-'}  ${r.names ? r.names.join(' | ') : ''}\n      ${r.clause}`);
    }
  }
}
