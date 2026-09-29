/*
 * GUARD: A REFRESH MAY NOT TAKE ANYTHING AWAY FROM A SHIPPED RECORD.
 *
 * Three rounds of per-record repairs after the 2026-09 Archives refresh did not converge: every round
 * the refuters found NEW records that had lost a field, a number, a description, descRefs, traits,
 * actionCost, usage or bulk, or had a level/price swapped with a sibling. Repairing case by case only
 * ever measures the cases somebody happened to open. So this is the instrument instead: it compares
 * the WHOLE shipped artefact against a BEFORE snapshot of itself and reports every loss, and the
 * repair loop is "run it to zero", not "look for another one".
 *
 * It is a LOSS detector, not a diff. Growth is silent — a record that gains a trait, a longer
 * description or a new field says nothing. Only these say something:
 *
 *   gone            a record id present before and absent after
 *   renamed         `name` changed
 *   field-dropped   a field present before and absent after (at any depth)
 *   text-shrank     a string field emptied, or shorter by more than TEXT_SLACK characters
 *   array-lost      an array that lost members (traits, prerequisites, descRefs, skills, grants, …)
 *   number-changed  any change under a NUMERIC_ROOTS key, either way
 *   rarity-changed  `rarity` moved — mechanical, see below
 *   ladder          a graded family out of order: lesser <= moderate <= greater <= major <= true
 *   desc-orphan     a description entry whose record no longer exists
 *
 * RARITY IS A FINDING, NOT A NOTE. `items/dragontooth-club` went uncommon -> common in this refresh and
 * NOTHING reported it: TEXT_SLACK swallows an 8-character string shrinking to 6, and `rarity` was not a
 * NUMERIC_ROOT. Rarity gates whether a character needs Access to select the item at all, so it is read
 * off the sheet exactly the way a price is — the same blind spot a spell's `area` had, one field over.
 *
 * ...AND FIVE FIELDS ARE REPORTED WITHOUT FAILING (CHANGED_ROOTS: traits, name, source, edition, aonId).
 * A non-numeric string that GROWS, or shrinks by <= TEXT_SLACK, is structurally invisible to everything
 * above — and every `edition` transition this refresh makes is exactly that shape (legacy-era -> legacy,
 * remaster-era -> superseded, …, all <= 4 characters shorter), while remaster-era -> superseded hides a
 * record from the Builder for good. Those five are provenance and presentation, not mechanics, so they
 * are PRINTED with a per-field tally rather than made fatal; the corpus guard for them is
 * scripts/edition-drift-check.mjs. Printing them stops "0 unexplained" from being read as "nothing moved".
 *
 * WHY "number-changed" IS BOTH DIRECTIONS. A price or a level that moves is never noise: it is either
 * the Archives correcting a figure — allow-list it with the doc id — or two grades of one item
 * swapping their rows, which is what happened to the Judgment Thurible and which no one-sided check
 * can see.
 *
 * WHAT COUNTS AS A NUMBER (NUMERIC_ROOTS). The first cut of this guard watched only the numbers on an
 * ITEM's line — level, price, bulk, hands, actionCost, usage — and was therefore blind to every number
 * on a SPELL's. `spells/elemental-confluence` moved from a 10-foot burst to a 20-foot one in the same
 * refresh, an independent differ caught it and this instrument did not. A spell's area, range, duration
 * and DC are read off the sheet exactly the way a price is, so they are watched on the same terms.
 *
 * ALLOW-LIST. Every finding must be either repaired or written down in
 * scripts/data/refresh-loss-allow.json as a row
 *
 *     { "key": "items/dragonhide", "field": "description", "aon": "equipment-3268",
 *       "why": "AoN deleted the Craft Requirements line in the 2026-09 refresh" }
 *
 * `key` and `field` are exact — there are no wildcards, deliberately. A wildcard allow is how a class
 * of loss goes quiet, and this guard exists because a class of loss went quiet.
 *
 * `aon` MUST BE A DOCUMENT SOMEBODY CAN OPEN — `<category>-<number>`, or an Archives variant sub-document
 * (`equipment-2963-2839`). It is refused otherwise, because the first draft of this allow-list cited
 * `equipment-4978-bonus-1669` on five rows: that is an id this pipeline MINTS for a synthetic itemBonus
 * row, not a page on the Archives, so the evidence could not be checked by the one method that matters —
 * opening it. An unopenable citation is a wildcard allow wearing a doc id.
 *
 *   node scripts/refresh-loss-check.mjs                       # vs `git show HEAD:public/core.json`
 *   node scripts/refresh-loss-check.mjs before/core.json before/core-descriptions.json
 *   node scripts/refresh-loss-check.mjs --json work/.refresh-loss.json   # the findings, untruncated
 *
 * The description file argument is optional; without it the guard looks for a core-descriptions.json
 * beside the core file, and failing that compares core.json alone (descriptions then simply do not
 * participate, which is a weaker run — it says so).
 *
 * ⚠ THE ALLOW-LIST IS DIRECTIONAL. A row explains a change from ONE before-snapshot to the shipped
 * artefact. Running the guard against a DIFFERENT snapshot — the lane's own pre-rebuild copy rather
 * than git HEAD — can surface a change HEAD never had, and there is no row for it because there was
 * nothing to explain. That is not a defect in either run; it means the two snapshots differ, and the
 * finding has to be read on its own evidence. Say which snapshot a "zero" was measured against.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A string field may lose this many characters to whitespace/punctuation normalisation in silence. */
