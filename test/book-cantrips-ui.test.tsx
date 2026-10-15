// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { addSpellTrade, applyPlayState, CANTRIP_TRADE, initialPlay, setPreparedCantrip, setTradedCantrip, type PlayState } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/**
 * BOOK CASTERS — what the player SEES (owner's bug 2026-10-14: "magus (and other spellbook casters)
 * can prepare spells that aren't in their spellbook"). test/book-cantrips.test.ts holds the engine;
 * this holds the two pages: the builder's cantrip row is the BOOK, and the sheet SAYS when a drawn
 * pick is not in it.
 */
const db = content();
const noop = () => undefined;
const flat = (host: HTMLElement) => (host.textContent ?? '').replace(/\s+/g, ' ');

const SUB: Record<string, string> = {
  wizard: 'school-of-ars-grammatica',
  witch: 'the-inscribed-one',
  magus: db.classes.magus?.subclass?.options[0]?.id ?? '',
  necromancer: 'reaper',
  cleric: 'cloistered-cleric',
};
const b = (classId: string, level: number, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'Book caster',
    level,
    classId,
    subclassId: SUB[classId] ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: classId === 'cleric' ? 'wis' : 'int',
    ...over,
  }) as unknown as BuildState;

/** Open the builder on a level page the way a player does — the level chip. Caller must stop(). */
const openAt = (build: BuildState, level: number) => {
  const r = renderDom(<Builder content={db} initial={build} onCancel={noop} onCreate={noop} />);
  r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === String(level)) ?? null);
  return r;
};
/** The cantrip row: its label and its "N / cap". */
const cantripRow = (host: HTMLElement) => {
  const row = [...host.querySelectorAll<HTMLElement>('.spell-pick-row')].find((el) => /cantrips/i.test(el.querySelector('.spr-head span')?.textContent ?? ''));
  return {
    label: (row?.querySelector('.spr-head span')?.textContent ?? '').trim(),
    count: (row?.querySelector('.spr-count')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    hint: (row?.querySelector('.book-cantrip-hint')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
    add: row?.querySelector<HTMLButtonElement>('button.spr-add') ?? null,
  };
};

describe('the builder: a book caster chooses its BOOK of cantrips', () => {
  const cases: [string, Partial<BuildState>, string, string, number][] = [
    ['wizard', {}, 'Spellbook cantrips', '0 / 10', 6],
    ['wizard', { subclassId: 'school-of-unified-magical-theory' }, 'Spellbook cantrips', '0 / 10', 5],
    ['witch', {}, 'Familiar’s cantrips', '0 / 10', 5],
    ['magus', {}, 'Spellbook cantrips', '0 / 8', 5],
    ['necromancer', {}, 'Dirge cantrips', '0 / 8', 5],
  ];
  for (const [classId, over, label, count, prepared] of cases) {
    // mutation-proof
    it(`${classId}${over.subclassId ? ' (Unified Magical Theory)' : ''}: "${label} ${count}", the first ${prepared} prepared`, () => {
      const r = openAt(b(classId, 1, over), 1);
      try {
        const row = cantripRow(r.host);
        expect(row.label).toBe(label);
        expect(row.count).toBe(count);
        expect(row.hint).toBe(`The first ${prepared} are prepared each morning by default — change them on the sheet (Spells tab).`);
        expect(row.add?.getAttribute('data-ctl-options'), 'gate 9 sees the book\'s capacity').toBe(count.split(' / ')[1]);
      } finally {
        r.stop();
      }
    });
  }

  it('the necromancer\'s leveled rail is its dirge too (it was a per-rank slot picker over the whole occult list)', () => {
    const r = openAt(b('necromancer', 1), 1);
    try {
      expect(flat(r.host)).toContain('Dirge — 0 / 4 learned');
    } finally {
      r.stop();
    }
  });

  it('a caster with no book is unchanged: "Cantrips 0 / 5", no hint', () => {
    const r = openAt(b('cleric', 1), 1);
    try {
      const row = cantripRow(r.host);
      expect(row.label).toBe('Cantrips');
      expect(row.count).toBe('0 / 5');
      expect(row.hint).toBe('');
    } finally {
      r.stop();
    }
  });

  // mutation-proof
  it('Cantrip Expansion: the row says 5 / 7 and the 6th cantrip really goes in (the toggle capped at 5)', () => {
    /* `toggleCantrip` read `cantripsKnown(classId)` — five for a cleric — and ignored every bonus, so the
     * row offered "5 / 7" and the add bailed without a word. It takes the row's own cap now. */
    const five = ['guidance', 'light', 'stabilize', 'detect-magic', 'sigil'];
    const r = openAt(b('cleric', 2, { cantrips: five, featPicks: { '2:class:0': 'cantrip-expansion' } } as never), 1);
    try {
      expect(cantripRow(r.host).count, 'fixture: the bonus reaches the row').toBe('5 / 7');
      r.click(cantripRow(r.host).add);
      const addable = [...r.host.querySelectorAll<HTMLElement>('.pick-row')].find(
        (row) => !row.classList.contains('chosen') && !(row.querySelector<HTMLButtonElement>('button.pick-add')?.disabled ?? true),
      );
      expect(addable, 'the picker offers a cantrip that is not yet chosen').toBeTruthy();
      r.click(addable!.querySelector('button.pick-add'));
      expect(cantripRow(r.host).count, 'the 6th went in').toBe('6 / 7');
    } finally {
      r.stop();
    }
  });
});

describe('the sheet: a drawn pick the book does not hold is SAID, never hidden', () => {
  const sheetOf = (ch: Character, play: PlayState) => applyPlayState(ch, play, db);

  // mutation-proof
  it('a magus\'s off-book cantrip is drawn with "Not in your spellbook — add it in the builder"', () => {
    const ch = buildCharacter(b('magus', 1, { cantrips: ['detect-magic', 'light', 'shield', 'daze', 'electric-arc'] }), db);
    const play = setPreparedCantrip(initialPlay(ch, db), 'magus-casting', 0, 'figment');
    const r = renderDom(<SpellsTab character={sheetOf(ch, play)} content={db} onPlay={noop} />);
    try {
      const card = [...r.host.querySelectorAll<HTMLElement>('.spell-card')].find((c) => c.querySelector('.spell-name')?.textContent === 'Figment');
      expect(card, 'the cantrip is on the sheet').toBeTruthy();
      expect(card?.querySelector('.spell-offbook-note')?.textContent).toBe('Not in your spellbook — add it in the builder');
      // …and a book cantrip carries no marker.
      const ok = [...r.host.querySelectorAll<HTMLElement>('.spell-card')].find((c) => c.querySelector('.spell-name')?.textContent === 'Light');
      expect(ok?.querySelector('.spell-offbook-note')).toBeNull();
    } finally {
      r.stop();
    }
  });

  it('the book card holds the book\'s cantrips, labelled "Cantrip" — and a necromancer\'s is the Dirge', () => {
    const ch = buildCharacter(b('necromancer', 1, { cantrips: ['detect-magic', 'light', 'shield', 'daze', 'message', 'void-warp'] }), db);
    const r = renderDom(<SpellsTab character={sheetOf(ch, initialPlay(ch, db))} content={db} onPlay={noop} />);
    try {
      const book = [...r.host.querySelectorAll<HTMLElement>('section.card')].find((s) => (s.querySelector('.ct')?.textContent ?? '').trim().startsWith('Dirge'));
      expect(book, 'the book card is titled with the class\'s own word').toBeTruthy();
      const cards = [...book!.querySelectorAll<HTMLElement>('.spell-card')].map((c) => `${c.querySelector('.spell-name')?.textContent} · ${c.querySelector('.spell-meta-text')?.textContent}`);
      // The sixth is in the dirge but not prepared today — only the book card shows it.
      expect(cards).toContain('Void Warp · Cantrip');
      expect(cards).toContain('Harm · 1st rank');
      expect(cards.join(' | ')).not.toMatch(/0th rank/);
    } finally {
      r.stop();
    }
  });
});

describe('the sheet: an off-book pick is on offer in ITS OWN opening only (lane C1 check, 2026-10-14)', () => {
  const sheetOf = (ch: Character, play: PlayState) => applyPlayState(ch, play, db);
  const nameOf = (id: string) => db.spells[id]!.name;
  /** Manage spells → the `n`th opening under the header `hdr` → the names its picker offers. */
  const openingOffers = (ch: Character, hdr: string, n: number): string[] => {
    const r = renderDom(<SpellsTab character={ch} content={db} onPlay={noop} />);
    try {
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.ms-btn')].find((x) => x.title === 'Manage spells for this session') ?? null);
      const box = [...r.host.querySelectorAll('.ms-rank')].find((x) => (x.querySelector('.ms-rank-hdr')?.textContent ?? '').trim() === hdr);
      r.click(box?.querySelectorAll('button.ms-slot')[n] ?? null);
      return [...r.host.querySelectorAll('.pick-row .picker-name')].map((x) => (x.textContent ?? '').trim());
    } finally {
      r.stop();
    }
  };

  // mutation-proof
  it('lane C3: a wizard whose book holds no 1st-rank spell is offered none — and the sheet says where they come from', () => {
    /* An empty leveled book read as "cannot say", so this slot offered the whole arcane list (the owner's
     * bug, still reachable). It offers nothing now, and an empty list must not read as a broken filter. */
    const ch = buildCharacter(b('wizard', 1, { cantrips: ['detect-magic', 'light', 'shield', 'daze', 'electric-arc', 'frostbite'] }), db);
    const r = renderDom(<SpellsTab character={sheetOf(ch, initialPlay(ch, db))} content={db} onPlay={noop} />);
    try {
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.ms-btn')].find((x) => x.title === 'Manage spells for this session') ?? null);
      // The Prepare panel's hint names the book and the builder before any slot is opened…
      expect((r.host.querySelector('.ms-hint')?.textContent ?? '').trim()).toBe(
        'Tap a slot to change what’s prepared — from your spellbook; add spells to it in the builder. Changes apply to this play session.',
      );
      const box = [...r.host.querySelectorAll('.ms-rank')].find((x) => (x.querySelector('.ms-rank-hdr')?.textContent ?? '').trim() === '1st rank');
      expect(box, 'fixture: a 1st-rank slot').toBeTruthy();
      r.click(box?.querySelector('button.ms-slot') ?? null);
      expect([...r.host.querySelectorAll('.pick-row')], 'nothing outside the (empty) book').toHaveLength(0);
      // …and so does the empty list itself, where the player is looking.
      expect((r.host.querySelector('.ms-book-empty')?.textContent ?? '').trim()).toBe(
        'Your spellbook holds nothing this slot can take yet — add spells to it in the builder.',
      );
    } finally {
      r.stop();
    }
    // Control: one spell in the book, and the slot offers exactly it, with no empty-book note.
    const one = buildCharacter(b('wizard', 1, { cantrips: ['detect-magic', 'light', 'shield', 'daze', 'electric-arc', 'frostbite'], spells: { 1: ['grease'] } }), db);
    expect(openingOffers(sheetOf(one, initialPlay(one, db)), '1st rank', 0)).toEqual([nameOf('grease')]);
  });

  // mutation-proof
  it('a magus\'s opening holding Figment still offers Figment; the book is offered with it', () => {
    const ch = buildCharacter(b('magus', 1, { cantrips: ['detect-magic', 'light', 'shield', 'daze', 'electric-arc'] }), db);
    const sheet = sheetOf(ch, setPreparedCantrip(initialPlay(ch, db), 'magus-casting', 2, 'figment'));
    const offered = openingOffers(sheet, 'Cantrips', 2);
    expect(offered, 'its own pick stays on offer (SpellsTab passes the opening\'s pick)').toContain(nameOf('figment'));
    expect(offered).toContain(nameOf('shield'));
  });

  // mutation-proof
  it('Spell Blending: a traded opening\'s off-book pick is offered in that opening, never in a prepared opening or the other traded one', () => {
    const ch = buildCharacter(
      // Eight in the book, six prepared: ignition and prestidigitation are the book's free places.
      b('wizard', 5, { cantrips: ['detect-magic', 'light', 'shield', 'daze', 'electric-arc', 'frostbite', 'ignition', 'prestidigitation'], spells: { 1: ['grease', 'force-barrage'], 2: ['see-the-unseen'], 3: ['fireball'] }, extraChoices: { thesis: ['spell-blending'] } } as never),
      db,
    );
    let play = initialPlay(ch, db);
    play = addSpellTrade(play, applyPlayState(ch, play, db).spellcasting.find((e) => e.id === 'wizard-casting')!, 1, CANTRIP_TRADE);
    play = setTradedCantrip(play, 'wizard-casting', 0, 'tangle-vine');
    const sheet = sheetOf(ch, play);
    expect(openingOffers(sheet, 'Traded cantrips', 0), 'in the traded opening that holds it').toContain(nameOf('tangle-vine'));
    expect(openingOffers(sheet, 'Traded cantrips', 1), 'not in the other traded opening').not.toContain(nameOf('tangle-vine'));
    const prepared = openingOffers(sheet, 'Cantrips', 0);
    expect(prepared, 'not in a prepared opening').not.toContain(nameOf('tangle-vine'));
    expect(prepared, 'the book still is').toContain(nameOf('ignition'));
  });
});
