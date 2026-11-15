// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP7 RUN 3 — the Builder and the Tweaks page for an extra FEAT place (`choice.addPlace`, place 'feat';
 * plan work/tweaks-phase2-notes/plan.md WP7 steps 3, 5 and 7; C11-C13, C21, C33, C42). Synthetic characters only.
 *
 *   - "Add a place" at the end of a level's section (Tweaks on only): Feat place → a category (C13: the one list the
 *     Tweaks page offers too) → ONE block, no question (C21); opening it writes nothing (C36). The empty card is owed.
 *   - The place card (WP2's PlaceCardShell, "Normal card + chip"), the same label in every state: live = the place's own
 *     slot card with its picker, notes and questions and the Tweak mark beside it; paused = greyed, "Turn on"; Tweaks off =
 *     greyed, no controls (C42).
 *   - drawnKeys hold every READABLE place key in every state: its pick is never a "feat with no slot" and its questions
 *     are asked once; a key with no block, or an unreadable / newer block, stays a feat with no slot (UNKNOWN ≠ EMPTY).
 *   - Delete = the block only (C12): the card menu's "Remove this place" and the Tweaks page's Delete keep the pick and
 *     every answer byte for byte, never write `remove.choicePlace`, ask nothing; Ctrl+Z brings the place back.
 *   - A filled place never moves (the write door refuses; its level and kind are greyed); an empty one moves and leaves
 *     nothing behind under the old key.
 *   - The Tweaks page's "Add a place": a place made there alone appears on its level page, is owed, and its feat applies.
 *   - The Feats-tab card of a place pick says "Tweak: extra class feat place"; the switch-off confirm names the feat (C33).
 */
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { addEditor, enter, hero, mountTweaks, openMenu, partsOf, pick, press, rowBy, typeInto } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, levelChoices, type BuildState } from '../src/rules/build';
import { contentFor } from '../src/rules/blocks/content';
import { featPlaceKey } from '../src/rules/blocks/active';
import { parseStoredBlocks } from '../src/rules/blocks/stored';
import { PLACE_HOLDS_ANSWERS, PLACE_HOLDS_FEAT, heldUnderPlace, writeTweak } from '../src/rules/blocks/write';
import { STILL_TO_ADD, blockKind } from '../src/rules/blocks/registry';
import { SLOT_KEYED } from '../src/rules/featSlots';
import { deriveMaxHp } from '../src/rules/derive';
import { featPlaceCategories, tweaksTurnOffList } from '../src/builder/tweaks/model';
import { featEntries } from '../src/sheet/FeatsTab';
import { OURS_KINDS } from '../src/sheet/cardModel';
import type { BuildOverrides, Character } from '../src/rules/types';

