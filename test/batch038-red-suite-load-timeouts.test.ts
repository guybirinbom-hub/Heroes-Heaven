/*
 * BATCH 038 — GATE-RED, group `suite-load-timeouts` (family repair). No record and no print claim:
 * four suite failures that were TEST COST under full-suite load (every one passed alone).
 *
 * The cost cuts themselves live in the files they fix (authoring-guards.test.ts: one shared memo of
 * scripts/*.mjs + an early exit; batch035-field-diff.test.ts: both mirror walks run concurrently) and
 * are pinned by those files' own unchanged assertions. What is pinned here is the shared cause: vitest
 * forks one worker per core minus one, and under that load a worker can miss the hard-coded 60 s
 * START_TIMEOUT (bug-tracker-offline-door.test.tsx never started).
 */
import { availableParallelism } from 'node:os';
import { describe, expect, it } from 'vitest';
import config from '../vitest.config';

describe('batch 038 suite-load-timeouts — the suite leaves cores free', () => {
  it('caps vitest workers below the default of cores - 1', () => {
    const mw = (config as { test?: { maxWorkers?: number | string } }).test?.maxWorkers;
    expect(mw).toBeDefined();
    // Resolve a percentage EXACTLY as vitest 4 does (getWorkersCountByPercentage: Math.round, clamped
    // to 1..cores) — a Math.floor here under-counts on e.g. 3 cores (60% -> 1, vitest -> 2 = default).
    const cpus = availableParallelism();
    const n = typeof mw === 'string'
      ? Math.max(1, Math.min(cpus, Math.round((Number.parseInt(mw) / 100) * cpus)))
      : mw!;
    expect(n).toBeGreaterThan(0);
    // Default forks = cores - 1; anything at or above it is the configuration that starved the suite.
    expect(n).toBeLessThan(Math.max(2, availableParallelism() - 1));
  });
});
