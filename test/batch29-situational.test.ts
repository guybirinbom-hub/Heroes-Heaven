// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderText } from './_render';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { characterSituationalIds, explainStat, recordMarkersFor } from '../src/rules/explain';
import { featSituationalFor, FEAT_SITUATIONAL, RECORD_MARKERS } from '../src/rules/situationalBonuses';
import type { Character } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 29, SITUATIONAL REGISTRY lane.
 *
 * Same discipline as batches 25–28: every assertion goes through the reader the SHEET uses —
 * `featSituationalFor(characterSituationalIds(...))`, `recordMarkersFor`, `explainStat`, or the
 * companion card itself — over a BUILT character. Asserting the registry literal would prove only
 * that a line was typed; an entry keyed to an id the character never contributes is invisible in
 * play, which is exactly the defect two of these findings are.
 */
const db = content();
const noop = () => undefined;

/** A character with one item in use — the state an item's clauses require. */
const withItem = (itemId: string, classId = 'fighter', level = 7): Character =>
  ({ ...build(classId, level), inventory: [{ itemId, qty: 1, invested: true, equipped: true, worn: true }] }) as unknown as Character;

/** A character holding feats by id, the route `characterSituationalIds` reads first. */
const withFeats = (featIds: string[], classId = 'fighter', level = 7): Character => {
  const base = build(classId, level);
  return {
    ...base,
    feats: [...base.feats, ...featIds.map((featId, i) => ({ featId, level, slot: `b29:${i}` }))],
  } as unknown as Character;
};

