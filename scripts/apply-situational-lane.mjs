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
 *   disciplined-mind (WG parity b029, disciplined-mind#duplicate): DELETED from the registry. Print
 *     states it once — *"When you roll a success on a Will save, you get a critical success
 *     instead."* — and the record's own `degreeShifts` already stars the Will row, so the lane's copy
 *     rendered the same rule twice under the same source name. Same call as fluid-contortionist and
 *     combination-finisher; `existingIds` cannot exclude a deleted row, so name it here.
 *   chemical-hardiness / churning-mind / commanding-will / confident-evasion (WG parity b029,
 *     disciplined-mind#duplicate applied to its siblings): DELETED for the same reason. Each prints
 *     the upgrade once — *"When you roll a success on a Fortitude save, you get a critical success
 *     instead."* (class-feature-832; the others say the same of Will, Will and Reflex) — and each
 *     record's own `degreeShifts` successToCrit already stars that save. The generic guard in
 *     test/batch29-situational-siblings.test.ts fails if the lane ever re-emits this shape for ANY
 *     successToCrit record, not just these four.
 *   emotionless / hardened-harrow-deck (WG parity b029, same guard): TRIMMED, not deleted. Each
 *     prints a real bonus the registry must keep (*"a +1 circumstance bonus to saving throws against
 *     emotion and fear effects"*, feat-2461; the deck's *"you instead gain a +1 circumstance bonus"*
 *     fallback, equipment-837) PLUS the successToCrit sentence their own `degreeShifts` already
 *     carries. The lane's wording folds the upgrade back into the clause, so re-emitting it would
 *     restore the doubled star while looking like a harmless refresh. The lethoci edit exactly.
 *   monk-moves (WG parity b031, monk-moves#speed-star): DELETED from the registry. Print gives one
 *     bonus — *"You gain a +10-foot status bonus to your Speed when you're not wearing armor."* — and
 *     the record's own speedsIf [{unarmored:true, speeds:{land:10}}] already adds it to the Speed
 *     NUMBER, which is what types.ts's speedsIf doc names this very record as the reason for. The
 *     lane's row advertised the same +10 under the same condition as though it were still to be
 *     applied. `existingIds` cannot exclude a deleted row, so name it here. (The lane spec's own
 *     engineNote flagged the same record as a data DEFECT; the data half is long fixed.)
 *   swashbucklers-speed (WG parity b031): TRIMMED, not deleted. Print's +5 floor is always on and now
 *     rides the record's landSpeedBonus, so the star was narrowed to the panache remainder. The
 *     lane's wording restates the floor and would re-double it.
 *   incredible-movement (WG parity b031, gap lane): DELETED from the registry — the monk-moves case
 *     exactly, one rung up. Monk Moves is the ARCHETYPE COPY of this clause, and the class feature it
 *     copies had no speed carrier at all, so the star was the only thing that said *"You gain a
 *     +10-foot status bonus to your Speed whenever you're not wearing armor. The bonus increases by 5
 *     feet for every 4 levels you have beyond 3rd."* (class-feature-934) and it moved no number: a
 *     monk walked 10 feet short at 3rd and 25 short at 19th. work/.b031-rows-gap-situational.json puts
 *     the whole clause in speedsIf [{unarmored:true, speeds:{land:"10+5*floor((@actor.level-3)/4)"}}],
 *     which derive.ts evaluates from the character's own armour, so the star would now advertise a
 *     second copy of feet already in the Speed. Nothing is left over to keep — unlike vivacious-speed
 *     and swashbucklers-speed, print gates this on gear the sheet can see and nothing else. Deleted
 *     rows cannot be excluded by `existingIds`, so name it here.
 *   knowledge-is-power (WG parity b032, knowledge-is-power): DELETED from the registry, and this is the
 *     one entry here whose lane wording is not merely stale but describes a DIFFERENT EDITION of the
 *     feat. Our record is aonId feat-5039, edition "remaster", and feat-5039 grants the player
 *     nothing: *"you can invoke your knowledge to make the creature take a –1 circumstance penalty to
 *     either AC and saves against the next attack you make against it, or the next spell you cast that
 *     it needs to defend against."* The lane's three bonuses (and the four rows they became) come from
 *     the LEGACY feat-2861 text — *"you gain a +1 circumstance bonus to your next attack roll…"* —
 *     which core-descriptions still ships on this record. The remaster penalty lands on the ENEMY's
 *     roll, so it is OTHERS_ROLL under ruling F and earns no star at all; nothing is left to keep.
 *     Re-emitting the lane row would restore four bonuses the printed feat does not grant.
 *   weapon-innovation (WG parity b034, weapon-innovation#segmented-frame-duplicate): DELETED from the
 *     registry. Print states the bonus once and on the MODIFICATION — *"When it's collapsed to light
 *     Bulk, it has the concealable trait, which grants you a +2 circumstance bonus to Stealth checks
 *     and DCs to hide or conceal the weapon."* — and the 'segmented-frame' entry, keyed to the actual
 *     pick, already delivers it. The subclass-keyed copy was a stopgap from before innovation
 *     modifications reached ownedFeatureIds (derive.ts:3466), so it fired for EVERY weapon inventor:
 *     a doubled star for one who took Segmented Frame, and a star for a bonus one who took another
 *     modification does not have. The lane row is `needsHumanDecision` today and so already skipped,
 *     but that flag lives in a regenerable spec.json; `existingIds` cannot exclude a deleted row, so
 *     name it here — the fire-gate / monk-moves call exactly.
 */
const handEdited = new Set([
  'strong-oak', 'lethoci', 'sacred-nagaji', 'kanchil', 'respite-of-cloudless-paths',
  'fire-gate', 'metal-gate', 'earth-gate', 'disciplined-mind',
  'chemical-hardiness', 'churning-mind', 'commanding-will', 'confident-evasion',
  'emotionless', 'hardened-harrow-deck',
  'monk-moves', 'swashbucklers-speed', 'incredible-movement',
  'knowledge-is-power',
  'weapon-innovation',
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
