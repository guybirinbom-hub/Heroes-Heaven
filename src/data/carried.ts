/*
 * CUSTOM RECORDS TRAVEL WITH THE CHARACTER.
 *
 * Owner ruling, 2026-10-20 (Guy): "i dont want it in the homebrew and also its a problem that when the gm
 * or players view another character they see custom items as unknown items, the others should see the
 * same item as the player". So a character's custom records — the player's own homebrew of every
 * HomebrewType, and whatever campaign homebrew its sheet uses — ride along on the sheet itself
 * (`SavedChar.carried`), and every view of a sheet resolves them from there. NOT through the campaign's
 * shared homebrew (./campaignHomebrew.ts): he refused that, and nothing here ever writes a homebrew store.
 *
 * Three pieces:
 *  - `collectCarried` — on SEND (a publish, a GM push, an export): every homebrew record the sheet
 *    references, followed transitively (a homebrew feat naming a homebrew spell), deterministic so the
 *    publish's "already sent" test does not resend it forever.
 *  - `withCarried` — on VIEW: the content database a sheet is derived and drawn against, with its
 *    carried records added. Per sheet, never a global layer; memoised so a re-render is free and keeps
 *    the same object (every memo downstream is keyed on the database's identity).
 *  - `sheetKey` (./authored.ts) — a whole-sheet comparison that ignores which copy of a record rode along.
 *
 * Round 2 (2026-10-20): the player's own MODES travel too (checker finding coverage-F3 — applyPlayState
 * drops an active mode id the viewer's `content.modes` lacks, so while a custom mode was on, the GM, the
 * teammates and the tracker saw a different AC from the player's); a publish marks, per campaign, what
 * that campaign's shared homebrew already gives its members as FILL-only and leaves its text out of the
 * "already sent" test (`carriedForCampaign` / `publishKey`, findings saving-C2 and saving-R2-chk-1/3);
 * and the tracker's GM screen resolves a record the party's sheets carry (`partyContent`, finding N2).
 *
 * Round 3 (2026-10-20): a GM push keeps the fill-only marks of the sheet it was built on
 * (`withCarriedAttached`, final finding N-b), and a carried MODE is repointed or taken off a character in
 * one place (`repointMode` / `withoutCarried`, final findings N-a / N-c — the player's own sheet).
 *
 * Pure over its arguments, except `ownContent`, `freshModeId` and the `load…` conveniences, which read
 * this device's storage (or the clock).
 */
import type { ContentDatabase, ModeDef } from '../rules/types';
import {
  HOMEBREW_TYPES,
  duplicateChar,
  loadCampaignHbCache,
  loadHomebrewContent,
  loadHomebrewSources,
  loadRevived,
  loadTombstones,
  type CampaignHbCampaign,
  type CarriedRecords,
  type HomebrewType,
  type SavedChar,
} from './storage';
import { isPrintedId } from './index';
import { playerModeLibrary } from '../rules/modes';

export { sheetKey } from './authored';

/** The buckets a sheet carries: every homebrew type, and the player's own modes (round 2, 2026-10-20). */
export type CarriedType = HomebrewType | 'modes';
export const CARRIED_TYPES: readonly CarriedType[] = [...HOMEBREW_TYPES, 'modes'];
const isCarriedType = (t: string): t is CarriedType => (CARRIED_TYPES as readonly string[]).includes(t);

/** What a sheet carries: records by type, then id. */
export type Carried = CarriedRecords;

/** This account's deletion tombstones and revive stamps (storage.ts), as `withCarried` reads them. */
export interface OwnTombstones {
  deleted: Record<string, number>;
  revived: Record<string, number>;
}

type IsPrinted = (type: CarriedType, id: string) => boolean;
type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (map: unknown, id: string): unknown => (isRec(map) && Object.prototype.hasOwnProperty.call(map, id) ? map[id] : undefined);

/** The `fill` list's field on a carried object (storage.ts CarriedRecords): not a bucket of records. */
const FILL = 'fill';
/** The `type:id` keys a carried object marks fill-only (`carriedForCampaign`); empty when it marks none. */
function fillKeys(carried: unknown): ReadonlySet<string> {
  const list = isRec(carried) ? carried[FILL] : undefined;
  return new Set(Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : []);
}
/** `fill` cut down to the keys whose record `recs` (a carried object, by type) still holds — sorted, or
 *  undefined when none is left. */
function fillFor(keys: Iterable<string>, recs: Rec): string[] | undefined {
  const out = [...new Set(keys)].filter((k) => {
    const at = k.indexOf(':');
    return at > 0 && own(recs[k.slice(0, at)], k.slice(at + 1)) !== undefined;
  });
  return out.length ? out.sort() : undefined;
}