const TEXT_SLACK = 4;
/** Top-level keys whose every leaf is a mechanical number the player can read off the sheet. */
const NUMERIC_ROOTS = new Set([
  'level', 'price', 'bulk', 'hands', 'actionCost', 'usage',
  // A spell's numbers, on the same terms as an item's — see the header.
  'area', 'baseArea', 'range', 'duration', 'dc',
]);
/** Mechanical but not numeric: a change needs an allow row like any other finding. See the header. */
const HARD_CHANGE_ROOTS = new Set(['rarity']);
/** Provenance + presentation: a change is printed with its before/after and never fails the run. */
const CHANGED_ROOTS = new Set(['traits', 'name', 'source', 'edition', 'aonId']);
const GRADES = ['lesser', 'moderate', 'greater', 'major', 'true'];
/**
 * `<category>-<number>`, plus the Archives' variant sub-documents (`equipment-2963-2839`, the
 * high-grade alloy orb). Anything else is not a page and cannot be opened — see the header.
 */
const AON_DOC_ID = /^[a-z][a-z-]*[a-z]-\d+(?:-\d+)*$/;
/** Map key for (key, field). U+001F is a unit separator: it cannot occur in a record id or a field path. */
const SEP = String.fromCharCode(31);

const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** core.json + core-descriptions.json are one artefact split for load time; compare them rejoined. */
function merge(corePath, descPath) {
  const core = load(corePath);
  const desc = descPath && existsSync(descPath) ? load(descPath) : null;
  if (desc) {
    for (const [bucket, recs] of Object.entries(desc)) {
      for (const [id, entry] of Object.entries(recs)) {
        const rec = core[bucket]?.[id];
        if (!rec || typeof rec !== 'object') continue;
        if (entry.d !== undefined) rec.description = entry.d;
        if (entry.r !== undefined) rec.descRefs = entry.r;
      }
    }
  }
  return { core, desc };
}

function snapshotFromHead() {
  const dir = mkdtempSync(join(tmpdir(), 'refresh-loss-'));
  const out = [];
  for (const f of ['public/core.json', 'public/core-descriptions.json']) {
    const at = join(dir, basename(f));
    writeFileSync(at, execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, maxBuffer: 1 << 30 }));
    out.push(at);
  }
  return out;
}

