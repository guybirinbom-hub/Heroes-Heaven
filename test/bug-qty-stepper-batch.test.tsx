// @vitest-environment jsdom
import { useState } from 'react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { VitalsRail } from '../src/sheet/VitalsRail';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import { normalizeCharacter } from '../src/rules/normalize';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { applyPlayState, type PlayState } from '../src/rules/play';
import type { Character, InventoryItem } from '../src/rules/types';

/**
 * A stepper that does arithmetic on the value it RENDERED loses taps.
 *
 * `onPlay((p) => setItemQuantity(p, id, inv.quantity + 1))` reads `inv.quantity` from the render
 * closure, so two clicks inside one React batch both compute 3 + 1 and the stack moves by one. Tapping
 * "+" twice quickly is not an exotic case — it is how anyone buys four torches — and "+ then −" in one
 * batch left the count somewhere the player never asked for. The live value is only visible INSIDE the
 * updater, which is why the arithmetic moved into `bumpItemQuantity` / `bumpItemCounter` (rules/play).
 *
 * Both surfaces are driven as a player drives them: the inventory card's inline stepper, and the item
 * detail popup's Quantity and Uses rows.
 */
/** The rune-etching confirm, held open so the test can change the world behind it. */
const gate = vi.hoisted(() => ({ answer: null as ((v: boolean) => void) | null }));
vi.mock('../src/sheet/confirm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/sheet/confirm')>()),
  confirmDialog: () =>
    new Promise<boolean>((resolve) => {
      gate.answer = resolve;
    }),
}));

const c = content();
const noop = () => undefined;

const POTION = 'healing-potion-minor';
const CHIME = 'chime-of-opening'; // 10 activations, so a counter has room to move twice

const INV: InventoryItem[] = [
  { instanceId: 'inv-0', itemId: 'longsword', quantity: 1, equipped: true },
  { instanceId: 'inv-1', itemId: POTION, quantity: 3 },
  { instanceId: 'inv-2', itemId: CHIME, quantity: 1, worn: true },
];

const baseChar = (inventory: InventoryItem[]): Character =>
  normalizeCharacter({
    id: 'q',
    name: 'Q',
    level: 3,
    classId: 'fighter',
    keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    feats: [],
    inventory,
  } as unknown as Character);

/** A live play state behind the real component, plus a handle the test can drive it with. */
type Ctl = { set?: (fn: (p: PlayState) => PlayState) => void; play?: PlayState };

function TabHarness({ ctl, start }: { ctl: Ctl; start: InventoryItem[] }) {
  const [play, setPlay] = useState<PlayState>({ inventory: start } as PlayState);
  ctl.set = (fn) => setPlay((p) => fn(p));
  ctl.play = play;
  return (
    <InventoryTab
      character={baseChar(play.inventory ?? [])}
      content={c}
      onPlay={(fn) => setPlay((p) => fn(p))}
      onCreateItem={() => undefined} // enables the detail popup's pencil → the item editor
    />
  );
}

/** A drag event carrying a dataTransfer — jsdom implements no DataTransfer constructor, and the
 *  frozen `text/plain` payload is exactly the part of a real drag that outlives its own row. */
function dragEvent(type: string, data: string) {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', {
    value: { getData: () => data, setData: () => undefined, dropEffect: '', effectAllowed: '' },
  });
  return e;
}

function DetailHarness({ itemId }: { itemId: string }) {
  const [play, setPlay] = useState<PlayState>({ inventory: INV } as PlayState);
  const inv = (play.inventory ?? []).find((i) => i.itemId === itemId)!;
  return (
    <ItemDetail
      inv={inv}
      item={c.items[itemId]}
      content={c}
      inventory={play.inventory ?? []}
      feats={[]}
      charLevel={3}
      onClose={noop}
      onPlay={(fn) => setPlay((p) => fn(p))}
    />
  );
}

/** Click every one of `targets` inside ONE React batch — two taps before a re-render, which is what
 *  a double-tap on a phone actually produces. */
