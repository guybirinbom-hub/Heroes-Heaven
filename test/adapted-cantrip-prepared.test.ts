import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, classArchetypeSpellMods, classCantripBonus, classPaysCantripSwap, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay, setPreparedCantrip, type PlayState } from '../src/rules/play';
import { openChoiceOptions } from '../src/rules/openChoice';
import { ownPlacesBeside, pickerSpellOptions, traditionPool } from '../src/rules/spellOptions';
import { exportWg } from '../src/data/transfer';
import { enabledBookSet } from '../src/rules/sources';
import { cantripsKnown } from '../src/rules/spellcasting';
import type { Character, SpellcastingEntry } from '../src/rules/types';

/**
 * ADAPTED CANTRIP ON A PREPARED CLASS — the caster keeps every cantrip (owner's bug 2026-10-15).
 *
 * Print, Pathfinder Player Core (feat-4474): *"Choose one cantrip from a magical tradition other than
 * your own. If you prepare spells, you can choose this spell when you prepare your cantrips, in addition
 * to your other options. If you have a spell repertoire, replace one of your cantrips known with the
 * chosen spell."*
 *
 * So the record's `spellSlotBonus { cantrips: -1 }` is the REPERTOIRE half alone. The build charged it to
 * every class pool, measured before the fix: a 1st-level School of Battle Magic wizard with Adapted
 * Cantrip (guidance) had cantripCap 5, not 6, and guidance was in the book but in none of the five
 * openings; a cleric had 4 openings, not 5; under Dual Class the class that never receives the cantrip
 * lost one as well. Wanderer's Guide agrees with print on the count: its Player Core row for the feat
 * carries no operations at all, so no class there loses a cantrip (its other row is a deprecated
 * playtest book's, never evidence — R15).
 *
 * The rule now, one function for the build and both builder rows (`classPaysCantripSwap` /
 * `classCantripBonus`): the `-1` is charged only to the class pool the cantrip lands in, and only when
 * that class keeps a repertoire. A prepared class keeps its whole count and may prepare the cantrip in
 * any opening; with every opening filled it is an OPTION (the entry's list additions, a book), never a
 * cantrip drawn on top of them — a sheet with no play state draws the build list as it is.
 *
 * Old saves: the allowance only ever goes UP, so every stored pick is still drawn; a save made with the
 * old builder (one pick fewer) gets the adapted cantrip in the opening the old builder took away.
 *
 * MUTATION-PROVED (planted in memory, restored in `finally`): with the feat's `grantToClassEntry` taken
 * off, the swap is charged to every pool again — the code's shape before this fix — and the full-count
 * assertion below reads the old number.
 *
 * Fixtures are synthetic ("TEST …"), never an owner's character.
 */
const db = content();
const CORE = enabledBookSet(undefined);
const PREPARED = Object.keys(db.classes).filter((id) => db.classes[id].spellcasting?.type === 'prepared').sort();
const REPERTOIRE = ['bard', 'sorcerer'];

const pc = (classId: string, level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST adapted cantrip',
    level,
    classId,
    subclassId: db.classes[classId]?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: db.classes[classId]?.keyAbility?.[0] ?? null,
    ...over,
  }) as BuildState;
const withAdapted = (b: BuildState, answer: string): BuildState =>
  ({ ...b, featPicks: { ...b.featPicks, '1:ancestry:0': 'adapted-cantrip' }, featChoices: { ...b.featChoices, '1:ancestry:0': answer } }) as BuildState;
const entryOf = (ch: Character, classId: string): SpellcastingEntry => ch.spellcasting.find((e) => e.id === `${classId}-casting`)!;
const sheetOf = (ch: Character, play: PlayState = initialPlay(ch, db)) => applyPlayState(ch, play, db);
/** The sheet's Prepare-a-cantrip picker for one opening (SpellsTab's own call). */
const opening = (ch: Character, classId: string, i: number, play: PlayState = initialPlay(ch, db)): string[] => {
  const sheet = sheetOf(ch, play);
  const e = entryOf(sheet, classId);
  return pickerSpellOptions({ character: sheet, entry: e, content: db }, 0, undefined, CORE, e.cantripSlots?.[i] ?? null).map((s) => s.id);
};
/** Common Player Core cantrips on `tradition`, in a fixed order — the player's own picks. */
const onTradition = (tradition: string) =>
  Object.values(db.spells)
    .filter((s) => s.rank === 0 && s.rarity === 'common' && CORE.has(s.source?.book ?? '') && s.traditions?.includes(tradition as never) && !s.traits?.includes('focus'))
    .map((s) => s.id)
    .sort();
