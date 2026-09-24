// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState, act } from 'react';
import { createRoot } from 'react-dom/client';
import { content } from './_content';
import { InventoryTab } from '../src/sheet/InventoryTab';
import { normalizeCharacter } from '../src/rules/normalize';
import { emptyPlay, packQuantity, type PlayState, type PlayUpdater } from '../src/rules/play';
import { CustomizationContext, DEFAULT_CUSTOMIZATION } from '../src/data/customization';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import type { Character, CompanionConfig, InventoryItem } from '../src/rules/types';

/**
 * "ADDED" INDICATION — adding an item from the Add-items picker has to be SEEN.
 *
 * The picker stays open on purpose (you usually buy several things at once), and the new row lands at
 * the bottom of a section that may be scrolled away, so before this the only feedback that a Give/Buy
 * did anything was the coin total moving. Two marks now: a short line at the bottom of the screen
 * ("Added Longsword", "Added 10 × Wooden Taws"), one per press, above the still-open picker; and, once
 * the picker closes, an outline on every row it added that fades after ~2 s. (The outline waits for the
 * close because the picker is a full-screen overlay: played behind it, nobody would see it.)
 *
 * MUTATION LINES
 *   1. In InventoryTab.tsx delete the `armAdded(item, init.quantity)` call before the plain add:
 *      every pack test here goes red — that call is the only thing that arms either mark.
 *   2. In InventoryTab.tsx make the toast text `Added ${item.name}` with no quantity: the pack test
 *      ("Added 10 × Wooden Taws") goes red.
 *   3. In InventoryTab.tsx drop `!addOpen &&` from `justAdded`: "shows the toast at once, and outlines
 *      the new row once the picker closes" goes red (the outline is there while the picker is up).
 *   4. In InventoryTab.tsx delete the `setActiveTab(sectionOf(first))` line: "on the phone, closing
 *      the picker opens the section the new row landed in" goes red.
 */
const c = content();
const packItem = Object.values(c.items).find((i) => (i.packOf ?? 1) > 1)!;
const companionGear = Object.values(c.items).find((i) => (i.traits ?? []).includes('companion') && !(i.packOf && i.packOf > 1))!;
const REX: CompanionConfig = { id: 'c1', kind: 'animal', name: 'Rex' } as CompanionConfig;

const character = (inventory: InventoryItem[], companions: CompanionConfig[]): Character =>
  normalizeCharacter({
    id: 'ai',
    name: 'AI',
    level: 3,
    classId: 'fighter',
    keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
    feats: [],
    inventory,
    companions,
    // Enough coin that Buy is never the disabled branch.
    currency: { pp: 0, gp: 500, sp: 0, cp: 0 },
  } as unknown as Character);

function Harness({
  initial,
  companions,
  mobile,
  onPlay: report,
}: {
  initial: InventoryItem[];
  companions: CompanionConfig[];
  mobile: boolean;
  onPlay: (p: PlayState) => void;
}) {
  const [play, setPlay] = useState<PlayState>({
    ...emptyPlay(),
    inventory: initial,
    companions,
    currency: { pp: 0, gp: 500, sp: 0, cp: 0 },
  });
  useEffect(() => report(play), [play, report]);
  const onPlay: PlayUpdater = (fn) => setPlay((cur) => fn(cur));
  return (
    <CustomizationContext.Provider value={DEFAULT_CUSTOMIZATION}>
      <ForceMobileContext.Provider value={mobile}>
        <InventoryTab character={character(play.inventory ?? [], play.companions ?? [])} content={c} onPlay={onPlay} />
      </ForceMobileContext.Provider>
    </CustomizationContext.Provider>
  );
}

