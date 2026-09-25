/*
 * bug 2026-09-25: Wanderer's Guide import — a dual-gate kineticist's impulses in each other's gate slots.
 *
 * The rebuild from a character (`deriveBuildFromCharacter`, which the WG import runs) put any impulse in
 * the first free gate slot, while the Builder's picker binds a dual gate's first slot to the first element
 * and its second to the other. Listed water-first, a fire + water kineticist came back with the water
 * impulse in the fire slot and the fire impulse in the water slot, both flagged "Not valid for this slot".
 * The picker and the rebuild now ask ONE function, `kineticSlotAllows` (build.ts); every check below asks
 * the picker's own test, `fitsSlot`.
 *
 * Synthetic characters only.
 */
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, type BuildState } from '../src/rules/build';
import { fitsSlot } from '../src/rules/featSlots';
import { importCharacter, WG_VERSION } from '../src/data/transfer';
import type { Character } from '../src/rules/types';

const C = content();
// 1st-level impulses, one element each.
const FIRE = 'burning-jet';
const FIRE2 = 'flying-flame';
const WATER = 'winters-clutch';
const AIR = 'aerial-boomerang';
// A 4th-level fire impulse, for a class slot above 1st.
const FIRE4 = 'blazing-wave';
const DUAL: Partial<BuildState> = { extraChoices: { element: ['fire-gate', 'water-gate'] }, featChoices: { 'feature:kinetic-gate': 'dual' } };
const SINGLE: Partial<BuildState> = { extraChoices: { element: ['fire-gate'] }, featChoices: { 'feature:kinetic-gate': 'single' } };

/** A kineticist carrying its gate, as every character the app builds does, with its feats handed over
 *  the way a lossy source hands them: no slot, the feat's own category, in the order given. */
const lossy = (level: number, gate: Partial<BuildState>, ids: string[]): Character => ({
  ...build('kineticist', level, gate),
  feats: ids.map((featId) => ({ featId, level: C.feats[featId].level, category: C.feats[featId].category })),
});
/** Every pick the rebuild made, asked of the slot's own picker. */
const fits = (b: BuildState) => Object.fromEntries(Object.keys(b.featPicks).map((k) => [k, fitsSlot(b, C, k, k)]));
const chips = (b: BuildState) => (b.overrides?.addedFeats ?? []).map((a) => a.featId);

describe('the rebuild slots each impulse where the picker takes it', () => {
  it('the fixture: both impulses are the elements they are meant to be, and the gate slots are 1:impulse:2 and :3', () => {
    for (const [id, el] of [[FIRE, 'fire'], [FIRE2, 'fire'], [WATER, 'water'], [AIR, 'air'], [FIRE4, 'fire']] as const) {
      expect(C.feats[id]?.traits, id).toContain('impulse');
      expect(C.feats[id]?.traits, id).toContain(el);
    }
    const b = deriveBuildFromCharacter(lossy(1, DUAL, []), C);
    expect(fitsSlot({ ...b, featPicks: { '1:impulse:2': FIRE } }, C, '1:impulse:2', '1:impulse:2')).toBe(true);
    expect(fitsSlot({ ...b, featPicks: { '1:impulse:3': WATER } }, C, '1:impulse:3', '1:impulse:3')).toBe(true);
  });

  it('dual gate, the water impulse listed first: each lands in the gate slot of its own element', () => {
    const b = deriveBuildFromCharacter(lossy(1, DUAL, [WATER, FIRE]), C);
    expect(b.featPicks).toEqual({ '1:impulse:2': FIRE, '1:impulse:3': WATER });
    expect(fits(b)).toEqual({ '1:impulse:2': true, '1:impulse:3': true });
    expect(chips(b)).toEqual([]);
  });

  it('a round trip keeps every impulse where it was, whatever order the rows come in', () => {
    // Rows the app emits carry category 'impulse' for a gate slot, which matched every gate slot outright.
    const ch = build('kineticist', 1, { ...DUAL, featPicks: { '1:class:1': FIRE2, '1:impulse:2': FIRE, '1:impulse:3': WATER } });
    const b = deriveBuildFromCharacter({ ...ch, feats: [...ch.feats].reverse() }, C);
    expect(b.featPicks).toEqual({ '1:class:1': FIRE2, '1:impulse:2': FIRE, '1:impulse:3': WATER });
    expect(Object.values(fits(b))).toEqual([true, true, true]);
  });

  it('three impulses, water first: a gate slot is filled before the class slot, so none is left over', () => {
    const b = deriveBuildFromCharacter(lossy(1, DUAL, [WATER, FIRE, FIRE2]), C);
    expect(b.featPicks).toEqual({ '1:class:1': FIRE2, '1:impulse:2': FIRE, '1:impulse:3': WATER });
    expect(Object.values(fits(b))).toEqual([true, true, true]);
    expect(chips(b)).toEqual([]);
  });

  it('a single gate’s two slots both take its one element', () => {
    const b = deriveBuildFromCharacter(lossy(1, SINGLE, [FIRE2, FIRE]), C);
    expect(b.featPicks).toEqual({ '1:impulse:2': FIRE2, '1:impulse:3': FIRE });
    expect(fits(b)).toEqual({ '1:impulse:2': true, '1:impulse:3': true });
  });

  it('an impulse of an element the gate lacks takes no slot: a visible chip, still on the sheet', () => {
    const b = deriveBuildFromCharacter(lossy(1, DUAL, [AIR, WATER, FIRE]), C);
    expect(b.featPicks).toEqual({ '1:impulse:2': FIRE, '1:impulse:3': WATER });
    expect(chips(b)).toEqual([AIR]);
    expect(buildCharacter(b, C).feats.map((f) => f.featId)).toEqual(expect.arrayContaining([AIR, FIRE, WATER]));
  });

  it('5th level: the gate impulses still bind by element, and the others take the class slots', () => {
    const b = deriveBuildFromCharacter(lossy(5, DUAL, [FIRE4, WATER, FIRE2, FIRE]), C);
    // Level-1 rows in list order: water takes its slot, the first fire impulse the fire slot, the second the class slot.
    expect(b.featPicks).toEqual({ '1:class:1': FIRE, '1:impulse:2': FIRE2, '1:impulse:3': WATER, '4:class:0': FIRE4 });
    expect(Object.values(fits(b))).toEqual([true, true, true, true]);
    expect(chips(b)).toEqual([]);
  });
});

