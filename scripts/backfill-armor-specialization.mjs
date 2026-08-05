/*
 * Armor specialization — the whole mechanic was missing.
 *
 * `armorSpecialization` appeared nowhere in the data, the seven armorGroup records are bare
 * {id,name,edition} stubs with no effect text, and the only trace anywhere in the app was one
 * display-only note next to AC. Four records whose entire content is "you gain the armor
 * specialization effect" therefore did nothing at all, and two items that MODIFY that effect had
 * nothing to modify.
 *
 * The EFFECTS live in src/rules/armorSpec.ts, not here: each value is `base + the armor's potency
 * rune`, which no data formula can express. These rows only say WHO gets it and for WHICH armors.
 *
 * Every grant is checked against the record's own wording, so a text change fails the script.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
const fail = (msg) => {
  console.error(`REFUSING TO WRITE — ${msg}`);
  process.exit(1);
};
const text = (cat, id) => {
  const rec = core[cat]?.[id];
  if (!rec) fail(`${cat}/${id} does not ship`);
  return String(rec.description ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};
const add = (category, id, field, value, mustSay) => {
  const t = text(category, id);
  for (const re of mustSay) if (!re.test(t)) fail(`${category}/${id} no longer matches ${re} — its text says: ${t.slice(0, 200)}`);
  core[category][id][field] = value;
  entries.push({ category, id, field, value });
  console.log(`  ${(category + '/' + id).padEnd(38)} ${field} = ${JSON.stringify(value)}`);
};

/* "You gain the armor specialization effects of medium and heavy armor." */
add('classFeatures', 'armor-expertise', 'armorSpec', { categories: ['medium', 'heavy'] }, [
  /armor specialization effects of medium and heavy armor/i,
]);

/* "You gain the armor specialization effects for all armors you are proficient with." */
add('feats', 'armor-specialist', 'armorSpec', { anyProficient: true }, [
  /armor specialization effects for all armors you are proficient with/i,
]);

/*
 * "You gain the armor specialization effect of light armor. If you are trained in medium or heavy
 * armor, you gain the respective armor specialization effect for those armors as well. While in
 * Tenacious Stance, you increase the value ... by ... your armor check penalty."
 *
 * The light clause is recorded faithfully even though NO armor group defines a light value — every
 * group text gives a medium and a heavy figure and nothing else. Inventing one would be homebrew.
 */
{
  const stanceId = 'tenacious-stance';
  if (!core.stances?.[stanceId]) fail(`stances/${stanceId} does not ship — the conditional bonus would never fire`);
  add(
    'feats',
    'unshaken-in-iron',
    'armorSpec',
    {
      categories: ['light'],
      ifTrained: ['medium', 'heavy'],
      bonusWhileStance: { stanceId, source: 'armorCheckPenalty' },
    },
    [/armor specialization effect of light armor/i, /trained in medium or heavy armor/i, /Tenacious Stance/i],
  );
}

/* "the armor specialization effects of Hellknight breastplate, Hellknight half plate, and Hellknight
 * plate, and your resistance from that armor specialization is 1 higher than normal." */
{
  const t = text('feats', 'hellknight-preferment');
  const items = ['hellknight-breastplate', 'hellknight-half-plate', 'hellknight-plate'];
  for (const id of items) {
    if (core.items[id]?.itemType !== 'armor') fail(`items/${id} is not shipped armor`);
    // The feat NAMES each one; make sure the id we resolved is the armor the text means.
    const name = core.items[id].name.replace(/\s+/g, ' ');
    if (!new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(t)) fail(`hellknight-preferment does not name "${name}"`);
  }
  const m = t.match(/armor specialization is (\d+) higher than normal/i);
  if (!m) fail('hellknight-preferment no longer states how much higher its resistance is');
  add('feats', 'hellknight-preferment', 'armorSpec', { items, bonus: Number(m[1]) }, [/armor specialization/i]);
}

/* "If you have armor specialization with heavy armor, your resistance while wearing Highhelm
 * stronghold plate applies to both slashing and piercing damage." Its group is plate, whose effect is
 * already slashing — so only the extra type is recorded. */
{
  const armor = core.items['highhelm-stronghold-plate'];
  if (armor?.group !== 'plate') fail(`highhelm-stronghold-plate is group ${armor?.group}, expected plate`);
  if (armor.category !== 'heavy') fail(`highhelm-stronghold-plate is ${armor.category}, but its clause is heavy-only`);
  add('items', 'highhelm-stronghold-plate', 'armorSpecExtraTypes', ['piercing'], [/applies to both slashing and piercing damage/i]);
}

/* "If the armor is in the chain armor group and you have its armor specialization effect, you instead
 * increase the physical resistance from the chain armor specialization by 2." */
{
  const m = text('items', 'reinforced-surcoat').match(/from the chain armor specialization by (\d+)/i);
  if (!m) fail('reinforced-surcoat no longer states its chain increase');
  add('items', 'reinforced-surcoat', 'armorSpecBonus', { group: 'chain', value: Number(m[1]) }, [/chain armor group/i]);
}

if (entries.length !== 6) fail(`only ${entries.length} of 6 rows resolved`);

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`wired ${entries.length} armor-specialization rows (backfill ${backfill.length} → ${next.length})`);
