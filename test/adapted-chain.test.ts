import { describe, expect, it } from 'vitest';
import { content } from './_content';
import {
  archetypeCantripCounts,
  buildCharacter,
  checkPrerequisites,
  deriveBuildFromCharacter,
  emptyBuild,
  hasSpellSlotsOfRank,
  type BuildState,
} from '../src/rules/build';
import { activeCasterArchetype } from '../src/rules/casterArchetypes';
import { openChoiceOptions } from '../src/rules/openChoice';
import { applyPlayState, initialPlay, setPreparedCantrip, setPreparedSpell, type PlayState } from '../src/rules/play';
import { giftChipIds, pickerSpellOptions, spellOptions, variantGiftCount } from '../src/rules/spellOptions';
import { enabledBookSet } from '../src/rules/sources';
import type { Character, ContentDatabase, SpellcastingEntry } from '../src/rules/types';

/**
 * THE ADAPTED CANTRIP CHAIN — the two gaps c720191 and 585544e left (2026-10-15).
 *
 * Print, Pathfinder Player Core:
 *   · Adapted Cantrip (feat-4474), prerequisite *"spellcasting class feature"*: *"Choose one cantrip from a
 *     magical tradition other than your own. If you prepare spells, you can choose this spell when you
 *     prepare your cantrips, in addition to your other options. If you have a spell repertoire, replace
 *     one of your cantrips known with the chosen spell."*
 *   · Adaptive Adept (feat-4481), prerequisites *"Adapted Cantrip; can cast 3rd-level spells"*: *"Choose a
 *     cantrip or 1st-rank spell from the same magical tradition as your cantrip from Adapted Cantrip. You
 *     gain that spell, adding it to your spell options just like the cantrip from Adapted Cantrip. … If you
 *     choose a 1st-rank spell, you don't gain access to the heightened versions of that spell, meaning you
 *     can't prepare them if you prepare spells and you can't learn them or select the spell as a signature
 *     spell if you have a spell repertoire."*
 *   · What "spellcasting class feature" means: Player Core rules-2230 — *"you don't qualify for feats and
 *     other rules that require you to be a spellcaster or have a spellcasting class feature—those require
 *     you to have spell slots"* (Player Core's archetype chapter, rules-2132, adds nothing; the legacy Core
 *     Rulebook's, rules-170, agreed: *"the basic spellcasting feat counts as having a spellcasting class
 *     feature"*).
 *   · Cleric Dedication (feat-5066): *"You can prepare two common cantrips each day from the divine spell
 *     list"* (Druid feat-5073 and Animist feat-7219 the same on their lists).
 * Wanderer's Guide: its Common Core rows for both feats (19871, 19872) carry no operations, so there is no
 * print-vs-WG conflict; its Cleric Dedication gives two rank-0 PREPARED slots off the divine tradition.
 *
 * Measured on be93069, before this: (1) the prerequisite line was unrecognised, so every character — a
 * fighter with no spells — met it; (2) a fighter with Cleric Dedication + Basic Cleric Spellcasting and
 * Adapted Cantrip had ONE place for their own cantrips (the -1 charged to a prepared pool), and with two
 * stored the build drew three, electric arc on top; the pool's cantrips could not be re-prepared at all;
 * (3) Adaptive Adept was "Recorded only" — its answer reached nothing.
 *
 * MUTATION-PROVED legs plant the old shape in memory (restored in `finally`) and show the assertion reads
 * the old number. Fixtures are synthetic ("TEST …"), never an owner's character.
 */
const db = content();
const CORE = enabledBookSet(undefined);

const pc = (classId: string, level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST adapted chain',
    level,
    classId,
    subclassId: db.classes[classId]?.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: db.classes[classId]?.keyAbility?.[0] ?? null,
    ...over,
  }) as BuildState;
const fighter = (level: number, over: Partial<BuildState> = {}) => pc('fighter', level, { keyAbility: 'str', subclassId: null, ...over });
/* An ordinary doctrine and school, not the data's first options (measured: a 5th-level Battle Creed cleric
 * has 2nd- and 3rd-rank slots only, so no 1st-rank slot to prepare a 1st-rank spell in). */
