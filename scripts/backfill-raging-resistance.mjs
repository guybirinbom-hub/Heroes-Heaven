/*
 * Raging Resistance — the barbarian's 9th-level defence — reached no sheet, on any instinct.
 *
 * The feature itself says only "you gain resistance equal to 3 + your Constitution modifier to damage
 * types based on your instinct"; the TYPES are printed on the instinct, a record chosen at 1st level.
 * Nothing connected the two, and nothing could have: a `resistances` list on an instinct would have
 * handed a 1st-level barbarian a 9th-level defence, permanently, whether or not they were raging.
 *
 * So each clause is written as `whileActive` with `minLevel: 9`. Three instincts print a CHOICE of
 * type; their pickers already existed and already stored an answer that nothing read — dragon's even
 * carried a note admitting "Raging Resistance (9th) isn't applied" — so the grant is attached to the
 * option the player already picks rather than to a new question.
 *
 * Every clause below is quoted from the AoN mirror (by-category/instinct) in the comment above it.
 * Clauses that name a CREATURE rather than a damage type ("damage dealt by the attacks and abilities
 * of undead creatures, regardless of the damage type") cannot be a typed resistance and are carried
 * as a note on the entry instead of being silently dropped or silently invented.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CORE = 'public/core.json';
const BACKFILL = 'scripts/data/effect-backfill.json';
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/instinct';

const VALUE = '3+@actor.con.mod';
const RAGE = (resistances, extra = {}) => [{ state: 'rage', minLevel: 9, resistances, ...extra }];

/** instinct id → what Raging Resistance grants it. */
const FIXED = {
  // "You resist piercing and slashing damage."
  'animal-instinct': { whileActive: RAGE([{ type: 'piercing', value: VALUE }, { type: 'slashing', value: VALUE }]) },
  // "You resist physical weapon damage, but not physical damage from other sources (such as unarmed
  //  attacks)." One resistance with the restriction named, not three separate physical types.
  'fury-instinct': {
    whileActive: RAGE([{ type: 'physical', value: VALUE, note: 'weapon damage only — not unarmed attacks or other sources' }]),
  },
  // "You resist piercing and slashing damage, but you gain weakness to fire equal to 3 + your
  //  Constitution modifier, as your bark-like flesh is highly flammable."
  'ligneous-instinct': {
    whileActive: RAGE([{ type: 'piercing', value: VALUE }, { type: 'slashing', value: VALUE }], {
      weaknesses: [{ type: 'fire', value: VALUE }],
    }),
  },
  // "You resist void damage, as well as damage dealt by the attacks and abilities of undead
  //  creatures, regardless of the damage type."
  'spirit-instinct': {
    whileActive: RAGE([
      { type: 'void', value: VALUE },
      { type: 'all damage from undead', value: VALUE, note: 'attacks and abilities of undead creatures, regardless of damage type' },
    ]),
  },
  // "You resist poison damage, as well as damage dealt by the attacks and abilities of creatures with
  //  the fungus trait, regardless of the damage type."
  'decay-instinct': {
    whileActive: RAGE([
      { type: 'poison', value: VALUE },
      { type: 'all damage from fungus creatures', value: VALUE, note: 'attacks and abilities of creatures with the fungus trait, regardless of damage type' },
    ]),
  },
};

/**
 * Instincts whose Raging Resistance type is CHOSEN. The picker already exists on the record; this
 * hangs the grant on the option the player picks, so no second question appears.
 */
const CHOSEN = {
  // "You resist bludgeoning damage and your choice of cold, electricity, or fire, chosen when you
  //  gain raging resistance." Giant Instinct had no picker at all, so one is added with only these
  //  three options — the record names them, so this is transcription, not invention.
  'giant-instinct': {
    addChoice: {
      flag: 'ragingResistanceEnergy',
      prompt: 'Raging Resistance energy type',
      kind: 'array',
      options: ['cold', 'electricity', 'fire'].map((t) => ({
        value: t,
        label: t[0].toUpperCase() + t.slice(1),
        grant: { whileActive: RAGE([{ type: 'bludgeoning', value: VALUE }, { type: t, value: VALUE }]) },
      })),
    },
  },
  // "Choose two associated magical traditions… The resistance from your raging resistance class
  //  feature applies against all damage you take from spells of those traditions."
  'superstition-instinct': {
    grantByValue: (value) => {
      const [a, b] = value.split('-');
      return {
        whileActive: RAGE(
          [a, b].map((t) => ({ type: `${t} spells`, value: VALUE, note: `all damage from ${t} spells` })),
        ),
      };
    },
  },
  // "You resist piercing damage and the damage type of your dragon's breath." Each option's label
  //  already carries its damage type ("Rime — Primal, cold"), which is where the type comes from.
  'dragon-instinct': {
    grantByLabel: (label) => {
      const type = String(label).split(',').pop().trim().replace(/^(line|cone) of /, '').toLowerCase();
      if (!type) return null;
      return { whileActive: RAGE([{ type: 'piercing', value: VALUE }, { type, value: VALUE }]) };
    },
  },
  // "You resist the damage dealt by attacks and abilities of elemental creatures of your chosen
  //  element… You also resist damage dealt by attacks, spells and abilities with your element's trait."
  //  Each option's value is `<element>-<damage type>`.
  'elemental-instinct': {
    grantByValue: (value) => {
      const el = value.split('-')[0];
      return {
        whileActive: RAGE([
          { type: `${el} damage`, value: VALUE, note: `attacks, spells and abilities with the ${el} trait` },
          { type: `damage from ${el} creatures`, value: VALUE, note: `elemental creatures of your element, regardless of damage type` },
        ]),
      };
    },
  },
};

