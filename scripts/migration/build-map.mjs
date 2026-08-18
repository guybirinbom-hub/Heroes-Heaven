/*
 * Stage 2a — collapse every intermediate result into ONE authoritative map.
 *
 * Stage 1 produced five files, each answering part of the question "where does this Heroes Heaven
 * record come from". Everything after this — sub-block extraction, table extraction, stamping archive
 * ids into core.json, deleting the Foundry base — reads exactly one file: out/map.json.
 *
 * Every HH record gets exactly one status:
 *   doc       — has its own archive document                       (docId)
 *   subblock  — is a section inside another document               (parentDocId)
 *   table     — is a row in a table inside another document        (parentDocId)
 *   scraped   — came from the targeted #220 Crypt of Runes fetch    (docId, out/scraped/)
 *   authored  — hand-written Heroes Heaven content, no archive doc  (user-confirmed: modes/runes/stances)
 *   drop      — user decided to remove it (Foundry-only content)
 *   open      — still unknown; MUST be empty before stage 2 proceeds
 *
 * Re-runnable and idempotent.  node scripts/migration/build-map.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { join as pjoin } from 'node:path';

const OUT = 'scripts/migration/out';
const read = (f) => JSON.parse(readFileSync(pjoin(OUT, f), 'utf8'));

const core = JSON.parse(readFileSync('public/core.json', 'utf8'));
const joinRes = read('join.json');
const located = read('located.json');
const resolved = read('resolved.json');
const dropLoot = read('drop-adventure-loot.json');
const variants = read('variant-items.json');
/*
 * Stage 2b feedback. `locate.py` (FTS) ran before the book-scoped matcher, so its weak full-text
 * guesses claimed records the strong rules never got to see — `Vindicator's Judgment` was filed as a
 * SECTION of "Vindicator's Judgement", `Norns` under "Norn". Extraction is the arbiter: a real section
 * extracts, a page that merely mentions the word does not. `reclassify.py` re-runs the strong rules
 * over every extraction failure, so its verdict OVERRIDES the FTS guess below.
 */
const reclass = (() => { try { return read('reclassified.json'); } catch { return { reclassified: {} }; } })();
/*
 * Also from stage 2b: records whose "section" turned out to be the ENTIRE parent document, with a
 * matching name. They are not sections of anything — they ARE that document under a slightly different
 * spelling. `Discomfiting Whispers` is the spell `Discomfiting Whisper` (spell-2139); the user
 * confirmed that one themselves by searching their Archives app.
 */
const isDoc = (() => { try { return read('is-really-the-doc.json'); } catch { return []; } })();
/*
 * GROUND TRUTH, written by import-core-v2.mjs: the archive doc each record was ACTUALLY built from.
 * It outranks every rule below, because a record's provenance is where its values came from, not where
 * a matching rule thinks they should have come from. The two diverge on purpose: preferBase() re-binds
 * a family summary to its base page, and the exclude_from_search guard keeps a visible doc over the
 * hidden one idmap happens to name (that is how `Knockdown` and `envision` went missing).
 */
const usedDocs = (() => { try { return read('used-docs.json'); } catch { return {}; } })();

/** Buckets Heroes Heaven authors by hand — user-confirmed these stay and have no archive doc. */
const AUTHORED = new Set(['modes', 'stances', 'runes', 'services', 'followers', 'pets', 'companionAdvanced', 'specificFamiliars']);

/*
 * The six size traits. Verified in stage 1b: the Archives hold 907 `trait` docs and ZERO size traits —
 * AoN treats size as a rules concept, not a trait page, while Heroes Heaven models it as a trait.
 * They are listed by key because every automated pass finds a plausible WRONG home for them: `Tiny`
 * matched a bulk-conversion table row ("Size of Creature | Bulk | Tiny | 1"), `Medium` matched a class
 * sample. There is nothing to join to, so they are hand-authored HH content and stay that way.
 */
const AUTHORED_TRAIT_KEYS = new Set(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);

/*
 * The ~27 records verified absent from the Archives by full substring scan, which the user chose to
 * drop for the same reason as the adventure loot: one-off adventure / Society-scenario content, not
 * character-building material, and present only because Foundry ships it.
 */
