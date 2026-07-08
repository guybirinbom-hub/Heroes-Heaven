/*
 * One-time importer: Foundry VTT pf2e source JSON -> our ContentDatabase schema.
 * Imports all character-building content from every book (ancestries, heritages,
 * backgrounds, classes, class-features, feats, spells, equipment, deities) —
 * monsters/hazards/NPCs are excluded. Run with: node scripts/import-core.mjs
 *
 * Reads the sparse clone in .import-src/pf2e and writes public/core.json (~14 MB),
 * a static asset the app fetches at runtime (see src/data/index.ts) rather than
 * bundling. Per-class spellcasting/subclass metadata (SPELLCASTING/SUBCLASS below)
 * is hand-supplied and currently covers only the Player Core classes.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = '.import-src/pf2e/packs/pf2e';
// Full character-content import (all books). Written to public/ (a ~12 MB static
// asset fetched at runtime) rather than bundled into the JS.
const OUT = 'public/core.json';

// Build safety: if the Foundry source clone isn't present (source-less checkout/CI), do NOT fail or
// overwrite — keep the committed public/core.json so `npm run build` still ships a working app. The
// importer only regenerates when the source is available.
if (!existsSync(ROOT)) {
  console.warn(`[import-core] ${ROOT} not found — skipping import; keeping existing ${OUT}.`);
  process.exit(0);
}
const RANKS = ['untrained', 'trained', 'expert', 'master', 'legendary'];
const SIZE = { tiny: 'tiny', sm: 'small', med: 'medium', lg: 'large', huge: 'huge', grg: 'gargantuan' };

// Tradition/type aren't in the class JSON, so supply them here. Player Core (1)
// casters only; add PC2 casters (sorcerer, oracle, ...) when that book is imported.
// NOTE: witch's tradition is actually patron-dependent — 'arcane' is a placeholder
// until patron selection exists.
const SPELLCASTING = {
  bard: { type: 'spontaneous', tradition: 'occult', repertoire: true },
  cleric: { type: 'prepared', tradition: 'divine', repertoire: false },
  druid: { type: 'prepared', tradition: 'primal', repertoire: false },
  witch: { type: 'prepared', tradition: 'arcane', repertoire: false },
  wizard: { type: 'prepared', tradition: 'arcane', repertoire: false },
  // Full spontaneous casters from later books. Oracle is fixed-divine; sorcerer's
  // tradition is set by its bloodline (extracted per-subclass below), so 'arcane'
  // here is only a fallback if no bloodline is chosen.
  oracle: { type: 'spontaneous', tradition: 'divine', repertoire: true, progression: 'full' },
  sorcerer: { type: 'spontaneous', tradition: 'arcane', repertoire: true, progression: 'full' },
  // Limited casters (slot tables transcribed from Archives of Nethys, modelled in
  // spellcasting.ts). Magus prepares arcane; psychic casts occult; summoner's
  // tradition comes from its eidolon (extracted per-subclass below).
  // Magus casts off Intelligence even though its class key ability is Str/Dex; the
  // psychic's key ability is a conscious-mind choice (absent in data) — default Int.
  magus: { type: 'prepared', tradition: 'arcane', repertoire: false, progression: 'two-rank', keyAbility: 'int' },
  summoner: { type: 'spontaneous', tradition: 'arcane', repertoire: true, progression: 'two-rank' },
  psychic: { type: 'spontaneous', tradition: 'occult', repertoire: true, progression: 'psychic', keyAbility: 'int' },
  // Animist: divine, Wis. Models the COMBINED total of its prepared "animist" pool
  // + spontaneous "apparition" pool as a single prepared pool (see spellcasting.ts).
  animist: { type: 'prepared', tradition: 'divine', repertoire: false, progression: 'animist' },
};
const FEAT_PROGRESSION = {
  class: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
  skill: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
  general: [3, 7, 11, 15, 19],
  ancestry: [1, 5, 9, 13, 17],
};

// Subclass choice per class: a display name + the Foundry otherTag that marks its
// option features. Fighter has none. Options are collected from class-features.
const SUBCLASS = {
  cleric: { name: 'Doctrine', tag: 'cleric-doctrine' },
  druid: { name: 'Order', tag: 'druid-order' },
  ranger: { name: "Hunter's Edge", tag: 'ranger-hunters-edge' },
  rogue: { name: 'Racket', tag: 'rogue-racket' },
  bard: { name: 'Muse', tag: 'bard-muse' },
  wizard: { name: 'Arcane School', tag: 'wizard-arcane-school' },
  witch: { name: 'Patron', tag: 'witch-patron' },
  // All-books classes. Tag = the Foundry otherTag marking that class's subclass
  // option features (verified by scanning class-features otherTags). Options +
  // their skill/focus grants are extracted data-drivenly, same as Player Core.
  // monk has no subclass; commander/guardian have no tagged subclass; exemplar
  // and kineticist use multi-pick ikon/gate systems (deferred — not a single pick).
  alchemist: { name: 'Research Field', tag: 'alchemist-research-field' },
  barbarian: { name: 'Instinct', tag: 'barbarian-instinct' },
  champion: { name: 'Cause', tag: 'champion-cause' },
  gunslinger: { name: 'Way', tag: 'gunslinger-way' },
  inventor: { name: 'Innovation', tag: 'inventor-innovation' },
  investigator: { name: 'Methodology', tag: 'investigator-methodology' },
  magus: { name: 'Hybrid Study', tag: 'magus-hybrid-study' },
  oracle: { name: 'Mystery', tag: 'oracle-mystery' },
  sorcerer: { name: 'Bloodline', tag: 'sorcerer-bloodline' },
  summoner: { name: 'Eidolon', tag: 'summoner-eidolon' },
  swashbuckler: { name: 'Style', tag: 'swashbuckler-style' },
  // thaumaturge implements are a multi-pick (1 at L1, +1 at L5, +1 at L15) — see EXTRA_CHOICES, not a single subclass.
  psychic: { name: 'Conscious Mind', tag: 'psychic-conscious-mind' },
  animist: { name: 'Practice', tag: 'animistic-practice' },
};

// A witch's spell tradition is set by its patron (the patron features state it in
// prose, not as a rule). Authoritative Player Core mapping by patron slug.
const PATRON_TRADITION = {
  'faiths-flamekeeper': 'divine',
  'silence-in-snow': 'primal',
  'spinner-of-threads': 'occult',
  'starless-shadow': 'occult',
  'the-inscribed-one': 'arcane',
  'the-resentment': 'occult',
  'wilding-steward': 'primal',
};

// Subclass armor/weapon keystones not expressible as a simple rank rule in the
// source. (The Warrior muse bard is already martial-trained at base, so it needs
// no entry; its real benefit is a fighter feat — out of scope.)
const SUBCLASS_KEYSTONE = {
  ruffian: { armor: ['medium'] },
  avenger: { armor: ['medium'] }, // Avenger rogue is trained in medium armor (from the racket's prose)
};

// Subclass option key-ability overrides not expressible as a Foundry keyOptions field (e.g. set via
// a FlatModifier on the class selector). Way of the Spellshot uses Intelligence for the class DC.
const SUBCLASS_KEY_ABILITY = {
  'way-of-the-spellshot': 'int',
};

// Subclass options whose Foundry keyOptions describe something OTHER than the class's key attribute and
// must NOT set it. Eldritch Trickster's keyOptions are its required multiclass DEDICATION's attributes
// (int/cha/wis), not the rogue's — a rogue's key attribute stays Dexterity regardless of this racket.
const KEY_ABILITY_IGNORE = new Set(['eldritch-trickster']);

// Class-feature id fixups: a class's items[] name slugs to an id the class-features pack stores
// differently, leaving the feature without a description. Map the slug to the real feature id.
const FEATURE_ID_ALIAS = {
  hexes: 'hex-spells', // witch "Hexes" feature → "Hex Spells" content
  'choice-greater-field-discovery': 'greater-field-discovery', // alchemist L13 display slug
};

const slug = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const rank = (n) => RANKS[n] ?? 'untrained';
const idOf = (e) => slug(e.system?.slug || e.name);

function walk(dir) {
  let out = [];
  for (const e of readdirSync(dir)) {
    if (e.startsWith('_')) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(walk(p));
    else if (e.endsWith('.json')) out.push(p);
  }
  return out;
}
const readPack = (name) => walk(join(ROOT, name)).map((f) => JSON.parse(readFileSync(f, 'utf8')));

/** Derive a readable label for a LABEL-LESS @UUID/@Compendium reference from its document
 *  name (the last path segment), so condition/spell/feat references don't leave dangling
 *  sentences like "You are , you don't treat anyone as your ally". Conditions read lowercase
 *  ("off-guard"); other names keep their case ("Fear"). Opaque Foundry ids (no separators)
 *  have no readable name, so they're dropped. */
function uuidLabel(ref) {
  const seg = (ref.split('.').pop() || '').trim();
  if (!seg || (/^[A-Za-z0-9]{12,}$/.test(seg) && !/[ -]/.test(seg))) return '';
  return /conditionitems/i.test(ref) ? seg.toLowerCase() : seg;
}

/** Foundry compendium pack -> the ContentDatabase key it maps to (for in-description links).
 *  Packs not listed (journals/effects/bestiary/…) aren't navigable content, so they stay plain. */
const PACK_KEY = {
  'spells-srd': 'spells',
  conditionitems: 'conditions',
  actionspf2e: 'actions',
  'feats-srd': 'feats',
  'equipment-srd': 'items',
  classfeatures: 'classFeatures',
  deities: 'deities',
  'familiar-abilities': 'familiarAbilities',
  heritages: 'heritages',
  backgrounds: 'backgrounds',
};

// Foundry embeds action-cost icons as <span class="action-glyph">X</span>. Map its font characters to
// the app's Pathfinder2eActions font chars (1/2/3 = actions, 4 = free, 5 = reaction). Foundry uses both
// digits and letters: A = 1 action, D = 2, T = 3, F/0 = free, R = reaction.
const ACTION_GLYPH_CHAR = {
  '1': '1', A: '1', a: '1',
  '2': '2', D: '2', d: '2',
  '3': '3', T: '3', t: '3',
  '0': '4', F: '4', f: '4',
  R: '5', r: '5',
};

/**
 * Like cleanDesc, but also extracts the cross-references the text links to (Foundry @UUID
 * links), so the app can make those words clickable. Returns { text, refs } where each ref
 * is { label, key } (key = ContentDatabase map). The label text is left inline in `text`
 * exactly where the link was, so the renderer can re-linkify its occurrences.
 */
