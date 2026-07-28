/**
 * TARGETED companion/familiar re-import.
 *
 * Rebuilds ONLY the companion + familiar collections of public/core.json from the Archives-of-GuyB
 * AoN mirror (one JSON file per record under data/by-category/). Everything else in core.json is
 * left byte-for-byte alone — this is deliberately NOT the full importer (scripts/import-core-v2.mjs),
 * which regenerates the whole file and has previously clobbered hand-curated work.
 *
 * Collections written:
 *   animalCompanions            <- animal-companion + animal-companion-unique
 *   companionSpecializations    <- animal-companion-specialization
 *   companionAdvanced           <- animal-companion-advanced        (new bucket)
 *   familiarAbilities           <- familiar-ability (generic only)  (MERGED, see below)
 *   specificFamiliars           <- familiar-specific                (new bucket; was hardcoded in
 *                                  src/rules/specificFamiliars.ts)
 *
 * Rules the merge follows:
 *   • MERGE, never blind-replace. An existing record is overlaid field-by-field; a field AoN can't
 *     yield keeps the old value. Records the app has and AoN doesn't (Foundry-only familiar
 *     abilities, the hand-authored Construct Companion) are kept untouched.
 *   • ID STABILITY. A record whose normalized name already exists keeps its CURRENT id (many are
 *     `aon-<name>` from an earlier pass) so saved characters never lose their companion.
 *   • EDITIONS. A record AoN marks `remaster_id` is the superseded half of a remaster change and is
 *     pruned; the survivor gets edition = remaster (has `legacy_id`) or its source book's edition.
 *   • SOURCES. Every imported record gets `source.book`, canonicalized against the book names
 *     already used elsewhere in core.json (so it lands on the same Sources shelf).
 *
 * Re-runnable: running it twice produces the same core.json.
 * Run: node scripts/import-companions.mjs [--dry-run] [--out <path>]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = process.env.AON_DATA || 'C:/trying ai 2/Archives of GuyB/data/by-category';
const CORE = 'public/core.json';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : CORE;

/* ------------------------------------------------------------------ small helpers */

