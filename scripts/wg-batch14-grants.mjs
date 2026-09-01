/*
 * Batch 14, first pass — records whose printed clause reached nothing.
 *
 *   geckos-grip           *"…a climb Speed of 15 feet"* for a cliffscale lizardfolk. The record held
 *                         only `degreeShifts`, so the Speed existed nowhere. `speedsIf` is the
 *                         heritage-gated lane, read in deriveSpeeds.
 *
 *   investigators-stratagem  *"You gain the Devise a Stratagem action."* `actions/devise-a-stratagem`
 *                         ships as a free action and NOTHING granted it.
 *
 *   soothing-pulse        *"…granting you the Administer Ambient Magic action."* Same shape: the
 *                         action ships (1 action, Frequency once per hour) and was unreachable —
 *                         `aonParentId` has no reader, so parentage does not surface it either. The
 *                         Frequency rides on the GRANTER, because MainTab reads the per-day limit off
 *                         the granting record rather than the action.
 *
 *   necrotic-bomber       *"You learn the necrotic bomb…"* — an inert record; the focus spell and its
 *                         Focus Point both follow from `focusSpells`.
 *
 *   the-taste-of-magic    *"…as if distinguishing between different odors"* — a 30-foot imprecise
 *                         scent, on a record that carried no mechanical field at all.
 *
 *   planar-resilience     The daily picker existed and its answer reached NO number: nothing in src/
 *                         reads the flag `planarResilienceType`. The grants go on the options, which is
 *                         where a per-answer grant belongs. ⚠ Re-authored WHOLE — the row-writer
 *                         replaces by (category, id, field).
 *
 *   mortification         Same shape: the three damage types were offered with nothing behind them.
 *                         *"…resistance to the chosen damage type equal to your number of archetype
 *                         class feats from the Hellknight archetype"* — `@actor.archetypeFeats.hellknight`
 *                         is a live token (substituteTokens, derive.ts), already used by eight records.
 *
 *   primal-evolution      The twin of divine-evolution, which was fixed in batch 13: *"an additional
 *                         spell slot of your highest rank, which you can use only to cast Summon Animal
 *                         or Summon Plant or Fungus."* A RESTRICTED slot, not an innate-spell pick.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Half your level, minimum 1 — the shape every level-scaled resistance in the overlay uses. */
const HALF_LEVEL = 'max(1,floor(@actor.level/2))';

const edits = [
  { category: 'feats', id: 'geckos-grip', field: 'speedsIf', value: [{ heritage: 'cliffscale-lizardfolk', speeds: { climb: 15 } }] },

  { category: 'feats', id: 'investigators-stratagem', field: 'grantsActions', value: ['devise-a-stratagem'] },

  { category: 'feats', id: 'soothing-pulse', field: 'grantsActions', value: ['administer-ambient-magic'] },
  /* The Frequency lives on the granter: the action record cannot hold it, and MainTab reads the limit
   * from the record that hands the action over. */
  { category: 'feats', id: 'soothing-pulse', field: 'limitedUses', value: { max: 1, per: 'hour' } },

  { category: 'feats', id: 'necrotic-bomber', field: 'focusSpells', value: ['necrotic-bomb'] },

  { category: 'feats', id: 'the-taste-of-magic', field: 'senses', value: [{ name: 'scent', range: 30, acuity: 'imprecise' }] },

  {
    category: 'feats',
    id: 'planar-resilience',
    field: 'choice',
    value: {
      flag: 'planarResilienceType',
      prompt: 'Resistance today',
      kind: 'array',
      daily: true,
      options: [
        { value: 'cold', label: 'Cold', grant: { resistances: [{ type: 'cold', value: HALF_LEVEL }] } },
        { value: 'fire', label: 'Fire', grant: { resistances: [{ type: 'fire', value: HALF_LEVEL }] } },
      ],
    },
  },

  {
    category: 'feats',
    id: 'mortification',
    field: 'choice',
    value: {
      flag: 'damageType',
      prompt: 'Physical damage your reckonings harden you against',
      kind: 'array',
      options: ['bludgeoning', 'piercing', 'slashing'].map((t) => ({
        value: t,
        label: t.charAt(0).toUpperCase() + t.slice(1),
        grant: { resistances: [{ type: t, value: '@actor.archetypeFeats.hellknight' }] },
      })),
    },
  },

  {
    category: 'feats',
    id: 'primal-evolution',
    field: 'spellSlotBonus',
    value: {
      restricted: {
        label: 'Primal Evolution',
        note: 'An extra spell slot of your highest rank, usable only for Summon Animal or Summon Plant or Fungus.',
        highestOnly: 1,
        spells: ['summon-animal', 'summon-plant-or-fungus'],
      },
    },
  },
  /* The innate-spell encoding it used to carry is not what the feat prints. */
  { category: 'feats', id: 'primal-evolution', field: 'effectChoices', value: null },
];

const rows = readBackfill(ROOT);
let added = 0;
let updated = 0;
for (const e of edits) {
  const at = rows.findIndex((r) => r.category === e.category && r.id === e.id && r.field === e.field);
  if (at >= 0) { rows[at] = e; updated++; } else { rows.push(e); added++; }
}
writeBackfill(ROOT, rows);
console.log(`${edits.length} edit(s): ${added} added, ${updated} updated (${rows.length} rows).`);