function cleanDescRich(html) {
  if (!html) return { text: '', refs: [] };
  const refs = [];
  const seen = new Set();
  const addRef = (pack, label) => {
    const key = PACK_KEY[pack];
    const l = (label || '').trim();
    if (!key || !l) return;
    const dk = key + '|' + l.toLowerCase();
    if (seen.has(dk)) return;
    seen.add(dk);
    refs.push({ label: l, key });
  };
  // Inline emphasis + entity decode for a fragment (used for table/list cell text).
  const inlineClean = (frag) =>
    String(frag)
      .replace(/<\/?(?:strong|b)\b[^>]*>/gi, '**')
      .replace(/<\/?(?:em|i)\b[^>]*>/gi, '*')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&mdash;/g, '—')
      .replace(/&ndash;/g, '–')
      .replace(/&times;/g, '×')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/&[a-z]+;/g, '')
      // collapse empty emphasis runs left by a stripped label-less link (e.g. "**** " / "** **")
      .replace(/\*\*\s*\*\*/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  // A Foundry <table> → a GFM pipe table. Cells keep bold runs; pipes are escaped to '/'.
  const tableToMd = (inner) => {
    const rows = [...inner.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
      [...m[1].matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((c) => inlineClean(c[1]).replace(/\|/g, '/')),
    );
    const grid = rows.filter((r) => r.length);
    if (!grid.length) return '';
    const ncol = Math.max(...grid.map((r) => r.length));
    const pad = (r) => { while (r.length < ncol) r.push(''); return r; };
    const line = (cells) => '| ' + cells.join(' | ') + ' |';
    const out = [line(pad(grid[0])), line(Array(ncol).fill('---'))];
    for (const r of grid.slice(1)) out.push(line(pad(r)));
    return '\n\n' + out.join('\n') + '\n\n';
  };

  const text = String(html)
    // Foundry "effect" item links (Spell Effect / equipment-effects / feat-effects / …) carry the
    // VTT effect token but read as noise in prose ("Spell Effect: Albatross Curse (Failure)") — drop
    // them entirely, labelled or not, before the general ref handlers keep their label text.
    .replace(/@(?:UUID|Compendium)\[Compendium\.pf2e\.[a-z0-9-]*effects\.[^\]]*\](?:\{[^}]*\})?/gi, '')
    // Journal links (e.g. a class flavor entry's trailing "{Fighter}" link to its rules journal) are
    // navigation artifacts that render as a stray line — drop them entirely.
    .replace(/@(?:UUID|Compendium)\[Compendium\.pf2e\.journals\.[^\]]*\](?:\{[^}]*\})?/gi, '')
    // labelled compendium refs we can map → record the ref, keep the label text
    .replace(/@(?:UUID|Compendium)\[Compendium\.pf2e\.([a-z0-9-]+)\.[^\]]*\]\{([^}]*)\}/g, (_, pack, label) => {
      addRef(pack, label);
      return label;
    })
    // labelled refs we can't map (journals, effects, …) → keep the label text only
    .replace(/@(?:UUID|Compendium)\[[^\]]*\]\{([^}]*)\}/g, '$1')
    .replace(/@[A-Za-z]+\[[^\]]*\]\{([^}]*)\}/g, '$1')
    // label-less compendium refs we can map → derive a label + record the ref
    .replace(/@(?:UUID|Compendium)\[(Compendium\.pf2e\.([a-z0-9-]+)\.[^\]]*)\]/g, (_, ref, pack) => {
      const lbl = uuidLabel(ref);
      addRef(pack, lbl);
      return lbl;
    })
    // other label-less UUID/Compendium refs: derive a name instead of deleting them
    .replace(/@(?:UUID|Compendium)\[([^\]]*)\]/g, (_, ref) => uuidLabel(ref))
    // @Damage tokens carry a value the prose needs (e.g. a healing potion's amount), and they nest a
    // [type] bracket — @Damage[(2d8+5)[healing]]. Recover the dice/number formula instead of deleting it
    // (the old catch-all stopped at the inner ] and stranded the outer one → "regain ] Hit Points").
    .replace(/@Damage\[((?:[^\[\]]*\[[^\]]*\])*[^\[\]]*)\](?:\{([^}]*)\})?/g, (_m, inner, label) => {
      if (label) return label;
      const formula = inner
        .replace(/\[[^\]]*\]/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^\(|\)$/g, ''))
        .filter(Boolean)
        .join(' plus ');
      return /^[\dd+\-\s()]+(?: plus [\dd+\-\s()]+)*$/.test(formula) && /\d/.test(formula) ? formula : '';
    })
    // other label-less inline macros (@Check, @Template, …) have no readable text; tolerate one level of
    // nested brackets and keep a {label} when present, so a nested ] is never left stranded.
    .replace(/@[A-Za-z]+\[(?:[^\[\]]*\[[^\]]*\])*[^\[\]]*\](?:\{([^}]*)\})?/g, (_m, label) => label || '')
    // inline roll expressions: [[/r 1d4 #flavor]]{label} → label; bare [[/r 2d6]] → the dice.
    .replace(/\[\[\/[a-z]+\s+[^\]]*?\]\]\{([^}]*)\}/gi, '$1')
    // dice form — tolerate an inline [type] bracket (e.g. 4d8[healing]) and a #flavor tail with or
    // without a leading space (1d4#flavor), consuming the remainder lazily up to the closing ]].
    .replace(/\[\[\/[a-z]+\s+(\d+d\d+(?:[+\-]\d+)?)[\s\S]*?\]\]/gi, '$1')
    // any remaining bare roll (non-dice / flat) — allow #flavor with or without a leading space.
    .replace(/\[\[\/[a-z]+\s+([^\]#]*?)(?:\s*#[^\]]*)?\]\]/gi, '$1')
    // leaked Foundry data getters (@actor.x / @item.x — only resolvable with a live actor): render the
    // common ability-mod case as readable text ("Str mod"), and strip any other getter so none leak.
    .replace(/@actor\.abilities\.(str|dex|con|int|wis|cha)\.mod\b/gi, (_m, a) => a.charAt(0).toUpperCase() + a.slice(1) + ' mod')
    .replace(/@(?:actor|item)\.[\w.[\]-]+/g, '')
    // tables and lists first, so their nested <p>/<li> don't get flattened by the block pass below
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, inner) => tableToMd(inner))
    .replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, inner) => {
      let n = 0;
      const items = [...inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => {
        const c = inlineClean(m[1]);
        return (tag.toLowerCase() === 'ol' ? `${++n}. ` : '- ') + c;
      });
      return items.length ? '\n\n' + items.join('\n') + '\n\n' : '';
    })
    // Preserve the action-cost glyph inline (Foundry drops it into "Activate [icon] (traits)") as a
    // ⟨N⟩ token the renderer turns into the icon, rather than stripping it.
    .replace(/<span class="action-glyph">\s*([^<]*?)\s*<\/span>/g, (_m, g) => {
      const c = ACTION_GLYPH_CHAR[g.trim()];
      return c ? `⟨${c}⟩` : '';
    })
    // block structure → markdown breaks
    .replace(/<hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<h1[^>]*>/gi, '\n\n# ')
    .replace(/<h2[^>]*>/gi, '\n\n## ')
    .replace(/<h3[^>]*>/gi, '\n\n### ')
    .replace(/<h4[^>]*>/gi, '\n\n#### ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // inline emphasis
    .replace(/<\/?(?:strong|b)\b[^>]*>/gi, '**')
    .replace(/<\/?(?:em|i)\b[^>]*>/gi, '*')
    // strip any remaining tags
    .replace(/<[^>]+>/g, ' ')
    // entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&times;/g, '×')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/g, '')
    // normalize whitespace: collapse spaces/tabs per line, keep newlines, cap blank lines at one.
    // Lines left as bare emphasis markers (e.g. an empty "**" from a stripped link) are dropped.
    .split('\n')
    .map((l) => {
      const t = l.replace(/[ \t]+/g, ' ').trim();
      if (/^[*_]+$/.test(t)) return ''; // a line left as a bare emphasis marker → drop
      // A stray leading "* " (a literal asterisk bullet some source paragraphs use) → a real bullet,
      // so it renders as a list item instead of a dangling asterisk. (Bold "**"/italic "*x" are unaffected.)
      return t.replace(/^\* /, '- ');
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text, refs };
}

function cleanDesc(html) {
  return cleanDescRich(html).text;
}

/** Flatten markdown-lite back to a single plain-text line, for the prose parsers (frequency,
 *  charges, subclass tradition) that scan description text and predate the markdown formatting. */
function flat(md) {
  return String(md)
    .replace(/\*\*/g, '')
    .replace(/(^|\s)-{3,}(?=\s|$)/g, ' ')
    .replace(/[#|]/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Object spread for an entry: { description, descRefs? } from a Foundry HTML description. */
function descFields(html) {
  const { text, refs } = cleanDescRich(html);
  return refs.length ? { description: text, descRefs: refs } : { description: text };
}

function boosts(obj) {
  const out = [];
  for (const k of Object.keys(obj || {}).sort()) {
    const v = obj[k]?.value || [];
    if (v.length === 0) continue;
    if (v.length >= 6) out.push({ kind: 'free' });
    else if (v.length === 1) out.push({ kind: 'fixed', ability: v[0] });
    else out.push({ kind: 'choice', options: v });
  }
  return out;
}
const flaws = (obj) =>
  Object.values(obj || {})
    .map((f) => (f?.value || [])[0])
    .filter(Boolean);

const traitsOf = (s) => s?.traits?.value || [];
const rarityOf = (s) => s?.traits?.rarity || 'common';
const bulkVal = (b) => (typeof b?.value === 'number' ? b.value : 0);
const sourceOf = (e) => {
  const p = e.system?.publication;
  return p ? { book: p.title, license: p.license } : undefined;
};

function featCost(s) {
  const t = s.actionType?.value;
  if (t === 'passive') return { type: 'passive' };
  if (t === 'reaction') return { type: 'reaction' };
  if (t === 'free') return { type: 'free' };
  const n = s.actions?.value;
  if (t === 'action' && (n === 1 || n === 2 || n === 3)) return { type: 'actions', value: n };
  return undefined;
}
// Foundry localization keys (PF2E.Skill.Arcana) -> a readable label.
const humanize = (l) =>
  !l ? '' : String(l).startsWith('PF2E.') ? String(l).split('.').pop().replace(/([a-z])([A-Z])/g, '$1 $2') : String(l);
// A feat's embedded sub-choice (ChoiceSet), when we can resolve its options:
// the deity-domain reference (Domain Initiate) or an inline {value,label} array.
function featChoice(s) {
  const cs = (s.rules || []).find((r) => r.key === 'ChoiceSet');
  if (!cs) return undefined;
  if (cs.choices === 'system.details.deities.domains') return { flag: cs.flag || 'choice', prompt: 'Domain', kind: 'domains' };
  if (Array.isArray(cs.choices)) {
    const options = cs.choices
      .filter((c) => c && c.value !== undefined && typeof c.value !== 'object')
      .map((c) => ({ value: String(c.value), label: humanize(c.label) || String(c.value) }));
    if (options.length) return { flag: cs.flag || 'choice', prompt: humanize(cs.prompt) || 'Choose an option', kind: 'array', options };
  }
  return undefined;
}
function spellCast(tv) {
  if (!tv) return { type: 'passive' };
  const t = String(tv).trim().toLowerCase();
  if (t === 'reaction') return { type: 'reaction' };
  if (t === 'free') return { type: 'free' };
  // Variable casting time: "1 to 3" and "1 or 2" both mean an N–M action range.
  const m = t.match(/^(\d)\s*(?:to|or)\s*(\d)$/);
  if (m) return { type: 'variable', min: +m[1], max: +m[2] };
  if (/^[123]$/.test(t)) return { type: 'actions', value: +t };
  return { type: 'duration', text: String(tv) };
}

const db = {
  ancestries: {},
  heritages: {},
  backgrounds: {},
  classes: {},
  classFeatures: {},
  feats: {},
  spells: {},
  items: {},
  deities: {},
  languages: {},
  animalCompanions: {},
  familiarAbilities: {},
  conditions: {},
  actions: {},
  runes: {},
};
const langSet = new Set(['common']);

/** Strike-damage property runes (Foundry has no structured damage on the rune item; this is the
 *  well-known elemental set). Greater variants deal the SAME 1d6 per hit; only Greater Flaming adds
 *  persistent damage on a crit (2d10 fire). The other greater elementals' crit effects (Frost → slowed,
 *  Shock → arcs to a second creature, Corrosive → damages armor, Thundering → deafened) aren't per-hit
 *  damage, so they're not modelled as a damage rider. */
const RUNE_DAMAGE = {
  flaming: { dice: 1, die: 'd6', type: 'fire' },
  'flaming-greater': { dice: 1, die: 'd6', type: 'fire', critPersistent: { dice: 2, die: 'd10' } },
  frost: { dice: 1, die: 'd6', type: 'cold' },
  'frost-greater': { dice: 1, die: 'd6', type: 'cold' },
  corrosive: { dice: 1, die: 'd6', type: 'acid' },
  'corrosive-greater': { dice: 1, die: 'd6', type: 'acid' },
  shock: { dice: 1, die: 'd6', type: 'electricity' },
  'shock-greater': { dice: 1, die: 'd6', type: 'electricity' },
  thundering: { dice: 1, die: 'd6', type: 'sonic' },
  'thundering-greater': { dice: 1, die: 'd6', type: 'sonic' },
};

// Reinforcing rune (Player Core 2) additive bonuses to a shield's Hardness / HP / BT, keyed by the
// rune's numeric tier (minor=1 … supreme=6). Foundry stores a reinforced shield's boosted HP in
// `system.hp.value` but leaves `system.hardness` at the base value, so we apply this table when a shield
// carries `system.runes.reinforcing`. Values sourced from the reinforcing-rune equipment descriptions.
const REINFORCING_STATS = {
  1: { hardness: 3, hp: 44, bt: 22 },
  2: { hardness: 3, hp: 52, bt: 26 },
  3: { hardness: 3, hp: 64, bt: 32 },
  4: { hardness: 5, hp: 80, bt: 40 },
  5: { hardness: 5, hp: 84, bt: 42 },
  6: { hardness: 7, hp: 108, bt: 54 },
};

/** Parse a standalone "etched-onto-…" equipment item into a RuneDef (or null if not a rune). */
function parseRune(id, name, usage, level, price) {
  const slot = /armor/.test(usage) ? 'armor' : /shield/.test(usage) ? 'shield' : 'weapon';
  let m;
  if ((m = /^(weapon|armor)-potency-(\d)$/.exec(id))) return { id, name, slot: m[1], kind: 'potency', value: Number(m[2]), level, price };
  const tier = (base) => (id === base ? 1 : id === `${base}-greater` ? 2 : id === `${base}-major` ? 3 : null);
  let v;
  if ((v = tier('striking')) != null) return { id, name, slot: 'weapon', kind: 'striking', value: v, level, price };
  if ((v = tier('resilient')) != null) return { id, name, slot: 'armor', kind: 'resilient', value: v, level, price };
  if (id.startsWith('reinforcing-rune')) {
    const tiers = { minor: 1, lesser: 2, moderate: 3, greater: 4, major: 5, supreme: 6 };
    const t = Object.keys(tiers).find((k) => id.endsWith(k));
    return { id, name, slot: 'shield', kind: 'reinforcing', value: t ? tiers[t] : 1, level, price };
  }
  return { id, name, slot, kind: 'property', level, price, ...(RUNE_DAMAGE[id] ? { damage: RUNE_DAMAGE[id] } : {}) };
}

/** Parse an item's limited-use frequency from its description ("Frequency once per day", etc.).
 *  Foundry has no structured frequency, so the count + period are read from the prose. */
function parseFrequency(desc) {
  if (!desc) return undefined;
  const m = /frequency\s+(once|twice|thrice|three times|four times|five times|\d+\s*times?)\s+per\s+(?:\d+\s+)?(day|hour|minute|round|turn|week|month)/i.exec(desc);
  if (!m) return undefined;
  const w = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
  const words = { once: 1, twice: 2, thrice: 3, 'three times': 3, 'four times': 4, 'five times': 5 };
  let max = words[w];
  if (max == null) {
    const n = /(\d+)/.exec(w);
    max = n ? Number(n[1]) : 1;
  }
  return { max, per: m[2].toLowerCase() };
}

/** An item's activation action cost, read from the RAW description ("Activate" + the action glyph),
 *  which must run before cleanDescRich strips the glyph span. Returns an ActionCost or undefined. */
function parseActivationCost(rawHtml) {
  const h = String(rawHtml || '');
  if (!/<strong>\s*Activate\b/i.test(h)) return undefined;
  // Foundry's action-glyph font uses digits AND letters: A = 1 action, D = 2, T = 3, F/0 = free,
  // R = reaction. (Mapping must stay in sync with ACTION_GLYPH_CHAR used for description rendering.)
  const map = {
    '1': { type: 'actions', value: 1 },
    '2': { type: 'actions', value: 2 },
    '3': { type: 'actions', value: 3 },
    A: { type: 'actions', value: 1 },
    a: { type: 'actions', value: 1 },
    D: { type: 'actions', value: 2 },
    d: { type: 'actions', value: 2 },
    T: { type: 'actions', value: 3 },
    t: { type: 'actions', value: 3 },
    '0': { type: 'free' },
    f: { type: 'free' },
    F: { type: 'free' },
    r: { type: 'reaction' },
    R: { type: 'reaction' },
  };
  // Some items list several activations (and a glyph-less "Activate Interact" / "Activate Cast a Spell"
  // line may come first) — scan EVERY Activate line and use the first one carrying a recognized glyph.
  for (const m of h.matchAll(/<strong>\s*Activate\b[^<]*<\/strong>[\s—–-]*(?:<span[^>]*action-glyph[^>]*>\s*([^<]*?)\s*<\/span>)?/gi)) {
    const g = (m[1] || '').trim();
    if (map[g]) return map[g];
  }
  return undefined; // no recognizable glyph ("Cast a Spell" / glyph-less Activate) — don't fabricate a cost
}

/** Spells held by a staff/spellheart, parsed from its description's per-rank list
 *  (`<strong>1st</strong> @UUID[…], @UUID[…]`). Returns rank → spell ids, or undefined. */
function parseHeldSpells(rawHtml) {
  const h = String(rawHtml || '');
  const out = {};
  const re = /<strong>\s*(Cantrip|\d+(?:st|nd|rd|th))\s*<\/strong>([^]*?)(?:<\/li>|<\/p>|<strong>)/gi;
  let m;
  while ((m = re.exec(h))) {
    const rank = /cantrip/i.test(m[1]) ? 0 : parseInt(m[1], 10);
    if (!Number.isFinite(rank)) continue;
    const ids = [...m[2].matchAll(/@UUID\[Compendium\.pf2e\.spells-srd\.Item\.([^\]]+)\]/g)].map((x) => slug(x[1]));
    if (ids.length) out[rank] = [...new Set([...(out[rank] || []), ...ids])];
  }
  return Object.keys(out).length ? out : undefined;
}
/** Innate spells a feat/heritage grants: the `item:slug:<spell>` token on an `ItemAlteration` rule
 *  predicated `spellcasting:innate`, with tradition + at-will/frequency read from the prose. */
// Pre-Remaster spell slugs that some feats still reference → their current Remaster ids.
const INNATE_SPELL_ALIAS = { 'produce-flame': 'ignition', regeneration: 'regenerate' };
function parseInnateSpells(rules, descHtml) {
  const ids = new Set();
  for (const r of rules || []) {
    if (r.key !== 'ItemAlteration') continue;
    const pred = (r.predicate || []).map(String);
    if (!pred.includes('spellcasting:innate')) continue;
    const tok = pred.find((p) => p.startsWith('item:slug:'));
    if (!tok) continue;
    let slugId = tok.slice('item:slug:'.length);
    // Skip Foundry ChoiceSet templates like "{item|flags.system.rulesSelections.cantrip}" — these
    // never resolve to a real spell id.
    if (slugId.includes('{')) continue;
    slugId = INNATE_SPELL_ALIAS[slugId] ?? slugId;
    ids.add(slugId);
  }
  if (!ids.size) return undefined;
  const t = flat(cleanDesc(descHtml));
  const tradition = (t.match(/\b(arcane|divine|occult|primal)\s+innate/i) || [])[1]?.toLowerCase();
  const atWill = /\binnate spell at will\b/i.test(t) || /\bat will\b/i.test(t);
  return [...ids].map((spellId) => ({ spellId, ...(tradition ? { tradition } : {}), ...(atWill ? { atWill: true } : {}) }));
}

/** A spellheart's held spells (a cantrip + a 1/day leveled spell), referenced as @UUID spell links in
 *  prose rather than a per-rank list. Groups the resolvable spell refs by their rank (needs db.spells). */
function parseSpellheartSpells(rawHtml) {
  const ids = [...String(rawHtml || '').matchAll(/@UUID\[Compendium\.pf2e\.spells-srd\.Item\.([^\]]+)\]/g)].map((m) => slug(m[1]));
  const out = {};
  for (const id of ids) {
    const r = db.spells[id]?.rank;
    if (r != null && !(out[r] || []).includes(id)) (out[r] = out[r] || []).push(id);
  }
  return Object.keys(out).length ? out : undefined;
}
/** A wand's single held spell at the wand's rank (structured embedded spell, or generic by name). */
function parseWandSpell(s, name) {
  const sslug = s?.spell?.system?.slug;
  if (!sslug) return undefined;
  const rankFromName = /\(rank (\d+)\)/i.exec(name)?.[1];
  const rank = Number(rankFromName ?? s.spell.system?.level?.value ?? 1);
  return { [rank]: [slug(sslug)] };
}

const FREQ_WORDS = { once: 1, one: 1, twice: 2, two: 2, thrice: 3, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
/** All "Frequency N per/each/every <period>" activations in the prose (an item can have several). */
function parseFrequencies(desc) {
  if (!desc) return [];
  const re = /frequency\s+(once|twice|thrice|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?:\s*times?)?\s+(?:per|each|every)\s+(?:\d+\s+)?(day|hour|minute|round|turn|week|month)/gi;
  const out = [];
  let m;
  while ((m = re.exec(desc))) {
    const w = m[1].toLowerCase();
    out.push({ max: FREQ_WORDS[w] ?? (Number(w) || 1), per: m[2].toLowerCase() });
  }
  return out;
}

/** Build the trackable counters for an item: a staff's level-based charge pool, an explicit
 *  prose charge pool, each per-X activation, and a multi-use consumable's finite stock. */
function buildCounters(desc, traits, uses) {
  const counters = [];
  if ((traits ?? []).includes('staff')) {
    // A staff's charge pool equals its level (PF2e core rule); resolved at derive time.
    counters.push({ id: 'pool', label: 'Charges', max: 'level', resetsOnRest: true, startsFull: true });
  } else {
    // Explicit prose charge pool, e.g. "has 10 charges", "begins with 10 charges", "up to 2 charges".
    const cm = /\b(?:has|holds|begins with|contains|up to|stores|with)\s+(\d{1,3})\s+charges?\b/i.exec(desc || '');
    if (cm) counters.push({ id: 'pool', label: 'Charges', max: Number(cm[1]), resetsOnRest: !/reset[^.]*\bto 0\b/i.test(desc || '') });
  }
  parseFrequencies(desc).forEach((f, i) =>
    counters.push({ id: i === 0 ? 'freq' : `freq${i + 1}`, label: `per ${f.per}`, max: f.max, per: f.per, resetsOnRest: !['week', 'month'].includes(f.per) }),
  );
  if (uses && uses.max > 1) counters.push({ id: 'uses', label: 'Uses', max: uses.max, resetsOnRest: false });
  return counters;
}

/* =========================================================================
 * Structured "stat block" markdown.
 *
 * Foundry stores only flavor text in a class/ancestry/deity/background's description.value; the
 * mechanical "page" (proficiencies, HP, boosts, domains, the advancement table) lives in structured
 * fields. We compose those into a markdown stat block and append it after the flavor, so every place
 * that renders `description` (Details-tab chips, cross-reference popups) shows the full page via the
 * existing RichText markdown renderer — no display-path changes needed.
 * ========================================================================= */
const ABIL_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const capWord = (x) => (x ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : '');
const titleCase = (x) => String(x || '').split(/[-_\s]+/).filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
const abilName = (a) => ABIL_NAME[a] || titleCase(a);
const rankName = (n) => capWord(rank(n));
const ordinal = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

const NUMWORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'];
function boostSlotsText(slots) {
  if (!slots.length) return '';
  const named = [];
  let free = 0;
  for (const b of slots) {
    if (b.kind === 'free') free++;
    else if (b.kind === 'fixed') named.push(abilName(b.ability));
    else named.push((b.options || []).map(abilName).join(' or '));
  }
  const freeTxt = free ? `${NUMWORD[free] || free} free` : '';
  return [...named, freeTxt].filter(Boolean).join(', ');
}
/** "Simple weapons (Trained), Martial weapons (Trained)" — only categories the class is trained+ in. */
function profCats(obj, cats) {
  return cats.filter(([k]) => (obj?.[k] || 0) > 0).map(([k, label]) => `${label} (${rankName(obj[k])})`).join(', ') || 'Untrained';
}
/** Combine a cleaned flavor description with a structured stat block (flavor first, then a divider).
 *  extraRefs (e.g. the cross-references inside inlined class-feature text) are merged + de-duped so
 *  links keep working in the appended block. */
function descWithBlock(html, blockMd, extraRefs) {
  const { text, refs } = cleanDescRich(html);
  const description = blockMd ? (text ? `${text}\n\n---\n\n${blockMd}` : blockMd) : text;
  const all = [...refs, ...(extraRefs || [])];
  const seen = new Set();
  const merged = all.filter((r) => {
    const k = `${r.key}|${(r.label || '').toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return merged.length ? { description, descRefs: merged } : { description };
}

function classStatBlock(s) {
  const key = s.keyAbility?.value || [];
  const sk = s.trainedSkills || {};
  const head = [
    '## Class details',
    `**Key Attribute** ${key.length ? key.map(abilName).join(' or ') : '—'}`,
    `**Hit Points** ${s.hp ?? '—'} + your Constitution modifier per level`,
    `**Perception** ${rankName(s.perception || 0)}`,
    `**Saving Throws** Fortitude ${rankName(s.savingThrows?.fortitude || 0)}, Reflex ${rankName(s.savingThrows?.reflex || 0)}, Will ${rankName(s.savingThrows?.will || 0)}`,
    (sk.value || []).length
      ? `**Skills** Trained in ${sk.value.map(titleCase).join(', ')}${sk.additional ? `, plus ${sk.additional} + Intelligence modifier additional skills` : ''}`
      : `**Skills** Trained in ${sk.additional || 0} + Intelligence modifier skills of your choice`,
    `**Attacks** ${profCats(s.attacks, [['unarmed', 'Unarmed attacks'], ['simple', 'Simple weapons'], ['martial', 'Martial weapons'], ['advanced', 'Advanced weapons']])}`,
    `**Defenses** ${profCats(s.defenses, [['unarmored', 'Unarmored'], ['light', 'Light armor'], ['medium', 'Medium armor'], ['heavy', 'Heavy armor']])}`,
    '**Class DC** Trained',
  ].join('\n\n');
  const byLevel = {};
  for (const it of Object.values(s.items || {})) (byLevel[it.level || 1] ??= []).push(it.name);
  const set = (v) => new Set(v || []);
  const cf = set(s.classFeatLevels?.value), sf = set(s.skillFeatLevels?.value), gf = set(s.generalFeatLevels?.value), af = set(s.ancestryFeatLevels?.value), si = set(s.skillIncreaseLevels?.value);
  const boostL = new Set([5, 10, 15, 20]);
  const rows = [];
  for (let L = 1; L <= 20; L++) {
    const it = [];
    if (byLevel[L]) it.push(...byLevel[L]);
    if (cf.has(L)) it.push('Class feat');
    if (si.has(L)) it.push('Skill increase');
    if (boostL.has(L)) it.push('Attribute boosts');
    if (gf.has(L)) it.push('General feat');
    if (sf.has(L)) it.push('Skill feat');
    if (af.has(L)) it.push('Ancestry feat');
    if (it.length) rows.push(`| ${L} | ${it.join(', ').replace(/\|/g, '/')} |`);
  }
  const table = rows.length ? `### Class advancement\n\n| Level | You gain |\n| --- | --- |\n${rows.join('\n')}` : '';
  // The full per-feature text is appended in a post-pass (appendClassFeatureText), once
  // db.classFeatures is populated — it isn't yet when this runs during the classes loop.
  return head + (table ? `\n\n${table}` : '');
}

function ancestryStatBlock(s) {
  const parts = ['## Ancestry details'];
  parts.push(`**Hit Points** ${s.hp ?? '—'}`);
  parts.push(`**Size** ${capWord(SIZE[s.size] || 'medium')}`);
  parts.push(`**Speed** ${s.speed ?? '—'} feet`);
  const bt = boostSlotsText(boosts(s.boosts));
  if (bt) parts.push(`**Attribute Boosts** ${bt}`);
  const fl = flaws(s.flaws).map(abilName);
  if (fl.length) parts.push(`**Attribute Flaws** ${fl.join(', ')}`);
  const langs = (s.languages?.value || []).map(titleCase);
  const addl = s.additionalLanguages?.count || 0;
  parts.push(`**Languages** ${langs.join(', ') || '—'}${addl ? `; plus ${addl} + Intelligence modifier additional languages` : ''}`);
  parts.push(`**Senses** ${titleCase(s.vision || 'normal')}`);
  return parts.join('\n\n');
}

function deityStatBlock(s) {
  const parts = ['## Divine details'];
  const font = (s.font || []).map(capWord);
  if (font.length) parts.push(`**Divine Font** ${font.join(' or ')}`);
  const skill = (s.skill || []).map(titleCase);
  if (skill.length) parts.push(`**Divine Skill** ${skill.join(', ')}`);
  const wpn = (s.weapons || []).map(titleCase);
  if (wpn.length) parts.push(`**Favored Weapon** ${wpn.join(', ')}`);
  const dom = (s.domains?.primary || []).map(titleCase);
  const alt = (s.domains?.alternate || []).map(titleCase);
  if (dom.length) parts.push(`**Domains** ${dom.join(', ')}${alt.length ? ` (Alternate: ${alt.join(', ')})` : ''}`);
  if (s.sanctification && (s.sanctification.what || []).length) {
    parts.push(`**Sanctification** ${capWord(s.sanctification.modal || 'can')} be ${s.sanctification.what.map(capWord).join(' or ')}`);
  }
  const spells = s.spells && typeof s.spells === 'object'
    ? Object.entries(s.spells).sort((a, b) => Number(a[0]) - Number(b[0])).map(([r, v]) => `${ordinal(Number(r))}: ${String(v).split('.').pop()}`)
    : [];
  if (spells.length) parts.push(`**Cleric Spells** ${spells.join(', ')}`);
  return parts.length > 1 ? parts.join('\n\n') : '';
}

function backgroundStatBlock(s) {
  const parts = ['## Background details'];
  const bt = boostSlotsText(boosts(s.boosts));
  if (bt) parts.push(`**Attribute Boosts** ${bt}`);
  const skill = (s.trainedSkills?.value || [])[0];
  if (skill) parts.push(`**Trained Skill** ${titleCase(skill)}`);
  const lore = (s.trainedSkills?.lore || [])[0];
  if (lore) {
    // Source lore values can carry stray markdown (e.g. "**Boneyard Lore (...)") — drop any asterisks
    // before inserting, and only append " Lore" when the value isn't already a "… Lore" subject.
    const name = titleCase(String(lore).replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s*lore$/i, ''));
    parts.push(`**Lore** ${name}${/\blore\b/i.test(name) ? '' : ' Lore'}`);
  }
  const feat = Object.values(s.items || {})[0];
  if (feat) parts.push(`**Skill Feat** ${feat.name}`);
  return parts.length > 1 ? parts.join('\n\n') : '';
}

for (const e of readPack('ancestries')) {
  const s = e.system;
  (s.languages?.value || []).forEach((l) => langSet.add(l));
  db.ancestries[idOf(e)] = {
    id: idOf(e),
    name: e.name,
    traits: traitsOf(s),
    rarity: rarityOf(s),
    ...descWithBlock(s.description?.value, ancestryStatBlock(s)),
    source: sourceOf(e),
    hp: s.hp,
    size: SIZE[s.size] || 'medium',
    speeds: { land: s.speed },
    abilityBoosts: boosts(s.boosts),
    abilityFlaws: flaws(s.flaws),
    vision: s.vision || 'normal',
    languages: { granted: s.languages?.value || [], additional: s.additionalLanguages?.count || 0 },
    heritages: [],
    ...grantedStrikesField(s.rules, e.name),
  };
}

// Parse innate defenses (senses + IWR) from a Foundry rule-element array. Skips
// predicated (conditional) rules and dynamic/choice-based types we can't resolve
// statically. Resistance/Weakness `value` may be a level-formula string, resolved
// per-character in derive.ts.
function parseDefenses(rules) {
  const senses = [];
  const resistances = [];
  const weaknesses = [];
  const immunities = [];
  const speeds = {};
  for (const r of rules || []) {
    if (!r || r.predicate) continue;
    if (r.key === 'BaseSpeed') {
      // Only unconditional, numeric non-land speeds (fly/swim/climb/burrow). Predicated
      // (form-/toggle-gated) speeds are skipped above; land overrides and formula values
      // are dropped here. Normalize the occasional "fly-speed"-style selector.
      if (typeof r.selector !== 'string' || typeof r.value !== 'number') continue;
      const sel = r.selector.replace(/-speed$/, '');
      if (!['fly', 'swim', 'climb', 'burrow'].includes(sel)) continue;
      speeds[sel] = Math.max(speeds[sel] ?? 0, r.value);
    } else if (r.key === 'Sense') {
      if (typeof r.selector !== 'string' || r.selector.includes('{')) continue;
      const sense = { name: r.selector };
      if (typeof r.range === 'number') sense.range = r.range;
      if (typeof r.acuity === 'string') sense.acuity = r.acuity;
      senses.push(sense);
    } else if (r.key === 'Resistance' || r.key === 'Weakness') {
      if (typeof r.type !== 'string' || r.type.includes('{')) continue;
      const value =
        typeof r.value === 'number' ? r.value : typeof r.value === 'string' ? r.value : Number(r.value) || 0;
      (r.key === 'Resistance' ? resistances : weaknesses).push({ type: r.type, value });
    } else if (r.key === 'Immunity') {
      for (const t of Array.isArray(r.type) ? r.type : [r.type]) {
        if (typeof t === 'string' && !t.includes('{')) immunities.push(t);
      }
    }
  }
  const out = {};
  if (senses.length) out.senses = senses;
  if (resistances.length) out.resistances = resistances;
  if (weaknesses.length) out.weaknesses = weaknesses;
  if (immunities.length) out.immunities = immunities;
  if (Object.keys(speeds).length) out.speeds = speeds;
  return out;
}

/** Weapon critical specialization from a CriticalSpecialization rule element, made predicate-aware:
 *  - a `self:level >= N` gate becomes critSpecLevel (the effect only applies from level N);
 *  - weapon-narrowing tokens (item:group/trait/base, item:melee) become critSpecWeapons so the
 *    sheet only shows crit-spec for matching weapons;
 *  - a `feature:`/`feat:` prerequisite (e.g. monastic-weaponry needs expert-strikes) ⇒ DON'T flag,
 *    since we can't evaluate it (and the prerequisite feature usually grants crit-spec itself).
 *    A `proficiency:rank` gate is the normal "for weapons you're expert in" clause (Weapon
 *    Mastery/Expertise) — that's the core grant, so it's treated as satisfied, not a blocker.
 *  Returned as fields to spread onto the entry; {} when there's no (usable) grant. */
// A feat that raises max HP (Toughness/Mountain's Stoutness = +level; Thick Hide Mask = +20;
// Ghostly Resistance = -level). Returns { maxHpBonus: { perLevel?, flat? } } or {}. Dedication-count
// formulas (the Resiliency feats: "3 * @actor.flags…DedicationCount") are not yet supported.
function parseHpGrant(rules) {
  for (const r of rules || []) {
    if (!r || r.key !== 'FlatModifier' || r.selector !== 'hp') continue;
    const v = r.value;
    if (typeof v === 'number' && Number.isFinite(v)) return { maxHpBonus: { flat: v } };
    if (typeof v === 'string') {
      const s = v.replace(/\s+/g, '');
      const m = s.match(/^(-?\d*)\*?@actor\.level$/);
      if (m) {
        const c = m[1] === '' ? 1 : m[1] === '-' ? -1 : Number(m[1]);
        if (Number.isFinite(c)) return { maxHpBonus: { perLevel: c } };
      }
      if (/^-?\d+$/.test(s)) return { maxHpBonus: { flat: Number(s) } };
    }
  }
  return {};
}

function critSpecGrant(rules) {
  const rule = (rules || []).find((r) => r && r.key === 'CriticalSpecialization');
  if (!rule) return {};
  const pred = Array.isArray(rule.predicate) ? rule.predicate : null;
  if (!pred) return { critSpec: true }; // unconditional → all weapons, at the entry's own level
  let level = 0;
  const groups = [];
  const traits = [];
  const bases = [];
  let melee = false;
  let blocked = false; // a prerequisite we can't evaluate here
  const token = (t) => {
    if (typeof t !== 'string') return;
    if (t.startsWith('item:group:')) groups.push(t.slice('item:group:'.length));
    else if (t.startsWith('item:trait:')) traits.push(t.slice('item:trait:'.length));
    else if (t.startsWith('item:base:')) bases.push(t.slice('item:base:'.length));
    else if (t === 'item:melee') melee = true;
    else if (t.startsWith('feature:') || t.startsWith('feat:')) blocked = true;
  };
  const scan = (p) => {
    if (typeof p === 'string') token(p);
    else if (p && typeof p === 'object') {
      if (Array.isArray(p.gte)) {
        const [lhs, n] = p.gte;
        if (lhs === 'self:level' && typeof n === 'number') level = Math.max(level, n);
        // a proficiency-rank gate is the normal "weapons you're expert in" clause — ignore it.
      } else if (Array.isArray(p.or)) p.or.forEach(scan);
      else if (Array.isArray(p.and)) p.and.forEach(scan);
    }
  };
  pred.forEach(scan);
  if (blocked) return {};
  const out = { critSpec: true };
  if (level > 1) out.critSpecLevel = level;
  const w = {};
  if (groups.length) w.groups = groups;
  if (traits.length) w.traits = traits;
  if (bases.length) w.bases = bases;
  if (melee) w.melee = true;
  if (Object.keys(w).length) out.critSpecWeapons = w;
  return out;
}

/**
 * Extract MELEE unarmed Strike grants from a feat/feature's rule-element array (Foundry `Strike`
 * rule elements). Each becomes {name, die, damageType, traits, group, choiceValue?}. `choiceValue`
 * is the ChoiceSet option that gates the strike (e.g. Iruxi 'fangs'/'tail'); absent = unconditional.
 * Skips: fist-upgrades / no-die rules, dice-formula templates, and ranged/thrown attacks (the app's
 * deriveUnarmedStrike is melee-only — those are deferred). Returns undefined when nothing grants.
 */
function parseGrantedStrikes(rules, fallbackName) {
  const list = rules || [];
  const cs = list.find((r) => r && r.key === 'ChoiceSet' && r.rollOption);
  const ro = cs?.rollOption;
  const out = [];
  for (const r of list) {
    if (!r || r.key !== 'Strike') continue;
    const base = r.damage?.base;
    if (!base || typeof base.die !== 'string' || !base.die || base.die.includes('{')) continue;
    const rng = r.range;
    const ranged = typeof rng === 'number' ? rng > 0 : !!(rng && (rng.increment ?? rng.max));
    if (ranged) continue;
    let choiceValue;
    if (ro) {
      const toks = (JSON.stringify(r.predicate || []).match(/"([^"]+)"/g) || []).map((t) => t.slice(1, -1));
      const tok = toks.find((t) => t.startsWith(ro + ':'));
      if (tok) choiceValue = tok.slice(ro.length + 1);
    }
    const lbl = String(r.label || '');
    const name = /^PF2E\./.test(lbl)
      ? titleCase(lbl.split('.').pop())
      : lbl
        ? titleCase(lbl)
        : r.slug
          ? titleCase(r.slug)
          : fallbackName || 'Natural Attack';
    const g = {
      name,
      die: base.die,
      damageType: base.damageType || 'bludgeoning',
      traits: Array.isArray(r.traits) && r.traits.length ? r.traits : ['unarmed'],
      group: r.group || 'brawling',
    };
    if (choiceValue) g.choiceValue = choiceValue;
    out.push(g);
  }
  return out.length ? out : undefined;
}
function grantedStrikesField(rules, name) {
  const gs = parseGrantedStrikes(rules, name);
  return gs ? { grantedStrikes: gs } : {};
}

for (const e of readPack('heritages')) {
  const s = e.system;
  // Versatile Human: a ChoiceSet over level-1 GENERAL feats + a GrantItem of the selection. Detected
  // structurally so any future heritage with the same grant pattern picks it up too.
  const grantsGeneralFeat = (s.rules || []).some(
    (r) => r.key === 'ChoiceSet' && r.choices?.itemType === 'feat' && (r.choices.filter || []).includes('item:trait:general'),
  );
  db.heritages[idOf(e)] = {
    id: idOf(e),
    name: e.name,
    ancestryId: s.ancestry?.slug || null,
    versatile: !s.ancestry,
    ...(grantsGeneralFeat ? { grantsGeneralFeat: true } : {}),
    traits: traitsOf(s),
    rarity: rarityOf(s),
    ...descFields(s.description?.value),
    source: sourceOf(e),
    ...parseDefenses(s.rules),
    ...grantedStrikesField(s.rules, e.name),
    ...((() => {
      const innate = parseInnateSpells(s.rules, s.description?.value);
      return innate ? { innateSpells: innate } : {};
    })()),
  };
}

// The core skill ids, for conservative description parsing of backgrounds whose structured
// trainedSkills are empty upstream. Only these count as skills; "<Subject> Lore" is the lore.
const CORE_SKILL_IDS = new Set([
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation', 'medicine',
  'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery',
]);
/**
 * Fallback for backgrounds whose structured trainedSkills.value is EMPTY: recover the training from
 * the description's "Trained in …" clause. Two shapes:
 *  - a CHOICE ("your choice of Deception or Diplomacy", "either Arcana or Occultism",
 *    "Diplomacy, Performance, or Society") -> { choice: [skills…] }
 *  - a FIXED skill ("trained in the Crafting skill and the Architecture Lore skill") -> { skill }
 * The lore is the single unambiguous "<Subject> Lore" in the clause (skipped when the clause offers
 * several lores, or the subject is only described — "a Lore skill related to…"). Parenthesized
 * examples ("(such as Fire Lore)") are stripped first so they can't be mistaken for a grant.
 */
function parseBackgroundSkills(html) {
  const text = String(html || '')
    .replace(/@UUID\[[^\]]*\](?:\{([^}]*)\})?/g, '$1')
    .replace(/<[^>]+>/g, ' ');
  const m = text.match(/trained in[^.;]*/i);
  if (!m) return {};
  const clause = m[0].replace(/\([^)]*\)/g, ' ');
  const skills = [];
  for (const w of clause.matchAll(/\b([A-Z][a-z]+)\b(?!\s+Lore)/g)) {
    const id = w[1].toLowerCase();
    if (CORE_SKILL_IDS.has(id) && !skills.includes(id)) skills.push(id);
  }
  const lores = [...new Set([...clause.matchAll(/\b((?:[A-Z][A-Za-z'-]*\s+)*[A-Z][A-Za-z'-]*)\s+Lore\b/g)].map((x) => x[1]))];
  const out = {};
  if (skills.length >= 2 && /\bor\b/i.test(clause)) out.choice = skills;
  else if (skills.length >= 1) out.skill = skills[0];
  if (lores.length === 1) out.lore = slug(lores[0].replace(/\s*lore$/i, ''));
  return out;
}

let bgFallbackFixed = 0, bgFallbackChoice = 0;
for (const e of readPack('backgrounds')) {
  const s = e.system;
  const granted = Object.values(s.items || {})[0];
  const lore = (s.trainedSkills?.lore || [])[0];
  const structured = s.trainedSkills?.value || [];
  // Upstream gap: many backgrounds have empty structured trainedSkills — either because the training
  // is a player CHOICE (only expressed in prose) or because the data is simply missing. Recover both
  // from the description; a background with structured data is never second-guessed.
  const parsed = structured.length ? {} : parseBackgroundSkills(s.description?.value);
  if (parsed.skill) bgFallbackFixed++;
  if (parsed.choice) bgFallbackChoice++;
  db.backgrounds[idOf(e)] = {
    id: idOf(e),
    name: e.name,
    traits: traitsOf(s),
    rarity: rarityOf(s),
    ...descWithBlock(s.description?.value, backgroundStatBlock(s)),
    source: sourceOf(e),
    abilityBoosts: boosts(s.boosts),
    trainedSkill: structured[0] ?? parsed.skill,
    ...(parsed.choice ? { trainedSkillChoice: parsed.choice } : {}),
    trainedLore: lore ? slug(String(lore).replace(/\s*lore$/i, '')) : parsed.lore,
    grantedFeatId: granted ? slug(granted.name) : undefined,
  };
}
console.log(`backgrounds: description fallback recovered ${bgFallbackFixed} fixed skills, ${bgFallbackChoice} skill choices`);

// Collect subclass option features (Player Core) keyed by their otherTag.
// Subclass features reference their granted/curriculum spells in prose via @UUID;
// we capture all such refs and later keep only the ones that are focus spells.
const spellRefs = (html) =>
  [...String(html || '').matchAll(/@UUID\[Compendium\.pf2e\.spells-srd\.Item\.([^\]]+)\]/g)].map((m) => slug(m[1]));
const featRefs = (html) =>
  [...String(html || '').matchAll(/@UUID\[Compendium\.pf2e\.feats-srd\.Item\.([^\]]+)\]/g)].map((m) => slug(m[1]));
