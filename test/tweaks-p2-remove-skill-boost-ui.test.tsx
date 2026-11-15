// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP14 — the screens for removing a skill-increase or attribute-boost place (`remove.choicePlace`,
 * place 'skillIncrease' / 'boost'; plan work/tweaks-phase2-notes/plan.md WP14, C33, C47). Synthetic characters only.
 * The engine is test/tweaks-p2-remove-skill-boost.test.ts.
 *
 *   - From the Tweaks page alone: Remove a place → Level 5 · Skill increase: one block, and it applies.
 *   - The level page: "Remove this place" in the increase card's menu (Tweaks on only, no confirm) → the kept row
 *     "Stealth — kept, doesn't count (place removed)" with Restore; Ctrl+Z undoes it; an empty one is the thin line,
 *     owed no more; the store is untouched when saved.
 *   - The level-10 boost set: one menu entry per place; removing Dex draws its kept row and three selects.
 *   - Setup: the ancestry and free sets have the menu; the key attribute has none; a dwarf's fixed boosts give no
 *     entry.
 *   - "Turn off Tweaks?" names each removed place in "comes back and counts again".
 */
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { addEditor, hero, mountTweaks, openMenu, pick, press, rowBy } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import { choicePlaceOptions, tweaksTurnOffList } from '../src/builder/tweaks/model';
import { buildCharacter, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { parseStoredBlocks } from '../src/rules/blocks/stored';
import type { BuildOverrides, Character } from '../src/rules/types';

const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
if (!g.CSS?.escape) g.CSS = { ...(g.CSS ?? {}), escape: (s: string) => s.replace(/["\\\]\[]/g, '\\$&') };

const db = content();
const noop = () => undefined;
let seq = 0;
const rm = (fields: Record<string, unknown>) => ({ id: `t${++seq}_ui14${String(seq).padStart(2, '0')}`, kind: 'remove.choicePlace', v: 1, ...fields });
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const built = (b: BuildState): Character => buildCharacter(b, contentFor(db, b));
const F = (level: number, blocks: object[] = [], more: Partial<BuildState> = {}) =>
  hero(db, 'fighter', level, ov(...blocks), { ancestryBoosts: ['int', 'cha'], backgroundBoosts: ['wis', 'con'], levelBoosts: ['str', 'dex', 'con', 'wis'], ...more });
const removals = (b: BuildState | null) => parseStoredBlocks(b?.overrides?.blocks).known.filter((x) => x.kind === 'remove.choicePlace');

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
  for (const n of [...document.body.children]) n.remove();
  await flush();
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
const menuItems = () => [...document.querySelectorAll<HTMLButtonElement>('.lvl-menu button.lvl-menu-item')].map((b) => (b.textContent ?? '').trim());
async function choose(r: ReturnType<typeof open>['r'], scope: Element, label: string) {
  r.click(scope.querySelector('button.lvl-menu-btn'));
  await flush();
  const item = [...document.querySelectorAll<HTMLButtonElement>('.lvl-menu button.lvl-menu-item')].find((b) => (b.textContent ?? '').trim() === label);
  expect(item, `no "${label}" in the menu (${menuItems().join(' | ')})`).toBeTruthy();
  r.click(item!);
  await flush();
}
const pendingOf = (host: ParentNode) => Number(/(\d+)/.exec(host.querySelector('.lvl-pending-tag')?.textContent ?? '0')?.[1] ?? 0);
const ctrl = (k: string) => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true })));

describe('the Tweaks page alone: Remove a place → Level 5 · Skill increase', () => {
  it('one block, its row, and it applies', async () => {
    const t = mountTweaks(db, F(5, [], { skillIncreases: { 5: 'stealth' } }));
    stops.push(t.stop);
    await openMenu(t.host, 'Remove a place');
    await pick(addEditor(t.host)!, 'Place', 'Level 5 · Skill increase');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    const b = t.build();
    expect(removals(b).map((x) => x.params)).toEqual([{ place: 'skillIncrease', level: 5, lane: 'main' }]);
    expect(rowBy(t.host, 'Removed: skill increase at level 5 — holds Stealth'), 'its row').toBeTruthy();
    expect(built(b).proficiencies.skills.stealth, 'it applies').toBe('untrained');
    expect(b.skillIncreases[5], 'the store is untouched').toBe('stealth');
  });

  it('a boost place: Level 10 · Attribute boost (third)', async () => {
    const t = mountTweaks(db, F(10, [], { attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'con', 'dex', 'wis'] } }));
    stops.push(t.stop);
    await openMenu(t.host, 'Remove a place');
    await pick(addEditor(t.host)!, 'Place', 'Level 10 · Attribute boost (third)');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    expect(removals(t.build()).map((x) => x.params)).toEqual([{ place: 'boost', set: 'level', level: 10, index: 2 }]);
    expect(built(t.build()).abilities.dex).toBe(built(F(10, [], { attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'con', null, 'wis'] } })).abilities.dex);
  });
});