const cleric5 = () => pc('cleric', 5, { keyAbility: 'wis', subclassId: 'cloistered-cleric' });
const wizard = (level: number, over: Partial<BuildState> = {}) => pc('wizard', level, { keyAbility: 'int', subclassId: 'school-of-battle-magic', ...over });
/** Adapted Cantrip in the 1st-level ancestry slot, Adaptive Adept (when given) in the 5th. */
const withChain = (b: BuildState, adapted: string, adept?: string): BuildState =>
  ({
    ...b,
    featPicks: { ...b.featPicks, '1:ancestry:0': 'adapted-cantrip', ...(adept ? { '5:ancestry:0': 'adaptive-adept' } : {}) },
    featChoices: { ...b.featChoices, '1:ancestry:0': adapted, ...(adept ? { '5:ancestry:0': adept } : {}) },
  }) as BuildState;
const entry = (ch: Character, id: string): SpellcastingEntry => ch.spellcasting.find((e) => e.id === id)!;
const sheetOf = (ch: Character, play: PlayState = initialPlay(ch, db)) => applyPlayState(ch, play, db);
const featIds = (b: BuildState) => Object.values(b.featPicks ?? {}).filter((v): v is string => !!v);
const prereq = (b: BuildState, featId: string) => checkPrerequisites(db.feats[featId], buildCharacter(b, db), db);
/** What a slot or cantrip opening's picker offers (SpellsTab's own call). */
const offered = (ch: Character, entryId: string, rank: number, play?: PlayState): string[] => {
  const sheet = sheetOf(ch, play);
  return pickerSpellOptions({ character: sheet, entry: entry(sheet, entryId), content: db }, rank, undefined, CORE).map((s) => s.id);
};
/** Common Player Core cantrips on `tradition`, in a fixed order — the player's own picks. */
const onTradition = (tradition: string) =>
  Object.values(db.spells)
    .filter((s) => s.rank === 0 && s.rarity === 'common' && CORE.has(s.source?.book ?? '') && s.traditions?.includes(tradition as never) && !s.traits?.includes('focus'))
    .map((s) => s.id)
    .sort();

/* The three book-less PREPARED dedications whose openings this change gives back, each with an adapted
 * cantrip off its own list. */
const BOOKLESS: { ded: string; basic: string; tradition: string; adapted: string }[] = [
  { ded: 'cleric-dedication', basic: 'basic-cleric-spellcasting', tradition: 'divine', adapted: 'electric-arc' },
  { ded: 'druid-dedication', basic: 'basic-druid-spellcasting', tradition: 'primal', adapted: 'divine-lance' },
  { ded: 'animist-dedication', basic: 'basic-animist-spellcasting', tradition: 'divine', adapted: 'electric-arc' },
];
const dedicated = (c: (typeof BOOKLESS)[number], level: number, cantrips: string[], over: Partial<BuildState> = {}) =>
  fighter(level, { featPicks: { '2:class:0': c.ded, '4:class:1': c.basic }, cantrips, ...over });

describe('the fixtures are what they claim', () => {
  it('the spells, the feats and the dedications', () => {
    expect(db.feats['adapted-cantrip'].prerequisites).toEqual(['spellcasting class feature']);
    expect(db.feats['adaptive-adept'].prerequisites).toEqual(['Adapted Cantrip', 'can cast 3rd-level spells']);
    expect(db.spells['electric-arc'].traditions).toEqual(['arcane', 'primal']);
    expect(db.spells.grease.traditions).toEqual(['arcane', 'primal']);
    expect(db.spells.bless.traditions).toEqual(['divine', 'occult']);
    expect(db.spells.ignition.rank).toBe(0);
    for (const c of BOOKLESS) {
      expect(db.feats[c.basic], c.basic).toBeDefined();
      const arch = activeCasterArchetype([c.ded, c.basic])!;
      expect(arch.dedicationId, c.ded).toBe(c.ded);
      expect(arch.config.repertoire, `${c.ded} prepares`).toBeFalsy();
      expect(arch.config.book, `${c.ded} has no book`).toBeFalsy();
      expect(db.spells[c.adapted].traditions, `${c.adapted} is off ${c.tradition}`).not.toContain(c.tradition);
    }
  });
});

