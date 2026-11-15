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
 * THE MARKER asks `trustHeldBack(bucket, id)` — the side map `trustOff` plus every code-side lane —
 * deliberately NOT a `_trust` key stamped on the record: a synthetic key on a game-data record breaks the display-hygiene rule and would leak into
 * the homebrew editor, the exporter and every deep compare.
 */
import ledgerJson from './trust-ledger.json';
import { getPrefs } from './prefs';
import { setSituationalTrustOff, shippedSituational } from '../rules/situationalBonuses';
import { engineLaneOff, setEngineTrustOff } from '../rules/trustLanes';
import { grantKindsHeldBack, setFeatGrantTrustOff } from '../rules/featGrants';
import { CHOICE_FEAT_GRANTS, FEAT_FEAT_GRANTS, FEAT_FEAT_GRANTS_LEVELED, FEAT_RANK_FEAT_GRANTS } from '../rules/featFeatGrants';

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
  /** "bucket/id" of records created from a page with NO rules encoded yet (scripts/trust-ledger.mjs).
   *  Nothing to strip, so not a `records` entry — the marker says so for them whatever the switch says,
   *  because turning the gate off cannot apply rules that were never written. */
  unencoded?: string[];
  /** "bucket/id" -> what a record created from its page prints but does not apply yet, in the player's
   *  words ("Azlant Lore, the Azlanti language"). Some of its rules are encoded, not all — the marker
   *  says which, whatever the switch says, for the same reason as `unencoded`. */
  partly?: Record<string, string>;
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

/* The 8 buckets Wanderer's Guide is paired against (scripts/trust-ledger.mjs BUCKETS). The code-side
 * lanes are keyed by BARE id, and the generator puts an id on a lane only when EVERY twin of it in
 * these buckets is off — so a spell, a trait page or an itemBonus row that merely shares the slug is
 * never one of the records the lane speaks for, and must not get the line. */
const LANE_BUCKETS = new Set(['feats', 'classFeatures', 'heritages', 'backgrounds', 'items', 'ancestries', 'classes', 'actions']);

/** bare carrier id -> 'modes' / 'stances' when a mode or stance it carries had its payload stripped by
 *  the LAST gate run. Filled beside `offMap`, emptied with it. */
let carrierOff: Record<string, string[]> = {};

/** "bucket/id" -> `grants:<name>` for each action or feat this record hands over whose own rules the
 *  LAST gate run held back (Clawdancer Dedication -> Claw Stance, Talon Stance). Built once per gate
 *  run, after every other lane is set, from `heldBackBase` of the granted record. */
let granterOff: Record<string, string[]> = {};

/** How many records in the 8 buckets show the line — counted once per gate run. `lastHeldCount`
 *  survives a switch-off so the Settings sentence can say what turning it back on would do. */
let heldCount = 0;
let lastHeldCount: number | undefined;

/**
 * THE ONE QUESTION the "not yet verified" line asks: is any rule of this record held back right now,
 * in ANY lane? Returns the held-back parts as paths `trustWords` can say in plain words, or undefined.
 *
 * The records map (`trustOff`) only knows about FIELDS stripped off the record. A record whose only
 * dark rule lives in code — a situational star (Incredible Initiative's +2), a FEAT_GRANTS entry, a
 * hard-coded engine lane, the mode or stance it carries — is in no `records` entry, so asking the
 * side map alone left those cards silent. Each code lane is asked through its own module's reader,
 * never re-derived here, so this can never disagree with what the sheet applies.
 *
 * A record that HANDS OVER a held-back action or feat (`granterOff`) owes the line too: the player
 * took Clawdancer Dedication, entered Claw Stance, and nothing applied.
 *
 * With the switch off nothing is held back: undefined, whatever the lanes last held.
 */
export function trustHeldBack(bucket: string, id: string): string[] | undefined {
  if (!trustGateOn()) return undefined;
  const out = heldBackBase(bucket, id);
  out.push(...(granterOff[`${bucket}/${id}`] ?? []));
  return out.length ? [...new Set(out)] : undefined;
}

/** Every lane but the granter pass, with no switch test — what `trustHeldBack` and the granter pass
 *  both read. */
