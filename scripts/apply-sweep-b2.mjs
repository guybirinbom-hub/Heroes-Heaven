/*
 * Applies batch 2 of the coverage sweep: the defense, proficiency and toggle lanes.
 *
 * Same rule as batch 1 — NOTHING is written on trust. The legal field set, the skill ids, the sense
 * names and the speed types are all derived from the repo at run time, so a fix naming something the
 * engine does not have is REPORTED rather than written. An invented field sits in core.json looking
 * like data and doing nothing, which is the exact failure this whole exercise exists to undo.
 *
 * TWO THINGS BATCH 1'S SCRIPT COULD NOT DO, and this one must:
 *
 *  1. ARRAY MERGE. Batch 1's lanes wrote scalars, so "already has a value -> skip" was right. Batch 2
 *     is mostly `resistances` / `immunities` / `senses` / `speeds`, which are LISTS. A record that
 *     already resists fire and should also resist cold must end up resisting both — overwriting would
 *     silently delete the fire entry, and skipping would silently drop the cold one. Existing entries
 *     always win; only genuinely new keys are appended.
 *
 *  2. TOGGLES. A toggle is not a record field, it is an entry in core.stances or core.modes. Both
 *     accept a prose `note` as a complete entry (air-shroud is exactly that), so a toggle can be
 *     encoded honestly without inventing a modifier format.
 *     Durability: `stances` and `modes` are both in the importer's CARRY_WHOLESALE list, and
 *     scripts/data/stances.json is additionally merged OVER the carried bucket — so new stances are
 *     written to that file as well, which is the authoritative hand-authored table.
 *
 * Usage: node scripts/apply-sweep-b2.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);

const res = JSON.parse(readFileSync(p('work/sweep/b2/result.json'), 'utf8'));
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

/** Every distinct key already in use for an array field — the engine's real vocabulary. */
function observedVocab(field, keyOf) {
  const s = new Set();
  for (const coll of COLLECTIONS) {
    for (const r of Object.values(core[coll] ?? {})) {
      const v = r?.[field];
      if (Array.isArray(v)) for (const e of v) { const k = keyOf(e); if (k) s.add(k); }
    }
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
]);
// Strict where the engine switches on the value (an unrecognised one silently does nothing);
// lenient for damage types, which are open-ended and stored as data.
const STRICT_VOCAB = new Set(['senses', 'speeds']);
const VOCAB = new Map([...ARRAY_MERGE].map(([f, k]) => [f, observedVocab(f, k)]));

/**
 * ITEMS STORE DEFENCES UNDER passiveEffects, NEVER AT THE TOP LEVEL.
 *
 * Found by the adversarial pass and verified in the source: derive.ts reads senses/resistances/
 * immunities ONLY from `db.items[inv.itemId]?.passiveEffects` (lines 709-711) and speeds/speedPenalty
 * only from the same object (1667-1673). There is no read of a top-level `item.resistances` anywhere
 * in src — I grepped for it.
 *
 * usedIn() CANNOT catch this: 49 item records already carry a top-level `resistances`, so the guard
 * happily says "the engine reads it here". It does not. Those 49 are inert leftovers, and writing a
 * 50th would have produced a value that looks like data, passes every check, and does nothing — the
 * exact failure this sweep exists to undo.
 *
 * `weaknesses` is deliberately absent: ItemPassiveEffects has no such key, so an item weakness has
 * nowhere real to go and is reported instead of parked somewhere convenient.
 */
const ITEM_PASSIVE_FIELDS = new Set(['resistances', 'immunities', 'senses', 'speedPenalty']);
const ITEM_UNSUPPORTED = new Map([
  ['weaknesses', 'ItemPassiveEffects has no weaknesses key — the engine cannot apply an item weakness'],
  ['speeds', 'passiveEffects.speeds is SpeedGrants, a different shape from the top-level speeds list'],
  ['landSpeedBonus', 'the item-side name is passiveEffects.speedBonus, and the shapes differ'],
  ['landSpeedMin', 'no item-side equivalent'],
]);

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

