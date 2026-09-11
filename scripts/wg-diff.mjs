/**
 * WANDERER'S GUIDE, USED AS A DIFFER.
 *
 * Wanderer's Guide (GPL-3.0) encodes the same game we do, with a different vocabulary: 16 generic
 * operation verbs carrying a variable NAME in a string, against our ~190 named typed fields. Where
 * the two disagree about a feat, one of us is wrong, and that disagreement is a work list nobody had
 * to read 6,000 feats to produce.
 *
 * ⚠ THIS READS THEIR DATA. IT NEVER COPIES IT. Their encodings are their copyrighted work under
 * GPL-3.0 and this app ships proprietary; `work/wg/` is gitignored for that reason. The output here
 * is a list of RECORDS TO LOOK AT — the fix for each is then authored from the printed rules text,
 * which is Paizo's under the ORC licence and already our source.
 *
 * FOUR BUCKETS, and only the first two are work:
 *
 *   THEY-ONLY   they encode a mechanic on this feat and we encode nothing of that kind.
 *               The high-value bucket: a rule we silently do not apply.
 *   DISAGREE    we both encode the same kind of mechanic and the VALUES differ.
 *               Cheap to adjudicate — one line of printed text settles it.
 *   WE-ONLY     we encode something they do not. Expected to be large and mostly NOT a defect:
 *               759 of their 3,936 encoded feats (19.3%) fall back to prose, and their vocabulary
 *               has no degree-of-success operation at all, so 140 of our feats have no counterpart
 *               they could express. Reported, never actioned blindly.
 *   AGREE       both encode the same kind, values compatible. The denominator.
 *
 * ⚠ KIND, NOT VALUE, DECIDES THE BUCKET. A first draft compared raw JSON and called every feat a
 * disagreement, because `{"trainedSkill":"stealth"}` and `adjValue(SKILL_STEALTH,"T")` share no
 * bytes. The comparison has to happen in a shared vocabulary or it measures the vocabularies, not
 * the content. That vocabulary is KIND_OF below.
 *
 *   node scripts/wg-diff.mjs                 # the counts
 *   node scripts/wg-diff.mjs --bucket they-only --list
 *   node scripts/wg-diff.mjs --out work/wg-diff.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCopyBlock, wgAllRecords, wgRowsByBucket, wgOwnsComparison, WG_PAIRING } from './lib/wg-parse.mjs';

/* `--raw` bypasses the settle registries so `wg-settle-stale.mjs` can see which of them still
 * answer a real difference. A settle that matches nothing is a trap: it will silence the NEXT
 * difference of that kind on that record, unread. */
const RAW_SETTLES = process.argv.includes('--raw');


const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const DUMP = join(ROOT, 'work/wg/wg-data.sql');
if (!existsSync(DUMP)) {
  console.error(`No Wanderer's Guide dump at work/wg/wg-data.sql.\nIt is gitignored on purpose — see the header of this file.`);
  process.exit(2);
}

/* ---------------------------------------------------------------- their side */
/* The dump escapes TWICE: pg_dump writes a TSV (backslash -> \\), and inside that sits a Postgres
 * json[] literal {"<json>","<json>"} whose elements are double-quoted with \" inside. Undo the TSV
 * escape first; the array is then literally a JSON array once { } become [ ]. Two earlier parsers
 * that undid only one layer silently returned zero operations for every row. */
