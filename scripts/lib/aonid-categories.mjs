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
    /*
     * The necromancer's four GRIM FASCINATIONS (Impossible Magic pg. 30 — AoN `grim-fascination-1..4`).
     * Pre-stamped, like the runesmith's runes below: the archive export predates the category and holds
     * no grim-fascination file at all, so the ids come from the page rather than from a name match.
     * Classified anyway so a later stamp into the WRONG bucket still fails — Blood, Bone, Flesh and
     * Spirit are each words that name other things in this data.
     */
    'grim-fascination',
    /* The necromancer's two FATAL METHODS (Impossible Magic pg. 29 — AoN `fatal-method-1..2`), the
     * subclass-option category that belongs beside `practice` and `mystery` above. They shipped as
     * bare subclass options with no classFeatures record at all — the 2 of 160 options that could not
     * be owned by anything — so this category had never been reachable from here. */
    'fatal-method',
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
  // The runesmith's 44 runes. These arrive PRE-STAMPED from the archive doc id
  // (`runesmith-rune-N`) rather than matched by name, because stamp-aonid.mjs reads the export and
  // the export has no runesmith-rune.json. Classified anyway, so a later stamp into the wrong bucket
  // still fails — `Runic Tattoo` is simultaneously a feat and an item, and `Sun-` collides with
  // nothing today only by luck.
  runesmithRune: ['runesmith-rune'],
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
/**
 * AoN CATEGORIES THE IMPORT EXPORT DOES NOT HAVE.
 *
 * The 93-file export this check resolves against is a snapshot; the pristine mirror at
 * `aon-2e-archive/data/by-category` is newer and has categories the export never saw. An id in one of
 * these resolves to no document, and the link is nonetheless correct — it was read off the page.
 *
 * Listed as CATEGORIES rather than as per-record quirks because the whole category is absent: naming
 * 44 runesmith runes one at a time would say "these 44 links are odd" when the truth is "this export
 * is one book behind". Each entry clears itself the next time the archive export is refreshed.
 *
 * ⚠ A category here still has to be in ALLOWED for its bucket — this waives "no document found", never
 * "pointed at the wrong kind of page".
 */
export const CATEGORY_ABSENT_FROM_EXPORT = new Set([
  'grim-fascination',  // Impossible Magic pg. 30 — the necromancer's four fascinations
  'fatal-method',      // Impossible Magic pg. 29 — the necromancer's two fatal methods
  'runesmith-rune',    // Impossible Magic pg. 55–61 — the 44 runes of the runic repertoire
]);

export const BUCKET_QUIRK = new Set([
  /*
   * NOT mis-bucketed — the LINK IS RIGHT and the DOCUMENT IS ABSENT FROM OUR MIRROR.
   *
   * The necromancer's four grim fascinations carry `grim-fascination-1..4`, read from
   * https://2e.aonprd.com/GrimFascinations.aspx (Impossible Magic pg. 30, AoN's own category slug is
   * `grim-fascination`, four entries, verified against the index and each `?ID=n` page). The archive
   * export this app imports from predates the category and has no grim-fascination file at all, so the
   * integrity check can resolve no document and would otherwise call four correct links hard failures.
   *
   * This clears itself the next time the archive is refreshed — see project memory on the AoN update
   * pipeline. Until then the ids are right and are the reason the four records exist at all.
   */
  'classFeatures/fascination-blood', 'classFeatures/fascination-bone',
  'classFeatures/fascination-flesh', 'classFeatures/fascination-spirit',

  /*
   * The yaoguai and tanuki Change Shape actions (batch 19) are PRINTED INSIDE their ancestry's
   * mechanics block — AoN has no standalone action page for either (the kitsune's, by contrast, is
   * action-701 and links there). The ancestry page IS the printed source, so the link is right and
   * the bucket difference is the quirk.
   */
  'actions/change-shape-yaoguai', 'actions/change-shape-tanuki',
  /* Batch 21's created background actions — each printed INSIDE its background's block, no
   * standalone action page exists: the two Season of Ghosts Seasonal Boons, the Tian Xia
   * merge-with-ward. The background page IS the printed source. */
  'actions/seasonal-boon', 'actions/seasonal-boon-folklore', 'actions/merge-with-ward',
  'actions/seasonal-boon-southbank', 'actions/seasonal-boon-outskirt', 'actions/seasonal-boon-northridge',
  // Batch 23 found the fifth Season of Ghosts boon (Close Ties) — same shape, same quirk.
  'actions/seasonal-boon-close-ties',

  /*
   * Same shape, same book: the necromancer's two FATAL METHODS carry `fatal-method-1..2` (Impossible
   * Magic pg. 29; AoN's own category slug is `fatal-method`, two entries — Puppeteer and Reaper —
   * and both documents are present in the pristine mirror at aon-2e-archive/data/by-category). It is
   * the 93-file EXPORT this check resolves against that predates the category, so the link is right
   * and no document can be found. Clears itself on the next archive refresh, like the four above.
   */
  'classFeatures/puppeteer', 'classFeatures/reaper',

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
