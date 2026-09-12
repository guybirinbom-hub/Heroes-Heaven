// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { build, content, mainCasting } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { initialPlay, type PlayState } from '../src/rules/play';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { wizardSpellbookBudget } from '../src/rules/spellcasting';
import type { Character } from '../src/rules/types';

/**
 * FLEXIBLE SPELLCASTER ON A BOOK CASTER — desk #155.
 *
 * Owner, 2026-09-12, reading the live Archives page (archetype-99, Secrets of Magic pg. 209): a
 * wizard, witch or magus who takes the archetype KEEPS its book and its restricted slots and prepares
 * the flat collection OUT of the book.
 *
 * Print: *"You learn spells as normal for your class (a wizard uses a spellbook, a witch teaches
 * spells to their familiar, and so on)"*; *"Select these spells from the same source as normal, such
 * as from a spellbook for a wizard"*; *"Extra spell slots you gain that have additional restrictions,
 * like the wizard's specialist school spells or the cleric's divine font spells, don't change due to
 * this archetype, nor do such spells count toward the number of spells you place in your spell
 * collection."*
 *
 * Batch 037 built the collection for the classes that FALL THROUGH to it — cleric, druid, animist —
 * and the book branch is tested first, so a flexible wizard reached neither: measured before this
 * file, a flexible wizard at every level built a `prepared` entry with no `slots` and no `repertoire`
 * at all, paying the archetype's slot cap and cantrip cut for nothing. A bare reorder of the two
 * branches is the WRONG fix: `restrictedSlots` (the curriculum lane) is built only inside the book
 * branch, so reordering hands the archetype the collection and takes the school's slots away.
 */
const db = content();
const noop = () => undefined;

/** Six 1st-rank arcane spells, so a book can hold more of the rank than the collection can prepare. */
const BOOK1 = ['grease', 'sure-strike', 'mystic-armor', 'breathe-fire', 'snowball', 'negate-aroma'];
const BOOK2 = ['acid-grip', 'dispel-magic', 'gecko-grip'];
const BOOK3 = ['fireball', 'haste'];
const BOOK4 = ['fly', 'weapon-storm'];
/** A common 1st-rank arcane spell deliberately NOT written into any book below. */
const UNLEARNED1 = 'admonishing-ray';

const flex = (classId: string, level: number, subclassId: string | null, spells: Record<number, string[]>): BuildState =>
  ({
    ...emptyBuild(),
    name: 'flex',
    level,
    classId,
    subclassId,
    ancestryId: Object.keys(db.ancestries)[0],
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: classId === 'cleric' ? 'wis' : 'int',
    featPicks: { '2:class:0': 'flexible-spellcaster-dedication' },
    spells,
  }) as unknown as BuildState;

/** A wizard with a real arcane school, so the curriculum's restricted slots are actually built. */
const WIZ_SCHOOL = db.classes.wizard.subclass!.options.find((o) => o.id !== 'school-of-unified-magical-theory')!.id;
const flexWiz = (level: number, spells: Record<number, string[]>) => flex('wizard', level, WIZ_SCHOOL, spells);
const built = (b: BuildState): Character => buildCharacter(b, db);
/** The collection: ranks 1-9 of the repertoire (the capstone 10th slot is outside it). */
const collected = (ch: Character) =>
  Object.entries(mainCasting(ch)?.repertoire ?? {}).filter(([r]) => Number(r) <= 9).flatMap(([, ids]) => ids);