describe('"spellcasting class feature" means spell slots', () => {
  // mutation-proof
  it('a dedication with cantrips only does not qualify; its basic spellcasting feat (a 1st-rank slot) does', () => {
    const plain = fighter(5);
    expect(prereq(plain, 'adapted-cantrip').unmet, 'a fighter with no spells at all').toEqual(['spellcasting class feature']);
    for (const c of BOOKLESS) {
      const cantripsOnly = fighter(3, { featPicks: { '2:class:0': c.ded }, cantrips: onTradition(c.tradition).slice(0, 2) });
      const ch = buildCharacter(cantripsOnly, db);
      expect(entry(ch, `${c.ded}-casting`)?.cantrips, `fixture: ${c.ded} casts two cantrips`).toHaveLength(2);
      expect(checkPrerequisites(db.feats['adapted-cantrip'], ch, db).met, `${c.ded} alone`).toBe(false);
      expect(prereq(dedicated(c, 4, []), 'adapted-cantrip').met, `${c.ded} + ${c.basic}`).toBe(true);
      // The planted bad case: the same cantrips-only character with a 1st-rank slot written into its pool
      // reads as qualified — so the check reads SLOTS, not the dedication or the class.
      const planted = structuredClone(ch);
      entry(planted, `${c.ded}-casting`).prepared = { 1: [{ spellId: null, expended: false }] };
      expect(checkPrerequisites(db.feats['adapted-cantrip'], planted, db).met, `${c.ded}: planted slot`).toBe(true);
    }
    // A repertoire archetype the same way.
    expect(prereq(fighter(3, { featPicks: { '2:class:0': 'sorcerer-dedication' } }), 'adapted-cantrip').met).toBe(false);
    expect(prereq(fighter(4, { featPicks: { '2:class:0': 'sorcerer-dedication', '4:class:1': 'basic-sorcerer-spellcasting' } }), 'adapted-cantrip').met).toBe(true);
  });

  it('every class that casts from slots qualifies at 1st level; a champion (focus spells only) does not', () => {
    const casters = Object.keys(db.classes).filter((id) => db.classes[id].spellcasting).sort();
    expect(casters).toEqual(expect.arrayContaining(['bard', 'cleric', 'druid', 'magus', 'oracle', 'psychic', 'sorcerer', 'summoner', 'witch', 'wizard']));
    for (const id of casters) expect(prereq(pc(id, 1), 'adapted-cantrip').met, id).toBe(true);
    const champ = buildCharacter(pc('champion', 1), db);
    expect(champ.spellcasting.some((e) => e.type === 'focus'), 'fixture: the champion has focus spells').toBe(true);
    expect(checkPrerequisites(db.feats['adapted-cantrip'], champ, db).met, 'champion').toBe(false);
  });

  it('"can cast 3rd-level spells" (Adaptive Adept) reads a 3rd-rank slot', () => {
    const wiz = (level: number) => withChain(wizard(level), 'divine-lance');
    expect(prereq(wiz(5), 'adaptive-adept').met, 'wizard 5').toBe(true);
    expect(prereq(wiz(4), 'adaptive-adept').unmet, 'wizard 4').toEqual(['can cast 3rd-level spells']);
    const c = BOOKLESS[0];
    expect(prereq(withChain(dedicated(c, 8, []), 'electric-arc'), 'adaptive-adept').met, 'fighter 8 + Basic Cleric Spellcasting').toBe(true);
    expect(prereq(withChain(dedicated(c, 7, []), 'electric-arc'), 'adaptive-adept').met, 'fighter 7').toBe(false);
    expect(prereq(wizard(5), 'adaptive-adept').unmet, 'no Adapted Cantrip').toEqual(['Adapted Cantrip']);
    expect(hasSpellSlotsOfRank(buildCharacter(wizard(5), db), 3)).toBe(true);
  });

  it('War Mage, Time Mage and Hellknight Signifer\'s Preferment print "you have a spellcasting class feature" — the same test', () => {
    for (const id of ['war-mage-dedication', 'time-mage-dedication', 'hellknight-signifer-preferment']) {
      const line = db.feats[id]?.prerequisites?.find((p) => /^you have a spellcasting class feature$/i.test(p));
      expect(line, id).toBeDefined();
      expect(prereq(fighter(2), id).unmet, id).toContain(line);
      expect(prereq(wizard(2), id).unmet, id).not.toContain(line);
    }
  });
});

