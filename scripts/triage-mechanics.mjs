/*
 * TRIAGE — step 0 of the "every record must actually work" pass.
 *
 * Assigns EVERY player-facing record to one or more mechanical LANES based on its own rules text,
 * plus what the app already models for it. Deterministic and re-runnable: no judgement here, just
 * signal detection, so the set handed to the (expensive, verified) classification pass is auditable
 * and nothing is silently skipped. Records with NO detected signal are reported too, with a count,
 * so "we looked at everything" is a checkable statement rather than a promise.
 *
 *   npx jiti scripts/triage-mechanics.mjs        # summary (jiti: it imports the app's own hide rules)
 *   npx jiti scripts/triage-mechanics.mjs --json # full per-record ledger (large)
 *   npx jiti scripts/triage-mechanics.mjs --lane choice --out work/lane-choice.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findDuplicateIds, findUmbrellaIds } from '../src/data';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const db = JSON.parse(read('public/core.json'));
/*
 * Descriptions live in a SECOND file now — 61% of the data, split out so the app becomes interactive
 * after parsing 8 MB instead of 22.5. Every lane below tests a record BY ITS TEXT, so without this
 * merge each one matched zero records and the whole report read "0 candidates, 0 TO DO" — a broken
 * instrument that looked like a finished job. coverage-report.mjs merges them back for the same reason.
 */
{
  const desc = JSON.parse(read('public/core-descriptions.json'));
  for (const [bucket, records] of Object.entries(desc)) {
    if (!db[bucket]) continue;
    for (const [id, v] of Object.entries(records)) {
      const rec = db[bucket][id];
      if (!rec) continue;
      if (v.d !== undefined) rec.description = v.d;
      if (v.r !== undefined) rec.descRefs = v.r;
    }
  }
}

/* ---- what the app ALREADY models, so triage can mark a record done ------------------------- */

/** Every id that resolves to a real record, in any collection — the filter that makes idsIn exact. */
const RECORD_IDS = new Set(
  ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds',
   'animalCompanions', 'specificFamiliars', 'companionSpecializations', 'deities', 'spells', 'stances']
    .flatMap((c) => Object.keys(db[c] ?? {})),
);

/**
 * Registry keys, verified against core.json.
 *
 * The old pattern required a HYPHEN (`[a-z0-9]+(?:-[a-z0-9]+)+`), so every single-word id was
 * invisible to this report — `pet` and `familiar` are both registered companion grants and were
 * being counted as gaps, and 105 situational ids like `forlorn` and `pirouette` likewise. Matching
 * any quoted key instead over-collects field names (`rank`, `options`, `fortitude`), so the result is
 * filtered to keys that actually resolve to a record. That way the report can neither miss a real
 * entry nor credit a field name as one.
 */