describe('a flexible WIZARD keeps its spellbook and curriculum and prepares a collection out of the book', () => {
  // desk 155: flexible-book-casters
  // mutation-proof
  it('collects Table 5-1’s number at 2nd, 4th and 8th — 2, 4, 8 — over slots capped at 2 per rank', () => {
    /* Table 5-1's Collection column: 2 at 2nd, 4 at 4th, 8 at 8th, and the archetype's price is that
     * *"your number of spell slots per day don't advance from 2 to 3"* — an unmodified wizard has 3 of
     * each rank from 4th on. Before this the entry had no `slots` and no `repertoire` at all. */
    for (const [level, size, ranks] of [
      [2, 2, 1],
      [4, 4, 2],
      [8, 8, 4],
    ] as const) {
      const picks: Record<number, string[]> = { 1: BOOK1.slice(0, 2) };
      if (ranks >= 2) picks[2] = BOOK2.slice(0, 2);
      if (ranks >= 3) picks[3] = BOOK3;
      if (ranks >= 4) picks[4] = BOOK4;
      const main = mainCasting(built(flexWiz(level, picks)))!;
      expect(main.type, `L${level}: a collection casts spontaneous-shaped`).toBe('spontaneous');
      expect(main.prepared, `L${level}: nothing is nailed into a slot any more`).toBeUndefined();
      expect(collected(built(flexWiz(level, picks))).length, `L${level}: Table 5-1's Collection column`).toBe(size);
      expect(Object.keys(main.slots ?? {}).map(Number).sort((a, b) => a - b), `L${level}: the ranks it casts from`).toEqual(
        Array.from({ length: ranks }, (_, i) => i + 1),
      );
      for (const [r, s] of Object.entries(main.slots ?? {}))
        expect(s.max, `L${level}: rank ${r} never advances past 2`).toBe(2);
    }
  });

  // desk 155: flexible-book-casters
  // mutation-proof
  it('the CURRICULUM slots are still there, one per rank, and none of them costs a collection place', () => {
    /* *"Extra spell slots you gain that have additional restrictions, like the wizard's specialist
     * school spells … don't change due to this archetype, nor do such spells count toward the number
     * of spells you place in your spell collection."* The restricted lane is built inside the book
     * branch — which is exactly why reordering the branches is the wrong fix. */
    const main = mainCasting(built(flexWiz(8, { 1: BOOK1.slice(0, 2), 2: BOOK2.slice(0, 2), 3: BOOK3, 4: BOOK4 })))!;
    const curriculum = (main.restrictedSlots ?? []).filter((s) => s.label === 'Curriculum');
    expect(curriculum.map((s) => s.rank), 'one per rank the wizard can cast').toEqual([1, 2, 3, 4]);
    for (const s of curriculum) expect(s.allowed?.length, `rank ${s.rank} offers its school's list`).toBeGreaterThan(0);
    expect(collected(built(flexWiz(8, { 1: BOOK1.slice(0, 2), 2: BOOK2.slice(0, 2), 3: BOOK3, 4: BOOK4 }))).length,
      'still 8 — the four curriculum slots added none and spent none').toBe(8);
  });

  // desk 155: flexible-book-casters
  // mutation-proof
  it('the SPELLBOOK is untouched and the collection is drawn from it — book 6 at 1st rank, collection 4', () => {
    /* *"You learn spells as normal for your class"*: the archetype changes preparation, not learning,
     * so the book keeps every spell the wizard wrote into it while the collection stays at Table 5-1's
     * size — and every collected spell is one of the book's. */
    const ch = built(flexWiz(4, { 1: BOOK1, 2: BOOK2 }));
    const main = mainCasting(ch)!;
    expect(main.spellbook?.[1], 'the book keeps all six').toEqual(BOOK1);
    expect(main.spellbook?.[2]).toEqual(BOOK2);
    const pool = collected(ch);
    expect(pool.length, 'the collection is Table 5-1’s 4, not the book’s nine').toBe(4);
    const book = new Set(Object.values(main.spellbook ?? {}).flat());
    for (const id of pool) expect(book.has(id), `${id} is prepared out of the spellbook`).toBe(true);
    expect(pool, 'filled from the lowest rank up, so the printed 1st-rank floor holds itself').toEqual(BOOK1.slice(0, 4));
  });

  // desk 155: flexible-book-casters
  // mutation-proof
  it('the printed 1st-rank floor holds a place for a book with no 1st-rank spell in it', () => {
    /* *"you must select at least one 1st-level spell for your collection each time you prepare,
     * ensuring that you can use all your spell slots each day"* — the same floor the collection branch
     * holds, which is the point of sharing one filler rather than writing a second one. */
    const ch = built(flexWiz(4, { 2: BOOK2 }));
    expect(mainCasting(ch)?.repertoire?.[1] ?? [], 'nothing 1st-rank to prepare').toEqual([]);
    expect(collected(ch).length, 'three of four places filled; the fourth waits for a 1st-rank spell').toBe(3);
  });

  // desk 155: flexible-book-casters
  // mutation-proof
  it('at 19th the capstone 10th-rank slot stays outside the collection’s 18 places', () => {
    const picks: Record<number, string[]> = { 10: ['wish'] };
    for (let r = 1; r <= 9; r++) picks[r] = ['grease', 'sure-strike'];
    const ch = built(flexWiz(19, picks));
    const main = mainCasting(ch)!;
    expect(main.slots?.[10], 'the capstone slot is there').toEqual({ max: 1, used: 0 });
    expect(main.repertoire?.[10], 'and its spell survives a full collection').toEqual(['wish']);
    expect(collected(ch).length, 'nine ranks × 2 — Table 5-1’s Collection 18 at 19th').toBe(18);
  });

  /* The cantrip ladder is composed elsewhere (`cantripDelta` −2 on the class archetype, the
   * dedication's own `spellSlotBonus.cantripsAt` give-back) and was already right; it is asserted here
   * because the ruling names it and because the book branch is where a wizard's count is finally read. */
  // desk 155: flexible-book-casters
  it('cantrips follow Table 5-1 — 3 / 4 / 5 for a five-cantrip class, and a wizard’s curriculum cantrip on top', () => {
    /* feat-2994: *"four cantrips per day instead of three. At 4th level, five instead of four."* A
     * cleric's five class cantrips − 2 = 3, then 4 from 2nd and 5 from 4th. A wizard's class count is
     * six (the school's curriculum cantrip is one of them), so its ladder sits one higher throughout. */
    const capOf = (b: BuildState) => mainCasting(built(b))!.cantripCap;
    expect(capOf(flex('cleric', 2, 'cloistered-cleric', {})), 'cleric 2nd: four instead of three').toBe(4);
    expect(capOf(flex('cleric', 4, 'cloistered-cleric', {})), 'cleric 4th: five instead of four').toBe(5);
    expect([capOf(flexWiz(2, {})), capOf(flexWiz(4, {})), capOf(flexWiz(8, {}))], 'wizard: the same ladder + the curriculum cantrip').toEqual([5, 6, 6]);
  });
});

