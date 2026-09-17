// @vitest-environment jsdom
import { useState, act, StrictMode } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { CustomizationEditor } from '../src/sheet/CustomizationEditor';
import { CustomizeModal } from '../src/sheet/CustomizeModal';
import { useUndoableState, type Undoable } from '../src/useUndoableState';
import { DEFAULT_CUSTOMIZATION } from '../src/data/customization';
import { setAccent, setTheme } from '../src/theme/theme-manager';
import { getTheme } from '../src/theme/themes';
import type { Character, Customization } from '../src/rules/types';
import { renderDom } from './_render';

/*
 * OWNER (2026-09-17): *"Add a full color picker in the accent customization."*
 *
 * The Accent row offered fourteen swatches and nothing else, so an accent outside those fourteen was
 * unreachable from the UI even though the field storing it (Customization.accentColor / the device
 * appearance's `accent`) has always been a plain hex string. The fix is a native <input type="color">
 * beside the presets writing THAT SAME FIELD — which is the whole point: a hand-picked hex has to
 * save, sync, apply and reload exactly like a preset, with no second code path.
 *
 * What would make the feature a lie, and so what these assert:
 *  - the picked hex reaches the field (not a local-only colour that vanishes on save),
 *  - the presets stop showing as chosen and the picker shows as chosen instead,
 *  - a stored custom hex comes BACK selected (the reload half of the round trip),
 *  - the picker opens on the accent actually painted, including the per-character palette rule,
 *  - the derived accent ink still follows contrast, so a bright custom accent isn't white-on-yellow.
 */

/** Fire a colour change the way the browser does: set the value, then dispatch `input`.
 *  React tracks the last value it wrote, so assigning through the prototype setter is what makes it
 *  see a change at all (a plain `input.value = …` is swallowed as a no-op). */
function pick(input: HTMLInputElement, hex: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, hex);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function editor(scope: 'global' | 'character', initial: Customization, base: Customization) {
  const changes: [string, unknown][] = [];
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <CustomizationEditor
        value={value}
        base={base}
        scope={scope}
        onChange={(k, v) => {
          changes.push([k as string, v]);
          setValue((c) => ({ ...c, [k]: v }));
        }}
      />
    );
  }
  const r = renderDom(<Harness />);
  // Every axis has its own "Match device" chip, so scope to the Accent row — the label's sibling.
  const row = (): Element => {
    const label = [...r.host.querySelectorAll('.menu-label')].find((l) => l.textContent === 'Accent colour');
    if (!label?.nextElementSibling) throw new Error('no Accent colour row');
    return label.nextElementSibling;
  };
  const colour = () => row().querySelector('input[aria-label="Custom accent colour"]') as HTMLInputElement;
  return {
    ...r,
    changes,
    row,
    colour,
    /** How many preset swatches are lit. */
    litPresets: () => row().querySelectorAll('.accent-swatch.active').length,
    /** Is the colour field itself shown as the chosen one? */
    litPicker: () => row().querySelector('.color-field.active') !== null,
    /** The row's inherit chip ("Theme default" / "Match device"). */
    inheritChip: () => row().querySelector('button.chip')!,
  };
}

const DEVICE: Customization = { ...DEFAULT_CUSTOMIZATION, themeId: 'midnight', styleId: 'modern', fontId: 'system' };
const MIDNIGHT = getTheme('midnight')!.tokens['--app-accent'];
const EMBER = getTheme('ember')!.tokens['--app-accent'];

describe('Accent: the colour picker writes the same field the presets do', () => {
  it('stores the picked hex, deselects every preset, and shows itself as the choice', () => {
    const r = editor('global', { themeId: 'midnight' }, DEVICE);

    // Nothing chosen yet: the picker opens on the palette's own accent and wears no ring.
    expect(r.colour().value).toBe(MIDNIGHT);
    expect(r.litPicker()).toBe(false);
    expect(r.inheritChip()!.className).toContain('active');

    // A preset first, so the hand-off is what's measured and not an empty row.
    r.click(r.host.querySelector('[aria-label="accent #ef4444"]'));
    expect(r.litPresets()).toBe(1);
    expect(r.colour().value).toBe('#ef4444');

    pick(r.colour(), '#ff8800');
    expect(r.changes.at(-1)).toEqual(['accentColor', '#ff8800']);
    expect(r.colour().value).toBe('#ff8800');
    expect(r.litPicker()).toBe(true);
    expect(r.litPresets()).toBe(0); // the swatch that was lit let go
    expect(r.inheritChip()!.className).not.toContain('active');
    expect(r.row().textContent).toContain('#ff8800');
    r.stop();
  });

  it('loads a saved custom hex back as the selected accent', () => {
    // The reload half: this is what a synced character's stored accentColor looks like on open.
    const r = editor('character', { accentColor: '#7f1d1d' }, DEVICE);
    expect(r.colour().value).toBe('#7f1d1d');
    expect(r.litPicker()).toBe(true);
    expect(r.litPresets()).toBe(0);
    expect(r.inheritChip()!.className).not.toContain('active');
    r.stop();
  });

  it('clearing the accent hands the picker back to the palette it inherits', () => {
    const r = editor('character', { accentColor: '#7f1d1d' }, DEVICE);
    r.click(r.inheritChip()!);
    expect(r.changes.at(-1)).toEqual(['accentColor', undefined]);
    expect(r.litPicker()).toBe(false);
    expect(r.colour().value).toBe(MIDNIGHT); // the device accent it now follows
    r.stop();
  });

  it('opens on the palette the CHARACTER chose, not the device accent it no longer uses', () => {
    // applyOverlayResolved: a character overriding the palette but not the accent is painted with
    // THAT palette's accent. A picker opening on the device's red would offer to "keep" a colour the
    // sheet isn't wearing, and the first drag would silently change the accent.
    const r = editor('character', { themeId: 'ember' }, { ...DEVICE, accentColor: '#ff0000' });
    expect(r.colour().value).toBe(EMBER);
    expect(r.litPicker()).toBe(false);
    r.stop();
  });
});

