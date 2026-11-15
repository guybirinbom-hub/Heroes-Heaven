// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP6 step 2: "Remove a place" for a printed feat slot (`remove.choicePlace`, place 'feat'; plan
 * work/tweaks-phase2-notes/plan.md WP6, C17, C29, C42, section 2 row 13). Synthetic characters only.
 *
 *   - filled → the pick moves to the "Feat with no slot" row with "X stays as a feat with no slot", and still counts;
 *   - empty → not owed (levelChoices); paused or Tweaks off → the slot is back with its pick, featPicks byte-equal;
 *   - the removal follows its ordinal across every slot toggle (Free Archetype, Ancestry Paragon, Dual Class, Mythic);
 *   - a place no longer drawn → "Not in use" with Remove / Point to another (another drawn slot);
 *   - the card menu's "Remove this place" opens no confirm; Restore brings the slot back; `moveTargetFor` never names
 *     a removed slot; the Tweaks page alone removes a fresh character's 4th-level class slot.
 */
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { addEditor, hero, mountTweaks, openMenu, pick, press, rowBy } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, levelChoices, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { blockKind, placeWords, STILL_TO_ADD } from '../src/rules/blocks/registry';
import { moveTargetFor, printedFeatPlaces, printedSlotKey, rekeyFeatSlots, removedSlotKeys } from '../src/rules/featSlots';
import { writeTweak } from '../src/rules/blocks/write';
import { parseStoredBlocks } from '../src/rules/blocks/stored';
import type { BuildOverrides, Character } from '../src/rules/types';

const db = content();
const noop = () => undefined;
let seq = 0;
const rm = (level: number, category: string, ordinal = 0, on = true) => ({
  id: `t${++seq}_wp6rm${String(seq).padStart(2, '0')}`,
  kind: 'remove.choicePlace',
  v: 1,
  place: 'feat',
  level,
  category,
  ordinal,
  ...(on ? {} : { on: false }),
});
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const built = (b: BuildState): Character => buildCharacter(b, contentFor(db, b));
const featIds = (ch: Character) => (ch.feats ?? []).map((f) => f.featId);
const owes = (b: BuildState, label: string) => levelChoices(b, db).some((c) => c.label.endsWith(`— ${label}`) && c.page === 4);
/** A level-4 fighter, its 4th-level class slot holding Sudden Charge (or empty). */
const F4 = (filled: boolean, ...blocks: object[]) => hero(db, 'fighter', 4, ov(...blocks), filled ? { featPicks: { '4:class:0': 'sudden-charge' } } : {});
const storedRemovals = (b: BuildState) => parseStoredBlocks(b.overrides?.blocks).known.filter((x) => x.kind === 'remove.choicePlace');

