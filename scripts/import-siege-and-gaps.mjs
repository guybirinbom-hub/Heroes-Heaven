/**
 * TARGETED gap-closing import (siege weapons + 4 heritages + 1 deity + 1 language + 2 archetypes).
 *
 * Closes the 63 verified content gaps listed in audit/missing-content.md by merging the Archives-of-
 * Nethys mirror into FIVE collections of public/core.json. Everything else in core.json is left
 * byte-for-byte alone — this is deliberately NOT the full importer (scripts/import-core-v2.mjs),
 * which regenerates the whole file from public/core.foundry-backup.json and has previously clobbered
 * hand-curated work. Modelled on scripts/import-companions.mjs, which solved the same problem.
 *
 * Collections written:
 *   siegeWeapons  <- siege-weapon   (was 5 hand-authored records; AoN holds 62 distinct names)
 *   heritages     <- heritage       (the 4 High Seas heritages, ADDED only)
 *   deities       <- deity          (Surveyors of the Deep, ADDED only)
 *   languages     <- language       (Iblydosi, ADDED only)
 *   archetype     <- archetype      (Jalmeri Heavenseeker + Bright Lion reference entries, ADDED only)
 * Plus the matching lazy-loaded description trees: public/ast/<bucket>.json(.gz) + public/ast-index.json.
 *
 * Rules the merge follows:
 *   • THIS SCRIPT OWNS ONLY THE RECORDS IT CREATES. It rewrites those (so re-running after a change
 *     to the parser refreshes them) and touches NOTHING else: the 5 hand-authored siege weapons
 *     (Ballista, Catapult, Trebuchet, Battering Ram, Cannon — see CURATED_SIEGE_IDS) are matched by
 *     name and skipped, and the four small buckets only ever write the ids enumerated below, all of
 *     which the audit verified absent. Writing over a record that turns up from a different book is
 *     a hard error, not a silent clobber. Nothing a saved character already references changes.
 *   • NO INVENTED NUMBERS. A field AoN doesn't state is OMITTED. AoN gives PORTABLE siege weapons
 *     (the rams) no AC/HP/Hardness/Space at all — they're carried objects rated by Bulk — and the
 *     Light Mortar's defensive stats live in the Inventor innovation, not on the weapon. Those
 *     records ship without a defensive frame rather than with a guess.
 *   • EDITIONS. AoN carries no remaster_id/legacy_id on siege weapons, so the legacy Guns & Gears
 *     printings are collapsed into their Remastered twins by NAME, preferring (a) the page record
 *     over an extracted sub-entry, (b) the newer edition of the source book, (c) the richer record.
 *   • SOURCES. Every imported record gets source.book canonicalized against the book names core.json
 *     already uses (so it lands on the same Sources shelf), plus that book's majority license.
 *
 * Re-runnable: running it twice produces an identical core.json / ast payload.
 * Run: node scripts/import-siege-and-gaps.mjs [--dry-run] [--out <path>] [--no-ast]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { applyBackfill } from './lib/apply-backfill.mjs';
import { fillFrequencyCounters, canonBookName, foldBookSpellings } from './lib/aon-facets.mjs';
import { LABELLED_BUCKETS } from './lib/archive-coverage.mjs';
import { plain, unlink, decode, handlebarsLinks, ACTION_WORD } from './lib/aon-plain.mjs';
import { appendSubclassOptions } from './lib/player-create.mjs';
import { readBackfill } from './lib/write-backfill.mjs';
import { loadBaseline as loadEmbeddedBaseline, recordReader, syncOptionDescriptions } from './lib/embedded-descriptions.mjs';

/** The PRISTINE AoN mirror (one JSON file per record). Facets + markdown come from here. */
const SRC = process.env.AON_MIRROR || 'C:/wonderers guide/aon-2e-archive/data/by-category';
/** The importer's own export of the same corpus — used ONLY for its pre-parsed `ast` description
 *  trees (identical source data; public/ast/* is built from it). Optional: no export, no ast. */
const EXPORT = process.env.AON_EXPORT || 'C:/trying ai 2/hh-data-export/without-images/data';
const CORE = 'public/core.json';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const NO_AST = argv.includes('--no-ast');
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : CORE;

/* ------------------------------------------------------------------ small helpers */

/** The EXACT slug() the engine + saved characters key off (must not drift). */
const slug = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/*
 * `plain`, `unlink`, `decode` and ACTION_WORD now live in scripts/lib/aon-plain.mjs (imported at the top
 * of this file).
 *
 * They HAVE to be shared. A repair script can only tell whether an artefact in stored prose came from
 * this transform or from AoN's own text by applying the identical function; a second copy answers that
 * question with a different function and quietly gets it wrong. Two artefacts this code used to
 * introduce — a literal " ()" from `<actions string="" />`, and a newline kept from inside a link label —
 * are documented there with the evidence that found them.
 */

