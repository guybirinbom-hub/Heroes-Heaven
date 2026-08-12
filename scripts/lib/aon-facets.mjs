/*
 * Facets read from an Archives-of-Nethys record, for import-core-v2.mjs's overlayContent().
 *
 * WHY THIS EXISTS. Until now `overlayContent()` returned only `{ name }`, so an overlaid record kept
 * its level / rarity / traits / price / bulk verbatim from the Foundry data — 76.9% of every value in
 * core.json was byte-identical to core.foundry-backup.json. The user's rule is that no value may
 * originate in Foundry. These functions supply the Archives' answer instead.
 *
 * THE ONE JUDGEMENT CALL, made by the user: take the Archives' traits, then apply the official
 * remaster renames. So a legacy spell gets its school trait back (the Archives print it, Foundry
 * stripped it) but says `vitality` rather than `positive`.
 *
 * WHERE THE ARCHIVES SAY NOTHING, NOTHING IS RETURNED — the caller's existing value survives. That is
 * deliberate: silently deleting a level because AoN never printed one would be worse than the leftover
 * it replaces. Those leftovers are counted and reported, never hidden.
 */

import { readFileSync } from 'node:fs';

/*
 * Archives usage PROSE -> Heroes Heaven's usage slug, learned once by
 * scripts/migration/gen-usage-slugs.mjs and frozen as an HH-owned file.
 *
 * A mechanical slugify only reaches 79.8%: HH writes "worn cloak" as `worncloak` with no separator,
 * drops the article in "affixed to a weapon", and calls "tattoo" `tattooed-on-the-body`. The Archives
 * supply the FACT; the vocabulary the engine reads is HH's own.
 */
const USAGE_SLUGS = (() => {
  try { return JSON.parse(readFileSync('scripts/data/usage-slugs.json', 'utf8')); } catch { return {}; }
})();
const USAGE_NUM = { 1: 'one', 2: 'two', 3: 'three', 4: 'four' };

/** HH's usage slug for an archive record, or null when the Archives say nothing. */
export function usageOf(rec) {
  const raw = rec?.data?.usage;
  if (!raw) return null;
  const key = String(raw).trim().toLowerCase();
  if (USAGE_SLUGS[key]) return USAGE_SLUGS[key];
  // Not in the table — fall back to the mechanical form, which covers four fifths of the corpus.
  return key
    .replace(/\b([1-4])\b/g, (_, d) => USAGE_NUM[d])
    .normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null;
}

const RARITY = new Set(['common', 'uncommon', 'rare', 'unique']);
// The Archives list rarity and the edition marker among the traits; Heroes Heaven keeps rarity in its
// own field. Without this, almost every record would look like a trait disagreement.
const NOT_A_TRAIT = new Set([...RARITY, 'legacy', 'remaster', 'remastered']);

/*
 * Legacy trait -> remaster trait, per the official Pathfinder remaster.
 * `lawful` and `chaotic` map to null: the remaster removed them outright with no successor, so the
 * remaster wording for an old `lawful` spell is simply to have no alignment trait at all.
 * The eight SCHOOL traits are deliberately NOT here — the user chose to keep them.
 */
export const REMASTER_TRAIT = {
  positive: 'vitality',
  negative: 'void',
  good: 'holy',
  evil: 'unholy',
  lawful: null,
  chaotic: null,
  metamagic: 'spellshape',
  /*
   * The remaster folded the half-ancestries into their parents. The Archives print BOTH names —
   * feat-960 "Round Ears" carries `["Aiuvarin","Half-Elf"]` — so without these two the legacy name
   * comes back and half-elf/half-orc grow feat lists again. scripts/backfill-heritage-feat-access.mjs:13
   * already states the project's policy: "writing `half-elf` would widen" the ancestry feat list.
   */
  'half-elf': 'aiuvarin',
  'half-orc': 'dromaar',
};

/*
 * READ `trait_raw`, NOT `traits`.
 *
 * The `traits` array holds only the bare word, so a rapier comes out `Deadly` and the die is gone.
 * `trait_raw` keeps the parameter — `"Deadly d8"`, `"Thrown 20 ft."`, `"Two-Hand 1d12"`,
 * `"Entrench Melee"` — which is exactly what Heroes Heaven encodes as `deadly-d8`, `thrown-20`,
 * `two-hand-d12`, `entrench-melee`. It is present on 100% of docs that have traits.
 *
 * Reading `traits` cost seven test failures: rapier lost its crit die, bastard sword its two-handed
 * die, light hammer its thrown range, Bastion Plate its entrench parameter.
 */
export function traitSlug(raw) {
  let s = String(raw).toLowerCase().trim();
  if (!s) return '';
  s = s.replace(/\s*ft\.?$/, '');        // "thrown 20 ft." -> "thrown 20"
  s = s.replace(/\b1d(\d+)\b/g, 'd$1');  // "fatal 1d10" -> "fatal d10"  (HH writes fatal-d10)
  return s.normalize('NFKD').replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The Archives' traits as HH slugs: parameters kept, rarity/edition dropped, remaster renames applied. */
export function remasterTraits(traits) {
  if (!Array.isArray(traits)) return null;
  const out = [];
  for (const raw of traits) {
    const t = traitSlug(raw);
    if (!t || NOT_A_TRAIT.has(t)) continue;
    const mapped = Object.prototype.hasOwnProperty.call(REMASTER_TRAIT, t) ? REMASTER_TRAIT[t] : t;
    if (mapped) out.push(mapped);
  }
  return [...new Set(out)].sort();
}

/** `trait_raw` if the doc has it (it almost always does), else the bare `traits`. */
export const rawTraitsOf = (rec) => rec?.trait_raw ?? rec?.data?.trait_raw ?? rec?.traits ?? null;

/** Copper integer -> Heroes Heaven's {pp,gp,sp,cp}, mirroring the importer's own cpToCoins. */
export function coinsFromCp(cp) {
  if (typeof cp !== 'number' || !Number.isFinite(cp) || cp < 0) return null;
  const c = {};
  const gp = Math.floor(cp / 100);
  const sp = Math.floor((cp % 100) / 10);
  const rem = cp % 10;
  if (gp) c.gp = gp;
  if (sp) c.sp = sp;
  if (rem) c.cp = rem;
  return Object.keys(c).length ? c : { cp: 0 };
}

/*
 * Bulk needs `bulk_raw`, not `bulk_num`. `bulk_num` is 0 both for "Bulk —" (negligible) and for the
 * 115 items where the Archives simply print no Bulk row at all — Backpack (equipment-4) has
 * bulk_num 0.0, bulk_raw null, and an empty row where the value should be. Reading bulk_num alone
 * would quietly zero out real values.
 */
export function bulkOf(rec) {
  const raw = rec?.data?.bulk_raw ?? rec?.bulk_raw;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (!s) return null;
    if (s === 'l') return 0.1;             // light
    if (s === '—' || s === '-' || s === '–') return 0;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;  // "varies (see text)" and friends
  }
  if (raw === null) return null;           // the Archives print no Bulk for this item
  return typeof rec?.bulk_num === 'number' ? rec.bulk_num : null;
}

