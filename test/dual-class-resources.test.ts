// @vitest-environment jsdom
/*
 * DUAL CLASS — the SECOND class's counters and toggles are the character's.
 *
 * bug 2026-10-23 (sheet fixes): `resourcesForCharacter` matched only the class id it was handed, and
 * every caller handed it `classId` — the first class. So a Fighter/Barbarian had no Rage toggle, a
 * Wizard/Ranger no Hunt Prey, a Wizard/Oracle no Cursebound meter, and a Rogue/Alchemist had no
 * Versatile Vials counter and threw a LESSER vial at 12th level (the vial tier asks for the counter).
 * The Dual Class rule prints *"gain the proficiencies, HP, features and feats of a second class"*.
 *
 * Every case has a control beside it: a single-class character and a `classId2` left behind with the
 * rule OFF must not gain anything.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { build, content, firstSubclass } from './_content';
import { renderDom } from './_render';
import { initialClassResources, resourcesForCharacter } from '../src/rules/classResources';
import { deriveStrike, heldClasses } from '../src/rules/derive';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { CATALOG_MODES, modeRelevant } from '../src/rules/modes';
import { VitalsRail } from '../src/sheet/VitalsRail';
import type { BuildState } from '../src/rules/build';
import type { Character, InventoryItem } from '../src/rules/types';

const db = content();
const dual = (a: string, b: string, level: number, over: Partial<BuildState> = {}): Character =>
  build(a, level, { variantRules: { dualClass: true }, classId2: b, subclassId2: firstSubclass(b), ...over });
const ids = (c: Character) => resourcesForCharacter(c, new Set(c.feats.map((f) => f.featId))).map((r) => r.id);
const crafting = (level: number, at: number[]) => Object.fromEntries(at.filter((l) => l <= level).map((l) => [l, 'crafting']));
const vial: InventoryItem = { instanceId: 'v1', itemId: 'versatile-vial', quantity: 1, equipped: true };
const throwVial = (c: Character) => deriveStrike({ ...c, inventory: [vial] }, db, vial)!;

describe('Dual Class — the second class has its own class resources', () => {
  it.each([
    ['fighter', 'barbarian', 5, 'rage'],
    ['wizard', 'ranger', 8, 'hunt-prey'],
    ['fighter', 'swashbuckler', 3, 'panache'],
    ['champion', 'investigator', 4, 'devise-stratagem'],
    ['wizard', 'oracle', 11, 'cursebound'],
    ['fighter', 'inventor', 6, 'overdrive'],
    ['cleric', 'psychic', 5, 'unleash-psyche'],
    ['fighter', 'commander', 2, 'commanders-banner'],
    ['rogue', 'alchemist', 12, 'versatile-vials'],
  ] as const)('%s/%s %i has %s — on the sheet list and in the stored starting values', (a, b, level, id) => {
    const c = dual(a, b, level);
    expect(ids(c)).toContain(id);
    expect(Object.keys(c.classResources ?? {})).toContain(id);
  });

  it('the first class keeps its own entry beside the second class\'s (Alchemist/Barbarian)', () => {
    const c = dual('alchemist', 'barbarian', 12);
    expect(ids(c)).toEqual(['versatile-vials', 'rage']);
  });

  it('a second-class alchemist gets the class 2 + Int, not a dedication\'s flat 4', () => {
    const c = dual('rogue', 'alchemist', 12);
    const def = resourcesForCharacter(c).find((r) => r.id === 'versatile-vials')!;
    expect(def.feat).toBeUndefined();
  });

  it('controls: a single-class fighter and a classId2 left behind with Dual Class OFF gain nothing', () => {
    expect(ids(build('fighter', 5))).toEqual([]);
    const off = build('fighter', 5, { classId2: 'barbarian', subclassId2: firstSubclass('barbarian') });
    expect(ids(off)).toEqual([]);
    expect(off.classResources).toEqual({});
    expect(initialClassResources({ classId: 'fighter', classId2: 'barbarian' }, 5, { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 })).toEqual({});
  });

  it('a bare class id still names that one class (old callers and tests)', () => {
    expect(resourcesForCharacter('barbarian').map((r) => r.id)).toEqual(['rage']);
  });
});

describe('Dual Class — a second-class alchemist throws the vial their level makes', () => {
  it('Rogue/Alchemist 12 (master Crafting) throws a greater vial: 3d6, +2 item, 3 splash', () => {
    const c = dual('rogue', 'alchemist', 12, { skillIncreases: crafting(12, [3, 7]) });
    const s = throwVial(c);
    expect(s.damage).toMatch(/^3d6\b/);
    expect(s.damage).toContain('3 acid splash');
  });

  it('control: the same build with Dual Class OFF throws the printed lesser vial', () => {
    const c = build('rogue', 12, { classId2: 'alchemist', subclassId2: firstSubclass('alchemist'), skillIncreases: crafting(12, [3, 7]) });
    expect(throwVial(c).damage).toMatch(/^1d6\b/);
  });
});

describe('Dual Class — the rail shows the second class\'s counters', () => {
  it('Wizard/Oracle shows Cursebound; Rogue/Alchemist shows Versatile Vials', () => {
    for (const [c, label] of [
      [dual('wizard', 'oracle', 11), 'Cursebound'],
      [dual('rogue', 'alchemist', 12), 'Versatile Vials'],
    ] as const) {
      const r = renderDom(createElement(VitalsRail, { character: c, content: db }));
      const card = [...r.host.querySelectorAll('section.card')].map((s) => s.textContent ?? '').find((t) => t.includes('Class resources'));
      r.stop();
      expect(card, `${c.classId}/${c.classId2}`).toContain(label);
    }
  });
});

describe('Dual Class — a character saved before the fix', () => {
  /* Checker finding (2026-10-23): applyPlayState took `play.resources` WHOLE, so a Rogue/Alchemist saved before
   * the fix — whose play state never held `versatile-vials` — showed "0 / 3" on the rail until a rest. The play
   * values still win; only a key the play state never held gets the build's starting value. */
  it('a play state without the new key shows the build\'s 3 vials; a spent value the player set still wins', () => {
    const c = dual('rogue', 'alchemist', 12);
    const fresh = applyPlayState(c, { ...initialPlay(c, db), resources: {} }, db);
    expect(fresh.classResources?.['versatile-vials']).toBe(3);
    const spent = applyPlayState(c, { ...initialPlay(c, db), resources: { 'versatile-vials': 1 } }, db);
    expect(spent.classResources?.['versatile-vials']).toBe(1);
  });

  it('the rail shows 3 / 3 for that character, not 0 / 3', () => {
    const c = dual('rogue', 'alchemist', 12);
    const r = renderDom(createElement(VitalsRail, { character: applyPlayState(c, { ...initialPlay(c, db), resources: {} }, db), content: db }));
    const card = [...r.host.querySelectorAll('section.card')].map((s) => s.textContent ?? '').find((t) => t.includes('Class resources'));
    r.stop();
    expect(card).toContain('3 / 3');
  });
});

