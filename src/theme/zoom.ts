/*
 * App zoom — scales the entire UI via CSS `zoom` on <html>, persisted across sessions.
 * `zoom` (rather than transform: scale) keeps layout reflow + 100vh + scrolling correct.
 * Driven by Ctrl+wheel / Ctrl +/-/0 (wired in App) and the Settings → Appearance controls.
 */
const STORAGE_KEY = 'pf2e-codex.zoom';
export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;

let zoom = 1;
const listeners = new Set<(z: number) => void>();

const clamp = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 10) / 10));

function apply(): void {
  document.documentElement.style.setProperty('zoom', String(zoom));
}
function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(zoom));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function getZoom(): number {
  return zoom;
}

export function setZoom(z: number): void {
  const next = clamp(z);
  if (next === zoom) return;
  zoom = next;
  apply();
  save();
  for (const l of listeners) l(zoom);
}

export function bumpZoom(delta: number): void {
  setZoom(zoom + delta);
}

export function resetZoom(): void {
  setZoom(1);
}

/** Subscribe to zoom changes (for UI that displays the current level). Returns an unsubscribe. */
export function subscribeZoom(fn: (z: number) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Load the persisted zoom and apply it. Call once before first paint. */
export function initZoom(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseFloat(raw) : 1;
    zoom = Number.isFinite(n) ? clamp(n) : 1;
  } catch {
    zoom = 1;
  }
  apply();
}
