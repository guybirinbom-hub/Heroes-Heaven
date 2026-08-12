/*
 * Applies a coverage-sweep batch. Generic successor to apply-sweep-b1/b2.mjs.
 *
 * NOTHING is written on trust. The legal field set, skill ids, sense names, spell ids and feat ids
 * are all derived from the repo at run time, so a fix naming something the engine does not have is
 * REPORTED rather than written. An invented field sits in core.json looking like data and doing
 * nothing — the exact failure this whole exercise exists to undo. Every guard below exists because
 * an adversarial pass caught a real bad write:
 *
 *   b1  invented field names          -> LEGAL_FIELDS, derived from types.ts
 *       a field legal SOMEWHERE       -> usedIn(), per collection
 *   b2  items store defences under passiveEffects, never top-level (usedIn cannot see this)
 *       effectChoices with no options -> renders an empty picker while the audit says "fixed"
 *       stance/mode toggles           -> provably unreachable, deferred instead of written
 *   b3  a granted spell or feat id that does not exist -> referential check against core.json
 *
 * Usage: node scripts/apply-sweep.mjs <batch> [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const batch = process.argv[2];
if (!batch || batch.startsWith('--')) { console.error('usage: node scripts/apply-sweep.mjs <batch> [--dry]'); process.exit(2); }
const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);

const res = JSON.parse(readFileSync(p(`work/sweep/${batch}/result.json`), 'utf8'));
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const typesSrc = readFileSync(p('src/rules/types.ts'), 'utf8');
const REGISTRY = p('src/rules/situationalBonuses.ts');
let regSrc = readFileSync(REGISTRY, 'utf8');

// ---- vocabulary, derived not remembered ----
const LEGAL_FIELDS = new Set([...typesSrc.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]));
const SKILLS = new Set(typesSrc.match(/export const SKILLS = \[([\s\S]*?)\]/)[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)));
const SAVES = new Set(['fortitude', 'reflex', 'will', 'all']);
const KINDS = new Set(['skill', 'save', 'perception', 'ac', 'attack', 'strikeAttack', 'strikeDamage', 'speed', 'hp', 'classDc', 'spell', 'spellDamage', 'ability']);
const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'spells', 'deities', 'stances'];
const findColl = (id) => COLLECTIONS.find((c) => core[c]?.[id]);

function observedVocab(field, keyOf) {
  const s = new Set();
  for (const coll of COLLECTIONS) for (const r of Object.values(core[coll] ?? {})) {
    const v = r?.[field];
    if (Array.isArray(v)) for (const e of v) { const k = keyOf(e); if (k) s.add(k); }
  }
  return s;
}
const lower = (x) => (typeof x === 'string' ? x.toLowerCase() : null);

/** field -> how to identify "the same entry", so a merge can tell new from duplicate. */
const ARRAY_MERGE = new Map([
  ['immunities', (x) => lower(x)],
  ['resistances', (x) => lower(x?.type)],
  ['weaknesses', (x) => lower(x?.type)],
  ['senses', (x) => lower(x?.name)],
  ['speeds', (x) => lower(x?.type)],
  // b3 lanes
  ['innateSpells', (x) => lower(x?.spellId)],
  ['focusSpells', (x) => lower(x)],
  ['grantsFeats', (x) => lower(x)],
]);
const STRICT_VOCAB = new Set(['senses', 'speeds']);
const VOCAB = new Map([...ARRAY_MERGE].map(([f, k]) => [f, observedVocab(f, k)]));

/**
 * A granted spell or feat that does not exist is worse than no grant: the sheet shows a row that
 * opens nothing. referential-integrity.test.ts fails on it, but far downstream of the cause.
 * field -> (entry) => the id it must resolve to, and which collection it must resolve in.
 */
const REFERENTIAL = new Map([
  ['innateSpells', { coll: 'spells', idOf: (e) => e?.spellId }],
  ['focusSpells', { coll: 'spells', idOf: (e) => e }],
  ['grantsFeats', { coll: 'feats', idOf: (e) => e }],
  ['grantedFeatId', { coll: 'feats', idOf: (e) => e }],
]);

/**
 * Feats a record ALREADY grants through a class option, keyed by the option id.
 *
 * A class extra-choice option and a classFeature can share an id. Born of the Bones of the Earth is
 * both `classFeatures['born-of-the-bones-of-the-earth']` and
 * `classes.exemplar.extraChoices[2].options[0]`, and the OPTION already carries
 * `grantedChoiceFeats: [{featId:'energized-spark', restrictTo:['earth','fire']}]`.
 *
 * Writing a plain `grantsFeats:['energized-spark']` onto the classFeature grants the same feat a
 * SECOND time with no restriction, and the unrestricted grant wins — the player silently loses the
 * earth/fire narrowing and picks from all twelve elements. feature-gaps.test.ts caught it. Nothing
 * about the classFeature record itself reveals the collision, so it is computed here.
 */
