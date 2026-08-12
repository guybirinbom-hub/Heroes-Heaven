/*
 * Applies the full feat audit. Runs repeatedly as batches land — it only ever writes what is not
 * already there, so re-running after each batch is safe.
 *
 * Every guard below exists because an adversarial pass caught a real bad write in an earlier pass:
 *   - invented field names            -> LEGAL_FIELDS, derived from types.ts at run time
 *   - a field legal SOMEWHERE         -> usedIn(), per collection
 *   - critSpec with no critSpecWeapons-> grants crit spec with EVERY weapon (weaponMatches:1167)
 *   - effectChoices with no options   -> renders an empty picker while the audit says "fixed"
 *   - a grant naming content that does not exist -> a sheet row that opens nothing
 *   - a mode with no gate             -> nothing would ever show it
 *   - an existing registry key        -> a second entry silently shadows the first
 *
 * Usage: node scripts/apply-feat-audit.mjs [--dry]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);
const DIR = p('work/feataudit');

const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const typesSrc = readFileSync(p('src/rules/types.ts'), 'utf8');
const REGISTRY = p('src/rules/situationalBonuses.ts');

/**
 * Drop a previously generated block. Done at LOAD time, before anything reads the registries' keys:
 * this script re-runs as each batch lands, and a key that was only there because a previous run put
 * it there would otherwise be skipped as "already present" and then dropped when the block is
 * rewritten from the current run's findings alone.
 */
const stripGen = (text, tag) => {
  const at = text.indexOf(tag);
  if (at < 0) return text;
  const start = text.lastIndexOf('\n', at - 1) + 1; // the start of the tag's own line
  const end = text.indexOf('\n};', at);
  if (end < 0) return text; // the table's close is missing — leave the file alone rather than cut blind
  return text.slice(0, start) + text.slice(end + 1);
};

/**
 * All string surgery below is index-based, so the file MUST be LF while we work on it. A CRLF file
 * has no "\n\n" — the blank line is "\r\n\r\n" — and the previous strip's lastIndexOf returned -1,
 * which `slice(0, -1)` turned into "everything but the last character" and duplicated 780 lines of
 * the registry. Git restores the platform's endings on checkout, so this is not hypothetical.
 */
const lf = (text) => text.replace(/\r\n/g, '\n');
const GEN_SIT = '  // ---- full feat audit (scripts/apply-feat-audit.mjs) — every never-examined feat';
const GEN_MARK = '  // ---- full feat audit — action/condition marks ----';
const GEN_LANE = '  // ---- full feat audit (scripts/apply-feat-audit.mjs) ----';
const GEN_MODS = '  // ---- full feat audit — companion mods ----';
const GEN_GRANTS = '  // ---- full feat audit — companion grants ----';
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
/**
 * Would the engine actually READ this field off a feat?
 *
 * "Some feat already carries it" is the cheap test and it is right almost always, but it is wrong for
 * the FIRST user of a lane: derive.ts reads `db.feats[f.featId]?.strikeDamage` and no feat carried
 * strikeDamage, so a correct fix was rejected as an invented field. So fall back to asking the source.
 */
const rulesSrc = readdirSync(p('src/rules')).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(p(`src/rules/${f}`), 'utf8')).join('\n');
const usedCache = new Map();
const usedIn = (field) => {
  if (!usedCache.has(field)) {
    const carried = Object.values(core.feats).some((r) => r?.[field] != null);
    const read = new RegExp(String.raw`feats\[[^\]\n]+\]\??\.\s*${field}\b`).test(rulesSrc);
    usedCache.set(field, carried || read);
  }
  return usedCache.get(field);
};
const REFERENTIAL = new Map([
  ['innateSpells', { coll: 'spells', idOf: (e) => e?.spellId }],
  ['focusSpells', { coll: 'spells', idOf: (e) => e }],
  ['grantsFeats', { coll: 'feats', idOf: (e) => e }],
  ['grantedFeatId', { coll: 'feats', idOf: (e) => e }],
]);

/**
 * Prose and routing keys — never a field write. `note` is here because a previous applier wrote 32
 * "needsEngineWork" explanations into a real `note` field, which is legal on a stance and therefore
 * passed every other guard while meaning nothing.
 */
const META = new Set([
  'needsEngineWork', 'situational', 'mode', 'note', 'why', 'reason', 'explanation', 'confidence',
  'rulesText', 'citation', 'source', 'comment', 'verdict', 'id', 'name', 'where', 'scope', 'upheld',
  'precedent', 'lane', 'evidence',
]);

