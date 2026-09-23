/*
 * CLASS FEATURE TABLES, diffed against the AoN mirror — levels 2 through 20.
 *
 * The verification sweep checks level-1 ground truth because that is what the mirror's STRUCTURED
 * fields carry. But its markdown tags every class-feature heading with the level it arrives at:
 *
 *   <title level="3" right="Level 7">Perpetual Infusions</title>
 *
 * so the whole advancement table is there after all, and "levels 2-20 can only be checked against
 * invariants" was wrong.
 *
 * Reports, per class: features the mirror has and the app does not, and features whose LEVEL
 * disagrees.
 *
 *   node scripts/class-table-diff.mjs
 *   node scripts/class-table-diff.mjs --out work/class-table-diff.json
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/class';
const db = JSON.parse(readFileSync(join(root, 'public/core.json'), 'utf8'));

const slug = (s) =>
  String(s).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Headings that are not class features: the generic progression rows every class shares. */
const NOT_A_FEATURE = new Set([
  'ability-boosts', 'attribute-boosts', 'skill-increases', 'skill-increase', 'general-feats',
  'skill-feats', 'ancestry-feats', 'class-feats', 'ancestry-feats-and-class-feats', 'ability-boost',
  'attribute-boost', 'general-feat', 'skill-feat', 'ancestry-feat', 'class-feat', 'bonus-feats',
]);
/** "Bard Feats", "Wizard Feats" — the feat-progression row, not a feature. */
const isFeatRow = (fid) => /-feats?$/.test(fid);

/**
 * AoN's heading name → the id the app uses for the same row.
 *
 * PF2e gives the same proficiency bump a different flavour name in each class — Lightning Reflexes,
 * Vigilant Senses, Resolve, Juggernaut, Alertness — while the app names every one after the stat it
 * moves. Each of these was checked by building a character and reading the resulting rank, not
 * assumed: an inventor's Will reaches master at 11 (Resolve) and Fortitude at 17 (Juggernaut), and a
 * thaumaturge's Perception reaches master at 9. Nothing here hides a number that disagrees; a level
 * mismatch would still be reported, because the level comes from the app's own table either way.
 */
const ALIASES = {
  'lightning-reflexes': ['reflex-expertise', 'reflex-mastery'],
  'evasion': ['reflex-expertise', 'reflex-mastery'],
  'improved-evasion': ['reflex-mastery', 'reflex-legend'],
  'juggernaut': ['fortitude-expertise', 'fortitude-mastery'],
  'great-fortitude': ['fortitude-expertise'],
  'resolve': ['will-expertise', 'will-mastery'],
  'greater-resolve': ['will-mastery', 'will-legend'],
  'iron-will': ['will-expertise'],
  'alertness': ['perception-expertise'],
  'vigilant-senses': ['perception-mastery'],
  'incredible-senses': ['perception-legend'],
  'perception-expertise': ['perception-mastery'],
  /*
   * IMPOSSIBLE MAGIC RENAMED THREE MAGUS ROWS, and the three aliases that used to sit here —
   * twofold-will -> resolve, spell-tempered-body -> juggernaut, perception-expertise -> alertness —
   * are GONE, because the rows themselves moved. The magus table now names `twofold-will`,
   * `spell-tempered-body` and `perception-expertise-magus`, built from class-feature-1274 / -1278 /
   * -1273, which are the Magus's own Impossible Magic pages.
   *
   * The claim that stood here — that renaming the rows "would silently drop the magus's Will-master
   * and Fortitude-master bumps" — was wrong. The bumps come from CLASS_ADVANCEMENT in
   * src/rules/advancement.ts, which is keyed by class id and fires at its own level whatever the
   * table names; `source` there is a label for the explain timeline and for class-archetype
   * suppression, not a lookup into `features`. Both new records carry the degreeShift the old ones
   * did, so the success-to-critical-success upgrade moved with them.
   *
   * The SUMMONER's row keeps its alias, and the id behind it moved too: class-feature-1346 is titled
   * "Signature Spells" and the app now ships it as `signature-spells-summoner` — this database's own
   * shape for one class's copy of a shared feature, and the id `sigAvailable` in src/rules/build.ts
   * matches. `unlimited-signature-spells` (class-feature-455, Secrets of Magic) is retired.
   */
  'signature-spells': ['signature-spells-summoner'],
  /** AoN prints the magus row singular; the record and the table are plural. */
  'studious-spell': ['studious-spells'],
  'weapon-mastery': ['martial-weapon-mastery'],
  'premonitions-reflexes': ['premonition-reflexes'],
  'second-skin': ['light-armor-mastery', 'medium-armor-mastery'],
  'trackless-step': ['trackless-journey'],
  'wild-stride': ['unimpeded-journey'],
};

