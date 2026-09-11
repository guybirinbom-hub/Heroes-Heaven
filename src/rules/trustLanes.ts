/*
 * WHY THIS FILE EXISTS.
 *
 * The trust gate (docs/trust-gate.md) turns a record's mechanics off by stripping FIELDS off the
 * record — but a few dozen mechanics are not on a record at all: they are written into the engine,
 * keyed by a record id. `if (owned.has('sneak-attack'))` in derive.ts is the shape. No amount of
 * field-stripping reaches those, because the id is in the CODE, not in the data (plan section 3,
 * "Hard-coded engine lanes keyed by record id").
 *
 * So the ledger carries a fifth lane — `lanes.engine`, a plain list of record ids whose hard-coded
 * lane is off — and this module is the one place that list is stored and asked about. The inventory
 * of those lanes, and which of them are gated at all, is `scripts/data/trust-lanes.json`;
 * `scripts/trust-lanes-check.mjs` (in `npm run verify`) goes red when a NEW id-keyed lane is added
 * to src/rules without being entered there, so the next such lane cannot ship ungated.
 *
 * Written ONCE, at content load, by `applyTrustGate` in src/data/trustGate.ts — never per character,
 * exactly like `setSituationalTrustOff` in situationalBonuses.ts and for the same reason.
 */

const offIds = new Set<string>();

/** The ids whose hard-coded engine lane is OFF. Replaces the whole set (an empty list = gate off). */
export const setEngineTrustOff = (ids: Iterable<string>): void => {
  offIds.clear();
  for (const id of ids) offIds.add(id);
};

/** Whether this record's hard-coded engine lane must apply NOTHING. The record itself still exists,
 *  is still pickable, still shows its text — only the code lane keyed to it goes quiet. */
export const engineLaneOff = (id: string | undefined | null): boolean => !!id && offIds.has(id);
