import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { choiceOwnedFeatureIds, ownedFeatureIds } from '../src/rules/derive';

/**
 * A witch's Lesson grants a hex, and the hex lives on the LESSON, not on the feat.
 *
 * Basic/Greater/Major Lesson carry a `choice` whose value names a `lesson-of-*` class feature. Nothing
 * turned a chosen value into an owned feature, and focus spells from a class feature are gathered
 * from `klass.features` alone — a lesson is in no class's feature list. So a witch picked a lesson,
 * saw it in the builder, and never received the hex.
 *
 * The lane is OPT-IN (`choice.ownsFeature`) rather than "any value that resolves", because 33 feats
 * offer a value that happens to be a classFeature id: Dragon Disciple Dedication offers "time", which
 * is also the oracle's Time mystery.
 */
const db = content();
const LESSON_FEATS = ['basic-lesson', 'greater-lesson', 'major-lesson'] as const;
const lessons = () => Object.entries(db.classFeatures).filter(([id]) => id.startsWith('lesson-of'));

describe('witch lessons deliver their hex', () => {
  it('every lesson carries a focus spell that is a real hex', () => {
    for (const [id, r] of lessons()) {
      expect(r.focusSpells?.length, `${id} carries no hex`).toBeGreaterThan(0);
      for (const sid of r.focusSpells!) {
        const sp = db.spells[sid];
        expect(sp, `${id} names "${sid}", which is not a spell`).toBeDefined();
        expect((sp.traits ?? []).some((t) => t === 'hex' || t === 'witch'), `${sid} is not a hex`).toBe(true);
      }
    }
  });

  it('all three lesson feats opt into owning what they pick', () => {
    for (const id of LESSON_FEATS) expect(db.feats[id].choice?.ownsFeature, id).toBe(true);
  });

  it('picking a lesson puts its record in ownedFeatureIds, aon- prefix and all', () => {
    const value = db.feats['basic-lesson'].choice!.options![0].value; // 'aon-lesson-of-calamity'
    expect(value.startsWith('aon-'), 'the option no longer carries the prefix this strips').toBe(true);
    const owned = choiceOwnedFeatureIds([{ featId: 'basic-lesson', choice: { value } }], db);
    expect(owned).toContain(value.replace(/^aon-/, ''));
  });

  it('a witch who takes the feat actually receives the hex', () => {
    const value = db.feats['basic-lesson'].choice!.options![0].value;
    const hex = db.classFeatures[value.replace(/^aon-/, '')].focusSpells![0];
    const ch = build('witch', 4, { featPicks: { '2:class': 'basic-lesson' }, featChoices: { '2:class': value } });

    expect(ownedFeatureIds(ch, db).has(value.replace(/^aon-/, ''))).toBe(true);
    // Focus spells live in the focus entry's repertoire, and spellSources records what gave each one.
    const focusEntry = ch.spellcasting.find((e) => e.type === 'focus')!;
    const known = Object.values(focusEntry.repertoire ?? {}).flat();
    expect(known, `the witch never received ${hex}`).toContain(hex);
    expect(focusEntry.spellSources?.[hex], 'the hex is not attributed to its lesson').toBeTruthy();
  });

  it('a witch WITHOUT the feat receives no lesson hex', () => {
    const ch = build('witch', 4, {});
    const known = new Set(ch.spellcasting.flatMap((e) => Object.values(e.repertoire ?? {}).flat()));
    const allHexes = lessons().flatMap(([, r]) => r.focusSpells ?? []);
    expect(allHexes.filter((h) => known.has(h))).toEqual([]);
  });

  it('the opt-in gate is what stops a false match', () => {
    // Dragon Disciple Dedication offers "time", which IS an oracle mystery classFeature. Without the
    // flag it would be owned; with it, nothing happens.
    const ded = db.feats['dragon-disciple-dedication'];
    if (!ded?.choice?.options?.some((o) => o.value === 'time')) return; // the data moved on
    expect(ded.choice.ownsFeature).toBeFalsy();
    expect(choiceOwnedFeatureIds([{ featId: 'dragon-disciple-dedication', choice: { value: 'time' } }], db)).toEqual([]);
  });
});
