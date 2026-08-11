import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { creatureTraitsOf } from '../src/rules/derive';
import { statHasSituational, explainStat, recordMarkersFor } from '../src/rules/explain';
import type { DegreeShift } from '../src/rules/types';

const db = () => content();

/** A character who owns exactly the record under test, so nothing else can supply the effect. */
const withFeat = (featId: string) => {
  const c = db();
  return buildCharacter(
    { ...emptyBuild(), level: 20, ancestryId: 'human', backgroundId: Object.keys(c.backgrounds)[0], classId: 'fighter', keyAbility: 'str', featPicks: { '1:class:0': featId } },
    c,
  );
};

describe('creature traits (owner ruling Q6)', () => {
  it('the ancestry supplies the baseline', () => {
    const traits = creatureTraitsOf(withFeat('sudden-charge'), db());
    expect(traits.map((t) => t.trait)).toContain('human');
    expect(traits.map((t) => t.trait)).toContain('humanoid');
    expect(traits.every((t) => t.from === 'ancestry')).toBe(true);
  });

  it('a record that grants traits adds them, marked with its source', () => {
    const c = db();
    // Zombie Dedication is the case the gold set settled: "You gain the undead and zombie traits."
    expect(c.feats['zombie-dedication']?.grantsCreatureTraits).toEqual(['undead', 'zombie']);
  });

  it('an acquired trait does not replace the ancestry ones — you are still a human, AND undead', () => {
    const c = db();
    const ch = withFeat('sudden-charge');
    // Drive the aggregator directly with a synthesised owner, so the test does not depend on a feat
    // being takeable by a fighter at level 1.
    const withZombie = { ...ch, feats: [...ch.feats, { featId: 'zombie-dedication', level: 2, category: 'class' as const }] };
    const traits = creatureTraitsOf(withZombie, c);
    const names = traits.map((t) => t.trait);
    expect(names).toContain('human');
    expect(names).toContain('undead');
    expect(names).toContain('zombie');
    expect(traits.find((t) => t.trait === 'undead')?.from).toBe('granted');
    expect(traits.find((t) => t.trait === 'human')?.from).toBe('ancestry');
  });

  it('never lists the same trait twice, however many records grant it', () => {
    const c = db();
    const ch = withFeat('sudden-charge');
    const doubled = {
      ...ch,
      feats: [
        ...ch.feats,
        { featId: 'zombie-dedication', level: 2, category: 'class' as const },
        { featId: 'lich-dedication', level: 4, category: 'class' as const }, // also grants undead
      ],
    };
    const undead = creatureTraitsOf(doubled, c).filter((t) => t.trait === 'undead');
    expect(undead).toHaveLength(1);
  });

  it('the contextual placeholders were NOT authored — "the appropriate trait" is not a trait', () => {
    const c = db();
    expect(c.feats['bloodline-mutation']?.grantsCreatureTraits).toBeUndefined();
    expect(c.classFeatures['deity-cleric']?.grantsCreatureTraits).toBeUndefined();
  });
});

describe('degree-of-success shifts (owner ruling Q2 — star BOTH the skill and the action)', () => {
  const SHIFT: DegreeShift[] = [
    { shift: 'successToCrit', when: 'on a check to Pick a Lock', skills: ['thievery'], actions: ['pick-a-lock'] },
  ];

  /** Inject the field on a record the character owns, which is how authored data will reach it. */
  const withShift = (shifts: DegreeShift[]) => {
    const c = db();
    const patched = { ...c, feats: { ...c.feats, 'sudden-charge': { ...c.feats['sudden-charge'], degreeShifts: shifts } } };
    const ch = buildCharacter(
      { ...emptyBuild(), level: 20, ancestryId: 'human', backgroundId: Object.keys(c.backgrounds)[0], classId: 'fighter', keyAbility: 'str', featPicks: { '1:class:0': 'sudden-charge' } },
      patched,
    );
    return { ch, patched };
  };

  it('stars the SKILL', () => {
    const { ch, patched } = withShift(SHIFT);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'thievery' }, patched)).toBe(true);
  });

  it('marks the ACTION from the same entry — the half that used to be a separate registry', () => {
    const { ch, patched } = withShift(SHIFT);
    const marks = recordMarkersFor(ch, patched, 'action', 'pick-a-lock');
    expect(marks).toHaveLength(1);
    expect(marks[0].value).toBe('success → crit success');
    expect(marks[0].note).toContain('a success is a critical success instead');
    expect(marks[0].note).toContain('Pick a Lock');
  });

  it('does not leak onto an unrelated skill or action', () => {
    const { ch, patched } = withShift(SHIFT);
    expect(statHasSituational(ch, { kind: 'skill', skill: 'athletics' }, patched)).toBe(false);
    expect(recordMarkersFor(ch, patched, 'action', 'balance')).toHaveLength(0);
  });

  it('a general save clause stars ALL THREE saves — Q2’s sub-question, answered yes', () => {
    const { ch, patched } = withShift([
      { shift: 'successToCrit', when: 'against a disease or poison', saves: ['all'] },
    ]);
    for (const save of ['fortitude', 'reflex', 'will'] as const) {
      expect(statHasSituational(ch, { kind: 'save', save }, patched), save).toBe(true);
    }
  });

  it('the note the player reads names the shift and its trigger', () => {
    const { ch, patched } = withShift(SHIFT);
    // Through the real popup path, so this asserts what actually reaches the player.
    const notes = explainStat(ch, patched, { kind: 'skill', skill: 'thievery' }).situational ?? [];
    expect(notes.some((n) => n.text.includes('a success is a critical success instead'))).toBe(true);
    expect(notes.some((n) => n.text.includes('Pick a Lock'))).toBe(true);
    // Clickable back to the record that granted it — ruling H.
    expect(notes.find((n) => n.text.includes('critical success instead'))?.sourceId).toBe('sudden-charge');
  });

  it('an actions-only shift still marks the action and stars no stat', () => {
    const { ch, patched } = withShift([
      { shift: 'critFailToFail', when: 'when you Earn Income with a Lore skill', actions: ['earn-income'] },
    ]);
    expect(recordMarkersFor(ch, patched, 'action', 'earn-income')[0]?.value).toBe('crit fail → fail');
    expect(statHasSituational(ch, { kind: 'skill', skill: 'thievery' }, patched)).toBe(false);
  });
});
