import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { scaleDamage } from '../src/rules/heightening';
import type { Character, Spell } from '../src/rules/types';

/**
 * Print batch P02, data-rows chunk 4: the magus focus spells whose whole fix is authored data
 * (work/.bP02-rows-data-rows-4.json). The printed pages are the authority: Impossible Magic
 * pg. 179-180 (spell-2876, spell-2882..2885), Rival Academies pg. 82 (spell-2311) and Secrets of
 * Magic pg. 143 (spell-1036).
 *
 * Every assertion on a record reads the SHIPPED content through `content()`, so the record-level
 * tests are red until the driver applies the rows. That is deliberate: they pin the row, and a
 * regeneration that drops it fails here. Each is paired with a BUILT magus proving the player who
 * owns the spell actually receives that record.
 */
const db = content();

const magus = (level: number, subclassId: string, over = {}): Character =>
  build('magus', level, { subclassId, keyAbility: 'str', ...over });
/** Every focus spell a built character can cast, across all focus entries and ranks. */
const focusSpells = (ch: Character): string[] =>
  ch.spellcasting.filter((s) => s.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());
const desc = (id: string) => db.spells[id]!.description ?? '';

describe('shielding-strike: the remaster order - shield first, then the Strike (spell-2882)', () => {
  // batch P02: shielding-strike
  it('shielding-strike: a Sparkling Targe magus owns the spell', () => {
    expect(focusSpells(magus(5, 'sparkling-targe'))).toContain('shielding-strike');
  });

  // batch P02: shielding-strike
  it('shielding-strike: the description raises the shield BEFORE the melee Strike', () => {
    const d = desc('shielding-strike');
    // Print: "You can either Raise your Shield if you're wielding one or cast shield if you have the
    // spell. Then, make a melee Strike." The legacy spell-1041 order (Strike first) must be gone.
    expect(d).toContain("You can either Raise your Shield if you're wielding one or cast shield if you have the spell. Then, make a melee Strike.");
    expect(d).not.toMatch(/Make a melee Strike\. You can then/);
  });

  // batch P02: shielding-strike
  it('shielding-strike: the Raise your Shield link sits on the printed words', () => {
    const labels = (db.spells['shielding-strike']!.descRefs ?? []).map((r) => r.label);
    expect(labels).toContain('Raise your Shield');
    expect(labels).not.toContain('Raise a Shield');
  });
});

describe('shooting-star: the printed Requirements line (spell-2883)', () => {
  // batch P02: shooting-star
  it('shooting-star: a Starlit Span magus owns the spell', () => {
    expect(focusSpells(magus(5, 'starlit-span'))).toContain('shooting-star');
  });

  // batch P02: shooting-star
  it('shooting-star: the description opens with the ranged-or-thrown requirement and the remaster body', () => {
    const d = desc('shooting-star');
    expect(d.startsWith("**Requirements** You're wielding a ranged weapon or a thrown weapon.\n\n---\n\n")).toBe(true);
    expect(d).toContain('for only this Strike');
    expect(d).not.toContain('for this Strike only');
  });
});

describe('spinning-staff: the printed Requirements line (spell-2884)', () => {
  // batch P02: spinning-staff
  it('spinning-staff: a Twisting Tree magus owns the spell', () => {
    expect(focusSpells(magus(5, 'twisting-tree'))).toContain('spinning-staff');
  });

  // batch P02: spinning-staff
  it('spinning-staff: the description opens with the staff requirement and the remaster body', () => {
    const d = desc('spinning-staff');
    expect(d.startsWith("**Requirements** You're wielding a staff.\n\n---\n\n")).toBe(true);
    expect(d).toContain('with an impossibly quick twirling flourish');
  });
});

