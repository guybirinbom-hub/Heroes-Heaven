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
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
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

const outIdx = process.argv.indexOf('--out');
if (outIdx > -1 && process.argv[outIdx + 1]) {
  mkdirSync(join(root, 'work'), { recursive: true });
  writeFileSync(join(root, process.argv[outIdx + 1]), JSON.stringify(rows, null, 1));
  console.log(`wrote -> ${process.argv[outIdx + 1]}`);
}