const jsonAt = process.argv.indexOf('--json');
const jsonOut = jsonAt > -1 ? process.argv[jsonAt + 1] : null;
/* Positional args are the BEFORE snapshot; `--json <path>` and its value are not among them. */
const args = process.argv.slice(2).filter((a, i) => !a.startsWith('--') && process.argv[i + 1] !== '--json');
let [beforeCore, beforeDesc] = args;
let against = 'the before snapshot';
if (!beforeCore) {
  [beforeCore, beforeDesc] = snapshotFromHead();
  against = 'git HEAD';
} else if (!beforeDesc) {
  const sibling = join(dirname(beforeCore), 'core-descriptions.json');
  if (existsSync(sibling)) beforeDesc = sibling;
}

const before = merge(beforeCore, beforeDesc);
const after = merge(
  process.env.CORE_JSON || join(ROOT, 'public/core.json'),
  process.env.CORE_DESCRIPTIONS_JSON || join(ROOT, 'public/core-descriptions.json'),
);

const ALLOW_PATH = join(ROOT, 'scripts/data/refresh-loss-allow.json');
const allowRows = existsSync(ALLOW_PATH) ? load(ALLOW_PATH) : [];
const allow = new Map();
for (const row of allowRows) {
  if (!row.key || !row.field || !row.aon || !row.why) {
    console.error(`refresh-loss-check: FAIL — an allow row needs key, field, aon and why: ${JSON.stringify(row)}`);
    process.exit(1);
  }
  if (/[*?]/.test(row.key) || /[*?]/.test(row.field)) {
    console.error(`refresh-loss-check: FAIL — no wildcards in the allow-list: ${row.key} ${row.field}`);
    process.exit(1);
  }
  if (!AON_DOC_ID.test(String(row.aon))) {
    console.error(`refresh-loss-check: FAIL — "${row.aon}" (${row.key} ${row.field}) is not an AoN document id.`);
    console.error('   Cite a page somebody can open: <category>-<number>, or a variant sub-document');
    console.error('   (equipment-2963-2839). An id this pipeline minted is not evidence.');
    process.exit(1);
  }
  allow.set(`${row.key}${SEP}${row.field}`, row);
}

/** record → Map(path → scalar | array). Objects are walked; null/undefined are "absent". */
function flatten(obj, prefix, out) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) out.set(p, v);
    else if (typeof v === 'object') flatten(v, p, out);
    else out.set(p, v);
  }
  return out;
}

