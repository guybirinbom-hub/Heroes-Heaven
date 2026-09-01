/*
 * The two lanes batch 002 needed, and the records they exist for.
 *
 * Both were "no field can carry this" findings. A lane with no test is a field with no proof of a
 * reader, which is the failure this project ships most often — so each is held here by the record that
 * wanted it, not by a synthetic fixture.
 */
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { strikeShowsCritSpec } from '../src/rules/derive';
import type { Strike } from '../src/rules/types';

/* strikeShowsCritSpec is the exported entry point; weaponMatches is internal to derive.ts. Wrapping it
 * in a one-source list exercises exactly the same matcher through the API the sheet actually calls. */
const matches = (s: Strike, w: unknown) => strikeShowsCritSpec(s, [{ level: 1, weapons: w as never }]);

const db = content();

describe('critSpecWeapons.names — a named unarmed strike', () => {
  /*
   * Oni Weapon Familiarity: "…whenever you get a critical hit with one of these weapons, OR WITH YOUR
   * HORNS UNARMED STRIKE, you get its critical specialization effect."
   *
   * None of the other three matchers can reach it: `bases` tests strike.base, which for a natural
   * attack is `natural:<index>` and never a weapon slug; `groups:['brawling']` or `traits:['unarmed']`
   * would light crit spec on Fist and every other unarmed strike the character has.
   */
  const strike = (over: Partial<Strike>): Strike =>
    ({ name: 'Fist', base: 'natural:0', group: 'brawling', traits: ['unarmed', 'agile'], ranged: false, ...over }) as Strike;

  it('the record carries the horns clause', () => {
    const w = db.feats['oni-weapon-familiarity']?.critSpecWeapons;
    expect(w?.bases, 'the four printed weapons must still be there').toEqual(
      expect.arrayContaining(['khakkhara', 'nodachi', 'ogre-hook', 'tetsubo']),
    );
    expect(w?.names, 'the horns half of the sentence').toEqual(['horns']);
  });

  it('matches the horns strike and no other unarmed strike', () => {
    const w = db.feats['oni-weapon-familiarity']?.critSpecWeapons;
    expect(matches(strike({ name: 'Horns' }), w), 'Horns must match').toBe(true);
    expect(matches(strike({ name: 'Horns (agile)' }), w), 'substring, so a suffixed name still matches').toBe(true);
    expect(matches(strike({ name: 'Fist' }), w), 'Fist must NOT match — that is why groups/traits were wrong').toBe(false);
    expect(matches(strike({ name: 'Claw' }), w), 'another natural attack must NOT match').toBe(false);
  });

  it('still matches the four printed weapons', () => {
    const w = db.feats['oni-weapon-familiarity']?.critSpecWeapons;
    expect(matches(strike({ name: 'Nodachi', base: 'nodachi', group: 'sword', traits: [] }), w)).toBe(true);
    expect(matches(strike({ name: 'Longsword', base: 'longsword', group: 'sword', traits: [] }), w)).toBe(false);
  });
});

describe('IwrEntry.against — a resistance that only applies against a named source', () => {
  /*
   * Draconic Resistance: "Double this resistance against damage of that type dealt to you by dragons."
   * The clause was encoded nowhere, and no resistance anywhere in core.json carried a qualifier.
   *
   * ⚠ The VALUE is Wanderer's Guide's reading, not ours, under the owner's parity rule. Theirs is
   * max(2, level) — double the unfloored half, then floor; ours would be 2*max(1, floor(level/2)).
   * They differ at every odd level from 3 up. The printed text reads our way; the rule says theirs
   * wins. This test pins the choice so it cannot be "corrected" back by accident.
   */
  const options = () => db.feats['draconic-resistance']?.effectChoices?.[0]?.options ?? [];

  it('every energy option grants the base resistance AND the doubled-against-dragons one', () => {
    const opts = options();
    expect(opts.length, 'the feat must still offer its energy choices').toBeGreaterThan(0);
    for (const o of opts) {
      const rs = o.grant?.resistances ?? [];
      const base = rs.find((r) => !r.against);
      const vs = rs.find((r) => r.against);
      expect(base, `${o.value}: base resistance`).toBeTruthy();
      expect(base?.value).toBe('max(1,floor(@actor.level/2))');
      expect(vs, `${o.value}: the doubled entry for the printed "against dragons" clause`).toBeTruthy();
      expect(vs?.against).toBe('dragons');
      expect(vs?.type, 'must double the SAME damage type it chose').toBe(base?.type);
      // Their reading, kept deliberately — see the block comment above.
      expect(vs?.value).toBe('max(2,@actor.level)');
    }
  });
});

describe('recordMarks — a clause that belongs on an ACTION row, authored from data', () => {
  /*
   * The DATA twin of the hand-authored RECORD_MARKERS table. Five records wanted it: Rune Singer,
   * Titan Wrestler and Group Coercion here, plus Whip Tail and Boots of Bounding from batch 001. All
   * three below carried NO mechanical field and no registry entry — completely inert — because the
   * clause changes an ACTION, and `situational` can only target a StatRef while
   * `modifiesGrant.actionRider` is gated on the target being an owned feat or class feature.
   */
  it('the three records carry marks pointing at real actions', () => {
    const cases: [string, number][] = [['rune-singer', 1], ['titan-wrestler', 5], ['group-coercion', 1]];
    for (const [id, count] of cases) {
      const marks = db.feats[id]?.recordMarks;
      expect(marks, `${id} must carry recordMarks`).toBeTruthy();
      expect(marks!.length, `${id}: one mark per action named in the printed text`).toBe(count);
      for (const m of marks!) {
        expect(m.on).toBe('action');
        expect(db.actions?.[m.id], `${id} -> actions/${m.id} must exist, or the note lands nowhere`).toBeTruthy();
        expect(m.note.length, `${id}: the note must actually say something`).toBeGreaterThan(20);
      }
    }
  });

  it('Titan Wrestler marks all five printed actions and nothing else', () => {
    const ids = (db.feats['titan-wrestler']?.recordMarks ?? []).map((m) => m.id).sort();
    expect(ids).toEqual(['disarm', 'grapple', 'reposition', 'shove', 'trip']);
  });
});
