// Recover AoN markdown tables that get flattened into prose.
//
// AoN keeps tables in the `markdown` field as <table><tr><td>…, but the `text`
// field most descriptions are built from has them flattened into a single prose
// run. These helpers convert each <table> to a GitHub-flavoured pipe table and
// splice it back over the flattened run (matched on an alphanumeric-only
// normalization with an index map back to the original, so whitespace,
// punctuation, markdown escapes, and footnote asterisks never block a match).
//
// Shared by the scraper (scrape-aon.mjs) and the standalone post-processor
// (inject-tables.mjs) so both behave identically.

const stripTags   = t => t.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')
const stripLinks  = t => t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
const stripBold   = t => t.replace(/\*\*/g, '')
const stripItalic = t => t.replace(/_([^_\n]+?)_/g, '$1')
const unescapeMd  = t => t.replace(/\\([-–—_*\\|])/g, '$1')
const cleanCell   = t => unescapeMd(stripItalic(stripBold(stripLinks(stripTags(t))))).replace(/\*+/g, '').replace(/\s+/g, ' ').trim()

// Normalize to alphanumerics only, keeping a map from each kept char back to its
// original index — lets us match a table's flattened form inside a description
// regardless of whitespace/punctuation/escape differences, then splice at the
// correct ORIGINAL coordinates.
function normMap(s) {
  let norm = ''; const map = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i].toLowerCase()
    if (c >= 'a' && c <= 'z' || c >= '0' && c <= '9') { norm += c; map.push(i) }
  }
  return { norm, map }
}
function cellsFromRow(tr) {
  // Split on OPENING <td>/<th> (some AoN cells omit the closing tag), then strip
  // any stray tag fragments from each piece.
  return tr.split(/<t[dh][^>]*>/i).slice(1)
    .map(p => cleanCell(p.replace(/<\/?t[dh][^>]*>/gi, '').replace(/<\/?tr[^>]*>/gi, '')))
}
function convTable(inner) {
  const rows = []
  for (const tr of inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = cellsFromRow(tr[1])
    if (cells.some(c => c)) rows.push(cells)
  }
  if (!rows.length) return null
  const ncol = Math.max(...rows.map(r => r.length))
  if (ncol < 1) return null
  const pad = r => { const c = r.slice(); while (c.length < ncol) c.push(''); return c }
  const header = pad(rows[0])
  const body = rows.slice(1).map(pad)
  let pipe = '| ' + header.join(' | ') + ' |\n|' + header.map(() => '---').join('|') + '|'
  for (const r of body) pipe += '\n| ' + r.join(' | ') + ' |'
  const flat = rows.map(r => r.join(' ')).join(' ').replace(/\s+/g, ' ').trim()
  return { pipe, flat }
}

/** Convert every <table> in a markdown string to { pipe, flat }. */
export function extractTables(markdown) {
  if (!markdown || !/<table/i.test(markdown)) return []
  const out = []
  for (const m of markdown.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    const t = convTable(m[1]); if (t && t.flat) out.push(t)
  }
  return out
}

/** Splice recovered pipe tables into a flattened description. Returns the
 *  description unchanged when the markdown holds no tables.
 *
 *  When a table's flattened run isn't found in the description it is normally
 *  appended (so AoN reformat-aways aren't lost). Pass `{ append: false }` to
 *  suppress that — required when matching entries to raw docs BY NAME (as the
 *  post-processor does), where a name collision must not graft an unrelated
 *  table onto every same-named entry. Splices only fire on a genuine text match,
 *  so they stay safe under name collisions. */
export function injectTables(description, markdown, { append = true } = {}) {
  const tables = extractTables(markdown)
  if (!tables.length) return description
  const base = unescapeMd(description || '')
  const edits = []; const appends = []; const claimed = []
  const overlaps = (s, e) => claimed.some(([cs, ce]) => s < ce && cs < e)
  for (const t of tables) {
    const { norm: nd, map } = normMap(base)
    const nf = normMap(t.flat).norm
    let at = nf ? nd.indexOf(nf) : -1
    while (at >= 0) {
      const start = map[at], end = map[at + nf.length - 1] + 1
      if (!overlaps(start, end)) { edits.push({ start, end, pipe: t.pipe }); claimed.push([start, end]); break }
      at = nd.indexOf(nf, at + 1)
    }
    if (at < 0 && append) appends.push(t.pipe)
  }
  edits.sort((a, b) => b.start - a.start)
  let d = base
  for (const e of edits) d = d.slice(0, e.start) + '\n\n' + e.pipe + '\n\n' + d.slice(e.end)
  for (const p of appends) d = d.replace(/\s*$/, '') + '\n\n' + p
  return d
}

/** Creature tables live in lore/aside blocks that get dropped during ability
 *  parsing, so there's no flattened run to splice over. Append each recovered
 *  table to the ability that references it ("…on the table below / in the
 *  sidebar"), falling back to the last ability. Mutates `abilities`. Returns
 *  the number of tables appended. */
export function appendCreatureTables(abilities, markdown) {
  const tables = extractTables(markdown)
  if (!tables.length || !abilities) return 0
  const buckets = [abilities.top, abilities.mid, abilities.bot].filter(Array.isArray)
  const refRe = /\b(table|sidebar|summarized|as follows|listed (?:on|below|above)|following|below)\b/i
  let n = 0
  for (const t of tables) {
    // Skip a table already present (idempotent re-runs).
    if (buckets.some(arr => arr.some(ab => (ab.entries || []).some(e => typeof e === 'string' && e.includes(t.pipe))))) continue
    let target = null
    for (const arr of buckets) {
      for (const ab of arr) {
        if (refRe.test((ab.entries || []).join(' '))) { target = ab; break }
      }
      if (target) break
    }
    if (!target) {
      for (let i = buckets.length - 1; i >= 0 && !target; i--) {
        if (buckets[i].length) target = buckets[i][buckets[i].length - 1]
      }
    }
    if (!target) continue
    if (!Array.isArray(target.entries) || !target.entries.length) target.entries = [t.pipe]
    else target.entries[target.entries.length - 1] += '\n\n' + t.pipe
    n++
  }
  return n
}
