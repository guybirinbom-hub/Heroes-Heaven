import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { buildChoiceOptions, emptyBuild, type BuildState } from '../src/rules/build';
import { effectiveChoiceLimits, narrowChoiceOptions } from '../src/rules/derive';
import type { Character, FeatChoiceDef } from '../src/rules/types';

/**
 * Ruling Q9's FILTERING lane — *"the builder shows only what the player may legally pick"*.
 *
 * Four records promise a narrowed menu in their own text and shipped with the full one. The lane is
 * general (a record declares how a choice list narrows); these are the four that declare it today.
 *
 * The three rulings that meet here pull in different directions, so each is asserted separately:
 *   Q9  — an ILLEGAL option is removed.
 *   Q21 — removal is only for a grant wasted across the whole career, never "redundant right now".
 *   Q27 — an option that is legal but cannot be taken stays VISIBLE, greyed, and says why.
 */
const db = content();

/** The options a record's own choice offers this character, through the builder's own funnel. */
const optionsFor = (c: Character, recordId: string, def: FeatChoiceDef) =>
  narrowChoiceOptions(recordId, def, def.options ?? [], c, db);
const values = (o: { value: string }[]) => o.map((x) => x.value).sort();

describe('Manifold Modifications offers only its own innovation’s modifications', () => {
  const manifold = db.feats['manifold-modifications'];
  const def = manifold.choice!;

  const inventor = (subclassId: string, over: Partial<BuildState> = {}) =>
    build('inventor', 8, { subclassId, ...over });

  it('the record still asks the question this lane narrows', () => {
    expect(def.kind).toBe('array');
    // The count is the point: seventeen printed options, and no inventor may take more than eleven
    // of them. If a regeneration flattens the tags away this is the assertion that notices.
    expect(def.options!.length).toBeGreaterThan(11);
    expect(def.options!.every((o) => o.requiresAnyFeature?.length)).toBe(true);
  });

  it('an ARMOR inventor sees the seven armour modifications and no weapon one', () => {
    const opts = optionsFor(inventor('armor-innovation'), 'manifold-modifications', def);
    expect(values(opts)).toEqual(
      ['harmonic-oscillator', 'metallic-reactance', 'muscular-exoskeleton', 'otherworldly-protection', 'phlogistonic-regulator', 'speed-boosters', 'subtle-dampeners'].sort(),
    );
    expect(values(opts)).not.toContain('razor-prongs');
  });

  it('a WEAPON inventor sees the weapon modifications and no armour one', () => {
    const opts = optionsFor(inventor('weapon-innovation'), 'manifold-modifications', def);
    expect(opts.length).toBe(10);
    expect(values(opts)).toContain('razor-prongs');
    expect(values(opts)).not.toContain('harmonic-oscillator');
    // Advanced Design is the weapon innovation's own level-1 feature, not one of the modifications
    // you choose between — it must never appear as a pick.
    expect(values(opts)).not.toContain('advanced-design');
  });

  it('a CONSTRUCT inventor is not left with an empty picker', () => {
    const opts = optionsFor(inventor('construct-innovation'), 'manifold-modifications', def);
    expect(opts.length).toBeGreaterThan(0);
    expect(values(opts)).toContain('sensory-array');
    expect(values(opts)).not.toContain('harmonic-oscillator');
  });

  it('Q27: the initial modification you ALREADY took is greyed with a reason, not hidden', () => {
    const c = inventor('armor-innovation', { inventorModifications: { initial: 'speed-boosters' } });
    expect(c.inventor?.modifications.initial, 'the fixture must actually hold the modification').toBe('speed-boosters');
    const opts = optionsFor(c, 'manifold-modifications', def);
    const taken = opts.find((o) => o.value === 'speed-boosters');
    expect(taken, 'shown, per Q27 — hiding it reads as missing content').toBeDefined();
    expect(taken!.disabled).toMatch(/already taken/i);
    // …and only that one.
    expect(opts.filter((o) => o.disabled).length).toBe(1);
  });

  it('a character who is not an inventor at all gets nothing rather than everything', () => {
    // The failure this guards is the one the ruling names: an untagged list handed all 17 options to
    // anyone holding the feat, whichever innovation (or none) they had.
    expect(optionsFor(build('fighter', 8), 'manifold-modifications', def)).toEqual([]);
  });
});