const readCat = (cat) => {
  const dir = join(SRC, cat);
  if (!existsSync(dir)) throw new Error(`missing AoN mirror category dir: ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== '_index.json')
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
};

/* ------------------------------------------------------------------ core.json context */

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const BUCKETS = ['siegeWeapons', 'heritages', 'deities', 'languages', 'archetype', 'familiarAbilities', 'animalCompanions', 'classFeatures', 'runesmithRune'];
/**
 * Buckets where this script may write the ast for the slugs it OWNS and for nothing else, not even a
 * slug with no tree yet. The rule above is "add a tree where there is none, never rewrite one" —
 * right for a bucket this script created, wrong for `classFeatures`, where 1,073 records belong to
 * the full importer and a missing tree is its answer, not a gap for this one to fill.
 */
const STRICT_AST = new Set(['classFeatures']);

/**
 * Slugs `topUpCarried` adds, so `writeAst` knows which trees it may write and leaves every
 * pre-existing record's alone.
 *
 * Declared HERE, above the function that fills it. `const` is in its temporal dead zone until its
 * own declaration executes — putting these sets down beside OWNED_IDS (which appears later in the
 * file) threw "Cannot access 'OWNED_IDS' before initialization" at run time, not at parse time.
 */
const TOPPED_UP = { familiarAbilities: new Set(), animalCompanions: new Set() };

/** book display name -> edition, from core.json's own `source` catalog ("Battlecry!" -> remaster-era). */
const bookEdition = {};
for (const s of Object.values(core.source ?? {})) if (s?.name) bookEdition[String(s.name).trim()] = s.edition;

/** AoN ships SHORT book names ("Battlecry!"); core.json records use the canonical Foundry-style name
 *  ("Pathfinder Battlecry!"). `(Remastered)` is dropped from the key because core.json files the
 *  Remastered Guns & Gears under the SAME shelf as the original — align to whatever it already uses. */
const normBook = (s) =>
  String(s || '').toLowerCase()
    .replace(/^pathfinder\s+/, '').replace(/^lost omens:?\s*/, '')
    .replace(/\((?:remastered|remaster)\)/g, '')
    .replace(/[^a-z0-9]+/g, '');
const canonBook = {};
const bookLicense = {}; // canonical book -> {license: count} (the majority license wins)
for (const bucket of Object.keys(core)) {
  const map = core[bucket];
  if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
  for (const e of Object.values(map)) {
    const b = e && typeof e === 'object' ? e.source?.book?.trim() : null;
    if (!b) continue;
    if (!canonBook[normBook(b)]) canonBook[normBook(b)] = b;
    const lic = e.source?.license;
    if (lic) ((bookLicense[b] ??= {})[lic] = (bookLicense[b][lic] ?? 0) + 1);
  }
}
/** …and the hand-kept table first, because `normBook` cannot spell — see canonBookName's own note. */
const mapBook = (book) => canonBookName(book, (b) => canonBook[normBook(b)]);
/** The license the rest of core.json records for this book (majority vote), or none. */
function licenseOf(canonicalBook) {
  const counts = bookLicense[canonicalBook];
  if (!counts) return undefined;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
function sourceOf(primarySource) {
  const book = mapBook(primarySource);
  if (!book) return undefined;
  const license = licenseOf(book);
  return license ? { book, license } : { book };
}
const editionOf = (primarySource) => bookEdition[String(primarySource || '').trim()] ?? 'neutral';

const EDITION_RANK = { remaster: 0, 'remaster-era': 1, neutral: 2, 'legacy-era': 3, legacy: 4 };
const RARITY = new Set(['common', 'uncommon', 'rare', 'unique']);

/** Normalized-name -> id over the given ids of a map (used to spot a curated record by its name). */
function nameIndex(map, onlyIds) {
  const idx = new Map();
  for (const [id, e] of Object.entries(map ?? {})) {
    if (onlyIds && !onlyIds.has(id)) continue;
    if (e?.name) idx.set(slug(e.name), id);
  }
  return idx;
}

/** Refuse to overwrite a record that arrived from a DIFFERENT book than the one we're importing —
 *  that means the app grew its own copy and the conflict needs a human. */
function assertOwnable(bucket, id, prev, src) {
  const a = prev?.source?.book;
  const b = src?.book;
  if (prev && a && b && a !== b) throw new Error(`${bucket}/${id} already exists from "${a}" but AoN says "${b}" — resolve by hand`);
}

const stats = {};
const notes = [];

/* ------------------------------------------------------------------ descRefs from AoN links */

/** AoN page -> the ContentDatabase bucket a link resolves against (descref.ts `key`). */
const LINK_BUCKET = {
  'actions.aspx': 'actions', 'conditions.aspx': 'conditions', 'spells.aspx': 'spells',
  'equipment.aspx': 'items', 'weapons.aspx': 'items', 'armor.aspx': 'items', 'feats.aspx': 'feats',
  'traits.aspx': 'trait', 'skills.aspx': 'skill', 'rules.aspx': 'rules', 'archetypes.aspx': 'archetype',
  'deities.aspx': 'deities', 'ancestries.aspx': 'ancestries', 'classes.aspx': 'classes',
  'heritages.aspx': 'heritages', 'domains.aspx': 'domain', 'siegeweapons.aspx': 'siegeWeapons',
  /* `languages` is a shipped bucket and 42 handlebars cross-references name it; without the row
   * every one of them resolved to no bucket and was dropped. */
  'languages.aspx': 'languages',
};
const nameIdx = {};
function resolves(bucket, label) {
  const map = core[bucket];
  if (!map || typeof map !== 'object') return false;
  const base = label.replace(/\s*\(.*\)\s*$/, '').replace(/\s+\d+$/, '').trim();
  for (const cand of new Set([label, base])) {
    if (!cand) continue;
    if (map[slug(cand)]) return true;
    nameIdx[bucket] ??= new Set(Object.values(map).map((e) => String(e?.name ?? '').toLowerCase()));
    if (nameIdx[bucket].has(cand.toLowerCase())) return true;
  }
  return false;
}
/** Cross-references for a description, from the AoN markdown's own links — emitted only when the
 *  target actually resolves in core.json, so no ref renders as a dead link. `handlebarsLinks` first,
 *  because AoN's newer `{{conditions 62 "concealed"}}` template says the same thing in a shape this
 *  scanner cannot see (see its header). */
function descRefsOf(md, body) {
  const out = [];
  const seen = new Set();
  for (const m of handlebarsLinks(md).replace(/\r/g, '').matchAll(/\[([\s\S]*?)\]\(\/([A-Za-z]+\.aspx)[^)]*\)/g)) {
    const label = plain(m[1]).replace(/\s+/g, ' ').trim();
    const bucket = LINK_BUCKET[m[2].toLowerCase()];
    if (!bucket || !label || seen.has(label.toLowerCase())) continue;
    if (!body.includes(label)) continue; // the link text must survive into the plain description
    if (!resolves(bucket, label)) continue;
    seen.add(label.toLowerCase());
    out.push({ label, key: bucket });
  }
  return out;
}

/* ==================================================================== siege weapons */

/** An AoN sub-record: a variant pulled out of a page ("siege-weapon-45-5" = Adamantine Drilling Ram).
 *  It carries the WHOLE page's markdown but its own level/price facets. */
const isSubRecord = (id) => /^siege-weapon-\d+-\d+$/.test(String(id));

/** The prose block of a siege-weapon page: everything after the last statblock rule, before any
 *  level-2 sub-entry title. */
function pageBody(md) {
  let s = String(md ?? '').replace(/\r/g, '');
  const cut = s.search(/<title[\s\S]{0,60}?level="2"/);
  if (cut >= 0) s = s.slice(0, cut);
  const parts = s.split(/\n\s*---\s*\n/);
  return parts[parts.length - 1];
}

/** A sub-entry's OWN section: from its level-2 title to the next title. Its rules text is the
 *  parent page's (the variant shares the activities), so the caller appends those separately. */
function subBody(md, name) {
  const s = String(md ?? '').replace(/\r/g, '');
  const titles = [...s.matchAll(/<title[\s\S]*?<\/title>|<title[^>]*\/>/g)];
  for (let i = 0; i < titles.length; i++) {
    const t = titles[i];
    if (!/level="2"/.test(t[0])) continue;
    const label = plain(t[0].replace(/<[^>]*>/g, ' '));
    if (slug(label) !== slug(name)) continue;
    const start = t.index + t[0].length;
    const end = i + 1 < titles.length ? titles[i + 1].index : s.length;
    const seg = s.slice(start, end);
    // drop the sub-entry's own <column> header (Source/Price) — those are already facets
    const parts = seg.split(/\n\s*---\s*\n/);
    return parts.length > 1 ? parts[parts.length - 1] : seg.replace(/<column[\s\S]*?<\/column>/g, '');
  }
  return '';
}

/** Every "**Label** <actions .../> rest" activity in a body, in page order. */
function activitiesOf(body) {
  const s = String(body ?? '').replace(/<br\s*\/?>/g, '\n');
  const out = [];
  const re = /(?:^|\n)\s*(?:\*\*)?([A-Z][A-Za-z'’ -]{1,28}?)(?:\*\*)?\s*<actions\s+string="([^"]+)"\s*\/>([\s\S]*?)(?=(?:\n\s*(?:\*\*)?[A-Z][A-Za-z'’ -]{1,28}?(?:\*\*)?\s*<actions)|$)/g;
  for (const m of s.matchAll(re)) {
    // UNLINK FIRST: the leading trait list is markdown links whose URLs contain parentheses
    // ("([manipulate](/Traits.aspx?ID=104), [range increment 80 feet](…))"), so it can only be
    // matched once the links are flattened to their labels.
    const un = unlink(m[3]).replace(/^\s+/, '');
    const paren = /^\(([^)]*)\)/.exec(un);
    out.push({
      name: m[1].trim(),
      cost: ACTION_WORD[m[2]] ?? m[2],
      // Split the trait list on commas — but NOT a thousands separator ("range increment 1,000 feet").
      traits: paren ? paren[1].split(/,(?!\d{3}(?:\D|$))/).map((t) => t.trim().toLowerCase()).filter(Boolean) : [],
      rest: plain(paren ? un.replace(/^\([^)]*\)/, '') : un),
    });
  }
  return out;
}

/** The Load activity as a `reload` string: "2 actions, 2 times". */
function reloadOf(acts) {
  const load = acts.find((a) => /^(load|reload hopper)$/i.test(a.name));
  if (!load) return undefined;
  const times = /^(\d+)\s+times?/i.exec(load.rest.trim());
  return times ? `${load.cost}, ${times[1]} time${times[1] === '1' ? '' : 's'}` : load.cost;
}

/** The best one-line damage/effect summary for an activity: the first sentence that names damage
 *  dice, else the first that names a save DC, else the first sentence. */
function damageOf(rest) {
  const clean = String(rest ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return undefined;
  const sentences = clean.split(/(?<=\.)\s+(?=[A-Z(“"])/);
  const pick =
    sentences.find((s) => /\d+d\d+/.test(s)) ?? sentences.find((s) => /DC \d+/.test(s)) ?? sentences[0];
  return pick
    .replace(/^Requirements[\s\S]*?;\s*Effect\s+/i, '') // an activity's trigger clause isn't damage
    .replace(/^Effect\s+/, '')
    .replace(/^(?:This Strike deals|It deals|The .{1,30} deals)\s+/i, '')
    .replace(/\.$/, '')
    .trim() || undefined;
}

/** The range this activity reaches, from its own trait list ("range increment 120 feet"). */
function rangeOf(act) {
  // Matched against the joined list (AoN sometimes leaves the unit outside the link, so the trait
  // reads "range increment 120" with a stray "feet" after it).
  const joined = act.traits.join(', ');
  const inc = /range increment ([\d,]+)/i.exec(joined);
  if (inc) return `increment ${inc[1]} ft`;
  const rng = /(?:^|,\s*)range ([\d,]+)/i.exec(joined);
  return rng ? `${rng[1]} ft` : undefined;
}

/** The siege weapon's attacks: every activity that Strikes or deals damage. Aim/Load are folded in
 *  as `reload` / left to the description — they aren't attacks. */
function attacksOf(acts) {
  const reload = reloadOf(acts);
  const out = [];
  for (const a of acts) {
    if (/^(aim|quick aim|load|reload hopper)$/i.test(a.name)) continue;
    const damage = damageOf(a.rest);
    const isAttack = a.traits.includes('attack') || /^(launch|fire|ram)$/i.test(a.name) || /\d+d\d+/.test(a.rest);
    if (!isAttack) continue;
    const range = rangeOf(a);
    const bonus = /at a \+(\d+) bonus/i.exec(a.rest);
    const atk = { name: a.name, actionCost: a.cost };
    if (bonus) atk.bonus = Number(bonus[1]);
    if (range) atk.range = range;
    if (damage) atk.damage = damage;
    if (reload) atk.reload = reload;
    // The renderer labels Melee vs Ranged: a Ram (and Wolf Fang's Launch) is an explicit melee Strike.
    atk.melee = !range && (/^ram$/i.test(a.name) || /melee Strike/i.test(a.rest));
    out.push(atk);
  }
  return out;
}

const crewOf = (raw) => {
  const nums = plain(raw ?? '').match(/\d+/g);
  if (!nums?.length) return undefined;
  // "2 to 4" / "2-4" / AoN's typo "2 t o4" all normalize to the same range.
  return nums.length >= 2 ? `${nums[0]}–${nums[1]} crew` : `${nums[0]} crew`;
};
const spaceOf = (raw) => {
  const s = plain(raw ?? '').replace(/\s+/g, ' ').replace(/\bfeet\b/g, 'ft').replace(/\btall\b/g, 'high').trim();
  return s || undefined;
};
const speedsOf = (raw) => {
  const s = plain(raw ?? '').replace(/\s+/g, ' ').replace(/^Speed\s+/i, '').trim();
  return s || undefined;
};
const priceOf = (raw) => {
  const s = plain(raw ?? '').replace(/\s+/g, ' ').trim();
  return /\d/.test(s) ? s : undefined; // AoN writes "—" for the price-less Light Mortar
};

/**
 * The 5 hand-authored siege weapons that predate this import. They are matched BY NAME against the
 * AoN corpus and skipped, so their ids (note `ram`, not `battering-ram`), their stats and their
 * wording are never touched — a saved character that owns one keeps exactly what it had. Their
 * numbers do NOT agree with AoN (see the import report); reconciling them is a separate decision.
 */
const CURATED_SIEGE_IDS = new Set();

/**
 * The 5 records that predate this import (Ballista, Catapult, Trebuchet, Battering Ram, Cannon) were
 * hand-authored, NOT imported: they are the only siege weapons in core.json with no `source` at all,
 * and their numbers do not match the rules (the app said Ballista 1,000 gp / 1 crew / +10 / 4d8;
 * AoN says 320 gp / 2 crew / no attack roll / 4d12). Per the owner they now use AoN data like every
 * other record, so CURATED_SIEGE_IDS is empty and they are re-imported.
 *
 * Their IDS must not move, or a saved character that owns one stops resolving. Four already match
 * AoN's slug; Battering Ram does not — the app has always keyed it `ram`. This maps AoN's slug onto
 * the id the app already uses, so the stats change and the reference doesn't.
 */
const SIEGE_ID_ALIAS = { 'battering-ram': 'ram' };

/** Rank a candidate record for a given name: lower is better. */
function siegeRank(rec) {
  return (
    (isSubRecord(rec.id) ? 100 : 0) + // a page record beats an extracted sub-entry (which has degraded facets)
    (EDITION_RANK[editionOf(rec.primary_source)] ?? 9) * 10 +
    (typeof rec.ac === 'number' ? 0 : 1) // prefer the printing that actually carries the statblock
  );
}

function buildSiegeWeapons() {
  const recs = readCat('siege-weapon');
  const byId = new Map(recs.map((r) => [r.id, r]));
  const candidates = new Map(); // normalized name -> every printing/variant AoN files under it
  for (const r of recs) {
    if (r.exclude_from_search || !r.name) continue;
    (candidates.get(slug(r.name)) ?? candidates.set(slug(r.name), []).get(slug(r.name))).push(r);
  }
  const best = new Map();
  let collapsed = 0;
  for (const [k, list] of candidates) {
    const sorted = [...list].sort((a, b) => siegeRank(a) - siegeRank(b));
    best.set(k, sorted[0]);
    collapsed += list.length - 1;
  }

  const prevMap = core.siegeWeapons ?? {};
  const have = nameIndex(prevMap, CURATED_SIEGE_IDS);
  const out = { ...prevMap };
  let added = 0;
  let refreshed = 0;
  const skipped = [];
  const noFrame = [];

  for (const [rawKey, rec] of [...best].sort((a, b) => a[0].localeCompare(b[0]))) {
    // Keep the app's existing id where it differs from AoN's slug (Battering Ram -> `ram`), so a
    // character that owns one keeps resolving it while its stats are corrected.
    const key = SIEGE_ID_ALIAS[rawKey] ?? rawKey;
    if (have.has(key)) { skipped.push(`${rec.name} (app already ships it as "${have.get(key)}")`); continue; }
    const md = String(rec.markdown ?? '').replace(/\r/g, '');
    const parentActs = activitiesOf(pageBody(md));
    const own = isSubRecord(rec.id) ? subBody(md, rec.name) : pageBody(md);
    // A SUB-ENTRY (Battering Ram (covered), Adamantine Drilling Ram) is a variant of the page's
    // machine: only its own name/level/price/rarity are its own. AoN's extraction degrades the rest
    // (it files every sub-entry as size "Tiny" and drops space/immunities), so the PHYSICAL facets
    // are taken from the page record they belong to.
    const parent = isSubRecord(rec.id) ? byId.get(rec.id.replace(/-\d+$/, '')) : undefined;
    const phys = parent ?? rec;
    // The Drilling Ram page carries its price only on the extracted item sub-entry, not on the
    // statblock record that wins the pick — take it from the same-named, same-level sibling.
    const priceRaw = priceOf(rec.price_raw)
      ? rec.price_raw
      : (candidates.get(key) ?? []).find((o) => o !== rec && o.level === rec.level && priceOf(o.price_raw))?.price_raw;
    const flavour = plain(own.replace(/(?:^|\n|<br\s*\/?>)\s*(?:\*\*)?[A-Z][A-Za-z'’ -]{1,28}?(?:\*\*)?\s*<actions[\s\S]*$/, ''));

    // Description = flavour + the physical facets that have no structured home + every activity, so
    // nothing AoN prints on the page is dropped on the floor.
    const facts = [];
    if (phys.usage) facts.push(`Usage ${plain(phys.usage).replace(/\s+/g, ' ').trim()}`);
    if (phys.bulk != null) facts.push(`Bulk ${phys.bulk}`);
    if (phys.ammunition) facts.push(`Ammunition ${plain(phys.ammunition).replace(/\s+/g, ' ').trim()}`);
    const actLines = parentActs.map((a) => `${a.name} (${a.cost})${a.traits.length ? ` (${a.traits.join(', ')})` : ''} ${a.rest}`.trim());
    const description = [flavour, facts.join(' · '), actLines.join('\n\n')].filter(Boolean).join('\n\n');

    const size = phys.size?.[0] && phys.size[0] !== 'No Size' ? phys.size[0] : undefined;
    const traits = ['siege-weapon', ...(rec.trait ?? []).map((t) => String(t).toLowerCase()).filter((t) => !RARITY.has(t))];
    const attacks = attacksOf(parentActs);
    const src = sourceOf(rec.primary_source);
    const entry = {
      id: key,
      name: rec.name,
      level: typeof rec.level === 'number' ? rec.level : 0,
      ...(priceOf(priceRaw) ? { price: priceOf(priceRaw) } : {}),
      ...(size ? { size } : {}),
      ...(spaceOf(phys.space) ? { space: spaceOf(phys.space) } : {}),
      ...(crewOf(phys.crew) ? { crew: crewOf(phys.crew) } : {}),
      ...(typeof phys.ac === 'number' ? { ac: phys.ac } : {}),
      ...(typeof phys.fortitude_save === 'number' ? { fort: phys.fortitude_save } : {}),
      ...(typeof phys.hp === 'number' ? { hp: phys.hp } : {}),
      ...(typeof phys.hardness === 'number' ? { hardness: phys.hardness } : {}),
      ...(phys.immunity?.length ? { immunities: phys.immunity.map((i) => plain(i).trim()).filter(Boolean) } : {}),
      ...(speedsOf(phys.speed_markdown) ? { speeds: speedsOf(phys.speed_markdown) } : {}),
      traits: [...new Set(traits)],
      ...(RARITY.has(rec.rarity) && rec.rarity !== 'common' ? { rarity: rec.rarity } : {}),
      ...(description ? { description } : {}),
      ...(attacks.length ? { attacks } : {}),
      ...(src ? { source: src } : {}),
      edition: editionOf(rec.primary_source),
    };
    if (!attacks.length) notes.push(`siegeWeapons/${key}: no attack activity could be parsed`);
    if (entry.hp == null) noFrame.push(rec.name);
    if (CURATED_SIEGE_IDS.has(key)) throw new Error(`siegeWeapons/${key} is curated — refusing to overwrite`);
    assertOwnable('siegeWeapons', key, prevMap[key], src);
    if (prevMap[key]) refreshed++; else added++;
    out[key] = entry;
  }
  stats.siegeWeapons = { before: Object.keys(prevMap).length, after: Object.keys(out).length, added, refreshed, collapsed, skipped, noFrame, raw: recs.length, distinct: best.size, ids: Object.keys(byId).length };
  return out;
}

/* ==================================================================== heritages (High Seas) */

/**
 * The four High Seas heritages. AoN's heritage records carry NO structured ancestry link and no
 * mechanical facets, so the owning ancestry and the engine fields are stated here, transcribed from
 * the record's own rules text (which ships verbatim as the description). Anything the text states
 * that the engine can't yet model (Camouflage Tripkee's terrain choice, Aquatic Elf's weekly rest,
 * Benthic Athamaru's difficult-terrain exemption) stays prose-only, exactly like its siblings.
 */
const HERITAGE_MECHANICS = {
  'benthic-athamaru': { ancestryId: 'athamaru', senses: [{ name: 'darkvision' }] },
  'aquatic-elf': { ancestryId: 'elf', traits: ['amphibious'], speeds: { swim: 30 } },
  // "Your land Speed becomes 10 feet" — merfolk's ancestry land Speed is 5, and `speeds.land` is
  // ADDITIVE in deriveSpeeds, so the +5 here lands on the printed value of 10.
  'cecaelia-merfolk': { ancestryId: 'merfolk', speeds: { land: 5, climb: 10 } },
  'camouflage-tripkee': { ancestryId: 'tripkee' },
};

function buildHeritages() {
  const prevMap = core.heritages ?? {};
  const out = { ...prevMap };
  const recs = readCat('heritage');
  let added = 0;
  let refreshed = 0;
  for (const rec of recs) {
    const key = slug(rec.name ?? '');
    if (!HERITAGE_MECHANICS[key]) continue;
    const mech = HERITAGE_MECHANICS[key];
    assertOwnable('heritages', key, prevMap[key], sourceOf(rec.primary_source));
    if (prevMap[key]) refreshed++; else added++;
    if (!core.ancestries?.[mech.ancestryId]) throw new Error(`heritage ${key}: unknown ancestry "${mech.ancestryId}"`);
    const md = String(rec.markdown ?? '').replace(/\r/g, '');
    // body = everything after the Source line, minus AoN's "Feats that require ..." index block
    const cut = md.search(/<title[\s\S]{0,60}?level="2"/);
    const bodyMd = (cut >= 0 ? md.slice(0, cut) : md).replace(/<title[\s\S]*?<\/title>/g, '').replace(/<traits>[\s\S]*?<\/traits>/g, '').replace(/\*\*Source\*\*[^\n]*/g, '');
    const description = plain(bodyMd);
    const descRefs = descRefsOf(bodyMd, description);
    out[key] = {
      id: key,
      name: rec.name,
      ancestryId: mech.ancestryId,
      versatile: false,
      traits: mech.traits ?? [],
      rarity: RARITY.has(rec.rarity) ? rec.rarity : 'common',
      description,
      ...(descRefs.length ? { descRefs } : {}),
      ...(sourceOf(rec.primary_source) ? { source: sourceOf(rec.primary_source) } : {}),
      ...(mech.senses ? { senses: mech.senses } : {}),
      ...(mech.speeds ? { speeds: mech.speeds } : {}),
      edition: editionOf(rec.primary_source),
    };
  }
  const missing = Object.keys(HERITAGE_MECHANICS).filter((k) => !out[k]);
  if (missing.length) throw new Error(`heritages not found in the mirror: ${missing.join(', ')}`);
  stats.heritages = { before: Object.keys(prevMap).length, after: Object.keys(out).length, added, refreshed };
  return out;
}

/* ==================================================================== deity (High Seas) */

const DEITY_NAMES = ['Surveyors of the Deep'];

/** One bold-labelled field out of the AoN markdown ("**Divine Font** Heal"). */
function field(md, label) {
  const m = String(md ?? '').replace(/\r/g, '')
    .match(new RegExp(`\\*\\*(?:\\[)?${label}(?:\\][^)]*\\))?\\*\\*[ \\t]*\\n?([\\s\\S]*?)(?=\\n\\s*\\n\\s*\\*\\*|\\n\\s*\\n\\s*<|\\n<title|$)`));
  return m ? plain(m[1]) : undefined;
}

function buildDeities() {
  const prevMap = core.deities ?? {};
  const out = { ...prevMap };
  const wanted = new Set(DEITY_NAMES.map(slug));
  let added = 0;
  let refreshed = 0;
  for (const rec of readCat('deity')) {
    const key = slug(rec.name ?? '');
    if (!wanted.has(key)) continue;
    assertOwnable('deities', key, prevMap[key], sourceOf(rec.primary_source));
    if (prevMap[key]) refreshed++; else added++;
    const md = String(rec.markdown ?? '').replace(/\r/g, '');
    // core.json's deity descriptions are the AoN facet summary followed by the "Divine details"
    // block — the same shape every other deity ships (see e.g. deities/maat).
    const flavourMd = md.split(/<column gap="tiny">/)[0]
      .replace(/<title[\s\S]*?<\/title>/g, '').replace(/<traits>[\s\S]*?<\/traits>/g, '')
      .replace(/\*\*Source\*\*[^\n]*/g, '').replace(/<[a-z][^>]*>/g, '');
    // The field ORDER + labels below match the deity records core.json already ships (see
    // deities/pillars-of-knowledge and deities/wards-of-the-pharaoh, the closest precedent — both
    // pantheons): Edicts / Anathema / Areas of Concern / Pantheon Members, then a "Divine details"
    // block whose Domains row carries the alternates inline.
    const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => plain(String(x)).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const lines = [];
    for (const [label, key2] of [['Edicts', 'edict'], ['Anathema', 'anathema'], ['Areas of Concern', 'area_of_concern'], ['Religious Symbol', 'religious_symbol'], ['Pantheon Members', 'pantheon_member']]) {
      const v = list(rec[key2]).join(', ');
      if (v) lines.push(`**${label}** ${v}`);
    }
    // "**Cleric Spells** 1st: Tailwind, 3rd: Feet to Fins" — the ranks live only in the markdown.
    const spellsByRank = [...md.matchAll(/-\s*\*\*(\d+(?:st|nd|rd|th))\*\*\s*\n+\s*([^\n]+)/g)]
      .map((m) => `${m[1]}: ${plain(m[2]).trim()}`);
    const domains = list(rec.domain_primary ?? rec.domain);
    const alternates = list(rec.domain_alternate);
    const sanctification = list(rec.sanctification_raw).join(', ');
    const details = [];
    for (const [label, v] of [
      ['Divine Attribute', list(rec.attribute).join(' or ')],
      ['Divine Font', list(rec.divine_font).join(' or ')],
      ['Divine Skill', list(rec.skill).join(', ')],
      ['Favored Weapon', list(rec.favored_weapon).join(', ')],
      ['Domains', domains.join(', ') + (alternates.length ? ` (Alternate: ${alternates.join(', ')})` : '')],
      ['Sanctification', /^none$/i.test(sanctification) ? '' : sanctification],
      ['Cleric Spells', spellsByRank.length ? spellsByRank.join(', ') : list(rec.cleric_spell ?? rec.spell).join(', ')],
    ]) {
      if (v && String(v).trim()) details.push(`**${label}** ${String(v).replace(/\s+/g, ' ').trim()}`);
    }
    const description = [plain(flavourMd), lines.join('\n\n'), details.length ? `---\n\n## Divine details\n\n${details.join('\n\n')}` : '']
      .filter(Boolean).join('\n\n');
    out[key] = {
      id: key,
      name: rec.name,
      traits: (rec.trait ?? []).map((t) => String(t).toLowerCase()).filter((t) => !RARITY.has(t)),
      rarity: RARITY.has(rec.rarity) ? rec.rarity : 'common',
      description,
      ...(sourceOf(rec.primary_source) ? { source: sourceOf(rec.primary_source) } : {}),
      domains: [...(rec.domain_primary ?? rec.domain ?? [])].map((d) => slug(d)),
      divineFont: (rec.divine_font ?? []).map((f) => String(f).toLowerCase()),
      favoredWeapons: (rec.favored_weapon ?? []).map((w) => slug(w)),
      ...(rec.skill?.length ? { skill: slug(rec.skill[0]) } : {}),
      edition: editionOf(rec.primary_source),
    };
  }
  const missing = [...wanted].filter((k) => !out[k]);
  if (missing.length) throw new Error(`deities not found in the mirror: ${missing.join(', ')}`);
  stats.deities = { before: Object.keys(prevMap).length, after: Object.keys(out).length, added, refreshed };
  return out;
}

