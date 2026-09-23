// @vitest-environment jsdom
import { act } from 'react';
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { normalizeCharacter } from '../src/rules/normalize';
import { CustomizationContext, DEFAULT_CUSTOMIZATION } from '../src/data/customization';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import { VitalsRail } from '../src/sheet/VitalsRail';
import { CustomizationEditor } from '../src/sheet/CustomizationEditor';
import type { Character, Customization } from '../src/rules/types';
import type { PlayState, PlayUpdater } from '../src/rules/play';

/*
 * OWNER (2026-09-22), on the XP mockup: *"i want b1 and b2 as options b2 the deafoult, just making
 * sure when you press the xp you get somtihng similer to edining hp where you can both edit the
 * current numbner or write how much to add to it, also pressing b1 also needs to open that editing."*
 *
 * So XP moved into the rail's Hit points card with two looks — B2 a chip in the card's title row
 * (the default, and what an ABSENT `xpDisplay` means) and B1 a thin "XP 340 / 1000" line with a
 * progress bar — and PRESSING EITHER opens one editor with both moves: set the total, or add.
 *
 * What would make this a lie, and so what these legs pin:
 *  - a character who never touched the setting gets the chip (a default that needs a saved value is
 *    not a default),
 *  - the line's bar is the real fraction of the 1,000 XP a PF2e level costs, not decoration,
 *  - BOTH surfaces open the editor — the owner asked for B1's press by name,
 *  - Add ADDS (340 + 120 = 460) and a minus sign takes XP away, which is the whole difference
 *    between the two fields,
 *  - the editor is reachable on a PHONE, where the HP damage/heal row is deliberately gone.
 *
 * MUTATION PROOF (applied once, then restored):
 *  • Making the + button set instead of add — `onPlay((p) => setXp(p, n))` in `applyXpAdd` — fails
 *    "Add ADDS to the total": `AssertionError: 340 + 120: expected 120 to be 460 // Object.is
 *    equality`.
 *  • Dropping the `onKeyDown` this lane's refuter added to `xpPressable`'s button (VitalsRail.tsx)
 *    fails "Escape closes it even with focus still on the chip" below: clicking a button does not
 *    move focus into the editor it opens, so Escape pressed there used to reach no handler at all —
 *    `AssertionError: closed: expected <div class="hp-edit…"> to be null`.
 */
const db = content();

/** A level-5 fighter sitting on 340 XP — 34% of the 1,000 a PF2e level costs (Player Core). */
const hero = (over: Record<string, unknown> = {}): Character =>
  normalizeCharacter({
    id: 'x',
    name: 'X',
    level: 5,
    classId: 'fighter',
    keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    feats: [],
    currency: {},
    inventory: [],
    xp: 340,
    ...over,
  } as unknown as Character);

/** Render the rail with a given XP display setting, capturing what the play writes would do. */
function rail(opts: { xpDisplay?: Customization['xpDisplay']; mobile?: boolean; readOnly?: boolean } = {}) {
  // Only `xp` is read by setXp/addXp, so a stub state is the honest whole of what they touch.
  let play = { xp: 340 } as unknown as PlayState;
  const onPlay = ((fn) => {
    play = fn(play);
  }) as PlayUpdater;
  const opened: unknown[] = [];
  const custom: Customization = { ...DEFAULT_CUSTOMIZATION, xpDisplay: opts.xpDisplay };
  const el = (
    <ForceMobileContext.Provider value={opts.mobile ?? false}>
      <CustomizationContext.Provider value={custom}>
        <VitalsRail
          character={hero()}
          content={db}
          onPlay={opts.readOnly ? undefined : onPlay}
          onOpenStat={(r) => opened.push(r)}
        />
      </CustomizationContext.Provider>
    </ForceMobileContext.Provider>
  );
  const r = renderDom(el);
  const q = <T extends Element>(sel: string) => r.host.querySelector(sel) as T | null;
  return {
    ...r,
    opened,
    xp: () => play.xp,
    chip: () => q<HTMLElement>('.xp-chip'),
    line: () => q<HTMLElement>('.xp-rail-line'),
    fill: () => q<HTMLElement>('.xp-rail-fill'),
    editor: () => q<HTMLElement>('.xp-rail-edit'),
    total: () => q<HTMLInputElement>('input[aria-label^="Experience points total"]'),
    add: () => q<HTMLInputElement>('input[aria-label^="Experience points to add"]'),
    plus: () => q<HTMLButtonElement>('.xp-rail-add'),
  };
}

