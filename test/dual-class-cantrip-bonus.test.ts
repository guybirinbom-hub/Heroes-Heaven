import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, cantripBonusFor, classArchetypeSpellMods, classCantripBonus, classPaysCantripSwap, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay, preparedCantripKey } from '../src/rules/play';
import { cantripsOverOf } from '../src/rules/spellOptions';
import { cantripsKnown } from '../src/rules/spellcasting';
import type { Character, SpellcastingEntry } from '../src/rules/types';

/**
 * DUAL CLASS: A CANTRIP BONUS FEEDS ITS OWN CLASS'S POOL (2026-10-15).
 *
 * Gamemastery Guide, Dual-Class Characters (rules-1330): a dual-class caster gets *"full access to all
 * the spells of any spellcasting classes they have"* and *"keep[s] these spells entirely separate"*.
 * The build summed every untargeted cantrip bonus into EVERY class pool, so one feat raised both.
 * Measured before the fix (builder `classCantripBonus` and sheet `cantripCap` agreed on the wrong number):
 *
 *  · Cantrip Expansion (Player Core, feat-4580): *"Prepared Caster (Cleric, Wizard, etc.): You can
 *    prepare two additional cantrips each day. Spontaneous Caster (Bard, Sorcerer, etc.): Add two
 *    additional cantrips from your spell list to your repertoire."* A Wizard/Druid had wizard 8 AND druid 7 — four cantrips from one
 *    sentence that prints two, and the druid cannot take the feat at all. Sorcerer/Summoner: 7 and 7.
 *    Wanderer's Guide keeps one copy of the feat per class, each feeding only its own class
 *    (`giveSpellSlot`, castingSource = that class). Print and WG agree: the class that took it.
 *  · Flexible Spellcaster Dedication (archetype-99): its cantrip ladder (*"four cantrips per day instead
 *    of three"*) and its *"reduce the number of cantrips you gain from your class by 2"* compose to ONE
 *    class's column. A Wizard/Sorcerer whose wizard took it had the sorcerer's five raised to seven by a
 *    ladder whose -2 the sorcerer never paid (owner ruling 2026-10-15: a class archetype's effect is its
 *    own class's).
 *
 * NOT settled, pinned as they were (owner question #172): a prepared + spontaneous pair taking Cantrip
 * Expansion (the measured Wizard/Sorcerer — print's two sentences each fit one class, WG feeds one) and
 * two same-kind classes that both list the feat (Wizard/Cleric — which pool). A ruling there changes the
 * "#172" pins below on purpose.
 *
 * Old saves: a pool the fix made smaller never hides a stored pick. A no-book class draws every pick the
 * old cap allowed and reports the rest over the cap (`cantripCapWas`, `cantripsOverOf`, counted from
 * what is DRAWN), in the play overlay too — including a cantrip the player prepared ON THE SHEET into an
 * opening past the new cap; a gift-inside class (the sorcerer) reports through its own count; a book
 * class keeps the picks in its book.
 *
 * MUTATION-PROVED: the old shape (`cantripBonusFor` with no class — every bonus in every pool) reads the
 * old numbers, and a planted druid trait on Cantrip Expansion (restored in `finally`) puts the druid's
 * two back — the routing is what this guard measures.
 *
 * Fixtures are synthetic ("TEST …"), never an owner's character.
 */
const db = content();

const dual = (classId: string, classId2: string, level: number, featId: string, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST dual-class cantrips',
    level,
    classId,
    classId2,
    variantRules: { dualClass: true },
    subclassId: db.classes[classId]?.subclass?.options[0]?.id ?? null,
    subclassId2: db.classes[classId2]?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: db.classes[classId]?.keyAbility?.[0] ?? null,
    featPicks: { '2:class:0': featId },
    ...over,
  }) as BuildState;
const single = (classId: string, level: number, featId: string): BuildState =>
  ({ ...dual(classId, '', level, featId), classId2: null, subclassId2: null, variantRules: {} }) as BuildState;
