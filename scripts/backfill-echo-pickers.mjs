/*
 * Ruling Q20 — the echo-only pickers whose fix is DATA, plus ruling Q16's fly formula.
 *
 * Q20 judges an echo picker by two questions: does the app model a mechanical consequence (if so,
 * build it — a label is not enough), and does the choice name a specific STAT (if so, that stat gets
 * a `*`). Each row below is one record where the answer to the first question was yes and the record
 * was the thing standing in the way.
 *
 * The code halves of the same run live in src/rules/ (the star lane, the kinetic-element gate, the
 * eidolon notes); this file only carries what belongs in a record.
 *
 * ⚠ Every guard here REFUSES rather than guesses. A row authored against a record that has since
 * changed shape would be a silent wrong answer, which is worse than a failed script.
 *
 * Run: node scripts/backfill-echo-pickers.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { formatBackfill } from './lib/write-backfill.mjs';

const ROOT = 'C:/trying ai 2/pf2e codex/';
const CORE = ROOT + 'public/core.json';
const DESC = ROOT + 'public/core-descriptions.json';
const BF = ROOT + 'scripts/data/effect-backfill.json';

const db = JSON.parse(readFileSync(CORE, 'utf8'));
const desc = JSON.parse(readFileSync(DESC, 'utf8'));
const rows = JSON.parse(readFileSync(BF, 'utf8'));

const fail = (m) => {
  console.error('REFUSED: ' + m);
  process.exit(1);
};
const norm = (s) => String(s).replace(/[\u2019\u2018']/g, "'").replace(/\s+/g, ' ').toLowerCase();
/** Assert the record still SAYS the sentence a row implements. */
const says = (id, quote) => {
  const text = desc.feats?.[id]?.d ?? '';
  if (!norm(text).includes(norm(quote))) fail(`${id}'s description no longer contains "${quote}"`);
};
const write = (category, id, field, value) => {
  if (!db[category]?.[id]) fail(`${category}/${id} is not in core.json`);
  const i = rows.findIndex((r) => r.category === category && r.id === id && r.field === field && !r.path);
  const row = { category, id, field, value };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  if (value === null) delete db[category][id][field];
  else db[category][id][field] = value;
};

const done = [];

/* ---------------------------------------------------------------- Q16: Constant Levitation ---- */
/*
 * "You're affected by a constant Fly spell." The record hardcoded `speeds: { fly: 40 }`, which is the
 * Fly spell's number for a character whose Speed is 40 and wrong for every other one — Fly grants
 * "a fly Speed equal to its Speed or 20 feet, whichever is greater".
 *
 * `resolveFormula` already parses max() and @actor.speed.land, and deriveSpeeds resolves a granted
 * Speed against the land Speed accumulated so far (ancestry + floors + flat bonuses), which is what
 * the spell means by "its Speed". The `*` on the fly Speed is separate and already shipped
 * (situationalBonuses.ts, "constant-levitation").
 */
{
  const id = 'constant-levitation';
  const cur = db.feats[id]?.speeds;
  const FORMULA = 'max(@actor.speed.land,20)';
  if (!cur || (cur.fly !== 40 && cur.fly !== FORMULA)) {
    fail(`${id}.speeds is ${JSON.stringify(cur)} — expected the hardcoded fly 40 the ruling names, or this script's own formula`);
  }
  // The number comes out of the FLY SPELL, so assert the spell still says it rather than trusting a
  // transcription: if Fly is ever re-printed, this row must be re-read, not silently kept.
  const fly = norm(desc.spells?.fly?.d ?? '');
  if (!fly.includes('equal to its speed or 20 feet, whichever is greater')) {
    fail("the Fly spell no longer reads 'equal to its Speed or 20 feet, whichever is greater' — re-derive the formula from its current text");
  }
  write('feats', id, 'speeds', { fly: FORMULA });
  done.push(`${id}: fly Speed 40 → ${FORMULA}`);
}

/* ------------------------------------------------- Q20: Manifold Modifications — own the pick -- */
/*
 * "Your innovation gains an additional initial modification from the list for innovations of its
 * type." The Q9 half is already built (each option carries `requiresAnyFeature`, so the list narrows
 * to the innovation the character actually has). The ANSWER, though, reached nothing: an inventor's
 * modifications are read from `c.inventor.modifications`, which holds only the three tier slots, so
 * the extra one was recorded and then ignored by everything — Harmonic Oscillator's resistance,
 * Segmented Frame's Stealth star, every mode gated on a modification.
 *
 * `ownsFeature` is the whole fix for the 17 ARMOUR and WEAPON modifications: each option value is
 * already a classFeature id, so the answer joins `ownedFeatureIds` and each modification's own record
 * does the rest.
 *
 * The 10 CONSTRUCT and LIGHT-MORTAR options ship no classFeature record at all (they are prose in the
 * innovation's text), which is why their labels state the effect inline. `choiceOwnedFeatureIds`
 * resolves only values that ARE features and skips the rest, so the flag is simply inert for them —
 * asserted below rather than assumed, because a flag that silently does nothing for a third of a list
 * is exactly the kind of thing that later reads as built.
 */
{
  const id = 'manifold-modifications';
  const cur = db.feats[id]?.choice;
  if (cur?.flag !== 'modification') fail(`${id}.choice is not the modification picker any more`);
  let owned = 0;
  for (const o of cur.options ?? []) {
    if (db.classFeatures[o.value]) {
      owned++;
      continue;
    }
    // No record to own → the option must carry its own effect, or the answer still reaches nothing.
    if (!o.label.includes('—')) fail(`${id} option "${o.value}" is neither a classFeature nor a label stating its effect`);
  }
  if (!owned) fail(`${id}: no option resolves to a classFeature — ownsFeature would be a flag with no reader`);
  says(id, 'Your innovation gains an additional initial modification');
  write('feats', id, 'choice', { ...cur, ownsFeature: true });
  done.push(`${id}: the chosen modification is now OWNED (${owned} of ${cur.options.length} options carry a record; the rest state their effect in the label)`);
}

