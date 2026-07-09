// Pure merge logic for cloud sync — kept dependency-free and side-effect-free so it can be unit
// tested exhaustively. This is the one piece where a bug could actually lose a character, so it's
// deliberately conservative: it UNIONs everything and only ever drops a character when the *same*
// roster id exists on both sides (a real conflict), never when it exists on only one.
import { HOMEBREW_TYPES, TOMBSTONE_TTL_MS, type CloudBundle, type HomebrewContent, type SavedChar } from './storage';

/** Content fingerprint of a saved character — used to detect real edits (portrait, play state, etc.). */
export function charFingerprint(c: SavedChar): string {
  return JSON.stringify(c);
}

function unionRecords<T>(cloud: Record<string, T> | undefined, local: Record<string, T> | undefined): Record<string, T> {
  return { ...(cloud ?? {}), ...(local ?? {}) };
}

/** Union campaign memberships by id (local wins on conflict — e.g. a just-updated defaults answer). */
function mergeCampaigns<T extends { id: string }>(cloud: T[] | undefined, local: T[] | undefined): T[] {
  const byId = new Map<string, T>();
  for (const c of cloud ?? []) byId.set(c.id, c);
  for (const c of local ?? []) byId.set(c.id, c);
  return [...byId.values()];
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

function mergeHomebrew(cloud: HomebrewContent | undefined, local: HomebrewContent | undefined): HomebrewContent {
  const out = {} as HomebrewContent;
  for (const t of HOMEBREW_TYPES) {
    (out[t] as Record<string, unknown>) = unionRecords(cloud?.[t] as Record<string, unknown>, local?.[t] as Record<string, unknown>);
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
 * id+timestamp; homebrew content/sources and modes are a plain union (local wins key conflicts). The
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
  const { roster, charUpdated } = mergeRoster(
    local.roster ?? [],
    local.charUpdated ?? {},
    cloud.roster ?? [],
    cloud.charUpdated ?? {},
    deleted,
  );
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
  const homebrew = mergeHomebrew(cloud.homebrew, local.homebrew);
  for (const type of HOMEBREW_TYPES) {
    (homebrew[type] as Record<string, unknown>) = dropTombstoned(homebrew[type] as Record<string, unknown>, deleted, revived, `hb:${type}:`);
  }
  return {
    roster,
    charUpdated,
    deleted,
    revived,
    homebrew,
    homebrewSources: dropTombstoned(unionRecords(cloud.homebrewSources, local.homebrewSources), deleted, revived, 'hbsrc:'),
    modes: dropTombstoned(unionRecords(cloud.modes, local.modes), deleted, revived, 'mode:'),
    campaigns: mergeCampaigns(cloud.campaigns, local.campaigns).filter(
      (m) => deleted[`camp:${m.id}`] === undefined || deleted[`camp:${m.id}`] < (revived[`camp:${m.id}`] ?? 0),
    ),
    settings: cloudTs > localTs ? cloud.settings : local.settings, // ties → local
    settingsUpdated: Math.max(localTs, cloudTs),
    customization: cloudCustTs > localCustTs ? cloud.customization : local.customization, // ties → local
    customizationUpdated: Math.max(localCustTs, cloudCustTs),
    lastDevice: cloudEdited > localEdited ? cloud.lastDevice : local.lastDevice,
    lastEditedAt: Math.max(localEdited, cloudEdited) || undefined,
  };
}
