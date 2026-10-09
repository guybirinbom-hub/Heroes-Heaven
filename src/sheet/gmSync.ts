/*
 * The one rule that decides whether a GM's unsaved work survives a player's edit.
 *
 * The GM's sheet holds a WORKING COPY. The player's published sheet arrives live underneath it. Which
 * of the two wins is the whole conflict model, so it lives here as a pure function with tests rather
 * than as a condition buried in an effect.
 */
import type { SavedChar } from '../data/storage';
import { authoredKey, canonicalJson, hash53 } from '../data/authored';

/** What the GM's editor should do with a newly published version of the player's sheet. */
export type GmReconcile =
  /** The two already match — usually our own push echoing back. Nothing to do. */
  | 'in-step'
  /** No unsaved GM edits, so take the player's version silently. This is the seamless case. */
  | 'adopt'
  /** The GM has unsaved edits. Keep them and flag the newer version — never overwrite work in progress. */
  | 'hold';

export function reconcileGmWork(args: { live: string; work: string; dirty: boolean; pushed?: string }): GmReconcile {
  if (args.live === args.work) return 'in-step';
  // …or it IS our own last push coming back. Since the GM's pending edit is overlaid on every
  // GM-side read (see the pending store below), the "live" sheet becomes our own push the moment it
  // lands — and a GM who had already started typing again would otherwise be told the PLAYER changed
  // their character, and offered to take a version that is the GM's own.
  if (args.pushed !== undefined && args.live === args.pushed) return 'in-step';
  return args.dirty ? 'hold' : 'adopt';
}

/**
 * Two spellings of ONE instant — never an ordering of two clocks.
 *
 * Every stamp the GM-edit channel compares is a copy of a single value one device wrote (the GM's push
 * stamp, the player's publish stamp), handed back by PostgREST in its own spelling (`+00:00`, fewer
 * fraction digits) or by this app as `toISOString()`. Equality is the only question ever asked of them.
 */
export function sameInstant(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}

/**
 * Which fetched GM edits this device has NOT handled yet — every row whose stamp is not the instant of
 * the last edit handled (applied, refused or settled) for the same (campaign, character).
 *
 * The stamp exists because the cleanup DELETE on `gm_character_edits` is best-effort: on a database
 * missing the `gce_owner_delete` policy it "succeeds" while removing NOTHING, and the surviving row
 * was then re-applied on every poll tick (2.5 s) — the player's sheet rewound to the GM's stale copy
 * seconds after every local change, inventory moves included, with no error anywhere. However long a
 * row lingers, it is judged exactly once.
 *
 * EQUALITY, never `<` (F1, 2026-10): the stamps are the GM's clock, and a push from the GM's OTHER
 * device whose clock runs slow is a different, newer edit stamped earlier — `<` silenced it. A row with
 * no timestamp cannot be told apart from one already handled, so it is skipped.
 */
export function editsToApply<E extends { campaignId: string; charId: string; updatedAt?: string }>(
  edits: E[],
  appliedStamps: Record<string, string>,
): E[] {
  return edits.filter((e) => !!e.updatedAt && !sameInstant(appliedStamps[`${e.campaignId}|${e.charId}`], e.updatedAt));
}

/* ──────────────────────────────────────────────────────────────────────────────
 * THE PLAYER'S SIDE OF THE CHANNEL — does a GM edit lose anything of theirs?
 * ────────────────────────────────────────────────────────────────────────────── */

/**
 * `gm_character_edits.gm_base` — which published sheet a GM push was BUILT on (F1, 2026-10).
 *
 *   at    a copy of this push's own `updated_at`. A row whose `at` is not its own stamp carries a base an
 *         EARLIER push left behind (an older GM app's upsert rewrites only the columns it sends), so it
 *         proves nothing about the sheet beside it (`boundGmBase`).
 *   stamp the `campaign_characters.updated_at` of the read it was built on, as PostgREST spelled it —
 *         for the GM's overlay DISPLAY only (`pendingEditStillStands`).
 *   hash  `hash53(authoredKey(<that read's sheet>))` — the proof. The player's app applies the push only
 *         while its own published sheet still has this hash (`gmEditVerdict`). Content, never a stamp.
 *   on    the `updated_at` of the earlier GM push this one was built on (his edit still unapplied), or
 *         null when it was built on the published sheet.
 */
export interface GmBase {
  v: 1;
  at: string;
  stamp: string;
  hash: string;
  on: string | null;
}

/** What this device last applied for one (campaign, character), outside the undo timeline:
 *  `at` = that row's own `updated_at` — WHICH push it was, the only value a later push's `gm_base.on`
 *  can name; `stamp` = that row's `gm_base.stamp` — the very PUBLISH it was applied over (a stamp names
 *  one publish, so unlike the hash it can never come back by an A-B-A); `base` = that row's
 *  `gm_base.hash`; `result` = `hash53(authoredKey(<the entry the apply produced>))`. A record without
 *  `at` / `stamp` (none was ever released) answers for no push by that field. */
export interface GmChainRecord {
  at?: string;
  stamp?: string;
  base: string;
  result: string;
}

export type GmEditVerdict = 'apply' | 'wait' | 'refuse' | 'settled' | 'told';

/** The row's `gm_base` when it really belongs to THIS push (its `at` is the row's own stamp), else
 *  undefined — no base, a malformed one, or a survivor an earlier push left beside a new sheet. */
export function boundGmBase(row: { updatedAt?: string; gmBase?: GmBase | 'future' }): GmBase | undefined {
  const b = row.gmBase;
  return b &&
    b !== 'future' &&
    b.v === 1 &&
    typeof b.stamp === 'string' &&
    b.stamp !== '' &&
    typeof b.hash === 'string' &&
    b.hash !== '' &&
    sameInstant(b.at, row.updatedAt)
    ? b
    : undefined;
}

