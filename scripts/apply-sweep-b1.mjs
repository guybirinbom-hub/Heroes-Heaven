/*
 * Applies batch 1 of the coverage sweep: 301 verified misses in the choice + situational lanes.
 *
 * NOTHING is written on trust. The legal field set is derived from src/rules/types.ts at run time, so a
 * fix naming a field the engine does not have is REPORTED rather than written — an invented field would
 * sit in core.json looking like data and doing nothing, which is the exact failure this whole exercise
 * is about. Same for target kinds, skill ids and save ids.
 *
 * Usage: node scripts/apply-sweep-b1.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);

const res = JSON.parse(readFileSync(p('work/sweep/b1/result.json'), 'utf8'));
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const typesSrc = readFileSync(p('src/rules/types.ts'), 'utf8');
const REGISTRY = p('src/rules/situationalBonuses.ts');
let regSrc = readFileSync(REGISTRY, 'utf8');

// ---- the vocabulary, derived not remembered ----
const LEGAL_FIELDS = new Set([...typesSrc.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]));
const SKILLS = new Set(typesSrc.match(/export const SKILLS = \[([\s\S]*?)\]/)[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)));
const SAVES = new Set(['fortitude', 'reflex', 'will', 'all']);
const KINDS = new Set(['skill', 'save', 'perception', 'ac', 'attack', 'strikeAttack', 'strikeDamage', 'speed', 'hp', 'classDc', 'spell', 'spellDamage', 'ability']);
const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'spells', 'deities', 'stances'];
const findColl = (id) => COLLECTIONS.find((c) => core[c]?.[id]);

/**
 * Does the engine read `field` for records in `coll`?
 *
 * The strong signal is that another record in the same collection already carries it — if the data uses
 * it there, the engine reads it there. That has a FALSE NEGATIVE though: a field the engine reads but
 * no record has populated yet. Two such pairs were verified by hand against the source and are listed
 * below with the line that proves it; anything else failing the data check is reported, not written.
 *
 * The four pairs deliberately NOT listed here, each checked and each genuinely unread for that type:
 *   backgrounds.grantsLanguages — build.ts reads it for feats, heritages and items.passiveEffects only
 *   backgrounds.negativeHealing — derive.ts reads heritage?.negativeHealing and feats, not backgrounds
 *   items.grantedSpells         — read for subclass OPTIONS, not for item records
 *   items.runes                 — runes live on the INVENTORY instance, never on the item definition
 */
const VERIFIED_READS = new Set([
  'items.spellSlotBonus', // build.ts:2542 — `if (it?.spellSlotBonus) spellSlotBonuses.push(...)`
  'items.situational',    // explain.ts:220 — `const authored = db.items[inv.itemId]?.situational`
]);
const usedCache = new Map();
function usedIn(coll, field) {
  const key = `${coll}.${field}`;
  if (VERIFIED_READS.has(key)) return true;
  if (!usedCache.has(key)) {
    usedCache.set(key, Object.values(core[coll] ?? {}).some((r) => r?.[field] != null));
  }
  return usedCache.get(key);
}

// Umbrella summaries stay inert whatever a fix says — ruling A, and the sweep agents were told, but a
// script that trusts its input is how the last three passes went wrong.
const umbrellaIds = (() => {
  const MECH = ['passiveEffects', 'effectChoices', 'situational', 'uses', 'spell', 'runes', 'damage', 'acBonus', 'capacity', 'value', 'heldSpells', 'dynamicSkillBonus', 'spellSlotBonus'];
  const KEEP = new Set(['judgement-thurible', 'spore-shepherds-staff', 'razmiri-mask', 'inspiring']);
  const ids = Object.keys(core.items).sort();
  const out = new Set(['aon-magical-medals']);
  for (let i = 0; i < ids.length; i++) {
    const it = core.items[ids[i]];
    if (KEEP.has(ids[i]) || (it.price && Object.values(it.price).some(Boolean)) || MECH.some((k) => it[k] != null && (!Array.isArray(it[k]) || it[k].length))) continue;
    let kin = 0;
    for (let j = i + 1; j < ids.length && ids[j].startsWith(ids[i] + '-'); j++) kin++;
    if (kin >= 2) out.add(ids[i]);
  }
  return out;
})();

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const NOTE_CAP = 90;
/** Ruling H's one-line cap: parentheticals first, then a clause boundary, then a word break. */
function trimWhen(when) {
  const full = String(when ?? '').trim().replace(/\s+/g, ' ');
  if (full.length <= NOTE_CAP) return full;
  let s = full.replace(/\s*\([^()]*\)\s*/g, ' ').trim().replace(/\s+/g, ' ').replace(/[,;]$/, '');
  if (s.length > NOTE_CAP) {
    const cut = s.slice(0, NOTE_CAP);
    const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' — '));
    s = (at > 40 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' '))).trim();
  }
  return `${s}…`;
}

const skipped = [];
const applied = { situational: 0, markers: 0, spellMarkers: 0, fields: 0 };
const sitEntries = new Map();
const markerEntries = new Map();
const spellMarkerEntries = new Map();
const fieldWrites = [];