describe('a book-less PREPARED dedication keeps both cantrip openings, and they re-prepare', () => {
  // mutation-proof
  it('Cleric, Druid and Animist Dedication with Adapted Cantrip: two openings, both picks prepared, the cantrip an option', () => {
    for (const c of BOOKLESS) {
      const two = onTradition(c.tradition).slice(0, 2);
      const b = withChain(dedicated(c, 5, two), c.adapted);
      const id = `${c.ded}-casting`;
      const arch = activeCasterArchetype(featIds(b))!;
      expect(archetypeCantripCounts(arch, b, db, featIds(b)).prepared, `${c.ded}: the builder's row offers two (it offered one)`).toBe(2);
      const ch = buildCharacter(b, db);
      const e = entry(ch, id);
      expect(e.cantripsPrepared, `${c.ded}: the openings re-prepare`).toBe(true);
      expect(e.cantripCap, c.ded).toBe(2);
      expect(e.cantrips, `${c.ded}: the standing preparation is the player's two, not three`).toEqual(two);
      expect(ch.spellListAdditions?.[id], `${c.ded}: on the list the openings prepare from`).toContain(c.adapted);
      expect(e.spellSources?.[c.adapted], c.ded).toBe('Adapted Cantrip');
      for (const i of [0, 1]) expect(offered(ch, id, 0), `${c.ded}: opening ${i} may prepare ${c.adapted}`).toContain(c.adapted);
      const morning = setPreparedCantrip(initialPlay(ch, db), id, 1, c.adapted);
      expect(entry(sheetOf(ch, morning), id).cantripSlots, `${c.ded}: prepared and drawn`).toEqual([two[0], c.adapted]);
      expect(deriveBuildFromCharacter(ch, db).cantrips, `${c.ded}: the reverse build gives back the player's own two`).toEqual(two);
    }
    // The planted bad case: the swap charged to a prepared pool again — the shape before this change.
    const c = BOOKLESS[0];
    const b = withChain(dedicated(c, 5, onTradition(c.tradition).slice(0, 2)), c.adapted);
    const from = db.feats['adapted-cantrip'].choice!.from as { grantToClassEntry?: boolean };
    const saved = from.grantToClassEntry;
    delete from.grantToClassEntry;
    try {
      expect(archetypeCantripCounts(activeCasterArchetype(featIds(b))!, b, db, featIds(b)).prepared, 'the guard reads the old number').toBe(1);
    } finally {
      from.grantToClassEntry = saved;
    }
  });

  // The -1 is ON under the gate since package K (desk #174, 2026-10-15); a prepared pool never pays it anyway.
  it('…in the app as shipped (trust gate on): two cantrips drawn, not three', () => {
    const gated: ContentDatabase = content({ trustGate: true });
    const c = BOOKLESS[0];
    const two = onTradition(c.tradition).slice(0, 2);
    const ch = buildCharacter(withChain(dedicated(c, 5, two), c.adapted), gated);
    expect(entry(ch, `${c.ded}-casting`).cantrips).toEqual(two);
    expect(entry(applyPlayState(ch, undefined, gated), `${c.ded}-casting`).cantrips, 'no play state: the build list as it is').toHaveLength(2);
    expect(ch.spellListAdditions?.[`${c.ded}-casting`]).toContain(c.adapted);
  });

  it('an old save with ONE stored pick (the old builder offered one): the adapted cantrip fills the free opening', () => {
    const c = BOOKLESS[0];
    const one = onTradition(c.tradition).slice(0, 1);
    const ch = buildCharacter(withChain(dedicated(c, 5, one), c.adapted), db);
    expect(entry(ch, `${c.ded}-casting`).cantrips).toEqual([one[0], c.adapted]);
    expect(deriveBuildFromCharacter(ch, db).cantrips, 'never read back as a pick').toEqual(one);
  });

  it('without the feat the openings re-prepare too: the builder picks are the default, the sheet may change one', () => {
    for (const c of BOOKLESS) {
      const list = onTradition(c.tradition);
      const ch = buildCharacter(dedicated(c, 4, list.slice(0, 2)), db);
      const id = `${c.ded}-casting`;
      expect(entry(sheetOf(ch), id).cantripSlots, c.ded).toEqual(list.slice(0, 2));
      const morning = setPreparedCantrip(initialPlay(ch, db), id, 0, list[2]);
      expect(entry(sheetOf(ch, morning), id).cantripSlots, `${c.ded}: re-prepared`).toEqual([list[2], list[1]]);
      expect(entry(ch, id).cantrips, `${c.ded}: the build is untouched`).toEqual(list.slice(0, 2));
    }
  });

  it('control: a REPERTOIRE dedication still replaces one ("replace one of your cantrips known")', () => {
    const b = withChain(
      fighter(5, { featPicks: { '2:class:0': 'sorcerer-dedication', '4:class:1': 'basic-sorcerer-spellcasting' }, cantrips: ['detect-magic', 'light'] }),
      'divine-lance',
    );
    const arch = activeCasterArchetype(featIds(b))!;
    expect(archetypeCantripCounts(arch, b, db, featIds(b)).prepared).toBe(1);
    const e = entry(buildCharacter(b, db), 'sorcerer-dedication-casting');
    expect(e.type).toBe('spontaneous');
    expect(e.cantripsPrepared).toBeUndefined();
  });
});