describe('thunderous-strike: requirement and heightened damage (spell-2885)', () => {
  // batch P02: thunderous-strike#requirements
  it('thunderous-strike: an Inexorable Iron magus owns the spell', () => {
    expect(focusSpells(magus(5, 'inexorable-iron'))).toContain('thunderous-strike');
  });

  // batch P02: thunderous-strike#requirements
  it('thunderous-strike: the description opens with the two-handed melee requirement', () => {
    const d = desc('thunderous-strike');
    expect(d.startsWith("**Requirements** You're wielding a melee weapon in two hands.\n\n---\n\n")).toBe(true);
    expect(d).toContain('take 2 sonic damage');
    expect(d).toContain('**Heightened (+1)** The damage increases by 1.');
  });

  // batch P02: thunderous-strike#heightened-damage
  it('thunderous-strike: the record carries the printed 2 as its base damage', () => {
    const s = db.spells['thunderous-strike']!;
    expect(s.baseDamage).toBe('2');
    expect(s.damageKind).toBe('damage');
    expect(s.heightening).toEqual({ type: 'interval', interval: 1, damageIncr: '1' });
  });

  // batch P02: thunderous-strike#heightened-damage
  it('thunderous-strike: a 5th-level magus casts it at rank 3 for 4 sonic damage', () => {
    // "Heightened (+1) The damage increases by 1." Focus spells heighten to half your level rounded
    // up, so a 5th-level Inexorable Iron magus casts it at 3rd rank: 2 + 1 + 1 = 4.
    const ch = magus(5, 'inexorable-iron');
    expect(focusSpells(ch)).toContain('thunderous-strike');
    const rank = Math.ceil(ch.level / 2);
    expect(rank).toBe(3);
    expect(scaleDamage(db.spells['thunderous-strike']!, rank)).toBe('4');
    expect(scaleDamage(db.spells['thunderous-strike']!, 1)).toBeNull();
  });

  // batch P02: thunderous-strike#heightened-damage
  it('thunderous-strike: with baseDamage stripped in memory the scaling reaches nothing (the defect)', () => {
    const stripped = { ...db.spells['thunderous-strike']! } as Spell;
    delete stripped.baseDamage;
    expect(scaleDamage(stripped, 3)).toBeNull();
  });

  // batch P02: thunderous-strike#heightened-damage
  it('thunderous-strike: with the row PATCHED in memory, a built 5th-level magus heightens it to 4 and a 19th-level one to 11', () => {
    // Holds before AND after the driver applies the row: the copy carries the row's value whatever
    // the shipped record says. Print (spell-2885): "take 2 sonic damage" ... "Heightened (+1) The
    // damage increases by 1." A flat "2" must scale as a flat number (addDice), not as dice.
    const patched = { ...db.spells['thunderous-strike']!, baseDamage: '2', damageKind: 'damage' } as Spell;
    for (const [level, want] of [[5, '4'], [19, '11']] as const) {
      const ch = magus(level, 'inexorable-iron');
      expect(focusSpells(ch)).toContain('thunderous-strike');
      expect(scaleDamage(patched, Math.ceil(ch.level / 2))).toBe(want);
    }
    expect(scaleDamage(patched, 1)).toBeNull();
  });
});

describe("conjurers-countermeasure: cast, duration and prose (spell-2876)", () => {
  const withFeat = () =>
    magus(6, 'inexorable-iron', { featPicks: { '6:class': 'conjurers-countermeasure' } });

  // batch P02: conjurers-countermeasure#cast-duration
  it('conjurers-countermeasure: a magus with the feat owns the spell', () => {
    expect(focusSpells(withFeat())).toContain('conjurers-countermeasure');
  });

  // batch P02: conjurers-countermeasure#cast-duration
  it('conjurers-countermeasure: the spell is one action, lasts until the end of your next turn, level 3', () => {
    const s = db.spells['conjurers-countermeasure']! as Spell & { level?: number };
    expect(s.cast).toEqual({ type: 'actions', value: 1 });
    expect(s.duration).toBe('until the end of your next turn');
    expect(s.level).toBe(3);
  });

  // batch P02: conjurers-countermeasure#description
  it('conjurers-countermeasure: the description has no scraped header and a separated Heightened entry', () => {
    const d = desc('conjurers-countermeasure');
    expect(d.startsWith('You quickly create a barrier that protects you against the magic of spellcraft.')).toBe(true);
    expect(d).not.toMatch(/Source Impossible Magic/);
    expect(d).not.toMatch(/^Duration /m);
    expect(d.endsWith('\n\n---\n\n**Heightened (+3)** The resistance increases by 5.')).toBe(true);
  });
});

describe('turbulent-tide: the printed Requirements line (spell-2311)', () => {
  // batch P02: turbulent-tide#requirements
  it('turbulent-tide: a Resurgent Maelstrom magus owns the spell', () => {
    expect(focusSpells(magus(5, 'resurgent-maelstrom'))).toContain('turbulent-tide');
  });

  // batch P02: turbulent-tide#requirements
  it('turbulent-tide: the description opens with the improvised-weapon requirement', () => {
    const d = desc('turbulent-tide');
    expect(d.startsWith("**Requirements** You're wielding an improvised weapon.\n\n---\n\n")).toBe(true);
    expect(d).toContain('You cause the sheath of water');
  });
});

describe('cascade-countermeasure: the printed Requirements line (spell-1036)', () => {
  // batch P02: cascade-countermeasure#requirements
  it('cascade-countermeasure: a magus with the feat owns the spell', () => {
    const ch = magus(6, 'inexorable-iron', { featPicks: { '6:class': 'cascade-countermeasure' } });
    expect(focusSpells(ch)).toContain('cascade-countermeasure');
  });

  // batch P02: cascade-countermeasure#requirements
  it('cascade-countermeasure: the description opens with the Arcane Cascade requirement', () => {
    const d = desc('cascade-countermeasure');
    expect(d.startsWith("**Requirements** You're benefiting from Arcane Cascade.\n\n---\n\n")).toBe(true);
    expect(d).toContain('**Heightened (+3)** The resistance increases by 5.');
  });
});