/**
 * Feats a subclass/extra-choice option grants WITH a restricted embedded sub-choice — e.g. an
 * Exemplar Dominion Epithet grants Energized Spark restricted to the dominion's two energy types.
 * Read from the option's rules: a GrantItem(feat) whose preselectChoices key matches a sibling
 * ChoiceSet's flag; restrictTo = that ChoiceSet's literal string choices. Returns [] if none.
 */
/** Sorcerer Draconic bloodline: the chosen dragon (exemplar) sets the spell tradition + the second
 *  bloodline skill (+ a flavor blood-magic damage type). Read from the 'dragonBloodline' ChoiceSet. */
const dragonChoices = (rules) => {
  const cs = (rules || []).find((r) => r.key === 'ChoiceSet' && r.flag === 'dragonBloodline');
  if (!cs) return undefined;
  const out = [];
  const seen = new Set();
  for (const ch of cs.choices || []) {
    const v = ch.value;
    if (!v?.slug || seen.has(v.slug)) continue;
    seen.add(v.slug);
    out.push({
      slug: v.slug,
      label: String(ch.label || '').replace(/^PF2E\.Dragon\./, '') || v.slug,
      tradition: v.tradition,
      skill: v.skill,
      damageType: v.damageType,
    });
  }
  return out.length ? out : undefined;
};
const grantedChoiceFeats = (rules) => {
  const out = [];
  for (const r of rules || []) {
    if (r.key !== 'GrantItem' || !r.preselectChoices) continue;
    const m = String(r.uuid || '').match(/feats-srd\.Item\.(.+)$/);
    if (!m) continue;
    const flag = Object.keys(r.preselectChoices)[0];
    const cs = (rules || []).find((x) => x.key === 'ChoiceSet' && x.flag === flag);
    const restrictTo = (cs?.choices || []).map((c) => (typeof c === 'string' ? c : c?.value)).filter((v) => typeof v === 'string');
    out.push({ featId: slug(m[1]), ...(restrictTo.length ? { restrictTo } : {}) });
  }
  return out;
};
/** Focus-pool points a feat grants: "gain a focus pool of N Focus Points" or
 *  "increase the number of Focus Points in your focus pool by N". Undefined if neither. */