describe('Dual Class — the Modes panel lists the second class\'s modes', () => {
  /* Checker finding (2026-10-23): modeRelevant took `character.classId`, so a Fighter/Barbarian's Rage modes
   * were hidden from the default list. The sheet now passes every held class. */
  it('Rage is relevant to a Fighter/Barbarian (both class ids) and not to a plain fighter', () => {
    const rage = CATALOG_MODES.find((m) => m.id === 'cat-rage')!;
    expect(modeRelevant(rage, heldClasses(dual('fighter', 'barbarian', 5)).map((s) => s.classId))).toBe(true);
    expect(modeRelevant(rage, heldClasses(build('fighter', 5)).map((s) => s.classId))).toBe(false);
    expect(modeRelevant(rage, 'barbarian')).toBe(true);
  });
});

describe('guard: no caller hands the class-resource list a bare first-class id', () => {
  it('src never calls resourcesForCharacter / initialClassResources with `<x>.classId`', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n)) files.push(p);
      }
    };
    walk('src');
    const bad = files.flatMap((f) =>
      // `x.classId` and a bare destructured `classId` alike (checker finding: the first form alone let
      // `const { classId } = character; resourcesForCharacter(classId…)` through).
      [...readFileSync(f, 'utf8').matchAll(/(?:resourcesForCharacter|initialClassResources)\(\s*(?:[\w.]*\.)?classId\b/g)].map((m) => `${f}: ${m[0]}`),
    );
    expect(bad).toEqual([]);
  });

  it('the sheet never hands the Modes panel `classId={<x>.classId}` — it passes every held class', () => {
    // Second checker (2026-10-23): the modeRelevant test calls the function directly, so the two call sites
    // (VitalsRail, CompanionsTab) could go back to the first class with every other test green.
    const bad = readdirSync('src/sheet')
      .filter((n) => /\.tsx$/.test(n))
      .flatMap((n) => {
        const f = join('src/sheet', n);
        return [...readFileSync(f, 'utf8').matchAll(/classId=\{\s*[\w.]*\.classId\s*\}/g)].map((m) => `${f}: ${m[0]}`);
      });
    expect(bad).toEqual([]);
  });
});