/* --------------------------------------- Q20 + Q9: Battle Harbinger Dedication — one picker ---- */
/*
 * "You become trained in your choice of Athletics or Acrobatics, if you are already trained in both
 * skills, you instead become trained in another skill of your choice."
 *
 * TWO pickers shipped for that one sentence: this `choice` (the right two options, read by nothing)
 * and the auto-extracted skill grant's `skillChoices: [{ options: 'any' }]` (all sixteen — and the one
 * that actually trained). So the player answered the correct question and got nothing for it, then
 * answered a wrong one that let them train Occultism.
 *
 * ⚠ The echo is made REAL rather than deleted. Deleting it looks like the Exemplar Dedication
 * treatment and is not: `battle-creed` lists this feat in the subclass option's `grantedFeats`, and
 * buildCharacter deliberately skips a granted feat that HAS a `choice` so the player picks it in a
 * slot and answers the question there. Removing the field therefore auto-granted the dedication at
 * level 1, free of the 2nd-level class feat slot the subclass says it must occupy — and with it the
 * Toughness it grants, which put every battle-creed cleric +1 HP per level. Measured, not guessed.
 *
 * So the `choice` stays and featGrants.ts reads it through `choiceGrants`; the over-wide
 * `skillChoices` picker goes away there. The prompt is spelled out because "Skill" does not say which.
 *
 * The "already trained in both" clause has no lane (redundantFallback only fires for a STATIC skill
 * grant), so it goes where this feat's Toughness clause already lives: the record's note.
 */
{
  const id = 'battle-harbinger-dedication';
  const cur = db.feats[id]?.choice;
  const opts = (cur?.options ?? []).map((o) => o.value).sort().join(',');
  if (opts !== 'acrobatics,athletics') fail(`${id}.choice offers ${opts} — expected the acrobatics/athletics pair featGrants.ts keys its choiceGrants on`);
  says(id, 'You become trained in your choice of Athletics or Acrobatics');
  const note = db.feats[id].note ?? '';
  const EXTRA = 'If you are already trained in BOTH Athletics and Acrobatics, you instead become trained in another skill of your choice — pick it through Setup → Overrides.';
  write('feats', id, 'choice', { ...cur, prompt: 'Trained skill' });
  if (!note.includes('already trained in BOTH')) write('feats', id, 'note', note ? `${note} ${EXTRA}` : EXTRA);
  done.push(`${id}: its own picker now trains the skill; the all-sixteen duplicate is gone from featGrants.ts`);
}

/* ------------------------------------- Q20: Sterling Dynamo Dedication — the answer's strike ---- */
/*
 * The record's four `grantedStrikes` were all named "Label" — the same i18n failure that gave 31 other
 * records a prompt reading "Prompt" — and none carried a `choiceValue`. `collectGrantedNaturals`
 * dedupes by NAME, so a sterling dynamo got exactly one unarmed attack called "Label": the 1d8 shove
 * one, whoever they were, whatever they had chosen.
 *
 * Damage and traits are read off the feat's own text, which states all four combinations:
 *   power driver     1d6 B, shove          | percussive striker 1d4 B, agile finesse
 *   …manual control raises the die one size: 1d8 power driver, 1d6 percussive striker.
 * The option LABELS say which is which, because a picker reading "Automatic Power" tells the player
 * nothing about the attack they are choosing.
 */
{
  const id = 'sterling-dynamo-dedication';
  const cur = db.feats[id]?.choice;
  const P = 'feature:dynamo:';
  const want = ['automatic-percussive', 'automatic-power', 'manual-percussive', 'manual-power'].map((s) => P + s);
  const got = (cur?.options ?? []).map((o) => o.value).sort();
  if (got.join('|') !== [...want].sort().join('|')) fail(`${id}.choice offers ${got.join(',')} — expected the four dynamo configurations`);
  says(id, 'choose whether you have a power driver dynamo, which deals 1d6 bludgeoning damage and has the shove trait, or a percussive striker dynamo, which deals 1d4 bludgeoning damage and has the agile and finesse traits');
  says(id, 'This increases the damage die by one size, to a 1d8 for a power drive dynamo or 1d6 for a percussive striker dynamo');
  // The Strike is named after the prosthetic, which is what the feat calls it ("your dynamo unarmed
  // attack"). All four share the name because only one can ever pass the choiceValue filter.
  const strike = (choiceValue, die, traits) => ({ name: 'Dynamo', die, damageType: 'bludgeoning', traits: ['unarmed', ...traits], group: 'brawling', choiceValue });
  write('feats', id, 'grantedStrikes', [
    strike(P + 'automatic-power', 'd6', ['shove']),
    strike(P + 'manual-power', 'd8', ['shove']),
    strike(P + 'automatic-percussive', 'd4', ['agile', 'finesse']),
    strike(P + 'manual-percussive', 'd6', ['agile', 'finesse']),
  ]);
  write('feats', id, 'choice', {
    ...cur,
    prompt: 'Sterling dynamo',
    options: [
      { value: P + 'automatic-power', label: 'Automatic power driver — 1d6 bludgeoning, shove; needs no free hand' },
      { value: P + 'manual-power', label: 'Manual power driver — 1d8 bludgeoning, shove; needs a free hand to operate' },
      { value: P + 'automatic-percussive', label: 'Automatic percussive striker — 1d4 bludgeoning, agile finesse; needs no free hand' },
      { value: P + 'manual-percussive', label: 'Manual percussive striker — 1d6 bludgeoning, agile finesse; needs a free hand to operate' },
    ],
    note: 'The dynamo is made of silver, which the Strike row does not show. An ARM dynamo is always manual, and uses that arm\u2019s hand to operate it.',
  });
  done.push(`${id}: four unarmed Strikes all named "Label" → one Strike per configuration, selected by the answer`);
}