/**
 * A record somebody AUTHORED rather than one the books print: the homebrew merge stamps
 * `license: 'homebrew'` on every stored entry (./index.ts mergeWithSeed, own and campaign alike), and an
 * item the item editor copied from a printed one keeps the book's license under a minted `custom-…` id
 * until the next merge re-stamps it — the same two-part test the Add-items search and the item editor
 * use (src/sheet/AddItemsModal.tsx `userAuthored`). Without the second half, an item made in the sheet a
 * moment ago would not ride along until the app re-merged its content.
 *
 * A MODE has no license: one the player wrote is one the Modes panel lists under "Your modes" — not the
 * catalog's, not a consumable's (`fromItemId`), not a gated content mode (src/rules/modes.ts
 * `playerModeLibrary`, the one test of it). The core file's item modes are kept out by `isPrinted` too.
 */
function isAuthored(type: CarriedType, id: string, rec: unknown): boolean {
  if (!isRec(rec)) return false;
  if (type === 'modes') return rec.id === id && playerModeLibrary([rec as never]).length === 1;
  return (rec.source as { license?: unknown } | undefined)?.license === 'homebrew' || id.startsWith('custom-');
}

/** Very long strings are portraits, notes and descriptions — never a record id — so the walk skips them. */
const MAX_ID_LENGTH = 512;

const REF_LINK_ID = /data-ref-id\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const unescapeAttr = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/**
 * The record ids a rich-text string LINKS to: the `.ref-link` anchors the rich editor writes
 * (src/sheet/RichEditor.tsx, `data-ref-id="…"`, attribute-escaped) and the description popups follow
 * (src/sheet/DescBody.tsx). Read at any length — a description is long, its links are still references.
 * 2026-10-20 (checker finding semantics-C3): a homebrew feat whose description links a homebrew spell
 * the sheet names nowhere else left the spell behind, and on the GM's device the link opened nothing.
 */
function refLinkIds(s: string): string[] {
  if (!s.includes('data-ref-id')) return [];
  const out: string[] = [];
  for (const m of s.matchAll(REF_LINK_ID)) {
    const id = unescapeAttr(m[1] ?? m[2] ?? '');
    if (id && id.length <= MAX_ID_LENGTH) out.push(id);
  }
  return out;
}

/**
 * Every string value and every object key anywhere in a sheet, except inside `carried` itself, plus every
 * record a rich-text string links to (`refLinkIds`). Keys count because some references ARE keys:
 * `spellSources` is keyed by spell id (src/data/transfer.ts), and play state keys several maps by record
 * id. Over-collecting is harmless — an id only matters when a homebrew record has it.
 */
export function referencedIds(sheet: unknown): Set<string> {
  const out = new Set<string>();
  const stack: unknown[] = [];
  if (isRec(sheet)) {
    for (const [k, v] of Object.entries(sheet)) {
      if (k === 'carried') continue;
      out.add(k);
      stack.push(v);
    }
  } else stack.push(sheet);
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') {
      if (v.length <= MAX_ID_LENGTH) out.add(v);
      for (const id of refLinkIds(v)) out.add(id);
    } else if (Array.isArray(v)) {
      for (const x of v) stack.push(x);
    } else if (isRec(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k.length <= MAX_ID_LENGTH) out.add(k);
        stack.push(x);
      }
    }
  }
  return out;
}

/**
 * The homebrew records `sheet` uses, as found in `viewContent` — the content the sheet is drawn against
 * on the SENDING device (own homebrew, campaign homebrew, and whatever the sheet already carried).
 *
 * For each referenced id, every record of a carried bucket (a HomebrewType, or `modes`) that is authored
 * (above) and not a printed id, then that record's own references, until nothing new turns up. Printed
 * records never ride along: someone else's content may add records, never replace the book's (the same
 * rule the campaign merge keeps) — for modes, the catalog's and the core file's item modes. Types and ids
 * come out sorted, so the same sheet always serialises the same way. Undefined when there is nothing to carry.
 *
 * A mode is found the way any record is: an active one is named in `play.activeModes` (or a companion's
 * `companionModes`). One the player wrote and has NOT switched on is named nowhere on the sheet and stays
 * home — it changes no number anybody else sees.
 */
export function collectCarried(sheet: unknown, viewContent: ContentDatabase, opts: { isPrinted?: IsPrinted } = {}): Carried | undefined {
  const isPrinted = opts.isPrinted ?? isPrintedId;
  const found = new Map<CarriedType, Map<string, unknown>>();
  const queue = [...referencedIds(sheet)];
  const seen = new Set(queue);
  while (queue.length) {
    const id = queue.pop()!;
    for (const type of CARRIED_TYPES) {
      const rec = own(viewContent[type], id);
      if (!isAuthored(type, id, rec) || isPrinted(type, id)) continue;
      const bucket = found.get(type) ?? new Map<string, unknown>();
      if (bucket.has(id)) continue;
      bucket.set(id, rec);
      found.set(type, bucket);
      for (const ref of referencedIds(rec)) {
        if (seen.has(ref)) continue;
        seen.add(ref);
        queue.push(ref);
      }
    }
  }
  if (!found.size) return undefined;
  const out: Rec = {};
  for (const type of [...found.keys()].sort()) {
    const bucket = found.get(type)!;
    const recs: Rec = {};
    for (const id of [...bucket.keys()].sort()) recs[id] = bucket.get(id);
    out[type] = recs;
  }
  return out as Carried;
}

