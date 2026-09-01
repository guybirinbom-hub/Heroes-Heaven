/*
 * EVERY AEON STONE'S RESONANT POWER — 34 records, none of them modelled.
 *
 * *"…their resonant power when slotted into a special magical item called a wayfinder."* A resonant
 * power is a SECOND effect on top of the stone's own, and not one of the 34 that print one carried
 * anything: a slotted stone's extra spell did not exist, and the player had no way to learn what
 * slotting bought them.
 *
 * The clause is read from the printed text and authored into `resonant`:
 *   · `note` — ALWAYS. Half the resonant powers modify the base power in prose (*"increases the damage
 *     prevented from 5 to 10"*, *"grants a separate activation"*) and have no mechanical carrier;
 *     stating those is the whole fix for them.
 *   · `innateSpells` — only where the clause is unambiguously *"cast X as a <tradition> innate spell"*,
 *     with the frequency the sentence states. Everything else gets the note alone, because a resonant
 *     power modelled from a guess is worse than one a player can read.
 *
 * ⚠ NOTHING IS INVENTED. A clause naming a spell we do not ship, or whose tradition or frequency the
 * sentence does not state, falls back to the note rather than being approximated.
 *
 *   node scripts/backfill-aeon-resonance.mjs           # report
 *   node scripts/backfill-aeon-resonance.mjs --write
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

/* Spell ids by lower-cased name — the join that survives punctuation in a printed spell name. */
const spellByName = new Map(Object.entries(core.spells ?? {}).map(([id, s]) => [String(s?.name ?? '').toLowerCase(), id]));

/*
 * ⚠ A sentence containing "resonant" is not necessarily a resonant POWER. The family prose appears on
 * every stone — *"…one of many devices in which aeon stones can be slotted to gain additional resonant
 * powers…"* — and a loose match handed the family HEADER record (aeon-stone-crescent, which is generic
 * aeon-stone prose and has no power of its own) a resonant entry made of boilerplate.
 *
 * A real clause is about THIS stone: "The resonant power…", "Its resonant power…", "The stone's
 * resonant power…". Anything else is description.
 */
const clauseOf = (text) => {
  for (const s of text.split(/(?<=[.!?])\s+/)) {
    if (!/\b(?:the|its|this)\s+(?:stone's\s+)?resonant power\b/i.test(s)) continue;
    if (/devices in which|slotted into a special magical item/i.test(s)) continue;
    return s.trim();
  }
  return null;
};

/** *"cast 2nd-rank Augury as a divine innate spell once per day"* → a grant, or null if not that shape. */
function spellsFrom(clause) {
  const out = [];
  /* ⚠ The article is OPTIONAL. Half the clauses read *"as A divine innate spell"* and half *"as arcane
   * innate spellS"* with none — requiring it silently dropped every plural form, including the only
   * two-spell clause in the family (Detect Magic AND Read Aura). A parser that quietly matches less
   * than it should is the same failure as one that matches too much. */
  /* …and the spell name may be LOWER case. One clause reads *"cast forbidding ward as a divine innate
   * cantrip"* where every other capitalises the title, and requiring a capital dropped it silently.
   * The name is validated against core.spells by name anyway, so case is not what makes it safe. */
  const re = /cast (?:the )?(?:(\d+)(?:st|nd|rd|th)-rank )?([A-Za-z][A-Za-z' -]{2,40}?)(?: and ([A-Za-z][A-Za-z' -]{2,40}?))? (?:cantrips? )?as (?:(?:an?|your) )?(arcane|divine|occult|primal) innate (?:spell|cantrip)s?(?: (at will|once per day))?/g;

  /*
   * …and the clauses that name a spell with NO TRADITION — *"The resonant power allows you to cast
   * Sending once per day."* Requiring a tradition dropped these silently, and Wanderer's Guide encodes
   * both of them (Sending rank 5 casts 1; False Vitality rank 7 casts 1) with no tradition either. The
   * tradition is genuinely absent from the printed text, so none is invented here.
   */
  const bare = /cast (?:the )?(?:(\d+)(?:st|nd|rd|th)-rank )?([A-Z][A-Za-z' -]{2,40}?)(?: (once per day|at will))?\.?$/;
  let m;
  while ((m = re.exec(clause))) {
    const [, rank, first, second, tradition, freq] = m;
    for (const name of [first, second].filter(Boolean)) {
      const id = spellByName.get(name.trim().toLowerCase());
      if (!id) return null; // a spell we do not ship — fall back to the note rather than guess
      const g = { spellId: id, ...(tradition ? { tradition } : {}) };
      /*
       * ⚠ THE RANK IS ALWAYS CARRIED. Where the clause states one ("cast 1st-rank Mending") it wins;
       * where it does not, the spell's OWN rank is the answer — and that is exactly what Wanderer's
       * Guide stores (See the Unseen 2, Phantasmal Minion 1, Read Aura 0). Omitting it left four
       * stones differing from their encoding for no reason; it is not an invented value, it is the
       * spell's printed rank.
       */
      g.rank = rank ? Number(rank) : (core.spells?.[id]?.rank ?? 0);
      if (/at will/i.test(freq ?? '')) g.atWill = true;
      else if (/once per day/i.test(freq ?? '')) g.usesPerDay = 1;
      out.push(g);
    }
  }
  if (out.length) return out;

  /* The no-tradition form, tried only after the full one finds nothing. */
  const b = bare.exec(clause.trim());
  if (b) {
    const [, rank, name, freq] = b;
    const id = spellByName.get(name.trim().toLowerCase());
    if (id) {
      const g = { spellId: id, rank: rank ? Number(rank) : (core.spells?.[id]?.rank ?? 0) };
      if (/at will/i.test(freq ?? '')) g.atWill = true;
      else if (/once per day/i.test(freq ?? '')) g.usesPerDay = 1;
      return [g];
    }
  }
  return null;
}

const ROWS = [];
const noteOnly = [];
for (const [id, rec] of Object.entries(core.items ?? {})) {
  if (!/^aeon-stone/.test(id) && !/aeon stone/i.test(String(rec?.name ?? ''))) continue;
  const text = String(descs.items?.[id]?.d ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const clause = clauseOf(text);
  if (!clause) continue;
  const spells = spellsFrom(clause);
  const value = { note: clause.length > 220 ? clause.slice(0, 217) + '…' : clause };
  if (spells) value.innateSpells = spells;
  else noteOnly.push(id);
  ROWS.push({ category: 'items', id, field: 'resonant', value });
}

if (!ROWS.length) { console.error('no aeon stone carries a resonant clause — the printed text changed, or the read is broken'); process.exit(2); }

console.log(`${ROWS.length} aeon stone(s) with a resonant power; ${ROWS.length - noteOnly.length} carry a modelled spell grant.\n`);
for (const r of ROWS) {
  const s = r.value.innateSpells;
  console.log(`  ${r.id.padEnd(42)}${s ? s.map((g) => `${g.spellId}(${g.tradition}${g.atWill ? ', at will' : g.usesPerDay ? ', 1/day' : ''})`).join(' + ') : '— note only'}`);
}

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
writeBackfill(ROOT, rows);
console.log(`\nwrote ${added} new, ${replaced} replaced (${rows.length} rows).`);
