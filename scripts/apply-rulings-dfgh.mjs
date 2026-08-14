/*
 * Applies rulings D, F, G and H.
 *
 *   D — a bonus with no stat row marks THE THING IT MODIFIES: the action (Treat Wounds heals d10s)
 *       or the condition (The Survivor changes Dying), with the changed value shown inline. A bonus
 *       that moves a SAVE DC rather than a save gets `dcOnly`, so the `*` lands on the DC.
 *   F — a bonus that lands on someone else does NOTHING to your sheet; if it runs for a stated time
 *       the activator gets a display-only mode so they can see it is going.
 *   G — the mark lives on the record you are looking at, and a set REPLACES the piece it upgrades.
 *   H — where the rules are open the app stays open; notes cap at one line.
 *
 * Writes: src/rules/situationalBonuses.ts (entries + markers + supersedes) and public/core.json's
 * `modes` bucket (F's display-only modes). Verify-pass corrections REPLACE the first extraction.
 *
 * Usage: node scripts/apply-rulings-dfgh.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(import.meta.dirname, '..');
const p = (f) => path.join(ROOT, f);

const raw = JSON.parse(readFileSync(p('work/dfgh/raw.json'), 'utf8'));
const core = JSON.parse(readFileSync(p('public/core.json'), 'utf8'));
const REGISTRY = p('src/rules/situationalBonuses.ts');
let src = readFileSync(REGISTRY, 'utf8');

const MARKER = '  // ---- rulings D + F + G + H (scripts/apply-rulings-dfgh.mjs)';
{
  const at = src.indexOf(MARKER);
  if (at >= 0) src = src.slice(0, src.lastIndexOf('\n\n', at)) + src.slice(src.indexOf('\n};', at));
}

const SKILLS = new Set(
  readFileSync(p('src/rules/types.ts'), 'utf8').match(/export const SKILLS = \[([\s\S]*?)\]/)[1].match(/'[a-z]+'/g).map((s) => s.slice(1, -1)),
);
const SAVES = new Set(['fortitude', 'reflex', 'will', 'all']);
const KINDS = new Set(['skill', 'save', 'perception', 'ac', 'attack', 'strikeAttack', 'strikeDamage', 'speed', 'hp', 'classDc', 'spell', 'spellDamage', 'ability']);

// Ruling A still governs: an umbrella summary is not ownable, so nothing can ever reach a sheet
// through it. The verify pass caught three records that had slipped past this.
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

const merge = (lane) => {
  const byId = new Map(lane.extracted.map((r) => [r.id, r]));
  let applied = 0;
  for (const f of lane.findings) {
    try { const c = JSON.parse(f.correction); byId.set(c.id, c); applied++; }
    catch { console.log(`  ! ${f.id}: correction is not valid JSON — keeping the original`); }
  }
  return { records: [...byId.values()], applied };
};

const D = merge(raw.D);
const F = merge(raw.F);
const GH = merge(raw.GH);
console.log(`corrections applied — D: ${D.applied}/${raw.D.findings.length}, F: ${F.applied}/${raw.F.findings.length}, GH: ${GH.applied}/${raw.GH.findings.length}`);

const problems = [];
const forOwner = [];
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function validTarget(id, t) {
  if (!KINDS.has(t.kind)) { problems.push(`${id}: unknown target kind "${t.kind}"`); return null; }
  if (t.kind === 'skill') {
    if (!t.detail) { problems.push(`${id}: skill target with no detail`); return null; }
    if (t.detail !== 'all' && !t.detail.startsWith('lore:') && !SKILLS.has(t.detail)) { problems.push(`${id}: unknown skill "${t.detail}"`); return null; }
  }
  if (t.kind === 'save' && t.detail && !SAVES.has(t.detail)) { problems.push(`${id}: unknown save "${t.detail}"`); return null; }
  // `dcOnly` describes a DC other creatures roll. Only a save (and a spell DC) has one.
  if (t.dcOnly && t.kind !== 'save' && t.kind !== 'spell') { problems.push(`${id}: dcOnly on ${t.kind}, which has no DC — flag dropped`); return { ...t, dcOnly: undefined }; }
  return t;
}

/** Ruling H's one-line cap. A parenthetical is an aside, so it goes before any mid-sentence cut. */
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
  return `${s}…`;
}

