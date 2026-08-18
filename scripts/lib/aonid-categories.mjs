/*
 * WHICH AoN CATEGORIES MAY EACH core.json BUCKET POINT INTO?
 *
 * One definition, two readers:
 *   • scripts/migration/stamp-aonid.mjs  — refuses to WRITE an implausible aonId
 *   • scripts/aonid-integrity.mjs        — fails the build if one is PRESENT
 *
 * Shared deliberately. Two copies of a predicate like this drift, and the drift is invisible: the
 * checker would pass on exactly the links the stamper had just written.
 *
 * `aonId` is stamped by NAME, so a name shared by two unrelated things mis-stamps in silence:
 *
 *     items/coral    gemstone, 1 gp  ->  draconic-exemplar-8   (the Coral dragon)
 *     items/jet      gemstone, 1 gp  ->  familiar-ability-94   (the Jet familiar ability)
 *     items/sard     gemstone, 1 gp  ->  creature-792
 *
 * stamp-aonid.mjs already refused this for `subblock`/`table` matches, with the gems as its worked
 * example ("`Alabaster` is filed under the feat `Alabaster Eyes`"). Whole-document name matches
 * (`doc`/`scraped`) had no such guard, which is how these three got through.
 *
 * ⚠ NAMES ARE NOT THE TEST. Comparing a record's name to its page title reports ~140 false positives:
 * AoN's own typos that we already corrected (feat-5337 is "Camoflage Coat"), composed labels
 * ("Adept Benefit (Amulet)" -> the Amulet page), and family variants ("Lucky Coin (Lucky Gold)").
 * Category compatibility is the signal; the name is at best a hint.
 *
 * Every category below is one of the 93 real files in the export — none guessed. Guessing category and
 * bucket names is what manufactured ~500 phantom findings in earlier sweeps.
 */

/** Entries that look wrong and are correct, so nobody "tidies" them away. */
export const SURPRISING_BUT_CORRECT = `
  items -> feat            an ancestry item is documented ON the feat that grants it
                           (orc-warmask -> feat-2415, tengu-feather-fan -> feat-5685)
  items -> class-kit       the class kits are purchasable bundles
  items -> set-relic       a relic set is an item family
  items -> item-bonus      our own '-bonus-N' id IS a real document in item-bonus.json
  spells -> feat           champion litanies are focus spells whose page is the feat page
  actions -> tactic        the Battlecry commander tactics are actions on our side
  actions -> rules         Reload and Research live on a rules page, not their own entry
  classFeatures -> ikon    exemplar ikons are class features
  classFeatures -> class-sample   AoN files alchemist research fields (Bomber, Chirurgeon) here
  classFeatures -> sidebar Warden Spells is documented in a book sidebar
  familiarAbilities -> feat one feat page covers six variants (Elemental Familiar (Air/Earth/...))
  conditions -> trait      the cursebound rules live on the trait page
  heritages -> trait       AoN documents each versatile heritage on its trait page
`;

export const ALLOWED = {
  items: ['equipment', 'weapon', 'armor', 'shield', 'implement', 'ikon', 'siege-weapon', 'vehicle',
    'relic', 'set-relic', 'apparition', 'class-kit', 'feat', 'spell', 'campsite-meal', 'curse',
    'item-bonus'],
  itemBonus: ['equipment', 'weapon', 'armor', 'shield', 'item-bonus'],
  feats: ['feat', 'action', 'class-feature', 'skill', 'archetype', 'skill-general-action',
    'creature-ability'],
  spells: ['spell', 'ritual', 'feat', 'class-feature'],
  classFeatures: ['class-feature', 'class', 'class-sample', 'feat', 'implement', 'doctrine', 'bloodline',
    'mystery', 'lesson', 'muse', 'hunters-edge', 'racket', 'methodology', 'cause', 'instinct', 'domain',
    'patron', 'research-field', 'apparition', 'tenet', 'style', 'druidic-order', 'conscious-mind',
    'subconscious-mind', 'eidolon', 'deviant-ability-classification', 'ancestry', 'heritage',
    'arcane-school', 'arcane-thesis', 'hybrid-study', 'innovation', 'way', 'element', 'practice',
    'epithet', 'mythic-calling', 'tactic', 'draconic-exemplar', 'curse', 'hellknight-order',
    'ikon', 'archetype', 'action', 'creature', 'creature-ability', 'spell', 'plane', 'tradition',
    'rules', 'sidebar'],
  actions: ['action', 'feat', 'class-feature', 'skill', 'skill-general-action', 'creature-ability',
    'tactic', 'warfare-tactic', 'spell', 'rules'],
  conditions: ['condition', 'trait'],
  ancestries: ['ancestry'],
  heritages: ['heritage', 'ancestry', 'trait'],
  backgrounds: ['background'],
  deities: ['deity', 'deity-category', 'domain'],
  vehicles: ['vehicle', 'equipment'],
  siegeWeapons: ['siege-weapon', 'equipment', 'weapon'],
  familiarAbilities: ['familiar-ability', 'familiar-specific', 'feat', 'action'],
  animalCompanions: ['animal-companion', 'animal-companion-advanced', 'animal-companion-unique',
    'animal-companion-specialization', 'creature', 'creature-family'],
  companionSpecializations: ['animal-companion-specialization', 'animal-companion'],
  languages: ['language'],
  archetypes: ['archetype'],
  classes: ['class', 'class-sample'],
  rules: ['rules', 'source', 'trait', 'skill', 'sidebar', 'article'],
  // The archive-only buckets added by scripts/import-archive-buckets.mjs. Classified even though each
  // draws from exactly one category, so that a future stamp into the wrong one still fails.
  kingdomStructure: ['kingdom-structure'],
  kingdomEvent: ['kingdom-event'],
  creatureThemeTemplate: ['creature-theme-template'],
  creatureAdjustment: ['creature-adjustment'],
  categoryPage: null, // an index page legitimately points at any category
};

