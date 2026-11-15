// Pure merge logic for cloud sync — kept dependency-free and side-effect-free so it can be unit
// tested exhaustively. This is the one piece where a bug could actually lose a character, so it's
// deliberately conservative: it UNIONs everything and only ever drops a character when the *same*
// roster id exists on both sides (a real conflict), never when it exists on only one.
import { HOMEBREW_TYPES, TOMBSTONE_TTL_MS, type CloudBundle, type HomebrewContent, type SavedChar } from './storage';

/** Content fingerprint of a saved character — used to detect real edits (portrait, play state, etc.). */
export function charFingerprint(c: SavedChar): string {
  return JSON.stringify(c);
}

/** Each side's own "last created/updated at" stamps for keyed records (`revived`, storage.ts
 *  recordReviveKeys — written on every save of a homebrew record, source, mode or membership). */
type Stamps = { cloud: Record<string, number> | undefined; local: Record<string, number> | undefined };

/** Does the LOCAL copy of key `k` win over the cloud's? The newer stamp wins; a missing stamp counts as
 *  oldest (0); ties go to local, as for characters (mergeRoster).
 *
 *  Before 2026-11-13 local won EVERY key conflict, so a device holding an older copy of a record kept it
 *  on each pull and pushed it back up: Guy changed a custom item's description (and once its name) on
 *  one device and the other device never showed it (test/bug-item-edit-other-device.test.ts). */
function localWins(k: string, stamps: Stamps): boolean {
  return (stamps.local?.[k] ?? 0) >= (stamps.cloud?.[k] ?? 0);
}

/** Union by key; on a key both sides hold, the newer copy by its `${prefix}${id}` stamp wins. */
function unionRecords<T>(
  cloud: Record<string, T> | undefined,
  local: Record<string, T> | undefined,
  stamps: Stamps,
  prefix: string,
): Record<string, T> {
  const out: Record<string, T> = { ...(cloud ?? {}) };
  for (const [id, v] of Object.entries(local ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(out, id) || localWins(prefix + id, stamps)) out[id] = v;
  }
  return out;
}

/** Union campaign memberships by id; on an id both sides hold, the newer `camp:<id>` stamp wins (a
 *  just-updated defaults answer is stamped by saveCampaigns, so it still wins locally). */
function mergeCampaigns<T extends { id: string }>(cloud: T[] | undefined, local: T[] | undefined, stamps: Stamps, prefix: string): T[] {
  const cloudById = Object.fromEntries((cloud ?? []).map((c) => [c.id, c]));
  const localById = Object.fromEntries((local ?? []).map((c) => [c.id, c]));
  return Object.values(unionRecords(cloudById, localById, stamps, prefix));
}

/** Union two stamp maps (newest per key), pruning entries past the retention window. Used for both the
 *  deletion tombstones and the keyed-record revive stamps. */
function mergeStamps(a: Record<string, number> | undefined, b: Record<string, number> | undefined, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  const cutoff = now - TOMBSTONE_TTL_MS;
  for (const src of [a, b]) {
    if (!src) continue;
    for (const [k, t] of Object.entries(src)) {
      if (typeof t === 'number' && t >= cutoff && (out[k] === undefined || t > out[k])) out[k] = t;
    }
  }
  return out;
}

/** The roster less every campaign its GM deleted (a `campdel:<id>` mark, CampaignsPage), out of each
 *  character and build, keeping each character's own timestamp. The device that deleted it takes it off
 *  his characters at once, but another of his devices may still hold the link — a character edited there
 *  offline, or a Builder open on it — and its newer copy put a nameless "Campaign" back on every device,
 *  publishing to a campaign that no longer exists (a checker's finding, 2026-10-21). Done here, from the
 *  mark every device gets, the strip is never an edit: a real edit made elsewhere still wins. */
