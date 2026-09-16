// ── Persist bus ────────────────────────────────────────────────────────────
// "A store just wrote a localStorage key." That's the whole contract.
//
// The tracker stays local-first and knows nothing about accounts or the cloud: each store keeps
// writing localStorage exactly as it always did, and calls notifyPersist(key) on the same line. The
// Heroes Heaven side (src/data/trackerSync.ts) listens and mirrors the GM's keys to that GM's other
// devices. With nobody listening this is a Set iteration over zero entries — the standalone tracker
// pays nothing, and tracker/src still imports nothing from src/.
//
// The key passed is the FINAL one written (already campaign-scoped where the store scopes it), so a
// listener never has to re-derive it.

import { useCallback, useSyncExternalStore } from 'react'

const listeners = new Set<(key: string) => void>()
const versions = new Map<string, number>()

/** Announce that `key` was just written to localStorage. Call it right after the setItem. */
export function notifyPersist(key: string): void {
  versions.set(key, (versions.get(key) ?? 0) + 1)
  for (const fn of listeners) fn(key)
}

/** Listen for local writes. Returns the unsubscribe. */
export function onPersist(fn: (key: string) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

const resetListeners = new Set<() => void>()

/** "Every key is about to be replaced wholesale" — a backup restore, before it writes. A mirror
 *  listening on onPersist tracks per-key history, and that history describes data that is being
 *  thrown away; announced here, it can drop it BEFORE the restore's own notifyPersist calls arrive
 *  (which would otherwise write the stale copy straight back out). Nobody listening = a no-op. */
export function notifyReset(): void {
  for (const fn of resetListeners) fn()
}

/** Listen for that announcement. Returns the unsubscribe. */
export function onReset(fn: () => void): () => void {
  resetListeners.add(fn)
  return () => { resetListeners.delete(fn) }
}

/** Re-render when `key` is written — including by the GM-device mirror pulling the other device's
 *  copy. For the two lists that read their data through a MODULE cache rather than a store (saved
 *  encounters, custom creatures): nothing else tells them the file under them changed. */
export function usePersistVersion(key: string): number {
  const subscribe = useCallback(
    (cb: () => void) => onPersist(k => { if (k === key) cb() }),
    [key],
  )
  return useSyncExternalStore(subscribe, () => versions.get(key) ?? 0, () => 0)
}