function parseFocusPoolBonus(html) {
  const t = flat(cleanDesc(html));
  let m = /focus pool of (\d+) focus point/i.exec(t);
  if (m) return Number(m[1]);
  m = /increase the number of focus points in your focus pool by (\d+)/i.exec(t);
  if (m) return Number(m[1]);
  // Gaining a focus spell from an archetype/feat grants a focus point too (the app caps the pool at
  // 3 and counts sources). Match an explicit GRANT of a focus-category spell (not a comparison).
  if (/\byou (?:gain|learn)\b[^.]{0,50}\b(?:devotion|focus|domain|conflux|revelation|order|school|mystery|bloodline)\b[^.]{0,15}\bspells?\b/i.test(t)) return 1;
  return undefined;
}
const subclassTags = new Set(Object.values(SUBCLASS).map((s) => s.tag));
// Per-class choices made IN ADDITION to the single subclass (psychic's subconscious
// mind now; animist apparitions / exemplar ikons / kineticist elements added with
// those classes). pickByLevel = cumulative count allowed by character level.
const EXTRA_CHOICES = {
  psychic: [{ id: 'subconscious-mind', name: 'Subconscious Mind', tag: 'psychic-subconscious-mind', pickByLevel: { 1: 1 } }],
  // Exemplar: 3 ikons at L1 (a 4th via the Additional Ikon feat — not auto), plus an
  // epithet gained at 3rd, 7th and 15th. No spellcasting.
  exemplar: [
    { id: 'ikon', name: 'Ikons', tag: 'exemplar-ikon', pickByLevel: { 1: 3 } },
    { id: 'root-epithet', name: 'Root Epithet', tag: 'exemplar-root-epithet', pickByLevel: { 3: 1 } },
    { id: 'dominion-epithet', name: 'Dominion Epithet', tag: 'exemplar-dominion-epithet', pickByLevel: { 7: 1 } },
    { id: 'sovereignty-epithet', name: 'Sovereignty Epithet', tag: 'exemplar-sovereignty-epithet', pickByLevel: { 15: 1 } },
  ],
  // Kineticist: the Kinetic Gate chooses 1 element (single gate) or 2 (dual gate)
  // from the six. Impulses are element-traited feats (filtered in the feat picker).
  kineticist: [{ id: 'element', name: 'Kinetic Gate (elements)', tag: 'kineticist-kinetic-gate', pickByLevel: { 1: 2 } }],
  // Animist: attune to apparitions (2 at L1, 3 at L7, 4 at L15); each grants a
  // spontaneous spell repertoire (its spell ladder) cast from the apparition pool.
  animist: [{ id: 'apparition', name: 'Apparitions', tag: 'animist-apparition', pickByLevel: { 1: 2, 7: 3, 15: 4 } }],
  // Thaumaturge: choose 3 different implements — one at L1, a second at L5, a third at L15.
  // (Modeled as a multi-pick rather than a single subclass; the adept/paragon designations at
  // L7/L17 are a further refinement not yet surfaced.)
  thaumaturge: [{ id: 'implement', name: 'Implements', tag: 'thaumaturge-implement', pickByLevel: { 1: 1, 5: 2, 15: 3 } }],
  // Wizard: Arcane Thesis is a single level-1 pick of one methodology (alongside the Arcane School subclass).
  wizard: [{ id: 'thesis', name: 'Arcane Thesis', tag: 'wizard-arcane-thesis', pickByLevel: { 1: 1 } }],
};
// Tags whose options grant a spell ladder added to the caster's repertoire/known list.
// Subclass tags whose option feature adds bonus spells to the caster's repertoire/known list
// (the spells named in the option's prose). Focus spells are filtered out of this set in
// resolveOptionFocus so a bloodline/mystery/order focus spell doesn't also land in the repertoire.
const GRANTED_SPELL_TAGS = new Set([
  'psychic-conscious-mind',
  'animist-apparition',
  'sorcerer-bloodline', // Sorcerous Gifts (cantrip + 1st–9th)
  'oracle-mystery', // mystery Granted Spells
  'bard-muse', // muse-granted repertoire spell
]);
// Subclass tags whose option grants a fixed bonus FEAT named in its prose (bard muse feat,
// cleric doctrine grants, druid order feat). build.ts auto-grants those without a sub-choice.
const SUBCLASS_FEAT_TAGS = new Set(['bard-muse', 'cleric-doctrine', 'druid-order']);
// Actions a class grants but doesn't list in its items[] (granted by feature rules).
// Surfaced as features so they appear on the sheet. Slugs come from the actions pack.
const GRANTED_ACTIONS = {
  kineticist: [
    { level: 1, featureId: 'elemental-blast' },
    { level: 1, featureId: 'base-kinesis' },
    { level: 1, featureId: 'channel-elements' },
  ],
};
const extraTags = new Set(Object.values(EXTRA_CHOICES).flat().map((c) => c.tag));
const allOptionTags = new Set([...subclassTags, ...extraTags]);
const optionsByTag = {};
let bardCompositionRefs = [];
let summonerLinkRefs = [];
for (const e of readPack('class-features')) {
  if (idOf(e) === 'composition-spells') bardCompositionRefs = spellRefs(e.system.description?.value);
  // A summoner's link spells (Boost Eidolon, Evolution Surge) are focus spells
  // granted by the link; the spell entries lack the 'focus' trait (they're cantrip/
  // summoner) so capture the refs directly rather than via the focus filter.
  if (idOf(e) === 'link-spells') summonerLinkRefs = spellRefs(e.system.description?.value);
  for (const t of e.system?.traits?.otherTags || []) {
    if (!allOptionTags.has(t)) continue;
    // Fixed trained skills are AELike rules on system.skills.<skill>.rank (the
    // templated choice path has braces, so [a-z]+ excludes it).
    const skills = [
      ...new Set(
        (e.system.rules || [])
          .filter((r) => r.key === 'ActiveEffectLike' && /^system\.skills\.[a-z]+\.rank$/.test(r.path || ''))
          .map((r) => r.path.split('.')[2]),
      ),
    ];
    const keystone = SUBCLASS_KEYSTONE[idOf(e)] || {};
    const grants = {};
    if (skills.length) grants.skills = skills;
    if (keystone.weapons) grants.weapons = keystone.weapons;
    if (keystone.armor) grants.armor = keystone.armor;
    const { text: desc, refs: descR } = cleanDescRich(e.system.description?.value);
    // A subclass that sets the caster's tradition encodes it authoritatively as a
    // `...tradition:<name>` RollOption (sorcerer bloodlines) or names it in prose:
    // witch patrons as "Spell List <name>", sorcerer Draconic as "Tradition <name>"
    // (its rule is a per-dragon choice). Fall back to the hand-mapped witch patrons.
    const tradFromRules = (e.system.rules || [])
      .map((r) => (JSON.stringify(r).match(/tradition:(arcane|divine|occult|primal)/i) || [])[1])
      .find(Boolean);
    const tradFromDesc = (flat(desc).match(/(?:Spell List|Tradition)\s+(arcane|divine|occult|primal)\b/i) || [])[1];
    (optionsByTag[t] ??= []).push({
      id: idOf(e),
      name: e.name,
      description: desc,
      ...(descR.length ? { descRefs: descR } : {}),
      tradition:
        (tradFromRules || tradFromDesc)?.toLowerCase() ?? PATRON_TRADITION[idOf(e)],
      // Psychic subconscious mind sets the spellcasting key ability (Int or Cha); a few options
      // (Way of the Spellshot) set it via a FlatModifier the importer can't read, so hand-map those.
      keyAbility: (KEY_ABILITY_IGNORE.has(idOf(e)) ? undefined : e.system.subfeatures?.keyOptions?.[0]) ?? SUBCLASS_KEY_ABILITY[idOf(e)],
      // PC2: a rogue racket makes the key attribute a CHOICE between the racket's attribute and
      // Dexterity (a Dex Ruffian is legal). Also surface any genuinely multi-valued keyOptions.
      // First entry = the default when the player hasn't picked (the racket's own attribute).
      ...((() => {
        const raw = KEY_ABILITY_IGNORE.has(idOf(e)) ? [] : e.system.subfeatures?.keyOptions ?? [];
        const opts = t === 'rogue-racket' && raw.length ? [...new Set([...raw, 'dex'])] : [...new Set(raw)];
        return opts.length > 1 ? { keyAbilityOptions: opts } : {};
      })()),
      // Psychic conscious mind grants a spell ladder to the repertoire.
      grantedSpells: GRANTED_SPELL_TAGS.has(t) ? spellRefs(e.system.description?.value) : undefined,
      grantedFeats: SUBCLASS_FEAT_TAGS.has(t) ? featRefs(e.system.description?.value) : undefined,
      _grantedChoiceFeats: grantedChoiceFeats(e.system.rules),
      ...((() => {
        const dc = dragonChoices(e.system.rules);
        return dc ? { dragonChoice: dc } : {};
      })()),
      _focusRefs: spellRefs(e.system.description?.value),
      grants: Object.keys(grants).length ? grants : undefined,
    });
  }
}

