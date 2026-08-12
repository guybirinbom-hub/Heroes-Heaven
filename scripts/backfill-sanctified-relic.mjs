/*
 * Sanctified Relic (Mythic, 18): "When you take this feat, choose two attributes (one of which must
 * be your key attribute) as your divine attributes and either holy or unholy sanctification."
 *
 * Two permanent, constrained picks that were never asked for. Note what is NOT modelled and why:
 * the daily apex relic raises the attributes of whoever WEARS it, and the feat says outright "You
 * can't wear this apex item, but your hierophant can" — so none of it lands on the owner's own
 * sheet. The picks are recorded because they are permanent and constrained; the benefit is described.
 *
 * Only ONE attribute is genuinely free: the rule fixes the other as your key attribute, so asking for
 * two would invite an illegal answer.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const db = JSON.parse(readFileSync(ROOT + 'public/core.json', 'utf8'));
const BF = ROOT + 'scripts/data/effect-backfill.json';
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};
const t = String(db.feats['sanctified-relic']?.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
if (!t) fail('sanctified-relic has no description');
for (const [what, re] of [
  ['the two-attribute pick', /choose two attributes \(one of which must be your key attribute\) as your divine attributes/i],
  ['the sanctification pick', /either holy or unholy sanctification/i],
  ['the must-match clause', /if you have the holy or unholy trait through a class feature or other ability, you must choose that same trait/i],
  ['the daily apex step', /you can touch one worn magical item that doesn.t have the apex trait/i],
  ['the +1-or-to-\\+4 rule', /by 1 or to a total of \+4, whichever is higher/i],
  ['the you-cannot-wear-it clause', /You can.t wear this apex item, but your hierophant can/i],
  ['the mythic-point option', /If you spend 1 Mythic Point when you create this apex item/i],
])
  if (!re.test(t)) fail(`sanctified-relic: ${what} is not in the printed text`);

const ATTRS = [
  ['str', 'Strength'],
  ['dex', 'Dexterity'],
  ['con', 'Constitution'],
  ['int', 'Intelligence'],
  ['wis', 'Wisdom'],
  ['cha', 'Charisma'],
];

const put = (field, value) => {
  const i = rows.findIndex((r) => r.category === 'feats' && r.id === 'sanctified-relic' && r.field === field && !r.path);
  const row = { category: 'feats', id: 'sanctified-relic', field, value };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
};

put('effectChoices', [
  {
    id: 'divine-attribute',
    // Only one is free — "one of which must be your key attribute" fixes the other, so offering two
    // pickers would invite an answer the rules forbid.
    prompt: 'Your second divine attribute (the first is your key attribute)',
    options: ATTRS.map(([value, label]) => ({
      value,
      label,
      note: 'Permanent. The relic can raise either of your two divine attributes.',
    })),
  },
  {
    id: 'sanctification',
    prompt: 'Sanctification — the trait your relic confers',
    options: [
      { value: 'holy', label: 'Holy', note: 'If you already have the holy trait from a class feature or other ability, you must choose this one.' },
      { value: 'unholy', label: 'Unholy', note: 'If you already have the unholy trait from a class feature or other ability, you must choose this one.' },
    ],
  },
]);

put(
  'note',
  'At your daily preparations, touch one worn magical item without the apex trait: it gains apex until your ' +
    'next preparations and raises one of your divine attributes (chosen then) by 1, or to +4, whichever is higher — ' +
    'and grants its wearer your chosen sanctification. You cannot wear it yourself; your hierophant can, so the ' +
    'bonus lands on their sheet rather than yours. Spend 1 Mythic Point as you create it to raise BOTH divine ' +
    'attributes, an explicit exception to the one-apex-item limit.',
);

writeFileSync(BF, formatBackfill(rows));
console.log('sanctified-relic: 2 recorded picks + the apex note written');