/** The adapted cantrip the feat's own picker offers this character first (off every tradition it casts). */
const adaptedFor = (b: BuildState) => openChoiceOptions(db.feats['adapted-cantrip'].choice!.from, db, { character: buildCharacter(b, db) })[0].id;
/** The builder's cap for a class row (Builder.tsx `cantripCap` / `cantripCap2`, before UMT's missing cantrip). */
const builderCap = (b: BuildState, classId: string) =>
  Math.max(0, cantripsKnown(classId) + classCantripBonus(b, db, classId) + classArchetypeSpellMods(b, db, classId).cantripDelta);

/** A class at 1st level with every place the builder offers filled (a sorcerer's gift takes one of its
 *  five — `ownPlacesBeside`), and the same build with the feat answered. */
const fixture = (classId: string) => {
  const probe = entryOf(buildCharacter(pc(classId, 1), db), classId);
  const cap = probe.cantripCap!;
  const places = ownPlacesBeside(probe, 0, cap, []);
  const granted = new Set(probe.grantedCantrips ?? []);
  const plain = pc(classId, 1, { cantrips: onTradition(probe.tradition).filter((id) => !granted.has(id)).slice(0, places) });
  const answer = adaptedFor(plain);
  return { cap, places, tradition: probe.tradition, plain, answer, adapted: withAdapted(plain, answer) };
};

describe('the fixtures are what they claim', () => {
  it('every prepared class in the data, and the feat still carries the repertoire half as a -1', () => {
    expect(PREPARED).toEqual(expect.arrayContaining(['animist', 'cleric', 'druid', 'magus', 'necromancer', 'witch', 'wizard']));
    expect(db.feats['adapted-cantrip'].spellSlotBonus).toEqual({ cantrips: -1 });
    for (const classId of PREPARED) {
      const f = fixture(classId);
      expect(f.cap, classId).toBeGreaterThan(0);
      expect(f.places, `${classId}: no gift inside a prepared class's count`).toBe(f.cap);
      expect(f.plain.cantrips, `${classId}: the plain build stores its whole allowance`).toHaveLength(f.cap);
      expect(db.spells[f.answer]?.traditions, `${classId}: ${f.answer} is off ${f.tradition}`).not.toContain(f.tradition);
    }
  });
});

