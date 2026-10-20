// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useUndoableState, type Undoable, type UndoableOptions } from '../src/useUndoableState';
import { revertRosterStep } from '../src/data/rosterMerge';
import { renderDom } from './_render';

/**
 * S4 (2026-10-20, a checker's finding on 6393b29): Ctrl+Z after another tab's write was folded in undid
 * THAT write — every fold and every cloud adopt was its own undo step — and left this tab's own last
 * action in place. A change that is not this screen's own is now set with `record: false`, and undo
 * carries this screen's last step back onto the present (src/useUndoableState.ts; the App-level leg is
 * test/bug-two-tabs-roster.test.tsx (9)).
 * MUTATION (run 2026-10-20): ignore `record: false` (`if (opts?.record === false && Math.random() > 2)`)
 * — every leg below fails, the first on `undo takes back the player’s own step, and only it: expected
 * [ 'potion' ] to deeply equal [ 'dagger' ]`.
 */
function mount<T>(initial: T, options?: UndoableOptions<T>, strict = false) {
  let api!: Undoable<T>;
  function H() {
    api = useUndoableState(initial, options);
    return null;
  }
  const h = renderDom(strict ? (
    <StrictMode>
      <H />
    </StrictMode>
  ) : (
    <H />
  ));
  return { stop: h.stop, get: () => api };
}

type R = { id: string; v: string[] }[];
const roster = (...v: string[]): R => [{ id: 'pc', v }];
/** A list merge for the test: the step's own additions/removals carried onto the present. */
const listRevert: UndoableOptions<R>['revert'] = (present, from, to) => {
  const add = to[0].v.filter((x) => !from[0].v.includes(x));
  const drop = from[0].v.filter((x) => !to[0].v.includes(x));
  return [{ id: 'pc', v: [...present[0].v.filter((x) => !drop.includes(x)), ...add] }];
};

for (const strict of [false, true])
describe(`useUndoableState: a change that is not this screen’s own is not an undo step (strict: ${strict})`, () => {
  it('another tab’s change (record: false) is not undone; this screen’s own last step is, carried onto the present', () => {
    const u = mount(roster(), { revert: listRevert }, strict);
    act(() => u.get().set(roster('potion'))); // the player's own step
    act(() => u.get().set((r) => [{ id: 'pc', v: [...r[0].v, 'dagger'] }], { record: false })); // the other tab's dagger
    expect(u.get().state[0].v).toEqual(['potion', 'dagger']);
    act(() => u.get().undo());
    expect(u.get().state[0].v, 'undo takes back the player’s own step, and only it').toEqual(['dagger']);
    expect(u.get().canUndo).toBe(false);
    act(() => u.get().redo());
    expect(u.get().state[0].v).toEqual(['dagger', 'potion']);
    u.stop();
  });

  it('nothing came in since the step: undo restores the old value itself (no revert asked)', () => {
    const revert = vi.fn(listRevert);
    const u = mount(roster(), { revert }, strict);
    const first = u.get().state;
    act(() => u.get().set(roster('potion')));
    act(() => u.get().undo());
    expect(u.get().state).toBe(first);
    expect(revert).not.toHaveBeenCalled();
    u.stop();
  });

  it('an edit right after a change that is not a step never coalesces into the step before it', () => {
    let clock = 1000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const u = mount(roster(), { revert: listRevert }, strict);
    const TAG = { coalesce: true, tag: 't' };
    act(() => u.get().set(roster('a'), TAG));
    clock += 10;
    act(() => u.get().set((r) => [{ id: 'pc', v: [...r[0].v, 'theirs'] }], { record: false }));
    clock += 10;
    act(() => u.get().set((r) => [{ id: 'pc', v: [...r[0].v, 'b'] }], TAG));
    act(() => u.get().undo());
    expect(u.get().state[0].v).toEqual(['a', 'theirs']);
    act(() => u.get().undo());
    expect(u.get().state[0].v).toEqual(['theirs']);
    spy.mockRestore();
    u.stop();
  });

  it('resetHistory: the value belongs to someone else now — no step of before can be undone into it', () => {
    const u = mount(roster(), { revert: listRevert }, strict);
    act(() => u.get().set(roster('old account')));
    act(() => u.get().set(roster('new account'), { record: false, resetHistory: true }));
    expect(u.get().canUndo).toBe(false);
    act(() => u.get().undo());
    expect(u.get().state[0].v).toEqual(['new account']);
    u.stop();
  });

  it('with the roster revert App uses: a character the other tab added after the step survives the undo', () => {
    const u = mount([{ id: 'a', hp: 10 }] as { id: string; hp: number }[], { revert: revertRosterStep }, strict);
    act(() => u.get().set([{ id: 'a', hp: 7 }]));
    act(() => u.get().set((r) => [...r, { id: 'b', hp: 3 }], { record: false }));
    act(() => u.get().undo());
    expect(u.get().state).toEqual([{ id: 'a', hp: 10 }, { id: 'b', hp: 3 }]);
    u.stop();
  });
});
