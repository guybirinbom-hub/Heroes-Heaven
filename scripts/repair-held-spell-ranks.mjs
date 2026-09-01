/*
 * MOVE EACH HELD SPELL TO THE RANK ITS ITEM PRINTS.
 *
 * `heldSpells` is a rank → spell-ids map and the key is the rank the spell is CAST at: build.ts copies
 * it into the item entry's `repertoire`, and the heightening code turns that into dice. The importer
 * keys these off the linked spell's own base rank and never reads the "Nth-rank" qualifier printed
 * beside it, so every GRADED item casts at the base rank — Faith Tattoo (True) casting Harm at 1st
 * where the book says 7th, a Jyoti's Feather (Greater) healing 4d10 where the book says 5d10.
 *
 * 91 spells across the corpus. Found by batch 1's residual read on one record; the shape is measured by
 * `scripts/held-spell-rank-check.mjs`, which holds it at zero afterwards.
 *
 * Only the unambiguous case is moved: the description prints "<N>th-rank <Spell>" and that spell is one
 * the item holds. Cantrips are left at key 0, which is what that key means for them.
 *
 *   node scripts/repair-held-spell-ranks.mjs           # report
 *   node scripts/repair-held-spell-ranks.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8').replace(/^﻿/, ''));
const core = read('public/core.json');
const descs = read('public/core-descriptions.json');

const RANKED = /\b(\d+)(?:st|nd|rd|th)-rank\s+\*{0,2}_?([A-Za-z][A-Za-z' -]{2,40}?)_?\*{0,2}(?=[.,;)]|\s+(?:as|and|from|with|at|on)\b|$)/g;
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const edits = [];
for (const [id, item] of Object.entries(core.items ?? {})) {
  const held = item?.heldSpells;
  if (!held || typeof held !== 'object') continue;
  const text = String(descs.items?.[id]?.d ?? '').replace(/\s+/g, ' ');
  if (!text) continue;

  const storedAt = new Map();
  for (const [rank, ids] of Object.entries(held)) for (const s of ids ?? []) storedAt.set(s, Number(rank));

  /*
   * spellId → EVERY rank its own text prints for it.
   *
   * ⚠ NOT "the last one wins". An item may cast the same spell at several ranks: the Fan of Soothing
   * Winds has six beads and casts Heal at 4th, 3rd and 2nd depending which you turn, and the Anima Robe
   * casts Illusory Disguise at 3rd on one activation and 7th on another. Taking one rank per spell
   * silently discarded the others — and, because the survivor happened to equal what was stored, made
   * the repair report "nothing to move" on records the guard was flagging. The two disagreed, which is
   * the only reason it was caught.
   */
  const printedAt = new Map();
  for (const m of text.matchAll(RANKED)) {
    const spellId = slug(m[2]);
    if (!storedAt.has(spellId)) continue;
    if ((core.spells?.[spellId]?.traits ?? []).includes('cantrip')) continue;
    if (!printedAt.has(spellId)) printedAt.set(spellId, new Set());
    printedAt.get(spellId).add(Number(m[1]));
  }
  if (!printedAt.size) continue;

  /* Rebuild the whole map: an overlay row replaces the field, so every spell the item holds is carried
   * across — those with printed ranks land on exactly those ranks, the rest keep the rank they had. */
  const next = {};
  const push = (r, s) => { (next[r] ??= []).push(s); };
  const placed = new Set();
  for (const [rank, ids] of Object.entries(held)) {
    for (const s of ids ?? []) {
      const ranks = printedAt.get(s);
      if (!ranks) { push(Number(rank), s); continue; }
      if (placed.has(s)) continue; // its copies are represented by the printed rank list
      placed.add(s);
      for (const r of [...ranks].sort((a, b) => a - b)) push(r, s);
    }
  }

  const before = JSON.stringify(Object.fromEntries(Object.entries(held).map(([k, v]) => [k, [...v].sort()])));
  const after = JSON.stringify(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, [...v].sort()])));
  if (before === after) continue;
  const moves = [...printedAt].map(([s, ranks]) => [s, [...ranks].sort((a, b) => a - b).join('/')]);
  edits.push({ category: 'items', id, field: 'heldSpells', value: next, moves });
}

const moved = edits.reduce((n, e) => n + e.moves.length, 0);
console.log(`${edits.length} item(s), ${moved} spell(s) to move.\n`);
for (const e of edits.slice(0, 20)) {
  for (const [s, r] of e.moves) console.log(`  ${e.id.padEnd(38)} ${s.padEnd(22)} → rank ${r}`);
}
if (edits.length > 20) console.log(`  …and ${edits.length - 20} more item(s)`);

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const e of edits) {
  const row = { category: e.category, id: e.id, field: e.field, value: e.value };
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new row(s), ${replaced} replaced (${rows.length} rows total).`);
