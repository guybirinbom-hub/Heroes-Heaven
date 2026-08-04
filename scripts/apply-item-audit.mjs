/*
 * Applies the full item audit. Re-runnable as batches land — it only ever writes what is not already
 * there, so running it again after each group is safe.
 *
 * Every guard exists because a previous applier made that exact mistake, on feats:
 *   - invented field names            -> EFFECT_FIELDS, derived from types.ts at run time
 *   - a field legal SOMEWHERE         -> usedIn(), which also asks whether the ENGINE reads it off an
 *                                        item, so a lane's first user is not rejected
 *   - a placeholder left in the fix   -> quarantined, never written
 *   - a mode with no fromItemId       -> nothing would ever show it
 *   - one lane per fix                -> lanes fall through; a fix may carry a mode AND fields
 *   - passiveEffects with a stray key -> checked against the ItemPassiveEffects interface itself
 *
 * Usage: node scripts/apply-item-audit.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const DIR = p('work/itemaudit');

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const typesSrc = readFileSync(p('src/rules/types.ts'), 'utf8');

/** Field names declared anywhere in types.ts — an invented one cannot pass this. */
const LEGAL_FIELDS = new Set([...typesSrc.matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]));
const SKILLS = new Set(typesSrc.match(/export const SKILLS = \[([\s\S]*?)\]/)[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)));
const SAVES = new Set(['fortitude', 'reflex', 'will', 'all']);
const KINDS = new Set(['skill', 'save', 'perception', 'ac', 'attack', 'strikeAttack', 'strikeDamage', 'speed', 'hp', 'classDc', 'spell', 'spellDamage', 'ability']);

/** The exact keys ItemPassiveEffects declares — read from the interface, never restated here. */
const PASSIVE_KEYS = new Set(
  [...typesSrc
    .slice(typesSrc.indexOf('export interface ItemPassiveEffects'), typesSrc.indexOf('\n}', typesSrc.indexOf('export interface ItemPassiveEffects')))
    .matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]),
);

/**
 * Would the engine READ this field off an item? "Some item already carries it" is right almost
 * always, and wrong for a lane's first user — so also ask the source.
 */
const rulesSrc = readdirSync(p('src/rules')).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(p(`src/rules/${f}`), 'utf8')).join('\n');
const usedCache = new Map();
const usedIn = (field) => {
  if (!usedCache.has(field)) {
    const carried = Object.values(core.items).some((r) => r?.[field] != null);
    const read = new RegExp(String.raw`(items\[[^\]\n]+\]|\bit|\bitem|\binv)\??\.\s*${field}\b`).test(rulesSrc);
    usedCache.set(field, carried || read);
  }
  return usedCache.get(field);
};

const REFERENTIAL = new Map([
  ['innateSpells', { coll: 'spells', idOf: (e) => e?.spellId }],
  ['heldSpells', { coll: 'spells', idOf: (e) => (typeof e === 'string' ? e : e?.spellId) }],
  ['grantsFeats', { coll: 'feats', idOf: (e) => e }],
]);

/** Prose and routing keys — never a field write. */
const META = new Set([
  'needsEngineWork', 'situational', 'mode', 'note', 'why', 'reason', 'explanation', 'confidence',
  'rulesText', 'citation', 'source', 'comment', 'verdict', 'id', 'name', 'where', 'scope', 'upheld',
  'precedent', 'lane', 'evidence',
]);

/* ---- load every verdict + the adversary's rulings ---- */
const records = [];
for (const f of readdirSync(DIR).filter((n) => /^judge-\d+\.json$/.test(n)).sort()) {
  try {
    for (const r of JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).records ?? []) records.push(r);
  } catch {
    console.log(`  (skipping ${f}: not valid JSON yet — a run may still be writing it)`);
  }
}

