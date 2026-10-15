// @vitest-environment jsdom
import { act } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { CASTER_ARCHETYPES, type ArchetypeBook } from '../src/rules/casterArchetypes';
import { applyPlayState, initialPlay, setPreparedSpell, type PlayState } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/**
 * ARCHETYPE DEDICATION BOOKS — what the player SEES (owner, 2026-10-15: "archetype dedication spellbooks —
 * Wizard, Witch, Magus, Necromancer, Hedge Mage and Spellshot Dedication characters should prepare spells
 * only from their own small book, the same rules the class casters got in d01fe33").
 *
 * Print, newest printing:
 *   · Wizard Dedication — *"a spellbook with four common arcane cantrips of your choice … You can prepare
 *     two cantrips each day from your spellbook"* (feat-5106); Basic Wizard Spellcasting — *"add two common
 *     spells of that rank to your spellbook"* (feat-5109).
 *   · Witch Dedication — *"a familiar with two common cantrips … You can prepare one cantrip each day from
 *     your familiar"* (feat-5099).
 *   · Magus Dedication — Basic Magus Spellcasting adds *"two common spells of that rank or lower"* (feat-9285).
 *   · Hedge Mage Dedication — *"Your keepsake holds 4 common cantrips"* (feat-9326); Basic Hedge Mage
 *     Spellcasting adds *"three common 1st-rank spells to your keepsake"* (feat-9327); the tradition is the
 *     one *"associated with the skill chosen for this dedication"* (primal for Nature).
 *
 * test/book-cantrips-ui.test.tsx holds the CLASS books on these same two pages; this holds the dedication's
 * book on every surface the change touched: the builder's level pages (a non-caster class), the Level 0
 * "Archetype spellcasting" card (a caster class beside the dedication), and the sheet's Prepare panel, off-
 * book marker, Book section and Learn a Spell. Every `mutation-proof` leg plants the bad case IN MEMORY —
 * the dedication's `book` taken away or bent — and restores it, so each assertion is shown to depend on it.
 */
const db = content();
const noop = () => undefined;
// renderDom and these helpers wrap every update in act(); say so, as card-pins does, so React stops warning.
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
/** Headroom for whole-builder jsdom renders on a loaded machine; these are real-component tests. */
const T = 60_000;
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (id: string) => db.spells[id]!.name;

const SUB: Record<string, string | null> = {
  fighter: null,
  cleric: 'cloistered-cleric',
  magus: db.classes.magus?.subclass?.options[0]?.id ?? null,
  gunslinger: 'way-of-the-spellshot',
};
const KEY: Record<string, string> = { fighter: 'str', cleric: 'wis', magus: 'str', gunslinger: 'dex' };
/** A synthetic character — never the owner's. */
const pc = (classId: string, level: number, featPicks: Record<string, string>, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST Dedication Book',
    level,
    classId,
    subclassId: SUB[classId] ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: KEY[classId],
    featPicks,
    ...over,
  }) as unknown as BuildState;

const WIZ = { '2:class:0': 'wizard-dedication', '4:class:0': 'basic-wizard-spellcasting' };
const MAGUS = { '2:class:0': 'magus-dedication', '4:class:0': 'basic-magus-spellcasting' };
const HEDGE = { '2:class:0': 'hedge-mage-dedication', '4:class:0': 'basic-hedge-mage-spellcasting' };
const NATURE = { featSkillChoices: { 'hedge-mage-dedication:0': 'nature' } } as unknown as Partial<BuildState>;

/** Plant a bad case: run `fn` with the dedication's book removed (`null`) or bent, then put it back. */
function withBook<R>(id: string, change: Partial<ArchetypeBook> | null, fn: () => R): R {
  const cfg = CASTER_ARCHETYPES[id];
  const original = cfg.book;
  if (change === null) delete cfg.book;
  else cfg.book = { ...original!, ...change };
  try {
    return fn();
  } finally {
    cfg.book = original;
  }
}

// ── builder helpers ──────────────────────────────────────────────────────────────────────────────────
const chip = (host: HTMLElement, level: number) =>
  [...host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => flat(x.textContent) === String(level)) ?? null;
/** Open the builder on a level page the way a player does — the level chip. Caller must stop(). */
const openAt = (build: BuildState, level: number, onCreate: (b: BuildState) => void = noop) => {
  const r = renderDom(<Builder content={db} initial={build} onCancel={noop} onCreate={onCreate} />);
  r.click(chip(r.host, level));
  return r;
};
type R = ReturnType<typeof renderDom>;
const go = (r: R, level: number) => r.click(chip(r.host, level));
const rowOf = (el: Element | undefined) => ({
  label: flat(el?.querySelector('.spr-head span')?.textContent),
  count: flat(el?.querySelector('.spr-count')?.textContent),
  hint: flat(el?.querySelector('.book-cantrip-hint')?.textContent),
  add: el?.querySelector<HTMLButtonElement>('button.spr-add') ?? null,
});
/** The level page's row headed `label` ("1st rank") — or `label · <the rank's rule>` ("2nd rank · 1st-rank
 *  spells", "2nd rank · 2nd rank or lower"); every field empty when there is none. */
const row = (host: HTMLElement, label: string) =>
  rowOf(
    [...host.querySelectorAll('.spell-pick-row')].find((el) => {
      const head = flat(el.querySelector('.spr-head span')?.textContent);
      return head === label || head.startsWith(`${label} · `);
    }),
  );
const cantripRow = (host: HTMLElement) =>
  rowOf([...host.querySelectorAll('.spell-pick-row')].find((el) => /cantrips/i.test(el.querySelector('.spr-head span')?.textContent ?? '')));
const sectionTitles = (host: HTMLElement) => [...host.querySelectorAll('.bsec-title')].map((x) => flat(x.textContent));
const bookHint = (host: HTMLElement) => flat(host.querySelector('.arch-book-hint')?.textContent);
/** Every row an open FilterableSelect offers. It draws 150 at a time and grows as the list scrolls, so
 *  scroll until its "Showing N of M" note is gone — a capped view could hide the very row a leg looks for. */