/**
 * THE PLAYER'S RULE: apply a GM edit only when it provably loses nothing of the player's.
 *
 * The edit is a WHOLE sheet, built by the GM on a published sheet whose authored hash it carries. The
 * player's app reads its OWN published row fresh (`own`) and judges by what the player AUTHORED
 * (`authoredKey` — a launch rebuild's derived `character` never counts):
 *
 *   settled  the server already holds exactly the GM's sheet (their other device applied it): consume.
 *   apply    the server is still exactly the sheet it was built on AND this device's entry is that
 *            sheet too (for a push built on an earlier push of his, the same publish as well) — or,
 *            for a push built on an earlier push of his over the publish THIS device applied a push of
 *            his over (the chain record's `at` or `stamp`), the entry is still exactly what that apply
 *            produced and the server still at that publish or holding exactly that result.
 *   wait     the server is at the base but this device differs from it (unpublished, in-flight or failed
 *            work, a device behind its cloud copy), a read failed, or a newer app wrote the row:
 *            nothing is consumed, and the row is judged again on the next event.
 *   refuse   anything else — the player changed the character after the GM's read (F1), the row
 *            proves no base, or the character is no longer published here. Never applied.
 *   told     the server already holds this device's refusal receipt for this very push (a receipt that
 *            landed after the pass stopped waiting for it): consumed quietly like `settled`, never applied.
 *
 * Pure. Every comparison is content, a hash of it, or the equality of two copies of one stamp; no
 * clock is ordered anywhere.
 */
export function gmEditVerdict(a: {
  row: { updatedAt: string; sheet: SavedChar; gmBase?: GmBase | 'future' };
  /** A FRESH read of this player's own `campaign_characters` row; null = the read failed. */
  own: PublishedRow | null;
  /** The roster entry the edit would replace. */
  local: SavedChar;
  /** This device's record for campaign|char (persisted, outside undo). */
  chain?: GmChainRecord;
  /** What THIS device's load turned a sheet with this authored hash into (`authoredKey` of the loaded
   *  entry), when loading changed what counts as authored — a play migration of an app update
   *  (storage.ts → `loadedAuthoredAs`). Undefined: loading changed nothing there. */
  loaded?: (hash: string) => string | undefined;
}): GmEditVerdict {
  if (a.row.gmBase === 'future') return 'wait'; // a NEWER app's format: unknown is not empty
  if (!a.own) return 'wait'; // the own read failed
  // F1 (2026-10-09, round 6): the server already carries THIS device's refusal receipt for this very push
  // (a receipt UPDATE slower than the pass's 20 s bound lands after the pass gave up on it, so the row
  // stayed). The GM's card says "not applied": the row is only ever consumed now, never applied — an
  // A-B-A back to his base content (their undo) would otherwise land it under that receipt (race leg 46).
  if (sameInstant(a.own.gmRefusedAt, a.row.updatedAt)) return 'told';
  const b = boundGmBase(a.row);
  if (!b) return 'refuse'; // no base, malformed, or a base an earlier push left behind
  if (!a.own.sheet) return 'refuse'; // not published here any more (detached, left, kicked)
  const S = authoredKey(a.own.sheet);
  if (S === authoredKey(a.row.sheet)) return 'settled';
  const hS = hash53(S);
  const A = authoredKey(a.local);
  // The very publish the push was built on: the same content AND the same stamp (a stamp names one
  // publish — content alone can come back by an A-B-A, the stamp never does).
  const atThatPublish = hS === b.hash && sameInstant(a.own.updatedAt, b.stamp);
  if (
    b.on &&
    a.chain &&
    a.chain.base === b.hash &&
    (sameInstant(a.chain.at, b.on) || sameInstant(a.chain.stamp, b.stamp))
  ) {
    // Built on an earlier GM push, over the very publish THIS device applied a push of his over (or on
    // that very push — `on` names it): ONLY the chain may apply it — the entry must still be exactly what
    // that apply produced (a Ctrl+Z of it refuses), and the server either still at THAT publish or
    // holding exactly that result.
    // F1 (2026-10-09): keyed on the base hash alone, a record an OLD apply left answered for a push this
    // device never saw, whenever the sheet had come back to that content (an A-B-A) — applying over an
    // unpublished change, or refusing a push the general rule takes. Bound to the push by `at` (10c).
    // F1 (2026-10-09): bound by `at` ALONE, a THIRD gesture (E3 `on` E2, E2 `on` E1, all on one publish)
    // missed the record of E1 on the device that applied E1 and had its Ctrl+Z inside the debounce, fell
    // to the general rule (the server unmoved) and was APPLIED — E1's change back over the undo (a round-2
    // refuter probe, now test/gm-sync.test.ts (10f)). Every push his app builds on a held edit carries that edit's base
    // publish (`pendingEditStandsOnFreshRead`), so the record's `stamp` catches the whole chain (10f).
    // F1 (2026-10-09): "server still at the base" was content alone, so a device that applied E1 and is
    // BEHIND its other device — which took E1 back, publishing the base content under a new stamp —
    // applied E2 (carrying E1's change) and its republish then overwrote that other device's publish
    // (a round-2 refuter probe, now race leg (13b)). It needs the very publish now (10e).
    const r = a.chain.result;
    return hash53(A) === r && (atThatPublish || hS === r) ? 'apply' : 'refuse';
  }
  // At the base: the server holds the content the push was built on. For a push built on an earlier
  // push of his (`on`) that this device did NOT apply, the content alone is not enough: their other
  // device may have applied that earlier push and they then took it back (a heal after his hit),
  // returning the sheet to his base content under a newer publish — and this push still carries the
  // hit. So such a push needs the very PUBLISH it was built on as well (the same rule the GM's write
  // path builds on his held edit by, `pendingEditStandsOnFreshRead`). The cost is his and visible: a
  // republish that changed nothing (a launch, their other device's launch, a homebrew re-derive) refuses
  // it — "not applied", he gestures again. That includes TWO between-session Updates (the second built
  // on the first) once the player's launch republish lands before this device reads its own row: a
  // device with no record of the first cannot tell "a launch changed nothing" from "their other device
  // applied the first and they took it back", and only the second is player-safe to assume
  // (README Known gaps; test/bug-gm-edit-race.test.tsx leg 34c).
  // F1 (2026-10-09): test/gm-sync.test.ts "a chain-less device never applies a chained push over a heal".
  // For a push built on the PUBLISHED sheet (`on` null) content is the proof — and the content THIS
  // device's own load made of the base counts as the base: a load is not an edit. An app update whose
  // load migrates `play` (normalizePlay dropping a legacy field) otherwise made the loaded entry differ
  // from what the old version published, and its launch republish refused every between-session edit
  // (a round-2 refuter probe, now race leg 34b).
  const atBase = b.on ? atThatPublish : hS === b.hash || (!!a.loaded && a.loaded(b.hash) === S);
  if (atBase && A === S) return 'apply';
  return atBase ? 'wait' : 'refuse';
}

/* ──────────────────────────────────────────────────────────────────────────────
 * THE GM'S PENDING EDIT — what the GM sees between "Update" and the player's app
 * ────────────────────────────────────────────────────────────────────────────── */

