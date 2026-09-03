import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import { characterSituationalIds, recordMarkersFor } from '../src/rules/explain';
import { featSituationalFor } from '../src/rules/situationalBonuses';

const db = content();

/**
 * Wanderer's-Guide parity batch 25, STARS lane: printed heritage clauses that reached no row on the
 * sheet, plus one duplicate marker removed.
 *
 * Every assertion goes through the reader the SHEET uses — `characterSituationalIds` over a built
 * character, then `featSituationalFor` for the stat row — not over the registry literal. A registry
 * entry keyed to an id the character never contributes is invisible in play, which is exactly the
 * failure earlier batches kept finding, so asserting the table would prove nothing.
 */
type Ref = { kind: string; skill?: string; save?: string };

/** The situational clauses a heritage puts on one stat row, as the sheet would read them. */
const stars = (heritageId: string, ref: Ref, over: Partial<BuildState> = {}) => {
  const c = build('fighter', 5, { heritageId, ...over } as Partial<BuildState>);
  return featSituationalFor(characterSituationalIds(c, db), ref).filter((s) => s.id === heritageId);
};

/** The `bonus` strings on that row, joined — what the player reads in the stat popup. */
const text = (heritageId: string, ref: Ref, over: Partial<BuildState> = {}) =>
  stars(heritageId, ref, over)
    .map((s) => `${s.when} :: ${s.bonus}`)
    .join(' | ');

describe('flat-check reductions reach the Strike row', () => {
  it('Whisper Elf: DC 3 concealed / DC 9 hidden (heritage-243)', () => {
    /* Printed: "reduce the DC of the flat check to 3 for a concealed target or 9 for a hidden one".
     * Only the +2 Seek half had ever shipped. */
    const t = text('whisper-elf', { kind: 'strikeAttack' }, { ancestryId: 'elf' });
    expect(t).toContain('flat check DC is 3 (concealed) or 9 (hidden) instead of 5 or 11');
    expect(t).toContain('capable of making sound');
    // the Seek half is still there
    expect(text('whisper-elf', { kind: 'perception' }, { ancestryId: 'elf' })).toContain('+2 circumstance');
  });

  it('Liminal Fetchling: DC 3 concealed and DC 9 undetected (heritage-122)', () => {
    /* Printed: "Your flat check to target concealed creatures is DC 3 instead of DC 5, and your flat
     * check to target undetected creatures is DC 9 instead of DC 11." */
    const t = text('liminal-fetchling', { kind: 'strikeAttack' }, { ancestryId: 'fetchling' });
    expect(t).toContain('DC 3 flat check instead of DC 5');
    expect(t).toContain('DC 9 flat check instead of DC 11');
    expect(text('liminal-fetchling', { kind: 'perception' }, { ancestryId: 'fetchling' })).toContain('+1 circumstance');
  });
});

describe('Rock Dwarf plays as printed (heritage-237)', () => {
  const fort = () => text('rock-dwarf', { kind: 'save', save: 'fortitude' }, { ancestryId: 'dwarf' });
  const reflex = () => text('rock-dwarf', { kind: 'save', save: 'reflex' }, { ancestryId: 'dwarf' });

  it('both defenses cover all three maneuvers — not the old Fort/Reflex split', () => {
    /* Printed: "+2 circumstance bonus to your Fortitude OR Reflex DC against attempts to Reposition,
     * Shove, or Trip you." We used to scope Reposition/Shove to Fortitude and Trip to Reflex. */
    for (const t of [fort(), reflex()]) {
      expect(t).toContain('Reposition, Shove, or Trip you');
      expect(t).toContain('+2 circumstance');
    }
  });

  it('the spells-and-effects sentence is carried', () => {
    /* Printed: "This bonus also applies to saving throws against spells or effects that attempt to
     * force you to move or knock you prone" — it had no carrier at all. */
    expect(fort()).toContain('spells or effects that try to move you or knock you prone');
    expect(text('rock-dwarf', { kind: 'save', save: 'will' }, { ancestryId: 'dwarf' })).toContain(
      'spells or effects that try to move you or knock you prone',
    );
  });

  it('halved forced movement shows on the Speed row', () => {
    /* Printed: "if any effect would force you to move 10 feet or more, you are moved only half the
     * distance" — description prose only until b25. */
    expect(text('rock-dwarf', { kind: 'speed' }, { ancestryId: 'dwarf' })).toContain('moved only half the distance');
  });
});