const offered = (host: HTMLElement) => {
  const list = host.querySelector('.fsel-list');
  for (let i = 0; i < 30 && host.querySelector('.fsel-list .picker-more'); i++)
    act(() => {
      list!.dispatchEvent(new Event('scroll'));
    });
  return [...host.querySelectorAll('.fsel-list > .fsel-rowwrap')].map((w) => ({
    name: flat(w.querySelector('.picker-name')?.textContent),
    rank: flat(w.querySelector('.picker-traits')?.textContent).split(' · ')[0],
  }));
};
const ranksOf = (rows: { rank: string }[]) => [...new Set(rows.map((x) => x.rank))].sort();
const closePicker = (r: R) => r.click(r.host.querySelector('.fsel-head .picker-close'));
const THE_SLOTS = 'Your spell slots are prepared from it — change them on the sheet (Spells tab).';

describe('the builder: a non-caster class takes a dedication with a BOOK (Fighter)', () => {
  // mutation-proof
  it(
    'Wizard Dedication at 2nd: "Spellbook cantrips 0 / 4" is on the Level 2 page — not Level 1, where the character casts nothing yet',
    () => {
      const r = openAt(pc('fighter', 6, WIZ), 1);
      try {
        expect(cantripRow(r.host).label, 'Level 1: the dedication is a 2nd-level feat').toBe('');
        expect(sectionTitles(r.host).filter((t) => t.startsWith('Spells')), 'no Spells section on Level 1').toEqual([]);
        go(r, 2);
        const c = cantripRow(r.host);
        expect(c.label).toBe('Spellbook cantrips');
        expect(c.count).toBe('0 / 4');
        expect(c.hint).toBe('The first 2 are prepared each morning by default — change them on the sheet (Spells tab).');
        expect(c.add?.getAttribute('data-ctl-options'), 'gate 9 sees the book’s four places').toBe('4');
        expect(sectionTitles(r.host)).toContain('Spells — Arcane prepared (archetype)');
      } finally {
        r.stop();
      }
      // Control: taken at 4th, the book is drawn on the Level 4 page — the page follows the feat.
      const late = openAt(pc('fighter', 6, { '4:class:0': 'wizard-dedication' }), 2);
      try {
        expect(cantripRow(late.host).label).toBe('');
        go(late, 4);
        expect(cantripRow(late.host).label).toBe('Spellbook cantrips');
      } finally {
        late.stop();
      }
      // Without the book the row is the two cantrips prepared, as before the change.
      withBook('wizard-dedication', null, () => {
        const m = openAt(pc('fighter', 6, WIZ), 2);
        try {
          const c = cantripRow(m.host);
          expect(c.label).toBe('Cantrips');
          expect(c.count).toBe('0 / 2');
          expect(c.hint).toBe('');
        } finally {
          m.stop();
        }
      });
    },
    T,
  );

  // mutation-proof
  it(
    'each new spell rank adds a BOOK row: "1st rank 0 / 2 in your spellbook" at 4th, "2nd rank" at 6th',
    () => {
      const r = openAt(pc('fighter', 6, WIZ), 4);
      try {
        const one = row(r.host, '1st rank');
        expect(one.count).toBe('0 / 2 in your spellbook');
        expect(one.add?.getAttribute('data-ctl-options'), 'Basic Wizard Spellcasting adds two').toBe('2');
        expect(bookHint(r.host)).toBe(`Each new spell rank adds 2 spells of that rank to your spellbook. ${THE_SLOTS}`);
        go(r, 6);
        expect(row(r.host, '2nd rank').count).toBe('0 / 2 in your spellbook');
        expect(row(r.host, '1st rank').label, 'the 1st rank grew at 4th, not again at 6th').toBe('');
      } finally {
        r.stop();
      }
      withBook('wizard-dedication', null, () => {
        const m = openAt(pc('fighter', 6, WIZ), 4);
        try {
          const one = row(m.host, '1st rank');
          expect(one.count, 'without a book the row is one prepared spell per slot').toMatch(/prepared/);
          expect(one.count).not.toContain('in your spellbook');
          expect(bookHint(m.host)).toBe('');
        } finally {
          m.stop();
        }
      });
    },
    T,
  );

  // mutation-proof
  it(
    'Wizard: the 2nd-rank book row offers 2nd-rank ARCANE spells only ("two common spells of that rank")',
    () => {
      const pickRank2 = () => {
        const r = openAt(pc('fighter', 6, WIZ), 6);
        try {
          r.click(row(r.host, '2nd rank').add);
          expect(flat(r.host.querySelector('.fsel-title')?.textContent)).toBe('Add 2nd-rank spell');
          return offered(r.host);
        } finally {
          r.stop();
        }
      };
      const rows = pickRank2();
      expect(rows.length).toBeGreaterThan(0);
      expect(ranksOf(rows)).toEqual(['2nd rank']);
      const names = rows.map((x) => x.name);
      expect(names).toContain(nameOf('see-the-unseen'));
      expect(names, '1st rank is not "of that rank"').not.toContain(nameOf('grease'));
      expect(names, 'divine/primal, not arcane').not.toContain(nameOf('restoration'));
      // Bent to "or lower", the same row offers 1st-rank spells too — the filter reads the book's rule.
      const bent = withBook('wizard-dedication', { rankRule: 'orLower' }, pickRank2);
      expect(ranksOf(bent)).toEqual(['1st rank', '2nd rank']);
    },
    T,
  );

  // mutation-proof
  it(
    'Magus: the 2nd-rank book row offers 1st- AND 2nd-rank spells ("two common spells of that rank or lower")',
    () => {
      let hint = '';
      const pickRank2 = () => {
        const r = openAt(pc('fighter', 6, MAGUS), 6);
        try {
          hint = bookHint(r.host);
          expect(row(r.host, '2nd rank').count).toBe('0 / 2 in your spellbook');
          r.click(row(r.host, '2nd rank').add);
          return offered(r.host);
        } finally {
          r.stop();
        }
      };
      const rows = pickRank2();
      expect(hint).toBe(`Each new spell rank adds 2 spells of that rank or lower to your spellbook. ${THE_SLOTS}`);
      expect(ranksOf(rows)).toEqual(['1st rank', '2nd rank']);
      const names = rows.map((x) => x.name);
      expect(names).toContain(nameOf('grease'));
      expect(names).toContain(nameOf('see-the-unseen'));
      const bent = withBook('magus-dedication', { rankRule: 'exact' }, pickRank2);
      expect(ranksOf(bent), 'bent to "of that rank", the 1st-rank spells go').toEqual(['2nd rank']);
      expect(hint, '…and the hint says so').toBe(`Each new spell rank adds 2 spells of that rank to your spellbook. ${THE_SLOTS}`);
    },
    T,
  );

  // The other three books on the same two pages: the dedication's own noun, four cantrips, two per rank.
  for (const [ded, classId, label, noun] of [
    ['necromancer-dedication', 'fighter', 'Dirge cantrips', 'dirge'],
    ['spellshot-dedication', 'gunslinger', 'Spellbook cantrips', 'spellbook'],
    ['magus-dedication', 'fighter', 'Spellbook cantrips', 'spellbook'],
  ] as const) {
    it(
      `${ded} (${classId}): "${label} 0 / 4" on the Level 2 page, "1st rank 0 / 2 in your ${noun}" on Level 4`,
      () => {
        const basic = CASTER_ARCHETYPES[ded].basicId!;
        const r = openAt(pc(classId, 4, { '2:class:0': ded, '4:class:0': basic }), 2);
        try {
          const c = cantripRow(r.host);
          expect(c.label).toBe(label);
          expect(c.count).toBe('0 / 4');
          expect(c.hint).toBe('The first 2 are prepared each morning by default — change them on the sheet (Spells tab).');
          go(r, 4);
          expect(row(r.host, '1st rank').count).toBe(`0 / 2 in your ${noun}`);
        } finally {
          r.stop();
        }
      },
      T,
    );
  }

  // mutation-proof
  it(
    'Witch Dedication: "Familiar’s cantrips 0 / 2", and "The first is prepared…" (it prepares one)',
    () => {
      const r = openAt(pc('fighter', 2, { '2:class:0': 'witch-dedication' }), 2);
      try {
        const c = cantripRow(r.host);
        expect(c.label).toBe('Familiar’s cantrips');
        expect(c.count).toBe('0 / 2');
        expect(c.hint).toBe('The first is prepared each morning by default — change them on the sheet (Spells tab).');
        expect(c.add?.getAttribute('data-ctl-options')).toBe('2');
      } finally {
        r.stop();
      }
      withBook('witch-dedication', null, () => {
        const m = openAt(pc('fighter', 2, { '2:class:0': 'witch-dedication' }), 2);
        try {
          expect(cantripRow(m.host).count).toBe('0 / 1');
          expect(cantripRow(m.host).hint).toBe('');
        } finally {
          m.stop();
        }
      });
    },
    T,
  );

  // mutation-proof
  it(
    'Hedge Mage who chose Nature: a PRIMAL keepsake — primal cantrips, and every Basic rank row offers 1st-rank spells only, "n / 3 in your keepsake"',
    () => {
      const r = openAt(pc('fighter', 8, HEDGE, NATURE), 2);
      try {
        /* The builder used to compute its own tradition and never read the skill answer, so a Nature hedge
         * mage — a PRIMAL caster on the sheet — was offered arcane spells here. */
        expect(sectionTitles(r.host)).toContain('Spells — Primal prepared (archetype)');
        expect(sectionTitles(r.host).join(' | ')).not.toContain('Arcane');
        const c = cantripRow(r.host);
        expect(c.label).toBe('Keepsake cantrips');
        expect(c.count).toBe('0 / 4');
        expect(c.hint).toBe('The first 2 are prepared each morning by default — change them on the sheet (Spells tab).');
        r.click(c.add);
        const cantrips = offered(r.host);
        expect(ranksOf(cantrips)).toEqual(['Cantrip']);
        const cn = cantrips.map((x) => x.name);
        // Data-checked: electric arc and tangle vine are arcane AND primal, so they decide nothing here.
        expect(cn, 'primal, not arcane').toContain(nameOf('guidance'));
        expect(cn, 'primal, not arcane').toContain(nameOf('vitality-lash'));
        expect(cn, 'arcane, not primal').not.toContain(nameOf('daze'));
        expect(cn, 'arcane, not primal').not.toContain(nameOf('telekinetic-hand'));
        closePicker(r);

        go(r, 4);
        const one = row(r.host, '1st rank');
        expect(one.count).toBe('0 / 3 in your keepsake');
        expect(one.add?.getAttribute('data-ctl-options'), 'three common 1st-rank spells').toBe('3');
        expect(bookHint(r.host)).toBe(`Each new spell rank adds 3 1st-rank spells to your keepsake. ${THE_SLOTS}`);
        for (const [lvl, label] of [
          [6, '2nd rank'],
          [8, '3rd rank'],
        ] as const) {
          go(r, lvl);
          const rr = row(r.host, label);
          expect(rr.count, label).toBe('0 / 3 in your keepsake');
          expect(bookHint(r.host), label).toBe(`Each new spell rank adds 3 1st-rank spells to your keepsake. ${THE_SLOTS}`);
          r.click(rr.add);
          const rows = offered(r.host);
          expect(rows.length, label).toBeGreaterThan(0);
          expect(ranksOf(rows), `${label}: Basic Hedge Mage Spellcasting adds 1st-rank spells only`).toEqual(['1st rank']);
          expect(rows.map((x) => x.name), `${label}: primal`).toContain(nameOf('heal'));
          expect(rows.map((x) => x.name), `${label}: arcane/occult, not primal`).not.toContain(nameOf('force-barrage'));
          closePicker(r);
        }
      } finally {
        r.stop();
      }
      // Without the keepsake's rank cap, the 2nd-rank row would offer 2nd-rank spells.
      withBook('hedge-mage-dedication', { maxRankByTier: undefined }, () => {
        const m = openAt(pc('fighter', 8, HEDGE, NATURE), 6);
        try {
          m.click(row(m.host, '2nd rank').add);
          expect(ranksOf(offered(m.host))).toContain('2nd rank');
        } finally {
          m.stop();
        }
      });
      // Without the skill→tradition table, the same build reads the dedication's default, arcane.
      const cfg = CASTER_ARCHETYPES['hedge-mage-dedication'];
      const bySkill = cfg.traditionBySkill;
      delete cfg.traditionBySkill;
      try {
        const m = openAt(pc('fighter', 8, HEDGE, NATURE), 2);
        try {
          expect(sectionTitles(m.host)).toContain('Spells — Arcane prepared (archetype)');
        } finally {
          m.stop();
        }
      } finally {
        cfg.traditionBySkill = bySkill;
      }
    },
    T,
  );
});