/* ==================================================================== language */

const LANGUAGE_NAMES = ['Iblydosi'];

function buildLanguages() {
  const prevMap = core.languages ?? {};
  const out = { ...prevMap };
  const wanted = new Set(LANGUAGE_NAMES.map(slug));
  let added = 0;
  let refreshed = 0;
  for (const rec of readCat('language')) {
    const key = slug(rec.name ?? '');
    if (!wanted.has(key) || rec.exclude_from_search) continue;
    assertOwnable('languages', key, prevMap[key], sourceOf(rec.primary_source));
    if (prevMap[key]) refreshed++; else added++;
    out[key] = {
      id: key,
      name: rec.name,
      rarity: RARITY.has(rec.rarity) ? rec.rarity : 'common',
      ...(sourceOf(rec.primary_source) ? { source: sourceOf(rec.primary_source) } : {}),
      edition: editionOf(rec.primary_source),
    };
  }
  const missing = [...wanted].filter((k) => !out[k]);
  if (missing.length) throw new Error(`languages not found in the mirror: ${missing.join(', ')}`);
  stats.languages = { before: Object.keys(prevMap).length, after: Object.keys(out).length, added, refreshed };
  return out;
}

/* ==================================================================== carried-bucket top-up */

/**
 * The buckets `import-core-v2.mjs` copies WHOLESALE from the previous core.json instead of rebuilding.
 *
 * `CARRY_WHOLESALE` exists to protect hand-curated records (modes, stances, runes) from being
 * clobbered by a regeneration. The cost is that a bucket on that list can never GAIN a record: the
 * importer reads the old file and ignores the export entirely. Measured 2026-08-16, after the
 * Impossible Magic delta — 78 familiar abilities and 7 animal-companion records existed in the
 * mirror and could not reach the app however many times `npm run data` was run.
 *
 * ADD-ONLY, deliberately. An existing record is left byte-for-byte alone: that is the whole point of
 * the carry list, and these buckets hold authored mechanics the mirror knows nothing about. This
 * only fills in names the app has never seen.
 */
