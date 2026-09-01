import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveDefenses, deriveBulk, deriveStrikes } from '../src/rules/derive';
import { deriveBuildFromCharacter } from '../src/rules/build';

const db = content();

/**
 * Records closed in Wanderer's-Guide parity batch 11 — an items-heavy batch. Each is asserted on a
 * BUILT character wherever it can be: a gate passing proves the comparers agree, not that a player
 * gets anything.
 */

describe('an affixed spellheart is still in use', () => {
  /* THE defect of this batch. Attaching a spellheart deliberately clears worn/equipped/invested so it
   * is not double-counted as loose gear — and every "while affixed to your armor" clause was gated on
   * exactly those flags, so a spellheart's benefit switched OFF at the moment the player affixed it,
   * the only state in which the printed text says it works. 61 attachable records carry such a clause. */
  const withCoil = (attached: boolean) =>
    build('fighter', 5, {
      // The answer lives on the BUILD, keyed `<itemId>:<choiceId>` — not on the inventory row.
      effectChoices: { 'jolt-coil:affix': 'armor' },
      inventory: [
        { instanceId: 'arm', itemId: 'hellknight-plate', quantity: 1, worn: true },
        {
          instanceId: 'coil',
          itemId: 'jolt-coil',
          quantity: 1,
          ...(attached ? { attachedTo: 'arm' } : { worn: true }),
        },
      ],
    } as never);

  it('grants its resistance while affixed, exactly as it does while worn', () => {
    const affixed = deriveDefenses(withCoil(true), db).resistances.find((r) => r.type === 'electricity');
    const loose = deriveDefenses(withCoil(false), db).resistances.find((r) => r.type === 'electricity');
    expect(loose?.value, 'premise: it works when merely worn').toBeGreaterThan(0);
    expect(affixed?.value, 'and must not switch off when affixed').toBe(loose?.value);
  });
});

describe('the seven quah emblems grant Shoanti', () => {
  /* *"The tattoo allows you to understand and speak Shoanti."* All seven variants carried no language
   * at all, and nothing else in the database grants Shoanti. ⚠ The ITEM path is
   * `passiveEffects.grantsLanguages` read off INVESTED items — a bare top-level `grantsLanguages` on an
   * item record is inert, which is the batch-10 wrong-reader trap in its item form. */
  const QUAH = ['tamiir', 'lyrune', 'shadde', 'shriikirri', 'shundar', 'sklar', 'skoan'];

  it('shoanti is a language we ship', () => {
    expect(db.languages?.shoanti, 'the grant must name a real language').toBeTruthy();
  });

  it('every emblem grants it while invested, and none while merely carried', () => {
    for (const q of QUAH) {
      const id = `unifying-emblem-${q}-quah`;
      expect(db.items[id], id).toBeTruthy();
      const langs = (invested: boolean) =>
        build('fighter', 3, {
          inventory: [{ instanceId: 'e', itemId: id, quantity: 1, ...(invested ? { invested: true } : {}) }],
        } as never).languages;
      expect(langs(true), id).toContain('shoanti');
      expect(langs(false), id).not.toContain('shoanti');
    }
  });
});

describe("a weapon's own printed item bonus to attack", () => {
  /* The alchemical bomb grades print "+1 item bonus to attack rolls" (moderate) through +3 (major).
   * A bomb takes no runes, so the potency slot that normally carries a weapon's item-class attack
   * bonus was permanently 0 and the printed number had nowhere to land — on 103 records. */
  it('the moderate acid flask carries it and it reaches the Strike', () => {
    expect(db.items['acid-flask-moderate']?.attackItemBonus).toBe(1);
    const ch = build('fighter', 5, {
      inventory: [{ instanceId: 'b', itemId: 'acid-flask-moderate', quantity: 1, equipped: true }],
    } as never);
    const strike = deriveStrikes(ch, db).find((s) => s.name.toLowerCase().includes('acid flask'));
    expect(strike, 'the bomb must produce a Strike at all').toBeTruthy();
    expect(strike!.potencyBonus, 'the printed +1 must reach the attack').toBe(1);
  });
});

describe('the Lifting Belt raises the Bulk limits it prints', () => {
  /* *"You can carry Bulk equal to 6 + your Strength modifier before becoming encumbered."* Only a
   * RUNE's `bulkLimitBonus` was ever read, so the identical field on an item looked authored and moved
   * nothing. */
  const bulkOf = (worn: boolean) =>
    deriveBulk(
      build('fighter', 3, {
        inventory: [{ instanceId: 'belt', itemId: 'lifting-belt', quantity: 1, ...(worn ? { worn: true, invested: true } : {}) }],
      } as never),
      db,
    );

  it('worn and invested raises both thresholds; in the pack it does not', () => {
    const on = bulkOf(true);
    const off = bulkOf(false);
    expect(on.encumberedAt).toBe(off.encumberedAt + 1);
    expect(on.max).toBe(off.max + 1);
  });
});

describe('Stylish Tricks — a SECOND skill increase at a level that already grants one', () => {
  it('the swashbuckler declares the levels and both increases land', () => {
    expect(db.classes.swashbuckler?.bonusSkillIncreaseLevels).toEqual([3, 7, 15]);
    const ch = build('swashbuckler', 7, {
      skillIncreases: { 3: 'acrobatics' },
      bonusSkillIncreases: { 3: 'thievery' },
    } as never);
    const atThree = (ch.skillIncreases ?? []).filter((s) => s.level === 3).map((s) => s.skill).sort();
    expect(atThree, 'two increases at one level').toEqual(['acrobatics', 'thievery']);
    expect(ch.proficiencies.skills.thievery).toBe('trained');
  });

  it('round-trips — the second pick does not overwrite the first on load', () => {
    // Both live in one array on the character and in two maps on the build; without the split the
    // second entry at level 3 clobbered the first every time a character was reopened.
    const ch = build('swashbuckler', 7, {
      skillIncreases: { 3: 'acrobatics' },
      bonusSkillIncreases: { 3: 'thievery' },
    } as never);
    const back = deriveBuildFromCharacter(ch, db) as unknown as {
      skillIncreases: Record<number, string>;
      bonusSkillIncreases: Record<number, string>;
    };
    expect(back.skillIncreases[3]).toBe('acrobatics');
    expect(back.bonusSkillIncreases[3]).toBe('thievery');
  });
});
