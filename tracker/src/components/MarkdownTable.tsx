import { Fragment, type ReactNode } from 'react'

// Renders GitHub-flavoured pipe tables embedded in description text. The data
// pipeline (scripts/inject-tables.mjs) recovers AoN's flattened tables as pipe
// tables; here we split them back out of the prose and render real <table>s.
// Cell text is handed back to the caller's inline renderer so trait/condition
// links and dice rollers keep working inside cells.

export interface TableBlock { type: 'table'; header: string[]; rows: string[][] }
export interface TextBlock  { type: 'text';  text: string }
export type Block = TableBlock | TextBlock

const ROW_RE = /^\s*\|(.+)\|\s*$/

function parseRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())
}
function isSeparator(line: string): boolean {
  if (!ROW_RE.test(line)) return false
  const cells = parseRow(line)
  return cells.length > 0 && cells.every(c => /^:?-{2,}:?$/.test(c.replace(/\s/g, '')))
}

/** True if the text contains at least one table — an HTML <table> (as AoN
 *  sometimes stores them) or a GitHub pipe table (a row followed by a
 *  |---|---| separator). Cheap guard so the common no-table path is untouched. */
export function hasTables(text: string): boolean {
  if (!text) return false
  if (/<table\b/i.test(text)) return true
  if (text.indexOf('|') < 0) return false
  const lines = text.split('\n')
  for (let i = 0; i < lines.length - 1; i++) {
    if (ROW_RE.test(lines[i]) && isSeparator(lines[i + 1])) return true
  }
  return false
}

