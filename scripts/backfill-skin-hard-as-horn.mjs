/*
 * "During your daily preparations, you can strike your skin lightly with an object that deals
 *  bludgeoning, slashing or piercing damage to habituate your skin against this type of injury…
 *  Immanence: you gain resistance to the attuned damage type equal to half your level. This
 *  resistance doesn't apply against critical hits."
 *
 * Two things were missing and only one of them was a field. A daily choice could be RECORDED but its
 * answer granted nothing, so even after the player picked a damage type every morning nothing moved.
 * That is now fixed generally (FeatChoiceDef options carry a grant, resolved by dailyChoiceGrants).
 *
 * The second is a real limit, stated rather than papered over: the resistance applies only while the
 * exemplar's divine spark is in this ikon, and the app models immanence as a stated condition on the
 * benefit (every other ikon in situationalBonuses.ts reads "while your divine spark is in this ikon"),
 * not as a live toggle. So the resistance ships with its condition on the entry — the breakdown shows
 * the number, its source, and when it applies — rather than being granted unconditionally, which
 * would be wrong, or omitted, which is what happened before.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const ID = 'skin-hard-as-horn';

const NOTE = 'only while your divine spark is in this ikon (immanence), and never against critical hits';

const CHOICE = {
  flag: 'attunedDamageType',
  prompt: 'Damage type your skin is habituated against',
  kind: 'array',
  daily: true,
  options: ['bludgeoning', 'piercing', 'slashing'].map((t) => ({
    value: t,
    label: t[0].toUpperCase() + t.slice(1),
    grant: { resistances: [{ type: t, value: 'floor(@actor.level/2)', note: NOTE }] },
  })),
};

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const rec = core.classFeatures[ID];
if (!rec) {
  console.error(`${ID} is not a class feature in core.json — refusing to write.`);
  process.exit(1);
}
if (rec.choice) {
  console.error(`${ID} already carries a choice (${rec.choice.flag}) — refusing to replace it.`);
  process.exit(1);
}
// The record must actually say what we are transcribing.
const text = String(rec.description ?? '');
for (const phrase of ['daily preparations', 'resistance to the attuned damage type']) {
  if (!text.toLowerCase().includes(phrase)) {
    console.error(`${ID}'s description does not contain "${phrase}" — refusing to write.`);
    process.exit(1);
  }
}

rec.choice = CHOICE;
writeFileSync(CORE, JSON.stringify(core));

const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const entry = { category: 'classFeatures', id: ID, field: 'choice', value: CHOICE };
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const next = [...backfill.filter((e) => key(e) !== key(entry)), entry];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`wrote the daily attunement choice on ${ID} (backfill ${backfill.length} → ${next.length})`);