/** The rank bumps to MASTER — see the comment at the check below for why these are skipped. */
const MASTERY_ROWS = new Set(['juggernaut', 'resolve', 'greater-resolve', 'improved-evasion', 'incredible-senses', 'vigilant-senses']);

const mirrorClasses = new Map();
for (const f of readdirSync(MIRROR)) {
  const j = JSON.parse(readFileSync(join(MIRROR, f), 'utf8'));
  if (!j.name || j.type !== 'Class') continue;
  const md = (j._source && j._source.markdown) || j.markdown || '';
  const prev = mirrorClasses.get(slug(j.name));
  /*
   * The legacy and remaster halves of a class BOTH exist in the mirror, and a record carrying
   * `remaster_id` is the legacy one (it points forward to its replacement). Preferring the longer
   * markdown picked the LEGACY alchemist and reported Perpetual Infusions / Potency / Perfection as
   * missing — they are not missing, the Remaster replaced them with Advanced and Abundant Vials, and
   * the app models the remaster class correctly.
   */
  const isRemaster = !j.remaster_id;
  if (!prev || (isRemaster && !prev.remaster) || (isRemaster === prev.remaster && md.length > prev.md.length)) {
    mirrorClasses.set(slug(j.name), { name: j.name, md, remaster: isRemaster });
  }
}

const rows = [];
for (const [id, cls] of Object.entries(db.classes ?? {})) {
  const m = mirrorClasses.get(id) ?? mirrorClasses.get(slug(cls.name));
  if (!m) {
    rows.push({ classId: id, error: 'no mirror record' });
    continue;
  }
  const printed = new Map();
  for (const match of m.md.matchAll(/<title[^>]*\bright="Level (\d+)"[^>]*>([^<]+)<\/title>/g)) {
    const level = Number(match[1]);
    const name = match[2].trim();
    const fid = slug(name);
    if (NOT_A_FEATURE.has(fid) || isFeatRow(fid)) continue;
    if (!printed.has(fid) || printed.get(fid).level > level) printed.set(fid, { name, level });
  }
  const app = new Map();
  for (const f of cls.features ?? []) {
    if (!app.has(f.featureId) || app.get(f.featureId) > f.level) app.set(f.featureId, f.level);
  }

  const missing = [];
  const levelMismatch = [];
  for (const [fid, { name, level }] of printed) {
    // The app may name the feature with a class suffix (`medium-armor-expertise-inventor`) or hold
    // only per-subclass variants — both count as present.
    const suffixed = `${fid}-${id}`;
    const variant = [...app.entries()].find(([k]) => k.startsWith(`${fid}-`))?.[1];
    // The app names a proficiency bump after the stat it moves; AoN names it after the class's own
    // flavour word. Try the aliases, and their class-suffixed forms, before calling it missing.
    const aliased = (ALIASES[fid] ?? [])
      .flatMap((a) => [app.get(a), app.get(`${a}-${id}`), app.get(`${id}-${a}`)])
      .find((v) => v != null);
    // `psychic-weapon-specialization` — the class name in FRONT, the mirror image of the `-inventor`
    // suffix form already tried above.
    const appLevel = app.get(fid) ?? app.get(suffixed) ?? app.get(`${id}-${fid}`) ?? aliased ?? variant;
    /*
     * A rank bump to MASTER has no named row anywhere in this data: `fortitude-expertise` and its
     * siblings exist and are listed, `fortitude-mastery` and its siblings do not exist for any of the
     * 27 classes. The rank still moves — an inventor's Fortitude is master at 17, checked by building
     * one — so this is a naming convention, not a missing mechanic, and inventing 27 records to
     * satisfy the diff would be worse than saying so here.
     */
    const isMasteryRow = appLevel == null && MASTERY_ROWS.has(fid);
    if (isMasteryRow) continue;
    if (appLevel == null) {
      missing.push({ id: fid, name, level, recordExists: !!db.classFeatures[fid] });
    } else if (appLevel !== level) {
      levelMismatch.push({ id: fid, name, mirror: level, app: appLevel });
    }
  }
  rows.push({ classId: id, printed: printed.size, inApp: app.size, missing, levelMismatch });
}

