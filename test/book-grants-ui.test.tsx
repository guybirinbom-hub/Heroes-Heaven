// @vitest-environment jsdom
import { act } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, initialPlay } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/**
 * SPELLS A FEAT WRITES INTO A DEDICATION'S BOOK — what the player SEES (follow-up to 585544e, 2026-10-15).
 * test/book-grants.test.ts holds the engine; this holds the three surfaces:
 *
 *   · the builder's level pages (a non-caster class): the book's rank row shows the grant as a LOCKED chip,
 *     with the record named in words under it, and the row's count stays the player's own places
 *     (*"your familiar learns the associated spell"* — Basic Lesson, feat-4996 — is on top of Basic Witch
 *     Spellcasting's two);
 *   · the Level 0 "Archetype spellcasting" card (a caster class beside the dedication): the same chip;
 *   · a GRANTED lesson's own "or" (Lesson of the Elements under Basic Witchcraft): WG's second select,
 *     which the slot path has shown since batch 035 and the granted path never did;
 *   · the sheet's Book section: the granted spell says which record wrote it.
 *
 * Synthetic characters only ("TEST …"). `mutation-proof` legs plant the bad case in memory and restore it.
 */
const db = content();
const noop = () => undefined;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
const T = 60_000;
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

const pc = (classId: string, level: number, featPicks: Record<string, string>, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST Book Grants',
    level,
    classId,
    subclassId: classId === 'cleric' ? 'cloistered-cleric' : null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: classId === 'cleric' ? 'wis' : 'str',
    featPicks,
    ...over,
  }) as unknown as BuildState;

const WITCH = { '2:class:0': 'witch-dedication', '4:class:1': 'basic-witch-spellcasting', '6:class:2': 'basic-witchcraft' };
const lesson = (value: string, spell?: string) =>
  ({
    pickFeatChoices: { '6:class:2': 'basic-lesson' },
    grantedFeatChoices: { 'basic-lesson': value },
    ...(spell ? { featSpellChoices: { 'granted:basic-lesson:granted-spell': spell } } : {}),
  }) as unknown as Partial<BuildState>;
const OWN = { cantrips: ['daze', 'shield'], spells: { 1: ['fear', 'command'] } } as unknown as Partial<BuildState>;
/** The visible line under a grant chip. `at`: the level the granting feat is taken, said when the row's page
 *  comes before it; `rank`: the grant's own rank, said when the row is another rank's. */
const NOTE = (spell: string, noun: string, from: string, o: { at?: string; rank?: string } = {}) =>
  `${spell}${o.rank ? ` (${o.rank} rank)` : ''} is added to your ${noun} by ${from}${o.at ? ` at ${o.at} level` : ''} — it does not use one of these places.`;

/** Plant `value` on a record's field for the length of `fn` (undefined deletes it), then restore it. */
function planted<R>(rec: Record<string, unknown>, field: string, value: unknown, fn: () => R): R {
  const had = Object.prototype.hasOwnProperty.call(rec, field);
  const saved = rec[field];
  if (value === undefined) delete rec[field];
  else rec[field] = value;
  try {
    return fn();
  } finally {
    if (had) rec[field] = saved;
    else delete rec[field];
  }
}

// ── builder helpers (the dedication-books-ui shapes) ─────────────────────────────────────────────────
const chip = (host: HTMLElement, level: number) =>
  [...host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => flat(x.textContent) === String(level)) ?? null;
const openAt = (build: BuildState, level: number) => {
  const r = renderDom(<Builder content={db} initial={build} onCancel={noop} onCreate={noop} />);
  r.click(chip(r.host, level));
  return r;
};
type R = ReturnType<typeof renderDom>;
/** A rank row of the level page or the Level 0 card: its label, count, locked grant chips and notes. */
const rowOf = (el: Element | undefined) => ({
  label: flat(el?.querySelector('.spr-head span')?.textContent),
  count: flat(el?.querySelector('.spr-count')?.textContent),
  add: el?.querySelector<HTMLButtonElement>('button.spr-add') ?? null,
  grants: [...(el?.querySelectorAll('.spr-chip-book-grant') ?? [])].map((c) => flat(c.textContent)),
  locked: [...(el?.querySelectorAll('.spr-chip-book-grant') ?? [])].every((c) => !!c.querySelector('.ti-lock') && !c.querySelector('button')),
  notes: [...(el?.querySelectorAll('.spr-gift-note') ?? [])].map((c) => flat(c.textContent)),
});
const row = (host: HTMLElement, label: string) =>
  rowOf(
    [...host.querySelectorAll('.spell-pick-row')].find((el) => {
      const head = flat(el.querySelector('.spr-head span')?.textContent);
      return head === label || head.startsWith(`${label} · `);
    }),
  );
