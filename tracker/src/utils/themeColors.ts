// ── Custom-theme colour engine ─────────────────────────────────────────────
// Built-in themes live as `[data-theme="…"]` CSS-variable blocks in index.css.
// A custom theme is a handful of base colours the user picks; from those we
// DERIVE the full set of `--…` tokens and apply them inline on <html>, layered
// over a base theme (so non-colour tokens — fonts, radii, shadows, icon
// gradients — still come from that base).

export interface ThemeColors {
  accent: string; linked: string; danger: string; bg: string; text: string; hp: string
}

/** The colours exposed in the editor, in display order. */
export const COLOR_FIELDS: { key: keyof ThemeColors; label: string; hint: string }[] = [
  { key: 'accent', label: 'Accent',     hint: 'Primary highlight — buttons, section headers, the active-turn pill' },
  { key: 'linked', label: 'Links',      hint: 'Hover/click links and secondary highlights' },
  { key: 'bg',     label: 'Background',  hint: 'The main app background; panels/surfaces are derived from it' },
  { key: 'text',   label: 'Text',        hint: 'Main body text colour' },
  { key: 'danger', label: 'Danger',      hint: 'Delete / remove buttons and the low-HP bar' },
  { key: 'hp',     label: 'Healthy HP',  hint: 'Full HP bar colour' },
]

const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)))
const hex2 = (n: number) => clampByte(n).toString(16).padStart(2, '0')

export function toRgb(str: string): [number, number, number] {
  const s = (str || '').trim()
  let m = s.match(/^#([0-9a-f]{3})$/i)
  if (m) { const h = m[1]; return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)] }
  m = s.match(/^#([0-9a-f]{6})$/i)
  if (m) { const h = m[1]; return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)] }
  m = s.match(/rgba?\(([^)]+)\)/i)
  if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return [p[0] || 0, p[1] || 0, p[2] || 0] }
  return [136, 136, 136]
}

export function toHex(str: string): string {
  if (/^#[0-9a-f]{6}$/i.test((str || '').trim())) return str.trim().toLowerCase()
  const [r, g, b] = toRgb(str)
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

const rgba = (hex: string, a: number) => { const [r, g, b] = toRgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})` }

/** Linear blend of two colours (t=0 → a, t=1 → b) as #rrggbb. */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = toRgb(a), [r2, g2, b2] = toRgb(b)
  return `#${hex2(r1 + (r2 - r1) * t)}${hex2(g1 + (g2 - g1) * t)}${hex2(b1 + (b2 - b1) * t)}`
}

export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Every token applyTheme may set inline — cleared when switching themes so a
 *  custom override never bleeds into the next theme. */
export const CUSTOM_VAR_KEYS = [
  '--bg-base', '--bg-panel', '--bg-elevated', '--bg-hover', '--bg-header-top', '--bg-header-bottom',
  '--border', '--border-strong', '--border-focus',
  '--accent', '--accent-hover', '--accent-soft', '--accent-line',
  '--linked', '--linked-soft', '--danger', '--danger-soft',
  '--hp-full', '--hp-mid', '--hp-low',
  '--text', '--text-muted', '--text-faded', '--text-on-accent',
  // Brand-mark / taskbar icon gradient (so a custom theme recolours the logo too).
  '--icon-bg-start', '--icon-bg-end', '--icon-glyph-start', '--icon-glyph-end',
  '--icon-arrow-start', '--icon-arrow-end', '--icon-frame',
]

/** Expand the 6 chosen colours into the full token set. Surfaces/muted text are
 *  blended toward the text/background so light AND dark backgrounds both work. */
export function deriveThemeVars(c: ThemeColors): Record<string, string> {
  const dark = luminance(c.bg) < 0.4
  return {
    '--bg-base': toHex(c.bg),
    '--bg-panel': mix(c.bg, c.text, 0.05),
    '--bg-elevated': mix(c.bg, c.text, 0.10),
    '--bg-hover': mix(c.bg, c.text, 0.15),
    '--bg-header-top': mix(c.bg, c.text, 0.06),
    '--bg-header-bottom': mix(c.bg, c.text, 0.02),
    '--border': rgba(c.accent, 0.10),
    '--border-strong': rgba(c.accent, 0.22),
    '--border-focus': rgba(c.accent, 0.48),
    '--accent': toHex(c.accent),
    '--accent-hover': mix(c.accent, dark ? '#ffffff' : '#000000', 0.15),
    '--accent-soft': rgba(c.accent, 0.14),
    '--accent-line': rgba(c.accent, 0.35),
    '--linked': toHex(c.linked),
    '--linked-soft': rgba(c.linked, 0.14),
    '--danger': toHex(c.danger),
    '--danger-soft': rgba(c.danger, 0.14),
    '--hp-full': toHex(c.hp),
    '--hp-mid': toHex(c.accent),
    '--hp-low': toHex(c.danger),
    '--text': toHex(c.text),
    '--text-muted': mix(c.text, c.bg, 0.42),
    '--text-faded': mix(c.text, c.bg, 0.60),
    '--text-on-accent': luminance(c.accent) > 0.55 ? '#1a1011' : '#ffffff',
    // Brand-mark icon: a deep, dark accent-hued square (kept dark even for light
    // themes, with a hint of the page bg) so the bright accent glyph + sweep
    // always read. All derived from the accent, so the logo follows the palette.
    '--icon-bg-start': mix(mix(c.accent, '#000000', 0.80), c.bg, 0.15),
    '--icon-bg-end': mix(mix(c.accent, '#000000', 0.80), '#000000', 0.30),
    '--icon-glyph-start': mix(c.accent, '#ffffff', 0.30),
    '--icon-glyph-end': mix(c.accent, '#000000', 0.18),
    '--icon-arrow-start': mix(c.accent, '#ffffff', 0.10),
    '--icon-arrow-end': mix(c.accent, '#000000', 0.40),
    '--icon-frame': rgba(c.accent, 0.18),
  }
}

/** Read a built-in theme's key colours (to seed the editor when "starting from"
 *  that theme). Briefly toggles <html data-theme> to read its computed values,
 *  then restores — synchronous, so no paint happens in between. */
export function readThemeSeed(baseId: string): ThemeColors {
  if (typeof document === 'undefined') return { accent: '#d4a14a', linked: '#82a89a', danger: '#c66a5a', bg: '#161011', text: '#f0e6d6', hp: '#8fb56a' }
  const el = document.documentElement
  const prevAttr = el.getAttribute('data-theme')
  const prevInline = CUSTOM_VAR_KEYS.map(k => [k, el.style.getPropertyValue(k)] as const)
  for (const k of CUSTOM_VAR_KEYS) el.style.removeProperty(k)
  if (baseId === 'tavern') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', baseId)
  const cs = getComputedStyle(el)
  const g = (v: string) => toHex(cs.getPropertyValue(v).trim() || '#888888')
  const seed: ThemeColors = { accent: g('--accent'), linked: g('--linked'), danger: g('--danger'), bg: g('--bg-base'), text: g('--text'), hp: g('--hp-full') }
  // Restore whatever was applied before.
  if (prevAttr) el.setAttribute('data-theme', prevAttr); else el.removeAttribute('data-theme')
  for (const [k, v] of prevInline) if (v) el.style.setProperty(k, v)
  return seed
}