let totalMissing = 0;
let totalMismatch = 0;
for (const r of rows) {
  if (r.error) {
    console.log(`${r.classId.padEnd(15)} ${r.error}`);
    continue;
  }
  totalMissing += r.missing.length;
  totalMismatch += r.levelMismatch.length;
  if (!r.missing.length && !r.levelMismatch.length) continue;
  console.log(`\n${r.classId}  (mirror ${r.printed}, app ${r.inApp})`);
  for (const x of r.missing) {
    console.log(`   missing  L${String(x.level).padStart(2)}  ${x.id}${x.recordExists ? '   [record exists]' : '   (no record)'}`);
  }
  for (const x of r.levelMismatch) console.log(`   level    ${x.id}: mirror ${x.mirror}, app ${x.app}`);
}
const withRecord = rows.flatMap((r) => r.missing ?? []).filter((x) => x.recordExists).length;
console.log(`\nTOTAL: ${totalMissing} features missing from a class table, ${totalMismatch} at the wrong level`);
console.log(`(of those missing, ${withRecord} already have a classFeatures record — those are orphans this explains)`);

/*
 * …AND EVERY ROW MUST OPEN A PAGE OF ITS OWN CLASS.
 *
 * "The row exists at the right level" is not the whole question. PF2e gives 25 classes a row called
 * "Weapon Expertise" and the app shipped ONE record for it, on whichever class's document won the
 * slug — so a magus clicking Weapon Expertise at 5th read the THAUMATURGE's page, Expert and Master
 * Spellcaster the PSYCHIC's, and three magus rows still read Alertness / Resolve / Juggernaut and
 * opened Inventor, Inventor and Barbarian pages. Nothing said so, because every one of them is
 * "present at the right level".
 *
 * ⚠ ENFORCED FOR FOUR CLASSES, MEASURED FOR ALL OF THEM. Splitting the rest is its own batch, so the
 * rest is COUNTED AND PRINTED on every run rather than written into this comment as a number: a
 * sentence goes stale silently and a printed count cannot. (The first draft of this comment claimed
 * 187 of 567 across 29 classes; the instrument says 154 across 25, with 25 rows it cannot resolve.)
 * Widen OWN_PAGE_CLASSES as the split lands and the printed figure falls on its own.
 */
