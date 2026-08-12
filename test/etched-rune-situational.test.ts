import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { explainStat, statHasSituational } from '../src/rules/explain';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { normalizeCharacter } from '../src/rules/normalize';

const c = content();

/**
 * ETCHED RUNES.
 *
 * A property rune is not an inventory row once it is on a weapon — etching CONSUMES the loose item
 * (InventoryTab commits the plan, then removes it) and records the id in `inventory[].runes.property`.
 * `characterSituationalIds` only walked `inv.itemId`, so a rune's conditional bonuses disappeared at
 * exactly the moment the rune started working: visible while it sat unused in your pack, invisible
 * once etched.
 *
 * Companion-sourced entries are deliberately NOT wired into this path — see the last test.
 */

const withRune = (rune: string, equipped = true) =>
  normalizeCharacter({
    id: 'r', name: 'R', level: 5, classId: 'fighter', keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    feats: [],
    inventory: [{ instanceId: 'w1', itemId: 'longsword', quantity: 1, equipped, runes: { potency: 1, property: [rune] } }],
  });

describe('etched property runes keep their situational bonuses', () => {
  it('deathdrinking stars saves once etched, not only while loose in the pack', () => {
    const ch = withRune('deathdrinking');
    expect(statHasSituational(ch, { kind: 'save', save: 'will' }, c)).toBe(true);
    expect(explainStat(ch, c, { kind: 'save', save: 'will' }).situational?.map((s) => s.text).join(' ')).toContain('against void damage and death effects');
  });

  it('a rune on a weapon you are NOT wielding contributes nothing', () => {
    // Same gate as any other item: a bonus from a weapon in your pack is not a bonus you have.
    // ⚠ This asked `statHasSituational(…, 'will') === false`, i.e. that NOTHING starred the Will
    // save. That stopped being a statement about the rune once the degreeShifts lane was authored:
    // this level-5 fighter has Bravery, whose shift correctly stars Will. The claim is about the
    // rune, so it now names the rune.
    const stowed = withRune('deathdrinking', false);
    const lines = explainStat(stowed, c, { kind: 'save', save: 'will' }).situational ?? [];
    expect(lines.some((s) => s.sourceId === 'deathdrinking')).toBe(false);
  });

  it('every rune in the registry is reachable this way', () => {
    const runeIds = Object.keys(FEAT_SITUATIONAL).filter((id) => c.runes?.[id]);
    expect(runeIds.length).toBeGreaterThanOrEqual(10);
    const unreachable = runeIds.filter((id) => {
      const ch = withRune(id);
      // Whatever the rune targets, SOMETHING on the character must now see it.
      return !FEAT_SITUATIONAL[id].some((b) =>
        b.targets.some((t) => {
          const ref =
            t.kind === 'skill' ? { kind: 'skill' as const, skill: (t.detail === 'all' ? 'athletics' : t.detail) as never }
            : t.kind === 'save' ? { kind: 'save' as const, save: (t.detail === 'all' ? 'will' : t.detail) as never }
            : t.kind === 'perception' ? { kind: 'perception' as const }
            : t.kind === 'ac' ? { kind: 'ac' as const }
            : t.kind === 'speed' ? { kind: 'speed' as const }
            : t.kind === 'hp' ? { kind: 'hp' as const }
            : t.kind === 'classDc' ? { kind: 'classDc' as const }
            : null;
          return ref ? statHasSituational(ch, ref, c) : true; // strike/spell refs need an instance; covered above
        }),
      );
    });
    expect(unreachable, 'runes whose bonuses can never surface').toEqual([]);
  });

  it('COMPANION-sourced entries stay off the character, because they are not the character’s', () => {
    // Both records say so in their own `when`: the bonus is the animal companion's, not yours.
    // Wiring them into characterSituationalIds would star the player's saves for a bonus the player
    // does not get — the exact mis-target this registry is supposed to avoid.
    for (const id of ['aon-vulture', 'steadfast-strider']) {
      expect(FEAT_SITUATIONAL[id], `${id} should still be in the registry`).toBeTruthy();
      const ch = normalizeCharacter({
        id: 'p', name: 'P', level: 5, classId: 'ranger', keyAbility: 'dex',
        abilities: { str: 12, dex: 18, con: 12, int: 10, wis: 12, cha: 10 },
        companions: [{ id: 'c1', kind: id, name: 'Pet' }],
      });
      expect(statHasSituational(ch, { kind: 'save', save: 'fortitude' }, c), `${id} must not star the PC`).toBe(false);
    }
  });
});