/* ---- load every batch's verdicts + the adversary's rulings ---- */
const records = [];
for (const f of readdirSync(DIR).filter((n) => /^judge-\d+\.json$/.test(n)).sort()) {
  for (const r of JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).records ?? []) records.push(r);
}
const overturned = new Map();
const corrected = new Map();
/**
 * An adversary's `correction` is one of three things and they must not be confused:
 *   {}                              -> nothing to say; the judge's own fix stands
 *   {verdict, reason}               -> a RECLASSIFICATION, not a fix. Carries no field to write.
 *   {fix: {...}} or a bare fix      -> the real fix, replacing the judge's.
 * Reading the second as a fix is what turned 27 correct overturns into "a MISS whose fix says nothing".
 */
const realFix = (c) => {
  if (!c || typeof c !== 'object') return null;
  if (/^(NEEDS_NOTHING|ALREADY_OK)$/.test(c.verdict ?? '')) return null;
  if (c.fix && typeof c.fix === 'object') return c.fix;
  return Object.keys(c).some((k) => !META.has(k)) ? c : null;
};
for (const f of readdirSync(DIR).filter((n) => /^refute-c\d+-\d+\.json$/.test(n)).sort()) {
  for (const r of JSON.parse(readFileSync(path.join(DIR, f), 'utf8')).rulings ?? []) {
    const fix = realFix(r?.correction);
    // An UPHELD ruling may still carry a corrected fix — many judges wrote "needsEngineWork" for
    // lanes that already exist, and the adversary supplied the lane that was there all along.
    if (fix) corrected.set(r.id, fix);
    else if (r?.upheld === false) overturned.set(r.id, r.why ?? 'overturned by the adversary');
  }
}

