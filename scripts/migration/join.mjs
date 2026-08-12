/*
 * Stage 1b — build the JOIN between Heroes Heaven's core.json records and the Archives docs.
 * Read-only; writes scripts/migration/out/join.json and nothing else.
 *
 * Why this exists as its own step: the first inventory pass joined only via public/idmap.json and left
 * 3,607 of 25,344 records unmatched. idmap turns out to cover ONLY the records the importer created
 * FROM the archive — anything that was already in core.json (i.e. Foundry-sourced) and merely overlaid
 * has no idmap entry at all. So "unjoined" in pass 1 did not mean "not in the archive"; it mostly
 * meant "the importer never linked it".
 *
 * This rebuilds the join from the ARCHIVE side, the way the importer itself would:
 *   archive category --CAT_BUCKET--> HH bucket, and slug(doc.name) --> HH key,
 * using the exact CAT_BUCKET table and the exact slug() from scripts/import-core-v2.mjs. Both are
 * copied here verbatim and must not drift; a mismatch would silently reintroduce name-based matching,
 * which hard rule 4 forbids.
 *
 * Output per HH record: how it was matched (idmap | slug | none) and the archive doc id.
 * Anything still `none` after this is a REAL question for the user, not a decision for us.
 *
 * Re-runnable, idempotent, a few seconds:  node scripts/migration/join.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';

const HH = 'public/core.json';
const IDMAP = 'public/idmap.json';
const ARCHIVE = 'C:/trying ai 2/hh-data-export/without-images/data';
const OUT_DIR = 'scripts/migration/out';

// --- verbatim from scripts/import-core-v2.mjs — keep in sync ------------------------------------
const slug = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const CAT_BUCKET = {
  spell: 'spells', ritual: 'spells',
  equipment: 'items', weapon: 'items', armor: 'items', shield: 'items', relic: 'items', 'set-relic': 'items', 'class-kit': 'items',
  class: 'classes', 'class-feature': 'classFeatures', feat: 'feats',
  ancestry: 'ancestries', heritage: 'heritages', background: 'backgrounds', deity: 'deities', language: 'languages',
  action: 'actions', condition: 'conditions',
  'animal-companion': 'animalCompanions', 'animal-companion-advanced': 'animalCompanions', 'animal-companion-unique': 'animalCompanions',
  'animal-companion-specialization': 'companionSpecializations',
  'familiar-ability': 'familiarAbilities', 'familiar-specific': 'familiarAbilities',
  vehicle: 'vehicles', 'siege-weapon': 'siegeWeapons',
};
// ------------------------------------------------------------------------------------------------

/** Buckets HH authors by hand — no archive doc should ever exist for these (user-confirmed). */
const AUTHORED = new Set(['modes', 'stances', 'runes', 'services', 'followers', 'pets', 'companionAdvanced', 'specificFamiliars']);

console.log('reading…');
const core = JSON.parse(readFileSync(HH, 'utf8'));
const idmap = JSON.parse(readFileSync(IDMAP, 'utf8'));

// bucket -> slug -> archive doc id, from idmap (the importer's own record of what it created)
const fromIdmap = {};
for (const [docId, m] of Object.entries(idmap)) {
  if (m?.bucket && m?.slug) (fromIdmap[m.bucket] ??= {})[m.slug] = docId;
}

/*
 * bucket -> slug -> [archive doc ids]. An ARRAY, deliberately: several archive docs can slug to the
 * same HH key (the legacy/remaster pair, plus AoN's duplicate printings). Collapsing them here would
 * be the very "matched the wrong doc" bug that produced two wrong answers earlier — so keep every
 * candidate and let the caller see the ambiguity.
 */
const fromArchive = {};
/* …and the same thing again across ALL 93 categories, not just the 27 CAT_BUCKET names.
 * CAT_BUCKET describes where the IMPORTER draws from, which is not the same question as where a
 * record can be FOUND: AoN files class features under curse / tactic / ikon / instinct / doctrine,
 * and the traits of an action under `action` while the class-feature doc of the same name carries
 * none. Restricting the search to the mapped 27 accounted for ~1,178 of the 1,928 misses. */
const anySlug = {};
/* Third index: the slug with a trailing parenthetical removed. Heroes Heaven disambiguates same-named
 * records by appending one — `Tusks (Orc)`, `Irrepressible (Halfling)`, `Many Guises (Kitsune)` —
 * and the archive holds the bare name. Worth ~490 more. Kept as its OWN index and reported under its
 * own `how`, so a weaker match is never silently counted as an exact one. */
const noParenSlug = {};
const stripParen = (s) => String(s).replace(/\s*\([^)]*\)\s*$/, '').trim();