/**
 * Every facet the Archives can state for this record. Keys are omitted entirely when the Archives say
 * nothing, so a spread over the existing record leaves that field untouched.
 *
 * `notes` reports adoptions worth a human glance rather than hiding them — chiefly a level dropping to
 * 0, which is a genuine "Item 0" on some Archive pages and a data hole on others.
 */
const TRADITIONS = new Set(['arcane', 'divine', 'occult', 'primal']);
const ACT = { 'single action': 1, 'one action': 1, 'two actions': 2, 'three actions': 3 };

const ABIL = '(?:strength|dexterity|constitution|intelligence|wisdom|charisma)';

/*
 * ---------------------------------------------------------------- combat statistics
 *
 * The highest-consequence fields in the app: they drive strike math and AC. Three traps dominate, all
 * measured, and getting any of them wrong corrupts numbers silently rather than failing:
 *
 *  1. `data.damage_type` is ALPHABETICAL and mixes the versatile options in with the real type.
 *     `kusarigama` is "1d8 S" with damage_type ["Bludgeoning","Slashing"] — reading [0] makes it
 *     bludgeoning. The type is the abbreviation inside `data.damage`, never that array.
 *  2. A melee weapon's THROWN range lives only in `trait_raw`. Spear has `data.range` null and
 *     "Thrown 20 ft."; 0 of 49 melee+thrown docs carry data.range. And a `range` written WITHOUT the
 *     matching thrown trait breaks strike math outright — `derive.ts:2616` treats any range as
 *     ranged, and `derive.ts:1962` then refuses finesse/agile.
 *  3. `equipment.json` carries NO combat statistics at all (0% across 700 weapon / 173 armor / 149
 *     shield joins). A magic weapon's numbers are on its BASE item, reachable only through
 *     `data.base_item_markdown`, which has the URL. `data.base_item` is names only — unusable.
 */
const DMG_ABBR = {
  b: 'bludgeoning', p: 'piercing', s: 'slashing', a: 'acid', c: 'cold', e: 'electricity',
  f: 'fire', so: 'sonic', po: 'poison', me: 'mental', fo: 'force', n: 'void',
  pos: 'vitality', sp: 'spirit', bl: 'bleed',
};

/** `"1d8 S"` -> `{ dice: 1, die: 'd8', type: 'slashing' }`. Null when the Archives cannot say. */
export function parseDamage(s) {
  const t = String(s ?? '').trim();
  if (!t || /^varies$/i.test(t)) return null;                 // Alchemical Bomb
  const m = /^(\d+)(?:d(\d+))?\s*(.*)$/.exec(t);
  if (!m) return null;
  const tok = String(m[3] ?? '').split(' + ')[0].trim();      // "1d4 B + 1d4 F" -> the primary only
  if (/^modular$/i.test(tok)) return null;                    // a player choice — never overwrite
  const type = DMG_ABBR[tok.toLowerCase()] ?? (tok ? tok.toLowerCase() : null);
  if (!type) return null;
  return { dice: Number(m[1]), die: m[2] ? `d${m[2]}` : '', type };
}

/** Feet of range: the explicit field, else the `Thrown N ft.` trait, which is the only place it lives. */
export function rangeOf(rec) {
  if (typeof rec?.data?.range === 'number') return rec.data.range;
  for (const raw of rawTraitsOf(rec) ?? []) {
    const m = /^thrown\s+(\d+)/i.exec(String(raw).trim());
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Heroes Heaven's `prerequisites` — one clause per array element, no markup — from `data.prerequisite`.
 *
 * This is NOT display text: `checkPrerequisites()` (src/rules/build.ts:5445) parses each clause with
 * three anchored patterns, so the exact wording gates feat selection. Every rule below exists because
 * skipping it silently switches a gate OFF rather than failing loudly.
 *
 * Returns null when the Archives say nothing, so the caller keeps what it has.
 */
export function prerequisitesFrom(rec) {
  const raw = rec?.data?.prerequisite;
  if (!raw) return null;

  return String(raw)
    .replace(/\r/g, '')
    .split(/[;\n]/)                       // ';' is the only separator — verified never inside parens
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s
        // "[Druid] animal order" — AoN prefixes a class tag when the prerequisite differs per class.
        .replace(/^\[[^\]]*\]\s*/, '')
        // "ability to cast _fly_" -> "ability to cast fly"
        .replace(/_([^_]+)_/g, '$1')
        .replace(/’/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s*\.\s*$/, '')
        /*
         * AoN repeats the rank word across an OR/comma list — "Trained in Deception or Trained in
         * Diplomacy" — but the engine's OR-split only understands "trained in A or B". Leaving the
         * repeat in place kills the gate on 57 clauses.
         *
         * ONLY when the clause itself STARTS with that rank word. Without the guard it also fires on
         * "powerful fist or expert in unarmed attacks" (Student of Perfection Dedication), collapsing
         * it to "powerful fist or unarmed attacks" and deleting a real proficiency requirement — the
         * repeat is only redundant when the clause already established the rank.
         */
        .replace(/^((trained|expert|master|legendary)\s+in\s+.*)$/i, (clause, _all, word) =>
          clause
            .replace(new RegExp(`\\b(or|and)\\s+${word}\\s+in\\s+`, 'gi'), '$1 ')
            .replace(new RegExp(`,\\s*${word}\\s+in\\s+`, 'gi'), ', '),
        )
        /*
         * AoN writes raw ability SCORES, Heroes Heaven writes modifiers, and the engine compares
         * against abilityMod(). GLOBAL, not anchored: `spellmaster-dedication` is
         * "Intelligence 14, Wisdom 14, or Charisma 14" and an anchored rule converts only the first.
         */
        .replace(new RegExp(`\\b(${ABIL})\\s+(\\d{1,2})\\b`, 'gi'), (_, a, n) => `${a} +${Math.floor((Number(n) - 10) / 2)}`)
        /*
         * Lowercase a leading rank word ONLY when a real rank clause follows. The `in|with|at` guard is
         * mandatory: "Expert Longevity" and "Master Summoner" are FEAT NAMES (26 clauses). Lowercasing
         * those makes the rank pattern swallow them and the has-feat gate silently vanishes.
         */
        .replace(/^(Trained|Expert|Master|Legendary)(\s+(?:in|with|at)\b)/, (_, w, rest) => w.toLowerCase() + rest)
        .trim(),
    );
}

