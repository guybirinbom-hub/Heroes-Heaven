/*
 * WHAT THIS TAB KNOWS THE ROSTER KEY HOLDS, AND WHAT EACH WRITE WAS BUILT ON (package H1, 2026-10-18).
 *
 * Two tabs of one browser profile share ONE roster key. A tab's React state is based on a value it read
 * from that key or wrote there itself — `known` below. When the key moves to something else, another
 * tab wrote it, and src/data/rosterTabs.ts merges that write into this tab's state against the roster
 * both grew from (src/data/rosterMerge.ts).
 *
 * "The roster both grew from" is not always this tab's `known`. Two tabs can each write before the
 * other's `storage` event arrives (a tab whose main thread is busy rendering hears of a write late), so
 * a write can be built on an OLDER value than the one this tab last wrote — and merged against this
 * tab's newer write it would read as "the other tab took our change back". So every write records, under
 * LINEAGE_KEY, the signature of the value it replaced (`on`) beside its own (`sig`), and each tab keeps
 * the last few values it knew by signature (`history`): the merge base is the value the write says it
 * was built on, when this tab still has it.
 *
 * The lineage key is written BEFORE the roster key (src/data/storage.ts saveRoster), so a tab handling
 * the roster's `storage` event already holds it; `sig` must equal the current roster's own signature or
 * the record belongs to another write (two tabs interleaving) and is not used. Old app versions write no
 * lineage; their writes fall back to `known` as the base, exactly as before.
 *
 * A leaf module (only hash53): storage.ts writes through it, rosterTabs.ts reads it.
 */
import { hash53 } from './authored';

/** `{ sig, on }` of the last roster write: its own signature and that of the value it replaced. */
export const LINEAGE_KEY = 'wanderers-codex:roster-lineage:v1';

/** How many known values a tab keeps by signature. A write built on anything older merges against
 *  `known` (the pre-lineage behaviour). A tab's own writes share almost all their structure, but each
 *  value taken from another tab is a parse of its own — so this stays small. */
const HISTORY = 8;

/** A roster value's signature: its length and its cyrb53 — content, never a clock. */
export function rosterSig(raw: string): string {
  return `${raw.length}.${hash53(raw)}`;
}

export interface KnownRoster {
  /** The raw value, or null when the key was empty. */
  raw: string | null;
  sig: string | null;
  roster: unknown[];
}

let known: KnownRoster = { raw: null, sig: null, roster: [] };
const history = new Map<string, unknown[]>();

/** This tab's state is now based on `raw` (it wrote it, read it at launch, or merged it in). */
export function noteRosterKnown(raw: string | null, roster: unknown[], sig: string | null = raw === null ? null : rosterSig(raw)): void {
  known = { raw, sig, roster };
  if (sig === null) return;
  history.delete(sig);
  history.set(sig, roster);
  while (history.size > HISTORY) history.delete(history.keys().next().value as string);
}

export function knownRoster(): KnownRoster {
  return known;
}

/** A value this tab knew, by signature. */
export function rosterFromHistory(sig: string): unknown[] | undefined {
  return history.get(sig);
}

/** The lineage record, when it describes the roster value whose signature is `sig`. */
export function lineageOf(sig: string): { on: string | null } | null {
  try {
    const raw = localStorage.getItem(LINEAGE_KEY);
    const rec = raw ? (JSON.parse(raw) as { sig?: unknown; on?: unknown }) : null;
    if (!rec || rec.sig !== sig) return null;
    return { on: typeof rec.on === 'string' ? rec.on : null };
  } catch {
    return null;
  }
}

/** Record that the write about to happen replaces `on` with `sig`. Best-effort: a write without it
 *  merges against `known` on the other side. */
export function writeLineage(sig: string, on: string | null): void {
  try {
    localStorage.setItem(LINEAGE_KEY, JSON.stringify({ sig, on }));
  } catch {
    /* quota: the roster write itself reports the failure */
  }
}