/** Every row the level page's open spell picker (a FilterableSelect) offers. It draws 150 at a time and grows
 *  as the list scrolls, so scroll until its "show more" row is gone (dedication-books-ui's helper). */
const offeredNames = (host: HTMLElement) => {
  const list = host.querySelector('.fsel-list');
  for (let i = 0; i < 30 && host.querySelector('.fsel-list .picker-more'); i++)
    act(() => {
      list!.dispatchEvent(new Event('scroll'));
    });
  return [...host.querySelectorAll('.fsel-list > .fsel-rowwrap')].map((w) => flat(w.querySelector('.picker-name')?.textContent));
};
/** An open PopupSelect's rows: read-first `.pick-row`s, chosen with their `.pick-add` button. */
const pickerItems = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.picker-overlay .pick-row')];
const itemName = (x: Element) => flat(x.querySelector('.picker-name')?.textContent);

describe('the builder: a Fighter with Witch Dedication takes Basic Lesson under Basic Witchcraft', () => {
  // mutation-proof
  it(
    'Lesson of Life: the familiar’s "1st rank" row shows Spirit Link LOCKED, says it comes from Lesson of Life, and still counts "2 / 2"',
    () => {
      const look = () => {
        const r = openAt(pc('fighter', 6, WITCH, { ...OWN, ...lesson('aon-lesson-of-life') }), 4);
        try {
          return row(r.host, '1st rank');
        } finally {
          r.stop();
        }
      };
      const one = look();
      expect(one.count, 'the two Basic Witch Spellcasting places, the grant on top').toBe('2 / 2 in your familiar');
      expect(one.grants).toEqual(['Spirit Link']);
      expect(one.locked, 'a grant has no ✕ — the player cannot remove it here').toBe(true);
      // The row is on the Level 4 page and Basic Witchcraft is a 6th-level pick, so the note says when.
      expect(one.notes).toEqual([NOTE('Spirit Link', 'familiar', 'Lesson of Life', { at: '6th' })]);
      // Planted: the lesson with no taught spell — the row is the player's two picks and nothing else.
      const bare = planted(db.classFeatures['lesson-of-life'] as unknown as Record<string, unknown>, 'grantedSpells', undefined, look);
      expect(bare.grants).toEqual([]);
      expect(bare.notes).toEqual([]);
    },
    T,
  );

  // mutation-proof
  it(
    'Lesson of the Elements GRANTED: the lesson card asks "Familiar spell" with its four spells, and the answer is taught to the familiar',
    async () => {
      /* A granted feat's own question is asked where the builder asks every granted feat's (the granted-feats
       * lane — on a fighter, the Level 1 page), so the select is looked for page by page. */
      const findSel = (rr: R) => {
        for (const L of [1, 2, 4, 6]) {
          rr.click(chip(rr.host, L));
          const s = rr.host.querySelector<HTMLElement>('[data-ctl="popup"][data-ctl-title="Familiar spell"]');
          if (s) return s;
        }
        return null;
      };
      const r = openAt(pc('fighter', 6, WITCH, { ...OWN, ...lesson('aon-lesson-of-elements') }), 6);
      try {
        const sel = findSel(r);
        expect(sel, 'the granted lesson’s second select (WG shows it)').toBeTruthy();
        expect(sel!.dataset.ctlOptions).toBe('4');
        r.click(sel);
        const names = pickerItems(r.host).map(itemName);
        expect(names.sort()).toEqual(['Breathe Fire', 'Gust of Wind', 'Hydraulic Push', 'Pummeling Rubble']);
        r.click(pickerItems(r.host).find((x) => itemName(x) === 'Gust of Wind')!.querySelector('.pick-add'));
        await act(async () => undefined);
        r.click(chip(r.host, 4));
        const one = row(r.host, '1st rank');
        expect(one.grants).toEqual(['Gust of Wind']);
        expect(one.notes).toEqual([NOTE('Gust of Wind', 'familiar', 'Lesson of the Elements', { at: '6th' })]);
      } finally {
        r.stop();
      }
      // Planted: a lesson with no "or" asks nothing (Lesson of Life has no grantedSpellChoice).
      const life = openAt(pc('fighter', 6, WITCH, { ...OWN, ...lesson('aon-lesson-of-life') }), 6);
      try {
        expect(findSel(life)).toBeNull();
      } finally {
        life.stop();
      }
    },
    T,
  );

  /* Checker finding 2026-10-15: the Level 0 card left a granted spell out of its picker and the level page
   * offered it, so a player could spend one of Basic Witch Spellcasting's two places on Spirit Link. */
  // mutation-proof
  it(
    'the familiar’s "1st rank" picker does not offer Spirit Link — the lesson already put it there',
    () => {
      const offered = () => {
        const r = openAt(pc('fighter', 6, WITCH, { cantrips: ['daze', 'shield'], spells: { 1: ['fear'] }, ...lesson('aon-lesson-of-life') } as unknown as Partial<BuildState>), 4);
        try {
          r.click(row(r.host, '1st rank').add);
          return offeredNames(r.host);
        } finally {
          r.stop();
        }
      };
      const names = offered();
      expect(names, 'fixture: the picker offers the occult 1st-rank list').toContain('Command');
      expect(names).not.toContain('Spirit Link');
      // Planted: no grant, and Spirit Link is an ordinary choice again.
      expect(planted(db.classFeatures['lesson-of-life'] as unknown as Record<string, unknown>, 'grantedSpells', undefined, offered)).toContain('Spirit Link');
    },
    T,
  );

  it(
    'Major Lesson (Death) on a familiar with no 6th-rank row (Basic Witch Spellcasting only): Raise Dead is shown on the book’s last row, with its rank',
    () => {
      const b = pc('fighter', 20, { ...WITCH, '10:class:4': 'advanced-witchcraft' }, {
        ...OWN,
        pickFeatChoices: { '6:class:2': 'basic-lesson', '10:class:4': 'major-lesson' },
        grantedFeatChoices: { 'basic-lesson': 'aon-lesson-of-life', 'major-lesson': 'aon-lesson-of-death' },
      } as unknown as Partial<BuildState>);
      const r = openAt(b, 2);
      const seen: Record<string, ReturnType<typeof rowOf>> = {};
      try {
        for (let L = 2; L <= 20; L++) {
          r.click(chip(r.host, L));
          for (const el of r.host.querySelectorAll('.spell-pick-row')) {
            const x = rowOf(el);
            if (x.grants.length) seen[x.label.split(' · ')[0]] = x;
          }
        }
      } finally {
        r.stop();
      }
      expect(Object.keys(seen).sort()).toEqual(['1st rank', '3rd rank']);
      expect(seen['3rd rank'].grants).toEqual(['Raise Dead']);
      expect(seen['3rd rank'].notes).toEqual([NOTE('Raise Dead', 'familiar', 'Lesson of Death', { rank: '6th', at: '10th' })]);
    },
    T,
  );
});

