/*
 * Non-blocking update check against the app's public GitHub releases. Fired once per session
 * (memoized promise) from the UpdateNotice banner after mount; every failure path — offline,
 * rate-limited, bad JSON, weird tag — resolves to null, so boot is never affected.
 */
import { APP_VERSION } from '../version';

const REPO = 'guybirinbom-hub/character-builder-';
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;

/** 'v1.2.3' or '1.2.3' → [1, 2, 3]; null when it isn't a plain x.y.z semver. */
export function parseVersion(tag: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `remote` is a strictly newer x.y.z than `current`. Unparseable versions are never newer. */
export function isNewerVersion(remote: string, current: string): boolean {
  const r = parseVersion(remote);
  const c = parseVersion(current);
  if (!r || !c) return false;
  for (let i = 0; i < 3; i++) if (r[i] !== c[i]) return r[i] > c[i];
  return false;
}

let pending: Promise<string | null> | null = null;

async function fetchLatestTag(): Promise<string | null> {
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { tag_name?: unknown } | null;
    const tag = typeof body?.tag_name === 'string' ? body.tag_name : null;
    return tag && isNewerVersion(tag, APP_VERSION) ? tag : null;
  } catch {
    return null;
  }
}

/** Resolves the newer release's tag (e.g. "v0.1.5"), or null when up to date / anything failed.
 *  At most one network request per session — later callers share the same promise. */
export function checkForUpdate(): Promise<string | null> {
  pending ??= fetchLatestTag();
  return pending;
}