const OWN_PAGE_CLASSES = { magus: 'Magus', summoner: 'Summoner', necromancer: 'Necromancer', runesmith: 'Runesmith' };
const CF_EXPORT = join(process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data', 'class-feature.json');
const foreign = [];
let checkedRows = 0;
if (existsSync(CF_EXPORT)) {
  const cfDocs = JSON.parse(readFileSync(CF_EXPORT, 'utf8')).docs ?? {};
  for (const [classId, className] of Object.entries(OWN_PAGE_CLASSES)) {
    for (const row of db.classes?.[classId]?.features ?? []) {
      const rec = db.classFeatures?.[row.featureId];
      if (!rec) { foreign.push(`${classId} L${row.level} ${row.featureId} — no classFeatures record`); continue; }
      const doc = rec.aonId ? cfDocs[String(rec.aonId)] : null;
      if (!doc) { foreign.push(`${classId} L${row.level} ${row.featureId} — aonId ${rec.aonId ?? '(none)'} is not a class-feature document`); continue; }
      checkedRows++;
      const dc = doc.data?.class ?? doc.class ?? null;
      if (dc !== className) foreign.push(`${classId} L${row.level} ${row.featureId} -> ${rec.aonId} "${doc.name}" is class ${JSON.stringify(dc)} (${doc.book})`);
    }
  }
  console.log(`\nown-page rows checked: ${checkedRows} across ${Object.keys(OWN_PAGE_CLASSES).length} classes; ${foreign.length} open a document of another class`);
  for (const f of foreign) console.log(`   ${f}`);

  /* The same question asked of EVERY class, report-only — the batch this lane did not take. */
  let allRows = 0, allOwn = 0, allForeign = 0, allUnresolved = 0;
  const foreignClasses = new Set();
  for (const [classId, cls] of Object.entries(db.classes ?? {})) {
    for (const row of cls.features ?? []) {
      allRows++;
      const doc = db.classFeatures?.[row.featureId]?.aonId ? cfDocs[String(db.classFeatures[row.featureId].aonId)] : null;
      const dc = doc ? (doc.data?.class ?? doc.class ?? null) : null;
      if (dc == null) { allUnresolved++; continue; }
      if (String(dc).toLowerCase() === String(cls.name).toLowerCase()) allOwn++;
      else { allForeign++; foreignClasses.add(classId); }
    }
  }
  console.log(`corpus-wide (report only): ${allRows} rows — ${allOwn} own-class, ${allForeign} FOREIGN across `
    + `${foreignClasses.size} classes, ${allUnresolved} unresolvable`);
} else {
  console.log('\nown-page check SKIPPED: no AoN export at ' + CF_EXPORT);
}

/*
 * …AND EVERY ROW MUST BE A RECORD THE BUILDER CAN SEE.
 *
 * `applyEditionFilter` (src/rules/build.ts) drops `edition: 'superseded'` from the Builder's content
 * ALWAYS — not when "Hide legacy data" is on, always — and `levelGrants` then falls back to
 * `content.classFeatures[id]?.name ?? f.featureId`. A class table naming a superseded record therefore
 * prints the RAW SLUG with no Details button, and nothing was red: a level-1 runesmith's page read
 * `shield-block-runesmith`, and a necromancer's `reflex-expertise-necromancer`. Seventeen rows, on the
 * three classes whose per-class records happened to pass through the importer branch that stamps it.
 *
 * Corpus-wide, not scoped to four classes: the branch that can do this is shared by all 29.
 */
const unreadable = [];
for (const [classId, cls] of Object.entries(db.classes ?? {})) {
  for (const row of cls.features ?? []) {
    const rec = db.classFeatures?.[row.featureId];
    if (rec?.edition === 'superseded') unreadable.push(`${classId} L${row.level} ${row.featureId} — edition "superseded"`);
  }
}
console.log(`class-table rows the Builder would print as a raw slug: ${unreadable.length}`);
for (const u of unreadable) console.log(`   ${u}`);

/*
 * …AND THE CLASS-DETAILS POPUP MUST NAME THE SAME FEATURES AS THE TABLE IT SITS BESIDE.
 *
 * The class picker feeds `c.description` into a popup (src/builder/shared.tsx), and that prose carries
 * its own advancement table. For the magus the two came from different printings: the table was Secrets
 * of Magic's ("Arcane Spellcasting (Magus)", "Lightning Reflexes", "Alertness, Resolve", "Juggernaut")
 * while the Builder's level rows next to it read the Impossible Magic reprints ("Magus Spellcasting",
 * "Reflex Expertise", "Perception Expertise", "Twofold Will", "Spell-Tempered Body"). One screen, two
 * rulebooks, and every other check in this file passed because both halves were internally consistent.
 *
 * EVERY pipe table on the page is read, not the last one: an AoN class page prints the feature table
 * AND the spells-per-day table and both key their first column "Your Level", so reading one map loses
 * the other. A page with no table at all has nothing to disagree with — except for the four classes
 * below, where a missing table would be this check quietly passing on nothing.
 *
 * ⚠ RATCHET, NOT AN ALLOWANCE, for the other classes. Seven of them still carry the Foundry-era
 * transcription's table, written before the Remaster renamed the rows (Weapon Mastery -> Martial Weapon
 * Mastery, Alertness -> Perception Mastery, the alchemist's whole level-1 line). Regenerating those
 * seven from their own AoN pages is its own batch; until then the count may fall and may never rise.
 */
const DESC_FILE = join(root, 'public/core-descriptions.json');
const classDescs = existsSync(DESC_FILE) ? (JSON.parse(readFileSync(DESC_FILE, 'utf8')).classes ?? {}) : {};
const DESC_TABLE_RATCHET = { alchemist: 4, champion: 3, investigator: 3, kineticist: 4, ranger: 1, swashbuckler: 2, witch: 4 };
const flatName = (s) => String(s).toLowerCase().replace(/\(level \d+\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const descMiss = {};
const noTable = [];
for (const [classId, cls] of Object.entries(db.classes ?? {})) {
  const prose = classDescs[classId]?.d ?? cls.description ?? '';
  const byLevel = {};
  for (const m of prose.matchAll(/^\|\s*(\d+)\s*\|([^|]*)\|/gm)) byLevel[Number(m[1])] = `${byLevel[Number(m[1])] ?? ''} ${m[2]}`;
  if (!Object.keys(byLevel).length) { if (OWN_PAGE_CLASSES[classId]) noTable.push(classId); continue; }
  for (const row of cls.features ?? []) {
    const name = db.classFeatures?.[row.featureId]?.name ?? row.featureId;
    const hay = flatName(byLevel[row.level] ?? '');
    // The record's own "(Summoner)"-style disambiguator is not in the printed table, so try both.
    if (hay.includes(flatName(name)) || hay.includes(flatName(String(name).replace(/\s*\([^)]*\)\s*$/, '')))) continue;
    (descMiss[classId] ??= []).push(`L${row.level} ${row.featureId} "${name}"`);
  }
}
const ownDescMiss = Object.entries(descMiss).filter(([c]) => OWN_PAGE_CLASSES[c]);
const overRatchet = Object.entries(descMiss).filter(([c, list]) => !OWN_PAGE_CLASSES[c] && list.length > (DESC_TABLE_RATCHET[c] ?? 0));
console.log(`class-description tables: ${Object.keys(db.classes ?? {}).length} classes, `
  + `${Object.values(descMiss).reduce((n, l) => n + l.length, 0)} row(s) the popup's table does not name `
  + `(${ownDescMiss.length} on an Impossible Magic class, ratchet ${Object.values(DESC_TABLE_RATCHET).reduce((a, b) => a + b, 0)})`);
for (const [c, list] of Object.entries(descMiss)) console.log(`   ${c}: ${list.join('; ')}`);

const outIdx = process.argv.indexOf('--out');
if (outIdx > -1 && process.argv[outIdx + 1]) {
  mkdirSync(join(root, 'work'), { recursive: true });
  writeFileSync(join(root, process.argv[outIdx + 1]), JSON.stringify(rows, null, 1));
  console.log(`wrote -> ${process.argv[outIdx + 1]}`);
}

/*
 * …AND IT FAILS. This ran in `npm run verify` reporting divergences and exiting 0, which means it
 * could never turn a build red: the 2026-09 Impossible Magic refresh put five rows in this list and
 * the chain stayed green through every run of that lane. A guard that cannot go red is a report.
 *
 * It exits 0 today because all five resolve through ALIASES above (the rows are present, under the
 * name the app has always used). Anything left is a class table the Archives print and the app does
 * not build — a level the player reaches and gains nothing at.
 */
if (unreadable.length) {
  console.error('\nclass-table-diff: FAIL — a class table names a record the Builder filters out.');
  console.error('   `applyEditionFilter` drops edition "superseded" unconditionally, so the row renders as its id');
  console.error('   with no Details button. Repair the record\'s edition at its source, not the filter.');
  process.exit(1);
}

if (noTable.length || ownDescMiss.length || overRatchet.length) {
  console.error('\nclass-table-diff: FAIL — the class-details popup and the class table name different features.');
  for (const c of noTable) console.error(`   ${c}: its description carries NO advancement table, so this check has nothing to read`);
  for (const [c, list] of ownDescMiss) console.error(`   ${c}: ${list.length} row(s) the table does not name — ${list.join('; ')}`);
  for (const [c, list] of overRatchet) console.error(`   ${c}: ${list.length} row(s), above its ratchet of ${DESC_TABLE_RATCHET[c] ?? 0}`);
  console.error('   Repair: regenerate that class\'s description from its own AoN class document —');
  console.error('   work/new-classes/<id>.json with "descriptionsOnly": true, applied by scripts/import-new-classes.mjs.');
  process.exit(1);
}

if (foreign.length) {
  console.error('\nclass-table-diff: FAIL — a class table row opens another class\'s page.');
  console.error('   The row is present and at the right level; what the player READS is a different class\'s rules.');
  console.error('   Repair: give the row its own record from that class\'s own document —');
  console.error('   buildImClassFeatures() in scripts/import-siege-and-gaps.mjs does it from the printed table.');
  process.exit(1);
}

if (totalMissing || totalMismatch || rows.some((r) => r.error)) {
  console.error('\nclass-table-diff: FAIL — a class table disagrees with the Archives.');
  console.error('   A row the mirror prints and the app has no feature for is a level the player gains nothing at.');
  console.error('   Repair: add the row to that class\'s `features` (and its proficiency label in');
  console.error('   src/rules/advancement.ts when the row moves a rank), or — when only the NAME moved —');
  console.error('   record that in ALIASES above with the printing that renamed it.');
  process.exit(1);
}
