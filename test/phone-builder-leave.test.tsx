// @vitest-environment jsdom
import { act, createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder, useBuildChanged } from '../src/builder/Builder';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { useBackHandler, useEscapeClose } from '../src/sheet/useEscapeClose';
import { addEditor, openMenu, pick, press } from './_tweaks-harness';

/**
 * LEAVING THE BUILDER ON A PHONE (owner's phone list, 2026-10-14; audit A1 A2 B1 C2 D1 E3).
 *
 * Measured before the fix (Pixel 7 profile, the real app): with no popup open, Android Back did NOTHING
 * on the first press (the dismiss stack's trap was used up silently, the builder never registered a
 * handler) and LEFT THE APP on the second, the unsaved character with it. Cancel dropped every change
 * at once, with no question, one tap beside Create.
 *
 * Now one door, `requestLeave`: unchanged since the builder opened → leave at once; changed → ask
 * "Discard changes?" (Keep editing / Discard). Cancel uses it on every platform, Back on phones only
 * (desktop Escape with nothing open still does nothing). Back reaches it only when no popup is open:
 * the builder is the FLOOR of the dismiss stack (useBackHandler `floor`), below every picker its page
 * mounts in the same commit. A plain registration sits ABOVE them (a parent's effects run after its
 * children's) and its Back would leave the builder over an open popup.
 *
 * MUTATIONS (tried 2026-10-14, each alone, then restored):
 *  - Builder's `{ floor: true }` dropped (a plain useBackHandler) → fails "Back with a picker open closes
 *    the PICKER" (onCancel ran, the builder left over the open Ancestry popup) and the hook-level order test.
 *  - the Cancel button back on `onClick={onCancel}` → fails "Cancel after an edit asks first".
 *  - `useBuildChanged`'s start never moved before the first touch (start = the build handed in) → fails
 *    "a build the builder changes by itself while opening is not the player's change".
 *  - (round 3) Builder's `backOnly: true` dropped → fails the three "phone width: the Escape KEY never
 *    leaves the builder" tests; handleKey calling a backOnly entry → fails the hook-level backOnly test.
 */

const PHONE = '(max-width: 720px)';
let realMatchMedia: typeof window.matchMedia | undefined;

function stubViewport(phone: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: phone && q === PHONE,
    media: q,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

beforeEach(() => {
  realMatchMedia = window.matchMedia;
  stubViewport(true);
});

/** Unmounts for whatever a test rendered, run even when the test failed half-way — a builder left
 *  mounted keeps its entry on the (module-wide) dismiss stack and would answer the next test's Back. */
const cleanups: (() => void)[] = [];

afterEach(async () => {
  // Answer any question still open (its root unmounts itself, and with it its stack entry)…
  for (let i = 0; i < 3 && document.querySelector('.confirm-modal'); i++) {
    const keep = [...document.querySelectorAll('.confirm-modal .confirm-actions button')][0];
    await act(async () => {
      keep?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
  }
  // …then unmount what the test rendered.
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* already unmounted by the test */
    }
  }
  await settle();
  for (const n of [...document.body.children]) n.remove();
  if (realMatchMedia) window.matchMedia = realMatchMedia;
});

/** Let a confirm's deferred teardown (setTimeout 0) and any promise it resolved run. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}
/** Android's Back: the WebView pops the trap's history entry and fires `popstate`. No key at all. */
async function back() {
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }));
  });
  await settle();
}
async function escape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
}
const confirmBox = () => document.querySelector('.confirm-modal');
const confirmTitle = () => confirmBox()?.querySelector('.picker-head')?.textContent?.trim() ?? null;
async function pressConfirm(label: string) {
  const b = [...(confirmBox()?.querySelectorAll('button') ?? [])].find((x) => (x.textContent ?? '').trim() === label);
  if (!b) throw new Error(`no "${label}" button in the confirm`);
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}

/** Mount into a fresh root; its unmount runs once, from the test or from afterEach. */
function mount(el: ReturnType<typeof createElement>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  const root = createRoot(div);
  act(() => root.render(el));
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    act(() => root.unmount());
  };
  cleanups.push(stop);
  return stop;
}