const idsIn = (p) => {
  let src;
  // ONLY a missing file is tolerable here. A blanket catch previously swallowed a ReferenceError and
  // silently reported every registry as empty — a coverage report that fails open is worse than one
  // that crashes, because the number still looks like an answer.
  try { src = read(p); } catch { return new Set(); }
  const keys = [...src.matchAll(/["']([a-z0-9][a-z0-9-]*)["']\s*:/g)].map((m) => m[1]);
  return new Set(keys.filter((k) => RECORD_IDS.has(k)));
};
/** Feature ids that appear in some class's feature list — the class pipeline advances these. */
const CLASS_FEATURE_IDS = new Set(
  Object.values(db.classes ?? {}).flatMap((c) => (c.features ?? []).map((f) => f.featureId)),
);

/** Subclass-option ids that already carry a focus/innate spell grant (witch patrons, druid orders). */
const SUBCLASS_OPTION_SPELLS = new Set(
  Object.values(db.classes ?? {}).flatMap((c) =>
    (c.subclass?.options ?? []).filter((o) => o.focusSpells?.length || o.innateSpells?.length).map((o) => o.id),
  ),
);

/**
 * Ids EXAMINED against their own rules text and deliberately left with no data, because the correct
 * answer for that record is "it grants nothing of this kind" — a stance-requiring action is not a
 * stance, a feat that names a prerequisite proficiency does not grant one.
 *
 * Without this the report counts finished work as outstanding: the defense lane read all 1,096 of its
 * records and correctly modelled 119, yet still showed ~975 "TO DO". Those numbers can never reach
 * zero, because for most records "no data" IS the right answer. Splitting examined from unexamined is
 * the difference between "975 left to do" and "975 already decided".
 */
const EXAMINED = (() => {
  try { return JSON.parse(read('work/examined.json')); } catch { return {}; }
})();
const examinedIn = (lane) => new Set(EXAMINED[lane] ?? []);

const MODELLED = {
  choice: new Set([
    ...idsIn('src/rules/featPickGrants.ts'),
    ...idsIn('src/rules/featCantripGrants.ts'),
  ]),
  grantsFeat: idsIn('src/rules/featFeatGrants.ts'),
  // featGrantsLane.ts is merged into FEAT_GRANTS just like the other two; omitting it here reported
  // ~78 already-wired feats (Master Spotter, Juggernaut's Fortitude, Evasiveness…) as gaps. A new
  // registry file has to be added HERE as well, or the report silently stops seeing it.
  proficiency: new Set([
    ...idsIn('src/rules/featGrants.ts'),
    ...idsIn('src/rules/featGrantsAuto.ts'),
    ...idsIn('src/rules/featGrantsLane.ts'),
  ]),
  companion: idsIn('src/rules/companionGrants.ts'),
  situational: idsIn('src/rules/situationalBonuses.ts'),
  /** "Cast X once per day as an innate spell" is TRACKED once the spell is granted, and for these the
   *  grant lives in the registry rather than in an `innateSpells` field on the record. 24 records read
   *  as untracked resources until the resource lane learned about this file. */
  innateGrant: idsIn('src/rules/featCantripGrants.ts'),
};

/** Does this record grant a spell through an effect CHOICE — either an open spell filter or a
 *  closed option list whose picked option carries the grant? Both reach the character's spell pool
 *  (build.ts chosenInnateGrants); neither is visible in `innateSpells`. */
const grantsSpellViaChoice = (r) =>
  (r.effectChoices ?? []).some(
    (e) => !!e.spellFilter || (e.options ?? []).some((o) => (o.grant?.innateSpells ?? []).length > 0 || (o.grant?.focusSpells ?? []).length > 0),
  );

/* ---- lane signals ------------------------------------------------------------------------- */
// Ordered: the FIRST matching lane is the record's primary lane, but all matches are recorded.
const LANES = [
  {
    id: 'choice',
    what: 'asks the player to pick something at build time',
    re: /\b(choose|select|pick)\s+(an?|one|two|three|up to|\d+)\b/i,
    not: /\b(choose|select|pick)\s+(a target|one target|a creature|an? adjacent|a square|a direction|a point|a spot|an enemy|an ally|any number)/i,
    /** `effectChoices` IS a build-time picker — the generic choose-one-of-N lane — and it is where
     *  every "choose a 1st-rank arcane spell" record already lives. Counting only `choice` and the
     *  registries reported working pickers (Spell Runes, Ornate Tattoo, …) as gaps. `grantOptions`
     *  on a class covers the subclass/extra-choice pickers, which are not on the record at all. */
    /** `abilityBoosts` with a `choice`/`free` entry IS the picker for "choose two attribute boosts" —
     *  a first-class builder control (BuildState.backgroundBoosts / ancestryBoosts), not something a
     *  record models itself. Every background prints that sentence, which is why 72 of them read as
     *  gaps. */
    modelled: (r) =>
      !!r.choice ||
      (r.effectChoices ?? []).length > 0 ||
      (r.abilityBoosts ?? []).some((b) => b?.kind === 'choice' || b?.kind === 'free') ||
      MODELLED.choice.has(r.id),
  },
  {
    id: 'situational',
    what: 'grants a typed bonus that only applies sometimes',
    re: /(circumstance|status|item)\s+bonus/i,
    modelled: (r) => MODELLED.situational.has(r.id),
  },
  {
    id: 'proficiency',
    what: 'raises or grants a proficiency rank',
    re: /\b(become|becomes|are|you're|you are)\s+(trained|expert|master|legendary)\b|\bproficiency rank\b.*\b(to|in)\b/i,
    /**
     * A proficiency can be modelled in FOUR different places, and checking only the feat registry
     * over-counted the gap badly: it reported 1,062 unmodelled records, of which 477 were backgrounds
     * that already carry their skill data, 157 were class features the class pipeline already
     * advances, and only ~20 were real. FEAT_GRANTS is iterated over TAKEN FEATS only (build.ts
     * ~2129), so a background or class feature listed there would be inert data that this very report
     * would then count as "modelled" — the worst outcome.
     */
    modelled: (r) =>
      MODELLED.proficiency.has(r.id) ||
      !!r.skillChoices ||
      !!r.grants ||
      // Backgrounds carry their own training fields. NOTE the singular `trainedSkill` — checking only
      // the plural missed 16 of the 18 backgrounds still being reported here.
      !!r.trainedSkill || !!r.trainedSkills || !!r.trainedLore || !!r.trainedLoreChoice || !!r.trainedSkillChoice ||
      !!r.loreChoices ||
      // Heritages express "become trained in Crafting (or another skill if already trained)" as an
      // effect-choice the builder renders as a picker — that IS the model, not a gap.
      (r.effectChoices ?? []).some((ec) => /skill|lore|trained/i.test(`${ec.id} ${ec.prompt ?? ''}`)) ||
      // "Trained in spell attack rolls and spell DCs" is a proficiency too, and it has its own field
      // that buildCharacter already reads — omitting it here reported wired archetypes as gaps.
      !!r.spellcastingGrant ||
      // class features are advanced by the class pipeline, not by any registry
      CLASS_FEATURE_IDS.has(r.id),
  },
  {
    id: 'resource',
    what: 'a limited-use pool or per-day/per-hour counter',
    re: /\b(once per (?:day|hour|minute|round|turn)|(?:\d+|one|two|three) times? per (?:day|hour)|you can use this (?:ability|feat|action) only once)\b/i,
    /** `frequency`/`counters` are the ITEM shape (itemUses.ts); `limitedUses` is the FEAT one added
     *  when per-day feat tracking was built. Both count — checking only the item fields would report
     *  every tracked feat as a gap. */
    /** Four separate systems track limited use, and the report has to know all four or it calls
     *  working content a gap:
     *    frequency / counters  — items, via itemUses.ts (use pips on the inventory row)
     *    limitedUses           — feats, via PlayState.featUses (added with feat use tracking)
     *    innateSpells          — "cast X once per day as an innate spell" is tracked by
     *                            PlayState.innateUsed and reset by rest; 231 of the records still
     *                            listed here are exactly that, already working.
     *    featCantripGrants.ts  — same as innateSpells, but the SPELL comes from the registry rather
     *                            than a field on the record (24 more that looked untracked)
     *    usesUpgrade           — a feat that RETUNES another feat's limit correctly has no limit of
     *                            its own; without this it reads as an untracked resource */
    modelled: (r) =>
      !!r.frequency ||
      !!r.uses ||
      !!r.counters ||
      !!r.limitedUses ||
      !!r.usesUpgrade ||
      (r.innateSpells ?? []).length > 0 ||
      grantsSpellViaChoice(r) ||
      MODELLED.innateGrant.has(r.id),
  },
  {
    id: 'toggle',
    what: 'a stance or on/off state the player turns on',
    re: /\b(stance|you enter|while in this stance|sustained|you can activate|until you (?:dismiss|end))\b/i,
    modelled: (r) => !!(db.stances && db.stances[r.id]) || !!r.toggle,
  },
  {
    id: 'grantsFeat',
    what: 'gives the character another feat or feature',
    re: /\b(you gain|you also gain|gains?) (?:the )?[A-Z][\w' -]+ (?:feat|feature)\b|\bgain a \w+ feat\b/i,
    /** Same over-count as proficiency: 408 of the 409 flagged BACKGROUNDS already carry
     *  grantedFeatId, and records carry their own grantsFeats. Checking only the registry
     *  reported working content as a gap. */
    modelled: (r) => MODELLED.grantsFeat.has(r.id) || !!r.grantsFeats || !!r.grantedFeatId,
  },
  {
    id: 'spellGrant',
    what: 'grants a spell, cantrip or focus spell',
    re: /\b(you (?:learn|gain|can cast)|gains?) .{0,40}\b(spell|cantrip|focus spell)\b/i,
    /** Subclass options (witch patrons, druid orders) carry focusSpells on the OPTION, not on any
     *  record in a scanned collection, so they looked unmodelled while working perfectly. */
    modelled: (r) =>
      !!r.focusSpells || !!r.innateSpells || !!r.spellcasting || MODELLED.choice.has(r.id) ||
      // heldSpells is the ITEM shape — a staff/wand/pendant that casts a spell on activation. The
      // Greater Pendant of the Occult already carries {0:[guidance],3:[dream-message]}.
      !!r.heldSpells ||
      // effectChoices grants spells in TWO shapes, and an audit that knew neither reported eighteen
      // working records as bare: an open `spellFilter` ("choose a 1st-rank arcane spell, 1/day
      // innate"), and a closed list whose chosen OPTION carries the grant (Fey Ascension's branches).
      grantsSpellViaChoice(r) ||
      SUBCLASS_OPTION_SPELLS.has(r.id),
  },
  {
    id: 'companion',
    what: 'GRANTS a companion/familiar/eidolon (not merely interacts with one)',
    /** Only records that CREATE a companion belong here. Matching the bare word "familiar" flagged
     *  386 records, of which 379 merely interact with a companion you already have (Mature Companion,
     *  Enhanced Familiar, eidolon evolutions) — all handled by the Companions UI and deliberately
     *  excluded by the earlier verify pass documented at the top of companionGrants.ts. The remaining
     *  7 were checked by hand: only `familiar` and `pet` actually grant one, and both are already
     *  registered. This lane is CLOSED, and the old count was measuring the wrong thing. */
    re: /\byou (?:gain|get|have) a (?:[a-z-]+ )?(animal companion|familiar|eidolon|pet|construct companion)\b/i,
    not: /\bif you (?:have|already have) an?\b/i,
    modelled: (r) => MODELLED.companion.has(r.id),
  },
  {
    id: 'defense',
    what: 'grants resistance, immunity, weakness or a sense',
    re: /\b(resistance \d|immunity to|immune to|weakness \d|darkvision|low-light vision|scent|tremorsense)\b/i,
    /**
     * `defenses` is the wrapper NO record actually uses; the real storage is direct fields, which is
     * also where derive.ts reads from. Checking only defenses/senses under-reported every applied
     * resistance, immunity and weakness — the mirror image of the proficiency over-count above.
     *
     * ⚠ An ITEM's defences live under `passiveEffects` and nowhere else: a top-level `resistances`
     * on an item record is read by nothing. Leaving that out reported all 58 items in this lane as
     * outstanding when 57 of them already carried the resistance, and it took an authoring pass over
     * all 58 to discover that only one was real. `modes` counts too — a defence the player toggles on
     * is modelled, just not always-on.
     */
    modelled: (r) =>
      !!r.defenses || !!r.senses || !!r.resistances || !!r.weaknesses || !!r.immunities ||
      !!r.speeds || !!r.whileActive || !!r.passiveEffects || !!r.modes,
  },
];

const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'animalCompanions', 'specificFamiliars', 'companionSpecializations', 'deities'];

/*
 * Records NO CHARACTER CAN REACH are excluded from the ledger entirely.
 *
 * Two kinds, both hidden from every picker by src/data/index.ts: an `aon-` scrape that collides by
 * name with a canonical record, and an unpriced family head with priced kin. A mechanical field on
 * either reaches nobody, so listing them as work is worse than useless — an authoring pass reads the
 * record, writes a correct entry, and the entry renders for no one. Sixty of the situational lane's
 * outstanding rows were exactly this, and the same shape produced the Ruling A regression where
 * writing `situational` onto a family head UN-HIDES it and puts a priceless duplicate in the shop.
 *
 * The rules are imported rather than re-implemented; a private copy of "what counts as hidden" is
 * how a report drifts away from the app it is reporting on.
 */
const hidden = new Set([...findDuplicateIds(db), ...findUmbrellaIds(db)]);

const ledger = [];
let excluded = 0;
for (const coll of COLLECTIONS) {
  for (const r of Object.values(db[coll] ?? {})) {
    if (hidden.has(r.id)) {
      excluded++;
      continue;
    }
    const text = String(r.description ?? '');
    const hits = [];
    for (const lane of LANES) {
      if (!lane.re.test(text)) continue;
      if (lane.not?.test(text)) continue;
      const modelled = !!lane.modelled?.(r);
      hits.push({ lane: lane.id, modelled, examined: !modelled && examinedIn(lane.id).has(r.id) });
    }
    ledger.push({ collection: coll, id: r.id, name: r.name, level: r.level ?? null, lanes: hits, noSignal: hits.length === 0 });
  }
}

/* ---- output ------------------------------------------------------------------------------- */
const laneArg = process.argv.indexOf('--lane');
const outArg = process.argv.indexOf('--out');
if (laneArg > -1) {
  const want = process.argv[laneArg + 1];
  // Only genuinely UNEXAMINED records — otherwise every re-run hands back the pile already decided.
  const rows = ledger.filter((e) => e.lanes.some((l) => l.lane === want && !l.modelled && !l.examined));
  const payload = JSON.stringify(rows, null, 1);
  if (outArg > -1) {
    const p = join(root, process.argv[outArg + 1]);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, payload);
    console.log(`${rows.length} unmodelled '${want}' records -> ${process.argv[outArg + 1]}`);
  } else console.log(payload);
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify(ledger, null, 1));
} else {
  console.log(`TRIAGED ${ledger.length} records across ${COLLECTIONS.length} collections\n`);
  const per = {};
  for (const e of ledger) for (const l of e.lanes) {
    const b = (per[l.lane] ??= { need: 0, modelled: 0, examined: 0 });
    b.need++;
    if (l.modelled) b.modelled++;
    else if (l.examined) b.examined++;
  }
  console.log(
    'LANE'.padEnd(14) + 'candidates'.padStart(11) + 'modelled'.padStart(10) + 'examined'.padStart(10) + 'TO DO'.padStart(8),
  );
  for (const lane of LANES) {
    const b = per[lane.id] ?? { need: 0, modelled: 0, examined: 0 };
    const todo = b.need - b.modelled - b.examined;
    console.log(
      lane.id.padEnd(14) + String(b.need).padStart(11) + String(b.modelled).padStart(10) +
      String(b.examined).padStart(10) + String(todo).padStart(8) + '   ' + lane.what,
    );
  }
  const noSignal = ledger.filter((e) => e.noSignal).length;
  const touched = ledger.length - noSignal;
  console.log(`\n${touched} records matched at least one lane; ${noSignal} matched none.`);
  console.log('Records matching none are NOT skipped — they are the "no mechanical signal" set and');
  console.log('get a cheap confirmation pass, so coverage is provable rather than assumed.');
  const distinct = new Set(ledger.filter((e) => !e.noSignal).map((e) => e.collection + ':' + e.id)).size;
  console.log(`\nDISTINCT records needing classification: ${distinct}`);
}