/**
 * A GM's Update does NOT change the player's published character. It writes a row to
 * `gm_character_edits`; the PLAYER's app picks that row up, applies it, and re-publishes. Everything
 * the GM looks at — the party cards, the pane card, the sheet they reopen — reads the PUBLISHED row.
 *
 * So until the player's device has been open and synced, the GM's own change was invisible to them:
 * press Update, go back to the character, and nothing had changed. The owner's words: *"it didn't
 * update the character at all."* Between sessions, with nobody's app open, that is the normal case
 * and it lasted for days.
 *
 * This is the GM-side record of "what I last pushed", kept here beside the conflict rule it belongs
 * to. It is overlaid on every GM-side read of the published sheet until the player's row overtakes
 * it, and it carries the chip that says the player hasn't picked it up yet.
 *
 * ⚠ IT IS NEVER PUBLISHED. It is a local view of a change already on the server; only the player's
 * own device ever writes `campaign_characters` for their character, exactly as before. And a player
 * publish NEWER than the push wins outright — the pending copy is dropped, not merged, so a GM's
 * stale edit can never sit on top of work the player did afterwards.
 */
export interface PendingGmEdit {
  campaignId: string;
  charId: string;
  /** The whole SavedChar the GM pushed — the same object that went into `gm_character_edits`. */
  sheet: SavedChar;
  /** The stamp that row carries (the GM's clock at push time). Only ever compared against OTHER
   *  stamps from this same device — see `baseUpdatedAt` for why that matters. */
  pushedAt: string;
  /**
   * `campaign_characters.updated_at` as it stood the moment we pushed — the PLAYER's clock.
   *
   * ⚠ This field exists because the obvious test (`published.updated_at > pushedAt`) compares two
   * DIFFERENT devices' clocks. A GM whose machine runs a few minutes fast would decide the player's
   * newer publish was older and keep the overlay up. Both values here come off the player's own
   * clock, so "did they publish after I pushed?" is answered by a comparison that skew cannot break.
   *
   * It is the stamp of the publish the push was BUILT on (`rememberGmEdit`), and it drives what is
   * DRAWN (`pendingEditStillStands`, by `>`). The write path needs it too, by EQUALITY, beside
   * `baseHash` below (`pendingEditStandsOnFreshRead` says why both).
   *
   * Undefined only on an edit seeded from a row an OLDER GM app wrote (no bound `gm_base`). Every push
   * this app makes carries one (`pushGmEdit` refuses without it), and a row it wrote seeds it back
   * (`fetchPendingGmEdits`), so an edit from his other device or a sign-in is proved like any other.
   */
  baseUpdatedAt?: string;
  /**
   * `hash53(authoredKey(<the published sheet the push was built on>))` — the same value the row carries
   * in `gm_base.hash`, and the proof the WRITE path stands on (`pendingEditStandsOnFreshRead`).
   *
   * ⚠ A WRITE DEPENDS ON IT. The tracker seam builds every push on what `gmPushBuiltOn` answers — his
   * edit while the published sheet is still the one it was built on, else the published sheet — and
   * `gm_character_edits` keeps one row per character, so this decides whether his next push is built
   * ON his last edit or REPLACES it. Content AND the stamp (`baseUpdatedAt`, by equality): the player's
   * app applies a push built on his held edit by the same pair (`gmEditVerdict`, `on` set), so the two
   * ends of the channel cannot disagree about it. A hash,
   * once proved, is never downgraded by a push that did not carry one (`rememberGmEdit`). Undefined
   * exactly where `baseUpdatedAt` is: such an edit is never built on.
   */
  baseHash?: string;
  /**
   * WHOSE character this edit is about — `campaign_characters.owner_id`.
   *
   * It travels with the edit so the "never on your own character" rule can live at the one place
   * every surface reads through (`gmPendingEdit`) instead of at each of them. A GM who plays in
   * their own campaign is both parties: an edit they push to themselves lands through the ordinary
   * player path (their own app applies it and republishes), so drawing an overlay of it on their own
   * card, pane and sheet only showed them a change with no way to tell it apart from what they had
   * published. Undefined on an edit from a row with no owner recorded — but that gap is what the
   * READ closes now: `learnPendingOwner` fills it in from the published row's own `owner_id`, and
   * `resolvePendingGmEdit` refuses to draw an overlay on the signed-in account's own character, or
   * when nobody — neither this field nor the published row — can say whose character it is. The
   * card's own `m.ownerId !== myId` test (./PartyMembers.tsx) is only the belt for the case where
   * there is no published row to learn from at all.
   */
  ownerId?: string;
}

/** The published row as the party layer reads it, before any overlay. */
export interface PublishedRow {
  sheet: SavedChar | null;
  /** `campaign_characters.updated_at` — the PLAYER's clock at their last publish. */
  updatedAt?: string;
  /**
   * `campaign_characters.owner_id` — WHOSE character this row is.
   *
   * The only thing that can answer that for an edit whose own row never recorded it (see
   * `PendingGmEdit.ownerId`): a pending edit is matched to a published row by (campaign, character),
   * and the row always knows its owner. So the read fills the gap in, and the "never on your own
   * character" rule below can judge an older edit everywhere instead of nowhere.
   *
   * Undefined where the caller has no row to hand — the party cards' pruner passes a stamp alone.
   */
  ownerId?: string;
  /**
   * `campaign_characters.gm_refused_at` — the `updated_at` of the last GM edit the PLAYER's app
   * REFUSED (it was built on a sheet they had changed since). A copy of the GM's own push stamp, so it
   * is compared with `pushedAt` by equality and never ordered against anything.
   */
  gmRefusedAt?: string;
}

export function pendingGmKey(campaignId: string, charId: string): string {
  return `${campaignId}|${charId}`;
}

/** THE ONLY WAY a stamp-only row is built — the party list's member carries the stamp and the receipt,
 *  never the sheet (test/gm-sync.test.ts walks src/ for any other spelling of it). */
export function memberPublishedRow(m: { updatedAt?: string; gmRefusedAt?: string }): PublishedRow {
  return { sheet: null, updatedAt: m.updatedAt, gmRefusedAt: m.gmRefusedAt };
}

/** The base a GM push carries, from the FRESH read it was built on — one helper, so the two GM callers
 *  (the seam's `send`, GmEditSheet's Update) cannot drift. Undefined when the read gave no sheet or no
 *  stamp: then nothing is proved and nothing is sent (`pushGmEdit` refuses). */
