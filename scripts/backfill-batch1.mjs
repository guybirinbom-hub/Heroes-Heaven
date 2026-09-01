/*
 * BATCH 1 — the one batch cut before the level ordering, and the last to be brought up to standard.
 *
 * It holds classes, backgrounds and items that no later batch does, which is why most of its reported
 * gaps turned out to be blind spots in the COMPARERS rather than in the data (a class states its saves
 * and skills on itself; a background states its trained skill on itself; an item states its Speed under
 * `passiveEffects`). Those were fixed in the instruments. What is authored here is the remainder: the
 * records whose printed text really did reach nothing.
 *
 *   node scripts/backfill-batch1.mjs --write
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBackfill, writeBackfill } from './lib/write-backfill.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');
const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8'));

const ROWS = [
  /*
   * WARRIOR AUTOMATON — *"The damage die for your fist increases to 1d6 instead of 1d4. You don't take
   * a penalty when making a lethal attack with your fist or any other unarmed attack."*
   *
   * The heritage carried `versatile` and nothing else. Both sentences are unarmed riders, and the
   * second is deliberately UNMATCHED because the text says "or any other unarmed attack" — an
   * unfiltered rider is normally the loudest over-grant in the engine, and here it is what is printed.
   *
   * ⚠ The field alone would have been inert: unarmed riders were read from feats and class features
   * only, so heritages had no route at all (fixed in derive.ts). Mirrors `mummy-dedication`, which
   * prints the same two clauses and models them the same way.
   */
  {
    category: 'heritages',
    id: 'warrior-automaton',
    field: 'unarmedTraits',
    value: [{ match: ['fist'], setDie: 'd6' }, { remove: ['nonlethal'] }],
  },
  /*
   * …and its sibling, whose sentence stops one clause SHORT: *"The damage die for your fist increases
   * to 1d6. You don't take a penalty when making a lethal attack with your fist."* — fist only, where
   * the automaton says "your fist OR ANY OTHER UNARMED ATTACK".
   *
   * derive.ts held both heritages in one hard-coded id list beside Powerful Fist, which gave them the
   * same narrow treatment and quietly dropped the automaton's wider clause. Moving both to data is what
   * lets them differ — and removes a list that could only grow by editing the engine.
   */
  {
    category: 'heritages',
    id: 'warrior-jotunborn',
    field: 'unarmedTraits',
    value: [{ match: ['fist'], setDie: 'd6', remove: ['nonlethal'] }],
  },

  /*
   * PACT OF THE HERALD AND HOST — *"You can cast fear as an innate spell once per day, with the spell's
   * TRADITION MATCHING THAT OF YOUR BOUND DRAGON."* The item carried no spell at all.
   *
   * The tradition is not a property of the item, so it cannot be written on the grant: it is whatever
   * the bound dragon's is. Asked as a choice, which is also how their side encodes it — the four
   * options each grant the same spell on a different tradition, so the Spells page shows it under the
   * right one instead of guessing.
   */
  {
    category: 'items',
    id: 'pact-of-the-herald-and-host',
    field: 'effectChoices',
    value: [
      {
        id: 'dragon-tradition',
        prompt: "Your bound dragon's tradition — Fear is cast on it",
        options: ['arcane', 'divine', 'occult', 'primal'].map((t) => ({
          value: t,
          label: t.charAt(0).toUpperCase() + t.slice(1),
          grant: { innateSpells: [{ spellId: 'fear', tradition: t, usesPerDay: 1 }] },
        })),
      },
    ],
  },
];

/* Every record named must exist, and the item ids inside a grant must resolve — a grant naming a
 * record that is not there grants nothing and says nothing. */
for (const r of ROWS) {
  if (!core[r.category]?.[r.id]) { console.error(`${r.category}/${r.id} is not in core.json`); process.exit(2); }
}

const rows = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of ROWS) {
  const at = rows.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { rows[at] = row; replaced++; } else { rows.push(row); added++; }
}
console.log(`${ROWS.length} row(s): ${added} new, ${replaced} replaced.`);
for (const r of ROWS) console.log(`  ${r.category}/${r.id}.${r.field}`);
if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }
writeBackfill(ROOT, rows);
console.log(`\nwrote ${rows.length} rows.`);
