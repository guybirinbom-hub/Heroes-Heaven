/**
 * Read the CSS custom properties driving the active theme straight off
 * <html>. Used to ship a snapshot of the palette into auxiliary windows
 * (image viewer, future pop-out windows) so they paint with the same
 * colours as the main app instead of staying stuck on the default Tavern.
 *
 * Returns property names WITHOUT the leading `--` so the receiving side
 * can prepend it once when calling `setProperty`.
 */
export function readThemeTokens(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const cs = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  const keys = [
    // Surfaces
    'bg-base', 'bg-panel', 'bg-elevated', 'bg-hover',
    // Borders + focus ring
    'border', 'border-strong', 'border-focus',
    // Accents
    'accent', 'accent-hover', 'accent-soft', 'accent-line',
    // Linked / danger / text family
    'linked', 'linked-soft', 'danger', 'danger-soft',
    'text', 'text-muted', 'text-faded', 'text-on-accent',
    // Header gradient (used in the image-viewer titlebar)
    'bg-header-top', 'bg-header-bottom',
    // Brand-mark gradient stops (SVG)
    'icon-bg-start', 'icon-bg-end',
    'icon-glyph-start', 'icon-glyph-end',
    'icon-arrow-start', 'icon-arrow-end',
  ]
  for (const k of keys) {
    const v = cs.getPropertyValue('--' + k).trim()
    if (v) out[k] = v
  }
  return out
}