/**
 * The carried records of a sheet read from a FILE (an import) or anything else not built by
 * `collectCarried`: only carried buckets (the HomebrewTypes and `modes`), only records whose `id` is
 * their key — and a mode only with its `modifiers` list, which every reader of a mode walks (a mode
 * without one would crash the sheet that drew it). Undefined when nothing usable is left — an unknown
 * shape is dropped, never guessed at.
 */
export function normalizeCarried(v: unknown): Carried | undefined {
  if (!isRec(v)) return undefined;
  const out: Rec = {};
  for (const type of CARRIED_TYPES) {
    const recs = v[type];
    if (!isRec(recs)) continue;
    const kept: Rec = {};
    for (const [id, rec] of Object.entries(recs)) if (usable(type, id, rec)) kept[id] = rec;
    if (Object.keys(kept).length) out[type] = kept;
  }
  if (!Object.keys(out).length) return undefined;
  const fill = fillFor(fillKeys(v), out); // only keys naming a record kept above
  if (fill) out[FILL] = fill;
  return out as Carried;
}

/** A carried record any view may take in: a record under its own id; a mode also with its `modifiers` list. */
function usable(type: CarriedType, id: string, rec: unknown): rec is Rec {
  if (!isRec(rec) || rec.id !== id) return false;
  return type !== 'modes' || Array.isArray(rec.modifiers);
}

/** A carried record as it goes into a viewer's database: a `traits` array (every layer of the app's
 *  database has one — ./index.ts ensureTraits) and the homebrew license the owner's merge gave it, so
 *  it is treated exactly like the owner's homebrew record (offered to edit in place, carried on by the
 *  next send). Cached per record object, so the same record is the same object on every view. A mode
 *  goes in as it came: modes carry neither field, and nothing reads one off a mode. */
const normalizedCache = new WeakMap<object, Rec>();
function normalized(type: CarriedType, rec: Rec): Rec {
  if (type === 'modes') return rec;
  if (Array.isArray(rec.traits) && (rec.source as { license?: unknown } | undefined)?.license === 'homebrew') return rec;
  const hit = normalizedCache.get(rec);
  if (hit) return hit;
  const n: Rec = {
    ...rec,
    traits: Array.isArray(rec.traits) ? rec.traits : [],
    source: { ...(isRec(rec.source) ? rec.source : {}), license: 'homebrew' },
  };
  normalizedCache.set(rec, n);
  return n;
}

/**
 * Did this account delete its own record `type:id` (a tombstone newer than its last revive)? The same
 * test campaign homebrew's conversion makes (./campaignHomebrew.ts convertGone `deletedAt`). A mode's
 * stamps are `mode:<id>` (storage.ts deleteMode / saveMode), every other record's `hb:<type>:<id>`.
 */
function tombstoned(t: OwnTombstones | undefined, type: CarriedType, id: string): boolean {
  if (!t) return false;
  const k = type === 'modes' ? `mode:${id}` : `hb:${type}:${id}`;
  return (t.deleted[k] ?? 0) > (t.revived[k] ?? 0);
}

/** content → carried object → plan key → the database built for it. Weak on both objects, so a sheet
 *  replaced by a newer copy (or a database by a re-merge) takes its entries with it. */
const memo = new WeakMap<object, WeakMap<object, Map<string, ContentDatabase>>>();

/**
 * The database a sheet is derived and drawn against: `content` with the sheet's carried records added.
 *
 * mode 'own' — this device's own character (the roster, its sheet, its publish). The player's own
 *   records always win: a carried record only FILLS an id `content` lacks (a GM-made item a push
 *   brought). And one this account DELETED from its homebrew stays deleted (`ownTombstones`): owner
 *   ruling 2026-09-12 #7 — a Homebrew-page Delete means "your characters lose it". (A RETIRED record is
 *   not deleted — it is still in `content` and resolves as it always did.)
 * mode 'foreign' — a sheet that may be someone else's: a party member, the GM's edit sheet, a tracker
 *   row. The carried copy WINS over the viewer's own homebrew of that id (or fills a gap), so the viewer
 *   sees exactly the owner's record — but it never replaces a PRINTED record, and the viewer's own
 *   tombstones are not applied: a GM deleting his own item must not blank the copy a player holds.
 *   Except a record the carried object marks FILL-only (`carriedForCampaign`: the campaign the sheet was
 *   published to shares it, so its members and its GM hold it themselves, maybe newer than this copy):
 *   that one only fills a gap — the GM deleted it from his homebrew and his members have not
 *   republished yet (2026-10-20, checker finding saving-R2-chk-1).
 * mode 'fill' — no sheet in particular (the tracker's GM screen over the whole party, `partyContent`):
 *   a carried record only fills an id `content` lacks, and no tombstones are read.
 *
 * Modes follow the same rules (round 2, 2026-10-20): own = this device's saved mode wins and a mode this
 * account deleted (`mode:<id>` tombstone) stays deleted; foreign = the carried mode wins over the viewer's
 * own saved mode of that id, never over a catalog or core-file mode.
 *
 * Returns `content` itself when there is nothing to add, and the same object for the same content and
 * the same carried object on every later call.
 */