/**
 * Parse an Archives action string into Heroes Heaven's ActionCost.
 *
 * '' means EXPLICIT PASSIVE — see actionCostOf. `undefined` means unknown, so the caller keeps what it
 * already had. Never confuse the two: "the field is absent" is not "the ability is passive".
 */
export function parseAonActions(s) {
  if (s === undefined || s === null) return undefined;
  const l = String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  if (l === '') return { type: 'passive' };
  if (ACT[l]) return { type: 'actions', value: ACT[l] };
  if (l === 'reaction') return { type: 'reaction' };
  if (l === 'free action') return { type: 'free' };

  const m = /^(.+?)\s+(?:to|or)\s+(.+)$/.exec(l);
  if (m) {
    const a = m[1];
    const b = m[2] === 'more actions' ? 'three actions' : m[2];
    if (ACT[a] && ACT[b]) {
      const lo = Math.min(ACT[a], ACT[b]);
      const hi = Math.max(ACT[a], ACT[b]);
      return lo === hi ? { type: 'actions', value: lo } : { type: 'variable', min: lo, max: hi };
    }
    // "Reaction or Two Actions" / "Free Action or One Action" — the cheaper form is the real cost.
    if (a === 'reaction' && ACT[b]) return { type: 'reaction' };
    if (a === 'free action' && ACT[b]) return { type: 'free' };
  }
  return { type: 'duration', text: l };   // "1 minute", "2 actions to 2 rounds", "1 day"
}

/**
 * The action glyph AoN prints in a page's <title>: `<actions string="Single Action" />`.
 *
 * THE WHOLE POINT: an EMPTY `string=""` is how the Archives say "this is passive". That is not the same
 * as `data.actions` being absent, and nothing in this project had used it before. On feat.json the
 * correspondence is total — 8,460/8,460 docs carry the tag, 5,498 empty and 2,962 non-empty, and those
 * 2,962 are exactly the docs that have a `data.actions` facet.
 *
 * Returns undefined when the page type has no cost line at all, so the caller can leave HH's value be.
 */
export function titleGlyph(rec) {
  const md = rec?.data?.markdown ?? rec?.markdown;
  if (!md) return undefined;
  const t = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(md);
  if (!t) return undefined;
  const g = /<actions\s+string="([^"]*)"\s*\/?>/.exec(t[1]);
  return g ? g[1] : undefined;
}

/** Everything after the page's `<title>` block — the description and its stat lines. */
function bodyOf(rec) {
  const md = String(rec?.data?.markdown ?? rec?.markdown ?? '');
  const t = /<title\b[^>]*>[\s\S]*?<\/title>/.exec(md);
  return t ? md.slice(t.index + t[0].length) : md;
}

/*
 * A feat can be passive ITSELF while granting an activity that costs actions — and Heroes Heaven needs
 * that cost, or the ability cannot be filtered as a reaction/action. The Archives state it in the body,
 * two different ways:
 *
 *   an inline glyph   `**Activate** <actions string="Two Actions" />` on Ka Stone Ritual, whose granted
 *                     activity has no page of its own. Glass Skin carries a bare `"Reaction"` tag with
 *                     no `**Activate**` label at all, so the label cannot be part of the match.
 *   a document embed  `<document level="2" id="action-320" />` on Brightness Seeker, where the granted
 *                     reaction (Call Upon the Brightness) DOES have its own page — read the cost off it.
 *
 * Empty tags are skipped: `string=""` in the body is the same "no glyph" marker as in the title.
 */
function grantedCost(rec) {
  /*
   * An INLINE glyph in the body is the cost of an activity this page grants that has no page of its
   * own, so the feat is the only place to keep it. Confirmed against four cases the user checked by
   * hand in their Archives app:
   *   Glass Skin   inline "Reaction"     -> grants the Shatter Glass reaction, described inline
   *   Moldersoul   inline "Two Actions"  -> grants the Decompose action, described inline
   *   Ka Stone Ritual  `**Activate** <actions string="Two Actions" />`
   *   Powder Punch Stance  no inline tag -> genuinely takes no action (the user confirmed this, which
   *                                        is why the earlier "125 of 126 stance feats" guess is gone)
   *
   * It is safe to read ANY inline tag, not just a labelled `**Activate**` one: the 170-feat blowup
   * came from the DOCUMENT-EMBED path, not this one. Summoner Dedication has no inline tag at all —
   * its bogus 3 actions came from following the Manifest Eidolon embed, which is handled separately
   * and now yields `passive` plus a link.
   */
  const m = /<actions\s+string="([^"]+)"/.exec(bodyOf(rec));
  return m ? { cost: parseAonActions(m[1]), via: 'inline glyph' } : null;
}

/*
 * Some pages state the cost only in PROSE — "You can spend an action, which has the concentrate trait,
 * to focus on a creature inside of a solid object" (Reach Beyond). The Archives do carry it; it simply
 * is not tagged. Deliberately narrow: an explicit "spend/take/use N action(s)" or "as a reaction", and
 * nothing looser, because prose matching is where silent errors get in.
 */
const PROSE_COST = [
  [/\byou can spend (?:an|one|1) action\b/i, { type: 'actions', value: 1 }],
  [/\byou can spend (?:two|2) actions\b/i, { type: 'actions', value: 2 }],
  [/\byou can spend (?:three|3) actions\b/i, { type: 'actions', value: 3 }],
  [/\byou can spend a reaction\b/i, { type: 'reaction' }],
];
function proseCost(rec) {
  const body = bodyOf(rec);
  for (const [re, cost] of PROSE_COST) if (re.test(body)) return cost;
  return null;
}

