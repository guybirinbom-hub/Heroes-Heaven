import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setupPersist,
  schedulePersist,
  persistNow,
  flushPersist,
  cancelPersist,
  hasPendingPersist,
  PERSIST_DEBOUNCE_MS,
} from '../src/data/persist';

/** Fresh writer + result spies, wired up before each test. */
function wire(writerOk = true) {
  const writer = vi.fn((_roster: unknown) => writerOk);
  const onResult = vi.fn((_ok: boolean) => {});
  setupPersist(writer, onResult);
  return { writer, onResult };
}

describe('persist scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cancelPersist(); // clear any pending state from a prior test
  });

  it('debounces: multiple schedules coalesce into ONE write of the latest value', () => {
    const { writer } = wire();
    schedulePersist({ v: 1 });
    schedulePersist({ v: 2 });
    schedulePersist({ v: 3 });
    expect(writer).not.toHaveBeenCalled(); // nothing written yet — still within the idle gap
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith({ v: 3 }); // only the latest wins
  });

  it('reports the write result to onResult', () => {
    const { onResult } = wire(false); // storage rejects (e.g. quota)
    schedulePersist({ v: 1 });
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('flushPersist writes the pending value immediately and clears the pending state', () => {
    const { writer } = wire();
    schedulePersist({ v: 42 });
    expect(hasPendingPersist()).toBe(true);
    flushPersist();
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith({ v: 42 });
    expect(hasPendingPersist()).toBe(false);
    // The debounce timer must not fire a second write after a flush.
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('flushPersist is a no-op when nothing is pending', () => {
    const { writer } = wire();
    flushPersist();
    expect(writer).not.toHaveBeenCalled();
  });

  it('persistNow writes immediately and supersedes any pending debounced write', () => {
    const { writer } = wire();
    schedulePersist({ v: 1 }); // queued
    persistNow({ v: 2 }); // structural change — immediate
    expect(writer).toHaveBeenCalledTimes(1);
    expect(writer).toHaveBeenCalledWith({ v: 2 });
    // The earlier debounce must not fire a stale { v: 1 } afterwards.
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(writer).toHaveBeenCalledTimes(1);
  });

  it('cancelPersist drops a pending write so neither flush nor the timer writes it', () => {
    const { writer } = wire();
    schedulePersist({ v: 1 });
    cancelPersist();
    expect(hasPendingPersist()).toBe(false);
    flushPersist();
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS);
    expect(writer).not.toHaveBeenCalled();
  });
});
