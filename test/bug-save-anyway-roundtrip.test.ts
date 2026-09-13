// @vitest-environment jsdom
// bug 2026-09-12 #3: save-anyway
import { createElement } from 'react';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { applyOverrides, buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { loadRoster, saveRoster, type SavedChar } from '../src/data/storage';
import { rebuildRoster } from '../src/data/rebuild';
import { PROFICIENCY_RANKS } from '../src/rules/types';

/**
 * "when i save a unfinished character it asks me if to save anyway but even if i say yes it doesnt
 *  always save it like i had it, i come back to edit and things are different." — owner, 2026-09-12.
 *
 * MEASURED, on the real Builder and the real persistence chain (see the first describe): the
 * save-anyway path itself is byte-lossless. Pressing "Save anyway" hands App exactly the build the
 * Builder was holding; `saveRoster`/`loadRoster`/`rebuildRoster` carry it through unchanged; and
 * App's edit path reads that stored build back (`active.build ?? deriveBuildFromCharacter`).
 *
 * The losses are in the OTHER half of that `??` — the reverse-derive, which is the load path for
 * every character with no stored build (an import, a GM edit, a party-published sheet, the seed) and
 * the fallback when reconstructing one throws. Two of them were real and are fixed at their cause in
 * src/rules/build.ts; both only bite a PARTIALLY-FILLED build, which is exactly the character the
 * "save anyway" dialog exists for:
 *
 *   1. A whole attribute boost vanished. The boost solver could hand the ancestry's FREE slot an
 *      attribute the ancestry already boosts outright, and `collectBoosts` then drops that pick under
 *      the same-source rule — so the boost was never applied anywhere. A level-7 bard's Charisma went
 *      in at 18 and came back 16.
 *   2. A skill increase was counted twice. A skill first TRAINED by a skill increase was re-attributed
 *      as a class skill AND kept as the increase, so Acrobatics went in trained and came back expert.
 */
const c = () => content();
const noop = () => undefined;

/** A level-7 catfolk bard with holes in it — the shape the "save anyway" dialog is for. */
const partial = (over: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  name: 'Unfinished',
  level: 7,
  ancestryId: 'catfolk',
  heritageId: 'liminal-catfolk',
  backgroundId: 'acolyte',
  classId: 'bard',
  subclassId: 'maestro',
  keyAbility: 'cha',
  ...over,
});

const SHAPES: Record<string, BuildState> = {
  'no ancestry boost answered': partial({ ancestryBoosts: [] }),
  'one skill increase of four': partial({ skillIncreases: { 3: 'acrobatics' } }),
  'one level-1 free boost of four, one of four at 5th': partial({
    levelBoosts: ['cha', null, null, null],
    attributeBoosts: { 5: ['cha', null, null, null] },
  }),
  'one class feat, the rest empty': partial({ featPicks: { '2:class:0': 'bardic-lore' } }),
  'a cantrip and one spell': partial({ cantrips: ['light'], spells: { 1: ['soothe'] } }),
  'an item picked, nothing paid for': partial({ inventory: [{ itemId: 'longsword', quantity: 1, equipped: true }] }),
  'a half-answered everything': partial({
    ancestryBoosts: ['int'],
    backgroundBoosts: [null, 'wis'],
    levelBoosts: ['cha', 'dex', null, null],
    skillIncreases: { 3: 'acrobatics' },
    featPicks: { '2:class:0': 'bardic-lore' },
    cantrips: ['light'],
    inventory: [{ itemId: 'longsword', quantity: 1, equipped: true }],
  }),
};

/** Render the real Builder on `initial`, press "Save changes", and answer the confirmation.
 *  Returns the build App's `onCreate` received, or null when it never fired. */
async function saveThroughTheUi(initial: BuildState, answer: 'Save anyway' | 'Keep editing'): Promise<BuildState | null> {
  let got: BuildState | null = null;
  const r = renderDom(
    createElement(Builder, { content: c(), initial, onCancel: noop, onCreate: (b: BuildState) => void (got = b) }),
  );
  // The dialog is confirmDialog(), which mounts its own root on <body> — so look app-wide, not in host.
  const byText = (t: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === t) ?? null;
  r.click(byText('Save changes'));
  await act(async () => undefined);
  const btn = byText(answer);
  expect(btn, `the save confirmation never offered "${answer}"`).toBeTruthy();
  r.click(btn);
  await act(async () => undefined);
  r.stop();
  return got;
}

/** The exact chain App.tsx runs after onCreate: build the character, persist the roster, relaunch
 *  (loadRoster + the once-per-launch rebuild), then reopen for editing. */
function persistAndReopen(build: BuildState): BuildState {
  const db = c();
  const built = buildCharacter(build, applyOverrides(db, build.overrides));
  expect(saveRoster([{ id: 'c-1', character: built, build }] as SavedChar[]), 'localStorage rejected the write').toBe(true);
  const entry = rebuildRoster(loadRoster(), db)[0];
  // App.tsx onEdit: the stored build, or a reverse-derived one when there is none.
  return entry.build ?? deriveBuildFromCharacter(entry.character, db);
}