// ---- refuse to run against data that does not match what was transcribed ---------------------
if (!existsSync(MIRROR)) {
  console.error(`No AoN mirror at ${MIRROR} — refusing to write clauses that cannot be checked.`);
  process.exit(1);
}
const mirrorClauses = new Map();
for (const f of readdirSync(MIRROR)) {
  let j;
  try {
    j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  } catch {
    continue;
  }
  for (const r of Array.isArray(j) ? j : [j]) {
    const s = String(r.text ?? r.markdown ?? '').replace(/\s+/g, ' ');
    const m = s.match(/Raging Resistance\s*:?\s*(.{20,300})/i);
    if (m && r.name) mirrorClauses.set(r.name.toLowerCase(), m[1]);
  }
}

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const entries = [];
const skipped = [];

for (const [id, spec] of Object.entries({ ...FIXED, ...CHOSEN })) {
  const rec = core.classFeatures[id];
  if (!rec) {
    skipped.push(`${id}: not a class feature`);
    continue;
  }
  // The mirror must actually carry a Raging Resistance clause for this instinct.
  const name = id.replace(/-instinct$/, '');
  if (!mirrorClauses.has(name)) {
    skipped.push(`${id}: no Raging Resistance clause in the mirror under "${name}"`);
    continue;
  }

  if (spec.whileActive) {
    rec.whileActive = spec.whileActive;
    entries.push({ category: 'classFeatures', id, field: 'whileActive', value: spec.whileActive });
    continue;
  }
  if (spec.addChoice) {
    if (rec.choice) {
      skipped.push(`${id}: already has a choice (${rec.choice.flag}) — not replacing it`);
      continue;
    }
    rec.choice = spec.addChoice;
    entries.push({ category: 'classFeatures', id, field: 'choice', value: spec.addChoice });
    continue;
  }
  // Attach a grant to each existing option, leaving the option list itself untouched.
  const def = rec.choice;
  if (!def?.options?.length) {
    skipped.push(`${id}: expected an existing choice to hang grants on, found none`);
    continue;
  }
  const options = def.options.map((o) => {
    const grant = spec.grantByValue ? spec.grantByValue(o.value) : spec.grantByLabel(o.label);
    return grant ? { ...o, grant } : o;
  });
  const ungranted = options.filter((o) => !o.grant).map((o) => o.value);
  if (ungranted.length) {
    skipped.push(`${id}: ${ungranted.length} options got no grant (${ungranted.slice(0, 5).join(', ')}) — writing nothing`);
    continue;
  }
  // Drop the stale caveat: it said the resistance was not applied, and now it is.
  const next = { ...def, options };
  if (typeof next.note === 'string' && /Raging Resistance/i.test(next.note)) {
    next.note = next.note.replace(/,?\s*and Raging Resistance \(9th\) isn.t applied\.?/i, '.').replace(/\s+/g, ' ').trim();
    if (!next.note || next.note === '.') delete next.note;
  }
  rec.choice = next;
  entries.push({ category: 'classFeatures', id, field: 'choice', value: next });
}

if (skipped.length) console.warn('SKIPPED:\n  ' + skipped.join('\n  '));

writeFileSync(CORE, JSON.stringify(core));
const backfill = JSON.parse(readFileSync(BACKFILL, 'utf8'));
const key = (e) => `${e.category}/${e.id}/${(e.path ?? []).join('/')}/${e.field}`;
const seen = new Set(entries.map(key));
const next = [...backfill.filter((e) => !seen.has(key(e))), ...entries];
writeFileSync(BACKFILL, JSON.stringify(next, null, 2) + '\n');
console.log(`wrote Raging Resistance on ${entries.length} instincts (backfill ${backfill.length} → ${next.length})`);
