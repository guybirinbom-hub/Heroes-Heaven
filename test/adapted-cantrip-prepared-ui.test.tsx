// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/**
 * ADAPTED CANTRIP ON A PREPARED CLASS — what the player SEES in the builder (owner's bug 2026-10-15).
 *
 * Print (feat-4474): *"If you prepare spells, you can choose this spell when you prepare your cantrips,
 * in addition to your other options. If you have a spell repertoire, replace one of your cantrips known
 * with the chosen spell."* The builder's cantrip row charged the swap to every class, so a cleric's row
 * read "5 / 4" and a wizard's book said the first FIVE were prepared; under Dual Class the second class's
 * card was charged too, whichever class the cantrip went to. test/adapted-cantrip-prepared.test.ts holds
 * the engine; this holds the rows, and the Spells tab of a character with no play state yet. Every
 * builder leg reads the same row WITHOUT the feat beside it (the control), and failed on the code before
 * the fix.
 *
 * Fixtures are synthetic ("TEST …"), never an owner's character.
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

const pc = (classId: string, over: Partial<BuildState> = {}): BuildState =>
  ({
    ...emptyBuild(),
    name: 'TEST adapted cantrip',
    level: 1,
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

/** Open the builder on a level page the way a player does — the level chip. Caller must stop(). */
const openAt = (b: BuildState, level: number) => {
  const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
  r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => flat(x.textContent) === String(level)) ?? null);
  return r;
};
const cantripRow = (el: ParentNode | null) => {
  const row = [...(el?.querySelectorAll<HTMLElement>('.spell-pick-row') ?? [])].find((x) => /cantrips/i.test(x.querySelector('.spr-head span')?.textContent ?? ''));
  return {
    label: flat(row?.querySelector('.spr-head span')?.textContent),
    count: flat(row?.querySelector('.spr-count')?.textContent),
    hint: flat(row?.querySelector('.book-cantrip-hint')?.textContent),
  };
};
/** The row on a level page, or on the second class's card (`[data-setupcard]`). */
const rowOf = (b: BuildState, level: number, card?: string) => {
  const r = openAt(b, level);
  try {
    const host = card ? r.host.querySelector(`[data-setupcard="${card}"]`) : r.host;
    expect(host, card ?? 'the page').toBeTruthy();
    return cantripRow(host);
  } finally {
    r.stop();
  }
};

const DIV5 = ['divine-lance', 'stabilize', 'light', 'shield', 'vitality-lash'];
const ARC6 = ['light', 'shield', 'daze', 'prestidigitation', 'detect-magic', 'sigil'];

describe('the builder: a prepared class keeps every cantrip place', () => {
  it(
    'Cleric: "Cantrips 5 / 5" with Adapted Cantrip, the same as without it (it read 5 / 4)',
    () => {
      const plain = pc('cleric', { keyAbility: 'wis', cantrips: DIV5 });
      expect(rowOf(plain, 1).count, 'control').toBe('5 / 5');
      const row = rowOf(withAdapted(plain, 'electric-arc'), 1);
      expect(row.label).toBe('Cantrips');
      expect(row.count).toBe('5 / 5');
    },
    T,
  );

  it(
    'School of Battle Magic wizard: the book says the first SIX are prepared (it said five)',
    () => {
      const plain = pc('wizard', { subclassId: 'school-of-battle-magic', keyAbility: 'int', cantrips: ARC6 });
      const six = 'The first 6 are prepared each morning by default — change them on the sheet (Spells tab).';
      expect(rowOf(plain, 1).hint, 'control').toBe(six);
      const row = rowOf(withAdapted(plain, 'guidance'), 1);
      expect(row.label).toBe('Spellbook cantrips');
      expect(row.count).toBe('6 / 10');
      expect(row.hint).toBe(six);
    },
    T,
  );
});

describe('the sheet: a fresh prepared caster draws its openings, not the option on top', () => {
  /** The names on the Spells tab's Cantrips cards (the section headed "Cantrips"). */
  const cantripCards = (ch: Character) => {
    const r = renderDom(<SpellsTab character={ch} content={db} onPlay={noop} />);
    try {
      const hdr = [...r.host.querySelectorAll('.spell-rankhdr')].find((h) => flat(h.textContent).startsWith('Cantrips'));
      return [...(hdr?.parentElement?.querySelectorAll('.spell-grid .spell-card:not(.empty) .spell-name') ?? [])].map((x) => flat(x.textContent));
    } finally {
      r.stop();
    }
  };

  // mutation-proof
  it(
    'Cleric with Adapted Cantrip and NO play state: five cantrip cards (it drew six, electric arc on top)',
    () => {
      const ch = buildCharacter(withAdapted(pc('cleric', { keyAbility: 'wis', cantrips: DIV5 }), 'electric-arc'), db);
      expect(applyPlayState(ch, undefined, db), 'fixture: no play state draws the build entry as it is').toBe(ch);
      const names = cantripCards(ch);
      expect(names).toEqual(DIV5.map((id) => db.spells[id].name));
      // The planted bad case: the same character with the option pushed onto its preparation, as the
      // grant did before — the card list reads it straight off the entry.
      const bad = structuredClone(ch);
      bad.spellcasting.find((e) => e.id === 'cleric-casting')!.cantrips.push('electric-arc');
      expect(cantripCards(bad)).toHaveLength(6);
    },
    T,
  );
});

describe('the builder, Dual Class: only the class the cantrip lands in can pay for it', () => {
  const dual = (a: string, b: string, over: Partial<BuildState> = {}): BuildState =>
    pc(a, {
      variantRules: { dualClass: true },
      classId2: b,
      subclassId2: db.classes[b]?.subclass?.options[0]?.id ?? null,
      ...over,
    } as Partial<BuildState>);

  it(
    'Sorcerer/Wizard: the cantrip goes to the sorcerer, so the wizard card still prepares six',
    () => {
      const plain = dual('sorcerer', 'wizard', { subclassId2: 'school-of-battle-magic', cantrips: ['detect-magic', 'light', 'shield'], cantrips2: ARC6 });
      const card = 'Wizard spells — Arcane prepared';
      const six = 'The first 6 are prepared each morning by default — change them on the sheet (Spells tab).';
      expect(rowOf(plain, 0, card).hint, 'control').toBe(six);
      expect(rowOf(withAdapted(plain, 'divine-lance'), 0, card).hint).toBe(six);
    },
    T,
  );

  it(
    'Wizard/Sorcerer: the cantrip goes to the wizard, so the sorcerer card keeps every place',
    () => {
      const plain = dual('wizard', 'sorcerer', { keyAbility: 'int', cantrips: ARC6, cantrips2: ['detect-magic', 'light', 'shield'] });
      const card = 'Sorcerer spells — Occult spontaneous';
      const control = rowOf(plain, 0, card).count;
      expect(control, 'control: three picks beside the gift').toMatch(/^3 \/ \d+$/);
      expect(rowOf(withAdapted(plain, 'divine-lance'), 0, card).count).toBe(control);
    },
    T,
  );
});