const entryOf = (ch: Character, classId: string): SpellcastingEntry => ch.spellcasting.find((e) => e.id === `${classId}-casting`)!;
/** The builder's row cap (Builder.tsx `cantripCap` / `cantripCap2`) and the sheet's, which must agree. */
const caps = (b: BuildState, classId: string) => ({
  builder: Math.max(0, cantripsKnown(classId) + classCantripBonus(b, db, classId) + classArchetypeSpellMods(b, db, classId).cantripDelta),
  sheet: entryOf(buildCharacter(b, db), classId).cantripCap,
});
/** Common cantrips on `tradition`, fixed order — the player's own picks. */
const onTradition = (tradition: string) =>
  Object.values(db.spells)
    .filter((s) => s.rank === 0 && s.rarity === 'common' && s.traditions?.includes(tradition as never) && !s.traits?.includes('focus'))
    .map((s) => s.id)
    .sort();

describe('the fixtures are what they claim', () => {
  it('Cantrip Expansion lists the eight classes print gives it, and the druid and summoner are not among them', () => {
    expect(db.feats['cantrip-expansion'].spellSlotBonus).toEqual({ cantrips: 2 });
    expect([...db.feats['cantrip-expansion'].traits].sort()).toEqual(['bard', 'cleric', 'magus', 'oracle', 'psychic', 'sorcerer', 'witch', 'wizard']);
    expect(db.classes.druid.spellcasting?.type).toBe('prepared');
    expect(db.classes.summoner.spellcasting?.type).toBe('spontaneous');
    const flex = db.feats['flexible-spellcaster-dedication'];
    expect(flex.classArchetype?.classId).not.toContain('sorcerer');
    expect(flex.spellSlotBonus?.cantripsAt).toEqual([{ level: 4, cantrips: 2 }]);
  });
});

describe('a cantrip bonus feeds only the class it belongs to (print and Wanderer’s Guide agree)', () => {
  // mutation-proof
  it('Wizard/Druid with Cantrip Expansion: the wizard gets the two, the druid keeps its five — builder and sheet', () => {
    const b = dual('wizard', 'druid', 2, 'cantrip-expansion');
    expect(caps(b, 'wizard')).toEqual({ builder: 8, sheet: 8 });
    expect(caps(b, 'druid'), 'was 7: the druid cannot take the feat').toEqual({ builder: 5, sheet: 5 });
    // The old shape — every bonus in every pool — reads the druid's old two.
    expect(cantripBonusFor(b, db, { skipSwaps: !classPaysCantripSwap(b, db, 'druid') }), 'the old number on the old shape').toBe(2);
    // Planted: the druid on the feat's list too, so the feat is the druid's as well and feeds it again.
    const traits = db.feats['cantrip-expansion'].traits;
    db.feats['cantrip-expansion'].traits = [...traits, 'druid'];
    try {
      expect(caps(b, 'druid').builder, 'the guard reads the routing, not a constant').toBe(7);
    } finally {
      db.feats['cantrip-expansion'].traits = traits;
    }
  });
  it('the order of the two classes does not matter (Druid/Wizard)', () => {
    const b = dual('druid', 'wizard', 2, 'cantrip-expansion');
    expect(caps(b, 'druid')).toEqual({ builder: 5, sheet: 5 });
    expect(caps(b, 'wizard')).toEqual({ builder: 8, sheet: 8 });
  });
  it('two spontaneous classes the same way: Sorcerer/Summoner gives the sorcerer 7, the summoner keeps 5', () => {
    const b = dual('sorcerer', 'summoner', 2, 'cantrip-expansion');
    expect(caps(b, 'sorcerer').builder).toBe(7);
    expect(caps(b, 'summoner')).toEqual({ builder: 5, sheet: 5 });
  });
  // mutation-proof
  it('Flexible Spellcaster on a Wizard/Sorcerer: its ladder pairs with its -2 on the wizard, the sorcerer keeps 5', () => {
    const b = dual('wizard', 'sorcerer', 4, 'flexible-spellcaster-dedication');
    expect(caps(b, 'wizard'), 'wizard 6 - 2 + 2').toEqual({ builder: 6, sheet: 6 });
    expect(caps(b, 'sorcerer'), 'was 7').toEqual({ builder: 5, sheet: 5 });
    expect(cantripBonusFor(b, db), 'the old shape gives the sorcerer the ladder').toBe(2);
  });
  it('a bonus AIMED at one class pool (`entryId: <class>-casting`) sizes that class alone', () => {
    // No shipped record aims at a class pool; a homebrew row can. Planted on a copy of the record's bonus.
    const b = dual('wizard', 'sorcerer', 2, 'cantrip-expansion');
    const feat = db.feats['cantrip-expansion'];
    const saved = feat.spellSlotBonus;
    feat.spellSlotBonus = { entryId: 'sorcerer-casting', cantrips: 1 };
    try {
      expect(classCantripBonus(b, db, 'sorcerer')).toBe(1);
      expect(classCantripBonus(b, db, 'wizard'), 'the wizard pool is not the one it names').toBe(0);
    } finally {
      feat.spellSlotBonus = saved;
    }
  });
  it('a single class is unchanged: wizard 8 with Cantrip Expansion, flexible cleric 5 at 4th', () => {
    expect(caps(single('wizard', 2, 'cantrip-expansion'), 'wizard')).toEqual({ builder: 8, sheet: 8 });
    expect(caps(single('cleric', 4, 'flexible-spellcaster-dedication'), 'cleric')).toEqual({ builder: 5, sheet: 5 });
  });
});