const entries = new Map();
const markers = new Map();
const supersedes = new Map();
const spellMarks = new Map();
const modes = [];
let bonusCount = 0;

function addEntries(id, list) {
  if (umbrellaIds.has(id)) { problems.push(`${id}: umbrella summary — no entries (ruling A)`); return; }
  const out = [];
  for (const b of list ?? []) {
    const targets = (b.targets ?? []).map((t) => validTarget(id, t)).filter(Boolean);
    if (!targets.length) continue;
    if (!String(b.bonus ?? '').trim()) { problems.push(`${id}: entry with no bonus text — dropped`); continue; }
    const lits = targets.map((t) => {
      const bits = [`kind: '${t.kind}'`];
      if (t.detail) bits.push(`detail: '${esc(t.detail)}'`);
      if (t.dcOnly) bits.push('dcOnly: true');
      return `{ ${bits.join(', ')} }`;
    });
    out.push(`{ targets: [${lits.join(', ')}], when: "${esc(trimWhen(id, b.when))}", bonus: "${esc(String(b.bonus).trim())}" }`);
    bonusCount++;
  }
  if (out.length) entries.set(id, [...(entries.get(id) ?? []), ...out]);
}

function addMarker(id, on, m) {
  if (!m?.targetId) { problems.push(`${id}: ${on}-marker with no target`); return; }
  const bucket = on === 'action' ? core.actions : core.conditions;
  if (!bucket?.[m.targetId]) { problems.push(`${id}: ${on} "${m.targetId}" is not in core.json — marker dropped`); return; }
  const bits = [`on: '${on}'`, `id: '${esc(m.targetId)}'`];
  if (m.value) bits.push(`value: "${esc(m.value)}"`);
  bits.push(`note: "${esc(trimWhen(id, m.note))}"`);
  markers.set(id, [...(markers.get(id) ?? []), `{ ${bits.join(', ')} }`]);
}

// ---- D ----
for (const r of D.records) {
  switch (r.verdict) {
    case 'action-marker': addMarker(r.id, 'action', r.marker); break;
    case 'condition-marker': addMarker(r.id, 'condition', r.marker); break;
    case 'dc-only-save':
    case 'ordinary-star':
      addEntries(r.id, r.situational);
      break;
    case 'not-yours':
      // A companion item's entries still go in the registry — CompanionsTab reads them by item id off
      // the COMPANION's own inventory, which is exactly where the ★ ruling puts the gear.
      addEntries(r.id, r.situational);
      break;
    case 'no-surface':
      forOwner.push(`D/${r.id}: ${r.reason}`);
      break;
    default: problems.push(`${r.id}: unhandled D verdict "${r.verdict}"`);
  }
}

// ---- F ----
for (const r of F.records) {
  if (r.verdict === 'yours-after-all') { addEntries(r.id, r.situational); continue; }
  if (r.verdict === 'ally-instant') continue; // nothing on your sheet, and nothing running to show
  if (r.verdict !== 'ally-timed') { problems.push(`${r.id}: unhandled F verdict "${r.verdict}"`); continue; }
  if (umbrellaIds.has(r.id)) { problems.push(`${r.id}: umbrella summary — no mode (ruling A)`); continue; }
  const m = r.mode;
  if (!m?.name || !m.duration) { problems.push(`${r.id}: ally-timed with no mode name/duration`); continue; }
  const isItem = !!core.items[r.id];
  // The two source kinds need DIFFERENT mechanisms, and using the item one for a feat leaves the mode
  // unreachable: `fromItemId` both hides the mode from the Modes panel and makes "Use one" the only
  // way to switch it on — and a feat has no Use button. A feat's mode is therefore an ordinary
  // player-toggled mode GATED on having that feat, which is what the `feats` gate already does.
  const source = isItem
    ? { fromItemId: r.id }
    : { feats: [r.id], category: 'Ally effects', predefined: true };
  modes.push({
    id: `${isItem ? 'item' : 'feat'}-${r.id}`,
    name: m.name,
    ...source,
    duration: m.duration,
    ...(m.survivesRest ? { survivesRest: true } : {}),
    // The note is the whole mode: nothing of the player's changes, so without it the pill says nothing.
    note: m.note || `Running — the benefit goes to ${r.whoGetsIt || 'someone else'}, not to you.`,
    modifiers: [],
  });
}