describe('a background can NARROW a feat it grants (Q9)', () => {
  /** The build the builder holds, and the character it derives — a granted feat's picker reads both. */
  const withBackground = (backgroundId: string, over: Partial<BuildState> = {}) => {
    const bs: BuildState = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      classId: 'fighter',
      ancestryId: 'human',
      keyAbility: 'str',
      backgroundId,
      ...over,
    };
    return { bs, ch: build('fighter', 1, { backgroundId, ...over }) };
  };

  it('Toymaker cuts Specialty Crafting from twelve specialties to the six it names', () => {
    const def = db.feats['specialty-crafting'].choice!;
    expect(def.options!.length, 'the feat itself still offers all twelve to anyone who picks it').toBe(12);
    const { ch } = withBackground('toymaker');
    const opts = optionsFor(ch, 'specialty-crafting', def);
    expect(values(opts)).toEqual(['artistry', 'blacksmithing', 'glassmaking', 'leatherworking', 'tailoring', 'woodworking']);
    // The narrowing belongs to the background, not the feat: a different background leaves it whole.
    expect(optionsFor(withBackground('farmhand').ch, 'specialty-crafting', def).length).toBe(12);
  });

  it('Isgeri Reclaimer cuts Terrain Stalker to rubble or underbrush, and says why', () => {
    const def = db.feats['terrain-stalker'].choice!;
    const { ch } = withBackground('isgeri-reclaimer');
    expect(values(optionsFor(ch, 'terrain-stalker', def))).toEqual(['rubble', 'underbrush']);
    expect(values(optionsFor(ch, 'terrain-stalker', def))).not.toContain('snow');
    const reasons = effectiveChoiceLimits('terrain-stalker', def, ch, db).map((l) => l.reason);
    expect(reasons.length, 'a menu cut in half must say who cut it').toBe(1);
    expect(reasons[0]).toMatch(/rubble or underbrush/i);
  });

  it('the decoy duplicate question on Isgeri Reclaimer is gone', () => {
    // It asked the same rubble/underbrush question a second time, recorded the answer as "no number
    // of its own", and never reached Terrain Stalker.
    expect(db.backgrounds['isgeri-reclaimer'].choice).toBeUndefined();
  });

  it('Reputation Seeker ties the terrain to the Lore actually taken', () => {
    const def = db.feats['terrain-expertise'].choice!;
    const forLore = (lore: string) =>
      values(optionsFor(withBackground('reputation-seeker', { backgroundLore: lore }).ch, 'terrain-expertise', def));
    expect(forLore('jungle')).toEqual(['forest']);
    expect(forLore('desert')).toEqual(['desert']);
    expect(forLore('darklands')).toEqual(['underground']);
  });

  it('…which needs the Lore to be a real choice — it was hardcoded to Jungle', () => {
    const bg = db.backgrounds['reputation-seeker'];
    expect(bg.trainedLoreOptions).toEqual(['darklands', 'desert', 'jungle']);
    expect(bg.trainedLore, 'a fixed Lore made two of the three legal builds unreachable').toBeUndefined();
    const ch = withBackground('reputation-seeker', { backgroundLore: 'darklands' }).ch;
    expect(ch.proficiencies.skills['lore:darklands']).toBe('trained');
    expect(ch.proficiencies.skills['lore:jungle']).toBeUndefined();
  });

  it('a narrowed choice suppresses nothing for characters without the narrowing record', () => {
    const def = db.feats['terrain-expertise'].choice!;
    const plain = optionsFor(build('fighter', 1, { backgroundId: 'farmhand' }), 'terrain-expertise', def);
    expect(plain.length).toBe(def.options!.length);
  });
});

describe('the funnel leaves an undeclared choice untouched', () => {
  it('buildChoiceOptions returns the printed list when no record narrows it', () => {
    const bs: BuildState = { ...emptyBuild(), name: 't', level: 1, classId: 'fighter', ancestryId: 'human', keyAbility: 'str', backgroundId: 'farmhand' };
    const def = db.feats['terrain-stalker'].choice!;
    const ch = build('fighter', 1, { backgroundId: 'farmhand' });
    expect(buildChoiceOptions('terrain-stalker', def, bs, db, ch).length).toBe(def.options!.length);
  });
});