const findings = [];
/** The reported-not-fatal half — one row per CHANGED_ROOTS field that moved. */
const changes = [];
const seen = new Set();
const add = (kind, key, field, was, now) => {
  const dedupe = `${kind}${SEP}${key}${SEP}${field}`;
  if (seen.has(dedupe)) return;
  seen.add(dedupe);
  findings.push({ kind, key, field, was, now });
};
const noteChange = (key, field, was, now) => { changes.push({ kind: 'changed', key, field, was, now }); };
const show = (v) => {
  if (v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 110 ? `${s.slice(0, 107)}…` : s;
};

let compared = 0;
for (const [bucket, recs] of Object.entries(before.core)) {
  if (!recs || typeof recs !== 'object' || Array.isArray(recs)) continue;
  const afterRecs = after.core[bucket];
  for (const [id, was] of Object.entries(recs)) {
    if (!was || typeof was !== 'object') continue;
    const key = `${bucket}/${id}`;
    const now = afterRecs?.[id];
    if (!now || typeof now !== 'object') {
      add('gone', key, 'record', 'present', 'absent');
      continue;
    }
    compared++;
    if (was.name !== now.name) add('renamed', key, 'name', was.name, now.name);

    const wasFlat = flatten(was, '', new Map());
    const nowFlat = flatten(now, '', new Map());
    for (const [path, wv] of wasFlat) {
      const nv = nowFlat.get(path);
      const root = path.split('.')[0];
      if (nv === undefined) {
        add('field-dropped', key, path, wv, undefined);
        continue;
      }
      if (Array.isArray(wv)) {
        if (!Array.isArray(nv)) continue; // shape change; the dropped/added pair below covers it
        const have = new Set(nv.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))));
        const lost = wv.filter((x) => !have.has(typeof x === 'object' ? JSON.stringify(x) : String(x)));
        if (lost.length) add('array-lost', key, path, lost, `${nv.length} member(s) remain`);
        // A re-ordered or extended array loses nothing, so nothing above fires — report it anyway.
        else if (CHANGED_ROOTS.has(root) && JSON.stringify(wv) !== JSON.stringify(nv)) noteChange(key, path, wv, nv);
        continue;
      }
      if (typeof wv === 'string' && typeof nv === 'string') {
        if (wv.trim() && !nv.trim()) add('text-shrank', key, path, `${wv.length} chars`, 'empty');
        /* `source.book` is a KEY, not prose — the source filter's toggle (src/rules/sources.ts) — so its
         * length says nothing about loss: desk #166 (2026-09-25) relabelled 144 records from a fold target
         * to their own book, "Pathfinder Adventure Path: Hellbreakers" -> "Pathfinder #222: Hellbreakers",
         * ten characters shorter and nothing lost. A changed book is printed under CHANGED like every
         * `source` change; an EMPTIED one still fails above; book identity is scripts/reprint-check.mjs's
         * (CHECK 2 and CHECK 4). */
        else if (nv.length < wv.length - TEXT_SLACK && path !== 'source.book') add('text-shrank', key, path, `${wv.length} chars`, `${nv.length} chars`);
        // A same-length rewrite of a numeric field is still a number change; NUMERIC_ROOTS below.
      }
      if (NUMERIC_ROOTS.has(root) && wv !== nv) add('number-changed', key, path, wv, nv);
      else if (HARD_CHANGE_ROOTS.has(root) && wv !== nv) add('rarity-changed', key, path, wv, nv);
      else if (CHANGED_ROOTS.has(root) && wv !== nv) noteChange(key, path, wv, nv);
    }
    // A numeric root that APPEARED is also a mechanical change the player reads off the sheet.
    for (const [path, nv] of nowFlat) {
      if (!NUMERIC_ROOTS.has(path.split('.')[0])) continue;
      if (!wasFlat.has(path)) add('number-changed', key, path, undefined, nv);
    }
  }
}

/*
 * THE GRADE LADDER, on the AFTER corpus. This is the one invariant that catches an Archives labelling
 * error with no second printing to compare against: two grades of one item swapping their rows leaves
 * both figures "correct" against the mirror and only the ORDER wrong. scripts/price-check.mjs holds
 * the same invariant against the mirror; this one holds it against nothing but the ladder itself, so
 * it still fires on a machine with no mirror.
 */
const families = new Map();
for (const [id, rec] of Object.entries(after.core.items ?? {})) {
  const i = GRADES.findIndex((g) => id.endsWith(`-${g}`));
  if (i < 0) continue;
  const base = id.slice(0, -(GRADES[i].length + 1));
  (families.get(base) ?? families.set(base, []).get(base)).push({ id, rank: i, rec });
}
const copper = (p) => (p?.pp ?? 0) * 1000 + (p?.gp ?? 0) * 100 + (p?.sp ?? 0) * 10 + (p?.cp ?? 0);
let ladders = 0;
for (const [base, members] of families) {
  if (members.length < 2) continue;
  ladders++;
  members.sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < members.length; i++) {
    const lo = members[i - 1], hi = members[i];
    if (typeof lo.rec.level === 'number' && typeof hi.rec.level === 'number' && hi.rec.level < lo.rec.level) {
      add('ladder', `items/${base}`, 'level', `${lo.id} ${lo.rec.level}`, `${hi.id} ${hi.rec.level}`);
    }
    if (lo.rec.price && hi.rec.price && copper(hi.rec.price) < copper(lo.rec.price)) {
      add('ladder', `items/${base}`, 'price', `${lo.id} ${copper(lo.rec.price)} cp`, `${hi.id} ${copper(hi.rec.price)} cp`);
    }
  }
}

