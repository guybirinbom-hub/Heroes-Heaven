import { describe, expect, it } from 'vitest';
import { content, mainCasting } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import {
  addSpellTrade,
  applyPlayState,
  CANTRIP_TRADE,
  initialPlay,
  learnSpell,
  setPreparedCantrip,
  setPreparedSpell,
  setTradedCantrip,
  type PlayState,
} from '../src/rules/play';
import { bookCantripIds, bookLeveledIds, notInBookOf, pickerSpellOptions, spellOptions, spellsHeldBy } from '../src/rules/spellOptions';
import { bookCantripCapacity, bookNoun, cantripsKnown, isBookCaster, notInBookNote, spellbookBudget, wizardSpellbookSize } from '../src/rules/spellcasting';
import { enabledBookSet } from '../src/rules/sources';
import { exportWg, importCharacter } from '../src/data/transfer';
import type { Character, ClassDef, SpellcastingEntry } from '../src/rules/types';

/**
 * BOOK CASTERS PREPARE ONLY FROM THEIR BOOK — owner's bug, 2026-10-14:
 *
 * > "magus (and other spellbook casters) can prepare spells that aren't in their spellbook"
 *
 * Print sizes a book caster's book at 10 / 10 / 8 / 8 cantrips (wizard class-feature-793, witch
 * class-feature-772, magus class-feature-1258, necromancer class-75) and prepares five (six) of them
 * each morning. The app modelled only the five, so the sheet's Prepare-a-cantrip opening — and Spell
 * Blending's traded openings — offered the WHOLE tradition (measured: 54 of 54 arcane cantrips for a
 * level-1 wizard, witch and magus; 38 of 38 occult for a necromancer, whose leveled slots also offered
 * all 93 occult spells because it was not a book caster in the engine at all).
 *
 * The rule now: `build.cantrips` IS the book (`entry.bookCantrips`); the PICKER offers a book caster
 * only its book; the RENDER is never narrower than before — a pick the player stored keeps being
 * drawn, marked "Not in your <book> — add it in the builder" (`entry.notInBook`), never hidden.
 */
const db = content();
const CORE = enabledBookSet(undefined);

/** Ten arcane cantrips (every one also occult-or-not as printed), the wizard's / witch's whole book. */
const ARCANE10 = ['detect-magic', 'light', 'shield', 'daze', 'electric-arc', 'frostbite', 'ignition', 'prestidigitation', 'telekinetic-hand', 'message'];
/** Eight occult cantrips, a necromancer's whole dirge. */
const OCCULT8 = ['detect-magic', 'light', 'shield', 'daze', 'prestidigitation', 'telekinetic-hand', 'message', 'void-warp'];
/** On the arcane AND the occult list, and in none of the books above — the off-book cantrip. */
const OFF_BOOK = 'figment';

const SUB: Record<string, string> = {
  wizard: 'school-of-ars-grammatica',
  witch: 'the-inscribed-one', // an ARCANE patron, so one fixture list serves the wizard, witch and magus
  magus: db.classes.magus?.subclass?.options[0]?.id ?? '',
  necromancer: 'reaper',
};
const BOOK: Record<string, string[]> = {
  wizard: ARCANE10,
  witch: ARCANE10,
  magus: ARCANE10.slice(0, 8),
  necromancer: OCCULT8,
};
const caster = (classId: string, level: number, cantrips: string[], spells: Record<number, string[]> = {}, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Book caster',
    level,
    classId,
    subclassId: SUB[classId] ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'int',
    cantrips,
    spells,
    ...over,
  }) as unknown as BuildState;
const built = (b: BuildState): Character => buildCharacter(b, db);
const shownOf = (ch: Character, play: PlayState = initialPlay(ch, db)): SpellcastingEntry => mainCasting(applyPlayState(ch, play, db))!;
const ids = (xs: { id: string }[]) => xs.map((s) => s.id);
/** The sheet's picker; `keep` is the asking cantrip opening's own pick (SpellsTab passes it). */
const picker = (ch: Character, play: PlayState, rank: number, keep?: string | null) =>
  ids(pickerSpellOptions({ character: applyPlayState(ch, play, db), entry: shownOf(ch, play), content: db }, rank, undefined, CORE, keep));

