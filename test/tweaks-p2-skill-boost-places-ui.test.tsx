// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP11 — the screens for an extra skill increase and an extra attribute boost place
 * (`choice.addPlace`, place 'skillIncrease' / 'boost'; plan work/tweaks-phase2-notes/plan.md WP11, C15, C16, C36, C42;
 * finding 16). Synthetic characters only. The engine is test/tweaks-p2-skill-boost-places.test.ts.
 *
 *   - From the Tweaks page alone: Add a place → Skill increase → level 5 → Stealth: one block, its row, and it applies.
 *   - A carrier on a Lore the character does not know (lore:sailing) is Broken: Remove (asks nothing) and Point to
 *     another, whose pick rewrites only `skill`.
 *   - The level page: "Add a place" offers Skill increase and Attribute boost; the empty card is owed; picking writes
 *     only the block's answer; the live, paused and Tweaks-off cards; opening and saving writes nothing (C36).
 */
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { addEditor, enter, hero, mountTweaks, openMenu, partsOf, pick, press, rowBy } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, levelChoices, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { parseStoredBlocks } from '../src/rules/blocks/stored';
import type { BuildOverrides, Character } from '../src/rules/types';

const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
if (!g.CSS?.escape) g.CSS = { ...(g.CSS ?? {}), escape: (s: string) => s.replace(/["\\\]\[]/g, '\\$&') };
const esc = (s: string) => s.replace(/["\\]/g, '\\$&');

const db = content();
const noop = () => undefined;
let seq = 0;
const carrier = (place: 'skillIncrease' | 'boost', level: number, answer?: string, extra: Record<string, unknown> = {}) => ({
  id: `t${++seq}_ui${String(seq).padStart(2, '0')}`,
  kind: 'choice.addPlace',
  v: 1,
  place,
  level,
  ...(answer ? { [place === 'boost' ? 'attribute' : 'skill']: answer } : {}),
  ...extra,
});
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const built = (b: BuildState): Character => buildCharacter(b, contentFor(db, b));
const F5 = (blocks: object[] = [], more: Partial<BuildState> = {}) => hero(db, 'fighter', 5, ov(...blocks), { levelBoosts: ['str', 'dex', 'con', 'wis'], ...more });
const addPlaces = (b: BuildState) => parseStoredBlocks(b.overrides?.blocks).known.filter((x) => x.kind === 'choice.addPlace');
const rawBlocks = (b: BuildState | null) => (b?.overrides?.blocks ?? []) as Record<string, unknown>[];

const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
let stops: (() => void)[] = [];
const clear = () => {
  for (const s of stops) {
    try {
      s();
    } catch {
      /* gone */
    }
  }
  stops = [];
  for (const n of [...document.body.children]) n.remove();
};
afterEach(async () => {
  clear();
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
/** Open the picker titled `title` inside `root` and choose the first option whose name starts with `name`. */
async function pickStarting(root: ParentNode, title: string, name: string) {
  const ctl = root.querySelector(`[data-ctl-title="${esc(title)}"]`);
  expect(ctl, `no "${title}" picker`).toBeTruthy();
  await press(ctl!.querySelector('.ss-replace') ?? ctl!);
  const overlays = [...document.querySelectorAll('.picker-overlay')];
  const o = overlays[overlays.length - 1];
  const starts = (x: Element) => (x.querySelector('.picker-name')?.textContent ?? '').trim().startsWith(name);
  const item = [...(o?.querySelectorAll('.pick-row, .picker-item') ?? [])].find(starts);
  expect(item, `no "${name}…" in the ${title} picker`).toBeTruthy();
  const select = [...item!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Select');
  await press(select ?? item);
}
const placeCard = (host: ParentNode, key: string) => host.querySelector<HTMLElement>(`.tw-place-card[data-place-key="${esc(key)}"]`);
const ctrl = (k: string) => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true })));
const pendingOf = (host: ParentNode) => Number(/(\d+)/.exec(host.querySelector('.lvl-pending-tag')?.textContent ?? '0')?.[1] ?? 0);

describe('the Tweaks page alone: Add a place → Skill increase at 5 → Stealth', () => {
  it('one block, its row, and it applies', async () => {
    const t = mountTweaks(db, F5());
    stops.push(t.stop);
    const ed = await openMenu(t.host, 'Add a place');
    expect(partsOf(ed), 'a feat place first (the default kind): no answer part').toEqual(['place', 'reason']);
    await pick(ed, 'Kind of place', 'Skill increase');
    expect(partsOf(addEditor(t.host)!), 'a skill increase carries its skill').toEqual(['place', 'answer', 'reason']);
    await enter(addEditor(t.host)!.querySelector<HTMLInputElement>('input[aria-label="At level"]'), '5');
    await pick(addEditor(t.host)!, 'Skill', 'Stealth');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    const b = t.build();
    expect(addPlaces(b).map((x) => x.params)).toEqual([{ place: 'skillIncrease', level: 5, skill: 'stealth' }]);
    expect(rowBy(t.host, 'Extra skill increase at level 5 — Stealth'), 'its row').toBeTruthy();
    expect(built(b).proficiencies.skills.stealth, 'it applies').toBe('trained');
  });

  it('Attribute boost at 5 → Dexterity: +2 Dex', async () => {
    const t = mountTweaks(db, F5());
    stops.push(t.stop);
    const ed = await openMenu(t.host, 'Add a place');
    await pick(ed, 'Kind of place', 'Attribute boost');
    await enter(addEditor(t.host)!.querySelector<HTMLInputElement>('input[aria-label="At level"]'), '5');
    await pick(addEditor(t.host)!, 'Attribute', 'Dexterity');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    const b = t.build();
    expect(addPlaces(b).map((x) => x.params)).toEqual([{ place: 'boost', level: 5, attribute: 'dex' }]);
    expect(built(b).abilities.dex).toBe(built(F5()).abilities.dex + 2);
  });
});

describe('a Broken extra increase on a Lore not known (lore:sailing)', () => {
  it('offers Remove and Point to another; picking Stealth rewrites only `skill`', async () => {
    const block = carrier('skillIncrease', 5, 'lore:sailing', { reason: 'Shipwreck' });
    const before = F5([block]);
    const t = mountTweaks(db, before);
    stops.push(t.stop);
    const row = rowBy(t.host, /^Extra skill increase at level 5/)!;
    expect(row, 'the row').toBeTruthy();
    expect(row.classList.contains('broken')).toBe(true);
    await press(row.querySelector('button.tw-row-head'));
    expect(row.querySelector('.tw-problem')?.textContent).toMatch(/is not a Lore you know at level 5/);
    expect(row.querySelector('button.tw-del')?.textContent?.trim()).toBe('Remove');
    const rp = row.querySelector('.tw-repoint')!;
    expect(rp, 'Point to another').toBeTruthy();
    await pick(rp, 'Point to another', 'Stealth');
    const after = rawBlocks(t.build());
    expect(after).toEqual([{ ...block, skill: 'stealth' }]);
    expect(built(t.build()).proficiencies.skills.stealth).toBe('trained');
  });

  it('Remove takes the block and asks nothing', async () => {
    const t = mountTweaks(db, F5([carrier('skillIncrease', 5, 'lore:sailing')]));
    stops.push(t.stop);
    const row = rowBy(t.host, /^Extra skill increase at level 5/)!;
    await press(row.querySelector('button.tw-row-head'));
    await press(row.querySelector('button.tw-del'));
    expect(document.querySelector('.confirm-modal'), 'asks nothing').toBeNull();
    expect(rawBlocks(t.build())).toEqual([]);
  });

  it('a boost carrier outside the six (luck) is read-only: no switch, no Point to another', async () => {
    const t = mountTweaks(db, F5([carrier('boost', 5, 'luck')]));
    stops.push(t.stop);
    const row = [...t.host.querySelectorAll<HTMLElement>('li.tw-row')][0];
    expect(row, 'it is listed').toBeTruthy();
    expect(row.querySelector('button.tw-toggle'), 'no switch').toBeNull();
    await press(row.querySelector('button.tw-row-head'));
    expect(row.querySelector('.tw-repoint')).toBeNull();
  });
});

describe('the level page cards (C15, C16, C36, C42)', () => {
  it('"Add a place" → Skill increase: the empty card is owed; picking Stealth writes only the skill', async () => {
    const { r, saved } = open(F5(), '5');
    await flush();
    const pending = pendingOf(r.host);
    r.click(r.host.querySelector('button.lvl-add-place-btn'));
    await flush();
    const add = r.host.querySelector('[data-add-place="5"]')!;
    expect([...add.querySelectorAll('[data-carrier]')].map((b) => b.textContent?.trim())).toEqual(['Skill increase', 'Attribute boost']);
    expect([...add.querySelectorAll('.lvl-add-place-kind')].map((h) => h.textContent?.trim()), 'two headings, side by side').toEqual(['Feat place', 'Skill increase or attribute boost']);
    r.click(add.querySelector('[data-carrier="skillIncrease"]'));
    await flush();
    expect(document.querySelector('.confirm-modal'), 'asks nothing').toBeNull();
    const cardEl = r.host.querySelector<HTMLElement>('[data-carrier-card="skillIncrease"]')!;
    expect(cardEl, 'the card').toBeTruthy();
    expect(cardEl.querySelector('.lvl-card-label')?.textContent).toBe('Extra skill increase (tweak)');
    expect(pendingOf(r.host), 'the empty place is owed').toBe(pending + 1);
    await pickStarting(cardEl, 'Extra skill increase (tweak)', 'Stealth');
    await flush();
    expect(pendingOf(r.host), 'answered: owed no more').toBe(pending);
    expect(r.host.querySelector('[data-carrier-card="skillIncrease"] .lvl-result')?.textContent).toBe('→ trained');
    await save(r);
    const blocks = rawBlocks(saved());
    expect(blocks.map(({ id: _i, ...rest }) => rest)).toEqual([{ kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 5, skill: 'stealth' }]);
  });

  it('the boost card: Dexterity shows +2; Remove this place takes the block only', async () => {
    const b0 = F5([carrier('boost', 5)]);
    const { r, saved } = open(b0, '5');
    await flush();
    const cardEl = r.host.querySelector<HTMLElement>('[data-carrier-card="boost"]')!;
    expect(cardEl.querySelector('.lvl-card-label')?.textContent).toBe('Extra attribute boost (tweak)');
    await pickStarting(cardEl, 'Extra attribute boost (tweak)', 'Dexterity');
    await flush();
    expect(r.host.querySelector('[data-carrier-card="boost"] .lvl-result')?.textContent).toBe('+2');
    r.click(r.host.querySelector('[data-carrier-card="boost"] button[data-remove-carrier]'));
    await flush();
    expect(document.querySelector('.confirm-modal'), 'asks nothing').toBeNull();
    expect(r.host.querySelector('[data-carrier-card="boost"]')).toBeNull();
    await save(r);
    expect(rawBlocks(saved())).toEqual([]);
  });

  it('opening the page and saving writes nothing (C36); paused and Tweaks-off cards are greyed', async () => {
    const live = carrier('skillIncrease', 5, 'stealth', { reason: 'GM gift' });
    const paused = carrier('boost', 5, 'dex', { on: false });
    const b0 = F5([live, paused]);
    const { r, saved } = open(b0, '5');
    await flush();
    expect(placeCard(r.host, `blocks:${live.id}`)?.dataset.placeState).toBe('live');
    const pc = placeCard(r.host, `blocks:${paused.id}`)!;
    expect(pc?.dataset.placeState).toBe('paused');
    expect([...pc.querySelectorAll('button')].some((x) => /Turn on/.test(x.textContent ?? '')), 'paused: Turn on').toBe(true);
    await save(r);
    expect(rawBlocks(saved()), 'byte for byte').toEqual(rawBlocks(b0));
    clear();
    const { r: r2 } = open(off(b0), '5');
    await flush();
    const oc = placeCard(r2.host, `blocks:${live.id}`)!;
    expect(oc?.dataset.placeState).toBe('off');
    expect(oc.querySelector('[data-carrier-card]'), 'Tweaks off: no picker').toBeNull();
    expect(levelChoices(off(F5([carrier('skillIncrease', 5)])), db).some((m) => /extra skill increase/.test(m.label)), 'Tweaks off: not owed').toBe(false);
  });

  it('"Remove this place" on a carrier: Ctrl+Z brings the place back with its answer (fix round 1)', async () => {
    const block = carrier('skillIncrease', 5, 'stealth');
    const b0 = F5([block]);
    const { r, saved } = open(b0, '5');
    await flush();
    r.click(r.host.querySelector('[data-carrier-card="skillIncrease"] button[data-remove-carrier]'));
    await flush();
    expect(r.host.querySelector('[data-carrier-card="skillIncrease"]'), 'gone').toBeNull();
    await ctrl('z');
    await flush();
    expect(placeCard(r.host, `blocks:${block.id}`)?.dataset.placeState, 'Ctrl+Z: the place is back').toBe('live');
    expect(r.host.querySelector('[data-carrier-card="skillIncrease"] .lvl-result')?.textContent).toBe('→ trained');
    await save(r);
    expect(rawBlocks(saved()), 'byte for byte').toEqual(rawBlocks(b0));
  });

  it('a capped extra increase says it changes nothing, not "→ expert" (fix round 1)', async () => {
    // Religion: trained by Acolyte; the main increase at 3 makes it expert; level 3 caps at expert.
    const { r } = open(hero(db, 'fighter', 3, ov(carrier('skillIncrease', 3, 'religion')), { levelBoosts: ['str', 'dex', 'con', 'wis'], skillIncreases: { 3: 'religion' } }), '3');
    await flush();
    const cardEl = r.host.querySelector('[data-carrier-card="skillIncrease"]')!;
    expect(cardEl.querySelector('.lvl-result'), 'no "→ expert"').toBeNull();
    expect(cardEl.querySelector('[data-carrier-note]')?.textContent).toBe('No change: Religion is already expert (this level caps at expert).');
    // WP14 fix round 1: the picked answer's own label says "no change", never "E → M".
    const text = cardEl.textContent ?? '';
    expect(text, 'the capped pick is named with no change').toContain('Religion (E — no change)');
    expect(text, 'no arrow on the capped pick').not.toMatch(/Religion \(E → /);
  });

  it('a stored Lore not known shows by name, greyed, with what the sheet does', async () => {
    const { r } = open(F5([carrier('skillIncrease', 5, 'lore:sailing')]), '5');
    await flush();
    expect(r.host.querySelector('[data-carrier-note="lore:sailing"]')?.textContent).toMatch(/is not a skill or Lore you know at level 5 — this increase doesn't count until you pick another\./);
  });
});
