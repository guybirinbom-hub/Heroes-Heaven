// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { Character } from '../src/rules/types';

/**
 * THE ADAPTED CANTRIP CHAIN — what the player SEES (2026-10-15). test/adapted-chain.test.ts holds the
 * engine and the print it follows; this holds the builder row, the builder's prerequisite marker and the
 * Spells tab's Prepare / Repertoire panels.
 *
 *   · Adapted Cantrip (feat-4474): *"If you prepare spells, you can choose this spell when you prepare your
 *     cantrips, in addition to your other options."* A fighter's Cleric Dedication row read "2 / 1".
 *   · Its prerequisite *"spellcasting class feature"* needs spell slots (Player Core rules-2230); a stored
 *     pick on a character without slots now shows the builder's "Prerequisites no longer met" marker —
 *     warned, never removed.
 *   · Cleric Dedication (feat-5066): *"You can prepare two common cantrips each day"* — the Prepare panel
 *     had no Cantrips openings for a dedication pool.
 *   · Adaptive Adept (feat-4481): *"you can't … select the spell as a signature spell if you have a spell
 *     repertoire"* — the ★ is greyed and says why (Q27).
 *
 * Every leg failed on be93069. Fixtures are synthetic ("TEST …"), never an owner's character.
 */
const db = content();
const noop = () => undefined;
beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});
const T = 60_000;
const flat = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

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
const withAdapted = (b: BuildState, answer: string, adept?: string): BuildState =>
  ({
    ...b,
    featPicks: { ...b.featPicks, '1:ancestry:0': 'adapted-cantrip', ...(adept ? { '5:ancestry:0': 'adaptive-adept' } : {}) },
    featChoices: { ...b.featChoices, '1:ancestry:0': answer, ...(adept ? { '5:ancestry:0': adept } : {}) },
  }) as BuildState;
const DIVINE2 = ['divine-lance', 'stabilize'];
const clericDed = (level: number, over: Partial<BuildState> = {}) =>
  fighter(level, { featPicks: { '2:class:0': 'cleric-dedication', '4:class:1': 'basic-cleric-spellcasting' }, cantrips: DIVINE2, ...over });

/** Open the builder on a level page the way a player does — the level chip. Caller must stop(). */
const openAt = (b: BuildState, level: number) => {
  const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
  r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => flat(x.textContent) === String(level)) ?? null);
  return r;
};
const cantripCount = (b: BuildState, level: number) => {
  const r = openAt(b, level);
  try {
    const row = [...r.host.querySelectorAll<HTMLElement>('.spell-pick-row')].find((x) => /cantrips/i.test(x.querySelector('.spr-head span')?.textContent ?? ''));
    return flat(row?.querySelector('.spr-count')?.textContent);
  } finally {
    r.stop();
  }
};
/** The "Prerequisites no longer met" marker on the slot holding `featName`, on that level's page. */
const invalidMarker = (b: BuildState, level: number, featName: string) => {
  const r = openAt(b, level);
  try {
    const card = [...r.host.querySelectorAll<HTMLElement>('.lvl-card')].find((c) => flat(c.querySelector('.lvl-card-val')?.textContent) === featName);
    expect(card, `the ${featName} slot`).toBeTruthy();
    return card!.querySelector('.lvl-invalid')?.getAttribute('title') ?? null;
  } finally {
    r.stop();
  }
};
/** Open an entry's Prepare / Repertoire panel on the Spells tab. Caller must stop(). */
const openPanel = (ch: Character, entryName: RegExp, button: 'Prepare' | 'Repertoire') => {
  const r = renderDom(<SpellsTab character={ch} content={db} onPlay={noop} />);
  const row = [...r.host.querySelectorAll<HTMLElement>('.sc-name-row')].find((x) => entryName.test(flat(x.querySelector('.sc-name')?.textContent)));
  expect(row, `the ${entryName} entry`).toBeTruthy();
  r.click([...row!.querySelectorAll<HTMLButtonElement>('.ms-btn')].find((x) => flat(x.textContent) === button) ?? null);
  return r;
};

describe('the builder', () => {
  it(
    'a fighter with Cleric Dedication and Adapted Cantrip: the dedication row offers two places (it read "2 / 1")',
    () => {
      expect(cantripCount(clericDed(5), 2), 'control: without the feat').toBe('2 / 2');
      expect(cantripCount(withAdapted(clericDed(5), 'electric-arc'), 2)).toBe('2 / 2');
    },
    T,
  );

  it(
    'Adapted Cantrip stored on a character with no spell slots is marked, never removed',
    () => {
      const noSlots = withAdapted(fighter(3, { featPicks: { '2:class:0': 'cleric-dedication' }, cantrips: DIVINE2 }), 'electric-arc');
      expect(invalidMarker(noSlots, 1, 'Adapted Cantrip')).toBe('Prerequisites no longer met: spellcasting class feature');
      expect(invalidMarker(withAdapted(clericDed(5), 'electric-arc'), 1, 'Adapted Cantrip'), 'with Basic Cleric Spellcasting').toBeNull();
    },
    T,
  );
});

