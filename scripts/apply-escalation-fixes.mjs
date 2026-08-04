/*
 * Applies the encoded answers to the escalated questions the triage marked DECIDABLE.
 *
 * Same discipline as every other applier here: nothing is written on trust. Field names come from
 * types.ts at run time, referenced ids are checked against core.json, and an existing registry key is
 * never given a second entry (the later one would silently win).
 *
 * Usage: node scripts/apply-escalation-fixes.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const DIR = p('work/escalation-triage');

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const typesSrc = readFileSync(p('src/rules/types.ts'), 'utf8');
const REGISTRY = p('src/rules/situationalBonuses.ts');
let regSrc = readFileSync(REGISTRY, 'utf8');

const LEGAL_FIELDS = new Set([...typesSrc.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]));
const SKILLS = new Set(typesSrc.match(/export const SKILLS = \[([\s\S]*?)\]/)[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)));
const SAVES = new Set(['fortitude', 'reflex', 'will', 'all']);
const KINDS = new Set(['skill', 'save', 'perception', 'ac', 'attack', 'strikeAttack', 'strikeDamage', 'speed', 'hp', 'classDc', 'spell', 'spellDamage', 'ability']);
const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'spells', 'deities', 'stances'];
const findColl = (id) => COLLECTIONS.find((c) => core[c]?.[id]);
const existingReg = new Set([...regSrc.matchAll(/^ {2}"([a-z0-9-]+)":\s\[/gm)].map((m) => m[1]));

/** ITEMS keep defences under passiveEffects; a top-level write there is inert (derive.ts reads only
 *  db.items[..].passiveEffects). The guard that checks "does any record carry this field" cannot see
 *  it, because 49 items already carry an inert top-level one. */
const ITEM_PASSIVE_FIELDS = new Set(['resistances', 'immunities', 'senses', 'speedPenalty']);

const fixes = [];
for (const f of readdirSync(DIR).filter((n) => /^encoded-\d+\.json$/.test(n)).sort()) {
  for (const x of JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).fixes ?? []) fixes.push(x);
}

// The adversary's rulings: a supplied correction replaces the fix; a bare rejection drops it.
const corrected = new Map();
const rejected = new Map();
for (const f of readdirSync(DIR).filter((n) => /^encoded-verify-\d+\.json$/.test(n)).sort()) {
  for (const r of JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).rulings ?? []) {
    if (r?.ok !== false) continue;
    // A correction of {"kind":"none"} is the adversary saying "drop it" — honour that as a drop.
    if (r.correction && Object.keys(r.correction).length && r.correction.kind !== 'none') corrected.set(r.id, r.correction);
    else rejected.set(r.id, r.problem ?? 'rejected by the adversary');
  }
}

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const skipped = [];
const sitEntries = new Map();
const replaces = new Set();
const fieldWrites = [];
const markerEntries = new Map();
let none = 0;

