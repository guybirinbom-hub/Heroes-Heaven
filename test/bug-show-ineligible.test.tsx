// @vitest-environment jsdom
// bug 2026-09-12 #1: show-ineligible
import { describe, expect, it } from 'vitest';
import { content, firstSubclass } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';

/**
 * "after i press the show ineligible button nothing changes." — owner, 2026-09-12.
 *
 * MEASURED on the rendered Builder before the fix (a human fighter, core books only):
 *   1st-level Ancestry feat: 7 rows, button "Show ineligible" → click → 7 rows.
 *   1st-level Class feat:    8 rows, button "Show ineligible" → click → 8 rows.
 *   3rd-level General feat: 36 rows, button "Show ineligible · 97" → click → 133 rows.
 *   2nd-level Skill feat:   17 rows, button "Show ineligible · 93" → click → 110 rows.
 *
 * The toggle itself was never broken. The button was RENDERED WHERE IT COULD DO NOTHING: its
 * condition was `inelKeys && (inelCount > 0 || hideInel)`, and `hideInel` is the default, so every
 * picker carrying an `ineligible` predicate showed the button even when the current results held no
 * ineligible entry at all. The two slots a player opens first — 1st-level ancestry and class feats,
 * where a level-1 character qualifies for everything that is offered — are exactly that case.
 *
 * The fix is one condition: show it only while something is actually being held back.
 */
const c = () => content();
const noop = () => undefined;

const fighter = (level: number): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level,
  classId: 'fighter',
  ancestryId: 'human',
  heritageId: 'skilled-human',
  backgroundId: 'acolyte',
  keyAbility: 'str',
  subclassId: firstSubclass('fighter'),
});

/** Open the Builder at `level` and click that level's first empty slot labelled `label`. */
function openSlot(build: BuildState, level: number, label: string) {
  const r = renderDom(<Builder content={c()} initial={build} onCancel={noop} onCreate={noop} />);
  const lvlBtn = [...r.host.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === String(level));
  r.click(lvlBtn ?? null);
  const slot = [...r.host.querySelectorAll<HTMLButtonElement>('button.lvl-card.empty')].find((b) =>
    (b.textContent ?? '').includes(label),
  );
  r.click(slot ?? null);
  expect(r.host.querySelector('.fsel-results-search input'), `the ${label} picker did not open`).toBeTruthy();
  return r;
}

const rows = (host: HTMLElement) => host.querySelectorAll('.fsel-list .fsel-rowwrap').length;
const toggle = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('button.fsel-inel');

describe('the "Show ineligible" button only exists where pressing it changes the list', () => {
  /*
   * The defect itself: a button offering to reveal an empty set. Asserting on its ABSENCE is what
   * makes this mutation-proof — restore the `|| hideInel` and these two fail.
   */
  it.each([
    [1, 'Ancestry feat'],
    [1, 'Class feat'],
  ])('is not rendered in the lvl-%s %s slot, where nothing is held back', (lvl, label) => {
    const r = openSlot(fighter(3), lvl as number, label as string);
    const before = rows(r.host);
    expect(before, 'the slot must actually be offering feats').toBeGreaterThan(0);
    expect(toggle(r.host), 'a button that cannot change the list must not be on screen').toBeNull();
    r.stop();
  });

  /* …and the other half: where it DOES hold things back, it is present, counts them, and pressing it
   * reveals exactly that many more rows. A fix that simply deleted the button passes the pair above
   * and fails here. */
  it.each([
    [3, 'General feat'],
    [2, 'Skill feat'],
  ])('reveals its counted rows in the lvl-%s %s slot', (lvl, label) => {
    const r = openSlot(fighter(3), lvl as number, label as string);
    const before = rows(r.host);
    const t = toggle(r.host);
    expect(t, 'the escape hatch must exist where options are hidden').toBeTruthy();
    // The label names the action AND how many it is holding back.
    const held = Number(/Show ineligible · (\d+)/.exec(t!.textContent ?? '')?.[1] ?? NaN);
    expect(held, 'the button must print the count it is holding back').toBeGreaterThan(0);

    r.click(t);
    const after = rows(r.host);
    expect(after, 'pressing it must reveal the rows it counted').toBe(before + held);
    // Still reachable in the revealed state, so the player can put them back.
    const back = toggle(r.host);
    expect(back?.textContent ?? '', 'the toggle must survive its own press').toContain('Hide ineligible');
    r.click(back);
    expect(rows(r.host), 'pressing it again must restore the filtered list').toBe(before);
    r.stop();
  });
});
