// Pure merge logic for cloud sync — kept dependency-free and side-effect-free so it can be unit
// tested exhaustively. This is the one piece where a bug could actually lose a character, so it's
// deliberately conservative: it UNIONs everything and only ever drops a character when the *same*
// roster id exists on both sides (a real conflict), never when it exists on only one.
import { HOMEBREW_TYPES, type CloudBundle, type HomebrewContent, type SavedChar } from './storage';

/** Content fingerprint of a saved character — used to detect real edits (portrait, play state, etc.). */
export function charFingerprint(c: SavedChar): string {
  return JSON.stringify(c);
}

function unionRecords<T>(cloud: Record<string, T> | undefined, local: Record<string, T> | undefined): Record<string, T> {
  return { ...(cloud ?? {}), ...(local ?? {}) };
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

  return { roster: [...byId.values()], charUpdated: ts };
}

/**
 * Merge a local bundle with the cloud's (or null when the cloud has nothing yet). Characters merge by
 * id+timestamp; homebrew content/sources and modes are a plain union (local wins key conflicts). The
 * result is a superset — nothing that exists on either side is dropped except a genuinely-older
 * same-id character.
 */
export function mergeBundles(local: CloudBundle, cloud: CloudBundle | null): CloudBundle {
  if (!cloud) return local;
  const { roster, charUpdated } = mergeRoster(local.roster ?? [], local.charUpdated ?? {}, cloud.roster ?? [], cloud.charUpdated ?? {});
  // Settings (prefs/appearance) aren't union-able — take whichever side changed them more recently.
  const localTs = local.settingsUpdated ?? 0;
  const cloudTs = cloud.settingsUpdated ?? 0;
  return {
    roster,
    charUpdated,
    homebrew: mergeHomebrew(cloud.homebrew, local.homebrew),
    homebrewSources: unionRecords(cloud.homebrewSources, local.homebrewSources),
    modes: unionRecords(cloud.modes, local.modes),
    settings: cloudTs > localTs ? cloud.settings : local.settings, // ties → local
    settingsUpdated: Math.max(localTs, cloudTs),
  };
}