for (const e of readPack('classes')) {
  const s = e.system;
  const id = idOf(e);
  const sc = SPELLCASTING[id];
  const sub = SUBCLASS[id];
  const subOptions = sub ? (optionsByTag[sub.tag] || []).sort((a, b) => a.name.localeCompare(b.name)) : [];
  const extraChoices = (EXTRA_CHOICES[id] || [])
    .map((g) => ({
      id: g.id,
      name: g.name,
      pickByLevel: g.pickByLevel,
      options: (optionsByTag[g.tag] || []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((g) => g.options.length);
  const key = s.keyAbility?.value || [];
  db.classes[id] = {
    id,
    name: e.name,
    traits: traitsOf(s),
    rarity: rarityOf(s),
    ...descWithBlock(s.description?.value, classStatBlock(s)),
    source: sourceOf(e),
    keyAbility: key,
    hpPerLevel: s.hp,
    perception: rank(s.perception),
    saves: {
      fortitude: rank(s.savingThrows?.fortitude),
      reflex: rank(s.savingThrows?.reflex),
      will: rank(s.savingThrows?.will),
    },
    attacks: {
      unarmed: rank(s.attacks?.unarmed),
      simple: rank(s.attacks?.simple),
      martial: rank(s.attacks?.martial),
      advanced: rank(s.attacks?.advanced),
    },
    // Weapon-GROUP proficiency from the class's "other" attack entry (alchemist bombs, gunslinger
    // firearms) — these signature weapons would otherwise derive at the wrong (martial) category rank.
    ...((() => {
      const o = s.attacks?.other;
      if (!o?.name || !(o.rank > 0)) return {};
      const nm = o.name.toLowerCase();
      const g = {};
      if (nm.includes('bomb')) g.bomb = rank(o.rank);
      if (nm.includes('firearm')) g.firearm = rank(o.rank);
      if (nm.includes('crossbow')) g.crossbow = rank(o.rank);
      return Object.keys(g).length ? { attackGroups: g } : {};
    })()),
    defenses: {
      unarmored: rank(s.defenses?.unarmored),
      light: rank(s.defenses?.light),
      medium: rank(s.defenses?.medium),
      heavy: rank(s.defenses?.heavy),
    },
    classDc: 'trained',
    // A multi-skill `value` WITH a `custom` lore (only the thaumaturge) means "trained in ONE of these"
    // + the named Lore — NOT all of them. Encode it as a restricted choice so it doesn't over-grant.
    trainedSkills: (() => {
      const ts = s.trainedSkills || {};
      const value = ts.value || [];
      const isChoice = !!ts.custom && value.length > 1;
      return {
        fixed: isChoice ? [] : value,
        additional: ts.additional || 0,
        ...(isChoice ? { choice: value } : {}),
        ...(ts.custom ? { lore: slug(String(ts.custom).replace(/\s+lore$/i, '')) } : {}),
      };
    })(),
    features: [
      ...Object.values(s.items || {}).map((it) => {
        // Foundry stores the real feature under the @UUID target name (…classfeatures.Item.<Name>),
        // which sometimes differs from the display name in items[]. Prefer the UUID target so the
        // featureId resolves in db.classFeatures (skip raw 16-char Foundry ids — those aren't names).
        const seg = (String(it.uuid || '').match(/classfeatures\.Item\.(.+)$/) || [])[1];
        const fromUuid = seg && !/^[A-Za-z0-9]{16}$/.test(seg) ? slug(seg) : null;
        const base = fromUuid || slug(it.name);
        return { level: it.level || 1, featureId: FEATURE_ID_ALIAS[base] ?? FEATURE_ID_ALIAS[slug(it.name)] ?? base };
      }),
      // Actions granted by class features (not listed in class items[]) — surfaced as features.
      ...(GRANTED_ACTIONS[id] || []),
    ],
    // Per-class progression lives in the source (classFeatLevels etc.); fall back to
    // the standard table only if a class is missing it.
    featProgression: {
      class: s.classFeatLevels?.value || FEAT_PROGRESSION.class,
      skill: s.skillFeatLevels?.value || FEAT_PROGRESSION.skill,
      general: s.generalFeatLevels?.value || FEAT_PROGRESSION.general,
      ancestry: s.ancestryFeatLevels?.value || FEAT_PROGRESSION.ancestry,
    },
    skillIncreaseLevels: s.skillIncreaseLevels?.value || [3, 5, 7, 9, 11, 13, 15, 17, 19],
    spellcasting: sc
      ? { type: sc.type, tradition: sc.tradition, keyAbility: sc.keyAbility || key[0] || 'wis', repertoire: sc.repertoire, progression: sc.progression }
      : undefined,
    subclass: sub && subOptions.length ? { name: sub.name, options: subOptions } : undefined,
    extraChoices: extraChoices.length ? extraChoices : undefined,
  };
}

for (const e of readPack('class-features')) {
  const s = e.system;
  const ot = s.traits?.otherTags || [];
  db.classFeatures[idOf(e)] = {
    id: idOf(e),
    name: e.name,
    traits: traitsOf(s),
    rarity: rarityOf(s),
    ...descFields(s.description?.value),
    source: sourceOf(e),
    level: s.level?.value || 1,
    actionCost: featCost(s),
    // Inventor modifications are class-features tagged by innovation type (e.g. armor-innovation-
    // modification); the tier is the item level (1/7/15). Keep the tags so they're selectable.
    ...(ot.length ? { otherTags: ot } : {}),
    ...parseDefenses(s.rules),
    ...critSpecGrant(s.rules),
    ...grantedStrikesField(s.rules, e.name),
  };
}

// Class-granted ACTIONS (Elemental Blast, Channel Elements, Base Kinesis, …) live in
// the `actions` pack, not class-features. Import them as features so a class's
// signature actions resolve + display. Don't clobber a same-slug real feature.
for (const e of readPack('actions/class')) {
  const s = e.system;
  const id = idOf(e);
  if (db.classFeatures[id]) continue;
  db.classFeatures[id] = {
    id,
    name: e.name,
    traits: traitsOf(s),
    rarity: rarityOf(s),
    ...descFields(s.description?.value),
    source: sourceOf(e),
    level: s.level?.value || 1,
    actionCost: featCost(s),
    ...parseDefenses(s.rules),
  };
}

// AoN-style full class pages: now that db.classFeatures is populated, append each class feature's
// full text (in level order) to the class description, merging the features' cross-references so
// links keep working. (Done as a post-pass because db.classFeatures isn't ready during the classes loop.)
for (const cls of Object.values(db.classes)) {
  const seen = new Set();
  const sections = [];
  const refs = [...(cls.descRefs || [])];
  for (const f of (cls.features || []).slice().sort((a, b) => a.level - b.level)) {
    if (seen.has(f.featureId)) continue;
    seen.add(f.featureId);
    const def = db.classFeatures[f.featureId];
    if (!def || !def.description) continue;
    sections.push(`### ${def.name} (Level ${f.level})\n\n${def.description}`);
    for (const r of def.descRefs || []) refs.push(r);
  }
  if (sections.length) {
    cls.description = `${cls.description || ''}\n\n## Class features\n\n${sections.join('\n\n')}`;
    const seenR = new Set();
    cls.descRefs = refs.filter((r) => {
      const k = `${r.key}|${(r.label || '').toLowerCase()}`;
      if (seenR.has(k)) return false;
      seenR.add(k);
      return true;
    });
  }
}

// Walk feat paths (not readPack) so we can read the archetype each feat belongs to:
// archetype feats live under feats/archetype/<archetype-slug>/, the only place that grouping
// is recorded (the feat JSON itself doesn't name its archetype).
for (const fp of walk(join(ROOT, 'feats'))) {
  const e = JSON.parse(readFileSync(fp, 'utf8'));
  const s = e.system;
  const archMatch = fp.match(/[/\\]feats[/\\]archetype[/\\]([^/\\]+)[/\\]/);
  const feat = {
    id: idOf(e),
    name: e.name,
    level: s.level?.value || 1,
    category: s.category || 'class',
    traits: traitsOf(s),
    rarity: rarityOf(s),
    ...descFields(s.description?.value),
    source: sourceOf(e),
    prerequisites: (s.prerequisites?.value || []).map((p) => p.value).filter(Boolean),
    actionCost: featCost(s),
    choice: featChoice(s),
    _focusRefs: spellRefs(s.description?.value),
    focusPoolBonus: parseFocusPoolBonus(s.description?.value),
    ...parseDefenses(s.rules),
    ...critSpecGrant(s.rules),
    ...grantedStrikesField(s.rules, e.name),
    ...parseHpGrant(s.rules),
    ...(archMatch ? { archetype: archMatch[1] } : {}),
    ...((() => {
      const innate = parseInnateSpells(s.rules, s.description?.value);
      return innate ? { innateSpells: innate } : {};
    })()),
  };
  // Two DISTINCT feats can slug-collide (e.g. the Knight Vigilant archetype "Keep Up the Good Fight"
  // vs the Guardian class feat). Don't let one silently clobber the other: qualify the archetype
  // feat's id with its archetype so both survive (the picker still filters archetype feats by tag).
  const existing = db.feats[feat.id];
  if (existing) {
    if (feat.archetype) {
      feat.id = `${feat.id}-${feat.archetype}`;
    } else if (existing.archetype) {
      existing.id = `${existing.id}-${existing.archetype}`;
      db.feats[existing.id] = existing;
    }
  }
  db.feats[feat.id] = feat;
}

// Pick the primary damage/heal entry's key + dice formula from system.damage (for upcast scaling).
// Skips non-dice formulas ("1", "@item.rank"). Returns { key, formula, kind } or null.
function primaryDamage(dmg) {
  if (!dmg || typeof dmg !== 'object') return null;
  const keys = Object.keys(dmg);
  if (!keys.length) return null;
  const key = keys.find((k) => (dmg[k]?.kinds || []).some((x) => x === 'damage' || x === 'healing')) || keys[0];
  const formula = String(dmg[key]?.formula || '').trim();
  if (!/d\d/.test(formula)) return null;
  return { key, formula, kind: (dmg[key]?.kinds || []).includes('healing') ? 'healing' : 'damage' };
}
// Normalize system.heightening → { type:'interval', interval, damageIncr?, areaIncr? } | { type:'fixed', levels }.
function normHeightening(h, primaryKey) {
  if (!h || !h.type) return undefined;
  if (h.type === 'interval') {
    const out = { type: 'interval', interval: h.interval === 2 ? 2 : 1 };
    if (h.damage) {
      const k = primaryKey != null && h.damage[primaryKey] != null ? primaryKey : h.damage['0'] != null ? '0' : Object.keys(h.damage)[0];
      const incr = String(h.damage[k] ?? '').trim();
      if (incr) out.damageIncr = incr;
    }
    if (typeof h.area === 'number' && h.area > 0) out.areaIncr = h.area;
    return out.damageIncr || out.areaIncr ? out : undefined;
  }
  if (h.type === 'fixed') {
    const levels = {};
    for (const [rank, body] of Object.entries(h.levels || {})) {
      const lv = {};
      if (body.damage) {
        const pd = primaryDamage(body.damage);
        if (pd) lv.damage = pd.formula;
      }
      if (body.area?.value != null) lv.area = Number(body.area.value);
      if (body.range?.value) lv.range = String(body.range.value);
      if (body.target?.value) lv.target = String(body.target.value);
      if (body.duration?.value) lv.duration = String(body.duration.value);
      if (Object.keys(lv).length) levels[rank] = lv;
    }
    return Object.keys(levels).length ? { type: 'fixed', levels } : undefined;
  }
  return undefined;
}

for (const e of readPack('spells')) {
  const s = e.system;
  const cantrip = traitsOf(s).includes('cantrip');
  const area = s.area ? `${s.area.value}-foot ${s.area.type}` : undefined;
  const pd = primaryDamage(s.damage);
  const heighten = normHeightening(s.heightening, pd?.key);
  db.spells[idOf(e)] = {
    id: idOf(e),
    name: e.name,
    rank: cantrip ? 0 : s.level?.value || 1,
    traditions: s.traits?.traditions || [],
    traits: traitsOf(s),
    rarity: rarityOf(s),
    ...descFields(s.description?.value),
    source: sourceOf(e),
    cast: spellCast(s.time?.value),
    range: s.range?.value || undefined,
    area,
    targets: s.target?.value || undefined,
    duration: s.duration?.value || undefined,
    save: s.defense?.save ? { type: s.defense.save.statistic, basic: !!s.defense.save.basic } : undefined,
    // Rituals: a tradition-less spell anyone can cast if they meet the primary-check proficiency.
    ...(s.ritual ? { ritual: true, ...(s.ritual.primary?.check ? { ritualPrimary: s.ritual.primary.check } : {}) } : {}),
    // Upcast scaling: structured base damage/area + the heightening increments (used to show "→ X" inline).
    ...(pd ? { baseDamage: pd.formula, damageKind: pd.kind } : {}),
    ...(typeof s.area?.value === 'number' ? { baseArea: { value: s.area.value, kind: s.area.type } } : {}),
    ...(heighten ? { heightening: heighten } : {}),
  };
}

// Foundry "specific magic items" (e.g. Hero's Plate, Splintering Spear, an Energized Shield)
// reference a plain base weapon/armor/shield via `system.baseItem` and OFTEN omit the base's core
// stat fields (damage / category / group / acBonus / dexCap / checkPenalty / hardness / hp) — those
// live only on the base item. Index every equipment entry by its slug so a specific item can inherit
// the base's stats; without this, deriveAc/deriveShield/deriveStrike see undefined → NaN AC / no Strike.
const EQUIP_PACK = readPack('equipment');
const baseItemBySlug = {};
for (const e of EQUIP_PACK) baseItemBySlug[e.system?.slug || slug(e.name)] = e;
/** The referenced base weapon/armor/shield for a specific magic item, if it resolves. */
const resolveBaseItem = (sys) => (sys?.baseItem ? baseItemBySlug[sys.baseItem] : undefined);
/** First defined value; treats null/undefined (and, for numbers, 0-as-placeholder handled by caller) as "missing". */
const pick = (...vals) => vals.find((v) => v !== undefined && v !== null);

for (const e of EQUIP_PACK) {
  const s = e.system;
  // A specific magic item's own `system` for stat fields the base defines; fall back to the base item's
  // system so category/damage/acBonus/hardness/hp are never dropped. Foundry stores base-derived hardness/hp
  // as 0 on the specific item, so a 0/absent value here means "inherit from base".
  const bs = resolveBaseItem(s)?.system;
  const id = idOf(e);
  const hands = s.usage?.value === 'held-in-two-hands' ? 2 : s.usage?.value === 'held-in-one-hand' ? 1 : undefined;
  const { text: desc, refs: descR } = cleanDescRich(s.description?.value);
  // Frequency/charge parsers scan prose, so feed them the flattened (un-markdown'd) text.
  const flatDesc = flat(desc);
  const freq = parseFrequency(flatDesc);
  const traits = traitsOf(s);
  const counters = buildCounters(flatDesc, traits, e.type === 'consumable' ? s.uses : undefined);
  const base = {
    id,
    name: e.name,
    level: s.level?.value || 0,
    price: s.price?.value || {},
    bulk: bulkVal(s.bulk),
    traits,
    rarity: rarityOf(s),
    description: desc,
    ...(descR.length ? { descRefs: descR } : {}),
    source: sourceOf(e),
    usage: s.usage?.value,
    ...(s.material?.type ? { material: { type: s.material.type, ...(s.material.grade ? { grade: s.material.grade } : {}) } } : {}),
    // Apex items: the attribute the item raises while invested (Belt of Giant Strength → str).
    ...(s.apex?.attribute ? { apexAttribute: s.apex.attribute } : {}),
    ...(freq ? { frequency: freq } : {}),
    ...(counters.length ? { counters } : {}),
    ...((() => {
      const a = parseActivationCost(s.description?.value);
      return a ? { activationCost: a } : {};
    })()),
    // Staff/wand/spellheart held spells (a magic-item spell source for the Spells tab).
    ...((() => {
      const held = traits.includes('staff')
        ? parseHeldSpells(s.description?.value)
        : traits.includes('spellheart')
          ? parseSpellheartSpells(s.description?.value)
          : traits.includes('wand')
            ? parseWandSpell(s, e.name) ?? parseHeldSpells(s.description?.value)
            : undefined;
      if (held) return { heldSpells: held };
      // A GENERIC scroll/wand ("Scroll of 3rd-rank Spell", "Magic Wand (3rd-rank spell)") holds a spell
      // the player picks. Flag it with a spellSlot {rank, traditions?} so the sheet can offer a picker.
      if (traits.includes('scroll') || traits.includes('wand')) {
        const m = String(e.name).match(/(\d+)(?:st|nd|rd|th)-rank/i);
        const rank = m ? Number(m[1]) : null;
        if (rank && rank >= 1 && rank <= 10) {
          const trads = traits.filter((t) => ['arcane', 'divine', 'occult', 'primal'].includes(t));
          return { spellSlot: { rank, ...(trads.length ? { traditions: trads } : {}) } };
        }
      }
      // A worn/held magic item (amulet, ring, cloak, mask, weapon, armor…) whose activation casts a
      // SPECIFIC named spell — phrased "Cast a Spell" or "You cast <spell>", the spell linked by @UUID
      // in the prose — is also a Spells-page source. The trait-based parsers above miss these because
      // they aren't staff/wand/spellheart; the cast-phrase gate keeps flavor spell-mentions out.
      if (/Cast a Spell|\bYou cast\b/i.test(String(s.description?.value || ''))) {
        const cast = parseSpellheartSpells(s.description?.value);
        if (cast) return { heldSpells: cast };
      }
      return {};
    })()),
  };
  if (e.type === 'weapon') {
    // A thrown weapon's range increment is often encoded only in a `thrown-N` trait
    // (e.g. dagger = thrown-10) rather than system.range; surface it so the weapon can
    // be used as a (Strength-based) ranged Strike.
    const thrownTrait = (base.traits ?? []).find((t) => /^thrown-\d+$/.test(t));
    const explicitRange = typeof s.range === 'number' ? s.range : s.range?.value || undefined;
    db.items[id] = {
      ...base,
      itemType: 'weapon',
      hands,
      category: pick(s.category, bs?.category),
      group: pick(s.group, bs?.group) || '',
      damage: {
        dice: pick(s.damage?.dice, bs?.damage?.dice) || 1,
        die: pick(s.damage?.die, bs?.damage?.die) || 'd4',
        type: pick(s.damage?.damageType, bs?.damage?.damageType) || 'untyped',
      },
      range: explicitRange ?? (thrownTrait ? Number(thrownTrait.split('-')[1]) : undefined) ?? (typeof bs?.range === 'number' ? bs.range : bs?.range?.value || undefined),
      reload: s.reload?.value != null && s.reload.value !== '' ? Number(s.reload.value) : undefined,
    };
  } else if (e.type === 'armor') {
    db.items[id] = {
      ...base,
      itemType: 'armor',
      category: pick(s.category, bs?.category),
      group: pick(s.group, bs?.group) || undefined,
      acBonus: pick(s.acBonus, bs?.acBonus) ?? 0,
      dexCap: pick(s.dexCap, bs?.dexCap),
      checkPenalty: pick(s.checkPenalty, bs?.checkPenalty),
      speedPenalty: pick(s.speedPenalty, bs?.speedPenalty),
      strength: pick(s.strength, bs?.strength),
    };
  } else if (e.type === 'shield') {
    // Foundry stores a specific magic shield's Hardness/HP as 0 (they live on the base shield), so a
    // 0/absent value inherits from the referenced base item — otherwise shields read 0 hardness / 0 HP.
    let hardness = (s.hardness || bs?.hardness) ?? 0;
    let hp = (s.hp?.max || bs?.hp?.max) ?? 0;
    let brokenThreshold = s.hp?.brokenThreshold || bs?.hp?.brokenThreshold || Math.floor(hp / 2);
    // A shield with a reinforcing rune (e.g. the Energized Shields) reads its base steel Hardness/HP in
    // Foundry; the rune's boost lives only in `system.hp.value`. Apply the reinforcing table so the
    // reinforced Hardness/HP/BT surface instead of the bare base steel 5/20.
    const reinf = REINFORCING_STATS[s.runes?.reinforcing];
    if (reinf) {
      hardness += reinf.hardness;
      hp += reinf.hp;
      brokenThreshold += reinf.bt;
    }
    db.items[id] = {
      ...base,
      itemType: 'shield',
      acBonus: (s.acBonus || bs?.acBonus) ?? 0,
      hardness,
      hp,
      brokenThreshold,
      speedPenalty: pick(s.speedPenalty, bs?.speedPenalty),
    };
  } else if (e.type === 'consumable') {
    db.items[id] = {
      ...base,
      itemType: 'consumable',
      consumableType: s.category || 'other',
      uses: s.uses ? { current: s.uses.value, max: s.uses.max } : undefined,
    };
  } else if (e.type === 'backpack') {
    db.items[id] = {
      ...base,
      itemType: 'container',
      bulk: s.bulk?.heldOrStowed ?? bulkVal(s.bulk),
      capacity: s.bulk?.capacity != null ? { bulk: s.bulk.capacity } : undefined,
      ignoredBulk: s.bulk?.ignored,
    };
  } else if (e.type === 'treasure') {
    db.items[id] = { ...base, itemType: 'treasure', value: s.price?.value || {} };
  } else {
    db.items[id] = { ...base, itemType: 'equipment' };
  }
  // Standalone runes (also kept as buyable equipment above) → the etchable-rune registry.
  if ((s.usage?.value || '').startsWith('etched-onto')) {
    const r = parseRune(id, e.name, s.usage.value, base.level, base.price);
    if (r) db.runes[id] = r;
  }
}

for (const e of readPack('deities')) {
  const s = e.system;
  db.deities[idOf(e)] = {
    id: idOf(e),
    name: e.name,
    traits: traitsOf(s),
    rarity: rarityOf(s),
    ...descWithBlock(s.description?.value, deityStatBlock(s)),
    source: sourceOf(e),
    domains: s.domains?.primary || [],
    divineFont: s.font || [],
    favoredWeapons: s.weapons || [],
    skill: (s.skill || [])[0],
  };
}

// Ancestry-referenced names are a fallback (rarity unknown → common); scripts/data/languages.json
// (the full current Archives of Nethys language set) is then authoritative for completeness + rarity.
for (const l of langSet) {
  const id = slug(l);
  if (!db.languages[id]) db.languages[id] = { id, name: l.charAt(0).toUpperCase() + l.slice(1), rarity: 'common' };
}
if (existsSync('scripts/data/languages.json')) {
  for (const l of JSON.parse(readFileSync('scripts/data/languages.json', 'utf8'))) {
    const id = slug(l.name);
    db.languages[id] = { id, name: l.name, rarity: l.rarity || 'common' };
  }
}

// Resolve focus spells: of the spells a subclass/class references in prose, keep only
// the ones that are actually focus spells (the order/school spell, the witch hex, the
// bard compositions) — the rest are curriculum or repertoire grants.
// Focus cantrips (hexes, compositions) carry the hex/composition trait, not focus,
// so recognize all three.
const isFocus = (s) => (s.traits || []).some((t) => t === 'focus' || t === 'hex' || t === 'composition');
const focusSet = new Set(
  Object.values(db.spells)
    .filter(isFocus)
    .map((s) => s.id),
);
const resolveOptionFocus = (o) => {
  // A subclass grants ONE initial focus spell (order spell / school spell / hex) at level 1;
  // its advanced/greater focus spells are feat-gated (Advanced/Greater Bloodline or Revelation).
  // The description lists them in order (initial -> advanced -> greater), so capture all three and
  // expose the feat-gated ones separately for the build engine to grant when the feat is taken.
  const fs = (o._focusRefs || []).filter((id) => focusSet.has(id));
  if (fs.length) o.focusSpells = fs.slice(0, 1);
  if (fs[1]) o.advancedFocusSpell = fs[1];
  if (fs[2]) o.greaterFocusSpell = fs[2];
  delete o._focusRefs;
  // Keep only granted repertoire spells that were imported AND aren't focus spells (a bloodline/
  // mystery/order focus spell is granted via focusSpells above, not added to the repertoire).
  if (o.grantedSpells) {
    o.grantedSpells = o.grantedSpells.filter((id) => db.spells[id] && !focusSet.has(id));
    if (!o.grantedSpells.length) delete o.grantedSpells;
  }
  if (o.grantedFeats) {
    o.grantedFeats = o.grantedFeats.filter((id) => db.feats[id]);
    if (!o.grantedFeats.length) delete o.grantedFeats;
  }
  // Granted choice-feats (Energized Spark on dominion epithets): keep only feats that imported AND
  // actually carry an embedded choice (so we can render the restricted sub-picker).
  if (o._grantedChoiceFeats?.length) {
    const kept = o._grantedChoiceFeats.filter((g) => db.feats[g.featId]?.choice);
    if (kept.length) o.grantedChoiceFeats = kept;
  }
  delete o._grantedChoiceFeats;
};
// Subclasses that grant a *restricted* skill choice (vs a fixed trained skill). The build engine
// shows a picker limited to these options instead of granting nothing.
const SUBCLASS_SKILL_CHOICE = {
  'way-of-the-pistolero': ['deception', 'intimidation'],
  'empiricism-methodology': ['arcana', 'crafting', 'occultism', 'society'], // Int-based skills
  'palatine-detective': ['occultism', 'religion'],
};
// Subclasses that force a deity choice even though the base class doesn't (rogue Avenger racket).
const SUBCLASS_REQUIRES_DEITY = new Set(['avenger']);
// Cleric Battle Creed replaces the full-caster table with the reduced two-rank "Battle Harbinger"
// progression and removes Resolute Faith + Miraculous Spell (verified against battle-creed.json's
// spells-per-day table and system.subfeatures.suppressedFeatures).
const SUBCLASS_SLOT_PROGRESSION = { 'battle-creed': 'two-rank' };
const SUBCLASS_SUPPRESSED_FEATURES = { 'battle-creed': ['resolute-faith', 'miraculous-spell'] };
for (const cls of Object.values(db.classes)) {
  for (const o of cls.subclass?.options || []) {
    if (SUBCLASS_SKILL_CHOICE[o.id]) o.skillChoice = SUBCLASS_SKILL_CHOICE[o.id];
    if (SUBCLASS_REQUIRES_DEITY.has(o.id)) o.requiresDeity = true;
    if (SUBCLASS_SLOT_PROGRESSION[o.id]) o.slotProgression = SUBCLASS_SLOT_PROGRESSION[o.id];
    if (SUBCLASS_SUPPRESSED_FEATURES[o.id]) o.suppressedFeatures = SUBCLASS_SUPPRESSED_FEATURES[o.id];
  }
  for (const o of cls.subclass?.options || []) resolveOptionFocus(o);
  for (const g of cls.extraChoices || []) for (const o of g.options) resolveOptionFocus(o);
}
// Feats that grant a fixed focus spell + a focus pool point (Blessed One → Lay on Hands, etc.):
// attach the single named focus spell when the feat also grants a pool (so it maps 1:1 to a point).
// Multi-ref/choice feats keep only the pool bonus; context-dependent grants resolve to nothing.
for (const f of Object.values(db.feats)) {
  const refs = (f._focusRefs || []).filter((id) => focusSet.has(id) && db.spells[id]);
  delete f._focusRefs;
  if (f.focusPoolBonus && refs.length === 1) {
    f.focusSpells = refs;
    delete f.focusPoolBonus; // counted via the granted spell to avoid double-counting the point
  } else if (f.focusPoolBonus == null) {
    delete f.focusPoolBonus;
  }
}
if (db.classes.bard) {
  // All bards get their composition cantrips at level 1.
  const fs = bardCompositionRefs.filter((id) => focusSet.has(id));
  if (fs.length) db.classes.bard.focusSpells = fs;
}
if (db.classes.summoner) {
  // Link spells are focus spells; keep only those actually imported as spells.
  const fs = summonerLinkRefs.filter((id) => db.spells[id]);
  if (fs.length) db.classes.summoner.focusSpells = fs;
}

// Familiar / master abilities (the familiar-abilities pack).
for (const e of readPack('familiar-abilities')) {
  const s = e.system;
  db.familiarAbilities[idOf(e)] = {
    id: idOf(e),
    name: e.name,
    kind: traitsOf(s).includes('master') ? 'master' : 'familiar',
    ...descFields(s.description?.value),
  };
}
// PF2e conditions (the conditions pack) — the browsable rules entries. `isValued`
// flags the ones that carry a numeric value (Frightened 2, Clumsy 1, …).
for (const e of readPack('conditions')) {
  const s = e.system;
  db.conditions[idOf(e)] = {
    id: idOf(e),
    name: e.name,
    ...descFields(s.description?.value),
    valued: !!s.value?.isValued,
    group: s.group ?? null,
  };
}
// Actions (the actions pack) — Strike, Seek, Demoralize, … Referenced constantly in
// other descriptions, so they're stored as navigable content for in-text links.
// Commander tactics are `action` items tagged by tier in traits.otherTags. The folio unlocks
// higher tiers at level 7/15/19, so record each tactic's tier (defaulting basic for AP tactics
// that ship without a tier tag). Suffix match also catches a known source typo (vcommander-…).
const tacticTier = (otherTags) => {
  for (const t of otherTags || []) {
    if (/-(mobility|offensive)-tactic$/.test(t)) return 'basic';
    if (/-expert-tactic$/.test(t)) return 'expert';
    if (/-master-tactic$/.test(t)) return 'master';
    if (/-legendary-tactic$/.test(t)) return 'legendary';
  }
  return 'basic';
};
for (const e of readPack('actions')) {
  if (e.type !== 'action') continue;
  const s = e.system;
  const cost = featCost(s);
  const traits = traitsOf(s);
  db.actions[idOf(e)] = {
    id: idOf(e),
    name: e.name,
    traits,
    rarity: rarityOf(s),
    ...descFields(s.description?.value),
    ...(cost ? { actionCost: cost } : {}),
    ...(traits.includes('tactic') ? { tacticTier: tacticTier(s.traits?.otherTags) } : {}),
    source: sourceOf(e),
  };
}
// Animal-companion per-type data (sourced from AoN, authored into this JSON) — the
// level/maturity scaling is a formula in src/rules/companions.ts.
if (existsSync('scripts/data/animal-companions.json')) {
  db.animalCompanions = JSON.parse(readFileSync('scripts/data/animal-companions.json', 'utf8'));
}
// Companion specializations, followers, and pets (authored JSON, like animal companions).
if (existsSync('scripts/data/companion-specializations.json')) {
  db.companionSpecializations = JSON.parse(readFileSync('scripts/data/companion-specializations.json', 'utf8'));
}
if (existsSync('scripts/data/followers.json')) {
  db.followers = JSON.parse(readFileSync('scripts/data/followers.json', 'utf8'));
}
if (existsSync('scripts/data/pets.json')) {
  db.pets = JSON.parse(readFileSync('scripts/data/pets.json', 'utf8'));
}
// Curated reference content the SRD bundle has no data for (hand-authored, not data-driven).
if (existsSync('scripts/data/services.json')) {
  db.services = JSON.parse(readFileSync('scripts/data/services.json', 'utf8'));
}
if (existsSync('scripts/data/vehicles.json')) {
  db.vehicles = JSON.parse(readFileSync('scripts/data/vehicles.json', 'utf8'));
}
if (existsSync('scripts/data/siege-weapons.json')) {
  db.siegeWeapons = JSON.parse(readFileSync('scripts/data/siege-weapons.json', 'utf8'));
}
// Stance mechanical effects (strike/AC/dexcap/speed), keyed by stance feat/action slug — extracted +
// verified from the Foundry stance descriptions (see scripts/data/stances.json). Stamp each with its
// id (slug) + name (from the source feat/action) so it's a self-describing content record.
db.stances = existsSync('scripts/data/stances.json')
  ? JSON.parse(readFileSync('scripts/data/stances.json', 'utf8'))
  : {};
for (const [slug, s] of Object.entries(db.stances)) {
  s.id = slug;
  s.name = db.feats[slug]?.name || db.actions[slug]?.name || slug.replace(/-/g, ' ');
}

// Additive content from `scripts/data/<category>-additions.json` (missing AoN entries mapped to the
// app's shape). Each file is an array; entries are merged into db[category] only when their id isn't
// already present — so the Foundry-derived base is never overwritten, just extended.
for (const f of readdirSync('scripts/data').filter((f) => f.endsWith('-additions.json'))) {
  const key = f.replace(/-additions\.json$/, '');
  if (!db[key] || typeof db[key] !== 'object') {
    console.warn(`[import-core] ${f}: no such category "${key}" — skipped`);
    continue;
  }
  let n = 0;
  for (const e of JSON.parse(readFileSync(`scripts/data/${f}`, 'utf8'))) {
    if (e && e.id && !db[key][e.id]) {
      // Skip broken ancestry stubs: a handful of versatile HERITAGES were authored here as "ancestries"
      // with hp:0 / no boosts and would show up as unbuildable ancestries. A real ancestry always has HP.
      // (They already exist correctly as versatile heritages.)
      if (key === 'ancestries' && !(e.hp > 0)) continue;
      db[key][e.id] = e;
      n++;
    }
  }
  if (n) console.log(`[import-core] +${n} → ${key} (from ${f})`);
}

// Backfill core stats on ADDED weapons/armor/shields. AoN-scraped additions (items-additions.json)
// arrive as description-only stubs with no damage / acBonus / hardness / hp — equipping one shows NaN
// AC / NaN shield or gives no Strike. When such an addition names a `baseItem` (a base weapon/armor/
// shield slug in the Foundry pack), inherit the base's stat fields; also guarantee every one of these
// items has a finite fallback so the sheet math can never see undefined. Existing (Foundry-derived)
// items already carry their stats, so this only touches items still missing them.
{
  let n = 0;
  for (const it of Object.values(db.items)) {
    // Only touch additions that either declare a `baseItem` to inherit from, or are a weapon/armor/shield
    // still missing its core stat field (a NaN-causing stub). Foundry-derived items already carry stats
    // and have no baseItem, so they're left untouched.
    const bs = it.baseItem ? baseItemBySlug[it.baseItem]?.system : undefined;
    if (it.itemType === 'weapon') {
      if (bs && !it.damage) {
        const d = bs.damage;
        if (d) it.damage = { dice: d.dice || 1, die: d.die || 'd4', type: d.damageType || 'untyped' };
      }
      if (bs) {
        if (it.category === undefined) it.category = bs.category;
        if (it.group === undefined || it.group === '') it.group = bs.group || '';
      }
      // Last-resort finite fallback so deriveStrike never sees a half-populated weapon.
      if (!it.damage) it.damage = { dice: 1, die: 'd4', type: 'untyped' };
      if (bs) n++;
    } else if (it.itemType === 'armor') {
      if (bs) {
        if (it.acBonus === undefined || it.acBonus === null) it.acBonus = bs.acBonus ?? 0;
        if (it.category === undefined) it.category = bs.category;
        if (it.group === undefined || it.group === null) it.group = bs.group;
        if (it.dexCap === undefined) it.dexCap = bs.dexCap;
        if (it.checkPenalty === undefined) it.checkPenalty = bs.checkPenalty;
        if (it.speedPenalty === undefined) it.speedPenalty = bs.speedPenalty;
        if (it.strength === undefined) it.strength = bs.strength;
        n++;
      }
      if (it.acBonus === undefined || it.acBonus === null) it.acBonus = 0;
    } else if (it.itemType === 'shield') {
      if (bs) {
        if (it.acBonus === undefined || it.acBonus === null || it.acBonus === 0) it.acBonus = bs.acBonus ?? it.acBonus ?? 0;
        if (!it.hardness) it.hardness = bs.hardness ?? 0;
        if (!it.hp) it.hp = bs.hp?.max ?? 0;
        if (it.brokenThreshold === undefined || it.brokenThreshold === null || it.brokenThreshold === 0)
          it.brokenThreshold = bs.hp?.brokenThreshold || Math.floor((it.hp || 0) / 2);
        n++;
      }
      if (it.acBonus === undefined || it.acBonus === null) it.acBonus = 0;
      if (it.hardness === undefined || it.hardness === null) it.hardness = 0;
      if (it.hp === undefined || it.hp === null) it.hp = 0;
      if (it.brokenThreshold === undefined || it.brokenThreshold === null)
        it.brokenThreshold = Math.floor((it.hp || 0) / 2);
    }
  }
  if (n) console.log(`[import-core] backfilled base stats on ${n} added weapons/armor/shields`);
}

// Targeted corrections to inaccurate existing entries (see scripts/data/fixes.json).
if (existsSync('scripts/data/fixes.json')) {
  let n = 0;
  for (const fix of JSON.parse(readFileSync('scripts/data/fixes.json', 'utf8'))) {
    const map = db[fix.category];
    const entry = map && (map[fix.id] || Object.values(map).find((e) => e.name === fix.name));
    if (entry && fix.field) {
      entry[fix.field] = fix.value;
      n++;
    }
  }
  if (n) console.log(`[import-core] applied ${n} content fixes`);
}

// Class sub-option additions (scripts/data/class-extras.json): inject sub-options that aren't
// represented in the curated Foundry clone — Investigator's Esoterica methodology, plus the
// Commander "Tactics" and Witch "Lessons" pick-by-level choice groups. `subclassOptions` extend a
// class's existing subclass.options; `extraChoices` append new groups. Existing options/groups
// (matched by id) are never overwritten.
if (existsSync('scripts/data/class-extras.json')) {
  const extras = JSON.parse(readFileSync('scripts/data/class-extras.json', 'utf8'));
  for (const [classId, spec] of Object.entries(extras)) {
    const cls = db.classes[classId];
    if (!cls) {
      console.warn(`[import-core] class-extras: no class "${classId}" — skipped`);
      continue;
    }
    if (spec.subclassOptions?.length && cls.subclass) {
      const have = new Set(cls.subclass.options.map((o) => o.id));
      const add = spec.subclassOptions.filter((o) => !have.has(o.id));
      if (add.length) {
        cls.subclass.options = [...cls.subclass.options, ...add].sort((a, b) => a.name.localeCompare(b.name));
        console.log(`[import-core] +${add.length} ${classId} ${cls.subclass.name} option(s)`);
      }
    }
    if (spec.extraChoices?.length) {
      cls.extraChoices = cls.extraChoices || [];
      const have = new Set(cls.extraChoices.map((g) => g.id));
      for (const g of spec.extraChoices) {
        if (!have.has(g.id)) {
          cls.extraChoices.push(g);
          console.log(`[import-core] +extraChoices "${g.name}" (${g.options.length} options) → ${classId}`);
        }
      }
    }
  }
}

// Feat embedded sub-choices (scripts/data/feat-choices.json): wire a ChoiceSet onto feats whose
// Foundry data didn't carry one — e.g. Basic/Greater/Major Lesson, which should let a witch pick
// which lesson (and its hex). Keyed by feat id → FeatChoiceDef.
if (existsSync('scripts/data/feat-choices.json')) {
  const fc = JSON.parse(readFileSync('scripts/data/feat-choices.json', 'utf8'));
  let n = 0;
  for (const [featId, choice] of Object.entries(fc)) {
    if (db.feats[featId]) {
      db.feats[featId].choice = choice;
      n++;
    } else {
      console.warn(`[import-core] feat-choices: no feat "${featId}" — skipped`);
    }
  }
  if (n) console.log(`[import-core] wired ${n} feat sub-choice(s)`);
}

mkdirSync('public', { recursive: true });
writeFileSync(OUT, JSON.stringify(db));
const counts = Object.fromEntries(Object.entries(db).map(([k, v]) => [k, Object.keys(v).length]));
const bytes = statSync(OUT).size;
console.log('Imported (all books):', JSON.stringify(counts, null, 1));
console.log(`-> ${OUT} (${(bytes / 1e6).toFixed(1)} MB)`);