// jsdom has no CSS.escape; "Go to"'s flashPlace (choiceParts.tsx) uses it, as every browser and WebView2 provide it.
const g = globalThis as unknown as { CSS?: { escape?: (s: string) => string } };
if (!g.CSS?.escape) g.CSS = { ...(g.CSS ?? {}), escape: (s: string) => s.replace(/["\\\]\[]/g, '\\$&') };
const esc = (s: string) => s.replace(/["\\]/g, '\\$&');

const db = content();
const noop = () => undefined;
let seq = 0;
/** One `choice.addPlace` feat block (`on: false` = paused). */
const placeBlock = (level: number, category: string, n: number | undefined, on = true, extra: Record<string, unknown> = {}) => ({
  id: `t${++seq}_pc${String(seq).padStart(2, '0')}`,
  kind: 'choice.addPlace',
  v: 1,
  place: 'feat',
  level,
  category,
  ...(n === undefined ? {} : { n }),
  ...(on ? {} : { on: false }),
  ...extra,
});
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const built = (b: BuildState): Character => buildCharacter(b, contentFor(db, b));
const featIds = (ch: Character) => (ch.feats ?? []).map((f) => f.featId);
const N = 483920;
const KEY = featPlaceKey(4, 'class', N);
/** A level-4 fighter holding `blocks`, `more` laid over. */
const F4 = (blocks: object[] = [], more: Partial<BuildState> = {}) => hero(db, 'fighter', 4, ov(...blocks), more);
/** …with an extra class place at level 4 (n = N) holding Sudden Charge (a fighter class feat: it fits), and answers
 *  under its key in two maps (`#1`, `:…`) — what Delete must keep byte for byte. */
const FILLED = (on = true) =>
  F4([placeBlock(4, 'class', N, on, { reason: 'Boon from the first adventure' })], {
    featPicks: { [KEY]: 'sudden-charge' },
    featChoices: { [KEY]: 'kept answer', [`${KEY}#1`]: 'second answer' },
    effectChoices: { [`${KEY}:some-choice`]: 'kept effect' } as BuildState['effectChoices'],
  });
const addPlaces = (b: BuildState) => parseStoredBlocks(b.overrides?.blocks).known.filter((x) => x.kind === 'choice.addPlace');
const removals = (b: BuildState) => parseStoredBlocks(b.overrides?.blocks).known.filter((x) => x.kind === 'remove.choicePlace');
const owes = (b: BuildState, level: number, label: string) => levelChoices(b, db).some((c) => c.page === level && c.label.endsWith(`— ${label}`));
/** Every entry of every SLOT_KEYED map under `key` (the key, `key#…`, `key:…`), as one comparable string. */
const underKey = (b: BuildState, key: string) =>
  JSON.stringify(
    SLOT_KEYED.map((f) => [
      f,
      Object.entries((b as unknown as Record<string, Record<string, unknown> | undefined>)[f] ?? {}).filter(([k]) => k === key || k.startsWith(`${key}#`) || k.startsWith(`${key}:`)),
    ]),
  );

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
const card = (host: ParentNode, key = KEY) => host.querySelector<HTMLElement>(`.tw-place-card[data-place-key="${esc(key)}"]`);
const pendingOf = (host: ParentNode) => Number(/(\d+)/.exec(host.querySelector('.lvl-pending-tag')?.textContent ?? '0')?.[1] ?? 0);
const ctrl = (k: string) => act(async () => void window.dispatchEvent(new KeyboardEvent('keydown', { key: k, ctrlKey: true })));

describe('choice.addPlace on the level page: "Add a place" (C13, C21, C36)', () => {
  it('Tweaks off: no "Add a place"; Tweaks on: the last thing in the level section', async () => {
    const { r } = open(off(F4()), '4');
    await flush();
    expect(r.host.querySelector('[data-add-place]')).toBeNull();
    clear();
    const { r: r2 } = open(F4(), '4');
    await flush();
    const zone = r2.host.querySelector('fieldset.lvl-choice-zone')!;
    expect(zone.lastElementChild?.matches('[data-add-place="4"]'), 'the last thing in the level section').toBe(true);
    expect(zone.lastElementChild?.textContent?.trim()).toBe('Add a place');
  });

  it('opening it writes nothing and offers Feat place with the character’s own categories; Cancel closes it', async () => {
    const { r, saved } = open(F4(), '4');
    await flush();
    r.click(r.host.querySelector('button.lvl-add-place-btn'));
    await flush();
    const ctl = r.host.querySelector('[data-add-place="4"]')!;
    expect(ctl.querySelector('.lvl-add-place-kind')?.textContent?.trim()).toBe('Feat place');
    // a fighter: the five always, and bonus (it draws bonus feat slots at some level)
    // WP11 adds "Skill increase" and "Attribute boost" beside them (`[data-carrier]`, test/tweaks-p2-skill-boost-places-ui.test.tsx).
    expect([...ctl.querySelectorAll('.lvl-add-place-cat:not([data-carrier])')].map((b) => b.textContent?.trim())).toEqual(['Ancestry feat', 'Class feat', 'General feat', 'Skill feat', 'Archetype feat', 'Bonus feat']);
    r.click(ctl.querySelector('button.lvl-add-place-cancel'));
    await flush();
    expect(r.host.querySelector('.lvl-add-place-cat')).toBeNull();
    await save(r);
    expect(saved(), 'saved').not.toBeNull();
    expect(addPlaces(saved()!), 'opening and cancelling wrote nothing').toEqual([]);
  });

  it('Class feat → one block, no question; the empty place card appears under "Added by a tweak" and is owed', async () => {
    const { r, saved } = open(F4(), '4');
    await flush();
    const before = pendingOf(r.host);
    r.click(r.host.querySelector('button.lvl-add-place-btn'));
    await flush();
    r.click(r.host.querySelector('button.lvl-add-place-cat[data-category="class"]'));
    await flush();
    expect(document.querySelector('.confirm-modal'), 'asks nothing (C21)').toBeNull();
    const group = r.host.querySelector('[data-added-places="4"]')!;
    expect(group.querySelector('.lvl-group-h')?.textContent?.trim()).toBe('Added by a tweak');
    const c = group.querySelector<HTMLElement>('.tw-place-card')!;
    expect(c.dataset.placeState).toBe('live');
    expect(c.getAttribute('aria-label')).toBe('Extra class feat (level 4)');
    const slot = c.querySelector<HTMLElement>('button.lvl-card[data-ctl="slot"]')!;
    expect(slot.dataset.ctlTitle).toBe('Extra class feat (level 4)');
    expect(slot.dataset.ctlState).toBe('empty');
    expect(c.querySelector('[data-tweak-mark="choice.addPlace"]'), 'the Tweak mark beside it').not.toBeNull();
    expect(pendingOf(r.host), 'the empty place is owed').toBe(before + 1);
    const placeKey = c.dataset.placeKey;
    await save(r);
    const blocks = addPlaces(saved()!);
    expect(blocks.map((b) => ({ ...b.params, n: undefined }))).toEqual([{ place: 'feat', level: 4, category: 'class', n: undefined }]);
    const n = blocks[0].params!.n as number;
    expect(Number.isInteger(n) && n >= 100000 && n <= 999999, `n = ${n}`).toBe(true);
    expect(placeKey).toBe(featPlaceKey(4, 'class', n));
  });

  it('the categories are one list for both screens: impulse for a kineticist, mythic with Mythic on, bonus for a fighter', () => {
    expect(featPlaceCategories(hero(db, 'wizard', 4), db)).toEqual(['ancestry', 'class', 'general', 'skill', 'archetype']);
    expect(featPlaceCategories(hero(db, 'fighter', 4), db)).toContain('bonus');
    expect(featPlaceCategories(hero(db, 'kineticist', 4), db)).toContain('impulse');
    expect(featPlaceCategories(hero(db, 'wizard', 4), db)).not.toContain('impulse');
    expect(featPlaceCategories(hero(db, 'wizard', 4, undefined, { mythicEnabled: true } as Partial<BuildState>), db)).toContain('mythic');
    expect(featPlaceCategories(hero(db, 'wizard', 4), db, 'mythic'), "a stored place's own category stays listed").toContain('mythic');
  });
});

describe('choice.addPlace: the place card in its three states (C42)', () => {
  it('live: the place’s own slot card holding Sudden Charge, the Tweak mark beside it with the rule and reason', async () => {
    const { r } = open(FILLED(), '4');
    await flush();
    const c = card(r.host)!;
    expect(c.dataset.placeState).toBe('live');
    const slot = c.querySelector<HTMLElement>('.tw-place-row > .lvl-slot-wrap button.lvl-card[data-ctl="slot"]')!;
    expect(slot.dataset.ctlTitle).toBe('Extra class feat (level 4)');
    expect(slot.textContent).toContain('Sudden Charge');
    const mark = c.querySelector<HTMLElement>('.tw-place-row > [data-tweak-mark="choice.addPlace"]')!;
    expect(mark.dataset.tweakState).toBe('live');
    r.click(mark.querySelector('button.tw-mark-chip'));
    await flush();
    expect(mark.querySelector('.tw-mark-rule')?.textContent).toBe('An extra class feat place at level 4');
    expect(mark.querySelector('.tw-mark-reason')?.textContent).toContain('Boon from the first adventure');
    expect(mark.querySelector('button.tw-mark-show')?.textContent).toContain('Show in Tweaks');
    expect(c.querySelector('.tw-place-note'), 'no state line on a live card').toBeNull();
    expect(r.host.querySelector(`[data-unfit="${esc(KEY)}"]`), 'it fits its own place').toBeNull();
    expect(r.host.querySelector(`[data-noslot="${esc(KEY)}"]`), 'never a feat with no slot').toBeNull();
  });

  it('live, empty: the card opens the place’s own picker, and the pick lands under the place key', async () => {
    const { r, saved } = open(F4([placeBlock(4, 'general', N)]), '4');
    await flush();
    const key = featPlaceKey(4, 'general', N);
    r.click(card(r.host, key)!.querySelector('button.lvl-card[data-ctl-title="Extra general feat (level 4)"]'));
    await flush();
    const overlays = [...document.querySelectorAll('.picker-overlay')];
    const ovl = overlays[overlays.length - 1]!;
    expect(ovl, 'the place’s picker opened').toBeTruthy();
    const rowNamed = (name: string) => [...ovl.querySelectorAll('.pick-row')].find((n) => (n.querySelector('.picker-name')?.textContent ?? '').trim() === name);
    const search = ovl.querySelector<HTMLInputElement>('input.name-input');
    if (search) {
      typeInto(search, 'Sudden Charge');
      await flush();
      expect(rowNamed('Sudden Charge')?.querySelector('.pick-add:not([disabled])') ?? null, 'a class feat is not offered for a general place').toBeNull();
      typeInto(search, 'Toughness');
      await flush();
    }
    const row = rowNamed('Toughness');
    expect(row, 'Toughness in the place’s own (general) list').toBeTruthy();
    r.click(row!.querySelector('.pick-add'));
    await flush();
    expect(card(r.host, key)!.querySelector('button.lvl-card')?.textContent).toContain('Toughness');
    await save(r);
    expect(saved()!.featPicks[key]).toBe('toughness');
  });

  it('paused: greyed, its chip paused, "Paused: Sudden Charge doesn’t count while paused — Turn on"; Turn on writes only on', async () => {
    const { r, saved } = open(FILLED(false), '4');
    await flush();
    const c = card(r.host)!;
    expect(c.className).toContain('paused');
    expect(c.querySelector('.tw-place-plain .lvl-card-label')?.textContent, 'the same label').toBe('Extra class feat (level 4)');
    expect(c.querySelector('.tw-place-plain .lvl-card-val')?.textContent).toBe('Sudden Charge');
    expect(c.querySelector('[data-tweak-mark="choice.addPlace"]')?.getAttribute('data-tweak-state')).toBe('paused');
    expect(c.querySelector('.tw-place-note')?.textContent).toBe('Paused: Sudden Charge doesn’t count while paused — Turn on');
    expect(c.querySelector('button[data-ctl="slot"]'), 'no picker while paused').toBeNull();
    r.click(c.querySelector('button.tw-place-on'));
    await flush();
    expect(card(r.host)!.dataset.placeState).toBe('live');
    await save(r);
    expect(addPlaces(saved()!)[0].on).toBe(true);
    expect(underKey(saved()!, KEY), 'the pick and answers untouched').toBe(underKey(FILLED(false), KEY));
  });

  it('Tweaks off: greyed, no chip, no controls, "Tweaks are off: Sudden Charge doesn’t count — turn Tweaks on in Setup → Options"', async () => {
    const { r } = open(off(FILLED()), '4');
    await flush();
    const c = card(r.host)!;
    expect(c.className).toContain('off');
    expect(c.querySelector('.tw-place-plain .lvl-card-label')?.textContent).toBe('Extra class feat (level 4)');
    expect(c.querySelector('.tw-place-note')?.textContent).toBe('Tweaks are off: Sudden Charge doesn’t count — turn Tweaks on in Setup → Options');
    expect(c.querySelectorAll('button'), 'no controls (C42)').toHaveLength(0);
    expect(c.querySelector('[data-tweak-mark]')).toBeNull();
    expect(r.host.querySelector('[data-add-place]'), 'no "Add a place" with Tweaks off').toBeNull();
  });
});

describe('choice.addPlace: drawnKeys hold every readable place key, in every state (C11, C42)', () => {
  it('live, paused and off: the pick is never a feat with no slot', async () => {
    for (const [name, b] of [
      ['live', FILLED()],
      ['paused', FILLED(false)],
      ['off', off(FILLED())],
      ['off + paused', off(FILLED(false))],
    ] as const) {
      const { r } = open(b, '4');
      await flush();
      expect(card(r.host), `${name}: the card is drawn`).not.toBeNull();
      expect(r.host.querySelector(`[data-noslot="${esc(KEY)}"]`), `${name}: no no-slot row`).toBeNull();
      clear();
    }
  });

  it('a key with no block, or an unreadable / newer block, stays a feat with no slot that counts (UNKNOWN ≠ EMPTY)', async () => {
    const pickOnly = { featPicks: { [KEY]: 'sudden-charge' } };
    const cases: [string, BuildState][] = [
      ['no block', F4([], pickOnly)],
      ['a newer version', F4([{ ...placeBlock(4, 'class', N), v: 99 }], pickOnly)],
      ['unreadable (no n)', F4([placeBlock(4, 'class', undefined)], pickOnly)],
    ];
    for (const [name, b] of cases) {
      const { r } = open(b, '4');
      await flush();
      expect(card(r.host), `${name}: no card`).toBeNull();
      expect(r.host.querySelector(`[data-noslot="${esc(KEY)}"]`)?.textContent, `${name}: a feat with no slot`).toContain('Sudden Charge');
      expect(featIds(built(b)), `${name}: it counts`).toContain('sudden-charge');
      clear();
    }
  });

  it("a live place's feat asks its questions once, under its card; a paused one asks nothing", async () => {
    const key = featPlaceKey(4, 'skill', N);
    const { r } = open(F4([placeBlock(4, 'skill', N)], { featPicks: { [key]: 'assurance' } }), '4');
    await flush();
    const c = card(r.host, key)!;
    expect(c, 'the skill place card').not.toBeNull();
    const titles = [...c.querySelectorAll<HTMLElement>('[data-ctl-title]')].map((e) => e.dataset.ctlTitle!).filter((t) => t !== 'Extra skill feat (level 4)');
    expect(titles.length, 'Assurance asks its skill under the card').toBeGreaterThan(0);
    for (const t of titles) expect(r.host.querySelectorAll(`[data-ctl-title="${esc(t)}"]`).length, `"${t}" asked once`).toBe(1);
    expect(r.host.querySelector(`[data-noslot="${esc(key)}"]`)).toBeNull();
    clear();
    const { r: r2 } = open(F4([placeBlock(4, 'skill', N, false)], { featPicks: { [key]: 'assurance' } }), '4');
    await flush();
    for (const t of titles) expect(r2.host.querySelector(`[data-ctl-title="${esc(t)}"]`), `paused: "${t}" not asked`).toBeNull();
    expect(r2.host.querySelector(`[data-noslot="${esc(key)}"]`), 'paused: not a feat with no slot either').toBeNull();
  });
});

describe('choice.addPlace: Delete is the block only (C12)', () => {
  it('"Remove this place" asks nothing, never writes remove.choicePlace, keeps the pick and every answer; Ctrl+Z brings it back', async () => {
    const before = FILLED();
    const { r, saved } = open(before, '4');
    await flush();
    r.click(card(r.host)!.querySelector('button.lvl-menu-btn'));
    await flush();
    const item = [...document.querySelectorAll<HTMLButtonElement>('.lvl-menu button')].find((b) => (b.textContent ?? '').trim() === 'Remove this place')!;
    expect(item).toBeTruthy();
    r.click(item);
    await flush();
    expect(document.querySelector('.confirm-modal'), 'asks nothing').toBeNull();
    expect(card(r.host), 'the card is gone').toBeNull();
    expect(r.host.querySelector(`[data-noslot="${esc(KEY)}"]`)?.textContent).toContain('Sudden Charge');
    expect(r.host.querySelector(`[data-place-gone="${esc(KEY)}"]`)?.textContent?.trim()).toBe('Sudden Charge stays as a feat with no slot.');
    expect(r.host.querySelector('[data-removed-place]'), 'no removed-place line: no remove.choicePlace').toBeNull();
    expect(r.host.querySelector('button.lvl-card[data-ctl-title="Class feat"]'), 'the book class slot is still drawn').not.toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    await ctrl('z');
    await flush();
    expect(card(r.host)?.dataset.placeState, 'Ctrl+Z: the place is back').toBe('live');
    expect(card(r.host)!.querySelector('button.lvl-card')?.textContent).toContain('Sudden Charge');
    await ctrl('y');
    await flush();
    expect(card(r.host), 'redo: gone again').toBeNull();
    await save(r);
    const b = saved()!;
    expect(addPlaces(b), 'the block is gone').toEqual([]);
    expect(removals(b), 'no remove.choicePlace for an extra place').toEqual([]);
    expect(underKey(b, KEY), 'the pick and every answer, byte for byte').toBe(underKey(before, KEY));
    expect(featIds(built(b)), 'a feat with no slot that counts').toContain('sudden-charge');
  });

  it('the Tweaks page: "Delete — Sudden Charge stays as a feat with no slot" takes the block only; an empty place reads "Delete tweak"', async () => {
    const before = FILLED();
    const t = mountTweaks(db, before);
    stops.push(t.stop);
    const row = rowBy(t.host, 'Extra class feat place at level 4 — holds Sudden Charge')!;
    expect(row, 'the row').toBeTruthy();
    await press(row.querySelector('button.tw-row-head'));
    const del = row.querySelector<HTMLButtonElement>('button.tw-del')!;
    expect(del.textContent?.trim()).toBe('Delete — Sudden Charge stays as a feat with no slot');
    await press(del);
    expect(document.querySelector('.confirm-modal'), 'asks nothing').toBeNull();
    const b = t.build();
    expect(addPlaces(b)).toEqual([]);
    expect(removals(b)).toEqual([]);
    expect(underKey(b, KEY)).toBe(underKey(before, KEY));
    clear();
    const e = mountTweaks(db, F4([placeBlock(4, 'class', N)]));
    stops.push(e.stop);
    const er = rowBy(e.host, 'Extra class feat place at level 4 — empty')!;
    expect(er, 'the empty row').toBeTruthy();
    await press(er.querySelector('button.tw-row-head'));
    expect(er.querySelector('button.tw-del')?.textContent?.trim()).toBe('Delete tweak');
    // The final check (2026-10-25): a PAUSED place's feat counts again once the place is deleted; the label says so.
    clear();
    const p = mountTweaks(db, FILLED(false));
    stops.push(p.stop);
    const pr = rowBy(p.host, 'Extra class feat place at level 4 — holds Sudden Charge')!;
    expect(pr, 'the paused row').toBeTruthy();
    await press(pr.querySelector('button.tw-row-head'));
    expect(pr.querySelector('button.tw-del')?.textContent?.trim()).toBe('Delete — Sudden Charge stays as a feat with no slot and counts again');
  });
});

describe('choice.addPlace: a filled place never moves; an empty one leaves nothing behind (C12)', () => {
  const update = (b: BuildState, fields: Record<string, unknown>) => writeTweak(b, { op: 'update', key: addPlaces(b)[0].key, draft: { fields } });

  it('the write door refuses moving a filled place (level or kind), or one holding answers; a pause still saves', () => {
    expect(update(FILLED(), { level: 5 }).refused).toBe(PLACE_HOLDS_FEAT);
    expect(update(FILLED(), { category: 'general' }).refused).toBe(PLACE_HOLDS_FEAT);
    const answersOnly = F4([placeBlock(4, 'class', N)], { featLoreChoices: { [`${KEY}:0`]: 'lore:sailing' } as BuildState['featLoreChoices'] });
    expect(heldUnderPlace(answersOnly, KEY)).toBe('answers');
    expect(update(answersOnly, { level: 5 }).refused).toBe(PLACE_HOLDS_ANSWERS);
    const f = FILLED();
    expect(writeTweak(f, { op: 'setOn', key: addPlaces(f)[0].key, on: false }).refused, 'a pause is no move').toBeUndefined();
    expect(update(FILLED(), { level: 4 }).refused, 'the same level is no move').toBeUndefined();
  });

  it('an empty place moves; nothing is under the old key; a move onto a key a stranded pick holds draws a fresh n', () => {
    const empty = F4([placeBlock(4, 'class', N)]);
    const moved = { ...empty, overrides: update(empty, { level: 5, category: 'general' }).overrides } as BuildState;
    expect(addPlaces(moved).map((b) => b.params)).toEqual([{ place: 'feat', level: 5, category: 'general', n: N }]);
    expect(heldUnderPlace(moved, KEY)).toBeNull();
    const stranded = F4([placeBlock(4, 'class', N)], { featPicks: { [featPlaceKey(5, 'class', N)]: 'sudden-charge' } });
    const r = update(stranded, { level: 5 });
    expect(r.refused).toBeUndefined();
    const p = parseStoredBlocks(r.overrides?.blocks).known[0].params!;
    expect(p.level).toBe(5);
    expect(p.n, 'never captures the stranded Sudden Charge').not.toBe(N);
    expect(heldUnderPlace(stranded, featPlaceKey(5, 'class', p.n)), 'its new key is empty').toBeNull();
    expect(update(stranded, { level: 5, n: N }).refused, 'an n given outright that is in use is refused').toMatch(/already uses/);
  });

  it('the Tweaks page row: level and kind greyed while filled ("remove the feat first"); empty, the level changes the place', async () => {
    const t = mountTweaks(db, FILLED());
    stops.push(t.stop);
    const row = rowBy(t.host, /^Extra class feat place at level 4/)!;
    await press(row.querySelector('button.tw-row-head'));
    const part = row.querySelector('[data-part="place"]')!;
    expect(part, 'the place part').toBeTruthy();
    expect(part.querySelector('input[aria-label="At level"]'), 'level greyed').toBeNull();
    expect(part.querySelector('[data-ctl-title="Feat kind"]'), 'kind greyed').toBeNull();
    expect(part.textContent).toContain('remove the feat first');
    clear();
    const e = mountTweaks(db, F4([placeBlock(4, 'class', N)]));
    stops.push(e.stop);
    const er = rowBy(e.host, 'Extra class feat place at level 4 — empty')!;
    await press(er.querySelector('button.tw-row-head'));
    await enter(er.querySelector<HTMLInputElement>('[data-part="place"] input[aria-label="At level"]'), '3');
    expect(addPlaces(e.build()).map((b) => b.params)).toEqual([{ place: 'feat', level: 3, category: 'class', n: N }]);
    expect(rowBy(e.host, 'Extra class feat place at level 3 — empty')).toBeTruthy();
  });
});

describe('choice.addPlace on the Tweaks page: Add a tweak → "Add a place"', () => {
  it('the place part (Feat place by default), level and kind; the place is owed, shows on its level page, and its feat applies', async () => {
    const t = mountTweaks(db, F4());
    stops.push(t.stop);
    const ed = await openMenu(t.host, 'Add a place');
    expect(partsOf(ed), 'the place and the reason (no answer part for a feat place)').toEqual(['place', 'reason']);
    // WP11: the kind is chosen (Feat place, Skill increase, Attribute boost); a new place starts as a Feat place.
    expect(ed.querySelector('[data-part="place"] [data-ctl-title="Kind of place"]'), 'WP11: the kind chooser').not.toBeNull();
    expect(ed.querySelector('[data-part="place"]')?.textContent).toContain('Feat place');
    expect(ed.querySelector('.tw-missing')?.textContent).toBe('Choose the level');
    expect(Number(ed.querySelector('[data-ctl-title="Feat kind"]')?.getAttribute('data-ctl-options')), 'the one category list').toBe(featPlaceCategories(F4(), db).length);
    await enter(ed.querySelector<HTMLInputElement>('input[aria-label="At level"]'), '4');
    expect(addEditor(t.host)!.querySelector('.tw-missing')?.textContent).toBe('Choose the feat kind');
    await pick(addEditor(t.host)!, 'Feat kind', 'General');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    const b = t.build();
    expect(addPlaces(b).map((x) => ({ ...x.params, n: typeof x.params?.n }))).toEqual([{ place: 'feat', level: 4, category: 'general', n: 'number' }]);
    expect(rowBy(t.host, 'Extra general feat place at level 4 — empty'), 'its row').toBeTruthy();
    expect(owes(b, 4, 'extra general feat'), 'owed').toBe(true);
    clear();
    const key = featPlaceKey(4, 'general', addPlaces(b)[0].params!.n);
    const { r } = open(b, '4');
    await flush();
    expect(card(r.host, key)?.dataset.placeState, 'on its level page').toBe('live');
    const filled = { ...b, featPicks: { ...b.featPicks, [key]: 'toughness' } } as BuildState;
    expect(owes(filled, 4, 'extra general feat'), 'filled: no longer owed').toBe(false);
    expect(featIds(built(filled))).toContain('toughness');
    expect(deriveMaxHp(built(filled), db), 'its feat applies (Toughness: +level HP)').toBe(deriveMaxHp(built(b), db) + 4);
  });

  it('a place above the character’s level: "Not reached yet"', async () => {
    const t = mountTweaks(db, F4());
    stops.push(t.stop);
    await openMenu(t.host, 'Add a place');
    await enter(addEditor(t.host)!.querySelector<HTMLInputElement>('input[aria-label="At level"]'), '9');
    await pick(addEditor(t.host)!, 'Feat kind', 'General');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    const row = rowBy(t.host, 'Extra general feat place at level 9 — empty')!;
    expect(row, 'its row').toBeTruthy();
    expect(row.querySelector('.tw-chip-notReachedYet')?.textContent).toBe('Not reached yet (level 9)');
    expect(owes(t.build(), 9, 'extra general feat'), 'not owed above the level').toBe(false);
  });

  it('"Go to" lands on the level page and flashes the card', async () => {
    const { r } = open(FILLED(), '1');
    await flush();
    await press(r.host.querySelector('.builder-head button.b-tweaks'));
    const row = rowBy(r.host, 'Extra class feat place at level 4 — holds Sudden Charge')!;
    expect(row, 'the row').toBeTruthy();
    await press(row.querySelector('button.tw-row-head'));
    await press(row.querySelector('button.tw-goto-place'));
    await act(async () => void (await new Promise((res) => setTimeout(res, 150))));
    expect(r.host.querySelector('.lvl-page .bsec-title')?.textContent).toBe('Level 4');
    expect(card(r.host)?.classList.contains('tw-flash'), 'the card flashes').toBe(true);
  });
});

describe('choice.addPlace on the sheet and in the switch-off confirm', () => {
  it('the Feats-tab card of a live place pick says "Tweak: extra class feat place"; a book slot pick does not; paused, not on the sheet', () => {
    expect(OURS_KINDS).toContain('place');
    const live = featEntries(built(FILLED()), db).find((e) => e.featId === 'sudden-charge');
    expect(live, 'on the Feats tab').toBeTruthy();
    expect(live!.ours).toContainEqual({ kind: 'place', text: 'Tweak: extra class feat place' });
    const book = F4([], { featPicks: { '4:class:0': 'sudden-charge' } });
    const bookEntry = featEntries(built(book), db).find((e) => e.featId === 'sudden-charge');
    expect(bookEntry, 'the book slot pick is on the Feats tab').toBeTruthy();
    expect(bookEntry!.ours?.some((l) => l.kind === 'place'), 'a book slot is no tweak').toBe(false);
    expect(featEntries(built(FILLED(false)), db).some((e) => e.featId === 'sudden-charge'), 'a paused place’s feat is not on the sheet').toBe(false);
  });

  it('C33: switching Tweaks off names the live place’s feat under "Choices: stops counting"', () => {
    expect(tweaksTurnOffList(FILLED(), db, null).choices.stops).toContain('Extra class feat place at level 4 — holds Sudden Charge');
  });
});

describe('choice.addPlace: the registry calls it built and applied', () => {
  it('built (main menu "Add a place"), applies blocks, no STILL_TO_ADD line', () => {
    const k = blockKind('choice.addPlace')!;
    expect(k.editor).toMatchObject({ place: 'main', menus: ['Add a place'], built: true });
    expect(k.applies).toBe('blocks');
    expect(k.test).toBe('test/tweaks-p2-place-card.test.tsx');
    expect(STILL_TO_ADD.some((s) => s.id === 'choice.addPlace')).toBe(false);
  });
});