// ── the Level 0 "Archetype spellcasting" card (a caster class beside the dedication) ──────────────────
const setupCard = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-setupcard="Archetype spellcasting"]');
const subcards = (card: Element | null) =>
  Object.fromEntries([...(card?.querySelectorAll<HTMLElement>('[data-subcard]') ?? [])].map((el) => [el.getAttribute('data-subcard') ?? '', el]));
const OLD_NOTE = 'Prepare leveled archetype spells on the Spells tab.';

describe('the builder: a caster class with a book dedication (Cleric + Wizard Dedication, Level 0)', () => {
  // mutation-proof
  it(
    'the card asks for the spellbook: "Spellbook cantrips (0/4)" and a "Spellbook — leveled spells" card with a row per rank',
    () => {
      const r = openAt(pc('cleric', 6, WIZ), 0);
      try {
        const card = setupCard(r.host);
        expect(card, 'the Archetype spellcasting card').toBeTruthy();
        const subs = subcards(card);
        const cantrips = subs['Spellbook cantrips (0/4)'];
        expect(cantrips, `cantrip card label; saw ${Object.keys(subs).join(' | ')}`).toBeTruthy();
        expect(flat(cantrips?.querySelector('.book-cantrip-hint')?.textContent)).toBe(
          'The first 2 are prepared each morning by default — change them on the sheet (Spells tab).',
        );
        const book = subs['Spellbook — leveled spells'];
        expect(book, 'the book’s leveled spells have a writer here now').toBeTruthy();
        // The level page's own sentence (archetypeBookSentence), so the card says which ranks a page takes.
        expect(flat(book?.querySelector('.bsec-note')?.textContent)).toBe(
          'Each new spell rank adds 2 spells of that rank to your spellbook. Your spell slots are prepared from it on the Spells tab.',
        );
        const rows = [...(book?.querySelectorAll('.arch-book-rank') ?? [])].map(rowOf);
        expect(rows.map((x) => x.label)).toEqual(['1st rank', '2nd rank']);
        expect(rows.map((x) => x.count)).toEqual(['0 / 2 in your spellbook', '0 / 2 in your spellbook']);
        expect(flat(card?.textContent), 'the Spells tab adds only out of the book, so it cannot be sent there').not.toContain(OLD_NOTE);
      } finally {
        r.stop();
      }
      withBook('wizard-dedication', null, () => {
        const m = openAt(pc('cleric', 6, WIZ), 0);
        try {
          const subs = subcards(setupCard(m.host));
          expect(Object.keys(subs)).toContain('Cantrips (0/2)');
          expect(Object.keys(subs).filter((k) => k.endsWith('leveled spells'))).toEqual([]);
          expect(flat(setupCard(m.host)?.textContent)).toContain(OLD_NOTE);
        } finally {
          m.stop();
        }
      });
    },
    T,
  );

  /**
   * Final check, 2026-10-15: on this card a Hedge Mage keepsake's "2nd rank" and "3rd rank" rows offered
   * only 1st-rank spells with nothing saying why — the note read "adds 3 spells to your keepsake" and the
   * popup "Add a 2nd-rank keepsake spell". The level page already said "3 1st-rank spells"; the card now
   * uses the same sentence, labels each row with its rule, and titles the popup "for 2nd rank" (a page of
   * the book) rather than "a 2nd-rank spell", which contradicted the 1st-rank list under it. The planted leg (no tier cap) shows the
   * label is the rule's, not a fixed string.
   */
  // mutation-proof
  it(
    'Cleric + Hedge Mage (Nature): the keepsake rows say they take 1st-rank spells, in the label, the note and the popup title',
    () => {
      const look = () => {
        const r = openAt(pc('cleric', 8, HEDGE, NATURE), 0);
        try {
          const subs = subcards(setupCard(r.host));
          const book = subs['Keepsake — leveled spells'];
          expect(book, `the keepsake card; saw ${Object.keys(subs).join(' | ')}`).toBeTruthy();
          const rows = [...(book?.querySelectorAll('.arch-book-rank') ?? [])];
          return {
            cantrips: Object.keys(subs).find((k) => k.startsWith('Keepsake cantrips')),
            note: flat(book?.querySelector('.bsec-note')?.textContent),
            labels: rows.map((el) => rowOf(el).label),
            counts: rows.map((el) => rowOf(el).count),
            titles: rows.map((el) => el.querySelector('button[data-ctl-title]')?.getAttribute('data-ctl-title') ?? ''),
          };
        } finally {
          r.stop();
        }
      };
      const got = look();
      expect(got.cantrips).toBe('Keepsake cantrips (0/4)');
      expect(got.note).toBe('Each new spell rank adds 3 1st-rank spells to your keepsake. Your spell slots are prepared from it on the Spells tab.');
      expect(got.labels).toEqual(['1st rank', '2nd rank · 1st-rank spells', '3rd rank · 1st-rank spells']);
      expect(got.counts).toEqual(['0 / 3 in your keepsake', '0 / 3 in your keepsake', '0 / 3 in your keepsake']);
      expect(got.titles).toEqual([
        'Add a spell to your keepsake for 1st rank',
        'Add a spell to your keepsake for 2nd rank (1st-rank spells)',
        'Add a spell to your keepsake for 3rd rank (1st-rank spells)',
      ]);
      // The plant: no tier cap — the rows become "or lower" and the 1st-rank wording goes with the cap.
      const planted = withBook('hedge-mage-dedication', { maxRankByTier: undefined }, look);
      expect(planted.labels).toEqual(['1st rank', '2nd rank · 2nd rank or lower', '3rd rank · 3rd rank or lower']);
      expect(planted.note).not.toContain('1st-rank spells');
    },
    T,
  );

  it(
    'a dedication with no book (Druid Dedication) keeps "Cantrips (0/2)" and the Spells-tab note, and no book card',
    () => {
      const r = openAt(pc('cleric', 6, { '2:class:0': 'druid-dedication', '4:class:0': 'basic-druid-spellcasting' }), 0);
      try {
        const card = setupCard(r.host);
        const subs = subcards(card);
        expect(Object.keys(subs)).toContain('Cantrips (0/2)');
        expect(Object.keys(subs).filter((k) => k.endsWith('leveled spells'))).toEqual([]);
        expect(flat(card?.textContent)).toContain(OLD_NOTE);
        expect(card?.querySelector('.book-cantrip-hint')).toBeNull();
      } finally {
        r.stop();
      }
    },
    T,
  );

  it(
    'adding to the book from the card: a 1st-rank arcane spell goes in (and comes out), and the saved build holds it in archetypeSpells',
    async () => {
      const saved: BuildState[] = [];
      const r = openAt(pc('cleric', 6, WIZ), 0, (b) => void saved.push(b));
      const bookCard = () => subcards(setupCard(r.host))['Spellbook — leveled spells'];
      const rankRow = (label: string) => [...(bookCard()?.querySelectorAll('.arch-book-rank') ?? [])].find((el) => rowOf(el).label === label);
      const popupNames = () => [...r.host.querySelectorAll('.picker-overlay .pick-row .picker-name')].map((x) => flat(x.textContent));
      const choose = (name: string) =>
        r.click(
          [...r.host.querySelectorAll('.picker-overlay .pick-row')]
            .find((p) => flat(p.querySelector('.picker-name')?.textContent) === name)
            ?.querySelector('button.pick-add') ?? null,
        );
      try {
        // The 1st-rank popup: 1st-rank arcane spells — no 2nd-rank spell, no divine-only one.
        const add1 = rankRow('1st rank')?.querySelector<HTMLButtonElement>('button[data-ctl-title="Add a spell to your spellbook for 1st rank"]') ?? null;
        expect(add1, 'the 1st-rank row offers an add').toBeTruthy();
        r.click(add1);
        const ones = popupNames();
        expect(ones).toContain(nameOf('grease'));
        expect(ones).toContain(nameOf('force-barrage'));
        expect(ones, 'a 2nd-rank spell is not "of that rank"').not.toContain(nameOf('see-the-unseen'));
        expect(ones, 'divine/primal, not arcane').not.toContain(nameOf('heal'));
        choose(nameOf('grease'));
        expect(rowOf(rankRow('1st rank')).count).toBe('1 / 2 in your spellbook');
        const chipX = rankRow('1st rank')?.querySelector<HTMLButtonElement>(`button.ec-chip[aria-label="Remove ${nameOf('grease')}"]`) ?? null;
        expect(chipX, 'the chosen spell is drawn as a removable chip').toBeTruthy();
        r.click(chipX);
        expect(rowOf(rankRow('1st rank')).count, 'the ✕ takes it out').toBe('0 / 2 in your spellbook');
        r.click(rankRow('1st rank')?.querySelector('button[data-ctl-title="Add a spell to your spellbook for 1st rank"]') ?? null);
        choose(nameOf('grease'));
        expect(rowOf(rankRow('1st rank')).count).toBe('1 / 2 in your spellbook');

        // The 2nd-rank popup: 2nd-rank spells only (wizard: "of that rank").
        r.click(rankRow('2nd rank')?.querySelector('button[data-ctl-title="Add a spell to your spellbook for 2nd rank"]') ?? null);
        const twos = popupNames();
        expect(twos).toContain(nameOf('see-the-unseen'));
        expect(twos).not.toContain(nameOf('grease'));
        r.click(r.host.querySelector('.picker-overlay .picker-close'));

        // Save through the header, answering the "choices left" confirmation (it mounts on <body>).
        const byText = (t: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => flat(b.textContent) === t) ?? null;
        r.click(r.host.querySelector('button.b-create'));
        await act(async () => undefined);
        for (let i = 0; i < 4 && byText('Save anyway'); i++) {
          r.click(byText('Save anyway'));
          await act(async () => undefined);
        }
        expect(saved.length, 'onCreate fired').toBe(1);
        expect(saved[0].archetypeSpells?.spells?.[1], 'the book’s 1st rank, in the two-caster store').toEqual(['grease']);
        expect(saved[0].spells?.[1] ?? [], 'the cleric’s own picks are untouched').toEqual([]);
      } finally {
        r.stop();
      }
    },
    T,
  );
});