/* ---- the three registries a correction can target, read from the source that ships ---- */
const LANE_FILE = p('src/rules/featGrantsLane.ts');
const COMP_FILE = p('src/rules/companionGrants.ts');
const laneBefore = stripGen(lf(readFileSync(LANE_FILE, 'utf8')), GEN_LANE);
const compBefore = stripGen(stripGen(lf(readFileSync(COMP_FILE, 'utf8')), GEN_MODS), GEN_GRANTS);
let laneSrc = laneBefore;
let compSrc = compBefore;
const keysOf = (text, exportName) => {
  const open = text.indexOf(`export const ${exportName}`);
  const close = text.indexOf('\n};', open);
  return new Set([...text.slice(open, close).matchAll(/^ {2}['"]?([a-z0-9-]+)['"]?:/gm)].map((m) => m[1]));
};
const laneGrants = keysOf(laneSrc, 'FEAT_LANE_GRANTS');
const compMods = keysOf(compSrc, 'COMPANION_MODS');
const compGrants = keysOf(compSrc, 'FEAT_COMPANION_GRANTS');
const featGrantSrc = lf(readFileSync(p('src/rules/featGrants.ts'), 'utf8'));
const FEATGRANT_FIELDS = new Set(
  [...featGrantSrc.slice(featGrantSrc.indexOf('export interface FeatGrant'), featGrantSrc.indexOf('\n}', featGrantSrc.indexOf('export interface FeatGrant')))
    .matchAll(/^ {2}([a-zA-Z][\w]*)\??:/gm)].map((m) => m[1]),
);
const COMPANION_KINDS = new Set(typesSrc.match(/CompanionKind = ([^;]+);/)[1].match(/'[a-z-]+'/g).map((s) => s.slice(1, -1)));
/** The kinds companions.ts actually tests COMPANION_MODS against — read from the source, not assumed. */
const CONSUMED_COMPANION_KINDS = new Set(
  [...readFileSync(p('src/rules/companions.ts'), 'utf8').matchAll(/mod\.kinds\.includes\('([a-z-]+)'\)/g)].map((m) => m[1]),
);
const MATURITIES = new Set(readFileSync(p('src/rules/companions.ts'), 'utf8').match(/export type Maturity =([\s\S]*?);/)[1].match(/'[a-z-]+'/g).map((s) => s.slice(1, -1)));

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const skipped = [];
const engineWork = [];
const unresolved = [];
const sitEntries = new Map();
const newMarkers = new Map();
const fieldWrites = [];
const newModes = new Map();
const newLaneGrants = new Map();
const newCompMods = new Map();
const newCompGrants = new Map();
let none = 0;

for (const rec of records) {
  const id = rec?.id;
  if (!id) continue;
  if (rec.verdict !== 'MISS') { none++; continue; }
  if (overturned.has(id)) { skipped.push(`${id}: ${overturned.get(id)}`); continue; }
  const fix = corrected.get(id) ?? rec.fix;
  if (!fix) { skipped.push(`${id}: MISS with no fix`); continue; }
  if (!core.feats[id]) { skipped.push(`${id}: not a feat in core.json`); continue; }

  // A fix that still contains an instruction to itself is not a fix. Several weapon-familiarity
  // corrections shipped `["<enumerate the advanced bow-group weapons>"]` — applying that would put a
  // literal placeholder in a proficiency table and the audit would count the feat as done.
  if (/<[a-z][^>]{4,}>/i.test(JSON.stringify(fix))) {
    unresolved.push({ id, name: rec.name ?? core.feats[id].name, fix });
    continue;
  }

  // Checked FIRST: a fix that only explains what the engine cannot yet do must never be mined for
  // something that looks like a field.
  if (fix.needsEngineWork && !Object.keys(fix).some((k) => !META.has(k))) {
    engineWork.push({ id, name: rec.name ?? core.feats[id].name, reason: rec.reason ?? fix.note ?? '' });
    continue;
  }

  // ---- a mark on an ACTION or a CONDITION rather than on a stat ----
  // Adversaries return these under `situational` too, but they carry {on,id,note} instead of
  // {targets,when,bonus} and belong in RECORD_MARKERS. Routing them by their shape rather than by
  // their key — otherwise a Leap distance would be written as a star on a stat that has no bonus.
  if (Array.isArray(fix.situational) && fix.situational.some((b) => b?.on && b?.id)) {
    if (existingMarkers.has(id) || newMarkers.has(id)) { skipped.push(`${id}: already in RECORD_MARKERS`); continue; }
    const marks = fix.situational.filter((b) => b?.on && b?.id && b?.note);
    const badSurface = marks.filter((b) => b.on !== 'action' && b.on !== 'condition');
    if (badSurface.length) { skipped.push(`${id}: marker "on" must be action or condition`); continue; }
    const dead = marks.filter((b) => (b.on === 'action' ? !core.actions?.[b.id] : !core.conditions?.[b.id]));
    if (dead.length) { skipped.push(`${id}: marker points at no such ${dead[0].on}: ${dead.map((d) => d.id).join(', ')}`); continue; }
    if (marks.length) newMarkers.set(id, marks.map((m) => ({ on: m.on, id: m.id, ...(m.value ? { value: String(m.value) } : {}), note: String(m.note) })));
    continue;
  }

  // ---- conditional bonuses -> the star registry ----
  if (fix.situational?.length) {
    if (existingReg.has(id) || sitEntries.has(id)) { skipped.push(`${id}: already in the situational registry`); continue; }
    const out = [];
    for (const b of fix.situational) {
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

  // ---- a toggleable effect -> a mode ----
  // Deliberately does NOT `continue`: a fix may carry a mode AND record fields. Golden Body is a mode
  // for its fast healing plus `unarmedTraits` for its deadly d12, and stopping at the mode dropped the
  // second half in silence — the feat read as handled with half of it missing.
  if (fix.mode) {
    const m = fix.mode;
    const gate = (m?.feats ?? []).filter((f) => !core.feats[f] && !core.classFeatures[f]);
    if (!m.id) skipped.push(`${id}: mode with no id`);
    else if (core.modes?.[m.id] || newModes.has(m.id)) skipped.push(`${id}: mode "${m.id}" already exists`);
    else if (gate.length) skipped.push(`${id}: mode gate not found: ${gate.join(', ')}`);
    else if (!m.fromItemId && !(m.feats ?? []).length) skipped.push(`${id}: mode with no gate — nothing would show it`);
    else newModes.set(m.id, { ...m, modifiers: m.modifiers ?? [] });
  }

  // ---- registry lanes ----
  // Judges wrote "needsEngineWork" for these three and the adversary showed the lane already exists.
  // They are REGISTRIES keyed by feat id, not fields on the record, so they are written to source.
  if (fix.entry && typeof fix.entry === 'object') Object.assign(fix, fix.entry[id] ?? fix.entry);
  if (fix.companionMod) {
    const m = fix.companionMod;
    if (compMods.has(id)) { skipped.push(`${id}: already in COMPANION_MODS`); continue; }
    if (!(m.kinds ?? []).length || m.kinds.some((k) => !COMPANION_KINDS.has(k))) { skipped.push(`${id}: companionMod kinds ${JSON.stringify(m.kinds)}`); continue; }
    // COMPANION_MODS is READ only for 'animal' (companions.ts deriveAnimalCompanion) and 'eidolon'
    // (deriveEidolon). A familiar- or follower-kind entry passes every other check and then sits dead
    // — deriveFamiliar never looks at this table. Better a recorded gap than a field that reads done.
    if (!m.kinds.some((k) => CONSUMED_COMPANION_KINDS.has(k))) {
      skipped.push(`${id}: companionMod for ${m.kinds.join('/')} — only animal and eidolon entries are ever read`);
      continue;
    }
    if (m.maturityFloor && !MATURITIES.has(m.maturityFloor)) { skipped.push(`${id}: maturityFloor "${m.maturityFloor}" is not on the ladder`); continue; }
    newCompMods.set(id, m);
    continue;
  }
  if (fix.companionGrant) {
    const g = fix.companionGrant;
    if (compGrants.has(id)) { skipped.push(`${id}: already in FEAT_COMPANION_GRANTS`); continue; }
    if (!COMPANION_KINDS.has(g.kind)) { skipped.push(`${id}: companionGrant kind "${g.kind}"`); continue; }
    newCompGrants.set(id, g);
    continue;
  }
  {
    const grant = Object.fromEntries(Object.entries(fix).filter(([k]) => FEATGRANT_FIELDS.has(k)));
    if (Object.keys(grant).length) {
      const rest = Object.keys(fix).filter((k) => !META.has(k) && !FEATGRANT_FIELDS.has(k) && k !== 'entry' && k !== 'registry');
      if (rest.length) { skipped.push(`${id}: mixes a proficiency grant with ${rest.join(', ')}`); continue; }
      if (laneGrants.has(id)) { skipped.push(`${id}: already in FEAT_LANE_GRANTS`); continue; }
      newLaneGrants.set(id, grant);
      continue;
    }
  }

  // ---- record fields ----
  // A judge names the field directly ({critSpec: true, critSpecWeapons: {...}}), so anything left on
  // the fix that is not prose is a field write. A fix is ALL-OR-NOTHING: critSpec landing without the
  // critSpecWeapons that scope it would grant crit specialisation with every weapon in the game.
  const pairs = Object.entries(fix)
    .filter(([k]) => !META.has(k))
    .map(([field, raw]) => {
      let value = raw;
      if (typeof value === 'string') { try { value = JSON.parse(value); } catch { /* a plain string value */ } }
      return { field, value };
    });
  if (!pairs.length) { skipped.push(`${id}: a MISS whose fix says nothing`); continue; }

  const r = core.feats[id];
  const reject = (why) => { skipped.push(`${id}: ${why}`); return true; };
  const bad = pairs.some(({ field, value }) => {
    if (!LEGAL_FIELDS.has(field)) return reject(`"${field}" is not a field on any record type`);
    if (!usedIn(field)) return reject(`no feat carries "${field}" — the engine probably does not read it there`);
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
    // A usesUpgrade retunes a `limitedUses` pool and nothing else. Shape of the Dragon's once-per-day
    // lives on innateSpells.usesPerDay, so Mighty Dragon Shape pointed at a pool that is not there —
    // it would have shipped as a field that reads as done and changes nothing.
    if (field === 'usesUpgrade') {
      const t = value?.featId ? core.feats[value.featId] : null;
      if (!t) return reject(`usesUpgrade names a feat that does not exist: ${value?.featId}`);
      if (!t.limitedUses) return reject(`usesUpgrade -> ${value.featId}, which has no limitedUses to retune`);
    }
    return false;
  });
  if (bad) continue;
  for (const { field, value } of pairs) fieldWrites.push({ id, field, value });
}

console.log(`judged ${records.length} · not a MISS ${none}`);
console.log(`WRITING  ${sitEntries.size} situational · ${newMarkers.size} markers · ${fieldWrites.length} fields · ${newModes.size} modes`);
const byField = new Map();
for (const w of fieldWrites) byField.set(w.field, (byField.get(w.field) ?? 0) + 1);
for (const [f, n] of [...byField.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)} ${f}`);
console.log(`         ${newLaneGrants.size} proficiency grants · ${newCompMods.size} companion mods · ${newCompGrants.size} companion grants`);
console.log(`NEEDS ENGINE WORK: ${engineWork.length}`);
if (unresolved.length) console.log(`UNRESOLVED (the fix still contains a placeholder): ${unresolved.map((u) => u.id).join(', ')}`);
if (skipped.length) {
  console.log(`\nNOT APPLIED (${skipped.length}):`);
  for (const s of skipped.slice(0, 25)) console.log('   ' + s);
  if (skipped.length > 25) console.log(`   ...and ${skipped.length - 25} more`);
}

if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }

const MARKER = GEN_SIT;
const lines = [...sitEntries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, out]) => `  "${id}": [${out.join(', ')}],`);
if (lines.length) {
  const banner = `\n\n${MARKER} — do not hand-edit below ----\n  // ${lines.length} feats. Selected by what the record HAS, not by whether its text matched a pattern.\n`;
  const open = regSrc.indexOf('export const FEAT_SITUATIONAL: Record<string, SituationalBonus[]> = {');
  const close = regSrc.indexOf('\n};', open);
  regSrc = regSrc.slice(0, close) + banner + lines.join('\n') + regSrc.slice(close);
}
if (newMarkers.size) {
  const body = [...newMarkers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  '${k}': ${JSON.stringify(v)},`).join('\n');
  const open = regSrc.indexOf('export const RECORD_MARKERS');
  const close = regSrc.indexOf('\n};', open);
  regSrc = `${regSrc.slice(0, close)}\n\n${GEN_MARK}\n  // ${newMarkers.size} feats that change an ACTION or a CONDITION rather than a stat.\n${body}${regSrc.slice(close)}`;
}
/**
 * Refuse to write a file whose structure changed shape. A line-ending bug once made the strip cut
 * `slice(0, -1)` and duplicated 780 lines of the registry — every export appeared three times and the
 * only symptom was a parse error 300 lines away. Counting the exports catches that at the source.
 */
const guardShape = (path, before, after, exports) => {
  for (const name of exports) {
    const n = (s) => s.split(`export const ${name}`).length - 1;
    if (n(after) !== n(before)) {
      throw new Error(`${path}: "export const ${name}" appears ${n(after)}x after editing, ${n(before)}x before — refusing to write`);
    }
  }
  const braces = (s) => (s.match(/^\};$/gm) ?? []).length;
  if (braces(after) !== braces(before)) {
    throw new Error(`${path}: top-level "};" count changed ${braces(before)} → ${braces(after)} — refusing to write`);
  }
  writeFileSync(path, after);
};

guardShape(REGISTRY, regBefore, regSrc, ['FEAT_SITUATIONAL', 'RECORD_MARKERS']);

/** Append feat-keyed entries to a `Record<string, T>` export, replacing any previous generated block. */
const appendTo = (text, exportName, entries, tag) => {
  if (!entries.size) return text; // already stripped at load

  const open = text.indexOf(`export const ${exportName}`);
  const close = text.indexOf('\n};', open);
  const body = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `  '${k}': ${JSON.stringify(v)},`).join('\n');
  return `${text.slice(0, close)}\n\n${tag}\n  // ${entries.size} entries. The judge said "no lane exists"; the adversary found the lane.\n${body}${text.slice(close)}`;
};
laneSrc = appendTo(laneSrc, 'FEAT_LANE_GRANTS', newLaneGrants, GEN_LANE);
compSrc = appendTo(compSrc, 'COMPANION_MODS', newCompMods, GEN_MODS);
compSrc = appendTo(compSrc, 'FEAT_COMPANION_GRANTS', newCompGrants, GEN_GRANTS);
guardShape(LANE_FILE, laneBefore, laneSrc, ['FEAT_LANE_GRANTS']);
guardShape(COMP_FILE, compBefore, compSrc, ['COMPANION_MODS', 'FEAT_COMPANION_GRANTS']);

for (const w of fieldWrites) core.feats[w.id][w.field] = w.value;
for (const [mid, m] of newModes) { core.modes = core.modes ?? {}; core.modes[mid] = m; }
writeFileSync(p('public/core.json'), JSON.stringify(core));

const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let ovAdd = 0;
for (const w of fieldWrites) {
  if (!overlay.some((x) => x.category === 'feats' && x.id === w.id && x.field === w.field)) {
    overlay.push({ category: 'feats', id: w.id, field: w.field, value: w.value });
    ovAdd++;
  }
}
writeFileSync(OVERLAY, formatBackfill(overlay));
if (newModes.size) {
  const SRC = p('scripts/data/toggle-modes.json');
  const prev = existsSync(SRC) ? JSON.parse(readFileSync(SRC, 'utf8')) : {};
  for (const [mid, m] of newModes) prev[mid] = m;
  writeFileSync(SRC, JSON.stringify(prev, null, 2) + '\n');
}
writeFileSync(path.join(DIR, 'not-applied.json'), JSON.stringify({ skipped, engineWork, unresolved }, null, 1));
console.log(`\noverlay: ${ovAdd} added`);
console.log('written: src/rules/situationalBonuses.ts, public/core.json, scripts/data/effect-backfill.json');