describe('the other two book casters take the same shape', () => {
  // desk 155: flexible-book-casters
  // mutation-proof
  it('a flexible WITCH prepares its collection out of the familiar, patron spell and all', () => {
    /* *"a witch teaches spells to their familiar"* — the familiar IS the book, and the patron's taught
     * spell is written into it (patron-N: *"your familiar learns …"*), so it is collectible like any
     * other entry rather than riding free on top of the pool. */
    const ch = built(flex('witch', 4, 'baba-yaga', { 1: BOOK1.slice(0, 2), 2: BOOK2.slice(0, 2) }));
    const main = mainCasting(ch)!;
    expect(main.type).toBe('spontaneous');
    expect(main.prepared).toBeUndefined();
    expect(main.spellbook?.[1], 'the patron spell is in the familiar').toContain('chilling-spray');
    expect(collected(ch).length, 'Table 5-1’s 4 at 4th').toBe(4);
    expect((main.restrictedSlots ?? []).length, 'a witch has no curriculum slot').toBe(0);
    const book = new Set(Object.values(main.spellbook ?? {}).flat());
    for (const id of collected(ch)) expect(book.has(id), `${id} is in the familiar`).toBe(true);
  });

  // desk 155: flexible-book-casters
  // mutation-proof
  it('a flexible MAGUS prepares its collection out of its own spellbook', () => {
    /* The magus qualifies by the dedication's own prerequisite — it prepares spells in slots and gets
     * the same number per day — and carries `spellcasting.spellbook` on its class record, which is the
     * test the book branch runs. */
    const ch = built(flex('magus', 4, 'inexorable-iron', { 1: BOOK1.slice(0, 2), 2: BOOK2.slice(0, 2) }));
    const main = mainCasting(ch)!;
    expect(main.type).toBe('spontaneous');
    expect(main.prepared).toBeUndefined();
    expect(main.spellbook?.[1]).toEqual(BOOK1.slice(0, 2));
    expect(collected(ch).length).toBe(4);
    for (const [r, s] of Object.entries(main.slots ?? {})) expect(s.max, `rank ${r} capped at 2`).toBe(2);
  });

  // desk 155: flexible-book-casters
  it('a flexible CLERIC is UNCHANGED — no book, the batch-037 shape exactly', () => {
    const ch = built(flex('cleric', 4, 'cloistered-cleric', { 1: ['heal', 'bless'], 2: ['restoration', 'spiritual-armament'] }));
    const main = mainCasting(ch)!;
    expect(main.spellbook, 'a cleric prepares from the whole divine list — no book').toBeUndefined();
    expect(main.type).toBe('spontaneous');
    expect(main.repertoire?.[1]).toEqual(['heal', 'bless']);
    expect(main.repertoire?.[2]).toEqual(['restoration', 'spiritual-armament']);
    expect(collected(ch).length).toBe(4);
    expect(main.signatureFixed).toEqual(main.signature);
  });
});