const grantedByOption = (() => {
  const map = new Map();
  const add = (id, featId) => {
    if (!id || !featId) return;
    if (!map.has(id)) map.set(id, new Set());
    map.get(id).add(featId);
  };
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.id) {
      for (const g of o.grantedChoiceFeats ?? []) add(o.id, g?.featId);
      for (const f of o.grants?.feats ?? []) add(o.id, typeof f === 'string' ? f : f?.featId);
      if (o.grantedFeatId) add(o.id, o.grantedFeatId);
      for (const f of o.grantsFeats ?? []) add(o.id, f);
    }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(core.classes);
  return map;
})();

const VERIFIED_READS = new Set([
  'items.spellSlotBonus', // build.ts:2542
  'items.situational',    // explain.ts:220
]);
const usedCache = new Map();
function usedIn(coll, field) {
  const key = `${coll}.${field}`;
  if (VERIFIED_READS.has(key)) return true;
  if (!usedCache.has(key)) usedCache.set(key, Object.values(core[coll] ?? {}).some((r) => r?.[field] != null));
  return usedCache.get(key);
}

/* ITEMS STORE DEFENCES UNDER passiveEffects. derive.ts reads db.items[..].passiveEffects only
 * (709-711, 1667-1673); there is no read of a top-level item.resistances anywhere in src. usedIn()
 * cannot catch it — 49 item records carry a top-level one, so the guard says "the engine reads it
 * here". It does not. Those are inert leftovers. */
const ITEM_PASSIVE_FIELDS = new Set(['resistances', 'immunities', 'senses', 'speedPenalty']);
const ITEM_UNSUPPORTED = new Map([
  ['weaknesses', 'ItemPassiveEffects has no weaknesses key'],
  ['speeds', 'passiveEffects.speeds is SpeedGrants, a different shape from the top-level list'],
  ['landSpeedBonus', 'the item-side name is passiveEffects.speedBonus, and the shapes differ'],
  ['landSpeedMin', 'no item-side equivalent'],
]);

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
const applied = { situational: 0, fieldsNew: 0, arraysMerged: 0, entriesAdded: 0, intoPassive: 0 };
const sitEntries = new Map();
const fieldWrites = [];
const deferredToggles = [];
const engineWork = [];
let recovered = 0;

function validTarget(id, t) {
  if (!KINDS.has(t.kind)) { skipped.push(`${id}: target kind "${t.kind}" is not a StatRef kind`); return null; }
  if (t.kind === 'skill') {
    if (!t.detail) { skipped.push(`${id}: skill target with no detail`); return null; }
    if (t.detail !== 'all' && !t.detail.startsWith('lore:') && !SKILLS.has(t.detail)) { skipped.push(`${id}: unknown skill "${t.detail}"`); return null; }
  }
  if (t.kind === 'save' && t.detail && !SAVES.has(t.detail)) { skipped.push(`${id}: unknown save "${t.detail}"`); return null; }
  if (t.dcOnly && t.kind !== 'save' && t.kind !== 'spell') return { ...t, dcOnly: undefined };
  return t;
}

