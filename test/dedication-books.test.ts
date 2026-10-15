import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import {
  archetypeCantripCounts,
  archetypeTradition,
  buildCharacter,
  deriveBuildFromCharacter,
  emptyBuild,
  type BuildState,
} from '../src/rules/build';
import {
  activeCasterArchetype,
  archetypeBook,
  archetypeBookMaxRank,
  archetypeBookRanks,
  archetypeSlots,
  CASTER_ARCHETYPES,
  type CasterArchetype,
} from '../src/rules/casterArchetypes';
import { applyPlayState, initialPlay, learnSpell, setPreparedCantrip, setPreparedSpell, type PlayState } from '../src/rules/play';
import { pickerSpellOptions, spellOptions } from '../src/rules/spellOptions';
import { enabledBookSet } from '../src/rules/sources';
import type { Character, SkillId, SpellcastingEntry } from '../src/rules/types';

/**
 * ARCHETYPE DEDICATION BOOKS — owner, 2026-10-15:
 *
 * > "archetype dedication spellbooks — Wizard, Witch, Magus, Necromancer, Hedge Mage and Spellshot
 * > Dedication characters should prepare spells only from their own small book, the same rules the
 * > class casters got in d01fe33"
 *
 * Print (newest printing, R12):
 *   · Wizard Dedication — *"a spellbook with four common arcane cantrips of your choice … You can prepare
 *     two cantrips each day from your spellbook"*; Basic Wizard Spellcasting — *"add two common spells of
 *     that rank to your spellbook"*. Spellshot Dedication prints the same book and borrows Basic Wizard
 *     Spellcasting (*"This counts as the wizard archetype for the benefits of Basic Wizard Spellcasting"*).
 *   · Witch Dedication — *"a familiar with two common cantrips … You can prepare one cantrip each day from
 *     your familiar"*; Basic — *"two common spells of that rank to your familiar"*.
 *   · Magus Dedication — four, prepare two; Basic — *"two common spells of that rank or lower"*.
 *   · Necromancer Dedication — *"a dirge with four common occult cantrips"*; Basic — *"…or lower to your dirge"*.
 *   · Hedge Mage Dedication — *"Your keepsake holds 4 common cantrips"*; Basic — *"add three common
 *     1st-rank spells to your keepsake"*; Expert / Master — *"you can choose 2nd-rank"* / *"3rd-rank spells"*.
 *
 * What this file holds (ENGINE side; the builder rows are test/book-cantrips-ui-style tests elsewhere):
 *   a) every number in `CasterArchetype.book` against the record's own sentence, and the six as the
 *      complete set — a seventh feat anywhere in the data printing a book with no `book` fails the scan;
 *   b) the built entry's book shape for each of the six (bookCantrips / cantrips / cantripCap /
 *      cantripsPrepared / bookNoun / spellbook / prepared / the keepsake's bookMaxRank by tier);
 *   c) the sheet's picker adds ONLY out of the book, an empty leveled book offers nothing;
 *   d) a stored sheet pick off the book is drawn and marked, never hidden;
 *   e) old saves draw exactly what they drew before (a per-slot repeat included);
 *   f) Peer Past the Hedge's detect magic goes INTO the keepsake (preparable), not on top of the two;
 *   g) Cantrip Supremacy (12 prepared / 14 in the keepsake), Cantrip Expansion on a fighter (all four
 *      picks drawn), Adapted Cantrip as one more book option (its `-1` not charged), and the untargeted
 *      bonus NOT on an archetype beside a caster class;
 *   h) Hedge Mage's tradition follows the skill, in buildCharacter and the shared `archetypeTradition`;
 *   i) the reverse build gives the whole book back, grants stripped, into the right store;
 *   j) negative controls — every archetype without a printed book is untouched;
 *   k) Learn a Spell into an archetype book is merged and becomes preparable.
 *
 * Fixtures are synthetic ("TEST …"), never an owner's character.
 *
 * MUTATION-PROVED (planted in memory, restored in `finally`): deleting a dedication's `book` makes the
 * picker offer the tradition again (c), leaves an old save's preparation unchanged (e — the proof that
 * the book changes nothing a save already drew), and the print matcher catches a changed `holds` /
 * `perRank` / `rankRule` / tier cap (a); deleting `traditionBySkill` moves a Nature hedge mage off
 * primal (h); stripping the book off a built entry loses book cantrips 3-4 in the reverse build (i).
 */
const db = content();
/** Core plus the books these dedications print in, so the narrowing is measured against a WIDE list. */
const BOOKS = new Set([
  ...enabledBookSet(undefined),
  'Pathfinder Player Core 2',
  'Pathfinder Impossible Magic',
  'Pathfinder Guns & Gears',
  'Pathfinder Rage of Elements',
]);

const SIX = ['wizard-dedication', 'witch-dedication', 'magus-dedication', 'necromancer-dedication', 'hedge-mage-dedication', 'spellshot-dedication'];
const ARCANE4 = ['detect-magic', 'light', 'shield', 'electric-arc'];

/** A synthetic martial (no class spellcasting) at `level`, so the dedication's pool is the character's only caster. */
const fighter = (level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST dedication book',
    level,
    classId: 'fighter',
    keyAbility: 'str',
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    subclassId: null,
    ...over,
  }) as BuildState;
/** A synthetic cleric — a caster class, so the dedication's pool lives in `build.archetypeSpells`. */
const cleric = (level: number, over: Partial<BuildState> = {}): BuildState =>
  fighter(level, { classId: 'cleric', keyAbility: 'wis', subclassId: db.classes.cleric?.subclass?.options[0]?.id ?? null, ...over });
const asStore = (cantrips: string[], spells: Record<number, string[]> = {}) =>
  ({ cantrips, spells, tradition: null, keyAbility: null }) as unknown as BuildState['archetypeSpells'];

interface Fx {
  ded: string;
  entryId: string;
  noun: string;
  prepared: number;
  cantrips: string[];
  spells: Record<number, string[]>;
  make: (over?: Partial<BuildState>) => BuildState;
}
const BASIC: Record<string, string> = {
  'wizard-dedication': 'basic-wizard-spellcasting',
  'witch-dedication': 'basic-witch-spellcasting',
  'magus-dedication': 'basic-magus-spellcasting',
  'necromancer-dedication': 'basic-necromancer-spellcasting',
  'hedge-mage-dedication': 'basic-hedge-mage-spellcasting',
};
/** Level 6, Basic at 4th: the book has grown at ranks 1 and 2. Each list is the book's full cantrip count. */
const fx = (ded: string, noun: string, prepared: number, cantrips: string[], spells: Record<number, string[]>, extra: Partial<BuildState> = {}): Fx => ({
  ded,
  entryId: `${ded}-casting`,
  noun,
  prepared,
  cantrips,
  spells,
  make: (over = {}) =>
    ded === 'spellshot-dedication'
      ? fighter(6, {
          classId: 'gunslinger',
          keyAbility: 'dex',
          subclassId: 'way-of-the-spellshot',
          featPicks: { '2:class': 'spellshot-dedication', '4:class': 'basic-wizard-spellcasting' },
          cantrips,
          spells,
          ...extra,
          ...over,
        })
      : fighter(6, { featPicks: { '2:class:0': ded, '4:class:1': BASIC[ded] }, cantrips, spells, ...extra, ...over }),
});
const FX: Fx[] = [
  fx('wizard-dedication', 'spellbook', 2, ARCANE4, { 1: ['grease', 'force-barrage'], 2: ['invisibility', 'see-the-unseen'] }),
  fx('witch-dedication', 'familiar', 1, ['daze', 'shield'], { 1: ['fear', 'command'], 2: ['invisibility', 'see-the-unseen'] }),
  // "of that rank or lower": the 2nd-rank page holds a 1st-rank spell.
  fx('magus-dedication', 'spellbook', 2, ARCANE4, { 1: ['grease', 'sure-strike'], 2: ['force-barrage', 'invisibility'] }),
  fx('necromancer-dedication', 'dirge', 2, ['daze', 'shield', 'light', 'void-warp'], { 1: ['fear', 'command'], 2: ['phantom-pain', 'invisibility'] }),
  // Basic only: every page of the keepsake holds 1st-rank spells, three a page.
  fx('hedge-mage-dedication', 'keepsake', 2, ['light', 'shield', 'electric-arc', 'frostbite'], { 1: ['grease', 'force-barrage', 'sure-strike'], 2: ['mystic-armor', 'fleet-step', 'gust-of-wind'] }, {
    featSkillChoices: { 'hedge-mage-dedication:0': 'arcana' },
  }),
  fx('spellshot-dedication', 'spellbook', 2, ARCANE4, { 1: ['grease', 'force-barrage'], 2: ['invisibility', 'see-the-unseen'] }),
];

