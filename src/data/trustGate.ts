/*
 * WHY THIS FILE EXISTS
 *
 * Guy, 2026-09-10: *"i cant trust them and i will go over them in the future but for now i want to
 * turn them off … if we have implementation on all of the thing wg has then the app is palyble."*
 * docs/trust-gate.md is the plan; this is its section 3 — the ONE place where a rule we have not
 * checked stops touching the sheet.
 *
 * WHAT IT DOES. `applyTrustGate` takes the CORE object (public/core.json, before the seed, homebrew,
 * user modes and the catalog are merged in — src/data/index.ts:mergeWithSeed) and returns a NEW core
 * with the field paths named in src/data/trust-ledger.json removed. The record itself stays: same id,
 * same printed text, same prerequisites, same pickers, same option rows. It simply grants nothing.
 * Homebrew and the player's own modes are untouched BY CONSTRUCTION, because they are merged after
 * this runs.
 *
 * IT NEVER MUTATES. `merge()` in index.ts is a shallow spread of the bucket MAP, so `db.feats[id]` IS
 * the object inside `cachedCore` and inside `seedContent`: a `delete rec.field` would corrupt the only
 * copy in memory and the switch could never turn the rules back on. Every record this function changes
 * is copied (and copied along each nested path it edits); everything else is passed by reference.
 *
 * WHAT IT CANNOT REACH, and how that is handled:
 *   · situational stars, the FEAT_GRANTS registries and the engine's hard-coded id lanes live in CODE,
 *     so the ledger's `lanes` lists are handed to lane B/C's setters here, once per gate run;
 *   · modes and stances carry their numbers on their OWN records (content.modes[id] /
 *     content.stances[id], applied with no ownership test at all), so their payload is stripped in the
 *     same pass — the toggle and the chip still show, and apply nothing.
 *
 * THE MARKER reads `trustOff(bucket, id)` — a side map, deliberately NOT a `_trust` key stamped on the
 * record: a synthetic key on a game-data record breaks the display-hygiene rule and would leak into
 * the homebrew editor, the exporter and every deep compare.
 */
import ledgerJson from './trust-ledger.json';
import { getPrefs } from './prefs';
import { setSituationalTrustOff } from '../rules/situationalBonuses';
import { setEngineTrustOff } from '../rules/trustLanes';
import { setFeatGrantTrustOff } from '../rules/featGrants';

export interface TrustLedger {
  coreSha: string;
  wgSha: string;
  generator: string;
  /** "bucket/id" -> the field paths that go dark on that record. Absent = the record is untouched. */
  records: Record<string, string[]>;
  lanes: {
    situational: string[];
    /** Per KIND since docs/trust-gate-decisions.md decision 2: `{ "<id>": ["skill","save"] }` — the
     *  registry kinds that are OFF for that carrier. Passed straight through to lane C's setter. */
    featGrants: Record<string, string[]>;
    modes: string[];
    stances: string[];
    engine: string[];
  };
}

/** The generated OFF list, imported as a MODULE, not fetched: mergeWithSeed is synchronous and runs
 *  the instant core.json parses, so a second fetch would leave the first merge ungated. */
export const TRUST_LEDGER = ledgerJson as unknown as TrustLedger;

/** Whether the gate is applying. Default ON — a player sees only checked rules until they say
 *  otherwise (docs/trust-gate.md §4). */
export function trustGateOn(): boolean {
  return getPrefs().trustGate !== false;
}

let offMap: Record<string, string[]> = {};
let census = { recordsOff: 0, recordsPartly: 0, stars: 0 };

/** The paths the LAST `applyTrustGate` call stripped from this record, or undefined when it is fully
 *  applied. Keyed "bucket/id" — the marker's only input. */
export function trustOff(bucket: string, id: string): string[] | undefined {
  return offMap[`${bucket}/${id}`];
}

