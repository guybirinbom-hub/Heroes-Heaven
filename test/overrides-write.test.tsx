// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { pruneOverrides } from '../src/rules/blocks/write';
import type { BuildOverrides } from '../src/rules/types';
import { addEditor, enter, focus, hero, leave, mountTweaks, openMenu, openRow, pick, press, rowBy, settle, typeInto } from './_tweaks-harness';

/**
 * Phone audit 2026-10-14, the Overrides card — its two findings, now held by the Tweaks editors that
 * replaced the card (plan B WP7: "port, never delete").
 *
 * D5 — "Set maximum HP" never saved anything. The card's writeOv rebuilt the overrides object one
 * hand-written line per key and had no `maxHp` line, so every value typed into the box was dropped before
 * it reached the build. It is generic now (pruneOverrides, blocks/write.ts) and this file holds a sample of
 * EVERY key BuildOverrides declares, read off src/rules/types.ts — a key added there later fails here until
 * it has a sample, and then it is proven to survive. The editor half: Tweaks → Set a number → Maximum HP
 * saves what is typed (the box is still `aria-label="Max HP"`).
 *
 * D6 — the number boxes snapped back when emptied: Dex 12, Backspace, Backspace, 8 saved 128, because an
 * empty box reverted the override mid-edit and refilled with the computed 12. The boxes are drafts
 * (DraftNumberInput): they may be empty while edited and decide when the player leaves them — a number
 * saves, an empty box removes the tweak (the card's "back to the computed value"), a tap with no typing
 * changes nothing. Held here on a score set's own row editor (Dexterity set to 12), where the card's
 * Dex box was.
 */

const db = content();
afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});

/** A non-empty value for every BuildOverrides key, in Tweaks part B's shape: the meta carries `mode`,
 *  `source`, `moved` and `of` (plan B WP1), and `v` is set. (scripts/blocks-parity-snapshot.mjs keeps an OLD
 *  copy of this sample on purpose — frozen there as the old-character fixture; this one may move on.) */
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
  blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1 }],
  meta: {
    'proficiencies:athletics': { reason: 'Guild training', mode: 'atLeast', of: 'expert', moved: true },
    'addedFeats:toughness@1': { source: 'import', of: 'toughness@1' },
  },
  v: 2,
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

  it('pruneOverrides keeps v (plan B, B27), and an object holding nothing but v and empty meta is no overrides (B15)', () => {
    // `v` is the Tweaks marker: dropping it would flip a stamped character back to "ON by read".
    expect(pruneOverrides({ v: 2, maxHp: 30 }, { attributes: { dex: 8 } })).toEqual({ v: 2, maxHp: 30, attributes: { dex: 8 } });
    expect(pruneOverrides({ v: 3, maxHp: 30 }, {})).toEqual({ v: 3, maxHp: 30 }); // a newer app's v is never lowered
    expect(pruneOverrides({}, { maxHp: 30 })).not.toHaveProperty('v'); // …and never added
    expect(pruneOverrides({ v: 2, maxHp: 30 }, { maxHp: undefined })).toBeUndefined();
    expect(pruneOverrides({ v: 2, meta: {} }, {})).toBeUndefined();
    expect(pruneOverrides({ v: 2, meta: { 'maxHp:max-hp': {} } }, {})).toBeUndefined();
    // a meta that still says something is kept (UNKNOWN ≠ EMPTY)
    expect(pruneOverrides({ v: 2, meta: { 'maxHp:max-hp': { reason: 'x', of: '30' } } }, {})).toEqual({ v: 2, meta: { 'maxHp:max-hp': { reason: 'x', of: '30' } } });
  });
});

/* ---- the real editors -------------------------------------------------------------------------- */

/** A level-1 fighter, Tweaks on (the old card's BASE). */
const BASE = (ov?: BuildOverrides) => hero(db, 'fighter', 1, ov);
const box = (label: string, root: ParentNode = document) => root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
const addGo = (host: ParentNode) => addEditor(host)!.querySelector<HTMLButtonElement>('button.tw-add-go')!;
async function openRowOf(host: HTMLElement, what: string | RegExp) {
  const row = rowBy(host, what);
  expect(row, `no row ${String(what)}`).toBeTruthy();
  await press(row!.querySelector('.tw-row-head'));
  return openRow(host)!;
}

