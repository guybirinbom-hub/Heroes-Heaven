/*
 * Completeness gate for the creature parser.
 *
 * THE BUG CLASS THIS EXISTS FOR is silent under-parsing: the scraper reported success while
 * dropping 1,903 abilities and 1,003 action costs, and nothing caught it because the output was
 * well-formed — just incomplete. Comparing the parser against its own prior output cannot find
 * that, since the prior output IS the bug. So this compares against the MARKDOWN: every ability
 * header AoN wrote must come out the other side.
 *
 *   node scripts/check-creature-parse.mjs           # measure against the shipped bestiary
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAonMarkdown } from './lib/creature-markdown.mjs';

const DIR = 'public/data/bestiary';

/* An ability header in AoN markdown, in all four shapes the corpus actually uses:
 *   **Name** <actions …/>        **Name** text
 *   **[Name](url)** <actions …/> **[Name](url)** text
 * `Recall Knowledge - X` is AoN's flavour sidebar, not an ability, and is excluded on both sides. */
const HEADER = /^\*\*(?:\[([^\]]{2,70})\]\([^)]*\)|([^*\n[]{2,70}))\*\*/;
const NOT_AN_ABILITY = new Set([
  'Perception', 'Skills', 'Str', 'Dex', 'Con', 'Int', 'Wis', 'Cha', 'Items', 'AC', 'Fort', 'Ref',
  'Will', 'HP', 'Immunities', 'Resistances', 'Weaknesses', 'Speed', 'Melee', 'Ranged', 'Damage',
  'Trigger', 'Effect', 'Requirements', 'Frequency', 'Critical Success', 'Success', 'Failure',
  'Critical Failure', 'Saving Throw', 'Languages', 'Source', 'Special', 'Area', 'Range', 'Duration',
  // Sub-headings of the Recall Knowledge sidebar (4,716 creatures each), not abilities. Counting
  // them as expected headers understated BOTH parsers by ~9,400 and made the comparison meaningless.
  'Unspecific Lore', 'Specific Lore',
  // Labelled clauses that belong to the ability above them; the parser folds these into its body
  // rather than emitting them, so they must not be counted as separate expected headers.
  'Requirements', 'Frequency', 'Prerequisites', 'Onset', 'Maximum Duration',
  'Stage 1', 'Stage 2', 'Stage 3', 'Stage 4', 'Stage 5', 'Stage 6', 'Stage 7',
]);

const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');