const sql = readFileSync(DUMP, 'utf8');
const head = /^COPY public\.ability_block \(([^)]*)\) FROM stdin;$/m.exec(sql);
const cols = head[1].split(',').map((s) => s.trim().replace(/"/g, ''));
const ix = Object.fromEntries(cols.map((c, i) => [c, i]));
const bodyStart = head.index + head[0].length + 1;
const rows = sql.slice(bodyStart, sql.indexOf('\n\\.\n', bodyStart)).split('\n').filter(Boolean).map((l) => l.split('\t'));

const untsv = (s) => s.replace(/\\\\/g, '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(//g, '\\');
function parseOps(raw) {
  if (!raw || raw === '\\N' || raw.length < 5) return [];
  const s = untsv(raw).trim();
  if (!s.startsWith('{')) return [];
  let arr;
  try { arr = JSON.parse('[' + s.slice(1, -1) + ']'); } catch { return []; }
  return arr.map((e) => { try { return typeof e === 'string' ? JSON.parse(e) : e; } catch { return null; } }).filter(Boolean);
}
/** Their operations nest — conditional carries true/false branches, select carries per-option ops. */
const flatten = (op, out = [], inOption = false) => {
  /* `__inOption` marks an op that lives inside a select's OWN option. It is not part of their data —
   * it is added here so `kindOfTheirOp` can tell "this is what the option does" from "this record is
   * writing down WHICH option you picked". See the SELECT-ANSWER BOOKKEEPING note in the mapper. */
  out.push(inOption ? Object.assign(Object.create(Object.getPrototypeOf(op)), op, { __inOption: true }) : op);
  const d = op.data ?? {};
  for (const k of ['operations', 'trueOperations', 'falseOperations']) for (const c of d[k] ?? []) flatten(c, out, inOption);
  for (const o of d.optionsPredefined ?? []) for (const c of o.operations ?? []) flatten(c, out, true);
  return out;
};

/*
 * THEIR UNARMED ATTACKS ARE ITEMS. Ours are `grantedStrikes` on the record.
 *
 * Seedpod is the plain case: their feat row carries one `giveItem`, and item 9279 "Seedpod" is a
 * WEAPON-group item with the Unarmed trait. Ours is a `grantedStrikes` entry with the same die,
 * damage type, group and range. Same mechanic; only the vocabulary differs — so mapping every
 * `giveItem` to `grantsItem` reported six batch-3 records as gaps when all six were already built.
 *
 * Not a special case for six records: MEASURED across the whole dump, 236 of the 339 `giveItem`
 * operations point at an item carrying the Unarmed trait (id 2398). Seven in ten.
 *
 * The other 103 are real items — Spellbook (Blank), Solar Weapon, Tengu Feather Fan — and still map
 * to `grantsItem`, which is what `grantsItems` on our side holds.
 */
/*
 * AND THEIR SENSES AND MODES ARE RECORDS TOO.
 *
 * `ability_block` holds six types, and `giveAbilityBlock` mapped all of them to `grantsRecord`. But
 * a sense is our `senses` field and a mode is our `modes` registry — neither is a granted record.
 * MEASURED over the dump: of 1,552 giveAbilityBlock operations, 226 target a `sense` (Darkvision,
 * Low-Light Vision) and 38 a `mode` (Rage, Panache, Arcane Cascade — our modes, by name).
 *
 * `physical-feature` (35) stays `grantsRecord`: Fangs, Prehensile Tail, Light Blindness and Change
 * Shape are ancestry features, and ours are records too.
 */
const BLOCK_TYPE_KIND = { sense: 'sense', mode: 'conditional' };
/* Physical-feature blocks compared by CONTENTS — see the giveAbilityBlock case. Lazily filled and
 * cycle-guarded (a block's ops could in principle grant a block). */
const physicalFeatureKindsById = new Map();
let abilityBlockRowsById = null;
const physicalFeatureKinds = (bid) => {
  if (physicalFeatureKindsById.has(bid)) return physicalFeatureKindsById.get(bid);
  physicalFeatureKindsById.set(bid, []); // cycle guard while computing
  abilityBlockRowsById ??= new Map(parseCopyBlock(sql, 'ability_block').rows.map((b) => [String(b.id), b]));
  const row = abilityBlockRowsById.get(bid);
  const ops = row?.operations ? parseOps(row.operations).flatMap((o) => flatten(o)) : [];
  const kinds = [...new Set(ops.flatMap((o) => { const k = kindOfTheirOp(o); return Array.isArray(k) ? k : k ? [k] : []; }))];
  physicalFeatureKindsById.set(bid, kinds);
  return kinds;
};
const blockTypeById = new Map();
{
  const bhead = /^COPY public\.ability_block \(([^)]*)\) FROM stdin;$/m.exec(sql);
  const bcols = bhead[1].split(',').map((s) => s.trim().replace(/"/g, ''));
  const bId = bcols.indexOf('id');
  const bType = bcols.indexOf('type');
  const bStart = bhead.index + bhead[0].length + 1;
  for (const line of sql.slice(bStart, sql.indexOf('\n\\.\n', bStart)).split('\n')) {
    if (!/^\d+\t/.test(line)) continue;
    const f = line.split('\t');
    if (f.length > Math.max(bId, bType)) blockTypeById.set(String(f[bId]), f[bType]);
  }
}

const UNARMED_TRAIT_ID = '2398';
const unarmedItemIds = new Set();
{
  const ihead = /^COPY public\.item \(([^)]*)\) FROM stdin;$/m.exec(sql);
  if (ihead) {
    const icols = ihead[1].split(',').map((s) => s.trim().replace(/"/g, ''));
    const iId = icols.indexOf('id');
    const iTraits = icols.indexOf('traits');
    const iStart = ihead.index + ihead[0].length + 1;
    for (const line of sql.slice(iStart, sql.indexOf('\n\\.\n', iStart)).split('\n')) {
      if (!line) continue;
      const f = line.split('\t');
      if (f.length <= Math.max(iId, iTraits)) continue;
      const traits = String(f[iTraits] ?? '').replace(/[{}]/g, '').split(',');
      if (traits.includes(UNARMED_TRAIT_ID)) unarmedItemIds.add(String(f[iId]));
    }
  }
}

/* ---------------------------------------------------------------- the shared vocabulary */
/**
 * KIND is the currency both sides are converted into. Deliberately COARSE: the question this script
 * answers is "does the other side model this KIND of thing at all", and a finer vocabulary would
 * report every difference of style as a difference of substance.
 */
const kindOfTheirOp = (op) => {
  const v = String(op.data?.variable ?? '');
  switch (op.type) {
    case 'adjValue':
    case 'setValue':
    case 'addBonusToValue': {
      /*
       * AN `addBonusToValue` WITH NO `value` IS A NOTE PINNED TO A STAT ROW, NOT A GRANT ON THAT TRACK.
       *
       * Fishseeker Shoony prints *"If you roll a success on an attempt to Grab an Edge, you get a
       * critical success instead; if you roll a critical failure, you get a failure instead"* — and
       * trains no skill at all. Their row writes that sentence twice, as `addBonusToValue
       * SKILL_ACROBATICS` and `addBonusToValue SAVE_REFLEX`, each `data` carrying only `variable` and
       * `text`: no `value` key on either, so nothing is trained and no number is added. The variable
       * names the DISPLAY SURFACE the sentence hangs on, and reading it as a skill carrier reported
       * `missing=[skill]` against a record whose two printed clauses are both authored as `degreeShifts`
       * on saves:['reflex'] + actions:['grab-an-edge'].
       *
       * A text-only situational rule attached to a stat is our `situational` / `degreeShifts` /
       * `whileActive` lane. wg-values.mjs already refuses to compare these ("a prose-only bonus asserts
       * no value" — the `val === null || val === undefined || val === ''` skip in theirAssertions), so
       * both comparers read the shape the same way.
       *
       * ⚠ THE KIND IS NOT REWRITTEN HERE, AND `return 'conditional'` WAS TRIED AND REVERTED. Measured
       * over the whole dump it LAUNDERED FOUR REAL GAPS: `missing` drops `conditional` whenever
       * `gatesOnlyWhatWeHave`, and that predicate is VACUOUSLY TRUE on a record with no `conditional`
       * op at all (`[].every()` is true), so Murksight, Greenwatcher, Insistent Command and Assured
       * Runic Crafter — each a bare feat carrying no mechanical field on our side — moved from
       * THEY-ONLY straight into AGREE with `ourKinds: []`. It opened FALSE gaps the other way too:
       * Half-Truths answers its prose op with `skillSubstitutions` and Officer's Medical Training with
       * `skillAbilitySwap`, both in the SKILL lane, which a `conditional` kind cannot see. The op names
       * a real display surface, and the surface IS the kind.
       *
       * What the shape means is a SATISFACTION rule, not a kind: a stat kind asserted ONLY by
       * value-less notes is answered by our `conditional` lane as well as by that stat's own fields.
       * Applied once, at the comparison site, from `proseOnlyKinds` — so "ours models nothing" still
       * reports.
       */
      if (/^SKILL_|^LORE_/.test(v)) return 'skill';
      /*
       * UNTRAINED_IMPROVISATION is a SKILL fact, not an unmapped marker. *"Your proficiency bonus to
       * untrained skill checks is equal to your level"* (Eclectic Skill) is a floor under the
       * proficiency contribution of an UNTRAINED skill — a skill rule with no rank to raise, which is
       * why it needs its own variable on their side and its own field (`untrainedProficiency`, listed
       * under OUR_KINDS.skill below) on ours. Left in the `unmapped` fallback it reported both records
       * that carry it as modelling nothing at all.
       *
       * Blast radius adversarially confirmed: exactly TWO rows in the whole dump write this variable
       * (Eclectic Skill, Untrained Improvisation) and both are answered by `untrainedProficiency`;
       * `pathfinder-agent-dedication` carries the field on our side only and stays WE-ONLY.
       */
      if (/^UNTRAINED_IMPROVISATION/.test(v)) return 'skill';
      if (/^SAVE_/.test(v)) return 'save';
      if (/^PERCEPTION/.test(v)) return 'perception';
      /*
       * ARMOR SPECIALIZATION IS A RESISTANCE, NOT AC. *"You gain the armor specialization effect of
       * light armor"* (Unshaken in Iron) grants the armour's specialization effect, and every one of
       * those effects is a typed resistance — our `armorSpec` is applied inside the computed-resistances
       * block in derive.ts (armorSpecEffect / armorSpecValue -> res.set(type, …)), never on AC. The
       * unanchored `/ARMOR/` test below swallowed ARMOR_SPECIALIZATION_LIGHT/MEDIUM/HEAVY into `ac`, so
       * the grant was compared against an AC field that neither side has, and the two trained-gated
       * conditionals around it then reported as an unanswered `conditional` too.
       *
       * Blast radius adversarially confirmed over the whole dump: 13 rows write this variable, 4 of
       * which we answer with `armorSpec`. Guardian Armor, Comfortable In Your Own Chitin and Medium
       * Armor Expertise carry no `armorSpec` on our side and are STILL flagged after the teach — the
       * teach compares the carrier, it does not assume one.
       */
      if (/^ARMOR_SPECIALIZATION/.test(v)) return 'defense';
      if (/^AC|ARMOR/.test(v)) return 'ac';
      if (/^SPEED/.test(v)) return 'speed';
      if (/^RESIST|^IMMUNITIES|^WEAKNESS/.test(v)) return 'defense';
      if (/^MAX_HEALTH|^HEALTH/.test(v)) return 'hp';
      if (/^SPELL_ATTACK|^SPELL_DC|^CASTING/.test(v)) return 'spellcasting';
      if (/^ATTRIBUTE_|^ATTR_/.test(v)) return 'attribute';
      /*
       * ⚠ ATTACK is deliberately NOT anchored. `^ATTACK` missed MELEE_ATTACK_DAMAGE_BONUS and
       * RANGED_ATTACK_ROLLS_BONUS, which fell through to the old default and mapped to no field —
       * reported as understood, silently unreachable.
       */
      if (/WEAPON|ATTACK|^UNARMED/.test(v)) return 'weapon';
      /*
       * RAGE_DAMAGE IS THE SAME LANE AS MELEE_ATTACK_DAMAGE_BONUS — it just does not say ATTACK.
       *
       * AoN instinct-15 (Decay) prints *"increase the additional damage from Rage from 2 to 6"* and
       * instinct-16 (Ligneous) *"you can increase the additional damage from Rage from 2 to 6"*, and
       * their side writes both as `setValue RAGE_DAMAGE 6`. The
       * unanchored ATTACK test above exists precisely so a DAMAGE bonus on Strikes lands in the weapon
       * lane, and this variable is the one member of that family whose name contains neither WEAPON nor
       * ATTACK — so it fell to the named `unmapped` fallback and Decay Instinct and Ligneous Instinct
       * each reported `missing=[unmapped]` against a carrier this file could not see.
       *
       * ⚠ CLOSER, batch 033: that carrier is NOT the modes. This paragraph used to end "(credited by
       * MODE_MODIFIER_KINDS below)", naming `src/rules/modes.ts` cat-rotting-rage / cat-wooden-rage and
       * their `target: 'damage'` modifier — and the resume-modes group then DELETED that modifier
       * (modes.ts:258 `cat-rotting-rage`.modifiers is now `[]`) as a frozen second copy of the ladder.
       * The real and only carrier is `RAGE_DAMAGE` in src/rules/derive.ts:3651, resolved by
       * rageStrikeRider — which is exactly what this file scrapes at the block below (~:1097-1102), and
       * what the last paragraph here already says. The two halves of the comment disagreed; the
       * derive.ts half is the true one.
       *
       * ⚠ THE KIND, NEVER THE NUMBER. Whether our 6 keeps up with their 6/10/18 weapon-specialization
       * ladder is a VALUES question, and it is live as findings decay-instinct#rotting-rage-damage-scaling
       * and ligneous-instinct#wooden-rage-mode — neither of which this mapping can hide, because
       * wg-values.mjs deliberately holds no VAR mapping for RAGE_DAMAGE and compares no number here.
       * Blast radius measured over the whole dump: 11 rows name RAGE_DAMAGE at all (most of them read
       * it back in a conditional), and the before/after corpus run in this pass's report
       * (work/.b033-report-resume-instruments-*.txt) names every record whose `missing` it changes:
       * eight instincts, every one of them carried by the derive.ts tiers table read below.
       */
      if (/^RAGE_DAMAGE/.test(v)) return 'weapon';
      if (/^SENSE|VISION|DARKVISION/.test(v)) return 'sense';
      if (/^SIZE/.test(v)) return 'size';
      if (/^CLASS_DC/.test(v)) return 'classDc';
      if (/^FOCUS_POINT/.test(v)) return 'focus';
      if (/^BULK_LIMIT|^IMPLANT_LIMIT/.test(v)) return 'carry';
      if (/^LANGUAGE|MULTILINGUAL/.test(v)) return 'language';
      /* Their ancestry rows write the printed "Choose from …" additional-language pool as
       * CORE_LANGUAGES (58 ops, found teaching batch 19). Ours is `languages.options` on the
       * ancestry, surfaced list-first by the LanguageEditor. */
      if (/^CORE_LANGUAGES/.test(v)) return 'language';
      /* AWAKENED_ANIMAL_HERITAGE is their engine writing down which heritage was picked so later
       * conditionals can read it back — select-answer bookkeeping, the CHAMPION_MERCIES class. */
      if (/^AWAKENED_ANIMAL_HERITAGE/.test(v)) return null;
      if (/^PRIMARY_SHEET_TABS|^PAGE_/.test(v)) return null; // pure UI plumbing, not a game rule
      /*
       * Which options a picker OFFERS is the one thing the owner reserved for us: "the only place where
       * we have the last word is filtering the options when giving a user selection menu." Their
       * blacklist verbs are therefore not a disagreement to act on.
       */
      if (/^BLACKLIST_|^WHITELIST_/.test(v)) return null;
      /* …and a _FEAT_COUNT. Their engine keeps a running tally of how many feats of an archetype the
       * character holds so its conditionals can read it; it is plumbing, not a rule any record states,
       * and our equivalent is computed at read time. Quoting one as a gap would be quoting their
       * bookkeeping back at them. */
      if (/_FEAT_COUNT$/.test(v)) return null;
      /*
       * SELECT-ANSWER BOOKKEEPING. Their Mercy declares `CHAMPION_MERCIES` and each of its three
       * options writes its own name into that list — `adjValue CHAMPION_MERCIES value="body"`. That is
       * not a mechanic; it is their engine writing down which option the player chose so later
       * conditionals can read it. Ours records the same answer as the choice itself, under the choice's
       * flag, which is why `select` already maps to `choice` and matches.
       *
       * Deliberately narrow, because a bespoke statistic is ALSO created and then adjusted, and those
       * adjustments are real numbers we must not hide. Both must hold:
       *   · the write sits inside the select's own option (`__inOption`, set by `flatten`), and
       *   · the value written is a NON-NUMERIC string — an option name, not an amount.
       * A numeric adjustment inside an option (a resistance value, a bonus) still reports.
       */
      if (op.__inOption && typeof op.data?.value === 'string' && op.data.value !== '' && !Number.isFinite(Number(op.data.value))) return null;
      /*
       * ⚠ THE FALLBACK IS NAMED, NOT SILENT. It used to be `'value'` — which is not a key in OUR_KINDS,
       * so 642 operations across 41 variables were counted as translated and then mapped to nothing.
       * A differ that reports coverage it does not have is worse than one that reports a gap.
       * Anything reaching here has no field on our side; scripts/wg-vocabulary.mjs lists them by
       * frequency, and work/wg-lane-backlog.md is where they go until a lane exists.
       */
      return 'unmapped';
    }
    case 'conditional': return 'conditional';
    case 'giveSpell': return 'spell';
    case 'giveSpellSlot': return 'spellSlot';
    case 'defineCastingSource': return 'spellcasting';
    case 'select': return 'choice';
    case 'giveAbilityBlock': {
      const bid = String(op.data?.abilityBlockId);
      /* A PHYSICAL-FEATURE block is a CONTAINER, not a record either side ships: their ancestry rows
       * hand out "Clan Dagger" or "Blunt Snout" as a block whose OWN operations carry the mechanics
       * (48 of 110 do; the other 62 are prose-only). Naming the container `grantsRecord` made every
       * such ancestry report a permanent style gap — ours models the CONTENTS (grantsItems,
       * degreeShifts, stars…). So the block is compared by its contents, exactly as a `conditional`
       * is; an op-less block asserts nothing mechanical on their side either. */
      if (blockTypeById.get(bid) === 'physical-feature') return physicalFeatureKinds(bid);
      return BLOCK_TYPE_KIND[blockTypeById.get(bid)] ?? 'grantsRecord';
    }
    /* An unarmed attack is a `grantedStrikes` entry on our side, not an inventory item. */
    case 'giveItem': return unarmedItemIds.has(String(op.data?.itemId)) ? 'weapon' : 'grantsItem';
    case 'giveTrait': return 'trait';
    case 'giveLanguage': return 'language';
    /* `createValue` makes a NEW variable — usually a bespoke statistic, but their Lores are created
     * this way too (`createValue SKILL_LORE_AXIS`). A Lore is a skill on our side, held in the same
     * `skills` map as any other, so three of batch 3's rows reported a missing `specialStat` for a
     * `lore:axis` we already train. */
    case 'createValue': return /^SKILL_|^LORE_/.test(v) ? 'skill' : 'specialStat';
    /*
     * `bindValue` POINTS ONE VARIABLE AT ANOTHER — and on a SPEED variable that is a Speed GRANT, not
     * a modification of some other record's grant.
     *
     * Quick Swim: *"If you're legendary in Athletics, you gain a swim Speed equal to your Speed"* is
     * `conditional (SKILL_ATHLETICS EQUALS L) THEN bindValue SPEED_SWIM <- CHARACTER.SPEED`. Ours is
     * `speedsIf: [{skill:'athletics', rank:'legendary', speeds:{swim:'@actor.speed.land'}}]` — the same
     * sentence, gate and formula, read in derive.ts after the land bonuses are folded in — which scores
     * `speed` + `conditional`. Filed as `modifiesGrant`, the record reported a permanent gap for a kind
     * (`recordMarks` — "on the High Jump action, DC -10") that has nothing to do with a Speed.
     *
     * ⚠ Only the SPEED_* variables. A bindValue on anything else really is their verb for "make this
     * follow that", which is the `modifiesGrant` lane, and widening it would launder those.
     */
    case 'bindValue': return /^SPEED/.test(v) ? 'speed' : 'modifiesGrant';
    case 'injectText': return 'note';
    /*
     * `injectSelectOption` IS A CROSS-RECORD OPTION INJECTION — THE CHOICE BELONGS TO THE RECORD THAT
     * OWNS THE SELECT, AND IS SCORED THERE.
     *
     * Their four surki heritages carry no `select` of their own. Each emits `injectSelectOption
     * variable=INJECT_SELECT_OPTIONS` whose payload is `{"opId":"39f5996f-2f7c-4b52-b7a3-e52b2dc9c6ca",
     * "option":{…}}` — and 39f5996f-… is the `id` of the `select` op ("Select an Evolution") on their
     * ability block 28165, «Grand Metamorphosis». Print agrees: the evolution is not a 1st-level
     * heritage question at all, it is Grand Metamorphosis (feat-5393, Feat 9) — *"One of your nodes has
     * adapted into a new magic-emitting organ. You gain one of the evolutions from your surki
     * heritage."* Ours asks it in the same place, `feats['grand-metamorphosis'].choice` (flag
     * 'surkiEvolution'), whose options carry all eight surki evolutions. Scoring the injection as a
     * heritage-level `choice` therefore reported `missing=[choice]` on lantern/hardshell/elytron/breaker
     * surki, and taken literally would have us add a picker to the heritage that print does not ask for.
     *
     * Dropped rather than re-keyed onto the owner, because the owner already scores `choice` from the
     * `select` op itself — re-keying would double-count. Blast radius MEASURED over the whole dump:
     * 11 injectSelectOption ops on 7 rows (the four surki, Frozen Wind Kitsune, Specialized Spirit
     * Companion, Peerless Mascot Companion), and ZERO of the 11 name an opId that belongs to their own
     * row — the verb is always cross-record, which is why it exists. Only the four surki were in
     * THEY-ONLY; the other three can only move toward WE-ONLY, never open a new gap.
     */
    case 'injectSelectOption': return null;
    default: return 'value';
  }
};

/** Our fields, in the same currency. A field may answer more than one kind (passiveEffects). */
const OUR_KINDS = {
  /* `skillProgression` is a skill grant that arrives on a schedule — the necromancer's Undead Lore and
   * the thaumaturge's Esoteric Lore climb to expert/master/legendary at 3/7/15 on their own, with no
   * skill increase spent. `skillAbilitySwap` is the other half of the same clause (Esoteric Lore runs
   * off Charisma), and is a skill fact too. */
  /*
   * ⚠ A CLASS AND A BACKGROUND STATE THEIR CHASSIS ON THEMSELVES, and none of those fields were listed.
   *
   * Batch 1 is the only batch cut before the level ordering, so it is the only one holding classes and
   * backgrounds — and every one of them reported gaps it did not have. The Alchemist read as modelling
   * no attribute, save, skill, weapon or AC while its own record carries `keyAbility`, `saves`,
   * `trainedSkills`, `attacks` and `defenses`; nine backgrounds read as offering no choice while every
   * one of them offers an ability-boost choice and most a skill choice too. Fourteen false gaps from
   * one blind spot, which is the shape this project keeps finding: a gap list is a claim about a QUERY.
   */
  /* The bare 'skills' key is what a CONTAINER grant carries — `choice.options[].grant.skills` and
   * `effectChoices[].options[].grant.skills` (51 records; 18 heritages like anvil-dwarf's trained-
   * skill branch, plus oatia-skysage-dedication's expert-occultism branch). The two container walks
   * below already credit whatever fieldToKinds knows, and this key was the one they were never
   * taught — so a grant that MOVED into a container (orc-warmask) re-opened as missing=[skill].
   * Safe: within the paired buckets a top-level `skills` map exists on one record (creative-prodigy);
   * animalCompanions' `skills` ARRAYS are outside WG_PAIRING and never reach ourKinds. */
  /* `trainedLoreOptions` — a background's "one of the following Lore skills" list, the dedicated
   * named-subject lane (batch 19 retired the duplicate `choice` blocks that used to shadow it). */
  /* `untrainedProficiency` — the floor an UNTRAINED skill check gets ("equal to your level", or level-2
   * for Untrained Improvisation), read by untrainedSkillBonus in derive.ts. The twin of their
   * UNTRAINED_IMPROVISATION variable, taught above. */
  skill: ['skills', 'trainedSkill', 'trainedSkillChoice', 'trainedLore', 'trainedLoreChoice', 'trainedLoreOptions', 'trainedSkills', 'skillSubstitutions', 'skillProgression', 'skillAbilitySwap', 'untrainedProficiency', 'passiveEffects.skills', 'passiveEffects.loreBonus'],
  save: ['passiveEffects.saves', 'saves'],
  perception: ['passiveEffects.perception', 'perception'],
  /* `unarmoredAc` is natural armour (Scales of Steel and its three peers) — an AC item bonus while
   * unarmored. Their side grants it as an ITEM, so without this the whole lane reads as missing. */
  ac: ['acBonus', 'passiveEffects.ac', 'armorAdjust', 'armorRestat', 'unarmoredAc', 'defenses'],
  /* `speedAdjust` — "reduce ALL your Speeds by 5" (Zombie Dedication), "any fly Speed you have increases
   * by 5" (Winged Warrior). Neither is a `speeds` map nor a land bonus, so both records read as
   * adjusting no speed at all on the day they were authored correctly. */
  speed: ['speeds', 'landSpeedBonus', 'landSpeedMin', 'speedPenalty', 'speedAdjust', 'passiveEffects.speedBonus', 'passiveEffects.speedPenalty', 'passiveEffects.speeds', 'speedsIf'],
  /* ⚠ The bare `weaknesses` was missing while `passiveEffects.weaknesses` was present, so a record
   * whose defensive clause is a WEAKNESS on itself read as holding no defence at all — the Werecreature
   * Dedication's *"a weakness to silver equal to half your level"* and the Mummy Dedication's fire
   * weakness are both authored, correctly, and both read as gaps. A cost the record imposes is part of
   * its defensive profile exactly as a resistance is. */
  // `resonant.resistances` — an aeon stone's resonant power (batch 29, Vital Amplification), read by derive.ts behind the wayfinder-slotted gate.
  /* `armorSpec` — an armour-specialization ACCESS grant, applied by armorSpecAccess in derive.ts as a
   * typed resistance while the character wears armour of a granted category. Their ARMOR_SPECIALIZATION_*
   * twin is taught above. */
  defense: ['resistances', 'weaknesses', 'immunities', 'passiveEffects.resistances', 'passiveEffects.immunities', 'passiveEffects.weaknesses', 'resonant.resistances', 'removesWeaknesses', 'choiceResistance', 'resistanceLevelUpgrade', 'armorSpec'],
  /* `ancestryHp` — a heritage that REPLACES the ancestry's Hit Points outright (Stoutheart Centaur:
   * *"Your ancestry Hit Points are 10 instead of 8"*), read first in resolvedAncestryHp (build.ts).
   * Their side writes the delta as adjValue MAX_HEALTH; ours writes the printed total. */
  hp: ['maxHpBonus', 'hp', 'hpPerLevel', 'ancestryHp'],
  /* `spellcastingGrant` is THE field an archetype dedication uses to hand over a casting entry
   * ("you gain the ability to cast divine spells; your spellcasting attribute is Charisma") — 36
   * records carry it, and it was not listed, so every one read as granting no spellcasting. */
  /* `innateSpells` IS a spellcasting grant, not only a spell grant. An innate spell arrives with a
   * spell attack roll and a spell DC — Player Core p.298, *"trained in spell attack rolls and spell
   * DCs … expert at 12th level"* — and their side writes exactly that as an `adjValue SPELL_ATTACK` /
   * `SPELL_DC` pair beside every innate grant. Ours delivers it centrally instead, on the pooled
   * innate entry at src/rules/build.ts:7113
   * (`level >= 12 ? 'expert' : 'trained'`), so no record carries a per-record field and every record
   * granting an innate spell read as modelling no spellcasting at all — Forge-Blessed Dwarf, whose
   * nine `effectChoices` options each grant one, was the case. Listed here (not only in the container
   * walks) because a container must not decide whether a grant counts — the same rule the
   * `effectChoices` / `choice` option walks below already follow. */
  spellcasting: ['spellcasting', 'spellcastingGrant', 'proficiencies', 'focusPoolBonus', 'innateSpells', 'resonant.innateSpells'],
  /* `alternateAttributes` is A HERITAGE'S ATTRIBUTE PACKAGE, held one level down — *"Instead of the
   * normal attribute boosts and flaws, you can choose to gain a boost to Strength, a boost to Charisma,
   * and a flaw in Intelligence"* (Mightyfall Kobold). The boosts and flaws sit inside it
   * (`alternateAttributes.abilityBoosts` / `.abilityFlaws`), read by heritageAdjustedAncestryAttributes
   * (src/rules/build.ts:663-680) and rendered by the heritage picker (src/builder/shared.tsx:2556), so
   * the mechanic is live — but a map keyed by top-level field NAME credited the package to no kind at
   * all and Mightyfall Kobold reported `missing=[hp,attribute]` on a record that carries both.
   * Adversarially confirmed: the only two records in core.json with the field are
   * heritages/mightyfall-kobold and backgrounds/song-of-the-deep, and each holds its boosts there. The
   * `hp` half is credited by the nested read in `ourKindsOf`, since only one of the two carries `hp`. */
  attribute: ['abilityBoosts', 'abilityFlaws', 'apexAttribute', 'keyAbility', 'alternateAttributes'],
  /* `unarmedTraits` was absent: Iron Fists ("your fist unarmed attacks no longer have the nonlethal
   * trait and gain the shove trait") ships exactly that, and their side expresses it by handing over a
   * pre-modified Unarmed item — so ours read as a missing weapon. */
  /* `attackItemBonus` — a weapon's OWN printed item bonus to attack (the alchemical bomb grades). */
  weapon: ['grantedStrikes', 'critSpec', 'critSpecWeapons', 'weaponFamiliarity', 'strikeRiders', 'strikeReach', 'mapReduction', 'precisionDice', 'unarmedTraits', 'attackItemBonus', 'attacks', 'attackGroups'],
  sense: ['senses', 'vision', 'conditionalSenses', 'darkvisionIfAncestryLowLight', 'passiveEffects.senses'],
  /* `sizeSet` is the unconditional form (Wisp Fetchling *"You're Small instead of Medium"*, Ponygait
   * Centaur Medium), read at build.ts beside `sizeOverride`; both were shipped, only one was listed. */
  size: ['size', 'sizeOverride', 'sizeSet'],
  /* `spellListAdditions` was absent, so Tupilaq Carver's *"Add the Summon Construct spell to your
   * spell list"* — which we ship as exactly that — read as a missing `giveSpell`. Their vocabulary
   * has no verb for "add to the list" and uses `giveSpell` for both. */
  /* `resonant.innateSpells` — an aeon stone's second spell, the one it casts *"when slotted into a
   * special magical item called a wayfinder"*. It is a real granted spell held one level down, so a
   * reader that only looks at top-level fields calls 15 stones spell-less. */
  spell: ['innateSpells', 'focusSpells', 'grantedRepertoire', 'heldSpells', 'grantsRituals', 'eidolonCantrips', 'spellListAdditions', 'resonant.innateSpells'],
  /* `spellSlotBonus` is on 42 records and was not listed — an archetype's extra slot ("you gain an
   * extra spell slot at each rank") read as granting no slot at all. */
  spellSlot: ['spellSlot', 'spellSlotBonus'],
  /*
   * A SLOT is a selection, and their `select from:LANGUAGE` / `select from:CUSTOM` says so.
   * Tangle-tongue's Wit ships `languageChoices: 2` — two pickers — and read as a missing `choice`
   * because those fields were filed under `language` alone. Same for a Lore slot and a skill slot.
   */
  /* `runesKnown` is the runesmith's repertoire table — *"At 1st level, you learn four 1st-level runes
   * of your choice"* — and a table of how many you pick IS a choice, the same way `skillChoices` is. */
  /* …and the choices a BACKGROUND or ANCESTRY makes without a `choice` field: an ability boost the
   * player picks (`abilityBoosts` carries `kind: 'choice' | 'free'`) and a "trained in your choice of
   * X or Y" skill or Lore. Their side encodes each as a `select`, which is why nine backgrounds read as
   * offering no choice at all while every one of them opens a picker in the builder. */
  /* `choiceResistance` is a PICKER, and it was filed under `defense` alone. Deep Fetchling's
   * *"You gain cold or negative resistance … chosen when you gain this heritage"* is asked as
   * `choiceResistance.options` (rendered at src/builder/shared.tsx:2729, answered into
   * `build.heritageResistanceChoice`, applied at src/rules/derive.ts:2681) — the same two-branch
   * `select` their side writes — so the record modelled the question and reported `choice` missing. */
  /* `grantsGeneralFeat` IS A SLOT, and a slot is a selection — Versatile Human: *"Select a general feat
   * of your choice for which you meet the prerequisites"*. Their side asks it as a FILTERED select over
   * level-1 General ability blocks; ours opens the same picker from the boolean (SearchSelect over
   * `heritageFeatOpts`, src/builder/shared.tsx:2694-2707, answered into `build.heritageFeatId` and
   * injected as a level-1 'general' feat at src/rules/build.ts:4411-4420, with an unfinished-build
   * warning at build.ts:1118). Only `choice`/`effectChoices` counted as asking, so the one record with
   * the field reported `missing=[choice]` while its picker has always been there. Filed under `choice`
   * only, not `grantsRecord`: the record hands over nothing until the player answers. */
  /* `choiceOptionLimits` — a record that NARROWS another record's pick (Frozen Wind Kitsune: foxfire
   * *"deals cold damage instead of electricity or fire"*), read by effectiveChoiceLimits. Their side
   * writes the same thing as a select with one option; the answer is fixed, but the kind is theirs. */
  choice: ['choice', 'effectChoices', 'choiceResistance', 'languageChoices', 'languageChoicesAtRank', 'languageChoicesBonus', 'loreChoices', 'skillChoices', 'runesKnown', 'abilityBoosts', 'trainedSkillChoice', 'trainedLoreChoice', 'trainedLoreOptions', 'grantsGeneralFeat', 'choiceOptionLimits'],
  /* `derivedGrant` is how a record hands over a class feature the character ALREADY chose on another
   * record — the barbarian instinct ability, the thaumaturge implement benefit, the gunslinger way's
   * initial deed. Their side spells it as a conditional wrapping a giveAbilityBlock, so it answers both
   * kinds. */
  grantsRecord: ['grantsFeats', 'grantsClassFeatures', 'grantsActions', 'grantedFeatId', 'grantedFeatByChoice', 'grantsFeat', 'derivedGrant'],
  /* `combinationMeleeForm` is how a COMBINATION WEAPON hands over its other usage: their side ships a
   * second "(Ranged)" item row plus one `giveItem`, ours names the `-melee` record. The same mechanic —
   * and without this all 18 read as granting nothing the moment they were correctly linked. */
  grantsItem: ['grantsItems', 'combinationMeleeForm'],
  /* `removesCreatureTraits` — the subtractive half (Fungus Leshy: *"you lose the plant trait and gain
   * the fungus trait"*), read in creatureTraitsOf after every additive source. */
  trait: ['grantsCreatureTraits', 'grantsCreatureTraitFromChoice', 'extraAncestryFeatTraits', 'removesCreatureTraits'],
  /* ⚠ `grantsLanguages` — the record NAMING a language, as opposed to offering a choice — was absent
   * here, and only its `passiveEffects` twin was listed. Angelkin's *"You know the Empyrean language"*
   * read as missing on the day it was authored. */
  /* `addsLanguageOptions` — a heritage WIDENING the ancestry's additional-languages menu without
   * granting anything (Dragonblood: *"Add Draconic to your ancestry's list of additional languages"*),
   * read by LanguageEditor (builder/shared.tsx). Their side spells it as adjValue CORE_LANGUAGES. */
  language: ['languages', 'languageChoices', 'grantsLanguages', 'passiveEffects.grantsLanguages', 'languageChoicesAtRank', 'languageChoicesBonus', 'addsLanguageOptions'],
  /*
   * Their `specialStat` is almost always a `createValue` — an engine variable their side invents to
   * remember an answer or count something. Ours are named fields, and there are two of them:
   *
   *   `choice`         a recorded PICK. GUNSLINGER_DEDICATION_WAY is `choice.flag: 'gunslingerWay'`;
   *                    ARCTIC/DESERT/MOUNTAIN/SWAMP is `choice.flag: 'terrain'`;
   *                    STERLING_DYNAMO_OPERATION is `choice.flag: 'dynamo'`.
   *   `dedicationGate` a COUNTER. STONE_BRAWLER_FEAT_COUNT and MONOLITH_FEAT_COUNT are both the
   *                    printed *"you cannot select another dedication feat until you have gained two
   *                    other feats from the … archetype"* clause, which we hold as a gate rather than
   *                    as a tally the player has to read.
   */
  specialStat: ['specialStatistic', 'passiveEffects.specialStatBonus', 'choice', 'dedicationGate'],
  /* `recordMarks` annotates ANOTHER record — "on the High Jump action, DC -10" — which is precisely
   * what their `injectText type=action` does, and it was in no kind list at all. Raging Athlete
   * carries three of them and reported `modifiesGrant` missing. */
  modifiesGrant: ['modifiesGrant', 'recordMarks'],
  /* `whileActive` was read for its CONTENTS (the loop further down maps each sub-field) but never
   * counted as a condition in its own right, so a clause that only fires while a state is on scored
   * its speed/sense/resistance and still reported `conditional` missing — on a record whose entire
   * shape is "while raging". Their encoding of the same thing is literally a `conditional` op. */
  conditional: ['situational', 'modes', 'battleForm', 'enhancement', 'degreeShifts', 'conditionalSenses', 'speedsIf', 'whileActive', 'derivedGrant'],
  note: ['note', 'spellNotes'],
  /*
   * Added 2026-08-18 after scripts/wg-vocabulary.mjs measured where their generic value verbs actually
   * point. Each of these is a variable we DO have a field for; only the pattern above failed to
   * recognise their spelling, so they were reported as translated and reached nothing.
   *   CLASS_DC 106 ops   UNARMED_ATTACKS 87   FOCUS_POINT_BONUS 29   BULK_LIMIT_BONUS 16
   *   MELEE_ATTACK_DAMAGE_BONUS 14   RANGED_ATTACK_ROLLS_BONUS 6
   */
  /* `classDcGrant` — an archetype dedication training you in ANOTHER class's DC (Alchemist Dedication:
   * "you become trained in … the alchemist class DC"). Absent here, so the record read as missing it. */
  classDc: ['classDc', 'classDcBonus', 'proficiencies', 'classDcGrant'],
  focus: ['focusPoolBonus', 'focusSpells'],
  /* ⚠ The NESTED path too. `bulkLimitBonus` has two homes — top-level on a feat (Beast of Burden) and
   * `passiveEffects.bulkLimitBonus` on an item or rune (Lifting Belt, the Assisting rune) — and only the
   * first was listed, so a correctly authored ITEM read as modelling no carrying capacity at all. */
  /* …and `bulkMaxBonus`, the asymmetric one: a bonus to the MAXIMUM limit that leaves the encumbered
   * limit alone (Embodied Dreadnought Subjectivity). Adding the field without adding it here would have
   * left the record reporting no carrying capacity the moment it was correctly authored. */
  carry: ['bulkBonus', 'bulkLimitBonus', 'bulkMaxBonus', 'passiveEffects.bulkLimitBonus'],
  /* Ours with no operation on their side at all — never counted as "they lack it", because a
   * vocabulary that cannot express something has not omitted it, it simply cannot say it. */
  _noCounterpart: ['degreeShifts', 'limitedUses', 'uses', 'companions', 'dailyChoice', 'temporaryProficiency', 'redundantFallback', 'actionCost'],
};
/**
 * WHAT A RuneDef DELIVERS, by its `kind` — the runes-bucket half of `ourKindsOf`.
 *
 * Kept a KIND MAP rather than "the id has a rune twin, so believe it": all 159 runes have an items-row
 * twin, and a blanket credit would silence every rune lane at once. Only kinds whose reader has been
 * read end-to-end are listed. `resilient` is here because AoN equipment-2786 prints *"a +1 item bonus
 * to saving throws"* and the chain is complete — planRune (attachments.ts) -> ArmorRunes.resilient ->
 * resilientSaveBonus (derive.ts) -> deriveSave's item bonus.
 */
const RUNE_KINDS = {
  resilient: ['save'],
};
const fieldToKinds = new Map();
for (const [kind, fields] of Object.entries(OUR_KINDS)) {
  if (kind.startsWith('_')) continue;
  for (const f of fields) fieldToKinds.set(f, [...(fieldToKinds.get(f) ?? []), kind]);
}

/* ---------------------------------------------------------------- our side */
/* `--core <path>` points the comparer at a STUNTED copy of the content, so a test can delete a carrier
 * and prove the record it answers goes back to reporting — the anti-laundering check every teach owes
 * (the `--advancement` flag on wg-values.mjs is the same hook one file over). Defaults to the shipped
 * content, so nothing changes for a normal run. */
const core = JSON.parse(readFileSync(join(ROOT, arg('--core', 'public/core.json')), 'utf8'));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * ⚠ A DATA FIELD IS NOT THE ONLY PLACE A MECHANIC LIVES.
 *
 * The first version of this script read top-level fields and `passiveEffects`, and nothing else. It
 * produced 1,329 "they model this and we do not" rows, and a 26-record sample put its precision at
 * 19.2% — 19 of 26 were mechanics we DO have, sitting in an id-keyed registry under src/rules/ where
 * no field on the record shows them.
 *
 * Officer's Education was the worked example: five things Wanderer's Guide encodes, four of them
 * already ours — three skill choices in FEAT_SKILL_GRANTS and a general-feat pick in
 * FEAT_PICK_GRANTS. Only the fifth, a language, was genuinely missing. A differ that reports all
 * five wastes four fifths of whoever works the list.
 *
 * So the registries are read as first-class carriers. They are TypeScript, not data, so they are
 * scanned as text for `'<feat-id>':` — deliberately crude, because the alternative is importing
 * src/rules into a plain .mjs script and the only question being asked is "is this id present".
 *
 * ⚠ THREE WAYS THIS SCAN UNDER-REPORTED, all found by measuring batch 3 after it was worked:
 *
 *   1. A KEY NEED NOT BE QUOTED. `gildedsoul: [...]` is a valid JS identifier and the old pattern
 *      required quotes, so a record was invisible purely because of how it was typed. The whole file
 *      then looked like a gap it was not.
 *   2. ONE FILE HOLDS SEVERAL TABLES, and they do not all mean the same thing. featFeatGrants.ts
 *      carries four, of which only FEAT_RANK_FEAT_GRANTS is conditional — a per-FILE kind list has
 *      to choose between claiming `conditional` for 300 unconditional grants or for none.
 *   3. `situationalBonuses.ts` was flattened to `conditional`, but every entry NAMES its targets
 *      (`targets: [{ kind: 'perception' }]`). Their side calls a +2 to Perception a `perception`
 *      operation, so ours read as missing: eight of batch 3's forty-four rows were this one bug,
 *      including Stonemason's Eye, whose bonus has shipped since long before the batch.
 *
 *   4. TEN REGISTRY FILES WERE NOT ON THE LIST AT ALL, holding 286 feat ids between them —
 *      companionGrants.ts (112), featGrantsLane.ts (62), featCantripGrants.ts (51),
 *      casterArchetypes.ts (22) and six smaller. Counted by scanning every file in src/rules for
 *      keys that are core.json feat ids, rather than by remembering which files exist.
 *
 * All four inflate the work list with records that are already done — the exact failure the 19.2%
 * measurement above exists to prevent.
 */
const REGISTRY_KINDS = [
  ['src/rules/featGrantsAuto.ts', ['skill', 'choice']],
  ['src/rules/featGrants.ts', ['skill', 'choice', 'grantsRecord']],
  ['src/rules/featGrantsLane.ts', ['skill', 'choice', 'grantsRecord']],
  ['src/rules/featPickGrants.ts', ['choice', 'grantsRecord']],
  ['src/rules/featFeatGrants.ts', ['grantsRecord', 'choice']],
  ['src/rules/backgroundGrants.ts', ['choice', 'grantsRecord']],
  ['src/rules/modes.ts', ['conditional']],
  ['src/rules/domains.ts', ['spell']],
  ['src/rules/featUses.ts', ['value']],
  /* Added 2026-08-18 from the measurement above. Kinds are the record's own vocabulary, read from
   * each file's header and shape, not guessed from its name. */
  ['src/rules/companionGrants.ts', ['grantsRecord', 'choice']],
  ['src/rules/featCantripGrants.ts', ['spell', 'choice']],
  ['src/rules/casterArchetypes.ts', ['spellcasting', 'spell', 'spellSlot', 'choice']],
  ['src/rules/formulaBook.ts', ['grantsItem']],
  ['src/rules/counterMods.ts', ['specialStat']],
  ['src/rules/glossary.ts', ['sense']],
];

/**
 * Per-TABLE overrides, for a file whose tables do not all model the same kind. The table's slice of
 * the file wins over the file-wide entry above.
 *
 * FEAT_RANK_FEAT_GRANTS is the case that forced this: "if you're already trained in Crafting you
 * instead gain Specialty Crafting" is a grant AND a condition, and their encoding of it is literally
 * `type: 'conditional'`. Without this the two records it holds report `conditional` as missing on the
 * day the lane was built.
 */
const TABLE_KINDS = {
  FEAT_RANK_FEAT_GRANTS: ['grantsRecord', 'conditional'],
};

/** Their kind for one of our situational `targets[].kind` values. Unlisted → `conditional` only. */
const SITUATIONAL_TARGET_KINDS = {
  skill: 'skill', skills: 'skill', save: 'save', ac: 'ac', perception: 'perception',
  speed: 'speed', hp: 'hp', classDc: 'classDc', spell: 'spell', spellDamage: 'spell',
  strikeAttack: 'weapon', strikeDamage: 'weapon', attack: 'weapon', ability: 'attribute',
  initiative: 'perception', // their INITIATIVE ops resolve against Perception, as ours do
};

/**
 * Their kind for one of a MODE MODIFIER's `target` values (`ModeTargetKind`, src/rules/types.ts:4579).
 *
 * BOTH mode readers below — the `src/rules/modes.ts` source scan and the `core.modes` loop — read a
 * mode's grantedStrikes, IWR, senses, speeds and size, and NEITHER read its `modifiers`, which is where
 * a mode keeps every plain number it applies. Four batch-033 records failed KINDS on nothing else:
 *
 *   curse-of-creeping-ashes      missing=[weapon,speed]  — modes/curse-of-creeping-ashes-2..4 carry
 *       {value:-2,type:'circumstance',target:'attack'} and -4 also {value:-10,type:'status',
 *       target:'speed'}, AoN mystery-20 Cursebound 2 and 4.
 *   curse-of-the-mortal-warrior  missing=[save]          — its four modes carry {target:'save'}, which
 *       wg-values.mjs ALREADY reads by name; wg-diff was the only blind side. AoN mystery-13 (Battle),
 *       "Curse of the Mortal Warrior", Cursebound 2 and 4.
 *   decay-instinct / ligneous-instinct  missing=[unmapped] — cat-rotting-rage / cat-wooden-rage carry
 *       {target:'damage'} (and, for Ligneous, {target:'speed'}), against their RAGE_DAMAGE above.
 *
 * ⚠ A MAP, NOT A BLANKET "it has a mode, believe it". The gate on a mode is still `feats`/`fromItemId`
 * naming the record, and only the tracks listed here are credited: `all-checks` is deliberately absent
 * (it names no single kind, so a mode carrying only one still reports). The pairs mirror
 * SITUATIONAL_TARGET_KINDS above — the same targets, reached through the other conditional lane.
 */
const MODE_MODIFIER_KINDS = {
  ac: 'ac', save: 'save', perception: 'perception', skill: 'skill',
  attack: 'weapon', damage: 'weapon',
  'spell-attack': 'spellcasting', 'spell-dc': 'spellcasting', 'class-dc': 'classDc',
  speed: 'speed', 'max-hp': 'hp', initiative: 'perception', ability: 'attribute',
};

/**
 * classFeature id -> the class that grants it, so a chassis feature can be credited with the mechanic
 * its CLASS record carries. Built from the classes' own feature tables; first grant wins, which matters
 * only for a feature two classes share (and then either owner answers the same question).
 */
const classOfFeature = new Map();
for (const [cid, cls] of Object.entries(core.classes ?? {})) {
  for (const f of cls.features ?? []) if (!classOfFeature.has(f.featureId)) classOfFeature.set(f.featureId, cid);
}

const registryKindsById = new Map();
const addKinds = (id, kinds) => {
  const prev = registryKindsById.get(id) ?? new Set();
  for (const k of kinds) prev.add(k);
  registryKindsById.set(id, prev);
};

/* A key at the start of an entry, quoted OR bare: `'officers-education':` and `gildedsoul:` both. */
const KEY_RE = /(?:^|[\s,{])(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:/gm;

for (const [path, kinds] of REGISTRY_KINDS) {
  let text;
  try { text = readFileSync(join(ROOT, path), 'utf8'); } catch { continue; }
  /* Split into `export const NAME` blocks so a per-table override can claim its own slice. */
  const marks = [...text.matchAll(/export\s+(?:const|type)\s+([A-Za-z_][A-Za-z0-9_]*)/g)];
  const blocks = marks.length
    ? marks.map((m, i) => [m[1], text.slice(m.index, marks[i + 1]?.index ?? text.length)])
    : [[null, text]];
  for (const [table, body] of blocks) {
    const k = (table && TABLE_KINDS[table]) ?? kinds;
    for (const m of body.matchAll(KEY_RE)) addKinds(m[1] ?? m[2], k);
  }
}

/*
 * TWO REGISTRIES DO NOT NAME THEIR RECORDS AS KEYS, AND THE SCAN ABOVE READS ONLY KEYS.
 *
 * `KEY_RE` finds `'some-feat':` — an entry keyed by the record it belongs to. Both registries below
 * reach their records another way entirely, so the scan credited them with nothing and every record
 * they cover reported its whole mechanic as missing. Neither is a handful of records:
 *
 *   1. MODE CATALOGUE (src/rules/modes.ts). A catalogue mode gates by ARRAY ELEMENT —
 *      `{ id: 'cat-invoke-offense', feats: ['invoke-offense'], grantedStrikes: [...] }`. The scan saw
 *      the keys `id`, `feats`, `grantedStrikes` and never the feat id inside the array. The
 *      `core.modes` loop further down does read gates properly, but it reads the merged
 *      scripts/data/toggle-modes.json ONLY — the TypeScript catalogue is merged into content at
 *      runtime and never lands in public/core.json, so it is invisible to a core.json reader.
 *      Batch 12 surfaced this as `invoke-offense missing=[conditional,weapon]` on a feat whose
 *      d8 spirit Strike, its traits and its 5th/12th/20th striking ladder are all authored.
 *
 *   2. CASTER ARCHETYPES (src/rules/casterArchetypes.ts). The entry is keyed by the DEDICATION, and
 *      the Basic/Expert/Master feats that actually unlock the slots are MINTED by `mk()` —
 *      `basic-${slug}-spellcasting` — so those ids appear nowhere in the file as text. Every one of
 *      them read as `missing=[spellSlot]` while the ladder works on a built character. Batch 12 hit
 *      four of them at once; the corpus holds one per tier per archetype.
 *
 * Both are read here from the source text, mirroring the same rules the app uses.
 */
{
  /* 1. Mode catalogue. Entries are sequential objects in one array, each opening with `id: '…'`, so
   * slicing between consecutive `id:` matches gives one entry's body. */
  let text = '';
  /* `--modes` is the anti-laundering hook, the twin of `--core`: a teach that reads a TypeScript table
   * can only be mutation-proved against a copy of that table with the carrier removed. Same for
   * `--advancement` and `--derive` below (wg-values.mjs already shipped `--advancement`). */
  try { text = readFileSync(join(ROOT, arg('--modes', 'src/rules/modes.ts')), 'utf8'); } catch { text = ''; }
  const marks = [...text.matchAll(/\bid:\s*'([a-z0-9][a-z0-9-]*)'/g)];
  for (const [i, m] of marks.entries()) {
    const body = text.slice(m.index, marks[i + 1]?.index ?? text.length);
    const gates = [];
    const feats = /\bfeats:\s*\[([^\]]*)\]/.exec(body);
    if (feats) for (const g of feats[1].matchAll(/'([^']+)'/g)) gates.push(g[1]);
    const fromItem = /\bfromItemId:\s*'([^']+)'/.exec(body);
    if (fromItem) gates.push(fromItem[1]);
    if (!gates.length) continue;
    /* Same kinds the core.modes loop assigns, from the same fields. */
    const k = ['conditional'];
    if (/\bgrantedStrikes:\s*\[/.test(body)) k.push('weapon');
    if (/\b(resistances|weaknesses|immunities):\s*\[/.test(body)) k.push('defense');
    if (/\bsenses:\s*\[/.test(body)) k.push('sense');
    if (/\bspeeds:\s*\{/.test(body)) k.push('speed');
    if (/\bsize:\s*'/.test(body)) k.push('size');
    /* …and the entry's own `modifiers`, built by the `m(value, type, target, extra)` helper at
     * src/rules/modes.ts:207 — see MODE_MODIFIER_KINDS. This is the half that reaches cat-rotting-rage
     * and cat-wooden-rage, whose whole mechanic is one m(6,'untyped','damage'). */
    for (const mo of body.matchAll(/\bm\(\s*-?\d+\s*,\s*'[a-z-]+'\s*,\s*'([a-z-]+)'/g)) {
      const kk = MODE_MODIFIER_KINDS[mo[1]];
      if (kk) k.push(kk);
    }
    /* A gate may be `<id>` or `<id>:<answer>` — the record is the part before the colon. */
    for (const g of gates) addKinds(g.split(':')[0], k);
  }
}
{
  /* 2. Caster archetypes. `mk(tradition, keyAbility, cantrips, slug)` mints the three tier ids from
   * `slug`; explicit `basicId`/`expertId`/`masterId`, the `customUnlocks[].featId` schedule and the
   * `profExpertFeat`/`profMasterFeat` advancement name theirs outright. Read all four shapes. */
  let text = '';
  try { text = readFileSync(join(ROOT, 'src/rules/casterArchetypes.ts'), 'utf8'); } catch { text = ''; }
  const SLOT_KINDS = ['spellcasting', 'spellSlot'];
  for (const m of text.matchAll(/\bmk\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*\d+\s*,\s*'([a-z0-9-]+)'/g)) {
    for (const tier of ['basic', 'expert', 'master']) addKinds(`${tier}-${m[1]}-spellcasting`, SLOT_KINDS);
  }
  for (const m of text.matchAll(/\b(?:basicId|expertId|masterId|profExpertFeat|profMasterFeat):\s*'([a-z0-9-]+)'/g)) {
    addKinds(m[1], SLOT_KINDS);
  }
  /* A `customUnlocks` entry is MORE than a slot: `{ rank, level, featId }` says "once you hold this
   * feat, at this LEVEL you unlock a spell of this rank" — a level gate plus a pick. The Captivator's
   * three unlocks are exactly their three level-gated `select from:SPELL` ops, so crediting only
   * spellcasting/spellSlot left `choice` and `conditional` reading as missing on a feat that models
   * both. */
  for (const m of text.matchAll(/\bfeatId:\s*'([a-z0-9-]+)'/g)) {
    addKinds(m[1], [...SLOT_KINDS, 'choice', 'conditional']);
  }
}

/*
 * The three FeatGrant-shaped tables are also read ENTRY BY ENTRY, because a FeatGrant says what it
 * grants and a per-file kind list cannot. Flattening featGrantsLane.ts to `['skill','choice']` would
 * have claimed a skill for `ironclad-fortitude` (a save) and missed the save; widening the file to
 * every kind any entry uses would credit all 305 entries with all of them. Neither is a measurement.
 */
const FEATGRANT_KEY_KINDS = {
  skills: ['skill'], skillChoices: ['skill', 'choice'], conditionalSkills: ['skill'],
  crossConditionalSkills: ['skill'], loreChoices: ['skill', 'choice'], bonusSkillFeat: ['grantsRecord'],
  save: ['save'], perception: ['perception'], armor: ['ac'], armorCascade: ['ac', 'choice'],
  weapon: ['weapon'], weaponFamiliarity: ['weapon'], choiceGrants: ['choice'],
  redundantFallback: ['choice'], rankUpgrade: [], minLevel: [],
};
for (const path of ['src/rules/featGrantsAuto.ts', 'src/rules/featGrants.ts', 'src/rules/featGrantsLane.ts']) {
  let text = '';
  try { text = readFileSync(join(ROOT, path), 'utf8'); } catch { continue; }
  const entries = [...text.matchAll(/^\s{2}(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:\s*\{/gm)];
  for (const [i, m] of entries.entries()) {
    const body = text.slice(m.index, entries[i + 1]?.index ?? text.length);
    const kinds = new Set();
    for (const k of Object.keys(FEATGRANT_KEY_KINDS)) {
      if (new RegExp(`['"]?${k}['"]?\\s*:`).test(body)) for (const kk of FEATGRANT_KEY_KINDS[k]) kinds.add(kk);
    }
    if (kinds.size) addKinds(m[1] ?? m[2], kinds);
  }
}

/*
 * situationalBonuses.ts is read entry by entry, because the entry says what it targets. An entry runs
 * from its key to the next key at the same indent, and every `kind: '…'` inside it is one target.
 */
{
  let text = '';
  try { text = readFileSync(join(ROOT, 'src/rules/situationalBonuses.ts'), 'utf8'); } catch { /* absent */ }
  const entries = [...text.matchAll(/^\s{2}(?:['"]([a-z0-9][a-z0-9-]{2,})['"]|([a-z][a-zA-Z0-9]{2,}))\s*:\s*\[/gm)];
  for (const [i, m] of entries.entries()) {
    const body = text.slice(m.index, entries[i + 1]?.index ?? text.length);
    const kinds = new Set(['conditional']);
    for (const t of body.matchAll(/kind:\s*['"]([a-zA-Z]+)['"]/g)) {
      const mapped = SITUATIONAL_TARGET_KINDS[t[1]];
      if (mapped) kinds.add(mapped);
    }
    addKinds(m[1] ?? m[2], kinds);
  }
}

/*
 * CARRIERS THAT LIVE OFF THE RECORD AND OUTSIDE EVERY REGISTRY — NAMED ONE BY ONE, WITH THE READER.
 *
 * The scans above find a carrier by finding the record's id as a KEY in a registry, and the walks in
 * `ourKindsOf` find one by reading the record's own fields. A handful of class features are delivered
 * by neither: the pick is a field on BuildState with its own picker and its own grant site in
 * src/rules/build.ts, or the mechanic is a level ladder in another module keyed by CLASS rather than by
 * record. Nothing in those files carries the feature's id as a key, so the differ reported the whole
 * mechanic as missing on features that are built, offered in the builder and covered by tests.
 *
 * ⚠ An EXPLICIT MAP, not a blanket settle, and deliberately not a heuristic: each entry names the
 * file:symbol that delivers each kind, so a reader can check it, and a carrier that is later deleted
 * leaves an entry that scripts/wg-settle-stale.mjs can find. Only the kinds actually delivered are
 * listed — anything else on these records still reports.
 */
const OFF_RECORD_CARRIERS = {
  /* Third Apparition — *"you choose three apparitions to attune to"* plus *"The number of Focus Points
   * in your focus pool increases by 1 (maximum 3)."* The pick is the OWNING CLASS's extra-choice group
   * widening: core.json classes.animist.extraChoices[apparition].pickByLevel."7" = 3, resolved by
   * extraPickCount/extraPickLevel and pushed as an owned classChoice in src/rules/build.ts. The class
   * declares `featureId` on the level-1 selector, not on this feature, so the extraChoices walk in
   * ourKindsOf (which credits only a DECLARED carrier, by design) cannot reach it. */
  'third-apparition': ['choice'],
  /* Implement Adept — *"Choose one of your implements and gain the adept benefit for that implement."*
   * BuildState.implementAdept (src/rules/build.ts), picker src/builder/shared.tsx (`actions.patch({
   * implementAdept: v })`), outstanding-choice prompt in build.ts once two implements are held at level
   * 7, and the grant in build.ts `pushBenefit('adept', adept7, 7)` — which pushes the level-7
   * `adept-benefit-<implement>` classFeature as an owned feature. */
  'implement-adept': ['choice'],
  /* Path to Perfection — *"Choose your Fortitude, Reflex, or Will saving throw. Your proficiency rank
   * for the chosen saving throw increases to master."* BuildState.pathToPerfection (src/rules/build.ts),
   * picker src/builder/Builder.tsx keyed on the feature id with options fortitude/reflex/will and an
   * `allowed()` gate so a later tier cannot repeat a save; the master rank is applied in build.ts as
   * `proficiencies.saves[picks[0]] = maxRank(…, 'master')` — a PLAYER-CHOSEN rank, which is why it is
   * not in advancement.ts (the monk block carries no save row at all, so there is no double lane).
   * `specialStat` answers their `createValue MONK_SAVES_*` bookkeeping, which records which save was
   * taken so the 11th/15th tiers can exclude it — ours is the pathToPerfection array that `allowed()`
   * reads. The success-to-crit half is on the record (`degreeShifts.savesFromChoice`). */
  'path-to-perfection': ['choice', 'save', 'specialStat'],
  /* Studious Spells — *"You gain two special 2nd-rank studious spell slots… At 11th level, the extra
   * slots increase to 3rd-rank… At 13th level, 4th-rank."* The level ladder is
   * magusStudiousSpells(level) in src/rules/spellcasting.ts (`conditional`: rank 2 at 7-10, 3 at 11-12,
   * 4 at 13+), consumed in src/rules/build.ts, which appends the extra auto-prepared slots and their
   * spells onto `entry.prepared[studious.rank]` for a magus and again for a dual-class magus. Keyed by
   * CLASS, so nothing in either file carries this feature's id. ⚠ WHICH spells fill the slots, and the
   * spellbook clause, are live findings on the record (studious-spells#gecko-grip / #spellbook) — this
   * entry credits the slot/rank/ladder mechanic only, and the identity comparer still checks the spells. */
  'studious-spells': ['spell', 'conditional'],
  /* Armor Innovation — *"Choose one of the sets of statistics on Table 2-2: Innovation Armor Statistics
   * for your innovation armor"* (AoN innovation-1). Three kinds, three carriers, none of them on the
   * record — this is a HARD-CODED impl, the shape the dead-reader audit warns about, and the closer's
   * triage read it as unmodelled because the record has no `grantsItems`/`choice`.
   *   `choice`     — BuildState.inventorArmorStats, PopupSelect "Armor base statistics" at
   *                  src/builder/shared.tsx:3565-3579 (Power Suit / Subterfuge Suit), listed as an
   *                  outstanding required choice at src/rules/build.ts:1262 until answered.
   *   `grantsItem` — src/rules/build.ts:7688-7702 pushes items/power-suit or items/subterfuge-suit into
   *                  grantedItems as a WORN item sourced "Armor Innovation"; both are real armour
   *                  records (AC/dexCap/checkPenalty/speedPenalty), which is what their two `giveItem`
   *                  options hand over. Paired with the `items` entry in wg-identity's SETTLED_IDENTITIES.
   *   `conditional`— their four modification `select`s are gated on breakthrough/revolutionary
   *                  innovation and Basic Modification; ours is inventorModificationOptions
   *                  (build.ts:2755-2771), which filters by `f.level <= maxTierLevel` and by the
   *                  power-suit/subterfuge-suit tag against the answer above.
   * The experience half is separately parked in work/experience-instrument-limits.json
   * (armor-innovation, lane `control-off-record`). */
  'armor-innovation': ['choice', 'grantsItem', 'conditional'],
  /* School of Unified Magical Theory — *"instead of using Drain Bonded Item only once per day, you can
   * use it once per day for each rank of spell you can cast"* and *"you gain an additional 1st-level
   * wizard class feat, and you add one 1st-rank spell of your choice to your spellbook"* (AoN
   * arcane-school-21). Their row is one `conditional IF CLASS_FEATURE_NAMES INCLUDES arcane school THEN
   * select optionType=ABILITY_BLOCK + injectText` plus two feat-gated conditionals.
   *   `conditional` — the Drain Bonded Item retune is a SEPARATE RECORD on our side,
   *                   classFeatures/arcane-bond-school-of-unified-magical-theory (created this batch,
   *                   limitedUses.maxByLevel 1→10 by odd level), preferred over the generic
   *                   classFeatures/arcane-bond by the `retunedBy` variant reader at
   *                   src/rules/featUses.ts:56-63. A carrier on ANOTHER record plus a code reader:
   *                   nothing wg-diff can see from this one.
   *   `choice`      — the other two printed clauses, both live pickers: BuildState.umtFeatId (the bonus
   *                   L1 wizard class feat; option list src/builder/Builder.tsx:998-1005, the select
   *                   itself at Builder.tsx:2064-2079, injected at
   *                   src/rules/build.ts:5080-5084) and the +1 spellbook slot (Builder.tsx:407,
   *                   `wizardSpellbookBudget(level, isUmtBook)`).
   * Its `spell` kind (the two school spells) already agrees off the subclass option. */
  'school-of-unified-magical-theory': ['conditional', 'choice'],
  /* CLOSER, batch 033 — findings angel-eidolon#language and fey-eidolon#language.
   * *"Language Celestial"* (AoN eidolon-1) and *"Language Sylvan"* (AoN eidolon-8): a FIXED line, not a
   * pick, so there is nothing on the record and nothing in content.languages to key it to — neither
   * `celestial` nor `sylvan` is a key of the remaster-only content.languages bucket, which is why the
   * printed NAME is what ships. The carrier is `CompanionMod.languages` in
   * src/rules/companionGrants.ts, read in deriveEidolon's type-row loop (src/rules/companions.ts) onto
   * EidolonBlock.languages and rendered at src/sheet/CompanionsTab.tsx:950; the language PICKER one
   * screen down (:1287) is gated on `languageChoices`, so a fixed line correctly asks nothing.
   * ⚠ PER ID, and that is the whole point: this is NOT put on the companionGrants.ts file row, because
   * REGISTRY_KINDS credits a file's kinds to EVERY id in it (~112 ids) and would falsely credit the
   * eidolon types that still have no Language row at all. Five of them report `missing=[language]`
   * today — beast, demon, plant, psychopomp, undead — and test/batch033-closer.test.ts asserts all five
   * still do, so a later hand moving this credit onto the file row fails there rather than silently. */
  'angel-eidolon': ['language'],
  'fey-eidolon': ['language'],
  /*
   * CLOSER, batch 034 — findings beast-eidolon#language-sylvan and psychopomp-eidolon#language. Two of
   * the five the batch-033 note above listed as still bare are bare no longer: the engine family put
   * the printed Language line on the same carrier its angel/fey siblings use, so the same credit is
   * now earned rather than assumed.
   *   beast-eidolon      — AoN eidolon-3  *"**Language** Sylvan"*; COMPANION_MODS['beast-eidolon']
   *                        .languages = ['Sylvan'] (src/rules/companionGrants.ts:502), the printed NAME
   *                        because `sylvan` is not a key of the remaster-only content.languages bucket.
   *   psychopomp-eidolon — AoN eidolon-10 *"**Language** Requian"*; COMPANION_MODS['psychopomp-eidolon']
   *                        .languages = ['requian'] (:539), the ID this time — content.languages
   *                        ['requian'] exists.
   * Both are read by the same `for (const l of mod.languages ?? [])` loop in deriveEidolon
   * (src/rules/companions.ts:1047) onto EidolonBlock.languages, rendered at
   * src/sheet/CompanionsTab.tsx:950.
   * ⚠ STILL PER ID, for the reason the 033 note gives: demon, plant and undead eidolons have no
   * Language row at all and must keep reporting. test/batch033-closer.test.ts pins exactly that — its
   * five-id assertion is narrowed to those three here, so the day a hand moves this credit onto the
   * companionGrants.ts FILE row (which would credit all ~112 ids) that test fails rather than passing. */
  'beast-eidolon': ['language'],
  'psychopomp-eidolon': ['language'],
  /*
   * CLOSER, batch 035 — findings demon-eidolon#language-abyssal, plant-eidolon#language and
   * undead-eidolon#language. The last three the batch-033 note listed as bare are bare no longer: this
   * batch's engine families put each printed Language line on the same CompanionMod.languages carrier
   * the four settled siblings above use, so the credit is earned here too.
   *   demon-eidolon  — AoN eidolon-5  *"**Language** Abyssal"*; COMPANION_MODS['demon-eidolon']
   *                    .languages = ['Abyssal'] (src/rules/companionGrants.ts:525), the printed NAME
   *                    because `abyssal` is not a key of the remaster-only content.languages bucket.
   *   plant-eidolon  — AoN eidolon-9  *"**Language** Sylvan"*; .languages = ['Sylvan'] (:559), the
   *                    printed NAME for the same reason as its beast/fey siblings.
   *   undead-eidolon — AoN eidolon-11 and its remaster twin eidolon-26, both *"**Language** Necril"*;
   *                    .languages = ['necril'] (:582), the ID this time — content.languages['necril']
   *                    exists. The type had no COMPANION_MODS row at all before this batch.
   * All three are read by the same `for (const l of mod.languages ?? [])` loop in deriveEidolon
   * (src/rules/companions.ts) onto EidolonBlock.languages, rendered at src/sheet/CompanionsTab.tsx:950.
   * ⚠ STILL PER ID, for the reason the 033 note gives — REGISTRY_KINDS would credit a file row to every
   * id in companionGrants.ts. The control that proves it has not become blanket is now dragon-eidolon:
   * it carries `languages: ['draconic']` on the same table and has NO entry here, because it is not a
   * batch-035 record and a closer may not settle an id outside its own batch. It still reports
   * `language`, and test/batch035-closer.test.ts asserts exactly that beside the three credits above. */
  'demon-eidolon': ['language'],
  'plant-eidolon': ['language'],
  'undead-eidolon': ['language'],
  /* CLOSER, batch 033 — finding light-mortar-innovation#duplicate-modification-choice.
   * *"Choose one of the sets of statistics on the Innovation Siege Weapon Statistics table"* plus the
   * tiered modification picks (AoN innovation-9 / archetype-329). The record's own `choice` field was
   * DELETED this batch (overlay row `field:'choice', value:null` — it was a frozen duplicate), so the
   * three tiered pickers are off-record by construction: `inventorModificationOptions`
   * (src/rules/build.ts:2752-2770) builds them for the `light-mortar` type and filters by
   * `f.level <= maxTierLevel`, and the harness's own play of the record records them as `controlsBoth`
   * with 3 / 6 / 9 options at the three tiers (work/.experience-raw-033.json).
   * ⚠ `choice` ONLY. Their `conditional` is already answered off the record (ourKinds carries it on
   * every run, shipped and stunted), and settling it here would launder a kind we do answer. */
  'light-mortar-innovation': ['choice'],
  /*
   * CLOSER, batch 034 — WEAPON INNOVATION, the same shape one innovation type over, and the record
   * that gap-engine's construct-innovation row cites as the correct precedent ("armor-innovation,
   * weapon-innovation and light-mortar-innovation all carry no `choice`, and the tier pickers are now
   * the single carrier"). Its core.json record carries no field at all beyond identity, so ourKinds
   * was EMPTY and both their kinds read as missing.
   *
   * `node scripts/wg-show.mjs "Weapon Innovation"` is four `conditional`s, each wrapping one `select
   * optionType=ABILITY_BLOCK`: IF CLASS_NAMES INCLUDES inventor, IF CLASS_FEATURE_NAMES INCLUDES
   * breakthrough innovation, IF … revolutionary innovation, and IF FEAT_NAMES INCLUDES basic
   * modification. Four gates, four pickers — the gate and the picker are one mechanism, which is why
   * BOTH kinds are credited here and not just `choice`.
   *   `choice`      — `inventorModificationOptions(content, 'weapon', undefined, maxTierLevel)`
   *                   (src/rules/build.ts:2753-2771) selects the 26 core.json classFeatures tagged
   *                   `weapon-innovation-modification` (levels 1 / 7 / 15), and the builder draws one
   *                   PopupSelect per tier at src/builder/shared.tsx:3582-3600. The answer is stored on
   *                   `build.inventorModifications` and re-validated against the same options at
   *                   build.ts:8410-8421.
   *   `conditional` — the same lines ARE their four gates: `build.level < INVENTOR_TIER_LEVEL[t.key]`
   *                   closes the breakthrough (7th) and revolutionary (15th) tiers, and `viaDedication`
   *                   opens only the initial tier and only when `basic-modification` is among the
   *                   character's feat picks — their fourth conditional, one for one.
   * ⚠ Per id, like its two siblings above: armor-innovation is NOT listed here and still reports.
   * Mutation-proof test: test/batch034-closer.test.ts. */
  // batch 034 premise: innovation-3 "Choose one initial weapon modification to apply to your innovation, either from the following or from other initial weapon modifications to which you have access."
  'weapon-innovation': ['conditional', 'choice'],
  /* BATCH 034 — finding elemental-blast#instrument.
   * Elemental Blast — *"The element determines the damage die, damage type, and range"* (AoN
   * action-2125), and the die COUNT is the kineticist's class table: 2 dice at 5th, 3 at 9th,
   * 4 at 13th, 5 at 17th. Their `createValue KINETICIST_BLAST_DICE = 1` (plus `adjValue … = 1` on
   * Improved Elemental Blast) is that tally, and this record carries no field for it, so `specialStat`
   * read as missing on a die count that ships.
   *   `specialStat` — src/rules/derive.ts `deriveBlastStrikes`: `dice = 1 + classDice + featDice`, with
   *                   `classDice = [5,9,13,17].filter((l) => c.level >= l).length` (zero when
   *                   `c.kineticist.archetype`, since an archetype blast never climbs) and `featDice`
   *                   summing `db.feats[…].blastDiceBonus` once per taking — the second half of their
   *                   pair, carried by feats/improved-elemental-blast (aonId feat-4337,
   *                   `blastDiceBonus: 1`). A level ladder keyed by CLASS plus a field on ANOTHER
   *                   record: nothing on this one for either walk to find.
   * ⚠ `specialStat` ONLY. Everything else this record asserts still reports; the experience harness
   * judges the same variable independently through `surface.blastDiceBonus`
   * (scripts/lib/wg-experience-lanes.mjs), so the die count is not settled in both instruments at once. */
  'elemental-blast': ['specialStat'],
};
for (const [id, kinds] of Object.entries(OFF_RECORD_CARRIERS)) addKinds(id, kinds);

/*
 * THE PER-CLASS ADVANCEMENT TABLE IS A CARRIER, AND IT IS KEYED BY THE FEATURE.
 *
 * A proficiency RANK may be raised in exactly one place on our side — the class ladder in
 * src/rules/advancement.ts — and every row names the feature it belongs to:
 * `{ level: 7, track: 'reflex', rank: 'master', source: 'natural-reflexes' }`, applied through
 * advancementRows -> applyAdvancement, which only ever raises. So a class feature whose whole printed
 * mechanic is *"your proficiency rank for Reflex saves increases to master"* carries NOTHING on its own
 * record, by design: reading the record alone reported `missing=[save]` on 25 features whose rank is
 * delivered, and the same reading for weapons on Alchemical Weapon Expertise (`WEAPON_GROUP_BOMB`) and
 * for perception on the four Perception Mastery/Legend/Expertise features.
 *
 * Read from the source text, exactly as modes.ts, casterArchetypes.ts and build.ts's FOCUS_CASTING are
 * read below — these scripts are plain .mjs and cannot import the TypeScript engine. A parenthetical
 * qualifier in `source` ('second-doctrine (cloistered)', 'weapon-legend (general)') names the doctrine
 * or the clause rather than a record, so it is stripped.
 *
 * ⚠ This credits the KIND, never the rank. Whether the table reaches the printed rank is a VALUES
 * question, and wg-values.mjs reads the same table for exactly that comparison — so a feature whose
 * ladder stops at expert against a printed master still reports there.
 */
const ADVANCEMENT_TRACK_KINDS = {
  fortitude: 'save', reflex: 'save', will: 'save',
  perception: 'perception',
  unarmed: 'weapon', simple: 'weapon', martial: 'weapon', advanced: 'weapon', bomb: 'weapon',
  unarmored: 'ac', light: 'ac', medium: 'ac', heavy: 'ac',
  classDc: 'classDc', spellcasting: 'spellcasting',
};
{
  let text = '';
  try { text = readFileSync(join(ROOT, arg('--advancement', 'src/rules/advancement.ts')), 'utf8'); } catch { /* absent */ }
  for (const m of text.matchAll(/\{\s*level:\s*\d+,\s*track:\s*'([a-zA-Z]+)',\s*rank:\s*'[a-z]+',\s*source:\s*'([^']+)'\s*\}/g)) {
    const kind = ADVANCEMENT_TRACK_KINDS[m[1]];
    if (kind) addKinds(m[2].replace(/\s*\([^)]*\)\s*$/, ''), [kind]);
  }
  /*
   * …AND THE WHOLE TABLE A SUBCLASS OPTION *OWNS*, not only the rows that name it in `source`.
   *
   * advancement.ts is keyed `<classId>` AND `<subclassId>`, and a subclass key is a COMPLETE table that
   * REPLACES the class default — the file's own note at :688-697 names "warpriest, battle-creed". Those
   * rows carry the printed CLAUSE in `source` ('initial-creed', 'lesser-creed', 'major-creed',
   * 'true-creed'), never the subclass id, so the `source` scan above credited the doctrine with nothing
   * and classFeatures/battle-creed reported missing=[ac,save,weapon,conditional,choice,classDc,
   * spellcasting] — seven kinds against advancement.ts:78, a complete cleric chassis that ships.
   * `conditional` is credited with them because every row carries its own `level`: their side writes
   * the same ladder as `IF LEVEL >= 5 / 11 / 13 / 15 / 19 THEN adjValue …`, and the level column IS
   * that gate.
   *
   * ⚠ ONLY a key that is a subclass OPTION id — the exact bound wg-values.mjs:141-150 puts on the same
   * teach. A class-keyed table ('cleric', 'druid') is credited to nobody: its rows belong to the
   * features that name them in `source`, and crediting a whole class table to the class record would
   * excuse every rank it does not raise.
   */
  const optionIds = new Set();
  for (const cls of Object.values(core.classes ?? {})) {
    for (const o of cls.subclass?.options ?? []) if (o?.id) optionIds.add(o.id);
    for (const ec of cls.extraChoices ?? []) for (const o of ec.options ?? []) if (o?.id) optionIds.add(o.id);
  }
  for (const m of text.matchAll(/\n {2}'?([a-z][a-z0-9-]*)'?:\s*\[([\s\S]*?)\n {2}\],/g)) {
    if (!optionIds.has(m[1])) continue;
    const kinds = new Set();
    for (const r of m[2].matchAll(/\{\s*level:\s*(\d+),\s*track:\s*'([a-zA-Z]+)',\s*rank:\s*'[a-z]+'/g)) {
      const kind = ADVANCEMENT_TRACK_KINDS[r[2]];
      if (!kind) continue;           // an unmapped track credits nothing at all, `conditional` included
      kinds.add(kind);
      if (Number(r[1]) > 1) kinds.add('conditional');
    }
    if (kinds.size) addKinds(m[1], kinds);
  }
}

/*
 * The FOCUS-ONLY casting classes, read from the table that actually decides them: `FOCUS_CASTING` in
 * src/rules/build.ts (champion devotion, monk qi, ranger warden). These classes have no `spellcasting`
 * block on the ClassDef — their focus entry's tradition and key attribute come from this table — so a
 * reader that looks only at the record sees no casting where a built character has one. Read from the
 * source text, the same way modes.ts and casterArchetypes.ts are.
 */
const FOCUS_CASTING_CLASSES = new Set();
{
  let text = '';
  try { text = readFileSync(join(ROOT, 'src/rules/build.ts'), 'utf8'); } catch { /* absent */ }
  const m = /const FOCUS_CASTING[^=]*=\s*\{([\s\S]*?)\n\s*\};/.exec(text);
  for (const e of (m?.[1] ?? '').matchAll(/^\s*'?([a-z][a-z0-9-]*)'?\s*:\s*\{/gm)) FOCUS_CASTING_CLASSES.add(e[1]);
}

/*
 * THE BARBARIAN INSTINCTS' ADDITIONAL RAGE DAMAGE, read from the table that delivers it.
 *
 * Every instinct prints the same Specialization ladder — AoN instinct-16 (Ligneous): *"When you use
 * wooden rage, increase the additional damage from Rage from 6 to 10. If you have greater weapon
 * specialization, instead increase the damage from Rage when using wooden rage from 10 to 18."*
 * (instinct-15, Decay, prints the identical two sentences for rotting rage.) Their side writes it as
 * `setValue RAGE_DAMAGE`
 * = 6 / 10 / 18, mapped to `weapon` in kindOfTheirOp above.
 *
 * Ours is `RAGE_DAMAGE` in src/rules/derive.ts:3651, keyed by the INSTINCT (subclass) id and carrying
 * all three tiers, resolved by rageStrikeRider and pushed onto every melee/unarmed Strike's
 * conditionalDamage. Nothing about it is on `classFeatures/<instinct>`, so all ten instincts read as
 * modelling no weapon damage at all. Read from the source text, exactly as FOCUS_CASTING above.
 *
 * ⚠ Deliberately NOT read off `src/rules/modes.ts` cat-rotting-rage / cat-wooden-rage, which carried a
 * second, FROZEN copy of the same +6: findings decay-instinct#rotting-rage-damage-scaling and
 * ligneous-instinct#wooden-rage-mode ruled that duplicate a display defect and cut it, so a reader
 * anchored there would have credited the kind only while the defect existed. The tiers table is the
 * single carrier. ⚠ THE KIND, NEVER THE NUMBER — no comparer compares rage damage as a value.
 */
{
  let text = '';
  try { text = readFileSync(join(ROOT, arg('--derive', 'src/rules/derive.ts')), 'utf8'); } catch { /* absent */ }
  const m = /const RAGE_DAMAGE[^=]*=\s*\{([\s\S]*?)\n\};/.exec(text);
  for (const e of (m?.[1] ?? '').matchAll(/^\s*'([a-z][a-z0-9-]*)'\s*:\s*\{\s*tiers:/gm)) addKinds(e[1], ['weapon']);
}

/* Recursive for ONE level: a subclass selector folds in its options kinds.  rather than a
 * const arrow so the recursive call below is hoisted. */
function ourKindsOf(rec, id, bucket) {
  const kinds = new Set();
  /*
   * A RUNE'S NUMBERS LIVE ON ITS RuneDef, NOT ON THE ITEM ROW.
   *
   * Every one of the 159 runes ships TWICE: a shop row in `items` (name, level, price — no
   * passiveEffects, by design) and the mechanical definition in the `runes` bucket, which is what
   * planRune() etches and what derive.ts reads. A comparer that stops at the item row therefore calls
   * every rune mechanically empty: Resilient (*"a +1 item bonus to saving throws"*, AoN equipment-2786)
   * is `runes['resilient'] = {kind:'resilient', value:1}`, turned into the item bonus deriveSave pools
   * by resilientSaveBonus() — and it read as `missing=[save] ours=[]`.
   *
   * DELIBERATELY A KIND MAP, NOT A BLANKET "it has a rune twin, believe it": only rune kinds whose
   * reader has been read end-to-end are listed, so armor-potency / weapon-potency / soaring keep
   * reporting until someone reads them. Adversarially confirmed by stunting: with `resilient` removed
   * from RUNE_KINDS the three Resilient rows go straight back to THEY-ONLY missing=[save].
   */
  if (bucket === 'items') for (const k of RUNE_KINDS[core.runes?.[id]?.kind] ?? []) kinds.add(k);
  /* An ANCESTRY's own `traits` are DELIVERED, not decoration: creatureTraitsOf (src/rules/derive.ts)
   * reads them onto the character, which is what their per-row `giveTrait` ops do. Ancestries only —
   * a feat's or heritage's `traits` are record tags and grant nothing by themselves. */
  if (bucket === 'ancestries' && Array.isArray(rec.traits) && rec.traits.length) kinds.add('trait');
  for (const k of Object.keys(rec)) {
    for (const kind of fieldToKinds.get(k) ?? []) kinds.add(kind);
    if (k === 'passiveEffects' && rec.passiveEffects && typeof rec.passiveEffects === 'object') {
      for (const sub of Object.keys(rec.passiveEffects)) {
        for (const kind of fieldToKinds.get(`passiveEffects.${sub}`) ?? []) kinds.add(kind);
      }
    }
    /* …and `resonant`, the same shape one level down: an aeon stone's second spell, cast only while
     * the stone is slotted in a wayfinder. A reader that stops at top-level keys calls 15 stones
     * spell-less when the grant is right there. */
    if (k === 'resonant' && rec.resonant && typeof rec.resonant === 'object') {
      for (const sub of Object.keys(rec.resonant)) {
        for (const kind of fieldToKinds.get(`resonant.${sub}`) ?? []) kinds.add(kind);
      }
      /*
       * …and `resonant` IS a choice. Their side encodes "is this stone slotted in a wayfinder?" as a
       * `select` with two branches, because that is the only shape their format has for it. Ours is a
       * per-item designation the player toggles on the stone itself — a better fit for a state that
       * changes in play rather than at build time, and the same carrier an inventor's innovation uses.
       * Same question asked, same two answers; only the control differs.
       */
      kinds.add('choice');
    }
  }
  /* A TRAIT-GATED IWR ENTRY IS A CONDITIONAL. Their side wraps the Channel Protection Amulet's
   * resistance in a conditional on undead-ness; ours is `whenCreatureTrait` / `unlessCreatureTrait`
   * nested ON THE ENTRY, where a map keyed by field NAME cannot reach it — so the record read as
   * holding a plain unconditional resistance and its whole conditional half went unreported. */
  for (const e of [
    ...(rec.resistances ?? []),
    ...(rec.weaknesses ?? []),
    ...(rec.passiveEffects?.resistances ?? []),
    ...(rec.passiveEffects?.weaknesses ?? []),
    ...(rec.resonant?.resistances ?? []),
  ]) {
    if (e?.whenCreatureTrait || e?.unlessCreatureTrait) kinds.add('conditional');
  }
  /*
   * A MECHANIC NESTED INSIDE A CONTAINER IS STILL A MECHANIC.
   *
   * `passiveEffects` was walked and nothing else, so two containers hid their contents entirely:
   *   · `whileActive[]` — Acute Vision's darkvision-while-raging is `whileActive[0].senses`, and the
   *     record read as having no sense at all. Eight entries across the whole database, carrying
   *     resistances / senses / weaknesses / speeds.
   *   · `effectChoices[].options[].grant` — Proteankin's three daily resistances live there, and the
   *     record read as `choice` only, so `defense` came back missing on a feat whose entire point is
   *     a resistance.
   * Both are read through the SAME `fieldToKinds` map as a top-level field, so a field only has to be
   * classified once no matter which container it sits in.
   */
  /* An ENHANCEMENT tier holds its always-on effects under `grant`; Undead Hunter's once-per-day Infuse
   * Vitality lives there, and reading only top-level fields reported the spell as missing. */
  for (const sub of Object.keys(rec.enhancement?.grant ?? {})) for (const kind of fieldToKinds.get(sub) ?? []) kinds.add(kind);
  for (const w of Array.isArray(rec.whileActive) ? rec.whileActive : []) {
    for (const sub of Object.keys(w ?? {})) for (const kind of fieldToKinds.get(sub) ?? []) kinds.add(kind);
  }
  /* A `choiceValue` on a granted strike means "this attack exists only if you picked that option" —
   * a condition on the record's own answer, and the exact shape their side writes as a `conditional`
   * wrapping the option's `giveItem` (Modular Dynamo gates nine configurations on whether the dynamo
   * is automatic or manual). Counted as `weapon` and never as `conditional`, so every record that
   * gates a strike on a pick reported `conditional` missing. Measured: 15 records, 95 strikes. */
  /* …and the HP an attribute package carries. `alternateAttributes.hp` is the *"You gain 10 Hit Points
   * from your ancestry instead of 6"* half of Mightyfall Kobold, read at the top of `resolvedAncestryHp`
   * (src/rules/build.ts:685-703) — a real HP carrier, and the only reason the kind read as missing is
   * that it sits one level down. WHETHER the 10 is unconditional (print) or gated behind the package
   * (ours today) is a VALUES question, adjudicated on the record, not a kinds one: the kind map asks
   * only "does this record model HP at all", and it does. Nested rather than in the `hp` field list
   * because backgrounds/song-of-the-deep carries the same package with no `hp` in it. */
  if (rec.alternateAttributes?.hp != null) kinds.add('hp');
  if ((rec.grantedStrikes ?? []).some((s) => s?.choiceValue)) kinds.add('conditional');
  for (const ch of Array.isArray(rec.effectChoices) ? rec.effectChoices : []) {
    for (const o of ch?.options ?? []) {
      for (const sub of Object.keys(o?.grant ?? {})) for (const kind of fieldToKinds.get(sub) ?? []) kinds.add(kind);
      /* …and the kinds nested under an option's `grant.passive`. `fieldToKinds` holds only the DOTTED
       * forms (`passiveEffects.resistances`) and has no bare `passive` key, so every kind inside a branch's
       * passive block was invisible. Measured: 31 shipped records carry one and NONE has a top-level
       * `passiveEffects`, so all 31 under-reported — and moving a resistance into a branch (clay-sphere,
       * jolt-coil) made a record REGRESS from 'defense present' to missing. */
      for (const sub of Object.keys(o?.grant?.passive ?? {})) for (const kind of fieldToKinds.get(`passiveEffects.${sub}`) ?? []) kinds.add(kind);
      if (o?.note) kinds.add('note');
    }
  }
  /* …and a plain `choice`'s options, which carry `grant` in exactly the same shape. Sanctification is
   * the case: *"gain the champion's aura and SANCTIFICATION as described in the champion class"* ships
   * as `choice.options[].grant.grantsCreatureTraits: ['holy'|'unholy']`, and reading only top-level
   * fields reported `trait` missing on the two dedications that had just been given it. Same map, same
   * rule as the `effectChoices` block above — a container should not decide whether a grant counts. */
  for (const o of rec.choice?.options ?? []) {
    for (const sub of Object.keys(o?.grant ?? {})) for (const kind of fieldToKinds.get(sub) ?? []) kinds.add(kind);
    for (const sub of Object.keys(o?.grant?.passive ?? {})) for (const kind of fieldToKinds.get(`passiveEffects.${sub}`) ?? []) kinds.add(kind);
    if (o?.note) kinds.add('note');
  }
  /*
   * …AND ONE LEVEL DEEPER STILL: AN OPTION'S `grant.whileActive`.
   *
   * `fieldToKinds` maps the bare key `whileActive` to `conditional` and stops there, so an option whose
   * grant is state-gated contributed the gating and nothing gated. That is the whole of Raging
   * Resistance wherever the second damage type is a PICK — Giant Instinct prints *"You resist
   * bludgeoning damage and your choice of cold, electricity, or fire"* (AoN instinct-3) and ours is
   * `choice.options[].grant.whileActive[{state:'rage', minLevel:9, resistances:[…]}]`, delivered by
   * src/rules/build.ts:6312-6320 — so `defense` read as missing on four instincts that carry it
   * (giant, dragon, elemental, superstition). This is the SAME descent the top-level `rec.whileActive`
   * loop above already does; only the container was different, and a container must not decide whether
   * a grant counts. Adversarially confirmed by stunting the clause: `defense` comes straight back
   * (test/batch034-instruments-2.test.ts).
   */
  for (const ch of [{ options: rec.choice?.options ?? [] }, ...(Array.isArray(rec.effectChoices) ? rec.effectChoices : [])]) {
    for (const o of ch?.options ?? []) {
      for (const w of Array.isArray(o?.grant?.whileActive) ? o.grant.whileActive : []) {
        for (const sub of Object.keys(w ?? {})) for (const kind of fieldToKinds.get(sub) ?? []) kinds.add(kind);
      }
    }
  }
  /*
   * AN INLINE `situational` NAMES ITS TARGETS TOO.
   *
   * The registry copy in situationalBonuses.ts is read target-by-target (above), but a record can carry
   * the same structure as a FIELD — and that path only ever yielded `conditional`. Storm Born ships
   * `situational: [{ targets: [{kind:'perception'}, {kind:'spell'}], … }]`, the complete printed rule,
   * and still reported a missing `perception`. One structure, two homes, one reader.
   */
  /*
   * A `choice: { kind: 'skills' }` is a picker over EVERY skill — Assurance's *"choose a skill you're
   * trained in"* — so the record models a skill even though it names none. Their side enumerates all
   * seventeen options, and without this the picker read as offering nothing.
   */
  if (rec.choice?.kind === 'skills') { kinds.add('skill'); kinds.add('choice'); }
  /*
   * WHAT A `choice` DELIVERS IS A KIND TOO, not just the asking (batch 23). buildCharacter classifies
   * the answer by what it IS (backgroundChoiceKind): options that are all feat ids GRANT the picked
   * feat (Corpse Stitcher's risky-surgery/stitch-flesh — their side writes two giveAbilityBlocks), and
   * a Lore-training pick TRAINS a skill (Elementally Infused's plane Lores — their side writes
   * SKILL_LORE_* createValues). Before this, deleting a redundant `grantedFeatId` beside the choice
   * made the record read as modelling no grant at all. `trainedLoreFromChoice` is the declared form
   * for options the label test cannot see (Energy Scarred's "Acid").
   */
  const chOpts = Array.isArray(rec.choice?.options) ? rec.choice.options : [];
  if (chOpts.length && chOpts.every((o) => core.feats?.[o?.value])) kinds.add('grantsRecord');
  if (rec.trainedLoreFromChoice || (chOpts.length && chOpts.every((o) => /lore/i.test(o?.label ?? '')))) kinds.add('skill');
  for (const s of Array.isArray(rec.situational) ? rec.situational : []) {
    kinds.add('conditional');
    for (const t of s?.targets ?? []) {
      const mapped = SITUATIONAL_TARGET_KINDS[t?.kind];
      if (mapped) kinds.add(mapped);
    }
  }
  /*
   * A `degreeShifts` ENTRY NAMES THE TRACK IT SHIFTS.
   *
   * "If you roll a success on an Acrobatics check to Balance, you get a critical success instead" is a
   * SKILL mechanic, and their side writes it as `addBonusToValue SKILL_ACROBATICS`. Ours was filed under
   * `conditional` only, so Sure Feet, Sturdy Bindings and Fire Savvy — all three fully authored, with
   * the right track named in the entry — reported a missing skill or save.
   */
  for (const d of Array.isArray(rec.degreeShifts) ? rec.degreeShifts : []) {
    kinds.add('conditional');
    if (d?.saves?.length) kinds.add('save');
    if (d?.skills?.length) kinds.add('skill');
    if (d?.perception) kinds.add('perception');
    if (d?.ac) kinds.add('ac');
  }
  for (const kind of registryKindsById.get(id) ?? []) kinds.add(kind);
  /*
   * A MODE KEYED TO THIS RECORD. An effect that applies only in a state — *"For 10 minutes you receive
   * the listed resistance to persistent bleed and persistent poison damage"* — is authored as a toggle
   * rather than a field, because a field would grant it unconditionally. The record itself therefore
   * holds nothing, and reading only the record called Blood Booster's resistances missing on an item
   * that carries them with the right number AND the right duration. Modes reach a record two ways:
   * `feats` (a feat/feature gate) and `fromItemId` (a consumable's own mode).
   */
  for (const m of Object.values(core.modes ?? {})) {
    /* A gate may be the bare record id OR `<id>:<answer>`, when the record's own answer decides which
     * modes apply — the werecreature dedication has nine types and eighteen shapes, so one gate per
     * type. An exact `includes` saw none of them and read the whole subsystem as missing. */
    const gated = (m?.feats ?? []).some((f) => f === id || String(f).startsWith(`${id}:`));
    if (m?.fromItemId !== id && !gated) continue;
    kinds.add('conditional');
    if ((m.resistances ?? []).length || (m.weaknesses ?? []).length || (m.immunities ?? []).length) kinds.add('defense');
    if ((m.grantedStrikes ?? []).length) kinds.add('weapon');
    if ((m.senses ?? []).length) kinds.add('sense');
    /* A BATTLE FORM's speeds. `battleForm.speeds` REPLACES rather than adds, which is why it is not in
     * the ordinary speed lane — but it is still a speed the record grants, and reading only the plain
     * lane called every shape-changing form speedless. `size` likewise. */
    if (Object.keys(m.battleForm?.speeds ?? m.speeds ?? {}).length) kinds.add('speed');
    if (m.battleForm?.size) kinds.add('size');
    if ((m.battleForm?.senses ?? []).length) kinds.add('sense');
    if (m.battleForm?.ac != null) kinds.add('ac');
    /* …and the mode's `modifiers`, the bucket that holds every plain number a mode applies — see
     * MODE_MODIFIER_KINDS. Read by nobody here, so an oracle curse whose whole Cursebound escalation is
     * a modifier list reported the record as modelling nothing but the conditional itself. */
    for (const mod of m.modifiers ?? []) {
      const kk = MODE_MODIFIER_KINDS[mod?.target];
      if (kk) kinds.add(kk);
    }
  }
  /* …and a STANCE of the same id, which is a separate collection from `modes`. A battle form's granted
   * attacks live there (Ursine Avenger Form's jaws and claws), and their side ships them as two items. */
  const stance = core.stances?.[id];
  if (stance) {
    kinds.add('conditional');
    if ((stance.strikes ?? []).length) kinds.add('weapon');
    if ((stance.resistances ?? []).length || (stance.immunities ?? []).length) kinds.add('defense');
  }
  /*
   * A CLASS RECORD'S OWN QUESTIONS ARE FIELDS, NOT A `choice` BLOCK.
   *
   * Print, on six class rows: *"Key Attribute: Strength or Dexterity — At 1st level, your class gives
   * you an attribute boost to your choice of Strength or Dexterity"* (fighter/monk/ranger/champion/
   * magus/exemplar), and on two more *"Trained in your choice of Arcana, Nature, Occultism, or
   * Religion"* (runesmith, thaumaturge). Their side writes each as a `select` — kind `choice` — while
   * ours holds the same question as the SHAPE of a plain field: `keyAbility` is documented at
   * src/rules/types.ts:3527 as "One entry = fixed key attribute; multiple = player chooses one", and
   * `trainedSkills.choice` / a `SubclassOption.skillChoice` are the skill twin. All three are asked:
   * build.ts:1103-1111 pushes 'Key attribute' onto setupMissing while `opts.length > 1`, build.ts:1136
   * reports 'Class trained skill' while unanswered, and shared.tsx:2572/3127 and :3150 render the two
   * pickers. `keyAbility` was listed under OUR_KINDS.attribute alone, so eight class rows reported
   * `missing=[choice]` on a question their builder and ours both ask (batch 28).
   *
   * ⚠ LENGTH, NOT PRESENCE. A single-entry `keyAbility` (runesmith's ["int"]) is a FIXED attribute and
   * must keep reading as no choice, or the eleven classes that really do offer none would be excused.
   */
  if (bucket === 'classes') {
    if ((rec.keyAbility ?? []).length > 1) kinds.add('choice');
    if ((rec.trainedSkills?.choice ?? []).length) kinds.add('choice');
    for (const o of rec.subclass?.options ?? []) {
      if ((o?.skillChoice ?? []).length || (o?.keyAbilityOptions ?? []).length) kinds.add('choice');
    }
    /*
     * …and a FOCUS-ONLY casting chassis, which no class record carries a `spellcasting` block for.
     * Print (champion): *"Your devotion spells are divine spells. Your spellcasting attribute is
     * Charisma"* plus Initial Proficiencies → Spells *"Trained in spell attack modifier / Trained in
     * spell DC"*; their class row 109 says the same with `adjValue SPELL_ATTACK/SPELL_DC T`, and their
     * casting SOURCE sits on ability_block 31209 (`CHAMPION:::-:::DIVINE:::ATTRIBUTE_CHA`). Ours is the
     * class-keyed FOCUS_CASTING table in src/rules/build.ts (champion/monk/ranger) plus the class's
     * `spellcasting` advancement track, which build a real focus entry at trained → expert (9th) →
     * master (17th) — so the champion class row read as modelling no spellcasting at all.
     */
    if (FOCUS_CASTING_CLASSES.has(id)) kinds.add('spellcasting');
  }
  /*
   * A CLASS-CHASSIS FEATURE'S MECHANIC LIVES ON THE CLASS RECORD.
   *
   * A subclass selector, a spellcasting entry and a class's own focus spells are all stored on
   * `classes.<id>`, never on the class FEATURE that introduces them — so reading the feature alone
   * reported 33 of these as "they model a choice/spell slots/a focus spell and we model nothing", and
   * every one was already built. Same failure as reading a record without its registries.
   *
   * ⚠ Credited ONLY to the feature the class DECLARES as its carrier (`subclass.featureId`), never to
   * every feature the class has. Crediting broadly was measured and rejected: it would have cleared
   * `blessing-of-the-devoted` and `skillful-lessons` too, whose choices are their own and unmodelled —
   * and hiding a real gap is worse than printing a false one. Name-guessing was rejected for the same
   * reason: it identified 11 of 20 carriers, because the gunslinger's selector is "Gunslinger's Way"
   * while the subclass is "Way", and the wizard's "Arcane Thesis" is NOT its "Arcane School" selector.
   */
  const owner = classOfFeature.get(id);
  if (owner) {
    const cls = core.classes[owner];
    if (cls?.subclass?.featureId === id && (cls.subclass.options ?? []).length) {
      kinds.add('choice');
      /*
       * …and the kinds its OPTIONS carry. Their `select` FLATTENS every option's operations onto the
       * selector row, so their Mystery row asserts every mystery's curse at once while ours live on the
       * option records (`classFeatures/ancestors`, `…/ashes`). Comparing the selector against its own
       * fields alone reported the whole subclass as unmodelled.
       *
       * This attributes rather than excuses: where the options DO carry the mechanic (each arcane
       * school's `curriculum`) the selector passes; where they are empty stubs (every oracle mystery)
       * it still fails, which is correct — that work is real and simply belongs on the options.
       */
      for (const o of cls.subclass.options ?? []) {
        const opt = core.classFeatures[o.id];
        if (opt) for (const k of ourKindsOf(opt, o.id)) kinds.add(k);
        /* A subclass option's weapon/armour keystone lives on the OPTION itself — the reader is
         * `grantOptions` in build.ts, not `classFeatures`. The necromancer's Reaper is the case:
         * `grants.weapons` is real, applied and tested, and reading only the option's classFeature
         * record (which for the two Fatal Methods did not exist at all) said the subclass granted no
         * proficiency of any kind. */
        if ((o.grants?.weapons ?? []).length) kinds.add('weapon');
        if ((o.grants?.armor ?? []).length) kinds.add('defense');
        if ((o.grants?.skills ?? []).length) kinds.add('skill');
      }
    }
    /*
     * …and the same for an EXTRA CHOICE. A kineticist's six elements, a wizard's five theses, an
     * exemplar's twenty-one ikons and an animist's thirteen apparitions live on
     * `classes.<id>.extraChoices`, so the feature whose printed text says "choose one" held nothing
     * and read as offering no choice at all. Credited only where the class DECLARES the carrier —
     * same rule and same reason as `subclass.featureId` above; the six undeclared entries stay
     * uncredited, so an uncredited choice reads as a gap rather than being silently excused.
     */
    for (const ec of cls?.extraChoices ?? []) {
      if (ec.featureId !== id || !(ec.options ?? []).length) continue;
      kinds.add('choice');
      for (const o of ec.options ?? []) {
        const opt = core.classFeatures[o.id];
        if (opt) for (const k of ourKindsOf(opt, o.id)) kinds.add(k);
        if ((o.focusSpells ?? []).length) kinds.add('spell');
        /* …and the keystones carried on the OPTION itself rather than on a classFeature record — the
         * same three the subclass walk above reads. The exemplar's six root epithets each train a
         * skill this way, so the feature that prints "choose one" read as training nothing. */
        if ((o.grants?.weapons ?? []).length) kinds.add('weapon');
        if ((o.grants?.armor ?? []).length) kinds.add('defense');
        if ((o.grants?.skills ?? []).length) kinds.add('skill');
      }
    }
    /* Spell slots and the spellcasting proficiency come off the class's own progression. */
    if (cls?.spellcasting && /-spellcasting$/.test(id)) { kinds.add('spellSlot'); kinds.add('spellcasting'); }
    /* …and the class's focus spells, for the feature that introduces them (Composition Spells, Grave
     * Spells, Link Spells). Gated on the feature's name ending in "Spells" so an unrelated feature of a
     * focus-casting class is not credited. */
    if ((cls?.focusSpells ?? []).length && /-spells$/.test(id)) kinds.add('spell');
  }
  /*
   * …AND WHEN THE RECORD *IS* THE OPTION.
   *
   * The two walks above credit an option list to the feature the class DECLARES as its carrier. The
   * comparison, though, usually lands on the OPTION: batch 033 compared `classFeatures/flame-order`,
   * `…/the-resentment`, `…/way-of-the-sniper`, `…/devotion-phantom-eidolon` and twenty more, each a
   * prose stub (`{actionCost, otherTags}` and nothing else) whose whole mechanic lives on
   * `classes.<cls>.subclass.options[<same id>]` or `extraChoices[].options[<same id>]`. So every witch
   * patron read as modelling no skill, no spell and no spellcasting; every gunslinger way as granting
   * no deed; every arcane school as holding no school spell. Same failure, one level along, as the
   * declared-carrier crediting itself was written for.
   *
   * The fields are the option's OWN carriers and every one has a live reader: `grants.skills`/`.lores`
   * at build.ts:3600-3624, `focusSpells` at :4650, `advancedFocusSpell` at :3854, `grantedSpells` at
   * :4227, `featureIds` at derive.ts:3475, `tradition` at build.ts:4196, `grantedFeats` at :5090.
   * An option that carries NONE of them still credits nothing, so an unbuilt subclass keeps reporting.
   */
  for (const cls of Object.values(core.classes ?? {})) {
    const opts = [...(cls.subclass?.options ?? []), ...(cls.extraChoices ?? []).flatMap((ec) => ec.options ?? [])];
    for (const o of opts) {
      if (o?.id !== id) continue;
      if ((o.grants?.skills ?? []).length || (o.grants?.lores ?? []).length || (o.loreProgression ?? []).length) kinds.add('skill');
      if ((o.grants?.weapons ?? []).length) kinds.add('weapon');
      if ((o.grants?.armor ?? []).length) kinds.add('defense');
      if ((o.focusSpells ?? []).length || o.advancedFocusSpell || (o.grantedSpells ?? []).length) kinds.add('spell');
      if (o.grantedSpellChoice) { kinds.add('spell'); kinds.add('choice'); }
      if ((o.skillChoice ?? []).length) { kinds.add('choice'); kinds.add('skill'); }
      if (o.tradition) kinds.add('spellcasting');
      /*
       * …and the option that SETS THE CHARACTER'S KEY ATTRIBUTE. Print (AoN subconscious-mind-5,
       * Emotional Acceptance): *"Key Attribute Your key attribute is Charisma."* — the psychic's key
       * attribute is chosen with the subconscious mind, so `classes.psychic.keyAbility` is [] and the
       * answer lives on `extraChoices['subconscious-mind'].options[<id>].keyAbility` ('cha' / 'int').
       * One field, three of their operations, none of them on the class-feature record:
       *   `attribute`    — subclassKeyAbility() (build.ts:889-901, which walks cls.extraChoices) is
       *                    pushed as the level-1 key-attribute boost at build.ts:1327, their
       *                    `adjValue ATTRIBUTE_INT/CHA = 1`.
       *   `classDc`      — it becomes the character's keyAbility (build.ts:3378/3393) and deriveClassDc
       *                    reads it at derive.ts:669 (`c.classDcKeyAbility ?? c.keyAbility`), their
       *                    `setValue CLASS_DC = {value:'T', attribute:ATTRIBUTE_*}`.
       *   `spellcasting` — ONLY when the owning class has a casting block for the pick to key, which is
       *                    their `defineCastingSource PSYCHIC:::SPONTANEOUS-REPERTOIRE:::OCCULT:::
       *                    ATTRIBUTE_*` — the entry keyAbility at build.ts:4249. The rogue's four
       *                    rackets carry the same `keyAbility` field and no casting, and correctly
       *                    credit nothing here.
       * Eight options in core.json carry the field; an option without it still credits nothing.
       */
      if (o.keyAbility) {
        kinds.add('attribute');
        kinds.add('classDc');
        if (cls?.spellcasting) kinds.add('spellcasting');
      }
      if ((o.grantedFeats ?? []).length || (o.featureIds ?? []).length) kinds.add('grantsRecord');
    }
  }
  return kinds;
}

/* ---------------------------------------------------------------- match + bucket */
/*
 * THEIR ROWS, PER OUR BUCKET — `bucket -> Map(normalised name -> {kinds, ops, …})`.
 *
 * This was one flat map filtered to `type === 'feat'`, so a class feature, item, heritage, background,
 * ancestry or class was compared against nothing and appeared in no bucket of this report. Type-gated
 * through the shared `WG_PAIRING`, never by name alone: 266 normalised names exist in two of our buckets
 * and a name-only widening compared our WEAPON `clan-pistol` against their FEAT of that name.
 */
const theirByBucket = {};
for (const [bucket, rowMap] of Object.entries(wgRowsByBucket(sql))) {
  const m = new Map();
  for (const [key, r] of rowMap) {
  const name = r.name;
  const ops = parseOps(r.operations).flatMap((o) => flatten(o));
  const kinds = new Set(ops.flatMap((o) => { const k = kindOfTheirOp(o); return Array.isArray(k) ? k : k ? [k] : []; }));
  /*
   * WHAT EACH `conditional` ACTUALLY GATES. A conditional is a WRAPPER, not a mechanic, and treating
   * it as one made every "gain X, or Y if you already have it" record report a permanent gap: Sea
   * Legs' swim Speed is `IF SPEED_SWIM < 10 THEN set 10`, and we ship `speeds: {swim: 10}`, which
   * raises and never lowers — the same rule, expressed once instead of twice. Four batch-3 records
   * were this, and every future batch would meet more.
   *
   * So the branch contents are recorded per conditional, and the comparison below drops `conditional`
   * from `missing` only when EVERY conditional's contents are kinds we already model. A conditional
   * that gates something we lack still reports — which is the case worth reading.
   */
  const condGroups = parseOps(r.operations)
    .flatMap((o) => flatten(o))
    .filter((o) => o?.type === 'conditional')
    .map((o) => new Set(flatten(o).slice(1).flatMap((x) => { const k = kindOfTheirOp(x); return Array.isArray(k) ? k : k ? [k] : []; })));
  /*
   * KINDS ASSERTED ONLY BY A VALUE-LESS `addBonusToValue` — the prose note pinned to a stat row (see
   * the long note in `kindOfTheirOp`). Fishseeker Shoony's *"If you roll a success on an attempt to
   * Grab an Edge, you get a critical success instead"* is written twice, on SKILL_ACROBATICS and on
   * SAVE_REFLEX, neither carrying a `value`; ours delivers both printed clauses as `degreeShifts`,
   * which scores `conditional`, so `missing=[skill]` was the differ demanding a second home for a rule
   * we already state. Recorded per record as a SATISFACTION allowance, not as a rewritten kind:
   * `kinds` still carries `skill`, so Half-Truths' `skillSubstitutions` and Officer's Medical
   * Training's `skillAbilitySwap` keep answering it in their own lane.
   *
   * `proseOnly` — a kind is listed only when NO other op on the row asserts it, so a record that both
   * trains a skill and annotates it (Officer's Medical Training: `adjValue SKILL_MEDICINE value T`
   * beside the note) still has to model the training.
   */
  const isProseNote = (o) => o?.type === 'addBonusToValue' && (o.data?.value === undefined || o.data?.value === null || o.data?.value === '');
  const kindsOfOps = (list) => new Set(list.flatMap((o) => { const k = kindOfTheirOp(o); return Array.isArray(k) ? k : k ? [k] : []; }));
  const valuedKinds = kindsOfOps(ops.filter((o) => !isProseNote(o)));
  const proseOnlyKinds = new Set([...kindsOfOps(ops.filter(isProseNote))].filter((k) => !valuedKinds.has(k)));
    /* `wgRowsByBucket` already kept the richest row per name, so there is no contest to resolve here. */
    m.set(key, { name, kinds, ops, condGroups, proseOnlyKinds, opCount: ops.length });
  }
  theirByBucket[bucket] = m;
}

/**
 * KIND MISMATCHES THAT HAVE BEEN READ AND SETTLED.
 *
 * The differ compares KINDS, so a handful of rows survive every vocabulary fix and are still not
 * gaps — the mechanic is there, expressed somewhere the kind comparison structurally cannot see, or
 * their operations encode something the record does not print. Left unlisted they reappear in every
 * batch and get re-read from scratch; asserted as fixed they would hide a real regression. So they are
 * named here, per KIND, with the reason and the evidence, and anything NOT listed still reports.
 *
 * ⚠ Only for a mismatch verified by reading the printed text. Never a place to quiet a real gap.
 */
const VERIFIED_EQUIVALENT = {
  /* ---- BATCH 33 (resume) ------------------------------------------------------------------------
   *
   * THE DRUID ORDER IS THE SUBCLASS PICK, AND `MAIN_DRUID_ORDER` IS THEIR ENGINE WRITING IT DOWN.
   *
   * `node scripts/wg-show.mjs "Flame Order" --raw`: the row's ONLY unmatched operation is
   * `createValue MAIN_DRUID_ORDER = flame` (type=str), and their own three conditionals then read it
   * back — `IF MAIN_DRUID_ORDER EQUALS flame THEN adjValue SKILL_ACROBATICS T` and
   * `… THEN giveSpell FOCUS`. That is select-answer bookkeeping, the class already settled here for
   * `speaker-in-training` (FAITHSPEAKER / GREENSPEAKER) and `path-to-perfection` (MONK_SAVES_*): their
   * engine has no notion of "which subclass did you take", so a variable stands in for it.
   *
   * Ours IS the subclass pick: classes.druid.subclass.options['flame-order' | 'spore-order' |
   * 'stone-order'], whose grants.skills (acrobatics / intimidation / crafting), focusSpells and
   * grantedFeats all AGREE after the option-carrier teach — which is why these three dropped from five
   * missing kinds at baseline to this one. `build.subclassId` is the answer their variable records.
   *
   * ⚠ THE ANATHEMA IS NOT THIS. Each row states its order anathema as an `injectText type=class-feature`,
   * which maps to `note` and is compared separately; it is not carried by the createValue, so settling
   * `specialStat` cannot hide it. One entry per order rather than a rule, so a fourth order added later
   * still reports.
   */
  // batch 033: flame-order#instrument
  'flame-order': ['specialStat'],
  /* SAME THING, DIFFERENT FIELD. `createValue MAIN_DRUID_ORDER = spore` is their engine writing down
   * the answer to a select; ours is `build.subclassId === 'spore-order'`, and the grants their three
   * conditionals hang off it (SKILL_INTIMIDATION T, the order focus spell, the order feat) all AGREE on
   * this record. ⚠ This settle covers the KINDS lane and nothing else: spore-order is OWNER-QUEUED on
   * Rulings Desk #134/#139, and that question is about wg-identity's `grants theirs-not-ours=[leaforder]`
   * membership token — a different comparer, still reporting, and untouched by this entry. */
  // batch 033: spore-order
  'spore-order': ['specialStat'],
  /* SAME THING, DIFFERENT FIELD, identically: `createValue MAIN_DRUID_ORDER = stone` against
   * `build.subclassId === 'stone-order'`, whose grants.skills crafting, focusSpells and grantedFeats
   * agree on the record after the option-carrier teach. The order's anathema is an `injectText
   * type=class-feature` that maps to `note` and is compared on its own, so this entry cannot hide it. */
  // batch 033: stone-order#instrument
  'stone-order': ['specialStat'],

  /* ---- BATCH 34 — the other five orders this batch cut, same shape, one entry each ---------------
   *
   * The three above were batch 033's; batch 034 cut five more order records and every one reports the
   * SAME single unmatched operation. `node scripts/wg-show.mjs "Animal Order" --raw` (and Leaf, Storm,
   * Untamed, Wave in turn) shows `createValue MAIN_DRUID_ORDER = animal | leaf | storm | untamed |
   * wild` (type=str) and nothing else unaccounted for — their own conditionals then read it straight
   * back (`IF MAIN_DRUID_ORDER EQUALS animal THEN adjValue SKILL_ATHLETICS {"value":"T"}`,
   * `… THEN giveSpell FOCUS`). Print makes the pick a subclass, not a statistic: class-feature-668
   * says a druid ALIGNS WITH an order which grants a class feat, an order spell and a trained skill —
   * there is no number on the character called "my order".
   *
   * Ours IS that pick: classes.druid.subclass.options['animal-order' | 'leaf-order' | 'storm-order' |
   * 'untamed-order' | 'wave-order'], selected into `build.subclassId`, and every grant their variable
   * gates (the order skill, the order focus spell, the order feat) already AGREES on these records —
   * `missing` is `['specialStat']` alone on all five.
   *
   * ⚠ ONE ENTRY PER ORDER, deliberately, exactly as the 033 note above says: cultivation-order is NOT
   * listed and still reports, which is what keeps this from becoming a rule that swallows an order
   * whose grants were never checked. ⚠ AND the anathema is not this — each row states it as an
   * `injectText type=class-feature`, which maps to `note` and is compared separately, so a
   * `specialStat` settle cannot hide it. Mutation-proof test: test/batch034-closer.test.ts. */
  // batch 034 premise: class-feature-668 "Upon becoming a druid, you align yourself with a druidic order, which grants you a class feat, an order spell (see below), and an additional trained skill tied to your order."
  'animal-order': ['specialStat'],
  // batch 034 premise: class-feature-668 "Upon becoming a druid, you align yourself with a druidic order, which grants you a class feat, an order spell (see below), and an additional trained skill tied to your order."
  'leaf-order': ['specialStat'],
  // batch 034 premise: class-feature-668 "Upon becoming a druid, you align yourself with a druidic order, which grants you a class feat, an order spell (see below), and an additional trained skill tied to your order."
  'storm-order': ['specialStat'],
  // batch 034 premise: class-feature-668 "Upon becoming a druid, you align yourself with a druidic order, which grants you a class feat, an order spell (see below), and an additional trained skill tied to your order."
  'untamed-order': ['specialStat'],
  // batch 034 premise: class-feature-668 "Upon becoming a druid, you align yourself with a druidic order, which grants you a class feat, an order spell (see below), and an additional trained skill tied to your order."
  'wave-order': ['specialStat'],

  /* ---- BATCH 35 — the NINTH order, the one the 034 note deliberately held back ------------------
   *
   * The note above says cultivation-order "is NOT listed and still reports, which is what keeps this
   * from becoming a rule that swallows an order whose grants were never checked". Batch 035 checked
   * them, so the entry is now owed. `node scripts/wg-show.mjs "Cultivation Order" --raw` shows the
   * single unaccounted operation is `createValue MAIN_DRUID_ORDER = "cultivation"` (type=str), read
   * straight back by their own conditionals (`IF MAIN_DRUID_ORDER EQUALS cultivation THEN adjValue
   * SKILL_CRAFTING {"value":"T"}` / `… THEN giveSpell FOCUS`) — bookkeeping for the pick, not a
   * printed statistic. Print makes it a subclass, not a number on the character.
   *
   * Ours IS that pick: classes.druid.subclass.options['cultivation-order'] — grants.skills
   * ['crafting'], grantedFeats ['leshy-familiar'] (configured through companionGrants.ts:125),
   * focusSpells ['cornucopia'] — selected into `build.subclassId`, so every grant their variable
   * gates already AGREES and `missing` is `['specialStat']` alone.
   *
   * ⚠ SCOPE, adversarially confirmed rather than assumed. This entry is the KINDS lane and nothing
   * else. The order anathema is an `injectText type=class-feature` mapping to `note`, compared
   * separately, so cultivation-order#anathema-sidebar is untouched; and the leaf-order membership
   * (cultivation-order#leaf-membership) is a `giveAbilityBlock` judged by the EXPERIENCE comparer,
   * which this registry does not reach — the gate still reports it. Mutation-proof test:
   * test/batch035-instruments-1.test.ts.
   */
  // batch 035: cultivation-order#instrument
  'cultivation-order': ['specialStat'],

  /*
   * SCHOOL OF THASSILONIAN RUNE MAGIC — the two sides put the sin pick on DIFFERENT RECORDS.
   *
   * The KINDS half of the settle wg-identity.mjs's SETTLED_IDENTITIES already carries (and which this
   * batch's gate prints in its own KEPT OURS block): their row is one `select optionType=CUSTOM` with
   * seven `giveSpell FOCUS` branches — kind `spell` — on `classFeatures/school-of-thassilonian-rune-magic`.
   * Ours is on `classFeatures/runelord`, otherTags ['class-archetype','wizard-arcane-school'], the record
   * the wizard Arcane School picker actually offers, whose effectChoices['sin'] options grant the seven
   * initial school spells (read at src/rules/build.ts:4104-4127).
   *
   * Adversarially confirmed the same way the identity settle was: the thassilonian record carries no
   * otherTags, appears in none of the 18 wizard subclass option ids, and no record in core.json names it
   * — it is NEVER OWNED, so no reading of it could deliver those spells and the option-carrier teach
   * cannot reach it. Settled on `spell` only; its `choice` kind already agrees.
   */
  // batch 033: school-of-thassilonian-rune-magic#instrument
  'school-of-thassilonian-rune-magic': ['spell'],

  /*
   * OTHERWORLDLY PROTECTION — A DERIVED VALUE, WHICH THEIR VOCABULARY CAN ONLY ASK AS A QUESTION.
   *
   * Their row is two `select optionType=CUSTOM` blocks (void | vitality, and unholy | holy | none).
   * Print makes BOTH branches derived, not chosen — AoN innovation-1: *"You gain resistance equal to
   * 3 + half your level to void damage, or to vitality damage if you have void healing (such as if
   * you're a dhampir)"* and *"If you are sanctified … this resistance applies to unholy damage (if you
   * are sanctified holy) or holy damage (if you are sanctified unholy)"*. Neither sentence asks the
   * player anything: the answer is already on the character sheet.
   *
   * Ours reads it off the character, which is why the record carries no picker: `resistances` (applied
   * this batch by otherworldly-protection#void-healing-swap / #sanctified-resistance) holds the void
   * entry with the void-healing clause in `condition`, plus unholy `whenCreatureTrait: 'holy'` and holy
   * `whenCreatureTrait: 'unholy'` — the derived-value-not-a-pick class already adjudicated for
   * `battle-creed` in work/experience-instrument-limits.json. `defense` agrees on both sides, so what
   * their selects add over ours is the QUESTION, not the resistance.
   */
  // batch 033: otherworldly-protection#sanctified-resistance
  'otherworldly-protection': ['choice'],

  /*
   * BATTLE CREED — their `select ADJ_VALUE "Select Deity Weapon"` is a workaround, not a choice.
   *
   * The other six kinds this record used to miss are now credited from the advancement.ts table it owns
   * (see the subclass-option-table teach above). What is left is `choice`, twice: `select from:ADJ_VALUE`
   * inside `IF LEVEL >= 5` and again inside `IF LEVEL >= 13`.
   *
   * Print offers nothing to select — AoN doctrine-6, Lesser Creed: *"You gain expert proficiency with
   * your deity's favored weapon"*, Major Creed: *"master proficiency with your deity's favored weapon"*.
   * The weapon is DERIVED from the deity already chosen: build.ts:3784 `favoredWeaponRank` gives
   * battle-creed master@13 / expert@5 / trained, written as a per-weapon override over EVERY entry of
   * the deity's favoredWeapons — so even a multi-weapon deity owes the player no pick. Their select is
   * their own workaround for not resolving the deity's favored weapon.
   *
   * Adjudicated and parked with the same reading in work/experience-instrument-limits.json
   * (battle-creed, lane `derived-value-not-a-pick`, verified 2026-09-08), whose refuter is the
   * multi-weapon-deity case. Settled on `choice` only; every other kind on this record still reports.
   */
  // batch 033: battle-creed#control
  'battle-creed': ['choice'],

  /*
   * SPELLSHIFTER DEDICATION — their grant points at a record that does not exist on our side, and the
   * one sharing its NAME is a different feat entirely.
   *
   * Printed: *"You gain the SHIFT SPELL ACTION and the Share the Burden spellshift."* That action is in
   * no bucket of our corpus. Ours used to carry `grantsFeats: ['shift-spell']`, which resolves to
   * `feats/shift-spell` — a LEVEL-14 WIZARD feat that merely shares the name — so an archetype
   * character was handed a wizard feat eleven levels early and still had no Shift Spell action.
   *
   * The grant is removed and the clause is stated on the record instead. Adopting their encoding here
   * would mean re-pointing at the wrong record, which is the defect, not the fix. Revisit if the
   * Spellshifter action records are ever imported — the whole archetype is prose-only today, which is
   * why its three feats also needed their archetype and prerequisite gates authored by hand.
   */
  'spellshifter-dedication': ['grantsRecord'],

  /*
   * THE FOUR AWAKENED-ANIMAL HERITAGES (batch 25) — their `giveAbilityBlock` hands over "Awakened Animal
   * Attacks", a block that exists only to hold the "which animal attack?" select and the Strike table
   * of the Howl of the Wild sidebar (sidebar-2749: *"Your heritage gives you a special unarmed attack
   * instead of the fist"*). Ours ships the same content on the record itself — an `effectChoices`
   * picker plus one `grantedStrikes` row per option tagged `choiceValue`, read by collectGrantedNaturals
   * with the heritage's answer threaded through — so the KINDS reader credits `choice` and `weapon`
   * and sees no granted RECORD, because there is none to grant: a feature record for the block would
   * hand the character a feature they do not have. Adversarially confirmed on a built climbing animal
   * who chose Jaws and got Jaws (test/batch25-engine.test.ts). Paired with the same four ids in
   * wg-identity's SETTLED_IDENTITIES.
   */
  'climbing-animal': ['grantsRecord'],
  'flying-animal': ['grantsRecord'],
  'running-animal': ['grantsRecord'],
  'swimming-animal': ['grantsRecord'],

  /*
   * AEON STONE (VITAL AMPLIFICATION) (batch 29) — their `hp` kind is a VALUE-LESS ANNOTATION, not a
   * mechanic. Both halves of their select ("Is this granting the resonant power?" No / Yes) carry
   * `addBonusToValue MAX_HEALTH_BONUS` with a `text` field holding the item's own prose and NO value
   * at all — the shape wg-values already refuses to compare as "a prose-only bonus asserts no value".
   *
   * Print (AoN equipment-3055): *"A vital amplification aeon stone improves the flow of vital energy
   * through your body, speeding the healing process… Whenever you regain Hit Points, you regain an
   * additional 1 Hit Point for each 10 Hit Points regained (minimum 1 additional Hit Point)."* That is
   * a percentage on HEALING RECEIVED, not a number on the maximum-HP track: the stone raises nobody's
   * Hit Point total by so much as 1. Adopting their carrier would hand the wearer a max-HP bonus the
   * book does not print, which is the defect and not the fix — so the kind is settled rather than
   * modelled, and if a healing-multiplier lane is ever built this record is its first customer.
   *
   * The `defense` leg is REAL and is answered separately by the record's `resonant.resistances`
   * (*"The resonant power grants you resistance 5 to void damage"*), so only `hp` is settled here.
   */
  'aeon-stone-vital-amplification': ['hp'],

  /*
   * DRAGONSCALED KOBOLD (batch 26) — their heritage hands over a "Draconic Exemplar" select (a
   * `specialStat` + `choice` on their side): WHICH dragon the scales come from, stored once and read
   * by their kobold feats. Print (AoN heritage-334) names no exemplar on the heritage — *"the shine
   * of your scales, a lean and reptilian build … You gain 10 Hit Points from your ancestry instead
   * of 6"* — and every feat that needs the dragon asks for what IT needs on its own record: Kobold
   * Breath's shape/damage/save picks, Benefactor's Resistance's breath-type pick, Dracomancer's two
   * "your draconic benefactor's dragon-spellcaster list" spell picks. Same information, asked where
   * the printed text asks it; a heritage-level exemplar select would be a second control print does
   * not state. Adversarially confirmed by the batch-26 refuter (the reading that this was a gap was
   * REFUTED on exactly this evidence). The `hp` leg is real and carried by `ancestryHp: 10`.
   */
  'dragonscaled-kobold': ['specialStat', 'choice'],

  /*
   * ---- BATCH 1 ----------------------------------------------------------------------------------
   *
   * Batch 1 is the only batch cut before the level ordering, so it is the only one holding classes,
   * backgrounds and a great many items — and most of what it reported were blind spots in the
   * COMPARERS, fixed there (a class states its saves and skills on itself; a background states its
   * trained skill and ability-boost choice on itself; an item states its Speed under `passiveEffects`).
   * 24 kinds gaps became 13 the moment the instruments could see those fields. These are the rest.
   *
   * POWER SUIT — `createValue INVENTOR_ARMOR = true` is a MARKER their engine tests elsewhere, the same
   * shape as MARTIAL_EXPERIENCE. Ours identifies an armour innovation by the record the inventor chose,
   * so there is no value to hold.
   */
  'power-suit': ['specialStat'],

  /*
   * ULTIMATE FLEXIBILITY — *"you gain three fighter feats instead of two."* The choice is a FEAT SLOT,
   * not a record `choice`: `levelGrants` reads the character's taken feats and adds a third
   * combat-flexibility slot when this one is among them. A `choice` on the record would be a second
   * place to answer the same question.
   */
  'ultimate-flexibility': ['choice'],

  /*
   * HAFT STRIKER STANCE — the standing "their unarmed attacks are ITEMS" translation. Their `giveItem`
   * is the haft as a weapon; ours is a `stances/haft-striker-stance` record carrying its `strikes`,
   * which is where every other stance keeps the attack it grants.
   */
  'haft-striker-stance': ['grantsItem'],

  /* MONK EXPERTISE — settle DELETED in batch 29, along with twelve more of its shape: the per-class
   * table in src/rules/advancement.ts is now READ (see ADVANCEMENT_TRACK_KINDS above), so the carrier
   * answers these records and a settle that matches nothing would only silence the next real
   * difference on them. `wg-settle-stale.mjs` is what found them. */

  // batch 030: eclectic-skill#instrument — the 'untrained-improvisation' settle is DELETED. Their
  // UNTRAINED_IMPROVISATION variable now maps to 'skill' and our `untrainedProficiency` field is listed
  // under OUR_KINDS.skill, so the carrier answers the record and the conditional around it gates only
  // what we have. Under --raw the settle matches nothing, and a settle that answers nothing silences the
  // next difference on that record, unread.

  /*
   * SKILLED HERITAGE — *"You become trained in one skill of your choice. At 5th level, you become an
   * expert in the chosen skill."* Both clauses live in `build.heritageSkill`: a first-class build field
   * with its own control in the builder, and buildCharacter applies the 5th-level step beside it. The
   * record therefore carries no `choice` and no conditional for the comparer to see.
   *
   * ⚠ This was nearly "fixed" into a duplicate. A FEAT_GRANTS entry was authored for it on the strength
   * of a grep across `featGrants*.ts` alone — which is not where that lane lives — and it granted a
   * SECOND skill on top; only the reverse-build round-trip caught it. Grep the id across ALL of src/.
   */
  'skilled-human': ['choice', 'conditional'],

  /*
   * RESPITE OF LOAM AND LEAF — the cantrip pick is an `effectChoices`, and the `spellcasting` half is
   * Player Core p.298 applied to every innate entry rather than authored per record (the identical
   * settle to Labyrinthine Echoes). Their `conditional` is the level gate on the cantrip's heightening,
   * which a cantrip gets by being a cantrip.
   */
  'respite-of-loam-and-leaf': ['spellcasting', 'conditional'],

  /*
   * ONE WITH THE WILD — RETIRED (batch 27), and it is the record that showed the hand-settle was a
   * whole SHAPE. *"In natural terrain, you can Hide and Sneak even without cover or being
   * concealed."* Their row is `addBonusToValue SKILL_STEALTH` carrying TEXT AND NO VALUE — an
   * annotation on the skill — plus two `injectText` ops naming Hide and Sneak; ours is two
   * RECORD_MARKERS, one on each of those actions. Fishseeker Shoony arrived with the identical shape
   * on SKILL_ACROBATICS, so the value-less `addBonusToValue` is now classified as `conditional` in
   * kindOfTheirOp rather than settled per record, and this entry answered nothing once it was.
   * Deleted rather than left: a settle that matches nothing silences the NEXT difference on the
   * record, unread.
   */

  /*
   * ---- BATCH 15 ---------------------------------------------------------------------------------
   *
   * UNCANNY AWARENESS — a NAME COLLISION on their side, not a gap on ours.
   *
   * Their dump holds THREE rows called "Uncanny Awareness": one at level 5 (`giveAbilityBlock
   * type=sense`, which is exactly our record) and two at level 9 carrying `addBonusToValue PERCEPTION
   * +2 circumstance to initiative`, one of them with a tie-break and a once-daily reroll as well.
   * Pairing by name matched our level-5 record against a level-9 namesake and reported `perception`.
   *
   * The Archives carry exactly ONE Uncanny Awareness — feat-2524, level 5, motion sense — and nothing
   * of that name in any other category. The clauses on their level-9 rows ARE printed, but on Elven
   * Instincts (feat-981) and Ambush Awareness (feat-2810), which are their own records. So there is no
   * printed rule behind the difference, and the printed rules are the authority: their data is a
   * differ, never a source.
   */
  'uncanny-awareness': ['perception'],

  /* MAGICAL FORTITUDE / PRECOGNITIVE REFLEXES / UNBREAKABLE EXPERTISE — settles DELETED in batch 29;
   * the advancement table that carries all three is read now. `test/batch15-parity.test.ts` still
   * builds each owning class either side of the level and asserts the rank actually steps, which is the
   * check that mattered. */
  /* ARMOR POTENCY (+1) — the mechanic is in the RUNES bucket, which no comparer reads.
   * Printed (GM Core p.226): "Increase the armor's item bonus to AC by 1. The armor can be etched
   * with one property rune." Their item 6719 encodes only the first clause, as addBonusToValue
   * AC_BONUS=1 type=item. Ours carries BOTH: core.runes/armor-potency-1 {kind: potency, value: 1} is
   * the carrier — the items-bucket twin is the purchasable CHASSIS and is EXPECTED to be empty,
   * because lib/wg-parse.mjs WG_BUCKETS has no runes entry, so every one of the 159 runes is compared
   * against its chassis. Reader chain: attachments.ts planRune -> hostInv.runes.potency ->
   * derive.ts acItem (an ITEM bonus), the exact clause their op asserts. */
  'armor-potency-1': ['ac'],

  /*
   * FIGHTER WEAPON MASTERY — the choice is real, it just does not live on the record.
   *
   * Their side is a bare `select from:ADJ_VALUE "Weapon Mastery"`. Ours is `build.fighterWeaponGroup`,
   * a first-class field on the build with its own surface in the builder, applied in buildCharacter —
   * so the comparer, which looks for a `choice` on the record, sees none.
   *
   * ⚠ Settled only after fixing what reading it exposed. The application was a FLAT per-group rank, and
   * the sentence is not flat: *"master with the simple weapons, martial weapons, and unarmed attacks in
   * that group, and to EXPERT with the advanced weapons in that group."* An advanced weapon of the
   * chosen group rolled at master from 5th level — one rank above the book, permanently, and visible
   * only to a fighter who actually wielded one. Now carried by `weaponGroupRanks`, which has the
   * category axis; pinned in `test/batch15-parity.test.ts`.
   */
  'fighter-weapon-mastery': ['choice'],

  /*
   * ADDITIONAL IKON (batch 030) — SAME THING, DIFFERENT FIELD: the fourth ikon pick is real, and it
   * lives in two code paths rather than on the record.
   *
   * Printed (AoN feat-7167): *"You gain a fourth ikon, which can be of any type."* Their side asks it
   * as `select "Select an Ikon"` (FILTERED, ABILITY_BLOCK, trait Exemplar Ikon), so the kind is
   * `choice`. Ours raises the CAP on the exemplar's own ikon group instead of adding a second picker:
   * src/rules/counterMods.ts:48 holds `'additional-ikon': [{ counter: 'ikon-picks', op: 'add', value: 1 }]`
   * and src/rules/build.ts `extraPickCount` runs it through applyCounterMods, which is the single gate
   * the builder's ikon picker (src/builder/shared.tsx:3277) and both resolvers (build.ts:3040, 7854)
   * clamp through — so the player is offered a fourth ikon out of the same 21 options and the sheet
   * keeps it. Pinned on a built level-9 exemplar in test/batch030-engine.test.ts
   * ('additional-ikon gives the exemplar a fourth ikon'), and the experience harness records the live
   * control ("Ikons", 21 options) on the built character.
   *
   * The kind scan DOES read counterMods.ts, but REGISTRY_KINDS credits a registry FILE's kinds to every
   * id in it, and only two of that file's six entries move a pick count — crediting `choice` there
   * would hand it to Pack Rat's bulk multiplier as well. So the mismatch is the carrier's shape, not a
   * missing mechanic, and it is named here per the fighter-weapon-mastery precedent above.
   */
  // batch 030: additional-ikon
  'additional-ikon': ['choice'],

  /*
   * SEALED POPPET — *"You no longer have the weakness to fire from the flammable ability."* Their side
   * hands over an ability block (`grantsRecord`); ours is the direct field `removesWeaknesses: ['fire']`,
   * read in derive.ts where the weakness list is assembled. Removing a weakness is the whole content of
   * the record, so a record-shaped wrapper would add a name and nothing else.
   */
  'sealed-poppet': ['grantsRecord'],

  /*
   * ASCENDED DRAGONET HERITAGE — their `giveAbilityBlock` per option against our `secondHeritage`.
   *
   * The record now carries the choice and the grant it was missing entirely (see the backfill script);
   * what remains is only the carrier. Their side copies the heritage's effects into an ability block
   * hung on each option; ours names the HERITAGE, which is the thing the sentence points at — *"the
   * dragonet heritage you selected at first level"* — and so keeps the feats and benefits that key off
   * owning it, which is the half of the sentence a copied effect block cannot deliver. Same settle as
   * its two siblings `awakened-yaoguai-heritage` and `late-awakener`.
   */
  /* RESTORED — the removal reason (the second heritage's innate spells now reach the character) fixed
   * a DIVERGENCE; it was never a reason their giveAbilityBlock-per-option would stop reporting as a
   * kind. Their five copied dragonet effect blocks against our secondHeritage field: same mechanic,
   * and ours additionally preserves heritage IDENTITY, which a copied effect block cannot. */
  'ascended-dragonet-heritage': ['grantsRecord'],

  /*
   * LABYRINTHINE ECHOES / THE MOON WEAVER'S ART — the level gate and the innate proficiency.
   *
   * Both now carry the innate spell they print (the Moon Weaver's was missing entirely; see the
   * backfill). What is left is two vocabulary differences:
   *
   *   `conditional` — their level gate is an explicit IF LEVEL >= n wrapped around a second `giveSpell`.
   *   Ours is `heightenAt: [{ level: 7, rank: 2 }]` on the one grant, which says the same thing without
   *   a second copy of the spell to keep in step.
   *
   *   `spellcasting` — their `adjValue SPELL_DC = T` / `SPELL_ATTACK = T`. Ours is not authored per
   *   record at all: Player Core p.298 makes it a rule of innate spells ("you become trained in the
   *   spell attack modifier and spell DC statistics"), so buildCharacter applies it to every innate
   *   entry, including the 12th-level step to expert. Authoring it per record would be 300-odd copies
   *   of a rule, each able to fall out of step with it.
   */
  'labyrinthine-echoes': ['conditional', 'spellcasting'],
  /* RESTORED — the removal reason (the duplicate registry picker) fixed a CHOICE divergence; these
   * two kinds were collateral. spellcasting = their per-record adjValue SPELL_DC/SPELL_ATTACK = T;
   * conditional = their LEVEL>=12 step to E (their conditional here wraps the PROFICIENCY step, not a
   * second giveSpell as the labyrinthine-echoes paragraph above describes). Both are one general rule
   * on our side, applied to every innate entry rather than copied onto 300 records. */
  'the-moon-weavers-art': ['conditional', 'spellcasting'],
  /* SPEAKER IN TRAINING — specialStat = their createValue FAITHSPEAKER/GREENSPEAKER, a boolean marker
   * written inside the select's own option: the same bookkeeping the string-marker guard above
   * already settles (power-suit's INVENTOR_ARMOR, martial-experience, bone-magic), only boolean-typed
   * so the guard does not recognise it. conditional = their heritage gate around the pick; ours gates
   * the record itself. The pick's mechanics are featCantripGrants with per-option traditions. */
  'speaker-in-training': ['conditional', 'specialStat'],

  /*
   * MARTIAL EXPERIENCE — their `setValue MARTIAL_EXPERIENCE = true` is a MARKER, not a mechanic: a flag
   * their engine tests elsewhere, so it maps to no kind at all on their side either.
   *
   * Both printed sentences are now modelled, and neither was before — *"treat your level as your
   * proficiency bonus"* is `untrainedWeaponProficiency` (a FLOOR under the proficiency contribution of
   * a weapon you are untrained with, the weapon-side twin of the skill lane that already existed), and
   * *"at 11th level, you become trained in all weapons"* is a real rank on every weapon category.
   * Pinned in test/batch15-parity.test.ts, which measures a wizard's greatsword either side of both.
   */
  'martial-experience': ['unmapped'],

  /*
   * IMPROVED ELEMENTAL BLAST — their `adjValue KINETICIST_BLAST_DICE = 1` names a variable this
   * comparer has no kind for, exactly like MARTIAL_EXPERIENCE above, and the mechanic it names is now
   * modelled: AoN feat-4337 prints *"The damage of your elemental blast increases by one die"*, and
   * batch 032 authored `feats/improved-elemental-blast.blastDiceBonus = 1` with its reader in
   * deriveBlastStrikes (src/rules/derive.ts), summed over `c.feats` so the feat's Special — a second
   * taking at 14th and a third at 18th — falls out of the one field. Pinned on a BUILT character by
   * test/batch032-engine.test.ts ("improved-elemental-blast: each taking adds one damage die…", a
   * level-14 archetype kineticist rolling 2dN with one taking and 3dN with two).
   *
   * ⚠ SETTLED PER RECORD, NOT BY REMAPPING THE VARIABLE. Mapping KINETICIST_BLAST_DICE to a kind
   * (`weapon` was the candidate) would have opened two FALSE gaps: their `gates-threshold` and
   * `elemental-blast` rows write the same variable for the +1-die-every-four-levels table, which is a
   * LEVEL table in derive.ts and no record field, so both would have started reporting a missing
   * `weapon` they cannot carry — measured on the dump: 8 of their rows write this variable across
   * three record names, and exactly one of them (this feat) has a per-record carrier on our side.
   */
  // batch 032: improved-elemental-blast
  'improved-elemental-blast': ['unmapped'],

  /*
   * GATE'S THRESHOLD — the branch lives in the BUILD, not on the record.
   *
   * *"At 5th level and every 4 levels thereafter, you choose to either expand the portal or fork the
   * path."* Their side is a `select from:CUSTOM` with the two branches nested under it. Ours is two
   * first-class BuildState fields — `gateForks` (the new element) and `gateExpands` (the bonus impulse
   * feat) — keyed by the threshold level, with the builder rendering both and buildCharacter applying
   * them, so a record-level `choice` would be a third place to store the same answer.
   *
   * The record's own `effectChoices` is the GATE JUNCTION, which is the other half of Expand the Portal
   * and is a different question; the comparer compares the two lists and reports the branch missing.
   *
   * ⚠ Settled only after fixing what reading it exposed. The fork was folded into `extraOptions` — the
   * list that carries an element's grants — but not into `classChoices`, the list the character
   * DISPLAYS. So a kineticist who forked into Air had Air Gate's Stealth, its impulses and its junction,
   * and no air element anywhere on their sheet. Two readers of one answer, and only one had been told.
   * Pinned in test/batch15-parity.test.ts, which asserts both halves.
   *
   * Their `adjValue KINETICIST_BLAST_DICE = 1` is settled separately in wg-values' NOT_A_SCALAR: we
   * read the same number off the level, at exactly the four Gate's Threshold levels.
   */
  /* RESTORED — the removal reason (Fork's impulse feat) fixed a divergence; the UNMAPPED kind was
   * collateral. Their Expand/Fork branch select is BuildState on our side (gateForks/gateExpands,
   * measured live by test/batch15-parity.test.ts, including the junction now gated on the Expand
   * branch via requiresNoGateFork), not a record field this comparer could read. */
  'gates-threshold': ['unmapped'],

  /*
   * BASIC KATA — their number contradicts the book, and sits on the wrong record.
   *
   * Their Basic Kata row carries `IF FEAT_NAMES INCLUDES "monk resiliency" THEN adjValue
   * MAX_HEALTH_BONUS 3`. Two disagreements in one operation:
   *
   *   · THE CARRIER. Monk Resiliency's Hit Points belong to Monk Resiliency. Theirs hang them off
   *     Basic Kata because their `select` cannot carry effects, so the pick has to be tested from the
   *     outside. Ours are on `monk-resiliency` itself, which is where any route to that feat finds
   *     them — Basic Kata is only one of them.
   *
   *   · THE NUMBER. Verbatim from the AoN mirror: *"You gain 3 additional Hit Points FOR EACH monk
   *     archetype class feat you have. As you continue selecting monk archetype class feats, you
   *     continue to gain additional Hit Points in this way."* Ours is `maxHpBonus.perArchetypeFeat: 3`,
   *     which is that sentence. Theirs is a flat 3 that never grows. Not adopted; recorded — same
   *     class as the `summiting-dragonblood` climb Speed in SETTLED_VALUES.
   *
   * `conditional` follows the same way: their conditional exists only to test the pick from outside
   * the select. Ours has no condition to model because the feat that grants the Hit Points is the
   * feat that carries them.
   */
  'basic-kata': ['conditional', 'hp'],

  /*
   * MODULAR DYNAMO — their configurations are ITEMS, ours are the strikes those items would be.
   *
   * The standing translation (see "THEIR UNARMED ATTACKS ARE ITEMS" at the top of this file) maps a
   * `giveItem` to `weapon` when the item carries their Unarmed trait, and 236 of their 339 do. The
   * dynamo attachments are the other kind: an item row without that trait, so the mapping calls them
   * `grantsItem` — but a dynamo configuration is not something the character carries, it is what the
   * dynamo attack IS. Ours are nine `grantedStrikes` entries in the same shape
   * `sterling-dynamo-dedication` already uses, each gated by `choiceValue` on the matching option.
   *
   * Their `conditional` is the automatic/manual split, which our option VALUES carry instead
   * (`modular:auto-…` / `modular:manual-…`) — the same gate, spelled into the answer rather than
   * wrapped around it.
   */
  'modular-dynamo': ['conditional', 'grantsItem'],

  /*
   * "You also become trained in Shoony Lore." Their row grants the Additional Lore FEAT instead, which
   * also carries its 3rd/7th/15th extra skill increases — more than this feat prints. The peers whose
   * text DOES say "you also gain the Additional Lore general feat" (catfolk-lore, tengu-lore,
   * dwarven-lore) are authored that way here; this one says only "become trained", and ships
   * `skills: {'lore:shoony': 'trained'}`. Ours matches its own printed text; theirs matches catfolk's.
   */
  /*
   * BATCH 14 — THE INNATE-SPELL PROFICIENCY RULE, re-encoded on every record that grants one.
   *
   * Four records here carry `spellcasting` + `conditional` that is not their own text at all. It is
   * the GENERAL rule, AoN rules-2232 (Player Core p. 298): *"When you gain an innate spell, you become
   * trained in the spell attack modifier and spell DC statistics. At 12th level, these proficiencies
   * increase to expert."* Their engine has no general rule, so every record that grants an innate
   * spell repeats it as a pair of level-banded adjValues; ours applies it once, in build.ts, to every
   * innate caster — which is why the records themselves say nothing.
   *
   * Checked against each feat's printed text: Fey Influence, Oni's Mask, Stem the Tide and Apprentice
   * Sea Witch all print the spell and its frequency and NOTHING about proficiency. Adopting theirs
   * would mean copying one rule onto hundreds of records and then keeping the copies in step.
   */
  'fey-influence': ['spellcasting', 'conditional'],
  'onis-mask': ['spellcasting', 'conditional'],
  'stem-the-tide': ['spellcasting', 'conditional'],
  'apprentice-sea-witch': ['conditional', 'spellcasting'],
  /* Same rule again, plus the heightening ladder — *"At 7th level, the spell is heightened to 2nd rank,
   * and every 2 levels thereafter"* — which ours carries as `heightenHalfLevel` on the grant rather
   * than as three level-banded copies of the grant. */
  'colugos-traversal': ['conditional', 'spellcasting'],

  /*
   * SCALES OF THE DRAGON — their grant is a SELF-REFERENCE.
   *
   * Their feat 22302 "grants" their physical-feature 29433 of the same name, and that block carries
   * zero operations. Reproducing it would put a second row on the sheet named exactly like the feat
   * already on the Feats tab, carrying nothing. (The feat's REAL second sentence — the resistance
   * upgrade — is a separate finding, tracked in the residual list, and neither side encodes it.)
   */
  'scales-of-the-dragon': ['grantsRecord'],

  /*
   * AWAKENED YAOGUAI HERITAGE — *"You gain all the mechanical benefits of the yaoguai heritage you
   * selected at first level."* The text POINTS AT the ancestry's heritage list rather than printing
   * one, so ours resolves it from the character's own heritage. Their five enumerated options are a
   * hand-copy of that list, and a hand-copy is the thing that drifts when the list grows.
   */
  'awakened-yaoguai-heritage': ['grantsRecord'],

  /*
   * SECOND IMPLEMENT — *"You choose a second implement, which must be a different type of implement
   * than your first. You gain the initiate benefit of your new implement."* Both halves are COMPUTED
   * on our side: the option list is the implements the character does not already hold, and the
   * initiate benefit comes from the implement record. Their `select` enumerates what we derive.
   */
  'second-implement': ['choice'],

  /*
   * TACTICAL EXCELLENCE — *"You add two new mobility or offensive tactics to your folio."* Their two
   * `select from:ABILITY_BLOCK` enumerate the tactics at the moment of the feat; ours widens the
   * FOLIO by 2 (counterMods `commander-folio`) and the player picks their tactics from the folio in
   * the one place tactics are chosen. Same two tactics, asked where every other tactic is asked.
   * The feat's other half — *"increase your maximum number of tactics prepared by 1"* — is now
   * `preparedTacticsBonus`, read at build.ts:6203; neither half reached a player before.
   */
  'tactical-excellence': ['choice'],

  /*
   * THE TASTE OF MAGIC — their carrier for a sense is a granted RECORD (`giveAbilityBlock type=sense`);
   * ours is the `senses` field, which is where every other scent feat in the database puts it. The
   * 30-foot imprecise scent itself was missing and is now authored — this settles only the carrier.
   */
  'the-taste-of-magic': ['grantsRecord'],

  /*
   * BATCH 13 — the three "Basic <X>" archetype feats, all the Basic Kata case again.
   *
   * Their row hangs a FLAT +3 Max HP off the Basic feat, gated on having also picked the archetype's
   * Resiliency feat. The Basic feats print no Hit Points at all — Basic Fury (feat-6192) is one
   * sentence, *"You gain a 1st- or 2nd-level barbarian feat"*, and Basic Devotion (feat-6197) and
   * Devout Magic (feat-6199) are the same shape. The HP sentence lives on the RESILIENCY feat:
   * *"You gain 3 additional Hit Points FOR EACH <class> archetype class feat you have."*
   *
   * Ours puts it there — `barbarian-resiliency` and `champion-resiliency` both carry
   * `maxHpBonus: {perArchetypeFeat: 3}`, read by featHpBonus at src/rules/derive.ts:755 — so the
   * number a character actually gets is right and it grows with the archetype as printed. Theirs is a
   * per-feat flat 3 distributed across the archetype's feats, which reaches the same total by a
   * different route and cannot grow; either way, nothing is missing here.
   * `conditional` follows for the same reason: their conditional exists only to test the pick from
   * outside their select. Ours has no condition to model, because the feat that grants the Hit Points
   * is the feat that carries them.
   */
  'basic-fury': ['conditional', 'hp'],
  'basic-devotion': ['conditional', 'hp'],
  'devout-magic': ['conditional', 'hp'],

  /*
   * BATCH 17'S TURN AT THE RESILIENCY ROW — six more records whose only `hp` op is a *-Resiliency
   * feat's Hit Points parked on an archetype feat, exactly the family settled directly above.
   *
   * Each of their rows carries `FEAT_NAMES INCLUDES "<class> resiliency"` (some also re-testing
   * MAX_HEALTH_CLASS_PER_LEVEL against that feat's own printed d8/d10 prerequisite — the FIRST
   * condition on advanced-defender's row) → flat +3 MAX_HEALTH_BONUS, else nothing. That is how their
   * model spells *"3 additional Hit Points FOR EACH <class> archetype class feat you have"* — a flat 3
   * distributed across every feat of the archetype. The printed feats grant no Hit Point at all:
   * advanced-devotion / advanced-glory / advanced-kata / advanced-defender are *"You gain one <class>
   * feat"* plus the half-level clause, and champions-reaction is *"You can gain and use the champion's
   * reaction associated with your cause."* We hold the Hit Points ONCE, on the feat that prints them —
   * `feats['<class>-resiliency'].maxHpBonus = { perArchetypeFeat: 3, archetype: '<class>' }`, read by
   * featHpBonus (src/rules/derive.ts:779) and folded into the initial-HP seed at build.ts:6949 — and
   * each of these carries `archetype: '<class>'`, so it is counted among the feats that bonus
   * multiplies, scaling as the book says where their flat 3 cannot. Owner ruling 2026-08-22 ("the book
   * wins"), guarded by scripts/resiliency-clause-check.mjs.
   *
   * guardians-intercept's `hp` half settles for the same reason (guardian-resiliency); its
   * grantsRecord gap (Intercept Attack) is a REAL mismatch fixed separately, so only the two
   * resiliency kinds are quieted here — never the whole record.
   */
  'advanced-devotion': ['conditional', 'hp'],
  'advanced-glory': ['conditional', 'hp'],
  'advanced-kata': ['conditional', 'hp'],
  'advanced-defender': ['conditional', 'hp'],
  'champions-reaction': ['conditional', 'hp'],
  'guardians-intercept': ['conditional', 'hp'],

  /*
   * BATCH 18 — the barbarian half of the batch-17 resiliency family (advanced-devotion/-glory/-kata/
   * -defender above). Their modern row 31308 is:
   *   select {modeType:'FILTERED', optionType:'ABILITY_BLOCK', title:'Select a Feat',
   *           optionsFilters:{abilityBlockType:'feat', traits:['Barbarian'], level:{max:10}}}
   *   conditional {conditions:[{name:'FEAT_NAMES', type:'list-str', operator:'INCLUDES',
   *                            value:'barbarian resiliency'}],
   *                trueOperations:[{type:'addBonusToValue',
   *                                 data:{variable:'MAX_HEALTH_BONUS', value:'+3', text:''}}],
   *                falseOperations:[]}
   * legacy 29495 is the same two ops reversed, value 3, level:{min:1,max:10}.
   * Printed Advanced Fury (feat-6193) grants no Hit Point; the clause prints on Barbarian Resiliency
   * (feat-6191). We hold it ONCE there — feats['barbarian-resiliency'].maxHpBonus =
   * {perArchetypeFeat:3, archetype:'barbarian'} — read by featHpBonus (derive.ts:824, fold at :836)
   * and seeded at build.ts:6985; advanced-fury carries archetype:'barbarian', so it is counted and
   * scales as the book says where their flat 3 cannot. Owner ruling 2026-08-22 ("the book wins"),
   * guarded by scripts/resiliency-clause-check.mjs. The select half already matches as `choice`
   * (featPickGrants.ts:254, maxLevel:'half' — their level.max:10 is a static half-of-20).
   */
  'advanced-fury': ['conditional', 'hp'],

  /*
   * KNIGHT RECLAIMANT DEDICATION — their 25835 is [adjValue SKILL_STEALTH {"value":"E"}, adjValue
   * SKILL_SURVIVAL {"value":"E"}, defineCastingSource CASTING_SOURCES
   * "KNIGHT_RECLAIMANT:::-:::DIVINE:::ATTRIBUTE_CHA", adjValue PRIMARY_SHEET_TABS "spells"]. The
   * slot-type segment is blank and the last op is their sheet's tab list: the row grants no spell,
   * no slot and no spellcasting proficiency. It is the hanger for the archetype's later focus
   * spells — the dump holds three KNIGHT_RECLAIMANT strings, this definition plus two consumers:
   * their Invoke the Crimson Oath (29003) = [adjValue SPELL_ATTACK {"value":"T"}, adjValue SPELL_DC
   * {"value":"T"}, giveSpell {spellId 6142, type FOCUS, castingSource KNIGHT_RECLAIMANT, rank 2}],
   * and For Love, For Lightning (28533), which casts from the same source.
   * Printed, feat-1097 prints expert Stealth and Survival and the undead-save upgrade and no Cast a
   * Spell; feat-1098 prints the profile — *"your knight reclaimant focus spells are divine spells;
   * when you gain this feat, you become trained in divine spell attacks and spell DCs. Your key
   * spellcasting ability for these spells is Charisma."* We hold it on the feats that print it:
   * feats['invoke-the-crimson-oath'].spellcastingGrant {divine, cha, trained} + focusSpells (the
   * same pair on shall-not-falter-shall-not-rout and for-love-for-lightning, expert on
   * crimson-oath-devotion), read by build.ts:5818 and the featFocusGrant chain, build.ts:3739-3783.
   * The skills are featGrantsAuto.ts:460 -> FEAT_GRANTS (featGrants.ts:630) -> build.ts:4604; the
   * save upgrade is the record's own degreeShifts, read by explain.ts:311/495. This settles the
   * SPELLCASTING kind only.
   */
  'knight-reclaimant-dedication': ['spellcasting'],

  /*
   * AEON STONE (DELAYING) — their one `hp` op has NO value and NO type:
   *   {"type":"addBonusToValue","data":{"variable":"MAX_HEALTH_BONUS","text":"When you would die from
   *   the dying condition (typically at dying 4), this smooth pink stone automatically activates and
   *   reduces your dying value to 1 less than would normally kill you (typically to dying 3). … only
   *   once per day, even if you have multiple such stones."}}
   * It appears once in EACH branch of their resonant select ("Is this granting the resonant power?",
   * the "Yes" branch adding giveSpell{spellId:4656, INNATE, rank 1, DIVINE, casts 1}).
   * Contrast a REAL one — champion resiliency's MAX_HEALTH_BONUS value 3. This is prose parked on the
   * HP variable; print grants no Hit Points. Ours states the clause in core-descriptions.json
   * items/aeon-stone-delaying.d (src/data/index.ts:553 -> ItemDetail.tsx:652) and makes "only once per
   * day" LIVE as frequency {max:1,per:'day'} -> itemUses.ts:32-40 -> ItemDetail.tsx:194/402.
   * `choice` and `spell` are already credited: ourKindsOf maps `resonant` to both the
   * wayfinder-slotted designation (choice) and resonant.innateSpells (spell, granted at build.ts:6501).
   */
  'aeon-stone-delaying': ['hp'],

  /*
   * AEON STONE (NOURISHING) — same shape as Delaying above: their addBonusToValue MAX_HEALTH_BONUS has
   * no value and no type (meta_data hp=hp_max=0), carrying only the printed no-eat/no-drink week
   * clause as text in both branches of the resonant select; the "Yes" branch adds
   * giveSpell{spellId:4392 = Air Bubble, INNATE, rank 1, PRIMAL, casts 1}.
   * Ours: items['aeon-stone-nourishing'].resonant = {note "cast Air Bubble as a primal innate spell
   * once per day", innateSpells:[{spellId:'air-bubble', tradition:'primal', rank:1, usesPerDay:1}]}
   * (effect-backfill), the select mapping to the wayfinder-slotted designation
   * (ItemDetail.tsx:490-506, InventoryTab.tsx:706), giveSpell to build.ts:6501-6505, and the text op
   * to core-descriptions.json .d (data/index.ts:551 -> ItemDetail.tsx:652). Prose parked on the HP
   * variable, not Hit Points.
   */
  'aeon-stone-nourishing': ['hp'],

  /*
   * BATCH 18 — THE ADVANCEMENT-TABLE FAMILY. Their side writes each class-feature proficiency bump as
   * bare adjValues on the record; ours live as rows in src/rules/advancement.ts keyed `source: '<id>'`
   * (advancementRows -> applyAdvancement -> derive).
   *
   * ⚠ SIX SETTLES DELETED HERE IN BATCH 29 — expert-spellcaster, expert-necromancy, expert-runes,
   * kinetic-expertise, reflex-expertise, reaction-time. That table is now READ (ADVANCEMENT_TRACK_KINDS
   * above), so the carrier answers them and the settles matched nothing; `wg-settle-stale.mjs` found
   * them. Only the record below survives, and only for the half the table does NOT carry:
   *  - expert-tactician: the `classDc` half is the commander table (expert@7) and is taught now; the
   *    `choice` kind is their two "Select a Tactic" ABILITY_BLOCK selects (traits Tactic, level max 7),
   *    which ours delivers as the folio lanes commanderFolioMax (5+2@7) and commanderMaxTier
   *    ('expert'@7) in build.ts — the same +2-tactics-at-expert-tier the selects encode. Warfare Lore
   *    master is the record's skillProgression overlay row (batch-18 fix).
   */
  'expert-tactician': ['classDc', 'choice'],

  /*
   * BATCH 18 — ADVANCED UNDEAD BENEFITS, unpacked. Their daywalker (feat 28681) and
   * grave-mummification (feat 28669) each run giveAbilityBlock physical-feature 28471 "Advanced
   * Undead Benefits", whose own ops are: giveAbilityBlock sense 20769 Darkvision; addBonusToValue
   * SAVE_FORT +2 circumstance "vs disease and poison"; adjValue RESISTANCES "poison, {{level/2}}";
   * +1 circumstance SAVE_FORT/REFLEX/WILL vs paralyzed/sleep. Ours delivers the SAME package on the
   * record itself (batch-18 fixes): senses [{name:'darkvision'}] + resistances
   * [{type:'poison', value:'max(1,floor(@actor.level/2))'}] overlay rows (read by the feat defence
   * lanes into derive), and the two save stars in FEAT_SITUATIONAL (the grave-mummification /
   * ghostly-grasp shape). grave-mummification additionally carries the bound-terrain resistance row.
   * The container record itself is not a thing a character owns — the benefits are.
   */
  'daywalker': ['grantsRecord'],
  'grave-mummification': ['grantsRecord'],

  /*
   * DEVOUT BLESSING — three kinds, three carriers, all confirmed live:
   *  - grantsRecord: their giveAbilityBlock class-feature 31244 "Blessing of the Devoted" is a select
   *    over the three Blessed Armament/Shield/Swiftness blocks; ours is the record's `choice`
   *    (flag divineAlly, ownsFeature:true — batch-18 fix) whose answer puts the chosen blessed-*
   *    classFeature into ownedFeatureIds (derive.ts choiceOwnedFeatureIds), where landSpeedBonus /
   *    shieldReinforcingByLevel / modeAdjust read it.
   *  - conditional + hp: their `conditional IF FEAT_NAMES INCLUDES "champion resiliency" THEN
   *    adjValue MAX_HEALTH_BONUS = 3` — the resiliency family; ours holds it once on
   *    feats['champion-resiliency'].maxHpBonus {perArchetypeFeat:3, archetype:'champion'} and
   *    devout-blessing carries archetype:'champion'. Owner ruling 2026-08-22.
   */
  'devout-blessing': ['grantsRecord', 'conditional', 'hp'],

  /*
   * MEDIUM'S AWARENESS — their three level-gated conditionals (IF LEVEL < 12 -> PERCEPTION +2
   * status "to Seek and for initiative"; 12-19 -> +3; 20 -> +4) are the LADDER inside our single
   * star: FEAT_SITUATIONAL['mediums-awareness'] targets perception with bonus
   * "+2 status (+3 at 12th, +4 at 20th)" (retargeted from initiative in the batch-18 fix — the
   * initiative popup still lists it by delegation, explain.ts builds Initiative from Perception).
   * The `unmapped` kind is their conditional wrapper, which carries no separate mechanic.
   */
  'mediums-awareness': ['unmapped'],

  /*
   * DOMAIN SPIRIT — their giveAbilityBlock -> ability_block 21087 "Domains" is a 37-option select
   * whose options' operations arrays are ALL EMPTY (reference text), plus a FILTERED spell select.
   * Ours: feats['domain-spirit'].focusPoolBonus 1 + effectChoices (16 domain options, each
   * grant.focusSpells [the domain's initial spell]) — the pick grants the actual spell where their
   * side grants prose. Same shape as the deitys-domain settle in SETTLED_IDENTITIES.
   */
  'domain-spirit': ['grantsRecord'],

  /*
   * DOMINION EPITHET — their current row 38691 is a 6-option PREDEFINED select whose options run
   * giveAbilityBlock feat grants (their stale 28637 row with Hefty Hauler / Underwater Marauder is
   * pre-errata and matches no print). Ours: classes/exemplar.extraChoices[id='dominion-epithet']
   * {pickByLevel {"7":1}} with grantedChoiceFeats mirroring their options' grants exactly
   * (born-of-the-bones-of-the-earth -> energized-spark earth/fire, dancer-in-the-seasons ->
   * cold/fire/void/wood, of-verse-unbroken -> sonic/vitality, restless-as-the-tide -> cold/water, …).
   */
  'dominion-epithet': ['choice', 'grantsRecord'],

  /*
   * SPIRIT STRIKING — their proficiency-gated ladder (conditional IF SIMPLE_WEAPONS EQUALS E/M/L ->
   * ATTACK_DAMAGE_BONUS 2/3/4 "spirit damage") is ours as a FIELD:
   * classFeatures['spirit-striking'].strikeDamage [{type:'spirit', appliesTo:'all',
   * byStrikeProficiency:{expert:2, master:3, legendary:4}}] (effect-backfill row), read by the
   * strike-damage lane per Strike proficiency.
   */
  'spirit-striking': ['conditional', 'weapon'],

  /*
   * STONEBOUND MAGIC — their block: giveSpell INNATE Scatter Scree unconditional, then THREE
   * `conditional IF LEVEL >= 8/10/12` each wrapping one giveSpell (One with Stone / Shape Stone /
   * Wall of Stone, casts 1), then `IF LEVEL >= 12 -> SPELL_ATTACK=E + SPELL_DC=E`. Ours:
   * feats['stonebound-magic'].innateSpells with minLevel 8/10/12 on the three leveled grants
   * (batch-18 fix; build.ts level-gates each grant), and build.ts already applies
   * maxRank(..., level >= 12 ? 'expert' : 'trained') to EVERY innate entry — the same T->E@12.
   */
  'stonebound-magic': ['conditional', 'spellcasting'],

  /* QUICK CLIMB — settle DELETED in batch 29. Its twin Quick Swim arrived with the same reading, and a
   * second copy is the lane asking to be built: a `bindValue` on a SPEED_* variable is now laned as a
   * Speed GRANT rather than a `modifiesGrant` (see kindOfTheirOp), which our `speedsIf` answers on both
   * feats — plus seven more records that were reporting the same false gap. */

  /*
   * AEON STONE (SMOOTHING) — their MAX_HEALTH_BONUS is a PROSE SLOT, not Hit Points.
   * Theirs (item 6684): select{title:"Is this granting the resonant power?",optionType:CUSTOM}
   *   "No"  -> addBonusToValue{variable:"MAX_HEALTH_BONUS", value:null, type:"", text:"You can ignore
   *            status penalties to skill checks from clumsy, enfeebled, frightened, sickened, and
   *            stupefied conditions as long as the value of that condition is 1."}
   *   "Yes" -> that same op + giveSpell{spellId:4649, type:"INNATE", rank:0, tradition:"OCCULT"}
   * value null, empty type, meta_data hp/hp_max 0: the variable carries text, not a number. GM Core
   * p.284 (equipment-3055-2978) prints no Hit Points for this stone. Their 4649 is Guidance, rank 0,
   * and carries no `casts` — at-will, where the Delaying stone's giveSpell carries casts:1.
   * Ours says both halves as fields: situational[{targets:[{kind:'skill',detail:'all'}], when:"you are
   * clumsy 1, enfeebled 1, frightened 1, sickened 1, or stupefied 1", bonus:"ignore that condition's
   * status penalty to skill checks (value 1 only)"}] and resonant{note, innateSpells:[{spellId:
   * 'guidance', tradition:'occult', rank:0}]} (effect-backfill).
   */
  'aeon-stone-smoothing': ['hp'],

  /*
   * BASE KINESIS — we hold TWO records under this id and the comparer is reading the wrong one.
   *
   * `feats/base-kinesis` is the Kineticist Dedication feat, *"You gain the Base Kinesis impulse"*, and
   * it now carries `grantsClassFeatures: ['base-kinesis']` (read by ownedFeatureIds, derive.ts:3088).
   * `classFeatures/base-kinesis` is the IMPULSE ITSELF — the thing granted — and it is what this
   * finding compares, against their archetype-feat row, because the classFeatures bucket pairs against
   * `class-feature` ∪ `feat` rows. A record cannot grant itself; the grant is on the feat, where the
   * printed sentence is.
   */
  'base-kinesis': ['grantsRecord'],

  /*
   * EXPANDED DOMAIN INITIATE — the `deitys-domain` case again (see SETTLED_IDENTITIES).
   *
   * Their `giveAbilityBlock` points at `feat/Domains`, a CONTAINER holding their domain list. Ours is
   * an `effectChoices` domain picker plus `focusPoolBonus: 1`, which is why our kinds already read
   * [spellcasting, focus, choice, spell]: the player picks the alternate domain and receives its
   * initial domain spell and the focus point. Only the carrier differs — a container on their side,
   * a resolved pick on ours.
   */
  'expanded-domain-initiate': ['grantsRecord'],

  /*
   * WORMSKIN — their carrier is an ITEM, ours is the resistance itself.
   *
   * The standing translation at the top of this file covers it: their `giveItem` hands you a skin
   * item, and ours is `effectChoices` whose three options each grant
   * `resistance max(1,floor(@actor.level/2))` of the chosen type — which is the printed clause,
   * *"resistance equal to half your level versus one of the following types"*. Our kinds already read
   * [defense], so the mechanic is present; only the vessel differs.
   */
  'wormskin': ['grantsItem'],

  /*
   * MANIPULATIVE CHARM — their `spellcasting` op is a proficiency step ours reaches another way.
   * Ours ships the innate charm plus its spell notes and the level-gated proficiency, which is why our
   * kinds read [spell, note, conditional, skill]; three independent refuters built a character and
   * watched the whole chain fire. Nothing of theirs is unmodelled.
   */
  'manipulative-charm': ['spellcasting'],

  /*
   * ⚠ SHOONY LORE IS NOT SETTLED — IT IS AN OPEN OWNER QUESTION. This entry carried no justification
   * at all, and was the ONLY one left bare once the settle audit's comment reader was fixed (it had
   * been clearing a shared block after the first entry beneath it, so 22 well-grounded settles were
   * also reporting empty). Reading this one showed the settle is not true.
   *
   * Their `giveAbilityBlock` hands over the ADDITIONAL LORE feat (their block #19873), not a bare Lore
   * training: *"Choose a Lore skill subcategory. You become trained in it. At 3rd, 7th, and 15th
   * levels, you gain an additional skill increase you can apply only to the chosen Lore subcategory."*
   * Shoony Lore's own text says only *"You also become trained in Shoony Lore."* Ours trains
   * Diplomacy, Survival and Shoony Lore — the three the text names — with `redundantFallback` for the
   * "you would already be trained" clause.
   *
   * Adopting theirs would give every shoony three skill increases the book does not grant, and would
   * let the Lore be any subcategory rather than Shoony. That is the owner's call, recorded in
   * work/owner-questions.json. The kind stays listed so the batch gate does not re-report a
   * difference already written down and awaiting a ruling — it is NOT a claim of equivalence, and it
   * comes out the moment he rules either way.
   */
  'shoony-lore': ['grantsRecord'],

  /*
   * Their carrier is a "Scaly Hide" ITEM (ac_bonus 1, dex_cap 3, plus a LEVEL>=5 conditional raising
   * AC_BONUS to 2); ours is the `unarmoredAc` field, the natural-armour lane derive.ts reads as an
   * item bonus, with the same numbers and the same bonus type. Only the CARRIER differs, which is what
   * this settles.
   *
   * (This comment used to end "the stacking exception is unbuilt". It is built: `unarmoredAc.cumulative`
   * pools the bonus apart from the competing item slot so it ADDS to a potency rune, exactly as the feat
   * prints — and `scales-of-steel` and `scales-of-the-dragon`, which print the same sentence, now carry
   * the flag too.)
   */
  'scaly-hide': ['grantsItem'],
  /*
   * "You gain a thorns unarmed attack that deals 1d6 piercing damage. Your thorns are in the knife
   * weapon group and have the finesse and unarmed traits." Their carrier is item 13068 "Hidden
   * Thorn"; ours is `grantedStrikes` with those exact dice, group and traits. Note that 13068 DOES
   * carry the Unarmed trait (2398), so the giveItem→weapon rule already maps it and the record lands
   * in AGREE — this entry currently suppresses nothing (unlike made-for-combat, whose three items
   * lack the trait).
   */
  'hidden-thorn': ['grantsItem'],
  /*
   * "For the next minute, you gain two unarmed attacks." A temporary attack cannot be a
   * `grantedStrikes` on the record, so it is a toggle: the two live on
   * `core.stances['howling-aspect']` and on the catalog mode `cat-howling-aspect` in
   * src/rules/modes.ts, both gated on this feat and asserted in test/batch8-parity.test.ts.
   * wg-diff's `ourKindsOf` already reads both carriers, so ours computes `weapon` on its own and
   * this entry no longer suppresses anything.
   */
  'howling-aspect': ['weapon'],
  /*
   * *"You gain a single arcane or occult cantrip … If you weren't already, you become trained in that
   * tradition's spell DCs and spell attack rolls."* The cantrip is a spell picker granting an at-will
   * innate; the proficiency half is ENGINE-WIDE (Player Core p.298 — gaining an innate spell trains
   * you in its DC and attack, expert at 12th), not a field on the record. Same reason as the innate
   * entry below. Their `conditional` is the tradition gate our picker's own filter applies.
   */
  /*
   * *"You gain Speak with Animals as a primal innate spell that you can cast once per day."* The innate
   * grant is authored; the spell DC and attack come from the engine, and a built samsaran really has
   * them — asserted in test/batch8-parity.test.ts at both trained and the 12th-level expert step.
   */
  'animal-soul-siblings': ['spellcasting'],
  /*
   * All three unarmed attacks ship as `grantedStrikes` with the printed dice, group and traits. Their
   * three items (16613 Blade / 16614 Spoke / 16615 Wrap) carry only the PRINTED traits and not the
   * Unarmed trait, so the giveItem→weapon rule above cannot recognise them. Measured: the trait is
   * present on 236 of their 339 giveItem targets, absent here — their data, not ours.
   */
  'made-for-combat': ['grantsItem'],
  /*
   * Their row encodes "When you roll a success against a fear effect, you get a critical success
   * instead" on all three saves — which IS printed under this name, but only in the LEGACY Order of
   * the Scourge (hellknight-order-7, Lost Omens Character Guide p. 83). Our record is the Hellfire
   * Dispatches reprint (hellknight-order-14), whose lesser order benefit was rewritten into the
   * 1-action Strike that reduces allies' frightened and prints no degree shift. Two printings of one
   * benefit, not a clause we dropped.
   */
  'fear-no-law-fear-no-one': ['save'],

  /* ---- batch 002's tail, read 2026-08-18 ---------------------------------------------------- */
  /*
   * Their `giveAbilityBlock` points at `feat/Domains` — a container record that exists to hold their
   * domain list, not a mechanic. Ours is `choice: {kind: 'domains'}` plus domains.ts resolving the
   * chosen domain's initial spell, and `focusPoolBonus: 1` for its pool point.
   */
  'deitys-domain': ['grantsRecord'],
  /*
   * Their Foxfire select offers two options — items 13814 (electricity) and 13815 (fire) — both
   * weapon-group but carrying only the Kitsune and Magical traits and no Unarmed trait, so their
   * giveItem→weapon rule cannot see them as attacks. Ours ships all THREE printed damage options as
   * `grantedStrikes`, including the cold one their feat never offers.
   */
  foxfire: ['grantsItem'],
  /*
   * Their `createValue DRAGONBLOOD_ASPECT = "claw"` is PLUMBING: a variable whose only reader is
   * feat/Deadly Aspect (measured — one reader in the whole dump). We solve the same problem without a
   * variable, because `deadly-aspect` ships `unarmedTraits: {match: ['claw','jaws','tail'], add:
   * ['deadly-d8']}` and Draconic Aspect grants only the one strike the player chose, so matching all
   * three hits exactly the one they have.
   */
  /*
   * The four facts their `defineCastingSource RANGER/PRIMAL/ATTRIBUTE_WIS` + `SPELL_ATTACK/DC = T`
   * state are produced by the engine, not written on the record, so no field can show them. Pinned by
   * test/initiate-warden-focus.test.ts: primal, wis, trained, and a pool of at least 1.
   */
  'initiate-warden': ['spellcasting'],
  /*
   * Already modelled, and more faithfully than theirs: the animist branch of the focus-pool block
   * (build.ts:3446-3457) takes the HIGHER of the 1/7/15 apparition ladder and the count of
   * focus-trait spells known, capped at 3 — the printed Special clause verbatim. Their encoding is a
   * single unconditional `adjValue FOCUS_POINT_BONUS = 1`. ⚠ The gate reads `build.featPicks`, so a
   * Liturgist animist — granted this feat by FEAT_FEAT_GRANTS['liturgist'] rather than picking it —
   * never reaches the clause.
   */
  'circle-of-spirits': ['focus'],

  /* ---- batch 004, read 2026-08-18 ------------------------------------------------------------ */
  /* Their "Awakened Animal Attacks" is a CONTAINER block listing the attacks; ours is the choice
   * itself plus the grantedStrikes behind it. */
  'tooth-and-claw': ['grantsRecord'],
  /*
   * Their "Mountain Stance" item packages the stance as gear (ARMOR/unarmored_defense, ac_bonus 4,
   * dex_cap 0), alongside a separate falling stone weapon item; ours is `grantedStrikes: Falling
   * Stone` on the feat plus `stances.mountain-stance` carrying acBonus +4 item, dexCap 0 and
   * speedPenalty 5. ⚠ Their item also writes the printed +2 circumstance bonus onto
   * SAVE_FORT/SAVE_REFLEX/SAVE_WILL; ours states it only in the stance's prose `note`, so that half
   * is displayed, not computed.
   */
  'mountain-stance': ['grantsItem'],
  /* A monk focus entry, produced by the engine rather than written on the record — the same shape as
   * initiate-warden, whose primal/Wis/trained entry is pinned by test/initiate-warden-focus.test.ts.
   * ⚠ The entry's TRADITION is no longer engine-decided: *"When you gain your first qi spell, you
   * decide whether your qi spells are divine or occult spells"* is a real player choice as of the
   * owner's 2026-08-19 ruling (`build.qiTradition`). Theirs hard-codes divine, ours hard-coded occult,
   * and the book chooses neither. Pinned by test/owner-rulings-qi-and-scale.test.ts. */
  'qi-spells': ['spellcasting'],
  /*
   * Printed: *"Choose one item of light Bulk to be your pusaka. It becomes a magic item that has the
   * occult trait."* Theirs hands over a new "Pusaka" item (item 16240, itself carrying no
   * operations); ours grants no item, because the text converts one the character already owns and
   * inventing one would put a phantom item in the bag. ⚠ Ours does not record WHICH item either —
   * the only trace is the inert note on the `pusakaLore` text choice telling the player to decide.
   */
  'inherit-the-dreaming-heirloom': ['grantsItem'],
  /* "domains" is their container record, as on deitys-domain; ours is a 4-pick domain choice. */
  'splinter-faith': ['grantsRecord'],
  /* Their scales are an ITEM; ours is `unarmoredAc`, the natural-armour field built in this batch and
   * applied as an AC item bonus while unarmored (test/natural-armour.test.ts). */
  'scales-of-steel': ['grantsItem'],
  /* Their yes/no select asks whether the automaton enhancement is active; ours is the enhancement
   * system, which gates the tier across every automaton feat rather than per record. */
  'undead-hunter': ['choice'],
  /* ---- batch 005, read 2026-08-18 ------------------------------------------------------------ */
  /* The innate spellcasting proficiency is engine-wide (Player Core p.298, "at 12th level these
   * proficiencies increase to expert"), applied in build.ts for every character — so no field on this
   * record can carry it. Same reading as pantheon-magic. */
  'awakened-magic': ['conditional', 'spellcasting'],

  /* ---- batch 006, read 2026-08-18 ------------------------------------------------------------ */
  /* Their `createValue WEAPON_LONGSWORD/BATTLE_AXE` is plumbing for their own picker; ours is the
   * record's `choice` plus a FEAT_GRANTS entry, and the Shield Block reaction is granted outright. */
  'viking-shieldbearer': ['specialStat'],
  /* Their Coerce clause is written onto SAVE_WILL, but nothing about it is a save — it changes the
   * OTHER creature's Intimidation check. Ours is a skill situational, which is what it is. */
  /* `UNBURDENED_IRON = true` is their own bespoke variable. Ours is `speedAdjust`, which states the
   * printed rule outright: ignore armour's Speed penalty, and reduce any other Speed penalty by 5. */
  'unburdened-iron': ['unmapped'],
  /* "domains" is their container record, as on deitys-domain and splinter-faith; ours is a domain
   * picker plus the focus pool point. */
  'domain-initiate': ['grantsRecord'],
  /*
   * `createValue BONE_MAGIC_TRADITION` is their own bespoke variable; the cantrip select beside it
   * hard-codes its tradition per option, and the only readers are Bone Investiture and Fossil Rider,
   * whose innate spell branches occult/primal on it — the feat's printed Special clause. Ours is the
   * record's `choice` (flag `boneMagicTradition`), read both by
   * FEAT_CANTRIP_GRANTS['bone-magic'].traditionFromChoiceFlag and by those same two downstream
   * feats.
   */
  'bone-magic': ['specialStat'],
  /* The innate spellcasting proficiency is engine-wide (Player Core p.298), so no field on the record
   * can carry it — the same reading as pantheon-magic and awakened-magic. */
  'awakened-jewel': ['spellcasting', 'conditional'],
  /* Their tail is an ITEM and their Enhancement a yes/no select; ours is a `grantedStrikes` entry and
   * the automaton enhancement system, which gates every automaton feat's tier in one place. */
  'powerful-tail': ['grantsItem', 'choice'],

  /*
   * Its text grants no casting at all: the printed feat (AoN feat-3486, Book of the Dead p.34) only
   * makes *animate dead* a signature spell for a spontaneous caster who already has it, and lets a
   * prepared caster spend 10 minutes swapping a prepared slot for it. Their row is the remaster
   * wording (*summon undead*) for the same two clauses, and their `defineCastingSource
   * REANIMATOR/ARCANE/INT` invents a casting source the feat never grants.
   */
  'reanimator-dedication': ['spellcasting'],
  /*
   * The settled `spellcasting` kind is carried by our `spellcastingGrant` (occult / Int / trained),
   * which answers their SPELL_ATTACK, SPELL_DC and defineCastingSource ops. The
   * Astronomy-or-Occultism choice and the two printed repertoire cantrips (detect magic, guidance,
   * know the way, read aura) ship as `effectChoices`, which grant them as at-will innate occult
   * spells rather than as a repertoire.
   */
  'oatia-skysage-dedication': ['spellcasting'],
  /* Their "Basic Undead Benefits" is a CONTAINER block. Ours expands it inline on the record —
   * `immunities`, `grantsCreatureTraits: ['undead','zombie']`, the -5 Speed and the jaws strike. */
  /* Their pre-modified fist ITEM vs our `unarmedTraits` rider stepping the die and adding parry, which is
   * what the feat prints ("changes to 1d6 INSTEAD OF 1d4"). */
  /*
   * SPIRIT WARRIOR DEDICATION — their pre-modified fist ITEM against our unarmed rider on the fist the
   * character already has. RE-SETTLED after a real divergence: ours used to strip nonlethal and stop,
   * leaving the fist at 1d4 with no parry. It now sets d6 and adds parry, so the two fists match and
   * only the vehicle differs. Granting a second fist item would give the character two.
   */
  'spirit-warrior-dedication': ['grantsItem'],
  /* `spellSlotBonus: { cantrips: 2 }` — exactly the printed "two additional cantrips". */
  'cantrip-expansion': ['spellSlot'],
  /*
   * Their only `hp` op sits inside a conditional gated on FEAT_NAMES including "barbarian
   * resiliency" and adds +3 MAX_HEALTH_BONUS — Barbarian Resiliency's Hit Points parked on the
   * dedication row, not the dedication's own. The printed Barbarian Dedication grants no HP, and we
   * carry those Hit Points on `barbarian-resiliency` itself as `maxHpBonus: { perArchetypeFeat: 3,
   * archetype: 'barbarian' }`.
   */
  'barbarian-dedication': ['hp'],
  /* The two skill feats are gated on the immanence being active, so they ship as a `situational` rather
   * than an unconditional grant — granting them outright would hand them over outside immanence. */
  /* The two extra tactics live in `counterMods.ts`, which the kind scan does not read for this shape. */
  'tactical-expansion': ['conditional', 'choice'],
  /*
   * Ours is feat-8812 (level 2, Hellfire Dispatches): the scaling mental resistance as
   * `@actor.archetypeFeats.hellknight + 1`, the order choice, Additional Lore, and Intimidation via
   * `conditionalSkills` in featGrantsAuto.ts. The row the name-keyed pairing picks is their LEVEL-6
   * Hellknight Dedication, whose conditional/ac ops are a Sentinel-style light/medium/heavy
   * armour-proficiency ladder from that feat's own printed text — a different feat sharing the name,
   * not a rule ours omits.
   */
  'hellknight-dedication': ['conditional', 'ac'],
  /*
   * The fly-Speed increase ships as `speedAdjust: { key: "fly", add: 5 }` and the Leap half as a
   * `situational`. Their row holds a single op — a conditional gated on `SPEED_FLY > 0` that adds 5
   * to SPEED_FLY — and encodes the Leap increase not at all.
   */
  'winged-warrior-dedication': ['speed'],
  /*
   * Their one `giveItem` is the "Pyrotechnic Versatile Vials" item; ours is `advancedAlchemy: {
   * items: 4 }` — the printed 4 are made during daily preparations, not handed over — plus the
   * Launch Fireworks action and the Fireworks Lore conditional in featGrantsAuto.ts. Their separate
   * "Quick Alchemy Benefits" block is a giveAbilityBlock container, not the item op settled here.
   */
  /*
   * FIREWORK TECHNICIAN DEDICATION — their pyrotechnic vial ITEM against our vial COUNTER. RE-SETTLED
   * after a real divergence: ours granted an Advanced Alchemy budget the feat never mentions and no
   * vials at all. Ours is now the versatile-vials counter in classResources.ts (maxBase 4, gated on
   * this feat). A daily consumable resource is a counter here and an item there.
   */
  'firework-technician-dedication': ['grantsItem'],

  /* ---- batches 002/003/005/006/008: CLASS CHASSIS, read 2026-08-19 ---------------------------
   *
   * Every entry below was read against the printed text and then traced to the code that implements
   * it. What they have in common is WHERE our implementation lives: a class resource, a toggle mode,
   * a derive-time rider, a build-time slot computation — none of which is a field on the record, and
   * none of which this comparer can see by reading `core.json`. The `subclass.featureId` and
   * `extraChoices[].featureId` crediting above covers the cases where the mechanic is DATA on the
   * class; these are the cases where it is CODE, and code has no id to match on.
   */

  /*
   * Their grants are not flat and not unconditional: a PREDEFINED select offers Single Gate / Dual
   * Gate, and the six impulse junctions appear only inside the Single Gate branch's element options
   * — Dual Gate grants elements alone, matching the printed paragraphs. Ours states the same rule
   * from `classes.kineticist.extraChoices[element]` (six *-gate options carrying the printed
   * junction) with `impulseJunctionIds()` in explain.ts gating on `gates.length === 1`, so only the
   * shape of the encoding differs and there is nothing to adopt.
   */
  'kinetic-gate': ['grantsRecord'],
  /*
   * The oracle's CURSEBOUND condition. Ours is a class resource carrying the level ladder —
   * classResources.ts `oracle`, `kind: 'counter'`, `meter: true`, `maxAtLevels:
   * [[1,2],[11,3],[17,4]]` — plus the four cursebound modes. Their row creates a bare `CURSEBOUND`
   * at 0 and grants Cursebound One and Two only, with no ladder to 3 and 4, so ours is the more
   * complete of the two.
   */
  mystery: ['specialStat'],
  /* *"While wearing medium or heavy armor, you gain resistance to physical damage equal to 1 + half
   * your level."* Ours: `modes['guardians-armor']`, from scripts/data/toggle-modes.json, with
   * `resistances: [{ type: 'physical', value: '1+floor(@actor.level/2)' }]`, `duration: "while wearing
   * medium or heavy armor"`, and the rest-in-armour clause in its note. A toggle mode rather than a
   * field on the feature, so no `defense` field exists to read. */
  'guardians-armor': ['defense'],
  /* *"Choose either shields of the spirit or a spell based on your deity's divine font … Your devotion
   * spells are divine spells. Your spellcasting attribute is Charisma."* Both halves are code:
   * `championDevotionSpell()` in build.ts resolves the choice from the deity, and the casting entry is
   * built from `champion: { tradition: 'divine', key: 'cha' }`. */
  'devotion-spells': ['spellcasting', 'choice'],
  /* *"It costs 1 Focus Point to cast a focus spell, and you start with a focus pool of 1 Focus Point."*
   * The animist's pool is computed by name in build.ts — `poolMax = 1 + (level>=7) + (level>=15)`, with
   * the Circle of Spirits branch — because it does NOT follow the general "one point per point-costing
   * focus spell" rule. A `focus` field on the record would be read by nothing. */
  'animist-apparition-spellcasting': ['focus'],
  /*
   * The animist pool is computed by name in build.ts (`poolMax = 1 + (level>=7) + (level>=15)`, then
   * the Circle of Spirits clause and `featPoolBonus`), because it does NOT follow the general
   * one-point-per-point-costing-spell rule. A `focus` field on the record would be read by nothing.
   */
  /*
   * RESTORED after a removal marker — the removal reason ("the Medium's Dual Invocation now raises
   * the focus pool from 9th") was about a DIVERGENCE that got fixed; it was never a reason their
   * FOCUS_POINT_BONUS op would stop reporting as a kind, and dropping the key made this the only
   * missing=[focus] row in the corpus. Their op sits on the Medium option inside `conditional IF
   * LEVEL >= 9 AND FEAT_NAMES NOT_INCLUDES "circle of spirits"` — their flat +1 approximation of
   * Dual Invocation, whose level gate and non-stacking guard mirror our build.ts branch. Ours
   * implements the printed "whichever is higher (maximum 3)" clause in buildCharacter's animist
   * focus-pool branch (the `subclassId === 'medium' && level >= 9` clause and the Math.min(poolMax,3)
   * cap), which is MORE faithful than their flat +1 — and a `focus` field on the core.json record
   * would be read by nothing, the same reasoning as 'animist-apparition-spellcasting' above.
   */
  'animistic-practice': ['focus'],
  /* *"You gain your choice of the Animal Empathy or Plant Empathy druid feat."* A two-way pick with its
   * own build field (`build.voiceOfNature`) and its own picker, granting the chosen feat at build.ts —
   * not an options array on the record. */
  'voice-of-nature': ['choice'],
  /* *"Healing Font: You gain 4 additional spell slots each day at your highest rank of cleric spell
   * slots … 5 at 5th level … 6 at 15th."* Ours is `entry.font = { type, slots, rank }` in build.ts with
   * `fontSlots = level>=15 ? 6 : level>=5 ? 5 : 4`, restricted to heal/harm and gated on the deity's
   * own font. All four kinds they flag are that one computation. */
  'divine-font': ['spellcasting', 'choice', 'grantsRecord', 'spellSlot'],
  /*
   * *"You begin play with a folio containing five tactics from the list"* and *"you prepare three
   * tactics from your folio"*. Ours is `build.commanderTactics` fed by `commanderTacticOptions` and
   * `commanderFolioMax` (5, +2 each at 7/15/19), with `commanderMaxTier(level)` gating which tier
   * may be learned and `preparedMax: 3` on the built entry — a prepared-list subsystem rather than
   * an options array, so there are no option labels to match.
   */
  tactics: ['choice'],
  /* Reaper's Edge *"you become an expert in martial weapons"* at 11th and the AC half at 13th are
   * level rows in advancement.ts, not fields on the record; the level-1 trained halves ARE data and are
   * credited by the subclass-option rule above. The `conditional` is their per-level branch on the
   * same two clauses. */
  'fatal-method': ['ac', 'conditional'],
  /* *"Each day, you can prepare an extra cantrip from your curriculum. You also gain an extra spell
   * slot at each spell rank …. You can prepare only spells from your school's curriculum in these
   * extra slots."* Deliberately NOT a plain +1: ours is a RESTRICTED slot per rank carrying the
   * curriculum's `allowed` list (build.ts), plus `cantripsKnown('wizard') = CANTRIPS_KNOWN + 1`. The
   * `conditional` is the School of Unified Magical Theory branch (`isUmt`), which is also code. */
  'arcane-school': ['conditional', 'spellSlot'],
  /* *"During your daily preparations, you can create a number of versatile vials up to 2 + your
   * Intelligence modifier"* — a daily-refreshed RESOURCE, not inventory. Ours: classResources.ts
   * `alchemist` → `{ id: 'versatile-vials', kind: 'counter', refresh: 'rest', maxBase: 2, maxAbility:
   * 'int' }`. Their four tiered vial items implement *"a vial you create is always the highest type you
   * could Craft"* by shipping one item per tier; that tiering is their implementation detail and the
   * printed text names no tiered items. */
  alchemy: ['conditional', 'grantsItem'],
  /* *"You deal 2 additional damage on melee Strikes."* Ours is `RAGE_DAMAGE` in derive.ts with the
   * per-instinct scaling their record lacks, applied by `rageStrikeRider()` and gated on the Rage
   * resource being active and the Strike being melee. Theirs is a flat `RAGE_DAMAGE = 2` variable. */
  rage: ['specialStat'],
  /* *"The damage die for your fist increases to 1d6 instead of 1d4. You don't take the normal –2
   * circumstance penalty when making a lethal attack…"* Ours is `fistDieUpgraded` in derive.ts, which
   * swaps the Fist profile's die to d6 and drops `nonlethal` — both printed halves. Theirs is a
   * synthetic unselectable "Powerful Fist" item standing in for the die swap. */
  'powerful-fist': ['weapon'],
  /* The inventor's armour innovation. Their "specialStat" is an engine-internal `INVENTOR_ARMOR`
   * boolean; ours is `build.inventorArmorStats`, which gates the modifications. The printed stat line
   * (Table 2-2: AC +2, Dex cap +4, check −1, Speed —, Str 0, Bulk 1, composite) is on
   * `items['subterfuge-suit']` and matches the book. */
  'subterfuge-suit': ['specialStat'],
  /*
   * MERCHANT'S SCALE — owner ruling, 2026-08-19: do not adopt their +1. Both mirror docs
   * (equipment-2734, equipment-34) are stat-block stubs (`text` ends at `Bulk L ---`, `skill_mod`
   * `{}`), and their seven `addBonusToValue` ops each carry the Recall-Knowledge condition in their
   * own text, but that sentence exists only in their GPL-3.0 dump, which is a differ and never a
   * source. work/wg-lane-backlog.md records the same no-copy rule while explicitly calling the empty
   * description a still-open gap needing the physical Player Core pg. 290 — so this settle closes
   * the +1, not the description.
   */
  'merchants-scale': ['skill'],
  /*
   * *"Choose one cantrip from the divine spell list. You can cast this cantrip as a divine innate
   * spell at will. A cantrip is heightened to a spell rank equal to half your level rounded up."*
   * Their row carries no casting-source op: the `conditional` is `LEVEL >= 12 →
   * SPELL_ATTACK/SPELL_DC expert, else trained`, and the `spellcasting` kind is those same adjValues
   * — a generic innate-caster ladder this feat does not print, which our engine already applies to
   * every innate entry in build.ts. Ours is `FEAT_CANTRIP_GRANTS['pantheon-magic']` (the whole
   * common divine cantrip list) plus the innate pipeline that heightens cantrips to half level by
   * rule.
   */
  'pantheon-magic': ['conditional', 'spellcasting'],
  /*
   * SEQUESTERED SPELL — same shape as Pantheon Magic. Their `conditional` is `LEVEL >= 12 →
   * SPELL_ATTACK/SPELL_DC expert, else trained`, and the `spellcasting` kind is those same adjValues
   * — the row carries no `defineCastingSource` — so it is one generic innate-caster ladder this feat
   * does not print, already applied engine-wide in build.ts. The one thing the feat does constrain,
   * the cantrip list, is narrowed by `effectChoices[].spellFilter.traditionFromChoiceFlag =
   * 'magiphageTradition'`, answered on the surki ancestry and read by `narrowSpellFilter`.
   */
  'sequestered-spell': ['conditional', 'spellcasting'],

  /* ---- batch 009: ARCHETYPE DEDICATIONS, read 2026-08-19 -------------------------------------- */
  /*
   * THE HP THAT IS NOT THEIRS TO GRANT. Both records' only `hp` operation is a `conditional` gated on
   * `FEAT_NAMES INCLUDES "<archetype> resiliency"` — it is the RESILIENCY feat's Hit Points parked on
   * the dedication by their engine, and neither printed dedication grants a single HP. We hold both
   * correctly on the feats that print them: `feats['monk-resiliency'].maxHpBonus` and
   * `feats['exemplar-resiliency'].maxHpBonus`, each `{ perArchetypeFeat: 3, archetype: … }`.
   * Exemplar's `conditional` is that same operation; Monk's is the Acrobatics-or-Athletics clause,
   * which now lives on the skill SLOT as `redundantFallback` rather than as a record-wide flag.
   */
  'monk-dedication': ['conditional', 'hp'],
  'exemplar-dedication': ['conditional', 'hp'],
  /*
   * Their `defineCastingSource` is `LOREMASTER:::-:::ARCANE:::ATTRIBUTE_INT` — only the slot-type
   * segment is blank; it names Arcane and Intelligence and is the hanger for the archetype's focus
   * spell (their Loremaster's Etude row casts from it), but the dedication row itself grants no
   * spell and no spellcasting proficiency, and the printed feat prints no Cast a Spell, so we hold
   * nothing here. This settles the SPELLCASTING kind only.
   *
   * (The skill half of this comment used to say the legendary-Decipher-Writing upgrade was unbuilt.
   * It has since been built — `featGrantsAuto.ts` carries `crossConditionalSkills['lore:loremaster']`
   * with `whenSkill: ['arcana','occultism','religion','society']`, `whenRank: 'legendary'`,
   * `rank: 'expert'` — and the matching settle in wg-values.mjs is gone, so that row now matches on
   * its own merits.)
   */
  'loremaster-dedication': ['spellcasting'],
  /*
   * SPELLMASTER DEDICATION — the same hanger reading as `loremaster-dedication` above. Their
   * `defineCastingSource SPELLMASTER:::-:::ARCANE:::ATTRIBUTE_INT` names Arcane and Intelligence and is
   * the hanger their model needs for the archetype's LATER focus spells: Spellmaster's Ward (their
   * 29184, `giveSpell spellId 6188 FOCUS castingSource SPELLMASTER rank 5`) and Familiar Form (their
   * 29180, `giveSpell spellId 6187 FOCUS castingSource SPELLMASTER rank 4`) both cast from it. The
   * DEDICATION row itself grants no spell, no slot and no spellcasting proficiency, and printed
   * (feat-1134, Character Guide p.114) the feat prints no Cast a Spell at all — only a +2 circumstance
   * bonus to Identify Magic with a trained skill, plus the daily cantrip swap for Wayfinder Resonance
   * Tinkerer. The caster is the PREREQUISITE ("ability to cast focus spells"), so there is nothing here
   * for us to hold. The second op, `adjValue PRIMARY_SHEET_TABS = spells`, is their sheet's tab list.
   * The hanger's actual cargo is already ours on the feats that print it: `feats['spellmasters-ward']`
   * and `feats['familiar-form']` each carry `focusSpells`, and both match on their own merits. Our +2
   * is FEAT_SITUATIONAL['spellmaster-dedication'] (src/rules/situationalBonuses.ts), read by
   * `featSituationalFor` via explain.ts. This settles the SPELLCASTING kind only.
   *
   * ⚠ Do NOT re-derive this with `grep -o "SPELLMASTER:::[^\"]*"` — that returns one line (this
   * definition) and looks like proof the source is unused. Consumers name it WITHOUT the `:::`
   * segments; a plain `grep -c SPELLMASTER` over the dump returns 3.
   */
  'spellmaster-dedication': ['spellcasting'],
  /*
   * Printed: *"You learn the summon undead spell."* Their giveSpell {spellId 4878, castingSource
   * NECROMANCER, rank 1} adds it to the necromancer's preparable list. Ours needs no record field: the
   * necromancer is a prepared OCCULT caster (classes.necromancer.spellcasting.tradition = 'occult')
   * and spells['summon-undead'].traditions includes 'occult', so SpellsTab's useTraditionSpells
   * already offers it in the prepare picker at rank 1. A spellListAdditions row would be a second,
   * redundant route to a spell the picker already lists. The restricted slot the same feat grants IS
   * authored (feats/conjurer-of-corpses.spellSlotBonus, resolved through resolveRestrictedSlots).
   */
  'conjurer-of-corpses': ['spell'],
  /*
   * BATCH 17's REMAINING SETTLES — each mechanic is delivered by a carrier this comparer cannot read.
   *
   * master-summoner: their nine 1st–9th-rank options are the printed *"designate one of your spell
   * slots"*. Ours is `spellSlotBonus.restricted.rankChoice` → resolveRestrictedSlots emits
   * `rankOptions`, and SpellsTab's spontaneous branch now renders the `ms-rank-select` (guarded by
   * test/spell-access-lanes.test.ts — the settle was REFUSED while that control did not render).
   *
   * grave-strength / ghostly-grasp-ghost / numb: their giveAbilityBlock hands over a named "Advanced
   * Undead Benefits" container (rules-1695); ours authors the container's CONTENT on each record —
   * `senses: [darkvision]` + `resistances: [poison, half level]` — which is the same two mechanics
   * without the intermediary record. Readers: deriveDefenses' senses/resistances walk.
   *
   * armor-specialist: a boolean ACCESS flag, not a kind of ours — `armorSpec.anyProficient`, read by
   * armorSpecAccess (derive.ts); the per-group values live in armorSpec.ts. Same reading as the
   * NOT_A_SCALAR entries for its three variables in wg-values.
   *
   * additional-servings: their per-taking tally + injectText prose; ours is `resourceMaxSet` +
   * `maxTakable`, resolved to the printed daily maximum (build.ts resourceFloors →
   * classResources.resourceMaxFor).
   *
   * sound-mirror: their SPELL_ATTACK/SPELL_DC 'T' ops are the innate-casting floor every innate
   * caster already has (build.ts innate entry: trained, expert at 12+, cha fallback) — a
   * spellcastingGrant row was checked and REJECTED because via the tradition-matched profile lookup
   * it can lower a multi-archetype character's innate entry from expert to trained.
   *
   * psi-development: their unique/standard two-branch select is ours as the archetype cantrip picker
   * widened by `spellListAdditions` (entryId-scoped) + the extra known cantrip
   * (`spellSlotBonus.cantrips`); which of the six unique cantrips is legal for THIS character is the
   * menu-filtering that is ours to decide.
   */
  'master-summoner': ['choice'],
  'grave-strength': ['grantsRecord'],
  'ghostly-grasp-ghost': ['grantsRecord'],
  'numb': ['grantsRecord'],
  // batch 030: unshaken-in-iron#instrument — the 'armor-specialist' settle is DELETED. It existed only
  // because ARMOR_SPECIALIZATION_* fell into the unanchored /ARMOR/ -> 'ac' test; now that the variable
  // maps to 'defense' and `armorSpec` is listed under OUR_KINDS.defense, the record's carrier answers it
  // and the settle matches nothing under --raw. A settle that answers nothing silences the NEXT
  // difference on that record, unread.
  'additional-servings': ['specialStat', 'unmapped'],
  'sound-mirror': ['spellcasting'],
  'psi-development': ['choice'],
  /* *"You also become trained in Fortune-Telling Lore, and you learn the harrowing ritual."* No Cast a
   * Spell grant anywhere in the feat. Their casting source exists only as a hanger for the ritual; ours
   * is `grantsRituals: [{ spellId: 'harrowing' }]`, which is what the sentence actually says. */
  'harrower-dedication': ['spellcasting'],
  /* Their `giveSpellSlot` is two rank-0 slots at every level — the PREPARED CANTRIPS PER DAY, which we
   * model as two `effectChoices` cantrip pickers. *"You can prepare two cantrips each day from your
   * spellbook."* The spellbook itself now ships as `grantsItems`. */
  'spellshot-dedication': ['spellSlot'],
  /*
   * Their four "Sterling Dynamo Prosthesis" rows are pseudo-items holding the attack — the two
   * automatic ones are `category: unarmed_attack`, the two manual ones are `category: simple`. The
   * printed text calls it *"a dynamo melee unarmed attack"* in every case, the AoN mirror holds no
   * equipment record for it, and ours is four `grantedStrikes` keyed by the same four-way choice
   * (power/percussive × automated/manual) with the printed dice (1d6/1d8/1d4/1d6).
   */
  'sterling-dynamo-dedication': ['grantsItem'],
  /* *"…and the basic undead benefits."* Their `grantsRecord` points at the "Basic Undead Benefits"
   * block; ours INLINES it — and since the 2026-08-19 flip the inlined package matches rules-1694
   * clause for clause (death-effects immunity only, +1 circumstance vs disease/poison, Necril, the
   * vision upgrade, negative healing, the Negative Survival note). There is no grantsRules field to
   * point with; the content is what matters and it is held. */
  'ghost-dedication': ['grantsRecord'],
  'zombie-dedication': ['grantsRecord'],
  /* *"Choose one of the domains associated with your mystery … You gain an initial domain spell from
   * that domain."* Their `giveAbilityBlock` points at a scaffolding feat literally named "Domains";
   * ours is `choice: { kind: 'domains' }` resolved by `applyFeatFocus` in build.ts against
   * `DOMAIN_SPELLS` in domains.ts — all 64 domains mapped. The same picker under another name. */
  'domain-acumen': ['grantsRecord'],
  /* SHARED VIGILANCE — settle DELETED in batch 29; the summoner table's perception row (source
   * 'shared-vigilance') is read now. */

  /* ---------------------------------------------------------------- batch 010 */

  /*
   * Both archetypes print the same clause — Hallowed Necromancer *"…have the same tradition as your
   * spell slots"*, Magic Warrior *"…are the same tradition as your other spells"* — so neither DEFINES
   * a casting source; each borrows the character's. Their `defineCastingSource` is the hanger their
   * model needs for the archetype's later focus spells. Ours is `focusFromSpellSlots`, read in
   * build.ts after both the class and archetype entries exist (it cannot be a `tradition` on the
   * record: the answer is not knowable until the character has one). Asserted on a built character in
   * test/batch10-parity.test.ts — a fighter casting from a wizard archetype gets ARCANE hallowed
   * ground, where a fighter's own focus default is occult.
   */
  'hallowed-necromancer-dedication': ['spellcasting'],
  'magic-warrior-dedication': ['spellcasting'],
  /*
   * *"You gain a lash melee unarmed attack that is in the flail weapon group, deals 1d4 bludgeoning
   * damage, and has the grapple and reach traits."* Their carrier is an ITEM; ours is `grantedStrikes`
   * with those exact dice, group and traits — the same reading already settled for `spine-stabber`
   * and the martial artist's fist. An unarmed attack is not a thing you can drop.
   */
  'thlipit-contestant-dedication': ['grantsItem'],
  /*
   * Every one of these is an implement INITIATE BENEFIT — the Regalia's saves, the Lantern's
   * Perception, the conditional attached to them. The printed dedication grants the implement and says
   * you do NOT gain its initiate benefit, so the numbers belong on the implement records, which is
   * where ours are. Matches the same record's settle in wg-values.mjs.
   */
  'thaumaturge-dedication': ['conditional', 'perception', 'save'],
  /*
   * Their row carries FOCUS_POINT_BONUS on the dedication. The Remaster text does not: the dedication
   * alone grants no focus spell and so no pool, and the pool arrives with Psi Development. Ours agrees
   * — measured: dedication alone -> no focus entry at all, dedication + Psi Development -> a pool of 1.
   * Registered only now that the pool is REACHABLE: the psychic's own 2 points moved off a hardcoded
   * `ownsClass('psychic')` literal onto `psi-cantrips-and-amps.focusPoolBonus`, so any record can now
   * grant points, which is what makes this a difference of edition rather than a gap.
   */
  'psychic-dedication': ['focus'],
  /*
   * *"You gain a skill feat… The feat must be one for an Intelligence-, Wisdom-, or Charisma-based
   * skill, or for the skill you gained from your methodology."*
   *
   * Their carrier is a `select` on the feat. Ours is `restrictedSkillFeatLevels` on the CLASS, because
   * the restriction is a property of those SLOTS and has to be applied while the picker lists options
   * — a select on the record cannot narrow what the slot offers. This is the one place the owner's
   * parity rule leaves us the last word: *"only place where we have the last word is filtering the
   * options when giving a user selection menu."* Measured: an investigator's restricted slot offers
   * 235 feats where a fighter's offers 295, and Cat Fall (Acrobatics) is correctly absent from it.
   */
  'skillful-lessons': ['choice'],

  /* ---------------------------------------------------------------- batch 011 */
  /* STUBBORN — settle DELETED in batch 29; the gunslinger table's Will-expert row (source 'stubborn')
   * is read now. Their second op is prose-only (the controlled-condition re-save), which we hold as a
   * RECORD_MARKER on the `controlled` condition and which the proseOnlyKinds allowance answers. */
  /*
   * Their only `hp` op is a conditional gated on FEAT_NAMES including "exemplar resiliency" — it is
   * Exemplar Resiliency's Hit Points parked on each exemplar archetype feat, which is how their model
   * spells *"for each exemplar archetype class feat you have"*. Printed Basic Glory grants no HP at
   * all; its whole text is *"You gain a 1st- or 2nd-level exemplar feat."* We hold them ONCE, on the
   * feat that prints them (exemplar-resiliency's per-archetype-feat bonus), and basic-glory is counted
   * among the feats it multiplies by. Same settle already made for 'exemplar-dedication' in batch 9.
   */
  'basic-glory': ['conditional', 'hp'],
  /*
   * *"For 5 rounds, your entire body begins to glow… At the end of each of your turns during this time,
   * you regain 1d4 Hit Points."* Their `hp` op is that 1d4. It is not a Hit Point TOTAL and no field on
   * our side holds one: it is healing over five rounds, produced by an activation, and it belongs to
   * the Light spell the same sentence grants. Ours rides there — `spellNotes` on the granted spell, so
   * the clause is read exactly where the player triggers it. Both grades carry it.
   */
  'enveloping-light': ['hp'],
  'enveloping-light-greater': ['hp'],
  /*
   * *"You gain an additional skill increase … you also gain a skill feat, which must be for
   * Acrobatics or for the skill of your swashbuckler's style."*
   *
   * Their carrier is a `select` of skills on the record. Ours is two class-level lanes, because both
   * halves are properties of SLOTS rather than of this record: `bonusSkillIncreaseLevels` [3,7,15] adds
   * a second skill increase at each of those levels (verified on a built swashbuckler — two entries at
   * level 3, both ranks applied, and the round-trip splits them back), and `restrictedSkillFeatLevels`
   * narrows the feat slot to Acrobatics plus the style's own skill. A select on the record cannot
   * narrow what a slot offers. Same shape and same reasoning as 'skillful-lessons' above — and this is
   * the one place the owner's parity rule leaves us the last word: filtering the options in a picker.
   */
  'stylish-tricks': ['choice'],
  /* Their two ops are UNFINISHED STUBS, quoted whole so the next reader does not have to fetch them:
   *   {"type":"addBonusToValue","data":{"variable":"","text":""}} x2
   * No variable, no value, no bonus type. Only the COUNT is legible — two bonuses, which is how many
   * the printed text gives. Their GREATER grade (item 18178) encodes the same effect properly
   * (SKILL_DIPLOMACY 2 item; PERCEPTION 2 item "to Sense Motive"), which is what establishes these
   * blanks as stubs rather than a different reading. This is a THEY-ENCODE-NOTHING settle, not a
   * we-cover-it-elsewhere one. ⚠ Do NOT fix this with a blanket empty-variable guard in
   * kindOfTheirOp — ability_block 57388 (Instinctive Collaborator) carries a COMPLETE +2 circumstance
   * whose variable is also empty (the target lives in text "to Aid"), and a blanket guard would
   * silence it. */
  'bolkas-blessing': ['unmapped'],

  /*
   * ---- BATCH 19 (ancestries + backgrounds) -------------------------------------------------------
   *
   * AWAKENED ANIMAL — their row's remaining block is `feat/Awakened Animal Versatile Heritage`:
   * their app models the awakened animal as a VERSATILE HERITAGE bolted onto another ancestry, ours
   * as the full ancestry the book prints (Howl of the Wild), with its own heritages, size choice
   * (`bodySize` → `hpBySize` 6/6/8/10, adversarially confirmed against their per-size setValue table)
   * and Awakened Mind delivered as the RECORD_MARKERS diplomacy note. There is no record of ours for
   * their structural block to correspond to — the whole ancestry is the correspondence.
   */
  'awakened-animal': ['grantsRecord'],
  /*
   * CENTAUR — their remaining blocks are `feat/Mount` and `feat/Robust`, granted as records. Read in
   * the batch-19 pass: Robust's whole content is `addBonusToValue BULK_LIMIT_BONUS 2`, which ours
   * ships as `ancestries.centaur.bulkLimitBonus: 2` read by deriveBulk (guarded on a built centaur in
   * test/batch19-parity.test.ts); Mount's block carries NO operations on their side and its rider
   * rules are prose on both (our AST carries the printed paragraph). Contents delivered; only the
   * container differs.
   */
  'centaur': ['grantsRecord'],
  /*
   * KHOLO — their Bite physical-feature block grants ITEM 13753, a bite weapon their data does not
   * tag with the unarmed trait, so the op reads as `grantsItem` rather than `weapon`. Ours ships the
   * same printed attack as `grantedStrikes` (Jaws, d6 piercing, brawling) — the lane every unarmed
   * ancestry attack uses, and the shape their own tagged unarmed items map to. Same Strike, styled as
   * a strike rather than an inventory row.
   */
  'kholo': ['grantsItem'],

  /*
   * ---- BATCH 21 ----------------------------------------------------------------------------------
   *
   * ZODIAC BOUND — their row wraps each sign's spell in a defineCastingSource + a conditional on the
   * sign select; ours delivers the same table as twelve `innateSpells` rows gated by `whenChoice`
   * (built this batch, guarded on built characters in test/batch21-parity.test.ts). The casting
   * source is the pooled innate entry both sides resolve to; the conditional IS the whenChoice gate.
   */
  'zodiac-bound': ['spellcasting', 'conditional'],

  /*
   * ---- BATCH 29 ----------------------------------------------------------------------------------
   *
   * WEAPON SPECIALIZATION / GREATER WEAPON SPECIALIZATION — a DERIVED damage step, computed from the
   * owning class's feature table rather than declared anywhere a key scan can find.
   *
   * Printed: *"You deal 2 additional damage with weapons and unarmed attacks in which you are an
   * expert. This damage increases to 3 if you're a master, and 4 if you're legendary."* Their side
   * writes a bare boolean marker (`adjValue WEAPON_SPECIALIZATION = true`, and its Greater twin) and
   * lets their engine supply the table — the MARTIAL_EXPERIENCE / INVENTOR_ARMOR shape.
   *
   * Ours computes it: `weaponSpecialization(c, db)` in src/rules/derive.ts detects the feature by
   * walking the OWNING CLASS's own feature table (`cls.features.filter(f => f.level <= c.level)`), so it
   * fires for all 27 class tables that grant it at each class's own level (most @7, guardian @11, the
   * rest @13; psychic through 'psychic-weapon-specialization'; the summoner's
   * 'eidolon-weapon-specialization' deliberately excluded by exact match), and `weaponSpecDamage(rank,
   * ws)` returns expert 2 / master 3 / legendary 4 (4/6/8 with Greater) keyed to the STRIKE's own
   * effective rank, folded into every Strike. Nothing on either record names it, which is why neither
   * the field walk nor a registry key scan can see it, and why this is not the advancement-table teach:
   * a damage step is not a proficiency rank and has no row in src/rules/advancement.ts. Paired with the
   * same two variables in wg-values' NOT_A_SCALAR.
   */
  'weapon-specialization': ['weapon'],
  'greater-weapon-specialization': ['weapon'],

  /*
   * ---- BATCH 031 ---------------------------------------------------------------------------------
   *
   * BASIC MODIFICATION — the mechanic is built, in the EXISTING picker rather than on the record.
   *
   * Printed (AoN feat-3117): *"You gain a basic modification of your choice for your innovation."*
   * Their side asks it on the record: three `conditional`s on INVENTOR_INNOVATION (armor / construct /
   * weapon), each wrapping a `select "Select a Modification"` — kinds `conditional` and `choice`.
   * Ours widened the app's own tiered modification picker to the archetype instead: build.ts's
   * `inventorViaDedication` resolves the innovation from Inventor Dedication's own `innovation` answer,
   * and `validPick` opens the INITIAL tier (and only that tier) while the character holds this feat,
   * with the matching gate on the control in src/builder/shared.tsx. The feat record therefore carries
   * no choice of its own and a comparison that reads record fields structurally cannot see the pick —
   * the same shape as batch 030's additional-ikon settle. A second 28-option picker on the record would
   * duplicate the one the app already has. Built and adversarially verified this batch on a fighter with
   * Inventor Dedication + Basic Modification (test/batch031-engine.test.ts: the innovation resolves, the
   * initial pick sticks and reaches ownedFeatureIds, the later tiers stay closed at 20).
   */
  // batch 031: basic-modification
  'basic-modification': ['conditional', 'choice'],

  /*
   * MONK MOVES — their `hp` op belongs to a DIFFERENT feat, and we carry it there.
   *
   * Printed (AoN feat-6214) mentions no Hit Points at all. Their row is `conditional IF FEAT_NAMES
   * INCLUDES "monk resiliency" AND MAX_HEALTH_CLASS_PER_LEVEL <= 8 THEN addBonusToValue
   * MAX_HEALTH_BONUS = 3` — Monk Resiliency's own per-monk-archetype-feat +3, replicated onto each
   * qualifying feat row. Ours carries it once, on feats/monk-resiliency as
   * `maxHpBonus {perArchetypeFeat: 3, archetype: 'monk'}`, which already counts Monk Moves. wg-values
   * was taught the same gate this batch (SETTLED_VALUES, work/.b031-report-instruments.txt); the kinds
   * reader flattens the conditional to a bare `hp` on this record, so it needs the settle as well.
   */
  // batch 031: monk-moves#hp
  'monk-moves': ['hp'],

  /*
   * INSPIRED STRATAGEM — A HOMONYM MISPAIR ACROSS BUCKETS, not a missing grant.
   *
   * `wg-show.mjs "Inspired Stratagem"` returns three rows: 19732 (level 1) with NO operations, and
   * 20263 (level 8) and 58198 (level 10), each a single `giveAbilityBlock -> 19732`. Their level-1 row
   * is the REACTION ITSELF and hands over nothing; the grant is on the level-8 feat. The bucket split
   * pairs their richest same-named row against `classFeatures/inspired-stratagem` — our level-1 copy of
   * the same aonId (feat-4952), which no class table references and which carries nothing but
   * `actionCost: 'reaction'` — so `missing=[grantsRecord]` is a demand made of the wrong record.
   *
   * The grant IS modelled, and this comparer already says so on its own row: `feats/inspired-stratagem`
   * (level 8, rogue) carries `grantsActions: ['inspired-stratagem']`, resolved into `chosenActionIds` by
   * src/rules/build.ts:6201 and rendered by the grantsActions walk in MainTab.tsx:310-316 against
   * `actions/inspired-stratagem` (reaction, traits fortune + linguistic) — the level-8 row is in the
   * AGREE bucket with `ourKinds:['grantsRecord']`.
   *
   * ⚠ BLAST RADIUS, MEASURED, NOT ASSUMED. `VERIFIED_EQUIVALENT` is keyed by record ID, and both rows
   * carry the id `inspired-stratagem`, so this entry blankets the level-8 feat row too: stunting
   * `feats/inspired-stratagem.grantsActions` leaves BOTH rows in wg-diff's AGREE bucket. What still
   * reports it is wg-identity's `grants` lane — the stunted run prints
   * `grants theirs-not-ours=[inspiredstratagem] ours=[(nothing)]` — so the grant is guarded, by the
   * comparer that names things rather than the one that names kinds. Pinned exactly that way in
   * test/batch034-instruments-2.test.ts. THE ROOT FIX IS THE PAIRING, not this settle: WG_PAIRING's
   * `classFeatures` bucket accepts `['class-feature','feat']` and wgRowsByBucket then keeps the richest
   * row per NAME regardless of type, so a feat row displaces the class-feature row of the same name
   * (scripts/lib/wg-parse.mjs:293-306, outside this batch's instrument grant — filed as a cross-file
   * gap). Delete this entry the day an earlier-typed row stops being displaced.
   *
   * Print (AoN feat-4952): *"Later, you can quickly advise them on your schemes using the below
   * reaction."*
   */
  // batch 034: inspired-stratagem#instrument
  'inspired-stratagem': ['grantsRecord'],
  /*
   * ELEMENTAL INSTINCT — their six ability blocks are our stored ANSWER, not a granted record.
   *
   * Print (AoN instinct-7, Elemental): *"Select an element from the Elemental Instincts table to be
   * your instinct's element. If your element offers multiple damage types, choose one of those type
   * when you select your element."* WG has no per-record choice flag in its vocabulary, so it hands
   * the answer over as six `giveAbilityBlock` blocks — "Kinetic Element (Air)" … "(Wood)" — one inside
   * each branch of its select, which is what `grantsRecord` counts. Ours is
   * `classFeatures/elemental-instinct.choice {flag:'instinctElement', kind:'array', options:['air-
   * electricity' … 'wood-slashing']}`, each option carrying that element's own `grant.whileActive`
   * resistances (merged at build.ts:6042, read by derive.ts ownedWhileActive). There is no record on
   * our side for their blocks to pair with because the element is a stored pick, and `choice` — the
   * kind that IS the pick — already agrees on both sides.
   *
   * Adversarially confirmed: with `choice` deleted from a content copy the record loses `choice` from
   * our kinds and `missing` grows rather than shrinking, so this entry cannot stand in for the carrier.
   *
   * ⚠ `grantsRecord` ONLY. Paired with the six member-scoped names in wg-identity's
   * SETTLED_IDENTITIES; every other kind on this record still reports, and the `defense` half is
   * carried for real by the `grant.whileActive` descent in `ourKindsOf`.
   */
  // batch 034: elemental-instinct#instrument
  'elemental-instinct': ['grantsRecord'],

  /*
   * ARMORED RESISTANCE — the same resiliency rider as monk-moves above, one archetype over.
   *
   * Printed (AoN feat-7897) says nothing about Hit Points: *"While you are wearing medium or heavy
   * armor, you gain resistance to physical damage equal to half your character level when you use the
   * Intercept Attack reaction to take damage instead of your ally."* Their row is `conditional IF
   * MAX_HEALTH_CLASS_PER_LEVEL <= 10 AND FEAT_NAMES INCLUDES "guardian resiliency" THEN adjValue
   * MAX_HEALTH_BONUS = 3` — Guardian Resiliency's own per-guardian-archetype-feat +3, replicated onto
   * each qualifying guardian feat row because their vocabulary has no "per feat of this archetype" verb.
   *
   * Ours holds that sentence ONCE, where it is printed: `feats/guardian-resiliency.maxHpBonus =
   * {perArchetypeFeat: 3, archetype: 'guardian'}`, multiplied by the count of taken feats whose
   * `archetype === 'guardian'` in featHpBonus (src/rules/derive.ts:897-901) and folded into starting
   * HP by build.ts:8557-8561 — a set that includes armored-resistance. Same total, one carrier.
   *
   * wg-values already drops this whole shape globally (RESILIENCY_GATE, batch 031); wg-diff's kinds
   * reader flattens the conditional to a bare `hp` on the record it sits on, so it needs the settle
   * too — exactly as monk-moves did.
   *
   * ⚠ `hp` ONLY, and the blast radius is one row: the settle is keyed by record id and `armored-
   * resistance` names a single feat row in the walk (the same-id `modes` record is outside
   * WG_PAIRING). The record's other kinds still report, and the printed resistance is delivered by
   * `modes/armored-resistance` (physical, floor(@actor.level/2)), which is why `defense` is already on
   * our side of the row. Adversarially confirmed both ways: under `--raw` the record goes straight
   * back to THEY-ONLY `missing=[hp]`, and with `maxHpBonus` stripped from feats/guardian-resiliency
   * the sentence is still reported — Guardian Resiliency's own row asserts its +3 UNGATED, so
   * wg-values reopens `MISSING hp|` there (test/batch036-instruments.test.ts).
   */
  // batch 036: armored-resistance#instrument
  'armored-resistance': ['hp'],
};

const out = { theyOnly: [], disagree: [], weOnly: [], agree: [], noMatch: [], theirsUnencoded: [] };
/*
 * FEATS ONLY — and that is a KNOWN LIMIT, not an oversight. `scripts/wg-batch-gate.mjs` reports every
 * record a batch contains that no comparer covers, so the limit is visible per batch instead of silent.
 *
 * Widening this walk to every bucket was tried and reverted ONCE: `theirs` is keyed by NAME and filtered
 * to their `feat` rows, so our items and class features got paired against their FEATS whenever a name
 * collided. `clan-pistol` is both a feat and a weapon on our side, and the widened walk compared the
 * WEAPON against their feat and reported the feat's granted item as missing — a false gap on a record
 * that had just been fixed. Pairing by name alone across buckets manufactures wrong answers.
 *
 * ⚠ The right fix IS available and is being built: `parseCopyBlock` returns rows as OBJECTS, so
 * `row.type` reads cleanly (feat 10843, class-feature 2237, heritage 594, action 135, physical-feature
 * 110, sense 69, mode 46) and their `item` table is a separate 6,244-row block that also carries
 * `operations`. An earlier note here claimed the type column "does not survive the TSV parse" — that was
 * wrong, and it was wrong because the probe indexed an object numerically.
 */
for (const [id, rec, bucket] of wgAllRecords(core)) {
  /* An action whose class feature or feat shares its id defers to that sibling — see wgOwnsComparison. */
  if (!wgOwnsComparison(core, bucket, id)) continue;
  const t = theirByBucket[bucket]?.get(norm(rec.name));
  /* `bucket` rides on EVERY emitted row because an id alone does not name a record: `warrior` is a
   * background AND a class feature (scripts/lib/wg-parse.mjs:146-149), `clan-pistol` a feat AND a
   * weapon, and 266 normalised names exist in two of our buckets (:1591 above). Any consumer keyed by
   * id alone — the trust ledger is the first — would place one twin's verdict on the other. It is
   * already in scope here, so this is the whole fix. */
  if (!t) { out.noMatch.push({ id, name: rec.name, bucket }); continue; }
  if (!t.opCount) { out.theirsUnencoded.push({ id, name: rec.name, bucket }); continue; }
  const ours = ourKindsOf(rec, id, bucket);
  let missing = [...t.kinds].filter((k) => !ours.has(k) && k !== 'note');
  /* A conditional whose every branch holds kinds we already model is a wrapper, not a gap. */
  const gatesOnlyWhatWeHave = (t.condGroups ?? []).every((g) => [...g].every((k) => k === 'note' || ours.has(k)));
  if (missing.includes('conditional') && gatesOnlyWhatWeHave) missing = missing.filter((k) => k !== 'conditional');
  /*
   * A STAT KIND ASSERTED ONLY BY A PROSE NOTE IS ANSWERED BY OUR CONDITIONAL LANE — see `proseOnlyKinds`.
   * Gated on `ours.has('conditional')`, which is the whole point: Fishseeker Shoony's `degreeShifts`
   * answer it and its `missing=[skill]` clears, while Murksight, Greenwatcher, Insistent Command and
   * Assured Runic Crafter model nothing at all and keep reporting the gap they really have.
   *
   * ⚠ BATCH 29 TRIED TO WIDEN THIS TO "ours models SOMETHING" AND REVERTED IT. The case for widening
   * was Aeon Stone (Vital Amplification), whose `addBonusToValue MAX_HEALTH_BONUS` carries no `value`
   * in either branch, so `missing=[hp]` looks like a demand for a mechanic their op does not grant.
   * Measured over the corpus it also silenced Icy Apotheosis (*"You automatically succeed against
   * effects that have the cold trait"*, written as value-less notes on all three saves — a printed rule
   * we do NOT carry on saves) and Crushing Bough Bracers (*"your Strikes deal damage … as though their
   * resistances were 5 lower"*). Both are REAL gaps, and the batch-27 test above pins Icy Apotheosis
   * for exactly this reason. A value-less note names a printed rule; whether it is a false positive
   * depends on whether WE carry that rule, and `has('conditional')` is the question that asks it. The
   * stone's hp half is a real gap too, filed separately as aeon-stone-vital-amplification#healing-amplification
   * — it clears when that lands, not by being settled here.
   */
  if (ours.has('conditional') && t.proseOnlyKinds?.size) missing = missing.filter((k) => !t.proseOnlyKinds.has(k));
  /* Kinds read, verified and settled for this record — see VERIFIED_EQUIVALENT above. */
  const settled = RAW_SETTLES ? undefined : VERIFIED_EQUIVALENT[id];
  if (settled) missing = missing.filter((k) => !settled.includes(k));
  const shared = [...t.kinds].filter((k) => ours.has(k));
  const extra = [...ours].filter((k) => !t.kinds.has(k));
  const row = { id, name: rec.name, bucket, level: rec.level, theirKinds: [...t.kinds], ourKinds: [...ours], missing, extra, theirOps: t.opCount };
  if (missing.length) out.theyOnly.push(row);
  else if (extra.length) out.weOnly.push(row);
  else out.agree.push(row);
}

/* Where BOTH sides model the same kind, the values still have to be compared — but that needs the
 * printed text to adjudicate, so it is a separate, judged pass. Flag the candidates here. */
out.disagree = out.agree.concat(out.weOnly).filter((r) => r.theirKinds.some((k) => ['skill', 'save', 'ac', 'hp', 'speed', 'defense', 'attribute'].includes(k)));

/* ---------------------------------------------------------------- report */
const dest = arg('--out', null);
if (dest) { writeFileSync(join(ROOT, dest), JSON.stringify(out, null, 1)); console.log(`-> ${dest}`); }

const matched = out.theyOnly.length + out.weOnly.length + out.agree.length;
/* Across EVERY paired bucket now, not just feats. The denominators moved when the comparison stopped
 * being feats-only, so they are labelled as records rather than feats to keep the number honest. */
const ourRecords = Object.keys(WG_PAIRING).reduce((n, b) => n + Object.keys(core[b] ?? {}).length, 0);
const theirEncoded = Object.values(theirByBucket).reduce(
  (n, m) => n + [...m.values()].filter((t) => t.opCount).length, 0,
);
console.log(`our records (paired buckets): ${ourRecords}    theirs (encoded, summed per bucket): ${theirEncoded}\n`);
console.log(`  matched by name, both encode something : ${matched}`);
console.log(`     ${String(out.theyOnly.length).padStart(5)}  THEY-ONLY   they model a kind we do not   <- the work list`);
console.log(`     ${String(out.weOnly.length).padStart(5)}  WE-ONLY     we model a kind they do not`);
console.log(`     ${String(out.agree.length).padStart(5)}  AGREE       same kinds on both sides`);
console.log(`  ${String(out.theirsUnencoded.length).padStart(5)}  they have the feat, encode NOTHING`);
console.log(`  ${String(out.noMatch.length).padStart(5)}  we have the feat, they do not\n`);
console.log(`  ${String(out.disagree.length).padStart(5)}  numeric kinds present on BOTH sides — values need adjudicating against the book`);

const byKind = {};
for (const r of out.theyOnly) for (const k of r.missing) byKind[k] = (byKind[k] ?? 0) + 1;
console.log(`\nTHEY-ONLY, by the kind we are missing:`);
for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${k}`);

if (has('--list')) {
  const b = arg('--bucket', 'they-only');
  const list = { 'they-only': out.theyOnly, 'we-only': out.weOnly, agree: out.agree, disagree: out.disagree, nomatch: out.noMatch }[b] ?? [];
  console.log(`\n--- ${b} (${list.length}) ---`);
  for (const r of list.slice(0, 400)) console.log(`  ${r.id.padEnd(42)} lvl ${String(r.level ?? '?').padStart(2)}  missing=[${(r.missing ?? []).join(',')}]  ours=[${(r.ourKinds ?? []).join(',')}]`);
}