describe('a prepared class keeps every cantrip opening', () => {
  // mutation-proof
  it("the owner's case: a 1st-level School of Battle Magic wizard with guidance has 6 openings, all six picks prepared, guidance on offer", () => {
    const six = onTradition('arcane').slice(0, 6);
    const b = withAdapted(pc('wizard', 1, { subclassId: 'school-of-battle-magic', keyAbility: 'int', cantrips: six }), 'guidance');
    const e = entryOf(buildCharacter(b, db), 'wizard');
    expect(e.cantripCap, 'six openings, as without the feat').toBe(6);
    expect(e.bookCantrips, 'guidance joins the book').toContain('guidance');
    expect(e.spellSources?.guidance).toBe('Adapted Cantrip');
    const ch = buildCharacter(b, db);
    expect(entryOf(sheetOf(ch), 'wizard').cantripSlots, "the standing preparation is the player's six").toEqual(six);
    for (let i = 0; i < 6; i++) expect(opening(ch, 'wizard', i), `opening ${i} may prepare guidance`).toContain('guidance');
    const morning = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 2, 'guidance');
    const today = entryOf(sheetOf(ch, morning), 'wizard');
    expect(today.cantripSlots?.[2]).toBe('guidance');
    expect(today.cantrips, 'still six prepared, guidance one of them').toHaveLength(6);
    // The planted bad case: the swap charged to every pool, as before the fix.
    const from = db.feats['adapted-cantrip'].choice!.from as { grantToClassEntry?: boolean };
    const saved = from.grantToClassEntry;
    delete from.grantToClassEntry;
    try {
      expect(entryOf(buildCharacter(b, db), 'wizard').cantripCap, 'the guard reads the old number on the old shape').toBe(5);
    } finally {
      from.grantToClassEntry = saved;
    }
    expect(entryOf(buildCharacter(b, db), 'wizard').cantripCap, 'restored').toBe(6);
  });

  it('every prepared class: the same cap as without the feat, the player\'s picks prepared, the adapted cantrip offered in every opening', () => {
    for (const classId of PREPARED) {
      const f = fixture(classId);
      const plainCh = buildCharacter(f.plain, db);
      const ch = buildCharacter(f.adapted, db);
      expect(entryOf(ch, classId).cantripCap, `${classId}: full count`).toBe(f.cap);
      expect(entryOf(sheetOf(ch), classId).cantripSlots, `${classId}: the standing preparation is unchanged`).toEqual(entryOf(sheetOf(plainCh), classId).cantripSlots);
      expect(entryOf(ch, classId).spellSources?.[f.answer], `${classId}: attributed`).toBe('Adapted Cantrip');
      for (let i = 0; i < f.cap; i++) expect(opening(ch, classId, i), `${classId}: opening ${i} may prepare ${f.answer}`).toContain(f.answer);
      expect(classPaysCantripSwap(f.adapted, db, classId), classId).toBe(false);
      // A rebuild with no stored build gives back the player's own picks — never the feat's cantrip as one.
      expect(deriveBuildFromCharacter(ch, db).cantrips, `${classId}: reverse build`).toEqual(f.plain.cantrips);
      // …and prepared in an opening, it is DRAWN (the render asks the same list the picker offers).
      const morning = setPreparedCantrip(initialPlay(ch, db), `${classId}-casting`, 0, f.answer);
      expect(entryOf(sheetOf(ch, morning), classId).cantripSlots?.[0], `${classId}: prepared and drawn`).toBe(f.answer);
    }
  });

  // mutation-proof
  it('a sheet with no play state yet draws the build list as it is: the openings, not the openings plus the option', () => {
    /* applyPlayState returns the character untouched when nothing has been played, so the Spells tab
     * draws the BUILD entry's `cantrips`. Measured in the dev app before this leg: a fresh cleric with
     * Adapted Cantrip showed six at-will cantrips (its five and electric arc). */
    for (const classId of PREPARED) {
      const f = fixture(classId);
      const ch = buildCharacter(f.adapted, db);
      const raw = entryOf(ch, classId);
      expect(raw.cantrips, `${classId}: the standing preparation`).toEqual(f.plain.cantrips);
      expect(entryOf(applyPlayState(ch, undefined, db), classId).cantrips, `${classId}: no play state`).toHaveLength(f.cap);
      expect(ch.spellListAdditions?.[`${classId}-casting`], `${classId}: still on the list the openings prepare from`).toContain(f.answer);
      // The planted bad case: the option pushed on top of a full preparation, as the grant did before.
      expect([...raw.cantrips, f.answer], `${classId}: the old push`).toHaveLength(f.cap + 1);
    }
  });

  it('the builder row and the sheet count the same places (Builder.tsx reads `classCantripBonus`)', () => {
    for (const classId of PREPARED) {
      const f = fixture(classId);
      expect(builderCap(f.adapted, classId), classId).toBe(entryOf(buildCharacter(f.adapted, db), classId).cantripCap);
      expect(builderCap(f.adapted, classId), `${classId}: the feat moves the row by nothing`).toBe(builderCap(f.plain, classId));
    }
  });
});