export function gmBaseOf(row: PublishedRow | null | undefined): { stamp: string; hash: string } | undefined {
  if (!row?.sheet || !row.updatedAt) return undefined;
  return { stamp: row.updatedAt, hash: hash53(authoredKey(row.sheet)) };
}

/**
 * Does a pushed edit still describe what the GM should be shown?
 *
 * Two ways it stops standing, and neither of them can lose anybody's work:
 *   • the player published something AFTER the push — their version is the newer one and wins, which
 *     is the same rule every other sync path in this app follows. "After" is measured against
 *     `baseUpdatedAt`, the published stamp we saw at push time, so both sides of the comparison come
 *     off the PLAYER's clock and a GM device running fast or slow cannot change the answer;
 *   • the published sheet IS the edit — their app applied it and published the result, so the
 *     overlay has nothing left to add. No clock at all in that one, and no key order either
 *     (`canonicalJson`): compared as written, a sheet that came back through jsonb never matched.
 * A read that FAILED (`null`) is not an answer, so the edit stands: dropping it on a bad response
 * would flip the GM's screen back to the pre-edit character for no reason at all.
 *
 * And a third way, with no clock either (F1, 2026-10): the player's app REFUSED it — they changed the
 * character after his read — and said so on their row (`gm_refused_at` is this push's own stamp).
 *
 * ⚠ For what is DRAWN. The `>` stays because party-list stamps can be older than the base; a WRITE
 * asks `pendingEditStandsOnFreshRead` instead.
 */
export function pendingEditStillStands(edit: PendingGmEdit, published: PublishedRow | null): boolean {
  if (!published) return true;
  if (published.gmRefusedAt && sameInstant(published.gmRefusedAt, edit.pushedAt)) return false;
  // No base (we never saw the row it was built on): fall back to its own push stamp — the GM's clock
  // against the player's, so best-effort, and for what is DRAWN only: the write path
  // (`pendingEditStandsOnFreshRead`, through `gmPushBuiltOn` / `gmUpdateBase`) never builds on an edit
  // with no base.
  if (published.updatedAt && published.updatedAt > (edit.baseUpdatedAt ?? edit.pushedAt)) return false;
  if (published.sheet && canonicalJson(published.sheet) === canonicalJson(edit.sheet)) return false;
  return true;
}

/**
 * Does a held edit still stand against a FRESH read — the WRITE-path test (F1, 2026-10).
 *
 * The published row must still be exactly the PUBLISH the edit was built on — the same stamp (equality:
 * a copy of one value the player's device wrote, never an ordering) AND the same authored content
 * (`baseHash`, the very test the player's app applies a push with, `gmEditVerdict`) — and the player's
 * app must not have refused it. So a push built ON his held edit is one their app will take, and one
 * built on their sheet replaces it only when they have published since.
 *
 * Why both. `>` let a second player device's earlier-stamped publish keep a stale edit standing under
 * a push (F2), so the stamp test is equality. And content alone is not enough either: their app can
 * apply his edit and then take its change back (a heal after his hit), which returns the published
 * sheet to his base CONTENT under a new stamp. Built on his edit there, the next push would carry his
 * old hit back over their heal, and a device of theirs that never applied the first one would accept it
 * (measured 2026-10-09: the seam legs PROBE-OWN-ABA and "his next gesture does not carry his own
 * overtaken push back" fail on content alone). The cost of the stamp is his, never theirs: a republish
 * that changed nothing of theirs stands his held edit down for the write path, and his next push is
 * built on their sheet. An edit with no proved base never stands here.
 */
export function pendingEditStandsOnFreshRead(edit: PendingGmEdit, published: PublishedRow): boolean {
  return (
    !!edit.baseHash &&
    !!published.sheet &&
    sameInstant(published.updatedAt, edit.baseUpdatedAt) &&
    hash53(authoredKey(published.sheet)) === edit.baseHash &&
    !sameInstant(published.gmRefusedAt, edit.pushedAt)
  );
}

/** The sheet a GM should see for this character: their pending edit while it stands, else the
 *  published one. Pure — the store below is what decides which edit is passed in. */
export function withPendingGmEdit(published: PublishedRow | null, edit: PendingGmEdit | undefined): SavedChar | null {
  if (edit && pendingEditStillStands(edit, published)) return edit.sheet;
  return published?.sheet ?? null;
}

/*
 * ⚠ ONE STORE PER ACCOUNT — AND NO DISK AT ALL UNTIL WE KNOW WHOSE IT IS.
 *
 * A pending edit is a GM's change to SOMEBODY ELSE's character that the player is deliberately not
 * told about. localStorage is per origin, not per account: with one shared key, the next person to
 * sign in on a browser profile the GM had used got the GM's secret sheet — their own card
 * re-summarised from it, "waiting" chip and all. The key therefore carries the uid of the account
 * that pushed, and while no account is bound there is no disk copy at all: "we haven't asked who
 * this is yet" must never fall back to a key everyone shares.
 *
 * Losing the disk copy costs the chip until the next `fetchPendingGmEdits`, never an edit — every
 * pending edit is a row on the server.
 */
const PENDING_STORE_KEY = 'wanderers-codex:gm-pending-edits:v1';
let pendingAccount: string | null = null;
function pendingStoreKey(): string | null {
  return pendingAccount && typeof localStorage !== 'undefined' ? `${PENDING_STORE_KEY}:${pendingAccount}` : null;
}
let pendingStore: Map<string, PendingGmEdit> | null = null;
let pendingVersion = 0;
const pendingWatchers = new Set<() => void>();

function pendingMap(): Map<string, PendingGmEdit> {
  if (pendingStore) return pendingStore;
  pendingStore = new Map();
  try {
    const key = pendingStoreKey();
    const raw = key ? localStorage.getItem(key) : null;
    for (const e of (raw ? (JSON.parse(raw) as PendingGmEdit[]) : []) ?? [])
      if (e?.campaignId && e?.charId && e?.sheet) pendingStore.set(pendingGmKey(e.campaignId, e.charId), e);
  } catch {
    /* no storage (private mode, quota, a wiped profile) — memory alone still covers this session */
  }
  return pendingStore;
}

