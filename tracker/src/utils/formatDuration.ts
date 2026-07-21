// AoN's ElasticSearch index stores spell durations as a raw number of seconds
// (e.g. `60`, `28800`). The scraper used to copy the bare `doc.duration`
// field, so existing `public/data/spells-index.json` entries are numeric.
// PF2e spell durations are read in rounds / minutes / hours / days, never in
// seconds, so we convert at display time.
//
// Accepts either a number, a numeric string, or an already-formatted phrase
// like "until the start of your next turn" — wordy strings pass through
// unchanged. That way fresh scrapes that grab `duration_raw` keep working
// without a second migration pass.

export function formatSpellDuration(d: unknown): string {
  if (d == null || d === '') return ''

  if (typeof d === 'string') {
    const trimmed = d.trim()
    if (!trimmed) return ''
    // Already a human-readable phrase — leave it alone.
    if (!/^\d+$/.test(trimmed)) return trimmed
    return formatSeconds(parseInt(trimmed, 10))
  }

  if (typeof d === 'number' && Number.isFinite(d)) return formatSeconds(d)

  // Structured duration objects ({ value|number, unit }) — the canonical
  // Foundry/PF2e shape. This app's own data stores durations as seconds/strings,
  // but an external import could supply one, and the bare String() fallback
  // would render it as the useless "[object Object]".
  if (typeof d === 'object') {
    const o = d as { value?: unknown; number?: unknown; unit?: unknown }
    const n = typeof o.value === 'number' ? o.value
      : typeof o.number === 'number' ? o.number : undefined
    if (n !== undefined && Number.isFinite(n) && typeof o.unit === 'string' && o.unit.trim()) {
      const unit = o.unit.trim()
      // Time units get a count + (de)pluralized noun; descriptive units like
      // "unlimited" / "sustained" pass through verbatim.
      if (!/^(round|minute|hour|day|turn|week|month|year)s?$/i.test(unit)) return unit
      if (n <= 0) return ''   // match the seconds path: non-positive → no duration
      const base = unit.replace(/s$/i, '')
      return n === 1 ? `${n} ${base}` : `${n} ${base}s`
    }
  }

  return String(d)
}

// PF2e: 1 round = 6 seconds. Pick the largest unit that divides evenly so
// 28800 → "8 hours" not "480 minutes". Fall back through the chain when the
// value isn't a clean multiple (e.g. 5400 → "90 minutes" since it's not whole
// hours).
function formatSeconds(secs: number): string {
  if (secs <= 0) return ''

  if (secs >= 86400 && secs % 86400 === 0) {
    const d = secs / 86400
    return d === 1 ? '1 day' : `${d} days`
  }
  if (secs >= 3600 && secs % 3600 === 0) {
    const h = secs / 3600
    return h === 1 ? '1 hour' : `${h} hours`
  }
  if (secs >= 60 && secs % 60 === 0) {
    const m = secs / 60
    return m === 1 ? '1 minute' : `${m} minutes`
  }
  if (secs % 6 === 0) {
    const r = secs / 6
    return r === 1 ? '1 round' : `${r} rounds`
  }
  // Sub-round values shouldn't happen in PF2e content, but degrade gracefully.
  return secs === 1 ? '1 second' : `${secs} seconds`
}