describe('Accent: a custom hex is applied and derived exactly like a preset', () => {
  it('paints --app-accent and picks the accent ink by contrast, not by hue', () => {
    setTheme('midnight');
    const css = () => document.documentElement.style;

    setAccent('#ffd400'); // bright — near-black ink wins on contrast
    expect(css().getPropertyValue('--app-accent')).toBe('#ffd400');
    expect(css().getPropertyValue('--app-focus')).toBe('#ffd400');
    expect(css().getPropertyValue('--app-accent-text')).toBe('#101013');

    setAccent('#3f2b96'); // dark — white wins
    expect(css().getPropertyValue('--app-accent')).toBe('#3f2b96');
    expect(css().getPropertyValue('--app-accent-text')).toBe('#ffffff');

    // Clearing it falls back to the palette's own accent, still derived the same way.
    setAccent(null);
    expect(css().getPropertyValue('--app-accent')).toBe(MIDNIGHT);
  });
});

/*
 * A colour input is not a click. Chromium fires `input` on every frame of a drag across the saturation
 * square, and per-character each one ran Customize → updateCharacter → setRoster — and setRoster IS the
 * undo timeline. One pick became dozens of steps (measured: five frames, five Ctrl+Z to take them back),
 * and 60 of them evict every real edit a player made, each one a full roster snapshot.
 *
 * The channel already existed for exactly this ("typing a value is one undo step, not one per key") —
 * updatePlay's coalesceTag. updateCharacter now has it too, and the drawer tags every field, so the
 * OTHER per-character colour input (consumables) is fixed by the same three lines.
 */
const CHAR = { id: 'c1', name: 'Test Fixture', customization: undefined } as unknown as Character;

