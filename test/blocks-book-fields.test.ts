import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState } from '../src/rules/play';
import { deriveMaxHp, deriveSave, deriveSkill, deriveSpeeds, maxHpTerms, ownedFeatureIds, saveTerms, skillTerms, stateGrantSummary } from '../src/rules/derive';
import { explainStat } from '../src/rules/explain';
import { backgroundTrainings, bookBlocksOf, growingValue, standingNumberBlocks } from '../src/rules/blocks/book';
import type { Character, ClassId, ContentDatabase, InventoryItem, Item } from '../src/rules/types';

/**
 * Building blocks item 10 (docs/overrides-redesign.md): the READERS of the book fields moved onto book
 * blocks (src/rules/blocks/book.ts) — saveBonuses, landSpeedBonus/speedBonusType/speedBonusAllSpeeds
 * (the whileActive copies included), maxHpBonus, passiveEffects.skills (and the answered-choice copy),
 * and a background's trainedSkill/trainedLore.
 *
 * One named record per field: the number WITH the record differs from the number WITHOUT it, and both
 * equal the values the app gave BEFORE the move (measured 2026-10-20 on the old readers, hard-coded
 * here). Where a breakdown exists, its line carries the block's fixed key (item 2, checker C15).
 */

const db = content();

function hero(classId: string, level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId as ClassId];
  return {
    ...emptyBuild(),
    name: 't',
    level,
    classId: classId as ClassId,
    keyAbility: cls.keyAbility.length === 1 ? cls.keyAbility[0] : 'str',
    ancestryId: 'human',
    backgroundId: null,
    subclassId: cls.subclass?.options[0]?.id ?? null,
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    ...more,
  } as BuildState;
}
const build = (b: BuildState, d: ContentDatabase = db) => buildCharacter(b, d);
const parts = (c: Character, ref: Parameters<typeof explainStat>[2]) =>
  (explainStat(c, db, ref).parts ?? []).map((p) => `${p.label}|${p.note ?? ''}|${p.value}`);

