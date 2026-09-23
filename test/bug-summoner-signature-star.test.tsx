// @vitest-environment jsdom
/*
 * THE SUMMONER'S SIGNATURE STAR — the control, on screen.
 *
 * The engine was moved to the Impossible Magic rule (one signature spell per rank, class-feature-1346)
 * by widening its feature test to `signature-spells-<class>`, and the THREE CONTROLS THAT DRAW THE
 * STAR were left on exact equality with the bare `signature-spells` id: Builder.tsx twice (primary
 * caster and the dual-class second caster) and SpellsTab.tsx once. The class table names
 * `signature-spells-summoner`, so all three came up false.
 *
 * The result was strictly worse than the legacy rule it replaced: the old branch had derived "every
 * spell in the repertoire is signature", so a summoner went from every spell signature to NONE, with
 * no control anywhere to designate one and no way to heighten a known spell. Every engine test passed
 * throughout — they read `build.signatures`, an old save stores nothing there, and "no signature" is
 * the correct answer to an empty store. Only the picker could tell the difference.
 *
 * So this asserts the BUTTON, out of the real Builder: drawn for a summoner at 3rd, not before the
 * feature arrives, and still drawn for the bard that reaches the same feature through the plain id.
 * Every case also asserts a chip is on the page, so a page that simply rendered nothing can never
 * read as "no star, as expected".
 */
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';

const db = content();
const noop = () => undefined;

const caster = (classId: string, level: number, spells: Record<number, string[]>): BuildState =>
  ({
    ...emptyBuild(),
    name: 'sig',
    level,
    classId,
    subclassId: classId === 'summoner' ? 'beast-eidolon' : 'enigma',
    ancestryId: Object.keys(db.ancestries)[0],
    backgroundId: Object.keys(db.backgrounds)[0],
    keyAbility: 'cha',
    spells,
  }) as unknown as BuildState;

/**
 * Open the builder on one level page, the way the batch-037 render tests do.
 *
 * The page lists the spells GAINED AT THAT LEVEL, so the rank has to be the one the level brings
 * (2nd at 3rd) — a 1st-rank pick shown on the level-3 page is simply not there, and an assertion
 * written against it would fail for a reason that has nothing to do with the star.
 */
const chips = (b: BuildState, level: number) => {
  const r = renderDom(<Builder content={db} initial={b} onCancel={noop} onCreate={noop} />);
  r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === String(level)) ?? null);
  return { chips: r.host.querySelectorAll('.spr-chip').length, stars: r.host.querySelectorAll('button.spr-chip-sig').length };
};

describe('a summoner can designate a signature spell', () => {
  it('draws the star on its repertoire from 3rd level', () => {
    const r = chips(caster('summoner', 3, { 1: ['heal'], 2: ['acid-arrow'] }), 3);
    expect(r.chips, 'the 2nd-rank chip the level grants').toBeGreaterThan(0);
    expect(r.stars, 'no star = no signature spell and no way to make one').toBe(r.chips);
  });

  it('does not draw it before the feature arrives', () => {
    const r = chips(caster('summoner', 1, { 1: ['heal'] }), 1);
    expect(r.chips, 'the 1st-rank chip is on the page').toBeGreaterThan(0);
    expect(r.stars).toBe(0);
  });

  it('the bard, which reaches the same feature under the plain id, still draws it', () => {
    const r = chips(caster('bard', 3, { 1: ['heal'], 2: ['acid-arrow'] }), 3);
    expect(r.chips).toBeGreaterThan(0);
    expect(r.stars).toBe(r.chips);
  });
});