describe('Adaptive Adept: the answer reaches the class entry', () => {
  const adeptFrom = () => db.feats['adaptive-adept'].choice!.from!;

  it('the record is no longer inert, and says what it does', () => {
    const ch = db.feats['adaptive-adept'].choice!;
    expect(ch.inert).toBeUndefined();
    expect(ch.from).toMatchObject({ type: 'spell', maxRank: 1, sameTraditionAsAnswerOf: 'adapted-cantrip', grantToClassEntry: true });
  });

  // mutation-proof
  it('the picker offers only cantrips and 1st-rank spells of the Adapted Cantrip answer\'s tradition — not that cantrip again', () => {
    const b = withChain(cleric5(), 'electric-arc');
    const ids = openChoiceOptions(adeptFrom(), db, { character: buildCharacter(b, db) }).map((o) => o.id);
    expect(ids.length, 'never emptied').toBeGreaterThan(50);
    for (const id of ids) {
      expect(db.spells[id].rank, id).toBeLessThanOrEqual(1);
      expect(db.spells[id].traditions.some((t) => t === 'arcane' || t === 'primal'), `${id} shares a tradition with electric arc`).toBe(true);
    }
    expect(ids).toEqual(expect.arrayContaining(['grease', 'ignition', 'heal']));
    expect(ids, 'divine and occult only').not.toContain('bless');
    expect(ids, 'the Adapted Cantrip answer itself').not.toContain('electric-arc');
    // No Adapted Cantrip answer yet: nothing narrowed.
    const unanswered = openChoiceOptions(adeptFrom(), db, { character: buildCharacter(cleric5(), db) }).map((o) => o.id);
    expect(unanswered).toContain('bless');
    // The planted bad case: the descriptor without its tradition hold — bless comes back.
    const from = adeptFrom() as { sameTraditionAsAnswerOf?: string };
    const saved = from.sameTraditionAsAnswerOf;
    delete from.sameTraditionAsAnswerOf;
    try {
      expect(openChoiceOptions(adeptFrom(), db, { character: buildCharacter(b, db) }).map((o) => o.id)).toContain('bless');
    } finally {
      from.sameTraditionAsAnswerOf = saved;
    }
  });

  // mutation-proof
  it('a PREPARED class (cleric): a 1st-rank answer is on the list its slots prepare from — at 1st rank only', () => {
    const b = withChain(cleric5(), 'electric-arc', 'grease');
    const ch = buildCharacter(b, db);
    const e = entry(ch, 'cleric-casting');
    expect(ch.spellListAdditions?.['cleric-casting']).toContain('grease');
    expect(e.spellSources?.grease).toBe('Adaptive Adept');
    expect(e.noHeighten).toEqual(['grease']);
    expect(offered(ch, 'cleric-casting', 1), 'a 1st-rank slot').toContain('grease');
    expect(offered(ch, 'cleric-casting', 2), 'a 2nd-rank slot: no heightened grease').not.toContain('grease');
    expect(offered(ch, 'cleric-casting', 3), 'a 3rd-rank slot').not.toContain('grease');
    expect(offered(ch, 'cleric-casting', 2), "control: the cleric's own heal still heightens").toContain('heal');
    const morning = setPreparedSpell(initialPlay(ch, db), 'cleric-casting', 1, 0, 'grease');
    expect(entry(sheetOf(ch, morning), 'cleric-casting').prepared?.[1]?.[0]?.spellId, 'prepared and drawn').toBe('grease');
    // The planted bad case: the entry without its at-rank-only list — grease heightens again.
    const bad = structuredClone(e);
    delete bad.noHeighten;
    expect(spellOptions({ character: ch, entry: bad, content: db }, 2).map((s) => s.id)).toContain('grease');
    // A spell the cleric's own list already offers (heal is divine) widens nothing and gets no label.
    const healCh = buildCharacter(withChain(cleric5(), 'electric-arc', 'heal'), db);
    expect(healCh.spellListAdditions?.['cleric-casting'] ?? []).not.toContain('heal');
    expect(entry(healCh, 'cleric-casting').spellSources?.heal).toBeUndefined();
    expect(entry(healCh, 'cleric-casting').noHeighten).toBeUndefined();
  });

  it('a prepared class with every opening filled: a CANTRIP answer is an option, not drawn on top', () => {
    const plain = cleric5();
    const cap = entry(buildCharacter(plain, db), 'cleric-casting').cantripCap!;
    const picks = onTradition('divine').slice(0, cap);
    const ch = buildCharacter(withChain({ ...plain, cantrips: picks }, 'electric-arc', 'ignition'), db);
    expect(entry(ch, 'cleric-casting').cantrips).toEqual(picks);
    expect(ch.spellListAdditions?.['cleric-casting']).toEqual(expect.arrayContaining(['electric-arc', 'ignition']));
    expect(offered(ch, 'cleric-casting', 0)).toContain('ignition');
  });

  it('a BOOK caster (wizard): the 1st-rank answer goes into the spellbook, at 1st rank only, never read back as a pick', () => {
    const b = withChain(wizard(5, { spells: { 1: ['force-barrage'] } }), 'divine-lance', 'bless');
    const ch = buildCharacter(b, db);
    const e = entry(ch, 'wizard-casting');
    expect(e.spellbook?.[1]).toContain('bless');
    expect(e.grantedRepertoire?.[1]).toContain('bless');
    expect(e.spellSources?.bless).toBe('Adaptive Adept');
    expect(offered(ch, 'wizard-casting', 1)).toContain('bless');
    expect(offered(ch, 'wizard-casting', 2)).not.toContain('bless');
    expect(deriveBuildFromCharacter(ch, db).spells[1]).toEqual(['force-barrage']);
  });

  // mutation-proof
  it('a REPERTOIRE (sorcerer): known for free — no place spent — and never a signature spell', () => {
    const base = pc('sorcerer', 5, { keyAbility: 'cha' });
    const tradition = entry(buildCharacter(base, db), 'sorcerer-casting').tradition;
    expect(tradition, 'fixture: the default bloodline is occult').toBe('occult');
    const ch = buildCharacter(withChain(base, 'electric-arc', 'grease'), db);
    const e = entry(ch, 'sorcerer-casting');
    expect(e.repertoire?.[1]).toContain('grease');
    expect(e.grantedRepertoire?.[1], 'granted: it spends none of the rank\'s places').toContain('grease');
    expect(e.signatureBarred).toEqual(['grease']);
    expect(e.spellSources?.grease).toBe('Adaptive Adept');
    expect(deriveBuildFromCharacter(ch, db).spells[1] ?? [], 'never read back as a pick').not.toContain('grease');
    // …barred whatever its list: force barrage is arcane AND occult (the sorcerer's own), still the feat's spell.
    const fb = entry(buildCharacter(withChain(base, 'electric-arc', 'force-barrage'), db), 'sorcerer-casting');
    expect(fb.grantedRepertoire?.[1]).toContain('force-barrage');
    expect(fb.signatureBarred).toEqual(['force-barrage']);
    // A cantrip answer: "you gain that spell" — one MORE cantrip, not a swap.
    const plainCount = entry(buildCharacter(withChain(base, 'electric-arc'), db), 'sorcerer-casting').cantrips.length;
    const withCantrip = entry(buildCharacter(withChain(base, 'electric-arc', 'ignition'), db), 'sorcerer-casting');
    expect(withCantrip.cantrips).toContain('ignition');
    expect(withCantrip.cantrips).toHaveLength(plainCount + 1);
    // The planted bad case: grease known with nothing saying a feat put it there — the reverse build then
    // reads it back as one of the player's own picks, so the assertion above tells the two apart.
    const bad = structuredClone(ch);
    delete entry(bad, 'sorcerer-casting').spellSources;
    expect(deriveBuildFromCharacter(bad, db).spells[1]).toContain('grease');
  });

  // mutation-proof
  it("a sorcerer's Adaptive Adept spell is not a second bloodline gift (checker finding)", () => {
    const e = entry(buildCharacter(withChain(pc('sorcerer', 5, { keyAbility: 'cha' }), 'electric-arc', 'grease'), db), 'sorcerer-casting');
    expect(e.grantsCountInside, 'fixture: the sorcerer counts its gift inside its places').toBe(true);
    expect(e.grantedRepertoire?.[1], 'fixture: the bloodline gift and grease').toEqual(expect.arrayContaining(['grease']));
    expect(variantGiftCount(e, 1), 'one gift at 1st rank, not "only one of these 2"').toBe(0);
    expect(giftChipIds(e, 1, []), 'no locked gift chip for grease').not.toContain('grease');
    // The planted bad case: grease without its "from" record reads as a second gift again.
    const bad = structuredClone(e);
    delete bad.spellSources;
    expect(variantGiftCount(bad, 1)).toBe(2);
  });

  it('the reverse build keeps the player\'s own pick of the same spell at another rank (checker finding)', () => {
    // force barrage is arcane AND occult: on the aberrant sorcerer's own list, learned heightened at 3rd.
    const b = withChain(pc('sorcerer', 5, { keyAbility: 'cha', spells: { 3: ['force-barrage'] } }), 'electric-arc', 'force-barrage');
    const ch = buildCharacter(b, db);
    expect(entry(ch, 'sorcerer-casting').repertoire?.[3], 'fixture: the player knows it at 3rd').toContain('force-barrage');
    expect(entry(ch, 'sorcerer-casting').grantedRepertoire?.[1], 'fixture: the feat gives it at 1st').toContain('force-barrage');
    const back = deriveBuildFromCharacter(ch, db).spells;
    expect(back[3], 'the 3rd-rank pick stays the player\'s').toContain('force-barrage');
    expect(back[1] ?? [], 'the feat\'s 1st-rank copy is not a pick').not.toContain('force-barrage');
  });

  it('a spell another widening already lists (a cleric of Otolmens: sure strike) keeps heightening and gets no label (checker finding)', () => {
    expect(db.deities.otolmens?.spells, 'fixture: sure strike is a deity spell').toContain('sure-strike');
    const b = withChain({ ...cleric5(), deityId: 'otolmens' } as BuildState, 'telekinetic-projectile', 'sure-strike');
    const ch = buildCharacter(b, db);
    expect(ch.spellListAdditions?.['cleric-casting'] ?? ch.spellListAdditions?.['*'] ?? [], 'fixture: the deity lists it').toContain('sure-strike');
    const e = entry(ch, 'cleric-casting');
    expect(e.noHeighten ?? []).not.toContain('sure-strike');
    expect(e.spellSources?.['sure-strike']).toBeUndefined();
    expect(offered(ch, 'cleric-casting', 2), 'heightened in a 2nd-rank slot, as a deity spell always was').toContain('sure-strike');
  });

  it('a Flexible Spellcaster prepares its collection: the 1st-rank answer is an option, not a free known spell (checker finding)', () => {
    const b = withChain(pc('cleric', 5, { keyAbility: 'wis', subclassId: 'cloistered-cleric', featPicks: { '2:class:0': 'flexible-spellcaster-dedication' } }), 'electric-arc', 'grease');
    const ch = buildCharacter(b, db);
    const e = entry(ch, 'cleric-casting');
    expect(e.spellCollection, 'fixture: a flexible collection').toBeGreaterThan(0);
    expect(Object.values(e.repertoire ?? {}).flat(), 'not known for free').not.toContain('grease');
    expect(ch.spellListAdditions?.['cleric-casting']).toContain('grease');
    expect(e.noHeighten).toEqual(['grease']);
  });

  it('a Flexible Spellcaster who COLLECTS the feat\'s spell does not get it as a signature spell (final check)', () => {
    const b = withChain(
      pc('cleric', 6, { keyAbility: 'wis', subclassId: 'cloistered-cleric', featPicks: { '2:class:0': 'flexible-spellcaster-dedication' }, spells: { 1: ['grease', 'heal'] } }),
      'electric-arc',
      'grease',
    );
    const e = entry(buildCharacter(b, db), 'cleric-casting');
    expect(Object.values(e.repertoire ?? {}).flat(), 'fixture: grease is collected').toContain('grease');
    expect(e.signature ?? [], 'collected spells are signature spells…').toContain('heal');
    expect(e.signature ?? [], '…but not the feat\'s, which print never heightens').not.toContain('grease');
    expect(e.signatureFixed ?? []).not.toContain('grease');
    expect(e.signatureBarred).toEqual(['grease']);
  });

  it('a list a class archetype REPLACED is the list that counts (Elementalist wizard: command is arcane, not elemental)', () => {
    const b = withChain(wizard(8, { featPicks: { '2:class:0': 'elementalist-dedication' }, effectChoices: { 'elementalist-dedication:elemental-philosophy': 'inner-sea' } }), 'divine-lance', 'command');
    const ch = buildCharacter(b, db);
    expect(ch.spellListReplacement?.entryId, 'fixture: the wizard prepares from the elemental list').toBe('wizard-casting');
    const e = entry(ch, 'wizard-casting');
    expect(e.spellbook?.[1], 'into the book').toContain('command');
    expect(e.noHeighten, 'held to its rank: the elemental list does not offer it').toEqual(['command']);
    expect(offered(ch, 'wizard-casting', 1)).toContain('command');
    expect(offered(ch, 'wizard-casting', 2)).not.toContain('command');
  });

  it("a dedication's repertoire: the feat's spell is never read back as the pool's own pick (final check)", () => {
    const b = withChain(
      fighter(8, { featPicks: { '2:class:0': 'sorcerer-dedication', '4:class:1': 'basic-sorcerer-spellcasting' }, cantrips: ['detect-magic'], spells: { 1: ['force-barrage'] } }),
      'divine-lance',
      'bless',
    );
    const ch = buildCharacter(b, db);
    const e = entry(ch, 'sorcerer-dedication-casting');
    expect(e.grantedRepertoire?.[1], 'fixture: bless granted at 1st').toContain('bless');
    expect(deriveBuildFromCharacter(ch, db).spells[1]).toEqual(['force-barrage']);
  });

  it('the same spell as the Adapted Cantrip answer is refused with its own reason (final check)', () => {
    const ch = buildCharacter(withChain(cleric5(), 'electric-arc', 'electric-arc'), db);
    const w = ch.effectWarnings?.find((x) => x.source === 'Adaptive Adept');
    expect(w?.message).toBe('Electric Arc is already your Adapted Cantrip cantrip — choose another spell in the builder.');
  });

  // mutation-proof
  it('a ★ the player stored on the spell BEFORE the feat granted it is not drawn (final check)', () => {
    const ch = buildCharacter(withChain(pc('sorcerer', 7, { keyAbility: 'cha' }), 'electric-arc', 'grease'), db);
    const play = { ...initialPlay(ch, db), signatureSpells: { 'sorcerer-casting': ['grease'] } } as PlayState;
    expect(entry(sheetOf(ch, play), 'sorcerer-casting').signature ?? []).not.toContain('grease');
    // The planted bad case: the same character without the bar — the stored ★ is drawn again.
    const bad = structuredClone(ch);
    delete entry(bad, 'sorcerer-casting').signatureBarred;
    expect(entry(sheetOf(bad, play), 'sorcerer-casting').signature ?? []).toContain('grease');
  });

  it('a stored answer the picker would refuse is not granted, and the warning says why', () => {
    const ch = buildCharacter(withChain(cleric5(), 'electric-arc', 'bless'), db);
    expect(ch.spellListAdditions?.['cleric-casting'] ?? []).not.toContain('bless');
    expect(entry(ch, 'cleric-casting').spellSources?.bless).toBeUndefined();
    expect(ch.effectWarnings?.some((w) => w.source === 'Adaptive Adept' && /Bless/.test(w.message))).toBe(true);
    expect(ch.feats.find((f) => f.featId === 'adaptive-adept')?.choice?.value, 'the pick stays stored').toBe('bless');
    // …and the builder's picker keeps it on offer in its own slot (`keep`), saying why it no longer fits.
    const kept = openChoiceOptions(db.feats['adaptive-adept'].choice!.from, db, { character: ch, keep: ['bless'] }).find((o) => o.id === 'bless');
    expect(kept?.note).toBe("1 rank · not from your Adapted Cantrip cantrip's tradition — choose again");
    expect(kept?.notAllowed).toBe('Bless is not from the tradition of your Adapted Cantrip cantrip — choose again.');
    const same = openChoiceOptions(db.feats['adaptive-adept'].choice!.from, db, { character: ch, keep: ['electric-arc'] }).find((o) => o.id === 'electric-arc');
    expect(same?.notAllowed).toBe('Electric Arc is already your Adapted Cantrip cantrip — choose another.');
  });

  it('in the app as shipped (trust gate on) the answer still reaches the class', () => {
    const gated: ContentDatabase = content({ trustGate: true });
    const ch = buildCharacter(withChain(cleric5(), 'electric-arc', 'grease'), gated);
    expect(ch.spellListAdditions?.['cleric-casting']).toContain('grease');
  });
});
