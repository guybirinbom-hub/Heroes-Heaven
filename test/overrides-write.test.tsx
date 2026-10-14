// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, createElement, useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { OverridesCard, pruneOverrides, type BuilderActions } from '../src/builder/shared';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import type { BuildOverrides } from '../src/rules/types';

/**
 * Phone audit 2026-10-14, the Overrides card.
 *
 * D5 — "Set maximum HP" never saved anything. The card's writeOv rebuilt the overrides object one
 * hand-written line per key and had no `maxHp` line, so every value typed into the box was dropped before
 * it reached the build. It is generic now (pruneOverrides) and this file holds a sample of EVERY key
 * BuildOverrides declares, read off src/rules/types.ts — a key added there later fails here until it has
 * a sample, and then it is proven to survive.
 *
 * D6 — the number boxes snapped back when emptied: Dex 12, Backspace, Backspace, 8 saved 128, because an
 * empty box reverted the override mid-edit and refilled with the computed 12. The boxes are drafts now
 * (DraftNumberInput): they may be empty while edited and decide when the player leaves them — a number
 * saves, an empty box reverts to the computed value, a tap with no typing changes nothing.
 */

afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});

/** A non-empty value for every BuildOverrides key. */
const SAMPLE: Required<BuildOverrides> = {
  allowedFeats: ['toughness'],
  addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }],
  addedFeatures: [{ featureId: 'shield-block', level: 1 }],
  removedFeatIds: ['shield-block'],
  attributes: { dex: 8 },
  proficiencies: { athletics: 'expert' },
  addedLanguages: ['draconic'],
  addedSpells: [{ spellId: 'shield', rank: 0 }],
  maxHp: 30,
  contentEdits: { feats: { toughness: { name: 'Tougher' } } },
};

/** The keys `interface BuildOverrides` declares (its own two-space-indented members). */
function declaredKeys(): string[] {
  const src = readFileSync('src/rules/types.ts', 'utf8');
  const start = src.indexOf('export interface BuildOverrides {');
  expect(start, 'BuildOverrides not found in types.ts').toBeGreaterThan(-1);
  const end = src.indexOf('\n}', start);
  const body = src.slice(start, end);
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
}

describe('D5: the overrides writer keeps every BuildOverrides key', () => {
  it('the sample covers every key types.ts declares', () => {
    const keys = declaredKeys();
    expect(keys.length).toBeGreaterThanOrEqual(10);
    expect(keys.filter((k) => !(k in SAMPLE)), 'a BuildOverrides key with no sample here — add one').toEqual([]);
  });

  it('each key, written alone and all together, is saved', () => {
    for (const k of declaredKeys()) {
      const one = { [k]: SAMPLE[k as keyof BuildOverrides] } as Partial<BuildOverrides>;
      expect(pruneOverrides({}, one), `${k} was dropped`).toEqual(one);
    }
    expect(pruneOverrides({}, SAMPLE)).toEqual(SAMPLE);
  });

  it('an emptied override clears; an edit just started does not', () => {
    expect(pruneOverrides({ maxHp: 30 }, { maxHp: undefined })).toBeUndefined();
    expect(pruneOverrides({ attributes: { dex: 8 }, maxHp: 30 }, { attributes: {} })).toEqual({ maxHp: 30 });
    expect(pruneOverrides({}, { addedLanguages: [] })).toBeUndefined();
    expect(pruneOverrides({}, { contentEdits: { feats: {}, classFeatures: {} } })).toBeUndefined();
    expect(pruneOverrides({}, { contentEdits: { feats: { toughness: {} } } })).toEqual({ contentEdits: { feats: { toughness: {} } } });
    expect(pruneOverrides({}, { maxHp: Number.NaN })).toBeUndefined();
  });
});

/* ---- the real card ----------------------------------------------------------------------------- */

const BASE: BuildState = {
  ...emptyBuild(),
  name: 't',
  level: 1,
  ancestryId: 'human',
  backgroundId: 'acolyte',
  classId: 'fighter',
};

/** The card over a live build: actions.patch really updates it, and the character is rebuilt. */
function mount(initial: BuildState = BASE) {
  const db = content();
  let latest: BuildState = initial;
  let patches = 0;
  function Host() {
    const [b, setB] = useState(initial);
    latest = b;
    const actions = new Proxy({} as BuilderActions, {
      get: (_t, prop) =>
        prop === 'patch'
          ? (p: Partial<BuildState> | ((x: BuildState) => Partial<BuildState>)) => {
              patches++;
              setB((x) => ({ ...x, ...(typeof p === 'function' ? p(x) : p) }));
            }
          : () => undefined,
    });
    return createElement(OverridesCard, { build: b, actions, content: db, character: buildCharacter(b, db) });
  }
  const r = renderDom(createElement(Host));
  return { r, build: () => latest, patches: () => patches };
}

