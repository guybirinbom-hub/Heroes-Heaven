/*
 * Applies rulings B and C.
 *
 *   B — "Move it to a star."  A flat bonus the printed text RESTRICTS leaves passiveEffects (where it
 *       applied to every check of that stat) and becomes a situational entry carrying the printed
 *       restriction. The stat's total drops back to the correct number; the bonus is one click away.
 *
 *   C — "Star every skill that could do it."  A bonus tied to a named ACTION stars every skill that
 *       can perform it, not just the most obvious one. Specialist's Ring stars Arcana, Nature,
 *       Occultism AND Religion, because all four can Recall Knowledge and Identify Magic.
 *
 * Both write into src/rules/situationalBonuses.ts; B also edits public/core.json to remove the flat
 * bonus. Corrections from the adversarial verify pass REPLACE the first extraction — a refuted record
 * is a revision, not a rejection.
 *
 * Usage: node scripts/apply-rulings-bc.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { formatBackfill } from './lib/write-backfill.mjs';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);

const raw = JSON.parse(readFileSync(p('work/abc/bc-raw.json'), 'utf8'));
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const REGISTRY = p('src/rules/situationalBonuses.ts');
let src = readFileSync(REGISTRY, 'utf8');

// Re-runnable: a block from a previous run is REMOVED FIRST, before anything reads the registry.
// It has to happen here rather than at splice time — the "is this id already authored?" scan runs in
// between, and with the old block still present every id looked already-taken and nothing was added.
const MARKER = '  // ---- rulings B + C (scripts/apply-rulings-bc.mjs)';
{
  const at = src.indexOf(MARKER);
  if (at >= 0) src = src.slice(0, src.lastIndexOf('\n\n', at)) + src.slice(src.indexOf('\n};', at));
}

const SKILLS = new Set(
  readFileSync(p('src/rules/types.ts'), 'utf8').match(/export const SKILLS = \[([\s\S]*?)\]/)[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)),
);
const SAVES = new Set(['fortitude', 'reflex', 'will', 'all']);
const KINDS = new Set(['skill', 'save', 'perception', 'ac', 'attack', 'strikeAttack', 'strikeDamage', 'speed', 'hp', 'classDc', 'spell', 'spellDamage', 'ability']);

// Umbrella summaries are not ownable, so a star on one can never reach a sheet. Ruling A says they
// get no entries at all; the verify pass flagged addiction-suppressant for exactly this.
const umbrellaIds = (() => {
  const MECH = ['passiveEffects', 'effectChoices', 'situational', 'uses', 'spell', 'runes', 'damage', 'acBonus', 'capacity', 'value', 'heldSpells', 'dynamicSkillBonus', 'spellSlotBonus'];
  const ids = Object.keys(core.items).sort();
  const out = new Set(['aon-magical-medals']);
  for (let i = 0; i < ids.length; i++) {
    const it = core.items[ids[i]];
    if ((it.price && Object.values(it.price).some(Boolean)) || MECH.some((k) => it[k] != null && (!Array.isArray(it[k]) || it[k].length))) continue;
    let kin = 0;
    for (let j = i + 1; j < ids.length && ids[j].startsWith(ids[i] + '-'); j++) kin++;
    if (kin >= 2) out.add(ids[i]);
  }
  return out;
})();

/** Corrections win: the verify pass read the same text and disputed the reading. */
const merge = (lane) => {
  const byId = new Map(lane.extracted.map((r) => [r.id, r]));
  let applied = 0;
  for (const f of lane.findings) {
    try { const c = JSON.parse(f.correction); byId.set(c.id, c); applied++; }
    catch { console.log(`  ! ${f.id}: correction is not valid JSON — keeping the original`); }
  }
  return { records: [...byId.values()], applied };
};

const B = merge(raw.B);
const C = merge(raw.C);
console.log(`corrections applied — B: ${B.applied}/${raw.B.findings.length}, C: ${C.applied}/${raw.C.findings.length}`);

const problems = [];
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** A target the engine can actually match, or null with the reason recorded. */
function validTarget(id, t) {
  if (!KINDS.has(t.kind)) { problems.push(`${id}: unknown target kind "${t.kind}"`); return null; }
  if (t.kind === 'skill') {
    const d = t.detail;
    if (!d) { problems.push(`${id}: skill target with no detail`); return null; }
    if (d !== 'all' && !d.startsWith('lore:') && !SKILLS.has(d)) { problems.push(`${id}: unknown skill "${d}"`); return null; }
  }
  if (t.kind === 'save' && t.detail && !SAVES.has(t.detail)) { problems.push(`${id}: unknown save "${t.detail}"`); return null; }
  return t;
}

