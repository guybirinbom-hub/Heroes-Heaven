/**
 * Theme-aware brand-mark icon generator.
 *
 * The Initiative Cycle brand mark is normally rendered as inline SVG with
 * CSS variables for every gradient stop, so it recolours automatically as
 * the user picks a different theme. The window/taskbar icon — which lives
 * outside the React tree on Electron's main-process `BrowserWindow` — can't
 * read CSS variables; it needs a real raster PNG.
 *
 * `updateTaskbarIcon()` rasterises the brand-mark SVG at 256×256 using the
 * theme's currently-resolved CSS-variable values, then ships the PNG
 * buffer to the main process via the preload bridge, where it gets
 * `win.setIcon()`-ed onto every open window.
 *
 * No-op in a regular browser (no `window.electronAPI` available); only
 * runs inside the Electron renderer.
 */

const ICON_SIZE = 256

/** Resolve a CSS custom property against `<html>` to its concrete value. */
function readVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Build the icon's SVG source using *resolved* hex values rather than
 *  `var(--…)` references — the rasteriser pipeline (Blob → Image) loads
 *  the SVG in isolation and can't access the document's CSS vars. */
function buildSvg(): string {
  const bgStart    = readVar('--icon-bg-start')    || '#2a1c1e'
  const bgEnd      = readVar('--icon-bg-end')      || '#150d0e'
  const glyphStart = readVar('--icon-glyph-start') || '#eec27a'
  const glyphEnd   = readVar('--icon-glyph-end')   || '#a87825'
  const arrowStart = readVar('--icon-arrow-start') || '#d4a14a'
  const arrowEnd   = readVar('--icon-arrow-end')   || '#8a6324'
  const frame      = readVar('--icon-frame')       || 'rgba(212,161,74,0.12)'

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${ICON_SIZE}" height="${ICON_SIZE}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${bgStart}"/>
        <stop offset="1" stop-color="${bgEnd}"/>
      </linearGradient>
      <linearGradient id="glyph" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${glyphStart}"/>
        <stop offset="1" stop-color="${glyphEnd}"/>
      </linearGradient>
      <linearGradient id="soft" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${arrowStart}"/>
        <stop offset="1" stop-color="${arrowEnd}"/>
      </linearGradient>
    </defs>
    <rect width="128" height="128" rx="28" fill="url(#bg)"/>
    <rect x="0.5" y="0.5" width="127" height="127" rx="27.5" fill="none" stroke="${frame}"/>
    <path d="M 64 22 A 42 42 0 1 1 22 64" fill="none" stroke="url(#soft)" stroke-width="6" stroke-linecap="round"/>
    <path d="M 22 64 L 12 56 M 22 64 L 12 72" fill="none" stroke="url(#soft)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M64 42 L86 64 L64 86 L42 64 Z" fill="url(#glyph)"/>
  </svg>`
}

/** Rasterise an SVG string to a PNG `ArrayBuffer` via an offscreen canvas. */
async function svgToPng(svg: string): Promise<ArrayBuffer | null> {
  const blob = new Blob([svg], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.width = ICON_SIZE
    img.height = ICON_SIZE
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('svg image load failed'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = ICON_SIZE
    canvas.height = ICON_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, ICON_SIZE, ICON_SIZE)
    // toBlob → arrayBuffer is the cleanest path; falls back gracefully if a
    // browser lacks toBlob (Electron Chromium always has it).
    const pngBlob: Blob | null = await new Promise(res => canvas.toBlob(b => res(b), 'image/png'))
    if (!pngBlob) return null
    return await pngBlob.arrayBuffer()
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Render the brand-mark icon from the active theme's CSS variables and
 *  push it to the main process so the taskbar / alt-tab thumbnail / window
 *  icon all recolour. Safe to call from any environment — silently no-ops
 *  if not running inside the Electron renderer. */
export async function updateTaskbarIcon(): Promise<void> {
  if (typeof window === 'undefined') return
  if (!window.electronAPI?.setAppIcon) return
  try {
    const buf = await svgToPng(buildSvg())
    if (!buf) return
    window.electronAPI.setAppIcon(new Uint8Array(buf))
  } catch (e) {
    // Non-fatal — the build-time-embedded icon stays as the fallback.
    console.warn('updateTaskbarIcon failed:', e)
  }
}