/* ------------------------------------------- Q20 + N2: Eidolon's Wrath — the type on the spell -- */
/*
 * "You determine the damage type when you gain the feat." The spell itself prints "damage of the type
 * you chose when you took the Eidolon's Wrath feat" — so the spell a player has open is precisely
 * where the answer is missing, and the record's own note said as much ("recorded but isn't
 * substituted"). Principle N2 is the lane: the clause is written onto the granted spell's
 * description, under the feat's name and separated from the spell's own rules.
 */
{
  const id = 'eidolons-wrath';
  if (!db.spells[id]) fail(`the spell ${id} is missing — the note would render nowhere`);
  const cur = db.feats[id]?.choice;
  if (cur?.flag !== 'eidolonsWrathDamage') fail(`${id}.choice is not the damage-type picker any more`);
  says(id, 'You determine the damage type when you gain the feat');
  write('feats', id, 'spellNotes', [
    {
      spellId: id,
      fromChoice: true,
      note: 'The damage type you chose when you gained this feat is {choice}, so this spell deals {choice} damage.',
    },
  ]);
  write('feats', id, 'choice', {
    ...cur,
    // The old note apologised for the answer reaching nothing. It now reaches the spell; what is still
    // the player's to honour is the alignment-damage clause, which depends on the eidolon's type.
    note: 'Spirit stands in for the printed alignment-damage option, and is available only if your eidolon is a celestial, fiend, or monitor.',
  });
  done.push(`${id}: the chosen damage type is written onto the granted spell's description`);
}

/* --------------------------------------------- Q20: Creature of Myth — name the five effects ---- */
/*
 * "It gains one of the following effects", five of them. The mechanics are authored per answer in
 * COMPANION_MODS (keys `creature-of-myth:<answer>`); this row only fixes what the PICKER says. The
 * prompt was the importer's "Choose an option" placeholder and the labels were bare names, so a
 * player choosing between five substantial companion upgrades saw five words.
 */
{
  const id = 'creature-of-myth';
  const cur = db.feats[id]?.choice;
  const got = (cur?.options ?? []).map((o) => o.value).sort().join(',');
  const WANT = 'baleful-body,chimeric-heads,energy-aegis,magnificent-flight,protective-skin';
  if (got !== WANT) fail(`${id}.choice offers ${got} — expected ${WANT}`);
  says(id, 'It gains one of the following effects');
  write('feats', id, 'choice', {
    ...cur,
    prompt: 'Your united companion gains',
    options: [
      { value: 'baleful-body', label: 'Baleful Body — melee attackers take half your level in acid, fire, or poison damage' },
      { value: 'chimeric-heads', label: 'Chimeric Heads — an extra head: all-around vision, and paired Strikes for a Mythic Point' },
      { value: 'energy-aegis', label: 'Energy Aegis — immunity to one energy type, and +1 status to AC and saves against it' },
      { value: 'magnificent-flight', label: 'Magnificent Flight — a fly Speed equal to its Speed, and the mount ability' },
      { value: 'protective-skin', label: 'Protective Skin — +30 maximum HP, and weakness 10 to cold iron or silver' },
    ],
  });
  done.push(`${id}: five bare labels → what each of the five effects gives`);
}

/* -------------------------------------------------------------------------------- writes ------ */
writeFileSync(BF, formatBackfill(rows));
writeFileSync(CORE, JSON.stringify(db));
console.log(done.map((d) => '  ' + d).join('\n') + `\nwritten: ${BF}, ${CORE}`);