describe('the option stays reachable on every path', () => {
  // mutation-proof
  it('Hide legacy on, a legacy answer (acid splash): offered in every opening and drawn once prepared', () => {
    /* Checker finding, 2026-10-15: with every opening filled the cantrip reaches the openings through the
     * entry's list addition, and `traditionPool` drops legacy spells before it reads additions — so a
     * stored acid splash drew "Empty cantrip". The openings now also offer what a feat put in the entry
     * (`spellSources`). */
    expect(db.spells['acid-splash']?.edition, 'fixture: a legacy cantrip').toBe('legacy');
    // Two divine pools without a book (acid splash is arcane and primal, so not a druid's answer).
    for (const classId of ['cleric', 'animist']) {
      const f = fixture(classId);
      expect(db.spells['acid-splash']?.traditions, `fixture: off ${f.tradition}`).not.toContain(f.tradition);
      const ch = buildCharacter({ ...withAdapted(f.plain, 'acid-splash'), hideLegacy: true } as BuildState, db);
      expect(entryOf(ch, classId).cantrips, `${classId}: an option, not prepared`).not.toContain('acid-splash');
      for (let i = 0; i < f.cap; i++) expect(opening(ch, classId, i), `${classId}: opening ${i}`).toContain('acid-splash');
      const stored = setPreparedCantrip(initialPlay(ch, db), `${classId}-casting`, 0, 'acid-splash');
      expect(entryOf(sheetOf(ch, stored), classId).cantripSlots?.[0], `${classId}: drawn, not "Empty cantrip"`).toBe('acid-splash');
      // The planted bad case: the list addition alone, which Hide legacy filters.
      expect(traditionPool(ch, entryOf(ch, classId), db).byRank[0]?.some((s) => s.id === 'acid-splash'), `${classId}: the addition alone`).toBe(false);
    }
  });

  it('…listed ONCE in an opening\'s picker, also on an old save where the build put it in `cantrips` too', () => {
    // Checker finding, 2026-10-15: the openings' own list read `cantrips` and the feat's cantrips
    // without de-duplicating, so a free-opening save listed the adapted cantrip twice.
    for (const classId of PREPARED) {
      const f = fixture(classId);
      if (f.cap < 2) continue;
      const old = buildCharacter(withAdapted(pc(classId, 1, { cantrips: f.plain.cantrips.slice(0, f.cap - 1) }), f.answer), db);
      for (let i = 0; i < f.cap; i++) {
        const ids = opening(old, classId, i);
        expect(ids.filter((id) => id === f.answer), `${classId}: opening ${i}`).toHaveLength(ids.includes(f.answer) ? 1 : 0);
        expect(new Set(ids).size, `${classId}: opening ${i} lists each cantrip once`).toBe(ids.length);
      }
    }
  });

  it("the export's readable spell list still names it (a cleric has it as an option, not prepared)", () => {
    const f = fixture('cleric');
    const ch = buildCharacter(f.adapted, db);
    expect(entryOf(ch, 'cleric').cantrips, 'fixture: not prepared').not.toContain(f.answer);
    const listed: string[] = JSON.parse(exportWg({ id: 'ac-export', character: ch, archived: false }, db)).content.spells;
    expect(listed).toContain(db.spells[f.answer]!.name);
  });

  it("…and only a CLASS pool's feat cantrips: a pixie's export does not name the grig's and draxie's Fey Cantrips", () => {
    /* Checker finding, 2026-10-15: an innate entry's `spellSources` is filled before its per-heritage
     * filter, so it names grants this character never received. */
    const ch = buildCharacter({ ...pc('fighter', 1, { ancestryId: 'sprite', heritageId: 'pixie', keyAbility: 'str' }), featPicks: { '1:ancestry:0': 'fey-cantrips' } } as BuildState, db);
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate?.cantrips, 'fixture: the pixie casts light and figment').toEqual(expect.arrayContaining(['light', 'figment']));
    const listed: string[] = JSON.parse(exportWg({ id: 'fey-export', character: ch, archived: false }, db)).content.spells;
    expect(listed).not.toContain(db.spells['detect-magic']!.name);
    expect(listed).not.toContain(db.spells['prestidigitation']!.name);
  });
});