const DROP_ABSENT = new Set([
  'Battle-Trained Human (BB)', 'Warden Human (BB)',
  'The Curtain Call', 'Atheists and Free Agents',
  'Magic Carpet', 'Sandsailer',
  'Anima Invocation (Modified)', 'Aspirational State', 'Destroy Mindscape', 'Rite of Cleansing Flame', 'Unfettered Mark',
  "Anvil's Hardness", 'Churning Mind', 'Echoes of the Scrolls', 'Echoes of the Swords',
  'Lotus Above the Wind', 'Construct Dynamo', 'Autonomic Psychic Action',
  /*
   * `Alocer` — the only record of Pathfinder One-Shot #2: Dinner at Lionlodge. It IS on live AoN as
   * `deity-732`, and our local Archives snapshot simply predates it (717 deities to `deity-731`; live
   * has 718). It was briefly recovered by a targeted fetch, then dropped again: the user decided that
   * book not being included is fine. Do not re-add it without asking.
   */
  'Mirror-Trickery', 'Activate Resonant Reflection', 'Alocer',
  // Book #221 Into the Apocalypse Archive — AoN never published it (0 hits on the live index).
  'Apocalypse Seed', "Belimarius's Invidious Halberd", 'Robes of Xin-Edasseril', 'Runewell of Lust',
  "Sorshen's Scintillating Garment", "Sorshen's Sinuous Guisarme", 'Timeflaying Blade',
]);

/*
 * Records Heroes Heaven GENERATES from one archive feature — it names per-element or per-instance
 * things the Archives keeps as a single page. Not missing, not sub-blocks: derived. Each maps to the
 * parent it is generated from, all verified against aon.db.
 */
const DERIVED = {
  // Kinetic Gate (class-feature-596) -> one record per element
  'Air Gate': 'class-feature-596', 'Fire Gate': 'class-feature-596', 'Earth Gate': 'class-feature-596',
  'Water Gate': 'class-feature-596', 'Wood Gate': 'class-feature-596',
  // Gate's Threshold (class-feature-606) -> one record per instance
  "Second Gate's Threshold": 'class-feature-606', "Third Gate's Threshold": 'class-feature-606',
  "Fourth Gate's Threshold": 'class-feature-606',
  // barbarian instincts: HH appends " Instinct"
  'Decay Instinct': 'instinct-15', 'Ligneous Instinct': 'instinct-16',
  // "Deviant Classifications" is one rules page (rules-1723); HH makes one record per classification
  'Blight Soul Deviant Classification': 'rules-1723', 'Dragon Deviant Classification': 'rules-1723',
  'Flicker Deviant Classification': 'rules-1723', 'Leech Deviant Classification': 'rules-1723',
  'Troll Deviant Classification': 'rules-1723', 'Verdant Core Deviant Classification': 'rules-1723',
  'Wraith Deviant Classification': 'rules-1723',
  // summoner eidolon types, from the one Eidolon class feature
  'Anger Phantom Eidolon': 'class-feature-445', 'Devotion Phantom Eidolon': 'class-feature-445',
  // HH prefixes the class name and appends the level; the archive keeps the generic feature
  'Psychic Weapon Expertise': 'class-21', 'Psychic Weapon Specialization': 'class-21',
  'Alchemist Armor Expertise (Level 13)': 'class-feature-22',
  'Alchemist Armor Mastery (Level 19)': 'class-feature-28',
};

