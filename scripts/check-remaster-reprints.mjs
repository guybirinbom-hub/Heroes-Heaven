/*
 * REMASTER REPRINTS: the same item arriving a second time under its new printing's name.
 *
 * Impossible Magic (2026) reprints Secrets of Magic equipment, and the 2026-08-15 import brought 49
 * of those reprints in as brand-new records beside the Secrets of Magic ones the app already held —
 * so the shop offered "Grim Sandglass (Major)" and "Major Grim Sandglass" as two things to buy.
 *
 * AoN states the link outright: a reprint's mirror document carries `legacy_id`, pointing at the
 * document it reprints. core.json keeps only `aonId`, so `findDuplicateIds` has to INFER "same item"
 * from the name shape plus level plus price — which caught 41 of the 49 and missed 7 (the eighth,
 * Grudge Journal, is a rebuilt item under a new name rather than a duplicate; see UNRESOLVED below).
 * This script re-derives the set from the mirror and FAILS if a reprint pair is listed twice, so the
 * next import cannot add one silently. That is the point of it: the rule is a heuristic, and this is
 * the check that says when the heuristic was not enough.
 *
 * HOW A PAIR IS RESOLVED, and why not by name alone:
 *   · candidates are the app records whose `aonId` is the legacy document or one of its grades.
 *   · the twin is the ONE candidate at the same level and the same price in copper. Exact, and it
 *     survives a renamed grade ladder — Impossible Magic prints Healer's Gel as base/Greater/Major
 *     where Secrets of Magic printed Lesser/Moderate/Greater, at identical levels and prices, so
 *     "Greater Healer's Gel" is the reprint of "Healer's Gel (MODERATE)" and matching on the grade
 *     word pairs the wrong two records.
 *   · failing that, the ONE candidate at the same level whose name is the SAME WORDS in a different
 *     order — "Major Grim Sandglass" / "Grim Sandglass (Major)", which the reprint repriced from
 *     2,000 to 1,750 gp. The word-multiset test is what keeps this second pass honest: a level match
 *     on its own paired Frozen Lava with Necklace of Fireballs I and Wayfinder with Archaic
 *     Wayfinder, which are renames of a whole family, not one item listed twice.
 *   · anything else is UNRESOLVED and printed, never guessed at. Grudge Journal lands there: its
 *     `legacy_id` is Instructions for Lasting Agony (level 5, 200 gp) and the reprint is level 11 at
 *     1,350 gp, so it is a rebuilt item under a new name — the `edition: 'superseded'` lane's
 *     business, not a duplicate spelling, and hiding it would take a real item off the shelf.
 *
 * WHAT MAKES THE RUN FAIL, and why it is not simply "both halves visible". A `legacy_id` link plus a
 * matching level and price is not on its own proof of a double listing: AoN also files a REBUILT item
 * that way, and eleven such pairs predate this check (Wyrm's Wingspan / Wyrm on the Wing, Cloak of
 * Illusions / Cloak of Elvenkind, Judgement / Judgment Thurible…). What separates them is that a
 * rebuilt item is MODELLED — it carries its own usage, spells, counters — while a re-scrape of an
 * item the app already holds arrives HOLLOW: none of the mechanical fields, and the whole family's
 * blurb for a description. So the run fails on a pair that is both visible AND has one hollow half,
 * which on this database picks out exactly the reprints and none of the rebuilds. It also fails if
 * the HOLLOW half is the one left showing, because hiding the modelled record empties the item —
 * `derive.ts` reads `db.items[inv.itemId]`, never its twin's.
 *
 * Mechanics missing from the hidden half are NOT reported here; that is
 * scripts/apply-grade-twin-mechanics.mjs, which copies them across so both ids resolve alike.
 *
 *   npx jiti scripts/check-remaster-reprints.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findDuplicateIds } from '../src/data';

const ROOT = path.resolve(import.meta.dirname, '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/equipment';
if (!existsSync(MIRROR)) {
  console.log(`mirror not present at ${MIRROR} — nothing to check against`);
  process.exit(0);
}
const core = JSON.parse(readFileSync(path.join(ROOT, 'public/core.json'), 'utf8'));
const hidden = findDuplicateIds(core);

/** In copper, so `{gp:125}` and `{pp:0,gp:125,sp:0,cp:0}` compare equal. */
const copper = (p) => (p?.pp ?? 0) * 1000 + (p?.gp ?? 0) * 100 + (p?.sp ?? 0) * 10 + (p?.cp ?? 0);
/** The mirror document behind an app record, or null when the record is not from a scrape. */
const mirrorDoc = (aonId) => {
  if (typeof aonId !== 'string') return null;
  const f = path.join(MIRROR, `${aonId}.json`);
  if (!existsSync(f)) return null;
  const j = JSON.parse(readFileSync(f, 'utf8'));
  return j._source ?? j;
};
/** "Major Grim Sandglass" and "Grim Sandglass (Major)" both fingerprint to "grim|major|sandglass". */
const words = (name) =>
  String(name).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').sort().join('|');

/** The fields that make an item resolve for the character carrying it. */
const MECHANICAL_FIELDS = ['passiveEffects', 'heldSpells', 'usage', 'frequency', 'counters', 'damage', 'uses', 'activationCost'];