describe('item 10: the book fields read as book blocks (blocks/book.ts)', () => {
  it('feats/peerless-form (saveBonuses): Fortitude and Will 21 with, 19 without; the line keeps its block key', () => {
    const w = build(hero('monk', 14, { featPicks: { '14:class:0': 'peerless-form' } }));
    const wo = build(hero('monk', 14));
    expect([deriveSave(w, 'fortitude', db).modifier, deriveSave(w, 'will', db).modifier, deriveSave(w, 'reflex', db).modifier]).toEqual([21, 21, 19]);
    expect([deriveSave(wo, 'fortitude', db).modifier, deriveSave(wo, 'will', db).modifier, deriveSave(wo, 'reflex', db).modifier]).toEqual([19, 19, 19]);
    expect(parts(w, { kind: 'save', save: 'fortitude' })).toEqual(['Proficiency — Expert|level 14 + 4|18', 'Constitution modifier|Constitution 12|1', 'Peerless Form|status bonus|2']);
    const term = saveTerms(w, 'fortitude', db).find((t) => t.key === 'feats/peerless-form#saveBonuses@save:fortitude');
    expect(term).toMatchObject({ layer: 'book', type: 'status', value: 2, source: { kind: 'book', id: 'feats/peerless-form', name: 'Peerless Form' } });
  });

  it('heritages/ponygait-centaur (saveBonuses): Reflex 11 with, 10 without', () => {
    const w = build(hero('fighter', 5, { ancestryId: 'centaur', heritageId: 'ponygait-centaur' }));
    const wo = build(hero('fighter', 5, { ancestryId: 'centaur', heritageId: null }));
    expect(deriveSave(w, 'reflex', db).modifier).toBe(11);
    expect(deriveSave(wo, 'reflex', db).modifier).toBe(10);
    expect(parts(w, { kind: 'save', save: 'reflex' })).toContain('Ponygait Centaur|circumstance bonus|1');
    expect(saveTerms(w, 'reflex', db).some((t) => t.key === 'heritages/ponygait-centaur#saveBonuses@save:reflex' && t.type === 'circumstance')).toBe(true);
  });

  it('feats/fleet (landSpeedBonus, untyped): land Speed 30 with, 25 without', () => {
    const w = build(hero('fighter', 1, { featPicks: { '1:general:0': 'fleet' } }));
    const wo = build(hero('fighter', 1));
    expect(w.feats.map((f) => f.featId)).toContain('fleet');
    expect(deriveSpeeds(w, db).land).toBe(30);
    expect(deriveSpeeds(wo, db).land).toBe(25);
    const [b] = bookBlocksOf(db.feats.fleet, 'feats');
    expect(b).toMatchObject({ kind: 'number.add', key: 'feats/fleet#landSpeedBonus@speed:land', target: 'speed:land', value: 5 });
    expect(b.bonusType).toBeUndefined();
  });

  it("feats/scouts-speed (landSpeedBonus + speedBonusType): land Speed 35 with, 25 without", () => {
    const w = build(hero('fighter', 6, { featPicks: { '2:class:0': 'scout-dedication', '6:class:0': 'scouts-speed' } }));
    const wo = build(hero('fighter', 6, { featPicks: { '2:class:0': 'scout-dedication' } }));
    expect(deriveSpeeds(w, db).land).toBe(35);
    expect(deriveSpeeds(wo, db).land).toBe(25);
    expect(parts(w, { kind: 'speed' })).toEqual(['Ancestry Speed|Human|25', "Speed increase|Scout's Speed|10"]);
    expect(bookBlocksOf(db.feats['scouts-speed'], 'feats')[0]).toMatchObject({ key: 'feats/scouts-speed#landSpeedBonus@speed:land', bonusType: 'status', value: 10 });
  });

  it('items/cloak-of-the-bat (passiveEffects.skills): Stealth +3 worn, +1 without; the line keeps its block key', () => {
    const w = build(hero('fighter', 10, { inventory: [{ itemId: 'cloak-of-the-bat', quantity: 1, worn: true, invested: true }] as BuildState['inventory'] }));
    const wo = build(hero('fighter', 10));
    expect(deriveSkill(w, 'stealth', db).modifier).toBe(3);
    expect(deriveSkill(wo, 'stealth', db).modifier).toBe(1);
    expect(parts(w, { kind: 'skill', skill: 'stealth' })).toContain('Cloak of the Bat|item bonus|2');
    const term = skillTerms(w, 'stealth', db).find((t) => t.key === 'items/cloak-of-the-bat#passiveEffects.skills@skill:stealth');
    expect(term).toMatchObject({ layer: 'book', type: 'item', value: 2 });
  });

  it('feats/golem-grafter-dedication (maxHpBonus, per level): max HP 104 with, 96 without, and the build starts at full', () => {
    const w = build(hero('fighter', 8, { featPicks: { '8:class:0': 'golem-grafter-dedication' } }));
    const wo = build(hero('fighter', 8));
    expect([deriveMaxHp(w, db), w.hitPoints.current]).toEqual([104, 104]);
    expect([deriveMaxHp(wo, db), wo.hitPoints.current]).toEqual([96, 96]);
    expect(maxHpTerms(w, db).some((t) => t.key === 'feats/golem-grafter-dedication#maxHpBonus@max-hp' && t.value === 8)).toBe(true);
  });

  it('feats/unbreakable-er-goblin (maxHpBonus, flat): max HP 163 with, 153 without, and the build starts at full', () => {
    const b = { ancestryId: 'goblin', heritageId: 'unbreakable-goblin' } as Partial<BuildState>;
    const w = build(hero('fighter', 13, { ...b, featPicks: { '13:ancestry:0': 'unbreakable-er-goblin' } }));
    const wo = build(hero('fighter', 13, b));
    expect([deriveMaxHp(w, db), w.hitPoints.current]).toEqual([163, 163]);
    expect([deriveMaxHp(wo, db), wo.hitPoints.current]).toEqual([153, 153]);
  });

  it('backgrounds/missionary (trainedSkill + trainedLore): Diplomacy and Scribing Lore trained with, absent without', () => {
    const w = build(hero('fighter', 1, { backgroundId: 'missionary' }));
    const wo = build(hero('fighter', 1));
    expect([deriveSkill(w, 'diplomacy', db).modifier, w.proficiencies.skills.diplomacy, w.proficiencies.skills['lore:scribing']]).toEqual([3, 'trained', 'trained']);
    expect([deriveSkill(wo, 'diplomacy', db).modifier, wo.proficiencies.skills.diplomacy ?? 'untrained', wo.proficiencies.skills['lore:scribing'] ?? 'absent']).toEqual([0, 'untrained', 'absent']);
    expect(backgroundTrainings(db.backgrounds.missionary)).toEqual({ skill: 'diplomacy', lores: [{ subject: 'scribing', key: 'lore:scribing' }] });
    expect(bookBlocksOf(db.backgrounds.missionary, 'backgrounds').map((b) => `${b.kind} ${b.key} ${b.rank}`)).toEqual([
      'rank.atLeast backgrounds/missionary#trainedSkill@skill:diplomacy trained',
      'rank.atLeast backgrounds/missionary#trainedLore@skill:lore:scribing trained',
    ]);
  });

  it('whileActive copies (panache): gated blocks; a db COPY with the fields stripped is read as it is (the parity twins)', () => {
    const c = build(hero('swashbuckler', 11));
    const panache = (x: Character): Character => ({ ...x, classResources: { ...(x.classResources ?? {}), panache: 1 } });
    const owned = [...ownedFeatureIds(c, db)].filter((id) => bookBlocksOf(db.classFeatures[id], 'classFeatures').some((b) => b.target === 'speed:land'));
    expect(owned).toEqual(['vivacious-speed', 'stylish-combatant']);
    const viv = bookBlocksOf(db.classFeatures['vivacious-speed'], 'classFeatures');
    expect(viv.map((b) => [b.key, b.gate?.whileState ?? null, (b.params as { allSpeeds?: boolean }).allSpeeds ?? false])).toEqual([
      ['classFeatures/vivacious-speed#landSpeedBonus@speed:land', null, false],
      ['classFeatures/vivacious-speed#whileActive.landSpeedBonus@speed:land', 'panache', true],
    ]);
    expect([deriveSpeeds(c, db).land, deriveSpeeds(panache(c), db).land]).toEqual([35, 45]);
    const strip = <T extends object>(r: T) => {
      const { landSpeedBonus, speedBonusType, speedBonusAllSpeeds, whileActive, ...rest } = r as Record<string, unknown>;
      void [landSpeedBonus, speedBonusType, speedBonusAllSpeeds, whileActive];
      return rest as T;
    };
    const dbs = { ...db, classFeatures: { ...db.classFeatures, ...Object.fromEntries(owned.map((id) => [id, strip(db.classFeatures[id])])) } } as ContentDatabase;
    expect([deriveSpeeds(c, dbs).land, deriveSpeeds(panache(c), dbs).land]).toEqual([25, 25]);
    expect(stateGrantSummary(c, db, 'panache')).toEqual([
      { from: 'Vivacious Speed', senses: [], other: ['status bonus to all Speeds'] },
      { from: 'Stylish Combatant', senses: [], other: ['+5 ft status bonus to all Speeds'] },
    ]);
  });

  it('growingValue resolves the max-HP shape the same way the build and derive do', () => {
    const [b] = standingNumberBlocks(bookBlocksOf(db.feats['golem-grafter-dedication'], 'feats'), 'max-hp');
    expect(growingValue(b.value, { level: 8, archetypeFeats: () => 0 })).toBe(8);
    expect(growingValue({ perArchetypeFeat: 3, archetype: 'x' }, { level: 5, archetypeFeats: (a) => (a === 'x' ? 2 : 0) })).toBe(6);
    expect(growingValue({ formula: '5' }, { level: 5, archetypeFeats: () => 0 })).toBe(0);
  });
});

