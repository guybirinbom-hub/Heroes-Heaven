/*
 * Unconventional Weaponry's `inert` note is no longer true.
 *
 * It read "Recorded only: access and the treat-as-simple (or treat-as-martial) proficiency are not
 * applied to your sheet." The proficiency half now IS applied — FEAT_GRANTS resolves the chosen
 * weapon through its choice flag and treats it as one category lower — so the note has to shrink to
 * the half that is still true: ACCESS (an uncommon-item permission the app does not enforce anywhere).
 *
 * Leaving the old wording would be worse than having none: it tells the player a working rule is dead.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const ID = 'unconventional-weaponry';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const fail = (m) => {
  console.error(`REFUSING TO WRITE — ${m}`);
  process.exit(1);
};

const rec = core.feats[ID];
if (!rec) fail(`feats/${ID} does not ship`);
const ch = rec.choice;
if (!ch) fail(`${ID} no longer carries a choice — the whole lane depends on it`);
if (ch.flag !== 'unconventionalWeapon') fail(`${ID}'s choice flag is "${ch.flag}", but FEAT_GRANTS resolves 'unconventionalWeapon'`);
if (!/treat as|treat-as-simple|proficiency/i.test(String(ch.inert ?? ''))) {
  fail(`${ID}'s inert note no longer mentions the proficiency — it may already have been narrowed`);
}

const value = 'Recorded only: access to the uncommon weapon is not enforced. Its proficiency IS applied.';
ch.inert = value;

writeFileSync(CORE, JSON.stringify(core));

/*
 * An existing overlay row already writes this feat's WHOLE `choice` object, old note and all. Adding
 * a second, narrower row would lose the race on the next data rebuild — the whole-object write would
 * put the stale wording straight back. Amend the row that is already there.
 */
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const whole = backfill.find((e) => e.category === 'feats' && e.id === ID && e.field === 'choice' && !e.path?.length);
if (!whole) fail(`expected an existing whole-choice overlay row for ${ID}; write one rather than a partial patch`);
if (typeof whole.value !== 'object' || whole.value === null) fail(`${ID}'s overlay row does not carry a choice object`);
whole.value.inert = value;
// Any stray partial patch of the same field is now redundant and would only drift.
const next = backfill.filter((e) => !(e.category === 'feats' && e.id === ID && e.path?.[0] === 'choice' && e.field === 'inert'));
writeFileSync(BACKFILL, formatBackfill(next));
console.log(`  ${ID}: inert note narrowed inside the existing choice row (backfill ${backfill.length} → ${next.length})`);
