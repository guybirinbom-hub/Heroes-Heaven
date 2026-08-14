/*
 * The companion/eidolon/familiar lane — the owner's feat has an answer the companion never receives.
 *
 * ADVANCED WEAPONRY (AoN feat-2886, Secrets of Magic p67), verbatim: "Choose one of your eidolon's
 * starting melee unarmed attacks. It gains one of the following traits, chosen when you gain the feat:
 * disarm, grapple, nonlethal, shove, trip, or versatile bludgeoning, piercing, or slashing."
 *
 * TWO questions. The record asked only the second, and its own `choice.inert` string admitted the
 * answer reached nothing: "Recorded only — the app doesn't track traits added to an eidolon's unarmed
 * attacks." `deriveEidolon` now adds the trait to the chosen Strike, so:
 *   1. the `inert` admission is DELETED — it is false once the trait lands;
 *   2. a second question is added as `effectChoices` (the feat's own `choice` is already spent on the
 *      trait picker, and 31 shipped feats already carry both). `resolvePick` in src/rules/build.ts
 *      records the answer in `character.effectPicks`, which `deriveEidolon` reads.
 *
 * ⚠ The `eidolon-attack` picker MUST keep both options. `resolvePick` auto-applies a one-option choice
 * even when unanswered, so a single-option picker would silently pick for the player.
 *
 * WHERE THE VALUES GO. `npm run feat -- advanced-weaponry` reported "no authoring script names this
 * record", and `feats` is not carried wholesale by import-core-v2, so scripts/data/effect-backfill.json
 * is the only place a value survives `npm run data`. This file is now that owner. Every guard REFUSES
 * rather than guesses, and re-running writes byte-identical files.
 *
 * Run: node scripts/apply-companion-lane.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatBackfill } from './lib/write-backfill.mjs';

// fileURLToPath, not `new URL(...).pathname` — this repo lives under a path with spaces.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE = ROOT + 'public/core.json';
const DESC = ROOT + 'public/core-descriptions.json';
const BF = ROOT + 'scripts/data/effect-backfill.json';

const coreRaw = readFileSync(CORE, 'utf8');
const db = JSON.parse(coreRaw);
const desc = JSON.parse(readFileSync(DESC, 'utf8'));
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => { console.error('REFUSED: ' + m); process.exit(1); };
// A parse→stringify round trip of a 9.8 MB minified file is only safe if it IS lossless on this tree
// (key order, number formatting, escapes). Asserted rather than assumed, before any edit.
if (JSON.stringify(db) !== coreRaw) fail('public/core.json does not round-trip through JSON.parse/stringify — refusing to rewrite it');

const norm = (s) => String(s).replace(/[’‘']/g, "'").replace(/\s+/g, ' ').toLowerCase();
/** Assert the record still SAYS the sentence a row implements. */
const says = (id, quote) => {
  const text = desc.feats?.[id]?.d ?? db.feats?.[id]?.description ?? '';
  if (!norm(text).includes(norm(quote))) fail(`feats/${id}'s description no longer contains "${quote}"`);
};
/** Write an overlay row AND apply it to the live core.json. `value: null` deletes the field. */
const write = (category, id, field, value) => {
  if (!db[category]?.[id]) fail(`${category}/${id} is not in core.json`);
  const i = rows.findIndex((r) => r.category === category && r.id === id && r.field === field && !r.path);
  const row = { category, id, field, value };
  if (i >= 0) rows[i] = row; else rows.push(row);
  if (value === null) delete db[category][id][field];
  else db[category][id][field] = value;
};
const done = [];

/* ------------------------------------------------ Advanced Weaponry: the attack the trait lands on */
{
  const id = 'advanced-weaponry';
  says(id, "Choose one of your eidolon's starting melee unarmed attacks");
  const choice = db.feats[id]?.choice;
  if (!choice) fail(`feats/${id} has no \`choice\` — the trait picker this lane depends on is gone`);
  // The 8 printed trait options are correct and hold LIVE answers (`character.feats[].choice.value`).
  // Refuse rather than rewrite them: moving a value here would silently re-answer saved characters.
  const traits = (choice.options ?? []).map((o) => o.value).join(',');
  const EXPECT = 'disarm,grapple,nonlethal,shove,trip,versatile-bludgeoning,versatile-piercing,versatile-slashing';
  if (traits !== EXPECT) fail(`feats/${id}.choice.options are [${traits}] — expected the 8 printed traits [${EXPECT}]`);

  // 1. the `inert` admission, now false: deriveEidolon adds the trait to attacks[0|1].traits.
  const { inert, ...rest } = choice;
  if (inert !== undefined) done.push(`${id}.choice: dropped the "Recorded only" admission`);
  write('feats', id, 'choice', rest);

  // 2. WHICH attack. Both options are required — see the one-option warning at the top of this file.
  const effectChoices = [
    {
      id: 'eidolon-attack',
      prompt: 'Eidolon attack that gains the trait',
      options: [
        { value: 'primary', label: 'Primary unarmed attack' },
        { value: 'secondary', label: 'Secondary unarmed attack' },
      ],
    },
  ];
  if (effectChoices[0].options.length < 2) fail('the eidolon-attack picker must keep two options — resolvePick auto-applies a one-option choice');
  write('feats', id, 'effectChoices', effectChoices);
  done.push(`${id}.effectChoices: +eidolon-attack (primary | secondary)`);
}

/* ------------------------------------------------------------------------------------------ write */
const nextCore = JSON.stringify(db);
if (nextCore.includes('\n')) fail('public/core.json would stop being minified');
writeFileSync(CORE, nextCore);
writeFileSync(BF, formatBackfill(rows));
console.log('APPLIED');
for (const d of done) console.log('   ' + d);
console.log(`\noverlay rows: ${rows.length}`);
