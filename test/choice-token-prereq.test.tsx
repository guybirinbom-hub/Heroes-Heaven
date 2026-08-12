// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';
import { content, firstSubclass } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { CORE_BOOKS } from '../src/rules/sources';

/**
 * A CHOICE ANSWER as an eligibility token — asserted on the RENDERED BUILDER.
 *
 * Magaambyan Attendant Dedication asks which branch you affiliate with, and eight feats print
 * "<Branch> affiliation" as a prerequisite. `checkPrerequisites` resolved a prerequisite line to a
 * feat id and silently ignored anything that matched none, so the affiliation line was unenforced:
 * measured before the fix, all eight came back met for all five branches, and every branch feat was
 * offered to every attendant.
 *
 * The unit half lives in prerequisites.test.ts. This half exists because the two rulings at stake are
 * about what the PLAYER SEES, and a predicate returning the right boolean proves neither of them:
 *   Q9  — the builder shows only what you may legally pick, unless you toggle "show options not
 *         meeting prerequisites".
 *   Q27 — anything shown but untakeable must LOOK untakeable and say WHY. The reason has to be the
 *         right one: the row used to print every prerequisite in one warn colour, so an attendant
 *         blocked on their branch was told they lacked the dedication they were holding.
 */
const c = () => content();
const noop = () => undefined;
/** The branch feats are Lost Omens content, and only the four Core books are on by default. */
const BOOK = 'Pathfinder Lost Omens Character Guide';

const attendant = (branch: string): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level: 6,
  classId: 'wizard',
  ancestryId: 'human',
  heritageId: 'skilled-human',
  backgroundId: 'acolyte',
  keyAbility: 'int',
  subclassId: firstSubclass('wizard'),
  enabledSources: [...CORE_BOOKS, BOOK],
  featPicks: { '2:class:0': 'magaambyan-attendant-dedication' },
  featChoices: { '2:class:0': branch },
});

/** Type into a controlled React input: assigning `.value` alone is invisible to React's onChange. */
function typeInto(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const byText = (host: HTMLElement, sel: string, text: string) =>
  [...host.querySelectorAll<HTMLElement>(sel)].find((e) => (e.textContent ?? '').trim() === text) ?? null;

/**
 * Open the level-6 class-feat picker for an attendant of `branch`, reveal archetype feats, and search
 * `query`. Returns the live host so a test can inspect what the player is actually looking at.
 */
function openFeatPicker(branch: string, query: string) {
  const r = renderDom(<Builder content={c()} initial={attendant(branch)} onCancel={noop} onCreate={noop} />);
  r.click(byText(r.host, 'button', '6'));
  const slot = [...r.host.querySelectorAll<HTMLButtonElement>('button.lvl-card.empty')].find((b) =>
    (b.textContent ?? '').includes('Class feat'),
  );
  r.click(slot ?? null);
  // Archetype feats are hidden from a class slot until the player asks for them.
  r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.fsel-arch')][0] ?? null);
  const search = r.host.querySelector<HTMLInputElement>('.fsel-results-search input');
  expect(search, 'the picker did not open').toBeTruthy();
  typeInto(search!, query);
  return r;
}

/** The picker row (if any) naming `name`. Matched by containment: the name cell also carries the
 *  feat's action-cost glyph, which is a character of the Pathfinder icon font, not part of the name. */
function rowFor(host: HTMLElement, name: string): HTMLElement | null {
  const nameEl = [...host.querySelectorAll<HTMLElement>('.picker-name')].find((e) => (e.textContent ?? '').includes(name));
  return nameEl?.closest('.fsel-rowwrap') ?? null;
}

describe('Q9 — a branch feat is offered only to that branch', () => {
  it("lists Cascade Bearer's Flexibility for a Cascade Bearer", () => {
    const r = openFeatPicker('cascade-bearers', 'Cascade Bearer');
    expect(rowFor(r.host, "Cascade Bearer's Flexibility"), 'the feat must be offered').toBeTruthy();
    r.stop();
  });

  it('hides it from a Rain-Scribe, behind the "Show ineligible" toggle', () => {
    const r = openFeatPicker('rain-scribes', 'Cascade Bearer');
    expect(rowFor(r.host, "Cascade Bearer's Flexibility"), 'the feat must be filtered out').toBeNull();
    // Q9's escape hatch has to exist, and has to say how much it is holding back.
    const toggle = r.host.querySelector<HTMLButtonElement>('button.fsel-inel');
    expect(toggle?.textContent ?? '').toContain('Show ineligible');
    r.stop();
  });
});

describe('Q27 — revealed, it looks untakeable and names the right reason', () => {
  it('greys the row, disables the action, and marks the affiliation clause as the unmet one', () => {
    const r = openFeatPicker('rain-scribes', 'Cascade Bearer');
    r.click(r.host.querySelector('button.fsel-inel'));
    const row = rowFor(r.host, "Cascade Bearer's Flexibility");
    expect(row, 'showing ineligible options must reveal it').toBeTruthy();

    // Looks untakeable…
    expect(row!.querySelector('.pick-row.dim'), 'the row must be dimmed').toBeTruthy();
    expect(row!.querySelector<HTMLButtonElement>('button.pick-add')?.disabled, 'the choose action must be disabled').toBe(true);

    // …and says why, about the clause that is ACTUALLY failing.
    const prereq = row!.querySelector('.picker-prereq');
    expect(prereq?.textContent ?? '').toContain('Requires (unmet)');
    const unmet = [...row!.querySelectorAll('.prereq-unmet')].map((e) => e.textContent);
    const met = [...row!.querySelectorAll('.prereq-met')].map((e) => e.textContent);
    expect(unmet).toEqual(['Cascade Bearers affiliation']);
    // The dedication the character IS holding must not be listed as a reason.
    expect(met).toContain('Magaambyan Attendant Dedication');
    r.stop();
  });
});