describe('remove.choicePlace: the rules', () => {
  it('filled: the slot is removed, the feat still counts, and no slot takes it ("Move to slot" never names a removed slot)', () => {
    const b = F4(true, rm(4, 'class'));
    expect([...removedSlotKeys(b, db)]).toEqual(['4:class:0']);
    expect(featIds(built(b))).toContain('sudden-charge');
    expect(moveTargetFor(b, db, '4:class:0')).toBeNull();
    // a stranded pick of the same kind is never offered the removed slot either
    const stranded = hero(db, 'fighter', 4, ov(rm(4, 'class')), { featPicks: { '4:class:7': 'sudden-charge' } });
    expect(moveTargetFor(stranded, db, '4:class:7')).toBeNull();
    expect(moveTargetFor(hero(db, 'fighter', 4, ov(), { featPicks: { '4:class:7': 'sudden-charge' } }), db, '4:class:7'), 'no removal: offered').toBe('4:class:0');
  });
  it('empty: not owed; paused or Tweaks off: owed again, featPicks byte-equal', () => {
    expect(owes(F4(false), 'class feat'), 'the book owes it').toBe(true);
    expect(owes(F4(false, rm(4, 'class')), 'class feat'), 'removed: not owed').toBe(false);
    for (const b of [F4(false, rm(4, 'class', 0, false)), off(F4(false, rm(4, 'class')))]) {
      expect(removedSlotKeys(b, db).size).toBe(0);
      expect(owes(b, 'class feat')).toBe(true);
    }
    const live = F4(true, rm(4, 'class'));
    const paused = F4(true, rm(4, 'class', 0, false));
    expect(paused.featPicks).toEqual(live.featPicks);
    expect(removedSlotKeys(paused, db).size).toBe(0);
  });
  it('follows its ordinal across every slot toggle', () => {
    // The 1st-level class slot: Ancestry Paragon's second ancestry slot moves it from index 1 to 2.
    const base = hero(db, 'fighter', 4, ov(rm(1, 'class')));
    const variants: [string, Partial<BuildState>][] = [
      ['none', {}],
      ['Free Archetype', { variantRules: { freeArchetype: true } }],
      ['Ancestry Paragon', { variantRules: { ancestryParagon: true } }],
      ['Dual Class', { variantRules: { dualClass: true }, classId2: 'rogue' }],
      ['Mythic', { mythicEnabled: true }],
      ['all four', { variantRules: { freeArchetype: true, ancestryParagon: true, dualClass: true }, classId2: 'rogue', mythicEnabled: true }],
    ];
    const seen = new Set<string>();
    for (const [name, patch] of variants) {
      const b = { ...base, ...patch } as BuildState;
      const want = printedSlotKey(b, db, 1, 'class', 0)!;
      expect([...removedSlotKeys(b, db)], name).toEqual([want]);
      seen.add(want);
    }
    expect(seen.size, 'Paragon moves the class slot: the removal moves with it').toBeGreaterThan(1);
    // the second class slot under Dual Class is its own place
    const dual = { ...hero(db, 'fighter', 4, ov(rm(4, 'class', 1))), variantRules: { dualClass: true }, classId2: 'rogue' } as BuildState;
    expect([...removedSlotKeys(dual, db)]).toEqual([printedSlotKey(dual, db, 4, 'class', 1)]);
    expect(removedSlotKeys({ ...dual, variantRules: {}, classId2: null } as BuildState, db).size, 'Dual Class off: not drawn').toBe(0);
  });
  it('a pick in a removed slot is still under the key the removal names after each toggle (the engine re-keys, the removal follows)', () => {
    // WP6 final check: the test above compares removedSlotKeys with printedSlotKey, which read the same list; this
    // one asks rekeyFeatSlots (the code that MOVES picks) where the pick went, and the removal must name that key.
    const base = hero(db, 'fighter', 4, ov(rm(1, 'class')));
    const at = [...removedSlotKeys(base, db)][0]!;
    const start = { ...base, featPicks: { [at]: 'sudden-charge' } } as BuildState;
    const toggles: Partial<BuildState>[] = [
      { variantRules: { freeArchetype: true } },
      { variantRules: { ancestryParagon: true } },
      { variantRules: { dualClass: true }, classId2: 'rogue' },
      { mythicEnabled: true },
      { variantRules: { freeArchetype: true, ancestryParagon: true, dualClass: true }, classId2: 'rogue', mythicEnabled: true },
    ];
    for (const t of toggles) {
      const on = rekeyFeatSlots(start, { ...start, ...t } as BuildState, db);
      const key = [...removedSlotKeys(on, db)][0]!;
      expect(on.featPicks[key], `${JSON.stringify(t)}: the pick is in the removed slot`).toBe('sudden-charge');
      const back = rekeyFeatSlots(on, { ...on, variantRules: {}, classId2: null, mythicEnabled: false } as BuildState, db);
      expect(back.featPicks[[...removedSlotKeys(back, db)][0]!], `${JSON.stringify(t)} and back`).toBe('sudden-charge');
    }
  });
  it('the write door refuses an edit that makes a removal a copy of another; a pause of an old copy still saves', () => {
    const b = F4(false, rm(4, 'class'), rm(4, 'class', 1));
    const second = storedRemovals(b).find((x) => x.params?.ordinal === 1)!;
    const edit = writeTweak(b, { op: 'update', key: second.key, draft: { fields: { place: 'feat', level: 4, category: 'class', ordinal: 0 } } as never });
    expect(edit.refused).toMatch(/already listed/);
    // the same edit with no other removal of that place saves
    const alone = F4(false, rm(4, 'class', 1));
    const only = storedRemovals(alone)[0]!;
    expect(writeTweak(alone, { op: 'update', key: only.key, draft: { fields: { place: 'feat', level: 4, category: 'class', ordinal: 0 } } as never }).refused).toBeUndefined();
    const dupes = F4(false, rm(4, 'class'), rm(4, 'class'));
    const old = storedRemovals(dupes)[1]!;
    expect(writeTweak(dupes, { op: 'setOn', key: old.key, on: false }).refused).toBeUndefined();
  });
  it('a removal whose place is not drawn names no slot', () => {
    expect(removedSlotKeys(F4(false, rm(4, 'archetype')), db).size).toBe(0);
    expect(printedFeatPlaces(F4(false), db).some((p) => p.key === '4:class:0' && p.level === 4 && p.category === 'class' && p.ordinal === 0)).toBe(true);
  });
  it('placeWords names the slot ("second class feat place at level 4" under Dual Class)', () => {
    expect(placeWords({ place: 'feat', level: 4, category: 'class', ordinal: 0 })).toBe('class feat place at level 4');
    expect(placeWords({ place: 'feat', level: 4, category: 'class', ordinal: 1 })).toBe('second class feat place at level 4');
  });
});

