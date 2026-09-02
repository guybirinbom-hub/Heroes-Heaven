/*
 * CLASS CASTING PARITY — the behaviour a per-record diff can never see.
 *
 * The owner's cleric prepared cantrips in the builder while Wanderer's Guide prepares them every
 * morning. No record carried that difference: WG encodes a class's casting on its class-feature row
 * (one `defineCastingSource` token — PREPARED-TRADITION / PREPARED-LIST / SPONTANEOUS-REPERTOIRE / '-'
 * — plus a `giveSpellSlot` table with rank-0 rows for cantrips), and its ENGINE does the rest. Our
 * engine keeps the same facts on the ClassDef and builds the entry. So this compares the two engines'
 * OUTPUT, class by class, level by level: casting type, tradition, key attribute, cantrips per level,
 * slots per rank per level, and whether a prepared caster prepares cantrips daily (owner, 2026-09-02).
 *
 *   npx jiti scripts/wg-casting.mjs              # every class both sides encode → work/wg-casting-parity.json
 *   npx jiti scripts/wg-casting.mjs --class cleric
 *   npx jiti scripts/wg-casting.mjs --verbose    # print the level table for every class, not just mismatches
 *
 * Report-only. Nothing is written into data; a mismatch is either a fix (with a test) or, where WG's
 * table contradicts the printed one, a question for work/owner-questions.json — never a decision here.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopyBlock, parseOps, untsv } from './lib/wg-parse.mjs';
import { seedContent } from '../src/rules/seed';
import { buildCharacter, emptyBuild } from '../src/rules/build';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const VERBOSE = process.argv.includes('--verbose');
const ONLY = arg('--class', null);
const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) { console.error("No Wanderer's Guide dump at work/wg/wg-data.sql (gitignored on purpose: GPL-3.0; differ only)."); process.exit(2); }

/* ---- our content, exactly as the app assembles it ------------------------------------------------ */
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const db = {};
for (const k of new Set([...Object.keys(seedContent), ...Object.keys(core)])) db[k] = { ...(seedContent[k] ?? {}), ...(core[k] ?? {}) };

/* ---- their casting sources ----------------------------------------------------------------------- */
const sql = readFileSync(DUMP, 'utf8');
const rows = parseCopyBlock(sql, 'ability_block').rows;
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const classByNorm = new Map(Object.keys(db.classes).map((id) => [norm(id), id]));

/**
 * source name -> { tokens, traditions, attributes, slots[], rows } from the class's OWN class-feature
 * rows. ⚠ Only class-feature rows, never feats: the archetype dedications ("Basic Cleric Spellcasting",
 * "Cantrip Expansion", "Divine Breadth") add slots INTO the same casting source, and summing them
 * reported the cleric as having 10 cantrips. Legacy duplicates ("Oracle Spellcasting (legacy)") are
 * skipped so a remastered class is not counted twice. A sorcerer's bloodlines each define the source
 * with their own tradition, so tradition is a SET, not a value.
 */
const theirs = new Map();
const isLegacy = (name) => /\(legacy\)|\blegacy\b/i.test(name);
// One row per name, the RICHEST (most ops) — the dump carries duplicate class-feature rows for some
// classes (a playtest and a release copy), and counting both doubles the slot table.
const richest = new Map();
// "Animist and Apparition Spellcasting" and "Animist & Apparition Spellcasting" are one row twice.
const rowKey = (name) => norm(String(name).replace(/&/g, ' and '));
for (const r of rows) {
  if (r.type !== 'class-feature' || isLegacy(untsv(r.name))) continue;
  const key = rowKey(untsv(r.name));
  const n = parseOps(r.operations).length;
  if (!richest.has(key) || richest.get(key).n < n) richest.set(key, { r, n });
}
const classFeatureRows = [...richest.values()].map((x) => x.r);
for (const r of classFeatureRows) {
  const ops = parseOps(r.operations);
  if (!ops.length) continue;
  for (const op of ops) {
    if (op.type === 'defineCastingSource') {
      const [source, token, tradition, attribute] = String(op.data?.value ?? '').split(':::');
      if (!source) continue;
      const cur = theirs.get(source) ?? { source, tokens: new Set(), traditions: new Set(), attributes: new Set(), slots: [], slotRows: new Set(), rows: new Set() };
      if (token) cur.tokens.add(token);
      if (tradition) cur.traditions.add(tradition.toLowerCase());
      if (attribute) cur.attributes.add(attribute);
      cur.rows.add(untsv(r.name));
      theirs.set(source, cur);
    }
  }
}
for (const r of classFeatureRows) {
  const ops = parseOps(r.operations);
  for (const op of ops) {
    if (op.type !== 'giveSpellSlot') continue;
    const src = op.data?.castingSource;
    if (!src || !theirs.has(src)) continue;
    const cur = theirs.get(src);
    cur.slots.push(...(op.data?.slots ?? []));
    cur.slotRows.add(untsv(r.name));
    cur.rows.add(untsv(r.name));
  }
}