const entryOf = (ch: Character, id: string): SpellcastingEntry | undefined => ch.spellcasting.find((e) => e.id === id);
const shown = (ch: Character, id: string, play: PlayState = initialPlay(ch, db)): SpellcastingEntry => entryOf(applyPlayState(ch, play, db), id)!;
/** The sheet's picker on the overlay (SpellsTab's own call); `keep` is the asking cantrip opening's pick. */
const offered = (ch: Character, id: string, rank: number, play: PlayState = initialPlay(ch, db), keep?: string | null): string[] => {
  const ov = applyPlayState(ch, play, db);
  return pickerSpellOptions({ character: ov, entry: entryOf(ov, id)!, content: db }, rank, undefined, BOOKS, keep).map((s) => s.id);
};
const rendered = (ch: Character, id: string, rank: number): string[] => {
  const ov = applyPlayState(ch, initialPlay(ch, db), db);
  return spellOptions({ character: ov, entry: entryOf(ov, id)!, content: db }, rank).map((s) => s.id);
};
const sorted = (xs: Iterable<string>) => [...xs].sort();
const featIdsOf = (b: BuildState) => Object.values(b.featPicks ?? {}).filter((v): v is string => !!v);
/** Run `fn` with `CASTER_ARCHETYPES[ded].book` removed (the code before the dedication books), then restore it. */
const withoutBook = <T,>(ded: string, fn: () => T): T => {
  const saved = CASTER_ARCHETYPES[ded].book;
  delete CASTER_ARCHETYPES[ded].book;
  try {
    return fn();
  } finally {
    CASTER_ARCHETYPES[ded].book = saved;
  }
};

/* ------------------------------------------------------------------------------------------------ */
/* a) PRINT                                                                                          */
/* ------------------------------------------------------------------------------------------------ */

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (w: string) => WORDS[w.toLowerCase()] ?? Number(w);
/** The record's own text (core.json `description`, merged back from core-descriptions.json by content()),
 *  whitespace folded and the non-breaking hyphens (U+2010-U+2013: "1st‑rank" in Basic Hedge Mage) made plain. */
const text = (id: string | undefined) =>
  String((id && db.feats[id]?.description) ?? '')
    .replace(/\s+/g, ' ')
    .replace(/[‐-–]/g, '-');
const BOOK_SENTENCE = /\b(spellbook|familiar|dirge|keepsake) (?:with|holds) (\d+|[a-z]+) common\b/i;

/** The checker, as a function, so the planted-bad-case leg runs the very same code. */
function printMismatches(ded: string, cfg: CasterArchetype): string[] {
  const out: string[] = [];
  const book = cfg.book;
  const dedText = text(ded);
  const b = BOOK_SENTENCE.exec(dedText);
  if (!book) return b ? [`${ded}: prints a book ("${b[0]}") but carries no \`book\``] : [];
  if (!b) return [`${ded}: carries a book but its record prints no book sentence this guard can read`];
  if (b[1].toLowerCase() !== book.noun) out.push(`${ded}: book noun ${book.noun}, print says ${b[1]}`);
  if (num(b[2]) !== book.holds) out.push(`${ded}: book holds ${book.holds} cantrips, print says ${num(b[2])} ("${b[0]}")`);
  const p = /\bprepare (\d+|[a-z]+) cantrips? (?:each day )?from your (spellbook|familiar|dirge|keepsake)/i.exec(dedText);
  if (!p) out.push(`${ded}: no "prepare N cantrips … from your <book>" sentence`);
  else {
    if (num(p[1]) !== cfg.cantrips) out.push(`${ded}: prepares ${cfg.cantrips} cantrips, print says ${num(p[1])}`);
    if (p[2].toLowerCase() !== book.noun) out.push(`${ded}: prepares from your ${p[2]}, book noun is ${book.noun}`);
  }
  const basicText = text(cfg.basicId);
  const s = /\badd (\d+|[a-z]+) common (?:spells of that rank( or lower)?|(\d+)(?:st|nd|rd|th)-rank spells) to your (spellbook|familiar|dirge|keepsake)/i.exec(basicText);
  if (!s) out.push(`${ded}: ${cfg.basicId} prints no "add N common spells … to your <book>" sentence`);
  else {
    if (num(s[1]) !== book.perRank) out.push(`${ded}: adds ${book.perRank} a rank, ${cfg.basicId} says ${num(s[1])} ("${s[0]}")`);
    if (s[4].toLowerCase() !== book.noun) out.push(`${ded}: ${cfg.basicId} adds to your ${s[4]}, book noun is ${book.noun}`);
    if (s[3]) {
      // A fixed rank (Hedge Mage's "three common 1st-rank spells"): the cap at Basic is that rank, and a
      // 1st-rank pick stays legal at every later rank — "of that rank or lower" in effect.
      if (book.maxRankByTier?.basic !== Number(s[3])) out.push(`${ded}: Basic cap ${book.maxRankByTier?.basic}, print says ${s[3]}`);
      if (book.rankRule !== 'orLower') out.push(`${ded}: a fixed-rank Basic sentence needs rankRule orLower, has ${book.rankRule}`);
    } else {
      const rule = s[2] ? 'orLower' : 'exact';
      if (rule !== book.rankRule) out.push(`${ded}: rankRule ${book.rankRule}, ${cfg.basicId} says ${rule} ("${s[0]}")`);
      if (book.maxRankByTier) out.push(`${ded}: caps the book by tier, but ${cfg.basicId} prints no fixed rank`);
    }
  }
  // Expert / Master: "When you add spells to your keepsake … you can choose 2nd-rank spells" (Hedge Mage).
  for (const [tier, fid] of [['expert', cfg.expertId], ['master', cfg.masterId]] as const) {
    if (!fid) continue;
    const c = /\byou can choose (\d+)(?:st|nd|rd|th)-rank spells/i.exec(text(fid));
    const printed = c ? Number(c[1]) : undefined;
    if (printed !== book.maxRankByTier?.[tier]) out.push(`${ded}: ${tier} cap ${book.maxRankByTier?.[tier]}, ${fid} says ${printed}`);
  }
  return out;
}