const CARRIED_TOPUP = [
  { bucket: 'familiarAbilities', cats: ['familiar-ability', 'familiar-specific'], kind: 'familiar' },
  { bucket: 'animalCompanions', cats: ['animal-companion', 'animal-companion-unique'] },
];

function topUpCarried() {
  for (const { bucket, cats, kind } of CARRIED_TOPUP) {
    const prevMap = core[bucket] ?? {};
    const out = { ...prevMap };
    const heldAon = new Set(Object.values(prevMap).map((r) => String(r?.aonId)).filter(Boolean));
    /**
     * ⚠ A SLUG CHECK ALONE IS NOT ENOUGH, and this is not theoretical.
     *
     * `animalCompanions` keys many records under something other than their slugged name — our Hyena
     * does not live at `hyena`. Skipping only on `out[key]` would have added 74 SECOND COPIES of
     * companions the app already holds: Hyena, Roc, Riding Tarantula, Durian Crab, Hermit Krait…
     * Measured before anything was written. Match on the NAME too, since a duplicate name is what a
     * player actually sees twice in a picker.
     */
    const nameKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const heldNames = new Set(Object.values(prevMap).map((r) => nameKey(r?.name)).filter(Boolean));
    let added = 0;
    for (const cat of cats) {
      for (const rec of readCat(cat)) {
        if (rec.exclude_from_search) continue;
        const key = slug(rec.name ?? '');
        if (!key || out[key]) continue; // never touch what is already there
        if (heldNames.has(nameKey(rec.name))) continue; // …nor add a second copy under a new key
        heldNames.add(nameKey(rec.name)); // two mirror docs can share a name (both "Jimothy")
        /* A record superseded by one we already hold is a reprint, not a gap — the same rule the
         * main importer applies, restated here because this path bypasses it. */
        if (rec.superseded_by && heldAon.has(String(rec.superseded_by))) continue;
        /* The PROSE, not just the identity. A record with no description and no ast renders an empty
         * popup — measured at 98 of 209 familiar abilities when this wrote identity fields alone.
         * `descRefsOf` emits a cross-reference only where the target resolves, so no ref is dead. */
        const body = plain(rec.markdown ?? rec.text ?? '');
        const refs = body ? descRefsOf(rec.markdown, body) : [];
        out[key] = {
          id: key,
          name: rec.name,
          ...(kind ? { kind } : {}),
          ...(RARITY.has(rec.rarity) && rec.rarity !== 'common' ? { rarity: rec.rarity } : {}),
          ...(sourceOf(rec.primary_source) ? { source: sourceOf(rec.primary_source) } : {}),
          edition: editionOf(rec.primary_source),
          aonId: String(rec.id),
          ...(body ? { description: body } : {}),
          ...(refs.length ? { descRefs: refs } : {}),
        };
        /* Claim the slug so writeAst() writes THIS record's tree and no pre-existing one's. */
        TOPPED_UP[bucket]?.add(key);
        added++;
      }
    }
    stats[bucket] = { before: Object.keys(prevMap).length, after: Object.keys(out).length, added, refreshed: 0 };
    core[bucket] = out;
  }
}