/**
 * The numbers the Settings card prints.
 *
 * `recordsOff` — records the gate emptied: nothing strippable is left applying.
 * `recordsPartly` — records the gate touched that still apply some of their rules.
 * `stars` — situational bonuses ("+1 to X when Y") that stop showing on the sheet.
 *
 * Zero until a gate run, which is the truth: with the switch off, nothing is off. The off/partly split
 * is measured against the paths the ledger names ANYWHERE (its own universe), not the full 137-path
 * strippable universe in scripts/data/trust-fields.json — that file belongs to the generator and is
 * not shipped, and the difference can only move a record from "off" to "partly", never hide one.
 */
export function trustCensus(): { recordsOff: number; recordsPartly: number; stars: number } {
  return census;
}

/** Turning the switch OFF must also empty the code-side lanes lane B/C hold, or the stars and grants
 *  the last gated load suppressed would stay suppressed until a relaunch. */
export function clearTrustGate(): void {
  offMap = {};
  census = { recordsOff: 0, recordsPartly: 0, stars: 0 };
  setSituationalTrustOff([]);
  setEngineTrustOff([]);
  setFeatGrantTrustOff({});
}

/*
 * A mode's / a stance's PAYLOAD — the numbers, grants and attacks it applies while it is on. Name,
 * note, duration, gates, exclusive group and (for a stance) its printed Requirements all stay, so the
 * toggle and the chip look exactly the same and simply do nothing. `weaknesses` and `speedPenalty`
 * stay too: docs/trust-gate.md §1 — only a BENEFIT goes dark, and turning a cost off would hand the
 * player a character stronger than print. `modifiers` is emptied rather than deleted; it is required
 * on ModeDef and the panel reads its length.
 */
const MODE_PAYLOAD = [
  'battleForm',
  'resistances',
  'immunities',
  'senses',
  'speeds',
  'grantedStrikes',
  'strikeDamage',
  'spellSlotBonus',
  'creatureTraits',
  'unarmedTraits',
  'weaponTraits',
];
const STANCE_PAYLOAD = ['strikes', 'acBonus', 'dexCap', 'resistances', 'senses', 'senseIfFeat', 'speeds', 'saves'];

type Node = Record<string, unknown>;

/**
 * Remove one path, copying along the way — the whole mechanic of the gate.
 *
 * A segment ending in `[]` is an array to map over (`choice.options[].grant.skills` empties the grant
 * inside every option row while the row itself — id, label, value, description — survives, which is
 * what makes a gated picker still ask its question). Returns the SAME object when nothing changed, so
 * the caller can tell an actual strip from a path the record never carried.
 */
function removeAt(node: unknown, segs: string[]): unknown {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return node;
  const rec = node as Node;
  const head = segs[0];
  const isArr = head.endsWith('[]');
  const key = isArr ? head.slice(0, -2) : head;
  if (!(key in rec)) return node;
  if (segs.length === 1) {
    const copy = { ...rec };
    delete copy[key];
    return copy;
  }
  const child = rec[key];
  const rest = segs.slice(1);
  let next: unknown;
  if (isArr) {
    if (!Array.isArray(child)) return node;
    let changed = false;
    const mapped = child.map((el) => {
      const m = removeAt(el, rest);
      if (m !== el) changed = true;
      return m;
    });
    if (!changed) return node;
    next = mapped;
  } else {
    next = removeAt(child, rest);
    if (next === child) return node;
  }
  return { ...rec, [key]: next };
}

/** Whether a path resolves to something on this record (the census's only question). */
function hasAt(node: unknown, segs: string[]): boolean {
  if (node === null || typeof node !== 'object') return false;
  const head = segs[0];
  const isArr = head.endsWith('[]');
  const key = isArr ? head.slice(0, -2) : head;
  const child = (node as Node)[key];
  if (child === undefined) return false;
  if (segs.length === 1) return true;
  const rest = segs.slice(1);
  return isArr ? Array.isArray(child) && child.some((el) => hasAt(el, rest)) : hasAt(child, rest);
}