/**
 * The actions this page GRANTS, as archive doc ids, from `<document level="2" id="action-N" />`.
 *
 * These already exist as their own Heroes Heaven action records with the right cost —
 * `call-upon-the-brightness` is a reaction, `manifest-eidolon` is three actions. What is missing is the
 * LINK, so nothing can tell that Brightness Seeker is what grants that reaction. Recording it is purely
 * additive: it never changes a cost, it just makes the relationship explicit for filtering.
 */
export function grantedActionIds(rec) {
  return [...new Set([...bodyOf(rec).matchAll(/<document\s+level="2"\s+id="(action-\d+)"\s*\/?>/g)].map((m) => m[1]))];
}

/**
 * An ITEM's activation cost, from the labelled `**Activate**` line in its body.
 *
 * The label is required here, unlike the feat case: an item's body can carry other glyphs (a granted
 * activity, an embedded action) and only the Activate line is the item's own activation. Reproduces
 * 93.5% of the existing values and fills 238 the app did not have.
 */
export function activationOf(rec) {
  const m = /\*\*Activate\*\*\s*<actions\s+string="([^"]+)"/.exec(bodyOf(rec));
  return m ? parseAonActions(m[1]) : null;
}

/**
 * The archetype this record belongs to, as HH's slug, from `data.archetype`.
 *
 * A feat can belong to SEVERAL archetypes — the level-20 mask feats are `["Druid","Wizard"]` — while
 * Heroes Heaven's field holds one. Taking `[0]` there is arbitrary churn, so an existing value that is
 * among the Archives' list is kept. A single-valued list is authoritative and does correct HH:
 * `Reminder of the Greater Fear` was `gray-gardener` and the Archives say Vigilante, which its own
 * traits confirm.
 */
export function archetypeOf(rec, slugify, prev) {
  const a = rec?.data?.archetype;
  if (!Array.isArray(a) || !a.length) return null;
  const slugs = a.map((x) => slugify(x));
  if (prev && slugs.includes(prev)) return prev;
  return slugs[0];
}

/*
 * An item's use limit, from the printed `**Frequency**` stat line.
 *
 * HH's item shape is `{ max, per }` with `per` drawn from a CLOSED set (types.ts:1971 + :1183), and the
 * item type has no `every` field — so "once per 10 minutes" has to collapse to `minute`, which is what
 * the app already ships for those 35 records. Anything whose unit falls outside the set is not emitted
 * rather than guessed at.
 */
const FREQ_WORD = { once: 1, twice: 2, 'three times': 3, 'four times': 4, 'five times': 5, 'six times': 6, 'ten times': 10 };
const FREQ_PER = new Set(['round', 'turn', 'minute', 'hour', 'day', 'week', 'month']);

export function frequencyOf(rec) {
  const line = /\*\*Frequency\*\*\s*([^\n*]+)/.exec(bodyOf(rec));
  if (!line) return null;

  const t = String(line[1]).trim().toLowerCase()
    .replace(/[.;].*$/, '')          // the stat line runs on into the next label
    .replace(/,?\s*plus\s+overcharge$/, '')
    .trim();

  const m = /^(once|twice|three times|four times|five times|six times|ten times|(\d+) times)\s+(?:per|every|a)\s+(.+)$/.exec(t);
  if (!m) return null;

  const max = m[2] ? Number(m[2]) : FREQ_WORD[m[1]];
  if (!max) return null;

  /*
   * Reduce the period to its unit. AoN writes "10 minutes", and qualifies the unit where the limit is
   * per-something-else — "day for each spell", "day per bead" — none of which HH's closed set can hold.
   */
  const unit = String(m[3]).trim().replace(/^\d+\s+/, '').split(/\s+(?:for|per)\s+/)[0].trim().replace(/s$/, '');
  return FREQ_PER.has(unit) ? { max, per: unit } : null;
}

/*
 * The spells a staff / wand / prayer beads holds, as HH's `{ rank: [slug, …] }`.
 *
 * The Archives put them in the page body as
 *   <ul><li>**Cantrip** [_ignition_](/Spells.aspx?ID=1565)</li><li>**1st** [_breathe fire_](…)</li></ul>
 *
 * Two things make this more than a regex:
 *
 *  1. ONE PAGE HOLDS EVERY VARIANT and they all share the same markdown — equipment-3041,
 *     -3041-2916 and -3041-2917 are Staff of Fire, Greater and Major, byte-identical `data.markdown`.
 *     The variant is identified by which `<title level="2">` section it sits under.
 *  2. STAVES ARE CUMULATIVE. Greater holds its own spells PLUS every lower one, which is why HH's
 *     `staff-of-fire-major` lists ranks 0 through 5. So a variant takes the union of its own list and
 *     all the lists above it.
 *
 * Unlinked names ("floating flame" in the 3rd-rank row) are repeats of a spell linked earlier on the
 * same page, so they resolve against a page-local name index rather than being dropped.
 */
const norm = (x) => String(x).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, " ").trim();

const RANK_WORD = { cantrip: 0, cantrips: 0 };
function rankOf(label) {
  const l = String(label).trim().toLowerCase();
  if (l in RANK_WORD) return RANK_WORD[l];
  const m = /^(\d+)(?:st|nd|rd|th)?$/.exec(l);
  return m ? Number(m[1]) : null;
}

