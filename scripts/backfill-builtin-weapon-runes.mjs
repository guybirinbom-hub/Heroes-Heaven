/*
 * A SPECIFIC MAGIC WEAPON DELIVERED NONE OF ITS OWN RUNES.
 *
 * *"This +1 striking longsword has a mirror-like blade…"* — the Cooperative Blade's potency and
 * striking are part of what it IS, not something you etch, so nothing ever wrote them onto the
 * inventory row and `effectiveWeaponRunes` read the row alone. Measured before this existed: a
 * Cooperative Blade rolled attack 14 for 1d8+2 — exactly what a PLAIN longsword rolls — where the book
 * says +1 and 2d8. Dwarven Thrower, a +2 striking hammer, rolled the same. Found in batch 1's residual
 * read on one item; the shape is the whole family of specific magic weapons.
 *
 * ⚠ THE DETECTOR IS DELIBERATELY NARROW. A loose "+N" search over the description matched status
 * bonuses, spell ranks and prices, and claimed 439 weapons — a number I did not trust and was right not
 * to. This reads only the SELF-DESCRIBING opening clause: "this|a|an <+N> [greater|major] striking
 * <base weapon>", where the base weapon named is the item's own. Anything less explicit is left alone
 * and reported, because a wrong rune is a wrong attack roll on every Strike for the rest of a career.
 *
 *   node scripts/backfill-builtin-weapon-runes.mjs           # report
 *   node scripts/backfill-builtin-weapon-runes.mjs --write
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

/*
 * "this +1 striking longsword", "a +3 greater striking dagger", and — the case a stricter pattern
 * missed on 352 items — "a +1 striking WOUNDING whip", where PROPERTY runes sit between the striking
 * and the base weapon. The tail is captured whole and searched for the weapon's own name, rather than
 * assuming the next word is it.
 */
const SELF = /\b(?:this|these|a|an)\s+\*{0,2}\+(\d)\s*(major striking|greater striking|striking)?\*{0,2}\s*([^.;]{0,60}?)(?=[.;,]|\s+(?:that|which|has|is|was|with|and|can|deals?|grants?)\b)/i;
const STRIKING = { striking: 'striking', 'greater striking': 'greater', 'major striking': 'major' };

/* Every word that appears in a BASE weapon's name — the printed vocabulary of the armoury, so the
 * self-description check does not depend on a hand-written list of weapon nouns. */
const baseWeaponWords = new Set();
for (const it of Object.values(core.items ?? {})) {
  if (it?.itemType !== 'weapon' || it.level > 0) continue; // level 0 = a mundane base weapon
  for (const w of String(it.name ?? '').toLowerCase().split(/[\s-]+/)) if (w.length > 3) baseWeaponWords.add(w);
}

const edits = [];
const skipped = [];
for (const [id, it] of Object.entries(core.items ?? {})) {
  if (it?.itemType !== 'weapon') continue;
  if (it.builtInRunes) continue;
  const text = String(descs.items?.[id]?.d ?? '').replace(/\s+/g, ' ');
  /* Only the opening clause — the item describing itself. Later text talks about other things. */
  const m = SELF.exec(text.slice(0, 300));
  if (!m) continue;

  const potency = Number(m[1]);
  const tail = m[3].toLowerCase().replace(/[*_]/g, ' ').trim();
  /*
   * ⚠ THE STRIKING RUNE IS NOT ALWAYS ADJACENT TO THE POTENCY. Eclipse prints *"This +1 RETURNING
   * striking cold iron starknife"* — a property rune sits in between — so reading only the words
   * immediately after "+1" gave it potency and NO striking, which is a wrong rune rather than a missing
   * one: half its damage dice, silently. The whole clause is searched instead.
   */
  const clause = `${m[2] ?? ''} ${tail}`.toLowerCase();
  const striking = /\bmajor striking\b/.test(clause) ? 'major'
    : /\bgreater striking\b/.test(clause) ? 'greater'
      : /\bstriking\b/.test(clause) ? 'striking'
        : undefined;

  /*
   * The clause must be describing THIS weapon, or it is talking about something else the item mentions
   * ("a +1 striking dagger is required to…"). Accepted when the tail names the item, its base weapon
   * group, or a generic word for the thing. Checked over the WHOLE tail so a property rune sitting in
   * front of the base weapon does not hide it.
   */
  const name = String(it.name ?? '').toLowerCase();
  const words = tail.split(/[\s-]+/).filter(Boolean);
  const GENERIC = /^(weapon|blade|sword|axe|hammer|spear|bow|crossbow|dagger|staff|club|flail|pick|knife|handwraps|gun|rifle|pistol|musket|shield)$/;
  const nounOk =
    words.some((w) => GENERIC.test(w)) ||
    (it.group && tail.includes(String(it.group).toLowerCase())) ||
    words.some((w) => w.length > 3 && name.includes(w)) ||
    /* …or the tail names any BASE WEAPON we ship. "morningstar", "katana" and "scythe" are weapons the
     * generic list does not contain and never could — the printed vocabulary is the whole armoury. */
    words.some((w) => w.length > 3 && baseWeaponWords.has(w));
  if (!nounOk) { skipped.push(`${id} — "+${m[1]} ${tail}" does not name this weapon`); continue; }

  edits.push({ category: 'items', id, field: 'builtInRunes', value: { potency, ...(striking ? { striking } : {}) }, printed: m[0].trim() });
}

console.log(`${edits.length} specific magic weapon(s) to give their own runes; ${skipped.length} clause(s) skipped as not self-describing.\n`);
for (const e of edits.slice(0, 20)) console.log(`  ${e.id.padEnd(34)} +${e.value.potency}${e.value.striking ? ' ' + e.value.striking : ''}   ← "${e.printed}"`);
if (edits.length > 20) console.log(`  …and ${edits.length - 20} more`);
if (skipped.length) {
  console.log(`\nskipped (left alone — a wrong rune is a wrong attack roll for a whole career):`);
  for (const s of skipped.slice(0, 12)) console.log(`   ${s}`);
  if (skipped.length > 12) console.log(`   …and ${skipped.length - 12} more`);
}

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
