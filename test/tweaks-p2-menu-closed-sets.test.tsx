// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP13 fix round 1: every "Add a tweak" menu that names a picker or a place offers EXACTLY the built
 * closed set the registry holds (`ANY_PICKERS`, `ADD_PLACES`, `REMOVE_PLACES`), read from the rendered menu as a
 * player opens it — so a deferred value (a skill increase taken anyway, a class-feature choice / tactic / rune place,
 * WP12 / WP15-WP17) hard-coded into ONE menu fails here even while the closed sets stay right. Synthetic characters
 * only.
 *
 *   - Add a tweak → Advanced → "Take anyway" in another picker → Picker: the six built pickers' words, in order;
 *   - Add a tweak → Add a place → Kind of place: the three built place kinds' words, in order;
 *   - Add a tweak → Advanced → Remove a place → Place: every option is a drawn place of a REMOVE_PLACES kind (by its
 *     words), and a level-10 fighter is offered every one of those kinds;
 *   - the place part's own remove-mode kind list (choiceParts.tsx; no screen shows it today: a removal row is read-only
 *     and the Add flow lists drawn places) holds the same three words.
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { hero, mountTweaks, openMenu, press, settle } from './_tweaks-harness';
import { PICKER_LABEL, PlacePart } from '../src/builder/tweaks/choiceParts';
import { ADD_PLACES, ANY_PICKERS, REMOVE_PLACES } from '../src/rules/blocks/registry';

const db = content();
let stops: (() => void)[] = [];
afterEach(async () => {
  for (const s of stops) {
    try {
      s();
    } catch {
      /* gone */
    }
  }
  stops = [];
  for (const n of [...document.body.children]) n.remove();
  await settle();
});

/** Open the popup carrying `title` inside `root` and read every option's name as drawn, then close it. */
async function optionNames(root: ParentNode, title: string): Promise<string[]> {
  const ctl = root.querySelector(`[data-ctl-title="${title}"]`);
  expect(ctl, `no "${title}" control`).toBeTruthy();
  await press(ctl!.querySelector('.ss-replace') ?? ctl!);
  const overlays = [...document.querySelectorAll('.picker-overlay')];
  const ov = overlays[overlays.length - 1];
  expect(ov, `the "${title}" popup opens`).toBeTruthy();
  const names = [...ov!.querySelectorAll('.pick-row, .picker-item')]
    .map((x) => x.querySelector('.picker-name')?.textContent?.trim())
    .filter((x): x is string => !!x);
  await press(ov!.querySelector('.picker-close'));
  return names;
}

/** The words each built place kind shows as. Its keys must be the closed set itself (checked below), so a kind added to
 *  a closed set fails here until it has words — and a menu row in no kind's words fails as unknown. */
const ADD_PLACE_WORDS: Record<string, string> = { feat: 'Feat place', skillIncrease: 'Skill increase', boost: 'Attribute boost' };
const REMOVE_PLACE_WORDS: Record<string, RegExp> = {
  feat: /^Level \d+ · [A-Z][a-z]+ feat( \([a-z]+\))?$/,
  skillIncrease: /^Level \d+ · Skill increase( \([a-z]+\))?$/,
  boost: /^Level \d+ · (Attribute|Ancestry|Background|Free) boost \(([a-z]+|\d+)\)$/,
};
const kindsOf = (label: string) => Object.keys(REMOVE_PLACE_WORDS).filter((k) => REMOVE_PLACE_WORDS[k].test(label));

describe('WP13 fix round 1: the Add menus offer exactly the built closed sets', () => {
  it('the words cover each closed set exactly (a kind added to a set needs its words first)', () => {
    expect(ANY_PICKERS.every((p) => !!PICKER_LABEL[p]), 'every built picker has its word').toBe(true);
    expect(Object.keys(ADD_PLACE_WORDS).sort()).toEqual([...ADD_PLACES].sort());
    expect(Object.keys(REMOVE_PLACE_WORDS).sort()).toEqual([...REMOVE_PLACES].sort());
  });

  it('"Take anyway" in another picker → Picker: the six built pickers, in order, and nothing else', async () => {
    const t = mountTweaks(db, hero(db, 'fighter', 5));
    stops.push(t.stop);
    const ed = await openMenu(t.host, '"Take anyway" in another picker');
    const names = await optionNames(ed, 'Picker');
    expect(names).toEqual(ANY_PICKERS.map((p) => PICKER_LABEL[p]));
    expect(names, 'no skill increase taken anyway (WP12, after the record rebuild)').not.toContain('Skill increase');
  });

  it('Add a place → Kind of place: the three built place kinds, in order, and nothing else', async () => {
    const t = mountTweaks(db, hero(db, 'fighter', 5));
    stops.push(t.stop);
    const ed = await openMenu(t.host, 'Add a place');
    expect(await optionNames(ed, 'Kind of place')).toEqual(ADD_PLACES.map((k) => ADD_PLACE_WORDS[k]));
  });

  it('Remove a place → Place: every option is a drawn place of a built kind, and a level-10 fighter is offered each kind', async () => {
    const t = mountTweaks(db, hero(db, 'fighter', 10));
    stops.push(t.stop);
    const ed = await openMenu(t.host, 'Remove a place');
    const names = await optionNames(ed, 'Place');
    expect(names.length, 'the level-10 fighter draws places').toBeGreaterThan(10);
    expect(
      names.filter((n) => kindsOf(n).length !== 1),
      'an option in no built kind (a class-feature choice, a tactic, a rune …) or in two',
    ).toEqual([]);
    expect([...new Set(names.map((n) => kindsOf(n)[0]))].sort()).toEqual([...REMOVE_PLACES].sort());
  });

  it("the place part's remove-mode kind list holds the same three built kinds", async () => {
    const r = renderDom(createElement(PlacePart, { mode: 'remove', value: {}, onChange: () => undefined }));
    stops.push(r.stop);
    expect(await optionNames(r.host, 'Kind of place')).toEqual(REMOVE_PLACES.map((k) => ADD_PLACE_WORDS[k]));
  });
});