describe('an old save draws everything it drew', () => {
  it('a save made with the old builder (one pick fewer): every pick prepared, and the adapted cantrip fills the opening it was given back', () => {
    for (const classId of PREPARED) {
      const f = fixture(classId);
      const old = withAdapted(pc(classId, 1, { cantrips: f.plain.cantrips.slice(0, f.cap - 1) }), f.answer);
      const slots = entryOf(sheetOf(buildCharacter(old, db)), classId).cantripSlots!;
      for (const id of old.cantrips) expect(slots, `${classId}: ${id} still prepared`).toContain(id);
      expect(slots, `${classId}: full count`).toHaveLength(f.cap);
      expect(slots[f.cap - 1], `${classId}: the last opening holds the adapted cantrip by default`).toBe(f.answer);
    }
  });

  // mutation-proof
  it('…and one whose player prepared the adapted cantrip BY HAND: the returned opening gets back the pick it had pushed out, not a second copy', () => {
    /* Before the fix the adapted cantrip was in no default opening, so a player who wanted it re-prepared
     * one (checker finding, 2026-10-15). The opening the fix gives back defaulted to the build's next
     * cantrip — the adapted one again — so it was drawn twice and the displaced pick stayed hidden. */
    for (const classId of PREPARED) {
      const f = fixture(classId);
      if (f.cap < 2) continue; // an opening must be re-prepared AND one returned
      const own = f.plain.cantrips.slice(0, f.cap - 1);
      const ch = buildCharacter(withAdapted(pc(classId, 1, { cantrips: own }), f.answer), db);
      const byHand = f.cap - 2; // the last opening the old cap had
      const play = setPreparedCantrip(initialPlay(ch, db), `${classId}-casting`, byHand, f.answer);
      const slots = entryOf(sheetOf(ch, play), classId).cantripSlots!;
      expect(slots[byHand], `${classId}: the stored choice is untouched`).toBe(f.answer);
      expect(new Set(slots).size, `${classId}: ${f.cap} different cantrips`).toBe(f.cap);
      for (const id of own) expect(slots, `${classId}: ${id} is prepared again`).toContain(id);
      // The planted bad case: every untouched opening on its own default, as before this leg.
      const raw = entryOf(ch, classId).cantrips;
      const naive = slots.map((_, i) => (i === byHand ? f.answer : raw[i]));
      expect(new Set(naive).size, `${classId}: the old fill drew one twice`).toBe(f.cap - 1);
    }
  });

  it('…and the returned opening never brings back a cantrip the player emptied or swapped out of ANOTHER opening', () => {
    /* Checker finding, 2026-10-15: the stand-in was the first free default, so an emptied opening's own
     * cantrip came back and the pick the adapted cantrip pushed out stayed hidden. It is the pick THAT
     * opening's choice pushed out. */
    const own = onTradition('arcane').slice(0, 5);
    const ch = buildCharacter(withAdapted(pc('wizard', 1, { subclassId: 'school-of-battle-magic', keyAbility: 'int', cantrips: own }), 'guidance'), db);
    const byHand = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 4, 'guidance');
    const swap = onTradition('arcane').find((id) => !own.includes(id))!;
    const emptied = entryOf(sheetOf(ch, setPreparedCantrip(byHand, 'wizard-casting', 0, null)), 'wizard').cantripSlots;
    expect(emptied, 'opening 0 stays empty; the 6th gets back what guidance pushed out').toEqual([null, ...own.slice(1, 4), 'guidance', own[4]]);
    const swapped = entryOf(sheetOf(ch, setPreparedCantrip(byHand, 'wizard-casting', 0, swap)), 'wizard').cantripSlots;
    expect(swapped, 'the swap stands; the 6th gets back what guidance pushed out').toEqual([swap, ...own.slice(1, 4), 'guidance', own[4]]);
  });

  it("a full wizard book: the five it prepared stay prepared, and a morning's re-preparation stays where it was", () => {
    /* DECISION (2026-10-15, recorded here because it changes what an old save draws): before the fix a
     * wizard with a full book drew its first FIVE book cantrips plus guidance — and, with no play state
     * yet, drew guidance beside the openings. Print: the player prepares six (*"in addition to your other
     * options"*), so the sixth opening takes the book's sixth cantrip, the player's own pick, and guidance
     * is offered in every opening instead of being drawn on top. Nothing the player STORED is hidden. */
    const ten = onTradition('arcane').slice(0, 10);
    const b = withAdapted(pc('wizard', 5, { keyAbility: 'int', cantrips: ten }), 'guidance');
    const ch = buildCharacter(b, db);
    expect(entryOf(applyPlayState(ch, undefined, db), 'wizard').cantrips, 'no play state: the six openings').toEqual(ten.slice(0, 6));
    const slots = entryOf(sheetOf(ch), 'wizard').cantripSlots!;
    expect(slots).toEqual(ten.slice(0, 6));
    const play = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 1, 'guidance');
    expect(entryOf(sheetOf(ch, play), 'wizard').cantripSlots).toEqual([ten[0], 'guidance', ...ten.slice(2, 6)]);
    // …and a rebuild with no stored build hands back the player's own ten, not the feat's cantrip.
    expect(deriveBuildFromCharacter(ch, db).cantrips).toEqual(ten);
  });
});

