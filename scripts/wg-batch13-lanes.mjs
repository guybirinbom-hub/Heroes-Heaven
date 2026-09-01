/*
 * Batch 13, second pass — the records whose mechanic needed a lane, not just a field.
 *
 *   exorcist-dedication   *"housing them in a special receptacle called a spirit dwelling"* — the
 *                         receptacle is a real granted item and we handed the player nothing. Created
 *                         + granted, the same shape as makeshift-staff / staff-nexus.
 *   divine-evolution      *"one additional spell slot of your highest spell rank… you can only use
 *                         this slot for heal or harm, even if they aren't in your spell repertoire."*
 *                         A RESTRICTED slot, which is why the new `highestOnly` selector was added to
 *                         restrictedSlots.ts — byRank is absolute and halfHighest divides. The old
 *                         `effectChoices` encoding is DELETED (`value: null`), because it modelled the
 *                         clause as an innate-spell pick, which is not what the feat prints.
 *   through-the-needles-eye  an exemplar IMBUE feat — joins the five that already share the
 *                         `kind: 'ikons'` picker, narrowed to weapon ikons by its printed Usage line.
 *   motionless-cutter, binding-serpents-celestial-arrow  (batch 17) two more exemplar IMBUE feats on
 *                         the same shared picker; each prompt carries its Usage-line refinement, and
 *                         the note says why the list is wider than the Usage (no ikon record carries a
 *                         reach, damage type or range for the picker to filter on).
 *   sleepwalker-dedication   names a tradition and attribute but grants no focus spell of its own;
 *                         `focusOnly` is the documented marker for exactly that shape.
 *   writing-on-the-wall   an innate embed message, with the tradition chosen by the player — the feat
 *                         demands expert in Arcana, Nature, Occultism AND Religion, so all four are open.
 *   esoteric-spellcasting / wayfinder-resonance-tinkerer
 *                         a tradition question whose answer must narrow the spell picker. Both copy the
 *                         shipped `minor-magic` shape: a record-level `choice` carrying the flag, and
 *                         `traditionFromChoiceFlag` on each filter, keeping the full list as the
 *                         unanswered fallback.
 *   greater-esoteric-spellcasting  its `esotericTradition` flag was written and read by NOTHING; wired
 *                         to its own filters in the same pass. ⚠ Distinct flags per record on purpose:
 *                         narrowSpellFilter resolves a flag by scanning every feat pick and taking the
 *                         first answer, so a shared string would let one feat's answer govern the other.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));

const TRADITIONS = [
  { value: 'arcane', label: 'Arcane' },
  { value: 'divine', label: 'Divine' },
  { value: 'occult', label: 'Occult' },
  { value: 'primal', label: 'Primal' },
];

/** Re-emit a record's existing effectChoices with `traditionFromChoiceFlag` added to each filter. */
const withTraditionFlag = (id, flag) => {
  const ecs = core.feats[id]?.effectChoices;
  if (!Array.isArray(ecs) || !ecs.length) throw new Error(`${id}: no effectChoices to extend`);
  return ecs.map((ec) => (ec.spellFilter ? { ...ec, spellFilter: { ...ec.spellFilter, traditionFromChoiceFlag: flag } } : ec));
};