/* ==================================================================== archetype reference entries */

/**
 * The two archetype GLOSSARY records whose dedications already ship in `feats` but whose reference
 * entry is absent, so description links to them render inert. AoN holds an older printing of each
 * that is flagged exclude_from_search; the importer's "best record per slug" pick ignores that flag
 * and lands on the hidden one, which deriveReference then drops — hence the gap.
 */
const ARCHETYPE_NAMES = ['Jalmeri Heavenseeker', 'Bright Lion'];

function buildArchetypes() {
  const prevMap = core.archetype ?? {};
  const out = { ...prevMap };
  const wanted = new Set(ARCHETYPE_NAMES.map(slug));
  const best = new Map();
  for (const rec of readCat('archetype')) {
    const key = slug(rec.name ?? '');
    if (!wanted.has(key) || rec.exclude_from_search) continue;
    const prev = best.get(key);
    if (!prev || (EDITION_RANK[editionOf(rec.primary_source)] ?? 9) < (EDITION_RANK[editionOf(prev.primary_source)] ?? 9)) best.set(key, rec);
  }
  let added = 0;
  let refreshed = 0;
  for (const [key, rec] of best) {
    assertOwnable('archetype', key, prevMap[key], sourceOf(rec.primary_source));
    if (prevMap[key]) refreshed++; else added++;
    out[key] = {
      id: key,
      name: rec.name,
      edition: editionOf(rec.primary_source),
      ...((rec.trait ?? []).map((t) => String(t).toLowerCase()).filter((t) => !RARITY.has(t)).length
        ? { traits: (rec.trait ?? []).map((t) => String(t).toLowerCase()).filter((t) => !RARITY.has(t)) }
        : {}),
      ...(RARITY.has(rec.rarity) && rec.rarity !== 'common' ? { rarity: rec.rarity } : {}),
      ...(sourceOf(rec.primary_source) ? { source: sourceOf(rec.primary_source) } : {}),
    };
  }
  const missing = [...wanted].filter((k) => !out[k]);
  if (missing.length) throw new Error(`archetypes not found in the mirror: ${missing.join(', ')}`);
  stats.archetype = { before: Object.keys(prevMap).length, after: Object.keys(out).length, added, refreshed };
  return out;
}

/* ============================================ Impossible Magic: a class table row opens ITS class */

/**
 * EVERY ROW OF THESE FOUR CLASS TABLES MUST OPEN A DOCUMENT OF THAT CLASS.
 *
 * PF2e gives 25 classes a row called "Weapon Expertise" and the app ships ONE record for it, on
 * whichever class's page won the slug. Measured across the whole corpus, 187 of 567 class-table rows
 * resolve to another class's document; 30 of them belong to the four Impossible Magic classes, and
 * those are the ones a player meets on a page the app has only just started shipping:
 *
 *   magus 12 · summoner 6 · necromancer 5 · runesmith 7
 *
 * A magus opening Weapon Expertise at 5th read the THAUMATURGE's page (class-feature-1178), Expert
 * and Master Spellcaster the PSYCHIC's, and the three rows Impossible Magic RENAMED still read
 * Alertness / Resolve / Juggernaut and opened Inventor, Inventor and Barbarian pages.
 *
 * Impossible Magic prints its own document for every one of the thirty, so nothing here is invented:
 * the record is the SHARED record's mechanics with this class's page, name, level and prose over the
 * top. Cloning the mechanics is load-bearing — `resolve` carries a success-to-critical-success
 * degreeShift on Will saves (which Twofold Will restates word for word), `juggernaut` the same on
 * Fortitude (Spell-Tempered Body), and `shield-block` grants the Shield Block feat, so a bare display
 * record in their place would silently take all three away.
 *
 * ⚠ THE OTHER 157 ROWS ARE LEFT ALONE, deliberately. Splitting every shared feature per class is 157
 * more records across 25 more class tables and its own batch; this closes it for the four classes
 * whose tables this lane is answerable for. scripts/class-table-diff.mjs asserts the invariant for
 * exactly these four and says so.
 */
const IM_CLASSES = { magus: 'Magus', summoner: 'Summoner', necromancer: 'Necromancer', runesmith: 'Runesmith' };
/**
 * …and ONE row on four more classes, because that row's prose is a FOUR-CLASS COMPOSITE.
 *
 * `classFeatures/spell-repertoire` is 8,817 characters reading "**Bard** … --- **Oracle** … ---
 * **Psychic** … --- **Sorcerer** …" in a single blob, so a bard opening their own Spell Repertoire
 * feature read all four classes' repertoire rules stacked on top of each other. Every one of those
 * four classes prints its own page — class-feature-625 (Player Core), -956 and -984 (Player Core 2),
 * -1141 (Dark Archives (Remastered)) — and the app already held four empty-handed per-class records
 * that all pointed at class-feature-447, the SUMMONER's Secrets of Magic page, and that no class
 * table named. Splitting is the composite's own answer: each class reads its own printing.
 *
 * Scoped to this one feature id on these four classes. Everything else they share stays shared —
 * see the note above about the other 157 rows.
 */
const OWN_PAGE_ROWS = {
  bard: { className: 'Bard', rows: ['spell-repertoire'] },
  oracle: { className: 'Oracle', rows: ['spell-repertoire'] },
  sorcerer: { className: 'Sorcerer', rows: ['spell-repertoire'] },
  psychic: { className: 'Psychic', rows: ['spell-repertoire'] },
};
/**
 * The rows Impossible Magic RENAMED: the app's table-row id -> the name IM prints for the same row.
 * Everything else matches on the record's own name, because the flavour word did not move.
 * (The summoner's L3 row is not here: it names `signature-spells-summoner`, an authored overlay record
 * carrying class-feature-1346 — the Summoner's own "Signature Spells" page — under the `<slug>-<class>`
 * id src/rules/build.ts routes through the ordinary one-signature-per-rank rule.)
 */
const IM_RENAMED = {
  magus: { alertness: 'Perception Expertise', resolve: 'Twofold Will', juggernaut: 'Spell-Tempered Body' },
};
/** Filled by buildImClassFeatures with exactly the slugs it creates, for the ast pass. */
const IM_FEATURE_IDS = new Set();

/*
 * THE PROSE, WITHOUT THE PAGE FURNITURE.
 *
 * `plain()` flattens the WHOLE document, and an AoN class-feature page opens with its own title, a
 * `Source <book> pg. N` line, a `Class <Class>` line and a `---` rule before the rules text starts. The
 * description POPUP is fine either way — it renders the ast, which draws those as proper metadata rows
 * with live links — but the flat `description` is what the Feats & Features list prints as its preview,
 * and 32 records shipped previews reading "Weapon Expertise Source Impossible Magic pg. 9 Class Magus
 * You've dedicated yourself…". Every record the FULL importer builds carries the body alone, so this is
 * the odd one out, not a house style.
 *
 * Cut only when what precedes the rule really is that block — a `Source` line inside the first few
 * lines. A page with a `---` in the middle of its prose and no furniture keeps all of it.
 */