/** Individually confirmed during stage 1f — kept here so the map is reproducible from source. */
const MANUAL = {
  // Recovered by the targeted #220 fetch, with naming differences the matcher could not see:
  // word order, and an apostrophe that moves between Day's and Days'.
  'items|Chromatic Robe (Greater)': { status: 'scraped', docId: 'equipment-4053-3738', how: 'scraped:word-order (Greater Chromatic Robe)' },
  "items|Three Day's Breath": { status: 'scraped', docId: 'equipment-4054-3740', how: "scraped:apostrophe (Three Days' Breath)" },
  "items|Ten Day's Breath": { status: 'scraped', docId: 'equipment-4054-3741', how: "scraped:apostrophe (Ten Days' Breath)" },
  // The six Crypt of Runes activities. Each is described INSIDE the Avenger feat that grants it —
  // verified: every one of these feats' text contains its activity's name.
  'actions|Aegis of Envy': { status: 'subblock', parentDocId: 'feat-9411', how: 'scraped:activity of Avenger of Envy' },
  'actions|Gluttonous Feast': { status: 'subblock', parentDocId: 'feat-9412', how: 'scraped:activity of Avenger of Gluttony' },
  'actions|Convocation of Greed': { status: 'subblock', parentDocId: 'feat-9413', how: 'scraped:activity of Avenger of Greed' },
  "actions|Sorshen's Devotion": { status: 'subblock', parentDocId: 'feat-9414', how: 'scraped:activity of Avenger of Lust' },
  'actions|Summon Sloth': { status: 'subblock', parentDocId: 'feat-9415', how: 'scraped:activity of Avenger of Sloth' },
  'actions|Host of Wrath': { status: 'subblock', parentDocId: 'feat-9416', how: 'scraped:activity of Avenger of Wrath' },
  'classFeatures|Premonition Reflexes': { status: 'doc', docId: 'class-feature-972', how: 'manual:apostrophe' },
  'classFeatures|Curse of the Living Death': { status: 'subblock', parentDocId: 'mystery-3', how: 'manual:oracle-curse' },
  'classFeatures|Lesson of Elements': { status: 'doc', docId: 'lesson-2', how: 'manual:the' },
  'feats|Harsh Judgement': { status: 'doc', docId: 'feat-3330', how: 'manual:spelling' },
  'feats|Empathic Envoy': { status: 'doc', docId: 'feat-4115', how: 'manual:spelling' },
  'feats|Knight Vigilant Dedication': { status: 'doc', docId: 'feat-1092', how: 'manual:HH appends " Dedication" to archetype entry feats' },
  'actions|Swirl Crimson Shroud': { status: 'subblock', parentDocId: 'feat-6521', how: 'manual:probable — feat text does not say "Swirl"' },
  /*
   * The animist's Apparition Sense activity. The Archives file it as the FEAT feat-7120 of the same
   * name, and the 10-minute activity is described inside that feat's text — so the action record is a
   * section of it, exactly like the six Crypt of Runes activities above.
   *
   * The matcher could not see it because our action and their feat share a name but not a bucket, so
   * the name lookup found a feat where it wanted an action. Verified against the live index
   * (2026-08-15): one hit, feat-7120, War of Immortals; and core.json already carried
   * aonParentId feat-7120 from an earlier stamping, which this now makes reproducible instead of
   * a value nothing regenerates.
   */
  'actions|Apparition Sense': { status: 'subblock', parentDocId: 'feat-7120', how: 'manual:activity described inside the feat of the same name' },
  'vehicles|Flying Broom': { status: 'doc', docId: 'equipment-251', how: 'manual:word-order (equipment "Broom of Flying")' },
  /*
   * The Archives file the Norns under their TITLE, not their name: deity-322 is "Followers of Fate".
   * Confirmed on the facets, not the name — domains Family/Fate/Knowledge/Truth, font Harm+Heal,
   * weapon Shears, skill Occultism, all matching HH exactly. It had been filed as a full-text guess
   * against creature-family-448, which is the Norn creature family, not the deity entry.
   */
  'deities|Norns': { status: 'doc', docId: 'deity-322', how: 'manual:the Archives title it "Followers of Fate"' },
};

// Records recovered by the targeted #220 scrape, keyed by name.
const scrapedNames = new Map();
const scrapedDir = pjoin(OUT, 'scraped');
if (existsSync(scrapedDir)) {
  for (const f of readdirSync(scrapedDir).filter((x) => x.endsWith('.json') && x !== 'manifest.json')) {
    for (const h of JSON.parse(readFileSync(pjoin(scrapedDir, f), 'utf8'))) {
      if (h?._source?.name) scrapedNames.set(h._source.name, h._id);
    }
  }
}

// Lookups built from the stage-1 outputs.
const subblockOf = new Map();   // "bucket|name" -> parent doc id
for (const [bucket, rows] of Object.entries(located.buckets ?? {})) {
  for (const r of rows) if (r.in?.length) subblockOf.set(`${bucket}|${r.name}`, r.in[0].id);
}
const resolvedOf = new Map();   // "bucket|key" -> {docId, how}
for (const [bucket, rows] of Object.entries(resolved.resolved ?? {})) {
  for (const r of rows) resolvedOf.set(`${bucket}|${r.key}`, { docId: r.docId, how: r.how });
}
const isDocOf = new Map();      // "bucket|key" -> {docId, archiveName}
for (const r of isDoc) isDocOf.set(`${r.bucket}|${r.key}`, r);
const reclassOf = new Map();    // "bucket|key" -> {status, docId|parentDocId, how}
for (const [bucket, rows] of Object.entries(reclass.reclassified ?? {})) {
  for (const [key, r] of Object.entries(rows)) reclassOf.set(`${bucket}|${key}`, r);
}
const variantOf = new Map();    // "items|name" -> base doc id
for (const r of variants.records ?? []) variantOf.set(`items|${r.name}`, r.docId);
const dropped = new Set((dropLoot.records ?? []).map((r) => `items|${r.name}`));

const map = {};
const tally = {};
const open = [];