// ---- G + H ----
for (const r of GH.records) {
  switch (r.verdict) {
    case 'star': addEntries(r.id, r.situational); break;
    case 'star-replaces':
      addEntries(r.id, r.situational);
      if (r.replacesId) supersedes.set(r.id, [...(supersedes.get(r.id) ?? []), r.replacesId]);
      else problems.push(`${r.id}: star-replaces with no replacesId`);
      break;
    case 'move-to-other-record':
      if (!r.moveToId) { problems.push(`${r.id}: move-to-other-record with no moveToId`); break; }
      // The mark lives on the thing you are looking at when it matters — for Distant Grasp that is
      // the SPELL, so it goes in SPELL_MARKERS keyed by the spell and gated on owning this record.
      if (r.moveToCollection === 'spells') {
        if (!core.spells?.[r.moveToId]) { problems.push(`${r.id}: spell "${r.moveToId}" is not in core.json`); break; }
        for (const b of r.situational ?? []) {
          if (!String(b.bonus ?? '').trim()) continue;
          spellMarks.set(r.moveToId, [
            ...(spellMarks.get(r.moveToId) ?? []),
            `{ source: '${esc(r.id)}', when: "${esc(trimWhen(r.id, b.when))}", bonus: "${esc(String(b.bonus).trim())}" }`,
          ]);
        }
        break;
      }
      addEntries(r.moveToId, r.situational);
      break;
    case 'no-star': break;
    default: problems.push(`${r.id}: unhandled GH verdict "${r.verdict}"`);
  }
}

// ---- splice the registry ----
const existing = new Set([...src.matchAll(/^ {2}"([a-z0-9-]+)":\s\[/gm)].map((m) => m[1]));
const collide = [...entries.keys()].filter((id) => existing.has(id));
if (collide.length) {
  problems.push(`already in the registry, not re-added: ${collide.join(', ')}`);
  for (const id of collide) entries.delete(id);
}

const entryLines = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, out]) => `  "${id}": [${out.join(', ')}],`);
const banner =
  `\n\n  // ---- rulings D + F + G + H (scripts/apply-rulings-dfgh.mjs) — do not hand-edit below ----\n` +
  `  // D: a DC-only bonus carries dcOnly, so the * lands on the DC and not on the save you roll.\n` +
  `  // G: a set's entry supersedes its piece's (SITUATIONAL_SUPERSEDES below).\n` +
  `  // ${entryLines.length} records / ${bonusCount} bonuses, adversarially verified.\n`;

const openTok = 'export const FEAT_SITUATIONAL: Record<string, SituationalBonus[]> = {';
const open = src.indexOf(openTok);
const close = src.indexOf('\n};', open);
if (open < 0 || close < 0) throw new Error('registry: could not locate FEAT_SITUATIONAL');
src = src.slice(0, close) + banner + entryLines.join('\n') + src.slice(close);

/*
 * ⚠ THESE THREE TABLES USED TO BE ASSIGNED WHOLESALE, AND THAT WAS A LOADED GUN.
 *
 * This script builds `markers` from work/dfgh/raw.json alone — SIX records — and then wrote the whole
 * `RECORD_MARKERS` object literal from it. That literal holds 119 entries today: the ruling-D/F/G/H
 * six, the 12 oracle curses, the 36 from the feature audit, and every hand-authored row since. A
 * single re-run of this file would have deleted 113 of them with no error and no way to notice, the
 * same failure mode the apply-reviewed.ts serialiser had.
 *
 * MEASURED before the change: `node scripts/apply-rulings-dfgh.mjs --dry` reports "markers : 6
 * records"; simulating its own assignTable in memory took RECORD_MARKERS from 119 entries to 6, and
 * SPELL_MARKERS from 2 to 1.
 *
 * So they MERGE now, with the same semantics scripts/apply-sweep-b1.mjs already uses: existing keys
 * win (a hand-authored row is authoritative and re-running is a no-op), new ones are appended sorted.
 * A key this script owns and wants to CHANGE must be removed from the .ts by hand first — which is
 * loud, unlike silently losing 113.
 */