/* ---------------------------------------------------------------- the Builder ---------------------------------- */

const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
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
  await flush();
  for (const n of [...document.body.children]) n.remove();
});
function open(initial: BuildState, page: string) {
  let saved: BuildState | null = null;
  const r = renderDom(createElement(Builder, { content: db, initial, onCancel: noop, onCreate: (b: BuildState) => void (saved = b) }));
  stops.push(r.stop);
  r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === page) ?? null);
  return { r, saved: () => saved };
}
async function save(r: ReturnType<typeof open>['r']) {
  r.click([...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === 'Save changes') ?? null);
  await flush();
  for (let i = 0; i < 4; i++) {
    const anyway = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === 'Save anyway');
    if (!anyway) break;
    r.click(anyway);
    await flush();
  }
}
const classCard = (host: HTMLElement) => host.querySelector<HTMLElement>('button.lvl-card[data-ctl-title="Class feat"]')?.closest<HTMLElement>('.lvl-slot-wrap') ?? null;

describe('remove.choicePlace in the Builder: the card menu, the thin line, Restore', () => {
  it('Tweaks off: no card menu', async () => {
    const { r } = open(off(F4(true)), '4');
    await flush();
    expect(classCard(r.host)!.querySelector('.lvl-menu-btn')).toBeNull();
  });
  it('"Remove this place" (no confirm) → the thin line with Restore; the pick in the no-slot row with its note; saved', async () => {
    const { r, saved } = open(F4(true), '4');
    await flush();
    r.click(classCard(r.host)!.querySelector('button.lvl-menu-btn'));
    await flush();
    const item = [...document.querySelectorAll<HTMLButtonElement>('.lvl-menu button')].find((b) => (b.textContent ?? '').trim() === 'Remove this place')!;
    expect(item).toBeTruthy();
    r.click(item);
    await flush();
    expect(document.querySelector('.confirm-modal'), 'no confirm opens').toBeNull();
    const line = r.host.querySelector<HTMLElement>('[data-removed-place="4:class:0"]')!;
    expect(line.textContent).toContain('Class feat place removed');
    expect(line.querySelector('[data-tweak-mark="remove.choicePlace"]')).toBeTruthy();
    expect(classCard(r.host), 'the slot card is gone').toBeNull();
    expect(r.host.querySelector('[data-noslot="4:class:0"]')?.textContent).toContain('Sudden Charge');
    expect(r.host.querySelector('[data-removed-held="4:class:0"]')?.textContent).toContain('Sudden Charge stays as a feat with no slot');
    expect(r.host.querySelector('[data-noslot="4:class:0"]')?.textContent, 'no slot takes it: no Move').not.toContain('Move to slot');
    await save(r);
    const b = saved()!;
    expect(storedRemovals(b).map((x) => x.params)).toEqual([{ place: 'feat', level: 4, category: 'class', ordinal: 0 }]);
    expect(b.featPicks['4:class:0']).toBe('sudden-charge');
  });
  it('Restore: the slot is back with its pick; the tweak is gone', async () => {
    const { r, saved } = open(F4(true, rm(4, 'class')), '4');
    await flush();
    r.click(r.host.querySelector('[data-removed-place="4:class:0"] button.lvl-restore-btn'));
    await flush();
    expect(r.host.querySelector('[data-removed-place]')).toBeNull();
    expect(classCard(r.host)?.textContent).toContain('Sudden Charge');
    await save(r);
    expect(storedRemovals(saved()!)).toEqual([]);
  });
  it("a removed slot's feat still asks its own questions in the no-slot row (levelChoices still owes them)", async () => {
    // WP6 final check: Assurance in the 4th-level skill slot, its skill not answered, that place removed — the page
    // used to say "1 choice left" with nothing on it to answer.
    const plain = hero(db, 'fighter', 4, ov());
    const sk = printedSlotKey(plain, db, 4, 'skill', 0)!;
    const withPick = { ...plain, featPicks: { [sk]: 'assurance' } } as BuildState;
    const { r } = open(withPick, '4');
    await flush();
    const wrap = r.host.querySelector<HTMLElement>(`[data-noslot], .lvl-slot-wrap:has(button.lvl-card[data-ctl-title="Skill feat"])`);
    const titles = [...(wrap?.querySelectorAll<HTMLElement>('[data-ctl-title]') ?? [])].map((e) => e.dataset.ctlTitle!).filter((t) => t !== 'Skill feat');
    expect(titles.length, 'the slot card asks Assurance its skill').toBeGreaterThan(0);
    for (const n of [...document.body.children]) n.remove();
    const removed = { ...withPick, overrides: ov(rm(4, 'skill')) } as BuildState;
    expect(levelChoices(removed, db).some((c) => c.page === 4 && c.label.includes('Assurance')), 'still owed').toBe(true);
    const { r: r2 } = open(removed, '4');
    await flush();
    expect(r2.host.querySelector(`[data-removed-place="${sk}"]`)).toBeTruthy();
    // Only what the no-slot row draws: the siblings after its row, up to the next no-slot row.
    const after: Element[] = [];
    for (let e = r2.host.querySelector(`[data-noslot="${sk}"]`)?.nextElementSibling ?? null; e && !e.matches('[data-noslot]'); e = e.nextElementSibling) after.push(e);
    for (const t of titles) expect(after.some((e) => e.matches(`[data-ctl-title="${t}"]`) || e.querySelector(`[data-ctl-title="${t}"]`)), `"${t}" asked in the no-slot row`).toBe(true);
  });
  it('a picker open on a slot an Undo removes closes, and a redo does not bring it back', async () => {
    const { r } = open(F4(false, rm(4, 'class')), '4');
    await flush();
    r.click(r.host.querySelector('[data-removed-place="4:class:0"] button.lvl-restore-btn'));
    await flush();
    r.click(classCard(r.host)!.querySelector('button.lvl-card'));
    await flush();
    expect(document.querySelector('.picker-lvl'), 'the class feat picker is open').toBeTruthy();
    const key = (k: string, shift = false) => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true, shiftKey: shift })));
    (document.activeElement as HTMLElement | null)?.blur(); // the picker's search box keeps the browser's own text undo
    await key('z');
    await flush();
    expect(r.host.querySelector('[data-removed-place="4:class:0"]'), 'the undo put the removal back').toBeTruthy();
    expect(document.querySelector('.picker-lvl'), 'no picker for a removed slot').toBeNull();
    await key('y');
    await flush();
    expect(classCard(r.host), 'the redo restored the slot').toBeTruthy();
    expect(document.querySelector('.picker-lvl'), 'the picker stays closed').toBeNull();
  });
  it('an empty slot removed: the line, nothing owed on the page; paused: the card is back', async () => {
    const { r } = open(F4(false, rm(4, 'class')), '4');
    await flush();
    expect(r.host.querySelector('[data-removed-place="4:class:0"]')).toBeTruthy();
    expect(r.host.querySelector('[data-removed-held]')).toBeNull();
    for (const n of [...document.body.children]) n.remove();
    const { r: r2 } = open(F4(false, rm(4, 'class', 0, false)), '4');
    await flush();
    expect(r2.host.querySelector('[data-removed-place]')).toBeNull();
    expect(classCard(r2.host)).toBeTruthy();
  });
});