export function heldSpellsOf(rec, resolveSpellUrl) {
  const md = String(rec?.data?.markdown ?? '');
  if (!md.includes('<ul>') || typeof resolveSpellUrl !== 'function') return null;

  // Split the page into its variant sections, in printed order. Section 0 is the base item.
  const marks = [...md.matchAll(/<title\s+level="2"[^>]*>([\s\S]*?)<\/title>/g)];
  const bounds = [0, ...marks.map((m) => m.index), md.length];
  const sections = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    sections.push({ title: i === 0 ? String(rec.name ?? '') : String(marks[i - 1][1]).replace(/\s+/g, ' ').trim(), text: md.slice(bounds[i], bounds[i + 1]) });
  }

  const want = norm(String(rec?.name ?? ''));
  let idx = sections.findIndex((s, i) => i > 0 && norm(s.title) === want);
  if (idx < 0) idx = 0;   // the base item, or a page with no variant sections

  // Every spell LINKED anywhere on the page, so an unlinked repeat can still be resolved.
  const byName = new Map();
  for (const m of md.matchAll(/\[_([^\]]+)_\]\(([^)]+)\)/g)) {
    const slug = resolveSpellUrl(m[2]);
    if (slug) byName.set(norm(m[1]), slug);
  }

  const out = {};
  for (let i = 0; i <= idx; i++) {
    for (const li of sections[i].text.matchAll(/<li>\s*\*\*([^*]+)\*\*\s*([\s\S]*?)<\/li>/g)) {
      const rank = rankOf(li[1]);
      if (rank === null) continue;
      for (const part of String(li[2]).split(',')) {
        const linked = /\[_([^\]]+)_\]/.exec(part);
        // An unlinked repeat can carry a qualifier the linked form does not — Wyrm Drinker's 6th-rank
        // row reads `_summon dragon_ (6th)`, and "(6th)" has to come off before the name will match.
        const bare = part.replace(/\([^)]*\)/g, ' ').replace(/[[\]_]/g, ' ');
        const slug = byName.get(norm(linked ? linked[1] : bare));
        if (!slug) continue;
        (out[rank] ??= []).push(slug);
      }
    }
  }
  for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
  return Object.keys(out).length ? out : null;
}

/** Stat lines that only ever appear on an ACTIVITY. Their presence contradicts "passive". */
const ACTIVITY_MARKER = /\*\*(Frequency|Requirements?|Trigger|Activate|Cost)\*\*/;

/**
 * Heroes Heaven's `actionCost` for a feat / class feature / action.
 *
 * The facet is preferred because it carries the time-based casts the glyph cannot ("1 minute"); the
 * glyph is the fallback AND the passive marker. `prev` is the existing HH record: a class feature that
 * GRANTS an action is itself passive, and following the granted action's cost would make it look like
 * an activity. All 26 records with `grantsActions` are passive today and a test asserts it.
 */
export function actionCostOf(rec, prev = {}, resolveDoc = null, report = null) {
  if (Array.isArray(prev.grantsActions) && prev.grantsActions.length) return { type: 'passive' };
  if (rec?.data?.actions != null) return parseAonActions(rec.data.actions);

  const g = titleGlyph(rec);
  if (g === undefined) return undefined;

  /*
   * The page shows no glyph of its own. Before calling it passive, look for an activity it GRANTS —
   * the Archives do record that, and demoting to passive throws the cost away. Verified on the 18
   * feats where this fired: every recovered value matches independently, which is why the fallbacks
   * below are trusted and the remainder is escalated rather than guessed.
   */
  if (g === '') {
    const granted = grantedCost(rec);
    if (granted?.cost) {
      if (report) report({ name: rec.name, via: granted.via, grants: granted.grants, cost: granted.cost });
      return granted.cost;
    }
    /*
     * The page GRANTS an action that has its own page. Then the empty glyph is correct and literal:
     * the feat is passive, and what costs a reaction is the thing it grants — conditionally, in
     * `Brightness Seeker`'s case ("unless the augury was 'nothing', you gain the following reaction
     * for 30 minutes"). Nothing is lost by saying passive, because `grantsActions` carries the
     * relationship and the granted record holds the cost. That is precisely the mechanism this
     * codebase already uses for Rage and Spellstrike — see test/granted-actions.test.ts.
     */
    if (typeof resolveDoc === 'function') {
      for (const id of grantedActionIds(rec)) {
        if (titleGlyph(resolveDoc(id))) {
          if (report) report({ name: rec.name, via: `passive, grants ${id}`, cost: { type: 'passive' } });
          return { type: 'passive' };
        }
      }
    }

    // Stated only in prose — the Archives have it, it is just not tagged. See PROSE_COST.
    const prose = proseCost(rec);
    if (prose) {
      if (report) report({ name: rec.name, via: 'prose', cost: prose });
      return prose;
    }

    /*
     * Nothing anywhere. The empty glyph is then taken at face value: the page is passive. The user
     * confirmed this reading on Powder Punch Stance. Records where Heroes Heaven previously held a
     * real cost are still REPORTED, so a genuine Archives hole is visible rather than silent.
     */
    if (prev.actionCost && prev.actionCost.type !== 'passive') {
      if (report) report({ name: rec.name, via: 'no cost anywhere — now passive', cost: prev.actionCost });
    }
  }


  return parseAonActions(g);
}

/**
 * Spell-only facets that the Archives state exactly: rank, traditions + spellLists, cast.
 *
 * Each is keyed off a field the export already carries in Heroes Heaven's own shape, so these
 * reconstruct rather than approximate. Fields the Archives express only as prose (range, duration,
 * targets, heightening, save) are deliberately NOT here — the spec found real traps in each.
 */
/*
 * A spell's saving throw: `{ type, basic }`.
 *
 * READ `data.saving_throw_markdown`, NEVER `data.saving_throw`. The plain twin flattens the markup and
 * renders "[basic](/Rules.aspx?ID=329) Reflex" as "basic  Reflex" — recoverable, but the LINK is the
 * machine-readable marker and the flattened form loses it on the pages that need it most.
 *
 * `basic` is load-bearing: it changes what a success does to damage. Three pages state it structurally
 * rather than in the row, and each has an answer:
 *   daze (spell-1482)      row says just "Will"; the body says "with a basic Will save" and the page
 *                          carries NO `**Critical Success**` block — AoN's structural way of saying the
 *                          outcomes are the basic ones.
 *   quench (spell-709)     no Defense row at all; the body carries the linked marker.
 *   heat-metal (spell-694) no row; the body names the save AND prints all four degree lines with
 *                          riders, so it is NOT basic.
 *
 * CRLF is normalised first: the export mixes "\n\n" and "\r\n" inside one document, and a body split
 * written against "\n---\n" silently matches nothing.
 */
const SAVE_T = '(fortitude|reflex|will)';
const SAVE_LINK = /\[([^\]]*)\]\(([^)]*)\)/g;