// Strip inner HTML tags from a cell, keeping the text (and any {@…} rich tags)
// for the caller's inline renderer. <br> becomes a space.
function stripCellHtml(s: string): string {
  return s.replace(/<br\s*\/?>/gi, ' ').replace(/<\/?[a-zA-Z][^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

/** Parse an HTML <table>…</table> string into a TableBlock (first <tr> is the
 *  header; cells from <td>/<th>). Returns null if no rows were found. */
function parseHtmlTable(html: string): TableBlock | null {
  const rows: string[][] = []
  for (const tr of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells: string[] = []
    for (const cell of tr[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)) {
      cells.push(stripCellHtml(cell[1]))
    }
    if (cells.length) rows.push(cells)
  }
  if (!rows.length) return null
  return { type: 'table', header: rows[0], rows: rows.slice(1) }
}

const HTML_TABLE_RE = /<table\b[^>]*>[\s\S]*?<\/table>/gi

/** Line-based GitHub pipe-table splitter (the original behaviour). */
function splitPipeTables(text: string): Block[] {
  const lines = text.split('\n')
  const out: Block[] = []
  let buf: string[] = []
  const flush = () => { if (buf.length) { out.push({ type: 'text', text: buf.join('\n') }); buf = [] } }
  for (let i = 0; i < lines.length; i++) {
    if (ROW_RE.test(lines[i]) && i + 1 < lines.length && isSeparator(lines[i + 1])) {
      flush()
      const header = parseRow(lines[i])
      const rows: string[][] = []
      i += 2 // skip header + separator
      while (i < lines.length && ROW_RE.test(lines[i]) && !isSeparator(lines[i])) {
        rows.push(parseRow(lines[i])); i++
      }
      i-- // the for-loop will re-increment
      out.push({ type: 'table', header, rows })
    } else {
      buf.push(lines[i])
    }
  }
  flush()
  return out
}

/** Split text into alternating prose and table blocks. Handles BOTH inline
 *  HTML <table>s and GitHub pipe tables; prose between/around tables is further
 *  split for pipe tables and otherwise passed through untouched. */
export function splitOnTables(text: string): Block[] {
  const out: Block[] = []
  let last = 0
  HTML_TABLE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HTML_TABLE_RE.exec(text)) !== null) {
    const before = text.slice(last, m.index)
    if (before) out.push(...splitPipeTables(before))
    const tbl = parseHtmlTable(m[0])
    out.push(tbl ?? { type: 'text', text: m[0] })
    last = HTML_TABLE_RE.lastIndex
  }
  if (last < text.length) out.push(...splitPipeTables(text.slice(last)))
  return out
}

const cellPad: React.CSSProperties = {
  border: 'var(--app-bw) solid var(--border)',
  padding: '3px 8px',
  textAlign: 'left',
  verticalAlign: 'top',
}

// A "header" whose first cell is a die roll / range (e.g. "1", "1–45",
// "4 or below") isn't really a header — it's the first row of a headerless
// roll table that GFM forced a header onto. Render those with no header row.
function looksLikeRollRow(cells: string[]): boolean {
  const c0 = (cells[0] ?? '').trim()
  return /^\d+\s*[–—-]\s*\d+$/.test(c0)            // "46–56"
      || /^\d+$/.test(c0)                            // "1"
      || /^\d+\s*(or\s+(less|fewer|below|lower|higher|more|greater))$/i.test(c0) // "4 or below"
}

export function MarkdownTable({ header, rows, renderCell }: {
  header: string[]
  rows: string[][]
  renderCell: (text: string) => ReactNode
}) {
  const headerless = looksLikeRollRow(header)
  // When headerless, fold the promoted "header" back in as the first body row.
  const bodyRows = headerless ? [header, ...rows] : rows
  const ncol = Math.max(header.length, ...rows.map(r => r.length), 1)
  const idx = Array.from({ length: ncol }, (_, c) => c)
  return (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table style={{
        borderCollapse: 'collapse',
        width: '100%',
        fontSize: '0.92em',
        lineHeight: 1.4,
      }}>
        {!headerless && (
          <thead>
            <tr>
              {idx.map(c => (
                <th key={c} style={{ ...cellPad, background: 'var(--bg-subtle, var(--bg-elevated))', fontWeight: 600 }}>
                  {renderCell(header[c] ?? '')}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {bodyRows.map((r, ri) => (
            <tr key={ri} style={ri % 2 ? { background: 'color-mix(in srgb, var(--text) 4%, transparent)' } : undefined}>
              {idx.map(c => <td key={c} style={cellPad}>{renderCell(r[c] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Inline HTML tags AoN occasionally leaves in description prose (everything
// except table tags, which splitOnTables handles). Only a known tag whitelist
// is stripped so real "<5 ft" / "<level>" style text is never mangled.
const PROSE_HTML_RE = /<\/?(?:b|i|strong|em|u|span|p|div|sup|sub|small|code|pre|a|h[1-6]|hr)\b[^>]*>/gi

/** Normalize HTML that leaks into description prose: turn <ul>/<ol>/<li> into
 *  bullet lines and <br> into newlines, and drop stray inline tags. Leaves
 *  <table>…</table> intact for splitOnTables. No-op when there's no '<'. */
export function normalizeProseHtml(text: string): string {
  if (!text || text.indexOf('<') < 0) return text
  return text
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<\/?(?:ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // AoN action-cost tag: <actions string="2" /> → action glyphs; empty/other → drop.
    .replace(/<actions\b[^>]*\bstring="([1-3])"[^>]*>/gi, (_m, n) => ' ' + '◆◆◆'.slice(0, parseInt(n, 10)) + ' ')
    .replace(/<actions\b[^>]*>/gi, '')
    .replace(PROSE_HTML_RE, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}

/** Wrap any description renderer with table awareness. `renderText` draws a
 *  table-free run of prose however the caller already does (line splitting,
 *  Success/Failure headings, …); `renderCell` draws inline rich text for a
 *  single table cell. The common no-table path delegates straight to
 *  `renderText` so existing rendering is untouched. */
export function TableAwareText({ text, renderText, renderCell }: {
  text: string
  renderText: (t: string) => ReactNode
  renderCell: (t: string) => ReactNode
}) {
  if (!text) return null
  const norm = normalizeProseHtml(text)
  if (!hasTables(norm)) return <>{renderText(norm)}</>
  return (
    <>
      {splitOnTables(norm).map((b, i) => b.type === 'table'
        ? <MarkdownTable key={i} header={b.header} rows={b.rows} renderCell={renderCell} />
        : <Fragment key={i}>{renderText(b.text)}</Fragment>)}
    </>
  )
}
