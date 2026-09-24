// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { useEffect, useLayoutEffect, useState, act } from 'react';
import { createRoot } from 'react-dom/client';
import { content } from './_content';
import { normalizeCharacter } from '../src/rules/normalize';
import { emptyPlay, moveInventoryItem, type PlayState, type PlayUpdater } from '../src/rules/play';
import { planAttach } from '../src/rules/attachments';
import { CustomizationContext, DEFAULT_CUSTOMIZATION } from '../src/data/customization';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import type { Character, Customization, InventoryItem, Item } from '../src/rules/types';

// The rune drop below ends in a confirm ("Etch … onto …?"). The dialog is a real modal with a real
// promise; this test is about which DROP the row took, so the answer is always yes.
vi.mock('../src/sheet/confirm', () => ({
  confirmDialog: () => Promise.resolve(true),
  chooseDialog: () => Promise.resolve(null),
}));

// Imported AFTER the mock declaration (vi.mock is hoisted, so the order here is cosmetic — but the
// tab pulls in confirm.tsx transitively and this keeps that obvious).
const { InventoryTab } = await import('../src/sheet/InventoryTab');

/**
 * DRAG (computer) and ARROWS (phone) TO REORDER an inventory row inside its own section.
 *
 * The order a player puts their gear in IS the order of `character.inventory` — the sections are
 * filters over that one array — so a reorder is a move within it, saved by the ordinary inventory
 * persist path (moveInventoryItem). Nothing else about the row may change.
 *
 * The risk this file exists for is CONFUSION between the three things a card can receive:
 *   • a drop at the top/bottom quarter of a row → reorder before/after it (the left/right quarter
 *     where the rows run across — a grid of several columns, or Flow);
 *   • a drop in its middle → the drop the card already had (etch a rune onto a weapon), or, for a row
 *     that is not an attach host, the enclosing section's relocate (Equipped / Carried / a container).
 * The rune tests below are the same two cards and the same drag at two different HEIGHTS, so a change
 * that lets one gesture swallow the other goes red.
 *
 * MUTATION LINES
 *   1. In InventoryTab.tsx set `const REORDER_EDGE = 0.5` (the whole row becomes a reorder zone):
 *      "a rune dropped on the middle of a weapon still etches" goes red — the etch never happens.
 *   2. In InventoryTab.tsx drop the `sectionOf(src) !== sectionOf(target)` guard in reorderSideNow:
 *      "a drag from another section is not a reorder" goes red.
 *   3. In customization.ts flip `inventoryReorderArrows` to false: "arrows show by default on a phone"
 *      goes red.
 *   4. In InventoryTab.tsx delete the `if (sectionOf(inv) === dest) return;` line in moveTo: "a drop
 *      that misses the reorder edge, inside its own section, changes nothing at all" goes red — the
 *      worn backpack comes out un-worn.
 *   5. In InventoryTab.tsx make `const across = false` in reorderSideNow: "where the rows run ACROSS"
 *      goes red.
 *   6. In InventoryTab.tsx put `onPointerDown={(e) => e.stopPropagation()}` back on `.inv-reorder`:
 *      "a swipe that STARTS on an arrow still scrolls the list" goes red — the list never moves.
 *   7. In InventoryTab.tsx's startHold, arm the hold timer even on `.inv-reorder`: "a press HELD on an
 *      arrow never picks the item up" goes red — the drag ghost appears.
 *   8. In InventoryTab.tsx's dupSuffix, return 0 from the sort comparator (list order): "two
 *      Longswords keep their numbers when reordered" goes red.
 *   9. In InventoryTab.tsx's doReorder, take `wasItemId` from `character.inventory` at drop time
 *      instead of the drag ref: "a drop whose dragged row was replaced … moves nothing" goes red.
 */
const c = content();

const character = (inventory: InventoryItem[]): Character =>
  normalizeCharacter({
    id: 'ro',
    name: 'RO',
    level: 3,
    classId: 'fighter',
    keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    feats: [],
    inventory,
  } as unknown as Character);

const runeItem: Item | undefined = (() => {
  // A rune whose loose-item twin exists in content.items (that item is what a player drags) AND that
  // this character could really etch onto a plain longsword — asked of the planner itself, so the
  // fixture cannot drift into one the rules reject for a reason that has nothing to do with this file.
  const sword = c.items['longsword'];
  const hostInv: InventoryItem = { instanceId: 'h', itemId: 'longsword', quantity: 1 };
  for (const r of Object.values(c.runes)) {
    const it = c.items[r.id];
    if (!it || r.slot !== 'weapon') continue;
    const srcInv: InventoryItem = { instanceId: 's', itemId: it.id, quantity: 1 };
    if (planAttach(it, srcInv, sword, hostInv, [srcInv, hostInv], c, character([srcInv, hostInv])).ok) return it;
  }
  return undefined;
})();

