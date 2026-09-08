/**
 * Timeout for a test whose body does not run in-process.
 *
 * These cases shell out to a real node child — the WG comparers, the overlay applier, the batch
 * close/commit guards, the deity instrument, the test-flip audit — each of which boots its own
 * runtime and reads the shipped data (core.json, the AoN mirror) from cold. Alone that fits inside
 * vitest's 5 s default; under the FULL suite the file competes with every other worker for CPU and
 * disk and the same child takes several times longer, so these files passed one at a time and failed
 * as timeouts in the suite. The work is unchanged — only the clock was too short for it.
 *
 * ⚠ Not a licence to slow a test down: a case that legitimately needs more than a second or two of
 * WALL time under load is a child process. An in-process test that starts timing out is a bug.
 */
export const CHILD_TIMEOUT = 90_000;

/**
 * The deity instrument re-reads every deity page in the Archives mirror and compares every structured
 * field, which is minutes of work rather than seconds (measured: 120 s exceeded under the suite).
 */
export const INSTRUMENT_TIMEOUT = 300_000;
