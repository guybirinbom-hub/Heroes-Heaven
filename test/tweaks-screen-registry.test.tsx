// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { targetName } from '../src/rules/blocks/names';
import { BLOCK_KINDS, STILL_TO_ADD, blockKind } from '../src/rules/blocks/registry';
import {
  addEditor,
  advancedPartsOf,
  chooserLabels,
  enter,
  hero,
  menuButtons,
  mountTweaks,
  openMenu,
  partsOf,
  pick,
  press,
  pressedOption,
} from './_tweaks-harness';

/**
 * "REGISTRY EDITORS BUILT" ON THE SCREEN (plan B section 7.3, WP7; decisions 23-24).
 *
 * scripts/blocks-check.mjs checks a boolean: a kind not built is on STILL_TO_ADD with a reason, a built one is
 * not. This checks the SCREEN those booleans promise: for every kind with `editor.built`, each of its menus is
 * a "Add a tweak" button in the right place (the main list, or inside Advanced only once it folds out), and
 * opening that menu with one fixture target the kind accepts shows exactly the kind's `parts`, in order —
 * the target part kept on top (number.setMaxHp's own parts have none) — and its `advancedParts` only inside
 * the editor's own Advanced fold. A menu two kinds share for one target shows the option chooser with both
 * labels (the shared-menu rule, section 4.6). The expected lists are read straight off the registry entry;
 * nothing here asks the screen code (model.ts) what it would show.
 *
 * MUTATION PROOF (wp7-report.md, a temp copy): one kind left `built: true` with its menu removed from the
 * screen → "every built kind's menus are buttons…" and its it.each case fail.
 */

const db = content();
afterEach(() => {
  for (const n of [...document.body.children]) n.remove();
});

/** One target per built kind that points at a statistic: the target part chooses it. */
const FIXTURE_TARGET: Record<string, string> = {
  'number.add': 'skill:athletics',
  'attribute.add': 'score:str',
  'number.set': 'ac',
  'number.setMaxHp': 'max-hp',
  'number.atLeast': 'ac',
  'attribute.set': 'score:dex',
  'rank.atLeast': 'skill:stealth',
  'rank.exactly': 'skill:stealth',
};
/** The "Add a Lore" menu's target is a typed subject. */
const LORE_MENU = 'Add a Lore';
const LORE_SUBJECT = 'Sailing';

const built = BLOCK_KINDS.filter((k) => k.editor?.built);
const pointsAtStat = (id: string) => 'aspect' in (blockKind(id)!.accepts as object);
const FIGHTER = () => hero(db, 'fighter', 5);