const box = (label: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
function focus(el: HTMLInputElement) {
  act(() => el.focus());
}
function blur(el: HTMLInputElement) {
  act(() => el.blur());
}
/** Set the box's text the way a keystroke does (native setter + input event). */
function typeInto(el: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('D5: Set maximum HP saves what is typed, and clearing it reverts', () => {
  it('30 is saved; an emptied box goes back to the computed maximum', () => {
    const { r, build } = mount();
    const hp = box('Max HP');
    expect(hp, 'no Max HP box').toBeTruthy();
    const computed = hp.value;
    focus(hp);
    typeInto(hp, '30');
    blur(hp);
    expect(build().overrides?.maxHp).toBe(30);
    expect(box('Max HP').value).toBe('30');
    expect(document.querySelector('[data-subcard="Set maximum HP"]')?.textContent).toContain('1');

    focus(box('Max HP'));
    typeInto(box('Max HP'), '');
    blur(box('Max HP'));
    expect(build().overrides?.maxHp).toBeUndefined();
    expect(box('Max HP').value).toBe(computed);
    r.stop();
  });

  it('Enter saves too, and a value below 1 is held at 1', () => {
    const { r, build } = mount();
    focus(box('Max HP'));
    typeInto(box('Max HP'), '0');
    act(() => {
      box('Max HP').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(build().overrides?.maxHp).toBe(1);
    r.stop();
  });
});

describe('D6: an override box can be emptied while typing', () => {
  it('Dex 12 → Backspace, Backspace, 8 saves 8 (it saved 128)', () => {
    const { r, build } = mount();
    const dex = box('Dex');
    const start = dex.value;
    expect(start.length, 'a two-digit starting Dex').toBe(2);
    focus(dex);
    typeInto(dex, start.slice(0, 1));
    typeInto(dex, '');
    expect(box('Dex').value, 'the emptied box refilled mid-edit').toBe('');
    typeInto(box('Dex'), '8');
    expect(box('Dex').value).toBe('8');
    blur(box('Dex'));
    expect(build().overrides?.attributes).toEqual({ dex: 8 });
    expect(box('Dex').value).toBe('8');
    r.stop();
  });

  it('emptied and left = back to the computed score; a tap with no typing changes nothing', () => {
    const { r, build, patches } = mount({ ...BASE, overrides: { attributes: { str: 9 } } });
    expect(box('Str').value).toBe('9');
    focus(box('Str'));
    typeInto(box('Str'), '');
    blur(box('Str'));
    expect(build().overrides).toBeUndefined();
    expect(box('Str').value).not.toBe('');

    const before = patches();
    focus(box('Con'));
    blur(box('Con'));
    expect(patches(), 'tapping a box and leaving it wrote an override').toBe(before);
    expect(build().overrides).toBeUndefined();
    r.stop();
  });

  it('a minus typed first is not glued onto the old value ("-1" gave 121)', () => {
    const { r, build } = mount();
    focus(box('Dex'));
    typeInto(box('Dex'), '');
    typeInto(box('Dex'), '-1');
    blur(box('Dex'));
    expect(build().overrides?.attributes).toEqual({ dex: -1 });
    r.stop();
  });

  it('text the browser cannot read as a number ("-", "1e") changes nothing — it is not an emptied box', () => {
    // A real type="number" input holding "-" reports value "" with validity.badInput — the same value as
    // an emptied box. Before the fix that cleared the override (final check 2026-10-14). jsdom has no
    // badInput, so the box is given the browser's answer by hand.
    const { r, build } = mount({ ...BASE, overrides: { attributes: { str: 9 } } });
    const str = box('Str');
    focus(str);
    Object.defineProperty(str, 'validity', { configurable: true, get: () => ({ badInput: true }) });
    typeInto(str, '');
    blur(str);
    expect(build().overrides?.attributes).toEqual({ str: 9 });
    expect(box('Str').value).toBe('9');
    r.stop();
  });

  it('the boxes ask the phone for its number keyboard', () => {
    const { r } = mount();
    for (const l of ['Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha', 'Max HP']) expect(box(l).getAttribute('inputmode'), l).toBe('numeric');
    r.stop();
  });
});