// ── the sheet ─────────────────────────────────────────────────────────────────────────────────────────
const ENTRY = 'wizard-dedication-casting';
const WIZ_BOOK = { cantrips: ['detect-magic', 'light', 'shield', 'daze'], spells: { 1: ['grease', 'fear'], 2: ['see-the-unseen'] } } as unknown as Partial<BuildState>;
const sheetOf = (ch: Character, play: PlayState = initialPlay(ch, db)) => applyPlayState(ch, play, db);
const renderSheet = (sheet: Character) => renderDom(<SpellsTab character={sheet} content={db} onPlay={noop} />);
const PREPARE = 'Manage spells for this session';
const LEARN = 'Learn a Spell (exploration activity)';
const entryBtn = (host: HTMLElement, entryId: string, title: string) =>
  host.querySelector<HTMLButtonElement>(`[data-entry="${entryId}"] button.ms-btn[title="${title}"]`);
const rankBox = (host: HTMLElement, hdr: string) => [...host.querySelectorAll('.ms-rank')].find((x) => flat(x.querySelector('.ms-rank-hdr')?.textContent) === hdr);
/** Prepare → the `n`th opening under `hdr` → what its picker offers and the empty-book note; null when the
 *  panel has no such group. */
const opening = (sheet: Character, entryId: string, hdr: string, n: number) => {
  const r = renderSheet(sheet);
  try {
    r.click(entryBtn(r.host, entryId, PREPARE));
    const box = rankBox(r.host, hdr);
    if (!box) return null;
    r.click(box.querySelectorAll('button.ms-slot')[n] ?? null);
    return { names: offered(r.host).map((x) => x.name), empty: flat(r.host.querySelector('.ms-book-empty')?.textContent) };
  } finally {
    r.stop();
  }
};
const sorted = (ids: string[]) => ids.map(nameOf).sort();
const cardsNamed = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll<HTMLElement>('.spell-card')].filter((c) => flat(c.querySelector('.spell-name')?.textContent) === name);
const bookSection = (host: HTMLElement, entryId: string) => host.querySelector<HTMLElement>(`section.card[data-book-entry="${entryId}"]`);
const bookCards = (sec: Element | null) =>
  [...(sec?.querySelectorAll<HTMLElement>('.spell-card') ?? [])].map((c) => `${flat(c.querySelector('.spell-name')?.textContent)} · ${flat(c.querySelector('.spell-meta-text')?.textContent)}`);

