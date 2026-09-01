/*
 * QUEUE breath-of-the-dragon FOR THE OWNER — with the question sharpened by what the mirror actually
 * holds, which the first investigation missed.
 *
 * *"The shape of the breath, the damage type, and the saving throw match those of YOUR DRACONIC
 * EXEMPLAR (see above)."* (Player Core 2 pg. 45.)
 *
 * Ours ships THREE independent pickers (shape × damage × save = 72 combinations, of which only 40
 * correspond to a real dragon — a player can build a 30-foot line of poison with a basic Will save).
 * Theirs derives all three from the ONE exemplar answer, which our side already stores on the
 * Dragonblood heritage (`choice.flag: 'draconicExemplar'`, 40 options). That much is not in dispute:
 * our encoding lets an illegal breath exist and theirs cannot.
 *
 * The block is the TABLE, and it is a genuine WG-vs-print question — the one thing the standing rule
 * reserves to the owner: *"if you think that the way wg does things is not according to the text then
 * ask me, don't make that decision by yourself."*
 *
 * WHAT THIS SCRIPT ADDS to the earlier finding, which reported the table as absent from our authority:
 * the AoN mirror DOES carry the printed table, on the Dragonblood HERITAGE page
 * (heritage/heritage-368.json) rather than on the exemplar pages that were searched — Dragon /
 * Tradition / Speeds / Dragon Breath, with the save as a superscript F/R/W. It covers the eight
 * Monster Core dragons; the remaining exemplars sit behind AoN's DraconicBenefactors page, which the
 * mirror did not fetch, though each dragon's own creature entries carry its Breath Weapon.
 *
 *   node scripts/queue-breath-of-the-dragon.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category';
const WRITE = process.argv.includes('--write');

const core = JSON.parse(readFileSync(join(ROOT, 'public/core.json'), 'utf8').replace(/^﻿/, ''));
const rec = core.feats?.['breath-of-the-dragon'];
if (!rec) { console.error('feats/breath-of-the-dragon is missing'); process.exit(2); }

/* Read the printed table out of the mirror rather than describing it, so the owner rules on the words
 * the book actually prints. */
const heritagePage = JSON.parse(readFileSync(join(MIRROR, 'heritage/heritage-368.json'), 'utf8'));
const md = String(heritagePage.markdown ?? '').replace(/\r/g, '');
/* The Dragon Breath cell carries the save as a <sup> tag, so a `[^<]*` column never matches it — the
 * cell is read non-greedily to the closing tag and the superscript spelled out. */
const rows = [...md.matchAll(/<tr><td>([^<]+)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>(.*?)<\/td><\/tr>/g)]
  .map((m) => m.slice(1, 5).map((s) => s.replace(/<sup>\(?([FRW])\)?<\/sup>/g, ' [$1 save]').trim()))
  .filter(([dragon]) => dragon && dragon !== 'Dragon');
if (rows.length < 5) { console.error(`only ${rows.length} printed table row(s) parsed — refusing to file a question quoting a table I could not read`); process.exit(2); }

const printedTable = rows.map(([d, , , breath]) => `${d}: ${breath}`).join('; ');
const ourChoices = (rec.effectChoices ?? []).map((ch) => `${ch.id} (${(ch.options ?? []).length} options)`).join(', ');
const exemplarOptions = (core.heritages?.dragonblood?.choice?.options ?? []).length;

const question = [
  'PRINTED (Player Core 2 pg. 45): "The shape of the breath, the damage type, and the saving throw match those of your draconic exemplar (see above)." One answer decides all three.',
  '',
  `OURS: three independent pickers on the feat — ${ourChoices} — so ${(rec.effectChoices ?? []).reduce((n, ch) => n * Math.max(1, (ch.options ?? []).length), 1)} combinations exist where the book allows 40, and a player can build a breath no dragon has. The exemplar itself is ALREADY asked, on heritages/dragonblood (choice.flag "draconicExemplar", ${exemplarOptions} options), and this feat ignores it.`,
  '',
  'THEIRS: 40 conditionals on DRACONIC_EXEMPLAR_NAME, each stating that exemplar\'s breath. One stored answer, no illegal combination reachable. Their model is plainly the right one and I would build it — the engine can now derive a field from another record\'s answered flag (choiceFlagAnswer, built for Surki Lore).',
  '',
  'THE BLOCK IS THE TABLE OF 40, AND IT IS YOUR CALL:',
  `  · Our own authority carries only EIGHT rows. The AoN mirror's Dragonblood heritage page prints them — ${printedTable} — and says of the rest, "If you choose a dragon from a different source, work with your GM." The other 32 sit behind AoN's DraconicBenefactors page, which the mirror never fetched.`,
  '  · WG has all 40, but work/wg/wg-data.sql is GPL-3.0 and is a differ, never a source.',
  '  · Foundry has all 40 and is licence-clean, and it DISAGREES WITH WG on at least three: crystal (Foundry Reflex, WG "basic Will"), sea (Foundry cone, WG "30-foot line"), wish (Foundry cone, WG "30-foot line"). On crystal the printed creature entries back Foundry — AoN creature-627/628/629 (Young/Adult/Ancient Crystal Dragon) all read piercing damage in a cone, basic Reflex.',
  '  · A fourth route: derive all 40 from each dragon\'s own creature entries in our mirror, which is printed authority and independent of both. That is the most work and would produce our own table — and where it contradicts WG, it is still your ruling, not mine.',
  '',
  'QUESTION: which table do I build from — Foundry, the creature entries, or the eight printed rows plus a "work with your GM" note for the rest? And do you accept the resulting divergences from WG on crystal, sea and wish?',
  '',
  'NOTE ON COST: the three current choice ids ("breath-shape", "breath-damage", "breath-save") hold answers on saved characters. Replacing them orphans those answers, which then fall back to each picker\'s first option. Whatever you rule, the change needs that migration handled rather than a straight swap.',
].join('\n');

const entry = {
  id: 'breath-of-the-dragon',
  batch: 8,
  printed: 'The shape of the breath, the damage type, and the saving throw match those of your draconic exemplar (see above).',
  theirs: '40 conditionals on DRACONIC_EXEMPLAR_NAME, each injecting that exemplar\'s shape, damage type and save. One answer decides all three.',
  ours: `Three independent pickers (${ourChoices}), which together admit breaths no dragon has, and which ignore the exemplar answer the Dragonblood heritage already stores.`,
  question,
};

console.log(`printed rows parsed from the mirror: ${rows.length}`);
console.log(printedTable);
console.log(`\nour pickers: ${ourChoices}`);
if (!WRITE) { console.log('\n(report only — pass --write)'); process.exit(0); }

const PATH = join(ROOT, 'work/owner-questions.json');
const doc = JSON.parse(readFileSync(PATH, 'utf8'));
doc.open ??= [];
const at = doc.open.findIndex((q) => q.id === entry.id);
if (at >= 0) doc.open[at] = entry; else doc.open.push(entry);
writeFileSync(PATH, JSON.stringify(doc, null, 2) + '\n');
console.log(`\nqueued (${doc.open.length} open questions).`);