const featureBody = (md) => {
  const s = plain(md ?? '');
  const cut = s.indexOf('\n---\n');
  return cut > 0 && /\n\nSource [^\n]+/.test(s.slice(0, cut)) ? s.slice(cut + 5).trim() : s;
};

function buildImClassFeatures() {
  const docs = readCat('class-feature');
  /*
   * WHICH ROW NEEDS ITS OWN PAGE — decided from the CLASS TABLES, not from `aonId`.
   *
   * This runs before `stamp-aonid.mjs`, which CLEARS and rewrites every aon* field, so at this point
   * in the chain a record's `aonId` is absent or self-assigned and cannot be trusted (the same reason
   * writeAst() below goes through the migration map). Reading it made the first run of this function
   * a silent no-op: every lookup missed and all 30 rows were skipped while the script reported
   * success.
   *
   * A row is shared when more than one class's table names it, which is exactly the condition that
   * makes one page have to serve several classes — and it is in core.json, complete, right here.
   */
  const namedBy = new Map();
  for (const [cid, cl] of Object.entries(core.classes ?? {})) {
    for (const f of cl.features ?? []) (namedBy.get(f.featureId) ?? namedBy.set(f.featureId, new Set()).get(f.featureId)).add(cid);
  }
  let created = 0;
  let already = 0;
  const unmatched = [];
  const scopes = [
    ...Object.entries(IM_CLASSES).map(([classId, className]) => ({ classId, className, only: null })),
    ...Object.entries(OWN_PAGE_ROWS).map(([classId, s]) => ({ classId, className: s.className, only: new Set(s.rows) })),
  ];
  for (const { classId, className, only } of scopes) {
    /*
     * The necromancer and the runesmith are not in core.json yet — `import-new-classes.mjs` merges
     * them four steps later, and it cannot move earlier (split-descriptions.mjs rebuilds the prose
     * file from whatever core.json holds, so a class merged after it renders an empty page). Their
     * tables live in work/new-classes/<id>.json and already name the per-class ids, so the rows are
     * read from there and the records are built here, in time for that merge's own "every feature the
     * table names must exist" guard.
     */
    const packPath = join('work/new-classes', `${classId}.json`);
    const rows = core.classes?.[classId]?.features
      ?? (existsSync(packPath) ? JSON.parse(readFileSync(packPath, 'utf8')).class?.features : null);
    if (!rows) continue;
    /* This class's own documents, newest printing per name — a superseded or hidden page never wins,
     * and where two live pages share a name the later release does (gold-set R12). For the four
     * Impossible Magic classes every Secrets of Magic / Dark Archive twin is superseded by the class
     * page, so this resolves to the Impossible Magic printing without naming the book. */
    const ownByName = new Map();
    for (const d of docs) {
      if (d.class !== className || d.exclude_from_search || d.superseded_by) continue;
      const k = String(d.name).toLowerCase();
      const prev = ownByName.get(k);
      if (!prev || String(d.release_date ?? '') > String(prev.release_date ?? '')) ownByName.set(k, d);
    }
    for (const row of rows) {
      /* A row read from a pack already names the per-class id; a row read from core.json names the
       * shared one. Both resolve back to the SHARED record, which is where the mechanics live. */
      const suffix = `-${classId}`;
      const suffixed = row.featureId.endsWith(suffix);
      const baseId = suffixed ? row.featureId.slice(0, -suffix.length) : row.featureId;
      if (only && !only.has(baseId)) continue; // a scoped class answers for its listed rows only
      if (suffixed && core.classFeatures?.[row.featureId]) continue; // built on an earlier run
      const rec = core.classFeatures?.[baseId];
      if (!rec) continue;
      const renamed = IM_RENAMED[classId]?.[baseId];
      if (!only && !suffixed && !renamed && (namedBy.get(row.featureId)?.size ?? 1) < 2) continue; // this class's own record already
      const want = renamed ?? rec.name;
      const doc = ownByName.get(String(want).toLowerCase());
      if (!doc) { unmatched.push(`${classId}/${row.featureId} — no ${className} document named "${want}"`); continue; }
      /* The bare slug when nothing holds it (Twofold Will, Spell-Tempered Body — rows Impossible Magic
       * named for the first time), the class-suffixed form otherwise: the convention
       * `medium-armor-expertise-inventor` and `arcane-spellcasting-magus` set. */
      const bare = slug(doc.name);
      const id = core.classFeatures[bare] ? `${bare}-${classId}` : bare;
      const body = featureBody(doc.markdown ?? doc.text ?? '');
      const refs = body ? descRefsOf(doc.markdown, body) : [];
      const { id: _id, name: _n, level: _l, aonId: _a, source: _s, edition: _e, description: _d, descRefs: _r, traits: _t, ...mechanics } = rec;
      /* A record that already carries the page's name plus a disambiguator — "Spell Repertoire
       * (Bard)" — keeps it: four rows all reading "Spell Repertoire" is what the split is for. */
      const held = core.classFeatures[id]?.name;
      core.classFeatures[id] = {
        id,
        name: held && held.replace(/\s*\([^)]*\)\s*$/, '') === doc.name ? held : doc.name,
        /* The class's OWN trait, not the 14-class list the shared record carries: these records are
         * named by one table and a picker that filters on the trait must not offer them elsewhere. */
        traits: [classId],
        ...mechanics,
        ...(sourceOf(doc.primary_source) ? { source: sourceOf(doc.primary_source) } : {}),
        level: typeof doc.level === 'number' ? doc.level : row.level,
        edition: editionOf(doc.primary_source),
        aonId: String(doc.id),
        ...(body ? { description: body } : {}),
        ...(refs.length ? { descRefs: refs } : {}),
      };
      if (rec.id === id) already++; else created++;
      row.featureId = id;
      IM_FEATURE_IDS.add(id);
    }
  }
  stats.classFeatures = { before: Object.keys(core.classFeatures).length - created, after: Object.keys(core.classFeatures).length, added: created, refreshed: already };
  if (unmatched.length) notes.push(`Impossible Magic class rows with no document of their own class (LEFT as they are):\n  ${unmatched.join('\n  ')}`);
}

/**
 * THE RUNESMITH'S RUNES, which ship with dead cross-links and no display tree.
 *
 * All 44 are hand-authored `create: true` rows in scripts/data/effect-backfill.json (the category did
 * not exist in the archive when they were written, which is why scripts/import-core-v2.mjs REF_SKIPs
 * it to this day). The archive has held `runesmith-rune-1…44` since the 2026-09-07 delta, so the one
 * player-facing bucket with no file in public/ast/ is the only one whose prose cannot resolve a link:
 * 39 of the 44 print cross-references on their own page (atryl: resistance, immunities, dazzled;
 * baruiel: frightened, emanation; esvadir: Strikes, persistent bleed damage) and shipped ZERO, and
 * the transcription also lost the bold on 34 "Invocation" and 13 "Level (+N)" lines.
 *
 * The MECHANICS stay authored — `level`, `usage`, `traits` and the rest are untouched, which is what
 * the REF_SKIP note protects. Only the cross-references are added here, and the ast pass below writes
 * the display tree from the rune's own page, which is where the bold and the live links come back.
 */
function addRunesmithRuneRefs() {
  const map = core.runesmithRune;
  if (!map) return;
  const byId = new Map(readCat('runesmith-rune').map((d) => [String(d.id), d]));
  let filled = 0;
  for (const rec of Object.values(map)) {
    const doc = byId.get(String(rec.aonId));
    if (!doc) continue;
    const body = rec.description || plain(doc.markdown ?? doc.text ?? '');
    const refs = body ? descRefsOf(doc.markdown, body) : [];
    if (!refs.length) continue;
    rec.descRefs = refs;
    filled++;
  }
  stats.runesmithRune = { before: Object.keys(map).length, after: Object.keys(map).length, added: 0, refreshed: filled };
}

/**
 * …and the SAME HOLE on the four classes' own features. `conflux-spells`, `evolution-feat`,
 * `summoner-spellcasting`, `spell-repertoire-summoner`, `mental-wards`, `runes`, `runic-crafter` and
 * `assured-runic-crafter` all print cross-references on their own page and shipped ZERO, because
 * nothing in the chain has ever built descRefs for `classFeatures`: they are carried forward from the
 * Foundry-era transcription, and a record that arrived after it has none and can never gain any.
 *
 * ADD-ONLY and scoped to the records whose source is Impossible Magic, so it cannot rewrite a
 * cross-reference somebody authored. `descRefsOf` emits a ref only where the label resolves in
 * core.json AND survives into the plain description, so nothing here can render as a dead link.
 */
function addImFeatureRefs() {
  const byId = new Map(readCat('class-feature').map((d) => [String(d.id), d]));
  let filled = 0;
  for (const [id, rec] of Object.entries(core.classFeatures ?? {})) {
    if (rec.descRefs?.length) continue;
    if (rec.source?.book !== 'Pathfinder Impossible Magic') continue;
    /* `stamp-aonid.mjs` has not run yet, so the record's own aonId is absent or self-assigned — the
     * verified join is the trustworthy answer here, exactly as it is for writeAst below. */
    const doc = byId.get(String(mapDocFor('classFeatures', id) ?? rec.aonId));
    if (!doc) continue;
    const body = rec.description || plain(doc.markdown ?? doc.text ?? '');
    const refs = body ? descRefsOf(doc.markdown, body) : [];
    if (!refs.length) continue;
    rec.descRefs = refs;
    filled++;
  }
  if (filled) notes.push(`${filled} Impossible Magic class feature(s) gained the cross-references their page prints`);
}