/** A minimal Wanderer's Guide v4 export (the shape test/wg-import-builder-slots.test.ts uses): the gate
 *  elements as class features, the impulses as class feats, in the order given. */
const wgKineticist = (elements: string[], impulses: string[]): string =>
  JSON.stringify({
    version: WG_VERSION,
    character: {
      name: 'WG Import',
      level: 1,
      details: { class: { name: 'Kineticist' }, ancestry: { name: 'Human' }, background: { name: 'Hermean Heritor' } },
    },
    content: {
      class: 'Kineticist',
      ancestry: 'Human',
      background: 'Hermean Heritor',
      feats_features: {
        classFeatures: elements.map((name) => ({ name })),
        classFeats: impulses.map((id) => ({ name: C.feats[id].name, level: 1 })),
      },
    },
  });
const imported = (elements: string[], impulses: string[]): BuildState => importCharacter(wgKineticist(elements, impulses), C).saved.build!;

describe("a Wanderer's Guide v4 export, end to end", () => {
  it('the gate comes through', () => {
    expect(imported(['Fire Gate', 'Water Gate'], []).extraChoices.element).toEqual(['fire-gate', 'water-gate']);
  });

  it('a single gate: both impulses in its slots, both taken there', () => {
    const b = imported(['Fire Gate'], [FIRE2, FIRE]);
    expect(b.featPicks).toEqual({ '1:impulse:2': FIRE2, '1:impulse:3': FIRE });
    expect(fits(b)).toEqual({ '1:impulse:2': true, '1:impulse:3': true });
  });

  /*
   * These two need the import to hand the rebuild the gate: `importFromWg` used to layer the matched
   * elements on only AFTER `deriveBuildFromCharacter` had slotted the feats, so the rebuild saw no
   * elements and `impulseAllowedFor` admitted every impulse everywhere. `baseBuild` now carries them.
   */
  it('dual gate, the water impulse listed first: each in the gate slot of its element', () => {
    const b = imported(['Fire Gate', 'Water Gate'], [WATER, FIRE]);
    expect(b.featPicks).toEqual({ '1:impulse:2': FIRE, '1:impulse:3': WATER });
    expect(fits(b)).toEqual({ '1:impulse:2': true, '1:impulse:3': true });
  });

  it('an impulse of an element the gate lacks: a visible chip, not a slot pick, nothing lost', () => {
    const b = imported(['Fire Gate', 'Water Gate'], [AIR, WATER, FIRE]);
    expect(Object.values(b.featPicks)).not.toContain(AIR);
    expect(chips(b)).toEqual([AIR]);
    expect(buildCharacter(b, C).feats.map((f) => f.featId)).toEqual(expect.arrayContaining([AIR, FIRE, WATER]));
  });
});

/*
 * Gate's Threshold (5/9/13/17): the rebuild never recovered `gateExpands` / `gateForks` /
 * `gateForkImpulses`, so a rebuilt kineticist lost the forked element and the bonus impulse took a
 * class slot or became a chip. Rebuild only: the WG v4 shape the import reads is names plus a feat's
 * minimum level, and matches elements in the option list's order, so it cannot say which element was
 * forked, at which threshold, or which impulse was the threshold's.
 */