const existingReg = new Set([...regSrc.matchAll(/^ {2}"([a-z0-9-]+)":\s\[/gm)].map((m) => m[1]));

for (const m of res.records) {
  if (m.verdict !== 'MISS' || !m.fix) continue;
  const { id, fix } = m;
  const coll = findColl(id);
  if (!coll) { skipped.push(`${id}: not in any collection`); continue; }
  if (umbrellaIds.has(id)) { skipped.push(`${id}: umbrella summary — inert by ruling A`); continue; }

  if (fix.situational?.length) {
    if (existingReg.has(id)) { skipped.push(`${id}: already in the situational registry — a second key would silently win`); continue; }
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
    continue;
  }

  /* Toggles are deferred, not written. MainTab.tsx:222 builds the stance list from character.feats
   * where the feat carries the 'stance' trait — so item-keyed entries and non-stance feats can never
   * surface. Writing them would record the gap as fixed while changing nothing. */
  if (fix.toggle) {
    deferredToggles.push({ id, name: m.name, collection: coll, lane: m.lane, effects: fix.toggle.effects ?? m.reason ?? '' });
    continue;
  }

  // "No field exists for this" is a verdict, not a shape to salvage — check it BEFORE trying to
  // recover a field, or the recovery below happily mistakes the explanatory prose for the fix.
  if (fix.needsEngineWork && !fix.field) { engineWork.push({ id, name: m.name, lane: m.lane, reason: m.reason }); continue; }

  let field = fix.field;
  let rawValue = fix.value;
  if (!field) {
    // Some agents return the field inline ({"landSpeedMin":20}) instead of {field,value}. Recover it
    // rather than lose the finding to a formatting slip — but NEVER from a key that is merely prose.
    // `note` is a real field on stances, so an unguarded scan turned {needsEngineWork,note:"..."}
    // into a write of field "note" onto 32 items. Metadata keys are excluded explicitly.
    const META = new Set(['note', 'name', 'description', 'id', 'reason', 'prompt', 'value', 'field']);
    const inline = Object.keys(fix).filter((k) => LEGAL_FIELDS.has(k) && !META.has(k));
    if (inline.length === 1) { field = inline[0]; rawValue = JSON.stringify(fix[field]); recovered++; }
  }
  if (!field || rawValue == null) { skipped.push(`${id}: MISS with no applicable fix`); continue; }
  if (!LEGAL_FIELDS.has(field)) { skipped.push(`${id}: "${field}" is not a field on any record type — needs engine work`); continue; }

  let value;
  try { value = JSON.parse(rawValue); } catch { value = rawValue; }
  const rec = core[coll][id];

  if (field === 'effectChoices') {
    const bad = (Array.isArray(value) ? value : []).filter((e) => !e?.options?.length && !e?.spellFilter);
    if (bad.length) { skipped.push(`${id}: effectChoices with no options and no spellFilter — a feat-pick belongs in featPickGrants.ts`); continue; }
  }

  /* OVER-GRANT GUARD. derive.ts weaponMatches() line 1167 is `if (!w) return true` — so a bare
   * `critSpec: true` with no `critSpecWeapons` narrowing matches EVERY strike, handing the character
   * critical specialization with every weapon they own. Viking Weapon Specialist's fix was exactly
   * that. A silently too-generous grant is harder to notice than a missing one. */
  if (field === 'critSpec' && value === true) {
    const narrowing = rec.critSpecWeapons ?? (typeof fix.critSpecWeapons === 'object' ? fix.critSpecWeapons : null);
    if (!narrowing) { skipped.push(`${id}: critSpec:true with no critSpecWeapons would grant crit spec with EVERY weapon`); continue; }
  }

  /* INERT-WRITE GUARD. build.ts:336-341 resolves grantedFeatByChoice through
   * `skillChoice ?? bg.trainedSkillChoice[0]`. With neither present the lookup yields nothing and the
   * code falls through to grantedFeatId — so the map is dead weight. */
  if (field === 'grantedFeatByChoice' && !rec.trainedSkillChoice?.length && !fix.trainedSkillChoice) {
    skipped.push(`${id}: grantedFeatByChoice is inert without trainedSkillChoice (build.ts:339 keys off it)`);
    continue;
  }

  /* DUPLICATE-GRANT GUARD. See grantedByOption above — a second, unrestricted grant of a feat the
   * record's class option already grants with a restriction silently removes the restriction. */
  if (field === 'grantsFeats' || field === 'grantedFeatId') {
    const already = grantedByOption.get(id);
    if (already) {
      const clash = (Array.isArray(value) ? value : [value]).filter((f) => already.has(f));
      if (clash.length) { skipped.push(`${id}: a class option already grants ${clash.join(', ')} — a second grant would drop its restriction`); continue; }
    }
  }

  // A grant must point at content that exists.
  const ref = REFERENTIAL.get(field);
  if (ref) {
    const list = Array.isArray(value) ? value : [value];
    const dead = list.map((e) => ref.idOf(e)).filter((x) => x && !core[ref.coll]?.[x]);
    if (dead.length) { skipped.push(`${id}: ${field} names ${ref.coll} that do not exist: ${dead.slice(0, 3).join(', ')}`); continue; }
  }

  let holder = rec;
  let underPassive = false;
  if (coll === 'items') {
    if (ITEM_UNSUPPORTED.has(field)) { skipped.push(`${id}: ${field} on an item — ${ITEM_UNSUPPORTED.get(field)}`); continue; }
    if (ITEM_PASSIVE_FIELDS.has(field)) { rec.passiveEffects = rec.passiveEffects ?? {}; holder = rec.passiveEffects; underPassive = true; }
  }
  if (!underPassive && !usedIn(coll, field)) { skipped.push(`${id}: no ${coll} record carries "${field}" — the engine probably does not read it there`); continue; }

  const merger = ARRAY_MERGE.get(field);
  if (merger) {
    const incoming = Array.isArray(value) ? value : [value];
    const vocab = VOCAB.get(field);
    const existing = Array.isArray(holder[field]) ? holder[field] : [];
    const have = new Set(existing.map(merger).filter(Boolean));
    const add = [];
    for (const e of incoming) {
      const k = merger(e);
      if (!k) { skipped.push(`${id}: malformed ${field} entry ${JSON.stringify(e).slice(0, 60)}`); continue; }
      if (have.has(k)) continue; // existing entry always wins, never overwritten
      if (STRICT_VOCAB.has(field) && !vocab.has(k)) { skipped.push(`${id}: ${field} "${k}" is not a value the engine uses`); continue; }
      have.add(k);
      add.push(e);
    }
    if (!add.length) { skipped.push(`${id}: ${field} — nothing new to add`); continue; }
    fieldWrites.push({ id, coll, field, value: [...existing, ...add], underPassive });
    if (existing.length) applied.arraysMerged++; else applied.fieldsNew++;
    if (underPassive) applied.intoPassive++;
    applied.entriesAdded += add.length;
    continue;
  }

  if (holder[field] != null && !(Array.isArray(holder[field]) && !holder[field].length)) { skipped.push(`${id}: already has ${underPassive ? 'passiveEffects.' : ''}${field} — not overwriting`); continue; }
  fieldWrites.push({ id, coll, field, value, underPassive });
  applied.fieldsNew++;
  if (underPassive) applied.intoPassive++;
}

// ---- splice the registry ----
const MARKER = `  // ---- coverage sweep ${batch} (scripts/apply-sweep.mjs)`;
{
  const at = regSrc.indexOf(MARKER);
  if (at >= 0) regSrc = regSrc.slice(0, regSrc.lastIndexOf('\n\n', at)) + regSrc.slice(regSrc.indexOf('\n};', at));
}
const lines = [...sitEntries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, out]) => `  "${id}": [${out.join(', ')}],`);
if (lines.length) {
  const banner =
    `\n\n${MARKER} — do not hand-edit below ----\n` +
    `  // ${lines.length} records with a printed conditional bonus and no star.\n` +
    `  // Judged then adversarially refuted; every target and skill id validated against types.ts.\n`;
  const open = regSrc.indexOf('export const FEAT_SITUATIONAL: Record<string, SituationalBonus[]> = {');
  const close = regSrc.indexOf('\n};', open);
  regSrc = regSrc.slice(0, close) + banner + lines.join('\n') + regSrc.slice(close);
}

