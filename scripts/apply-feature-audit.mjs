/*
 * Applies the full class-feature + heritage audit. Re-runnable as groups land.
 *
 * Every guard exists because a previous applier made that exact mistake:
 *   - invented field names            -> LEGAL_FIELDS, derived from types.ts at run time
 *   - a field legal SOMEWHERE         -> usedIn(), per collection, PLUS a source scan so a lane's
 *                                        first user is not rejected the way a correct strikeDamage was
 *   - a placeholder left in the fix   -> quarantined, never written
 *   - one lane per fix                -> lanes fall through; a fix may carry a mode AND fields
 *   - a restated value                -> a no-op, not an overwrite
 *   - a marker pointing at nothing    -> checked against core.actions / core.conditions
 *   - reading {verdict,reason} as a fix -> that shape is a RECLASSIFICATION and carries none
 *
 * Usage: node scripts/apply-feature-audit.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const DIR = p('work/featureaudit');
const REGISTRY = p('src/rules/situationalBonuses.ts');

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const typesSrc = readFileSync(p('src/rules/types.ts'), 'utf8');

/** All string surgery is index-based, so the file must be LF while we work on it. A CRLF file has no
 *  "\n\n" and a previous strip's lastIndexOf(-1) duplicated 780 lines of this very registry. */
const lf = (t) => t.replace(/\r\n/g, '\n');
const GEN_SIT = '  // ---- full feature audit (scripts/apply-feature-audit.mjs) ----';
const GEN_MARK = '  // ---- full feature audit — action/condition marks ----';
const stripGen = (text, tag) => {
  const at = text.indexOf(tag);
  if (at < 0) return text;
  const start = text.lastIndexOf('\n', at - 1) + 1;
  const end = text.indexOf('\n};', at);
  if (end < 0) return text; // the table's close is missing — leave the file alone rather than cut blind
  return text.slice(0, start) + text.slice(end + 1);
};
const regBefore = stripGen(stripGen(lf(readFileSync(REGISTRY, 'utf8')), GEN_SIT), GEN_MARK);
let regSrc = regBefore;

const LEGAL_FIELDS = new Set([...typesSrc.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]));
const SKILLS = new Set(typesSrc.match(/export const SKILLS = \[([\s\S]*?)\]/)[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)));
const SAVES = new Set(['fortitude', 'reflex', 'will', 'all']);
const KINDS = new Set(['skill', 'save', 'perception', 'ac', 'attack', 'strikeAttack', 'strikeDamage', 'speed', 'hp', 'classDc', 'spell', 'spellDamage', 'ability']);