describe("Gate's Threshold picks survive the rebuild", () => {
  // A 1st-level water impulse (the threshold's feat) and a 6th-level one (for a class slot).
  const WATER1 = 'oceans-balm';
  const WATER6 = 'driving-rain';

  it('Expand the Portal: the bonus impulse comes back as the pick, in no class slot and no chip', () => {
    const picks = { '1:class:1': FIRE2, '1:impulse:2': FIRE, '1:impulse:3': WATER, '4:class:0': FIRE4 };
    const ch = build('kineticist', 5, { ...DUAL, featPicks: picks, gateExpands: { '5': WATER1 } });
    expect(ch.feats.map((f) => f.featId)).toContain(WATER1);
    const b = deriveBuildFromCharacter(ch, C);
    expect(b.gateExpands).toEqual({ '5': WATER1 });
    expect(b.featPicks).toEqual(picks);
    expect(Object.values(fits(b))).toEqual([true, true, true, true]);
    expect(chips(b)).toEqual([]);
    expect(buildCharacter(b, C).feats.map((f) => f.featId)).toContain(WATER1);
  });

  it('Fork the Path: the element and its impulse come back, and an impulse of that element keeps its class slot', () => {
    const picks = { '1:impulse:2': FIRE, '1:impulse:3': FIRE2, '6:class:0': WATER6 };
    const ch = build('kineticist', 6, { ...SINGLE, featPicks: picks, gateForks: { '5': 'water-gate' }, gateForkImpulses: { '5': WATER1 } });
    const b = deriveBuildFromCharacter(ch, C);
    expect(b.extraChoices.element).toEqual(['fire-gate']);
    expect(b.gateForks).toEqual({ '5': 'water-gate' });
    expect(b.gateForkImpulses).toEqual({ '5': WATER1 });
    expect(b.gateExpands).toEqual({});
    expect(b.featPicks).toEqual(picks);
    expect(Object.values(fits(b))).toEqual([true, true, true]);
    expect(chips(b)).toEqual([]);
    expect(buildCharacter(b, C).feats.map((f) => f.featId)).toEqual(expect.arrayContaining([WATER1, WATER6]));
  });
});

/*
 * Side effect of `baseBuild` carrying `extraChoices`: the rebuild now sees every matched per-class pick,
 * so it subtracts the trainings those picks GRANT the way it does for the app's own characters, and a
 * granted skill no longer also eats a free skill pick.
 */
describe('matched per-class picks do not double-spend their grants on import', () => {
  /** The same v4 shape for any class, plus the skills the export lists as trained (`parts.profValue` 2). */
  const wgExport = (cls: string, level: number, classFeatures: string[], trained: string[]): string =>
    JSON.stringify({
      version: WG_VERSION,
      character: { name: 'WG Import', level, details: { class: { name: cls }, ancestry: { name: 'Human' }, background: { name: 'Hermean Heritor' } } },
      content: {
        class: cls,
        ancestry: 'Human',
        background: 'Hermean Heritor',
        feats_features: { classFeatures: classFeatures.map((name) => ({ name })) },
        proficiencies: Object.fromEntries(trained.map((k) => [`SKILL_${k}`, { parts: { profValue: 2 } }])),
      },
    });
  const importedAs = (...a: Parameters<typeof wgExport>): BuildState => importCharacter(wgExport(...a), C).saved.build!;

  /*
   * Not a kineticist: no gate option grants a skill. A gate's Skill Junction is an effect-choice answer
   * (`fire-gate:fire-gate-junction`), which the WG v4 shape has no field for, so the import never trains it.
   *
   * Fails on the old transfer.ts: the rebuild ran with no epithet, found Athletics trained by nothing it
   * knew of and kept it as a class-skill pick; the epithet layered on afterwards granted it a second time.
   */
  it('an exemplar’s root epithet: the Athletics it grants is not also a free skill pick', () => {
    const b = importedAs('Exemplar', 3, ['The Brave'], ['ATHLETICS', 'RELIGION', 'SOCIETY']);
    expect(b.extraChoices['root-epithet']).toEqual(['the-brave']);
    expect(b.classSkills).toEqual([]);
    expect(Object.values(b.skillIncreases)).not.toContain('athletics');
    expect(buildCharacter(b, C).proficiencies.skills.athletics).toBe('trained');
  });

  /*
   * Fails on the old transfer.ts the same way: the rebuild saw no apparition, so both of its Lores came
   * back as class-skill picks on top of the apparition's own grant. Its spells are not pinned: an
   * export's spell lists replace the rebuild's outright, so they never pass through the subtraction.
   */
  it('an animist’s apparition: the two Lores it grants are not also free skill picks', () => {
    const b = importedAs('Animist', 1, ['Crafter in the Vault'], ['RELIGION', 'SOCIETY', 'LORE___LEGAL', 'LORE___ARCHITECTURE', 'LORE___ENGINEERING']);
    expect(b.extraChoices.apparition).toEqual(['crafter-in-the-vault']);
    expect(b.classSkills).toEqual([]);
    const sk = buildCharacter(b, C).proficiencies.skills as Record<string, string>;
    expect([sk['lore:architecture'], sk['lore:engineering']]).toEqual(['trained', 'trained']);
  });
});
