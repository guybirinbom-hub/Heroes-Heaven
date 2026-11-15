// @vitest-environment jsdom
/*
 * VERSATILE VIALS REFILL TO THE RAISED MAXIMUM — bug found 2026-10-23, fixed 2026-11-09.
 *
 * Additional Servings: *"your number of versatile vials per day increases to 5"* (again to 6 and 7 on
 * later takes). The tracker drew that maximum through `resourceMaxFor` (it reads `resourceFloors`), but
 * the START value came from `initialClassResources` → `resourceInitial` → the bare `resourceMax`, which
 * ignored the floors. A rest refills to that start value (App.tsx hands `classResources` to rest()), so
 * the alchemist sat at "4 / 5" from creation and after every night.
 *
 * Same shape, second cause: an invested apex item raises an ability only in the play overlay
 * (applyPlayState), so a 17th-level alchemist with a Crown of Intellect was drawn at 2 + the raised Int
 * and rested to 2 + the build's Int. The rest now refills from the character the tracker draws.
 *
 * Every number below is checked against `resourceMaxFor` on the SAME character the rail draws, so the
 * test fails the moment the start value, the refill and the screen disagree again. The test characters
 * are synthesized by the shared `build` helper (Int 12, so the bare formula gives 2 + 1 = 3).
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { build, content, firstSubclass } from './_content';
import { renderDom } from './_render';
import { abilityMod } from '../src/rules/derive';
import {
  resourceMaxFor,
  resourcesForCharacter,
  restedClassResources,
  type ClassResource,
} from '../src/rules/classResources';
import { applyPlayState, bumpResource, initialPlay, rest, type PlayState } from '../src/rules/play';
import { VitalsRail } from '../src/sheet/VitalsRail';
import type { AbilityId, Character, InventoryItem } from '../src/rules/types';

const db = content();
const VIALS = 'versatile-vials';

/** The ability mods the tracker uses (VitalsRail / AlchemyPanel: abilityMod of the drawn character's scores). */
const mods = (c: Character) =>
  Object.fromEntries(Object.entries(c.abilities).map(([k, v]) => [k, abilityMod(v)])) as Record<AbilityId, number>;
const vialDef = (c: Character): ClassResource =>
  resourcesForCharacter(c, new Set(c.feats.map((f) => f.featId))).find((r) => r.id === VIALS)!;
/** The maximum the tracker draws for this character. */
const shownMax = (c: Character) => resourceMaxFor(vialDef(c), c, mods(c));

/** What the vitals rail prints for the vial counter, e.g. "5 / 5". */
function railVials(c: Character): string {
  const r = renderDom(createElement(VitalsRail, { character: c, content: db }));
  const card = [...r.host.querySelectorAll('section.card')].find((s) => (s.textContent ?? '').includes('Class resources'));
  const row = [...(card?.querySelectorAll('.rail-kv') ?? [])].find((el) => (el.textContent ?? '').includes('Versatile Vials'));
  const text = (row?.textContent ?? '').match(/(\d+)\s*\/\s*(\d+)/);
  r.stop();
  return text ? `${text[1]} / ${text[2]}` : `(no vial row: ${card?.textContent ?? 'no Class resources card'})`;
}

/** Spend `n` vials the way the rail's minus button does, then take a night's rest the way App.tsx does. */
function spendAndRest(ch: Character, n: number, play: PlayState = initialPlay(ch, db)): { spent: PlayState; rested: PlayState; sheet: Character } {
  const before = applyPlayState(ch, play, db);
  const spent = bumpResource(play, 'versatile-vials', before.classResources?.[VIALS] ?? 0, -n, shownMax(before));
  const sheet = applyPlayState(ch, spent, db);
  const rested = rest(spent, { level: ch.level, conMod: abilityMod(ch.abilities.con), initialResources: restedClassResources(sheet, mods(sheet)) });
  return { spent, rested, sheet: applyPlayState(ch, rested, db) };
}

const served = (level: number, picks: Record<string, string>) => build('alchemist', level, { featPicks: picks });