function mergeTable(decl, entries, fmt) {
  const at = src.indexOf(decl);
  if (at < 0) throw new Error(`registry: could not find "${decl}"`);
  const openBrace = src.indexOf('{', at + decl.length - 1);
  let end = src[openBrace + 1] === '}' ? openBrace + 2 : src.indexOf('\n};', openBrace) + 3;
  // Step past the statement's own semicolon so re-running cannot leave `};;` behind.
  while (src[end] === ';') end++;
  const body = src.slice(openBrace + 1, end - 2).replace(/^\n+|\n+$/g, '');
  const have = new Set([...body.matchAll(/^\s*['"]?([a-z0-9-]+)['"]?\s*:/gm)].map((m) => m[1]));
  const added = [...entries.entries()].filter(([k]) => !have.has(k)).sort(([a], [b]) => a.localeCompare(b));
  for (const [k] of entries) if (have.has(k)) skippedTable.push(`${k}: already in ${decl.split(' ')[2].replace(':', '')}`);
  if (!added.length) return;
  const next = [body, ...added.map(fmt)].filter(Boolean).join('\n');
  src = src.slice(0, at) + `${decl} {\n${next}\n};` + src.slice(end);
}
const skippedTable = [];

mergeTable(
  'export const RECORD_MARKERS: Record<string, RecordMarker[]> =',
  markers,
  ([id, ms]) => `  "${id}": [${ms.join(', ')}],`,
);
mergeTable(
  'export const SITUATIONAL_SUPERSEDES: Record<string, string[]> =',
  supersedes,
  ([id, ids]) => `  "${id}": [${ids.map((x) => `'${esc(x)}'`).join(', ')}],`,
);
mergeTable(
  'export const SPELL_MARKERS: Record<string, SpellMarker[]> =',
  spellMarks,
  ([id, ms]) => `  "${id}": [${ms.join(', ')}],`,
);

// ---- F's display-only modes into core.json ----
// Same bucket and shape as the consumable modes, so they inherit the pill, the X, the clear-on-rest
// and the hidden-from-the-Modes-panel behaviour without a second mechanism.
const mine = new Set(modes.map((n) => n.id));
// Also drop any mode a PREVIOUS run of this script left behind under the old id scheme.
const kept = Object.entries(core.modes ?? {}).filter(([id, m]) => !mine.has(m.id) && !mine.has(id) && !modes.some((n) => n.name === m.name && (m.fromItemId ?? m.feats?.[0]) === (n.fromItemId ?? n.feats?.[0])));
core.modes = Object.fromEntries([...kept, ...modes.map((m) => [m.id, m])]);

console.log(`\nregistry : +${entryLines.length} records / ${bonusCount} bonuses`);
console.log(`markers  : ${markers.size} records mark an action or condition`);
if (skippedTable.length) {
  console.log(`  ${skippedTable.length} table entries left alone (the live file wins — see the mergeTable note):`);
  for (const s of skippedTable) console.log('     ' + s);
}
console.log(`spells   : ${spellMarks.size} spells carry a marker`);
console.log(`supersede: ${supersedes.size} set entries replace a piece's`);
console.log(`modes    : ${modes.length} display-only pills for timed ally effects`);
if (problems.length) { console.log(`\n${problems.length} notes:`); for (const x of problems) console.log('   ' + x); }
if (forOwner.length) {
  console.log(`\n${forOwner.length} FOR THE OWNER (no surface fits):`);
  for (const x of forOwner) console.log('   • ' + x.slice(0, 220));
}
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(REGISTRY, src);
writeFileSync(p('public/core.json'), JSON.stringify(core));
writeFileSync(p('work/dfgh/for-owner.json'), JSON.stringify(forOwner, null, 1));
console.log('\nwritten  : src/rules/situationalBonuses.ts, public/core.json');