describe('Customize drawer: one colour drag is one undo step', () => {
  it('tags every field edit, so same-field calls can coalesce', () => {
    const tags: (string | undefined)[] = [];
    const r = renderDom(
      <CustomizeModal
        character={CHAR}
        globalDefault={DEFAULT_CUSTOMIZATION}
        onCustomize={(_fn, tag) => tags.push(tag)}
        onClose={() => undefined}
      />,
    );
    const input = (label: string) => r.host.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;

    for (const hex of ['#111111', '#222222', '#333333']) pick(input('Custom accent colour'), hex);
    expect(tags).toEqual(['cust:accentColor', 'cust:accentColor', 'cust:accentColor']);

    // The sibling control the same fix covers — it had the identical shape and nobody had noticed.
    pick(input('Consumable highlight colour'), '#0000ff');
    expect(tags.at(-1)).toBe('cust:consumableColor');

    // Tagged per FIELD, not per control: a preset click carries it too (two presets inside 350ms being
    // one undo step is the same bargain as typing).
    r.click(r.host.querySelector('[aria-label="accent #ef4444"]'));
    expect(tags.at(-1)).toBe('cust:accentColor');
    r.stop();
  });

  it('collapses a 40-frame drag into ONE step and keeps every edit made before it', () => {
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock); // the coalesce window is wall-clock
    const undoable = () => {
      let api!: Undoable<string>;
      function H() {
        api = useUndoableState('start');
        return null;
      }
      const h = renderDom(<H />);
      return { stop: h.stop, get: () => api };
    };
    const frame = (i: number) => `#0000${String(i).padStart(2, '0')}`;

    const u = undoable();
    // Five real edits — the ones a player would hate to lose.
    for (const v of ['e1', 'e2', 'e3', 'e4', 'e5']) {
      clock += 1000;
      act(() => u.get().set(v));
    }
    const TAG = { coalesce: true, tag: 'char:c1:cust:accentColor' };
    for (let i = 0; i < 40; i++) {
      clock += 16;
      act(() => u.get().set(frame(i), TAG));
    }
    expect(u.get().state).toBe(frame(39));

    clock += 1000;
    act(() => u.get().undo());
    expect(u.get().state).toBe('e5'); // one press takes back the whole drag, not one frame of it
    for (let i = 0; i < 5; i++) act(() => u.get().undo());
    expect(u.get().state).toBe('start'); // and nothing was evicted: the timeline is 6 deep, not 45
    expect(u.get().canUndo).toBe(false);
    u.stop();

    // Untagged, the same drag is 40 steps — which is what the tag buys, and what MAX_DEPTH 60 eats.
    const bare = undoable();
    for (let i = 0; i < 40; i++) {
      clock += 16;
      act(() => bare.get().set(frame(i)));
    }
    act(() => bare.get().undo());
    expect(bare.get().state).toBe(frame(38));
    bare.stop();
    vi.restoreAllMocks();
  });

  /*
   * React 18 StrictMode double-invokes a `setState` updater function in dev builds (both invocations
   * see the same prior state). `set()`'s updater used to write `lastPush.current` (the coalesce clock)
   * INSIDE that function — so the second invocation saw the tag+timestamp the first one had JUST
   * written, read `now - lastPush.time === 0` with a matching tag, and wrongly took the coalesce
   * branch; React commits that second invocation's result. Coalescing meant "don't add a past entry
   * for whatever the present was before this edit", so the state from right before the tagged edit
   * (here, 'seed') silently dropped out of the timeline — not the tagged edit's own resulting value.
   *
   * React only double-invokes an update AFTER the hook's first-ever one (that one takes an eager
   * dispatch-time bailout instead), hence the untagged `'seed'` push before the tagged one below —
   * without it this leg passes on the buggy code too, having never exercised the double-invoke path.
   *
   * Mutation check: moving `lastPush.current = { time: now, tag: opts?.tag }` back inside the `setHist`
   * updater in src/useUndoableState.ts (where the comment marks it) fails this leg — the second undo()
   * lands on 'start' instead of 'seed' — while every other leg in this file still passes.
   */
  it('a tagged push keeps its own history entry under StrictMode double-invocation', () => {
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    let api!: Undoable<string>;
    function H() {
      api = useUndoableState('start');
      return null;
    }
    const r = renderDom(
      <StrictMode>
        <H />
      </StrictMode>,
    );

    clock += 1000;
    act(() => api.set('seed'));
    clock += 1000;
    act(() => api.set('tagged', { coalesce: true, tag: 'grp' }));
    clock += 1000;
    act(() => api.set('plain'));
    expect(api.state).toBe('plain');

    act(() => api.undo());
    expect(api.state).toBe('tagged'); // the untagged push's own step
    act(() => api.undo());
    expect(api.state).toBe('seed'); // the tagged push's own step — the one StrictMode used to eat
    act(() => api.undo());
    expect(api.state).toBe('start');
    expect(api.canUndo).toBe(false);

    r.stop();
    vi.restoreAllMocks();
  });

  /*
   * Refuter (2026-09-17): set() decides its coalesce branch at CALL time, from lastPush.current as
   * it stood before the call. undo()/redo() used to write their lastPush.current reset INSIDE the
   * setHist updater, which React doesn't run until it flushes the batch — so a set() dispatched
   * right after undo() in the SAME batch (same synchronous tick, no flush between them) still read
   * the stale tag/timestamp undo was about to clear, coalesced, and threw away the past entry undo
   * had just restored. The reset now happens synchronously at call time, like set()'s does.
   *
   * Mutation check: moving `lastPush.current = { time: 0 }` back inside undo()'s setHist updater in
   * src/useUndoableState.ts (~line 67, guarded by `if (!h.past.length) return h;`) fails this leg —
   * `expect(api.canUndo).toBe(true)` below gets `false` instead (past came back empty instead of
   * ['start']), because the batched set() still read the stale tag/timestamp and coalesced. Mutation
   * reverted after confirming the failure.
   */
  it('a set() batched right after undo() still sees the reset, so the pre-undo step survives', () => {
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    let api!: Undoable<string>;
    function H() {
      api = useUndoableState('start');
      return null;
    }
    const r = renderDom(<H />);
    const TAG = { coalesce: true, tag: 'T' };

    clock += 1000;
    act(() => api.set('p', TAG));
    expect(api.state).toBe('p');

    act(() => {
      api.undo();
      api.set('q', TAG); // same tag, same tick — the batch the refuter measured
    });
    expect(api.state).toBe('q');
    expect(api.canUndo).toBe(true); // 'start' must still be in past, not dropped by a stale coalesce

    act(() => api.undo());
    expect(api.state).toBe('start');
    act(() => api.undo()); // no-op (nothing left), but must stay on 'start', not be stuck on 'q'
    expect(api.state).toBe('start');
    expect(api.canUndo).toBe(false);

    // Benign case stays: a same-tag pair with no undo between them still coalesces into one step.
    clock += 1000;
    act(() => api.set('r', { coalesce: true, tag: 'T2' }));
    clock += 10;
    act(() => api.set('s', { coalesce: true, tag: 'T2' }));
    expect(api.state).toBe('s');
    act(() => api.undo());
    expect(api.state).toBe('start'); // one undo takes back both 'r' and 's' — same coalesced step

    r.stop();
    vi.restoreAllMocks();
  });
});