/** Tap the strip's "0" chip (ancestry, background, class): the builder itself opens on Setup. */
function goToPage0(r: ReturnType<typeof renderDom>) {
  r.click([...r.host.querySelectorAll('.lstrip .lchip')].find((c) => c.textContent?.trim() === '0') ?? null);
}

function open(initial?: BuildState) {
  const calls = { cancel: 0 };
  const rendered = renderDom(
    createElement(Builder, {
      content: content(),
      initial,
      onCancel: () => void (calls.cancel += 1),
      onCreate: () => undefined,
    }),
  );
  let done = false;
  const r = {
    ...rendered,
    stop: () => {
      if (done) return;
      done = true;
      rendered.stop();
    },
  };
  cleanups.push(r.stop);
  const cancelBtn = () => r.host.querySelector('.builder-head .b-cancel');
  const typeName = (v: string) => {
    const input = r.host.querySelector('.builder-head input.name-input') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: v.slice(-1), bubbles: true }));
      setter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  return { r, calls, cancelBtn, typeName };
}

/** A saved character, as the roster holds it: built, stored, read back through JSON. */
function savedBuild(): BuildState {
  const b: BuildState = {
    ...emptyBuild(),
    name: 'Saved Hero',
    level: 3,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    classId: 'fighter',
    keyAbility: 'str',
  };
  return JSON.parse(JSON.stringify(b)) as BuildState;
}

describe('the dismiss stack: a screen FLOOR sits under the popups it mounts with', () => {
  it('Back closes the popup that mounted in the same commit first, then reaches the floor', async () => {
    const log: string[] = [];
    function Popup() {
      const [open, setOpen] = useState(true);
      useEscapeClose(open ? () => (log.push('popup'), setOpen(false)) : undefined);
      return open ? createElement('div', { className: 'pop' }) : null;
    }
    function Screen() {
      useBackHandler(true, () => void log.push('screen'), { floor: true });
      return createElement(Popup);
    }
    const stop = mount(createElement(Screen));
    await back();
    expect(log, 'the first Back must close the popup, not the screen under it').toEqual(['popup']);
    await back();
    expect(log).toEqual(['popup', 'screen']);
    stop();
  });

  it('a backOnly floor answers Back, never the Escape key — and Escape does not fall through under it', async () => {
    const log: string[] = [];
    function Below() {
      // Something registered before the screen opened (a sheet tab, say): Escape must not reach it either.
      useBackHandler(true, () => void log.push('below'));
      return null;
    }
    function Popup() {
      const [open, setOpen] = useState(true);
      useEscapeClose(open ? () => (log.push('popup'), setOpen(false)) : undefined);
      return open ? createElement('div', { className: 'pop' }) : null;
    }
    function Screen() {
      useBackHandler(true, () => void log.push('screen'), { floor: true, backOnly: true });
      return createElement(Popup);
    }
    const stopBelow = mount(createElement(Below));
    const stop = mount(createElement(Screen));
    await escape();
    expect(log, 'Escape still closes a popup above the floor').toEqual(['popup']);
    await escape();
    expect(log, 'Escape with nothing open on the screen does nothing').toEqual(['popup']);
    await back();
    expect(log, 'Back reaches the floor').toEqual(['popup', 'screen']);
    stop();
    stopBelow();
  });

  it('a floor that is not active answers nothing (desktop Escape with nothing open does nothing)', async () => {
    stubViewport(false);
    const log: string[] = [];
    function Screen() {
      useBackHandler(false, () => void log.push('screen'), { floor: true });
      return null;
    }
    const stop = mount(createElement(Screen));
    await escape();
    expect(log).toEqual([]);
    stop();
  });
});