describe('the builder: a repertoire row draws the Adaptive Adept spell', () => {
  it(
    "a sorcerer's 1st-rank row: grease as a locked chip with its line — not a second bloodline gift",
    () => {
      const r = openAt(withAdapted(pc('sorcerer', 6, { keyAbility: 'cha' }), 'electric-arc', 'grease'), 1);
      try {
        const row = [...r.host.querySelectorAll<HTMLElement>('.spell-pick-row')].find((x) => /^1st rank/.test(flat(x.querySelector('.spr-head span')?.textContent)));
        expect(row, 'the 1st-rank row').toBeTruthy();
        const chip = [...row!.querySelectorAll<HTMLElement>('.spr-chip-gift')].find((c) => flat(c.textContent) === 'Grease');
        expect(chip?.title).toBe('Known through Adaptive Adept — not one of the spells you choose here');
        const notes = [...row!.querySelectorAll('.spr-gift-note')].map((n) => flat(n.textContent));
        expect(notes).toContain('Grease is known through Adaptive Adept from 5th level — it does not use one of these places.');
        expect(notes.join(' '), 'no "only one of these" gift note').not.toMatch(/only one of these/);
      } finally {
        r.stop();
      }
    },
    T,
  );
});

describe('the builder, Dual Class: the second class\'s card draws it too', () => {
  it(
    'Fighter/Sorcerer: grease goes to the sorcerer, and its Level 0 card shows the locked chip and line',
    () => {
      const b = withAdapted(
        pc('fighter', 6, {
          keyAbility: 'str',
          subclassId: null,
          variantRules: { dualClass: true },
          classId2: 'sorcerer',
          subclassId2: db.classes.sorcerer?.subclass?.options[0]?.id ?? null,
        } as Partial<BuildState>),
        'electric-arc',
        'grease',
      );
      expect(buildCharacter(b, db).spellcasting.find((e) => e.id === 'sorcerer-casting')?.grantedRepertoire?.[1], 'fixture: the sorcerer knows grease').toContain('grease');
      const r = openAt(b, 0);
      try {
        const card = r.host.querySelector('[data-setupcard="Sorcerer spells — Occult spontaneous"]');
        expect(card, 'the second class card').toBeTruthy();
        const row = [...card!.querySelectorAll<HTMLElement>('.spell-pick-row')].find((x) => /^1st rank/.test(flat(x.querySelector('.spr-head span')?.textContent)));
        expect([...(row?.querySelectorAll('.spr-chip-gift') ?? [])].map((c) => flat(c.textContent))).toContain('Grease');
        expect([...(row?.querySelectorAll('.spr-gift-note') ?? [])].map((n) => flat(n.textContent))).toContain(
          'Grease is known through Adaptive Adept from 5th level — it does not use one of these places.',
        );
      } finally {
        r.stop();
      }
    },
    T,
  );
});

describe('the Spells tab', () => {
  it(
    "a Cleric Dedication's Prepare panel has its two cantrip openings, the builder's picks in them",
    () => {
      const ch = buildCharacter(clericDed(4), db);
      const r = openPanel(ch, /divine/i, 'Prepare');
      try {
        const rank = [...document.querySelectorAll<HTMLElement>('.ms-rank')].find((x) => flat(x.querySelector('.ms-rank-hdr')?.textContent) === 'Cantrips');
        expect(rank, 'a Cantrips section').toBeTruthy();
        expect([...rank!.querySelectorAll('.ms-slot .ms-slot-name')].map((x) => flat(x.textContent))).toEqual(DIVINE2.map((id) => db.spells[id].name));
      } finally {
        r.stop();
      }
    },
    T,
  );

  it(
    "a sorcerer's Adaptive Adept spell: known, locked, and its signature ★ greyed with the reason",
    () => {
      const ch = buildCharacter(withAdapted(pc('sorcerer', 6, { keyAbility: 'cha' }), 'electric-arc', 'grease'), db);
      const r = openPanel(ch, /occult/i, 'Repertoire');
      try {
        const slot = [...document.querySelectorAll<HTMLElement>('.ms-slot')].find((x) => flat(x.querySelector('.ms-slot-name')?.textContent) === 'Grease');
        expect(slot, 'grease in the repertoire').toBeTruthy();
        const star = slot!.querySelector<HTMLButtonElement>('.ms-sig');
        expect(star, 'the ★ is drawn').toBeTruthy();
        expect(star!.disabled).toBe(true);
        expect(star!.className).toContain('barred');
        expect(star!.title).toBe('Can’t be a signature spell — Adaptive Adept says so');
        expect(slot!.querySelector('.ms-granted')?.getAttribute('title')).toBe('Granted by Adaptive Adept — always known');
        // Control: one of the sorcerer's own spells keeps a live ★.
        const own = [...document.querySelectorAll<HTMLElement>('.ms-slot')].find((x) => x !== slot && x.querySelector('.ms-sig'));
        if (own) expect(own.querySelector<HTMLButtonElement>('.ms-sig')!.disabled).toBe(false);
      } finally {
        r.stop();
      }
    },
    T,
  );
});
