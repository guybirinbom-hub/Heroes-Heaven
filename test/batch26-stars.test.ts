import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import { characterSituationalIds, recordMarkersFor } from '../src/rules/explain';
import { deriveSpeeds } from '../src/rules/derive';
import { featSituationalFor } from '../src/rules/situationalBonuses';

const db = content();

/**
 * Wanderer's-Guide parity batch 26, STARS lane: printed heritage clauses that reached no row on the
 * sheet, plus two hand edits to rows the situational lane had generated with the wrong wording.
 *
 * Same discipline as batch 25: every assertion goes through the reader the SHEET uses —
 * `characterSituationalIds` / `recordMarkersFor` over a BUILT character — never over the registry
 * literal. An entry keyed to an id the character never contributes is invisible in play, so asserting
 * the table would prove nothing.
 */
type Ref = { kind: string; skill?: string; save?: string };

/** The situational clauses a heritage puts on one stat row, as the sheet would read them. */
const stars = (heritageId: string, ancestryId: string, ref: Ref) => {
  const c = build('fighter', 5, { heritageId, ancestryId } as Partial<BuildState>);
  return featSituationalFor(characterSituationalIds(c, db), ref).filter((s) => s.id === heritageId);
};

/** The `when :: bonus` strings on that row, joined — what the player reads in the stat popup. */
const text = (heritageId: string, ancestryId: string, ref: Ref) =>
  stars(heritageId, ancestryId, ref)
    .map((s) => `${s.when} :: ${s.bonus}`)
    .join(' | ');

/** The action/condition marks a heritage puts on one row, by source id. */
const marks = (heritageId: string, ancestryId: string, on: 'action' | 'condition', id: string) => {
  const c = build('fighter', 5, { heritageId, ancestryId } as Partial<BuildState>);
  return recordMarkersFor(c, db, on, id).filter((m) => m.sourceId === heritageId);
};

describe('flat-check clauses reach the row the player rolls on', () => {
  it('Charhide Goblin: persistent fire is a DC 10 flat check (heritage-250)', () => {
    /* Printed: "Your flat check to remove persistent fire damage is DC 10 instead of DC 15, which is
     * reduced to DC 5 if another creature uses a particularly appropriate action to help." The record
     * carried only the fire resistance. */
    const t = text('charhide-goblin', 'goblin', { kind: 'hp' });
    expect(t).toContain('persistent fire damage');
    expect(t).toContain('DC 10 instead of 15 (DC 5 with appropriate assistance)');
  });

  it('Warrenbred Hobgoblin: DC 3 concealed / DC 9 hidden underground (heritage-325)', () => {
    /* Printed: "While you're underground… reduce the DC of the flat check to 3 for a concealed target
     * or 9 for a hidden one." Only the Squeeze degree shift had ever shipped. */
    const t = text('warrenbred-hobgoblin', 'hobgoblin', { kind: 'strikeAttack' });
    expect(t).toContain("while you're underground");
    expect(t).toContain('flat check DC is 3 (concealed) or 9 (hidden) instead of 5 or 11');
  });

  it('Smokeworker Hobgoblin: auto-success against smoke concealment (heritage-323)', () => {
    /* Printed: "You automatically succeed at the DC 5 flat check to target a concealed creature if
     * that creature is concealed only by smoke." */
    const t = text('smokeworker-hobgoblin', 'hobgoblin', { kind: 'strikeAttack' });
    expect(t).toContain('concealed only by smoke');
    expect(t).toContain('automatically succeed at the DC 5 flat check');
  });
});

describe('Dog Kholo runs on all fours (heritage-328)', () => {
  it('the conditional Speed rides the Speed row, as a star and not a number', () => {
    /* Printed: "If you have both hands free, you can increase your Speed to 30 feet as you run on all
     * fours." A gate no `speedsIf` can express, and the owner's ruling is that a Speed is a real
     * number only while it is always on — so the star is the carrier, as for Hunter Automaton. */
    const t = text('dog-kholo', 'kholo', { kind: 'speed' });
    expect(t).toContain('both hands are free');
    expect(t).toContain('Speed becomes 30 feet');
  });

  it('the chassis Speed itself is untouched', () => {
    const c = build('fighter', 5, { heritageId: 'dog-kholo', ancestryId: 'kholo' } as Partial<BuildState>);
    expect(deriveSpeeds(c, db).land).toBe(25);
  });
});