describe('the level page: the skill increase card', () => {
  const card = (host: ParentNode) => host.querySelector<HTMLElement>('[data-increase-place="main:5"]');

  it('Tweaks off: no card menu', async () => {
    const { r } = open(off(F(5, [], { skillIncreases: { 5: 'stealth' } })), '5');
    await flush();
    expect(card(r.host), 'the card').toBeTruthy();
    expect(card(r.host)!.querySelector('.lvl-menu-btn')).toBeNull();
  });

  it('"Remove this place" (no confirm) → the kept row; Ctrl+Z undoes; Restore brings it back; saved, the store untouched', async () => {
    const { r, saved } = open(F(5, [], { skillIncreases: { 5: 'stealth' } }), '5');
    await flush();
    await choose(r, card(r.host)!, 'Remove this place');
    expect(document.querySelector('.confirm-modal'), 'no confirm opens').toBeNull();
    const kept = r.host.querySelector<HTMLElement>('[data-removed-place="skillIncrease:main:5"]')!;
    expect(kept, 'the kept row').toBeTruthy();
    expect(kept.querySelector('.tw-kept-row')?.textContent).toContain("Stealth — kept, doesn't count (place removed)");
    expect(card(r.host), 'no picker for a removed place').toBeNull();
    // Ctrl+Z undoes the removal …
    (document.activeElement as HTMLElement | null)?.blur();
    await ctrl('z');
    await flush();
    expect(card(r.host), 'undo: the card is back').toBeTruthy();
    await ctrl('y');
    await flush();
    expect(r.host.querySelector('[data-removed-place="skillIncrease:main:5"]'), 'redo: removed again').toBeTruthy();
    await save(r);
    const b = saved()!;
    expect(removals(b).map((x) => x.params)).toEqual([{ place: 'skillIncrease', level: 5, lane: 'main' }]);
    expect(b.skillIncreases[5]).toBe('stealth');
  });

  it('Restore deletes the removal: the card is back with Stealth', async () => {
    const { r, saved } = open(F(5, [rm({ place: 'skillIncrease', level: 5, lane: 'main' })], { skillIncreases: { 5: 'stealth' } }), '5');
    await flush();
    const btn = [...r.host.querySelectorAll<HTMLButtonElement>('[data-removed-place="skillIncrease:main:5"] button')].find((b) => (b.textContent ?? '').trim() === 'Restore');
    expect(btn).toBeTruthy();
    r.click(btn!);
    await flush();
    expect(card(r.host)?.textContent).toContain('Stealth');
    await save(r);
    expect(removals(saved())).toEqual([]);
  });

  it('an empty place removed: the thin line, owed no more; paused: the card is back and owed', async () => {
    const plain = F(5);
    const { r } = open(plain, '5');
    await flush();
    const owedBefore = pendingOf(r.host);
    await choose(r, card(r.host)!, 'Remove this place');
    const line = r.host.querySelector<HTMLElement>('[data-removed-place="skillIncrease:main:5"]')!;
    expect(line.textContent).toContain('Skill increase at level 5 removed');
    expect(line.querySelector('button.lvl-restore-btn')).toBeTruthy();
    expect(pendingOf(r.host), 'the empty place is owed no more').toBe(owedBefore - 1);
    for (const n of [...document.body.children]) n.remove();
    const paused = F(5, [{ ...rm({ place: 'skillIncrease', level: 5, lane: 'main' }), on: false }]);
    const { r: r2 } = open(paused, '5');
    await flush();
    expect(r2.host.querySelector('[data-removed-place]')).toBeNull();
    expect(card(r2.host)).toBeTruthy();
  });
});