/**
 * Cap the note at roughly one line — ruling H: "cap the note at about one line; anything longer gets
 * trimmed to its essential trigger, with the full text staying in the item's own description."
 *
 * Parentheticals go first, because a parenthetical is an aside by definition: dropping "(you lose the
 * Performance bonus until you use the activation again)" leaves the trigger intact, where cutting at
 * 90 characters left the sentence hanging inside an unclosed bracket.
 */
const NOTE_CAP = 90;
function trimWhen(id, when) {
  const full = String(when ?? '').trim().replace(/\s+/g, ' ');
  if (full.length <= NOTE_CAP) return full;

  let s = full.replace(/\s*\([^()]*\)\s*/g, ' ').trim().replace(/\s+/g, ' ').replace(/[,;]$/, '');
  if (s.length > NOTE_CAP) {
    const cut = s.slice(0, NOTE_CAP);
    const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf('; '), cut.lastIndexOf(' — '));
    s = (at > 40 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(' '))).trim();
  }
  // The ellipsis is the promise that there is more, which the record's own description still holds.
  const out = `${s}…`;
  problems.push(`${id}: note trimmed to one line (${full.length} → ${out.length}) — "${out}"`);
  return out;
}

const entries = new Map();       // id -> array of literal strings
const stripped = [];             // [id, description of what was removed] — this run only
// Every record a ruling means to strip, whether or not this run found anything left to remove. The
// overlay is synced from THIS set: on a re-run the strips are already applied, so keying the overlay
// off `stripped` would leave core.json edited and the overlay stale — which is the exact drift the
// durability test exists to catch.
const striptIds = new Set();
let bonusCount = 0;

function addEntries(id, list) {
  if (umbrellaIds.has(id)) { problems.push(`${id}: umbrella summary — no entries (ruling A)`); return; }
  const out = [];
  for (const b of list ?? []) {
    const targets = (b.targets ?? []).map((t) => validTarget(id, t)).filter(Boolean);
    if (!targets.length) continue;
    if (!String(b.bonus ?? '').trim()) { problems.push(`${id}: entry with no bonus text — dropped`); continue; }
    const lits = targets.map((t) => (t.detail ? `{ kind: '${t.kind}', detail: '${esc(t.detail)}' }` : `{ kind: '${t.kind}' }`));
    out.push(`{ targets: [${lits.join(', ')}], when: "${esc(trimWhen(id, b.when))}", bonus: "${esc(String(b.bonus).trim())}" }`);
    bonusCount++;
  }
  if (out.length) entries.set(id, [...(entries.get(id) ?? []), ...out]);
}

// ---- B: strip the restricted flat bonus, then star it ----
for (const r of B.records) {
  if (r.verdict === 'move-to-star' && r.stripFlat) {
    striptIds.add(r.id);
    const rec = core[r.collection ?? 'items']?.[r.id] ?? core.items[r.id] ?? core.feats[r.id];
    const pe = rec?.passiveEffects;
    if (!pe) problems.push(`${r.id}: stripFlat asked for, but the record has no passiveEffects`);
    else {
      const gone = [];
      for (const k of ['perception', 'saves', 'ac', 'attack']) if (r.stripFlat[k] && pe[k] != null) { gone.push(`${k}=${pe[k]}`); delete pe[k]; }
      for (const s of r.stripFlat.skills ?? []) {
        if (pe.skills?.[s] != null) { gone.push(`${s}=${pe.skills[s]}`); delete pe.skills[s]; }
        else problems.push(`${r.id}: stripFlat named skill "${s}" the record does not carry`);
      }
      if (pe.skills && !Object.keys(pe.skills).length) delete pe.skills;
      // An emptied passiveEffects is removed outright so the umbrella/mechanical guard sees the truth.
      if (!Object.keys(pe).length) delete rec.passiveEffects;
      if (gone.length) stripped.push([r.id, gone.join(', ')]);
    }
  }
  addEntries(r.id, r.situational);
}

