/*
 * The one rule that decides whether a GM's unsaved work survives a player's edit.
 *
 * The GM's sheet holds a WORKING COPY. The player's published sheet arrives live underneath it. Which
 * of the two wins is the whole conflict model, so it lives here as a pure function with tests rather
 * than as a condition buried in an effect.
 */
import type { SavedChar } from '../data/storage';

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
 * Did an incoming GM edit just replace local work the player hadn't published yet?
 *
 * `lastPublished` is what this device last sent to the party. If the sheet on screen has moved on from
 * that, the GM was necessarily editing a version without those changes, and applying their edit drops
 * them. Not a reason to refuse the edit — last change wins — but it IS a reason to say so, because a
 * change disappearing with no explanation is the one thing a player can't recover from on their own.
 *
 * Nothing published yet this session? Then there is no baseline — and suppressing the banner outright
 * made the FIRST revert of every session the silent one. `incoming` (the sheet about to be applied) is
 * the fallback baseline: if it already matches what is on screen, applying it changes nothing and there
 * is nothing to report; if it differs, the player's version is being replaced and they are told. With
 * neither baseline we still say nothing, because crying wolf trains the player to ignore the banner.
 */
export function playerWorkWasOverwritten(lastPublished: string | undefined, localNow: string, incoming?: string): boolean {
  if (lastPublished !== undefined) return lastPublished !== localNow;
  return incoming !== undefined && incoming !== localNow;
}

/**
 * Which fetched GM edits are NEW to this device — strictly newer than the stamp of the last edit
 * applied for the same (campaign, character).
 *
 * The stamp exists because the cleanup DELETE on `gm_character_edits` is best-effort: on a database
 * missing the `gce_owner_delete` policy it "succeeds" while removing NOTHING, and the surviving row
 * was then re-applied on every poll tick (2.5 s) — the player's sheet rewound to the GM's stale copy
 * seconds after every local change, inventory moves included, with no error anywhere. Filtering by
 * stamp makes that loop structurally impossible: however long a row lingers, it applies exactly once.
 *
 * A missing/empty `updatedAt` on a fetched edit compares as '' and is filtered once any stamp exists
 * for its key; with no stamp it is skipped too — a row with no timestamp cannot prove it is new.
 */
export function editsToApply<E extends { campaignId: string; charId: string; updatedAt?: string }>(
  edits: E[],
  appliedStamps: Record<string, string>,
): E[] {
  return edits.filter((e) => (appliedStamps[`${e.campaignId}|${e.charId}`] ?? '') < (e.updatedAt || ''));
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
   * Undefined on an edit seeded from the server (another GM device pushed it, or this one forgot):
   * there is no base to compare against, and the fallback below is best-effort. Nothing that WRITES
   * depends on it — every push re-reads the published row itself (`fetchPublishedSheet`) — so the
   * worst a wrong answer here costs is a chip that lingers or clears early.
   */
  baseUpdatedAt?: string;
  /**
   * WHOSE character this edit is about — `campaign_characters.owner_id`.
   *
   * It travels with the edit so the "never on your own character" rule can live at the one place
   * every surface reads through (`gmPendingEdit`) instead of at each of them. A GM who plays in
   * their own campaign is both parties: an edit they push to themselves lands through the ordinary
   * player path (their own app applies it and republishes), so drawing an overlay of it on their own
   * card, pane and sheet only showed them a change with no way to tell it apart from what they had
   * published. Undefined on an edit from a row with no owner recorded — then the card's own
   * `m.ownerId !== myId` test is what covers it.
   */
  ownerId?: string;
}

/** The published row as the party layer reads it, before any overlay. */
export interface PublishedRow {
  sheet: SavedChar | null;
  /** `campaign_characters.updated_at` — the PLAYER's clock at their last publish. */
  updatedAt?: string;
}

export function pendingGmKey(campaignId: string, charId: string): string {
  return `${campaignId}|${charId}`;
}

/** The EARLIER of two published stamps, either of which may be missing. Both are
 *  `campaign_characters.updated_at` — the PLAYER's own clock — and they are ISO-8601 UTC off the
 *  same column, so comparing them as strings compares instants (the same test every other stamp
 *  comparison in this file makes). */