describe('the book is the size its record prints — a guard on every class with a book', () => {
  const WORDS: Record<string, number> = { four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const num = (w: string) => WORDS[w.toLowerCase()] ?? Number(w);
  /** The class's own printed book sentence, read off its description (the record ships its prose). */
  const printed = (cls: ClassDef) => {
    const text = String(cls.description ?? '').replace(/\s+/g, ' ');
    // "…contains your choice of 10 arcane cantrips and five 1st-rank arcane spells" (wizard, magus);
    // "…contains your choice of eight occult cantrips, the 1st-rank spell harm, and four other 1st-rank" (dirge).
    const book = /\b(?:spellbook|dirge) contains your choice of (\d+|[a-z]+) [a-z]+ cantrips(?:, the 1st-rank spell ([a-z ]+?),)? and (\d+|[a-z]+)(?: other)? 1st-rank/i.exec(text);
    if (book) return { cantrips: num(book[1]), spells: num(book[3]), free: book[2]?.trim() ?? null, sentence: book[0] };
    const fam = /\bfamiliar starts off knowing (\d+|[a-z]+) cantrips, (\d+|[a-z]+) 1st-rank spells/i.exec(text);
    if (fam) return { cantrips: num(fam[1]), spells: num(fam[2]), free: null, sentence: fam[0] };
    return null;
  };
  /** The checker, as a function, so the planted-bad-case leg below runs the very same code. */
  const mismatches = (classes: Record<string, ClassDef>) => {
    const out: string[] = [];
    for (const cls of Object.values(classes)) {
      const p = printed(cls);
      const book = isBookCaster(cls);
      if (p && !book) { out.push(`${cls.id}: prints a book ("${p.sentence}") but is not a book caster`); continue; }
      if (!p && book) { out.push(`${cls.id}: is a book caster but its description prints no book sentence this guard can read`); continue; }
      if (!p) continue;
      if (bookCantripCapacity(cls) !== p.cantrips) out.push(`${cls.id}: book holds ${bookCantripCapacity(cls)} cantrips, print says ${p.cantrips} ("${p.sentence}")`);
      const leveled = cls.spellcasting?.spellbook ? spellbookBudget(cls.spellcasting.spellbook, 1) : wizardSpellbookSize(1);
      if (leveled !== p.spells) out.push(`${cls.id}: book holds ${leveled} 1st-rank spells of your choice, print says ${p.spells}`);
      if (p.free) {
        const freeId = Object.values(db.spells).find((s) => s.name.toLowerCase() === p.free)?.id;
        const owned = (cls.features ?? []).filter((f) => f.level <= 1).flatMap((f) => db.classFeatures[f.featureId]?.grantedSpells ?? []);
        if (!freeId || !(owned as string[]).includes(freeId)) out.push(`${cls.id}: print puts "${p.free}" in the book for free; no level-1 feature grants it`);
      }
    }
    return out;
  };

  it('wizard 10, witch 10, magus 8, necromancer 8 — and every other class with a book sentence too', () => {
    expect(mismatches(db.classes)).toEqual([]);
    // The four the owner's bug is about, named, so a class dropping out of the scan cannot pass quietly.
    expect(['wizard', 'witch', 'magus', 'necromancer'].map((id) => bookCantripCapacity(db.classes[id]))).toEqual([10, 10, 8, 8]);
    expect(['wizard', 'witch', 'magus', 'necromancer'].map((id) => bookNoun(db.classes[id]))).toEqual(['spellbook', 'familiar', 'spellbook', 'dirge']);
    // …and a class with no book has none (the cleric prepares off the whole divine list).
    expect(bookCantripCapacity(db.classes.cleric)).toBeUndefined();
    // The wizard and witch carry no `spellbook` object on purpose (the builder's UMT +1 depends on it).
    expect(db.classes.wizard.spellcasting?.spellbook).toBeUndefined();
    expect(db.classes.witch.spellcasting?.spellbook).toBeUndefined();
  });

  // mutation-proof
  it('…and the checker is not blind: the old data (no cantrip count, no dirge) fails it', () => {
    const old = structuredClone({ magus: db.classes.magus, necromancer: db.classes.necromancer });
    delete old.magus.spellcasting!.spellbook!.cantrips;
    delete old.necromancer.spellcasting!.spellbook;
    const found = mismatches(old as unknown as Record<string, ClassDef>);
    expect(found.some((m) => m.startsWith('magus: book holds undefined cantrips, print says 8'))).toBe(true);
    expect(found.some((m) => m.startsWith('necromancer: prints a book'))).toBe(true);
  });

  it('the necromancer\'s "apply it yourself" note is gone — the dirge is modelled now', () => {
    expect(db.classFeatures['necromancer-spellcasting']?.note).toBeUndefined();
    expect(db.classFeatures['necromancer-spellcasting']?.grantedSpells).toEqual(['harm']);
  });
});

describe('the PICKER offers a book caster only its book', () => {
  for (const classId of ['wizard', 'witch', 'magus', 'necromancer']) {
    // mutation-proof
    it(`${classId}: an off-book cantrip on its own tradition, neither held nor learned, is refused`, () => {
      const ch = built(caster(classId, 3, BOOK[classId]));
      const play = initialPlay(ch, db);
      const entry = shownOf(ch, play);
      expect(entry.bookCantrips, 'fixture: the whole book is built').toEqual(expect.arrayContaining(BOOK[classId]));
      expect(entry.cantrips.length, 'fixture: five (six) of them prepared').toBe(cantripsKnown(classId));
      // The RENDER's list still reaches it — it is on the tradition — so only the picker can refuse it.
      expect(ids(spellOptions({ character: ch, entry, content: db }, 0)), 'fixture: on the tradition').toContain(OFF_BOOK);
      const offered = picker(ch, play, 0);
      expect(offered, 'not in the book, not held, not learned').not.toContain(OFF_BOOK);
      for (const id of BOOK[classId]) expect(offered, `${id} is in the book`).toContain(id);
      const book = bookCantripIds(entry)!;
      for (const id of offered) expect(book.has(id) || spellsHeldBy(ch, entry).has(id), `${id} is offered from outside the book`).toBe(true);
    });
  }

  // mutation-proof
  it('the necromancer\'s LEVELED slots are held to its dirge too (they offered all 93 occult spells)', () => {
    const ch = built(caster('necromancer', 3, OCCULT8, { 1: ['fear', 'command'] }));
    const play = initialPlay(ch, db);
    const offered = picker(ch, play, 1);
    expect(offered.sort()).toEqual(['command', 'fear', 'harm']);
    expect(ids(spellOptions({ character: ch, entry: shownOf(ch, play), content: db }, 1)).length, 'the render still reaches the tradition').toBeGreaterThan(50);
  });

  /* Lane C3 (2026-10-15): an EMPTY leveled book read as "cannot say" (`bookLeveledIds` → null), so a
   * fresh wizard or magus whose builder book held no leveled spell yet was offered its WHOLE tradition at
   * rank 1+ on the sheet — the owner's bug, still reachable (final check: a level-1 wizard offered 51
   * arcane spells, and a pick made there got no marker). The class built the book (`bookCantrips`), so
   * an empty one is an empty book: nothing to ADD. What is drawn is unchanged — a pick stored earlier is
   * drawn and marked. */
  for (const classId of ['wizard', 'magus']) {
    // mutation-proof
    it(`${classId} with an empty leveled book: nothing on offer at 1st rank, and an earlier pick is still drawn, marked`, () => {
      const ch = built(caster(classId, 1, BOOK[classId].slice(0, 5)));
      const play = initialPlay(ch, db);
      const entry = shownOf(ch, play);
      expect(entry.bookCantrips, 'fixture: the class built its book').toBeTruthy();
      expect(Object.values(entry.spellbook ?? {}).flat(), 'fixture: not one leveled spell in it').toEqual([]);
      expect(entry.prepared?.[1]?.length, 'fixture: a 1st-rank slot to prepare').toBeGreaterThan(0);
      expect(ids(spellOptions({ character: ch, entry, content: db }, 1)).length, 'fixture: the tradition has plenty').toBeGreaterThan(20);
      expect(bookLeveledIds(entry), 'an empty book, not "cannot say"').toEqual(new Set());
      expect(picker(ch, play, 1), 'nothing to add until the builder puts a spell in the book').toEqual([]);
      // A pick stored before this (the sheet offered the whole tradition) keeps drawing, castable, marked.
      expect(db.spells.fear?.traditions, 'fixture: fear is arcane').toContain('arcane');
      const earlier = setPreparedSpell(play, `${classId}-casting`, 1, 0, 'fear');
      const shown = shownOf(ch, earlier);
      expect(shown.prepared?.[1]?.[0]?.spellId, 'drawn, not hidden').toBe('fear');
      expect(shown.notInBook, 'and marked').toEqual(['fear']);
      expect(notInBookNote(shown.bookNoun)).toBe('Not in your spellbook — add it in the builder');
      // …and the moment the builder puts a spell in the book, it is offered — and only it.
      const filled = built(caster(classId, 1, BOOK[classId].slice(0, 5), { 1: ['grease'] }));
      expect(picker(filled, initialPlay(filled, db), 1)).toEqual(['grease']);
    });
  }

  it('an entry with no CLASS book keeps "cannot say" — an empty book there still offers the tradition', () => {
    const entry = shownOf(built(caster('wizard', 1, ARCANE10.slice(0, 5))));
    // The same empty book without the class book branch's mark (an archetype's book is built elsewhere).
    expect(bookLeveledIds({ ...entry, bookCantrips: undefined })).toBeNull();
    expect(bookLeveledIds({ ...entry, bookCantrips: undefined, spellbook: undefined })).toBeNull();
    // A book with something in it answers whatever marks it.
    expect(bookLeveledIds({ ...entry, bookCantrips: undefined, spellbook: { 1: ['grease'] } })).toEqual(new Set(['grease']));
  });

  it('Spell Blending\'s traded cantrip openings: a pick there off the book is drawn and marked, and a new one is held to the book', () => {
    const b = caster('wizard', 5, ARCANE10.slice(0, 6), { 1: ['grease', 'force-barrage'], 2: ['see-the-unseen'], 3: ['fireball'] }, { extraChoices: { thesis: ['spell-blending'] } } as never);
    const ch = built(b);
    let play = initialPlay(ch, db);
    play = addSpellTrade(play, shownOf(ch, play), 1, CANTRIP_TRADE);
    play = setTradedCantrip(play, 'wizard-casting', 0, OFF_BOOK);
    const entry = shownOf(ch, play);
    expect(entry.tradedCantrips?.[0], 'the pick made before the book was enforced is drawn').toBe(OFF_BOOK);
    expect(entry.notInBook).toContain(OFF_BOOK);
    // The traded opening asks the same picker as every cantrip opening (SpellsTab optionsFor(0)).
    expect(picker(ch, play, 0)).not.toContain('sigil');
    expect(picker(ch, play, 0)).toContain(ARCANE10[5]);
  });
});

describe('the RENDER is never narrower than before', () => {
  // mutation-proof
  it('learning a cantrip hides nothing the player prepared (it hid every off-book opening)', () => {
    /* Learn a Spell merges a learned cantrip into `spellbook[0]`, and a rank-0 book list used to
     * REPLACE the tradition in the render: learn daze, and the opening holding shield went "Empty
     * cantrip" while the store still held it (measured 2026-10-14). */
    const ch = built(caster('wizard', 3, ['detect-magic', 'light']));
    let play = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 0, 'shield');
    expect(shownOf(ch, play).cantripSlots?.[0], 'fixture: drawn before the learning').toBe('shield');
    play = learnSpell(play, 'wizard-casting', 0, 'daze');
    const entry = shownOf(ch, play);
    expect(entry.cantripSlots?.[0], 'the prepared cantrip is still drawn').toBe('shield');
    expect(entry.cantrips, '…and castable').toContain('shield');
    expect(entry.notInBook, '…and said').toEqual(['shield']);
    expect(picker(ch, play, 0), 'the learned one is now preparable').toContain('daze');
  });

  it('a stored leveled pick the book no longer holds is drawn and marked, and the picker no longer offers it', () => {
    const b = caster('wizard', 3, ['detect-magic'], { 1: ['grease', 'force-barrage'] });
    const ch = built(b);
    const play = setPreparedSpell(initialPlay(ch, db), 'wizard-casting', 1, 0, 'grease');
    const rewritten = built(caster('wizard', 3, ['detect-magic'], { 1: ['force-barrage', 'sure-strike'] }));
    const entry = shownOf(rewritten, play);
    expect(entry.prepared?.[1]?.[0]?.spellId).toBe('grease');
    expect(entry.notInBook).toEqual(['grease']);
    expect(picker(rewritten, play, 1)).not.toContain('grease');
    expect(picker(rewritten, play, 1)).toEqual(expect.arrayContaining(['force-barrage', 'sure-strike']));
  });

  it('a pick no list of this caster holds at all is still not drawn (a divine-only cantrip on a wizard)', () => {
    const ch = built(caster('wizard', 3, ['detect-magic']));
    const play = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 0, 'stabilize');
    expect(shownOf(ch, play).cantripSlots?.[0]).toBeNull();
    expect(play.preparedSpells?.['wizard-casting:cantrip:0'], 'and not deleted').toBe('stabilize');
  });
});