let archiveDocs = 0, mappedDocs = 0;
for (const f of readdirSync(ARCHIVE).filter((x) => x.endsWith('.json'))) {
  let raw;
  try { raw = JSON.parse(readFileSync(pjoin(ARCHIVE, f), 'utf8')); } catch { continue; }
  const bucket = CAT_BUCKET[raw.category];
  for (const [numericId, doc] of Object.entries(raw.docs || {})) {
    if (!doc?.name) continue;
    archiveDocs++;
    const entry = {
      /*
       * The export keys docs by their FULL id already ("equipment-22819"), so prefixing the category
       * again produced "equipment-equipment-22819" — an id that resolves against nothing. It affected
       * 1,860 records: every one matched by a slug rule rather than by idmap, and every one of them
       * silently failed to resolve in the importer, which then fell back to slug dedup.
       * Guarded rather than blindly changed, in case a future export ever keys by the bare number.
       */
      id: String(numericId).startsWith(`${raw.category}-`) ? String(numericId) : `${raw.category}-${numericId}`,
      category: raw.category,
      edition: doc.edition ?? null,
      superseded: !!doc.superseded_by,
      excluded: !!doc.exclude_from_search,
    };
    const key = slug(doc.name);
    (anySlug[key] ??= []).push(entry);
    const bare = slug(stripParen(doc.name));
    if (bare && bare !== key) (noParenSlug[bare] ??= []).push(entry);
    if (bucket) { mappedDocs++; ((fromArchive[bucket] ??= {})[key] ??= []).push(entry); }
  }
}
console.log(`archive docs: ${archiveDocs} total, ${mappedDocs} in CAT_BUCKET-mapped categories`);

// ---------------------------------------------------------------- join
const out = { matched: {}, unmatched: {}, summary: {} };
const tally = { records: 0, idmap: 0, slug: 0, 'slug-any': 0, 'slug-noparen': 0, authored: 0, none: 0 };

/** Prefer a live doc over a superseded or hidden one; alternatives stay visible via `candidates`. */
const best = (cands) => cands.find((c) => !c.superseded && !c.excluded) ?? cands[0];

for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  const byIdmap = fromIdmap[bucket] || {};
  const byArch = fromArchive[bucket] || {};
  const s = { records: 0, idmap: 0, slug: 0, 'slug-any': 0, 'slug-noparen': 0, none: 0, ambiguous: 0 };

  for (const key of Object.keys(records)) {
    const rec = records[key];
    if (!rec || typeof rec !== 'object') continue;
    tally.records++; s.records++;

    if (AUTHORED.has(bucket)) { tally.authored++; continue; } // expected, not a gap

    // Cascade, strongest evidence first. `how` records which rung matched so a weak match is never
    // mistaken for a strong one downstream.
    let hit = null;
    if (byIdmap[key]) hit = { docId: byIdmap[key], how: 'idmap' };
    if (!hit && byArch[key]?.length) {
      const c = byArch[key]; hit = { docId: best(c).id, how: 'slug', candidates: c.length };
    }
    if (!hit && anySlug[key]?.length) {
      const c = anySlug[key]; const b = best(c);
      hit = { docId: b.id, how: 'slug-any', category: b.category, candidates: c.length };
    }
    if (!hit && rec.name) {
      const bare = slug(stripParen(rec.name));
      const c = (bare && (anySlug[bare] || noParenSlug[bare])) || null;
      if (c?.length) {
        const b = best(c);
        hit = { docId: b.id, how: 'slug-noparen', category: b.category, candidates: c.length };
      }
    }

    if (hit) {
      (out.matched[bucket] ??= {})[key] = hit;
      tally[hit.how]++; s[hit.how]++;
      if (hit.candidates > 1) s.ambiguous++;
    } else {
      (out.unmatched[bucket] ??= []).push({ key, name: rec.name ?? null });
      tally.none++; s.none++;
    }
  }
  out.summary[bucket] = s;
}

out.totals = tally;
let none = tally.none, viaIdmap = tally.idmap, viaSlug = tally.slug, authored = tally.authored;

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(pjoin(OUT_DIR, 'join.json'), JSON.stringify(out, null, 1));

console.log('\n--- join ---');
console.log('records                    ', tally.records);
console.log('  via idmap                ', tally.idmap);
console.log('  via slug (mapped cat)    ', tally.slug);
console.log('  via slug (any category)  ', tally['slug-any']);
console.log('  via slug minus "(…)"     ', tally['slug-noparen']);
console.log('  hand-authored, no doc    ', tally.authored);
console.log('  STILL UNMATCHED          ', tally.none);
console.log('\nstill unmatched, by bucket:');
for (const [b, list] of Object.entries(out.unmatched)) console.log(`  ${b.padEnd(22)} ${list.length}`);
console.log(`\nwrote ${OUT_DIR}/join.json`);