describe('the level page: the 10th-level boost set', () => {
  const sets = { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'con', 'dex', 'wis'] } as BuildState['attributeBoosts'];
  const setCard = (host: ParentNode) => host.querySelector<HTMLElement>('[data-boost-set="level:10"]');

  it('one entry per place; removing Dex draws its kept row and three selects', async () => {
    const { r, saved } = open(F(10, [], { attributeBoosts: sets }), '10');
    await flush();
    r.click(setCard(r.host)!.querySelector('button.lvl-menu-btn'));
    await flush();
    expect(menuItems()).toEqual(['Remove boost place 1 (Strength)', 'Remove boost place 2 (Constitution)', 'Remove boost place 3 (Dexterity)', 'Remove boost place 4 (Wisdom)']);
    r.click(setCard(r.host)!.querySelector('button.lvl-menu-btn'));
    await flush();
    await choose(r, setCard(r.host)!, 'Remove boost place 3 (Dexterity)');
    const kept = r.host.querySelector<HTMLElement>('[data-removed-place="boost:level:10:2"]')!;
    expect(kept.querySelector('.tw-kept-row')?.textContent).toContain("Dexterity — kept, doesn't count (place removed)");
    expect(setCard(r.host)!.querySelectorAll('[data-ctl-title="Attribute boost"]').length, 'three selects').toBe(3);
    // A removed place is not offered again (its Restore brings it back).
    r.click(setCard(r.host)!.querySelector('button.lvl-menu-btn'));
    await flush();
    expect(menuItems()).toEqual(['Remove boost place 1 (Strength)', 'Remove boost place 2 (Constitution)', 'Remove boost place 4 (Wisdom)']);
    r.click(setCard(r.host)!.querySelector('button.lvl-menu-btn'));
    await flush();
    await save(r);
    expect(removals(saved()).map((x) => x.params)).toEqual([{ place: 'boost', set: 'level', level: 10, index: 2 }]);
    expect(saved()!.attributeBoosts[10]).toEqual(['str', 'con', 'dex', 'wis']);
  });
});