/* ==================================================================== the created records' prose */

/*
 * THE PROSE OF THE RECORDS import-core-v2.mjs CREATED (its step 4, listed in
 * scripts/migration/out/player-created.json).
 *
 * That step writes a new record's description from the page's display tree, which prints the page
 * HEADER as the first lines of the text: "Clockwork Wonder / Source Pathfinder Society Clockwork
 * Mystery Player's Guide pg. 9 / You have a knack…", one flattened run with no links. The Builder's
 * Background and Heritage pickers show exactly that text (they open a description, never the tree).
 *
 * So the text is re-read here from the page's markdown, the way buildHeritages reads the High Seas
 * heritages: the title, traits and header block are dropped — they are the record's own fields
 * (name, traits, source, prerequisites, price) — the printed rules lines of the header that belong to
 * the text (Trigger, Requirements, Frequency, Cost) are kept, and the links the page prints become
 * descRefs through the same resolver every record this script builds uses. A page whose only text is
 * its header (the Travel Guide's "Silver (Ingot)", a trade-goods row) keeps the header lines bar its
 * Source, so the record never goes blank.
 */
const HEADER_TEXT = /^\*\*(?:Trigger|Requirements?|Frequency|Cost)\*\*/;
function pageProse(md) {
  let s = String(md ?? '').replace(/\r/g, '');
  const cut = s.search(/<title[\s\S]{0,60}?level="2"/);
  if (cut >= 0) s = s.slice(0, cut);
  s = s.replace(/<title[\s\S]*?<\/title>/g, '').replace(/<traits>[\s\S]*?<\/traits>/g, '');
  let header = [];
  const col = /<column[^>]*>([\s\S]*?)<\/column>/.exec(s);
  if (col && /\*\*Source\*\*/.test(col[1])) {
    header = col[1].split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    s = s.slice(0, col.index) + s.slice(col.index + col[0].length);
  }
  s = s.replace(/^[ \t]*\*\*Source\*\*[^\n]*$/m, '').replace(/^\s*(?:---\s*)+/, '');
  // "**Trigger**\nYour prey is…" -> "**Trigger** Your prey is…", the way every other record prints it.
  const rules = header.filter((p) => HEADER_TEXT.test(p)).map((p) => p.replace(/^(\*\*[^*]+\*\*)[ \t]*\n[ \t]*/, '$1 '));
  const bodyMd = [...rules, s].join('\n\n');
  if (plain(bodyMd)) return bodyMd;
  return header.filter((p) => !/^\*\*Source\*\*/.test(p)).join('\n\n');
}
/** The page's own hard wraps ("One must be to Intelligence\nor Wisdom") and indents are layout, not text. */
const unwrap = (t) => t.replace(/\n[ \t]+/g, '\n').replace(/([^\n])\n(?=[a-z])/g, '$1 ');
function createdProse() {
  const path = 'scripts/migration/out/player-created.json';
  if (!existsSync(path)) return;
  let n = 0;
  for (const [bucket, m] of Object.entries(JSON.parse(readFileSync(path, 'utf8')))) {
    for (const [key, { doc }] of Object.entries(m ?? {})) {
      const rec = core[bucket]?.[key];
      const cat = String(doc).replace(/-\d+(?:-\d+)*$/, '');
      const file = join(SRC, cat, `${doc}.json`);
      if (!rec || !existsSync(file)) { notes.push(`created ${bucket}/${key}: no mirror page ${doc} — its prose stays as the importer wrote it`); continue; }
      const bodyMd = pageProse(JSON.parse(readFileSync(file, 'utf8')).markdown);
      const description = unwrap(plain(bodyMd));
      if (!description) continue;
      rec.description = description;
      const refs = descRefsOf(bodyMd, description);
      if (refs.length) rec.descRefs = refs; else delete rec.descRefs;
      n++;
    }
  }
  if (n) notes.push(`${n} created record(s) took their prose from their page's markdown (header dropped, links kept)`);
}

/* ==================================================================== run the merge */

core.siegeWeapons = buildSiegeWeapons();
core.heritages = buildHeritages();
core.deities = buildDeities();
core.languages = buildLanguages();
core.archetype = buildArchetypes();
topUpCarried();
buildImClassFeatures();
addRunesmithRuneRefs();
createdProse();

/* ==================================================================== ast (lazy-loaded descriptions)
 * Every record in core.json renders its description from public/ast/<bucket>.json — the pre-parsed
 * AoN document tree. A record with no ast falls back to its plain `description`, and a REFERENCE
 * record (archetype) has no description at all, so its popup would open empty. The trees are taken
 * from the same corpus the rest of public/ast was built from; internal links are re-pointed at
 * "bucket:slug" via public/idmap.json exactly like import-core-v2 does.
 */
const AON_CATEGORY = {
  siegeWeapons: 'siege-weapon', heritages: 'heritage', deities: 'deity', languages: 'language',
  archetype: 'archetype',
  /* The carried buckets topped up above. Without these, a record arrives with an identity and no
   * prose and no display tree — measured: 98 of the 209 familiar abilities could render NOTHING,
   * because `topUpCarried` wrote {id,name,kind,source,edition,aonId} and stopped there. */
  familiarAbilities: 'familiar-ability', animalCompanions: 'animal-companion',
  /* The 30 Impossible Magic per-class rows built above, and the runesmith's 44 runes — the one
   * player-facing bucket that had no file in public/ast/ at all, so its cross-links had no display
   * path that could render them and the bold its page prints was simply gone. */
  classFeatures: 'class-feature', runesmithRune: 'runesmith-rune',
};

/** The slugs this script authored — the only asts it may (re)write. Everything else in a bucket's
 *  ast file was produced by the full importer and is left exactly as found. */
const OWNED_IDS = {
  heritages: new Set(Object.keys(HERITAGE_MECHANICS)),
  deities: new Set(DEITY_NAMES.map(slug)),
  languages: new Set(LANGUAGE_NAMES.map(slug)),
  archetype: new Set(ARCHETYPE_NAMES.map(slug)),
  /* Filled by topUpCarried with exactly the slugs it added, so the ast pass writes those and leaves
   * every pre-existing record's tree untouched. */
  familiarAbilities: TOPPED_UP.familiarAbilities,
  animalCompanions: TOPPED_UP.animalCompanions,
  classFeatures: IM_FEATURE_IDS,
  runesmithRune: new Set(Object.keys(core.runesmithRune ?? {})),
};
const ownsSlug = (bucket, s) => (bucket === 'siegeWeapons' ? !CURATED_SIEGE_IDS.has(s) : OWNED_IDS[bucket].has(s));

/** The verified join, read the same way import-core-v2.mjs reads it. Absent file = no opinion. */
const mapDocFor = (() => {
  let mig = null;
  try { mig = JSON.parse(readFileSync('scripts/migration/out/map.json', 'utf8')).map ?? {}; } catch { return () => null; }
  return (bucket, s) => {
    const m = mig[bucket]?.[s];
    // `joinDocId`: the join's page where an owner's aonId ruling replaced it (build-map.mjs); writeAst
    // reads the ruling itself first (PINNED_AON).
    return m && (m.status === 'doc' || m.status === 'scraped') ? m.joinDocId ?? m.docId : null;
  };
})();

/** `bucket|id` -> the aonId an overlay row rules for that record (see writeAst). */
const PINNED_AON = new Map(readBackfill('.')
  .filter((r) => r?.field === 'aonId' && !r.path?.length && typeof r.value === 'string')
  .map((r) => [`${r.category}|${r.id}`, r.value]));