describe('the BUILDER still spends the book, and the SHEET prepares the collection out of it', () => {
  /** Open the builder on a level page the way a player does — the level chip. */
  const openAt = (b: BuildState, level: number) => {
    const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === String(level)) ?? null);
    return r;
  };
  const flat = (host: HTMLElement) => (host.textContent ?? '').replace(/\s+/g, ' ');

  // desk 155: flexible-book-casters
  // mutation-proof
  it('a flexible wizard’s rail is its SPELLBOOK at the book’s own budget — not a four-place collection', () => {
    /* The builder chooses what the wizard LEARNS; the collection is the daily preparation the sheet
     * draws out of it. Reading the archetype-flipped cast type here made `isWizardBook` false, so the
     * level-4 page offered a 4-spell "Spell collection" where the book holds eleven — and every book
     * spell past the fourth became unpickable. */
    const r = openAt(flexWiz(4, { 1: BOOK1.slice(0, 2), 2: BOOK2.slice(0, 2) }), 4);
    const text = flat(r.host);
    expect(wizardSpellbookBudget(4), 'the wizard ladder: 5 at 1st, +2 a level').toBe(11);
    expect(text, 'the rail the player is actually spending').toContain('Spellbook — 4 / 11 learned');
    expect(text, 'and not the collection rail, which is not what the builder chooses').not.toContain('Spell collection');
    r.stop();
  });

  // desk 155: flexible-book-casters
  it('…and a flexible cleric’s rail is still the collection — batch 037 untouched', () => {
    const r = openAt(flex('cleric', 3, 'cloistered-cleric', { 1: ['heal'], 2: ['restoration'] }), 3);
    expect(flat(r.host), 'the pool count a cleric spends against').toContain('Spell collection — 2 / 4 collected');
    r.stop();
  });

  // desk 155: flexible-book-casters
  // mutation-proof
  it('the sheet’s collection picker offers ONLY the spellbook — a spell the wizard never learned is not on it', () => {
    /* *"Select these spells from the same source as normal, such as from a spellbook for a wizard."*
     * The manage modal branched on SPONTANEOUS before it branched on the book, so a flexible wizard's
     * collection could be stocked from the whole arcane list — spells that are in no book they own.
     *
     * ruling #102 / desk 155: built at 8th with a PARTLY filled book, so the pool has places left and
     * the Add control is there to click. At 4th with the whole book written in, the collection is full
     * (4 of 4) and the sheet now correctly offers no Add at all — which used to be offered, and would
     * have spent a place the pool did not have. */
    const ch = built(flexWiz(8, { 1: BOOK1.slice(0, 2), 2: BOOK2.slice(0, 2) }));
    let play: PlayState = initialPlay(ch, db);
    const onPlay = (fn: (p: PlayState) => PlayState) => {
      play = fn(play);
    };
    const r = renderDom(<SpellsTab character={ch} content={db} onPlay={onPlay} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.ms-btn')].find((b) => b.title === 'Manage spells for this session') ?? null);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.ms-add')].find((b) => (b.textContent ?? '').includes('2nd-rank')) ?? null);
    const offered = [...r.host.querySelectorAll('.pick-row .picker-name')].map((n) => (n.textContent ?? '').trim());
    expect(offered.length, 'a 2nd-rank slot may hold any book spell of 2nd rank or lower').toBeGreaterThan(0);
    const bookNames = new Set([...BOOK1, ...BOOK2].map((id) => db.spells[id]!.name));
    for (const name of offered) expect(bookNames.has(name), `${name} is in the spellbook`).toBe(true);
    expect(offered, 'a common 1st-rank arcane spell that is in no book this wizard owns').not.toContain(db.spells[UNLEARNED1]!.name);
    r.stop();
  });
});