/* ── index the app by the AoN document family each record came from ─────────────────────────── */
const byFamily = new Map(); // 'equipment-1007' -> [app ids]
for (const [id, rec] of Object.entries(core.items ?? {})) {
  const a = rec?.aonId;
  if (typeof a !== 'string') continue;
  const family = a.replace(/-\d+$/, '');
  if (!byFamily.has(family)) byFamily.set(family, []);
  byFamily.get(family).push(id);
}

/* ── resolve every reprint against the record it reprints ───────────────────────────────────── */
const pairs = []; // [reprintId, legacyId, how]
const unresolved = [];
for (const [id, rec] of Object.entries(core.items ?? {})) {
  const legacy = mirrorDoc(rec?.aonId)?.legacy_id?.[0];
  if (!legacy) continue;
  const candidates = (byFamily.get(legacy) ?? []).filter((c) => c !== id);
  if (!candidates.length) continue; // the app never held the legacy printing — nothing is duplicated
  const byLevel = candidates.filter((c) => core.items[c].level === rec.level);
  const byBoth = byLevel.filter((c) => copper(core.items[c].price) === copper(rec.price));
  const byWords = byLevel.filter((c) => words(core.items[c].name) === words(rec.name));
  if (byBoth.length === 1) pairs.push([id, byBoth[0], 'level+price']);
  else if (byWords.length === 1) pairs.push([id, byWords[0], 'level+same words, repriced']);
  else unresolved.push(`${id} (L${rec.level}, ${copper(rec.price)} cp) -> ${legacy}: ${candidates.length} candidate(s), ${byLevel.length} at that level`);
}

/**
 * Pairs this check knowingly does not fail on. An entry is a claim about the data, so it carries its
 * evidence — same rule as the ACCEPTED map in scripts/price-check.mjs.
 */
const ACCEPTED = {
  // Pre-existing: both halves were in core.json before the 2026-08-15 import, and the sibling rows
  // (Awakened Cold Iron Shot, Awakened Silver Shot) are the same double listing but do not resolve
  // uniquely here — two of them sit at the same level and the same price. The family needs deciding
  // as a family, in the near-duplicate lane, not one row at a time from this script.
  'awakened-metal-shot-awakened-adamantine-shot': 'pre-existing; adjudicate with its two sibling rows',
};

/* ── the two things that are wrong ──────────────────────────────────────────────────────────── */
/** Hollow = carries none of the fields that make an item do something, while its twin carries some. */
const hollow = (a, b) => MECHANICAL_FIELDS.every((f) => core.items[a][f] == null) && MECHANICAL_FIELDS.some((f) => core.items[b][f] != null);
const bothVisible = [];
const rebuilt = [];
const wrongHalfShown = [];
const accepted = [];
for (const [reprint, legacy, how] of pairs) {
  if (!hidden.has(reprint) && !hidden.has(legacy)) {
    const line = `${reprint} / ${legacy} — "${core.items[reprint].name}" and "${core.items[legacy].name}" both list (${how})`;
    if (ACCEPTED[reprint]) accepted.push(`${line}\n      accepted: ${ACCEPTED[reprint]}`);
    else if (hollow(reprint, legacy) || hollow(legacy, reprint)) bothVisible.push(line);
    else rebuilt.push(line); // both modelled — a rebuilt item under a new name, not a double listing
    continue;
  }
  const [shown, gone] = hidden.has(reprint) ? [legacy, reprint] : [reprint, legacy];
  if (hollow(shown, gone)) {
    const lost = MECHANICAL_FIELDS.filter((f) => core.items[gone][f] != null);
    wrongHalfShown.push(`${gone} is hidden, but it is the half that models ${lost.join(', ')} — ${shown} shows and is hollow`);
  }
}

console.log(`reprint pairs resolved: ${pairs.length} (${pairs.filter((p) => p[2] === 'level+price').length} on level+price, ${pairs.length - pairs.filter((p) => p[2] === 'level+price').length} repriced)`);
for (const [r, l, how] of pairs.filter((p) => p[2] !== 'level+price')) {
  console.log(`   repriced: ${r} ${copper(core.items[r].price)} cp  vs  ${l} ${copper(core.items[l].price)} cp   (${how})`);
}
if (unresolved.length) {
  console.log(`\nUNRESOLVED, informational — AoN calls these a reprint but the twin could not be identified (${unresolved.length}).`);
  console.log(`A rebuilt item under a new name is NOT a duplicate and must stay visible:`);
  for (const s of unresolved.slice(0, 12)) console.log(`   ${s}`);
  if (unresolved.length > 12) console.log(`   … and ${unresolved.length - 12} more`);
}
if (rebuilt.length) {
  console.log(`\nBOTH VISIBLE, BOTH MODELLED — a rebuilt item under a new name, or two rows of one big`);
  console.log(`family that happen to share a level and a price. Neither is a double listing (${rebuilt.length}):`);
  for (const s of rebuilt) console.log(`   ${s}`);
}
if (accepted.length) {
  console.log(`\nACCEPTED (${accepted.length}):`);
  for (const s of accepted) console.log(`   ${s}`);
}
if (wrongHalfShown.length) {
  console.log(`\n⚠ WRONG HALF SHOWING — the mechanics sit on the record that no longer lists (${wrongHalfShown.length}):`);
  for (const s of wrongHalfShown) console.log(`   ${s}`);
}
console.log(`\nSAME ITEM LISTED TWICE: ${bothVisible.length}`);
for (const s of bothVisible) console.log(`   ${s}`);
if (bothVisible.length || wrongHalfShown.length) process.exitCode = 1;