const edits = [
  /* ---- exorcist-dedication: the spirit dwelling is a real granted item ------------------------- */
  {
    category: 'items',
    id: 'spirit-dwelling',
    create: true,
    value: {
      id: 'spirit-dwelling',
      name: 'Spirit Dwelling',
      level: 1,
      itemType: 'equipment',
      rarity: 'common',
      bulk: 0.1,
      hands: 1,
      traits: [],
      description:
        'A mundane object in your possession, consecrated through prayer or ritual incantation to house a spirit until it is ready to move on.',
    },
  },
  { category: 'feats', id: 'exorcist-dedication', field: 'grantsItems', value: [{ itemId: 'spirit-dwelling' }] },

  /* ---- divine-evolution: a restricted slot at the caster's highest rank ------------------------ */
  {
    category: 'feats',
    id: 'divine-evolution',
    field: 'spellSlotBonus',
    value: {
      restricted: {
        label: 'Divine Evolution',
        note: "An extra spell slot of your highest rank, usable only for heal or harm — even if they aren't in your repertoire.",
        highestOnly: 1,
        spells: ['heal', 'harm'],
      },
    },
  },
  /* `value: null` DELETES the field — the innate-spell encoding is not what the feat prints. */
  { category: 'feats', id: 'divine-evolution', field: 'effectChoices', value: null },

  /* ---- through-the-needles-eye: the shared ikons picker ---------------------------------------- */
  {
    category: 'feats',
    id: 'through-the-needles-eye',
    field: 'choice',
    value: {
      flag: 'imbuedIkon',
      prompt: "The weapon ikon Through the Needle's Eye is imbued into",
      kind: 'ikons',
      ikonType: 'weapon',
    },
  },

  /* ---- the batch-17 pair on the same shared ikons picker --------------------------------------- */
  {
    category: 'feats',
    id: 'motionless-cutter',
    field: 'choice',
    value: {
      flag: 'imbuedIkon',
      prompt: 'The slashing melee weapon ikon Motionless Cutter is imbued into',
      kind: 'ikons',
      ikonType: 'weapon',
      note: "Printed Usage: imbued into a melee weapon ikon that deals slashing damage. The list offers your weapon ikons; 'melee' and 'deals slashing damage' are yours to honour, because no ikon record carries a reach or a damage type.",
    },
  },
  {
    category: 'feats',
    id: 'binding-serpents-celestial-arrow',
    field: 'choice',
    value: {
      flag: 'imbuedIkon',
      prompt: 'The ranged or thrown weapon ikon Binding Serpents Celestial Arrow is imbued into',
      kind: 'ikons',
      ikonType: 'weapon',
      note: "Printed Usage: imbued into a ranged weapon ikon, or a melee weapon ikon with the thrown trait. The list offers your weapon ikons; 'ranged or thrown' is yours to honour, because no ikon record carries a range.",
    },
  },

  /* ---- sleepwalker-dedication: tradition + attribute, no focus spell of its own ---------------- */
  {
    category: 'feats',
    id: 'sleepwalker-dedication',
    field: 'spellcastingGrant',
    value: { tradition: 'occult', keyAbility: 'wis', proficiency: 'trained', focusOnly: true },
  },

  /* ---- writing-on-the-wall: an innate spell whose tradition the player answers ------------------ */
  {
    category: 'feats',
    id: 'writing-on-the-wall',
    field: 'innateSpells',
    value: [
      {
        spellId: 'embed-message',
        usesPerDay: 1,
        heightenHalfLevel: true,
        tradition: 'arcane',
        traditionFromChoiceFlag: 'writingOnTheWallTradition',
      },
    ],
  },
  {
    category: 'feats',
    id: 'writing-on-the-wall',
    field: 'choice',
    value: {
      flag: 'writingOnTheWallTradition',
      prompt: 'Writing on the Wall — which tradition?',
      kind: 'array',
      options: TRADITIONS,
      note: 'Arcana for arcane, Nature for primal, Occultism for occult, Religion for divine. The feat requires expert in all four, so all four are open.',
    },
  },

  /* ---- the two tradition pickers that never narrowed their own spell filters -------------------- */
  {
    category: 'feats',
    id: 'esoteric-spellcasting',
    field: 'choice',
    value: {
      flag: 'esotericSpellcastingTradition',
      prompt: 'Tradition',
      kind: 'array',
      options: [
        { value: 'occult', label: 'Occult' },
        { value: 'divine', label: 'Divine' },
      ],
      note: 'Your 2nd- and 3rd-rank picks come from this same tradition.',
    },
  },
  { category: 'feats', id: 'esoteric-spellcasting', field: 'effectChoices', value: withTraditionFlag('esoteric-spellcasting', 'esotericSpellcastingTradition') },
  { category: 'feats', id: 'greater-esoteric-spellcasting', field: 'effectChoices', value: withTraditionFlag('greater-esoteric-spellcasting', 'esotericTradition') },
  {
    category: 'feats',
    id: 'wayfinder-resonance-tinkerer',
    field: 'choice',
    value: {
      flag: 'wayfinderResonanceTradition',
      prompt: 'Wayfinder cantrip tradition',
      kind: 'array',
      options: TRADITIONS,
      note: 'Your wayfinder casts the chosen cantrip as an innate spell of this tradition.',
    },
  },
  { category: 'feats', id: 'wayfinder-resonance-tinkerer', field: 'effectChoices', value: withTraditionFlag('wayfinder-resonance-tinkerer', 'wayfinderResonanceTradition') },
];

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const e of edits) {
  const at = rows.findIndex((r) => r.category === e.category && r.id === e.id && (e.create ? r.create : r.field === e.field));
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
writeBackfill(ROOT, rows);
console.log(`${edits.length} edit(s): ${added} added, ${updated} updated in place (${rows.length} rows).`);
