import { describe, it, expect } from 'vitest';
import { build, content, grantPicker } from './_content';
import type { BuildState } from '../src/rules/build';

const db = content();

/**
 * Initiate Warden: *"You gain your choice of one warden spell from these initial warden spells."*
 *
 * A ranger has no spellcasting, so a warden spell needs a focus entry built from nothing — and
 * Wanderer's Guide spells out what that entry is: `defineCastingSource RANGER / PRIMAL /
 * ATTRIBUTE_WIS`, with spell attack and spell DC set to Trained. That is four facts, and the parity
 * pass could see none of them from our side, because ours are produced by the engine rather than
 * written on the record.
 *
 * So this pins them. If the focus entry ever loses its tradition, its key attribute or its rank, a
 * ranger's Gravity Weapon silently starts rolling off the wrong statistic.
 */

/* Asked through `grantPicker`, not off `effectChoices`: Initiate Warden is repeatable ("a different
 * initial warden spell each time"), and an `effectChoices` answer is stored once per RECORD, so its
 * pick moved to the per-taking `choice`. The four facts below are about the FOCUS ENTRY and are
 * unchanged by which lane asks the question. */
const wardenSpells = grantPicker(db.feats['initiate-warden'])!;

function ranger(spell: string, level = 1) {
  return build('ranger', level, {
    featPicks: { '1:class': 'initiate-warden' } as BuildState['featPicks'],
    featChoices: { '1:class': spell },
  } as Partial<BuildState>);
}

describe('Initiate Warden — the focus entry a ranger has no other way to get', () => {
  it('offers exactly the three printed initial warden spells, and all three ship', () => {
    expect(wardenSpells, 'the effect choice must exist').toBeTruthy();
    const values = (wardenSpells.options ?? []).map((o) => o.value);
    expect(values).toEqual(['gravity-weapon', 'heal-companion', 'magic-hide']);
    for (const v of values) expect(db.spells[v], `${v} must ship`).toBeTruthy();
  });

  it('grants the chosen spell as a focus spell', () => {
    const ch = ranger('gravity-weapon');
    const focus = ch.spellcasting.find((s) => s.type === 'focus');
    expect(focus, 'a ranger with a warden spell must have a focus entry').toBeTruthy();
    const all = [...(focus!.cantrips ?? []), ...Object.values(focus!.repertoire ?? {}).flat()];
    expect(all).toContain('gravity-weapon');
  });

  /* The three facts their `defineCastingSource` states outright. */
  it('builds it as PRIMAL, off WISDOM, at TRAINED', () => {
    const focus = ranger('heal-companion').spellcasting.find((s) => s.type === 'focus');
    expect(focus?.tradition).toBe('primal');
    expect(focus?.keyAbility).toBe('wis');
    expect(focus?.proficiency).toBe('trained');
  });

  it('gives the ranger a focus pool to spend it from', () => {
    const ch = ranger('magic-hide');
    expect(ch.focus?.max ?? 0).toBeGreaterThanOrEqual(1);
  });
});