function olderStamp(a?: string, b?: string): string | undefined {
  if (!a || !b) return a || b;
  return a < b ? a : b;
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
 *     overlay has nothing left to add. No clock at all in that one.
 * A read that FAILED (`null`) is not an answer, so the edit stands: dropping it on a bad response
 * would flip the GM's screen back to the pre-edit character for no reason at all.
 */
export function pendingEditStillStands(edit: PendingGmEdit, published: PublishedRow | null): boolean {
  if (!published) return true;
  // No base (an edit seeded from the server, so we never saw the row it was built on): fall back to
  // our own push stamp. Cross-device, therefore best-effort — and display-only, see `baseUpdatedAt`.
  if (published.updatedAt && published.updatedAt > (edit.baseUpdatedAt ?? edit.pushedAt)) return false;
  if (published.sheet && JSON.stringify(published.sheet) === JSON.stringify(edit.sheet)) return false;
  return true;
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
 * here (pushVitals → pushGmEdit → rememberGmEdit → pendingChanged), and the write below stringifies
 * every pending edit, each of which is a whole character sheet that can carry an inline portrait.
 * Doing that on the main thread per keystroke of damage is a stall mid-combat. A burst now collapses
 * into one write; the delay costs nothing, because this copy is only ever read at startup and is
 * best-effort there too (the server read re-seeds what it misses).
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
): void {
  const key = pendingGmKey(campaignId, charId);
  const had = pendingMap().get(key);
  droppedPending.delete(key); // a fresh push is a new edit, whatever we dropped before
  /*
   * ⚠ A MISSING BASE NEVER REPLACES ONE WE ALREADY HAVE.
   *
   * Both push paths read the published row themselves and pass its stamp — but that read returns
   * `null` when it FAILS (offline, a blip), and the push still goes ahead on the newest thing this
   * device holds. Writing `undefined` over a base an earlier push had proved would downgrade a
   * protected edit to the `pushedAt` fallback, i.e. to the GM's clock against the player's: the
   * exact comparison `baseUpdatedAt` exists to remove. One blip on a damage push (which has no
   * confirm dialog to catch it) and a GM machine running fast would keep a stale overlay standing,
   * and the next push would re-base on it, straight over whatever the player published since.
   *
   * So we keep the OLDER of the two, which is the safe way in EVERY case and not just the missing
   * one: an older base can only make the overlay stand down sooner, so the player's own work is the
   * version that survives. A newer stamp arriving cannot quietly extend an overlay's life over it.
   */
  pendingMap().set(key, {
    campaignId,
    charId,
    sheet,
    pushedAt,
    baseUpdatedAt: olderStamp(baseUpdatedAt, had?.baseUpdatedAt),
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
    changed = true;
  }
  for (const r of rows) {
    if (!r?.campaignId || !r?.charId || !r?.sheet) continue;
    const key = pendingGmKey(r.campaignId, r.charId);
    // Already answered: this row is one we DROPPED because the player's own publish overtook it, and
    // it is only still on the server because the cleanup delete couldn't remove it. Re-seeding it is
    // what made the chip permanent on such a database.
    if ((droppedPending.get(key) ?? '') >= r.pushedAt) continue;
    const have = map.get(key);
    // Our own memory of the same push is the better copy — it knows the base stamp the row doesn't.
    if (have && have.pushedAt >= r.pushedAt) continue;
    map.set(key, r);
    changed = true;
  }
  if (changed) pendingChanged();
}

/**
 * The edit to SHOW for this character — the one read every GM-side surface goes through (the cards,
 * the pane card's chip, the sheet, the seam's echo test, and `resolvePendingGmEdit` below).
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
  if (had) droppedPending.set(key, had.pushedAt);
  pendingChanged();
}

/**
 * The one call the party layer makes: give it what the server answered, get back the sheet the GM
 * should see. A pending edit the published row has overtaken is dropped here — that is the single
 * place the chip goes away, so the card, the pane and the sheet all stop showing it together.
 */
export function resolvePendingGmEdit(campaignId: string, charId: string, published: PublishedRow | null): SavedChar | null {
  const edit = gmPendingEdit(campaignId, charId);
  if (edit && !pendingEditStillStands(edit, published)) {
    dropGmPendingEdit(campaignId, charId);
    return published?.sheet ?? null;
  }
  return withPendingGmEdit(published, edit);
}

/** Tests only — the store is module state. */
export function clearGmPendingEdits(): void {
  setGmPendingAccount(null); // whose they were, too: a leg must not inherit the previous one's account
  pendingMap().clear();
  droppedPending.clear();
  pendingChanged();
}