export function saveOf(rec) {
  const md = String(rec?.data?.markdown ?? '').replace(/\r\n?/g, '\n');
  const parts = md.split('\n---\n');
  const head = parts[0].replace(SAVE_LINK, '$1');
  const body = parts.length > 1 ? parts.slice(1).join('\n---\n') : '';
  const bodyPlain = body.replace(SAVE_LINK, '$1');

  const rowRaw = rec?.data?.saving_throw_markdown
    ?? (new RegExp(`\\*\\*Saving Throw\\*\\*[ \\t]*\\n?([^\\n]*)`).exec(head) ?? [])[1]
    ?? (new RegExp(`\\*\\*Defense\\*\\*[ \\t]*\\n?([^\\n]*)`).exec(head) ?? [])[1];

  let type = null;
  let basic = false;

  if (rowRaw) {
    // Keep the link text so "basic" survives; "AC and basic Fortitude" still yields fortitude because
    // only the save word is matched, and "Fortitude or basic Reflex" takes the FIRST save named.
    const row = String(rowRaw).replace(SAVE_LINK, '$1').replace(/\s+/g, ' ').trim();
    const m = new RegExp(`\\b(basic\\s+)?${SAVE_T}\\b`, 'i').exec(row);
    if (m) { type = m[2].toLowerCase(); basic = Boolean(m[1]); }
  }

  if (!type) {
    const m = new RegExp(`\\b(basic\\s+)?${SAVE_T}\\s+(?:saving throws?|saves?)\\b`, 'i').exec(bodyPlain);
    if (m) { type = m[2].toLowerCase(); basic = Boolean(m[1]); }
  }
  if (!type) return null;

  // The body can state "basic" where the row does not (daze, quench).
  if (!basic && new RegExp(`\\bbasic\\s+${SAVE_T}\\s+(?:saving throws?|saves?)\\b`, 'i').test(bodyPlain)) basic = true;

  return { type, basic };
}

/**
 * Deity facets. The Archives carry every one of these as a clean structured array — no prose parsing:
 *   data.domain ["Knowledge","Protection"]  ->  domains ["knowledge","protection"]
 *   data.divine_font ["Heal"]               ->  divineFont ["heal"]
 *   data.favored_weapon ["Starknife"]       ->  favoredWeapons ["starknife"]
 *   data.skill ["Society"]                  ->  skill "society"   (HH stores ONE, AoN an array)
 */
export function deityFacets(rec, prev = {}) {
  const out = {};
  const list = (v) => (Array.isArray(v) ? v.map((x) => traitSlug(x)).filter(Boolean) : null);

  /*
   * `domain_primary`, NOT `domain` — the plain field merges the ALTERNATE domains in with the primary
   * ones, and Abadar's `duty` is an alternate (test/choice-additions.test.ts asserts he has four
   * primaries, not five).
   *
   * …except never SHRINK the list. Lissala is the one deity where the Archives record 3 primaries plus
   * `Glyph` as an alternate, while Heroes Heaven and the Splinter Faith rule both want four
   * (test/multi-pick-choices.test.ts). Falling back to the combined field there gives exactly the four
   * the Archives name, and leaves Abadar's fifth out because his primaries already number four.
   */
  const primary = list(rec?.data?.domain_primary) ?? [];
  const all = list(rec?.data?.domain) ?? [];
  const domains = primary.length >= (prev.domains?.length ?? 0) ? primary : all;
  if (domains.length) out.domains = domains;

  const font = list(rec?.data?.divine_font);
  if (font?.length) out.divineFont = font;

  const weapons = list(rec?.data?.favored_weapon);
  if (weapons?.length) out.favoredWeapons = weapons;

  const skills = list(rec?.data?.skill);
  if (skills?.length) out.skill = skills[0];

  return out;
}

const ABBR_ATTR = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int', wisdom: 'wis', charisma: 'cha' };

/**
 * Background facets. The Archives state all of it structurally:
 *   data.skill ["Diplomacy","Heraldry Lore"]  ->  trainedSkill "diplomacy" + trainedLore "heraldry"
 *   data.feat ["Hobnobber"] / feat_markdown   ->  grantedFeatId, resolved through the LINK not the name
 *   data.attribute ["Dexterity","Intelligence"] -> abilityBoosts [{choice:[dex,int]}, {free}]
 *
 * A Pathfinder background grants two boosts: a choice between the named attributes, and one free. When
 * the Archives name only "Free" (or nothing), nothing is emitted rather than a guessed shape.
 */
export function backgroundFacets(rec, resolveFeatUrl, prev = {}) {
  const out = {};

  const skills = Array.isArray(rec?.data?.skill) ? rec.data.skill.map(String) : [];
  const lore = skills.find((s) => /\blore$/i.test(s.trim()));
  const plain = skills.find((s) => !/\blore$/i.test(s.trim()));

  /*
   * Not when the background offers a CHOICE of skill. HH models that with `trainedSkillChoice`, and
   * writing a single `trainedSkill` over it makes the picked skill untrained
   * (test/setup-gaps.test.ts, both assertions).
   */
  if (plain && !prev.trainedSkillChoice) out.trainedSkill = traitSlug(plain);

  // "Droskar Lore" -> droskar, but never an EMPTY subject: a lore whose whole name is the word "Lore"
  // slugs to "" and test/inert-choices.test.ts rejects it.
  /*
   * "Droskar Lore" -> droskar. Three things this must NOT do:
   *  - emit an EMPTY subject (a lore whose whole name is "Lore" slugs to "")
   *  - glue an EITHER/OR pair into one subject. "Legal Lore or Underworld Lore" once shipped as
   *    `legal-lore-or-underworld`, and seven characters were trained in a skill that does not exist.
   *    HH models those with `trainedLoreOptions` / `trainedLoreChoice`, so leave them alone.
   */
  if (lore && !prev.trainedLoreOptions && !prev.trainedLoreChoice) {
    const subject = traitSlug(lore.replace(/\s*lore$/i, ''));
    if (subject && !/(^|-)or(-|$)/.test(subject)) out.trainedLore = subject;
  }

  /*
   * FILL-ONLY. Heroes Heaven deliberately overrides this in places and says so out loud —
   * test/identity-data.test.ts is literally titled "the mirror is not always right", asserting Alma's
   * Clerk grants Glean Contents whatever the source field says. Adding the 16 that were missing is
   * safe; overwriting a hand-made correction is not.
   */
  if (prev.grantedFeatId == null) {
    const link = /\[[^\]]+\]\(([^)]+)\)/.exec(String(rec?.data?.feat_markdown ?? ''));
    if (link && typeof resolveFeatUrl === 'function') {
      const slug = resolveFeatUrl(link[1]);
      if (slug) out.grantedFeatId = slug;
    }
  }

  const attrs = (Array.isArray(rec?.data?.attribute) ? rec.data.attribute : [])
    .map((a) => ABBR_ATTR[String(a).toLowerCase()])
    .filter(Boolean);
  if (attrs.length >= 2) {
    // Same SET, different order is not a change worth making — keep HH's ordering to avoid 240 records
    // of pure churn in the diff.
    const prevOpts = prev.abilityBoosts?.[0]?.options;
    const same = Array.isArray(prevOpts) && prevOpts.length === attrs.length && [...prevOpts].sort().join() === [...attrs].sort().join();
    if (!same) out.abilityBoosts = [{ kind: 'choice', options: attrs }, { kind: 'free' }];
  }

  return out;
}

