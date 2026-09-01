/*
 * THE DRACONIC EXEMPLAR — a real choice, and the seven feats that filter it.
 *
 * The Draconic Codex sidebar (mirror: sidebar-2790): *"You can choose your exemplar when you create
 * your character, but are only required to choose one when you select a feat or other option that
 * requires you to have one."* Seven dragonblood feats then constrain WHICH dragon may be chosen:
 *
 *   arcane/divine/occult/primal-dragonblood — *"you must choose an <tradition> dragon"*
 *   summiting/aqueous/terra-dragonblood     — *"you must choose a dragon with a climb/swim/burrow Speed"*
 *
 * None of that existed: the app never asked the exemplar question (each dependent feat asks for its
 * own OUTPUT instead), so the constraints had no menu to filter. Owner ruling 2026-08-22: build the
 * choice and filter it.
 *
 * EVERYTHING IS COMPUTED FROM PRINTED DATA, never judged by me:
 *   · the option list  — the `draconicExemplar` glossary (the Draconic Codex table), minus the four
 *                        TRADITION HEADING rows (arcane/divine/occult/primal are groupings, not dragons)
 *   · each tradition   — the mirror page's own `tradition` field
 *   · each speed list  — the BESTIARY: the young/adult/ancient <name> dragon stat blocks' `speed`
 *                        objects, unioned across ages. An exemplar joining no bestiary dragon is a
 *                        HARD FAILURE, not a guess — a wrong filter forbids a legal character.
 *
 * The limits land as `choiceOptionLimits` targeting the heritage's new choice, and the resolver
 * INTERSECTS limits — so a primal + summiting character is offered primal ∩ climb, which per the
 * printed lists is empty: every option greyed with its reason, exactly what the book implies (Q27:
 * grey and explain, never hide).
 *
 *   node scripts/backfill-draconic-exemplar.mjs           # report
 *   node scripts/backfill-draconic-exemplar.mjs --write
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/draconic-exemplar';
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^\ufeff/, ''));

const core = read(join(ROOT, 'public/core.json'));
if (!existsSync(MIRROR)) { console.error(`no exemplar mirror at ${MIRROR}`); process.exit(2); }

/* The four heading rows of the printed table — traditions, not dragons. */
const HEADINGS = new Set(['arcane', 'divine', 'occult', 'primal']);

/* ---- tradition, from each exemplar's own mirror page ------------------------------------------- */
const tradition = new Map();
for (const f of readdirSync(MIRROR)) {
  if (!f.endsWith('.json') || f === '_index.json') continue;
  const j = read(join(MIRROR, f));
  if (j?.name && j?.tradition) tradition.set(String(j.name).toLowerCase(), String(j.tradition).toLowerCase());
}

/* ---- speeds, from the bestiary ----------------------------------------------------------------- */
const creatureSpeed = new Map();
for (const f of readdirSync(join(ROOT, 'public/data/bestiary'))) {
  let j;
  try { j = read(join(ROOT, 'public/data/bestiary', f)); } catch { continue; }
  for (const m of j?.creature ?? []) if (m?.name && m.speed) creatureSpeed.set(m.name.toLowerCase(), m.speed);
}
/** Movement kinds any age of this dragon has — the union, since the exemplar is the KIND of dragon. */
const kindsOf = (name) => {
  const out = new Set();
  let joined = false;
  for (const age of ['young', 'adult', 'ancient']) {
    const s = creatureSpeed.get(`${age} ${name.toLowerCase()} dragon`);
    if (!s) continue;
    joined = true;
    for (const k of Object.keys(s)) out.add(k);
  }
  return joined ? out : null;
};

/* ---- assemble ---------------------------------------------------------------------------------- */
const exemplars = Object.values(core.draconicExemplar ?? {}).filter((r) => !HEADINGS.has(r.id));
const unjoined = [];
const rows = [];
const options = [];
for (const r of exemplars.sort((a, b) => a.name.localeCompare(b.name))) {
  const trad = tradition.get(r.name.toLowerCase());
  const kinds = kindsOf(r.name);
  if (!trad || !kinds) { unjoined.push(`${r.name} (${!trad ? 'no tradition' : 'no bestiary dragon'})`); continue; }
  const move = ['fly', 'swim', 'climb', 'burrow'].filter((k) => kinds.has(k));
  options.push({
    value: r.id,
    label: r.name,
    description: `${trad.charAt(0).toUpperCase() + trad.slice(1)} dragon — ${move.join(', ') || 'land only'}.`,
    _trad: trad,
    _kinds: kinds,
  });
}
if (unjoined.length) {
  console.error(`REFUSING to write — ${unjoined.length} exemplar(s) could not be joined to printed data:`);
  for (const u of unjoined) console.error(`   ${u}`);
  process.exit(2);
}

const clean = options.map(({ _trad, _kinds, ...o }) => o);
rows.push({
  category: 'heritages',
  id: 'dragonblood',
  field: 'choice',
  value: {
    flag: 'draconicExemplar',
    prompt: 'Draconic exemplar — the kind of dragon whose blood runs in your veins (optional until a feat requires one)',
    kind: 'array',
    options: clean,
  },
});

/* The seven filters, each quoting its own printed sentence as the reason. */
const byTrad = (t) => options.filter((o) => o._trad === t).map((o) => ({ value: o.value }));
const byMove = (k) => options.filter((o) => o._kinds.has(k)).map((o) => ({ value: o.value }));
const LIMITS = [
  ['arcane-dragonblood', byTrad('arcane'), 'If you choose a draconic exemplar, you must choose an arcane dragon.'],
  ['divine-dragonblood', byTrad('divine'), 'If you choose a draconic exemplar, you must choose a divine dragon.'],
  ['occult-dragonblood', byTrad('occult'), 'If you choose a draconic exemplar, you must choose an occult dragon.'],
  ['primal-dragonblood', byTrad('primal'), 'If you choose a draconic exemplar, you must choose a primal dragon.'],
  ['summiting-dragonblood', byMove('climb'), 'If you choose a draconic exemplar, you must choose a dragon with a climb Speed.'],
  ['aqueous-dragonblood', byMove('swim'), 'If you choose a draconic exemplar, you must choose a dragon with a swim Speed.'],
  ['terra-dragonblood', byMove('burrow'), 'If you choose a draconic exemplar, you must choose a dragon with a burrow Speed.'],
];
for (const [featId, allow, reason] of LIMITS) {
  if (!core.feats[featId]) { console.error(`${featId} is not in core.json`); process.exit(2); }
  if (!allow.length) { console.error(`${featId}: the computed allow-list is EMPTY — that cannot be right for a printed option`); process.exit(2); }
  rows.push({
    category: 'feats',
    id: featId,
    field: 'choiceOptionLimits',
    value: [{ target: 'dragonblood', flag: 'draconicExemplar', allow, reason }],
  });
}

console.log(`${clean.length} exemplar option(s); 7 filter(s):`);
for (const [featId, allow] of LIMITS) console.log(`  ${featId.padEnd(24)} ${allow.length} allowed: ${allow.slice(0, 8).map((a) => a.value).join(', ')}${allow.length > 8 ? ' …' : ''}`);

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const all = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of rows) {
  const at = all.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { all[at] = row; replaced++; } else { all.push(row); added++; }
}
writeBackfill(ROOT, all);
console.log(`\nwrote ${added} new row(s), ${replaced} replaced (${all.length} rows total).`);
