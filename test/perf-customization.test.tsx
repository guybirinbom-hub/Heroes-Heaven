// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { fontList, warmFontStacks } from '../src/theme/fonts';
import { themeList } from '../src/theme/themes';
import { PaletteTile } from '../src/theme/PaletteTile';
import { renderDom } from './_render';
import { content, build } from './_content';
import { CharacterSheet } from '../src/sheet/CharacterSheet';

/**
 * How many times the SHEET BODY rendered.
 *
 * MainTab is the body's main content and carries no memo, so it renders exactly once per
 * CharacterSheet render — which makes it the honest counter for "did opening the drawer re-render
 * the sheet". The mock wraps the real component rather than replacing it, so the sheet under test is
 * the real sheet.
 */
let bodyRenders = 0;
vi.mock('../src/sheet/MainTab', async (importActual) => {
  const actual = await importActual<typeof import('../src/sheet/MainTab')>();
  const Real = actual.MainTab;
  return {
    ...actual,
    MainTab: (props: Parameters<typeof Real>[0]) => {
      bodyRenders++;
      return <Real {...props} />;
    },
  };
});

/*
 * The Customize panel's FIRST open is the slow one; every open after it is cheap. Measured in the dev
 * preview on a synthetic level-10 Fighter: ~50 ms to open the first time (React commit ~25 ms, layout
 * ~25 ms) against ~18 ms after (commit ~14 ms, layout ~4.5 ms). One part of that first-open layout is
 * the cold system-font match for the ten stacks the Font axis draws its chips in — 14-30 ms in a
 * renderer process that has never seen them, 0.1-0.5 ms once warm — and that part is what the idle
 * warm-up moves off the open. The rest is the drawer's first layout in the document and the sheet
 * re-rendering behind it, neither of which lives here. These two guards are what would catch the fix
 * rotting: a font added to the axis but left out of the warm-up, and a palette tile that starts doing
 * real work — applying theme tokens to the document — while it renders.
 */

describe('Customize panel: the first open must not pay for cold font matching', () => {
  it('lays out every stack the Font axis offers, exactly once, and leaves no probe behind', () => {
    // Returning the stacks is not proof they were MEASURED — a warm-up that never forces layout
    // costs nothing and buys nothing. Watch the forced read instead, and what it was read from.
    const real = Element.prototype.getBoundingClientRect;
    let measured: { probes: number; fonts: number } | null = null;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const probes = [...this.children] as HTMLElement[];
      if (probes.length && probes.every((p) => p.style.fontFamily)) {
        measured = { probes: probes.length, fonts: new Set(probes.map((p) => p.style.fontFamily)).size };
      }
      return real.call(this);
    };
    try {
      expect(warmFontStacks()).toEqual(fontList.map((f) => f.stack));
      expect(measured).toEqual({ probes: fontList.length, fonts: fontList.length });
      // Second call: the browser has cached the match per family for the life of the document.
      measured = null;
      expect(warmFontStacks()).toEqual([]);
      expect(measured).toBeNull();
    } finally {
      Element.prototype.getBoundingClientRect = real;
    }
    expect(document.body.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

describe('Customize panel: a palette tile paints itself and nothing else', () => {
  it('renders every palette without writing a CSS variable onto <html>', () => {
    document.documentElement.removeAttribute('style');
    const r = renderDom(
      <>
        {themeList.map((t) => (
          <PaletteTile key={t.id} theme={t} selectedId={themeList[0].id} onPick={() => undefined} />
        ))}
      </>,
    );
    expect(r.host.querySelectorAll('.palette-tile').length).toBe(themeList.length);
    // A tile that resolved its preview through the theme manager would restyle the whole document
    // once per tile, on every render of the panel. It must stay pure inline style.
    expect(document.documentElement.getAttribute('style')).toBeNull();
    r.stop();
  });
});

/*
 * OWNER: *"opening the Customization button for the first time is super laggy."*
 *
 * The flag was `useState` on CharacterSheet and the drawer rendered inside the sheet's tree, so every
 * open AND every close re-rendered the whole sheet — measured at ~30 ms of React work per toggle on a
 * level-20 caster with 45 items, 6 casting entries and 3 companions, and it grows with the character.
 * The flag now lives in CustomizeHost (a sibling that renders null while closed), reached through a
 * ref, so a toggle renders that subtree and nothing else.
 *
 * The whole fix IS the render count, which is why it is what these assert: a drawer that looks
 * identical and costs a full sheet render is the bug coming back.
 */
function sheet() {
  const c = content();
  const ch = build('wizard', 12);
  return renderDom(
    <CharacterSheet character={ch} content={c} charKey="perf" onPlay={() => undefined} onCustomize={() => undefined} />,
  );
}
const drawers = () => document.querySelectorAll('.cust-drawer');

describe('Customize drawer: opening it must not re-render the sheet', () => {
  it('leaves the sheet body untouched on open and on close', () => {
    const r = sheet();
    const btn = r.host.querySelector('button[aria-label="Customize"]');
    expect(btn).not.toBeNull();

    const atRest = bodyRenders;
    r.click(btn);
    expect(drawers().length).toBe(1);
    // The one that matters: the sheet behind the drawer did not render again.
    expect(bodyRenders).toBe(atRest);

    r.click(document.querySelector('.cust-drawer .picker-close'));
    expect(drawers().length).toBe(0);
    expect(bodyRenders).toBe(atRest);
    r.stop();
  });

  it('mounts exactly one drawer per open and unmounts it on close, as it always did', () => {
    const r = sheet();
    const btn = r.host.querySelector('button[aria-label="Customize"]');
    expect(drawers().length).toBe(0); // closed ⇒ nothing in the document, not a hidden copy

    r.click(btn);
    expect(drawers().length).toBe(1);
    expect(document.documentElement.classList.contains('cust-open')).toBe(true);

    r.click(document.querySelector('.cust-drawer .picker-close'));
    expect(drawers().length).toBe(0);
    expect(document.documentElement.classList.contains('cust-open')).toBe(false);

    // Re-opening gives one drawer again — never two, and never a stale one left behind.
    r.click(btn);
    expect(drawers().length).toBe(1);
    r.click(document.querySelector('.cust-drawer .picker-close'));
    expect(drawers().length).toBe(0);
    r.stop();
  });
});