function writeAst() {
  if (!existsSync(EXPORT)) { notes.push(`ast SKIPPED: no export at ${EXPORT} (records fall back to their plain description)`); return; }
  const idMap = existsSync('public/idmap.json') ? JSON.parse(readFileSync('public/idmap.json', 'utf8')) : {};
  if (!Object.keys(idMap).length) notes.push('ast: public/idmap.json missing — in-description links in the NEW records render as plain prose');
  const resolveTo = (to) => {
    const hit = idMap[to];
    return hit && core[hit.bucket]?.[hit.slug] ? `${hit.bucket}:${hit.slug}` : null;
  };
  const resolveAst = (node) => {
    if (!node || typeof node !== 'object') return node;
    const out = Array.isArray(node) ? [] : {};
    for (const k in node) {
      if (k === 'to') { out.ref = resolveTo(node.to); out.to = node.to; }
      else if (k === 'c') out.c = node.c.map(resolveAst);
      else out[k] = node[k];
    }
    return out;
  };

  mkdirSync('public/ast', { recursive: true });
  const index = existsSync('public/ast-index.json') ? JSON.parse(readFileSync('public/ast-index.json', 'utf8')) : {};
  const astStats = {};
  for (const bucket of BUCKETS) {
    const file = join(EXPORT, `${AON_CATEGORY[bucket]}.json`);
    if (!existsSync(file)) { notes.push(`ast: no export file for ${bucket}`); continue; }
    const docs = JSON.parse(readFileSync(file, 'utf8')).docs ?? {};
    // Which export doc backs each shipped slug: the one whose id the idmap points at this slug, or
    // (fallback) any doc whose name slugs to it. Hidden/superseded printings never win.
    const bySlug = new Map();
    for (const [id, d] of Object.entries(docs)) {
      if (!d?.ast || d.exclude_from_search === 1 || d.superseded_by) continue;
      const s = idMap[id]?.bucket === bucket ? idMap[id].slug : slug(d.name ?? '');
      if (!core[bucket]?.[s]) continue;
      const prev = bySlug.get(s);
      if (!prev || (EDITION_RANK[d.edition] ?? 9) < (EDITION_RANK[prev.edition] ?? 9)) bySlug.set(s, d);
    }
    const astPath = `public/ast/${bucket}.json`;
    const existing = existsSync(astPath) ? JSON.parse(readFileSync(astPath, 'utf8')) : {};
    /*
     * THE RECORD'S OWN DOCUMENT BEATS THE EDITION-RANK PICK — the same rule, for the same reason, as
     * scripts/import-core-v2.mjs. The loop below OVERWRITES the full importer's page for every slug
     * this script authored, so picking by edition rank here put the page back on the wrong document
     * after the importer had already put it on the right one: all 18 Guns & Gears siege weapons
     * rendered the REMASTERED page (siege-weapon-2…20) while the record is the original printing
     * (siege-weapon-69…90) — the book its own source line names — and four familiar abilities did the
     * same.
     *
     * `core` here is the IN-FLIGHT core.json: stage 1 has already rewritten it and stamp-aonid has not
     * reached it yet, so its `aonId` is absent or self-assigned and cannot be trusted at this point in
     * the chain. In order: the provenance stamp the importer just wrote, then the verified join
     * (scripts/migration/out/map.json, which is what stamp-aonid will read), then whatever aonId the
     * record does carry. Guarded by scripts/ast-provenance-check.mjs.
     */
    /* …and an OWNER'S aonId ruling (an `aonId` row in scripts/data/effect-backfill.json, e.g. the
     * scripts/fix-aonid-collisions.mjs repoints) before all three: it is re-applied over the stamp at
     * the end of the chain, so a page built from anything else disagrees with the record it is
     * attached to. `familiarAbilities/breath-weapon` (the APG Faerie Dragon's) kept rendering the House
     * Drake's page of the same name after its repoint, because the importer's slug pick had recorded
     * that page. */
    for (const s of [...bySlug.keys()]) {
      const own = docs[String(PINNED_AON.get(`${bucket}|${s}`) ?? existing[s]?.aon ?? mapDocFor(bucket, s) ?? core[bucket]?.[s]?.aonId ?? '')];
      if (own?.ast) bySlug.set(s, own);
    }
    const out = { ...existing };
    let addedAst = 0;
    for (const [s, d] of bySlug) {
      if (!ownsSlug(bucket, s) && (STRICT_AST.has(bucket) || s in existing)) continue; // never rewrite the full importer's ast
      if (!(s in existing)) addedAst++;
      out[s] = resolveAst(d.ast);
      if (d.id) out[s].aon = d.id; // provenance — see scripts/ast-provenance-check.mjs
    }
    const ordered = {};
    for (const s of Object.keys(out).sort()) ordered[s] = out[s];
    const json = JSON.stringify(ordered);
    writeFileSync(astPath, json);
    writeFileSync(`${astPath}.gz`, gzipSync(json, { level: 9 }));
    for (const s of Object.keys(ordered)) if (!(s in index)) index[s] = bucket; // additive: never re-point an existing slug
    astStats[bucket] = { total: Object.keys(ordered).length, added: addedAst };
  }
  const orderedIndex = {};
  for (const s of Object.keys(index).sort()) orderedIndex[s] = index[s];
  writeFileSync('public/ast-index.json', JSON.stringify(orderedIndex));
  stats._ast = astStats;
}

/* Below `mapDocFor`, which it reads for the same reason writeAst does: `stamp-aonid.mjs` runs four
 * steps later and a record's own aonId cannot be trusted at this point in the chain. */
addImFeatureRefs();

if (!DRY && !NO_AST) writeAst();

/* ==================================================================== report */

const pad = (s, n) => String(s).padEnd(n);
console.log('\ncollection        before   after   added   refreshed  name-dupes collapsed');
for (const b of BUCKETS) {
  const s = stats[b];
  console.log(`${pad(b, 17)} ${pad(s.before, 8)} ${pad(s.after, 7)} ${pad(s.added, 7)} ${pad(s.refreshed ?? 0, 10)} ${s.collapsed ?? 0}`);
}
for (const b of BUCKETS) {
  const s = stats[b];
  if (s.skipped?.length) console.log(`\n${b} — curated record, LEFT UNTOUCHED (${s.skipped.length}):\n  ${s.skipped.join('\n  ')}`);
}
if (stats.siegeWeapons.noFrame?.length)
  console.log(`\nsiege weapons with NO defensive frame in AoN (no AC/HP/Hardness stated — omitted, not invented) (${stats.siegeWeapons.noFrame.length}):\n  ${stats.siegeWeapons.noFrame.join(', ')}`);
if (stats._ast) {
  console.log('\nast (public/ast/<bucket>.json + .gz):');
  for (const [b, s] of Object.entries(stats._ast)) console.log(`  ${pad(b, 16)} +${s.added} (total ${s.total})`);
}
if (notes.length) console.log(`\nnotes:\n  ${notes.join('\n  ')}`);

// The records this script CREATES do not exist when import-core-v2 applies effect-backfill.json, so
// their hand-authored patches are skipped there — and then overwritten here by a fresh parse. Four
// were silently inert for exactly that reason (cecaelia-merfolk's climb Speed and land-Speed floor,
// camouflage-tripkee's terrain choice, the Surveyors' alternate domains). Re-applying is safe: every
// row is an absolute assignment, so applying it twice is applying it once.
{
  const { applied, unresolved } = applyBackfill(core);
  console.log(`\nre-applied ${applied} effect backfills over the gap-imported records`);
  if (unresolved.length) console.warn(`!! ${unresolved.length} backfill paths did not resolve:\n  ` + unresolved.join('\n  '));
  // The re-apply may have set a whole class option list again — put back the options
  // import-core-v2.mjs created (scripts/lib/player-create.mjs).
  const createdPath = 'scripts/migration/out/player-created.json';
  const appended = existsSync(createdPath) ? appendSubclassOptions(core, JSON.parse(readFileSync(createdPath, 'utf8'))) : 0;
  if (appended) console.log(`re-appended ${appended} created class option(s) the re-apply had replaced`);
  /*
   * …and the re-apply wrote every overlay `source` row back, AFTER import-core-v2's same-book pass: fourteen
   * rows spelt the Grand Bazaar "Pathfinder Grand Bazaar" (animalCompanions/beetle, familiarAbilities/snoop …),
   * one the Foolish Housekeeping blog post "Pathfinder …" (familiarAbilities/kick-up-dust) and one a curly
   * "Gatewalkers Player’s Guide (Remastered)" (backgrounds/sense-of-belonging), and each landed
   * on the Sources card as a second row of one book (desk #166). So the pass runs again here, the last step of
   * `npm run data` that writes a record's book from the overlay. foldBookSpellings, scripts/lib/aon-facets.mjs.
   * The sixteen rows were respelt to the table's key once this pass shipped them (2026-09-29,
   * work/sources-lane-2026-09-29-source-rows.json), so scripts/regen-durability-check.mjs — which holds every
   * overlay row equal to the artefact — still fails a NEW row that spells a book another way.
   */
  const folded = foldBookSpellings(core, LABELLED_BUCKETS);
  console.log(`${folded.length} record(s) the re-apply spelt another way took the table's spelling of their book`);
  for (const m of folded) console.log(`   ${m}`);
}

/*
 * …and THEN the printed-Frequency counters again, because "every row is an absolute assignment" cuts
 * both ways. A `counters` row REPLACES the array, so the re-apply above restored bravery-baldric's
 * curated 2-charge pool and with it discarded the per-hour counter the pass at the end of
 * import-core-v2.mjs had added beside it — the two records daily preparations still had nothing to
 * refill after a chain that reported success. Both belong: the pool is the baldric's charges (they
 * reset to 0 on investment, not on rest) and the counter is its printed "Frequency once per hour".
 *
 * This is the LAST step of `npm run data` that touches an item's counters or its inline description
 * (split-descriptions.mjs moves the text out next), so it is the last place the pass can run. Add-only
 * and idempotent: on every record the re-apply did not touch it finds the counter already there.
 */
{
  const { filled, gained } = fillFrequencyCounters(core.items);
  console.log(`item uses: ${filled} record(s) regained ${gained} printed-Frequency counter(s) the backfill re-apply had replaced`);
}

/*
 * …and a class option's text (and its record's links) from its record again (2026-09-30): the re-apply above wrote every whole-list
 * `options` row back (wizard, magus, thaumaturge, animist …), each option with the text it had when the row was
 * written. The last step before split-descriptions.mjs, so the copy split leaves in core.json is the record's.
 * scripts/lib/embedded-descriptions.mjs; the same pass ends import-core-v2 and import-new-classes.
 */
{
  const { synced, linked, kept } = syncOptionDescriptions(core, recordReader(core), new Set(loadEmbeddedBaseline('.').keys()));
  console.log(`class options: ${synced.length} embedded description(s) the re-apply restated took their record's text again, ${linked.length} its links; ${kept.length} baselined`);
}

if (DRY) {
  console.log('\n--dry-run: core.json NOT written');
} else {
  writeFileSync(OUT, JSON.stringify(core));
  console.log(`\nwrote ${OUT}`);
}
