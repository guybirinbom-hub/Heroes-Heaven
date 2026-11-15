// @vitest-environment jsdom
/*
 * Tweaks phase 2, WP8 — "Take a feat more times" in the Builder and on the Tweaks page (plan WP8; D1-D4 in state.md
 * "## WP8 + WP9 chat"; C5, C21, C28, C36, C44). Synthetic characters only. The engine is test/tweaks-p2-more-takes.test.ts.
 *
 *   - the slot picker's "Already taken" row gets "Take again" (Search every feat, Tweaks on): "Take Fleet again?" →
 *     the pick AND {record: 'fleet', times: 1} in ONE write (one Ctrl+Z takes both back); the copy shows the mark;
 *   - a third copy with "1 more time" stored: Take again raises `times` to 2 on that ONE block;
 *   - no Take again with Tweaks off, on a feat whose tweak is paused (the words say so), or on a copy held back only by
 *     a paused extra place (that row keeps its own words);
 *   - "Search every feat" off: the hidden-feat note points to the toggle to take an already-taken feat again, only
 *     while Take again could be offered (Tweaks off: the book's words; a paused tweak: no pointer);
 *   - the slot card of the copy the engine drops while paused: "Taken more times than the feat allows — tweak paused"
 *     with the mark paused, the book's note beside it; Tweaks off: the book's note, no mark; live: the mark, no note;
 *   - the Tweaks page alone: "Take a feat more times" → Fleet → Add lets a second general slot take Fleet; the row
 *     editor's count never goes below the copies used.
 */
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { addEditor, hero, mountTweaks, openMenu, partsOf, pick as pickPart, press, rowBy } from './_tweaks-harness';
import { Builder } from '../src/builder/Builder';
import type { BuildState } from '../src/rules/build';
import { featPlaceKey } from '../src/rules/blocks/active';
import { parseStoredBlocks } from '../src/rules/blocks/stored';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { MORE_TAKES_PAUSED } from '../src/builder/tweaks/moreTakes';
import type { BuildOverrides } from '../src/rules/types';

const db = content();
const noop = () => undefined;
let seq = 0;
const more = (record: string, times = 1, on = true) => ({ id: `t${++seq}_wp8ui${String(seq).padStart(2, '0')}`, kind: 'choice.moreTakes', v: 1, record, times, ...(on ? {} : { on: false }) });
const placeBlock = (level: number, category: string, n: number, on = true) => ({ id: `t${++seq}_wp8up${String(seq).padStart(2, '0')}`, kind: 'choice.addPlace', v: 1, place: 'feat', level, category, n, ...(on ? {} : { on: false }) });
const ov = (...blocks: object[]): BuildOverrides => ({ v: 2, ...(blocks.length ? { blocks } : {}) }) as unknown as BuildOverrides;
const off = (b: BuildState): BuildState => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: false } });
const moreBlocks = (b: BuildState) => parseStoredBlocks(b.overrides?.blocks).known.filter((k) => k.kind === 'choice.moreTakes').map((k) => [k.record, k.params?.times, k.on]);