/*
 * THE SHEET'S ADD GATE HAS TO CAP THE POOL, NOT THE RANK — ruling #102, reached through desk #155.
 *
 * The engine built the flat collection; ManageSpells still capped an add at `entry.slots[rank].max`,
 * which is the PF2e repertoire rule. So a flexible caster holding two 1st-rank spells was told
 * "Repertoire full (2 known)" with half the pool unspent, and the ruling was unreachable from the one
 * surface that spends it. The cap now comes from `entry.spellCollection` (stamped by
 * fillSpellCollection), minus what is collected across ALL ranks, minus the place held for the printed
 * 1st-rank floor.
 */
describe('a flexible collection is spent as ONE pool from the Manage Spells sheet', () => {
  /** Open Manage spells and hand back the live host. Caller must stop(). */
  const manage = (ch: Character) => {
    let play: PlayState = initialPlay(ch, db);
    const r = renderDom(<SpellsTab character={ch} content={db} onPlay={(fn) => { play = fn(play); }} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.ms-btn')].find((b) => b.title === 'Manage spells for this session') ?? null);
    return r;
  };
  const addButton = (host: HTMLElement, label: string) =>
    [...host.querySelectorAll<HTMLButtonElement>('button.ms-add')].find((b) => (b.textContent ?? '').includes(label)) ?? null;
  const capNotes = (host: HTMLElement) => [...host.querySelectorAll('.ms-cap-note')].map((n) => (n.textContent ?? '').trim());

  /* A flexible CLERIC — ruling #102's original subject, and the one whose picker can actually show the
   * case. A book caster's collection is filled from the book lowest-rank-first, so "the pool still has
   * room" and "an uncollected 1st-rank book spell exists" cannot both be true on a fresh build; a
   * cleric collects from the whole divine list, so the 1st rank always has more to offer. The gate
   * under test is the same code for both. */
  const flexCleric = (level: number, spells: Record<number, string[]>) =>
    built(flex('cleric', level, 'cloistered-cleric', spells));
  const DIV1 = ['magic-stone', 'admonishing-ray'];

  // desk 155: flexible-book-casters
  // mutation-proof
  it('a 3rd 1st-rank spell can be added while the pool has room, though the rank has only 2 slots', () => {
    /* L4 flexible cleric: Table 5-1 gives a collection of 4, and the archetype caps slots at 2 per
     * rank. Two spells are collected, so two places are free — and the 1st rank must accept more even
     * though its own slot count is 2. This is the exact shape the old cap refused: it read
     * `slots[1].max`, saw 2 known against 2, and printed "Repertoire full (2 known)". */
    const ch = flexCleric(4, { 1: DIV1 });
    const main = mainCasting(ch)!;
    expect(main.spellCollection, 'the pool size is stamped on the entry').toBe(4);
    expect(main.slots?.[1]?.max, "…and it is NOT the rank's slot count").toBe(2);
    expect((main.repertoire?.[1] ?? []).length, 'two of the four places are spent').toBe(2);

    const r = manage(ch);
    try {
      expect(addButton(r.host, '1st-rank'), 'the 1st-rank Add is offered with room left in the pool').toBeTruthy();
      expect(capNotes(r.host).join(' | '), 'nothing claims a rank is full').not.toMatch(/full/i);
      r.click(addButton(r.host, '1st-rank'));
      const rows = [...r.host.querySelectorAll<HTMLButtonElement>('.pick-row button.pick-add')];
      expect(rows.length, 'and the picker offers addable 1st-rank spells').toBeGreaterThan(0);
      expect(rows.some((b) => !b.disabled), 'at least one is live, not greyed').toBe(true);
    } finally { r.stop(); }
  });

  // desk 155: flexible-book-casters
  // mutation-proof
  it('…and the pool, not the rank, is what runs out for a cleric too', () => {
    /* Four collected at ONE rank against a collection of 4 — impossible under a per-rank cap of 2,
     * which is the whole point of the flat pool. The sheet names the limit it hit. */
    const ch = flexCleric(4, { 1: [...DIV1, 'echoing-weapon', 'breadcrumbs'] });
    expect(collected(ch).length).toBe(4);
    const r = manage(ch);
    try {
      expect(addButton(r.host, '1st-rank')).toBeNull();
      expect(capNotes(r.host)).toContain('Collection full (4 of 4)');
    } finally { r.stop(); }
  });

  // desk 155: flexible-book-casters
  // mutation-proof
  it('…and is refused once the POOL is full, named as a collection', () => {
    /* L4: the collection is 4 and the book's six 1st-rank spells fill it from the lowest rank up, so
     * every place is spent. The message has to say which limit was hit — "Repertoire full (2 known)"
     * on a rank holding four spells is a number the player cannot make sense of. */
    const ch = built(flexWiz(4, { 1: BOOK1, 2: BOOK2 }));
    expect(collected(ch).length).toBe(4);
    const r = manage(ch);
    try {
      expect(addButton(r.host, '1st-rank'), 'no Add while the pool is spent').toBeNull();
      expect(capNotes(r.host)).toContain('Collection full (4 of 4)');
      expect(capNotes(r.host).join(' | '), 'and never the per-rank wording').not.toMatch(/Repertoire full/);
    } finally { r.stop(); }
  });

  // desk 155: flexible-book-casters
  // mutation-proof
  it('an ORDINARY spontaneous caster still caps per rank, and says so', () => {
    /* The control. Nothing but a collection carries `spellCollection`, so a sorcerer's repertoire is
     * untouched — if this ever reads "Collection full" the marker has leaked onto every entry. */
    const ch = build('sorcerer', 4, { spells: { 1: BOOK1.slice(0, 4), 2: BOOK2.slice(0, 3) } } as Partial<BuildState>);
    const main = mainCasting(ch)!;
    expect(main.spellCollection, 'a plain spontaneous entry holds no collection').toBeUndefined();
    const r = manage(ch);
    try {
      const notes = capNotes(r.host).join(' | ');
      expect(notes, 'the per-rank wording, or no note at all').not.toMatch(/Collection full/);
      const cap = main.slots?.[1]?.max ?? 0;
      const known = (main.repertoire?.[1] ?? []).filter((id) => !(main.grantedRepertoire?.[1] ?? []).includes(id)).length;
      // The gate is still the rank's own slot count: Add is offered exactly while the rank has room.
      expect(!!addButton(r.host, '1st-rank')).toBe(known < cap);
      if (known >= cap) expect(notes).toMatch(new RegExp(`Repertoire full \\(${cap} known\\)`));
    } finally { r.stop(); }
  });
});
