// @vitest-environment jsdom
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import type { ReactElement } from 'react';

/**
 * Render a real component into jsdom and return its text.
 *
 * The whole suite ran in node against pure rule functions, so every defect of the shape "the value
 * is computed correctly and no surface displays it" was invisible to it — and that is this app's
 * dominant defect class by its own audit history. A gunslinger's firearm proficiency, a companion's
 * species, an eidolon's innate spells and 158 granted actions were each correct in the engine and
 * absent from the screen.
 *
 * Deliberately tiny: no @testing-library, no queries, no user events. These tests ask one question —
 * does this number reach a pixel — and text is the honest way to answer it.
 */
/** jsdom implements no media queries, and several components read one on their first render
 *  (useIsMobile). A desktop-shaped stub is the right default: these tests assert what the sheet
 *  prints, not how it reflows. */
function stubMatchMedia() {
  if (typeof window === 'undefined') return;
  // jsdom implements no layout, so scrollIntoView doesn't exist — the builder's level strip calls it
  // in an effect and the whole tree unmounts with an error before a single assertion runs.
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (window.matchMedia) return;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

/**
 * Render into jsdom and hand back the live host element plus a click helper.
 *
 * `renderText` answers "does this number reach a pixel". This answers the other half of the same
 * question — "does this control LOOK the way it behaves": whether an option that cannot be chosen
 * actually renders greyed, disabled and with its reason (gold-set Q27). A predicate returning false
 * proves nothing here; only the attributes on the node do. Caller must `stop()`.
 */
export function renderDom(el: ReactElement): {
  host: HTMLElement;
  click: (target: Element | null) => void;
  stop: () => void;
} {
  stubMatchMedia();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(el);
  });
  return {
    host,
    click(target) {
      if (!target) throw new Error('renderDom: click target not found');
      act(() => {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
    },
    stop() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

export function renderText(el: ReactElement, clickLabels: string[] = []): string {
  stubMatchMedia();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(el);
  });
  // Some panes are behind a sub-tab (the Main tab opens on Strikes, so the action list is one click
  // away). Clicking by visible label keeps the test honest: it reaches the pane the way a player does.
  for (const label of clickLabels) {
    // Not every clickable surface is a <button>: a spell opens its description from its card, which is
    // a div. Falling back to any element whose own text IS the label lands on the name inside the card
    // and the click bubbles to the card's handler, exactly as a player's does. Buttons still win, so
    // nothing that already resolved to one resolves anywhere else.
    const target =
      [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label) ??
      [...host.querySelectorAll('*')].find((e) => (e.textContent ?? '').trim() === label);
    if (!target) throw new Error(`renderText: nothing labelled "${label}"`);
    act(() => {
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }
  const text = host.textContent ?? '';
  act(() => {
    root.unmount();
  });
  host.remove();
  return text;
}
