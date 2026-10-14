// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { Builder } from '../src/builder/Builder';
import { useBackHandler, useEscapeClose } from '../src/sheet/useEscapeClose';

/**
 * THE BACK TRAP AFTER THE BUILDER HAS GONE (phone audit, round 2, 2026-10-14).
 *
 * On a phone the dismiss stack keeps one `history.pushState` "trap" entry so Android's Back fires
 * `popstate` (closing the top layer) instead of leaving the app. Measured in the real app (Pixel 7
 * profile): on the roster history.state is null and ONE Back exits; open the builder, leave it with no
 * edits by Back, and the roster then took TWO Backs — the first did nothing — because the trap was
 * re-armed after the Back that closed the builder, with nothing left on the stack to answer it. The
 * same after Cancel and after "Discard" (the trap was never given back once the builder had gone).
 *
 * This file runs with REAL history: `history.back()` is what Android's Back does to the webview (pop the
 * current entry, fire popstate), so `history.state` afterwards is the measurement. Its own file because
 * the dismiss stack is module-wide, and other files' synthetic popstates leave trap entries behind.
 *
 * Failed once against the old useEscapeClose.ts (re-arm at once in handlePop, no release, no arming when
 * a picker registered at mount opens): "Back with no edits", "Cancel", "Discard" and "a picker opened
 * after a Back that found nothing open" (2026-10-14). The two "keeps the trap" cases pass on both: they
 * pin that the new release never takes the trap from a screen that still has layers.
 */