const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
const dialogButton = (label: string) => [...(document.querySelector('.confirm-modal')?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) ?? null;
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
async function typeSearch(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
}
/** Open the page's empty general slot, turn "Search every feat" on and search Fleet: Fleet's row (any kind). */
async function fleetRow(r: ReturnType<typeof open>['r']) {
  r.click(r.host.querySelector('button.lvl-card.empty[data-ctl-title="General feat"]'));
  await flush();
  const reveal = document.querySelector<HTMLInputElement>('.tw-reveal input');
  if (!reveal) return null;
  act(() => reveal.click());
  await flush();
  await typeSearch(document.querySelector<HTMLInputElement>('.fsel-results-search input')!, 'Fleet');
  return [...document.querySelectorAll<HTMLElement>('.pick-row')].find((x) => (x.querySelector('.picker-name')?.textContent ?? '').trim() === 'Fleet') ?? null;
}
const generalCard = (host: ParentNode) => host.querySelector<HTMLElement>('button.lvl-card[data-ctl-title="General feat"][data-ctl-state="picked"]')?.closest<HTMLElement>('.lvl-slot-wrap') ?? null;

describe('"Take again" in the slot picker (D4)', () => {
  it('"Take Fleet again?" → the pick and {fleet, times 1} in ONE write: one Ctrl+Z takes both back; the copy shows the mark', async () => {
    const { r, saved } = open(hero(db, 'fighter', 7, ov(), { featPicks: { '3:general:0': 'fleet' } }), '7');
    const row = (await fleetRow(r))!;
    expect(row, 'Fleet listed under Search every feat').toBeTruthy();
    expect(row.dataset.breakable).toBe('again');
    expect(row.querySelector('.picker-why')?.textContent).toBe('Already taken');
    r.click(row.querySelector('button.tw-break-act'));
    await flush();
    expect(document.querySelector('.confirm-modal')?.textContent).toContain('Take Fleet again?');
    // WP8 round 4 (B1): Take again records ONE tweak, never "2 tweaks … one per rule".
    expect(document.querySelector('.confirm-modal')?.textContent).toContain('This records 1 tweak; it is listed on the Tweaks page.');
    expect(document.querySelector('.confirm-modal')?.textContent).not.toMatch(/records \d+ tweaks|one per rule/);
    r.click(dialogButton('Take again'));
    await flush();
    await flush();
    const card = generalCard(r.host)!;
    expect(card.textContent).toContain('Fleet');
    expect(card.querySelector('[data-more-takes="live"] [data-tweak-mark="choice.moreTakes"][data-tweak-state="live"]')).toBeTruthy();
    expect(card.querySelector('[data-unfit]'), 'no "Not valid for this slot"').toBeNull();
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    await flush();
    expect(generalCard(r.host), 'one undo: the pick is gone').toBeNull();
    expect(r.host.querySelector('[data-tweak-mark]'), '…and the tweak with it').toBeNull();
    // The mark lives on the card, so a block left behind by a second write would not show here: save the undone
    // draft and read it (a pick-then-block or block-then-pick pair of writes leaves the block after one Ctrl+Z).
    await save(r);
    const undone = saved()!;
    expect(undone.featPicks['7:general:0'], 'one undo: no pick').toBeUndefined();
    expect(moreBlocks(undone), 'one undo: no block either (ONE write)').toEqual([]);
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true })));
    await flush();
    await save(r);
    const b = saved()!;
    expect(b.featPicks['7:general:0']).toBe('fleet');
    expect(moreBlocks(b)).toEqual([['fleet', 1, true]]);
  });

  it('a third copy with "1 more time" stored: Take again raises times to 2 on the ONE block', async () => {
    const blk = more('fleet', 1);
    const { r, saved } = open(hero(db, 'fighter', 11, ov(blk), { featPicks: { '3:general:0': 'fleet', '7:general:0': 'fleet' } }), '11');
    const row = (await fleetRow(r))!;
    expect(row.dataset.breakable).toBe('again');
    r.click(row.querySelector('button.tw-break-act'));
    await flush();
    expect(document.querySelector('.confirm-modal')?.textContent).toContain('goes to 2 more times');
    // WP8 round 4 (B1): raising the one block says so, never "records 2 tweaks".
    expect(document.querySelector('.confirm-modal')?.textContent).toContain('This raises your “Take a feat more times” tweak for Fleet to 2 more times; it is listed on the Tweaks page.');
    expect(document.querySelector('.confirm-modal')?.textContent).not.toMatch(/records \d+ tweaks|one per rule|records 1 tweak/);
    r.click(dialogButton('Take again'));
    await flush();
    await flush();
    await save(r);
    const b = saved()!;
    expect(b.featPicks['11:general:0']).toBe('fleet');
    const stored = parseStoredBlocks(b.overrides?.blocks).known.filter((k) => k.kind === 'choice.moreTakes');
    expect(stored.map((k) => [k.key, k.params?.times])).toEqual([[`blocks:${blk.id}`, 2]]);
  });

  /* WP8 round 4 (F2): the commit plans again on the build the patch is handed. Here that build changed while the confirm
   * was open (Ctrl+Z took back the "turn on"), so the write is refused there: it is said ("Not saved"), the build is
   * kept whole and the picker stays open. */
  it('the build changes while "Take Fleet again?" is open (the tweak paused again): "Not saved", nothing written, the picker stays open', async () => {
    const blk = more('fleet', 1, false);
    const { r, saved } = open(hero(db, 'fighter', 11, ov(blk), { featPicks: { '3:general:0': 'fleet', '7:general:0': 'fleet' } }), '11');
    r.click(r.host.querySelector('button.b-tweaks'));
    await flush();
    const toggle = document.querySelector<HTMLButtonElement>('button.tw-toggle[aria-label^="Turn on: Fleet"]');
    expect(toggle, 'the paused row').toBeTruthy();
    r.click(toggle);
    await flush();
    r.click([...r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === '11') ?? null);
    await flush();
    const row = (await fleetRow(r))!;
    expect(row.dataset.breakable, 'live now: Take again offered').toBe('again');
    r.click(row.querySelector('button.tw-break-act'));
    await flush();
    expect(document.querySelector('.confirm-modal')?.textContent).toContain('Take Fleet again?');
    // While the box is open: Ctrl+Z pauses the tweak again.
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })));
    await flush();
    r.click(dialogButton('Take again'));
    await flush();
    await flush();
    const notSaved = [...document.querySelectorAll('.confirm-modal')].find((m) => (m.textContent ?? '').includes('Not saved'));
    expect(notSaved?.textContent, 'the refusal is said').toContain('tweak is paused');
    expect(document.querySelector('.fsel-results-search input'), 'the picker stays open').toBeTruthy();
    r.click(dialogButton('OK'));
    await flush();
    await save(r);
    const b = saved()!;
    expect(b.featPicks['11:general:0'], 'no pick written').toBeUndefined();
    expect(moreBlocks(b), 'the block as it was: paused, 1 more time').toEqual([['fleet', 1, false]]);
  });

  it('no Take again: Tweaks off; a paused tweak (its words say so); a copy held back only by a paused extra place', async () => {
    const { r: r0 } = open(off(hero(db, 'fighter', 7, ov(), { featPicks: { '3:general:0': 'fleet' } })), '7');
    expect(await fleetRow(r0), 'Tweaks off: no reveal, so no Fleet row at all').toBeNull();
    expect(document.querySelector('[data-breakable]')).toBeNull();
    for (const s of stops) s();
    stops = [];
    for (const n of [...document.body.children]) n.remove();

    const { r: r1 } = open(hero(db, 'fighter', 7, ov(more('fleet', 1, false)), { featPicks: { '3:general:0': 'fleet' } }), '7');
    const paused = (await fleetRow(r1))!;
    expect(paused, 'Fleet listed').toBeTruthy();
    expect(paused.dataset.breakable, 'no Take again on a paused tweak').toBeUndefined();
    expect(paused.querySelector('button.tw-break-act')).toBeNull();
    expect(paused.textContent).toContain('tweak is paused');
    for (const s of stops) s();
    stops = [];
    for (const n of [...document.body.children]) n.remove();

    const key = featPlaceKey(5, 'general', 483990);
    const { r: r2 } = open(hero(db, 'fighter', 7, ov(placeBlock(5, 'general', 483990, false)), { featPicks: { [key]: 'fleet' } }), '7');
    const held = (await fleetRow(r2))!;
    expect(held, 'Fleet listed').toBeTruthy();
    expect(held.dataset.breakable).toBeUndefined();
    expect(held.textContent).toContain('paused extra place');
  });
});

