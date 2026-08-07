/*
 * WEAPON and ARMOUR statistics, app vs the AoN mirror.
 *
 * These are the numbers the sheet actually rolls with: a wrong damage die changes every Strike, a
 * wrong AC bonus changes Armor Class, a wrong hands count changes what you can hold. They are also
 * the numbers nobody notices are wrong, because the sheet computes confidently either way.
 *
 * Same three guards as scripts/field-diff.mjs — see its header for why each exists.
 *
 *   node scripts/stat-check.mjs          # summary + the unexplained rows
 *   node scripts/stat-check.mjs --all    # also list what a guard is holding back
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const showAll = process.argv.includes('--all');

const norm = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const book = (s) => norm(String(s ?? '')).replace(/^pathfinder /, '').replace(/ remastered$/, '').replace(/^lost omens /, '').trim();

/**
 * One mirror record for this app record, or null.
 *
 * ⚠ The narrowed set must agree with itself on the FIELD BEING COMPARED, not merely on identity.
 * The mirror files Panabas under both Sword and Axe, and Repeating Hand Crossbow under both Bow and
 * Crossbow, across records that are otherwise the same weapon — so a "fix" drawn from whichever came
 * first would be a coin flip. Weapon GROUP is not compared at all for this reason; it decides the
 * critical specialization effect and the mirror cannot settle it.
 */
const resolve = (rec, list, field) => {
  const val = (m) => JSON.stringify(field(m));
  if (new Set(list.map(val)).size === 1) return list[0];
  const appBook = book(rec.source?.book);
  let matches = appBook ? list.filter((m) => (m.source ?? []).some((s) => book(s) === appBook)) : [];
  if (matches.length > 1 && matches.some((m) => !m.remaster_id)) matches = matches.filter((m) => !m.remaster_id);
  if (matches.length && new Set(matches.map(val)).size === 1) return matches[0];
  return null;
};

/**
 * The armour stat line, parsed out of the printed text. An em dash means "none" → 0.
 * Returns null when the line is not present or not complete, so a partial parse never invents a 0.
 */
const printedArmourLine = (m) => {
  const t = String(m.text ?? '').replace(/\s+/g, ' ');
  const num = (label) => {
    const r = new RegExp(`${label}\\s*(—|[+-]?\\d+)`, 'i').exec(t);
    if (!r) return null;
    return r[1] === '—' ? 0 : Number(r[1]);
  };
  const out = {
    dexCap: num('Dex Cap'),
    checkPenalty: num('Check Penalty'),
    speedPenalty: num('Speed Penalty'),
    strength: num('Strength'),
  };
  return Object.values(out).every((v) => v != null) ? out : null;
};

/**
 * The printed Bulk value: a number, "L" (0.1 here) or "—" (0). Null when it cannot be read cleanly.
 *
 * PF2e writes bulk as a number, L or —, and the mirror's `bulk` FIELD flattens L to 0 — so the field
 * alone reports every light item as wrong. Two guards keep a neighbouring item's line from being
 * copied across: more than one Bulk line means a multi-item page, and so does more than one <title>,
 * which is the case Silver's page hits ("Silver Chunk … Bulk L" then a second title for the ingot).
 */
