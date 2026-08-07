/*
 * SPELL saving throw and RANGE, against the AoN mirror — with the Foundry pf2e data as a second
 * source for the one field the mirror cannot settle.
 *
 * A save decides which defence the target rolls; a range decides whether the spell reaches. Neither
 * is ever recomputed, so a wrong one is silent.
 *
 * ⚠ THE `basic` FLAG IS NOT COMPARED, and the reason is worth keeping.
 *
 * It is not on AoN's Saving Throw line, its structured field omits it inconsistently, and the same
 * spell appears with and without it across printings — so a naive comparison reported 122 spells,
 * then 31, then 14, none of which was a defect count. Foundry looked like the answer because it
 * carries `savingThrow: {type, basic}` structurally, and I removed the flag from seven spells on
 * that basis before checking whether ABSENCE means anything there. It does not: Chain Lightning's
 * own body reads "basic Reflex" and its Foundry `savingThrow` is `{type:["R"]}` with no flag. All
 * seven changes were reverted.
 *
 * A positive is still trustworthy — Foundry's `basic: true`, or a body that says "basic Reflex" —
 * so the flag could be ADDED where it is missing, but never removed. Nothing in the data currently
 * needs that, so this compares the save TYPE (which both sources agree on) and the range.
 *
 *   node scripts/spell-check.mjs         # summary + the unexplained rows
 *   node scripts/spell-check.mjs --all   # also list what a guard is holding back
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/spell';
const FOUNDRY = 'C:/wonderers guide/pf2e-data-source/extracted/dist/data/spells';
const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));
const showAll = process.argv.includes('--all');

const norm = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const SAVE = { fortitude: 'fortitude', reflex: 'reflex', will: 'will', f: 'fortitude', r: 'reflex', w: 'will' };

/* ---- the two sources ---------------------------------------------------------------------- */
const mirror = new Map();
for (const f of readdirSync(MIRROR)) {
  const j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  if (!j.name) continue;
  const k = norm(j.name);
  const list = mirror.get(k);
  if (list) list.push(j);
  else mirror.set(k, [j]);
}
/** name -> {type, basic} from Foundry, or null when its records disagree. */
const foundry = new Map();
if (existsSync(FOUNDRY)) {
  const seen = new Map();
  for (const f of readdirSync(FOUNDRY)) {
    let j;
    try { j = JSON.parse(readFileSync(join(FOUNDRY, f), 'utf8')); } catch { continue; }
    for (const e of j.spell ?? []) {
      if (!e?.name || !e.savingThrow?.type?.length) continue;
      const k = norm(e.name);
      const v = `${SAVE[norm(e.savingThrow.type[0])] ?? ''}|${!!e.savingThrow.basic}`;
      const prev = seen.get(k);
      seen.set(k, prev && prev !== v ? 'CONFLICT' : v);
    }
  }
  for (const [k, v] of seen) {
    if (v === 'CONFLICT') continue;
    const [type, basic] = v.split('|');
    if (type) foundry.set(k, { type, basic: basic === 'true' });
  }
}

const resolve = (list, field) => {
  const val = (m) => JSON.stringify(field(m));
  const remaster = list.filter((m) => !m.remaster_id);
  const pool = remaster.length ? remaster : list;
  return new Set(pool.map(val)).size === 1 ? pool[0] : null;
};

let compared = 0;
const held = [];
const bad = [];
for (const [id, rec] of Object.entries(db.spells ?? {})) {
  if (!rec?.name || ['superseded', 'legacy', 'legacy-era'].includes(rec.edition)) continue;
  const key = norm(rec.name);
  const list = mirror.get(key) ?? [];
  if (!list.length) continue;

  /* ---- saving throw: both sources must agree, and both must disagree with the app ---- */
  const ms = resolve(list, (x) => x.saving_throw);
  const raw = ms?.saving_throw ? String(Array.isArray(ms.saving_throw) ? ms.saving_throw[0] : ms.saving_throw) : null;
  if (raw && !/see (text|below)/i.test(raw) && rec.save?.type) {
    const aonType = SAVE[norm(raw.replace(/\bbasic\b/i, ''))] ?? null;
    const fd = foundry.get(key);
    if (aonType && fd) {
      compared++;
      const have = norm(rec.save.type);
      // BOTH sources must name the same defence before the app's is called wrong.
      if (fd.type !== aonType) held.push(`${id}: the mirror says ${aonType}, Foundry says ${fd.type}`);
      else if (fd.type !== have) bad.push({ id, field: 'save', have, want: fd.type });
    } else if (aonType && !fd) {
      held.push(`${id}: not in the Foundry data, so its save has only one source`);
    }
  }

  /* ---- range: a number of feet in the mirror, a printed phrase here ---- */
  const mr = resolve(list, (x) => x.range);
  if (mr && typeof mr.range === 'number' && rec.range) {
    const feet = /([\d,]+)\s*(?:foot|feet|ft)/i.exec(rec.range);
    if (feet) {
      compared++;
      if (Number(feet[1].replace(/,/g, '')) !== mr.range) {
        bad.push({ id, field: 'range', have: rec.range, want: `${mr.range} feet` });
      }
    }
  }

  /* ---- area: size and SHAPE, from the printed line ---- */
  if (rec.baseArea?.value) {
    // Read the remaster half where the two differ — Door to Beyond was a 20-foot emanation in Gods &
    // Magic and is a 20-foot burst in Divine Mysteries, and Distortion Lens went from a 5-foot square
    // to a 5-foot burst.
    const remaster = list.filter((m) => !m.remaster_id);
    const pool = remaster.length ? remaster : list;
    const areas = new Set();
    for (const m of pool) {
      const am = /\bArea\s+(?:one\s+)?(\d+)[- ]foot\s+(burst|cone|emanation|line|square)/i.exec(String(m.text ?? '').replace(/\s+/g, ' '));
      if (am) areas.add(`${am[1]}|${norm(am[2])}`);
    }
    if (areas.size === 1) {
      compared++;
      const [size, kind] = [...areas][0].split('|');
      if (Number(size) !== rec.baseArea.value || kind !== norm(rec.baseArea.kind)) {
        bad.push({ id, field: 'area', have: `${rec.baseArea.value}ft ${rec.baseArea.kind}`, want: `${size}ft ${kind}` });
      }
    }
  }
}

console.log(`spell fields compared: ${compared}`);
console.log(`held back by a guard:  ${held.length}`);
if (showAll) for (const h of held) console.log(`   ${h}`);
console.log(`\nUNEXPLAINED: ${bad.length}`);
for (const b of bad) console.log(`   ${b.field.padEnd(6)} ${b.id.padEnd(34)} app ${JSON.stringify(b.have)} -> ${JSON.stringify(b.want)}`);
if (bad.length) process.exitCode = 1;