/** The EXACT slug() the engine + saved characters key off (must not drift). */
const slug = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&ndash;': '–', '&mdash;': '—' };
const decode = (s) => s.replace(/&(amp|lt|gt|quot|#39|nbsp|ndash|mdash);/g, (m) => ENTITIES[m] ?? m);

/** `[label](url)` -> `label`. Run BEFORE any line-based processing: a few records wrap the link
 *  label across a newline (Riding Dragonet's Source line), which would otherwise strand the `](…)`. */
const unlink = (md) => String(md ?? '').replace(/\r/g, '').replace(/\[([\s\S]*?)\]\((?:[^()]|\([^()]*\))*\)/g, '$1');

/** AoN markdown -> plain text: unwrap links, drop tags, keep list/paragraph breaks. */
function plain(md) {
  let s = unlink(md);
  s = s.replace(/<br\s*\/?>/g, '\n');
  s = s.replace(/<\/li>\s*<li>/g, '\n• ');
  s = s.replace(/<ul>\s*<li>/g, '\n• ').replace(/<\/li>\s*<\/ul>/g, '\n');
  s = s.replace(/<[^>]*>/g, '');
  // Emphasis markers: drop `**` outright, and `_` only where it opens/closes a run (so an
  // underscore inside a word survives, and nested `_a _b_ c_` doesn't leave orphans behind).
  s = s.replace(/\*\*/g, '');
  s = s.replace(/(^|[\s(“"'[])_(?=\S)/g, '$1').replace(/(?<=\S)_(?=$|[\s).,;:!?”"'\]])/g, '');
  s = decode(s);
  return s.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').split('\n').map((l) => l.trimEnd()).join('\n').trim();
}

/** Read one bold-labelled field out of an AoN markdown block ("**Size** Small"). */
function field(md, label) {
  const m = String(md ?? '')
    .replace(/\r/g, '')
    .match(new RegExp(`\\*\\*${label}\\*\\*[ \\t]*\\n?([\\s\\S]*?)(?=\\n\\s*\\n\\s*\\*\\*|\\n\\s*\\n\\s*<|\\n<document|$)`));
  return m ? plain(m[1]) : undefined;
}

/** Split a comma-separated AoN list without breaking on commas inside parentheses. */
const splitList = (s) =>
  String(s ?? '')
    .split(/,(?![^(]*\))/)
    .map((x) => x.trim())
    .filter(Boolean);

const readCat = (cat) => {
  const dir = join(SRC, cat);
  if (!existsSync(dir)) throw new Error(`missing AoN category dir: ${dir}`);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && f !== '_index.json')
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
};

/* ------------------------------------------------------------------ core.json context */

const core = JSON.parse(readFileSync(CORE, 'utf8'));

/** book edition ("Core Rulebook" -> "legacy-era"), from core.json's own `source` catalog. */
const bookEdition = {};
for (const s of Object.values(core.source ?? {})) if (s?.name) bookEdition[String(s.name).trim()] = s.edition;

/** AoN ships SHORT book names ("Player Core"); core.json uses the canonical Foundry-style name
 *  ("Pathfinder Player Core"). Align to whatever the rest of core.json already uses. */
const normBook = (s) =>
  String(s || '').toLowerCase().replace(/^pathfinder\s+/, '').replace(/^lost omens:?\s*/, '').replace(/[^a-z0-9]+/g, ' ').trim();
const canonBook = {};
for (const bucket of Object.keys(core)) {
  const map = core[bucket];
  if (!map || typeof map !== 'object' || Array.isArray(map)) continue;
  for (const e of Object.values(map)) {
    const b = e && typeof e === 'object' ? e.source?.book?.trim() : null;
    if (b && !canonBook[normBook(b)]) canonBook[normBook(b)] = b;
  }
}
function mapBook(book) {
  const b = String(book || '').trim();
  if (!b) return undefined;
  return canonBook[normBook(b)] ?? (/^Pathfinder /i.test(b) ? b : `Pathfinder ${b}`);
}

/** Edition of a KEPT (non-superseded) record: remaster when AoN links a legacy predecessor,
 *  otherwise its source book's edition. Verified 378/378 against the hh-data-export's own field. */
function editionOf(rec) {
  if (rec.remaster_id) return 'legacy';
  if (rec.legacy_id) return 'remaster';
  return bookEdition[String(rec.primary_source || '').trim()] ?? 'neutral';
}

const EDITION_RANK = { remaster: 0, 'remaster-era': 1, neutral: 2, 'legacy-era': 3, legacy: 4 };
const RARITY = new Set(['common', 'uncommon', 'rare', 'unique']);

const stats = {};
/** Prune superseded records, then collapse any remaining same-name duplicates (newest edition wins). */
function dedupe(recs, key) {
  const superseded = recs.filter((r) => r.remaster_id).length;
  const live = recs.filter((r) => !r.remaster_id);
  const byName = new Map();
  let collapsed = 0;
  for (const r of live) {
    const k = slug(r.name);
    const prev = byName.get(k);
    if (!prev) { byName.set(k, r); continue; }
    collapsed++;
    const better =
      (EDITION_RANK[editionOf(r)] ?? 9) < (EDITION_RANK[editionOf(prev)] ?? 9) ||
      (editionOf(r) === editionOf(prev) && String(r.release_date) > String(prev.release_date));
    if (better) byName.set(k, r);
  }
  stats[key] = { ...(stats[key] ?? {}), raw: recs.length, superseded, collapsed, unique: byName.size };
  return byName;
}

/** Existing normalized-name -> current id, so a record the app already ships keeps its id. */
function idIndex(map) {
  const idx = new Map();
  for (const [id, e] of Object.entries(map ?? {})) if (e?.name) idx.set(slug(e.name), id);
  return idx;
}

/* ------------------------------------------------------------------ descRefs from AoN links */

/** AoN page -> the ContentDatabase bucket a link resolves against (descref.ts `key`). */
const LINK_BUCKET = {
  'actions.aspx': 'actions',
  'conditions.aspx': 'conditions',
  'spells.aspx': 'spells',
  'equipment.aspx': 'items',
  'feats.aspx': 'feats',
  'traits.aspx': 'trait',
  'skills.aspx': 'skill',
  'rules.aspx': 'rules',
  'familiars.aspx': 'familiarAbilities',
  'animalcompanions.aspx': 'animalCompanions',
  'archetypes.aspx': 'archetype',
  'deities.aspx': 'deities',
  'ancestries.aspx': 'ancestries',
  'classes.aspx': 'classes',
};
/** lowercase display name -> present, per bucket (mirrors descref.ts's name index). */
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
/** Cross-references for a description, taken from the AoN markdown's own links — emitted only when
 *  the target actually resolves in core.json, so no ref can render as a dead link. */
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

/* ------------------------------------------------------------------ animal companions */

const SKILL_IDS = new Set([
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine',
  'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery',
]);
const ACTION_COST_WORD = { 'Single Action': 'single action', 'Two Actions': 'two actions', 'Three Actions': 'three actions', Reaction: 'reaction', 'Free Action': 'free action' };

const actionById = {};
for (const a of readCat('action')) actionById[a.id] = a;

/** "Badger Rage (single action): <effect>" — the shape CompanionsTab's maneuverNode() parses into a
 *  name + an action-cost glyph. AoN gives the companion only the maneuver's NAME plus a document
 *  reference, so the effect text is pulled from the referenced action record. */
function maneuverText(md) {
  const name = field(md, 'Advanced Maneuver');
  if (!name) return undefined;
  const ref = String(md).match(/<document level="2" id="(action-\d+)"/);
  const act = ref ? actionById[ref[1]] : null;
  if (!act) return name;
  const cost = ACTION_COST_WORD[act.actions];
  const parts = [];
  for (const [label, key] of [['Requirements', 'requirement'], ['Trigger', 'trigger'], ['Frequency', 'frequency']]) {
    if (act[key]) parts.push(`${label} ${plain(act[key])}`);
  }
  const body = plain(String(act.markdown).replace(/\r/g, '').split(/\n-{3,}\n/).slice(1).join('\n')) || plain(act.summary);
  const effect = [...parts, body].filter(Boolean).join('. ').replace(/\.\.+/g, '.');
  return `${act.name}${cost ? ` (${cost})` : ''}${effect ? `: ${effect}` : ''}`;
}

/** Melee blocks: "**Melee** <actions/> jaws (Agile), **Damage** 1d8 piercing". */
function parseAttacks(md) {
  const out = [];
  for (const m of String(md).replace(/\r/g, '').matchAll(/\*\*(Melee|Ranged)\*\*\s*\n?<actions[^>]*>\s*\n?([\s\S]*?)\*\*Damage\*\*[ \t]*([^\n]*)/g)) {
    const head = plain(m[2]).replace(/,\s*$/, '').trim();
    const hm = head.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const rawName = (hm ? hm[1] : head).trim();
    if (!rawName) continue;
    const traits = hm ? hm[2].split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) : [];
    const dmg = plain(m[3]).trim();
    const dm = dmg.match(/^(\d+d\d+)\s+([a-z]+)/i);
    if (!dm) continue;
    const atk = {
      name: rawName.charAt(0).toUpperCase() + rawName.slice(1),
      die: dm[1],
      damageType: dm[2].toLowerCase(),
      traits,
    };
    const rest = dmg.slice(dm[0].length).trim();
    const plus = rest.match(/^plus\s+(.+)$/i);
    if (plus) atk.plus = plus[1].trim();
    // "1d8 negative (doesn't apply the ghost's Strength modifier)"
    else if (/doesn.t apply .*strength modifier/i.test(rest)) atk.noStrengthDamage = true;
    out.push(atk);
  }
  return out;
}

/** Senses, from AoN's own `sense_markdown` facet. Returns null only when AoN carries NO sense field
 *  at all (so the caller can keep the old value); an explicit "Normal" means "no special senses". */
function parseSenses(rec) {
  const src = rec.sense_markdown ?? rec.sense;
  if (src == null) return null;
  const raw = plain(src);
  if (!raw || /^normal$/i.test(raw)) return [];
  return splitList(raw.replace(/\n+/g, ' ')).map((s) => s.trim()).filter(Boolean);
}

/** The flavour paragraph: everything between the Source line and the stat-block `<column>`. AoN's
 *  `summary` facet is ellipsis-truncated at ~150 chars, so it can't be used for this. */
function flavorText(md) {
  const head = unlink(md).split('<column')[0];
  return plain(
    head
      .replace(/<title[\s\S]*?<\/title>/g, '')
      .replace(/<traits>[\s\S]*?<\/traits>/g, '')
      .replace(/\*\*Source\*\*[^\n]*/g, ''),
  );
}

function buildAnimalCompanions() {
  const uniq = dedupe([...readCat('animal-companion'), ...readCat('animal-companion-unique')], 'animalCompanions');
  const prevMap = core.animalCompanions ?? {};
  const prevId = idIndex(prevMap);
  const out = { ...prevMap };
  const kept = [];
  let added = 0;
  let overlaid = 0;
  // A "unique" companion (Fiery Leopard) is a TEMPLATE over a base type ("Base Animal Companion:
  // Cat") and has no stat block of its own — build the bases first so it can inherit one instead of
  // shipping as an unusable stub.
  const ordered = [...uniq].sort((a, b) => Number(!!field(String(a[1].markdown), 'Base Animal Companion')) - Number(!!field(String(b[1].markdown), 'Base Animal Companion')));
  for (const [key, rec] of ordered) {
    const id = prevId.get(key) ?? key;
    const md = String(rec.markdown ?? '').replace(/\r/g, '');
    // Inherit from the base type when this is a unique template; otherwise from the app's own record.
    const baseName = field(md, 'Base Animal Companion');
    const base = baseName ? out[prevId.get(slug(baseName)) ?? slug(baseName)] : undefined;
    const prev = base ?? prevMap[id];
    const ab = { str: rec.strength, dex: rec.dexterity, con: rec.constitution, int: rec.intelligence, wis: rec.wisdom, cha: rec.charisma };
    for (const k of Object.keys(ab)) if (typeof ab[k] !== 'number') ab[k] = prev?.abilities?.[k] ?? 0;
    const speeds = {};
    for (const k of ['land', 'fly', 'swim', 'climb', 'burrow']) if (typeof rec.speed?.[k] === 'number') speeds[k] = rec.speed[k];
    const attacks = parseAttacks(md);
    const skills = (rec.skill ?? []).map((s) => String(s).toLowerCase().trim()).filter((s) => SKILL_IDS.has(s));
    const senses = parseSenses(rec);
    const traits = (rec.trait ?? []).map((t) => String(t).toLowerCase()).filter((t) => !RARITY.has(t));
    // A unique template's whole rules payload lives in its `<column>` block (immunities, extra
    // abilities); keep it as the entry's Special so nothing is dropped on the floor.
    const uniqueBlock = base ? plain(md.slice(md.indexOf('<column')).replace(/\*\*Base Animal Companion\*\*[^\n]*/, '')) : undefined;
    const special = field(md, 'Special') ?? uniqueBlock;
    const access = field(md, 'Access');
    const flavor = base ? `A ${baseName} animal companion with a unique template applied.` : flavorText(md);
    const description = [flavor, special ? `Special ${special}` : '', access ? `Access ${access}` : '']
      .filter(Boolean)
      .join('\n\n');

    const entry = {
      id,
      name: rec.name,
      ...(prev?.category ?? (traits.includes('construct') ? 'construct' : undefined)
        ? { category: prev?.category ?? 'construct' }
        : {}),
      size: field(md, 'Size') || (rec.size ?? []).join(' or ') || prev?.size || 'Medium',
      hp: typeof rec.hp === 'number' ? rec.hp : prev?.hp ?? 6,
      abilities: ab,
      senses: senses ?? prev?.senses ?? [],
      speeds: Object.keys(speeds).length ? speeds : prev?.speeds ?? {},
      attacks: attacks.length ? attacks : prev?.attacks ?? [],
      skills: skills.length ? skills : prev?.skills ?? [],
      support: field(md, 'Support Benefit') ?? prev?.support ?? '',
      maneuver: maneuverText(md) ?? prev?.maneuver ?? '',
      ...(special ? { special } : {}),
      ...(description ? { description } : {}),
      ...(rec.rarity && rec.rarity !== 'common' ? { rarity: rec.rarity } : {}),
      ...(traits.length ? { traits } : {}),
      source: { book: mapBook(rec.primary_source) },
      edition: editionOf(rec),
    };
    if (prevMap[id]) overlaid++; else added++;
    if (base) kept.push(`${rec.name}: stat block inherited from its base companion (${baseName})`);
    else {
      if (!attacks.length && prev?.attacks?.length) kept.push(`${rec.name}: attacks`);
      if (!skills.length && prev?.skills?.length) kept.push(`${rec.name}: skills`);
    }
    out[id] = entry;
  }
  const noAoN = Object.keys(prevMap).filter((id) => out[id] === prevMap[id]);
  stats.animalCompanions = { ...stats.animalCompanions, before: Object.keys(prevMap).length, after: Object.keys(out).length, overlaid, added, keptFoundryOnly: noAoN.length, keptIds: noAoN, kept };
  return out;
}

/* ------------------------------------------------------------------ specializations */

/**
 * MECHANICS for the five specializations the app didn't ship. Transcribed by hand from the AoN text
 * each record carries (the prose is the description; these are the numbers the engine needs). Kept
 * beside the importer, not in the data file, because AoN's text is not machine-readable here.
 */
const SPEC_MECHANICS = {
  'deep-diver': {
    abilityBoosts: { con: 1 },
    skills: [{ skill: 'athletics', rank: 'master' }],
    note: 'Gains a swim Speed of 30 feet (or +10 ft to an existing swim Speed) and can breathe underwater. Barding proficiency becomes expert. Marid-touched companions only.',
  },
  shade: {
    acRank: 'expert',
    note: 'Its form is partly shadow: it gains darkvision and resistance 5 to all damage except force, and in dim light or darkness it can Step 10 feet. Access: Shadowcaster.',
  },
  'steadfast-strider': {
    abilityBoosts: { str: 1 },
    note: 'Ignores natural difficult and greater difficult terrain from sediment or stone and crosses quicksand/mud as if solid; +2 status bonus to saves and DCs vs Shove and Trip. Barding proficiency becomes expert. Shaitan-touched companions only.',
  },
  'wildfire-scorcher': {
    abilityBoosts: { dex: 1 },
    acRank: 'expert',
    note: 'Gains resistance to fire equal to your level; creatures that Grapple/Grab it or hit it with an adjacent melee attack take 2d6 fire damage. Reflex saves become legendary. Efreeti-touched companions only.',
  },
  'wind-chaser': {
    abilityBoosts: { dex: 1 },
    skills: [{ skill: 'acrobatics', rank: 'master' }],
    acRank: 'expert',
    speedBonus: 20,
    note: '+20-foot status bonus to its Speed or fly Speed (your choice). Reflex saves become legendary. Djinni-touched companions only.',
  },
};

function buildSpecializations() {
  const uniq = dedupe(readCat('animal-companion-specialization'), 'companionSpecializations');
  const prevMap = core.companionSpecializations ?? {};
  const prevId = idIndex(prevMap);
  const out = { ...prevMap };
  let added = 0;
  let overlaid = 0;
  const kept = [];
  for (const [key, rec] of uniq) {
    const id = prevId.get(key) ?? key;
    const prev = prevMap[id];
    const md = String(rec.markdown ?? '').replace(/\r/g, '');
    const body = plain(unlink(md).split('\n').filter((l) => !/^\*\*(Source|Access)\*\*/.test(l) && !/^<title/.test(l)).join('\n'))
      .replace(/^[\s\S]*?\n\n/, (m) => (/Animal Companion Specialization/.test(m) ? '' : m))
      .replace(new RegExp(`^${rec.name}\\s*`), '')
      .trim();
    const mech = SPEC_MECHANICS[key];
    // Curated mechanics already in the app win (they were verified); AoN supplies the prose + source.
    const entry = {
      id,
      name: rec.name,
      description: body || prev?.description || '',
      ...(prev?.skills ?? mech?.skills ? { skills: prev?.skills ?? mech.skills } : {}),
      ...(prev?.abilityBoosts ?? mech?.abilityBoosts ? { abilityBoosts: prev?.abilityBoosts ?? mech.abilityBoosts } : {}),
      ...(prev?.acRank ?? mech?.acRank ? { acRank: prev?.acRank ?? mech.acRank } : {}),
      ...(prev?.speedBonus ?? mech?.speedBonus ? { speedBonus: prev?.speedBonus ?? mech.speedBonus } : {}),
      ...(prev?.note ?? mech?.note ? { note: prev?.note ?? mech.note } : {}),
      source: { book: mapBook(rec.primary_source) },
      edition: editionOf(rec),
    };
    if (prev) { overlaid++; kept.push(`${rec.name}: curated mechanics`); } else if (!mech) {
      throw new Error(`no transcribed mechanics for new specialization "${rec.name}" (${key})`);
    } else added++;
    out[id] = entry;
  }
  stats.companionSpecializations = { ...stats.companionSpecializations, before: Object.keys(prevMap).length, after: Object.keys(out).length, overlaid, added, kept };
  return out;
}

/* ------------------------------------------------------------------ advanced options */

function buildAdvanced() {
  const uniq = dedupe(readCat('animal-companion-advanced'), 'companionAdvanced');
  const prevMap = core.companionAdvanced ?? {};
  const out = {};
  // Nimble/Savage are already modelled as maturities in src/rules/companions.ts; the rest are data
  // only (see the import report) — `maturity` ties a record to the engine rung when one exists.
  const MATURITY = { nimble: 'nimble', savage: 'savage' };
  for (const [key, rec] of uniq) {
    const md = String(rec.markdown ?? '').replace(/\r/g, '');
    const body = plain(unlink(md).split('\n').filter((l) => !/^\*\*(Source|Access)\*\*/.test(l) && !/^<title/.test(l)).join('\n'))
      .replace(new RegExp(`^${rec.name}\\s*`), '')
      .trim();
    out[key] = {
      id: key,
      name: rec.name,
      description: body,
      ...(MATURITY[key] ? { maturity: MATURITY[key] } : {}),
      ...(rec.rarity && rec.rarity !== 'common' ? { rarity: rec.rarity } : {}),
      source: { book: mapBook(rec.primary_source) },
      edition: editionOf(rec),
    };
  }
  stats.companionAdvanced = { ...stats.companionAdvanced, before: Object.keys(prevMap).length, after: Object.keys(out).length, added: Object.keys(out).length };
  return out;
}

/* ------------------------------------------------------------------ familiar abilities */

const familiarAbilityRecs = readCat('familiar-ability');
const familiarAbilityById = {};
for (const r of familiarAbilityRecs) familiarAbilityById[r.id] = r;

/** The raw markdown of an ability's description — everything after the `<column>` header block
 *  (which holds only the title, source line and ability type). */
function abilityBodyMd(rec) {
  const md = String(rec.markdown ?? '').replace(/\r/g, '');
  const i = md.lastIndexOf('</column>');
  return i >= 0
    ? md.slice(i + '</column>'.length)
    : md.replace(/<title[\s\S]*?<\/title>/, '').replace(/\*\*Source\*\*[^\n]*/, '').replace(/\*\*Ability Type\*\*[^\n]*/, '');
}
const abilityBody = (rec) => plain(abilityBodyMd(rec));

const COST_OF = {
  'Single Action': { type: 'actions', value: 1 },
  'Two Actions': { type: 'actions', value: 2 },
  'Three Actions': { type: 'actions', value: 3 },
  Reaction: { type: 'reaction' },
  'Free Action': { type: 'free' },
};
function abilityCost(rec) {
  const m = String(rec.markdown ?? '').match(/<actions string="([^"]*)"/);
  return m && COST_OF[m[1]] ? COST_OF[m[1]] : undefined;
}

function buildFamiliarAbilities() {
  const generic = familiarAbilityRecs.filter((r) => r.ability_type === 'Familiar' || r.ability_type === 'Master');
  const uniq = dedupe(generic, 'familiarAbilities');
  const prevMap = core.familiarAbilities ?? {};
  const prevId = idIndex(prevMap);
  const out = { ...prevMap };
  let added = 0;
  let overlaid = 0;
  for (const [key, rec] of uniq) {
    const id = prevId.get(key) ?? key;
    const prev = prevMap[id];
    const body = abilityBody(rec);
    const refs = descRefsOf(abilityBodyMd(rec), body);
    out[id] = {
      id,
      name: rec.name,
      kind: rec.ability_type === 'Master' ? 'master' : 'familiar',
      description: body || prev?.description || '',
      ...(refs.length ? { descRefs: refs } : prev?.descRefs ? { descRefs: prev.descRefs } : {}),
      source: { book: mapBook(rec.primary_source) },
      edition: editionOf(rec),
    };
    if (prev) overlaid++; else added++;
  }
  // AoN files a familiar's own signature abilities (Ink Spray, Vina Song, …) under
  // "Specific Familiar - X" rather than as generic picks. They are NOT added to the generic picker,
  // but the ones the app already ships (inherited from Foundry, which didn't separate them) are
  // refreshed in place so they too carry AoN text + a source book.
  const specific = new Map();
  for (const r of familiarAbilityRecs) {
    if (r.remaster_id || !/^Specific Familiar/.test(r.ability_type ?? '')) continue;
    const k = slug(r.name);
    const prevRec = specific.get(k);
    if (!prevRec || (EDITION_RANK[editionOf(r)] ?? 9) < (EDITION_RANK[editionOf(prevRec)] ?? 9)) specific.set(k, r);
  }
  let specificOverlaid = 0;
  for (const [id, e] of Object.entries(out)) {
    const rec = specific.get(slug(e.name));
    if (!rec || e.source?.book) continue; // only entries the generic pass didn't already refresh
    const body = abilityBody(rec);
    const refs = descRefsOf(abilityBodyMd(rec), body);
    out[id] = {
      ...e,
      description: body || e.description || '',
      ...(refs.length ? { descRefs: refs } : {}),
      source: { book: mapBook(rec.primary_source) },
      edition: editionOf(rec),
    };
    specificOverlaid++;
  }

  const noAoN = Object.keys(prevMap).filter((id) => out[id] === prevMap[id]);
  stats.familiarAbilities = { ...stats.familiarAbilities, before: Object.keys(prevMap).length, after: Object.keys(out).length, overlaid, added, specificOverlaid, keptFoundryOnly: noAoN.length, keptIds: noAoN };
  return out;
}

/* ------------------------------------------------------------------ specific familiars */

function buildSpecificFamiliars(prevMap) {
  const uniq = dedupe(readCat('familiar-specific'), 'specificFamiliars');
  const prevId = idIndex(prevMap);
  const out = {};
  let added = 0;
  let overlaid = 0;
  const kept = [];
  for (const [key, rec] of uniq) {
    const id = prevId.get(key) ?? key;
    const prev = prevMap[id];
    const md = String(rec.markdown ?? '').replace(/\r/g, '');
    // "**Granted Abilities** a, b, c" — the always-on abilities that count against requiredCount.
    const granted = splitList(field(md, 'Granted Abilities') ?? '').map((s) => s.replace(/\s+/g, ' ').trim());
    const specialIds = [...md.matchAll(/<document level="2" id="(familiar-ability-\d+)"/g)].map((m) => m[1]);
    const specials = specialIds
      .map((sid) => familiarAbilityById[sid])
      .filter(Boolean)
      .map((a) => ({ name: a.name, ...(abilityCost(a) ? { cost: abilityCost(a) } : {}), desc: abilityBody(a) }));
    const traits = (rec.trait ?? []).map((t) => String(t).toLowerCase()).filter((t) => !RARITY.has(t));
    const access = field(md, 'Access');
    const alignment = field(md, 'Alignment');
    const note = prev?.note ?? ([access ? `Access: ${access}` : '', alignment].filter(Boolean).join(' ') || undefined);
    const i = md.lastIndexOf('</column>');
    const flavor = plain((i >= 0 ? md.slice(i + '</column>'.length) : '').replace(/<document[\s\S]*$/, ''));

    out[id] = {
      id,
      name: rec.name,
      requiredCount: typeof rec.required_abilities === 'number' ? rec.required_abilities : prev?.requiredCount ?? granted.length,
      requiredAbilities: granted.length ? granted : prev?.requiredAbilities ?? [],
      specials: specials.length ? specials : prev?.specials ?? [],
      traits,
      ...(note ? { note } : {}),
      ...(flavor ? { description: flavor } : {}),
      ...(rec.rarity && rec.rarity !== 'common' ? { rarity: rec.rarity } : {}),
      source: { book: mapBook(rec.primary_source) },
      edition: editionOf(rec),
    };
    if (prev) { overlaid++; if (prev.note) kept.push(`${rec.name}: note`); } else added++;
    if (!granted.length) kept.push(`${rec.name}: requiredAbilities (no AoN Granted Abilities line)`);
    if (!specials.length) kept.push(`${rec.name}: specials (no AoN ability documents)`);
  }
  stats.specificFamiliars = { ...stats.specificFamiliars, before: Object.keys(prevMap).length, after: Object.keys(out).length, overlaid, added, kept };
  return out;
}

/* ------------------------------------------------------------------ run */

// The nine specific familiars that used to be hardcoded in src/rules/specificFamiliars.ts — their ids
// (and the curated `note` on three of them) are preserved so saved characters keep their familiar.
const LEGACY_SPECIFIC_FAMILIARS = {
  'aeon-wyrd': { id: 'aeon-wyrd', name: 'Aeon Wyrd' },
  'calligraphy-wyrm': { id: 'calligraphy-wyrm', name: 'Calligraphy Wyrm' },
  'fey-dragonet': { id: 'fey-dragonet', name: 'Fey Dragonet', note: 'The Remaster successor to the older Faerie Dragon.' },
  'grindle-drake': { id: 'grindle-drake', name: 'Grindle-Drake', note: 'Access: characters from the Five Kings Mountains.' },
  homunculus: { id: 'homunculus', name: 'Homunculus' },
  imp: { id: 'imp', name: 'Imp' },
  pipefox: { id: 'pipefox', name: 'Pipefox' },
  poppet: { id: 'poppet', name: 'Poppet' },
  spellslime: { id: 'spellslime', name: 'Spellslime', note: 'Prerequisite: you must be able to cast spells using spell slots.' },
};

core.animalCompanions = buildAnimalCompanions();
core.companionSpecializations = buildSpecializations();
core.companionAdvanced = buildAdvanced();
core.familiarAbilities = buildFamiliarAbilities();
core.specificFamiliars = buildSpecificFamiliars(core.specificFamiliars ?? LEGACY_SPECIFIC_FAMILIARS);

/* ---- report ---- */
const pad = (s, n) => String(s).padEnd(n);
console.log('\ncollection                 before  after   overlaid  added  superseded  name-dupes');
for (const [k, s] of Object.entries(stats)) {
  console.log(
    `${pad(k, 26)} ${pad(s.before ?? 0, 7)} ${pad(s.after ?? 0, 7)} ${pad(s.overlaid ?? '-', 9)} ${pad(s.added ?? 0, 6)} ${pad(s.superseded ?? 0, 11)} ${s.collapsed ?? 0}`,
  );
}
for (const [k, s] of Object.entries(stats)) {
  if (s.kept?.length) console.log(`\n${k} — old values kept (AoN had no machine-readable field):\n  ${s.kept.join('\n  ')}`);
  if (s.keptFoundryOnly) console.log(`\n${k} — ${s.keptFoundryOnly} entries kept untouched (no AoN record):\n  ${s.keptIds.join(', ')}`);
}
const noBook = [];
for (const b of ['animalCompanions', 'companionSpecializations', 'companionAdvanced', 'familiarAbilities', 'specificFamiliars']) {
  for (const [id, e] of Object.entries(core[b])) if (!e.source?.book) noBook.push(`${b}/${id}`);
}
console.log(`\nrecords still without source.book: ${noBook.length}${noBook.length ? `\n  ${noBook.join(', ')}` : ''}`);

if (DRY) {
  console.log('\n--dry-run: core.json NOT written');
} else {
  writeFileSync(OUT, JSON.stringify(core));
  console.log(`\nwrote ${OUT}`);
}