describe('item 10: book blocks are cached per record OBJECT (a WeakMap, never by id)', () => {
  it('the same object gives the same list; a copied record object gets its own blocks', () => {
    const fleet = db.feats.fleet;
    expect(bookBlocksOf(fleet, 'feats')).toBe(bookBlocksOf(fleet, 'feats'));
    const copy = { ...fleet };
    expect(bookBlocksOf(copy, 'feats')).not.toBe(bookBlocksOf(fleet, 'feats'));
    expect(bookBlocksOf(copy, 'feats')).toEqual(bookBlocksOf(fleet, 'feats'));
    const faster = { ...fleet, landSpeedBonus: 15 };
    expect(bookBlocksOf(faster, 'feats')[0].value).toBe(15);
    expect(bookBlocksOf(fleet, 'feats')[0].value).toBe(5);
  });

  it('a record patched IN PLACE is read again (a test that sets a field on a live record)', () => {
    const rec: Record<string, unknown> = { id: 'patched', name: 'Patched', landSpeedBonus: 5 };
    expect(bookBlocksOf(rec, 'feats')[0].value).toBe(5);
    rec.landSpeedBonus = 10;
    expect(bookBlocksOf(rec, 'feats')[0].value).toBe(10);
    rec.passiveEffects = { skills: { stealth: 1 } };
    expect(bookBlocksOf(rec, 'feats').map((b) => b.key)).toEqual(['feats/patched#landSpeedBonus@speed:land', 'feats/patched#passiveEffects.skills@skill:stealth']);
  });

  it('a repeat of one key on a record gets ~2 (checker C15), and an absent record has none', () => {
    const rec = { id: 'twice', name: 'Twice', saveBonuses: [{ save: 'will', value: 1, type: 'status' }, { save: 'will', value: 2, type: 'circumstance' }] };
    expect(bookBlocksOf(rec, 'feats').map((b) => b.key)).toEqual(['feats/twice#saveBonuses@save:will', 'feats/twice#saveBonuses@save:will~2']);
    expect(bookBlocksOf(undefined, 'feats')).toEqual([]);
  });
});