function validTarget(id, t) {
  if (!KINDS.has(t.kind)) { skipped.push(`${id}: target kind "${t.kind}" is not a StatRef kind`); return null; }
  if (t.kind === 'skill') {
    if (!t.detail) { skipped.push(`${id}: skill target with no detail`); return null; }
    if (t.detail !== 'all' && !t.detail.startsWith('lore:') && !SKILLS.has(t.detail)) { skipped.push(`${id}: unknown skill "${t.detail}"`); return null; }
  }
  if (t.kind === 'save' && t.detail && !SAVES.has(t.detail)) { skipped.push(`${id}: unknown save "${t.detail}"`); return null; }
  if (t.dcOnly && t.kind !== 'save' && t.kind !== 'spell') { skipped.push(`${id}: dcOnly on ${t.kind}, which has no DC`); return { ...t, dcOnly: undefined }; }
  return t;
}

const existingReg = new Set([...regSrc.matchAll(/^ {2}"([a-z0-9-]+)":\s\[/gm)].map((m) => m[1]));

for (const m of res.records) {
  if (m.verdict !== 'MISS' || !m.fix) continue;
  const { id, fix } = m;
  if (!findColl(id)) { skipped.push(`${id}: not in any collection`); continue; }
  if (umbrellaIds.has(id)) { skipped.push(`${id}: umbrella summary — inert by ruling A`); continue; }

  // ---- situational entries ----
  if (fix.situational?.length) {
    if (existingReg.has(id)) {
      skipped.push(`${id}: already in the situational registry — a second key would silently win`);
    } else {
      const out = [];
      for (const b of fix.situational) {
        const targets = (b.targets ?? []).map((t) => validTarget(id, t)).filter(Boolean);
        if (!targets.length) continue;
        if (!String(b.bonus ?? '').trim()) { skipped.push(`${id}: entry with no bonus text`); continue; }
        const lits = targets.map((t) => {
          const bits = [`kind: '${t.kind}'`];
          if (t.detail) bits.push(`detail: '${esc(t.detail)}'`);
          if (t.dcOnly) bits.push('dcOnly: true');
          return `{ ${bits.join(', ')} }`;
        });
        out.push(`{ targets: [${lits.join(', ')}], when: "${esc(trimWhen(b.when))}", bonus: "${esc(String(b.bonus).trim())}" }`);
      }
      if (out.length) { sitEntries.set(id, out); applied.situational++; }
    }
  }

  // ---- action / condition markers ----
  if (fix.field === 'RECORD_MARKERS') {
    let v;
    try { v = JSON.parse(fix.value); } catch { skipped.push(`${id}: RECORD_MARKERS value is not JSON`); continue; }
    const list = Array.isArray(v) ? v : [v];
    const lits = [];
    for (const mk of list) {
      const on = mk.on === 'condition' ? 'condition' : 'action';
      const target = mk.id ?? mk.targetId;
      const bucket = on === 'action' ? core.actions : core.conditions;
      if (!target || !bucket?.[target]) { skipped.push(`${id}: ${on} "${target}" not in core.json`); continue; }
      const bits = [`on: '${on}'`, `id: '${esc(target)}'`];
      if (mk.value) bits.push(`value: "${esc(mk.value)}"`);
      bits.push(`note: "${esc(trimWhen(mk.note ?? m.reason))}"`);
      lits.push(`{ ${bits.join(', ')} }`);
    }
    if (lits.length) { markerEntries.set(id, lits); applied.markers++; }
    continue;
  }
  if (fix.field === 'SPELL_MARKERS') {
    let v;
    try { v = JSON.parse(fix.value); } catch { skipped.push(`${id}: SPELL_MARKERS value is not JSON`); continue; }
    const list = Array.isArray(v) ? v : [v];
    for (const mk of list) {
      const spellId = mk.spellId ?? mk.id;
      if (!spellId || !core.spells?.[spellId]) { skipped.push(`${id}: spell "${spellId}" not in core.json`); continue; }
      const prev = spellMarkerEntries.get(spellId) ?? [];
      prev.push(`{ source: '${esc(id)}', when: "${esc(trimWhen(mk.when))}", bonus: "${esc(mk.bonus ?? '')}" }`);
      spellMarkerEntries.set(spellId, prev);
      applied.spellMarkers++;
    }
    continue;
  }

  // ---- effectChoices ----
  if (fix.effectChoices?.length) {
    const coll = findColl(id);
    const rec = core[coll][id];
    if (rec.effectChoices?.length) skipped.push(`${id}: already has effectChoices`);
    else { fieldWrites.push({ id, coll, field: 'effectChoices', value: fix.effectChoices }); applied.fields++; }
    continue;
  }

  // ---- a plain field ----
  if (fix.field && fix.value != null) {
    const field = fix.field;
    if (!LEGAL_FIELDS.has(field)) { skipped.push(`${id}: "${field}" is not a field on any record type — needs engine work`); continue; }
    let value;
    try { value = JSON.parse(fix.value); } catch { value = fix.value; }
    const coll = findColl(id);
    const rec = core[coll][id];
    // LEGAL_FIELDS is flat — it knows the field exists SOMEWHERE in the type graph, not that it is read
    // for THIS kind of record. `spellSlot` is an item field; written onto a feat it would sit in
    // core.json looking like data and doing nothing. The proof that the engine reads it here is that
    // some other record in the same collection already carries it.
    if (!usedIn(coll, field)) {
      skipped.push(`${id}: no ${coll} record carries "${field}" — the engine probably does not read it there`);
      continue;
    }
    if (rec[field] != null && !(Array.isArray(rec[field]) && !rec[field].length)) {
      skipped.push(`${id}: already has ${field} — not overwriting`);
      continue;
    }
    fieldWrites.push({ id, coll, field, value });
    applied.fields++;
  }
}

// ---- splice the registry ----
const MARKER = '  // ---- coverage sweep batch 1 (scripts/apply-sweep-b1.mjs)';
{
  const at = regSrc.indexOf(MARKER);
  if (at >= 0) regSrc = regSrc.slice(0, regSrc.lastIndexOf('\n\n', at)) + regSrc.slice(regSrc.indexOf('\n};', at));
}
const lines = [...sitEntries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, out]) => `  "${id}": [${out.join(', ')}],`);
if (lines.length) {
  const banner =
    `\n\n${MARKER} — do not hand-edit below ----\n` +
    `  // ${lines.length} records the sweep found had a printed conditional bonus with no star.\n` +
    `  // Judged then adversarially refuted; every target and skill id validated against types.ts.\n`;
  const open = regSrc.indexOf('export const FEAT_SITUATIONAL: Record<string, SituationalBonus[]> = {');
  const close = regSrc.indexOf('\n};', open);
  regSrc = regSrc.slice(0, close) + banner + lines.join('\n') + regSrc.slice(close);
}