describe('the sheet: a Fighter with Wizard Dedication prepares out of the dedication’s spellbook', () => {
  // mutation-proof
  it(
    'Prepare: two cantrip openings filled from the book, and each opening offers only the book',
    () => {
      const build = pc('fighter', 6, WIZ, WIZ_BOOK);
      const sheet = sheetOf(buildCharacter(build, db));
      const r = renderSheet(sheet);
      try {
        r.click(entryBtn(r.host, ENTRY, PREPARE));
        expect(flat(r.host.querySelector('.ms-hint')?.textContent)).toBe(
          'Tap a slot to change what’s prepared — from your spellbook; add spells to it in the builder. Changes apply to this play session.',
        );
        const box = rankBox(r.host, 'Cantrips');
        expect(box, 'the archetype’s cantrips are openings to re-prepare').toBeTruthy();
        expect([...(box?.querySelectorAll('button.ms-slot .ms-slot-name') ?? [])].map((x) => flat(x.textContent))).toEqual([nameOf('detect-magic'), nameOf('light')]);
      } finally {
        r.stop();
      }
      // Opening 0 holds detect magic; opening 1 holds light — so the book's other two are on offer, and its own pick.
      expect(opening(sheet, ENTRY, 'Cantrips', 0)?.names.sort()).toEqual(sorted(['detect-magic', 'shield', 'daze']));
      expect(opening(sheet, ENTRY, '1st rank', 0)?.names.sort(), 'the 1st-rank slot: the book’s 1st-rank spells').toEqual(sorted(['grease', 'fear']));
      expect(opening(sheet, ENTRY, '2nd rank', 0)?.names.sort(), 'the 2nd-rank slot: the whole book').toEqual(sorted(['grease', 'fear', 'see-the-unseen']));
      withBook('wizard-dedication', null, () => {
        const plain = sheetOf(buildCharacter(build, db));
        /* This read "without a book the cantrips are not openings" (null). Since 2026-10-15 a book-less
         * PREPARED pool's cantrips re-prepare too (Cleric Dedication, feat-5066: "You can prepare two common
         * cantrips each day from the divine spell list") — so without the book the openings are still
         * there, and what tells the two apart is their list: the whole arcane list, not the book. */
        expect(opening(plain, ENTRY, 'Cantrips', 0)?.names, 'without a book the cantrip opening offers the whole arcane list').toContain(nameOf('ignition'));
        expect(opening(plain, ENTRY, '1st rank', 0)?.names, 'without a book the slot offers the whole arcane list').toContain(nameOf('force-barrage'));
      });
    },
    T,
  );

  // mutation-proof
  it(
    'a spell prepared on the sheet that the book does not hold is drawn with "Not in your spellbook — add it in the builder"',
    () => {
      const build = pc('fighter', 6, WIZ, WIZ_BOOK);
      const offBook = (ch: Character) => sheetOf(ch, setPreparedSpell(initialPlay(ch, db), ENTRY, 1, 0, 'force-barrage'));
      const r = renderSheet(offBook(buildCharacter(build, db)));
      try {
        const fb = cardsNamed(r.host, nameOf('force-barrage'));
        expect(fb.length, 'the off-book pick is still drawn').toBeGreaterThan(0);
        expect(flat(fb[0].querySelector('.spell-offbook-note')?.textContent)).toBe('Not in your spellbook — add it in the builder');
        const stu = cardsNamed(r.host, nameOf('see-the-unseen'));
        expect(stu.length).toBeGreaterThan(0);
        for (const c of stu) expect(c.querySelector('.spell-offbook-note'), 'a book spell carries no marker').toBeNull();
      } finally {
        r.stop();
      }
      withBook('wizard-dedication', null, () => {
        const m = renderSheet(offBook(buildCharacter(build, db)));
        try {
          const fb = cardsNamed(m.host, nameOf('force-barrage'));
          expect(fb.length).toBeGreaterThan(0);
          expect(fb[0].querySelector('.spell-offbook-note'), 'no book, no marker').toBeNull();
        } finally {
          m.stop();
        }
      });
    },
    T,
  );

  // mutation-proof
  it(
    'the Book section: "Spellbook" for one book, "Wizard Dedication — Spellbook" beside a magus’s own',
    () => {
      const build = pc('fighter', 6, WIZ, WIZ_BOOK);
      const r = renderSheet(sheetOf(buildCharacter(build, db)));
      try {
        const sec = bookSection(r.host, ENTRY);
        expect(sec, 'the dedication’s book has a section').toBeTruthy();
        expect(flat(sec?.querySelector('.ct')?.textContent).startsWith('Spellbook')).toBe(true);
        const cards = bookCards(sec);
        // Daze and Shield are in the book but not prepared today — only this section shows them.
        for (const want of ['Daze · Cantrip', 'Shield · Cantrip', 'Fear · 1st rank', 'See the Unseen · 2nd rank']) expect(cards).toContain(want);
      } finally {
        r.stop();
      }
      // Two books: the section says whose.
      const magus = pc('magus', 6, WIZ, {
        cantrips: ['electric-arc', 'light', 'shield', 'detect-magic', 'daze'],
        archetypeSpells: { cantrips: ['detect-magic', 'light', 'figment', 'message'], spells: { 1: ['grease', 'fear'] }, tradition: null, keyAbility: null },
      } as unknown as Partial<BuildState>);
      const m = renderSheet(sheetOf(buildCharacter(magus, db)));
      try {
        expect(flat(bookSection(m.host, 'magus-casting')?.querySelector('.ct')?.textContent).startsWith('Magus — Spellbook')).toBe(true);
        const ded = bookSection(m.host, ENTRY);
        expect(flat(ded?.querySelector('.ct')?.textContent).startsWith('Wizard Dedication — Spellbook')).toBe(true);
        expect(bookCards(ded)).toContain('Figment · Cantrip');
        expect(bookCards(ded)).toContain('Grease · 1st rank');
      } finally {
        m.stop();
      }
      withBook('wizard-dedication', null, () => {
        const p = renderSheet(sheetOf(buildCharacter(build, db)));
        try {
          expect(bookSection(p.host, ENTRY), 'no book, no section').toBeNull();
        } finally {
          p.stop();
        }
      });
    },
    T,
  );

  // mutation-proof
  it(
    'Cleric + Wizard Dedication with an empty book: the slot and the cantrip opening offer nothing, and say where spells come from',
    () => {
      const build = pc('cleric', 6, WIZ);
      const sheet = sheetOf(buildCharacter(build, db));
      const slot = opening(sheet, ENTRY, '1st rank', 0);
      expect(slot?.names, 'nothing outside the (empty) book').toEqual([]);
      expect(slot?.empty).toBe('Your spellbook holds nothing this slot can take yet — add spells to it in the builder.');
      const cantrip = opening(sheet, ENTRY, 'Cantrips', 0);
      expect(cantrip?.names).toEqual([]);
      expect(cantrip?.empty).toBe('Your spellbook holds nothing this opening can take yet — add spells to it in the builder.');
      withBook('wizard-dedication', null, () => {
        const plain = opening(sheetOf(buildCharacter(build, db)), ENTRY, '1st rank', 0);
        expect(plain?.names.length, 'without a book the slot offers the arcane list').toBeGreaterThan(0);
        expect(plain?.empty).toBe('');
      });
    },
    T,
  );
});