export function spellFacets(rec) {
  const out = {};

  const save = saveOf(rec);
  if (save) out.save = save;

  /*
   * `spell_type === 'Cantrip'` is the discriminator, NOT the cantrip trait and NOT level: it selects
   * all 115 cantrips with zero false positives. This is the whole explanation for the 115 rank
   * "disagreements" that looked mysterious earlier. HH's separate `level` field already agrees with
   * the Archives 1,761/1,761 and is left alone.
   */
  if (rec.spell_type === 'Cantrip') out.rank = 0;
  else if (typeof rec.spell_rank === 'number') out.rank = rec.spell_rank;

  /*
   * `data.tradition` carries a FIFTH value beyond the four traditions — `Elemental` — which is exactly
   * what Heroes Heaven keeps in `spellLists`. Splitting on the four-name allowlist reconstructs both.
   */
  if (Array.isArray(rec.data?.tradition)) {
    const low = rec.data.tradition.map((x) => String(x).toLowerCase());
    const traditions = [...new Set(low.filter((t) => TRADITIONS.has(t)))].sort();
    const lists = [...new Set(low.filter((t) => !TRADITIONS.has(t)))].sort();
    out.traditions = traditions;
    if (lists.length) out.spellLists = lists;   // HH omits the key when empty
  }

  /*
   * Read `data.actions`, never the top-level `action_cost`: that one is a BUCKETED search facet which
   * coarsens "10 minutes" to "1 minute+" and collapses every range to a single value.
   */
  const raw = rec.data?.actions;
  if (raw) {
    const s = String(raw).replace(/\s+/g, ' ').trim().toLowerCase();
    const range = s.match(/^(.+?) (?:to|or) (.+)$/);
    if (s === 'reaction') out.cast = { type: 'reaction' };
    else if (s === 'free action') out.cast = { type: 'free' };
    else if (ACT[s]) out.cast = { type: 'actions', value: ACT[s] };
    else if (range && ACT[range[1]] && ACT[range[2]]) out.cast = { type: 'variable', min: ACT[range[1]], max: ACT[range[2]] };
    else out.cast = { type: 'duration', text: s };
  }

  return out;
}