// ── the Level 0 "Archetype spellcasting" card (a caster class beside the dedication) ──────────────────
const setupCard = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-setupcard="Archetype spellcasting"]');

describe('the builder: a Cleric with Witch Dedication (the Level 0 card)', () => {
  // mutation-proof
  it(
    'the "Familiar — leveled spells" 1st-rank row shows Spirit Link locked, from Lesson of Life',
    () => {
      const look = () => {
        const store = { archetypeSpells: { cantrips: ['daze', 'shield'], spells: { 1: ['fear', 'command'] }, tradition: null, keyAbility: null } };
        const r = openAt(pc('cleric', 6, WITCH, { ...store, ...lesson('aon-lesson-of-life') } as unknown as Partial<BuildState>), 0);
        try {
          const card = setupCard(r.host);
          expect(card, 'the Archetype spellcasting card').toBeTruthy();
          const one = [...(card?.querySelectorAll('.arch-book-rank') ?? [])].find((el) => flat(el.querySelector('.spr-head span')?.textContent).startsWith('1st rank'));
          return rowOf(one);
        } finally {
          r.stop();
        }
      };
      const one = look();
      expect(one.count).toBe('2 / 2 in your familiar');
      expect(one.grants).toEqual(['Spirit Link']);
      expect(one.locked).toBe(true);
      expect(one.notes).toEqual([NOTE('Spirit Link', 'familiar', 'Lesson of Life')]);
      expect(planted(db.classFeatures['lesson-of-life'] as unknown as Record<string, unknown>, 'grantedSpells', undefined, look).grants).toEqual([]);
    },
    T,
  );
});

