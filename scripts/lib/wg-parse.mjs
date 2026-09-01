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

/**
 * The record behind an id, from ANY player-facing bucket.
 *
 * All four comparers used to resolve with `core.feats?.[id]` and give up otherwise, so every non-feat
 * record in every batch was silently never compared — measured on 2026-08-19: 156 of the 786 records
 * worked in batches 1-8, a fifth of the work, including 78 class features and 55 items. "No comparer
 * complained" and "no comparer looked" produce the same silence, which is exactly the failure
 * `scripts/wg-batch-gate.mjs` exists to make impossible.
 *
 * Order matters only for an id that exists in two buckets; feats first keeps every earlier reading
 * identical to what it was.
 */
export const WG_BUCKETS = ['feats', 'classFeatures', 'heritages', 'backgrounds', 'items', 'ancestries', 'classes', 'actions'];

/**
 * A rune id resolves to its purchasable CHASSIS in `items`, while the mechanic lives on the RUNES
 * twin (core.runes[id]) — all 159 rune ids exist in both. Comparing the chassis alone read every
 * etched-rune mechanic as absent (Assisting's `passiveEffects.bulkLimitBonus` was authored, live and
 * reported missing). Merge the twin's MECHANICAL keys in, ITEMS-WINS: kolss-oath and trudds-strength
 * carry a `price` that differs between the two records, so a blanket runes-over-items merge would
 * silently rewrite commerce data the items bucket owns. ⚠ Do NOT add `runes` to WG_BUCKETS instead —
 * WG_PAIRING has no runes table, so the 159 records would land in noMatch and move every counter for
 * a reason unrelated to parity.
 */
const RUNE_MERGE_KEYS = ['passiveEffects', 'slot', 'kind', 'damage'];
function mergeRuneTwin(core, id, rec, bucket) {
  const rune = bucket === 'items' ? core.runes?.[id] : undefined;
  if (!rune) return rec;
  const merged = { ...rec };
  for (const k of RUNE_MERGE_KEYS) if (merged[k] === undefined && rune[k] !== undefined) merged[k] = rune[k];
  return merged;
}

export function wgRecord(core, id, bucketHint) {
  /* An id can live in TWO buckets ('warrior' is a background AND a class feature), and bucket order
   * silently resolved it to whichever came first — so a BACKGROUND batch's warrior was examined as a
   * class feature and the background itself reached no comparer at all (batch 23's COVERAGE catch).
   * Batch rows carry the bucket they were cut from; callers that have it pass it. */
  if (bucketHint && core[bucketHint]?.[id]?.name) {
    return { rec: mergeRuneTwin(core, id, core[bucketHint][id], bucketHint), bucket: bucketHint };
  }
  for (const b of WG_BUCKETS) {
    const rec = core[b]?.[id];
    if (rec?.name) return { rec: mergeRuneTwin(core, id, rec, b), bucket: b };
  }
  return { rec: undefined, bucket: undefined };
}

/** Every (id, record) pair a comparer should walk, across all buckets. */
export function* wgAllRecords(core) {
  for (const b of WG_BUCKETS) {
    for (const [id, rec] of Object.entries(core[b] ?? {})) if (rec?.name) yield [id, mergeRuneTwin(core, id, rec, b), b];
  }
}

/**
 * OUR BUCKET -> THEIR ROWS, type-gated.
 *
 * Every comparer used to look our record up with `core.feats?.[id]` and match it against their `feat`
 * rows alone, so a non-feat was skipped in silence — measured: 156 of the 786 records worked in batches
 * 1-8 (20%) had never been compared by anything, and "no comparer complained" reads exactly like
 * "compared and agreed".
 *
 * ⚠ NAME ALONE IS NOT ENOUGH, and this is why an earlier widening was reverted. 266 normalised names
 * exist in more than one of our buckets, and in 26 of those their FEAT row is encoded while our
 * colliding record is not a feat — so a name-only cross-bucket match compares our WEAPON `clan-pistol`
 * against their FEAT of the same name and reports the feat's granted item as missing, on a record that
 * is correct. Type-gating removes all 98 of those item-vs-feat mispairs.
 *
 * Counts below are their ENCODED rows (non-empty `operations`), measured 2026-08-19:
 *   feats          ability_block type=feat            3936
 *   classFeatures  type=class-feature ∪ feat          2069 + fallback — the two projects disagree about
 *                                                      what is a feat vs a class feature: of our 1038
 *                                                      class features, 351 match a `feat` row and 351 a
 *                                                      `class-feature` row with only 22 in both, so a
 *                                                      strict pairing loses 150 records
 *   heritages      type=heritage                       527
 *   backgrounds    `background` table                   622
 *   ancestries     `ancestry` table                     110
 *   classes        `class` table                         57
 *   items          `item` table                         868
 *   actions        NOTHING — all 135 of their type=action rows have empty operations, so a strict
 *                  pairing would go from 17 comparable to 4. Falls back to feat/class-feature, which is
 *                  where the names that do carry mechanics actually live.
 */
export const WG_PAIRING = {
  feats: { table: 'ability_block', types: ['feat'] },
  classFeatures: { table: 'ability_block', types: ['class-feature', 'feat'] },
  heritages: { table: 'ability_block', types: ['heritage'] },
  backgrounds: { table: 'background' },
  ancestries: { table: 'ancestry' },
  classes: { table: 'class' },
  items: { table: 'item' },
  actions: { table: 'ability_block', types: ['action', 'mode', 'feat', 'class-feature'] },
};