/** A handle on the live play state, for an edit that lands from OUTSIDE the tab mid-gesture (a GM edit,
 *  another tab, a cloud pull). `afterCommit` runs once, right after the next render is on screen and
 *  before React's passive effects run — the window a real drop can land in. */
type Ctl = { set?: (fn: (p: PlayState) => PlayState) => void; afterCommit?: () => void };

function AfterCommit({ ctl }: { ctl: Ctl }) {
  useLayoutEffect(() => {
    const f = ctl.afterCommit;
    ctl.afterCommit = undefined;
    f?.();
  });
  return null;
}

/** The tab wired to a live play state, exactly as the sheet wires it: every edit goes through onPlay. */
function Harness({
  initial,
  custom,
  mobile,
  ctl,
  onPlay: report,
}: {
  initial: InventoryItem[];
  custom?: Partial<Customization>;
  mobile?: boolean;
  ctl?: Ctl;
  onPlay: (p: PlayState) => void;
}) {
  const [play, setPlay] = useState<PlayState>({ ...emptyPlay(), inventory: initial });
  useEffect(() => report(play), [play, report]);
  const onPlay: PlayUpdater = (fn) => setPlay((cur) => fn(cur));
  if (ctl) ctl.set = onPlay;
  const el = <InventoryTab character={character(play.inventory ?? [])} content={c} onPlay={onPlay} />;
  return (
    <CustomizationContext.Provider value={{ ...DEFAULT_CUSTOMIZATION, ...custom }}>
      <ForceMobileContext.Provider value={mobile ?? false}>
        {el}
        {ctl && <AfterCommit ctl={ctl} />}
      </ForceMobileContext.Provider>
    </CustomizationContext.Provider>
  );
}

function mount(initial: InventoryItem[], opts: { custom?: Partial<Customization>; mobile?: boolean; ctl?: Ctl } = {}) {
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!window.matchMedia)
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let last: PlayState = { ...emptyPlay(), inventory: initial };
  const report = (p: PlayState) => {
    last = p;
  };
  act(() => {
    root.render(<Harness initial={initial} custom={opts.custom} mobile={opts.mobile} ctl={opts.ctl} onPlay={report} />);
  });
  return {
    host,
    order: () => (last.inventory ?? []).map((i) => i.instanceId),
    rows: () => last.inventory ?? [],
    stop: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const cards = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('.inv-card')];
const card = (host: HTMLElement, name: string) =>
  cards(host).find((e) => (e.querySelector('.inv-name')?.textContent ?? '').toLowerCase().includes(name.toLowerCase()))!;
/** The section box whose header reads `title` (its own onDrop is the existing relocate). */
const group = (host: HTMLElement, title: string) =>
  [...host.querySelectorAll<HTMLElement>('.inv-group')].find(
    (g) => (g.querySelector('.inv-sec-title')?.textContent ?? '') === title,
  )!;

