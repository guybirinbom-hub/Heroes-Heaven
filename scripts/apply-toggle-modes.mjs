/*
 * Applies the authored toggle modes into core.modes, after applying the verifiers' corrections.
 *
 * NOTHING is written on trust — same rule as the coverage sweep. Every field name, sense name,
 * modifier target and referenced id is checked against the repo at run time, because the failure this
 * whole effort exists to undo is data that LOOKS authored and does nothing.
 *
 * Durability: `modes` is in the importer's CARRY_WHOLESALE list (import-core-v2.mjs), so entries in
 * core.json survive `npm run data`. The authored set is ALSO written to scripts/data/toggle-modes.json
 * so it can be rebuilt from source if core.json is ever regenerated from scratch.
 *
 * Usage: node scripts/apply-toggle-modes.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const DIR = p('work/toggles');

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const typesSrc = readFileSync(p('src/rules/types.ts'), 'utf8');
const modesSrc = readFileSync(p('src/rules/modes.ts'), 'utf8');

// ---- vocabulary, derived not remembered ----
const modeDefBlock = typesSrc.slice(typesSrc.indexOf('export interface ModeDef'));
const LEGAL_MODE_FIELDS = new Set(
  [...modeDefBlock.slice(0, modeDefBlock.indexOf('\n}')).matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]),
);
const MOD_TARGETS = new Set(['ac', 'save', 'skill', 'perception', 'attack', 'damage', 'all-checks', 'class-dc', 'spell-attack', 'spell-dc']);
const MOD_TYPES = new Set(['status', 'circumstance', 'item', 'untyped']);
const SKILLS = new Set(typesSrc.match(/export const SKILLS = \[([\s\S]*?)\]/)[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)));
/** Sense names the engine actually understands — taken from the shipped data, not from memory. */
const SENSES = new Set();
for (const coll of ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'stances']) {
  for (const r of Object.values(core[coll] ?? {})) {
    for (const s of r?.senses ?? []) if (s?.name) SENSES.add(String(s.name).toLowerCase());
    for (const s of r?.passiveEffects?.senses ?? []) if (s?.name) SENSES.add(String(s.name).toLowerCase());
  }
}
const EXISTING_MODE_IDS = new Set([...Object.keys(core.modes ?? {}), ...[...modesSrc.matchAll(/id: '([a-z0-9-]+)'/g)].map((m) => m[1])]);

// ---- load what the agents wrote ----
const authored = [];
const skipped = [];
for (const f of readdirSync(DIR).filter((n) => /^authored-\d+\.json$/.test(n)).sort()) {
  const b = JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
  for (const m of b.modes ?? []) authored.push(m);
  for (const s of b.skipped ?? []) skipped.push(s);
}

// ---- the verifiers' corrections ----
const corrections = new Map();
const rejected = new Map();
for (const f of readdirSync(DIR).filter((n) => /^verify-\d+\.json$/.test(n)).sort()) {
  const b = JSON.parse(readFileSync(path.join(DIR, f), 'utf8'));
  for (const r of b.rulings ?? []) {
    if (r?.ok === false && r.correction && Object.keys(r.correction).length) corrections.set(r.id, r.correction);
    else if (r?.ok === false) rejected.set(r.id, r.problem ?? 'verifier rejected it');
  }
}

const problems = [];
const out = new Map();
const seen = new Set();