/**
 * Gate a parsed core object. Pure: the input is never mutated, and every record the ledger does not
 * name is passed through by reference.
 *
 * Generic in its argument so the app can hand it a `Partial<ContentDatabase>` and a test can hand it
 * the raw parsed JSON, and both get their own type back.
 */
export function applyTrustGate<T>(core: T, ledger: TrustLedger = TRUST_LEDGER): T {
  const src = core as unknown as Record<string, Record<string, Node> | undefined>;
  const out: Record<string, unknown> = { ...(src as Record<string, unknown>) };
  const off: Record<string, string[]> = {};
  /* Bucket maps are copied at most once each, the first time a record in them changes. */
  const copied = new Set<string>();
  const bucketMap = (bucket: string): Record<string, Node> | undefined => {
    const map = src[bucket];
    if (!map) return undefined;
    if (!copied.has(bucket)) {
      copied.add(bucket);
      out[bucket] = { ...map };
    }
    return out[bucket] as Record<string, Node>;
  };

  /* The ledger's own path universe, for the off/partly census question "does anything still apply?" */
  const universe = [...new Set(Object.values(ledger.records).flat())].map((p) => p.split('.'));
  let recordsOff = 0;
  let recordsPartly = 0;

  for (const [key, paths] of Object.entries(ledger.records)) {
    const slash = key.indexOf('/');
    const bucket = key.slice(0, slash);
    const id = key.slice(slash + 1);
    const rec = src[bucket]?.[id];
    // A ledger key the data no longer has: fail open and say nothing. The generator's own guard
    // (scripts/trust-ledger-check.mjs) is where a stale key is caught, not here at load time.
    if (!rec) continue;
    let next: unknown = rec;
    const removed: string[] = [];
    for (const p of paths) {
      const segs = p.split('.');
      next = removeAt(next, segs);
      /* Asked of the ORIGINAL record, not of the running copy: a ledger entry can name both a
       * container and a path inside it (`enhancement` and `enhancement.grant.senses`), and whichever
       * is applied first takes the other with it. The side map is what the player is told went dark,
       * so it must list every path the record really carried, not just the ones that happened to be
       * the edit that changed the object. */
      if (hasAt(rec, segs)) removed.push(p);
    }
    if (!removed.length) continue;
    off[key] = removed;
    const map = bucketMap(bucket);
    if (map) map[id] = next as Node;
    const survives = universe.some((segs) => !paths.includes(segs.join('.')) && hasAt(next, segs));
    if (survives) recordsPartly++;
    else recordsOff++;
  }

  /* Modes and stances: the numbers live on their own record and are applied with no ownership test,
   * so stripping the payload here is the whole gate for them (docs/trust-gate.md §3). */
  for (const [bucket, fields] of [
    ['modes', MODE_PAYLOAD],
    ['stances', STANCE_PAYLOAD],
  ] as const) {
    const lane = bucket === 'modes' ? ledger.lanes.modes : ledger.lanes.stances;
    for (const id of lane) {
      const rec = src[bucket]?.[id];
      if (!rec) continue;
      const copy: Node = { ...rec };
      const removed: string[] = [];
      for (const f of fields) {
        if (copy[f] === undefined) continue;
        delete copy[f];
        removed.push(f);
      }
      if (bucket === 'modes' && Array.isArray(copy.modifiers) && copy.modifiers.length) {
        copy.modifiers = [];
        removed.push('modifiers');
      }
      if (!removed.length) continue;
      off[`${bucket}/${id}`] = removed;
      const map = bucketMap(bucket);
      if (map) map[id] = copy;
    }
  }

  offMap = off;
  census = { recordsOff, recordsPartly, stars: ledger.lanes.situational.length };
  /* The three code-side lanes, written once per gate run — never per character. */
  setSituationalTrustOff(ledger.lanes.situational);
  setEngineTrustOff(ledger.lanes.engine);
  setFeatGrantTrustOff(ledger.lanes.featGrants);
  return out as unknown as T;
}