/* A description whose record went away is text nothing can ever show again. */
if (after.desc) {
  for (const [bucket, recs] of Object.entries(after.desc)) {
    for (const id of Object.keys(recs)) {
      if (!after.core[bucket]?.[id]) add('desc-orphan', `${bucket}/${id}`, 'description', 'an entry', 'no record');
    }
  }
}

const allowed = [];
const open = [];
for (const f of findings) (allow.has(`${f.key}${SEP}${f.field}`) ? allowed : open).push(f);

/* `--json <path>`: the same findings, untruncated, for whatever is deciding what to do with them. */
if (jsonOut) writeFileSync(jsonOut, JSON.stringify([...findings, ...changes], null, 1));

console.log(`refresh-loss-check: ${compared} records compared against ${against}`);
console.log(`   ${ladders} graded families, ${allowRows.length} allow rows`);

/*
 * CHANGED — printed, never fatal. A per-field tally first, because the interesting number is "181
 * editions moved", not the 181 lines; the detail is capped and `--json` carries all of it.
 */
if (changes.length) {
  const byField = {};
  for (const c of changes) byField[c.field.split('.')[0]] = (byField[c.field.split('.')[0]] ?? 0) + 1;
  const tally = Object.entries(byField).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} ${n}`).join(', ');
  console.log(`\nCHANGED (${changes.length}) — provenance/presentation, reported not fatal: ${tally}`);
  for (const c of changes.slice(0, 40)) {
    console.log(`   ${c.key.padEnd(46)} ${c.field.padEnd(14)} was ${show(c.was)}  now ${show(c.now)}`);
  }
  if (changes.length > 40) console.log(`   … and ${changes.length - 40} more (--json <path> writes every one)`);
}
if (!after.desc || !before.desc) console.log('   ⚠ WEAK RUN: one side had no core-descriptions.json, so prose was not compared.');

if (allowed.length) {
  console.log(`\nALLOWED (${allowed.length}) — each with its AoN evidence:`);
  for (const f of allowed) {
    const row = allow.get(`${f.key}${SEP}${f.field}`);
    console.log(`   ${f.kind.padEnd(14)} ${f.key} ${f.field}  [${row.aon}] ${row.why}`);
  }
}

/*
 * ROWS THAT DID NOT FIRE — printed, never fatal.
 *
 * A row stops firing for two very different reasons and only one of them is fine. It is fine when the
 * lane was committed and HEAD moved: there is nothing left to explain. It is NOT fine when the loss was
 * REPAIRED and the row's rationale survived it — thirteen sidebar rows said "the Archives folded the
 * page into ancestry-68", the Archives had done no such thing, the records came back, and the rows
 * would have sat there stating it. Failing on this would go red on every ordinary commit; printing it
 * means a rationale nobody believes any more cannot stay invisible.
 */
const fired = new Set(allowed.map((f) => `${f.key}${SEP}${f.field}`));
const idle = allowRows.filter((r) => !fired.has(`${r.key}${SEP}${r.field}`));
if (idle.length) {
  console.log(`\nDID NOT FIRE (${idle.length}) — nothing to explain against this snapshot; re-read the reason before keeping the row:`);
  for (const r of idle) console.log(`   ${r.key} ${r.field}  [${r.aon}]`);
}

if (open.length) {
  console.error(`\nrefresh-loss-check: FAIL — ${open.length} unallowed finding(s):`);
  for (const f of open) {
    console.error(`   ${f.kind.padEnd(14)} ${f.key.padEnd(46)} ${f.field.padEnd(22)} was ${show(f.was)}  now ${show(f.now)}`);
  }
  console.error('\n   Repair from the before snapshot, or add a row to scripts/data/refresh-loss-allow.json');
  console.error('   naming the live AoN doc id and why the Archives themselves changed it.');
  process.exit(1);
}
console.log('\nrefresh-loss-check: ok — the refresh took nothing away.');