/* WP8 fixes round 3 (the orchestrator's item 2): with "Search every feat" OFF, the hidden-feat note under a search
 * points at the toggle for an already-taken feat too, but only while Take again could be offered there. */
describe('the hidden-feat note points to "Take again" (Search every feat off)', () => {
  async function hiddenNote(initial: BuildState) {
    const { r } = open(initial, '7');
    r.click(r.host.querySelector('button.lvl-card.empty[data-ctl-title="General feat"]'));
    await flush();
    await typeSearch(document.querySelector<HTMLInputElement>('.fsel-results-search input')!, 'Fleet');
    const text = document.querySelector('.fsel-hidden-note')?.textContent ?? '';
    for (const s of stops) s();
    stops = [];
    for (const n of [...document.body.children]) n.remove();
    return text;
  }
  it('Tweaks on: "… already taken) — turn on “Search every feat” to … take one again"; Tweaks off: the book words; a paused tweak: no pointer to Take again', async () => {
    const on = await hiddenNote(hero(db, 'fighter', 7, ov(), { featPicks: { '3:general:0': 'fleet' } }));
    expect(on).toContain('already taken');
    expect(on).toMatch(/ — turn on “Search every feat” to (allow one here or )?take one again/);
    const bookOff = await hiddenNote(off(hero(db, 'fighter', 7, ov(), { featPicks: { '3:general:0': 'fleet' } })));
    expect(bookOff).toMatch(/\d+ not valid for this slot \([^)]*1 already taken\)[.;]/);
    expect(bookOff, "Tweaks off: the book's words, no toggle named").not.toContain('Search every feat');
    const paused = await hiddenNote(hero(db, 'fighter', 7, ov(more('fleet', 1, false)), { featPicks: { '3:general:0': 'fleet' } }));
    expect(paused).toContain('already taken');
    expect(paused, 'Take again is not offered on a paused tweak').not.toContain('take one again');
  });
});