function withoutDeletedCampaigns(roster: SavedChar[], deleted: Record<string, number>): SavedChar[] {
  const gone = new Set(Object.keys(deleted).filter((k) => k.startsWith('campdel:')).map((k) => k.slice('campdel:'.length)));
  if (!gone.size) return roster;
  const holds = (ids: string[] | undefined) => !!ids?.some((id) => gone.has(id));
  const keep = (ids: string[] | undefined) => ids?.filter((id) => !gone.has(id));
  let changed = false;
  const out = roster.map((c) => {
    const inChar = holds(c.character?.campaignIds);
    const inBuild = holds(c.build?.campaignIds);
    if (!inChar && !inBuild) return c;
    changed = true;
    return {
      ...c,
      character: inChar ? { ...c.character, campaignIds: keep(c.character.campaignIds) } : c.character,
      build: inBuild && c.build ? { ...c.build, campaignIds: keep(c.build.campaignIds) } : c.build,
    };
  });
  return changed ? out : roster;
}

/** Drop keyed records (homebrew/sources/modes/campaigns) killed by a tombstone. Keyed records have no
 *  timestamp of their own, so we compare the tombstone against the record's REVIVE stamp: a re-create
 *  (revived after the delete) survives even when another device still carries the stale tombstone. */
function dropTombstoned<T>(
  rec: Record<string, T>,
  deleted: Record<string, number>,
  revived: Record<string, number>,
  prefix: string,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, v] of Object.entries(rec)) {
    const del = deleted[prefix + id];
    if (del === undefined || del < (revived[prefix + id] ?? 0)) out[id] = v;
  }
  return out;
}

/** Each homebrew type: union by the newer stamp, then drop what a tombstone killed (one `hb:<type>:` key). */
function mergeHomebrew(
  cloud: HomebrewContent | undefined,
  local: HomebrewContent | undefined,
  stamps: Stamps,
  deleted: Record<string, number>,
  revived: Record<string, number>,
): HomebrewContent {
  const out = {} as HomebrewContent;
  for (const t of HOMEBREW_TYPES) {
    const prefix = `hb:${t}:`;
    const union = unionRecords(cloud?.[t] as Record<string, unknown>, local?.[t] as Record<string, unknown>, stamps, prefix);
    (out[t] as Record<string, unknown>) = dropTombstoned(union, deleted, revived, prefix);
  }
  return out;
}

/**
 * Merge two rosters by roster id. A character present on only one side is always kept. When the same
 * id is on both sides, the side with the newer timestamp wins (ties → local, so a device never loses
 * its own in-progress edits to the cloud's equal-age copy). Returns the merged roster plus the merged
 * per-id timestamp map (max of the two).
 */
export function mergeRoster(
  local: SavedChar[],
  localTs: Record<string, number>,
  cloud: SavedChar[],
  cloudTs: Record<string, number>,
  deleted: Record<string, number> = {},
): { roster: SavedChar[]; charUpdated: Record<string, number> } {
  const byId = new Map<string, SavedChar>();
  const ts: Record<string, number> = {};

  for (const c of cloud) {
    byId.set(c.id, c);
    ts[c.id] = cloudTs[c.id] ?? 0;
  }
  for (const c of local) {
    const lt = localTs[c.id] ?? 0;
    const existing = byId.get(c.id);
    if (!existing) {
      byId.set(c.id, c);
      ts[c.id] = lt;
      continue;
    }
    const ct = ts[c.id] ?? 0;
    if (lt >= ct) byId.set(c.id, c); // local wins ties → don't clobber in-progress local edits
    ts[c.id] = Math.max(lt, ct);
  }

  // Honor deletion tombstones: drop a character whose deletion is at least as new as its surviving
  // timestamp. A character edited/re-created AFTER it was deleted (newer ts) survives — last write wins.
  for (const id of [...byId.keys()]) {
    const del = deleted['char:' + id];
    if (del !== undefined && del >= (ts[id] ?? 0)) {
      byId.delete(id);
      delete ts[id];
    }
  }

  return { roster: [...byId.values()], charUpdated: ts };
}

/**
 * Merge a local bundle with the cloud's (or null when the cloud has nothing yet). Characters merge by
 * id+timestamp; homebrew content/sources, modes and campaign memberships are a union where, on a key both
 * sides hold, the copy with the newer `revived` stamp wins (ties → local). The
 * result is a superset — nothing that exists on either side is dropped except a genuinely-older
 * same-id character.
 */