describe('every built kind is on the screen (decisions 23-24)', () => {
  it('every built kind that points at a statistic has a fixture target', () => {
    expect(built.filter((k) => pointsAtStat(k.id) && !FIXTURE_TARGET[k.id]).map((k) => k.id)).toEqual([]);
  });

  it('STILL_TO_ADD is the old rank (it is never a new tweak) and the phase-2 choice kinds not built yet', () => {
    // tweaks p2 WP1: the seven choice kinds are registered and stored but have no editor on the screen yet
    // (plan WP1 "Done when"); each WP4-WP17 takes its own off this list when it builds the editor.
    // tweaks p2 WP4: "Take anyway in another picker" (choice.allowAnywayAnyPicker) is built and off the list.
    // tweaks p2 WP5: "Pick from any list" (choice.anyList) is built and off the list; WP6: "Remove a place" too.
    // tweaks p2 WP7: "Add a place" (choice.addPlace, the extra feat place) is built and off the list.
    // tweaks p2 WP8: "Take a feat more times" (choice.moreTakes) is built and off the list.
    // tweaks p2 WP13 (re-scoped 2026-10-25): "Change an answer" (WP10) and "Edit a list" (WP9 steps 1-3) stay on the
    // list: they come after the record rebuild, and until then a stored one reads as made in a newer version.
    expect(STILL_TO_ADD.map((s) => s.id)).toEqual([
      'rank.legacySet',
      'choice.changeAnswer',
      'choice.editOptions',
    ]);
    expect(blockKind('rank.legacySet')!.title).toBe('Old rank, kept as it was');
    // tweaks p2 WP1: a kind not built yet is never on the screen (its menus are no buttons yet)
    for (const s of STILL_TO_ADD.slice(1)) expect(blockKind(s.id)!.editor?.built, s.id).toBe(false);
    // WP13: nothing applies them, and each says why in the rebuild's words.
    for (const s of STILL_TO_ADD.slice(1)) {
      expect(blockKind(s.id)!.applies, s.id).toBe('not-yet');
      expect(s.why, s.id).toMatch(/^Comes after the record rebuild: WP(9 steps 1-3 build|10 builds) "/);
    }
  });

  it("every built kind's menus are buttons in the right place: main at once, advanced only after Advanced opens", async () => {
    const r = mountTweaks(db, FIGHTER());
    const shown = () => menuButtons(r.host).map((b) => (b.textContent ?? '').trim());
    const main = new Set(shown());
    expect(r.host.querySelector('.tw-adv'), 'Advanced starts folded').toBeNull();
    await press(r.host.querySelector('button.tw-adv-toggle'));
    const advanced = new Set([...r.host.querySelectorAll('.tw-adv button.tw-menu')].map((b) => (b.textContent ?? '').trim()));
    for (const k of built)
      for (const m of k.editor!.menus) {
        if (k.editor!.place === 'main') expect(main.has(m), `${k.id}: "${m}" in the main menus`).toBe(true);
        else {
          expect(main.has(m), `${k.id}: "${m}" not before Advanced opens`).toBe(false);
          expect(advanced.has(m), `${k.id}: "${m}" inside Advanced`).toBe(true);
        }
      }
    r.stop();
  });

  it('no menu button that no built kind names', async () => {
    const r = mountTweaks(db, FIGHTER());
    await press(r.host.querySelector('button.tw-adv-toggle'));
    const named = new Set(built.flatMap((k) => k.editor!.menus));
    const shown = menuButtons(r.host).map((b) => (b.textContent ?? '').trim());
    expect(shown.filter((m) => !named.has(m))).toEqual([]);
    expect(new Set(shown)).toEqual(named);
    r.stop();
  });
});

const CASES = built.flatMap((k) => k.editor!.menus.map((menu) => [k.id, menu] as const));

describe('each built kind × menu opens exactly its parts (section 4.6, the shared-menu rule)', () => {
  it.each(CASES)('%s in "%s"', async (id, menuName) => {
    const def = blockKind(id)!;
    // The menu's kinds, in registry order, read off the registry itself.
    const menuKinds = built.filter((k) => k.editor!.menus.includes(menuName)).map((k) => k.id);
    const r = mountTweaks(db, FIGHTER());
    const ed = await openMenu(r.host, menuName);
    const target = FIXTURE_TARGET[id];
    const menuChoosesTarget = menuKinds.some(pointsAtStat);
    if (menuName === LORE_MENU) await enter(ed.querySelector('input[aria-label="Lore subject"]'), LORE_SUBJECT);
    else if (menuChoosesTarget) await pick(ed, 'What', targetName(target, [], { page: true }));
    // The kinds of this menu that hold the fixture target: two or more → the chooser, in registry order.
    const sharing = menuName === LORE_MENU || !menuChoosesTarget ? menuKinds : menuKinds.filter((k) => acceptsTarget(k, target));
    expect(sharing, 'the fixture target is one this kind accepts').toContain(id);
    if (sharing.length > 1) {
      expect(chooserLabels(ed), 'the option chooser names each kind').toEqual(sharing.map((k) => blockKind(k)!.editor!.option));
      const label = def.editor!.option!;
      if (pressedOption(ed) !== label) await press([...ed.querySelectorAll('.tw-chooser button.tw-opt')].find((b) => (b.textContent ?? '').trim() === label));
      expect(pressedOption(ed)).toBe(label);
    } else expect(ed.querySelector('.tw-chooser'), 'one kind: no chooser').toBeNull();
    // tweaks p2 WP4: "Take anyway in another picker" opens on its picker; the answer part appears for a sanctification
    // only. WP13: the skill-increase picker (WP12) comes after the record rebuild, so its place / rule parts are gone.
    // tweaks p2 WP7: an extra feat place has no answer part (its pick is made in its slot). WP11: a new place opens as a
    // Feat place; the answer part appears once its kind is Skill increase or Attribute boost
    // (test/tweaks-p2-skill-boost-places-ui.test.tsx).
    const own =
      id === 'choice.allowAnywayAnyPicker' ? ['picker', 'record', 'reason'] : id === 'choice.addPlace' ? ['place', 'reason'] : def.editor!.parts.filter((p) => p !== 'target');
    expect(partsOf(addEditor(r.host)!), 'the kind\'s parts, target on top').toEqual(menuChoosesTarget ? ['target', ...own] : own);
    const adv = def.editor!.advancedParts ?? [];
    const toggle = addEditor(r.host)!.querySelector<HTMLButtonElement>('button.tw-editor-adv-toggle');
    if (adv.length) {
      expect(advancedPartsOf(addEditor(r.host)!), 'folded until asked').toEqual([]);
      await press(toggle);
      expect(advancedPartsOf(addEditor(r.host)!)).toEqual(adv);
    } else expect(toggle, 'no Advanced fold without advanced parts').toBeNull();
    r.stop();
  });
});

/** Does registry kind `k` accept `target` (the target kinds of its entry; the fixture targets carry no
 *  owner, so the key's head is its target kind)? */
function acceptsTarget(k: string, target: string): boolean {
  const acc = blockKind(k)!.accepts as { aspect?: string; kinds?: readonly string[] };
  return !!acc.kinds?.includes(target.split(':')[0]);
}

describe('a menu two kinds share for one target shows the option chooser with both labels', () => {
  it('Set a number: AC → Set to / At least; Maximum HP → Set to / At least (Set to first); a score → no chooser', async () => {
    const r = mountTweaks(db, FIGHTER());
    let ed = await openMenu(r.host, 'Set a number');
    expect(partsOf(ed), 'the target first, alone').toEqual(['target']);
    await pick(ed, 'What', 'AC');
    expect(chooserLabels(ed)).toEqual(['Set to', 'At least']);
    expect(pressedOption(ed)).toBe('Set to');
    await pick(ed, 'What', 'Maximum HP');
    ed = addEditor(r.host)!;
    expect(chooserLabels(ed)).toEqual(['Set to', 'At least']);
    expect(pressedOption(ed), 'Maximum HP opens on its first kind: number.setMaxHp').toBe('Set to');
    expect(partsOf(ed)).toEqual(['target', 'number', 'level', 'reason']);
    await pick(ed, 'What', 'Dexterity score');
    expect(addEditor(r.host)!.querySelector('.tw-chooser')).toBeNull();
    r.stop();
  });

  it('Rank and Add a Lore offer At least and Exactly, At least first', async () => {
    const r = mountTweaks(db, FIGHTER());
    let ed = await openMenu(r.host, 'Rank (skill, save…)');
    await pick(ed, 'What', 'Stealth');
    expect(chooserLabels(ed)).toEqual(['At least', 'Exactly']);
    expect(pressedOption(ed)).toBe('At least');
    ed = await openMenu(r.host, LORE_MENU);
    expect(chooserLabels(ed)).toEqual(['At least', 'Exactly']);
    expect(pressedOption(ed)).toBe('At least');
    r.stop();
  });
});