/**
 * A `correction` is one of three things and they must not be confused:
 *   {}                   nothing to say; the judge's own fix stands
 *   {verdict, reason}    a RECLASSIFICATION, carrying no fix at all
 *   {fix} or a bare fix  the real fix, replacing the judge's
 * Reading the second as a fix is what once turned 27 correct overturns into "a MISS that says nothing".
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
  } catch {
    console.log(`  (skipping ${f}: not valid JSON yet)`);
  }
}

const skipped = [];
const engineWork = [];
const unresolved = [];
const fieldWrites = [];
const newModes = new Map();
let none = 0;

for (const rec of records) {
  const id = rec?.id;
  if (!id) continue;
  if (rec.verdict !== 'MISS') { none++; continue; }
  if (overturned.has(id)) { skipped.push(`${id}: ${overturned.get(id)}`); continue; }
  const fix = corrected.get(id) ?? rec.fix;
  if (!fix) { skipped.push(`${id}: MISS with no fix`); continue; }
  if (!core.items[id]) { skipped.push(`${id}: not an item in core.json`); continue; }

  // A fix still containing an instruction to itself is not a fix.
  if (/<[a-z][^>]{4,}>/i.test(JSON.stringify(fix))) {
    unresolved.push({ id, name: rec.name ?? core.items[id].name, fix });
    continue;
  }

  // Checked FIRST so a fix that only explains what the engine cannot do is never mined for a field.
  if (fix.needsEngineWork && !Object.keys(fix).some((k) => !META.has(k))) {
    engineWork.push({ id, name: rec.name ?? core.items[id].name, reason: rec.reason ?? fix.note ?? '' });
    continue;
  }

  // ---- an item MODE (an activated effect that lasts) ----
  // Does NOT `continue`: a fix may carry a mode AND record fields, and stopping here once dropped
  // half of a feat's content in silence.
  if (fix.mode) {
    const m = fix.mode;
    if (!m?.id) skipped.push(`${id}: mode with no id`);
    else if (core.modes?.[m.id] || newModes.has(m.id)) skipped.push(`${id}: mode "${m.id}" already exists`);
    else if (m.fromItemId && !core.items[m.fromItemId]) skipped.push(`${id}: mode fromItemId "${m.fromItemId}" is not an item`);
    else if (!m.fromItemId && !(m.feats ?? []).length) skipped.push(`${id}: mode with no gate — nothing would show it`);
    // Every shipped item mode says how long it lasts, and a test pins that. A span is not required —
    // the corpus already uses condition wordings like "While affixed to your armor" — but SOMETHING
    // must tell the player when to switch it off.
    else if (!String(m.duration ?? '').trim()) skipped.push(`${id}: mode "${m.id}" does not say how long it lasts`);
    else newModes.set(m.id, { ...m, modifiers: m.modifiers ?? [] });
  }

  // ---- record fields (an item carries `situational` directly, unlike a feat) ----
  const pairs = Object.entries(fix)
    .filter(([k]) => !META.has(k) || k === 'situational')
    .filter(([k]) => k !== 'mode' && k !== 'needsEngineWork')
    .map(([field, raw]) => {
      let value = raw;
      if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* a plain string */ } }
      return { field, value };
    });
  if (!pairs.length) {
    if (!fix.mode) skipped.push(`${id}: a MISS whose fix says nothing`);
    continue;
  }

  const r = core.items[id];
  const reject = (why) => { skipped.push(`${id}: ${why}`); return true; };
  const bad = pairs.some(({ field, value }) => {
    if (!LEGAL_FIELDS.has(field)) return reject(`"${field}" is not a field on any record type`);
    if (!usedIn(field)) return reject(`no item carries "${field}" and nothing reads it off an item`);
    // Restating a value the record already has is a no-op, not an overwrite. Rejecting the whole fix
    // for it blocked eight precious-material shields whose only collision was `bulk: 0.1` twice.
    if (JSON.stringify(r[field]) === JSON.stringify(value)) return false;
    // `equipment` is the importer's catch-all bucket. A record printing "Price 400 gp, Bulk L, the
    // shield has Hardness 8, HP 32, BT 16" is a buckler filed under it, and derive.ts only finds a
    // shield when itemType === 'shield' — so buying one gave the player nothing. Correcting away
    // from the fallback is allowed; changing one real type into another real type is not.
    const correctingFallback = field === 'itemType' && r.itemType === 'equipment' && value !== 'equipment';
    if (r[field] != null && !(Array.isArray(r[field]) && !r[field].length) && !correctingFallback) {
      return reject(`already has ${field} — not overwriting`);
    }

    if (field === 'passiveEffects') {
      if (!value || typeof value !== 'object') return reject('passiveEffects is not an object');
      const stray = Object.keys(value).filter((k) => !PASSIVE_KEYS.has(k));
      if (stray.length) return reject(`passiveEffects has keys ItemPassiveEffects does not declare: ${stray.join(', ')}`);
      if (value.skills && Object.keys(value.skills).some((k) => !SKILLS.has(k) && !k.startsWith('lore:'))) {
        return reject(`passiveEffects.skills names a skill that does not exist`);
      }
    }
    if (field === 'situational') {
      const list = Array.isArray(value) ? value : [];
      if (!list.length) return reject('situational with no entries');
      for (const b of list) {
        for (const t of b?.targets ?? []) {
          if (!KINDS.has(t.kind)) return reject(`situational target kind "${t.kind}"`);
          if (t.kind === 'skill' && t.detail && t.detail !== 'all' && !t.detail.startsWith('lore:') && !SKILLS.has(t.detail)) {
            return reject(`situational names skill "${t.detail}"`);
          }
          if (t.kind === 'save' && t.detail && !SAVES.has(t.detail)) return reject(`situational names save "${t.detail}"`);
        }
        if (!(b?.targets ?? []).length || !String(b?.bonus ?? '').trim()) return reject('situational entry with no target or no bonus');
      }
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
  for (const { field, value } of pairs) fieldWrites.push({ id, field, value });
}

console.log(`judged ${records.length} · not a MISS ${none}`);
console.log(`WRITING  ${fieldWrites.length} fields · ${newModes.size} modes`);
const byField = new Map();
for (const w of fieldWrites) byField.set(w.field, (byField.get(w.field) ?? 0) + 1);
for (const [f, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)} ${f}`);
console.log(`NEEDS ENGINE WORK: ${engineWork.length}`);
if (unresolved.length) console.log(`UNRESOLVED (the fix still contains a placeholder): ${unresolved.map((u) => u.id).join(', ')}`);
if (skipped.length) {
  console.log(`\nNOT APPLIED (${skipped.length}):`);
  for (const s of skipped.slice(0, 25)) console.log('   ' + s);
  if (skipped.length > 25) console.log(`   ...and ${skipped.length - 25} more`);
}

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

for (const w of fieldWrites) core.items[w.id][w.field] = w.value;
for (const [mid, m] of newModes) { core.modes = core.modes ?? {}; core.modes[mid] = m; }
writeFileSync(p('public/core.json'), JSON.stringify(core));

// The overlay is the ONLY thing that carries record fields through `npm run data`.
const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let ovAdd = 0;
for (const w of fieldWrites) {
  if (!overlay.some((x) => x.category === 'items' && x.id === w.id && x.field === w.field)) {
    overlay.push({ category: 'items', id: w.id, field: w.field, value: w.value });
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
console.log('written: public/core.json, scripts/data/effect-backfill.json' + (newModes.size ? ', scripts/data/toggle-modes.json' : ''));