function mount(initial: InventoryItem[] = [], companions: CompanionConfig[] = [], mobile = false) {
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
  act(() => {
    root.render(
      <Harness
        initial={initial}
        companions={companions}
        mobile={mobile}
        onPlay={(p) => {
          last = p;
        }}
      />,
    );
  });
  return {
    host,
    rows: () => last.inventory ?? [],
    play: () => last,
    stop: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error('nothing to click');
  act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
};
/** Type into a controlled React input the way a keystroke does. */
const type = (el: HTMLInputElement, v: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  act(() => el.dispatchEvent(new Event('input', { bubbles: true })));
};
const byText = (host: HTMLElement, sel: string, text: string) =>
  [...host.querySelectorAll<HTMLElement>(sel)].find((e) => (e.textContent ?? '').trim() === text);
const toast = (host: HTMLElement) => host.querySelector('.inv-toast')?.textContent?.trim() ?? '';
const outlined = (host: HTMLElement) =>
  [...host.querySelectorAll<HTMLElement>('.inv-card.inv-added')].map((e) => e.querySelector('.inv-name')?.textContent ?? '');

/** Open the picker, search for `name`, and press Give (or Buy) on that row. The picker STAYS open. */
function addFromPicker(host: HTMLElement, name: string, button: 'give' | 'Buy' = 'give') {
  if (!host.querySelector('.fsel-results')) click(byText(host, 'button', 'Add item'));
  const search = host.querySelector<HTMLInputElement>('.fsel-results-search input')!;
  type(search, name);
  const row = [...host.querySelectorAll<HTMLElement>('.ai-row')].find(
    (r) => (r.querySelector('.ai-name')?.textContent ?? '').trim() === name,
  );
  if (!row) throw new Error(`no picker row named ${name}`);
  click(button === 'give' ? row.querySelector('button.give') : [...row.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Buy'));
}
const closePicker = (host: HTMLElement) => click(host.querySelector('.fsel .picker-close'));

describe('adding an item says so', () => {
  it('shows the toast at once, and outlines the new row once the picker closes', () => {
    const t = mount();
    addFromPicker(t.host, 'Longsword');
    expect(toast(t.host)).toBe('Added Longsword');
    // No outline while the picker is still up — it would play, and fade, behind the overlay.
    expect(outlined(t.host)).toEqual([]);
    closePicker(t.host);
    expect(t.host.querySelector('.fsel-results')).toBeNull();
    // The row it made, and only that row, carries the fading outline.
    const marked = outlined(t.host);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('Longsword');
    expect(t.rows().map((i) => i.itemId)).toEqual(['longsword']);
    t.stop();
  });

  it('counts a pack: one purchase of ammunition is the whole pack', () => {
    const t = mount();
    addFromPicker(t.host, packItem.name);
    expect(toast(t.host)).toBe(`Added ${packQuantity(packItem)} × ${packItem.name}`);
    expect(t.rows()[0].quantity).toBe(packQuantity(packItem));
    t.stop();
  });

  it('a second add while the picker is still open is announced too, and both rows are outlined after', () => {
    const t = mount();
    addFromPicker(t.host, 'Longsword');
    expect(toast(t.host)).toBe('Added Longsword');
    // The picker is still up — no reopening between the two.
    expect(t.host.querySelector('.fsel-results')).toBeTruthy();
    addFromPicker(t.host, 'Dagger');
    expect(toast(t.host)).toBe('Added Dagger');
    closePicker(t.host);
    const marked = outlined(t.host);
    expect(marked).toHaveLength(2);
    expect(marked.join(' ')).toContain('Longsword');
    expect(marked.join(' ')).toContain('Dagger');
    expect(t.rows().map((i) => i.itemId)).toEqual(['longsword', 'dagger']);
    t.stop();
  });

  it('a bought item is announced the same way as a given one', () => {
    const t = mount();
    addFromPicker(t.host, 'Longsword', 'Buy');
    expect(toast(t.host)).toBe('Added Longsword');
    t.stop();
  });

  it('companion gear routed to the companion says whose pack it went to', () => {
    const t = mount([], [REX]);
    addFromPicker(t.host, companionGear.name);
    expect(toast(t.host)).toBe(`Added ${companionGear.name} to Rex`);
    // Nothing landed in the player's own pack, so nothing there is outlined.
    expect(t.rows()).toEqual([]);
    closePicker(t.host);
    expect(outlined(t.host)).toEqual([]);
    t.stop();
  });

  it('on the phone, closing the picker opens the section the new row landed in — once', () => {
    // One section open at a time there, Equipped first; a new rope lands in Carried.
    const t = mount([{ instanceId: 'i1', itemId: 'longsword', quantity: 1, equipped: true }], [], true);
    const openTitles = () =>
      [...t.host.querySelectorAll<HTMLElement>('.inv-group')]
        .filter((g) => g.querySelector('.inv-card'))
        .map((g) => g.querySelector('.inv-sec-title')?.textContent);
    expect(openTitles()).toEqual(['Equipped']);
    addFromPicker(t.host, 'Rope');
    closePicker(t.host);
    expect(openTitles()).toEqual(['Carried']);
    expect(outlined(t.host)).toEqual(['Rope']);
    // The player goes back to Equipped while the outline is still up: that choice stands.
    click([...t.host.querySelectorAll('.inv-tabs .stab')].find((b) => b.textContent?.trim() === 'Equipped'));
    expect(openTitles()).toEqual(['Equipped']);
    t.stop();
  });

  it('both marks go away on their own', () => {
    vi.useFakeTimers();
    const t = mount();
    addFromPicker(t.host, 'Longsword');
    closePicker(t.host);
    expect(outlined(t.host)).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(t.host.querySelector('.inv-toast')).toBeNull();
    expect(outlined(t.host)).toEqual([]);
    t.stop();
  });

  it('nothing is announced until something is added', () => {
    const t = mount([{ instanceId: 'i1', itemId: 'longsword', quantity: 1, equipped: true }]);
    expect(t.host.querySelector('.inv-toast')).toBeNull();
    expect(t.host.querySelector('.inv-card.inv-added')).toBeNull();
    t.stop();
  });
});
