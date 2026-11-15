// @vitest-environment jsdom
/*
 * The sheet header names BOTH classes of a Dual Class character.
 *
 * bug 2026-10-23 (sheet fixes): CharacterSheet printed `cls?.name` — the first class alone — so a
 * Fighter/Barbarian read "Fighter" at the top of their own sheet. The roster card, the roster search and
 * the party card did the same. All now ask `heldClassNames`, which names the second class only under the
 * Dual Class rule (a `classId2` left behind with the rule off is no class).
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { build, content, firstSubclass } from './_content';
import { renderDom } from './_render';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { RosterScreen } from '../src/sheet/RosterScreen';
import { computeSummary } from '../src/sheet/partySummary';
import { computePcStats } from '../src/integration/computePcStats';
import { heldClassNames } from '../src/rules/heldClasses';
import type { Character } from '../src/rules/types';

const db = content();
const noop = () => undefined;
const dual = (a: string, b: string, level: number): Character =>
  build(a, level, { variantRules: { dualClass: true }, classId2: b, subclassId2: firstSubclass(b) });
const leftOver = (): Character => build('fighter', 5, { classId2: 'barbarian', subclassId2: firstSubclass('barbarian') });

const header = (c: Character) => {
  const r = renderDom(createElement(CharacterSheet, { character: c, content: db, charKey: 't' }));
  const t = r.host.querySelector('.char-sub')?.textContent ?? '';
  r.stop();
  return t;
};

describe('Dual Class — both class names', () => {
  it('heldClassNames: "Fighter / Barbarian" under Dual Class, the first class alone otherwise', () => {
    expect(heldClassNames(dual('fighter', 'barbarian', 5), db.classes)).toBe('Fighter / Barbarian');
    expect(heldClassNames(build('fighter', 5), db.classes)).toBe('Fighter');
    expect(heldClassNames(leftOver(), db.classes)).toBe('Fighter');
    expect(heldClassNames({ classId: null }, db.classes)).toBeUndefined();
    // credits/sheetfix merge, 2026-10-24: the same class twice is named once.
    expect(heldClassNames({ classId: 'fighter', classId2: 'fighter', variantRules: { dualClass: true } }, db.classes)).toBe('Fighter');
  });

  it('the sheet header shows both', () => {
    expect(header(dual('fighter', 'barbarian', 5))).toContain('Fighter / Barbarian');
  });

  it('controls: a single-class header and a left-over classId2 with the rule off show one class', () => {
    expect(header(build('fighter', 5))).toMatch(/Fighter$/);
    expect(header(leftOver())).not.toContain('Barbarian');
  });

  it('the roster card shows both', () => {
    const r = renderDom(
      createElement(RosterScreen, {
        roster: [{ id: 'r1', character: dual('wizard', 'ranger', 3) }],
        activeId: 'r1',
        content: db,
        onOpen: noop,
        onNew: noop,
        onImport: noop,
        onDuplicate: noop,
        onArchive: noop,
        onDelete: noop,
      }),
    );
    const t = r.host.textContent ?? '';
    r.stop();
    expect(t).toContain('Wizard / Ranger');
  });

  it('the party card and the outside-app stats show both', () => {
    const c = dual('rogue', 'alchemist', 4);
    expect(computeSummary(c, db).className).toBe('Rogue / Alchemist');
    expect(computePcStats(c, db).ancestryClass).toContain('Rogue / Alchemist');
  });
});