/* ---- the comparison ------------------------------------------------------------------------------ */
const TOKEN_TYPE = { 'PREPARED-TRADITION': 'prepared', 'PREPARED-LIST': 'prepared', 'SPONTANEOUS-REPERTOIRE': 'spontaneous', '-': 'focus-only' };
const ATTR = { ATTRIBUTE_STR: 'str', ATTRIBUTE_DEX: 'dex', ATTRIBUTE_CON: 'con', ATTRIBUTE_INT: 'int', ATTRIBUTE_WIS: 'wis', ATTRIBUTE_CHA: 'cha' };

/** The subclass the reference host takes: prefer an option whose WG row of the same name ADDS slots to
 *  this source (a wizard's curriculum school), else the first option WITHOUT a slot-table override, so
 *  a cleric is compared as a cloistered cleric, not as a Battle Creed on the reduced two-rank table. */
let rowByName; // filled below, once the dump is parsed
const subclassAddsSlots = (o, source) => {
  const r = rowByName?.get(norm(o.name ?? o.id));
  return !!r && parseOps(r.operations).some((op) => op.type === 'giveSpellSlot' && op.data?.castingSource === source);
};
const hostSubclass = (cls, source) =>
  (source ? cls?.subclass?.options?.find((o) => !o.slotProgression && subclassAddsSlots(o, source)) : null) ??
  cls?.subclass?.options?.find((o) => !o.slotProgression) ??
  cls?.subclass?.options?.[0] ??
  null;
/** A class's extra choice groups filled with their first options (two apparitions for an animist, one
 *  conscious mind for a psychic …) — an animist with no attuned apparition has no apparition cantrips,
 *  which read as a 2-vs-4 mismatch that was the HOST, not the engine. */
const extraChoicesFor = (cls, level) => {
  const out = {};
  for (const g of cls?.extraChoices ?? []) {
    // The animist's attunement ladder is 2 apparitions, a third at 7th, a fourth at 15th (build.ts:4126).
    const n = g.id === 'apparition' ? (level >= 15 ? 4 : level >= 7 ? 3 : 2) : 1;
    out[g.id] = (g.options ?? []).slice(0, n).map((o) => o.id);
  }
  return out;
};
const hostAt = (classId, level, source = null) => {
  const cls = db.classes[classId];
  const extraChoices = extraChoicesFor(cls, level);
  return {
    ...emptyBuild(), name: 'wg-casting', level,
    ancestryId: db.ancestries.human ? 'human' : Object.keys(db.ancestries)[0],
    heritageId: Object.values(db.heritages).find((h) => h.ancestryId === 'human')?.id ?? null,
    backgroundId: Object.keys(db.backgrounds)[0] ?? null,
    classId, subclassId: hostSubclass(cls, source)?.id ?? null,
    keyAbility: cls?.keyAbility?.[0] ?? 'str',
    deityId: Object.keys(db.deities ?? {})[0] ?? null,
    extraChoices,
    primaryApparition: extraChoices.apparition?.[0] ?? null,
  };
};

/** Every non-focus entry the CLASS owns (an animist has two: its own pool and the apparition pool). */
const ourEntries = (c, classId) => c.spellcasting.filter((e) => (e.type === 'prepared' || e.type === 'spontaneous') && String(e.id).startsWith(`${classId}-`));
const ourSlotsByRank = (entries) => {
  const out = {};
  for (const e of entries) {
    if (e.type === 'prepared') {
      for (const [rank, arr] of Object.entries(e.prepared ?? {})) {
        if (Number(rank) > 0 && arr.length) out[Number(rank)] = (out[Number(rank)] ?? 0) + arr.length;
      }
    } else {
      for (const [rank, pool] of Object.entries(e.slots ?? {})) {
        if (Number(rank) > 0 && pool?.max) out[Number(rank)] = (out[Number(rank)] ?? 0) + pool.max;
      }
    }
  }
  return out;
};
const ourCantrips = (entries) => entries.reduce((n, e) => n + (e.cantripCap ?? e.cantrips?.length ?? 0), 0);

/** Their row for OUR host's subclass, by name (WG's "School of Battle Magic" feat ↔ our option of the
 *  same name), so both sides are compared on the same subclass — a school's extra cantrip and slot
 *  live on that row, not on "Wizard Spellcasting". */
rowByName = new Map(rows.filter((r) => !isLegacy(untsv(r.name))).map((r) => [norm(untsv(r.name)), r]));