// Umbrella summaries stay inert whatever a fix says — ruling A.
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
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

for (const m of res.records) {
  if (m.verdict !== 'MISS' || !m.fix) continue;
  const { id, fix } = m;
  const coll = findColl(id);
  if (!coll) { skipped.push(`${id}: not in any collection`); continue; }
  if (umbrellaIds.has(id)) { skipped.push(`${id}: umbrella summary — inert by ruling A`); continue; }
  if (fix.needsEngineWork) { skipped.push(`${id}: flagged as needing engine work — no field exists for it`); continue; }

  // ---- conditional bonuses -> the star registry ----
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

  /* ---- toggles: DEFERRED, because a written entry would never reach the player ----
   *
   * MainTab.tsx:222-224 builds the stance list as:
   *     character.feats -> content.feats[f.featId]
   *       .filter(f => content.stances[f.id] && (f.traits.includes('stance') || stances[f.id].form))
   *
   * So a stance entry only surfaces if it is keyed by a FEAT the character has, AND that feat carries
   * the `stance` trait (or the entry is flagged form:true). Measured against this batch's toggle
   * fixes: 102 are keyed by an ITEM (unreachable — the list never looks at inventory) and all 25
   * feat-keyed ones are on feats with NO stance trait. Zero would appear.
   *
   * Writing them anyway would add ~137 entries to core.stances that no player can ever toggle, while
   * the audit recorded the gap as "fixed". Item-keyed toggles want a core.modes entry with
   * `fromItemId` (the shape the 211 consumable modes use) and feat-keyed ones want `feats: [id]`
   * gating — that is engine-shaped work, not a data write, so it is recorded and left. */
  if (fix.toggle) {
    deferredToggles.push({
      id, name: m.name, collection: coll, lane: m.lane,
      registry: fix.toggle.registry ?? null,
      toggleName: fix.toggle.name ?? null,
      effects: fix.toggle.effects ?? m.reason ?? '',
      wouldSurface: false,
      needsEngineWork: !!fix.needsEngineWork,
    });
    continue;
  }

  // ---- a record field ----
  // Some agents returned the field inline ({"landSpeedMin":20}) instead of {field,value}. Recover it
  // rather than dropping the finding on a formatting slip.
  let field = fix.field;
  let rawValue = fix.value;
  if (!field) {
    const inline = Object.keys(fix).filter((k) => LEGAL_FIELDS.has(k));
    if (inline.length === 1) { field = inline[0]; rawValue = JSON.stringify(fix[field]); recovered++; }
  }
  if (field && rawValue != null) {
    if (!LEGAL_FIELDS.has(field)) { skipped.push(`${id}: "${field}" is not a field on any record type — needs engine work`); continue; }
    let value;
    try { value = JSON.parse(rawValue); } catch { value = rawValue; }
    const rec = core[coll][id];

    // An effect choice must offer options the picker can render: a literal list, or a spell filter.
    // An agent proposed `featFilter` for Adept Storyteller ("gain two Performance skill feats") — a
    // shape that does not exist. It would have rendered an empty picker, which is worse than the gap:
    // the record would look handled. Choosing from FEATS is a real lane, but it lives in
    // src/rules/featPickGrants.ts, not here. referential-integrity.test.ts catches this; so do we.
    if (field === 'effectChoices') {
      const bad = (Array.isArray(value) ? value : []).filter((e) => !e?.options?.length && !e?.spellFilter);
      if (bad.length) {
        skipped.push(`${id}: effectChoices with no options and no spellFilter (${bad.map((b) => b.id ?? '?').join(', ')}) — a feat-pick belongs in featPickGrants.ts`);
        continue;
      }
    }

    // Items keep defences under passiveEffects; a top-level write there is inert (see above).
    let holder = rec;
    let underPassive = false;
    if (coll === 'items') {
      if (ITEM_UNSUPPORTED.has(field)) { skipped.push(`${id}: ${field} on an item — ${ITEM_UNSUPPORTED.get(field)}`); continue; }
      if (ITEM_PASSIVE_FIELDS.has(field)) {
        rec.passiveEffects = rec.passiveEffects ?? {};
        holder = rec.passiveEffects;
        underPassive = true;
      }
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
        if (have.has(k)) continue; // already covered — existing value wins, never overwritten
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
}

// ---- splice the registry ----
const MARKER = '  // ---- coverage sweep batch 2 (scripts/apply-sweep-b2.mjs)';
{
  const at = regSrc.indexOf(MARKER);
  if (at >= 0) regSrc = regSrc.slice(0, regSrc.lastIndexOf('\n\n', at)) + regSrc.slice(regSrc.indexOf('\n};', at));
}
const lines = [...sitEntries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, out]) => `  "${id}": [${out.join(', ')}],`);
if (lines.length) {
  const banner =
    `\n\n${MARKER} — do not hand-edit below ----\n` +
    `  // ${lines.length} records from the defense/proficiency/toggle sweep with a printed conditional bonus.\n` +
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

console.log('APPLIED');
console.log(`  situational entries   : ${applied.situational} records`);
console.log(`  fields set (new)      : ${applied.fieldsNew}`);
console.log(`  array fields MERGED   : ${applied.arraysMerged}  (${applied.entriesAdded} list entries added, no existing entry touched)`);
console.log(`  routed into passiveEffects (items): ${applied.intoPassive}  — a top-level write there is inert`);
if (recovered) console.log(`  recovered from an inline fix shape: ${recovered}`);
console.log(`\nDEFERRED  toggles: ${deferredToggles.length} — written to work/sweep/b2/toggles-deferred.json`);
console.log(`  none would surface: stance entries only appear for a FEAT the character has that carries`);
console.log(`  the 'stance' trait (MainTab.tsx:222). ${deferredToggles.filter((t) => t.collection === 'items').length} are item-keyed, and no feat-keyed one has the trait.`);
const byField = new Map();
for (const w of fieldWrites) byField.set(w.field, (byField.get(w.field) ?? 0) + 1);
for (const [f, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)} ${f}`);
if (skipped.length) {
  console.log(`\nNOT APPLIED (${skipped.length}) — each needs a decision or engine work:`);
  const head = skipped.slice(0, 60);
  for (const s of head) console.log('   ' + s);
  if (skipped.length > head.length) console.log(`   ...and ${skipped.length - head.length} more`);
}

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

writeFileSync(REGISTRY, regSrc);
writeFileSync(p('public/core.json'), JSON.stringify(core));

// The overlay is the only thing that carries RECORD FIELDS through `npm run data`.
const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let ovAdd = 0, ovUpd = 0;
for (const w of fieldWrites) {
  // The overlay patches a whole top-level field. A passiveEffects write therefore carries the ENTIRE
  // merged passiveEffects object, not just the sub-key — otherwise a regen would restore the old one.
  const field = w.underPassive ? 'passiveEffects' : w.field;
  const value = w.underPassive ? core[w.coll][w.id].passiveEffects : w.value;
  const hits = overlay.filter((x) => x.category === w.coll && x.id === w.id && x.field === field);
  if (hits.length) { for (const h of hits) h.value = value; ovUpd++; }
  else { overlay.push({ category: w.coll, id: w.id, field, value }); ovAdd++; }
}
writeFileSync(OVERLAY, formatBackfill(overlay));
writeFileSync(p('work/sweep/b2/toggles-deferred.json'), JSON.stringify(deferredToggles, null, 1));

console.log(`\noverlay: ${ovAdd} added, ${ovUpd} updated`);
console.log('written: src/rules/situationalBonuses.ts, public/core.json, scripts/data/effect-backfill.json, work/sweep/b2/toggles-deferred.json');
