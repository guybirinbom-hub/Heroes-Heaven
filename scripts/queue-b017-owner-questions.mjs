/*
 * QUEUE batch 17's two WG-vs-print contradictions for the owner.
 *
 * Both survived adversarial verification as GENUINE contradictions — the standing rule reserves them:
 * *"if you think that the way wg does things is not according to the text then ask me dont make that
 * desion by yourself."*
 *
 *   node scripts/queue-b017-owner-questions.mjs [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

const ENTRIES = [
  {
    id: 'basic-summoner-spellcasting',
    batch: 17,
    printed:
      'feat-2957 is "Feat 6" and grants "the basic bounded spellcasting benefits"; the linked rule (rules-1485, Bounded Spellcasting Archetype, Secrets of Magic p.74) defines those as: "these feats give you a 1st-level spell slot and a 2nd-level spell slot from that magical tradition … At 10th level, you replace your 1st-level spell slot with a 3rd-level spell slot." TWO slots always, with a replacement at 10th.',
    theirs:
      'Their feat 22481 (listed at THEIR level 4, vs the printed Feat 6): SPELL_ATTACK/SPELL_DC trained, and giveSpellSlot castingSource SUMMONER with {lvl 1-20 rank0 amt2} + {lvl 4-20 rank1 amt1} + {lvl 6-20 rank2 amt1} + {lvl 8-20 rank3 amt1} — THREE leveled slots from 8th onward, all retained, no replacement ever.',
    ours: 'We currently match THEM (three retained slots, no replacement), so under the parity rule we are "at parity" — with an encoding that contradicts the printed bounded-spellcasting rule.',
    question:
      'PRINTED (rules-1485): basic bounded spellcasting = a 1st AND a 2nd-level slot; at 10th the 1st-level slot is REPLACED by a 3rd-level one — two slots at every level. THEIRS: three slots from 8th (1st+2nd+3rd), nothing ever replaced, and the feat availability at level 4 where print says Feat 6. OURS TODAY = THEIRS. Which wins: keep their encoding (status quo, contradicts the printed rule), or adopt print (two slots with the 10th-level replacement — the restricted-slot machinery can express it)? NOTE: every basic bounded-spellcasting feat likely shares the shape — at least basic-magus-spellcasting if it exists in their dump — so the ruling should state whether it covers the whole bounded family or this record alone. (advanced-red-mantis-magic from batch 16 may be the same family; its investigation is checking.)',
  },
  {
    id: 'time-mage-dedication',
    batch: 17,
    printed:
      'feat-8480 (Dark Archive Remastered p.184): "you gain the delay consequence domain spell… You also gain time sense as an innate cantrip usable at will. This innate spell and your focus spells from the time mage archetype are OF THE SAME TRADITION AS THE SPELLS YOU USED TO MEET THE ARCHETYPE\'S PREREQUISITES." (Prerequisite: "You have a spellcasting class feature.") The tradition is DERIVED from your class — not chosen.',
    theirs:
      'wg 22839: a free "Select a Tradition" with all FOUR options (arcane/divine/occult/primal) — the player picks any tradition regardless of class. AND their focus/innate assignment is INVERTED from print: their giveSpell hands Delay Consequence out as an INNATE rank-1 spell and Time Sense as the FOCUS spell (their Arcane option also omits the tradition field entirely — their own bug).',
    ours: 'Print-faithful on the assignment: focusSpells:["delay-consequence"], innateSpells:[time-sense atWill]. The FOCUS tradition already derives correctly from the prerequisite class (build.ts focusTradition falls through to the class\'s own tradition). The one gap: the INNATE cantrip carries no tradition, so it falls back to the spell\'s first listed tradition and a divine or primal time mage casts Time Sense as ARCANE.',
    question:
      'Their encoding contradicts the printed text TWICE: (1) a free 4-way tradition pick where print derives the tradition from your class ("the same tradition as the spells you used to meet the archetype\'s prerequisites"); (2) focus and innate swapped (Delay Consequence innate / Time Sense focus, where print says the opposite). Ours matches print except that the innate cantrip\'s tradition is underived. OPTIONS: (a) adopt theirs in full — the 4-option select and the inversion; (b) keep our print-faithful shape and DERIVE the innate cantrip\'s tradition from the prerequisite class the same way the focus side already does (a small src fix, no new lane needed). The parity rule\'s own exception clause ("if their encoding is not according to the text, ask") is why this is queued rather than built.',
  },
];

const PATH = join(ROOT, 'work/owner-questions.json');
const doc = JSON.parse(readFileSync(PATH, 'utf8'));
doc.open ??= [];
for (const e of ENTRIES) {
  const at = doc.open.findIndex((q) => q.id === e.id);
  if (at >= 0) doc.open[at] = e;
  else doc.open.push(e);
  console.log(`${at >= 0 ? 'replaced' : 'queued'}: ${e.id}`);
}
if (!WRITE) { console.log('(report only — pass --write)'); process.exit(0); }
writeFileSync(PATH, JSON.stringify(doc, null, 2) + '\n');
console.log(`${doc.open.length} open questions.`);