function headersIn(markdown) {
  const out = new Set();
  for (const line of markdown.replace(/<br\s*\/?>/gi, '\n').split('\n')) {
    const m = line.trim().match(HEADER);
    if (!m) continue;
    /* An ability header AoN wrote with an UNCLOSED bold — `**Guardian Spirit <actions
     * string="Reaction" /> **Trigger** …` — leaves the action tag inside HEADER's captured name,
     * so the expected name was `guardian spirit <actions string="reaction" />`. The parser now
     * cuts the name there (see creature-markdown.mjs), so cut it here too: without this the 20
     * names it just cleaned up read as missing and the FIXED-parser line falls to 99.8%. */
    const name = (m[1] ?? m[2] ?? '').split(/<actions\b/i)[0].trim();
    if (!name || NOT_AN_ABILITY.has(name) || /^Recall Knowledge/i.test(name)) continue;
    /* Spellcasting blocks are parsed separately, so their headers are not ability headers.
     * `Spells?$` alone was too strict: AoN writes a focus caster's header as
     * `**Cleric Domain Spells 1 Focus Point,**`, which does not END in "Spells". Those 42 headers
     * were therefore counted as expected abilities, and — until the parser learned to recognise
     * them — the parser really was emitting them as abilities, so the two errors cancelled and the
     * gate read 99.9%. Fixing the parser exposed the checker's bug as a fake 0.3% regression. */
    // Same widening as the parser: AoN also parenthesises the pool inside the bold,
    // `**Cleric Domain Spells (2 Focus Points),**` (Raja-Krodha). That header is now parsed as a
    // spellcasting block rather than an ability, so counting it as an expected ability header
    // would report a phantom miss. Exactly 1 header of the 19,729 is affected.
    if (/Spells?\b(?:\s+(?:Prepared|Known))?(?:[,\s(]*\d+\s+Focus\s+Points?\)?)?[,\s]*$/i.test(name)) continue;
    // Same story for the ritual block: `**Rituals** DC 32` is a caster block, not an ability —
    // and AoN prefixes it with the tradition, `**Divine Rituals**`, `**Occult Rituals**`.
    if (/^(?:[A-Za-z]+\s+)?Rituals?$/i.test(name)) continue;
    /* Stat-block FURNITURE that wears the ability shape: AoN's deity sidebar (Treerazer, Lorthact,
     * Caeto Vulaunex, and the Divine Font row on the cleric NPCs) and the PC-style build rows the
     * iconic NPCs are printed with (Amiri, Ekundayo, Jubilost, …). The parser's SKIP set now drops
     * these — 115 headers, 118 phantom abilities on 35 creatures, e.g. Treerazer listing "Favored
     * Weapon greataxe" among the things he can do — so counting them here as expected headers would
     * score the parser for NOT emitting them and read as a fake 0.6% regression. Same list as SKIP
     * in lib/creature-markdown.mjs; norm() absorbs AoN's double-spaced "**Skill  Feats**". */
    if (/^(?:areas of concern|edicts|anathema|domains|divine (?:font|skill|attribute)|favored weapon|follower alignments|space|(?:ancestry|class|general|skill) feats?|class abilities|formula book|research field|patron|bloodline)$/.test(norm(name))) continue;
    if (/^\d/.test(name)) continue;               // "**1st**" rank headings inside spell lists
    out.add(norm(name));
  }
  return out;
}

let creatures = 0;
let mdAbilities = 0, oldGot = 0, newGot = 0;
let oldCost = 0, newCost = 0, mdCost = 0;
const stillMissing = new Map();

for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  for (const c of JSON.parse(readFileSync(join(DIR, file), 'utf8')).creature) {
    const md = c?._aon?.markdown;
    if (!md) continue;
    creatures++;

    const want = headersIn(md);
    mdAbilities += want.size;

    const flat = (ab) => [...(ab?.top ?? []), ...(ab?.mid ?? []), ...(ab?.bot ?? [])];
    const oldAb = flat(c.abilities);
    const newAb = flat(parseAonMarkdown(md).abilities);

    const oldNames = new Set(oldAb.map((a) => norm(a.name ?? '')));
    const newNames = new Set(newAb.map((a) => norm(a.name ?? '')));
    for (const w of want) {
      if (oldNames.has(w)) oldGot++;
      if (newNames.has(w)) newGot++;
      else stillMissing.set(w, (stillMissing.get(w) ?? 0) + 1);
    }

    // Action costs: how many abilities carry one, old vs new.
    oldCost += oldAb.filter((a) => a.activity).length;
    newCost += newAb.filter((a) => a.activity).length;
    mdCost += (md.match(/<actions\b[^>]*string="[^"]+"/g) ?? []).length;
  }
}

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : '0.0');
console.log(`creatures with markdown        ${creatures}`);
console.log(`ability headers in the markdown ${mdAbilities}`);
console.log(`  captured by the SHIPPED data  ${oldGot}  (${pct(oldGot, mdAbilities)}%)`);
console.log(`  captured by the FIXED parser  ${newGot}  (${pct(newGot, mdAbilities)}%)`);
console.log(`  recovered                     +${newGot - oldGot}`);
console.log();
console.log(`abilities carrying an action cost`);
console.log(`  shipped                       ${oldCost}`);
console.log(`  fixed parser                  ${newCost}   (+${newCost - oldCost})`);
console.log(`  <actions> tags in markdown    ${mdCost}`);

if (stillMissing.size) {
  const top = [...stillMissing].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log(`\nstill missing (${stillMissing.size} distinct, ${[...stillMissing.values()].reduce((a, b) => a + b, 0)} total):`);
  for (const [name, n] of top) console.log(`   ${String(n).padStart(5)}  ${name}`);
}