// ---- C: star every capable skill ----
for (const r of C.records) {
  if (r.verdict !== 'star') continue;
  if (r.alsoStripFlat) {
    striptIds.add(r.id);
    const rec = core.items[r.id] ?? core.feats[r.id];
    const pe = rec?.passiveEffects;
    if (pe) {
      const gone = [];
      for (const k of ['perception', 'saves', 'ac']) if (r.alsoStripFlat[k] && pe[k] != null) { gone.push(`${k}=${pe[k]}`); delete pe[k]; }
      for (const s of r.alsoStripFlat.skills ?? []) if (pe.skills?.[s] != null) { gone.push(`${s}=${pe.skills[s]}`); delete pe.skills[s]; }
      if (pe.skills && !Object.keys(pe.skills).length) delete pe.skills;
      if (!Object.keys(pe).length) delete rec.passiveEffects;
      if (gone.length) stripped.push([r.id, gone.join(', ')]);
    }
  }
  addEntries(r.id, r.situational);
}

// ---- splice into the registry ----
const existing = new Set([...src.matchAll(/^ {2}"([a-z0-9-]+)":\s\[/gm)].map((m) => m[1]));
const collide = [...entries.keys()].filter((id) => existing.has(id));
if (collide.length) {
  // A hand-authored or previously-generated entry is a verified anchor; adding a second key for the
  // same id would make the LAST one silently win.
  problems.push(`already in the registry, not re-added: ${collide.join(', ')}`);
  for (const id of collide) entries.delete(id);
}

const lines = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, out]) => `  "${id}": [${out.join(', ')}],`);
const banner =
  `\n\n  // ---- rulings B + C (scripts/apply-rulings-bc.mjs) — do not hand-edit below this line ----\n` +
  `  // B: a flat bonus the text restricts moves here, and leaves passiveEffects, so the total is right.\n` +
  `  // C: an action-named bonus stars EVERY skill that can perform that action, not just the obvious one.\n` +
  `  // ${lines.length} records / ${bonusCount} bonuses, adversarially verified.\n`;

const openTok = 'export const FEAT_SITUATIONAL: Record<string, SituationalBonus[]> = {';
const open = src.indexOf(openTok);
const close = src.indexOf('\n};', open);
if (open < 0 || close < 0) throw new Error('registry: could not locate the object literal');
src = src.slice(0, close) + banner + lines.join('\n') + src.slice(close);

// ---- the overlay: the ONLY thing that survives `npm run data` ----
// A strip written straight into core.json lasts until the next regeneration and no longer. Every
// record whose passiveEffects changed gets its new value recorded here, or ruling B quietly undoes
// itself on the next import. `null` is how the overlay says "this field should not be there".
const OVERLAY = p('scripts/data/effect-backfill.json');
const overlay = JSON.parse(readFileSync(OVERLAY, 'utf8'));
let overlayUpdated = 0;
let overlayAdded = 0;
for (const id of striptIds) {
  const category = core.items[id] ? 'items' : 'feats';
  const value = core[category][id].passiveEffects ?? null;
  // EVERY match, not just the first. The overlay already held duplicate patches for a few records
  // (harmless while identical), and updating only the first left the second holding the old value —
  // the applier is last-write-wins, so the stale copy would have undone the strip on re-import.
  const matches = overlay.filter((x) => x.category === category && x.id === id && x.field === 'passiveEffects');
  if (matches.length) {
    for (const m of matches) m.value = value;
    // Collapse the duplicates so the pair cannot silently diverge again.
    if (matches.length > 1) {
      for (let i = overlay.length - 1; i >= 0; i--) if (matches.indexOf(overlay[i]) > 0) overlay.splice(i, 1);
    }
    overlayUpdated++;
  } else {
    overlay.push({ category, id, field: 'passiveEffects', value });
    overlayAdded++;
  }
}
console.log(`overlay  : ${overlayUpdated} updated, ${overlayAdded} added — the strips now survive a re-import`);

console.log(`\nregistry : +${lines.length} records / ${bonusCount} bonuses (${existing.size} → ${existing.size + lines.length})`);
console.log(`flat     : ${stripped.length} records lost a restricted bonus`);
for (const [id, what] of stripped) console.log(`   ${id}: removed ${what}`);
if (problems.length) {
  console.log(`\n${problems.length} notes:`);
  for (const x of problems) console.log('   ' + x);
}
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(REGISTRY, src);
writeFileSync(OVERLAY, formatBackfill(overlay));
writeFileSync(p('public/core.json'), JSON.stringify(core)); // MINIFIED — pretty-printing costs 4 MB
console.log('\nwritten  : src/rules/situationalBonuses.ts, scripts/data/effect-backfill.json, public/core.json');