const batchClick = (...targets: (Element | null | undefined)[]) =>
  act(() => {
    for (const t of targets) {
      expect(t, 'stepper button not found').toBeTruthy();
      t!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });

describe('a quantity/use stepper counts every tap, not just the last render', () => {
  // bug 2026-09-13: edits overwritten (D2)
  it('inventory card: two "+" in one batch move the stack by two', () => {
    const ctl: Ctl = {};
    const { host, stop } = renderDom(<TabHarness ctl={ctl} start={INV} />);
    const card = () => [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Potion'))!;
    const qty = () => card().querySelector('.inv-qtystep span')?.textContent;
    const plus = () => card().querySelector<HTMLButtonElement>('button[aria-label="Increase quantity"]');
    expect(qty()).toBe('3');
    batchClick(plus(), plus());
    expect(qty(), 'the second tap was computed from the value the first one replaced').toBe('5');
    stop();
  });

  // bug 2026-09-13: edits overwritten (D2)
  it('inventory card: "+" then "−" in one batch leaves the stack where it was', () => {
    const ctl: Ctl = {};
    const { host, stop } = renderDom(<TabHarness ctl={ctl} start={INV} />);
    const card = () => [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Potion'))!;
    const qty = () => card().querySelector('.inv-qtystep span')?.textContent;
    batchClick(
      card().querySelector('button[aria-label="Increase quantity"]'),
      card().querySelector('button[aria-label="Decrease quantity"]'),
    );
    expect(qty(), 'a tap that cancels another must land on the value it started from').toBe('3');
    stop();
  });

  // bug 2026-09-13: edits overwritten (D2)
  it('detail popup: two "+" in one batch move the stack by two', () => {
    const { host, stop } = renderDom(<DetailHarness itemId={POTION} />);
    const count = () => host.querySelector('.sd-uses-count')?.textContent;
    const plus = () => host.querySelector('button[aria-label="Increase quantity"]');
    expect(count()).toBe('3');
    batchClick(plus(), plus());
    expect(count()).toBe('5');
    stop();
  });

  // bug 2026-09-13: edits overwritten (D2)
  it('detail popup: two "spend a use" in one batch spend two', () => {
    const { host, stop } = renderDom(<DetailHarness itemId={CHIME} />);
    const uses = () => host.querySelector('.sd-uses-count')?.textContent?.replace(/\s+/g, '');
    const spend = () => host.querySelector('button[aria-label="Spend a use"]');
    expect(uses()).toBe('10/10');
    batchClick(spend(), spend());
    expect(uses(), 'the tracker forgot a use — the player has to fix the app’s arithmetic').toBe('8/10');
    stop();
  });
});

describe('an open popup never re-binds to whatever takes its instance id', () => {
  // bug 2026-09-13: edits overwritten (D3)
  it('closes the item detail when its row leaves the inventory, so a reused id cannot capture it', () => {
    const ctl: Ctl = {};
    // inv-2 is the highest-numbered row, so `nextInstanceId` hands its id straight to the next item.
    const { host, click, stop } = renderDom(<TabHarness ctl={ctl} start={INV} />);
    const openName = () => host.querySelector('.sd-head-name')?.textContent;
    click([...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Chime'))!);
    expect(openName(), 'fixture: the popup must be open on the chime').toBe('Chime of Opening');
    // The row goes (sold, consumed, dropped, taken by a GM edit) and a new item is acquired, which
    // takes the freed id. The popup was still holding it.
    act(() => {
      ctl.set!((p) => ({
        ...p,
        inventory: [...(p.inventory ?? []).filter((i) => i.instanceId !== 'inv-2'), { instanceId: 'inv-2', itemId: 'shortbow', quantity: 7 }],
      }));
    });
    expect(openName(), 'the popup silently re-opened on a different item — every control in it now edits that one').not.toBe('Shortbow');
    expect(host.querySelector('.sd-head-name'), 'an item that is gone has no detail view').toBeFalsy();
    // The header is the snapshot, so it would keep SAYING "Chime of Opening" while every control in
    // the popup — quantity, uses, stow, trash — acted on the bow that took its id. The bow's stack of
    // 7 showing up under the chime's name is what that looks like.
    expect(host.querySelector('.sd-uses-count')?.textContent, 'the popup is now editing the item that took the id').toBeUndefined();
    stop();
  });

  // bug 2026-09-13: edits overwritten (D3)
  it('closes the item editor when its row leaves, so Save cannot rewrite whatever took the id', () => {
    // The editor's Save writes `{ itemId: <the item you picked> }` to the instance id it was opened
    // on. Left open over a replaced row it would rename a different item — an edit to something the
    // player never opened, and one the sheet gives no clue about.
    const ctl: Ctl = {};
    const { host, click, stop } = renderDom(<TabHarness ctl={ctl} start={INV} />);
    click([...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Chime'))!);
    click(host.querySelector('[aria-label="Edit item"]'));
    expect(host.querySelector('.item-edit .ie-title')?.textContent, 'fixture: the editor must be open').toBe('Edit item');
    act(() => {
      ctl.set!((p) => ({
        ...p,
        inventory: [...(p.inventory ?? []).filter((i) => i.instanceId !== 'inv-2'), { instanceId: 'inv-2', itemId: 'shortbow', quantity: 1 }],
      }));
    });
    expect(host.querySelector('.item-edit'), 'the editor is still pointed at an id that now belongs to another item').toBeFalsy();
    stop();
  });

  // bug 2026-09-13: edits overwritten (D3)
  it('refuses a drop whose dragged row was replaced by the item that took its id', () => {
    // The drag is the holder that survives its own row: `dragstart` freezes the instance id into the
    // drag's dataTransfer, which keeps carrying it after the row is gone (a GM edit, another tab, a
    // cloud pull all land mid-gesture), and the drop read that payload in preference to anything the
    // component still knew. The bow that took the id was stowed in the backpack — a move of an item
    // the player never touched.
    const ctl: Ctl = {};
    const withBag: InventoryItem[] = [
      { instanceId: 'inv-0', itemId: 'longsword', quantity: 1, equipped: true },
      { instanceId: 'inv-1', itemId: 'backpack', quantity: 1, worn: true },
      { instanceId: 'inv-2', itemId: 'torch', quantity: 1 },
    ];
    const { host, stop } = renderDom(<TabHarness ctl={ctl} start={withBag} />);
    const card = (text: string) => [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes(text))!;
    act(() => card('Torch').dispatchEvent(dragEvent('dragstart', 'inv-2')));
    act(() => {
      ctl.set!((p) => ({
        ...p,
        inventory: [...(p.inventory ?? []).filter((i) => i.instanceId !== 'inv-2'), { instanceId: 'inv-2', itemId: 'dagger', quantity: 1 }],
      }));
    });
    const bag = [...host.querySelectorAll<HTMLElement>('.inv-group')].find((g) => (g.querySelector('.inv-sec-title')?.textContent ?? '').includes('Backpack'));
    expect(bag, 'fixture: the backpack must render as a drop target').toBeTruthy();
    // Nothing is being carried any more, so nothing lights up as somewhere to put it.
    act(() => bag!.dispatchEvent(dragEvent('dragover', 'inv-2')));
    expect(bag!.className, 'the app still offers to drop an item that is gone').not.toContain('drop-ok');
    act(() => bag!.dispatchEvent(dragEvent('drop', 'inv-2')));
    const dagger = (ctl.play!.inventory ?? []).find((i) => i.itemId === 'dagger');
    expect(dagger?.containerInstanceId, 'the drop moved an item the player never picked up').toBeUndefined();
    stop();
  });

  // bug 2026-09-13: edits overwritten (D3)
  it('refuses a phone hold-to-move whose row was replaced while the finger was down', async () => {
    // The hold is the longer gesture of the two — 450 ms to arm, then however long the finger travels
    // — and it keeps only an instance id. Same ending: the row is gone, the id belongs to something
    // else, and the lift stows an item the player never picked up.
    const ctl: Ctl = {};
    const withBag: InventoryItem[] = [
      { instanceId: 'inv-0', itemId: 'longsword', quantity: 1, equipped: true },
      { instanceId: 'inv-1', itemId: 'backpack', quantity: 1, worn: true },
      { instanceId: 'inv-2', itemId: 'torch', quantity: 1 },
    ];
    const { host, stop } = renderDom(
      <ForceMobileContext.Provider value={true}>
        <TabHarness ctl={ctl} start={withBag} />
      </ForceMobileContext.Provider>,
    );
    // Phone layout is an accordion: open the section the torch is carried in before grabbing it.
    const carried = host.querySelector<HTMLElement>('[data-drop-dest="carried"]')!;
    act(() => void carried.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const card = [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes('Torch'));
    expect(card, 'fixture: the torch card must be on screen to grab it').toBeTruthy();
    const pointer = (type: string, target: EventTarget) => {
      const e = new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10 });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      act(() => void target.dispatchEvent(e));
    };
    pointer('pointerdown', card!);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 520)); // the 450 ms hold arms
    });
    act(() => {
      ctl.set!((p) => ({
        ...p,
        inventory: [...(p.inventory ?? []).filter((i) => i.instanceId !== 'inv-2'), { instanceId: 'inv-2', itemId: 'dagger', quantity: 1 }],
      }));
    });
    const dest = host.querySelector<HTMLElement>('[data-drop-dest="inv-1"]');
    expect(dest, 'fixture: the backpack section must be a drop destination').toBeTruthy();
    document.elementFromPoint = () => dest;
    pointer('pointerup', window);
    const dagger = (ctl.play!.inventory ?? []).find((i) => i.itemId === 'dagger');
    expect(dagger?.containerInstanceId, 'the lift stowed an item the player never picked up').toBeUndefined();
    stop();
  });
});

describe('an etch reads the stack as it is when the player says yes', () => {
  // bug 2026-09-13: edits overwritten (D2)
  it('decrements a stack that grew while the confirm was open, instead of deleting it', async () => {
    // `attachDrop` captures the loose rune's row, then awaits a confirm. Whatever reaches the sheet
    // during that wait — a GM handing over loot, another tab, a cloud pull — is invisible to that
    // snapshot: it still said "quantity 1", so etching one rune removed the whole stack of three.
    const potency = Object.values(c.runes).find((r) => r.kind === 'potency' && r.slot === 'weapon')!;
    const runeItem = c.items[potency.id]!;
    const ctl: Ctl = {};
    const start: InventoryItem[] = [
      { instanceId: 'inv-0', itemId: 'longsword', quantity: 1, equipped: true },
      { instanceId: 'inv-1', itemId: runeItem.id, quantity: 1 },
    ];
    const { host, stop } = renderDom(<TabHarness ctl={ctl} start={start} />);
    const card = (text: string) => [...host.querySelectorAll<HTMLElement>('.inv-card')].find((e) => (e.textContent ?? '').includes(text));
    const rune = card(runeItem.name);
    const sword = card('Longsword');
    expect(rune && sword, 'fixture: both cards must render').toBeTruthy();
    act(() => void rune!.dispatchEvent(dragEvent('dragstart', 'inv-1')));
    act(() => void sword!.dispatchEvent(dragEvent('drop', 'inv-1')));
    expect(gate.answer, 'fixture: the etch must have asked for confirmation').toBeTruthy();
    // Two more of the same rune arrive while the question is on screen.
    act(() => {
      ctl.set!((p) => ({ ...p, inventory: (p.inventory ?? []).map((i) => (i.instanceId === 'inv-1' ? { ...i, quantity: 3 } : i)) }));
    });
    await act(async () => {
      gate.answer!(true);
      await Promise.resolve();
    });
    const left = (ctl.play!.inventory ?? []).find((i) => i.instanceId === 'inv-1');
    expect(left?.quantity, 'etching one rune took the whole stack with it').toBe(2);
    stop();
  });
});

/**
 * The same lost tap, on the rail.
 *
 * Focus points, versatile vials, stratagems — the class-resource +/− buttons computed `val ± 1` from
 * the value they had rendered, so a player spending two in one burst mid-encounter moved the tracker
 * once and had to fix the app's arithmetic by hand.
 */
describe('a class-resource stepper counts every tap', () => {
  // bug 2026-09-13: edits overwritten (D2)
  it('two "−" in one batch spend two', () => {
    const build: BuildState = {
      ...emptyBuild(),
      name: 'Alch',
      level: 3,
      ancestryId: 'human',
      heritageId: 'versatile-human',
      backgroundId: 'acolyte',
      classId: 'alchemist',
      keyAbility: 'int',
    };
    const built = buildCharacter(build, c);
    function Rail() {
      const [play, setPlay] = useState<PlayState>({} as PlayState);
      return <VitalsRail character={applyPlayState(built, play, c)} content={c} onPlay={(fn) => setPlay((p) => fn(p))} />;
    }
    const { host, stop } = renderDom(<Rail />);
    const val = () => host.querySelector('.res-val')?.textContent?.replace(/\s+/g, '');
    const minus = () => host.querySelector<HTMLButtonElement>('.res-step button[aria-label="Decrease"]');
    expect(val(), 'fixture: the vial pool must render full').toBe('3/3');
    batchClick(minus(), minus());
    expect(val(), 'the second tap was computed from the value the first one replaced').toBe('1/3');
    stop();
  });
});
