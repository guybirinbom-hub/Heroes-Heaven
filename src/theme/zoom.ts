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

// On phones, cap zoom at 1.0 — zooming IN past 100% makes content exceed the viewport (the bottom nav
// scrolls off-screen); zoom-OUT (down to ZOOM_MIN) is the useful direction on a small screen.
const clamp = (z: number) => {
  const mobile = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(max-width: 720px)').matches;
  const max = mobile ? 1 : ZOOM_MAX;
  // Finer 0.05 snapping on phones so zoom-out is gradual (small eases) rather than big 10% jumps.
  const snap = mobile ? 20 : 10;
  return Math.min(max, Math.max(ZOOM_MIN, Math.round(z * snap) / snap));
};

function apply(): void {
  // Expose the factor as --zoom and set the `zoom` property. The mobile shell + full-screen modals use
  // position:fixed (not 100dvh), so they fill the viewport at any zoom; mobile zoom is clamped to ≤1 (see clamp).
  document.documentElement.style.setProperty('--zoom', String(zoom));
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

/** Overlay a specific zoom (a character's per-sheet override) WITHOUT changing the persisted device zoom.
 *  Revert with applyGlobalZoom(). */
export function applyZoomOverlay(z: number): void {
  const v = clamp(z);
  document.documentElement.style.setProperty('--zoom', String(v));
  document.documentElement.style.setProperty('zoom', String(v));
}

/** Re-apply the persisted device zoom (used to revert a per-character overlay). */
export function applyGlobalZoom(): void {
  apply();
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