const report = [];
const sources = [...theirs.values()].filter((t) => classByNorm.has(norm(t.source)));
const skipped = [...theirs.values()].filter((t) => !classByNorm.has(norm(t.source))).map((t) => t.source);
for (const t of sources.sort((a, b) => a.source.localeCompare(b.source))) {
  const classId = classByNorm.get(norm(t.source));
  if (ONLY && classId !== ONLY) continue;
  const cls = db.classes[classId];
  const ours = cls.spellcasting ?? null;
  const tokens = [...t.tokens];
  const wgTypes = new Set(tokens.map((k) => TOKEN_TYPE[k] ?? k));
  const wgType = wgTypes.has('prepared') ? 'prepared' : wgTypes.has('spontaneous') ? 'spontaneous' : 'focus-only';
  const wgTraditions = [...t.traditions];
  const wgAttributes = [...t.attributes].map((a) => ATTR[a] ?? a);
  const rec = {
    classId, source: t.source, rows: [...t.rows], slotRows: [...t.slotRows],
    wg: { type: wgType, traditions: wgTraditions, attributes: wgAttributes },
    ours: ours ? { type: ours.type, tradition: ours.tradition, attribute: ours.keyAbility, progression: ours.progression ?? 'full' } : null,
    mismatches: [], levels: [],
  };
  if (wgType === 'focus-only') {
    // A focus-only source (champion devotion spells, monk qi spells) has no ClassDef block on our side:
    // the focus entry is built from the granting feature. So the check is on the BUILT character.
    let c = null;
    try { c = buildCharacter(hostAt(classId, 20), db); } catch (e) { rec.mismatches.push({ kind: 'build-error', level: 20, detail: String(e?.message ?? e).slice(0, 120) }); }
    if (c && !c.spellcasting.some((e) => e.type === 'focus')) rec.mismatches.push({ kind: 'focus-entry', level: 20, detail: `WG defines a focus source (${rec.rows.join(', ')}); our level-20 ${classId} has no focus entry` });
    report.push(rec);
    continue;
  }
  if (!ours) {
    rec.mismatches.push({ kind: 'class-casting', detail: `WG defines a ${wgType} ${wgTraditions.join('/')} source; our ClassDef has no spellcasting block` });
  } else {
    if (ours.type !== wgType) rec.mismatches.push({ kind: 'type', detail: `WG ${wgType}, ours ${ours.type}` });
    // Tradition and attribute may be subclass-dependent (a sorcerer's bloodline, a psychic's conscious
    // mind), which WG encodes as one source definition per subclass row — hence sets. Ours must be one
    // of theirs; a class whose keyAbility offers a choice is not failed on attribute.
    if (wgTraditions.length && ours.tradition && !wgTraditions.includes(ours.tradition)) rec.mismatches.push({ kind: 'tradition', detail: `WG ${wgTraditions.join('/')}, ours ${ours.tradition}` });
    if (wgAttributes.length && ours.keyAbility && !wgAttributes.includes(ours.keyAbility) && cls.keyAbility.length === 1) rec.mismatches.push({ kind: 'attribute', detail: `WG ${wgAttributes.join('/')}, ours ${ours.keyAbility}` });
  }
  // Level-by-level: cantrips (rank 0) and slots per rank. Their table = the class's own rows plus the
  // row of the SAME subclass our host takes (found by name); a subclass row that is not in the dump is
  // recorded, so a difference there is visibly "their subclass row missing", not a slot mismatch.
  const sub = hostSubclass(cls, t.source);
  const subRow = sub ? rowByName.get(norm(sub.name ?? sub.id)) : null;
  const subSlots = [];
  if (subRow) {
    for (const op of parseOps(subRow.operations)) {
      if (op.type === 'giveSpellSlot' && op.data?.castingSource === t.source) subSlots.push(...(op.data?.slots ?? []));
    }
  }
  rec.subclass = { ours: sub?.name ?? sub?.id ?? null, wgRow: subRow ? untsv(subRow.name) : null, wgSlotOps: subSlots.length };
  // A SECOND source of theirs that our class folds into its own entries: the animist's apparition pool
  // is our `animist-apparition-casting` entry, so their ANIMIST_APPARITION slots join the comparison.
  // (CLERIC_DIVINE_FONT does NOT — our font is tracked beside the entry, not inside `prepared`.)
  const EXTRA_SOURCES = { ANIMIST: ['ANIMIST_APPARITION'] };
  const extraSlots = (EXTRA_SOURCES[t.source] ?? []).flatMap((s) => theirs.get(s)?.slots ?? []);
  if (EXTRA_SOURCES[t.source]) rec.extraSources = EXTRA_SOURCES[t.source].map((s) => `${s} (${theirs.get(s)?.slots.length ?? 0} slot rows)`);
  const wgByLevel = new Map();
  for (const s of [...t.slots, ...subSlots, ...extraSlots]) {
    const lvl = Number(s.lvl), rank = Number(s.rank), amt = Number(s.amt);
    if (!wgByLevel.has(lvl)) wgByLevel.set(lvl, {});
    wgByLevel.get(lvl)[rank] = (wgByLevel.get(lvl)[rank] ?? 0) + amt;
  }
  for (let lvl = 1; lvl <= 20; lvl++) {
    let c;
    try { c = buildCharacter(hostAt(classId, lvl, t.source), db); } catch (e) { rec.mismatches.push({ kind: 'build-error', level: lvl, detail: String(e?.message ?? e).slice(0, 120) }); continue; }
    const entries = ourEntries(c, classId);
    const wg = wgByLevel.get(lvl) ?? {};
    const our = ourSlotsByRank(entries);
    const row = { level: lvl, wgCantrips: wg[0] ?? 0, ourCantrips: ourCantrips(entries), wgSlots: Object.fromEntries(Object.entries(wg).filter(([r]) => Number(r) > 0)), ourSlots: our, cantripsPrepared: entries.some((e) => e.cantripsPrepared) };
    rec.levels.push(row);
    if (!entries.length && Object.keys(wg).length) { rec.mismatches.push({ kind: 'no-entry', level: lvl, detail: `WG has slots at level ${lvl}; our character has no ${rec.wg.type} entry` }); continue; }
    if (entries.length) {
      if ((wg[0] ?? 0) !== row.ourCantrips) rec.mismatches.push({ kind: 'cantrips', level: lvl, detail: `WG ${wg[0] ?? 0} cantrips, ours ${row.ourCantrips}` });
      const ranks = new Set([...Object.keys(row.wgSlots), ...Object.keys(our)].map(Number));
      for (const r of [...ranks].sort((a, b) => a - b)) {
        const a = row.wgSlots[r] ?? 0, b = our[r] ?? 0;
        if (a !== b) rec.mismatches.push({ kind: 'slots', level: lvl, rank: r, detail: `rank ${r}: WG ${a} slot(s), ours ${b}` });
      }
      // The owner's rule: a PREPARED caster prepares cantrips each morning, like slots.
      const prep = entries.filter((e) => e.type === 'prepared');
      if (rec.wg.type === 'prepared' && prep.length && !prep.some((e) => e.cantripsPrepared)) rec.mismatches.push({ kind: 'cantrip-prep', level: lvl, detail: 'prepared caster whose cantrips are not prepared daily' });
    }
  }
  report.push(rec);
}