describe('existing saved characters — nothing rewritten, nothing lost', () => {
  it('a wizard with six stored cantrips is a book of six with four places free', () => {
    const six = ARCANE10.slice(0, 6);
    const b = caster('wizard', 1, six);
    const ch = built(b);
    const e = mainCasting(ch)!;
    expect(b.cantrips, 'the store is not touched').toEqual(six);
    expect(e.cantrips, 'the same six prepared as before').toEqual(six);
    expect(e.cantripCap).toBe(6);
    expect(e.bookCantrips).toEqual(six);
    expect(bookCantripCapacity(db.classes.wizard)! - e.bookCantrips!.length, 'four places free in the builder').toBe(4);
    expect(e.bookNoun).toBe('spellbook');
  });

  it('an off-book cantrip prepared on the sheet before the fix is still drawn and castable, with the marker', () => {
    const ch = built(caster('magus', 1, ARCANE10.slice(0, 5)));
    const play = setPreparedCantrip(initialPlay(ch, db), 'magus-casting', 2, OFF_BOOK);
    const entry = shownOf(ch, play);
    expect(entry.cantripSlots?.[2]).toBe(OFF_BOOK);
    expect(entry.cantrips, 'castable at will').toContain(OFF_BOOK);
    expect(entry.notInBook).toEqual([OFF_BOOK]);
    expect(notInBookNote(entry.bookNoun)).toBe('Not in your spellbook — add it in the builder');
    expect(play.preparedSpells?.['magus-casting:cantrip:2'], 'the store is never touched').toBe(OFF_BOOK);
    // It stays on offer in ITS OWN opening (desk #170's keep for what an opening holds) — and once
    // the player puts something else there, it is no longer offered: their own action.
    // (This used to call the picker with no opening and expect OFF_BOOK: every opening's pick was kept on
    // offer in every opening, which let it be copied into another — the lane C1 check. Now `keep` names it.)
    expect(picker(ch, play, 0, OFF_BOOK), 'in opening 2, which holds it').toContain(OFF_BOOK);
    expect(picker(ch, play, 0, ARCANE10[0]), 'in opening 0, which does not').not.toContain(OFF_BOOK);
    const changed = setPreparedCantrip(play, 'magus-casting', 2, ARCANE10[0]);
    expect(picker(ch, changed, 0, ARCANE10[0])).not.toContain(OFF_BOOK);
  });

  // mutation-proof
  it('an off-book pick is offered ONLY in the opening that holds it — never copied into another, Spell Blending\'s included', () => {
    /* The picker kept every opening's off-book pick on offer in every opening (the prepared ones, and
     * Spell Blending's traded ones), so one legacy off-book cantrip could be copied into a second
     * opening — the owner's bug in a narrower shape (lane C1 check, 2026-10-14). */
    const ch = built(caster('wizard', 5, ARCANE10.slice(0, 6), { 1: ['grease', 'force-barrage'], 2: ['see-the-unseen'], 3: ['fireball'] }, { extraChoices: { thesis: ['spell-blending'] } } as never));
    let play = setPreparedCantrip(initialPlay(ch, db), 'wizard-casting', 2, OFF_BOOK);
    play = addSpellTrade(play, shownOf(ch, play), 1, CANTRIP_TRADE);
    play = setTradedCantrip(play, 'wizard-casting', 0, 'tangle-vine');
    const entry = shownOf(ch, play);
    expect([entry.cantripSlots?.[2], entry.tradedCantrips?.[0]], 'fixture: both drawn').toEqual([OFF_BOOK, 'tangle-vine']);
    expect(entry.notInBook?.slice().sort(), 'fixture: both off the book').toEqual([OFF_BOOK, 'tangle-vine'].sort());
    // Each in its own opening…
    expect(picker(ch, play, 0, OFF_BOOK)).toContain(OFF_BOOK);
    expect(picker(ch, play, 0, 'tangle-vine')).toContain('tangle-vine');
    // …and neither anywhere else: another prepared opening, the other traded opening, an empty one.
    for (const keep of [entry.cantripSlots?.[0], entry.tradedCantrips?.[1] ?? null, null]) {
      const offered = picker(ch, play, 0, keep);
      expect(offered, `asked by an opening holding ${keep}`).not.toContain(OFF_BOOK);
      expect(offered, `asked by an opening holding ${keep}`).not.toContain('tangle-vine');
      expect(offered, 'the book is still on offer').toEqual(expect.arrayContaining(ARCANE10.slice(0, 6)));
    }
  });

  // mutation-proof
  it('a necromancer who prepared the same spell twice (the old per-slot picker) still has it twice — drawn and through a rebuild', () => {
    /* The old necromancer took the cleric branch, slot i = `spells[rank][i]`, so ['fear', 'fear'] was
     * fear in both 1st-rank slots. The dirge's book is a set, and filling the standing preparation from
     * the set drew [fear, harm] — a preparation the player never made (lane C1 check, 2026-10-14). */
    const b = caster('necromancer', 3, OCCULT8.slice(0, 5), { 1: ['fear', 'fear'], 2: ['invisibility'] });
    const ch = built(b);
    const e = mainCasting(ch)!;
    expect(e.prepared?.[1]?.length, 'fixture: two 1st-rank slots').toBe(2);
    expect(e.prepared?.[1]?.map((s) => s.spellId), 'the preparation the player made').toEqual(['fear', 'fear']);
    expect(e.spellbook?.[1]?.slice().sort(), 'the dirge itself holds each spell once, harm for free').toEqual(['fear', 'harm']);
    expect(shownOf(ch).prepared?.[1]?.map((s) => s.spellId), 'and the sheet draws it').toEqual(['fear', 'fear']);
    expect(shownOf(ch).notInBook, 'nothing to mark').toBeUndefined();
    // A rebuild with no stored build (App, the GM sheet) reads the set — and kept one fear.
    const derived = deriveBuildFromCharacter(ch, db);
    expect(derived.spells[1], 'the derived build keeps the repeat').toEqual(['fear', 'fear']);
    expect(mainCasting(buildCharacter(derived, db))?.prepared?.[1]?.map((s) => s.spellId), 'and the rebuild draws it').toEqual(['fear', 'fear']);
    // A wizard's book list never repeats, and its derive is the list it always was.
    const wiz = built(caster('wizard', 3, ['detect-magic'], { 1: ['grease', 'force-barrage', 'sure-strike'] }));
    expect(deriveBuildFromCharacter(wiz, db).spells[1]).toEqual(['grease', 'force-barrage', 'sure-strike']);
  });

  it('a Wanderer\'s Guide wizard with ten cantrips keeps all ten — through the import and a rebuild', () => {
    const file = JSON.stringify({
      version: 4,
      character: {
        name: 'Imported Wizard',
        level: 1,
        details: { ancestry: { name: 'Human' }, background: { name: 'Acolyte' }, class: { name: 'Wizard' } },
        inventory: { coins: {}, items: [] },
      },
      content: {
        attributes: { ATTRIBUTE_INT: { value: 4 } },
        feats_features: { classFeats: [], ancestryFeats: [], generalAndSkillFeats: [], otherFeats: [] },
        spells: { cantrips: ARCANE10.map((id) => ({ name: db.spells[id]!.name, rank: 0 })), normal: [] },
        languages: ['COMMON'],
      },
    });
    const { saved } = importCharacter(file, db);
    expect(saved.build?.cantrips, 'the import stores all ten').toHaveLength(10);
    const e = mainCasting(saved.character as Character)!;
    expect(e.bookCantrips, 'the book holds all ten').toHaveLength(10);
    // A character rebuilt WITHOUT its stored build (App's rebuild, the GM sheet, an export) goes
    // through deriveBuildFromCharacter, which read `cantrips` — the six prepared — and cut four.
    const again = buildCharacter(deriveBuildFromCharacter(saved.character as Character, db), db);
    expect(mainCasting(again)?.bookCantrips?.slice().sort()).toEqual(e.bookCantrips!.slice().sort());
  });

  // mutation-proof
  it('the export\'s readable spell list names the whole book, not only the six prepared', () => {
    /* contentSnapshot listed `cantrips`, the repertoire, the prepared slots and the leveled book — and so
     * left out the four book cantrips past the six prepared (lane C1 check, 2026-10-14). */
    const ch = built(caster('wizard', 1, ARCANE10));
    expect(mainCasting(ch)!.cantrips, 'fixture: six prepared').toHaveLength(6);
    const listed: string[] = JSON.parse(exportWg({ id: 'book-export', character: ch, archived: false }, db)).content.spells;
    for (const id of ARCANE10) expect(listed, `${id} is in the book`).toContain(db.spells[id]!.name);
  });

  it('an existing necromancer keeps every spell it had — its old per-rank picks become its dirge', () => {
    // Picked the old way: per prepared slot, off the whole occult list (psychic table at 5th: 2/2/1).
    const picks = { 1: ['fear', 'command'], 2: ['invisibility', 'see-the-unseen'], 3: ['slow'] };
    for (const id of Object.values(picks).flat()) expect(db.spells[id]?.traditions, `fixture: ${id} is occult`).toContain('occult');
    const b = caster('necromancer', 5, OCCULT8.slice(0, 5), picks);
    const e = mainCasting(built(b))!;
    for (const [rank, list] of Object.entries(picks)) {
      expect(e.spellbook?.[Number(rank)], `rank ${rank}: every pick is in the dirge`).toEqual(expect.arrayContaining(list));
      expect(e.prepared?.[Number(rank)]?.slice(0, list.length).map((s) => s.spellId), `rank ${rank}: and still prepared, in order`).toEqual(list);
    }
    expect(e.spellbook?.[1], 'harm is in the dirge for free').toContain('harm');
    expect(e.bookCantrips).toEqual(OCCULT8.slice(0, 5));
    expect(e.bookNoun).toBe('dirge');
    // The dirge's budget is the four of your choice + 2 a level; harm is not charged to it.
    const own = Object.values(picks).flat().length;
    expect(own).toBeLessThanOrEqual(spellbookBudget(db.classes.necromancer.spellcasting!.spellbook!, 5));
    const derived = deriveBuildFromCharacter(built(b), db);
    expect(derived.spells, 'a rebuild gives back exactly the player\'s picks (harm stripped as a grant)').toEqual(picks);
    // …and a pick prepared on the sheet off the dirge is drawn with the dirge's own word.
    const play = setPreparedSpell(initialPlay(built(b), db), 'necromancer-casting', 1, 0, 'phantom-pain');
    const shown = shownOf(built(b), play);
    expect(shown.prepared?.[1]?.[0]?.spellId).toBe('phantom-pain');
    expect(notInBookOf(shown)).toEqual(['phantom-pain']);
    expect(notInBookNote(shown.bookNoun)).toBe('Not in your dirge — add it in the builder');
  });
});