/*
 * The fixer's additions (2026-10-20): moved readers that no test or parity number pinned. A checker
 * dropped each one in a temp copy and every related test stayed green; each case below fails on that
 * reader alone.
 */
describe('item 10: every moved reader has a case that fails without it', () => {
  const play = (inventory: InventoryItem[]) =>
    ({ damage: 0, tempHp: 0, heroPoints: 0, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [], inventory }) as never;

  it("an item's ANSWERED choice (effectChoices[].options[].grant.passive.skills): +2 Diplomacy answered, none unanswered; the line keeps its block key", () => {
    const ITEM = {
      id: 'test-choice-item',
      name: 'Choice Item',
      itemType: 'equipment',
      level: 1,
      traits: [],
      rarity: 'common',
      description: '',
      effectChoices: [{ id: 'flavour', prompt: 'Pick', options: [{ value: 'dip', label: 'Diplomacy', grant: { passive: { skills: { diplomacy: 2 } } } }] }],
    } as Item;
    const dbi: ContentDatabase = { ...db, items: { ...db.items, [ITEM.id]: ITEM } };
    const ch = build(hero('fighter', 5), dbi);
    const answered: InventoryItem = { instanceId: 'i1', itemId: ITEM.id, quantity: 1, worn: true, invested: true, effectChoices: { flavour: 'dip' } };
    const w = applyPlayState(ch, play([answered]), dbi);
    const wo = applyPlayState(ch, play([{ ...answered, effectChoices: undefined }]), dbi);
    expect(deriveSkill(w, 'diplomacy', dbi).modifier - deriveSkill(wo, 'diplomacy', dbi).modifier).toBe(2);
    expect(skillTerms(w, 'diplomacy', dbi).find((t) => t.key === 'items/test-choice-item#effectChoices.grant.passive.skills@skill:diplomacy')).toMatchObject({ layer: 'book', type: 'item', value: 2 });
  });

  it("a BODY rune's passiveEffects.skills (runes/trudds-strength): +1 Athletics with the rune, none without; the line keeps its block key", () => {
    const c = build(hero('fighter', 5));
    const w = { ...c, bodyRune: 'trudds-strength' } as Character;
    expect(deriveSkill(w, 'athletics', db).modifier - deriveSkill(c, 'athletics', db).modifier).toBe(1);
    expect(skillTerms(w, 'athletics', db).find((t) => t.key === 'runes/trudds-strength#passiveEffects.skills@skill:athletics')).toMatchObject({ type: 'item', value: 1 });
  });

  it("Free Heart's passion background (backgrounds/missionary): its skill AND its Lore are trained; without the feat, neither", () => {
    const w = build(hero('fighter', 4, { featPicks: { '2:skill': 'free-heart' }, featChoices: { '2:skill': 'missionary' } } as Partial<BuildState>));
    const wo = build(hero('fighter', 4));
    expect([w.proficiencies.skills.diplomacy, w.proficiencies.skills['lore:scribing']]).toEqual(['trained', 'trained']);
    expect([wo.proficiencies.skills.diplomacy ?? 'untrained', wo.proficiencies.skills['lore:scribing'] ?? 'absent']).toEqual(['untrained', 'absent']);
  });

  it("a round trip through deriveBuildFromCharacter keeps the background's printed Lore a GRANT, never a class-skill pick", () => {
    const b = hero('fighter', 1, { backgroundId: 'missionary', classSkills: ['athletics', 'medicine', 'survival'] } as Partial<BuildState>);
    const c = build(b);
    const back = deriveBuildFromCharacter(c, db);
    expect(back.classSkills).not.toContain('lore:scribing');
    expect(back.classSkills).not.toContain('diplomacy');
    expect(build(back).proficiencies.skills).toEqual(c.proficiencies.skills);
  });

  it("the skill timeline names the background that trained the skill ('from the Missionary background')", () => {
    const c = build(hero('fighter', 1, { backgroundId: 'missionary' }));
    expect(explainStat(c, db, { kind: 'skill', skill: 'diplomacy' }).timeline?.[0]).toMatchObject({ level: 1, text: 'Trained', detail: 'from the Missionary background' });
  });

  it('two worn rows of ONE item give two max-HP lines with different keys (~2, checker C15)', () => {
    const belt = { itemId: 'belt-of-good-health', quantity: 1, worn: true, invested: true };
    const c = build(hero('fighter', 5, { inventory: [{ ...belt, instanceId: 'a' }, { ...belt, instanceId: 'b' }] as BuildState['inventory'] }));
    expect(maxHpTerms(c, db).filter((t) => t.source?.id === 'items/belt-of-good-health').map((t) => t.key)).toEqual([
      'items/belt-of-good-health#maxHpBonus@max-hp',
      'items/belt-of-good-health#maxHpBonus@max-hp~2',
    ]);
  });
});