export function withCarried(
  content: ContentDatabase,
  sheet: { carried?: unknown } | null | undefined,
  opts: { mode: 'own' | 'foreign' | 'fill'; ownTombstones?: OwnTombstones; isPrinted?: IsPrinted },
): ContentDatabase {
  const carried = sheet?.carried;
  if (!isRec(carried)) return content;
  const isPrinted = opts.isPrinted ?? isPrintedId;
  const fill = fillKeys(carried);
  const plan: [CarriedType, string, Rec][] = [];
  for (const type of CARRIED_TYPES) {
    const recs = carried[type];
    if (!isRec(recs)) continue;
    const have = content[type] as unknown;
    for (const [id, rec] of Object.entries(recs)) {
      if (!usable(type, id, rec) || isPrinted(type, id)) continue;
      const n = normalized(type, rec);
      const cur = own(have, id);
      if (cur === n) continue; // already this record — a view of a view adds nothing
      if (opts.mode === 'own') {
        if (cur !== undefined || tombstoned(opts.ownTombstones, type, id)) continue;
      } else if (opts.mode === 'fill') {
        if (cur !== undefined) continue;
      } else if (cur !== undefined && (fill.has(`${type}:${id}`) || !isAuthored(type, id, cur))) continue; // never over a printed record; a fill-only one never over the viewer's
      plan.push([type, id, n]);
    }
  }
  if (!plan.length) return content;
  const key = `${opts.mode}\n${plan.map(([t, id]) => `${t}:${id}`).join('\n')}`;
  let byCarried = memo.get(content);
  if (!byCarried) memo.set(content, (byCarried = new WeakMap()));
  let byKey = byCarried.get(carried);
  if (!byKey) byCarried.set(carried, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const next = { ...content } as unknown as Record<string, Rec>;
  for (const type of new Set(plan.map(([t]) => t))) next[type] = { ...((content[type] as unknown as Rec) ?? {}) };
  for (const [type, id, n] of plan) next[type][id] = n;
  const db = next as unknown as ContentDatabase;
  byKey.set(key, db);
  return db;
}

/** This device's tombstones and revive stamps, read from storage. */
export function loadOwnTombstones(): OwnTombstones {
  return { deleted: loadTombstones(), revived: loadRevived() };
}

/** `withCarried(content, sheet, 'own')` with this device's own tombstones — for a roster entry. */
export function ownContent(content: ContentDatabase, sheet: { carried?: unknown } | null | undefined, tombstones?: OwnTombstones): ContentDatabase {
  if (!isRec(sheet?.carried)) return content;
  return withCarried(content, sheet, { mode: 'own', ownTombstones: tombstones ?? loadOwnTombstones() });
}

/**
 * What a sheet ARRIVING in this device's roster (a GM edit applied, a file imported) keeps of the records
 * it carries: only the ones this device cannot otherwise resolve — an id `content` lacks that this account
 * never deleted. The rest are dropped here, once, as the entry is written.
 *
 * Why (2026-10-20, checker findings saving-C3 / semantics-C2): a GM's push carries EVERY record the sheet
 * uses, the player's own homebrew included. Kept in the roster, that copy outlived the player's own
 * Homebrew-page Delete: own mode hides a deleted id only through its tombstone, and tombstones are pruned
 * after 180 days (cloudMerge, TOMBSTONE_TTL_MS) — after which the copy filled the record back in, on the
 * sheet and in the next publish, breaking owner ruling 2026-09-12 #7 ("your characters lose it"). Nothing
 * is lost by the drop: an id `content` holds resolves from `content` (own mode lets it win anyway), and
 * the next publish collects it from there.
 *
 * `content` null/undefined (not loaded yet) → `carried` as it is: unknown is not empty, never trim a list
 * against a database never read. Returns `carried` itself when nothing is dropped, undefined when nothing
 * is left.
 */
export function carriedToKeep(
  carried: Carried | undefined,
  content: ContentDatabase | null | undefined,
  tombstones: OwnTombstones | undefined,
): Carried | undefined {
  if (!isRec(carried) || !content) return carried;
  let dropped = false;
  const out: Rec = {};
  for (const [type, recs] of Object.entries(carried)) {
    if (type === FILL) continue; // re-cut below, to the records kept
    if (!isCarriedType(type) || !isRec(recs)) {
      out[type] = recs; // not ours to judge: kept as it came
      continue;
    }
    // Modes too (round 2, 2026-10-20): a copy of a mode this device holds itself, or one this account
    // deleted (`mode:<id>`), would outlive the delete exactly as a homebrew record's would.
    const kept: Rec = {};
    for (const [id, rec] of Object.entries(recs)) {
      if (own(content[type], id) !== undefined || tombstoned(tombstones, type, id)) dropped = true;
      else kept[id] = rec;
    }
    if (Object.keys(kept).length) out[type] = kept;
  }
  if (!dropped) return carried;
  // A fill list naming only records dropped here is not something to keep on its own.
  const fill = fillFor(fillKeys(carried), out);
  if (fill) out[FILL] = fill;
  return Object.keys(out).some((k) => k !== FILL) ? (out as Carried) : undefined;
}

/**
 * `carried` as it goes to ONE campaign (`cid`): every record the player's view took from THAT campaign's
 * shared homebrew is marked FILL-only (`carried.fill`, its `type:id`) — the GM authored those and his
 * players pulled them, so each of them holds the record himself, and `withCarried` (foreign) lets a
 * fill-only copy fill a gap but never win over the viewer's own. And `publishKey` leaves a fill-only
 * record's TEXT out of the publish's "already sent" test.
 *
 * Why (2026-10-20):
 *  - checker finding saving-C2: carried in every publish as a winning copy, a GM's edit of his campaign's
 *    shared homebrew changed every PC sheet that used the record, so every player's app republished, which
 *    moved `campaign_characters.updated_at` under a chained GM push from the tracker — and his push read
 *    "not applied". The text of a fill-only record is not compared, so his edit moves nobody's sheet; it
 *    reaches the members through the campaign homebrew as it always did.
 *  - checker finding saving-R2-chk-1: left OUT instead (round 2's first cut), the record vanished from
 *    every other view — the GM's sheet, the tracker, the teammates — the moment the GM deleted it from his
 *    homebrew, until this player's app pulled, converted it to a kept record and republished: "Unknown
 *    item" again, the complaint of the owner's ruling. The fill-only copy covers that gap.
 *  - checker finding saving-R2-chk-3: a record is marked only when the player's view really holds THIS
 *    campaign's copy (`origins`, `sharedOrigins`: the first campaign holding an id wins, as in ./index.ts
 *    mergeWithSeed). Two campaigns sharing one id with different text: the player sees the first one's,
 *    and the second is sent it as a WINNING copy — "the others should see the same item as the player".
 *
 * Never marked: a record shared only in another campaign, the player's own homebrew — including their own
 * record under an id the campaign also shares, which wins over the shared copy on their device (`ownWins`,
 * mergeWithSeed: kept < shared < mine) — and modes (never shared homebrew).
 *
 * `carried` itself when nothing is marked (deterministic: the "already sent" test compares the JSON).
 */
export function carriedForCampaign(
  carried: Carried | undefined,
  cid: string,
  origins: ReadonlyMap<string, string>,
  ownWins?: ReadonlySet<string>,
): Carried | undefined {
  if (!isRec(carried)) return carried;
  const fill: string[] = [];
  for (const [type, recs] of Object.entries(carried)) {
    if (type === 'modes' || !isCarriedType(type) || !isRec(recs)) continue;
    for (const id of Object.keys(recs)) {
      const key = `${type}:${id}`;
      if (origins.get(key) === cid && !ownWins?.has(key)) fill.push(key);
    }
  }
  if (!fill.length) return carried;
  const { [FILL]: _old, ...rest } = carried as Rec;
  return { ...rest, [FILL]: fill.sort() } as Carried;
}

/**
 * `type:id` → the campaign whose shared copy the player's content database holds for that id: the FIRST
 * campaign of the cache holding it, printed ids skipped — exactly the pick ./index.ts mergeWithSeed makes
 * (`if (!(id in shared) && !isPrintedId(type, id)) shared[id] = e`, over `Object.values(loadCampaignHbCache())`).
 * For `carriedForCampaign`. Pure over `cache`.
 */
export function sharedOrigins(cache: Record<string, CampaignHbCampaign>, isPrinted: IsPrinted = isPrintedId): Map<string, string> {
  const out = new Map<string, string>();
  for (const [cid, camp] of Object.entries(cache)) {
    for (const type of HOMEBREW_TYPES) {
      for (const id of Object.keys(camp?.content?.[type] ?? {})) {
        const key = `${type}:${id}`;
        if (!out.has(key) && !isPrinted(type, id)) out.set(key, cid);
      }
    }
  }
  return out;
}

/** `sharedOrigins` over this device's campaign homebrew cache. */
export function loadSharedOrigins(): Map<string, string> {
  return sharedOrigins(loadCampaignHbCache());
}

/**
 * The string the publish's "already sent" test compares (src/App.tsx): the published sheet's JSON, with
 * each FILL-only record (`carriedForCampaign`) reduced to its key — which records are fill-only still
 * counts, their text does not. Finding saving-C2 (2026-10-20): a GM's edit of a record his campaign shares
 * must not republish the sheets that use it. The copy a viewer holds is then possibly older than the GM's
 * — harmless, since a fill-only copy never wins over the record the viewer holds, and the next real
 * publish (any change to the sheet, or the app's next launch) sends the current text.
 */
export function publishKey(published: { carried?: unknown }): string {
  const carried = published.carried;
  const fill = fillKeys(carried);
  if (!fill.size || !isRec(carried)) return JSON.stringify(published);
  const cut: Rec = {};
  for (const [type, recs] of Object.entries(carried)) {
    if (type === FILL || !isRec(recs)) {
      cut[type] = recs;
      continue;
    }
    const r: Rec = {};
    for (const [id, rec] of Object.entries(recs)) r[id] = fill.has(`${type}:${id}`) ? 1 : rec;
    cut[type] = r;
  }
  return JSON.stringify({ ...published, carried: cut });
}

/**
 * `type:id` of every entry of this account's own homebrew that wins over a campaign's shared copy of the
 * same id in its content database: all of them but the ones KEPT from a campaign source and not edited
 * since (their source's `kept.ids` lists them) — the split ./index.ts mergeWithSeed makes (kept < shared
 * < mine). For `carriedForCampaign`.
 */
export function loadOwnWinningIds(): Set<string> {
  const own = loadHomebrewContent();
  const sources = loadHomebrewSources();
  const out = new Set<string>();
  for (const type of HOMEBREW_TYPES) {
    for (const [id, e] of Object.entries(own[type] ?? {})) {
      const sid = (e as { homebrewSourceId?: string }).homebrewSourceId;
      if (sid && sources[sid]?.kept?.ids?.includes(`${type}:${id}`)) continue;
      out.add(`${type}:${id}`);
    }
  }
  return out;
}

/**
 * The tracker's database for its GM screen and its windows (src/integration/CampaignTracker.tsx): the
 * GM's `content` with the records the party's sheets carry filling the ids it lacks — never over a
 * record of his own, never over a printed one (mode 'fill'). The first sheet holding an id gives it.
 *
 * Why (2026-10-20, checker finding N2 — "every description popup keeps its PinStar"): a page pinned to the
 * GM screen is stored as its `bucket:id` alone, and the pane draws it from the tracker's database. A record
 * only a player's sheet carries (their custom item, a feat the GM made and later deleted from his own
 * homebrew) drew "This page is not in this version", star and all gone. Nothing new is stored with the
 * pin: existing pins keep working, and one resolves for as long as a party sheet carries its record.
 * The same object back for the same database and the same carried objects (withCarried's memo).
 */
export function partyContent(content: ContentDatabase, sheets: Iterable<{ carried?: unknown } | null | undefined>): ContentDatabase {
  let db = content;
  for (const s of sheets) db = withCarried(db, s, { mode: 'fill' });
  return db;
}

/**
 * `sheet` with `carried` cut down by `carriedToKeep` — the same object when nothing is dropped, and
 * without the field when nothing is left.
 */
export function keepCarried<T extends { carried?: Carried }>(
  sheet: T,
  content: ContentDatabase | null | undefined,
  tombstones: OwnTombstones | undefined,
): T {
  const kept = carriedToKeep(sheet.carried, content, tombstones);
  if (kept === sheet.carried) return sheet;
  if (kept) return { ...sheet, carried: kept };
  const { carried: _drop, ...rest } = sheet;
  return rest as T;
}

/** `withCarried(content, sheet, 'foreign')` — for a sheet that may belong to another account. */
export function foreignContent(content: ContentDatabase, sheet: { carried?: unknown } | null | undefined): ContentDatabase {
  return withCarried(content, sheet, { mode: 'foreign' });
}

/**
 * The ids of `type` a FOREIGN view of a sheet draws from what the sheet carries rather than from the
 * viewer's own `content` — every carried id, less a fill-only one (`carriedForCampaign`) the viewer holds
 * himself: that one is drawn from his own record. For the GM's edit sheet, which makes these copy-on-write
 * (src/sheet/CopyOnWriteItems.tsx): an in-place edit of one could reach nobody. A GM's own shared record,
 * marked fill-only, stays editable in place there — his edit reaches the members through the share
 * (2026-10-20, with finding saving-R2-chk-1's fill-only marking).
 */
export function foreignCarriedIds(content: ContentDatabase, carried: unknown, type: CarriedType): Set<string> {
  const recs = isRec(carried) ? carried[type] : undefined;
  if (!isRec(recs)) return new Set();
  const fill = fillKeys(carried);
  return new Set(Object.keys(recs).filter((id) => !(fill.has(`${type}:${id}`) && own(content[type], id) !== undefined)));
}

/**
 * `sheet` with `carried` set to what it uses, as found in `viewContent` — or without the field when it
 * uses nothing. For a SEND (a GM push, the tracker seam's push); the publish builds its own object (App.tsx).
 *
 * The FILL-only marks the sheet already had stay on every record the send still carries (round 3,
 * 2026-10-20, final finding N-b). The sheet a GM pushes is the published one, marked per campaign by the
 * player's publish (`carriedForCampaign`): his own campaign-shared record is fill-only there. Re-collected
 * without the marks, the push's copy of it WON on his own views of that PC for as long as the push waited
 * (the pending overlay hands back this very sheet): he edited his shared record and his party card and the
 * sheet still drew the pushed copy over his edit. Kept, his own record wins there, and a device that lacks
 * it is still filled. No new record is marked here: which records a campaign shares is the publish's
 * question (the GM's device does not hold his own shares as campaign homebrew), and a mark only ever says
 * "a viewer's own record of this id wins" — on the player's device their own does anyway (own mode).
 *
 * `sheet` ITSELF when what it already carries is exactly that: the tracker seam knows its own pushes
 * coming back by object identity (src/integration/pcSheetTruth.ts, rule E), so a send that changes
 * nothing must not hand back a copy — the seam attaches first, then pushGmEdit attaches again.
 */
export function withCarriedAttached<T extends { carried?: Carried }>(sheet: T, viewContent: ContentDatabase): T {
  const collected = collectCarried(sheet, viewContent);
  const fill = collected ? fillFor(fillKeys(sheet.carried), collected as Rec) : undefined;
  const carried = collected && fill ? ({ ...collected, [FILL]: fill } as Carried) : collected;
  if (carried) return sheet.carried && JSON.stringify(sheet.carried) === JSON.stringify(carried) ? sheet : { ...sheet, carried };
  if (!('carried' in sheet)) return sheet;
  const { carried: _drop, ...rest } = sheet;
  return rest as T;
}

/* ───────────── a carried MODE, copy-on-write or removed (rounds 2 and 3, 2026-10-20) ───────────── */

/** The play-state fields that name an active mode by id (src/rules/play.ts PlayState). */
export interface ModeRefs {
  activeModes?: string[];
  companionModes?: Record<string, string[]>;
  tempHpFrom?: string;
}

/**
 * Which roster characters use which modes (src/rules/modes.ts `ModeUsage`): a mode id → the ids of the
 * characters that have it switched on — in `play.activeModes` or a companion's `companionModes` — or carry
 * it (`carried.modes`). Read fresh from the roster each time and never stored: it is how a mode saved
 * before modes belonged to one character finds where it shows (`modeListedFor`), without a migration
 * writing anything on load. Pure; a malformed entry or list is skipped, never guessed at.
 */
export function modeUsage(
  roster: Iterable<{ id?: unknown; play?: ModeRefs | null; carried?: unknown } | null | undefined>,
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const add = (modeId: unknown, charId: string) => {
    if (typeof modeId !== 'string' || !modeId) return;
    let set = out.get(modeId);
    if (!set) out.set(modeId, (set = new Set()));
    set.add(charId);
  };
  const each = (ids: unknown, charId: string) => {
    if (Array.isArray(ids)) for (const id of ids) add(id, charId);
  };
  for (const sc of roster) {
    if (!sc || typeof sc.id !== 'string') continue;
    const play = isRec(sc.play) ? (sc.play as ModeRefs) : undefined;
    each(play?.activeModes, sc.id);
    const companions: unknown = play?.companionModes;
    if (isRec(companions)) for (const ids of Object.values(companions)) each(ids, sc.id);
    const carriedModes = isRec(sc.carried) ? sc.carried.modes : undefined;
    if (isRec(carriedModes)) for (const id of Object.keys(carriedModes)) add(id, sc.id);
  }
  return out;
}

/** A fresh id for a mode the viewer COPIES from one the sheet carries (the Modes panel mints `mode-…` too). */
export function freshModeId(): string {
  return `mode-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * `play` with mode `from` replaced by `to` wherever it names an active mode — the character's own
 * `activeModes`, every companion's `companionModes`, and the temporary-HP pool's `tempHpFrom` (the copy
 * now owns the form's temporary Hit Points) — or taken out of all three when `to` is null. Taking it out
 * never touches the pool itself: a pool is the character's Hit Points (src/rules/play.ts toggleMode turns
 * a form off properly first, where that is wanted). `play` itself when it names `from` nowhere.
 *
 * The one place a carried mode is repointed or removed: the GM's edit sheet's copy-on-write
 * (src/sheet/GmEditSheet.tsx saveModeDef) and the player's own sheet's (src/App.tsx, round 3).
 */
export function repointMode<P extends ModeRefs>(play: P, from: string, to: string | null): P {
  const swap = (ids: string[] | undefined): string[] | undefined =>
    ids?.includes(from) ? (to === null ? ids.filter((x) => x !== from) : ids.map((x) => (x === from ? to : x))) : ids;
  const activeModes = swap(play.activeModes);
  let companionModes = play.companionModes;
  if (companionModes && Object.values(companionModes).some((ids) => ids?.includes(from)))
    companionModes = Object.fromEntries(Object.entries(companionModes).map(([k, ids]) => [k, swap(ids) ?? ids]));
  const tempHpFrom = play.tempHpFrom === from ? (to ?? undefined) : play.tempHpFrom;
  if (activeModes === play.activeModes && companionModes === play.companionModes && tempHpFrom === play.tempHpFrom) return play;
  // Only the fields that changed are written: an absent field stays absent.
  const out: P = { ...play };
  if (activeModes !== play.activeModes) out.activeModes = activeModes;
  if (companionModes !== play.companionModes) out.companionModes = companionModes;
  if (tempHpFrom !== play.tempHpFrom) out.tempHpFrom = tempHpFrom;
  return out;
}

/**
 * `sheet` without the carried record `type:id` (and its fill mark) — the same object when it carries no
 * such record, and without the field when nothing is left. For a real player edit of their own roster
 * entry only (a carried mode taken off the character, or replaced by their own copy): never a sync step.
 */
export function withoutCarried<T extends { carried?: Carried }>(sheet: T, type: CarriedType, id: string): T {
  const carried = sheet.carried as Rec | undefined;
  if (!isRec(carried) || own(carried[type], id) === undefined) return sheet;
  const { [id]: _gone, ...left } = carried[type] as Rec;
  const out: Rec = {};
  for (const [t, recs] of Object.entries(carried)) {
    if (t === FILL) continue;
    if (t !== type) out[t] = recs;
    else if (Object.keys(left).length) out[t] = left;
  }
  const fill = fillFor(fillKeys(carried), out);
  if (fill) out[FILL] = fill;
  if (Object.keys(out).some((k) => k !== FILL)) return { ...sheet, carried: out as Carried };
  const { carried: _drop, ...rest } = sheet;
  return rest as T;
}

/**
 * The roster's Duplicate (src/App.tsx onDuplicate): storage.ts `duplicateChar`'s copy, plus the copy's OWN
 * copy of every saved mode the original owns (`charId` = the original's id) — a fresh id each, `charId` = the
 * copy's id — with the copy's play state (`activeModes`, every companion's `companionModes`, `tempHpFrom`)
 * pointed at them. Guy 2026-10-21: "modes need to be per character". Before, the copy kept the original's
 * modes switched on: listed on both, so an edit or a delete on either reached the other.
 *
 * `modes` is this device's merged modes (content.modes). Neither it nor `original` is changed; the caller
 * saves the returned modes — the duplicate is a player action, never a load — and `ids` (original mode id →
 * its copy's) lets it carry a pin across. Left as they were on the copy: a
 * mode the original uses but does not own (an old unowned one, another character's), and a mode it holds only
 * through `carried` (a GM's, never written into the player's saved modes — ruling 2026-10-20; it stays
 * copy-on-write there). The copy stops carrying an original it now has its own copy of (`withoutCarried`);
 * what a sheet carries is collected again on its next send.
 */
export function duplicateWithOwnModes(
  original: SavedChar,
  modes: Readonly<Record<string, ModeDef | undefined>>,
): { copy: SavedChar; modes: ModeDef[]; ids: Record<string, string> } {
  let copy = duplicateChar(original);
  const made: ModeDef[] = [];
  const ids: Record<string, string> = {}; // original mode id → its copy's
  const taken = new Set(Object.keys(modes));
  for (const m of Object.values(modes)) {
    if (!m || typeof m !== 'object' || m.charId !== original.id || m.fromItemId) continue;
    let id = freshModeId();
    while (taken.has(id)) id = freshModeId();
    taken.add(id);
    ids[m.id] = id;
    made.push({ ...structuredClone(m), id, charId: copy.id });
    if (copy.play) copy = { ...copy, play: repointMode(copy.play, m.id, id) };
    copy = withoutCarried(copy, 'modes', m.id);
  }
  return { copy, modes: made, ids };
}
