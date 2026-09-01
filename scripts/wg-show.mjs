/*
 * wg-show — print WHAT WANDERER'S GUIDE ACTUALLY ENCODES for one named record.
 *
 * Every batch of the parity project ends the same way: the gate names a handful of records where
 * their side models a kind ours does not, and the only honest next step is to READ their row before
 * deciding whether it is a real gap or a vocabulary difference. Up to now that read was re-derived
 * by hand each time — a throwaway parser, re-written per batch, each one a fresh chance to undo only
 * one of the dump's two escape layers and silently conclude "they encode nothing".
 *
 * So it is a tool. Point it at a name or an id and it prints their operations, flattened, with the
 * nested branches (conditional true/false, select options) shown in place.
 *
 *   node scripts/wg-show.mjs "Basic Kata"
 *   node scripts/wg-show.mjs --id mercy --raw
 *
 * NOTE ON LICENCE — the dump under work/wg/ is GPL-3.0 and this app ships proprietary. This script
 * READS it to describe a difference; nothing it prints may be copied into the repo as data. The
 * printed rules (Paizo/ORC, via the AoN mirror) remain the authority for content.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) {
  console.error(`No Wanderer's Guide dump at work/wg/wg-data.sql (gitignored on purpose).`);
  process.exit(2);
}

const query = process.argv.slice(2).filter((a) => !a.startsWith('--') && process.argv[process.argv.indexOf(a) - 1] !== '--id');
const wanted = (arg('--id', null) ?? query[0] ?? '').trim();
if (!wanted) {
  console.error('usage: node scripts/wg-show.mjs "<record name or our-id>" [--raw]');
  process.exit(2);
}

const sql = readFileSync(DUMP, 'utf8');

/* Same double-unescape as wg-diff: pg_dump's TSV layer, then the json[] literal inside it. Getting
 * this wrong is the one failure that looks like "they encode nothing" instead of like an error. */
const untsv = (s) => s.replace(/\\\\/g, '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(//g, '\\');
function parseOps(raw) {
  if (!raw || raw === '\\N' || raw.length < 5) return [];
  const s = untsv(raw).trim();
  if (!s.startsWith('{')) return [];
  let arr;
  try { arr = JSON.parse('[' + s.slice(1, -1) + ']'); } catch { return []; }
  return arr.map((e) => { try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; } }).filter(Boolean);
}

function table(name) {
  const head = new RegExp(`^COPY public\\.${name} \\(([^)]*)\\) FROM stdin;$`, 'm').exec(sql);
  if (!head) return null;
  const cols = head[1].split(',').map((s) => s.trim().replace(/"/g, ''));
  const start = head.index + head[0].length + 1;
  const rows = sql.slice(start, sql.indexOf('\n\\.\n', start)).split('\n').filter(Boolean).map((l) => l.split('\t'));
  return { cols, ix: Object.fromEntries(cols.map((c, i) => [c, i])), rows };
}

// Apostrophes are DELETED, not dashed: "Harbinger's Protection" must slug to harbingers-protection
// (our id form), not harbinger-s-protection — every other norm() in the toolchain strips punctuation
// outright, and this helper disagreeing made apostrophe records look absent from their dump.
const slug = (s) => String(s ?? '').toLowerCase().replace(/['’ʼ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const target = slug(wanted);

const ab = table('ability_block');
/* `--wgid 33747` picks one row outright. Their tables hold several rows per name (versions, legacy
 * printings, homebrew) and a name search prints all of them; once the interesting one is identified
 * this addresses it directly. */
const wgid = arg('--wgid', null);
const matches = wgid
  ? ab.rows.filter((r) => String(r[ab.ix.id]) === String(wgid))
  : ab.rows.filter((r) => {
      const n = slug(r[ab.ix.name]);
      return n === target || n.replace(/^aon-/, '') === target.replace(/^aon-/, '') || n.includes(target);
    });

if (!matches.length) {
  console.log(`\nNo ability_block row whose name slugs to "${target}".`);
  console.log(`That is itself an answer: they do not carry this record at all, so there is nothing of theirs to match.\n`);
  process.exit(0);
}

/* Names of the things their operations point AT, so the dump's numeric ids read as words. */
const nameTables = {};
for (const t of ['ability_block', 'item', 'spell', 'trait', 'language']) {
  const tt = table(t);
  if (!tt || tt.ix.id === undefined || tt.ix.name === undefined) continue;
  nameTables[t] = new Map(tt.rows.map((r) => [String(r[tt.ix.id]), r[tt.ix.name]]));
}
const typeById = ab.ix.type !== undefined ? new Map(ab.rows.map((r) => [String(r[ab.ix.id]), r[ab.ix.type]])) : new Map();

const label = (v) => {
  const s = String(v ?? '');
  const m = /^(ABILITY_BLOCK|ITEM|SPELL|TRAIT|LANGUAGE)_(\d+)$/.exec(s) ?? /^(\d+)$/.exec(s);
  if (!m) return s;
  const [kind, id] = m.length === 3 ? [m[1].toLowerCase(), m[2]] : ['ability_block', m[1]];
  const tbl = kind === 'ability_block' ? 'ability_block' : kind;
  const n = nameTables[tbl]?.get(id);
  if (!n) return s;
  const ty = tbl === 'ability_block' ? typeById.get(id) : null;
  return `${s}  «${n}${ty ? `, type=${ty}` : ''}»`;
};

const show = (op, depth = 0) => {
  const pad = '  '.repeat(depth + 1);
  const d = op.data ?? {};
  const bits = [];
  for (const k of ['variable', 'value', 'type', 'text', 'abilityBlockType', 'skill', 'amount', 'operator']) {
    if (d[k] === undefined || d[k] === null || d[k] === '') continue;
    bits.push(`${k}=${typeof d[k] === 'object' ? JSON.stringify(d[k]) : label(d[k])}`);
  }
  if (d.optionType) bits.push(`optionType=${d.optionType}`);
  console.log(`${pad}${op.type}${bits.length ? '  ' + bits.join('  ') : ''}`);
  if (d.conditions?.length) for (const c of d.conditions) console.log(`${pad}  IF ${label(c.name)} ${c.operator} ${label(c.value)}`);
  for (const [k, lbl] of [['trueOperations', 'THEN'], ['falseOperations', 'ELSE'], ['operations', '·']]) {
    if (!d[k]?.length) continue;
    console.log(`${pad}  ${lbl}`);
    for (const c of d[k]) show(c, depth + 2);
  }
  for (const o of d.optionsPredefined ?? []) {
    console.log(`${pad}  OPTION ${label(o.name ?? o.value ?? '?')}`);
    for (const c of o.operations ?? []) show(c, depth + 2);
  }
};

for (const r of matches.slice(0, 6)) {
  const ops = parseOps(r[ab.ix.operations]);
  console.log(`\n=== ${r[ab.ix.name]}  (their id ${r[ab.ix.id]}, type=${r[ab.ix.type]}, level=${r[ab.ix.level] ?? '?'}) ===`);
  if (!ops.length) { console.log('  (no operations — they carry the record but encode nothing mechanical)'); continue; }
  for (const op of ops) show(op);
  if (has('--raw')) console.log('\n--- raw ---\n' + JSON.stringify(ops, null, 2));
}
console.log('');
