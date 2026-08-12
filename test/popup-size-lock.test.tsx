// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { PopupSizeLock } from '../src/sheet/PopupSizeLock';

/*
 * PopupSizeLock freezes a popup's height so that expanding something inside it doesn't resize the
 * whole popup. The height it freezes at is the entire question: it used to read offsetHeight the
 * instant the element was inserted, which for every detail popup in the app is BEFORE its description
 * arrives from a lazily fetched ast bucket — so an 800px page ended up scrolling inside a 200px box.
 *
 * jsdom has neither ResizeObserver nor layout, so both are stubbed: the fake observer is driven by
 * hand, and each popup carries a `naturalHeight` that stands in for its content growing.
 */

type RoCallback = () => void;
const observers: { el: Element; cb: RoCallback }[] = [];

class FakeResizeObserver {
  constructor(private cb: RoCallback) {}
  observe(el: Element) {
    observers.push({ el, cb: this.cb });
    this.cb(); // the real one fires once on observe with the current size
  }
  disconnect() {
    for (let i = observers.length - 1; i >= 0; i--) if (observers[i].cb === this.cb) observers.splice(i, 1);
  }
  unobserve() {}
}

/** Tell the lock that `el` changed size, the way a real ResizeObserver would. */
function reportResize(el: Element) {
  for (const o of observers) if (o.el === el) o.cb();
}

/** A .picker whose reported height we control, standing in for jsdom's absent layout. */
function makePicker(height: number, ...classes: string[]): HTMLElement {
  const el = document.createElement('div');
  el.className = ['picker', ...classes].join(' ');
  let h = height;
  Object.defineProperty(el, 'offsetHeight', { get: () => h, configurable: true });
  (el as HTMLElement & { grow(to: number): void }).grow = (to: number) => {
    h = to;
    reportResize(el);
  };
  return el;
}
const grow = (el: HTMLElement, to: number) => (el as HTMLElement & { grow(to: number): void }).grow(to);

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  observers.length = 0;
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root.render(<PopupSizeLock />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Insert a popup into the document and let the MutationObserver see it. */
async function open(el: HTMLElement) {
  document.body.appendChild(el);
  await Promise.resolve(); // MutationObserver callbacks are microtasks
}

describe('PopupSizeLock', () => {
  it('does NOT pin the height while the popup is still filling', async () => {
    const p = makePicker(198); // the loading placeholder's height
    await open(p);
    act(() => void vi.advanceTimersByTime(200));
    expect(p.style.height).toBe('');
  });

  it('pins the height the content settles at, not the one it opened at', async () => {
    const p = makePicker(198);
    await open(p);
    act(() => void vi.advanceTimersByTime(200)); // ast bucket still in flight
    grow(p, 869); // …description arrives
    act(() => void vi.advanceTimersByTime(200)); // not settled long enough yet
    expect(p.style.height).toBe('');
    act(() => void vi.advanceTimersByTime(200)); // now it has held steady
    expect(p.style.height).toBe('869px');
  });

  it('keeps waiting while the height is still moving', async () => {
    const p = makePicker(198);
    await open(p);
    for (const h of [300, 500, 700]) {
      act(() => void vi.advanceTimersByTime(300));
      grow(p, h);
    }
    expect(p.style.height).toBe('');
    act(() => void vi.advanceTimersByTime(400));
    expect(p.style.height).toBe('700px');
  });

  it('stops watching once pinned, so a later expand cannot resize the popup', async () => {
    const p = makePicker(400);
    await open(p);
    act(() => void vi.advanceTimersByTime(400));
    expect(p.style.height).toBe('400px');
    grow(p, 900); // the user opens a dropdown inside — the popup must not follow
    act(() => void vi.advanceTimersByTime(1000));
    expect(p.style.height).toBe('400px');
  });

  it('leaves a height that popup-size-sync or a user resize already set', async () => {
    const p = makePicker(400);
    p.style.height = '620px';
    await open(p);
    act(() => void vi.advanceTimersByTime(1000));
    expect(p.style.height).toBe('620px');
  });

  it('leaves the self-sizing popups alone', async () => {
    for (const cls of ['fsel', 'ref-search', 'info-modal', 'settings-modal']) {
      const p = makePicker(400, cls);
      await open(p);
      act(() => void vi.advanceTimersByTime(1000));
      expect(p.style.height, cls).toBe('');
    }
  });

  it('does not pin a popup that was closed before it settled', async () => {
    const p = makePicker(400);
    await open(p);
    p.remove();
    act(() => void vi.advanceTimersByTime(1000));
    expect(p.style.height).toBe('');
  });
});