function heldBackBase(bucket: string, id: string): string[] {
  const out = [...(offMap[`${bucket}/${id}`] ?? [])];
  if (LANE_BUCKETS.has(bucket)) {
    if (!shippedSituational(id)) out.push('situational');
    /* FEAT_GRANTS entries are keyed by a FEAT's (or feature's) id. An item or an action that shares
     * the slug (items/clan-pistol beside feats/clan-pistol) is not what the entry grants from. */
    if (bucket !== 'items' && bucket !== 'actions') {
      for (const kind of grantKindsHeldBack(id)) out.push(`featGrants.${GRANT_KIND_PATH[kind] ?? kind}`);
    }
    if (engineLaneOff(id)) out.push('engine');
    for (const lane of carrierOff[id] ?? []) out.push(lane);
  }
  return out;
}

/* The containers an option row's own `grantsActions` hangs under (`choice.options[].grant`, and the
 * same under `effectChoices[]`). Walking EVERY nested object of every record cost ~45 ms per gate run,
 * which runs on each content rebuild; these keys reach every place core.json carries one today
 * (measured 2026-10-23: record level 278, `choice.options[].grant` 6). */
const ACTION_CONTAINERS = new Set(['choice', 'effectChoices', 'choices', 'options', 'grant']);

/** Every action id a record hands over: its own `grantsActions` and the ones its option rows hand over. */
function grantedActionIds(node: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const el of node) grantedActionIds(el, out, depth + 1);
    return;
  }
  const rec = node as Node;
  const own = rec.grantsActions;
  if (Array.isArray(own)) for (const a of own) if (typeof a === 'string') out.add(a);
  for (const k of ACTION_CONTAINERS) if (rec[k] !== null && typeof rec[k] === 'object') grantedActionIds(rec[k], out, depth + 1);
}

/** The granter pass and the count, run once at the end of every gate run (every lane already set). */
function finishHeldBack(src: Record<string, Record<string, Node> | undefined>): void {
  const granters: Record<string, string[]> = {};
  const nameOf = (bucket: string, id: string): string => {
    const n = src[bucket]?.[id]?.name;
    return typeof n === 'string' && n ? n : id;
  };
  const add = (key: string, what: string) => {
    if (!(granters[key] ??= []).includes(what)) granters[key].push(what);
  };
  /* The feat registries (flat, leveled, rank-gated) are keyed by the granter's bare id. A granter whose
   * answer picks its feats (CHOICE_FEAT_GRANTS) does not deliver the flat list (featFeatGrantsFor), so
   * it is left out. Only feats, class features and heritages reach the grant queue (build.ts), so an
   * item or action sharing the slug is never marked. Not modelled: FEAT_SUBSTITUTE_GRANTS swapping the
   * grant for a character who already has it — the line then names a feat that character gets elsewhere. */
  const featGrantsOf = (id: string): string[] =>
    CHOICE_FEAT_GRANTS[id]
      ? []
      : [
          ...(FEAT_FEAT_GRANTS[id] ?? []),
          ...(FEAT_FEAT_GRANTS_LEVELED[id] ?? []).map((g) => g.feat),
          ...(FEAT_RANK_FEAT_GRANTS[id] ?? []).map((g) => g.feat),
        ];
  const registryGranters = new Set([
    ...Object.keys(FEAT_FEAT_GRANTS),
    ...Object.keys(FEAT_FEAT_GRANTS_LEVELED),
    ...Object.keys(FEAT_RANK_FEAT_GRANTS),
  ]);
  for (const granter of registryGranters) {
    const held = featGrantsOf(granter).filter((f) => f !== granter && src.feats?.[f] && heldBackBase('feats', f).length);
    if (!held.length) continue;
    for (const bucket of ['feats', 'classFeatures', 'heritages']) {
      if (!src[bucket]?.[granter]) continue;
      for (const f of held) add(`${bucket}/${granter}`, `grants:${nameOf('feats', f)}`);
    }
  }
  /* One pass over the 8 buckets: the actions each record hands over, then the count. A record's granter
   * entry depends only on what IT grants, so it is complete by the time the record is counted. */
  let n = 0;
  const actions = new Set<string>();
  for (const bucket of LANE_BUCKETS) {
    const map = src[bucket];
    if (!map) continue;
    for (const id in map) {
      const key = `${bucket}/${id}`;
      actions.clear();
      grantedActionIds(map[id], actions);
      for (const a of actions) {
        if (a !== id && src.actions?.[a] && heldBackBase('actions', a).length) add(key, `grants:${nameOf('actions', a)}`);
      }
      /* The record's own top-level `grantsFeats` (Cloistered Cleric -> Domain Initiate). Option-row
       * feat grants depend on the player's answer, so they are not read here. */
      const feats = (map[id] as Node).grantsFeats;
      if (Array.isArray(feats)) {
        for (const f of feats) {
          if (typeof f === 'string' && f !== id && src.feats?.[f] && heldBackBase('feats', f).length) add(key, `grants:${nameOf('feats', f)}`);
        }
      }
      if (granters[key] || heldBackBase(bucket, id).length) n++;
    }
  }
  granterOff = granters;
  heldCount = n;
  lastHeldCount = n;
}

