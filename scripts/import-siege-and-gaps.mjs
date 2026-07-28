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

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp|ndash|mdash);/g, (m) => ENTITIES[m] ?? m);

/** `[label](url)` -> `label`. Run BEFORE any line-based processing. */
const unlink = (md) => String(md ?? '').replace(/\r/g, '').replace(/\[([\s\S]*?)\]\((?:[^()]|\([^()]*\))*\)/g, '$1');

/** AoN ships ~829 documents with UNSUBSTITUTED cross-reference templates (`<%EQUIPMENT%3021%%>label<%END>`).
 *  Drop the markers and keep the label (see audit note project_aon_text_formatting_issues). */
const stripTemplates = (s) => (s.indexOf('<%') === -1 ? s : s.replace(/<%[^>]*?>/g, '').replace(/ {2,}/g, ' '));

/** AoN markdown -> plain text: unwrap links, drop tags, keep list/paragraph breaks. */
function plain(md) {
  let s = stripTemplates(unlink(md));
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<actions\s+string="([^"]*)"\s*\/>/g, (_, a) => ` (${ACTION_WORD[a] ?? a}) `);
  s = s.replace(/<\/li>\s*<li>/g, '\n• ');
  s = s.replace(/<ul>\s*<li>/g, '\n• ').replace(/<\/li>\s*<\/ul>/g, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/\*\*/g, '');
  s = s.replace(/(^|[\s(“"'[])_(?=\S)/g, '$1').replace(/(?<=\S)_(?=$|[\s).,;:!?”"'\]])/g, '');
  s = decode(s);
  // AoN's own typography defects: a hard-wrapped "10- foot burst", the degree sign variants.
  s = s.replace(/(\d)-\s+(foot|ft)\b/g, '$1-$2');
  return s.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
}

const ACTION_WORD = {
  'Single Action': '1 action', 'Two Actions': '2 actions', 'Three Actions': '3 actions',
  'Free Action': 'free action', Reaction: 'reaction',
};

const readCat = (cat) => {
  const dir = join(SRC, cat);
  if (!existsSync(dir)) throw new Error(`missing AoN mirror category dir: ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== '_index.json')
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
};

/* ------------------------------------------------------------------ core.json context */

const core = JSON.parse(readFileSync(CORE, 'utf8'));
const BUCKETS = ['siegeWeapons', 'heritages', 'deities', 'languages', 'archetype'];

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
function mapBook(book) {
  const b = String(book || '').trim();
  if (!b) return undefined;
  return canonBook[normBook(b)] ?? (/^Pathfinder /i.test(b) ? b : `Pathfinder ${b}`);
}
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
 *  target actually resolves in core.json, so no ref renders as a dead link. */
function descRefsOf(md, body) {
  const out = [];
  const seen = new Set();
  for (const m of String(md ?? '').replace(/\r/g, '').matchAll(/\[([\s\S]*?)\]\(\/([A-Za-z]+\.aspx)[^)]*\)/g)) {
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
const CURATED_SIEGE_IDS = new Set(['ballista', 'catapult', 'trebuchet', 'ram', 'cannon']);

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

  for (const [key, rec] of [...best].sort((a, b) => a[0].localeCompare(b[0]))) {
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

/* ==================================================================== run the merge */

core.siegeWeapons = buildSiegeWeapons();
core.heritages = buildHeritages();
core.deities = buildDeities();
core.languages = buildLanguages();
core.archetype = buildArchetypes();

/* ==================================================================== ast (lazy-loaded descriptions)
 * Every record in core.json renders its description from public/ast/<bucket>.json — the pre-parsed
 * AoN document tree. A record with no ast falls back to its plain `description`, and a REFERENCE
 * record (archetype) has no description at all, so its popup would open empty. The trees are taken
 * from the same corpus the rest of public/ast was built from; internal links are re-pointed at
 * "bucket:slug" via public/idmap.json exactly like import-core-v2 does.
 */
const AON_CATEGORY = { siegeWeapons: 'siege-weapon', heritages: 'heritage', deities: 'deity', languages: 'language', archetype: 'archetype' };

/** The slugs this script authored — the only asts it may (re)write. Everything else in a bucket's
 *  ast file was produced by the full importer and is left exactly as found. */
const OWNED_IDS = {
  heritages: new Set(Object.keys(HERITAGE_MECHANICS)),
  deities: new Set(DEITY_NAMES.map(slug)),
  languages: new Set(LANGUAGE_NAMES.map(slug)),
  archetype: new Set(ARCHETYPE_NAMES.map(slug)),
};
const ownsSlug = (bucket, s) => (bucket === 'siegeWeapons' ? !CURATED_SIEGE_IDS.has(s) : OWNED_IDS[bucket].has(s));

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
    const out = { ...existing };
    let addedAst = 0;
    for (const [s, d] of bySlug) {
      if (!ownsSlug(bucket, s) && s in existing) continue; // never rewrite the full importer's ast
      if (!(s in existing)) addedAst++;
      out[s] = resolveAst(d.ast);
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

if (DRY) {
  console.log('\n--dry-run: core.json NOT written');
} else {
  writeFileSync(OUT, JSON.stringify(core));
  console.log(`\nwrote ${OUT}`);
}