describe('Setup: the boost sets', () => {
  // The origin page (Identity, Attributes, Skills) is the strip's "0" chip; its "Setup" chip is Sources and Options.
  const ORIGIN = '0';
  const sub = (host: ParentNode, set: string) => host.querySelector<HTMLElement>(`[data-boost-set="${set}"]`);

  it('the ancestry, background and free sets have the menu; the key attribute has none', async () => {
    const { r } = open(F(1), ORIGIN);
    await flush();
    for (const [set, n] of [['ancestry', 2], ['background', 2], ['free', 4]] as const) {
      const el = sub(r.host, set);
      expect(el, `the ${set} set`).toBeTruthy();
      r.click(el!.querySelector('button.lvl-menu-btn'));
      await flush();
      expect(menuItems().length, `${set}: one entry per place`).toBe(n);
      r.click(el!.querySelector('button.lvl-menu-btn'));
      await flush();
    }
    const keyCard = r.host.querySelector('[data-subcard="Key attribute"], [data-subcard^="Key attribute"]');
    if (keyCard) expect(keyCard.querySelector('.lvl-menu-btn'), 'no menu on the key attribute').toBeNull();
    expect(r.host.querySelectorAll('.lvl-menu-btn').length, 'the three sets only').toBe(3);
  });

  it('a dwarf: one ancestry entry (its two fixed boosts are no places)', async () => {
    const { r } = open(F(1, [], { ancestryId: 'dwarf', heritageId: null, ancestryBoosts: ['dex'] }), ORIGIN);
    await flush();
    r.click(sub(r.host, 'ancestry')!.querySelector('button.lvl-menu-btn'));
    await flush();
    expect(menuItems()).toEqual(['Remove boost place 1 (Dexterity)']);
  });

  it('"Go to" on a removed free boost lands on the page that draws the set (page 0, not the Setup chip)', async () => {
    const { r } = open(F(1, [rm({ place: 'boost', set: 'free', index: 1 })]), '1');
    await flush();
    await press(r.host.querySelector('.builder-head button.b-tweaks'));
    const row = r.host.querySelector<HTMLElement>('li.tw-row[data-kind="remove.choicePlace"]')!;
    expect(row, 'its row').toBeTruthy();
    await press(row.querySelector('button.tw-row-head'));
    await press(row.querySelector('button.tw-goto-place'));
    await flush();
    expect(r.host.querySelector('.lvl-page .bsec-title')?.textContent).toBe('Level 0');
    expect(r.host.querySelector('[data-removed-place="boost:free:0:1"]'), 'the kept row is on the page').toBeTruthy();
  });

  it('a removed free boost holding Dex: its kept row, three selects left; Restore brings it back', async () => {
    const { r, saved } = open(F(1, [rm({ place: 'boost', set: 'free', index: 1 })]), ORIGIN);
    await flush();
    const kept = r.host.querySelector<HTMLElement>('[data-removed-place="boost:free:0:1"]')!;
    expect(kept.querySelector('.tw-kept-row')?.textContent).toContain("Dexterity — kept, doesn't count (place removed)");
    r.click([...kept.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').trim() === 'Restore')!);
    await flush();
    expect(r.host.querySelector('[data-removed-place]')).toBeNull();
    await save(r);
    expect(removals(saved())).toEqual([]);
    expect(saved()!.levelBoosts).toEqual(['str', 'dex', 'con', 'wis']);
  });
});

describe('fix round 1', () => {
  const sets = { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'con', 'dex', 'wis'] } as BuildState['attributeBoosts'];
  const boosts = { ancestryBoosts: ['int', 'cha'], backgroundBoosts: ['wis', 'con'], levelBoosts: ['str', 'dex', 'con', 'wis'] } as Partial<BuildState>;

  it('a swashbuckler\'s removed bonus increase at 3: the kept row, and no bonus card', async () => {
    const b = hero(db, 'swashbuckler', 3, ov(rm({ place: 'skillIncrease', level: 3, lane: 'bonus' })), { ...boosts, bonusSkillIncreases: { 3: 'acrobatics' } });
    const { r } = open(b, '3');
    await flush();
    const kept = r.host.querySelector<HTMLElement>('[data-removed-place="skillIncrease:bonus:3"]');
    expect(kept, 'the kept row').toBeTruthy();
    expect(kept!.querySelector('.tw-kept-row')?.textContent).toContain("Acrobatics — kept, doesn't count (place removed)");
    expect(r.host.querySelector('[data-increase-place="bonus:3"]'), 'no bonus card').toBeNull();
    expect(r.host.querySelector('[data-increase-place="main:3"]'), 'the main card stays').toBeTruthy();
  });

  it('a Reborn Soul\'s removed background increase at 3: the kept row, and no background card', async () => {
    const rs = { backgroundId: 'reborn-soul', backgroundLore: 'Warfare', backgroundLore2: 'Sailing', backgroundBoosts: ['con', 'wis'] } as Partial<BuildState>;
    const b = F(3, [rm({ place: 'skillIncrease', level: 3, lane: 'background' })], { ...rs, backgroundSkillIncreases: { 3: 'lore:warfare' } });
    const { r } = open(b, '3');
    await flush();
    const kept = r.host.querySelector<HTMLElement>('[data-removed-place="skillIncrease:background:3"]');
    expect(kept, 'the kept row').toBeTruthy();
    expect(kept!.querySelector('.tw-kept-row')?.textContent).toMatch(/Warfare.*— kept, doesn't count \(place removed\)/);
    expect(r.host.querySelector('[data-increase-place="background:3"]'), 'no background card').toBeNull();
  });

  it('Tweaks off: no boost set has a menu, on page 0 or page 10', async () => {
    for (const page of ['0', '10']) {
      const { r } = open(off(F(10, [], { attributeBoosts: sets })), page);
      await flush();
      const setsHere = [...r.host.querySelectorAll('[data-boost-set]')];
      expect(setsHere.length, `page ${page}: its boost sets`).toBeGreaterThan(0);
      expect(setsHere.flatMap((s) => [...s.querySelectorAll('.lvl-menu-btn')]).length, `page ${page}: no menu`).toBe(0);
      for (const n of [...document.body.children]) n.remove();
    }
  });

  it('a gone level-10 boost removal (gradual boosts) pointed to "Level 1 · Free boost (first)" stores no level', async () => {
    const b = F(10, [rm({ place: 'boost', set: 'level', level: 10, index: 2 })], { variantRules: { gradualBoosts: true } as BuildState['variantRules'], attributeBoosts: {} });
    const t = mountTweaks(db, b);
    stops.push(t.stop);
    const row = t.host.querySelector<HTMLElement>('li.tw-row[data-kind="remove.choicePlace"]')!;
    expect(row.querySelector('.tw-chip-notInUse'), 'Not in use').toBeTruthy();
    await press(row.querySelector('button.tw-row-head'));
    await pick(row, 'Point to another', 'Level 1 · Free boost (first)');
    const params = removals(t.build())[0]!.params!;
    expect(JSON.parse(JSON.stringify(params))).toEqual({ place: 'boost', set: 'free', index: 0 });
    expect('level' in params, 'no level key at all').toBe(false);
  });

  it('"Remove a place" no longer offers a place a live removal names; a paused one is greyed; a row re-pointing keeps its own', () => {
    const live = rm({ place: 'skillIncrease', level: 3, lane: 'main' });
    const dex = rm({ place: 'boost', set: 'level', level: 10, index: 2 });
    const paused = { ...rm({ place: 'skillIncrease', level: 5, lane: 'main' }), on: false };
    const b = F(10, [live, dex, paused], { attributeBoosts: sets });
    const opts = choicePlaceOptions(b, contentFor(db, b));
    const labels = opts.map((o) => o.label);
    expect(labels).not.toContain('Level 3 · Skill increase');
    expect(labels).not.toContain('Level 10 · Attribute boost (third)');
    expect(opts.find((o) => o.label === 'Level 5 · Skill increase')?.disabled, 'paused: greyed').toBe('Already removed');
    expect(labels, 'others still offered').toContain('Level 7 · Skill increase');
    const own = choicePlaceOptions(b, contentFor(db, b), `blocks:${dex.id}`, 'boost');
    const mine = own.find((o) => o.label === 'Level 10 · Attribute boost (third)');
    expect(mine, "the row's own place").toBeTruthy();
    expect(mine!.disabled).toBeUndefined();
  });

  it('fix round 2: a live feat removal takes its place out of the picker (its own row keeps it); a removed sibling keeps "(second)"', () => {
    const first = rm({ place: 'feat', level: 2, category: 'class', ordinal: 0 });
    const b = F(2, [first], { variantRules: { dualClass: true } as BuildState['variantRules'], classId2: 'wizard' });
    const cd = contentFor(db, b);
    const labels = choicePlaceOptions(b, cd).map((o) => o.label);
    expect(labels, 'the removed place is gone').not.toContain('Level 2 · Class feat (first)');
    expect(labels, 'its sibling keeps its ordinal').toContain('Level 2 · Class feat (second)');
    expect(labels).not.toContain('Level 2 · Class feat');
    const own = choicePlaceOptions(b, cd, `blocks:${first.id}`, 'feat');
    const mine = own.find((o) => o.label === 'Level 2 · Class feat (first)');
    expect(mine, "the row's own place, under Point to another").toBeTruthy();
    expect(mine!.disabled).toBeUndefined();
    expect(own.map((o) => o.label)).toContain('Level 2 · Class feat (second)');
  });

  it('the counts say the places still counting; the kept rows are the card\'s own full-width line', async () => {
    const { r } = open(F(10, [rm({ place: 'boost', set: 'free', index: 1 })], { attributeBoosts: sets }), '0');
    await flush();
    const free = r.host.querySelector<HTMLElement>('[data-boost-set="free"]')!;
    expect(free.querySelector('.ol-count')?.textContent?.trim()).toBe('3');
    expect(free.querySelector(':scope > .lvl-removed-rows [data-removed-place="boost:free:0:1"]'), 'a direct row of the card, not inside its text column').toBeTruthy();
    expect(free.querySelector('.lvl-card-text .lvl-removed-rows')).toBeNull();
    for (const n of [...document.body.children]) n.remove();
    const { r: r2 } = open(F(10, [rm({ place: 'boost', set: 'level', level: 10, index: 2 })], { attributeBoosts: sets }), '10');
    await flush();
    expect(r2.host.querySelector('[data-boost-set="level:10"] .lvl-card-label')?.textContent).toBe('Attribute boosts — choose 3 different');
  });
});

describe('"Turn off Tweaks?" (C33)', () => {
  it('"comes back and counts again" names each removed place with what it holds', () => {
    const b = F(10, [rm({ place: 'skillIncrease', level: 5, lane: 'main' }), rm({ place: 'boost', set: 'level', level: 10, index: 2 }), rm({ place: 'boost', set: 'free', index: 0 })], {
      skillIncreases: { 5: 'stealth' },
      attributeBoosts: { 5: ['str', 'dex', 'con', 'wis'], 10: ['str', 'con', 'dex', 'wis'] },
    });
    expect(tweaksTurnOffList(b, db, built(b)).choices.returns).toEqual(['Skill increase at level 5: Stealth', 'Attribute boost at level 10 (third): Dexterity', 'Free boost at level 1 (first): Strength']);
  });
});