const printedBulk = (m) => {
  const t = String(m.text ?? '').replace(/\s+/g, ' ');
  const all = [...t.matchAll(/\bBulk\s+(L|—|-|[\d.]+)\b/gi)];
  if (all.length !== 1) return null;
  if ((t.match(/<title/g) ?? []).length > 1) return null;
  const v = all[0][1];
  if (/^l$/i.test(v)) return 0.1;
  if (v === '—' || v === '-') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const load = (dir) => {
  const byName = new Map();
  let files;
  try { files = readdirSync(join(MIRROR, dir)); } catch { return byName; }
  for (const f of files) {
    const j = JSON.parse(readFileSync(join(MIRROR, dir, f), 'utf8'));
    if (!j.name) continue;
    const k = norm(j.name);
    const list = byName.get(k);
    if (list) list.push(j);
    else byName.set(k, [j]);
  }
  return byName;
};

let compared = 0;
const held = [];
const bad = [];
const note = (id, field, have, want) => bad.push({ id, field, have, want });

/* ---- weapons ---------------------------------------------------------------------------- */
{
  const byName = load('weapon');
  const DAMAGE_LETTER = { b: 'bludgeoning', p: 'piercing', s: 'slashing' };
  for (const [id, rec] of Object.entries(db.items ?? {})) {
    if (rec?.itemType !== 'weapon' || ['superseded', 'legacy', 'legacy-era'].includes(rec.edition)) continue;
    const list = byName.get(norm(rec.name)) ?? [];
    if (!list.length) continue;
    compared++;
    const m = resolve(rec, list, (x) => x.damage);
    if (!m) {
      held.push(`${id}: the mirror records under this name disagree on damage`);
      continue;
    }
    // "1d8 S" / "1d4 B". A weapon with no damage line (ammunition, a shield boss entry) is skipped.
    const dm = /^(\d+)d(\d+)\s*([BPS])$/i.exec(String(m.damage ?? '').trim());
    if (dm && rec.damage) {
      const wantDice = Number(dm[1]);
      const wantDie = `d${dm[2]}`;
      const wantType = DAMAGE_LETTER[dm[3].toLowerCase()];
      if (rec.damage.dice !== wantDice) note(id, 'damage.dice', rec.damage.dice, wantDice);
      if (rec.damage.die !== wantDie) note(id, 'damage.die', rec.damage.die, wantDie);
      if (rec.damage.type !== wantType) note(id, 'damage.type', rec.damage.type, wantType);
    }
    const mh = resolve(rec, list, (x) => x.hands);
    if (mh && typeof mh.hands === 'number' && typeof rec.hands === 'number' && mh.hands !== rec.hands) {
      note(id, 'hands', rec.hands, mh.hands);
    }
    /*
     * GROUP and CATEGORY are deliberately not compared. The mirror files Panabas under both Sword and
     * Axe and Repeating Hand Crossbow under both Bow and Crossbow, in records that are otherwise the
     * same weapon, so it cannot settle either — and the group decides the critical specialization
     * effect, which is too load-bearing to set from a coin flip.
     */
  }
}

/* ---- armour ----------------------------------------------------------------------------- */
{
  const byName = load('armor');
  for (const [id, rec] of Object.entries(db.items ?? {})) {
    if (rec?.itemType !== 'armor' || ['superseded', 'legacy', 'legacy-era'].includes(rec.edition)) continue;
    const list = byName.get(norm(rec.name)) ?? [];
    if (!list.length) continue;
    compared++;
    const m = resolve(rec, list, (x) => x.ac);
    if (!m) {
      held.push(`${id}: the mirror records under this name disagree on AC`);
      continue;
    }
    if (typeof m.ac === 'number' && typeof rec.acBonus === 'number' && m.ac !== rec.acBonus) {
      note(id, 'acBonus', rec.acBonus, m.ac);
    }
    /*
     * The other four numbers are not in a structured field — they are in the printed stat line:
     *   "AC Bonus +1 Dex Cap +4 Check Penalty -1 Speed Penalty — Strength +0 Bulk 1"
     * An em dash means "none", which is 0. All four drive real arithmetic: the Dex cap and check
     * penalty change AC and every armour-affected skill, and the Strength threshold decides whether
     * the penalties apply at all.
     */
    const printed = printedArmourLine(m);
    if (!printed) continue;
    for (const [field, appField] of [['dexCap', 'dexCap'], ['checkPenalty', 'checkPenalty'], ['speedPenalty', 'speedPenalty'], ['strength', 'strength']]) {
      const want = printed[field];
      const have = rec[appField];
      if (want == null || typeof have !== 'number' || want === have) continue;
      note(id, appField, have, want);
    }
  }
}

/* ---- bulk, on every item ---------------------------------------------------------------- */
{
  const byName = load('equipment');
  for (const d of ['weapon', 'armor', 'shield']) {
    for (const [k, v] of load(d)) {
      const list = byName.get(k);
      if (list) list.push(...v);
      else byName.set(k, v);
    }
  }
  for (const [id, rec] of Object.entries(db.items ?? {})) {
    if (!rec?.name || typeof rec.bulk !== 'number') continue;
    if (['superseded', 'legacy', 'legacy-era'].includes(rec.edition)) continue;
    const list = byName.get(norm(rec.name)) ?? [];
    if (!list.length) continue;
    const printed = new Set(list.map(printedBulk).filter((v) => v != null));
    if (printed.size !== 1) continue;
    const want = [...printed][0];
    // The mirror's own `bulk` FIELD must corroborate its printed line. The field flattens "L" to 0,
    // so a printed 0.1 is corroborated by a field of 0; a printed 2 with a field of 0 is the two
    // halves of the mirror disagreeing, and neither can be trusted.
    const fields = new Set(list.map((m) => m.bulk).filter((v) => typeof v === 'number'));
    if (fields.size !== 1) continue;
    const field = [...fields][0];
    if (!(field === want || (want === 0.1 && field === 0))) continue;
    compared++;
    if (want !== rec.bulk) note(id, 'bulk', rec.bulk, want);
  }
}

console.log(`weapons + armour + bulk compared: ${compared}`);
console.log(`held back by a guard:      ${held.length}`);
if (showAll) for (const h of held) console.log(`   ${h}`);
console.log(`\nUNEXPLAINED: ${bad.length}`);
for (const b of bad) console.log(`   ${b.field.padEnd(12)} ${b.id.padEnd(36)} app ${JSON.stringify(b.have)} -> mirror ${JSON.stringify(b.want)}`);
if (bad.length) process.exitCode = 1;