describe('heritage clauses that had no carrier at all', () => {
  it('Strong-Blooded Dwarf reduces poison affliction stages (heritage-238)', () => {
    /* Printed: "each of your successful saving throws against a poison affliction reduces its stage
     * by 2, or by 1 for a virulent poison. Each critical success … by 3, or by 2 for a virulent." */
    const t = text('strong-blooded-dwarf', { kind: 'save', save: 'fortitude' }, { ancestryId: 'dwarf' });
    expect(t).toContain('poison affliction');
    expect(t).toContain('each success reduces the stage by 2 (1 if virulent); each critical success by 3 (2 if virulent)');
  });

  it('Thalassic Azarketi keeps full range increments underwater (heritage-197)', () => {
    /* Printed: "your piercing ranged attacks don't have their range increments halved when fighting
     * underwater targets." */
    expect(text('thalassic-azarketi', { kind: 'strikeAttack' }, { ancestryId: 'azarketi' })).toContain(
      'range increments are not halved',
    );
  });

  it('Reflection needs no Deception check to Impersonate its progenitor (heritage-428)', () => {
    /* Printed: "You don't need to attempt Deception checks to Impersonate your progenitor unless
     * you're interacting with people who know them personally…" — the heritage's only active
     * benefit beyond its trait, and it reached no row. */
    const t = text('reflection', { kind: 'skill', skill: 'deception' });
    expect(t).toContain('Impersonate your progenitor');
    expect(t).toContain('no check needed');
    // Both printed exceptions survive ruling H's 120-char trim of the `when`.
    expect(t).toContain('knows them personally');
    expect(t).toContain('out of character');
    expect(stars('reflection', { kind: 'skill', skill: 'deception' })[0].when.length).toBeLessThanOrEqual(120);
  });

  it('Benthic Azarketi carries both non-resistance clauses (heritage-194)', () => {
    /* Printed: "you don't treat environmental cold as one degree more severe when you are wet. You
     * adapt to pressure changes from being deep underwater automatically without ill effect." */
    const t = text('benthic-azarketi', { kind: 'save', save: 'fortitude' }, { ancestryId: 'azarketi' });
    expect(t).toContain('not treated as one degree more severe');
    expect(t).toContain('deep underwater');
    // the resistance is untouched — print gives no "minimum 1" here, unlike Winter Catfolk
    expect(db.heritages['benthic-azarketi'].resistances).toEqual([{ type: 'cold', value: 'floor(@actor.level/2)' }]);
  });

  it.each([
    ['naari', undefined, 'heat', 'one step less severe'],
    ['winter-catfolk', 'catfolk', 'cold', 'one step less extreme'],
    ['desert-elf', 'elf', 'heat', 'one step less extreme'],
  ])('%s treats environmental %s as one step less', (heritageId, ancestryId, kind, phrase) => {
    /* Three heritages print the same environmental-temperature sentence and nothing in the app has an
     * environment lane. Three records do not justify building one, so each rides its own save row. */
    const t = text(heritageId, { kind: 'save', save: 'fortitude' }, ancestryId ? { ancestryId } : {});
    expect(t).toContain(`against environmental ${kind} effects`);
    expect(t).toContain(phrase);
  });
});

describe('House Drake jaws count as silver (heritage-424)', () => {
  /* Printed as ONE sentence: "Your jaws count as silver and you gain a +1 circumstance bonus to
   * damage rolls against fiends." Only the fiend half shipped. */
  const hd = (ref: Ref) => text('house-drake', ref, { ancestryId: 'dragonet' });

  it('the silver marker rides both strike rows', () => {
    expect(hd({ kind: 'strikeAttack' })).toContain('counts as silver');
    expect(hd({ kind: 'strikeDamage' })).toContain('counts as silver');
  });

  it('the fiend half survives, and only the JAWS are silver', () => {
    const dmg = hd({ kind: 'strikeDamage' });
    expect(dmg).toContain('+1 circumstance');
    expect(dmg).toContain('with your jaws Strike');
    // WG also injects the same text on the dragonet CLAWS item; print does not say that, so we don't.
    expect(dmg).not.toMatch(/claw/i);
  });
});

describe('Nine Lives Catfolk: the duplicate marker is gone, the structured field still delivers', () => {
  it('no dying-condition marker restates the recovery DC', () => {
    /* The marker hard-coded "recovery DC 10" beside the pill that COMPUTES the same number, and could
     * not track recoveryDcReduction (Toughness). The structured field is the single source. */
    const c = build('fighter', 5, { heritageId: 'nine-lives-catfolk', ancestryId: 'catfolk' } as Partial<BuildState>);
    expect(recordMarkersFor(c, db, 'condition', 'dying').map((m) => m.sourceId)).not.toContain('nine-lives-catfolk');
  });

  it('the mechanic itself is untouched', () => {
    const c = build('fighter', 5, { heritageId: 'nine-lives-catfolk', ancestryId: 'catfolk' } as Partial<BuildState>);
    expect(c.recoveryDcIgnoresDyingValue).toBe(true);
  });

  it('POSITIVE CONTROL: a heritage marker still reaches recordMarkersFor', () => {
    /* Without this the assertion above passes vacuously the day heritage ids stop reaching
     * `characterSituationalIds` — an empty list "contains" nothing either. Jinxed Tengu's doomed
     * marker is the nearest live sibling of the one b25 removed. */
    const c = build('fighter', 5, { heritageId: 'jinxed-tengu', ancestryId: 'tengu' } as Partial<BuildState>);
    expect(recordMarkersFor(c, db, 'condition', 'doomed').map((m) => m.sourceId)).toContain('jinxed-tengu');
  });
});