describe('leaving the builder with nothing changed never asks', () => {
  it('new character: Cancel leaves at once', async () => {
    const { r, calls, cancelBtn } = open();
    r.click(cancelBtn());
    await act(async () => undefined);
    expect(confirmBox(), 'no question when nothing was chosen').toBeNull();
    expect(calls.cancel).toBe(1);
    r.stop();
  });

  it('new character: Android Back leaves at once', async () => {
    const { r, calls } = open();
    await back();
    expect(confirmBox()).toBeNull();
    expect(calls.cancel, 'the first Back leaves the builder (it used to do nothing)').toBe(1);
    r.stop();
  });

  it('editing a saved character: Cancel and Back leave at once', async () => {
    const a = open(savedBuild());
    a.r.click(a.cancelBtn());
    await act(async () => undefined);
    expect(confirmBox()).toBeNull();
    expect(a.calls.cancel).toBe(1);
    a.r.stop();

    const b = open(savedBuild());
    await back();
    expect(confirmBox()).toBeNull();
    expect(b.calls.cancel).toBe(1);
    b.r.stop();
  });

  it('editing a character with no stored build (rebuilt from the sheet, as App does for imports)', async () => {
    const db = content();
    const derived = deriveBuildFromCharacter(buildCharacter(savedBuild(), db), db);
    const { r, calls, cancelBtn } = open(derived);
    r.click(cancelBtn());
    await act(async () => undefined);
    expect(confirmBox()).toBeNull();
    expect(calls.cancel).toBe(1);
    r.stop();
  });

  it('a name typed and deleted again is no change', async () => {
    const { r, calls, cancelBtn, typeName } = open();
    typeName('X');
    typeName('');
    r.click(cancelBtn());
    await act(async () => undefined);
    expect(confirmBox()).toBeNull();
    expect(calls.cancel).toBe(1);
    r.stop();
  });
});