/** The `when :: bonus` strings one record puts on a stat row, as the sheet reads them. */
const stars = (c: Character, ref: { kind: string; skill?: string; save?: string }, sourceId: string) =>
  featSituationalFor(characterSituationalIds(c, db), ref)
    .filter((s) => s.id === sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`);

describe('ghost-scarf: the haunt bonus is filed on the row print names', () => {
  /* equipment-4104: "granting the wearer a +1 item bonus to all Perception checks and Perception DCs
   * to resolve discovering a haunt or rolling initiative when a haunt triggers." Filed under
   * `initiative`, it reached the Perception row not at all. */
  it('reaches Perception, and still reaches Initiative through the delegated breakdown', () => {
    const c = withItem('ghost-scarf');
    const perc = stars(c, { kind: 'perception' }, 'ghost-scarf');
    expect(perc.length, 'one Perception star, from the scarf').toBe(1);
    expect(perc[0]).toContain('discover a haunt');
    expect(perc[0]).toContain('+1 item');
    // Initiative delegates to Perception (explain.ts case 'initiative'), so the initiative half of the
    // same sentence is still in front of the player — and is not counted twice.
    const init = (explainStat(c, db, { kind: 'initiative' }).situational ?? []).filter((s) => s.sourceId === 'ghost-scarf');
    expect(init.length).toBe(1);
    expect(init[0].text).toContain('on initiative when a haunt triggers');
  });

  /* "If the weapon already bears a ghost touch rune, you instead gain a +1 item bonus to Fortitude
   * saves against effects from incorporeal undead for 5 minutes." Both gates had been elided into an
   * ellipsis, so the star read as a blanket +1 after any activation. */
  it('the Fortitude clause carries both printed gates', () => {
    const fort = stars(withItem('ghost-scarf'), { kind: 'save', save: 'fortitude' }, 'ghost-scarf');
    expect(fort.length).toBe(1);
    expect(fort[0]).toContain('already bears a ghost touch rune');
    expect(fort[0]).toContain('incorporeal undead');
    expect(fort[0], 'the elided wording must not come back').not.toContain('Caress…');
  });
});

describe('alacritous-horseshoes: the printed Leap distance reaches the companion card', () => {
  /* equipment-3013-2868: "In addition, when it Leaps, it can move 5 feet farther if jumping
   * horizontally or 3 feet higher if jumping vertically." Only the +5-foot Speed and the Athletics
   * star had ever shipped. */
  it('the companion block prints the extra Leap distance beside the Athletics star', () => {
    const typeId = Object.keys(db.animalCompanions)[0];
    const base = build('ranger', 7, {
      featPicks: { '1:class:0': 'animal-companion' },
      companions: [
        {
          id: 'c1',
          kind: 'animal',
          name: 'Fang',
          typeId,
          inventory: [{ itemId: 'alacritous-horseshoes', qty: 1, invested: true, equipped: true, worn: true }],
        },
      ],
    } as never);
    const ch = applyPlayState(base, initialPlay(base, db), db);
    const text = renderText(createElement(CompanionsTab, { character: ch, content: db, onPlay: noop, charKey: 't' }));
    // A non-numeric `bonus` string renders: CompanionSituational words every clause through
    // targetPhrase whatever the target kind is.
    expect(text).toContain('move 5 feet farther jumping horizontally, or 3 feet higher jumping vertically');
    expect(text).toContain('when the animal Leaps');
    // …and the clause that already shipped is still there.
    expect(text).toContain('High Jump and Long Jump');
  });
});

describe('disciplined-mind: the Will rule is stated once', () => {
  /* class-feature-1179: "When you roll a success on a Will save, you get a critical success instead."
   * The record's own degreeShifts already stars the Will row; the registry entry restated it, so the
   * breakdown carried the same rule twice under the same source name. */
  it("a thaumaturge's Will breakdown carries one Disciplined Mind line, not two", () => {
    const c = build('thaumaturge', 7);
    expect(characterSituationalIds(c, db), 'the feature is owned at 7th').toContain('disciplined-mind');
    const lines = (explainStat(c, db, { kind: 'save', save: 'will' }).situational ?? []).filter((s) => s.sourceId === 'disciplined-mind');
    expect(lines.length, 'exactly one line for the one printed sentence').toBe(1);
    expect(lines[0].text).toContain('a success is a critical success instead');
    // The surviving carrier must be the RECORD's own field, not a registry copy of it.
    expect(FEAT_SITUATIONAL['disciplined-mind']).toBeUndefined();
    expect(db.classFeatures['disciplined-mind'].degreeShifts?.[0].shift).toBe('successToCrit');
  });
});

describe('master-overdrive: the +2 damage step reaches a row', () => {
  /* class-feature-493: "on a successful Overdrive, you increase the additional damage by a total of
   * 2, replacing the increase from expert overdrive." No number lived anywhere on our side. */
  it("an inventor's Strike damage carries the Overdrive step, with print's two gates", () => {
    const s = stars(build('inventor', 7), { kind: 'strikeDamage' }, 'master-overdrive');
    expect(s.length).toBe(1);
    expect(s[0]).toContain('+2');
    expect(s[0]).toContain('successful Overdrive');
    expect(s[0], "print's replacement clause").toContain("replacing Expert Overdrive's +1");
    expect(s[0], 'the 15th-level cut-off').toContain('before 15th level');
    // Print says "on a successful Overdrive" and no more. The line must not carry the narrower gate a
    // first draft added — a critical Overdrive deals additional damage too (actions/overdrive), so
    // excluding it would be a ruling the printed text does not make.
    expect(s[0], 'no gate print does not state').not.toContain('not a critical success');
  });
});

describe('the action rows a feat rewrites say so', () => {
  /* feat-5200: "You Swim 5 feet farther on a success and 10 feet farther on a critical success, to a
   * maximum of your Speed." Only the legendary swim-Speed clause had a carrier. */
  it('Quick Swim marks the Swim action with the distance', () => {
    const marks = recordMarkersFor(withFeats(['quick-swim']), db, 'action', 'swim').filter((m) => m.sourceId === 'quick-swim');
    expect(marks.length).toBe(1);
    expect(marks[0].value).toContain('+5 feet');
    expect(marks[0].note).toContain('10 feet farther on a critical success');
    expect(marks[0].note).toContain('maximum of your Speed');
    // A character without the feat sees nothing on that row.
    expect(recordMarkersFor(build('fighter', 7), db, 'action', 'swim').some((m) => m.sourceId === 'quick-swim')).toBe(false);
  });

  /* feat-6459: "…can combine two maneuvers into a single action… The DC of the Acrobatics check is
   * equal to the DC of the most difficult maneuver + 5. If you're legendary in Acrobatics, you can
   * combine three… + 10." Only the +2 Acrobatics star shipped. */
  it('Aerobatics Mastery marks Maneuver in Flight with the combined-maneuver DCs', () => {
    const c = withFeats(['aerobatics-mastery']);
    const marks = recordMarkersFor(c, db, 'action', 'maneuver-in-flight').filter((m) => m.sourceId === 'aerobatics-mastery');
    expect(marks.length).toBe(1);
    expect(marks[0].note).toContain('most difficult maneuver + 5');
    expect(marks[0].note).toContain('+ 10');
    expect(marks[0].value).toContain('3 if legendary');
    // The action it marks has to exist, or the mark can never render.
    expect(db.actions['maneuver-in-flight']).toBeTruthy();
    // …and the +2 that already matched WG is untouched.
    expect(stars(c, { kind: 'skill', skill: 'acrobatics' }, 'aerobatics-mastery')).toEqual(['to Maneuver in Flight :: +2 circumstance']);
  });
});

describe('temperature-adjustment: the medicine sets the weather aside', () => {
  /* feat-7069: "If you created hot elemental medicine, the recipient ignores the effects of severe
   * cold while the medicine lasts. If you created cold elemental medicine, the recipient ignores the
   * effects of severe heat while the medicine lasts." Neither side modelled it. */
  it('both halves star the save row, the way the four environmental heritages do', () => {
    const s = stars(withFeats(['temperature-adjustment']), { kind: 'save', save: 'fortitude' }, 'temperature-adjustment');
    expect(s.length, 'one line per printed sentence').toBe(2);
    expect(s.join(' | ')).toContain('ignore the effects of severe cold');
    expect(s.join(' | ')).toContain('ignore the effects of severe heat');
    // Each is gated on the medicine that grants it — hot medicine for cold weather, and vice versa.
    expect(s.find((t) => t.includes('severe cold'))).toContain('hot elemental medicine');
    expect(s.find((t) => t.includes('severe heat'))).toContain('cold elemental medicine');
  });
});

describe('the generated lane cannot resurrect what was deleted', () => {
  it("apply-situational-lane.mjs names disciplined-mind, so a re-run cannot re-emit it", async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('scripts/apply-situational-lane.mjs', 'utf8');
    const set = src.slice(src.indexOf('const handEdited'), src.indexOf(']);', src.indexOf('const handEdited')));
    expect(set, 'the exclusion list, beside fluid-contortionist/combination-finisher precedent').toContain("'disciplined-mind'");
  });

  it('the two new marks are keyed to real actions, on the key the sheet looks them up by', () => {
    // MainTab.tsx:239 and StatDetailModal's `actionSlug` both key marks by the SLUGGED ACTION NAME,
    // not by the record's id — a row whose id and name disagree renders no mark at all.
    const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    for (const id of ['quick-swim', 'aerobatics-mastery']) {
      for (const m of RECORD_MARKERS[id]) {
        expect(m.on).toBe('action');
        const row = db.actions[m.id];
        expect(row, `${id} marks a real action row`).toBeTruthy();
        expect(slug(row.name), `${id}'s mark id is the key the sheet computes from the row's name`).toBe(m.id);
      }
    }
  });
});
