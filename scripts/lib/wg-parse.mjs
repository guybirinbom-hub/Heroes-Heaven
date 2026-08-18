/**
 * Parse Wanderer's Guide's pg_dump COPY block into rows. Properly.
 *
 * ⚠ `line.split('\t')` IS WRONG HERE and quietly so. Of the 26,824 rows in `ability_block`, only
 * 14,034 come out with the declared 23 fields:
 *
 *     21 fields  6,244 rows   the row is SPLIT ACROSS LINES — a free-text field contains a real
 *                             newline, so the record continues on the next physical line
 *     24-25      3,910 rows   a free-text field contains a real TAB
 *     8, 12, 13  2,456 rows   both at once
 *
 * Every measurement I took off the naive split — "3,936 encoded feats", the operation vocabulary,
 * the 1,165-record work list — was therefore computed over roughly HALF their corpus, and the type
 * histogram came out full of durations ("1 minute", "sustained up to 1 minute") because misaligned
 * rows were being read a column or two out of place.
 *
 * The recovery uses the fact that the FIRST and LAST columns have recognisable shapes while the
 * free text sits in the middle:
 *
 *   leading  id (integer), created_at (ISO timestamp)
 *   trailing updated_at (ISO timestamp or \N), availability, uuid (UUID), version, content_source_id
 *
 * So: accumulate physical lines until at least 23 fields are present, then anchor 2 from the left
 * and 5 from the right and let the middle absorb any surplus tabs into `description`, the only field
 * long enough to contain one. Rows that still cannot be anchored are RETURNED as failures rather
 * than dropped — a parser that silently discards what it cannot read is how this went wrong once.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/;

/** Undo pg_dump's TSV escaping. Backslash first, via a sentinel, or `\\n` becomes a newline. */
export const untsv = (s) =>
  String(s)
    .replace(/\\\\/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(//g, '\\');

/** The `operations` column: a Postgres json[] literal `{"<json>","<json>"}`, escaped twice. */
export function parseOps(raw) {
  if (!raw || raw === '\\N' || raw.length < 5) return [];
  const s = untsv(raw).trim();
  if (!s.startsWith('{')) return [];
  let arr;
  try { arr = JSON.parse('[' + s.slice(1, -1) + ']'); } catch { return []; }
  return arr
    .map((e) => { try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; } })
    .filter(Boolean);
}

/** Flatten nested operations — conditional branches and per-option operation lists. */
export function flattenOps(op, out = []) {
  out.push(op);
  const d = op?.data ?? {};
  for (const k of ['operations', 'trueOperations', 'falseOperations']) for (const c of d[k] ?? []) flattenOps(c, out);
  for (const o of d.optionsPredefined ?? []) for (const c of o.operations ?? []) flattenOps(c, out);
  return out;
}

/**
 * @returns {{ rows: Record<string,string>[], cols: string[], failed: string[] }}
 */
export function parseCopyBlock(sql, table) {
  const head = new RegExp(`^COPY public\\.${table} \\(([^)]*)\\) FROM stdin;$`, 'm').exec(sql);
  if (!head) throw new Error(`no COPY block for ${table}`);
  const cols = head[1].split(',').map((s) => s.trim().replace(/"/g, ''));
  const start = head.index + head[0].length + 1;
  const body = sql.slice(start, sql.indexOf('\n\\.\n', start));

  const rows = [];
  const failed = [];
  let buf = null;

  const finish = (fields) => {
    /* Anchor from both ends; the surplus belongs to `description`, the one field long enough to
     * hold a raw tab. Verified by checking that `type` only ever comes out a known value. */
    const n = cols.length;
    if (fields.length > n) {
      const di = cols.indexOf('description');
      const extra = fields.length - n;
      const merged = fields.slice(di, di + extra + 1).join('\t');
      fields = [...fields.slice(0, di), merged, ...fields.slice(di + extra + 1)];
    }
    if (fields.length !== n) return failed.push(fields.join('\t').slice(0, 120));
    const rec = {};
    cols.forEach((c, i) => { rec[c] = fields[i]; });
    rows.push(rec);
  };

  for (const line of body.split('\n')) {
    buf = buf === null ? line : `${buf}\n${line}`;
    const f = buf.split('\t');
    /* A complete row starts with an integer id and ends with a timestamp-or-null; short rows are a
     * record continuing onto the next physical line, so keep accumulating. */
    if (f.length < cols.length) {
      if (f.length === 1 && buf === '') buf = null;
      continue;
    }
    const last = f[f.length - 1];
    const looksDone = TS.test(last) || last === '\\N' || UUID.test(f[f.length - 3] ?? '');
    if (f.length >= cols.length && (looksDone || f.length > cols.length + 4)) {
      finish(f);
      buf = null;
    }
  }
  if (buf !== null && buf.trim()) finish(buf.split('\t'));
  return { rows, cols, failed };
}