describe('remove.choicePlace on the Tweaks page', () => {
  it('a fresh character removes its 4th-level class slot from the page alone; the row names what it holds', async () => {
    const t = mountTweaks(db, F4(true));
    stops.push(t.stop);
    await openMenu(t.host, 'Remove a place');
    await pick(addEditor(t.host)!, 'Place', 'Level 4 · Class feat');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    const b = t.build();
    expect(storedRemovals(b).map((x) => x.params)).toEqual([{ place: 'feat', level: 4, category: 'class', ordinal: 0 }]);
    expect([...removedSlotKeys(b, db)]).toEqual(['4:class:0']);
    expect(rowBy(t.host, 'Removed: class feat place at level 4 — holds Sudden Charge')).toBeTruthy();
  });
  it("the row's own switch pauses the removal: the slot is owed again and featPicks is byte-equal", async () => {
    const t = mountTweaks(db, F4(true, rm(4, 'class')));
    stops.push(t.stop);
    const before = JSON.stringify(t.build().featPicks);
    await press(rowBy(t.host, /^Removed: class feat place at level 4/)!.querySelector('.tw-toggle'));
    const b = t.build();
    expect(storedRemovals(b)[0]?.meta?.on ?? (storedRemovals(b)[0] as unknown as { on?: boolean }).on, 'stored paused').toBe(false);
    expect(removedSlotKeys(b, db).size).toBe(0);
    expect(JSON.stringify(b.featPicks), 'the pause touched no pick').toBe(before);
  });
  it('a place no longer drawn → "Not in use", with Point to another (a drawn slot) and Remove', async () => {
    const t = mountTweaks(db, F4(false, rm(4, 'archetype')));
    stops.push(t.stop);
    const row = rowBy(t.host, /^Removed: archetype feat place at level 4/)!;
    expect(row.querySelector('.tw-chip-notInUse')?.textContent).toBe('Not in use: this place no longer exists at level 4');
    await press(row.querySelector('button.tw-row-head'));
    await pick(row, 'Point to another', 'Level 4 · Class feat');
    const b = t.build();
    expect(storedRemovals(b).map((x) => x.params)).toEqual([{ place: 'feat', level: 4, category: 'class', ordinal: 0 }]);
    expect([...removedSlotKeys(b, db)]).toEqual(['4:class:0']);
  });
  it('the registry calls it built and applied; no STILL_TO_ADD line', () => {
    expect(blockKind('remove.choicePlace')?.editor?.built).toBe(true);
    expect(blockKind('remove.choicePlace')?.applies).toBe('blocks');
    expect(STILL_TO_ADD.some((s) => s.id === 'remove.choicePlace')).toBe(false);
  });
});