export function aonFacets(rec, prev = {}, resolveBase = null, bucket = null, resolveDoc = null, report = null) {
  const facets = {};
  const notes = [];

  if (typeof rec.level === 'number') {
    facets.level = rec.level;
    if (rec.level === 0 && typeof prev.level === 'number' && prev.level > 0) {
      notes.push({ field: 'level', from: prev.level, to: 0 });
    }
  }

  if (rec.rarity && RARITY.has(String(rec.rarity).toLowerCase())) {
    facets.rarity = String(rec.rarity).toLowerCase();
  }

  /*
   * A magic weapon's page lists only its MAGIC traits — `Eclipse` says Evocation/Light/Magical/Unique
   * and nothing about being a starknife. The weapon traits live on the base item, which the Archives
   * name in `data.base_item`: Eclipse -> Starknife -> Agile, Deadly d6, Finesse, Thrown 20 ft.,
   * Versatile S. Without this union, 774 magic items silently lose their weapon mechanics.
   */
  const own = remasterTraits(rawTraitsOf(rec)) ?? [];
  let baseTraits = [];
  const baseName = rec?.data?.base_item?.[0];
  if (baseName && typeof resolveBase === 'function') {
    const base = resolveBase(baseName);
    if (base) baseTraits = remasterTraits(rawTraitsOf(base)) ?? [];
  }
  const traits = [...new Set([...own, ...baseTraits])].sort();
  if (traits.length) facets.traits = traits;

  const price = coinsFromCp(rec.price_cp);
  if (price) facets.price = price;

  const bulk = bulkOf(rec);
  if (bulk !== null) facets.bulk = bulk;

  if (bucket === 'spells') Object.assign(facets, spellFacets(rec));
  if (bucket === 'deities') Object.assign(facets, deityFacets(rec, prev));
  if (bucket === 'backgrounds' && typeof resolveBase === 'function') Object.assign(facets, backgroundFacets(rec, (u) => resolveBase(u, 'featSlug'), prev));

  /*
   * Combat statistics. `stats` is the doc that actually carries them: a base weapon/armour/shield page
   * has them itself, a magic item's are on its base item. Only fields the record ALREADY has are
   * touched — this re-sources what is there, it does not turn an item into a weapon.
   */
  if (bucket === 'items') {
    /*
     * THE ITEM'S OWN DOC ONLY — never the base item.
     *
     * Following `base_item` for combat statistics looked right and is wrong in three ways, all found
     * by diffing 21 changed weapons:
     *   - it DESTROYS a magic weapon's damage type, which is the entire point of the item.
     *     Brilliant Rapier fire -> piercing, Mindlance mental -> piercing, Thundercrasher sonic ->
     *     piercing, Spark Dancer fire -> piercing.
     *   - some items name SEVERAL bases and there is no single answer. Gearblade lists Bastard Sword,
     *     Greatsword, Longsword, Shortsword and Greatclub; taking the first gave it a shortsword's d8.
     *   - Heroes Heaven appears to fold striking runes into `damage.dice` — Ankylostar is 3d6 where the
     *     base morningstar is 1d6 — so the base's dice are not comparable anyway.
     *
     * Base weapons and armour carry their own stats in weapon.json / armor.json, which is where these
     * values matter most and where agreement was already 99.4%. Magic items keep what they have; their
     * numbers are a separate problem needing the override sentence in the item's own prose.
     */
    const stats = rec;

    /*
     * A WAND IS NOT A CONSUMABLE. Measured in the Archives: of 438 docs with item_category "Wands",
     * ZERO carry the `Consumable` trait and all 438 carry `Wand`. The Archives state the rule outright
     * — trait-564 Consumable: "can be used only once … destroyed after activation"; trait-731 Wand:
     * "contains a single spell which you can cast once per day".
     *
     * Heroes Heaven disagrees with itself here: 119 wands are typed `consumable` and 253 are not.
     * The 119 are a real bug with a destructive symptom — `ItemDetail.tsx` gates the "Use one" button
     * on `itemType === 'consumable'`, which calls `useConsumable` and REMOVES the item, so casting
     * from those wands destroys them. `itemUses.ts:85` already documents the correct model.
     *
     * Only this one correction is made here. The rest of the itemType classifier is not: `itemType` is
     * a union TAG meaning "which stat block this record carries", and emitting a type whose required
     * fields are absent crashes the detail view. `equipment` requires nothing, so this flip is safe.
     */
    const itemCat = rec?.data?.item_category ?? rec?.item_category;
    const archiveTraits = (remasterTraits(rawTraitsOf(rec)) ?? []);
    if (prev.itemType === 'consumable' && (itemCat === 'Wands' || (archiveTraits.includes('wand') && !archiveTraits.includes('consumable')))) {
      facets.itemType = 'equipment';
    }

    const usage = usageOf(rec);
    if (usage) facets.usage = usage;

    const act = activationOf(rec);
    if (act) facets.activationCost = act;

    const freq = frequencyOf(rec);
    if (freq) facets.frequency = freq;

    /*
     * NEVER SHRINK a held-spell list. The extraction reproduces 685 of 723 exactly, but on 14
     * multi-variant staves it comes back 1-3 spells short — `Beast Staff (Major)` loses its whole
     * 5th-rank row. Some variant sections are not being sliced correctly and I have not pinned down
     * why, so rather than silently delete content the existing list is kept and the record reported.
     * Same principle as the untagged action costs: an extraction that is mostly right and lossy in a
     * way nobody notices is worse than one that declines.
     */
    const held = heldSpellsOf(rec, (url) => resolveBase(url, 'spellSlug'));
    if (held) {
      const size = (o) => (o ? Object.values(o).reduce((a, v) => a + v.length, 0) : 0);
      if (size(held) >= size(prev.heldSpells)) facets.heldSpells = held;
      else if (report) report({ name: rec.name, via: 'heldSpells would SHRINK — kept', cost: null });
    }

    /*
     * `hands`, `group`, `category` — measured against what the app already ships: category 100%,
     * hands 98.8%, group 98.3%. `hands` must be NUMERIC only: the Archives also write "1 or 2" and
     * "0+", which are prose, not a hand count.
     */
    if (typeof stats?.data?.hands === 'number') facets.hands = stats.data.hands;
    else if (/^\d+$/.test(String(stats?.data?.hands ?? ''))) facets.hands = Number(stats.data.hands);
    /*
     * `group` is FILL-ONLY, never an override. The Archives put crossbows in the `bow` group, which is
     * correct for the remaster, but Heroes Heaven's weapon-familiarity feats still name the `crossbow`
     * group and test/weapon-familiarity-mirror.test.ts asserts the two sides agree. Moving the weapons
     * without the feats breaks a real invariant, so the regroup is a paired change for later — it is
     * only 5 weapons and it gains nothing (there were 0 weapons missing a group).
     */
    if (prev.group == null && stats?.data?.weapon_group) facets.group = String(stats.data.weapon_group).toLowerCase();
    if (prev.category != null && stats?.data?.weapon_category) facets.category = String(stats.data.weapon_category).toLowerCase();

    if (prev.itemType === 'weapon') {
      const dmg = parseDamage(stats?.data?.damage);
      if (dmg) facets.damage = dmg;
      // Only alongside the thrown trait — see trap 2. A bare range makes a melee weapon a projectile.
      const rng = rangeOf(stats);
      const thrown = (remasterTraits(rawTraitsOf(stats)) ?? []).some((t) => t.startsWith('thrown'));
      if (rng != null && (thrown || typeof stats?.data?.range === 'number')) facets.range = rng;
      if (typeof stats?.data?.reload === 'number') facets.reload = stats.data.reload;
    }

    if (prev.itemType === 'armor') {
      const n = (v) => (typeof v === 'number' ? v : null);
      const ac = n(stats?.data?.ac);
      if (ac !== null) facets.acBonus = ac;
      if (n(stats?.data?.dex_cap) !== null) facets.dexCap = stats.data.dex_cap;
      if (n(stats?.data?.check_penalty) !== null) facets.checkPenalty = stats.data.check_penalty;
      if (n(stats?.data?.speed_penalty) !== null) facets.speedPenalty = stats.data.speed_penalty;
      if (n(stats?.data?.strength) !== null) facets.strength = stats.data.strength;
    }
  }

  // Spells carry their cost in `cast`, not `actionCost` — spellFacets handles those.
  if (bucket === 'feats' || bucket === 'classFeatures' || bucket === 'actions') {
    const ac = actionCostOf(rec, prev, resolveDoc, report);
    if (ac) facets.actionCost = ac;

    if (bucket === 'feats') {
      const pre = prerequisitesFrom(rec);
      if (pre) facets.prerequisites = pre;
      const arch = archetypeOf(rec, traitSlug, prev.archetype);
      if (arch) facets.archetype = arch;
    }

    // Additive only: the LINK to the actions this page grants, never their cost. Merged with whatever
    // Heroes Heaven already recorded, so a hand-authored entry is never dropped.
    if (typeof resolveDoc === 'function') {
      const slugs = grantedActionIds(rec).map((id) => resolveDoc(id, 'slug')).filter(Boolean);
      const merged = [...new Set([...(prev.grantsActions ?? []), ...slugs])];
      if (merged.length) facets.grantsActions = merged;
    }
  }

  return { facets, notes };
}