/** jsdom lays nothing out, so a row has no height and no position — give this one both. */
function box(el: HTMLElement, top = 100, height = 40) {
  el.getBoundingClientRect = () =>
    ({ top, bottom: top + height, height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  return { top, height };
}

/** One gesture's clipboard: the id is written at dragstart and read back at drop, as the browser does. */
function transfer() {
  const data: Record<string, string> = {};
  return {
    dropEffect: '',
    effectAllowed: '',
    setData: (k: string, v: string) => {
      data[k] = v;
    },
    getData: (k: string) => data[k] ?? '',
  };
}

function fire(el: Element, type: string, dt: ReturnType<typeof transfer>, clientY = 0, clientX = 100) {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(e, 'dataTransfer', { value: dt });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

const SWORD: InventoryItem = { instanceId: 'i1', itemId: 'longsword', quantity: 1, equipped: true };
const AXE: InventoryItem = { instanceId: 'i2', itemId: 'battle-axe', quantity: 1, equipped: true };
const DAGGER: InventoryItem = { instanceId: 'i3', itemId: 'dagger', quantity: 1, equipped: true };
const ROPE: InventoryItem = { instanceId: 'i4', itemId: 'rope', quantity: 1 };

describe('moveInventoryItem — the stored order is the array order', () => {
  const base: PlayState = { ...emptyPlay(), inventory: [SWORD, AXE, DAGGER] };

  it('moves a row before another', () => {
    expect((moveInventoryItem(base, 'i3', 'i1', 'before').inventory ?? []).map((i) => i.instanceId)).toEqual(['i3', 'i1', 'i2']);
  });

  it('moves a row after another', () => {
    expect((moveInventoryItem(base, 'i1', 'i3', 'after').inventory ?? []).map((i) => i.instanceId)).toEqual(['i2', 'i3', 'i1']);
  });

  it('changes nothing but the position — same rows, same fields', () => {
    const out = moveInventoryItem(base, 'i3', 'i1', 'before');
    expect([...(out.inventory ?? [])].sort((a, b) => a.instanceId.localeCompare(b.instanceId))).toEqual([SWORD, AXE, DAGGER]);
  });

  it('is a no-op when the row, or the row it was aimed at, is gone', () => {
    expect(moveInventoryItem(base, 'nope', 'i1', 'before')).toBe(base);
    expect(moveInventoryItem(base, 'i1', 'nope', 'before')).toBe(base);
    expect(moveInventoryItem(base, 'i1', 'i1', 'before')).toBe(base);
  });
});

describe('drag to reorder (computer)', () => {
  it('draws the drop line at the edge the row would land on, and moves it there', () => {
    const t = mount([SWORD, AXE, DAGGER]);
    const dt = transfer();
    fire(card(t.host, 'Dagger'), 'dragstart', dt);
    const sword = card(t.host, 'Longsword');
    const { top, height } = box(sword);
    fire(sword, 'dragover', dt, top + height * 0.1); // top quarter → "before this row"
    expect(card(t.host, 'Longsword').className).toContain('reorder-before');
    fire(card(t.host, 'Longsword'), 'drop', dt, top + height * 0.1);
    expect(t.order()).toEqual(['i3', 'i1', 'i2']);
    // …and only the position: every row is the object it was.
    expect([...t.rows()].sort((a, b) => a.instanceId.localeCompare(b.instanceId))).toEqual([SWORD, AXE, DAGGER]);
    t.stop();
  });

  it('the bottom quarter drops it after that row', () => {
    const t = mount([SWORD, AXE, DAGGER]);
    const dt = transfer();
    fire(card(t.host, 'Dagger'), 'dragstart', dt);
    const sword = card(t.host, 'Longsword');
    const { top, height } = box(sword);
    fire(sword, 'dragover', dt, top + height * 0.9);
    expect(card(t.host, 'Longsword').className).toContain('reorder-after');
    fire(card(t.host, 'Longsword'), 'drop', dt, top + height * 0.9);
    expect(t.order()).toEqual(['i1', 'i3', 'i2']);
    t.stop();
  });

  it('the middle of a row is not a reorder zone — no line is drawn there', () => {
    const t = mount([SWORD, AXE, DAGGER]);
    const dt = transfer();
    fire(card(t.host, 'Dagger'), 'dragstart', dt);
    const sword = card(t.host, 'Longsword');
    const { top, height } = box(sword);
    fire(sword, 'dragover', dt, top + height * 0.5);
    expect(cards(t.host).some((e) => /reorder-(before|after)/.test(e.className))).toBe(false);
    t.stop();
  });

  it('where the rows run ACROSS (a grid of several columns), the zones are the left/right quarters', () => {
    const t = mount([SWORD, AXE, DAGGER]);
    const dt = transfer();
    fire(card(t.host, 'Dagger'), 'dragstart', dt);
    const axe = card(t.host, 'Battle Axe');
    // jsdom lays nothing out; say what a computer's 230px auto-fill grid resolves to.
    const grid = axe.parentElement!;
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '230px 230px 230px';
    const { top } = box(axe); // x 0–200
    // Top quarter but the MIDDLE of the width: across, that is the card's middle — no line.
    fire(axe, 'dragover', dt, top + 2, 100);
    expect(cards(t.host).some((e) => /reorder-(before|after)/.test(e.className))).toBe(false);
    // Left quarter → before it, with the line drawn down its left edge.
    fire(axe, 'dragover', dt, top + 20, 20);
    expect(card(t.host, 'Battle Axe').className).toContain('reorder-before');
    expect(card(t.host, 'Battle Axe').className).toContain('reorder-across');
    fire(card(t.host, 'Battle Axe'), 'drop', dt, top + 20, 20);
    expect(t.order()).toEqual(['i1', 'i3', 'i2']);
    t.stop();
  });

  it('a drag from another section is not a reorder (a section says where an item IS)', () => {
    const t = mount([SWORD, AXE, ROPE]);
    const dt = transfer();
    fire(card(t.host, 'Rope'), 'dragstart', dt); // Carried
    const sword = card(t.host, 'Longsword'); // Equipped
    const { top, height } = box(sword);
    fire(sword, 'dragover', dt, top + height * 0.1);
    expect(cards(t.host).some((e) => /reorder-(before|after)/.test(e.className))).toBe(false);
    fire(card(t.host, 'Longsword'), 'drop', dt, top + height * 0.1);
    expect(t.order()).toEqual(['i1', 'i2', 'i4']); // untouched
    t.stop();
  });

  it('a drop that misses the reorder edge, inside its own section, changes nothing at all', () => {
    // A worn backpack sits in Carried beside the rope. Its middle is not a reorder zone, so the drop
    // falls through to the Carried section — the section the pack is ALREADY in. That used to run the
    // relocate anyway and write Carried's defaults over its flags: the pack came out un-worn.
    const pack: InventoryItem = { instanceId: 'i9', itemId: 'backpack', quantity: 1, worn: true };
    const t = mount([ROPE, pack]);
    const dt = transfer();
    fire(card(t.host, 'Backpack'), 'dragstart', dt);
    const rope = card(t.host, 'Rope');
    const { top, height } = box(rope);
    fire(rope, 'dragover', dt, top + height * 0.5);
    fire(card(t.host, 'Rope'), 'drop', dt, top + height * 0.5);
    expect(t.rows()).toEqual([ROPE, pack]);
    // …and the same drop straight onto the Carried section's own box.
    const dt2 = transfer();
    fire(card(t.host, 'Backpack'), 'dragstart', dt2);
    const sec = group(t.host, 'Carried');
    fire(sec, 'dragover', dt2);
    expect(sec.className).not.toContain('drop-ok');
    fire(sec, 'drop', dt2);
    expect(t.rows()).toEqual([ROPE, pack]);
    t.stop();
  });

  it('dropping on a container section still moves the item into it', () => {
    const pack: InventoryItem = { instanceId: 'i9', itemId: 'backpack', quantity: 1, worn: true };
    const t = mount([SWORD, ROPE, pack]);
    const dt = transfer();
    fire(card(t.host, 'Rope'), 'dragstart', dt);
    const sec = group(t.host, 'In Backpack');
    expect(sec).toBeTruthy();
    fire(sec, 'dragover', dt);
    fire(sec, 'drop', dt);
    expect(t.rows().find((i) => i.instanceId === 'i4')?.containerInstanceId).toBe('i9');
    t.stop();
  });

  it('a rune dropped on the MIDDLE of a weapon still etches onto it', async () => {
    expect(runeItem).toBeTruthy();
    const rune: InventoryItem = { instanceId: 'i5', itemId: runeItem!.id, quantity: 1 };
    const sword: InventoryItem = { instanceId: 'i1', itemId: 'longsword', quantity: 1 };
    const t = mount([sword, rune]); // BOTH carried, so the edge/middle split is the only difference
    const dt = transfer();
    fire(card(t.host, runeItem!.name), 'dragstart', dt);
    const target = card(t.host, 'Longsword');
    const { top, height } = box(target);
    fire(target, 'dragover', dt, top + height * 0.5);
    fire(card(t.host, 'Longsword'), 'drop', dt, top + height * 0.5);
    await act(async () => undefined); // the confirm is a promise
    const after = t.rows().find((i) => i.instanceId === 'i1');
    expect(after?.runes && Object.keys(after.runes).length).toBeTruthy();
    expect(t.order()).not.toContain('i5'); // the loose rune was consumed by the etch
    t.stop();
  });

  it('the same rune on the TOP QUARTER of that weapon reorders instead of etching', () => {
    expect(runeItem).toBeTruthy();
    const rune: InventoryItem = { instanceId: 'i5', itemId: runeItem!.id, quantity: 1 };
    const sword: InventoryItem = { instanceId: 'i1', itemId: 'longsword', quantity: 1 };
    const t = mount([sword, rune]);
    const dt = transfer();
    fire(card(t.host, runeItem!.name), 'dragstart', dt);
    const target = card(t.host, 'Longsword');
    const { top, height } = box(target);
    fire(target, 'dragover', dt, top + height * 0.1);
    fire(card(t.host, 'Longsword'), 'drop', dt, top + height * 0.1);
    expect(t.order()).toEqual(['i5', 'i1']);
    expect(t.rows().find((i) => i.instanceId === 'i1')?.runes).toBeUndefined();
    t.stop();
  });

  it('a drop whose dragged row was replaced by the item that took its id moves nothing', () => {
    // The drag outlives its row: a GM edit, another tab or a cloud pull removes the rope mid-drag, and
    // `nextInstanceId` (max + 1) hands the freed id to the next item acquired — a dagger, Carried, the
    // section the drop aims at. The sheet is already showing the dagger under that id when the drop
    // lands (the tab lets go of a gone drag in an effect, which runs after), so the id alone now names
    // the dagger; only the item the drag GRABBED says this is not the rope.
    const torch: InventoryItem = { instanceId: 'inv-0', itemId: 'torch', quantity: 1 };
    const rope: InventoryItem = { instanceId: 'inv-1', itemId: 'rope', quantity: 1 };
    const ctl: Ctl = {};
    const t = mount([torch, rope], { ctl });
    const dt = transfer();
    fire(card(t.host, 'Rope'), 'dragstart', dt);
    const { top, height } = box(card(t.host, 'Torch'));
    fire(card(t.host, 'Torch'), 'dragover', dt, top + height * 0.1);
    expect(card(t.host, 'Torch').className, 'fixture: the drag must be aimed as a reorder').toContain('reorder-before');
    let daggerShown = false;
    act(() => {
      ctl.afterCommit = () => {
        daggerShown = !!card(t.host, 'Dagger');
        const e = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 100, clientY: top + height * 0.1 });
        Object.defineProperty(e, 'dataTransfer', { value: dt });
        card(t.host, 'Torch').dispatchEvent(e);
      };
      ctl.set!((p) => ({ ...p, inventory: [torch, { instanceId: 'inv-1', itemId: 'dagger', quantity: 1 }] }));
    });
    expect(daggerShown, 'fixture: the drop must land while the dagger holds the id').toBe(true);
    expect(t.order(), 'the drop moved an item the player never picked up').toEqual(['inv-0', 'inv-1']);
    t.stop();
  });
});

describe('reorder arrows (phone)', () => {
  const arrowsIn = (host: HTMLElement, name: string) =>
    [...card(host, name).querySelectorAll<HTMLButtonElement>('.inv-reorder-btn')];

  it('show by default on a phone, and move the row one step', () => {
    const t = mount([SWORD, AXE, DAGGER], { mobile: true });
    const down = arrowsIn(t.host, 'Longsword')[1];
    expect(down).toBeTruthy();
    act(() => down.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(t.order()).toEqual(['i2', 'i1', 'i3']);
    const up = arrowsIn(t.host, 'Longsword')[0];
    act(() => up.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(t.order()).toEqual(['i1', 'i2', 'i3']);
    t.stop();
  });

  it('stop at the ends — the first row cannot go up, the last cannot go down', () => {
    const t = mount([SWORD, AXE, DAGGER], { mobile: true });
    expect(arrowsIn(t.host, 'Longsword')[0].disabled).toBe(true);
    expect(arrowsIn(t.host, 'Longsword')[1].disabled).toBe(false);
    expect(arrowsIn(t.host, 'Dagger')[0].disabled).toBe(false);
    expect(arrowsIn(t.host, 'Dagger')[1].disabled).toBe(true);
    // A press on a dead end changes nothing (and does not open the item's popup).
    act(() => arrowsIn(t.host, 'Longsword')[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(t.order()).toEqual(['i1', 'i2', 'i3']);
    t.stop();
  });

  it('the customization key hides them', () => {
    const t = mount([SWORD, AXE, DAGGER], { mobile: true, custom: { inventoryReorderArrows: false } });
    expect(t.host.querySelectorAll('.inv-reorder-btn')).toHaveLength(0);
    t.stop();
  });

  it('are a phone control — a computer reorders by dragging', () => {
    const t = mount([SWORD, AXE, DAGGER], { mobile: false });
    expect(t.host.querySelectorAll('.inv-reorder-btn')).toHaveLength(0);
    t.stop();
  });

  it('an arrow press does not open the item popup', () => {
    const t = mount([SWORD, AXE, DAGGER], { mobile: true });
    act(() => arrowsIn(t.host, 'Longsword')[1].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(t.host.querySelector('.picker-overlay')).toBeNull();
    t.stop();
  });

  // jsdom has no PointerEvent — the type is what React routes on. One pointer id for the whole gesture.
  const pointer = (type: string, target: EventTarget, clientY: number) => {
    const e = new MouseEvent(type, { bubbles: true, clientX: 300, clientY });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    act(() => void target.dispatchEvent(e));
  };

  it('a swipe that STARTS on an arrow still scrolls the list', () => {
    // On a phone the rows are touch-action:none, so the browser never scrolls a swipe that begins on
    // one — the row's own pointerdown (the hold-to-move tracker) does. The arrows sit on the right edge
    // of every row, where a right thumb swipes; an arrow that swallowed pointerdown left that strip of
    // the list unscrollable.
    const t = mount([SWORD, AXE, DAGGER], { mobile: true });
    const list = t.host; // jsdom lays nothing out: make the host the scrolling box, 700px overflowing
    list.style.overflowY = 'auto';
    Object.defineProperty(list, 'scrollHeight', { value: 1000 });
    Object.defineProperty(list, 'clientHeight', { value: 300 });
    Object.defineProperty(list, 'scrollTop', { value: 200, writable: true });
    pointer('pointerdown', arrowsIn(t.host, 'Battle Axe')[1], 100);
    pointer('pointermove', window, 60); // past the 10px slop → a scroll, finger up 40px
    pointer('pointermove', window, 30);
    pointer('pointerup', window, 30);
    expect(list.scrollTop).toBe(270);
    expect(t.order()).toEqual(['i1', 'i2', 'i3']); // a swipe is not a press
    t.stop();
  });

  it('a press HELD on an arrow never picks the item up — and the tap still moves it', async () => {
    const t = mount([SWORD, AXE, DAGGER], { mobile: true });
    const down = arrowsIn(t.host, 'Battle Axe')[1];
    pointer('pointerdown', down, 100);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 520)); // past the 450 ms hold that arms a card
    });
    expect(document.querySelector('.inv-drag-ghost')).toBeNull();
    pointer('pointerup', window, 100);
    act(() => down.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(t.order()).toEqual(['i1', 'i3', 'i2']);
    t.stop();
  });
});

describe('copy numbers follow the item, not its place in the list', () => {
  it('two Longswords keep their numbers when reordered', () => {
    // Numbered by acquisition (the instanceId's counter, compared as a number: 9 before 10), so a
    // reorder that swaps two copies swaps their CARDS, each keeping its number. Numbered by list
    // position, the cards read the same after the move as before — it looked like nothing happened.
    const older: InventoryItem = { instanceId: 'inv-9', itemId: 'longsword', quantity: 1, equipped: true };
    const newer: InventoryItem = { instanceId: 'inv-10', itemId: 'longsword', quantity: 1, equipped: true };
    const t = mount([newer, older], { mobile: true });
    const names = () => cards(t.host).map((e) => e.querySelector('.inv-name')?.textContent ?? '');
    expect(names()).toEqual(['Longsword 2', 'Longsword 1']);
    act(() => [...cards(t.host)[1].querySelectorAll<HTMLButtonElement>('.inv-reorder-btn')][0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(t.order()).toEqual(['inv-9', 'inv-10']);
    expect(names()).toEqual(['Longsword 1', 'Longsword 2']);
    t.stop();
  });

  it('the arrows say the name the row prints — "Move Longsword 2 up", never the same label twice', () => {
    // Before: both copies' arrows read "Move Longsword up" / "…down", so a screen reader could not
    // tell which row a press would move.
    const older: InventoryItem = { instanceId: 'inv-9', itemId: 'longsword', quantity: 1, equipped: true };
    const newer: InventoryItem = { instanceId: 'inv-10', itemId: 'longsword', quantity: 1, equipped: true };
    const t = mount([newer, older], { mobile: true });
    const labels = cards(t.host).map((e) =>
      [...e.querySelectorAll('.inv-reorder-btn')].map((b) => b.getAttribute('aria-label')),
    );
    expect(labels).toEqual([
      ['Move Longsword 2 up', 'Move Longsword 2 down'],
      ['Move Longsword 1 up', 'Move Longsword 1 down'],
    ]);
    // …which is the row's own printed name, not a second copy of the rule.
    for (const e of cards(t.host)) {
      expect(e.querySelector('.inv-reorder-btn')!.getAttribute('aria-label')).toBe(`Move ${e.querySelector('.inv-name')!.textContent} up`);
    }
    t.stop();
  });
});