describe('the environmental-temperature sentence, four more heritages', () => {
  it.each([
    ['snow-goblin', 'goblin'],
    ['frozen-wind-kitsune', 'kitsune'],
    ['wintertouched-human', 'human'],
  ])('%s treats environmental cold as one step less extreme', (heritageId, ancestryId) => {
    /* Printed word for word on all three (heritage-253, -139, -30): "You treat environmental cold
     * effects as if they were one step less extreme…" — the same sentence the b25 block already
     * carries for naari / winter-catfolk / desert-elf, which simply did not reach these records. */
    const t = text(heritageId, ancestryId, { kind: 'save', save: 'fortitude' });
    expect(t).toContain('against environmental cold effects');
    expect(t).toContain('treat the cold as one step less extreme');
  });

  it('Sandstrider Lizardfolk carries all three non-resistance clauses (heritage-343)', () => {
    /* Printed: "Environmental heat effects are one step less extreme for you, and you can go 10 times
     * as long as normal before you are affected by starvation or thirst. However, unless you wear
     * protective gear or take shelter, environmental cold effects are one step more extreme." */
    const t = text('sandstrider-lizardfolk', 'lizardfolk', { kind: 'save', save: 'fortitude' });
    expect(t).toContain('treat the heat as one step less extreme');
    expect(t).toContain('10 times as long as normal');
    // The "However" clause is a PENALTY and has to read as one.
    expect(t).toContain('unless you wear protective gear or take shelter');
    expect(t).toContain('one step MORE extreme');
  });
});

describe('Warrior Jotunborn: the lethal-fist waiver (heritage-420)', () => {
  it('the waiver is a star on the Strike row', () => {
    /* Printed: "You don't take a penalty when making a lethal attack with your fist." Print waives the
     * penalty; it does not strip the fist's nonlethal trait, and WG's own Warrior Jotunborn Fist keeps
     * Nonlethal. The star is what lets the trait line stay honest. */
    const t = text('warrior-jotunborn', 'jotunborn', { kind: 'strikeAttack' });
    expect(t).toContain('making a lethal attack with your fist');
    expect(t).toContain('no -2 penalty despite the nonlethal trait');
  });
});

describe('two generated rows corrected against print', () => {
  it('Strong Oak states the grab/restrain/prone extension (heritage-209)', () => {
    /* Printed second sentence: "This bonus also applies to saving throws against effects that would
     * grab you, restrain you, or knock you prone." Both save rows used to stop at "…Grapple you…". */
    /* Batch 27 aligned this entry to the house shape (the b25 rock-dwarf three-row shape, shared with
     * sacred-nagaji): one row per DC naming BOTH maneuvers, and the printed second sentence on its own
     * save:'all' row — so a Will save against a prone-knocking effect shows the star too. */
    const fort = text('strong-oak', 'ghoran', { kind: 'save', save: 'fortitude' });
    const reflex = text('strong-oak', 'ghoran', { kind: 'save', save: 'reflex' });
    const will = text('strong-oak', 'ghoran', { kind: 'save', save: 'will' });
    for (const t of [fort, reflex, will]) {
      expect(t).toContain('grab you, restrain you, or knock you prone');
      expect(t).toContain('+2 circumstance');
    }
    expect(fort).toContain('to your Fortitude DC against attempts to Grapple or Trip you');
    expect(reflex).toContain('to your Reflex DC against attempts to Grapple or Trip you');
    // the elided wording is gone from both
    expect(fort).not.toContain('against attempts to Grapple you…');
    expect(reflex).not.toContain('against attempts to Trip you…');
    // the Acrobatics half already matched print and is untouched
    expect(text('strong-oak', 'ghoran', { kind: 'skill', skill: 'acrobatics' })).toContain('to Balance');
    // ruling H's one-line cap, which the widened strings have to stay inside
    for (const s of [
      ...stars('strong-oak', 'ghoran', { kind: 'save', save: 'fortitude' }),
      ...stars('strong-oak', 'ghoran', { kind: 'save', save: 'reflex' }),
    ])
      expect(s.when.length).toBeLessThanOrEqual(120);
  });

  it('Lethoci states its Swim degree shift once, not twice (heritage-?)', () => {
    /* The record's own `degreeShifts` row already renders "if you critically fail an Athletics check
     * to Swim you get a failure instead" as an Athletics star and a Swim action marker; the registry's
     * `when` repeated it, so one rule came from two registries that can drift. */
    const t = text('lethoci', 'kashrishi', { kind: 'skill', skill: 'athletics' });
    expect(t).toContain('to Athletics checks to Swim :: +2 circumstance');
    expect(t).not.toContain('critical failure');
    /* POSITIVE CONTROL: the shift itself still reaches the player, from the structured field, through
     * `degreeShiftMarkers` (explain.ts) — asserted through the READER, not through the content field.
     * Reading `db.heritages['lethoci'].degreeShifts.length` would have passed even if the marker lane
     * were dead, which is exactly the drift the trim could have caused. */
    const c = build('fighter', 5, { heritageId: 'lethoci', ancestryId: 'kashrishi' } as Partial<BuildState>);
    const swim = recordMarkersFor(c, db, 'action', 'swim').filter((m) => m.sourceId === 'lethoci');
    expect(swim).toHaveLength(1);
    expect(swim[0].note).toContain('Swim');
  });
});