describe('control: a repertoire still REPLACES one ("replace one of your cantrips known")', () => {
  it('bard and sorcerer: one place fewer, the same number known, the cantrip one of them', () => {
    for (const classId of REPERTOIRE) {
      const f = fixture(classId);
      const plainEntry = entryOf(buildCharacter(f.plain, db), classId);
      expect(entryOf(buildCharacter(f.adapted, db), classId).cantripCap, classId).toBe(f.cap - 1);
      expect(classPaysCantripSwap(f.adapted, db, classId), classId).toBe(true);
      expect(builderCap(f.adapted, classId), classId).toBe(f.cap - 1);
      // A new save fills the places the builder now offers — one fewer — and knows as many as before.
      const placesNow = ownPlacesBeside(entryOf(buildCharacter(f.adapted, db), classId), 0, f.cap - 1, []);
      const e = entryOf(buildCharacter(withAdapted(pc(classId, 1, { cantrips: f.plain.cantrips.slice(0, placesNow) }), f.answer), db), classId);
      expect(e.cantrips, classId).toHaveLength(plainEntry.cantrips.length);
      expect(e.cantrips, classId).toContain(f.answer);
    }
  });
});

describe('Dual Class: only the class the cantrip lands in can pay for it', () => {
  const dual = (a: string, b: string, picks: string[], picks2: string[], answer: string): BuildState =>
    withAdapted(
      pc(a, 1, {
        variantRules: { dualClass: true },
        classId2: b,
        subclassId2: db.classes[b]?.subclass?.options[0]?.id ?? null,
        cantrips: picks,
        cantrips2: picks2,
      } as Partial<BuildState>),
      answer,
    );
  const capOf = (b: BuildState, classId: string) => entryOf(buildCharacter(b, db), classId).cantripCap!;
  const without = (b: BuildState): BuildState => ({ ...b, featPicks: {}, featChoices: {} }) as BuildState;
  const ARC = onTradition('arcane');
  // The first bloodline is aberrant: occult, its gift (daze) one of the five.
  const OCC = onTradition('occult').filter((id) => id !== 'daze');
  const DIV = onTradition('divine');
  // Each answer is off EVERY tradition the pair casts, as the feat's picker requires.
  const cases: { name: string; b: BuildState; receiver: string; other: string | null; pays: boolean }[] = [
    { name: 'Wizard/Sorcerer', b: dual('wizard', 'sorcerer', ARC.slice(0, 6), OCC.slice(0, 4), 'divine-lance'), receiver: 'wizard', other: 'sorcerer', pays: false },
    { name: 'Sorcerer/Wizard', b: dual('sorcerer', 'wizard', OCC.slice(0, 3), ARC.slice(0, 6), 'divine-lance'), receiver: 'sorcerer', other: 'wizard', pays: true },
    { name: 'Sorcerer/Bard', b: dual('sorcerer', 'bard', OCC.slice(0, 3), OCC.slice(0, 5), 'divine-lance'), receiver: 'sorcerer', other: 'bard', pays: true },
    { name: 'Fighter/Cleric', b: dual('fighter', 'cleric', [], DIV.slice(0, 5), 'electric-arc'), receiver: 'cleric', other: null, pays: false },
  ];
  for (const c of cases) {
    it(`${c.name}: the cantrip lands in the ${c.receiver}, which ${c.pays ? 'pays' : 'does not pay'}; the other class keeps every place`, () => {
      const answer = c.b.featChoices['1:ancestry:0'] as string;
      const ch = buildCharacter(c.b, db);
      expect(entryOf(ch, c.receiver).spellSources?.[answer], 'it lands in the class the helper names').toBe('Adapted Cantrip');
      expect(classPaysCantripSwap(c.b, db, c.receiver)).toBe(c.pays);
      expect(capOf(c.b, c.receiver)).toBe(capOf(without(c.b), c.receiver) - (c.pays ? 1 : 0));
      if (c.other) {
        expect(entryOf(ch, c.other).spellSources?.[answer], 'never in the other class too').toBeUndefined();
        expect(classPaysCantripSwap(c.b, db, c.other)).toBe(false);
        expect(capOf(c.b, c.other), `${c.other}: full count`).toBe(capOf(without(c.b), c.other));
      }
      for (const id of [c.receiver, ...(c.other ? [c.other] : [])])
        expect(builderCap(c.b, id), `${id}: the builder's row is the sheet's number`).toBe(entryOf(ch, id).cantripCap);
    });
  }
});