describe('"save anyway" saves the unfinished character exactly as it was', () => {
  it.each(Object.keys(SHAPES))('round-trips %s with nothing changed', async (label) => {
    const before = SHAPES[label];
    const saved = await saveThroughTheUi(before, 'Save anyway');
    // The Builder must hand over what it was holding — no defaults filled in, no partial pick dropped.
    expect(saved, 'onCreate never fired after "Save anyway"').toEqual(before);
    // …and the whole persistence chain must hand the same thing back to the next edit.
    expect(persistAndReopen(saved!)).toEqual(before);
  });

  it('"Keep editing" saves nothing at all', async () => {
    expect(await saveThroughTheUi(partial({ ancestryBoosts: [] }), 'Keep editing')).toBeNull();
  });

  it('the confirmation names every unmade choice, not just the origin page', async () => {
    const r = renderDom(
      createElement(Builder, { content: c(), initial: partial({ ancestryBoosts: [] }), onCancel: noop, onCreate: noop }),
    );
    const byText = (t: string) =>
      [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === t) ?? null;
    r.click(byText('Save changes'));
    await act(async () => undefined);
    const dialog = document.querySelector('.confirm-modal');
    expect(dialog, 'no confirmation opened for an unfinished character').toBeTruthy();
    const text = dialog!.textContent ?? '';
    expect(text).toContain('Ancestry boost'); // page 0
    expect(text).toMatch(/feat/i); // the level pages
    // It is the app's dialog, never the browser's — confirmDialog, per the project rule.
    expect(dialog!.getAttribute('role')).toBe('alertdialog');
    r.click(byText('Keep editing'));
    await act(async () => undefined);
    r.stop();
  });
});

describe('the reverse-derive load path keeps a PARTIALLY-filled build intact', () => {
  /*
   * The invariant: for a character with no stored build, rebuilding the derived build must reproduce
   * the character. Mutation proof — drop the `taken` seeding in deriveBuildFromCharacter's boost
   * solver and the first case comes back with Charisma 16 instead of 18.
   */
  it.each(Object.keys(SHAPES))('reproduces the character from %s', (label) => {
    const db = c();
    const built = buildCharacter(SHAPES[label], db);
    const again = buildCharacter(deriveBuildFromCharacter(built, db), db);
    expect(again.abilities).toEqual(built.abilities);
    expect(again.proficiencies.skills).toEqual(built.proficiencies.skills);
    expect(again.feats.map((f) => f.featId).sort()).toEqual(built.feats.map((f) => f.featId).sort());
  });

  it('does not spend the ancestry’s free boost on an attribute the ancestry already boosts', () => {
    // Catfolk boost Charisma outright, and a bard's key attribute is Charisma too, so Charisma is the
    // solver's hungriest attribute — exactly the one it used to drop into the free ancestry slot,
    // where collectBoosts throws it away.
    const db = c();
    const built = buildCharacter(partial({ levelBoosts: ['cha', null, null, null], attributeBoosts: { 5: ['cha', null, null, null] } }), db);
    expect(built.abilities.cha, 'fixture check: the bard starts at 18 Charisma').toBe(18);
    const back = deriveBuildFromCharacter(built, db);
    const anc = db.ancestries.catfolk;
    const fixed = anc.abilityBoosts.filter((x) => x.kind === 'fixed').map((x) => x.ability);
    for (const a of back.ancestryBoosts) expect(fixed, `the free ancestry slot was given ${a}`).not.toContain(a);
    expect(buildCharacter(back, db).abilities.cha).toBe(18);
  });

  it('does not turn a skill increase into a class skill as well', () => {
    // Mutation proof: drop the nativeSteps subtraction from `extras` and Acrobatics comes back expert.
    const db = c();
    const built = buildCharacter(partial({ skillIncreases: { 3: 'acrobatics' } }), db);
    expect(built.proficiencies.skills.acrobatics, 'fixture check').toBe('trained');
    const back = deriveBuildFromCharacter(built, db);
    expect(back.classSkills, 'a skill the increase trained is not a class skill').not.toContain('acrobatics');
    expect(buildCharacter(back, db).proficiencies.skills.acrobatics).toBe('trained');
  });

  it('still recovers a REAL class-skill training that sits under an increase', () => {
    // The subtraction must not swallow a genuine training: trained as a class skill AND increased
    // once is expert — one rank above what the increase alone explains — so it stays a class skill.
    const db = c();
    const built = buildCharacter(partial({ classSkills: ['stealth'], skillIncreases: { 3: 'stealth' } }), db);
    expect(PROFICIENCY_RANKS.indexOf(built.proficiencies.skills.stealth)).toBe(2); // expert
    const back = deriveBuildFromCharacter(built, db);
    expect(back.classSkills).toContain('stealth');
    expect(buildCharacter(back, db).proficiencies.skills.stealth).toBe('expert');
  });
});