describe('the builder: a Fighter with Necromancer Dedication takes Expanded Necromancy at 20th', () => {
  // mutation-proof
  it(
    'the dirge’s 5th-, 7th- and 8th-rank rows show Grisly Growths, Execute and Desiccate locked — no Massacre anywhere',
    () => {
      // Advanced Death Dealing at 20th: Expanded Necromancy is a 10th-level feat at "half your level".
      const NECRO = {
        '2:class:0': 'necromancer-dedication',
        '4:class:1': 'basic-necromancer-spellcasting',
        '6:class:2': 'basic-death-dealing',
        '12:class:3': 'expert-necromancer-spellcasting',
        '18:class:5': 'master-necromancer-spellcasting',
        '20:class:6': 'advanced-death-dealing',
      };
      const all = () => {
        const r = openAt(pc('fighter', 20, NECRO, { pickFeatChoices: { '20:class:6': 'expanded-necromancy' }, cantrips: ['daze', 'shield', 'light', 'void-warp'], spells: { 1: ['fear', 'command'] } } as unknown as Partial<BuildState>), 2);
        const seen: Record<string, ReturnType<typeof rowOf>> = {};
        try {
          for (let L = 2; L <= 20; L++) {
            r.click(chip(r.host, L));
            for (const el of r.host.querySelectorAll('.spell-pick-row')) {
              const x = rowOf(el);
              // "5th rank · 5th rank or lower" — keyed by the rank, the dirge's rule after the dot.
              if (x.grants.length) seen[x.label.split(' · ')[0]] = x;
            }
          }
          return seen;
        } finally {
          r.stop();
        }
      };
      const seen = all();
      expect(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, v.grants]))).toEqual({
        '5th rank': ['Grisly Growths'],
        '7th rank': ['Execute'],
        '8th rank': ['Desiccate'],
      });
      expect(seen['5th rank'].count, 'the two places Basic Necromancer Spellcasting gives the rank stay the player’s').toBe('0 / 2 in your dirge');
      // The 5th-rank row is on an earlier page than the 20th-level feat, so the note says when it arrives.
      expect(seen['5th rank'].notes).toEqual([NOTE('Grisly Growths', 'dirge', 'Expanded Necromancy', { at: '20th' })]);
      // Planted: the old list-widening encoding puts nothing in the dirge, so nothing is drawn.
      const old = planted(db.feats['expanded-necromancy'] as unknown as Record<string, unknown>, 'spellListAdditions', { spells: ['grisly-growths', 'execute', 'desiccate', 'massacre'], as: 'list' }, all);
      expect(old).toEqual({});
    },
    T,
  );
});

// ── the sheet ──────────────────────────────────────────────────────────────────────────────────────
const renderSheet = (sheet: Character) => renderDom(<SpellsTab character={sheet} content={db} onPlay={noop} />);
const bookCards = (host: HTMLElement, entryId: string) =>
  [...(host.querySelector(`section.card[data-book-entry="${entryId}"]`)?.querySelectorAll<HTMLElement>('.spell-card') ?? [])].map(
    (c) => `${flat(c.querySelector('.spell-name')?.textContent)} · ${flat(c.querySelector('.spell-meta-text')?.textContent)}`,
  );

describe('the sheet: the Book section names the record that wrote a spell into the book', () => {
  // mutation-proof
  it(
    'Fighter + Witch Dedication + Lesson of Life: "Spirit Link · 1st rank · from Lesson of Life"; the player’s own spells carry no source',
    () => {
      const look = () => {
        const ch = buildCharacter(pc('fighter', 6, WITCH, { ...OWN, ...lesson('aon-lesson-of-life') }), db);
        const r = renderSheet(applyPlayState(ch, initialPlay(ch, db), db));
        try {
          return bookCards(r.host, 'witch-dedication-casting');
        } finally {
          r.stop();
        }
      };
      const cards = look();
      expect(cards).toContain('Spirit Link · 1st rank · from Lesson of Life');
      expect(cards).toContain('Fear · 1st rank');
      expect(planted(db.classFeatures['lesson-of-life'] as unknown as Record<string, unknown>, 'grantedSpells', undefined, look).some((c) => c.startsWith('Spirit Link'))).toBe(false);
    },
    T,
  );
});