for (const raw of fixes) {
  const id = raw?.id;
  if (!id) continue;
  if (rejected.has(id)) { skipped.push(`${id}: ${rejected.get(id)}`); continue; }
  const fix = corrected.get(id) ?? raw;
  if (!fix.kind || fix.kind === 'none') { none++; continue; }
  const coll = findColl(id);
  if (!coll) { skipped.push(`${id}: not in any collection`); continue; }

  if (fix.kind === 'situational') {
    if (sitEntries.has(id)) { skipped.push(`${id}: duplicate fix in this batch — the first wins`); continue; }
    // An id that ALREADY has a shipped entry gets REPLACED, not appended. Eleven of these fixes are
    // refinements of existing entries (narrowing save 'all' to 'fortitude', broadening one to
    // Perception, adding a missing line), and appending would create a duplicate key whose later
    // copy silently shadows the first — while skipping would drop the refinement entirely. The
    // verify pass called this out by name as the failure a same-shaped applier would make.
    if (existingReg.has(id)) replaces.add(id);
    const out = [];
    for (const b of fix.entries ?? []) {
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
    continue;
  }

  if (fix.kind === 'field') {
    const field = fix.field;
    if (!LEGAL_FIELDS.has(field)) { skipped.push(`${id}: "${field}" is not a field on any record type`); continue; }
    // effectChoices are RENDERED only for feats (Builder.tsx:1422) and heritages (shared.tsx:2496).
    // On an item, class feature or background the pick is resolved by build.ts but never OFFERED, so
    // the player can never make it — authored data that does nothing. 50 records are already in that
    // state; this refuses to add more until those pickers exist.
    if (field === 'effectChoices' && coll !== 'feats' && coll !== 'heritages') {
      skipped.push(`${id}: effectChoices on a ${coll} — no picker renders it, so the pick could never be made`);
      continue;
    }
    const rec = core[coll][id];
    let holder = rec;
    let underPassive = false;
    if (coll === 'items' && ITEM_PASSIVE_FIELDS.has(field)) {
      rec.passiveEffects = rec.passiveEffects ?? {};
      holder = rec.passiveEffects;
      underPassive = true;
    }
    if (holder[field] != null && !(Array.isArray(holder[field]) && !holder[field].length)) { skipped.push(`${id}: already has ${underPassive ? 'passiveEffects.' : ''}${field} — not overwriting`); continue; }
    fieldWrites.push({ coll, id, field, value: fix.value, underPassive });
    continue;
  }

  if (fix.kind === 'marker') {
    const lits = [];
    for (const mk of fix.marks ?? []) {
      const on = mk.on === 'condition' ? 'condition' : 'action';
      const target = mk.id ?? mk.targetId;
      const bucket = on === 'action' ? core.actions : core.conditions;
      if (!target || !bucket?.[target]) { skipped.push(`${id}: ${on} "${target}" not in core.json`); continue; }
      const bits = [`on: '${on}'`, `id: '${esc(target)}'`];
      if (mk.value) bits.push(`value: "${esc(mk.value)}"`);
      bits.push(`note: "${esc(String(mk.note ?? '').slice(0, 90))}"`);
      lits.push(`{ ${bits.join(', ')} }`);
    }
    if (lits.length) markerEntries.set(id, lits);
    continue;
  }

  skipped.push(`${id}: unrecognised fix kind "${fix.kind}"`);
}

console.log(`encoded ${fixes.length} · needs nothing ${none} · writing ${sitEntries.size} situational, ${fieldWrites.length} fields, ${markerEntries.size} markers`);
const byField = new Map();
for (const w of fieldWrites) byField.set(w.field, (byField.get(w.field) ?? 0) + 1);
for (const [f, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)} ${f}`);
if (skipped.length) { console.log(`\nNOT APPLIED (${skipped.length}):`); for (const s of skipped.slice(0, 30)) console.log('   ' + s); if (skipped.length > 30) console.log(`   ...and ${skipped.length - 30} more`); }

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

const MARKER = '  // ---- escalated decisions, answered from the rules (scripts/apply-escalation-fixes.mjs)';
{
  const at = regSrc.indexOf(MARKER);
  if (at >= 0) regSrc = regSrc.slice(0, regSrc.lastIndexOf('\n\n', at)) + regSrc.slice(regSrc.indexOf('\n};', at));
}
for (const id of replaces) {
  const entries = sitEntries.get(id);
  if (!entries) continue;
  const line = `  "` + id + `": [` + entries.join(", ") + `],`;
  const re = new RegExp('^ {2}"' + id + '": \\[.*$', 'm');
  if (re.test(regSrc)) { regSrc = regSrc.replace(re, line); sitEntries.delete(id); }
}
const lines = [...sitEntries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, out]) => `  "${id}": [${out.join(', ')}],`);
if (lines.length) {
  const banner = `\n\n${MARKER} — do not hand-edit below ----\n  // ${lines.length} questions the triage decided from the rules, then an adversary re-checked.\n`;
  const open = regSrc.indexOf('export const FEAT_SITUATIONAL: Record<string, SituationalBonus[]> = {');
  const close = regSrc.indexOf('\n};', open);
  regSrc = regSrc.slice(0, close) + banner + lines.join('\n') + regSrc.slice(close);
}
if (markerEntries.size) {
  const decl = 'export const RECORD_MARKERS: Record<string, RecordMarker[]> =';
  const at = regSrc.indexOf(decl);
  const open = regSrc.indexOf('{', at + decl.length - 1);
  const body = regSrc.slice(open + 1, regSrc.indexOf('\n};', open) + 1);
  const have = new Set([...body.matchAll(/^\s*"([a-z0-9-]+)":/gm)].map((m) => m[1]));
  const add = [...markerEntries.entries()].filter(([k]) => !have.has(k)).map(([k, v]) => `  "${k}": [${v.join(', ')}],`);
  if (add.length) regSrc = regSrc.slice(0, open + 1) + '\n' + add.join('\n') + regSrc.slice(open + 1);
}
writeFileSync(REGISTRY, regSrc);

for (const w of fieldWrites) {
  const rec = core[w.coll][w.id];
  if (w.underPassive) { rec.passiveEffects = rec.passiveEffects ?? {}; rec.passiveEffects[w.field] = w.value; }
  else rec[w.field] = w.value;
}
writeFileSync(p('public/core.json'), JSON.stringify(core));

const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let ovAdd = 0;
for (const w of fieldWrites) {
  const field = w.underPassive ? 'passiveEffects' : w.field;
  const value = w.underPassive ? core[w.coll][w.id].passiveEffects : w.value;
  if (!overlay.some((x) => x.category === w.coll && x.id === w.id && x.field === field)) { overlay.push({ category: w.coll, id: w.id, field, value }); ovAdd++; }
}
writeFileSync(OVERLAY, JSON.stringify(overlay, null, 2) + '\n');
writeFileSync(path.join(DIR, 'not-applied.json'), JSON.stringify({ skipped }, null, 1));
console.log(`\noverlay: ${ovAdd} added`);
console.log('written: src/rules/situationalBonuses.ts, public/core.json, scripts/data/effect-backfill.json');
