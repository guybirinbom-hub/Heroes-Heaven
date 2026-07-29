/*
 * TRIAGE — step 0 of the "every record must actually work" pass.
 *
 * Assigns EVERY player-facing record to one or more mechanical LANES based on its own rules text,
 * plus what the app already models for it. Deterministic and re-runnable: no judgement here, just
 * signal detection, so the set handed to the (expensive, verified) classification pass is auditable
 * and nothing is silently skipped. Records with NO detected signal are reported too, with a count,
 * so "we looked at everything" is a checkable statement rather than a promise.
 *
 *   node scripts/triage-mechanics.mjs            # summary
 *   node scripts/triage-mechanics.mjs --json     # full per-record ledger (large)
 *   node scripts/triage-mechanics.mjs --lane choice --out work/lane-choice.json
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const db = JSON.parse(read('public/core.json'));

/* ---- what the app ALREADY models, so triage can mark a record done ------------------------- */
const idsIn = (p) => {
  try { return new Set([...read(p).matchAll(/["']?([a-z0-9]+(?:-[a-z0-9]+)+)["']?\s*:/g)].map((m) => m[1])); }
  catch { return new Set(); }
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

const MODELLED = {
  choice: new Set([
    ...idsIn('src/rules/featPickGrants.ts'),
    ...idsIn('src/rules/featCantripGrants.ts'),
  ]),
  grantsFeat: idsIn('src/rules/featFeatGrants.ts'),
  proficiency: new Set([...idsIn('src/rules/featGrants.ts'), ...idsIn('src/rules/featGrantsAuto.ts')]),
  companion: idsIn('src/rules/companionGrants.ts'),
  situational: idsIn('src/rules/situationalBonuses.ts'),
};

/* ---- lane signals ------------------------------------------------------------------------- */
// Ordered: the FIRST matching lane is the record's primary lane, but all matches are recorded.
const LANES = [
  {
    id: 'choice',
    what: 'asks the player to pick something at build time',
    re: /\b(choose|select|pick)\s+(an?|one|two|three|up to|\d+)\b/i,
    not: /\b(choose|select|pick)\s+(a target|one target|a creature|an? adjacent|a square|a direction|a point|a spot|an enemy|an ally|any number)/i,
    modelled: (r) => !!r.choice || MODELLED.choice.has(r.id),
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
      // backgrounds carry their own training fields
      !!r.trainedSkills || !!r.trainedLore || !!r.trainedLoreChoice || !!r.trainedSkillChoice ||
      // class features are advanced by the class pipeline, not by any registry
      CLASS_FEATURE_IDS.has(r.id),
  },
  {
    id: 'resource',
    what: 'a limited-use pool or per-day/per-hour counter',
    re: /\b(once per (?:day|hour|minute|round|turn)|(?:\d+|one|two|three) times? per (?:day|hour)|you can use this (?:ability|feat|action) only once)\b/i,
    modelled: (r) => !!r.frequency || !!r.uses || !!r.counters,
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
      SUBCLASS_OPTION_SPELLS.has(r.id),
  },
  {
    id: 'companion',
    what: 'grants or upgrades a companion/familiar/eidolon',
    re: /\b(animal companion|familiar|eidolon|construct companion)\b/i,
    modelled: (r) => MODELLED.companion.has(r.id),
  },
  {
    id: 'defense',
    what: 'grants resistance, immunity, weakness or a sense',
    re: /\b(resistance \d|immunity to|immune to|weakness \d|darkvision|low-light vision|scent|tremorsense)\b/i,
    /** `defenses` is the wrapper NO record actually uses; the real storage is direct fields, which is
     *  also where derive.ts reads from. Checking only defenses/senses under-reported every applied
     *  resistance, immunity and weakness — the mirror image of the proficiency over-count above. */
    modelled: (r) =>
      !!r.defenses || !!r.senses || !!r.resistances || !!r.weaknesses || !!r.immunities ||
      !!r.speeds || !!r.whileActive,
  },
];

const COLLECTIONS = ['feats', 'classFeatures', 'items', 'heritages', 'ancestries', 'backgrounds', 'animalCompanions', 'specificFamiliars', 'companionSpecializations', 'deities'];

const ledger = [];
for (const coll of COLLECTIONS) {
  for (const r of Object.values(db[coll] ?? {})) {
    const text = String(r.description ?? '');
    const hits = [];
    for (const lane of LANES) {
      if (!lane.re.test(text)) continue;
      if (lane.not?.test(text)) continue;
      hits.push({ lane: lane.id, modelled: !!lane.modelled?.(r) });
    }
    ledger.push({ collection: coll, id: r.id, name: r.name, level: r.level ?? null, lanes: hits, noSignal: hits.length === 0 });
  }
}

/* ---- output ------------------------------------------------------------------------------- */
const laneArg = process.argv.indexOf('--lane');
const outArg = process.argv.indexOf('--out');
if (laneArg > -1) {
  const want = process.argv[laneArg + 1];
  const rows = ledger.filter((e) => e.lanes.some((l) => l.lane === want && !l.modelled));
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
    const b = (per[l.lane] ??= { need: 0, modelled: 0 });
    b.need++; if (l.modelled) b.modelled++;
  }
  console.log('LANE'.padEnd(14) + 'candidates'.padStart(11) + 'modelled'.padStart(10) + 'TO DO'.padStart(8));
  for (const lane of LANES) {
    const b = per[lane.id] ?? { need: 0, modelled: 0 };
    console.log(lane.id.padEnd(14) + String(b.need).padStart(11) + String(b.modelled).padStart(10) + String(b.need - b.modelled).padStart(8) + '   ' + lane.what);
  }
  const noSignal = ledger.filter((e) => e.noSignal).length;
  const touched = ledger.length - noSignal;
  console.log(`\n${touched} records matched at least one lane; ${noSignal} matched none.`);
  console.log('Records matching none are NOT skipped — they are the "no mechanical signal" set and');
  console.log('get a cheap confirmation pass, so coverage is provable rather than assumed.');
  const distinct = new Set(ledger.filter((e) => !e.noSignal).map((e) => e.collection + ':' + e.id)).size;
  console.log(`\nDISTINCT records needing classification: ${distinct}`);
}