describe('D5: Set a number → Maximum HP saves what is typed, and emptying it removes the tweak', () => {
  it('30 is saved; an emptied box takes the tweak away', async () => {
    const r = mountTweaks(db, BASE());
    await openMenu(r.host, 'Set a number');
    await pick(addEditor(r.host)!, 'What', 'Maximum HP');
    const hp = box('Max HP', addEditor(r.host)!);
    expect(hp, 'no Max HP box').toBeTruthy();
    expect(hp.placeholder, 'the book maximum').toMatch(/^book: \d+$/);
    await enter(hp, '30');
    await press(addGo(r.host));
    expect(r.build().overrides?.maxHp).toBe(30);
    // The new tweak opens as its row, its box holding the number.
    expect(box('Max HP', openRow(r.host)!).value).toBe('30');
    await enter(box('Max HP', openRow(r.host)!), '');
    expect(r.build().overrides?.maxHp).toBeUndefined();
    expect(r.host.querySelector('li.tw-row[data-kind="number.setMaxHp"]'), 'the row goes with it').toBeNull();
    r.stop();
  });

  it('Enter saves too, and a value below 1 is held at 1', async () => {
    const r = mountTweaks(db, BASE());
    await openMenu(r.host, 'Set a number');
    await pick(addEditor(r.host)!, 'What', 'Maximum HP');
    focus(box('Max HP'));
    typeInto(box('Max HP'), '0');
    act(() => {
      box('Max HP').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();
    await press(addGo(r.host));
    expect(r.build().overrides?.maxHp).toBe(1);
    // …and on the row's own box.
    const row = openRow(r.host)!;
    focus(box('Max HP', row));
    typeInto(box('Max HP', row), '-5');
    act(() => {
      box('Max HP', row).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle();
    expect(r.build().overrides?.maxHp).toBe(1);
    r.stop();
  });
});

describe('D6: a tweak number box can be emptied while typing', () => {
  it('Dex 12 → Backspace, Backspace, 8 saves 8 (it saved 128)', async () => {
    const r = mountTweaks(db, BASE({ v: 2, attributes: { dex: 12 } } as BuildOverrides));
    const row = await openRowOf(r.host, 'Dexterity set to 12');
    const dex = box('Dexterity score', row);
    expect(dex.value).toBe('12');
    focus(dex);
    typeInto(dex, '1');
    typeInto(dex, '');
    expect(box('Dexterity score', row).value, 'the emptied box refilled mid-edit').toBe('');
    typeInto(box('Dexterity score', row), '8');
    expect(box('Dexterity score', row).value).toBe('8');
    leave(box('Dexterity score', row));
    await settle();
    expect(r.build().overrides?.attributes).toEqual({ dex: 8 });
    expect(box('Dexterity score', openRow(r.host)!).value).toBe('8');
    r.stop();
  });

  it('emptied and left = the tweak goes; a tap with no typing changes nothing', async () => {
    const r = mountTweaks(db, BASE({ v: 2, attributes: { str: 9, con: 14 } } as BuildOverrides));
    let row = await openRowOf(r.host, 'Strength set to 9');
    expect(box('Strength score', row).value).toBe('9');
    await enter(box('Strength score', row), '');
    expect(r.build().overrides?.attributes).toEqual({ con: 14 });

    row = await openRowOf(r.host, 'Constitution set to 14');
    const before = r.patches();
    focus(box('Constitution score', row));
    leave(box('Constitution score', row));
    await settle();
    expect(r.patches(), 'tapping a box and leaving it wrote a tweak').toBe(before);
    expect(r.build().overrides?.attributes).toEqual({ con: 14 });
    r.stop();
  });

  it('a minus typed first is not glued onto the old value ("-1" gave 121)', async () => {
    const r = mountTweaks(db, BASE({ v: 2, attributes: { dex: 12 } } as BuildOverrides));
    const row = await openRowOf(r.host, 'Dexterity set to 12');
    focus(box('Dexterity score', row));
    typeInto(box('Dexterity score', row), '');
    typeInto(box('Dexterity score', row), '-1');
    leave(box('Dexterity score', row));
    await settle();
    expect(r.build().overrides?.attributes).toEqual({ dex: -1 });
    r.stop();
  });

  it('text the browser cannot read as a number ("-", "1e") changes nothing — it is not an emptied box', async () => {
    // A real type="number" input holding "-" reports value "" with validity.badInput — the same value as
    // an emptied box. Before the fix that cleared the override (final check 2026-10-14). jsdom has no
    // badInput, so the box is given the browser's answer by hand.
    const r = mountTweaks(db, BASE({ v: 2, attributes: { str: 9 } } as BuildOverrides));
    const row = await openRowOf(r.host, 'Strength set to 9');
    const str = box('Strength score', row);
    focus(str);
    Object.defineProperty(str, 'validity', { configurable: true, get: () => ({ badInput: true }) });
    typeInto(str, '');
    leave(str);
    await settle();
    expect(r.build().overrides?.attributes).toEqual({ str: 9 });
    expect(box('Strength score', openRow(r.host)!).value).toBe('9');
    r.stop();
  });

  it('the boxes ask the phone for its number keyboard', async () => {
    const r = mountTweaks(db, BASE({ v: 2, attributes: { dex: 12 } } as BuildOverrides));
    const row = await openRowOf(r.host, 'Dexterity set to 12');
    for (const l of ['Dexterity score', 'From level']) expect(box(l, row).getAttribute('inputmode'), l).toBe('numeric');
    await openMenu(r.host, 'Set a number');
    await pick(addEditor(r.host)!, 'What', 'Maximum HP');
    for (const l of ['Max HP', 'From level']) expect(box(l, addEditor(r.host)!).getAttribute('inputmode'), l).toBe('numeric');
    r.stop();
  });
});