describe('heritage clauses that change an action or a condition', () => {
  it('Tailed Goblin needs one fewer free hand to Climb and to Trip (heritage-37)', () => {
    /* Printed third clause: "…and you reduce the number of free hands required to Climb or Trip by
     * one." The Athletics star and the Combat Climber grant were already there; this had no carrier. */
    for (const action of ['climb', 'trip'] as const) {
      const m = marks('tailed-goblin', 'goblin', 'action', action);
      expect(m).toHaveLength(1);
      expect(m[0].note).toContain('one fewer free hand');
    }
  });

  it('Shortshanks Hobgoblin is not off-guard while Climbing (heritage-322)', () => {
    /* Printed: "Additionally, you are not off-guard while you Climb." Only the Ride grant was carried;
     * WG injects this same sentence onto the Climb action row. */
    const m = marks('shortshanks-hobgoblin', 'hobgoblin', 'action', 'climb');
    expect(m).toHaveLength(1);
    expect(m[0].value).toBe('not off-guard');
    expect(m[0].note).toContain('not off-guard while you Climb');
  });

  it('Vivacious Gnome reads doomed one lower (heritage-92)', () => {
    /* Printed: "When you have the doomed condition, the condition affects you as if its value was 1
     * lower than it actually is (doomed 1 has no effect, doomed 2 causes you to die at dying 3…)."
     * The entire second half of the heritage, and nothing carried it. */
    const m = marks('vivacious-gnome', 'gnome', 'condition', 'doomed');
    expect(m).toHaveLength(1);
    expect(m[0].value).toBe('-1');
    expect(m[0].note).toContain('as if its value were 1 lower');
    expect(m[0].note).toContain('doomed 2 means you die at dying 3');
  });

  /* Ruling H caps a one-line note at 120 characters, "the full text staying in the description a
   * click away". `test/held-back-registry-fixes.test.ts` guards the FEAT_SITUATIONAL `when` strings
   * registry-wide; nothing guarded a RECORD_MARKERS `note`, and this batch shipped one at 125. The
   * guard is scoped to the batch's own ids because 25 notes authored before the ruling are longer —
   * widening it is a separate cleanup, not a licence to add a 26th. */
  it('every batch-26 marker note stays inside ruling H one-line cap', () => {
    for (const [heritageId, ancestryId, on, id] of [
      ['tailed-goblin', 'goblin', 'action', 'climb'],
      ['tailed-goblin', 'goblin', 'action', 'trip'],
      ['shortshanks-hobgoblin', 'hobgoblin', 'action', 'climb'],
      ['vivacious-gnome', 'gnome', 'condition', 'doomed'],
    ] as const)
      for (const m of marks(heritageId, ancestryId, on, id)) expect(m.note.length).toBeLessThanOrEqual(120);
  });
});