describe('the sheet: Learn a Spell for a hedge mage stops at what the keepsake can hold', () => {
  // mutation-proof
  it(
    'Basic only, level 8 (slots to 3rd): Learn a Spell offers cantrips and 1st-rank primal spells, nothing higher',
    () => {
      const ch = buildCharacter(
        pc('fighter', 8, HEDGE, { ...NATURE, cantrips: ['guidance', 'stabilize', 'light', 'detect-magic'], spells: { 1: ['heal', 'fear'] } } as unknown as Partial<BuildState>),
        db,
      );
      const entry = ch.spellcasting.find((e) => e.id === 'hedge-mage-dedication-casting');
      expect(entry?.tradition, 'fixture: the Nature hedge mage is primal').toBe('primal');
      expect(Object.keys(entry?.prepared ?? {}), 'fixture: slots reach 3rd rank').toEqual(['1', '2', '3']);
      const learn = (sheet: Character) => {
        const r = renderSheet(sheet);
        try {
          r.click(entryBtn(r.host, 'hedge-mage-dedication-casting', LEARN));
          const head = flat(r.host.querySelector('.manage-spells .picker-head span')?.textContent);
          const hint = flat(r.host.querySelector('.manage-spells .ms-hint')?.textContent);
          r.click(r.host.querySelector('.manage-spells button.ms-add'));
          return { head, hint, rows: offered(r.host) };
        } finally {
          r.stop();
        }
      };
      const { head, hint, rows } = learn(sheetOf(ch));
      expect(head).toBe('Learn a spell — Primal');
      expect(hint).toContain('A spell you learn goes into your keepsake, so you can prepare it from then on.');
      expect(rows.length).toBeGreaterThan(0);
      expect(ranksOf(rows), '"Your keepsake can also hold 1st-rank spells" — not 2nd or 3rd under Basic').toEqual(['1st rank', 'Cantrip']);
      expect(rows.map((x) => x.name), 'already in the keepsake').not.toContain(nameOf('heal'));
      // The same entry without the keepsake's cap offers what its 2nd- and 3rd-rank slots could cast.
      const uncapped = { ...ch, spellcasting: ch.spellcasting.map((e) => (e.id === 'hedge-mage-dedication-casting' ? { ...e, bookMaxRank: undefined } : e)) };
      expect(ranksOf(learn(sheetOf(uncapped)).rows)).toEqual(expect.arrayContaining(['2nd rank', '3rd rank']));
    },
    T,
  );
});