/** Type into a controlled input the way a browser does (React swallows a plain `.value =`). */
function type(input: HTMLInputElement | null, text: string): void {
  if (!input) throw new Error('no input to type into');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Press a key on an element, bubbling to React's root listener. */
function key(el: Element | null, k: string): void {
  if (!el) throw new Error('no element to press a key on');
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
}

describe('XP lives in the Hit points card', () => {
  it('with nothing saved, it is the chip — in the card TITLE row, where it costs no height', () => {
    const r = rail();
    expect(r.chip(), 'the default is the chip').toBeTruthy();
    expect(r.chip()!.textContent).toBe('XP 340');
    expect(r.chip()!.closest('.ct'), 'and it rides in the title row, not on a row of its own').toBeTruthy();
    expect(r.line(), 'so there is no line').toBeNull();
    r.stop();
  });

  it("'line' swaps it for the row above the HP numbers, with the bar at the real fraction", () => {
    const r = rail({ xpDisplay: 'line' });
    expect(r.chip()).toBeNull();
    const line = r.line();
    expect(line, 'the line is there').toBeTruthy();
    expect(line!.textContent).toBe('XP340/ 1000');
    // 340 of the 1,000 XP a level costs.
    expect(r.fill()!.style.width, 'the bar is the real fraction').toBe('34%');
    // It sits ABOVE the title row, which is what "above the HP numbers" means in the card.
    expect(line!.nextElementSibling!.className).toContain('ct');
    r.stop();
  });

  it('pressing the chip opens the editor — and does NOT open the HP breakdown behind it', () => {
    const r = rail();
    expect(r.editor(), 'closed until pressed').toBeNull();
    r.click(r.chip());
    expect(r.editor(), 'the chip opens it').toBeTruthy();
    expect(r.total()!.value, 'prefilled with the current total').toBe('340');
    expect(r.opened, 'the card title behind the chip stays shut').toEqual([]);
    r.stop();
  });

  it('pressing the LINE opens the same editor (the owner asked for this one by name)', () => {
    const r = rail({ xpDisplay: 'line' });
    expect(r.editor()).toBeNull();
    r.click(r.line());
    expect(r.editor()).toBeTruthy();
    expect(r.total()!.value).toBe('340');
    r.stop();
  });

  it('Total SETS the number, and the editor closes', () => {
    const r = rail();
    r.click(r.chip());
    type(r.total(), '900');
    key(r.total(), 'Enter');
    expect(r.xp(), 'typed 900, so the total is 900').toBe(900);
    expect(r.editor(), 'and it closes after applying').toBeNull();
    r.stop();
  });

  it('Add ADDS to the total, and a minus sign takes XP away', () => {
    const r = rail();
    r.click(r.chip());
    type(r.add(), '120');
    r.click(r.plus());
    expect(r.xp(), '340 + 120').toBe(460);
    expect(r.editor(), 'and it closes after applying').toBeNull();

    r.click(r.chip());
    type(r.add(), '-60');
    key(r.add(), 'Enter');
    expect(r.xp(), 'and a negative takes it away: 460 - 60').toBe(400);
    r.stop();
  });

  it('Escape closes it and writes nothing', () => {
    const r = rail();
    r.click(r.chip());
    type(r.total(), '7');
    key(r.total(), 'Escape');
    expect(r.editor(), 'closed').toBeNull();
    expect(r.xp(), 'and the 7 was thrown away').toBe(340);
    r.stop();
  });

  /*
   * The chip's onClick opens the editor but does not focus anything inside it, so focus is left on
   * the chip/line BUTTON itself — the case above (Escape pressed inside the Total field) never
   * exercised that. Both surfaces that can open the editor get their own leg.
   */
  it('Escape closes it even with focus still on the chip that opened it', () => {
    const r = rail();
    r.click(r.chip());
    type(r.total(), '7'); // dirty the draft, so only an actual discard clears it
    key(r.chip(), 'Escape'); // focus never left the button
    expect(r.editor(), 'closed').toBeNull();
    expect(r.xp(), 'and the 7 was thrown away').toBe(340);
    r.stop();
  });

  it('…and the same is true pressing Escape on the LINE, the other button that opens it', () => {
    const r = rail({ xpDisplay: 'line' });
    r.click(r.line());
    type(r.add(), '99');
    key(r.line(), 'Escape');
    expect(r.editor(), 'closed').toBeNull();
    expect(r.xp(), 'and the draft add was thrown away').toBe(340);
    r.stop();
  });

  it('works on a PHONE, where the HP damage/heal row is gone', () => {
    const r = rail({ mobile: true });
    r.click(r.chip());
    expect(r.editor(), 'the XP editor is NOT under the phone gate').toBeTruthy();
    const rows = [...r.host.querySelectorAll('.hp-edit')];
    expect(rows.length, 'and it is the only .hp-edit row on a phone').toBe(1);
    expect(rows[0].className).toContain('xp-rail-edit');
    r.stop();
  });

  it('a read-only sheet shows the number without offering an editor it could not commit', () => {
    const r = rail({ readOnly: true });
    expect(r.chip()!.tagName, 'a span, not a button').toBe('SPAN');
    expect(r.chip()!.textContent).toBe('XP 340');
    r.stop();
  });
});

describe('the setting', () => {
  it('offers both options, with the chip lit when nothing is saved', () => {
    const changes: [string, unknown][] = [];
    const r = renderDom(
      <CustomizationEditor
        value={{}}
        base={DEFAULT_CUSTOMIZATION}
        scope="character"
        onChange={(k, v) => changes.push([k as string, v])}
      />,
    );
    const label = [...r.host.querySelectorAll('.menu-label')].find((l) => l.textContent === 'XP display');
    expect(label, 'the control exists').toBeTruthy();
    const chips = [...label!.nextElementSibling!.querySelectorAll('button')];
    expect(chips.map((c) => c.textContent)).toEqual(['Chip in the title', 'Line with a bar']);
    expect(chips[0].className, 'the chip option is the default').toContain('active');
    r.click(chips[1]);
    expect(changes).toEqual([['xpDisplay', 'line']]);
    r.stop();
  });
});