describe('leaving the builder after a change asks "Discard changes?"', () => {
  it('Cancel after an edit asks first; Keep editing stays, Discard leaves', async () => {
    const { r, calls, cancelBtn, typeName } = open(savedBuild());
    typeName('Saved Hero EDITED');
    r.click(cancelBtn());
    await act(async () => undefined);
    expect(confirmTitle()).toBe('Discard changes?');
    expect(calls.cancel, 'nothing is thrown away before the answer').toBe(0);
    const labels = [...confirmBox()!.querySelectorAll('.confirm-actions button')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Keep editing', 'Discard']);
    await pressConfirm('Keep editing');
    expect(confirmBox()).toBeNull();
    expect(calls.cancel).toBe(0);
    expect((r.host.querySelector('.builder-head input.name-input') as HTMLInputElement).value).toBe('Saved Hero EDITED');

    r.click(cancelBtn());
    await act(async () => undefined);
    await pressConfirm('Discard');
    expect(calls.cancel).toBe(1);
    r.stop();
  });

  it('Back after an edit asks; Back again closes only the question', async () => {
    const { r, calls, typeName } = open();
    typeName('Draft Hero');
    await back();
    expect(confirmTitle()).toBe('Discard changes?');
    expect(calls.cancel).toBe(0);
    await back();
    expect(confirmBox(), 'Back closes the question (= Keep editing)').toBeNull();
    expect(calls.cancel).toBe(0);
    expect(r.host.querySelector('.builder-body'), 'still in the builder').toBeTruthy();
    // And the next Back asks again — it never falls out of the app.
    await back();
    expect(confirmTitle()).toBe('Discard changes?');
    await pressConfirm('Discard');
    expect(calls.cancel).toBe(1);
    r.stop();
  });

  /** Type into a number box as the phone does, leaving it focused (Back never takes the focus). */
  function typeKeepingFocus(box: HTMLInputElement, text: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      box.focus();
      box.dispatchEvent(new KeyboardEvent('keydown', { key: text.slice(-1), bubbles: true }));
      setter.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.activeElement, 'the box still has focus, as on the phone').toBe(box);
  }
  const tweaksOn = (b: BuildState) => ({ ...b, options: { ...(b.options ?? {}), overridesEnabled: true } }) as BuildState;

  it('a number still being typed (Tweaks → Set a number → Maximum HP, never left) counts as a change: Back asks', async () => {
    // Final check 2026-10-14 (then on the Overrides card; plan B WP7 moved it to the Tweaks page): the
    // number boxes write only when LEFT (DraftNumberInput), and Android's Back never takes focus from them —
    // so "50 typed, then Back" read as no change, left without asking, and the 50 was gone. The "Add a
    // tweak" editor holds its draft until Add (B22), so a draft there counts as a change too
    // (TweaksPage onPendingChange). MUTATION (wp7-report.md): requestLeave without `tweakAddPending` →
    // onCancel ran (cancel 1).
    const { r, calls } = open(tweaksOn(savedBuild()));
    await press(r.host.querySelector('.builder-head button.b-tweaks'));
    await openMenu(r.host, 'Set a number');
    await pick(addEditor(r.host)!, 'What', 'Maximum HP');
    const hp = addEditor(r.host)!.querySelector<HTMLInputElement>('input[aria-label="Max HP"]');
    expect(hp, 'no Max HP box in the Set a number editor').toBeTruthy();
    typeKeepingFocus(hp!, '50');
    await back();
    await settle();
    expect(calls.cancel, 'left without asking — the typed 50 would be lost').toBe(0);
    expect(confirmTitle()).toBe('Discard changes?');
    await pressConfirm('Keep editing');
    expect(addEditor(r.host)?.querySelector<HTMLInputElement>('input[aria-label="Max HP"]')?.value, 'the typed value was kept').toBe('50');
    r.stop();
  });

  it("a number still being typed in a tweak's own row (Maximum HP set to 40 → 50, never left): Back asks", async () => {
    // The row editor writes when the box is LEFT: requestLeave leaves the focused box first, then compares.
    // MUTATION: requestLeave without its blur-first step → onCancel ran (cancel 1).
    const { r, calls } = open(tweaksOn({ ...savedBuild(), overrides: { v: 2, maxHp: 40 } } as BuildState));
    await press(r.host.querySelector('.builder-head button.b-tweaks'));
    await press(r.host.querySelector('li.tw-row[data-kind="number.setMaxHp"] .tw-row-head'));
    const hp = r.host.querySelector<HTMLInputElement>('li.tw-row.open input[aria-label="Max HP"]');
    expect(hp?.value).toBe('40');
    typeKeepingFocus(hp!, '50');
    await back();
    await settle();
    expect(calls.cancel, 'left without asking — the typed 50 would be lost').toBe(0);
    expect(confirmTitle()).toBe('Discard changes?');
    await pressConfirm('Keep editing');
    expect(r.host.querySelector<HTMLInputElement>('li.tw-row.open input[aria-label="Max HP"]')?.value, 'the typed value was kept').toBe('50');
    r.stop();
  });

  it('an "Add a tweak" editor opened and cancelled is no change: Back leaves at once', async () => {
    const { r, calls } = open(tweaksOn(savedBuild()));
    await press(r.host.querySelector('.builder-head button.b-tweaks'));
    await openMenu(r.host, 'Set a number');
    await pick(addEditor(r.host)!, 'What', 'AC');
    await press([...addEditor(r.host)!.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Cancel'));
    await back();
    await settle();
    expect(confirmBox(), 'nothing to ask').toBeNull();
    expect(calls.cancel).toBe(1);
    r.stop();
  });

  it('desktop: Cancel after an edit asks too (same button), Escape with nothing open does nothing', async () => {
    stubViewport(false);
    const { r, calls, cancelBtn, typeName } = open();
    typeName('Desk Hero');
    await escape();
    expect(confirmBox()).toBeNull();
    expect(calls.cancel).toBe(0);
    r.click(cancelBtn());
    await act(async () => undefined);
    expect(confirmTitle()).toBe('Discard changes?');
    await pressConfirm('Keep editing');
    expect(calls.cancel).toBe(0);
    r.stop();
  });
});

/*
 * Round 3 (re-tester, h-history.cjs esc at 412x915): at PHONE width the Escape KEY reached the builder's
 * floor too — no edits: Escape left the builder; a name typed (focus in the field or not): Escape asked
 * "Discard changes?". Decision 1 wires leaving to Cancel and Android Back only. The floor is `backOnly`
 * now. MUTATION (2026-10-14): `backOnly: true` dropped from Builder.tsx → these fail (cancel 1 / the box).
 */
describe('phone width: the Escape KEY never leaves the builder (only Back does)', () => {
  it('no edits: Escape stays in the builder', async () => {
    const { r, calls } = open();
    await escape();
    expect(confirmBox()).toBeNull();
    expect(calls.cancel, 'Escape left the builder').toBe(0);
    expect(r.host.querySelector('.builder-body')).toBeTruthy();
    r.stop();
  });

  it('a name typed: Escape (on the page or inside the name field) asks nothing and leaves nothing', async () => {
    const { r, calls, typeName } = open(savedBuild());
    typeName('Saved Hero EDITED');
    await escape();
    expect(confirmBox(), 'Escape asked "Discard changes?"').toBeNull();
    const input = r.host.querySelector('.builder-head input.name-input') as HTMLInputElement;
    input.focus();
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();
    expect(confirmBox(), 'Escape inside the name field asked "Discard changes?"').toBeNull();
    expect(calls.cancel).toBe(0);
    expect(input.value, 'the typed name is kept').toBe('Saved Hero EDITED');
    // Android Back still asks.
    await back();
    expect(confirmTitle()).toBe('Discard changes?');
    r.stop();
  });

  it('a picker open: Escape closes the picker, the next Escape does nothing', async () => {
    const { r, calls } = open();
    // A new character opens on Setup (Guy, 2026-11-08); the Ancestry slot is on page 0, so open it first.
    goToPage0(r);
    r.click(r.host.querySelector('[data-ctl-title="Ancestry"]'));
    expect(document.querySelector('.picker-overlay'), 'the Ancestry popup did not open').toBeTruthy();
    await escape();
    expect(document.querySelector('.picker-overlay'), 'Escape closed the popup').toBeNull();
    await escape();
    expect(calls.cancel).toBe(0);
    expect(confirmBox()).toBeNull();
    r.stop();
  });
});

describe('Back with a picker open closes the PICKER, not the builder', () => {
  it('new character, Level 0: the Ancestry popup (mounted with the builder) closes first', async () => {
    const { r, calls } = open();
    // A new character opens on Setup (Guy, 2026-11-08: "it needs to open on setup not lv 1"); the
    // player taps the "0" chip, then the Ancestry slot. Back still closes the popup before the builder.
    goToPage0(r);
    r.click(r.host.querySelector('[data-ctl-title="Ancestry"]'));
    expect(document.querySelector('.picker-overlay'), 'the Ancestry popup did not open').toBeTruthy();
    await back();
    expect(document.querySelector('.picker-overlay'), 'Back closed the popup').toBeNull();
    expect(calls.cancel, 'and did not leave the builder under it').toBe(0);
    expect(confirmBox()).toBeNull();
    await back();
    expect(calls.cancel, 'the next Back leaves (nothing was chosen)').toBe(1);
    r.stop();
  });
});

describe('useBuildChanged: what the builder does to a build by itself is not the player’s change', () => {
  it('a build the builder changes by itself while opening is not the player’s change', async () => {
    let probe: (() => boolean) | null = null;
    let bump: (() => void) | null = null;
    function Normaliser({ patch }: { patch: () => void }) {
      useEffect(() => patch(), [patch]);
      return null;
    }
    function Harness() {
      const [b, setB] = useState<BuildState>(() => ({ ...emptyBuild(), name: 'Old Save' }));
      const changed = useBuildChanged(b);
      probe = changed;
      bump = () => setB((x) => ({ ...x, name: x.name + '!' }));
      const [patch] = useState(() => () => setB((x) => ({ ...x, gateForks: { normalised: 'yes' } }) as BuildState));
      return createElement(Normaliser, { patch });
    }
    const stop = mount(createElement(Harness));
    await act(async () => undefined);
    expect(probe!(), 'the mount-time patch alone must read as unchanged').toBe(false);
    // The player's first touch fixes the start; a change after it counts.
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
      bump!();
    });
    expect(probe!()).toBe(true);
    stop();
  });
});