/**
 * MIS-BUCKETED, NOT MIS-LINKED.
 *
 * Each of these resolves outside its bucket's set and is still correct: the page really does describe
 * the record, and the record already holds that page's own prose. Only the bucket is odd, from an old
 * scrape. Listed one by one rather than widened into ALLOWED, so that a NEW item pointing at a creature
 * page still fails the check.
 *
 * They stay where they are because `src/data/index.ts` explains the cost of moving them: characters
 * store raw ids (inventory[].itemId, feats[].featId), and 149 of these `aon-` records are the only copy
 * of their content — so relocating or deleting them orphans saved characters.
 */
export const BUCKET_QUIRK = new Set([
  // animal companions and armour groups filed under items by an old scrape
  'items/aon-badger', 'items/aon-bat', 'items/aon-bird', 'items/aon-cat', 'items/aon-dinosaur',
  'items/aon-dog', 'items/aon-fish', 'items/aon-fox', 'items/aon-frog', 'items/aon-horse',
  'items/aon-lizard', 'items/aon-monkey', 'items/aon-rat', 'items/aon-snake', 'items/aon-spider',
  'items/aon-squirrel', 'items/aon-turtle',
  'items/aon-cloth', 'items/aon-leather',
  'items/wrecker',                                 // an animal-companion specialization

  // A familiar ability that costs an action is surfaced in `actions`. Verified on shadow-step: the
  // archive holds exactly ONE "Shadow Step" document and our prose is that ability's own text
  // ("The familiar teleports itself up to 30 feet"). Right content, right link, odd bucket.
  'actions/shadow-step',

  // Oracle mysteries / class features whose name is shared with a creature family, a disease or a
  // background. The record carries its own correct prose in every case.
  'classFeatures/sloth', 'classFeatures/fungal-rot',   // `warrior` removed: repointed to muse-8 (Bard Muse)

  // (Thaumaturge implements Lantern/Mirror were listed here as "only the id is off". They were NOT
  //  only the id: the ast came from the equipment page too, so the sheet showed "Price 1 gp, Hands 1"
  //  for a class feature. Repointed by fix-classfeature-pages.mjs, and this whitelist entry removed —
  //  the badge check in classfeature-page-check.mjs now guards them properly.)

  // Named vehicles / siege weapons sharing a name with a creature.
  'vehicles/bone-ship', 'siegeWeapons/ram',

  // Suppressed `aon-` duplicates — the canonical twin carries the correct link.
  'spells/aon-misdirection', 'spells/aon-dread-aura', 'items/aon-stone', 'items/aon-guide',
  'items/aon-adamantine', 'items/aon-angelic-vessel', 'items/aon-living-statue',
  'items/aon-fixer', 'items/aon-researcher', 'items/aon-transportation', 'items/aon-spellcasting',

  // Same name, different thing, but the prose we hold is the right one.
  'items/aerekostes', 'items/magical-medal-wolf-pack', 'items/chain-10-feet',
  'feats/phalanx-formation', 'actions/once-bitten',
  'familiarAbilities/animated', 'familiarAbilities/augury', 'familiarAbilities/medic',
]);

/** Our own synthetic suffix — `equipment-4957-4520-bonus-1651` is minted here, not by AoN. */
export const stripSynthetic = (aonId) => String(aonId).replace(/-bonus-\d+$/, '');

/**
 * May `bucket` legitimately link into `cat`? An unknown bucket returns true — this guard exists to
 * catch a wrong link, not to police buckets nobody has classified yet.
 */
export function linkIsPlausible(bucket, cat, id) {
  if (id && BUCKET_QUIRK.has(`${bucket}/${id}`)) return true;
  const allow = ALLOWED[bucket];
  if (allow === null) return true;   // explicitly "anything goes"
  if (allow === undefined) return true; // bucket not classified
  return allow.includes(cat);
}

/**
 * Build `aonId -> { cat, name }` over every category file in the export.
 *
 * ⚠ Read the files; do NOT derive the file from the id prefix. `category-page.json` keys its documents
 * as `equipment-category-1`, so prefix-derivation reported all 107 category pages as missing when every
 * one was present.
 */
export function buildDocIndex(exportDir, { readFileSync, readdirSync, join }) {
  const byId = new Map();
  for (const f of readdirSync(exportDir).filter((x) => x.endsWith('.json'))) {
    const cat = f.replace(/\.json$/, '');
    let docs;
    try { docs = JSON.parse(readFileSync(join(exportDir, f), 'utf8')).docs; } catch { continue; }
    for (const [id, doc] of Object.entries(docs ?? {})) {
      if (!byId.has(id)) byId.set(id, { cat, name: String(doc?.name ?? doc?.data?.name ?? '').trim() });
    }
  }
  return byId;
}

/** Resolve an aonId through the index, walking off our synthetic suffix and a variant tail. */
export function resolveDoc(byId, aonId) {
  const base = stripSynthetic(aonId);
  for (const cand of [aonId, base, base.replace(/-\d+$/, '')]) {
    const hit = byId.get(cand);
    if (hit) return { doc: hit, via: cand };
  }
  return { doc: null, via: null };
}