/**
 * Does this record OWN the comparison for its name, or does a sibling?
 *
 * Our data ships a class feature AND the action it grants under the same id — `classFeatures.taunt`
 * carrying `grantsActions: ['taunt']`, and `actions.taunt` being that action. Their side has one row: a
 * `class-feature` with a `giveAbilityBlock`. The `actions` pairing above deliberately falls back to
 * feat/class-feature rows, because their own `action` rows carry no operations at all — and that
 * fallback then compared OUR ACTION against THEIR CLASS FEATURE and reported the action as missing the
 * very grant it is. Eighteen records read as gaps that way, ten of them inside finished batches.
 *
 * So an `actions` record defers when a feat or class feature shares its id: that sibling is the real
 * counterpart, it is compared in its own right, and it already scores the grant.
 */
/*
 * …and the SECOND sibling rule: an `aon-` twin defers to the canonical record of the same name.
 *
 * The import prefixes `aon-` onto a record whose id collides with one we already ship, and the app
 * SUPPRESSES the twin — hidden, never deleted, per the display-hygiene rule. The mechanics are
 * authored on the canonical, because that is the record a character can actually reach.
 *
 * The comparers walked both. The twin carries nothing by design, so every mechanic their row encodes
 * came back missing on it — a finding about a record no player can select, while the canonical beside
 * it was already correct. Batch 12 surfaced it as `aon-spore-shepherd-s-staff missing=[skill]` when
 * `spore-shepherds-staff` ships the +2 circumstance bonus to Nature in full.
 *
 * MEASURED across the paired buckets: 491 `aon-` twins are shadowed by a canonical of the same name.
 * Every one of them was a false finding waiting for the batch that happened to contain it.
 *
 * Deliberately narrow: only when a NON-`aon-` record of the same normalised name exists in the SAME
 * bucket. An `aon-` record that is the only carrier of its name is real content and is still compared.
 */
const shadowedAonTwins = new WeakMap();
function aonTwinIsShadowed(core, bucket, id) {
  if (!id.startsWith('aon-')) return false;
  let perCore = shadowedAonTwins.get(core);
  if (!perCore) shadowedAonTwins.set(core, (perCore = new Map()));
  if (!perCore.has(bucket)) {
    const canonical = new Set();
    for (const [otherId, rec] of Object.entries(core[bucket] ?? {})) {
      if (!rec?.name || otherId.startsWith('aon-')) continue;
      canonical.add(wgNorm(rec.name));
    }
    perCore.set(bucket, canonical);
  }
  const name = core[bucket]?.[id]?.name;
  return !!name && perCore.get(bucket).has(wgNorm(name));
}

export function wgOwnsComparison(core, bucket, id) {
  if (aonTwinIsShadowed(core, bucket, id)) return false;
  if (bucket !== 'actions') return true;
  return !core.feats?.[id] && !core.classFeatures?.[id];
}

const wgNorm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Build `bucket -> Map(normalisedName -> richest row)` for every pairing above, from one pass per table.
 *
 * "Richest" because their tables hold ~1.3 rows per name (versions, legacy printings, homebrew) and only
 * one of them is the encoded one; taking the first match compared against an empty row and reported a
 * gap on a record they model perfectly well.
 */
export function wgRowsByBucket(sql) {
  const cache = new Map();
  const tableRows = (t) => {
    if (!cache.has(t)) cache.set(t, parseCopyBlock(sql, t).rows);
    return cache.get(t);
  };
  /*
   * ⚠ THEIR DUMP HOLDS TWO GAMES. Wanderer's Guide ships Starfinder 2e content in the same tables,
   * and "richest row wins" then pairs a PF2e record against the OTHER GAME's namesake: our core
   * Acolyte (Player Core, src 1) was compared against the Xenowardens Acolyte from Guilt of the
   * Grave World (src 731, ops 2410 > 1816) and reported Survival + Urban Survivalist + cooking/
   * life-science Lores as parity gaps — none of them exist in Pathfinder's Acolyte (batch 23).
   * Membership is measured, not name-guessed: group 'starfinder-core' plus any source whose store
   * URL says starfinder (which catches the Tech Class Playtest filed under 'playtest'). "Guilt of
   * the Grave World" carries no "Starfinder" in its NAME — a name test misses it.
   */
  const starfinderSources = new Set(
    tableRows('content_source')
      .filter((s) => s.group === 'starfinder-core' || /starfinder/i.test(String(s.url ?? '')))
      .map((s) => String(s.id)),
  );
  const out = {};
  for (const [bucket, spec] of Object.entries(WG_PAIRING)) {
    const m = new Map();
    for (const row of tableRows(spec.table)) {
      if (spec.types && !spec.types.includes(row.type)) continue;
      if (row.content_source_id != null && starfinderSources.has(String(row.content_source_id))) continue;
      const key = wgNorm(row.name);
      if (!key) continue;
      const ops = String(row.operations ?? '');
      const prev = m.get(key);
      /* Prefer the row that actually encodes something, then the longer encoding. A row with empty
       * operations never displaces one that has any. */
      if (!prev || ops.length > String(prev.operations ?? '').length) m.set(key, row);
    }
    out[bucket] = m;
  }
  return out;
}