for (const [bucket, records] of Object.entries(core)) {
  if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
  for (const [key, rec] of Object.entries(records)) {
    if (!rec || typeof rec !== 'object') continue;
    const name = rec.name ?? key;
    const id = `${bucket}|${key}`;
    const byName = `${bucket}|${name}`;
    let entry;

    if (AUTHORED.has(bucket)) entry = { status: 'authored', how: 'hand-authored bucket' };
    else if (bucket === 'trait' && AUTHORED_TRAIT_KEYS.has(key)) {
      entry = { status: 'authored', how: 'size trait — the Archives have no size-trait pages (verified)' };
    }
    else if (dropped.has(byName)) entry = { status: 'drop', how: 'adventure loot (user decision)' };
    else if (DROP_ABSENT.has(name)) entry = { status: 'drop', how: 'absent from the Archives (user decision)' };
    else if (MANUAL[byName]) entry = MANUAL[byName];
    else if (usedDocs[bucket]?.[key]) entry = { status: 'doc', docId: usedDocs[bucket][key], how: 'importer:the doc this record was built from' };
    else if (joinRes.matched?.[bucket]?.[key]) {
      const m = joinRes.matched[bucket][key];
      entry = { status: 'doc', docId: m.docId, how: m.how };
    } else if (resolvedOf.has(id)) {
      const m = resolvedOf.get(id);
      entry = { status: 'doc', docId: m.docId, how: m.how };
    } else if (isDocOf.has(id)) {
      const d = isDocOf.get(id);
      entry = { status: 'doc', docId: d.docId, archiveName: d.archiveName, how: 'extract:the section was the whole document' };
    } else if (reclassOf.has(id)) {
      const { name: _n, archiveName, ...m } = reclassOf.get(id);
      entry = { ...m, archiveName };
    } else if (subblockOf.has(byName)) {
      entry = { status: 'subblock', parentDocId: subblockOf.get(byName), how: 'fts' };
    } else if (variantOf.has(byName)) {
      entry = { status: 'table', parentDocId: variantOf.get(byName), how: 'variant of a base item' };
    } else if (scrapedNames.has(name)) {
      entry = { status: 'scraped', docId: scrapedNames.get(name), how: '#220 targeted fetch' };
    } else if (DERIVED[name]) {
      entry = { status: 'derived', parentDocId: DERIVED[name], how: 'HH generates this from one archive feature' };
    } else if (rec.aonId) {
      /*
       * LAST RESORT — a record that already carries its own `aonId`.
       *
       * Every branch above reconstructs provenance from stage-1 artefacts that only know about
       * records the FULL importer built, so anything a targeted merger added
       * (`import-siege-and-gaps.mjs`) came out "open" — and `stamp-aonid.mjs` then refuses to write
       * at all, which silently dropped ALL 24,534 aonIds on the next regeneration. Measured: the 99
       * familiar abilities and companions added on 2026-08-16 left two records unmapped and the
       * stamp count fell to 99.
       *
       * ⚠ IT MUST STAY LAST. Placed earlier it OVERRULES the join, and the join is more precise: it
       * knows a record is a graded BLOCK of a page (`equipment-5194-4715`) where the record's own
       * field may hold the PAGE (`equipment-5194`). Soulheart flipped exactly that way when this ran
       * early, and a page id makes the base artifact look like a family summary — which the umbrella
       * rule then hides, deleting the item from the game. Caught by test/umbrella-items.test.ts.
       */
      entry = { status: 'doc', docId: String(rec.aonId), how: 'record carries its own aonId (targeted merge)' };
    } else {
      entry = { status: 'open', how: null };
      open.push({ bucket, key, name, book: (rec.source || {}).book || '' });
    }

    (map[bucket] ??= {})[key] = { name, ...entry };
    tally[entry.status] = (tally[entry.status] ?? 0) + 1;
  }
}

if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
writeFileSync(pjoin(OUT, 'map.json'), JSON.stringify({ tally, map }, null, 1));
writeFileSync(pjoin(OUT, 'open.json'), JSON.stringify(open, null, 1));

const total = Object.values(tally).reduce((a, b) => a + b, 0);
console.log('--- map.json ---');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(6)}  ${((v / total) * 100).toFixed(1)}%`);
}
console.log(`  ${'TOTAL'.padEnd(10)} ${String(total).padStart(6)}`);
if (open.length) {
  console.log(`\n${open.length} STILL OPEN — stage 2 must not proceed past extraction until this is 0:`);
  for (const o of open.slice(0, 25)) console.log(`   ${o.bucket.padEnd(16)} ${o.name}`);
  if (open.length > 25) console.log(`   …and ${open.length - 25} more (see out/open.json)`);
}