describe('Versatile Vials — start value and rest refill match the maximum the tracker shows', () => {
  it('premise: the test alchemist\'s bare formula is BELOW 5, so Additional Servings changes the number', () => {
    const plain = build('alchemist', 6, {});
    expect(shownMax(plain)).toBe(2 + abilityMod(plain.abilities.int));
    expect(shownMax(plain)).toBeLessThan(5);
  });

  it('(a) a new alchemist with Additional Servings starts at the raised maximum (5 / 5)', () => {
    const ch = served(6, { '6:class': 'additional-servings' });
    expect(ch.resourceFloors?.[VIALS]).toBe(5);
    expect(shownMax(ch)).toBe(5);
    // The stored start value (what rebuildRoster refreshes and initialPlay seeds from)…
    expect(ch.classResources?.[VIALS]).toBe(5);
    // …the play state's first seed…
    expect(initialPlay(ch, db).resources?.[VIALS]).toBe(5);
    // …and what the rail draws, before and after the play state exists.
    expect(railVials(ch)).toBe('5 / 5');
    expect(railVials(applyPlayState(ch, initialPlay(ch, db), db))).toBe('5 / 5');
  });

  it('(b) after spending vials and resting it is back at the raised maximum, not the bare 2 + Int', () => {
    const ch = served(6, { '6:class': 'additional-servings' });
    const { spent, rested, sheet } = spendAndRest(ch, 2);
    expect(spent.resources?.[VIALS]).toBeLessThan(5); // vials were spent…
    expect(rested.resources?.[VIALS]).toBe(5); // …and the night brings back all five
    expect(railVials(sheet)).toBe('5 / 5');
    // The stored character's own map — rest's fallback, and the value a launch rebuild refreshes — agrees.
    expect(rest(spent, { level: 6, conMod: 0, initialResources: ch.classResources }).resources?.[VIALS]).toBe(5);
  });

  it('(b) retaken: 6 at 12th level, 7 at 18th, from creation and after a rest', () => {
    for (const [level, picks, want] of [
      [12, { '6:class': 'additional-servings', '12:class': 'additional-servings' }, 6],
      [18, { '6:class': 'additional-servings', '12:class': 'additional-servings', '18:class': 'additional-servings' }, 7],
    ] as const) {
      const ch = served(level, picks);
      expect(shownMax(ch), `L${level}`).toBe(want);
      expect(ch.classResources?.[VIALS], `L${level} start`).toBe(want);
      expect(spendAndRest(ch, 3).rested.resources?.[VIALS], `L${level} rest`).toBe(want);
    }
  });

  it('(c) control: without the feat the start value and the refill are the base 2 + Int', () => {
    const ch = build('alchemist', 6, {});
    const base = 2 + abilityMod(ch.abilities.int);
    expect(ch.resourceFloors).toBeUndefined();
    expect(ch.classResources?.[VIALS]).toBe(base);
    const { rested, sheet } = spendAndRest(ch, 2);
    expect(rested.resources?.[VIALS]).toBe(base);
    expect(railVials(sheet)).toBe(`${base} / ${base}`);
  });

  it('(d) Dual Class: a Rogue/Alchemist with Additional Servings starts and rests at 5 too', () => {
    const ch = build('rogue', 6, {
      variantRules: { dualClass: true },
      classId2: 'alchemist',
      subclassId2: firstSubclass('alchemist'),
      featPicks: { '6:class:1': 'additional-servings' },
    });
    expect(shownMax(ch)).toBe(5);
    expect(ch.classResources?.[VIALS]).toBe(5);
    expect(spendAndRest(ch, 3).rested.resources?.[VIALS]).toBe(5);
  });

  it('(e) an apex item invested in play: the rest refills to the raised-Int maximum the rail draws', () => {
    const ch = build('alchemist', 17, {});
    const crown: InventoryItem = { instanceId: 'crown', itemId: 'crown-of-intellect', quantity: 1, worn: true, invested: true };
    expect(db.items['crown-of-intellect']?.apexAttribute).toBe('int');
    const seed = initialPlay(ch, db);
    const play: PlayState = { ...seed, inventory: [...(seed.inventory ?? []), crown] };
    const drawn = applyPlayState(ch, play, db);
    // Premise: the overlay raises Int, so the drawn maximum is above the build's stored start value.
    expect(drawn.abilities.int).toBeGreaterThan(ch.abilities.int);
    expect(shownMax(drawn)).toBeGreaterThan(ch.classResources?.[VIALS] ?? 0);
    const { rested, sheet } = spendAndRest(ch, 2, play);
    expect(rested.resources?.[VIALS]).toBe(shownMax(drawn));
    expect(railVials(sheet)).toBe(`${shownMax(drawn)} / ${shownMax(drawn)}`);
  });

  it('(f) wiring: the app\'s rest refills through restedClassResources over the in-play character', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    const at = app.indexOf('onRest={(o) => {');
    expect(at, 'the onRest handler in App.tsx').toBeGreaterThan(-1);
    const handler = app.slice(at, app.indexOf('onOpenRoster=', at));
    // The refill is worked out from `character` (the play-overlaid one the rail draws)…
    expect(handler).toMatch(/const restedResources = character\s*\?\s*restedClassResources\(\s*character\s*,/);
    // …and that is what the rest is handed — not the stored character's map.
    expect(handler).toMatch(/rest\(p, \{[\s\S]*initialResources: restedResources,/);
    expect(handler).not.toMatch(/initialResources: active\.character\.classResources/);
  });
});