const PHONE = '(max-width: 720px)';
const realMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = ((q: string) => ({
    matches: q === PHONE,
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
});

/*
 * A spy on history, to wait until it is QUIET: a jsdom traversal (history.back()) takes two timer hops
 * before its popstate, and under a busy event loop each hop is 10-30ms — a fixed short wait measured the
 * state half-way. jsdom also cancels a pending traversal when pushState runs, so a pushState zeroes it.
 */
let lastHistoryOp = Date.now();
let pendingBacks = 0;
{
  const push = history.pushState.bind(history);
  history.pushState = ((data: unknown, unused: string, url?: string | URL | null) => {
    lastHistoryOp = Date.now();
    pendingBacks = 0;
    push(data, unused, url);
  }) as typeof history.pushState;
  const goBack = history.back.bind(history);
  history.back = () => {
    lastHistoryOp = Date.now();
    pendingBacks += 1;
    goBack();
  };
  window.addEventListener('popstate', () => {
    lastHistoryOp = Date.now();
    pendingBacks = Math.max(0, pendingBacks - 1);
  });
}

/** Timers and React's commit run. */
async function settle(ms = 20) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
/** Wait until no traversal is pending and history has not moved for 100ms (at most 3s). */
async function quiet() {
  const t0 = Date.now();
  do await settle(20);
  while ((pendingBacks > 0 || Date.now() - lastHistoryOp < 100) && Date.now() - t0 < 3000);
}
const isTrap = () => !!(history.state as { __dismissTrap?: boolean } | null)?.__dismissTrap;

const roots: (() => void)[] = [];
afterEach(async () => {
  while (roots.length) roots.pop()!();
  await quiet();
  for (const n of [...document.body.children]) n.remove();
  window.matchMedia = realMatchMedia;
});

/** Android's Back: the webview pops the current history entry and fires popstate. */
async function androidBack() {
  await act(async () => {
    history.back();
  });
  await quiet();
}

async function mount(el: ReturnType<typeof createElement>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  act(() => root.render(el));
  let done = false;
  roots.push(() => {
    if (done) return;
    done = true;
    act(() => root.unmount());
  });
  await quiet();
  return div;
}

async function click(el: Element | null | undefined) {
  if (!el) throw new Error('nothing to click');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await quiet();
}

/** A tiny App: the roster (nothing on the dismiss stack) and the builder it opens. */
function App() {
  const [screen, setScreen] = useState<'roster' | 'builder'>('builder');
  return screen === 'builder'
    ? createElement(Builder, { content: content(), onCancel: () => setScreen('roster'), onCreate: () => undefined })
    : createElement('div', { className: 'roster' }, 'Characters');
}

function typeName(host: HTMLElement, v: string) {
  const input = host.querySelector('.builder-head input.name-input') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', bubbles: true }));
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('leaving the builder gives the Back trap back to the screen underneath', () => {
  it('Back with no edits: the builder closes and the roster’s next Back is not swallowed', async () => {
    const host = await mount(createElement(App));
    expect(isTrap(), 'the open builder traps Back').toBe(true);
    await androidBack();
    expect(host.querySelector('.builder'), 'the first Back leaves the builder').toBeNull();
    expect(host.textContent).toContain('Characters');
    expect(isTrap(), 'a trap left in on the roster swallows its next Back').toBe(false);
  });

  it('Cancel with no edits: no trap left behind', async () => {
    const host = await mount(createElement(App));
    expect(isTrap()).toBe(true);
    await click(host.querySelector('.builder-head .b-cancel'));
    expect(host.querySelector('.builder')).toBeNull();
    expect(isTrap(), 'Cancel left the trap armed under the roster').toBe(false);
  });

  it('Back after an edit, then Discard: no trap left behind', async () => {
    const host = await mount(createElement(App));
    typeName(host, 'Draft Hero');
    await androidBack();
    const discard = [...document.querySelectorAll('.confirm-modal button')].find((b) => b.textContent?.trim() === 'Discard');
    expect(discard, 'Back after an edit asks first').toBeTruthy();
    expect(isTrap(), 'while the question is up, Back is still trapped').toBe(true);
    await click(discard);
    expect(host.querySelector('.builder')).toBeNull();
    expect(isTrap(), 'Discard left the trap armed under the roster').toBe(false);
  });

  /** A screen FLOOR (the builder's shape) that a screen with its own layers replaces (the sheet's shape:
   *  pickers registered at mount, closed). */
  function FloorThenSheet() {
    const [screen, setScreen] = useState<'floor' | 'sheet'>('floor');
    return screen === 'floor' ? createElement(Floor, { onLeave: () => setScreen('sheet') }) : createElement(Sheet);
  }
  function Floor({ onLeave }: { onLeave: () => void }) {
    useBackHandler(true, onLeave, { floor: true });
    return createElement('button', { className: 'leave', onClick: onLeave }, 'Cancel');
  }
  function Sheet() {
    useEscapeClose(undefined);
    return createElement('div', { className: 'sheet' }, 'sheet');
  }

  it('a screen with its own layers that replaces the builder (Back) keeps the trap', async () => {
    const host = await mount(createElement(FloorThenSheet));
    expect(isTrap()).toBe(true);
    await androidBack();
    expect(host.querySelector('.sheet')).toBeTruthy();
    expect(isTrap(), 'the sheet’s layers lost their trap').toBe(true);
  });

  it('a screen with its own layers that replaces the builder (Cancel) keeps the trap', async () => {
    const host = await mount(createElement(FloorThenSheet));
    await click(host.querySelector('.leave'));
    expect(host.querySelector('.sheet')).toBeTruthy();
    expect(isTrap(), 'the release took the trap from a screen with layers').toBe(true);
  });
});

describe('the trap still catches every Back that has a layer to close', () => {
  /** A screen with a picker that is registered at mount, closed (the SearchSelect / PopupSelect shape). */
  function Screen() {
    const [open, setOpen] = useState(false);
    useEscapeClose(open ? () => setOpen(false) : undefined);
    return createElement(
      'div',
      null,
      createElement('button', { className: 'opener', onClick: () => setOpen(true) }, 'open'),
      open ? createElement('div', { className: 'pop' }, 'popup') : null,
    );
  }

  it('Back closes a popup and the screen beneath keeps its trap for the next one', async () => {
    const host = await mount(createElement(Screen));
    await click(host.querySelector('.opener'));
    expect(host.querySelector('.pop')).toBeTruthy();
    expect(isTrap()).toBe(true);
    await androidBack();
    expect(host.querySelector('.pop'), 'Back closed the popup').toBeNull();
    // Opening it again must leave Back trapped, or that Back would leave the app with the popup up.
    await click(host.querySelector('.opener'));
    expect(isTrap(), 'the reopened popup is not trapped').toBe(true);
    await androidBack();
    expect(host.querySelector('.pop')).toBeNull();
  });

  it('a picker opened after a Back that found nothing open is trapped again', async () => {
    const host = await mount(createElement(Screen));
    expect(isTrap(), 'the mount arms the trap').toBe(true);
    await androidBack(); // nothing open: the press is spent on the trap
    expect(isTrap()).toBe(false);
    await click(host.querySelector('.opener'));
    expect(isTrap(), 'the picker opened with Back untrapped — Back would exit the app over it').toBe(true);
    await androidBack();
    expect(host.querySelector('.pop'), 'Back closed the picker').toBeNull();
  });
});