/**
 * The Settings sentence's number: how many feats, features, items and actions show the "not yet
 * verified" line. `now` — this gate run's count (0 with the switch off). `ifOn` — what turning the switch
 * back on would hold back: the last gated run this session, or undefined when the app started with it off.
 */
export function trustHeldCount(): { now: number; ifOn: number | undefined } {
  return { now: trustGateOn() ? heldCount : 0, ifOn: lastHeldCount };
}

/* A FEAT_GRANTS kind -> a leaf `trustWords` already says in the player's words. */
const GRANT_KIND_PATH: Record<string, string> = {
  skill: 'skills',
  save: 'saves',
  perception: 'perception',
  ac: 'armor',
  weapon: 'weaponProficiency',
  choice: 'choiceGrants',
  grantsRecord: 'grantsRecord',
};

const unencodedSet = new Set(TRUST_LEDGER.unencoded ?? []);
/** Whether this record was created from a page with none of its rules encoded (see `unencoded`). */
export function trustUnencoded(bucket: string, id: string): boolean {
  return unencodedSet.has(`${bucket}/${id}`);
}

const partlyMap = TRUST_LEDGER.partly ?? {};
/** What this created record prints but does not apply yet, or undefined (see `partly`). */
export function trustPartly(bucket: string, id: string): string | undefined {
  return partlyMap[`${bucket}/${id}`];
}

/**
 * The unencoded (or partly encoded) record a popup that knows only a TITLE is showing. The Builder's
 * background rows and class-option rows open their description as `key: 'origin'`, which names no
 * bucket, so the marker could never find them. Exact name, among the few records `unencoded` and
 * `partly` list — never a guess over the whole database.
 */
export function unencodedNamed(
  name: string,
  content: Record<string, Record<string, { name?: string }> | undefined> | null | undefined,
): { bucket: string; id: string } | undefined {
  for (const key of [...unencodedSet, ...Object.keys(partlyMap)]) {
    const slash = key.indexOf('/');
    const bucket = key.slice(0, slash);
    const id = key.slice(slash + 1);
    if (content?.[bucket]?.[id]?.name === name) return { bucket, id };
  }
  return undefined;
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
  carrierOff = {};
  granterOff = {};
  heldCount = 0;
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
/* batch 039: magus#arcane-cascade-mode — a stance may now carry `strikeDamage` (action-4261: "your melee
 * Strikes ... deal 1 extra force damage"), read by derive.ts strikeDamageRiders off the active stance. It
 * is a BENEFIT, so a gated stance's damage rider goes dark with its resistances and strikes. */
const STANCE_PAYLOAD = ['strikes', 'acBonus', 'dexCap', 'resistances', 'senses', 'senseIfFeat', 'speeds', 'saves', 'strikeDamage'];

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
  const carriers: Record<string, string[]> = {};
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
      /* The records that CARRY it — the same list the generator's `carrierOff` reads (the slug, the
       * item it came from, the feats it names; a class/ancestry/background carrier is chassis and never
       * off). Their cards owe the line too: the feat's stance is what went dark. */
      const via = bucket === 'modes'
        ? [id, rec.fromItemId, ...(Array.isArray(rec.feats) ? rec.feats : []).map((f) => String(f).split(':')[0])]
        : [id];
      for (const c of via) {
        if (typeof c !== 'string' || !c) continue;
        if (!(carriers[c] ??= []).includes(bucket)) carriers[c].push(bucket);
      }
    }
  }

  offMap = off;
  carrierOff = carriers;
  census = { recordsOff, recordsPartly, stars: ledger.lanes.situational.length };
  /* The three code-side lanes, written once per gate run — never per character. */
  setSituationalTrustOff(ledger.lanes.situational);
  setEngineTrustOff(ledger.lanes.engine);
  setFeatGrantTrustOff(ledger.lanes.featGrants);
  /* The granter pass and the Settings count: ~25 ms over the whole database (measured 2026-10-23),
   * once per gate run, never per render. */
  finishHeldBack(src);
  return out as unknown as T;
}