export function mergeBundles(local: CloudBundle, cloud: CloudBundle | null, now: number = Date.now()): CloudBundle {
  if (!cloud) return local;
  // Merge (and prune) deletion tombstones + keyed-record revive stamps first; every union below then
  // drops records a tombstone kills (unless revived after it), so a delete on one device propagates
  // instead of being resurrected from the other's copy — and a re-create beats a stale tombstone.
  const deleted = mergeStamps(cloud.deleted, local.deleted, now);
  const revived = mergeStamps(cloud.revived, local.revived, now);
  const merged = mergeRoster(local.roster ?? [], local.charUpdated ?? {}, cloud.roster ?? [], cloud.charUpdated ?? {}, deleted);
  const roster = withoutDeletedCampaigns(merged.roster, deleted);
  const charUpdated = merged.charUpdated;
  // Settings (prefs/appearance) aren't union-able — take whichever side changed them more recently.
  const localTs = local.settingsUpdated ?? 0;
  const cloudTs = cloud.settingsUpdated ?? 0;
  // Sheet-customization default is merged INDEPENDENTLY (its own timestamp), so a customization edit on one
  // device isn't discarded by a more-recent theme/prefs edit on another.
  const localCustTs = local.customizationUpdated ?? 0;
  const cloudCustTs = cloud.customizationUpdated ?? 0;
  // "Last synced from …" metadata: keep whichever side wrote the cloud more recently.
  const localEdited = local.lastEditedAt ?? 0;
  const cloudEdited = cloud.lastEditedAt ?? 0;
  // Each side's OWN stamps decide a key both hold (the merged `revived` above is the max of the two, so it
  // cannot say which side is newer). Both pruned by the same retention, so a months-old stamp on one side
  // never beats a rival the other side already pruned.
  const stamps: Stamps = { cloud: mergeStamps(cloud.revived, undefined, now), local: mergeStamps(local.revived, undefined, now) };
  const homebrew = mergeHomebrew(cloud.homebrew, local.homebrew, stamps, deleted, revived);
  // A PLAYER membership a character of the merged roster is still in outlives its tombstone. A removal
  // (App's launch cleanup of a campaign no character was in, or the Leave of a last character) is judged
  // on one device's roster; a character another device put in that campaign and had not pushed yet was
  // unknown there, and the tombstone took the membership from under it — the card showed "Campaign" and
  // the GM's shared homebrew stopped (a checker's finding, 2026-10-21). A GM's never. A campaign its GM
  // deleted (`campdel:<id>`, CampaignsPage) stays deleted before every rule: also where an older install
  // stored the GM's own campaign as 'player', and also against a revive stamp a later join wrote offline or
  // an older app version wrote on every save.
  const heldCampaigns = new Set(roster.flatMap((c) => [...(c.character?.campaignIds ?? []), ...(c.build?.campaignIds ?? [])]));
  return {
    roster,
    charUpdated,
    deleted,
    revived,
    homebrew,
    homebrewSources: dropTombstoned(unionRecords(cloud.homebrewSources, local.homebrewSources, stamps, 'hbsrc:'), deleted, revived, 'hbsrc:'),
    modes: dropTombstoned(unionRecords(cloud.modes, local.modes, stamps, 'mode:'), deleted, revived, 'mode:'),
    campaigns: mergeCampaigns(cloud.campaigns, local.campaigns, stamps, 'camp:').filter(
      (m) =>
        deleted[`campdel:${m.id}`] === undefined &&
        (deleted[`camp:${m.id}`] === undefined ||
          deleted[`camp:${m.id}`] < (revived[`camp:${m.id}`] ?? 0) ||
          (m.role === 'player' && heldCampaigns.has(m.id))),
    ),
    settings: cloudTs > localTs ? cloud.settings : local.settings, // ties → local
    settingsUpdated: Math.max(localTs, cloudTs),
    customization: cloudCustTs > localCustTs ? cloud.customization : local.customization, // ties → local
    customizationUpdated: Math.max(localCustTs, cloudCustTs),
    lastDevice: cloudEdited > localEdited ? cloud.lastDevice : local.lastDevice,
    lastEditedAt: Math.max(localEdited, cloudEdited) || undefined,
  };
}