/**
 * The disk copy, so the chip survives a reload. Best-effort by design: losing it costs the chip
 * until the next server read re-seeds it, never the edit itself (the edit is a row on the server).
 *
 * A pushed SavedChar can carry an inline portrait, so the whole set CAN go over the storage quota.
 * Writing the newest edit alone rather than giving up on all of them means the character the GM just
 * pressed Update on is the one that survives — the rest are still in memory for this session.
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Scheduled, never synchronous — because EVERY point of damage the GM enters in the tracker lands
 * here (the tracker seam's push → pushGmEdit → rememberGmEdit → pendingChanged), and the write below
 * stringifies every pending edit, each of which is a whole character sheet that can carry an inline
 * portrait. Doing that on the main thread per keystroke of damage is a stall mid-combat. A burst now
 * collapses into one write; the delay costs nothing, because this copy is only ever read at startup
 * and is best-effort there too (the server read re-seeds what it misses).
 */
function persistPending(): void {
  if (!pendingStoreKey() || persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    writePending();
  }, 400);
}

function writePending(): void {
  const key = pendingStoreKey();
  if (!key) return;
  const all = [...pendingMap().values()];
  try {
    localStorage.setItem(key, JSON.stringify(all));
    return;
  } catch {
    /* over quota (or no storage at all) — fall through */
  }
  try {
    const newest = all.slice().sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : -1)).slice(0, 1);
    localStorage.setItem(key, JSON.stringify(newest));
  } catch {
    /* no storage (private mode, a blocked profile) */
  }
}

function pendingChanged(): void {
  pendingVersion++;
  persistPending();
  for (const w of [...pendingWatchers]) w();
}

/**
 * Edits we have already DROPPED, key → the push stamp they carried.
 *
 * The cleanup DELETE on `gm_character_edits` is best-effort: on a database missing the
 * `gce_owner_delete` policy it "succeeds" while removing nothing (the app warns about exactly this),
 * so a row the player applied weeks ago can sit there forever. Without this, every GM mount re-read
 * that row and resurrected it as pending, and the "waiting" chip became permanent and unclearable.
 *
 * Session-scoped on purpose: a reload may resurrect such a row once, and the published stamp then
 * drops it again. What it must never do is come back every single time.
 */
const droppedPending = new Map<string, string>();
/** …and whose character each dropped edit was about, so a refusal receipt for it can still keep the
 *  "not applied" chip off the signed-in account's own character. */
const droppedOwner = new Map<string, string | undefined>();

/**
 * "The player's app refused your last push" — key → that push's stamp and whose character it is.
 *
 * Filled from the refusal receipt (`campaign_characters.gm_refused_at`) by `noteGmReceipt` when it
 * names the push this device holds, or one it already dropped or replaced this session. Session-scoped:
 * a new push that CARRIES the refused one clears it (`rememberGmEdit`), and so do a full-sheet Update
 * made after it (`acknowledgeGmEditRefused`) and a change of account.
 */
const refusedNotice = new Map<string, { pushedAt: string; ownerId?: string }>();
/**
 * The push of his that a LATER push of his replaced on the server WITHOUT carrying it (key → its stamp
 * and whose character it is) — held or already dropped when the new one went out.
 *
 * F1 (2026-10-09): a receipt is the stamp of the push their app refused, and it can only name a push
 * this device still knows. His full-sheet XP award E1 was refused; his tracker hit E2 went out on THEIR
 * sheet (rightly — E1 was refused, so nothing was built on it) and replaced E1 as the held edit. From
 * then on a receipt for E1 matched nothing held and nothing dropped, so "not applied" was never shown,
 * or was taken off a card that already showed it: his award was gone and no screen said so (refuter
 * probe of 2026-10-09; test/gm-sync.test.ts "a refused Update is never silently replaced by his next
 * push"). Session-scoped, like `droppedPending`.
 */
const supersededPending = new Map<string, { pushedAt: string; ownerId?: string }>();

/** Set once a read or a push met a database without the F1 columns (the SQL not re-run yet). */
let schemaOutdated = false;

/** The party layer calls this when `gm_character_edits.gm_base` (or `gm_refused_at`) does not exist. */
export function markGmEditSchemaOutdated(): void {
  if (schemaOutdated) return;
  schemaOutdated = true;
  pendingChanged();
}

/** Has this session met a database that still needs supabase-campaign-characters.sql re-run? */
export function gmEditSchemaOutdated(): boolean {
  return schemaOutdated;
}

/**
 * WHOSE pending edits this device is holding — the signed-in uid, or null when signed out.
 *
 * Bound by whichever comes first: the auth listener (src/data/useAuth.ts, which is also what hears
 * the sign-OUT) or the two party calls that have just asked who we are (`pushGmEdit`,
 * `fetchPendingGmEdits`). Changing account — signing out included — drops what was held for the
 * previous one from memory AND from disk, so the next person to sign in on this browser profile
 * inherits nothing: a GM's edit is silent by design, and the player it is about must never be shown
 * it. Nothing is lost by dropping it; the GM's own campaign read seeds theirs again from the server.
 */
export function setGmPendingAccount(uid: string | null): void {
  if (uid === pendingAccount) return;
  if (persistTimer) {
    clearTimeout(persistTimer); // a queued write belongs to the account we are leaving
    persistTimer = null;
  }
  try {
    const key = pendingStoreKey();
    if (key) localStorage.removeItem(key);
    // …and the pre-scoping key, from a build that kept one store for the whole browser profile.
    if (typeof localStorage !== 'undefined') localStorage.removeItem(PENDING_STORE_KEY);
  } catch {
    /* no storage (private mode, a blocked profile) */
  }
  pendingAccount = uid;
  pendingStore = null; // re-read on the next use, from the new account's key
  droppedPending.clear();
  droppedOwner.clear();
  refusedNotice.clear();
  supersededPending.clear();
  pendingChanged();
}

/** Subscribe to "a pending edit appeared / was superseded" (useSyncExternalStore). */
export function subscribeGmPending(onChange: () => void): () => void {
  pendingWatchers.add(onChange);
  return () => {
    pendingWatchers.delete(onChange);
  };
}

/** A counter that changes whenever the pending set does — the store's snapshot. */
export function gmPendingVersion(): number {
  return pendingVersion;
}

/** Record what the GM just pushed. Called only after the server ACCEPTED the row. `baseUpdatedAt` is
 *  the published stamp the push was built on — see the field's note for why it is not `pushedAt`. */
