/*
 * Applies the VERIFIED situational-lane classification into src/rules/situationalBonuses.ts.
 *
 * What it deliberately does NOT apply:
 *   - records the verifier escalated (needsHumanDecision) — those are questions for the user;
 *   - records with a genuine content correction — the verifier disputed the reading, so shipping the
 *     unrevised spec would ship a known-wrong bonus. (Corrections that only said "this target kind
 *     can't be stored" are excluded from that set: extending SituationalTarget.kind resolved them.)
 *   - ids already hand-authored in the registry — those are the verified anchors, they win;
 *   - `spell` bonuses that are about spell DAMAGE or HEALING rather than the spell attack roll or DC.
 *     StatRef's `spell` kind addresses the Spell DC and Spell attack ROWS; a damage rider has no row
 *     to sit on, and filing it under the DC would tell the player something false.
 *
 * Usage: node scripts/apply-situational-lane.mjs [--dry]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DRY = process.argv.includes('--dry');
const LANE = 'work/situational-lane';
const REGISTRY = 'src/rules/situationalBonuses.ts';

const spec = JSON.parse(readFileSync(`${LANE}/spec.json`, 'utf8'));
const contentCorrections = JSON.parse(readFileSync(`${LANE}/corrections-content.json`, 'utf8'));

const correctedIds = new Set(contentCorrections.map((c) => c.id).filter(Boolean));
const escalatedIds = new Set(spec.filter((r) => r.needsHumanDecision).map((r) => r.id));

/*
 * Rows in the generated block that have since been HAND-EDITED against the printed text. `existingIds`
 * below already excludes any id still spelled in the registry, but that check dies the moment such a
 * row is deleted or re-keyed — and then the lane's original wording comes back and silently overwrites
 * a verified correction. Naming them is the durable exclusion.
 *   strong-oak  (WG parity b26): the two save `when` strings were widened to carry the printed second
 *     sentence, *"This bonus also applies to saving throws against effects that would grab you,
 *     restrain you, or knock you prone."* The lane's wording stopped at "…Grapple you…".
 *   lethoci     (WG parity b26): the degree clause was cut out of the `when` string — the record's own
 *     `degreeShifts` field already renders it, so the lane's wording duplicated it on Athletics.
 *   sacred-nagaji (WG parity b27): both save rows narrowed one defence to one maneuver and elided the
 *     printed second sentence. Print (heritage-183) gives *"your Fortitude or Reflex DC against
 *     attempts to Grapple or Trip you"* and adds *"This bonus also applies to saving throws against
 *     effects that would grab you, restrain you, or knock you prone."* — the same edit as strong-oak.
 *   kanchil     (WG parity b27): the `when` ended in an ellipsis where print's second target (*"to
 *     Deception DCs against Sense Motive checks to uncover such lies"*) belonged, and print's third
 *     (*"to initiative rolls when you roll Deception for initiative"*) had no row at all. The lane's
 *     wording would drop both again.
 *   respite-of-cloudless-paths (WG parity b27): the lane wrote only the +1-vs-environmental-hazards
 *     row; print (heritage-409) opens with *"Both environmental heat effects and environmental cold
 *     effects are one step less extreme for you"*, which is two further hand-authored stars on the
 *     same entry.
 *   fire-gate / metal-gate / earth-gate (WG parity b028, kineticist#duplicate-junction-star): DELETED
 *     from the registry. Print states the Gate Junction bonus once (*"you gain a +1 status bonus to the
 *     listed skill; the bonus increases to +2 at 10th level and +3 at 17th level"*) and the hand-authored
 *     "gate-junction" entry already carries it for all five junction skills; these element-keyed copies
 *     pooled as a second identical star on the same skill and fired from level 1, before any junction
 *     could be taken. `existingIds` cannot exclude a row that no longer exists, so name them here.
 */
const handEdited = new Set([
  'strong-oak', 'lethoci', 'sacred-nagaji', 'kanchil', 'respite-of-cloudless-paths',
  'fire-gate', 'metal-gate', 'earth-gate',
]);

const src = readFileSync(REGISTRY, 'utf8');
const existingIds = new Set([...src.matchAll(/^ {2}"([a-z0-9-]+)":\s\[/gm)].map((m) => m[1]));

/** Spell bonuses only earn a row when they modify the attack roll or the DC. */
const spellDetail = (when, bonus) => {
  const t = `${when} ${bonus}`.toLowerCase();
  if (/attack roll/.test(t)) return 'attack';
  if (/\bdc\b|save against/.test(t)) return 'dc';
  return null; // damage / healing rider — no display surface, park it
};

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const skipped = { escalated: 0, corrected: 0, alreadyAuthored: 0, handEdited: 0, spellNoRow: 0 };
const entries = [];
let bonusCount = 0;

for (const r of spec) {
  if (!r.situational || !(r.bonuses ?? []).length) continue;
  if (escalatedIds.has(r.id)) { skipped.escalated++; continue; }
  if (correctedIds.has(r.id)) { skipped.corrected++; continue; }
  if (handEdited.has(r.id)) { skipped.handEdited++; continue; }
  if (existingIds.has(r.id)) { skipped.alreadyAuthored++; continue; }

  const out = [];
  for (const b of r.bonuses) {
    let kind = b.targetKind;
    let detail;
    if (kind === 'skill') detail = b.skill || 'all';
    else if (kind === 'save') detail = b.save || 'all';
    else if (kind === 'spell') {
      detail = spellDetail(b.when, b.bonus);
      if (!detail) { skipped.spellNoRow++; continue; }
    }
    const target = detail ? `{ kind: '${kind}', detail: '${esc(detail)}' }` : `{ kind: '${kind}' }`;
    out.push(`{ targets: [${target}], when: "${esc(b.when)}", bonus: "${esc(b.bonus)}" }`);
    bonusCount++;
  }
  if (!out.length) continue;
  entries.push(`  "${r.id}": [${out.join(', ')}],`);
}

// Splice: keep the header, the hand-authored block and the trailing helpers exactly as they are, and
// append the generated entries just before the closing brace of the object literal.
const openTok = 'export const FEAT_SITUATIONAL: Record<string, SituationalBonus[]> = {';
const open = src.indexOf(openTok);
if (open < 0) throw new Error('registry: could not find FEAT_SITUATIONAL opening');
const close = src.indexOf('\n};', open);
if (close < 0) throw new Error('registry: could not find the object literal close');

const banner =
  `\n\n  // ---- generated by scripts/apply-situational-lane.mjs — do not hand-edit below this line ----\n` +
  `  // ${entries.length} records / ${bonusCount} bonuses from the adversarially verified pass.\n` +
  `  // Escalated, content-corrected and hand-authored ids are excluded by the script on purpose.\n`;

const next = src.slice(0, close) + banner + entries.join('\n') + src.slice(close);

console.log(`applying   : ${entries.length} records, ${bonusCount} bonuses`);
console.log(`skipped    : escalated ${skipped.escalated} · content-corrected ${skipped.corrected} · already authored ${skipped.alreadyAuthored} · hand-edited ${skipped.handEdited} · spell-with-no-row ${skipped.spellNoRow}`);
console.log(`registry   : ${existingIds.size} -> ${existingIds.size + entries.length} entries`);
if (DRY) { console.log('\n--dry: nothing written'); process.exit(0); }
writeFileSync(REGISTRY, next);
console.log('written    :', REGISTRY);