describe('owner question #172 — pinned as it was until he rules', () => {
  it('#172: Wizard/Sorcerer (a prepared + a spontaneous class) still gets two in each class', () => {
    const b = dual('wizard', 'sorcerer', 2, 'cantrip-expansion');
    expect(caps(b, 'wizard')).toEqual({ builder: 8, sheet: 8 });
    expect(caps(b, 'sorcerer')).toEqual({ builder: 7, sheet: 7 });
  });
  it('#172: Wizard/Summoner the same (the summoner reads the spontaneous sentence)', () => {
    expect(caps(dual('wizard', 'summoner', 2, 'cantrip-expansion'), 'summoner').builder).toBe(7);
  });
  it('#172: Wizard/Cleric (both list the feat) still gets two in each class — the app cannot tell which class took it', () => {
    const b = dual('wizard', 'cleric', 2, 'cantrip-expansion');
    expect(caps(b, 'wizard').builder).toBe(8);
    expect(caps(b, 'cleric').builder).toBe(7);
  });
});

describe('an old save whose pool shrank keeps every pick — drawn and reported', () => {
  const sevenDruid = onTradition('primal').slice(0, 7);
  const b = dual('wizard', 'druid', 2, 'cantrip-expansion', { cantrips2: sevenDruid });
  it('the fixture holds seven distinct primal cantrips', () => {
    expect(new Set(sevenDruid).size).toBe(7);
  });
  it('the druid draws all seven, against a cap of five, and says two are over', () => {
    const e = entryOf(buildCharacter(b, db), 'druid');
    expect(e.cantripCap).toBe(5);
    expect(e.cantripCapWas, 'the cap the save was made under').toBe(7);
    for (const id of sevenDruid) expect(e.cantrips, id).toContain(id);
    expect(cantripsOverOf(e)).toBe(2);
  });
  it('the play overlay draws all seven too: one opening per stored pick', () => {
    const ch = buildCharacter(b, db);
    const e = entryOf(applyPlayState(ch, initialPlay(ch, db), db), 'druid');
    expect(e.cantripSlots).toEqual(sevenDruid);
    for (const id of sevenDruid) expect(e.cantrips, id).toContain(id);
    expect(cantripsOverOf(e)).toBe(2);
  });
  it('a druid that stored only its five reports nothing', () => {
    const e = entryOf(buildCharacter(dual('wizard', 'druid', 2, 'cantrip-expansion', { cantrips2: sevenDruid.slice(0, 5) }), db), 'druid');
    expect(cantripsOverOf(e)).toBe(0);
  });
  // mutation-proof
  it('cantrips the player PREPARED ON THE SHEET into openings past the new cap are still drawn, and counted live', () => {
    /* Five builder picks, and the two openings the old cap of seven gave filled on the sheet. The opening
     * count used to follow the build's picks alone, so these two vanished with no note. */
    const ch = buildCharacter(dual('wizard', 'druid', 2, 'cantrip-expansion', { cantrips2: sevenDruid.slice(0, 5) }), db);
    const base = initialPlay(ch, db);
    const play = {
      ...base,
      preparedSpells: { ...base.preparedSpells, [preparedCantripKey('druid-casting', 5)]: sevenDruid[5], [preparedCantripKey('druid-casting', 6)]: sevenDruid[6] },
    };
    const e = entryOf(applyPlayState(ch, play, db), 'druid');
    expect(e.cantripSlots).toEqual(sevenDruid);
    expect(cantripsOverOf(e)).toBe(2);
    // …and the count is what is DRAWN: empty the last opening and only one is over.
    const emptied = { ...play, preparedSpells: { ...play.preparedSpells, [preparedCantripKey('druid-casting', 6)]: null } };
    const e2 = entryOf(applyPlayState(ch, emptied, db), 'druid');
    expect(e2.cantripSlots).toEqual(sevenDruid.slice(0, 6));
    expect(cantripsOverOf(e2), 'six prepared against five').toBe(1);
    // A pool whose cap did not shrink opens nothing past it, whatever the store holds.
    const plain = buildCharacter({ ...single('druid', 2, 'cantrip-expansion'), featPicks: {}, cantrips: sevenDruid.slice(0, 5) } as BuildState, db);
    expect(entryOf(plain, 'druid').cantripCapWas).toBeUndefined();
    const stray = { ...initialPlay(plain, db), preparedSpells: { [preparedCantripKey('druid-casting', 5)]: sevenDruid[5] } };
    expect(entryOf(applyPlayState(plain, stray, db), 'druid').cantripSlots, 'no shrunk cap, no extra opening').toHaveLength(5);
  });
  it('a gift-inside sorcerer that lost the ladder still draws every pick and reports through its own count', () => {
    // The player's own six, none of them the bloodline's gift (a pick equal to the gift is the gift).
    const gift = entryOf(buildCharacter(dual('wizard', 'sorcerer', 4, 'flexible-spellcaster-dedication'), db), 'sorcerer').grantedCantrips ?? [];
    expect(gift.length, 'the sorcerer has its gift cantrip').toBeGreaterThan(0);
    const sorcererOwn = onTradition('arcane').filter((id) => !gift.includes(id)).slice(0, 6);
    const ch = buildCharacter(dual('wizard', 'sorcerer', 4, 'flexible-spellcaster-dedication', { cantrips2: sorcererOwn }), db);
    const e = entryOf(ch, 'sorcerer');
    expect(e.cantripCap).toBe(5);
    for (const id of sorcererOwn) expect(e.cantrips, id).toContain(id);
    expect(cantripsOverOf(e), 'six own beside the gift, against four places').toBe(2);
  });
  it('a BOOK class keeps the picks in its book (Wizard/Necromancer: the dirge holds all seven)', () => {
    const occult = onTradition('occult').slice(0, 7);
    const e = entryOf(buildCharacter(dual('wizard', 'necromancer', 2, 'cantrip-expansion', { cantrips2: occult }), db), 'necromancer');
    expect(e.cantripCap).toBe(cantripsKnown('necromancer'));
    expect(e.bookCantrips, 'every stored pick is still in the book').toEqual(expect.arrayContaining(occult));
  });
});