export function rememberGmEdit(
  campaignId: string,
  charId: string,
  sheet: SavedChar,
  pushedAt: string,
  baseUpdatedAt?: string,
  /** The player the edit is about (`campaign_characters.owner_id`) — see `PendingGmEdit.ownerId`. */
  ownerId?: string,
  /** `gm_base.hash` of the push — see `PendingGmEdit.baseHash`. */
  baseHash?: string,
  /** `gm_base.on` of the push: the earlier push of his it CARRIES (built on it), or null/undefined. */
  builtOn?: string | null,
): void {
  const key = pendingGmKey(campaignId, charId);
  const had = pendingMap().get(key);
  const carries = (stamp: string) => !!builtOn && sameInstant(builtOn, stamp);
  // The push this one REPLACES on the server — the held one, else one dropped this session. Unless the
  // new push carries it, a refusal receipt for it may still arrive and must still be shown
  // (`supersededPending`). The same push remembered again replaces nothing.
  const replaced = had
    ? { pushedAt: had.pushedAt, ownerId: had.ownerId }
    : droppedPending.has(key)
      ? { pushedAt: droppedPending.get(key)!, ownerId: droppedOwner.get(key) }
      : undefined;
  if (replaced && !sameInstant(replaced.pushedAt, pushedAt)) {
    if (carries(replaced.pushedAt)) supersededPending.delete(key);
    else supersededPending.set(key, replaced);
  }
  droppedPending.delete(key); // a fresh push is a new edit, whatever we dropped before
  droppedOwner.delete(key);
  // "Not applied" STAYS unless this push carries the refused one. F1 (2026-10-09): it used to go with
  // every new push, so his next tracker hit — built on their sheet, without the refused XP award —
  // erased the only sign that the award never landed. A full-sheet Update he makes after seeing it
  // answers it (`acknowledgeGmEditRefused`, ./GmEditSheet.tsx).
  const notice = refusedNotice.get(key);
  if (notice && carries(notice.pushedAt)) refusedNotice.delete(key);
  /*
   * ⚠ RECORDED ON THE PUBLISH IT WAS BUILT ON — AND A MISSING BASE NEVER REPLACES ONE WE HAVE.
   *
   * Both push paths read the published row themselves and pass the base of that read (`gmBaseOf`):
   * the tracker seam builds on what `gmPushBuiltOn` answers for it, and the full-sheet Update
   * (./GmEditSheet.tsx) proves its working copy against that read (`gmUpdateBase`) — or the GM
   * knowingly chose "Overwrite anyway" over it. So a publish of theirs from before the read is one the
   * push was built on, and the base is recorded as it is. This used to keep the OLDER of it and the replaced
   * edit's base, "so the overlay only stands down sooner" — but a newer stamp means that read had
   * already seen the replaced edit overtaken, and the older base made the push built on their newer
   * publish look overtaken by that very publish: the next read dropped it, the row snapped back, and
   * the seam's next gesture, built on the published sheet, replaced it on the server (a push built on
   * their republish of his earlier one; an Update he confirmed over their newer sheet).
   *
   * A read that FAILS (offline, a blip) proves nothing, and `pushGmEdit` sends nothing then (F1). A
   * direct caller that still passes no base must not downgrade a protected edit to the `pushedAt`
   * fallback, i.e. to the GM's clock against the player's: the exact comparison `baseUpdatedAt`
   * exists to remove. So a missing base keeps the one we already have — the hash alike.
   */
  pendingMap().set(key, {
    campaignId,
    charId,
    sheet,
    pushedAt,
    baseUpdatedAt: baseUpdatedAt ?? had?.baseUpdatedAt,
    baseHash: baseHash ?? had?.baseHash,
    // Same reasoning as the base stamp: a push that didn't say whose character this is must never
    // un-hide an edit we already knew was our own.
    ownerId: ownerId ?? had?.ownerId,
  });
  pendingChanged();
}

/**
 * What the server says is still waiting for this campaign's players, made to agree with what we hold.
 *
 * A SUCCESSFUL read of `gm_character_edits` for a whole campaign IS an answer about that campaign: a
 * row that is not in it has been applied and deleted by the player's app, so the chip must go. The
 * earlier version folded rows in and never took any out, which left the party page showing "waiting"
 * on a character whose edit landed days ago, with nothing on that page able to clear it.
 *
 * UNKNOWN is still not EMPTY, so the two ways a read can lie are both handled:
 *   • a FAILED read never reaches here at all (the caller returns early), and
 *   • an edit pushed while this read was in flight is not missing from the answer, it is newer than
 *     it. `before` is the snapshot the caller took when it started, and the test is object IDENTITY:
 *     a push replaces the entry, so a re-push of the same character during the read is not the entry
 *     the answer was about. No clock is involved, so nothing here can be decided by one being wrong.
 *
 * The add loop is EQUALITY too (F1, 2026-10): a row is the push we hold when its stamp is the same
 * instant (the same push carries the same base either way, so OUR object is kept — rule E's identity),
 * and a DIFFERENT push on the server replaced ours, whatever the two GM devices' clocks say — `>=`
 * kept a stale copy whenever his other device's clock ran slow. Only a push made here while the read
 * was out beats the server's answer, and `before` says which that is.
 */
export function reconcileGmPendingEdits(campaignId: string, rows: PendingGmEdit[], before: Map<string, PendingGmEdit>): void {
  const map = pendingMap();
  let changed = false;
  const onServer = new Set(rows.filter((r) => r?.charId).map((r) => pendingGmKey(campaignId, r.charId)));
  for (const [key, have] of [...map]) {
    if (have.campaignId !== campaignId || onServer.has(key)) continue;
    if (before.get(key) !== have) continue; // pushed (or re-pushed) since the read began
    map.delete(key);
    droppedPending.set(key, have.pushedAt);
    droppedOwner.set(key, have.ownerId);
    changed = true;
  }
  for (const r of rows) {
    if (!r?.campaignId || !r?.charId || !r?.sheet) continue;
    const key = pendingGmKey(r.campaignId, r.charId);
    // Already answered: this row is one we DROPPED because the player's own publish overtook it, and
    // it is only still on the server because the cleanup delete couldn't remove it. Re-seeding it is
    // what made the chip permanent on such a database.
    const dropped = droppedPending.get(key);
    if (dropped && sameInstant(dropped, r.pushedAt)) continue;
    const have = map.get(key);
    // The same push: keep OUR object — it is what the seam's own-push test compares by identity. One
    // held from an older build's disk copy has no hash; the row's bound base proves it, in place.
    if (have && sameInstant(have.pushedAt, r.pushedAt)) {
      if (!have.baseHash && r.baseHash) {
        have.baseHash = r.baseHash;
        have.baseUpdatedAt ??= r.baseUpdatedAt;
        changed = true;
      }
      continue;
    }
    // Pushed here while the read was out: ours is newer than the answer.
    if (have && before.get(key) !== have) continue;
    // Otherwise the server row IS the current push.
    map.set(key, r);
    changed = true;
  }
  if (changed) pendingChanged();
}