/* ---- output -------------------------------------------------------------------------------------- */
const out = { generated: new Date().toISOString(), classes: report.map((r) => ({ ...r, levels: VERBOSE ? r.levels : undefined })), skippedSources: skipped.sort() };
writeFileSync(join(ROOT, 'work/wg-casting-parity.json'), JSON.stringify({ ...out, classes: report }, null, 1));
let bad = 0;
for (const r of report) {
  const m = r.mismatches;
  if (!m.length && !VERBOSE) continue;
  console.log(`\n${r.classId} ← WG ${r.source} (slots from: ${r.slotRows.join(', ') || '—'}${r.subclass?.wgRow ? ` + subclass row "${r.subclass.wgRow}" (${r.subclass.wgSlotOps} slot op(s))` : r.subclass?.ours ? ` · our subclass "${r.subclass.ours}" has NO row of that name in the dump` : ''})  WG: ${r.wg.type}/${r.wg.traditions.join('|')}/${r.wg.attributes.join('|')}  ours: ${r.ours ? `${r.ours.type}/${r.ours.tradition}/${r.ours.attribute}/${r.ours.progression}` : 'NONE'}`);
  const byKind = {};
  for (const x of m) (byKind[x.kind] ??= []).push(x);
  for (const [kind, xs] of Object.entries(byKind)) {
    bad += xs.length;
    const levels = xs.filter((x) => x.level != null).map((x) => x.level);
    const span = levels.length ? ` (levels ${Math.min(...levels)}–${Math.max(...levels)}, ${xs.length} row(s))` : '';
    console.log(`  ✗ ${kind}${span}: ${xs[0].detail}${xs.length > 1 ? ` … +${xs.length - 1}` : ''}`);
  }
  if (VERBOSE) for (const l of r.levels) console.log(`     L${String(l.level).padStart(2)}  cantrips WG ${l.wgCantrips} / ours ${l.ourCantrips}${l.cantripsPrepared ? ' (prepared daily)' : ''}   slots WG ${JSON.stringify(l.wgSlots)} / ours ${JSON.stringify(l.ourSlots)}`);
}
console.log(`\ncasting parity: ${report.length} class source(s) compared, ${report.filter((r) => r.mismatches.length).length} with mismatches (${bad} row(s)); ${skipped.length} non-class source(s) skipped (${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ' …' : ''})`);
console.log('written: work/wg-casting-parity.json');
process.exit(bad ? 1 : 0);