describe('a) the six books are the size their records print', () => {
  it('every number in CasterArchetype.book matches the dedication\'s and the Basic feat\'s own sentence — and the six are the complete set', () => {
    // The six, named, so a dedication dropping out of the table cannot pass quietly…
    expect(sorted(Object.entries(CASTER_ARCHETYPES).filter(([, c]) => c.book).map(([id]) => id))).toEqual(sorted(SIX));
    // …and the scan runs over EVERY caster archetype: one printing a book sentence with no `book` fails.
    const found = Object.entries(CASTER_ARCHETYPES).flatMap(([id, cfg]) => printMismatches(id, cfg));
    expect(found).toEqual([]);
    // …and over every FEAT in the data: a dedication printing a book that is not a caster archetype at all
    // (so the loop above never reads it) fails here. Measured 2026-10-15: exactly these six print one.
    expect(sorted(Object.keys(db.feats).filter((id) => BOOK_SENTENCE.test(text(id))))).toEqual(sorted(SIX));
    // The numbers, spelled out against print.
    const b = (id: string) => CASTER_ARCHETYPES[id].book!;
    expect([b('wizard-dedication'), b('magus-dedication'), b('spellshot-dedication')].map((x) => [x.noun, x.holds, x.perRank])).toEqual([
      ['spellbook', 4, 2],
      ['spellbook', 4, 2],
      ['spellbook', 4, 2],
    ]);
    expect(text('wizard-dedication')).toContain('spellbook with four common arcane cantrips');
    expect(text('spellshot-dedication')).toContain('spellbook with four common arcane cantrips');
    expect(text('magus-dedication')).toContain('spellbook with four common arcane cantrips');
    expect([b('witch-dedication').noun, b('witch-dedication').holds, CASTER_ARCHETYPES['witch-dedication'].cantrips]).toEqual(['familiar', 2, 1]);
    expect(text('witch-dedication')).toContain('familiar with two common cantrips');
    expect([b('necromancer-dedication').noun, b('necromancer-dedication').holds]).toEqual(['dirge', 4]);
    expect(text('necromancer-dedication')).toContain('dirge with four common occult cantrips');
    expect([b('hedge-mage-dedication').noun, b('hedge-mage-dedication').holds, b('hedge-mage-dedication').perRank]).toEqual(['keepsake', 4, 3]);
    expect(text('hedge-mage-dedication')).toContain('keepsake holds 4 common cantrips');
    // The Basic sentences, rank rule included.
    expect(text('basic-wizard-spellcasting')).toContain('add two common spells of that rank to your spellbook');
    expect(b('wizard-dedication').rankRule).toBe('exact');
    expect(text('basic-witch-spellcasting')).toContain('add two common spells of that rank to your familiar');
    expect(b('witch-dedication').rankRule).toBe('exact');
    expect(text('basic-magus-spellcasting')).toContain('add two common spells of that rank or lower to your spellbook');
    expect(b('magus-dedication').rankRule).toBe('orLower');
    expect(text('basic-necromancer-spellcasting')).toContain('add two common spells of that rank or lower to your dirge');
    expect(b('necromancer-dedication').rankRule).toBe('orLower');
    // The keepsake's sentence carries a U+2011 non-breaking hyphen in the record; the guard reads through it.
    expect(String(db.feats['basic-hedge-mage-spellcasting']?.description)).toMatch(/1st[-‑]rank spells to your keepsake/);
    expect(text('basic-hedge-mage-spellcasting')).toContain('add three common 1st-rank spells to your keepsake');
    expect(text('expert-hedge-mage-spellcasting')).toContain('you can choose 2nd-rank spells');
    expect(text('master-hedge-mage-spellcasting')).toContain('you can choose 3rd-rank spells');
    expect(b('hedge-mage-dedication').maxRankByTier).toEqual({ basic: 1, expert: 2, master: 3 });
    // Spellshot borrows Basic Wizard Spellcasting's sentence — and has no master rung to cap.
    expect(CASTER_ARCHETYPES['spellshot-dedication'].basicId).toBe('basic-wizard-spellcasting');
    expect(text('spellshot-dedication')).toContain('counts as the wizard archetype for the benefits of Basic Wizard Spellcasting');
    expect(b('spellshot-dedication')).toEqual(b('wizard-dedication'));
  });

  // mutation-proof
  it('…and the matcher is not blind: a changed size, rate, rank rule, tier cap or a missing book each fails it', () => {
    const cfg = (id: string) => CASTER_ARCHETYPES[id];
    const planted = (id: string, book: Partial<NonNullable<CasterArchetype['book']>> | null) =>
      printMismatches(id, { ...cfg(id), book: book === null ? undefined : { ...cfg(id).book!, ...book } });
    expect(planted('wizard-dedication', { holds: 5 }).some((m) => m.includes('book holds 5 cantrips, print says 4'))).toBe(true);
    expect(planted('witch-dedication', { holds: 4 }).some((m) => m.includes('book holds 4 cantrips, print says 2'))).toBe(true);
    expect(planted('hedge-mage-dedication', { perRank: 2 }).some((m) => m.includes('adds 2 a rank'))).toBe(true);
    expect(planted('wizard-dedication', { rankRule: 'orLower' }).some((m) => m.includes('rankRule orLower'))).toBe(true);
    expect(planted('necromancer-dedication', { rankRule: 'exact' }).some((m) => m.includes('rankRule exact'))).toBe(true);
    expect(planted('necromancer-dedication', { noun: 'spellbook' }).some((m) => m.includes('book noun spellbook, print says dirge'))).toBe(true);
    expect(planted('hedge-mage-dedication', { maxRankByTier: { basic: 1, expert: 3, master: 3 } }).some((m) => m.includes('expert cap 3'))).toBe(true);
    expect(planted('hedge-mage-dedication', { maxRankByTier: undefined }).length).toBeGreaterThan(0);
    // A dedication that prints a book but lost its `book` is caught by the scan's other half.
    expect(planted('magus-dedication', null)).toEqual([expect.stringContaining('prints a book')]);
    // …and the true table passes the same function (the leg above is the shipped data).
    for (const id of SIX) expect(printMismatches(id, cfg(id)), id).toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* b) THE BUILT ENTRY                                                                                */
/* ------------------------------------------------------------------------------------------------ */

describe('b) each of the six builds a book, the class book casters\' shape', () => {
  for (const f of FX) {
    it(`${f.ded}: the ${f.noun} holds every pick, the first ${f.prepared} are prepared, its pages are the leveled picks`, () => {
      const ch = buildCharacter(f.make(), db);
      const e = entryOf(ch, f.entryId);
      expect(e, `${f.entryId} is built`).toBeDefined();
      expect(f.cantrips.length, 'fixture: a full book of cantrips').toBe(CASTER_ARCHETYPES[f.ded].book!.holds);
      // Fixture sanity: every pick is on the entry's own tradition, so nothing below is a tradition filter.
      for (const id of [...f.cantrips, ...Object.values(f.spells).flat()])
        expect(db.spells[id]?.traditions, `fixture: ${id} is ${e!.tradition}`).toContain(e!.tradition);
      expect(e!.type).toBe('prepared');
      expect(e!.bookNoun).toBe(f.noun);
      expect(e!.bookCantrips, 'the whole book').toEqual(f.cantrips);
      expect(e!.cantrips, 'the standing preparation').toEqual(f.cantrips.slice(0, f.prepared));
      expect(e!.cantripCap).toBe(f.prepared);
      expect(e!.cantripsPrepared).toBe(true);
      expect(e!.spellbook).toEqual({ 1: f.spells[1], 2: f.spells[2] });
      expect(e!.prepared?.[1]?.map((s) => s.spellId), 'one 1st-rank slot, filled from the own list').toEqual([f.spells[1][0]]);
      expect(e!.prepared?.[2]?.map((s) => s.spellId), 'one 2nd-rank slot, filled from the own list').toEqual([f.spells[2][0]]);
      // Only the keepsake caps its ranks below the slots.
      if (f.ded === 'hedge-mage-dedication') expect(e!.bookMaxRank).toBe(1);
      else expect(e!.bookMaxRank).toBeUndefined();
      // The overlay draws the same standing preparation, nothing marked.
      const s = shown(ch, f.entryId);
      expect(s.cantripSlots).toEqual(f.cantrips.slice(0, f.prepared));
      expect(s.notInBook).toBeUndefined();
    });
  }

  it('the keepsake\'s highest rank follows the tier: 0 with the dedication alone, 1 at Basic, 2 with Expert (12th), 3 with Master (18th)', () => {
    const hedge = (level: number, picks: Record<string, string>) =>
      fighter(level, { featPicks: { '2:class:0': 'hedge-mage-dedication', ...picks }, featSkillChoices: { 'hedge-mage-dedication:0': 'occultism' }, cantrips: ['daze', 'shield'] });
    const basic = { '4:class:1': 'basic-hedge-mage-spellcasting' };
    const expert = { ...basic, '12:class:2': 'expert-hedge-mage-spellcasting' };
    const master = { ...expert, '18:class:3': 'master-hedge-mage-spellcasting' };
    const cases: [BuildState, number, number][] = [
      [hedge(6, {}), 0, 0],
      [hedge(6, basic), 1, 2],
      [hedge(12, expert), 2, 4],
      [hedge(18, master), 3, 7],
    ];
    for (const [b, cap, slotRanks] of cases) {
      const e = entryOf(buildCharacter(b, db), 'hedge-mage-dedication-casting')!;
      expect(e.bookMaxRank, `level ${b.level}`).toBe(cap);
      expect(archetypeBookMaxRank(activeCasterArchetype(featIdsOf(b))), `level ${b.level}`).toBe(cap);
      // The SLOTS go higher than the keepsake can hold (8th at 20th): only the book is capped.
      expect(Object.keys(e.prepared ?? {}).length, `level ${b.level}: slot ranks`).toBe(slotRanks);
    }
  });

  it('archetypeBookRanks: one row per rank whose slot the archetype has gained — Arcane Breadth adds slots, not pages', () => {
    const ranks = (b: BuildState) => archetypeBookRanks(b.level, activeCasterArchetype(featIdsOf(b)));
    const row = (rank: number, places: number, minSpellRank: number, maxSpellRank: number) => ({ rank, places, minSpellRank, maxSpellRank });
    expect(ranks(FX[0].make()), 'wizard: exact').toEqual([row(1, 2, 1, 1), row(2, 2, 2, 2)]);
    expect(ranks(FX[2].make()), 'magus: or lower').toEqual([row(1, 2, 1, 1), row(2, 2, 1, 2)]);
    expect(ranks(FX[1].make({ level: 4 })), 'witch at 4th: one page').toEqual([row(1, 2, 1, 1)]);
    expect(ranks(fighter(6, { featPicks: { '2:class:0': 'wizard-dedication' } })), 'the dedication alone: cantrips only').toEqual([]);
    const breadth = fighter(8, { featPicks: { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting', '8:class:2': 'arcane-breadth' } });
    const arch = activeCasterArchetype(featIdsOf(breadth))!;
    expect(archetypeSlots(8, arch), 'fixture: three slot ranks').toEqual({ 1: 1, 2: 1, 3: 1 });
    expect(ranks(breadth).map((r) => r.rank)).toEqual([1, 2, 3]);
    const hedge12 = fighter(12, { featPicks: { '2:class:0': 'hedge-mage-dedication', '4:class:1': 'basic-hedge-mage-spellcasting', '12:class:2': 'expert-hedge-mage-spellcasting' } });
    expect(ranks(hedge12), 'keepsake: Basic ranks stay 1st, the Expert rank may be 2nd').toEqual([row(1, 3, 1, 1), row(2, 3, 1, 1), row(3, 3, 1, 1), row(4, 3, 1, 2)]);
    expect(ranks(fighter(6, { featPicks: { '2:class:0': 'cleric-dedication', '4:class:1': 'basic-cleric-spellcasting' } })), 'no book, no pages').toEqual([]);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* c) THE PICKER                                                                                     */
/* ------------------------------------------------------------------------------------------------ */

describe('c) the sheet\'s picker adds ONLY out of the book', () => {
  for (const f of FX) {
    it(`${f.ded}: cantrip openings offer the ${f.noun}'s cantrips, slots offer its spells — and nothing else of the tradition`, () => {
      const ch = buildCharacter(f.make(), db);
      expect(rendered(ch, f.entryId, 0).length, 'fixture: the render reaches the tradition').toBeGreaterThan(f.cantrips.length + 5);
      expect(rendered(ch, f.entryId, 1).length, 'fixture: the render reaches the tradition').toBeGreaterThan(20);
      expect(sorted(offered(ch, f.entryId, 0))).toEqual(sorted(f.cantrips));
      const book = Object.values(f.spells).flat();
      for (const r of [1, 2]) {
        const want = book.filter((id) => db.spells[id]!.rank <= r);
        expect(sorted(offered(ch, f.entryId, r)), `rank ${r}: every book spell of rank ${r} or lower, and only those`).toEqual(sorted(want));
      }
    });
  }

  it('an EMPTY leveled book offers nothing at 1st rank (Cleric + Wizard Dedication with no archetype spells)', () => {
    const ch = buildCharacter(cleric(6, { featPicks: { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting' }, archetypeSpells: asStore(ARCANE4) }), db);
    const e = entryOf(ch, 'wizard-dedication-casting')!;
    expect(entryOf(ch, 'cleric-casting'), 'fixture: two casters').toBeDefined();
    expect(e.bookCantrips, 'the book is built out of archetypeSpells').toEqual(ARCANE4);
    expect(Object.values(e.spellbook ?? {}).flat(), 'fixture: not one leveled spell in it').toEqual([]);
    expect(e.prepared?.[1]?.length, 'fixture: a 1st-rank slot to prepare').toBe(1);
    expect(rendered(ch, 'wizard-dedication-casting', 1).length, 'fixture: the tradition has plenty').toBeGreaterThan(20);
    expect(offered(ch, 'wizard-dedication-casting', 1), 'nothing to add until the builder puts a spell in the book').toEqual([]);
    expect(offered(ch, 'wizard-dedication-casting', 2)).toEqual([]);
    expect(sorted(offered(ch, 'wizard-dedication-casting', 0)), 'the cantrip book is still on offer').toEqual(sorted(ARCANE4));
  });

  // mutation-proof
  it('…and the narrowing is the book\'s doing: without CASTER_ARCHETYPES.book the same character is offered the tradition', () => {
    const b = FX[0].make();
    const narrow = offered(buildCharacter(b, db), 'wizard-dedication-casting', 1);
    const wide = withoutBook('wizard-dedication', () => offered(buildCharacter(b, db), 'wizard-dedication-casting', 1));
    expect(sorted(narrow)).toEqual(sorted(FX[0].spells[1]));
    expect(wide.length, 'the old picker: the whole arcane list').toBeGreaterThan(20);
    expect(wide).toContain('sure-strike');
    const wideCantrips = withoutBook('wizard-dedication', () => offered(buildCharacter(b, db), 'wizard-dedication-casting', 0));
    expect(wideCantrips).toContain('figment');
    expect(offered(buildCharacter(b, db), 'wizard-dedication-casting', 0)).not.toContain('figment');
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* d) NEVER HIDDEN                                                                                   */
/* ------------------------------------------------------------------------------------------------ */

describe('d) a stored pick off the book is drawn and marked, never hidden', () => {
  it('a leveled slot and a cantrip opening holding off-book picks keep drawing them, each listed in notInBook', () => {
    const ch = buildCharacter(FX[0].make(), db);
    const id = 'wizard-dedication-casting';
    for (const sid of ['fear', 'figment']) {
      expect(db.spells[sid]?.traditions, `fixture: ${sid} is arcane`).toContain('arcane');
      expect([...FX[0].cantrips, ...Object.values(FX[0].spells).flat()], `fixture: ${sid} is not in the book`).not.toContain(sid);
    }
    let play = setPreparedSpell(initialPlay(ch, db), id, 1, 0, 'fear');
    play = setPreparedCantrip(play, id, 1, 'figment');
    const e = shown(ch, id, play);
    expect(e.prepared?.[1]?.[0]?.spellId, 'the leveled pick is drawn').toBe('fear');
    expect(e.cantripSlots, 'the cantrip opening is drawn').toEqual([FX[0].cantrips[0], 'figment']);
    expect(e.cantrips, '…and castable').toContain('figment');
    expect(sorted(e.notInBook ?? []), '…and both said').toEqual(['fear', 'figment']);
    expect(play.preparedSpells?.[`${id}:cantrip:1`], 'the store is never touched').toBe('figment');
    // Offered only in the opening that holds it; the picker never adds it anywhere else.
    expect(offered(ch, id, 0, play, 'figment')).toContain('figment');
    expect(offered(ch, id, 0, play, FX[0].cantrips[0])).not.toContain('figment');
    expect(offered(ch, id, 1, play)).not.toContain('fear');
  });

  it('the necromancer\'s dirge says its own word', () => {
    const f = FX[3];
    const ch = buildCharacter(f.make(), db);
    const play = setPreparedSpell(initialPlay(ch, db), f.entryId, 1, 0, 'bless');
    expect(db.spells.bless?.traditions, 'fixture: bless is occult').toContain('occult');
    const e = shown(ch, f.entryId, play);
    expect(e.prepared?.[1]?.[0]?.spellId).toBe('bless');
    expect(e.notInBook).toEqual(['bless']);
    expect(e.bookNoun).toBe('dirge');
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* e) OLD SAVES                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

describe('e) a save from before the books draws exactly what it drew', () => {
  // mutation-proof
  it('per-slot picks with a repeat ([fear, fear], Arcane Breadth\'s second 1st-rank slot) are prepared as stored', () => {
    const b = fighter(8, {
      featPicks: { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting', '8:class:2': 'arcane-breadth' },
      cantrips: ['detect-magic', 'light'],
      spells: { 1: ['fear', 'fear'], 2: ['invisibility'], 3: ['fireball'] },
    });
    const ch = buildCharacter(b, db);
    const e = entryOf(ch, 'wizard-dedication-casting')!;
    expect(e.prepared?.[1]?.length, 'fixture: two 1st-rank slots (Arcane Breadth)').toBe(2);
    const drawn = (x: SpellcastingEntry) => Object.fromEntries(Object.entries(x.prepared ?? {}).map(([r, s]) => [r, s.map((y) => y.spellId)]));
    expect(drawn(e)).toEqual({ 1: ['fear', 'fear'], 2: ['invisibility'], 3: ['fireball'] });
    expect(e.spellbook?.[1], 'the book holds each spell once').toEqual(['fear']);
    expect(drawn(shown(ch, e.id)), 'the sheet draws the same').toEqual(drawn(e));
    expect(shown(ch, e.id).notInBook, 'nothing to mark').toBeUndefined();
    // The proof: the build with NO book (the code before this change) prepares exactly the same.
    const before = withoutBook('wizard-dedication', () => entryOf(buildCharacter(b, db), 'wizard-dedication-casting')!);
    expect(before.bookCantrips, 'fixture: the planted build really has no book').toBeUndefined();
    expect(drawn(before)).toEqual(drawn(e));
    // …and a rebuild with no stored build keeps the repeat.
    const derived = deriveBuildFromCharacter(ch, db);
    expect(derived.spells[1]).toEqual(['fear', 'fear']);
    expect(drawn(entryOf(buildCharacter(derived, db), 'wizard-dedication-casting')!)).toEqual(drawn(e));
  });

  // mutation-proof
  it('a save with two cantrips prepares those two, the same as without the book, with two places free', () => {
    const b = fighter(4, { featPicks: { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting' }, cantrips: ['detect-magic', 'light'], spells: { 1: ['grease'] } });
    const ch = buildCharacter(b, db);
    const e = entryOf(ch, 'wizard-dedication-casting')!;
    expect(e.cantrips).toEqual(['detect-magic', 'light']);
    expect(e.bookCantrips).toEqual(['detect-magic', 'light']);
    expect(shown(ch, e.id).cantripSlots).toEqual(['detect-magic', 'light']);
    expect(shown(ch, e.id).cantrips).toEqual(['detect-magic', 'light']);
    const before = withoutBook('wizard-dedication', () => entryOf(buildCharacter(b, db), 'wizard-dedication-casting')!);
    expect(before.cantrips).toEqual(e.cantrips);
    expect(before.prepared).toEqual(e.prepared);
    const counts = archetypeCantripCounts(activeCasterArchetype(featIdsOf(b))!, b, db, featIdsOf(b));
    expect(counts.book! - e.bookCantrips!.length, 'two places free in the builder').toBe(2);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* f) PEER PAST THE HEDGE                                                                            */
/* ------------------------------------------------------------------------------------------------ */

describe('f) "Add the detect magic cantrip to your keepsake"', () => {
  it('detect magic goes into the keepsake — preparable, not prepared on top of the two — and stays on offer through a re-preparation', () => {
    expect(text('peer-past-the-hedge')).toContain('Add the detect magic cantrip to your keepsake');
    const f = FX[4];
    expect(f.cantrips, 'fixture: the player did not pick it').not.toContain('detect-magic');
    const without = buildCharacter(f.make(), db);
    expect(entryOf(without, f.entryId)!.bookCantrips, 'control: no feat, not in the keepsake').not.toContain('detect-magic');
    expect(offered(without, f.entryId, 0), 'control: not on offer').not.toContain('detect-magic');

    const ch = buildCharacter(f.make({ featPicks: { '2:class:0': 'hedge-mage-dedication', '4:class:1': 'basic-hedge-mage-spellcasting', '6:class:2': 'peer-past-the-hedge' } }), db);
    const e = entryOf(ch, f.entryId)!;
    expect(e.bookCantrips).toEqual([...f.cantrips, 'detect-magic']);
    expect(e.cantrips, 'the two the player prepares, no third on top').toEqual(f.cantrips.slice(0, 2));
    expect(e.cantripCap).toBe(2);
    expect(e.grantedRepertoire?.[0], 'attributed as a grant').toEqual(['detect-magic']);
    expect(offered(ch, f.entryId, 0, initialPlay(ch, db), f.cantrips[0])).toContain('detect-magic');
    // Prepared into opening 0…
    let play = setPreparedCantrip(initialPlay(ch, db), f.entryId, 0, 'detect-magic');
    let s = shown(ch, f.entryId, play);
    expect(s.cantripSlots).toEqual(['detect-magic', f.cantrips[1]]);
    expect(s.notInBook, 'it is in the keepsake').toBeUndefined();
    // …and re-prepared away: still an option for the next morning, in any opening.
    play = setPreparedCantrip(play, f.entryId, 0, f.cantrips[2]);
    s = shown(ch, f.entryId, play);
    expect(s.cantripSlots).toEqual([f.cantrips[2], f.cantrips[1]]);
    expect(offered(ch, f.entryId, 0, play, f.cantrips[2])).toContain('detect-magic');
    expect(offered(ch, f.entryId, 0, play, f.cantrips[1])).toContain('detect-magic');
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* g) CANTRIP BONUSES                                                                                */
/* ------------------------------------------------------------------------------------------------ */

describe('g) cantrip bonuses reach the pool they print for', () => {
  it('Cantrip Supremacy: the hedge mage prepares 12 and the keepsake holds 14', () => {
    expect(text('cantrip-supremacy')).toContain('Add 10 additional cantrips to your keepsake. You can also prepare 10 additional cantrips from your keepsake each day.');
    const b = fighter(10, {
      featPicks: { '2:class:0': 'hedge-mage-dedication', '4:class:1': 'basic-hedge-mage-spellcasting', '10:class:2': 'cantrip-supremacy' },
      featSkillChoices: { 'hedge-mage-dedication:0': 'arcana' },
      cantrips: ARCANE4,
    });
    const arch = activeCasterArchetype(featIdsOf(b))!;
    expect(archetypeCantripCounts(arch, b, db, featIdsOf(b))).toEqual({ prepared: 12, book: 14, drawn: 12 });
    const e = entryOf(buildCharacter(b, db), 'hedge-mage-dedication-casting')!;
    expect(e.cantripCap).toBe(12);
    expect(e.cantrips, 'every stored pick is prepared').toEqual(ARCANE4);
    // Control: without the feat, 2 and 4.
    const plain = fighter(10, { ...b, featPicks: { '2:class:0': 'hedge-mage-dedication', '4:class:1': 'basic-hedge-mage-spellcasting' } });
    expect(archetypeCantripCounts(activeCasterArchetype(featIdsOf(plain))!, plain, db, featIdsOf(plain))).toEqual({ prepared: 2, book: 4, drawn: 2 });
  });

  it('Cantrip Expansion on a fighter with Wizard Dedication: four prepared, and all four picks drawn', () => {
    expect(db.feats['cantrip-expansion']?.spellSlotBonus, 'fixture: an untargeted +2').toEqual({ cantrips: 2 });
    const b = fighter(6, { featPicks: { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting', '6:class:2': 'cantrip-expansion' }, cantrips: ARCANE4 });
    const arch = activeCasterArchetype(featIdsOf(b))!;
    expect(archetypeCantripCounts(arch, b, db, featIdsOf(b))).toEqual({ prepared: 4, book: 4, drawn: 4 });
    const ch = buildCharacter(b, db);
    const e = entryOf(ch, 'wizard-dedication-casting')!;
    expect(e.cantrips, 'picks 3 and 4 were drawn nowhere before').toEqual(ARCANE4);
    expect(e.cantripCap).toBe(4);
    expect(shown(ch, e.id).cantripSlots).toEqual(ARCANE4);
    // Control: without the feat, two prepared out of the same four.
    const plain = fighter(6, { featPicks: { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting' }, cantrips: ARCANE4 });
    expect(entryOf(buildCharacter(plain, db), 'wizard-dedication-casting')!.cantrips).toEqual(ARCANE4.slice(0, 2));
  });

  it('Adapted Cantrip on a book archetype: one more option in the book, not a cantrip charged to it', () => {
    // *"If you prepare spells, you can choose this spell when you prepare your cantrips, in addition to
    // your other options"* — the `-1` is the repertoire half (*"replace one of your cantrips known"*).
    expect(db.feats['adapted-cantrip']?.spellSlotBonus, 'fixture: the swap\'s -1').toEqual({ cantrips: -1 });
    const b = fighter(6, {
      featPicks: { '1:ancestry': 'adapted-cantrip', '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting' },
      featChoices: { '1:ancestry': 'divine-lance' },
      cantrips: ARCANE4,
    } as Partial<BuildState>);
    const arch = activeCasterArchetype(featIdsOf(b))!;
    expect(archetypeCantripCounts(arch, b, db, featIdsOf(b)), 'still two prepared out of four').toEqual({ prepared: 2, book: 4, drawn: 2 });
    const ch = buildCharacter(b, db);
    const e = entryOf(ch, 'wizard-dedication-casting')!;
    expect(e.bookCantrips).toEqual([...ARCANE4, 'divine-lance']);
    expect(e.spellSources?.['divine-lance']).toBe('Adapted Cantrip');
    const s = shown(ch, e.id);
    expect(s.cantripSlots, 'the standing preparation is the player\'s first two').toEqual(ARCANE4.slice(0, 2));
    expect(offered(ch, e.id, 0), 'and the adapted cantrip can be prepared').toContain('divine-lance');
    // A rebuild with no stored build does not hand it back as one of the player's four.
    expect(deriveBuildFromCharacter(ch, db).cantrips).toEqual(ARCANE4);
  });

  it('…but beside a caster class the untargeted bonus sizes the CLASS pool, not the archetype\'s', () => {
    const picks = { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting' };
    const withExp = cleric(6, { featPicks: { ...picks, '6:class:2': 'cantrip-expansion' }, archetypeSpells: asStore(ARCANE4) });
    const plain = cleric(6, { featPicks: picks, archetypeSpells: asStore(ARCANE4) });
    const arch = activeCasterArchetype(featIdsOf(withExp))!;
    expect(archetypeCantripCounts(arch, withExp, db, featIdsOf(withExp))).toEqual({ prepared: 2, book: 4, drawn: 2 });
    const a = buildCharacter(withExp, db);
    const p = buildCharacter(plain, db);
    expect(entryOf(a, 'wizard-dedication-casting')!.cantrips).toEqual(ARCANE4.slice(0, 2));
    expect(entryOf(a, 'wizard-dedication-casting')!.cantripCap).toBe(2);
    expect(entryOf(a, 'cleric-casting')!.cantripCap! - entryOf(p, 'cleric-casting')!.cantripCap!, 'the class pool takes the +2').toBe(2);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* h) TRADITION                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

describe('h) the hedge mage\'s tradition follows the skill it chose', () => {
  const hedge = (skill: SkillId | null) =>
    fighter(6, {
      featPicks: { '2:class:0': 'hedge-mage-dedication', '4:class:1': 'basic-hedge-mage-spellcasting' },
      ...(skill ? { featSkillChoices: { 'hedge-mage-dedication:0': skill } } : {}),
      cantrips: ['light', 'detect-magic'],
    });

  it('Nature → primal, Occultism → occult, Religion → divine, Arcana → arcane — the shared function and the built entry agree', () => {
    expect(text('hedge-mage-dedication')).toContain('arcane for Arcana, primal for Nature, occult for Occultism, and divine for Religion');
    for (const [skill, tradition] of [['nature', 'primal'], ['occultism', 'occult'], ['religion', 'divine'], ['arcana', 'arcane']] as const) {
      const b = hedge(skill);
      const arch = activeCasterArchetype(featIdsOf(b))!;
      expect(archetypeTradition(arch, b, db), skill).toBe(tradition);
      expect(entryOf(buildCharacter(b, db), 'hedge-mage-dedication-casting')!.tradition, skill).toBe(tradition);
    }
  });

  // mutation-proof
  it('…and it is the skill doing it: without traditionBySkill a Nature hedge mage falls back to arcane', () => {
    const b = hedge('nature');
    const cfg = CASTER_ARCHETYPES['hedge-mage-dedication'];
    const saved = cfg.traditionBySkill;
    delete cfg.traditionBySkill;
    try {
      expect(archetypeTradition(activeCasterArchetype(featIdsOf(b))!, b, db)).toBe('arcane');
    } finally {
      cfg.traditionBySkill = saved;
    }
    expect(archetypeTradition(activeCasterArchetype(featIdsOf(b))!, b, db)).toBe('primal');
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* i) REVERSE BUILD                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

describe('i) a rebuild with no stored build reads the whole book back', () => {
  it('fighter + Wizard Dedication: four book cantrips and both spells a page (one not prepared) come back as picks', () => {
    const f = FX[0];
    const ch = buildCharacter(f.make(), db);
    expect(entryOf(ch, f.entryId)!.cantrips, 'fixture: two prepared').toHaveLength(2);
    expect(entryOf(ch, f.entryId)!.prepared?.[1], 'fixture: one slot a rank').toHaveLength(1);
    const d = deriveBuildFromCharacter(ch, db);
    expect(d.cantrips).toEqual(f.cantrips);
    expect(d.spells).toEqual(f.spells);
    const again = entryOf(buildCharacter(d, db), f.entryId)!;
    const e = entryOf(ch, f.entryId)!;
    expect([again.bookCantrips, again.spellbook, again.prepared, again.cantrips]).toEqual([e.bookCantrips, e.spellbook, e.prepared, e.cantrips]);
  });

  // mutation-proof
  it('…and that is the book\'s doing: read off the prepared slots alone, book cantrips 3-4 and the unprepared spells are lost', () => {
    const f = FX[0];
    const ch = buildCharacter(f.make(), db);
    const stripped = structuredClone(ch);
    const e = entryOf(stripped, f.entryId)!;
    delete e.bookCantrips;
    delete e.spellbook;
    const d = deriveBuildFromCharacter(stripped, db);
    expect(d.cantrips).toEqual(f.cantrips.slice(0, 2));
    expect(d.spells).toEqual({ 1: [f.spells[1][0]], 2: [f.spells[2][0]] });
  });

  it('Hedge Mage + Peer Past the Hedge: detect magic, a grant, is not returned as a pick', () => {
    const f = FX[4];
    const ch = buildCharacter(f.make({ featPicks: { '2:class:0': 'hedge-mage-dedication', '4:class:1': 'basic-hedge-mage-spellcasting', '6:class:2': 'peer-past-the-hedge' } }), db);
    expect(entryOf(ch, f.entryId)!.bookCantrips, 'fixture: in the keepsake').toContain('detect-magic');
    const d = deriveBuildFromCharacter(ch, db);
    expect(d.cantrips).toEqual(f.cantrips);
    expect(d.spells).toEqual(f.spells);
    expect(d.archetypeTradition).toBe('arcane');
  });

  it('two casters (Cleric + Wizard Dedication): the book comes back into archetypeSpells, the class pool untouched', () => {
    const spells = { 1: ['grease', 'force-barrage'], 2: ['invisibility', 'see-the-unseen'] };
    const b = cleric(6, {
      featPicks: { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting' },
      cantrips: ['divine-lance', 'stabilize'],
      archetypeSpells: asStore(ARCANE4, spells),
    });
    const ch = buildCharacter(b, db);
    expect(entryOf(ch, 'wizard-dedication-casting')!.spellbook, 'fixture: the book is built from archetypeSpells').toEqual(spells);
    const d = deriveBuildFromCharacter(ch, db);
    expect(d.archetypeSpells?.cantrips).toEqual(ARCANE4);
    expect(d.archetypeSpells?.spells).toEqual(spells);
    expect(d.archetypeSpells?.tradition).toBe('arcane');
    expect(d.cantrips, 'the cleric\'s own cantrips').toEqual(['divine-lance', 'stabilize']);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* j) NEGATIVE CONTROLS                                                                              */
/* ------------------------------------------------------------------------------------------------ */

describe('j) every archetype without a printed book is untouched', () => {
  it('cleric, druid, sorcerer (repertoire), captivator (innate) and red mantis entries carry no book fields', () => {
    const cases: [string, string, string][] = [
      ['cleric-dedication', 'basic-cleric-spellcasting', 'prepared'],
      ['druid-dedication', 'basic-druid-spellcasting', 'prepared'],
      ['sorcerer-dedication', 'basic-sorcerer-spellcasting', 'spontaneous'],
      ['captivator-dedication', 'basic-captivator-spellcasting', 'innate'],
      ['red-mantis-assassin-dedication', 'basic-red-mantis-magic', 'prepared'],
    ];
    for (const [ded, basic, type] of cases) {
      expect(db.feats[basic], `fixture: ${basic} exists`).toBeDefined();
      const b = fighter(6, { featPicks: { '2:class:0': ded, '4:class:1': basic }, cantrips: ['detect-magic', 'light'], spells: { 1: ['fear'] } });
      const arch = activeCasterArchetype(featIdsOf(b));
      expect(arch?.dedicationId, ded).toBe(ded);
      expect(archetypeBook(arch), ded).toBeNull();
      expect(archetypeCantripCounts(arch!, b, db, featIdsOf(b)).book, ded).toBeUndefined();
      const e = entryOf(buildCharacter(b, db), `${ded}-casting`);
      expect(e?.type, ded).toBe(type);
      /* `cantripsPrepared` was asserted undefined here too. Since 2026-10-15 a book-less PREPARED pool's
       * cantrips re-prepare (*"You can prepare two common cantrips each day from the divine spell list"*,
       * feat-5066), so it is true for the prepared three and still absent for the repertoire and innate
       * pools — the book fields stay absent for all five (test/adapted-chain.test.ts holds the openings). */
      expect(
        { bookCantrips: e?.bookCantrips, spellbook: e?.spellbook, bookNoun: e?.bookNoun, cantripsPrepared: e?.cantripsPrepared, bookMaxRank: e?.bookMaxRank },
        ded,
      ).toEqual({ bookCantrips: undefined, spellbook: undefined, bookNoun: undefined, cantripsPrepared: type === 'prepared' ? true : undefined, bookMaxRank: undefined });
    }
  });

  it('Spellshot + Beast Gunner still builds the beast gunner\'s entry, and no spellshot book', () => {
    const both = build('gunslinger', 6, { subclassId: 'way-of-the-spellshot', featPicks: { '2:class': 'spellshot-dedication', '4:class': 'beast-gunner-dedication' } });
    const bg = entryOf(both, 'beast-gunner-dedication-casting');
    expect(bg?.type).toBe('spontaneous');
    expect(bg?.bookCantrips).toBeUndefined();
    expect(bg?.bookNoun).toBeUndefined();
    expect(entryOf(both, 'spellshot-dedication-casting')).toBeUndefined();
    expect(both.spellcasting.some((e) => e.bookCantrips), 'no entry carries a book').toBe(false);
  });

  it('Magaambyan Attendant + Halcyon Speaker: one merged archetype entry, no book', () => {
    const ch = buildCharacter(
      fighter(10, {
        featPicks: { '2:class:0': 'magaambyan-attendant-dedication', '6:class:1': 'halcyon-speaker-dedication', '10:class:2': 'halcyon-spellcasting-initiate' },
        archetypeTradition: 'arcane',
        cantrips: ['detect-magic'],
        spells: { 1: ['grease'] },
      }),
      db,
    );
    const arch = ch.spellcasting.filter((e) => e.id.endsWith('-dedication-casting'));
    expect(arch.map((e) => e.id)).toEqual(['magaambyan-attendant-dedication-casting']);
    expect(arch[0].type).toBe('spontaneous');
    expect([arch[0].bookCantrips, arch[0].spellbook, arch[0].bookNoun, arch[0].cantripsPrepared]).toEqual([undefined, undefined, undefined, undefined]);
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* k) LEARN A SPELL                                                                                  */
/* ------------------------------------------------------------------------------------------------ */

describe('k) Learn a Spell adds to the archetype\'s book', () => {
  it('a learned 1st-rank spell is merged into the overlay spellbook and becomes a picker option', () => {
    const f = FX[0];
    const ch = buildCharacter(f.make(), db);
    expect(offered(ch, f.entryId, 1), 'fixture: not on offer before').not.toContain('sure-strike');
    const play = learnSpell(initialPlay(ch, db), f.entryId, 1, 'sure-strike');
    const e = shown(ch, f.entryId, play);
    expect(e.spellbook?.[1]).toEqual([...f.spells[1], 'sure-strike']);
    expect(sorted(offered(ch, f.entryId, 1, play))).toEqual(sorted([...f.spells[1], 'sure-strike']));
    // Prepared into the slot, it is in the book — nothing to mark.
    const prepared = setPreparedSpell(play, f.entryId, 1, 0, 'sure-strike');
    expect(shown(ch, f.entryId, prepared).prepared?.[1]?.[0]?.spellId).toBe('sure-strike');
    expect(shown(ch, f.entryId, prepared).notInBook).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------------------------------ */
/* REVIEW FINDINGS, 2026-10-15                                                                       */
/* ------------------------------------------------------------------------------------------------ */

/**
 * The first review of the dedication-book change found these in the uncommitted tree; each is fixed, and
 * each gets one guard here so it cannot come back. F4 (the builder's distinct-count book rows) and F7
 * (the Wanderer's Guide import's bookCantrips) are builder / transfer surfaces, held in their own files.
 */
describe('review findings, 2026-10-15', () => {
  /**
   * F1 (was HIGH) — Adapted Cantrip's untargeted `-1` on a pool WITHOUT a book.
   *
   * `archetypeCantripCounts` charged the swap's -1 to a fighter's only caster, and the entry sliced its
   * stored cantrips to that number: a fighter who had stored two Sorcerer (or Cleric) Dedication cantrips
   * and then took Adapted Cantrip lost the second one from the sheet. Now `prepared` (the builder's row)
   * still charges it — a new save picks one — but `drawn` never falls below `config.cantrips` + the aimed
   * bonuses, so every stored pick AND the adapted one are drawn, as before the book change. A BOOK pool
   * skips the -1 (`skipSwaps`) and takes the adapted cantrip as one more option in the book.
   *
   * mutation-proof (in memory): the bad case is the entry slicing to `counts.prepared` instead of
   * `counts.drawn`; that slice is computed on the same numbers below and lacks the second stored cantrip,
   * so the `e.cantrips` assertion tells the fixed build from the bad one.
   *
   * 2026-10-15: the Cleric Dedication case moved. A book-less PREPARED pool no longer pays the -1 — its
   * openings re-prepare, so the adapted cantrip is an option there (feat-4474: *"in addition to your other
   * options"*) — and its leg below now reads that shape; test/adapted-chain.test.ts holds the rest. The
   * REPERTOIRE pool keeps every assertion it had.
   */
  it('F1: Adapted Cantrip\'s -1 never hides a stored cantrip on a non-book pool (the builder row still counts one); a book pool takes it into the book', () => {
    const cases: [ded: string, type: string, stored: string[], adapted: string][] = [
      ['sorcerer-dedication', 'spontaneous', ['detect-magic', 'light'], 'divine-lance'],
    ];
    for (const [ded, type, stored, adapted] of cases) {
      const b = fighter(6, {
        featPicks: { '1:ancestry': 'adapted-cantrip', '2:class:0': ded },
        featChoices: { '1:ancestry': adapted },
        cantrips: stored,
      } as Partial<BuildState>);
      const arch = activeCasterArchetype(featIdsOf(b))!;
      expect(arch.dedicationId, ded).toBe(ded);
      expect(archetypeBook(arch), `${ded}: fixture: no book`).toBeNull();
      const e = entryOf(buildCharacter(b, db), `${ded}-casting`)!;
      expect(e.type, ded).toBe(type);
      for (const s of stored) expect(db.spells[s]?.traditions, `fixture: ${s} is ${e.tradition}`).toContain(e.tradition);
      expect(db.spells[adapted]?.traditions, `fixture: ${adapted} is not ${e.tradition}`).not.toContain(e.tradition);
      const counts = archetypeCantripCounts(arch, b, db, featIdsOf(b));
      expect(counts.prepared, `${ded}: the builder's row charges the swap — a new save picks one`).toBe(1);
      expect(counts.drawn, `${ded}: the build draws what the pool drew before`).toBe(2);
      expect(counts.book, ded).toBeUndefined();
      expect(e.cantrips, `${ded}: both stored picks AND the adapted cantrip`).toEqual([...stored, adapted]);
      expect(e.spellSources?.[adapted], ded).toBe('Adapted Cantrip');
      // The planted bad case: the slice the entry made before `drawn`.
      expect(stored.slice(0, counts.prepared), `${ded}: the old slice hid the second pick`).not.toContain(stored[1]);
    }
    // A book-less PREPARED pool (Cleric Dedication): not charged; both stored picks prepared, the adapted
    // cantrip on the list its two openings prepare from — never drawn on top.
    {
      const stored = ['divine-lance', 'stabilize'];
      const b = fighter(6, {
        featPicks: { '1:ancestry': 'adapted-cantrip', '2:class:0': 'cleric-dedication' },
        featChoices: { '1:ancestry': 'electric-arc' },
        cantrips: stored,
      } as Partial<BuildState>);
      const arch = activeCasterArchetype(featIdsOf(b))!;
      expect(archetypeCantripCounts(arch, b, db, featIdsOf(b))).toEqual({ prepared: 2, book: undefined, drawn: 2 });
      const ch = buildCharacter(b, db);
      const e = entryOf(ch, 'cleric-dedication-casting')!;
      expect(e.cantrips).toEqual(stored);
      expect(ch.spellListAdditions?.['cleric-dedication-casting']).toContain('electric-arc');
      expect(e.spellSources?.['electric-arc']).toBe('Adapted Cantrip');
    }
    // A BOOK pool: the -1 is not charged, and the adapted cantrip joins the book as one more option.
    const b = fighter(6, {
      featPicks: { '1:ancestry': 'adapted-cantrip', '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting' },
      featChoices: { '1:ancestry': 'divine-lance' },
      cantrips: ['detect-magic', 'light'],
    } as Partial<BuildState>);
    const arch = activeCasterArchetype(featIdsOf(b))!;
    expect(archetypeCantripCounts(arch, b, db, featIdsOf(b))).toEqual({ prepared: 2, book: 4, drawn: 2 });
    const e = entryOf(buildCharacter(b, db), 'wizard-dedication-casting')!;
    expect(e.bookCantrips).toEqual(['detect-magic', 'light', 'divine-lance']);
    expect(e.cantrips).toEqual(expect.arrayContaining(['detect-magic', 'light']));
  });

  /**
   * F2 (was MEDIUM) — Spellshot + Beast Gunner (owner question #162 still open: the beast gunner wins the
   * one shared pool). The beast gunner keeps one cantrip, so three of a spellshot's four spellbook cantrips
   * vanished from the sheet with nothing said. Now, when a HELD book dedication did not win the pool, the
   * winning entry's own line on the Spells tab (`note`) names every stored pick it does not draw — on the
   * entry, not as an effectWarnings row: those show under the Feats tab's "Missing data" heading, and
   * nothing here is missing data (final check, 2026-10-15).
   *
   * mutation-proof (in memory): with `CASTER_ARCHETYPES['spellshot-dedication'].book` removed, the same
   * build hides the same three cantrips and says nothing — the line is the book's doing.
   */
  it('F2: Spellshot beside Beast Gunner names, on the beast gunner entry, the spellbook picks it does not draw', () => {
    const gunslinger = (featPicks: Record<string, string>, cantrips: string[]) =>
      fighter(6, { classId: 'gunslinger', keyAbility: 'dex', subclassId: 'way-of-the-spellshot', featPicks, cantrips });
    const pair = (cantrips: string[]) => gunslinger({ '2:class': 'spellshot-dedication', '4:class': 'beast-gunner-dedication' }, cantrips);
    /** The "Not shown" line(s) on the beast gunner entry — and never a "Missing data" row. */
    const rowsOf = (ch: Character) => {
      expect((ch.effectWarnings ?? []).filter((w) => /not shown/i.test(w.message)), 'nothing goes to the Missing data list').toEqual([]);
      const note = entryOf(ch, 'beast-gunner-dedication-casting')?.note ?? '';
      return /Not shown:/.test(note) ? [{ message: note }] : [];
    };
    const b = pair(ARCANE4);
    expect(activeCasterArchetype(featIdsOf(b))?.dedicationId, 'fixture: the beast gunner wins the pool').toBe('beast-gunner-dedication');
    const ch = buildCharacter(b, db);
    expect(entryOf(ch, 'spellshot-dedication-casting'), 'fixture: no spellshot entry').toBeUndefined();
    const bg = entryOf(ch, 'beast-gunner-dedication-casting')!;
    const keeps = bg.cantrips.length;
    expect(keeps, 'fixture: the beast gunner keeps fewer than the four stored').toBeLessThan(ARCANE4.length);
    expect(keeps, 'fixture: the beast gunner keeps some').toBeGreaterThan(0);
    expect(bg.cantrips).toEqual(ARCANE4.slice(0, keeps));
    const rows = rowsOf(ch);
    expect(rows, 'exactly one row').toHaveLength(1);
    for (const id of ARCANE4.slice(keeps)) expect(rows[0].message, `${id} is named`).toContain(db.spells[id]!.name);
    for (const id of bg.cantrips) expect(rows[0].message, `${id} is drawn, so not named`).not.toContain(db.spells[id]!.name);
    expect(rows[0].message).toContain('Beast Gunner Dedication');
    expect(rows[0].message).toContain('spellbook');
    // Only as many stored as the beast gunner keeps: nothing hidden, no row.
    expect(rowsOf(buildCharacter(pair(ARCANE4.slice(0, keeps)), db))).toEqual([]);
    // A lone spellshot draws its own book: never the row.
    const lone = buildCharacter(gunslinger({ '2:class': 'spellshot-dedication' }, ARCANE4), db);
    expect(entryOf(lone, 'spellshot-dedication-casting')?.bookCantrips, 'fixture: the lone spellshot\'s book').toEqual(ARCANE4);
    expect(rowsOf(lone)).toEqual([]);
    // The plant: no book on the spellshot — the same picks hidden, and silence.
    const planted = withoutBook('spellshot-dedication', () => buildCharacter(b, db));
    expect(entryOf(planted, 'beast-gunner-dedication-casting')!.cantrips).toEqual(bg.cantrips);
    expect(rowsOf(planted)).toEqual([]);
  });

  /**
   * F3 (was LOW) — Peer Past the Hedge's detect magic, when the player had ALSO picked it into the
   * keepsake. The grant was recorded in `grantedRepertoire[0]` anyway, and deriveBuildFromCharacter strips
   * that from the book as "not a pick": a rebuild read the player's own detect magic out of the keepsake,
   * and dropping the feat later lost it. Now a grant the book already holds is skipped and not recorded.
   * And the reverse build returns each book page in STORED order (the prepared slot's spell first, then
   * the rest of the page), so a rebuild with no stored build moves no slot's default.
   *
   * mutation-proof (in memory): writing the grant into `grantedRepertoire[0]` on a clone (what the build
   * did before) makes the reverse build drop the player's detect magic; and a clone whose book page is
   * reversed still comes back with the prepared slot's spell first — the head is what keeps the order.
   */
  it('F3: the player\'s own detect magic survives Peer Past the Hedge in the reverse build; book pages come back in stored order', () => {
    const PRIMAL4 = ['light', 'detect-magic', 'electric-arc', 'frostbite'];
    const id = 'hedge-mage-dedication-casting';
    const hedge = (cantrips: string[]) =>
      fighter(6, {
        featPicks: { '2:class:0': 'hedge-mage-dedication', '4:class:1': 'basic-hedge-mage-spellcasting', '6:class:2': 'peer-past-the-hedge' },
        featSkillChoices: { 'hedge-mage-dedication:0': 'nature' },
        cantrips,
      });
    const ch = buildCharacter(hedge(PRIMAL4), db);
    const e = entryOf(ch, id)!;
    expect(e.tradition, 'fixture: Nature → primal').toBe('primal');
    for (const s of PRIMAL4) expect(db.spells[s]?.traditions, `fixture: ${s} is primal`).toContain('primal');
    expect(e.bookCantrips, 'the keepsake holds detect magic once, where the player put it').toEqual(PRIMAL4);
    expect(e.grantedRepertoire?.[0] ?? [], 'the grant is not recorded over the player\'s pick').not.toContain('detect-magic');
    expect(deriveBuildFromCharacter(ch, db).cantrips, 'the player\'s detect magic comes back').toEqual(PRIMAL4);
    // The plant: the grant recorded, as before the fix — the reverse build loses the player's pick.
    const planted = structuredClone(ch);
    entryOf(planted, id)!.grantedRepertoire = { ...(e.grantedRepertoire ?? {}), 0: ['detect-magic'] };
    expect(deriveBuildFromCharacter(planted, db).cantrips).not.toContain('detect-magic');
    // Without the player's pick it IS the grant, and is still not handed back as a pick.
    const own3 = PRIMAL4.filter((s) => s !== 'detect-magic');
    const granted = buildCharacter(hedge(own3), db);
    expect(entryOf(granted, id)!.bookCantrips).toEqual([...own3, 'detect-magic']);
    expect(entryOf(granted, id)!.grantedRepertoire?.[0]).toEqual(['detect-magic']);
    expect(deriveBuildFromCharacter(granted, db).cantrips).toEqual(own3);

    // Stored order, one 1st-rank slot (Wizard Dedication + Basic at 4th).
    const wiz = (page: string[]) =>
      fighter(4, { featPicks: { '2:class:0': 'wizard-dedication', '4:class:1': 'basic-wizard-spellcasting' }, cantrips: ['detect-magic', 'light'], spells: { 1: page } });
    for (const page of [['fear', 'grease'], ['grease', 'fear']]) {
      const w = buildCharacter(wiz(page), db);
      expect(entryOf(w, 'wizard-dedication-casting')!.prepared?.[1]?.map((s) => s.spellId), `fixture: one slot, holding ${page[0]}`).toEqual([page[0]]);
      expect(deriveBuildFromCharacter(w, db).spells, page.join(', ')).toEqual({ 1: page });
    }
    // The plant: the book page reversed on a clone — the prepared slot's spell still comes back first.
    const clone = structuredClone(buildCharacter(wiz(['fear', 'grease']), db));
    entryOf(clone, 'wizard-dedication-casting')!.spellbook = { 1: ['grease', 'fear'] };
    expect(deriveBuildFromCharacter(clone, db).spells).toEqual({ 1: ['fear', 'grease'] });
  });

  /**
   * F5 (final checks, 2026-10-15) — the "Not shown" line is for a HELD book dedication that lost the pool
   * (Spellshot beside Beast Gunner; a Magus beside a Cleric Dedication), on a NON-caster class (where the
   * builder lists every pick as a removable chip), only for ranks the pool has now, and never for a held
   * spellshot's old-save cantrips (they are cast as at-will innate ones). A wider version (any pool without a book drawing fewer than its store)
   * named the higher ranks' picks after a level-down — picks the builder's level-down dialog promises to
   * keep and reapply — and, on a caster class, leveled picks the builder has no control to remove. So:
   *   · a level-down beside Beast Gunner names nothing at a rank the pool has not reached;
   *   · a Wizard Dedication swapped for a Cleric Dedication (no book) says nothing on the sheet — its
   *     builder row reads over its count, which is where those picks are removed — and the stored picks
   *     are untouched (the build never rewrites the store);
   *   · a lowered cleric dedication (spells stored at ranks it no longer has) says nothing at all.
   */
  it('F5: the "Not shown" line names only what a held book loses, at ranks the pool has now', () => {
    const noteOf = (ch: Character, id: string) => entryOf(ch, id)?.note ?? '';
    const missing = (ch: Character) => (ch.effectWarnings ?? []).filter((w) => /not shown/i.test(w.message));
    // Beast Gunner (wins) + Spellshot, a 2nd-rank pick stored, built at a level with 1st-rank slots only.
    const pair = (level: number) =>
      fighter(level, {
        classId: 'gunslinger', keyAbility: 'dex', subclassId: 'way-of-the-spellshot',
        featPicks: { '2:class': 'spellshot-dedication', '4:class': 'beast-gunner-dedication', '4:class:1': 'basic-beast-gunner-spellcasting' },
        cantrips: [],
        spells: { 1: ['fear'], 2: ['see-the-unseen'] },
      });
    const low = buildCharacter(pair(4), db);
    const bg = entryOf(low, 'beast-gunner-dedication-casting')!;
    expect(Object.keys(bg.slots ?? {}), 'fixture: the beast gunner has its 1st-rank slot only').toEqual(['1']);
    expect(bg.repertoire?.[1], 'fixture: and draws the 1st-rank pick').toEqual(['fear']);
    expect(noteOf(low, 'beast-gunner-dedication-casting'), 'a rank the pool has not reached is not named').not.toMatch(/Not shown/);
    expect(missing(low)).toEqual([]);
    // …and at 6th, where the pool HAS 2nd rank and keeps one spell there, a second 2nd-rank pick is named.
    const six = buildCharacter({ ...pair(6), spells: { 1: ['fear'], 2: ['see-the-unseen', 'invisibility'] } }, db);
    const n6 = noteOf(six, 'beast-gunner-dedication-casting');
    expect(n6, 'the 2nd-rank pick it cannot keep').toContain(db.spells['invisibility']!.name);
    expect(n6, 'the one it keeps is not named').not.toContain(db.spells['see-the-unseen']!.name);
    // The swap: no line, no Missing data row, the store untouched.
    const DIVINE4 = ['divine-lance', 'stabilize', 'guidance', 'light'];
    const swapped = fighter(4, { featPicks: { '2:class:0': 'cleric-dedication', '4:class:1': 'basic-cleric-spellcasting' }, cantrips: DIVINE4, spells: { 1: ['heal', 'bless'] } });
    const ch = buildCharacter(swapped, db);
    expect(entryOf(ch, 'cleric-dedication-casting')!.cantrips, 'fixture: the cleric pool draws two').toEqual(DIVINE4.slice(0, 2));
    expect(noteOf(ch, 'cleric-dedication-casting')).not.toMatch(/Not shown/);
    expect(missing(ch)).toEqual([]);
    expect(swapped.cantrips, 'the store keeps all four').toEqual(DIVINE4);
    // A lowered cleric dedication: spells stored at 2nd and 3rd rank, built at 4th — silent.
    const lowered = buildCharacter(fighter(4, { featPicks: { '2:class:0': 'cleric-dedication', '4:class:1': 'basic-cleric-spellcasting' }, cantrips: DIVINE4.slice(0, 2), spells: { 1: ['heal'], 2: ['spiritual-weapon'], 3: ['heroism'] } }), db);
    expect(noteOf(lowered, 'cleric-dedication-casting')).not.toMatch(/Not shown/);
    expect(missing(lowered)).toEqual([]);

    // An old-save spellshot beside Beast Gunner: its retired answers are cast as at-will innate cantrips,
    // so Light (one of them) is ON the sheet and is not named; Shield (only in the store) is.
    const old = buildCharacter(
      fighter(6, {
        classId: 'gunslinger', keyAbility: 'dex', subclassId: 'way-of-the-spellshot',
        featPicks: { '2:class': 'spellshot-dedication', '4:class': 'beast-gunner-dedication' },
        effectChoices: { 'spellshot-dedication:spellbook-cantrip-1': 'detect-magic', 'spellshot-dedication:spellbook-cantrip-2': 'light' },
        cantrips: ['detect-magic', 'light', 'shield'],
      }),
      db,
    );
    const innate = old.spellcasting.filter((e) => e.type === 'innate').flatMap((e) => e.cantrips);
    expect(innate, 'fixture: the retired answers are cast as innate cantrips').toEqual(expect.arrayContaining(['detect-magic', 'light']));
    const oldNote = noteOf(old, 'beast-gunner-dedication-casting');
    expect(oldNote, 'fixture: something is hidden').toMatch(/Not shown/);
    expect(oldNote).toContain(db.spells['shield']!.name);
    expect(oldNote, 'Light is on the sheet (innate), never "not shown"').not.toContain(db.spells['light']!.name);

    // A caster class (Druid) with a Cleric and a Magus Dedication: the leveled picks live in archetypeSpells,
    // which no builder control lists for the cleric pool — so no line it could never clear.
    const caster = buildCharacter(
      fighter(6, {
        classId: 'druid', keyAbility: 'wis', subclassId: db.classes.druid?.subclass?.options[0]?.id ?? null,
        featPicks: { '2:class:0': 'cleric-dedication', '4:class:1': 'basic-cleric-spellcasting', '6:class:2': 'magus-dedication' },
        archetypeSpells: asStore(['divine-lance', 'stabilize'], { 1: ['heal', 'fear'] }),
      }),
      db,
    );
    expect(entryOf(caster, 'cleric-dedication-casting'), 'fixture: the cleric pool wins').toBeTruthy();
    expect(noteOf(caster, 'cleric-dedication-casting')).not.toMatch(/Not shown/);
    expect(missing(caster)).toEqual([]);
  });
});