/**
 * The edit to SHOW for this character — the one read every GM-side surface goes through (the cards,
 * the pane card's chip, the sheet, the tracker seam's test for a push of its own coming back — which
 * asks only whether that sheet IS this edit's, by object — and `resolvePendingGmEdit` below).
 *
 * ⚠ NEVER OUR OWN CHARACTER. The store is already private to the account that pushed, which keeps a
 * GM's silent edit away from the player it is about; this is the other half, for the one account
 * that is both. The rule was written out at one of the three surfaces and simply missing from the
 * other two, so a GM who plays in their own campaign read edited numbers on the pane card with no
 * chip to explain them. It is held, pruned and pushed exactly as any other edit — it is only never
 * drawn as an overlay, because their own app is what applies it and republishes.
 */
export function gmPendingEdit(campaignId: string, charId: string): PendingGmEdit | undefined {
  const edit = pendingMap().get(pendingGmKey(campaignId, charId));
  if (edit?.ownerId && edit.ownerId === pendingAccount) return undefined;
  return edit;
}

/** What this campaign has pending RIGHT NOW — taken before a server read so `reconcileGmPendingEdits`
 *  can tell "the server doesn't have it any more" from "it was pushed while I was asking". */
export function snapshotGmPending(campaignId: string): Map<string, PendingGmEdit> {
  return new Map([...pendingMap()].filter(([, e]) => e.campaignId === campaignId));
}

export function dropGmPendingEdit(campaignId: string, charId: string): void {
  const key = pendingGmKey(campaignId, charId);
  const had = pendingMap().get(key);
  if (!pendingMap().delete(key)) return;
  // Remember WHICH push we dropped, so a server row that outlives its own delete can't bring it back.
  if (had) {
    droppedPending.set(key, had.pushedAt);
    droppedOwner.set(key, had.ownerId);
  }
  pendingChanged();
}

/**
 * Read the PLAYER's refusal receipt off a published row (F1, 2026-10).
 *
 * `gm_refused_at` is the stamp of the last push their app refused. When it names the push this device
 * HOLDS, or one it dropped earlier this session (their publish stood it down before the receipt came),
 * the GM is told "not applied" (`gmEditRefused`) instead of watching his change silently vanish.
 */
function noteGmReceipt(campaignId: string, charId: string, published: PublishedRow | null): void {
  const at = published?.gmRefusedAt;
  if (!at) return;
  const key = pendingGmKey(campaignId, charId);
  const held = pendingMap().get(key);
  let notice: { pushedAt: string; ownerId?: string } | undefined;
  const dropped = droppedPending.get(key);
  const superseded = supersededPending.get(key);
  if (held && sameInstant(at, held.pushedAt)) notice = { pushedAt: held.pushedAt, ownerId: held.ownerId ?? published?.ownerId };
  else if (dropped && sameInstant(at, dropped)) notice = { pushedAt: dropped, ownerId: droppedOwner.get(key) ?? published?.ownerId };
  // A push of his that a later one replaced without carrying it (F1, 2026-10-09 — `supersededPending`).
  else if (superseded && sameInstant(at, superseded.pushedAt))
    notice = { pushedAt: superseded.pushedAt, ownerId: superseded.ownerId ?? published?.ownerId };
  if (!notice) return;
  const had = refusedNotice.get(key);
  if (had && sameInstant(had.pushedAt, notice.pushedAt) && had.ownerId === notice.ownerId) return;
  refusedNotice.set(key, notice);
  pendingChanged();
}

/** "Your last push to this character was not applied — the player changed it first." Never on the
 *  signed-in account's own character (their own app is the one that refused it). */
export function gmEditRefused(campaignId: string, charId: string): boolean {
  const n = refusedNotice.get(pendingGmKey(campaignId, charId));
  return !!n && n.ownerId !== pendingAccount;
}

/** The GM has ANSWERED "not applied" for this character: a full-sheet Update he pushed after it
 *  (./GmEditSheet.tsx — the sheet showed him the refusal and the player's version). A tracker gesture
 *  never answers it (F1, 2026-10-09: see `supersededPending`). */
export function acknowledgeGmEditRefused(campaignId: string, charId: string): void {
  const key = pendingGmKey(campaignId, charId);
  const had = refusedNotice.delete(key);
  supersededPending.delete(key);
  if (had) pendingChanged();
}

/**
 * Teach an edit whose own row never recorded an owner whose character it is.
 *
 * `gm_character_edits.owner_id` came later than the first rows, and an edit that cannot say whose
 * character it is, is one the rule above cannot judge. The published row it is matched against
 * always knows, so the single read every surface goes through fills it in — once — and the rule
 * then covers the sheet, the "waiting" strip on it, the cards' chips and the tracker's pane
 * together, instead of each of them carrying its own guess about an edit nobody could judge.
 */
function learnPendingOwner(campaignId: string, charId: string, ownerId?: string): void {
  if (!ownerId) return;
  const key = pendingGmKey(campaignId, charId);
  const edit = pendingMap().get(key);
  if (!edit || edit.ownerId) return; // an owner the push itself recorded is the better one
  // Mutate in place — `reconcileGmPendingEdits` tells "pushed while the read was in flight" apart
  // from "the server dropped it" by object identity (`before.get(key) !== have`, ~line 416).
  // Replacing the entry here would forge a false "pushed since" for every edit this learns an
  // owner for, and a delete that should happen gets skipped.
  edit.ownerId = ownerId;
  pendingChanged();
}

/**
 * The one call the party layer makes: give it what the server answered, get back the sheet the GM
 * should see. A pending edit the published row has overtaken is dropped here — that is where the
 * chip goes away, so the card, the pane and the sheet all stop showing it together.
 *
 * ⚠ Judged on what is HELD, his own character's edit included. `gmPendingEdit` hides that one from
 * every surface that draws, and judged through it, it was never dropped at all: it was held, on its
 * first base, for the whole session.
 */