for (const w of fieldWrites) {
  const rec = core[w.coll][w.id];
  if (w.underPassive) { rec.passiveEffects = rec.passiveEffects ?? {}; rec.passiveEffects[w.field] = w.value; }
  else rec[w.field] = w.value;
}

console.log(`APPLIED  (batch ${batch})`);
console.log(`  situational entries   : ${applied.situational} records`);
console.log(`  fields set (new)      : ${applied.fieldsNew}`);
console.log(`  array fields MERGED   : ${applied.arraysMerged}  (${applied.entriesAdded} list entries added, no existing entry touched)`);
if (applied.intoPassive) console.log(`  routed into passiveEffects (items): ${applied.intoPassive}  — a top-level write there is inert`);
if (recovered) console.log(`  recovered from an inline fix shape: ${recovered}`);
const byField = new Map();
for (const w of fieldWrites) byField.set(w.field, (byField.get(w.field) ?? 0) + 1);
for (const [f, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)} ${f}`);
if (deferredToggles.length) console.log(`\nDEFERRED toggles: ${deferredToggles.length} (unreachable as data — see the b2 note)`);
if (engineWork.length) console.log(`NEEDS ENGINE WORK: ${engineWork.length} — no field exists for them`);
if (skipped.length) {
  console.log(`\nNOT APPLIED (${skipped.length}):`);
  for (const s of skipped.slice(0, 50)) console.log('   ' + s);
  if (skipped.length > 50) console.log(`   ...and ${skipped.length - 50} more (full list in the report file)`);
}

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

writeFileSync(REGISTRY, regSrc);
writeFileSync(p('public/core.json'), JSON.stringify(core));

const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let ovAdd = 0, ovUpd = 0;
for (const w of fieldWrites) {
  // The overlay patches a whole top-level field, so a passiveEffects write carries the ENTIRE merged
  // object — otherwise a regen would restore the old one.
  const field = w.underPassive ? 'passiveEffects' : w.field;
  const value = w.underPassive ? core[w.coll][w.id].passiveEffects : w.value;
  const hits = overlay.filter((x) => x.category === w.coll && x.id === w.id && x.field === field);
  if (hits.length) { for (const h of hits) h.value = value; ovUpd++; }
  else { overlay.push({ category: w.coll, id: w.id, field, value }); ovAdd++; }
}
writeFileSync(OVERLAY, formatBackfill(overlay));
writeFileSync(p(`work/sweep/${batch}/not-applied.json`), JSON.stringify({ skipped, deferredToggles, engineWork }, null, 1));

console.log(`\noverlay: ${ovAdd} added, ${ovUpd} updated`);
console.log(`written: src/rules/situationalBonuses.ts, public/core.json, scripts/data/effect-backfill.json, work/sweep/${batch}/not-applied.json`);