describe('the slot card of a more-taken copy', () => {
  const twice = (...blocks: object[]) => hero(db, 'fighter', 7, ov(...blocks), { featPicks: { '3:general:0': 'fleet', '7:general:0': 'fleet' } });
  it('paused: the copy the engine drops reads "Taken more times than the feat allows — tweak paused", the book note beside it', async () => {
    const { r } = open(twice(more('fleet', 1, false)), '7');
    await flush();
    const card = generalCard(r.host)!;
    const note = card.querySelector<HTMLElement>('[data-more-takes="paused"]')!;
    expect(note, 'the paused words on the dropped copy').toBeTruthy();
    expect(note.textContent).toContain(MORE_TAKES_PAUSED);
    expect(note.querySelector('[data-tweak-mark="choice.moreTakes"][data-tweak-state="paused"]')).toBeTruthy();
    expect(card.querySelector('[data-unfit]'), "the book's own note returns").toBeTruthy();
  });
  /* WP8 round 4 (B2; the orchestrator's decision): Tweaks on and the tweak paused, only the copy the engine DROPS (7th)
   * keeps a note; the copy that still counts (3rd) shows none. Tweaks off: the book's display, unchanged — which today
   * marks BOTH copies of a duplicate "Not valid for this slot", exactly as a character with no tweak at all (measured
   * here, not changed: a book display question for the orchestrator). */
  it('paused: the copy that COUNTS (3rd) has no "Not valid" note; Tweaks off and no tweak at all: the book display marks it', async () => {
    const third = async (b: BuildState) => {
      const { r } = open(b, '3');
      await flush();
      const card = generalCard(r.host)!;
      const out = { fleet: (card.textContent ?? '').includes('Fleet'), unfit: !!card.querySelector('[data-unfit]'), text: card.textContent ?? '', mark: !!card.querySelector('[data-tweak-mark]') };
      for (const s of stops) s();
      stops = [];
      for (const n of [...document.body.children]) n.remove();
      return out;
    };
    const paused = await third(twice(more('fleet', 1, false)));
    expect(paused.fleet).toBe(true);
    expect(paused.unfit, 'the counting copy: no "Not valid for this slot"').toBe(false);
    expect(paused.text, '…and no grey "Already taken" line either').not.toMatch(/Not valid for this slot|Already taken/);
    expect(paused.mark, 'it is not the copy the tweak is about').toBe(false);
    const bookOff = await third(off(twice(more('fleet', 1, false))));
    expect(bookOff.unfit, "Tweaks off: the book's display, unchanged").toBe(true);
    const none = await third(twice());
    expect(none.unfit, 'no tweak at all: the book display marks the 3rd-level copy too (measured)').toBe(true);
  });
  it('Tweaks off: the book display (the "Not valid for this slot" note, the pick kept), no mark; live: the mark and no note', async () => {
    const { r } = open(off(twice(more('fleet'))), '7');
    await flush();
    const card = generalCard(r.host)!;
    expect(card.textContent).toContain('Fleet');
    expect(card.querySelector('[data-unfit]')).toBeTruthy();
    expect(card.querySelector('[data-tweak-mark]')).toBeNull();
    for (const s of stops) s();
    stops = [];
    for (const n of [...document.body.children]) n.remove();
    const { r: r2 } = open(twice(more('fleet')), '7');
    await flush();
    const live = generalCard(r2.host)!;
    expect(live.querySelector('[data-more-takes="live"]')).toBeTruthy();
    expect(live.querySelector('[data-unfit]')).toBeNull();
  });
});

describe('the Tweaks page alone', () => {
  it('"Take a feat more times" → Fleet → Add: one block, and a second general slot takes Fleet', async () => {
    const t = mountTweaks(db, hero(db, 'fighter', 7, ov(), { featPicks: { '3:general:0': 'fleet' } }));
    stops.push(t.stop);
    const ed = await openMenu(t.host, 'Take a feat more times');
    expect(partsOf(ed)).toEqual(['record', 'count', 'reason']);
    await pickPart(addEditor(t.host)!, 'Feat', 'Fleet');
    await press(addEditor(t.host)!.querySelector('button.tw-add-go'));
    const b = t.build();
    expect(moreBlocks(b)).toEqual([['fleet', 1, true]]);
    expect(eligibleFeatsForSlot(b, db, { level: 7, category: 'general', idx: 0 }).some((f) => f.id === 'fleet')).toBe(true);
    expect(rowBy(t.host, 'Fleet — may be taken 1 more time (taken 1 of 2)'), 'its row').toBeTruthy();
  });
  it("the row's count never goes below the copies used", async () => {
    const t = mountTweaks(db, hero(db, 'fighter', 11, ov(more('fleet', 2)), { featPicks: { '3:general:0': 'fleet', '7:general:0': 'fleet', '11:general:0': 'fleet' } }));
    stops.push(t.stop);
    const row = rowBy(t.host, 'Fleet — may be taken 2 more times (taken 3 of 3)')!;
    expect(row, 'the row').toBeTruthy();
    await press(row.querySelector('button.tw-row-head'));
    const box = row.querySelector<HTMLInputElement>('input[aria-label="More times"]')!;
    expect(box.min).toBe('2');
    expect(row.textContent).toContain('At least 2');
  });
});
