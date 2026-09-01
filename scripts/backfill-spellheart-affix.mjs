/*
 * A SPELLHEART NEVER ASKED WHAT IT WAS AFFIXED TO.
 *
 * Every spellheart prints two different sets of benefits — *"- **Armor** You gain resistance 2 to fire.
 * - **Weapon** After you cast a fire spell … your Strikes deal an additional 1d4 fire damage"* — and
 * which one you get depends on where you affixed it. `jolt-coil` modelled that as an `effectChoices`
 * picker. Its 89 siblings did not, so the player was never asked and received neither branch.
 *
 * Found in batch 1's kinds gate on the jyoti's feather, which reported their `choice` against nothing
 * of ours; measuring the family turned one record into 89.
 *
 * WHAT IS GENERATED, and what deliberately is not. Each branch's printed sentence becomes the option's
 * NOTE, so the player is asked the question and told exactly what the answer gives. A STRUCTURED grant
 * is emitted only for the one shape that is unambiguous — *"You gain resistance N to <type>"* — which
 * is the same split `jolt-coil` uses. The weapon branches state riders in prose that no field holds
 * ("the weapon has the Vitalizing rune while the feather is affixed"); inventing a mechanic for those
 * would be guessing, and a wrong grant is worse than a stated one.
 *
 *   node scripts/backfill-spellheart-affix.mjs           # report
 *   node scripts/backfill-spellheart-affix.mjs --write
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

/** Strip the markdown a note should not carry, and trim the branch to its own sentence(s). */
const clean = (s) =>
  s
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const rows = [];
const skipped = [];
for (const [id, item] of Object.entries(core.items ?? {})) {
  if (!(item?.traits ?? []).includes('spellheart')) continue;
  if ((item.effectChoices ?? []).some((e) => e.id === 'affix')) continue; // already asks
  const text = String(descs.items?.[id]?.d ?? '').replace(/\s+/g, ' ');

  /* The two branches, each running to the next bullet or to the activation block. */
  const armor = /-\s*\*\*Armor\*\*\s*([\s\S]*?)(?=\s*-\s*\*\*Weapon\*\*|\s*---|$)/.exec(text)?.[1];
  const weapon = /-\s*\*\*Weapon\*\*\s*([\s\S]*?)(?=\s*-\s*\*\*[A-Z]|\s*---|$)/.exec(text)?.[1];
  if (!armor || !weapon) { skipped.push(`${id} — no Armor/Weapon branch printed`); continue; }

  const mk = (label, body) => {
    const note = clean(body);
    const opt = { value: label.toLowerCase(), label, note };
    /* The one shape that is safe to structure. Anything else stays a stated note. */
    const res = /^You gain resistance (\d+) to ([a-z]+)(?: damage)?\.?$/i.exec(note);
    if (res) opt.grant = { passive: { resistances: [{ type: res[2].toLowerCase(), value: Number(res[1]) }] } };
    return opt;
  };

  rows.push({
    category: 'items',
    id,
    field: 'effectChoices',
    value: [
      {
        id: 'affix',
        prompt: 'What is the spellheart affixed to?',
        options: [mk('Armor', armor), mk('Weapon', weapon)],
      },
    ],
  });
}

const structured = rows.filter((r) => r.value[0].options.some((o) => o.grant)).length;
console.log(`${rows.length} spellheart(s) gain an affix choice; ${structured} carry a structured resistance grant, the rest state their branch.`);
for (const r of rows.slice(0, 6)) {
  for (const o of r.value[0].options) console.log(`  ${r.id.padEnd(30)} ${o.label.padEnd(6)} ${o.grant ? '[grant] ' : '        '}${o.note.slice(0, 90)}`);
}
if (rows.length > 6) console.log(`  …and ${rows.length - 6} more`);
if (skipped.length) {
  console.log(`\n${skipped.length} skipped (no two-branch text to read):`);
  for (const s of skipped.slice(0, 10)) console.log(`   ${s}`);
}

if (!WRITE) { console.log('\n(report only — pass --write to author)'); process.exit(0); }

const all = readBackfill(ROOT);
let added = 0;
let replaced = 0;
for (const row of rows) {
  const at = all.findIndex((r) => r.category === row.category && r.id === row.id && r.field === row.field);
  if (at >= 0) { all[at] = row; replaced++; } else { all.push(row); added++; }
}
writeBackfill(ROOT, all);
console.log(`\nwrote ${added} new row(s), ${replaced} replaced (${all.length} rows total).`);