export function resolvePendingGmEdit(campaignId: string, charId: string, published: PublishedRow | null): SavedChar | null {
  // The row knows whose character this is even when an older edit row didn't.
  learnPendingOwner(campaignId, charId, published?.ownerId);
  // …and whether their app refused his push (before the drop below, which the receipt itself causes).
  noteGmReceipt(campaignId, charId, published);
  const held = pendingMap().get(pendingGmKey(campaignId, charId));
  if (held && !pendingEditStillStands(held, published)) {
    dropGmPendingEdit(campaignId, charId);
    return published?.sheet ?? null;
  }
  const edit = gmPendingEdit(campaignId, charId);
  /*
   * ⚠ AND NEVER ONTO OUR OWN CHARACTER — from HERE, not from each surface that draws the result.
   *
   * A GM's pending edit is private to the GM's account. Overlaid on the signed-in account's own
   * character it is somebody's unapplied change to OUR sheet, shown as if we had published it: the
   * cards carried their own test for that (`m.ownerId === myId` in ./PartyMembers.tsx) and the
   * SHEET those cards open carried none, so the card refused the edit while the sheet behind it
   * showed it.
   *
   * Two ways to refuse, and neither is a guess: the row says the owner is us, or nobody can say
   * whose character this is at all (an older edit row, and a read that gave us no row either). An
   * overlay we cannot judge is one we do not draw — the published sheet is what this account
   * published, and showing that is never wrong.
   */
  if (edit && (published?.ownerId ? published.ownerId === pendingAccount : !edit.ownerId))
    return published?.sheet ?? null;
  return withPendingGmEdit(published, edit);
}

/**
 * The sheet a GM's next push must be BUILT on, given the published row the push's own fresh read just
 * answered — his pending edit while it stands against that read ON A PROVED BASE
 * (`pendingEditStandsOnFreshRead`: the published sheet is still the one it was built on, and their
 * app has not refused it), else the published sheet — and WHICH push of his it is built on (`on`,
 * which the row carries in `gm_base.on` so the player's app can apply it over his earlier one).
 *
 * Judged on what is HELD, his OWN character included. `resolvePendingGmEdit` never DRAWS an edit over
 * the signed-in account's own character, and for what is shown that is right: their own app applies
 * it and republishes. A push is another question. Until that app has applied it, his last edit is
 * still the newest thing the server holds for the character, and `gm_character_edits` keeps one row
 * per character, so the next push REPLACES it: built on the published sheet instead, it carries his
 * earlier change away.
 *
 * The published sheet, then, in three cases:
 *   • the edit has STOOD DOWN against this read (their published sheet is no longer the one it was
 *     built on — they changed it, or their app applied it and republished): theirs is the newer sheet,
 *     and the push is recorded on this read's base (`rememberGmEdit`), so it stands. Nothing is dropped
 *     or announced from here — that told every watcher mid-push, and the member re-pull it set off
 *     answered with their publish (no push of his) while his push was out, so the tracker row took it
 *     for a sheet arriving and kept his landed push off the row. The push replaces the edit when it
 *     lands; if it never lands, the next read drops it (`resolvePendingGmEdit`).
 *   • their app REFUSED the edit (the receipt names it): it never reached them, so nothing is built
 *     on it.
 *   • the edit has NO PROVED BASE (seeded from a row an OLDER GM app wrote): built on, a stale copy
 *     could go out whole over a newer sheet of theirs. So the push is built on their sheet and
 *     REPLACES the edit on the server: a loss of his, never of theirs (the seam's header, rule C).
 */
export function gmPushBuiltOn(
  campaignId: string,
  charId: string,
  published: PublishedRow,
): { sheet: SavedChar | null; on: string | null } {
  const edit = pendingMap().get(pendingGmKey(campaignId, charId));
  return edit && pendingEditStandsOnFreshRead(edit, published)
    ? { sheet: edit.sheet, on: edit.pushedAt }
    : { sheet: published.sheet, on: null };
}

/** `gmPushBuiltOn(…).sheet` — the sheet alone. */
export function gmPushBase(campaignId: string, charId: string, published: PublishedRow): SavedChar | null {
  return gmPushBuiltOn(campaignId, charId, published).sheet;
}

/** The edit HELD for this character, with NO own-character filter — the same read `gmPushBuiltOn`
 *  does. For a write path; a surface that DRAWS uses `gmPendingEdit`. */
export function gmHeldEdit(campaignId: string, charId: string): PendingGmEdit | undefined {
  return pendingMap().get(pendingGmKey(campaignId, charId));
}

/**
 * The full-sheet Update's proof (./GmEditSheet.tsx): may the GM's working copy go out, and on what?
 *
 * His edits were made on `baseline` — the sheet he opened, or last pushed, or took. They may be sent
 * only on top of the newest thing the server holds for the character: his held edit while it stands
 * on this FRESH read, else the published sheet. If that is not `baseline` (by authored content), the
 * character MOVED since his copy — the player published, or his own tracker gesture replaced his held
 * edit — and sending would undo that change. Nothing is decided here about whether to; the caller asks.
 *
 * Every answer carries the fresh read's base and `on`, so a GM who knowingly overwrites still sends a
 * push the player's app can prove (and nothing else would reach them).
 */
export type GmUpdateBase =
  | { ok: true; base: { stamp: string; hash: string }; on: string | null }
  | { ok: false; reason: 'read-failed' | 'unpublished' }
  | { ok: false; reason: 'moved'; current: SavedChar; base: { stamp: string; hash: string }; on: string | null };

export function gmUpdateBase(baseline: SavedChar, row: PublishedRow | null, held: PendingGmEdit | undefined): GmUpdateBase {
  if (!row) return { ok: false, reason: 'read-failed' };
  if (!row.sheet) return { ok: false, reason: 'unpublished' };
  const base = gmBaseOf(row);
  if (!base) return { ok: false, reason: 'read-failed' }; // a row with no stamp proves nothing
  const standing = !!held && pendingEditStandsOnFreshRead(held, row);
  const current = standing ? held!.sheet : row.sheet;
  const on = standing ? held!.pushedAt : null;
  return authoredKey(current) === authoredKey(baseline) ? { ok: true, base, on } : { ok: false, reason: 'moved', current, base, on };
}

/** Tests only — the store is module state. */
export function clearGmPendingEdits(): void {
  setGmPendingAccount(null); // whose they were, too: a leg must not inherit the previous one's account
  pendingMap().clear();
  droppedPending.clear();
  droppedOwner.clear();
  refusedNotice.clear();
  supersededPending.clear();
  schemaOutdated = false;
  pendingChanged();
}