// ── a book is a SET: old per-slot saves, and a spell already on another rank's page ───────────────────
/* Before the book, a dedication's builder row was one prepared spell per SLOT, so a save could hold the same
 * spell twice at a rank (`[fear, fear]` — two 1st-rank slots with Arcane Breadth). In a book that is ONE
 * spell. And "two common spells of that rank or lower" (magus, necromancer, hedge mage) let a 1st-rank spell
 * be offered again at 2nd, spending a second place on a spell the book already holds. */
const pickRow = (host: HTMLElement, name: string) =>
  [...host.querySelectorAll('.fsel-list > .fsel-rowwrap')].find((w) => flat(w.querySelector('.picker-name')?.textContent) === name) ?? null;

describe('the builder: a dedication’s book counts DISTINCT spells, and offers none it already holds', () => {
  it(
    'Fighter + Wizard Dedication + Arcane Breadth, an old per-slot save [fear, fear]: "1 / 2 in your spellbook", and + add still adds',
    () => {
      const breadth = { ...WIZ, '8:class:0': 'arcane-breadth' };
      const twice = { spells: { 1: ['fear', 'fear'] } } as unknown as Partial<BuildState>;
      // Fixture: Arcane Breadth is what made two 1st-rank SLOTS at 8th (so a per-slot save could hold fear twice).
      const fx = buildCharacter(pc('fighter', 8, breadth, twice), db).spellcasting.find((e) => e.id === ENTRY);
      expect(fx?.prepared?.[1]?.length, 'fixture: two 1st-rank slots with Arcane Breadth').toBe(2);

      const r = openAt(pc('fighter', 8, breadth, twice), 4);
      try {
        const one = row(r.host, '1st rank');
        expect(one.count, 'fear twice is one spell in the book').toBe('1 / 2 in your spellbook');
        expect(one.add, 'the row offers an add').toBeTruthy();
        expect(one.add?.disabled, 'one place is still free').toBe(false);
        r.click(one.add);
        expect(flat(r.host.querySelector('.fsel-head .fsel-cap')?.textContent), 'the picker counts the same way').toBe('1 / 2');
        offered(r.host); // grow the list so the row below is drawn
        const grease = pickRow(r.host, nameOf('grease'));
        expect(grease, 'Grease is on offer').toBeTruthy();
        r.click(grease?.querySelector('button.pick-add') ?? null);
        closePicker(r);
        const after = row(r.host, '1st rank');
        expect(after.count, 'the free place took it').toBe('2 / 2 in your spellbook');
        expect(after.add?.disabled, 'now the book’s two places are full').toBe(true);
      } finally {
        r.stop();
      }
      // Control: two DIFFERENT spells fill the rank — the distinct count did not switch the cap off.
      const full = openAt(pc('fighter', 8, breadth, { spells: { 1: ['fear', 'grease'] } } as unknown as Partial<BuildState>), 4);
      try {
        const one = row(full.host, '1st rank');
        expect(one.count).toBe('2 / 2 in your spellbook');
        expect(one.add?.disabled).toBe(true);
      } finally {
        full.stop();
      }
    },
    T,
  );

  it(
    'Fighter + Magus Dedication, Fear in the book at 1st: the 2nd-rank row ("or lower") does not offer Fear again, but does offer other 1st-rank spells',
    () => {
      const offeredAt = (build: BuildState, level: number, label: string) => {
        const r = openAt(build, level);
        try {
          r.click(row(r.host, label).add);
          return offered(r.host).map((x) => x.name);
        } finally {
          r.stop();
        }
      };
      const withFear = pc('fighter', 6, MAGUS, { spells: { 1: ['fear'] } } as unknown as Partial<BuildState>);
      const two = offeredAt(withFear, 6, '2nd rank');
      expect(two, 'already in the book at 1st').not.toContain(nameOf('fear'));
      expect(two, 'another 1st-rank spell is still "of that rank or lower"').toContain(nameOf('grease'));
      expect(two).toContain(nameOf('see-the-unseen'));
      // Its own rank still offers it (drawn as Added — the toggle that takes it out).
      expect(offeredAt(withFear, 4, '1st rank'), 'the 1st-rank page holds it, so that picker keeps it').toContain(nameOf('fear'));
      // Control: with an empty book, the 2nd-rank row does offer Fear — the exclusion is the book's.
      expect(offeredAt(pc('fighter', 6, MAGUS), 6, '2nd rank')).toContain(nameOf('fear'));
    },
    T,
  );

  it(
    'Cleric + Magus Dedication (Level 0 card), Fear in the book at 1st: the 2nd-rank popup leaves Fear out; "1 / 2 in your spellbook" at 1st, also for an old [fear, fear]',
    () => {
      const withBookSpells = (spells: Record<number, string[]>) =>
        pc('cleric', 6, MAGUS, { archetypeSpells: { cantrips: [], spells, tradition: null, keyAbility: null } } as unknown as Partial<BuildState>);
      const look = (build: BuildState) => {
        const r = openAt(build, 0);
        try {
          const book = subcards(setupCard(r.host))['Spellbook — leveled spells'];
          expect(book, 'the magus book card').toBeTruthy();
          const rows = [...(book?.querySelectorAll('.arch-book-rank') ?? [])];
          const rankRow = (rank: string) => rows.find((el) => rowOf(el).label.startsWith(rank));
          const one = rankRow('1st rank');
          // The 2nd-rank title carries the rank's rule since the final check: "… (2nd rank or lower)".
          const twoAdd = rankRow('2nd rank')?.querySelector<HTMLButtonElement>('button[data-ctl-title^="Add a spell to your spellbook for 2nd rank"]') ?? null;
          const oneAdd = one?.querySelector('button[data-ctl-title="Add a spell to your spellbook for 1st rank"]') ?? null;
          expect(twoAdd, 'the 2nd-rank row offers an add').toBeTruthy();
          r.click(twoAdd);
          const names = [...r.host.querySelectorAll('.picker-overlay .picker-name')].map((x) => flat(x.textContent));
          return { labels: rows.map((el) => rowOf(el).label), oneCount: rowOf(one).count, oneAdd: !!oneAdd, names };
        } finally {
          r.stop();
        }
      };
      const fear = nameOf('fear');
      const got = look(withBookSpells({ 1: ['fear'] }));
      expect(got.labels).toEqual(['1st rank', '2nd rank · 2nd rank or lower']);
      expect(got.oneCount).toBe('1 / 2 in your spellbook');
      expect(got.names.length, 'the popup offers spells').toBeGreaterThan(0);
      expect(got.names, 'Fear is already in the book at 1st').not.toContain(`${fear} (1st)`);
      expect(got.names.filter((n) => n === fear || n.startsWith(`${fear} (`))).toEqual([]);
      expect(got.names, 'another 1st-rank spell is still offered').toContain(`${nameOf('grease')} (1st)`);
      expect(got.names).toContain(nameOf('see-the-unseen'));
      // An old per-slot save [fear, fear]: one spell in the book, so the 1st rank still has a place to fill.
      const twice = look(withBookSpells({ 1: ['fear', 'fear'] }));
      expect(twice.oneCount, 'fear twice is one spell').toBe('1 / 2 in your spellbook');
      expect(twice.oneAdd, 'and the add is still offered (not "holds the 2 spells this rank adds")').toBe(true);
      // Control: an empty book's 2nd-rank popup offers Fear — the exclusion is the book's.
      expect(look(withBookSpells({})).names).toContain(`${fear} (1st)`);
    },
    T,
  );
});