const between = (text, exportName) => {
  const open = text.indexOf(`export const ${exportName}`);
  return open < 0 ? '' : text.slice(open, text.indexOf('\n};', open));
};
const existingReg = new Set([...between(regSrc, 'FEAT_SITUATIONAL').matchAll(/^ {0,2}["']?([a-z0-9-]+)["']?:\s*\[/gm)].map((m) => m[1]));
const existingMarkers = new Set([...between(regSrc, 'RECORD_MARKERS').matchAll(/^ {0,2}["']?([a-z0-9-]+)["']?:\s*\[/gm)].map((m) => m[1]));

const rulesSrc = readdirSync(p('src/rules')).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(p(`src/rules/${f}`), 'utf8')).join('\n');
const usedCache = new Map();
const usedIn = (coll, field) => {
  const key = `${coll}.${field}`;
  if (!usedCache.has(key)) {
    const carried = Object.values(core[coll]).some((r) => r?.[field] != null);
    const read = new RegExp(String.raw`${coll}\[[^\]\n]+\]\??\.\s*${field}\b`).test(rulesSrc);
    usedCache.set(key, carried || read);
  }
  return usedCache.get(key);
};

const REFERENTIAL = new Map([
  ['innateSpells', { coll: 'spells', idOf: (e) => e?.spellId }],
  ['focusSpells', { coll: 'spells', idOf: (e) => e }],
  ['grantsFeats', { coll: 'feats', idOf: (e) => e }],
]);

const META = new Set([
  'needsEngineWork', 'situational', 'mode', 'note', 'why', 'reason', 'explanation', 'confidence',
  'rulesText', 'citation', 'source', 'comment', 'verdict', 'id', 'name', 'where', 'scope', 'upheld',
  'precedent', 'lane', 'evidence', 'collection',
]);

/* ---- load every verdict + the adversary's rulings ---- */
const records = [];
for (const f of readdirSync(DIR).filter((n) => /^judge-\d+\.json$/.test(n)).sort()) {
  try { for (const r of JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).records ?? []) records.push(r); }
  catch { console.log(`  (skipping ${f}: not valid JSON yet)`); }
}
/**
 * A correction is one of three things: {} (nothing to say), {verdict,reason} (a RECLASSIFICATION
 * carrying no fix), or {fix}/a bare fix. Reading the second as a fix once turned 27 correct overturns
 * into "a MISS whose fix says nothing".
 */
const realFix = (c) => {
  if (!c || typeof c !== 'object') return null;
  if (/^(NEEDS_NOTHING|ALREADY_OK)$/.test(c.verdict ?? '')) return null;
  if (c.fix && typeof c.fix === 'object') return c.fix;
  return Object.keys(c).some((k) => !META.has(k)) ? c : null;
};
const overturned = new Map();
const corrected = new Map();
for (const f of readdirSync(DIR).filter((n) => /^refute-c\d+-\d+\.json$/.test(n)).sort()) {
  try {
    for (const r of JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).rulings ?? []) {
      const fix = realFix(r?.correction);
      if (fix) corrected.set(r.id, fix);
      else if (r?.upheld === false) overturned.set(r.id, r.why ?? 'overturned by the adversary');
    }
  } catch { console.log(`  (skipping ${f}: not valid JSON yet)`); }
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const skipped = [];
const engineWork = [];
const unresolved = [];
const sitEntries = new Map();
const newMarkers = new Map();
const fieldWrites = [];
const newModes = new Map();
let none = 0;

/** Which collection a record id lives in — the judges do not always say. */
const collOf = (id) => (core.classFeatures[id] ? 'classFeatures' : core.heritages[id] ? 'heritages' : null);

for (const rec of records) {
  const id = rec?.id;
  if (!id) continue;
  if (rec.verdict !== 'MISS') { none++; continue; }
  if (overturned.has(id)) { skipped.push(`${id}: ${overturned.get(id)}`); continue; }
  const fix = corrected.get(id) ?? rec.fix;
  if (!fix) { skipped.push(`${id}: MISS with no fix`); continue; }
  const coll = collOf(id);
  if (!coll) { skipped.push(`${id}: not a class feature or heritage in core.json`); continue; }

  if (/<[a-z][^>]{4,}>/i.test(JSON.stringify(fix))) {
    unresolved.push({ id, name: rec.name ?? core[coll][id].name, fix });
    continue;
  }
  if (fix.needsEngineWork && !Object.keys(fix).some((k) => !META.has(k))) {
    engineWork.push({ id, coll, name: rec.name ?? core[coll][id].name, reason: rec.reason ?? fix.note ?? '' });
    continue;
  }

  // NOTE ON CONTROL FLOW: none of the lanes below `continue`. A fix may carry a marker AND a field,
  // or a mode AND a field, and an earlier version of this stopped at the first lane — which silently
  // dropped the only player-side half of a fix whose other half was target-side. Every lane runs.

  // ---- a mark on an ACTION or a CONDITION rather than a stat ----
  // Routed by SHAPE, not by key: adversaries return these under `situational` too, and a Leap
  // distance written as a star on a stat would claim a bonus it does not give.
  const markerEntries = Array.isArray(fix.situational) ? fix.situational.filter((b) => b?.on && b?.id) : [];
  if (markerEntries.length) {
    const marks = markerEntries.filter((b) => b?.note);
    if (existingMarkers.has(id) || newMarkers.has(id)) skipped.push(`${id}: already in RECORD_MARKERS`);
    else if (marks.some((b) => b.on !== 'action' && b.on !== 'condition')) skipped.push(`${id}: marker "on" must be action or condition`);
    else {
      const dead = marks.filter((b) => (b.on === 'action' ? !core.actions?.[b.id] : !core.conditions?.[b.id]));
      if (dead.length) skipped.push(`${id}: marker points at no such ${dead[0].on}: ${dead.map((d) => d.id).join(', ')}`);
      else if (marks.length) newMarkers.set(id, marks.map((m) => ({ on: m.on, id: m.id, ...(m.value ? { value: String(m.value) } : {}), note: String(m.note) })));
    }
  }

  // ---- conditional bonuses -> the star registry ----
  // FEAT_SITUATIONAL is feat/classFeature ONLY: a heritage entry there breaks the registry test, so a
  // heritage's conditional bonus has no home and is recorded rather than mis-filed.
  const starEntries = Array.isArray(fix.situational) ? fix.situational.filter((b) => !(b?.on && b?.id)) : [];
  if (starEntries.length) {
    if (coll !== 'classFeatures') skipped.push(`${id}: FEAT_SITUATIONAL takes feats and class features only, not a ${coll} record`);
    else if (existingReg.has(id) || sitEntries.has(id)) skipped.push(`${id}: already in the situational registry`);
    else {
    const out = [];
    for (const b of starEntries) {
      const targets = (b.targets ?? []).filter((t) => {
        if (!KINDS.has(t.kind)) { skipped.push(`${id}: target kind "${t.kind}"`); return false; }
        if (t.kind === 'skill' && t.detail && t.detail !== 'all' && !t.detail.startsWith('lore:') && !SKILLS.has(t.detail)) { skipped.push(`${id}: unknown skill "${t.detail}"`); return false; }
        if (t.kind === 'save' && t.detail && !SAVES.has(t.detail)) { skipped.push(`${id}: unknown save "${t.detail}"`); return false; }
        return true;
      });
      if (!targets.length || !String(b.bonus ?? '').trim()) continue;
      const lits = targets.map((t) => {
        const bits = [`kind: '${t.kind}'`];
        if (t.detail) bits.push(`detail: '${esc(t.detail)}'`);
        if (t.dcOnly) bits.push('dcOnly: true');
        return `{ ${bits.join(', ')} }`;
      });
      out.push(`{ targets: [${lits.join(', ')}], when: "${esc(String(b.when ?? '').trim().slice(0, 90))}", bonus: "${esc(String(b.bonus).trim())}" }`);
    }
      if (out.length) sitEntries.set(id, out);
    }
  }

  // ---- a toggleable effect -> a mode ----
  if (fix.mode) {
    const m = fix.mode;
    const gate = (m?.feats ?? []).filter((f) => !core.feats[f] && !core.classFeatures[f]);
    if (!m?.id) skipped.push(`${id}: mode with no id`);
    else if (core.modes?.[m.id] || newModes.has(m.id)) skipped.push(`${id}: mode "${m.id}" already exists`);
    else if (gate.length) skipped.push(`${id}: mode gate not found: ${gate.join(', ')}`);
    else if (!m.fromItemId && !(m.feats ?? []).length) skipped.push(`${id}: mode with no gate — nothing would show it`);
    else if (!String(m.duration ?? '').trim()) skipped.push(`${id}: mode "${m.id}" does not say how long it lasts`);
    else newModes.set(m.id, { ...m, modifiers: m.modifiers ?? [] });
  }

  // ---- record fields ----
  const pairs = Object.entries(fix)
    .filter(([k]) => !META.has(k))
    .map(([field, raw]) => {
      let value = raw;
      if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* a plain string */ } }
      return { field, value };
    });
  if (!pairs.length) {
    // Only complain when NO lane took it — a marker-only or star-only fix is complete as it stands.
    if (!fix.mode && !markerEntries.length && !starEntries.length) skipped.push(`${id}: a MISS whose fix says nothing`);
    continue;
  }

  const r = core[coll][id];
  const reject = (why) => { skipped.push(`${id}: ${why}`); return true; };
  const bad = pairs.some(({ field, value }) => {
    if (!LEGAL_FIELDS.has(field)) return reject(`"${field}" is not a field on any record type`);
    if (JSON.stringify(r[field]) === JSON.stringify(value)) return false; // restating is a no-op
    if (!usedIn(coll, field)) return reject(`no ${coll} record carries "${field}" and nothing reads it there`);
    if (r[field] != null && !(Array.isArray(r[field]) && !r[field].length)) return reject(`already has ${field} — not overwriting`);
    if (field === 'critSpec' && value === true && !r.critSpecWeapons && !fix.critSpecWeapons) {
      return reject('critSpec:true with no critSpecWeapons would grant crit spec with EVERY weapon');
    }
    if (field === 'effectChoices') {
      const empty = (Array.isArray(value) ? value : []).filter((e) => !e?.options?.length && !e?.spellFilter);
      if (empty.length) return reject('effectChoices with no options and no spellFilter');
    }
    const ref = REFERENTIAL.get(field);
    if (ref) {
      const list = Array.isArray(value) ? value : [value];
      const dead = list.map((e) => ref.idOf(e)).filter((x) => x && !core[ref.coll]?.[x]);
      if (dead.length) return reject(`${field} names ${ref.coll} that do not exist: ${dead.slice(0, 3).join(', ')}`);
    }
    return false;
  });
  if (bad) continue;
  for (const { field, value } of pairs) fieldWrites.push({ id, coll, field, value });
}

console.log(`judged ${records.length} · not a MISS ${none}`);
console.log(`WRITING  ${sitEntries.size} situational · ${newMarkers.size} markers · ${fieldWrites.length} fields · ${newModes.size} modes`);
const byField = new Map();
for (const w of fieldWrites) byField.set(`${w.coll}.${w.field}`, (byField.get(`${w.coll}.${w.field}`) ?? 0) + 1);
for (const [f, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)} ${f}`);
console.log(`NEEDS ENGINE WORK: ${engineWork.length}`);
if (unresolved.length) console.log(`UNRESOLVED (placeholder left in the fix): ${unresolved.map((u) => u.id).join(', ')}`);
if (skipped.length) {
  console.log(`\nNOT APPLIED (${skipped.length}):`);
  for (const s of skipped.slice(0, 25)) console.log('   ' + s);
  if (skipped.length > 25) console.log(`   ...and ${skipped.length - 25} more`);
}

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

/** Refuse to write a file whose structure changed shape — the line-ending bug's only symptom was a
 *  parse error 300 lines from the damage. */
const guardShape = (file, before, after, exports) => {
  for (const name of exports) {
    const n = (s) => s.split(`export const ${name}`).length - 1;
    if (n(after) !== n(before)) throw new Error(`${file}: "export const ${name}" appears ${n(after)}x, was ${n(before)}x — refusing to write`);
  }
  const braces = (s) => (s.match(/^\};$/gm) ?? []).length;
  if (braces(after) !== braces(before)) throw new Error(`${file}: top-level "};" count changed — refusing to write`);
  writeFileSync(file, after);
};

const insert = (text, exportName, tag, banner, lines) => {
  if (!lines.length) return text;
  const open = text.indexOf(`export const ${exportName}`);
  const close = text.indexOf('\n};', open);
  return `${text.slice(0, close)}\n\n${tag}\n  // ${banner}\n${lines.join('\n')}${text.slice(close)}`;
};
regSrc = insert(
  regSrc, 'FEAT_SITUATIONAL', GEN_SIT,
  `${sitEntries.size} class features. Selected by what the record HAS, not by whether its text matched a pattern.`,
  [...sitEntries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, out]) => `  "${id}": [${out.join(', ')}],`),
);
regSrc = insert(
  regSrc, 'RECORD_MARKERS', GEN_MARK,
  `${newMarkers.size} records that change an ACTION or a CONDITION rather than a stat.`,
  [...newMarkers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  '${k}': ${JSON.stringify(v)},`),
);
guardShape(REGISTRY, regBefore, regSrc, ['FEAT_SITUATIONAL', 'RECORD_MARKERS']);

for (const w of fieldWrites) core[w.coll][w.id][w.field] = w.value;
for (const [mid, m] of newModes) { core.modes = core.modes ?? {}; core.modes[mid] = m; }
writeFileSync(p('public/core.json'), JSON.stringify(core));

// The overlay is the ONLY thing that carries record fields through `npm run data`.
const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let ovAdd = 0;
for (const w of fieldWrites) {
  if (!overlay.some((x) => x.category === w.coll && x.id === w.id && x.field === w.field)) {
    overlay.push({ category: w.coll, id: w.id, field: w.field, value: w.value });
    ovAdd++;
  }
}
writeFileSync(OVERLAY, JSON.stringify(overlay, null, 2) + '\n');
if (newModes.size) {
  const SRC = p('scripts/data/toggle-modes.json');
  const prev = existsSync(SRC) ? JSON.parse(readFileSync(SRC, 'utf8')) : {};
  for (const [mid, m] of newModes) prev[mid] = m;
  writeFileSync(SRC, JSON.stringify(prev, null, 2) + '\n');
}
writeFileSync(path.join(DIR, 'not-applied.json'), JSON.stringify({ skipped, engineWork, unresolved }, null, 1));
console.log(`\noverlay: ${ovAdd} added`);
console.log('written: src/rules/situationalBonuses.ts, public/core.json, scripts/data/effect-backfill.json');
