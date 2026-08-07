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
  if (typeof window === 'undefined' || window.matchMedia) return;
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
    const btn = [...host.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
    if (!btn) throw new Error(`renderText: no button labelled "${label}"`);
    act(() => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }
  const text = host.textContent ?? '';
  act(() => {
    root.unmount();
  });
  host.remove();
  return text;
}