for (const raw of authored) {
  if (!raw?.id) { problems.push('an entry with no id'); continue; }
  const id = raw.id;

  // A verifier that supplied a full corrected entry replaces the authored one outright.
  const fix = corrections.get(id);
  const m = fix && fix.id === id ? { ...raw, ...fix } : raw;

  // The skip check MUST run on the MERGED entry, not the raw one: two of the verifier's corrections
  // are `{skip:true}` — "this cannot work, drop it" — and checking `raw.skip` first would have
  // written both anyway, which is exactly the failure the verify pass existed to prevent.
  if (m.skip) { skipped.push({ id, why: m.why ?? raw.why ?? 'skipped' }); continue; }
  if (rejected.has(id) && !fix) { problems.push(`${id}: dropped — ${rejected.get(id)}`); continue; }
  if (seen.has(id)) { problems.push(`${id}: duplicate authored entry — keeping the first`); continue; }
  if (EXISTING_MODE_IDS.has(id)) { problems.push(`${id}: a mode with this id already exists — not overwriting`); continue; }

  // ---- structure ----
  // `why` is authoring metadata, never a ModeDef field — it must not reach core.json. (`skip` is
  // handled above and can never get this far.)
  delete m.why;
  const unknown = Object.keys(m).filter((k) => !LEGAL_MODE_FIELDS.has(k));
  if (unknown.length) { problems.push(`${id}: unknown ModeDef field(s) ${unknown.join(', ')}`); continue; }
  if (!m.name) { problems.push(`${id}: no name`); continue; }

  // ---- referenced content must exist ----
  if (m.fromItemId && !core.items[m.fromItemId]) { problems.push(`${id}: fromItemId "${m.fromItemId}" is not an item`); continue; }
  const badGate = (m.feats ?? []).filter((f) => !core.feats[f] && !core.classFeatures[f]);
  if (badGate.length) { problems.push(`${id}: gate id(s) not in feats or classFeatures: ${badGate.join(', ')}`); continue; }
  if (!m.fromItemId && !(m.feats ?? []).length) { problems.push(`${id}: neither fromItemId nor a feats gate — nothing would ever show it`); continue; }

  // ---- modifiers ----
  let bad = null;
  for (const mod of m.modifiers ?? []) {
    if (!MOD_TARGETS.has(mod.target)) bad = `modifier target "${mod.target}"`;
    else if (mod.type && !MOD_TYPES.has(mod.type)) bad = `modifier type "${mod.type}"`;
    else if (mod.target === 'skill' && mod.detail && !SKILLS.has(mod.detail)) bad = `skill "${mod.detail}"`;
    else if (typeof mod.value !== 'number') bad = `modifier value ${JSON.stringify(mod.value)}`;
  }
  if (bad) { problems.push(`${id}: ${bad}`); continue; }

  // ---- senses ----
  const badSense = (m.senses ?? []).map((s) => String(s?.name ?? '').toLowerCase()).filter((n) => n && !SENSES.has(n));
  if (badSense.length) { problems.push(`${id}: sense "${badSense.join(', ')}" is not a value the engine uses`); continue; }

  // ---- IWR shapes ----
  for (const r of [...(m.resistances ?? []), ...(m.weaknesses ?? [])]) {
    if (!r || typeof r.type !== 'string' || (typeof r.value !== 'number' && typeof r.value !== 'string')) bad = `malformed IWR entry ${JSON.stringify(r)}`;
  }
  if ((m.immunities ?? []).some((x) => typeof x !== 'string')) bad = 'immunities must be strings';
  if (bad) { problems.push(`${id}: ${bad}`); continue; }

  // A mode that carries NOTHING mechanical and no note is an empty toggle.
  const hasEffect = (m.modifiers ?? []).length || (m.resistances ?? []).length || (m.weaknesses ?? []).length || (m.immunities ?? []).length || (m.senses ?? []).length;
  if (!hasEffect && !m.note) { problems.push(`${id}: no effect and no note — an empty toggle`); continue; }

  // survivesRest is only honest for a duration that outlasts a night.
  if (m.survivesRest && /\b(round|turn|minute|minutes|hour)\b/i.test(String(m.duration ?? '')) && !/\bday|daily|week/i.test(String(m.duration ?? ''))) {
    problems.push(`${id}: survivesRest with duration "${m.duration}" — a short effect must not survive a rest`);
    continue;
  }

  seen.add(id);
  out.set(id, { ...m, modifiers: m.modifiers ?? [] });
}

console.log(`authored ${authored.length} · corrections applied ${[...corrections.keys()].filter((k) => out.has(k)).length} · WRITING ${out.size}`);
console.log(`skipped by the authors (no lane): ${skipped.length}`);
const byKind = { item: 0, feat: 0 };
for (const m of out.values()) (m.fromItemId ? byKind.item++ : byKind.feat++);
console.log(`  item-driven ${byKind.item} · feat/feature-gated ${byKind.feat}`);
const carries = (k) => [...out.values()].filter((m) => (m[k] ?? []).length).length;
console.log(`  resistances ${carries('resistances')} · immunities ${carries('immunities')} · senses ${carries('senses')} · modifiers ${carries('modifiers')}`);
if (problems.length) {
  console.log(`\nNOT WRITTEN (${problems.length}):`);
  for (const s of problems.slice(0, 40)) console.log('   ' + s);
  if (problems.length > 40) console.log(`   ...and ${problems.length - 40} more`);
}

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

core.modes = core.modes ?? {};
for (const [id, m] of out) core.modes[id] = m;
writeFileSync(p('public/core.json'), JSON.stringify(core));

const SRC = p('scripts/data/toggle-modes.json');
const prev = existsSync(SRC) ? JSON.parse(readFileSync(SRC, 'utf8')) : {};
for (const [id, m] of out) prev[id] = m;
writeFileSync(SRC, JSON.stringify(prev, null, 2) + '\n');
writeFileSync(path.join(DIR, 'not-written.json'), JSON.stringify({ problems, skipped }, null, 1));

console.log(`\nwritten: public/core.json (core.modes now ${Object.keys(core.modes).length}), scripts/data/toggle-modes.json`);
console.log('note: `modes` is in the importer CARRY_WHOLESALE list, so these survive `npm run data`.');