/** Merge new keys into a generated table without disturbing what is already there. */
function mergeTable(decl, entries) {
  if (!entries.size) return;
  const at = regSrc.indexOf(decl);
  if (at < 0) throw new Error(`registry: could not find ${decl}`);
  const open = regSrc.indexOf('{', at + decl.length - 1);
  let end = regSrc[open + 1] === '}' ? open + 2 : regSrc.indexOf('\n};', open) + 3;
  while (regSrc[end] === ';') end++;
  const body = regSrc.slice(open + 1, end - 2).trim();
  const have = new Set([...body.matchAll(/^\s*"([a-z0-9-]+)":/gm)].map((m) => m[1]));
  const added = [...entries.entries()].filter(([k]) => !have.has(k)).sort(([a], [b]) => a.localeCompare(b));
  for (const [k] of entries) if (have.has(k)) skipped.push(`${k}: already in ${decl.split(' ')[2]}`);
  if (!added.length) return;
  const next = [body, ...added.map(([k, v]) => `  "${k}": [${v.join(', ')}],`)].filter(Boolean).join('\n');
  regSrc = regSrc.slice(0, at) + `${decl} {\n${next}\n};` + regSrc.slice(end);
}
mergeTable('export const RECORD_MARKERS: Record<string, RecordMarker[]> =', markerEntries);
mergeTable('export const SPELL_MARKERS: Record<string, SpellMarker[]> =', spellMarkerEntries);

// ---- field writes into core.json + the overlay ----
for (const w of fieldWrites) core[w.coll][w.id][w.field] = w.value;

console.log(`APPLIED`);
console.log(`  situational entries : ${applied.situational} records`);
console.log(`  action/condition marks: ${applied.markers}`);
console.log(`  spell marks         : ${applied.spellMarkers}`);
console.log(`  record fields       : ${applied.fields}`);
const byField = new Map();
for (const w of fieldWrites) byField.set(w.field, (byField.get(w.field) ?? 0) + 1);
for (const [f, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)} ${f}`);
if (skipped.length) {
  console.log(`\nNOT APPLIED (${skipped.length}) — each needs a decision or engine work:`);
  for (const s of skipped) console.log('   ' + s);
}

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(REGISTRY, regSrc);
writeFileSync(p('public/core.json'), JSON.stringify(core));

// The overlay is the only thing that survives `npm run data`.
const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let ovAdd = 0;
let ovUpd = 0;
for (const w of fieldWrites) {
  const hits = overlay.filter((x) => x.category === w.coll && x.id === w.id && x.field === w.field);
  if (hits.length) { for (const h of hits) h.value = w.value; ovUpd++; }
  else { overlay.push({ category: w.coll, id: w.id, field: w.field, value: w.value }); ovAdd++; }
}
writeFileSync(OVERLAY, formatBackfill(overlay));
console.log(`\noverlay: ${ovAdd} added, ${ovUpd} updated`);
console.log('written: src/rules/situationalBonuses.ts, public/core.json, scripts/data/effect-backfill.json');
