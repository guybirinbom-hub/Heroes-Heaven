import type { Feat, Item, Spell } from '../rules/types';
import type { FilterSpec } from './FilterableSelect';
import {
  AREA_STOPS,
  BULK_STOPS,
  DAMAGE_DIE_STOPS,
  DURATION_STOPS,
  FEAT_LEVEL_STOPS,
  ITEM_LEVEL_STOPS,
  PRICE_STOPS,
  RANGE_STOPS,
  RANK_STOPS,
  WEAPON_RANGE_STOPS,
  parseDurationSeconds,
  parseFeet,
} from '../rules/filterValues';
import { coinsToCp } from '../rules/wealth';

const RARITY = [
  { id: 'common', label: 'Common' },
  { id: 'uncommon', label: 'Uncommon' },
  { id: 'rare', label: 'Rare' },
  { id: 'unique', label: 'Unique' },
];

/** Derive a spell's "type" (normal / focus / ritual). Rituals are flagged via `s.ritual`, not a trait. */
function spellType(s: Spell): string {
  if (s.ritual) return 'ritual';
  if (s.traits.includes('focus')) return 'focus';
  return 'normal';
}

/** The full spell filter set (matches the Add-Spell panel: chips + Rank/Range/Area/Duration sliders). */
export const SPELL_SPEC: FilterSpec<Spell> = {
  fields: [
    { id: 'desc', label: 'Description', kind: 'text', accessor: (s) => `${s.name}\n${s.description}`, placeholder: 'Any text in the name or description, e.g. “Strike”' },
    { id: 'rarity', label: 'Rarity', kind: 'chips', options: RARITY, accessor: (s) => s.rarity },
    { id: 'type', label: 'Spell type', kind: 'chips', options: [
      { id: 'normal', label: 'Normal' },
      { id: 'focus', label: 'Focus' },
      { id: 'ritual', label: 'Ritual' },
    ], accessor: (s) => spellType(s) },
    { id: 'tradition', label: 'Tradition', kind: 'chips', options: [
      { id: 'arcane', label: 'Arcane' },
      { id: 'divine', label: 'Divine' },
      { id: 'occult', label: 'Occult' },
      { id: 'primal', label: 'Primal' },
    ], accessor: (s) => s.traditions },
    { id: 'cast', label: 'Cast time', kind: 'castTime', accessor: (s) => s.cast },
    { id: 'defense', label: 'Defense', kind: 'chips', options: [
      { id: 'ac', label: 'vs AC' },
      { id: 'fortitude', label: 'Fortitude' },
      { id: 'reflex', label: 'Reflex' },
      { id: 'will', label: 'Will' },
    ], accessor: (s) => s.defense ?? s.save?.type ?? '' },
    { id: 'components', label: 'Components', kind: 'chips', options: [
      { id: 'verbal', label: 'Verbal' },
      { id: 'somatic', label: 'Somatic' },
      { id: 'material', label: 'Material' },
      { id: 'focus', label: 'Focus' },
    ], accessor: (s) => s.components ?? [] },
    { id: 'traits', label: 'Traits', kind: 'traits', accessor: (s) => s.traits },
    { id: 'rank', label: 'Rank', kind: 'range', stops: RANK_STOPS, magnitude: (s) => s.rank },
    { id: 'range', label: 'Range', kind: 'range', stops: RANGE_STOPS, magnitude: (s) => parseFeet(s.range) },
    { id: 'area', label: 'Area', kind: 'range', stops: AREA_STOPS, magnitude: (s) => parseFeet(s.area) },
    { id: 'duration', label: 'Duration', kind: 'range', stops: DURATION_STOPS, magnitude: (s) => parseDurationSeconds(s.duration) },
    { id: 'targets', label: 'Targets', kind: 'text', accessor: (s) => s.targets ?? '', placeholder: 'Any targets, e.g. “1 creature”' },
  ],
};

/** Spell filters for the builder/repertoire picker. Tradition is fixed by the caster, but the Rank
 *  slider is kept: a slot of rank N can hold any spell of rank ≤ N, so the list spans 1..N and the
 *  slider lets the player narrow to a specific rank. */
export const SPELL_SPEC_BUILDER: FilterSpec<Spell> = {
  fields: SPELL_SPEC.fields.filter((f) => f.id !== 'tradition'),
};

/** Sentinel trait pushed onto Service catalog entries (which are shaped as `equipment` Items) in
 *  AddItemsModal so itemCategories can route them to the "Services" chip. */
export const SERVICE_MARK = '__service';

/** The full AoN "Category" tokens for one item — an item can belong to several (a magic staff is
 *  Staves + Held Items; a precious weapon is Weapons + Materials). Every AoN equipment category is
 *  represented; a few (Blighted Boons, Customizations) have no reliable signal in the Foundry data
 *  and so stay empty — that's fine, empty chips just filter to nothing. Signals come from the item's
 *  own data: itemType, traits, usage, consumableType, and (where no token exists) the name. */
function itemCategories(i: Item): string[] {
  const c: string[] = [];
  const u = i.usage ?? '';
  const t = i.traits ?? [];
  const name = i.name ?? '';
  const has = (trait: string) => t.includes(trait);
  const ct = i.itemType === 'consumable' ? i.consumableType : undefined;

  // --- itemType-driven ---
  if (i.itemType === 'weapon') c.push('weapons');
  else if (i.itemType === 'armor') c.push('armor');
  else if (i.itemType === 'shield') c.push('shields');
  else if (i.itemType === 'consumable') c.push('consumables');
  else if (i.itemType === 'treasure') c.push('trade-goods');

  // --- trait-driven (each trait maps 1:1 to an AoN category) ---
  if (has('apex')) c.push('apex');
  if (has('snare')) c.push('snares');
  if (has('tattoo')) c.push('tattoos');
  if (has('spellheart')) c.push('spellhearts');
  if (has('staff')) c.push('staves');
  if (has('wand') || ct === 'wand') c.push('wands');
  if (has('grimoire')) c.push('grimoires');
  if (has('cursed')) c.push('cursed');
  if (has('intelligent')) c.push('intelligent');
  if (has('relic')) c.push('relics');
  if (has('artifact')) c.push('artifacts');
  if (has('censer')) c.push('censer');
  if (has('contract')) c.push('contracts');
  if (has('graft')) c.push('grafts');
  if (has('structure')) c.push('structures');
  if (has('adjustment')) c.push('adjustments');
  if (has('figurehead')) c.push('figurehead');
  if (has('companion')) c.push('animals-and-gear');
  if (has('alchemical')) c.push('alchemical');
  // High-Tech (Starfinder / Guns & Gears tech gear).
  if (has('tech') || has('spellgun')) c.push('high-tech');

  // --- material-driven ---
  if (i.material || has('precious')) c.push('materials');

  // --- usage-driven ---
  if (/^etched/.test(u)) c.push('runes');
  if (/^worn/.test(u)) c.push('worn-items');
  if (/^held-in/.test(u)) c.push('held-items');

  // --- name/usage-derived categories that have no dedicated Foundry trait ---
  // Banners: no `banner` trait; identified by the "affixed-or-held" battle-standard usage or name.
  if (/^affixed-or-held/.test(u) || /\bbanner\b/i.test(name)) c.push('banners');
  // Assistive Items (prosthetics and other assistive gear) — matched by name (no trait exists).
  if (/\bprosthe|prosthesis\b/i.test(name)) c.push('assistive');
  // Services (reference-only catalog rows tagged with the sentinel in AddItemsModal).
  if (has(SERVICE_MARK)) c.push('services');

  // Adventuring Gear: mundane general equipment/consumables not otherwise magical or categorized.
  // (worn/held generic gear, tools, kits, mundane consumables — anything without a magical signal.)
  if (
    (i.itemType === 'equipment' || i.itemType === 'consumable' || i.itemType === 'container') &&
    !has('magical') &&
    !has('invested') &&
    !has('artifact') &&
    !has('relic') &&
    !has('cursed') &&
    !has('intelligent') &&
    !has(SERVICE_MARK)
  ) {
    c.push('adventuring-gear');
  }

  // Catch-all so nothing falls through the filter entirely.
  if (c.length === 0) c.push('other');
  return c;
}

/* ---------------------------------------------------------------------------
 * Rich AoN weapon/armor facets. All derived from data already on the item
 * (itemType / category / group / usage / traits / range / damage), so nothing
 * has to be backfilled into core.json. The facets are declared unconditionally
 * on ITEM_SPEC; FilterableSelect's presence pass hides any whose options don't
 * occur in the catalog, so armor facets simply vanish once the list is all
 * weapons (and vice-versa), giving the "contextual" AoN feel for free.
 * ------------------------------------------------------------------------- */

/** Melee vs ranged. A weapon is Ranged when it has a range increment AND isn't a thrown melee
 *  weapon; thrown weapons (dagger, javelin) count as BOTH melee and ranged, as on AoN. */
function weaponHandedKinds(i: Item): string[] {
  if (i.itemType !== 'weapon') return [];
  const out: string[] = [];
  const thrown = (i.traits ?? []).some((t) => /^thrown/.test(t));
  const hasRange = typeof i.range === 'number' && i.range > 0;
  if (!hasRange || thrown) out.push('melee');
  if (hasRange) out.push('ranged');
  return out;
}

/** AoN "Hands" facet token for one item, sourced from the Foundry usage/traits (the numeric
 *  `hands` only distinguishes 1 vs 2). AoN uses: −1 = shields (held for the Raise reaction),
 *  0+ = worn items that occupy no hand, 1, 1 or 2 (a one-handed weapon usable two-handed via the
 *  `two-hand` trait for a bigger die), 1+ (a firearm/bow that needs a second hand to reload/fire),
 *  and 2. */
function itemHandsToken(i: Item): string {
  if (i.itemType === 'shield') return '-1';
  const u = i.usage ?? '';
  if (/one-plus-hands/.test(u)) return '1+';
  if (i.itemType === 'weapon') {
    if ((i.traits ?? []).some((t) => /^two-hand/.test(t))) return '1 or 2';
    if (i.hands === 2 || /two-hands/.test(u)) return '2';
    if (i.hands === 1 || /one-hand/.test(u)) return '1';
  }
  // Worn / held generic gear that occupies no hand.
  if (/^worn/.test(u) || i.hands === 0) return '0+';
  if (i.hands === 2) return '2';
  if (i.hands === 1) return '1';
  return '0+';
}

/** Die-face magnitude of a weapon's damage die (d8 → 8); non-weapons/dice-less → 1 (the low stop). */
function damageDieFaces(i: Item): number {
  if (i.itemType !== 'weapon') return 1;
  const die = i.damage?.die;
  const n = die ? Number(String(die).replace(/^d/, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** A weapon's damage type (bludgeoning/fire/…), as a single-element list; empty for non-weapons. */
function weaponDamageTypes(i: Item): string[] {
  if (i.itemType !== 'weapon') return [];
  const t = i.damage?.type;
  return t ? [t] : [];
}

/** Weapon range increment in feet (0 for melee / no increment). */
function weaponRangeFeet(i: Item): number {
  return i.itemType === 'weapon' && typeof i.range === 'number' ? i.range : 0;
}

/** Reload token for a weapon: 0 / 1 / 2 / "1 Minute" (reload 10 = the 1-minute muzzle-loaders). */
function weaponReloadToken(i: Item): string {
  if (i.itemType !== 'weapon' || i.reload == null) return '';
  if (i.reload >= 10) return 'min';
  return String(i.reload);
}

const ARMOR_CATEGORY_OPTS = [
  { id: 'unarmored', label: 'Unarmored' },
  { id: 'light', label: 'Light' },
  { id: 'medium', label: 'Medium' },
  { id: 'heavy', label: 'Heavy' },
];
const ARMOR_GROUP_OPTS = ['chain', 'cloth', 'composite', 'leather', 'plate', 'skeletal', 'wood'].map((g) => ({
  id: g,
  label: g[0].toUpperCase() + g.slice(1),
}));
const WEAPON_CATEGORY_OPTS = [
  { id: 'simple', label: 'Simple' },
  { id: 'martial', label: 'Martial' },
  { id: 'advanced', label: 'Advanced' },
  { id: 'ammunition', label: 'Ammunition' },
  { id: 'unarmed', label: 'Unarmed' },
];
const WEAPON_GROUP_OPTS = [
  'axe', 'bomb', 'bow', 'brawling', 'club', 'crossbow', 'dart', 'firearm', 'flail', 'hammer',
  'knife', 'pick', 'polearm', 'shield', 'sling', 'spear', 'sword',
].map((g) => ({ id: g, label: g[0].toUpperCase() + g.slice(1) }));

/** The item filter set (type/category/rarity/traits chips + Level/Price/Bulk sliders). */
export const ITEM_SPEC: FilterSpec<Item> = {
  fields: [
    { id: 'desc', label: 'Description', kind: 'text', accessor: (i) => `${i.name}\n${i.description}`, placeholder: 'Any text in the name or description' },
    { id: 'type', label: 'Item type', kind: 'chips', options: [
      { id: 'weapon', label: 'Weapons' },
      { id: 'armor', label: 'Armor' },
      { id: 'shield', label: 'Shields' },
      { id: 'consumable', label: 'Consumables' },
      { id: 'equipment', label: 'Gear' },
      { id: 'container', label: 'Containers' },
      { id: 'treasure', label: 'Treasure' },
    ], accessor: (i) => i.itemType },
    { id: 'category', label: 'Category', kind: 'chips', mode: 'any', accessor: (i) => itemCategories(i), options: [
      { id: 'adjustments', label: 'Adjustments' },
      { id: 'adventuring-gear', label: 'Adventuring Gear' },
      { id: 'alchemical', label: 'Alchemical Items' },
      { id: 'animals-and-gear', label: 'Animals and Gear' },
      { id: 'apex', label: 'Apex Items' },
      { id: 'armor', label: 'Armor' },
      { id: 'artifacts', label: 'Artifacts' },
      { id: 'assistive', label: 'Assistive Items' },
      { id: 'banners', label: 'Banners' },
      { id: 'blighted-boons', label: 'Blighted Boons' },
      { id: 'censer', label: 'Censer' },
      { id: 'consumables', label: 'Consumables' },
      { id: 'contracts', label: 'Contracts' },
      { id: 'cursed', label: 'Cursed Items' },
      { id: 'customizations', label: 'Customizations' },
      { id: 'figurehead', label: 'Figurehead' },
      { id: 'grafts', label: 'Grafts' },
      { id: 'grimoires', label: 'Grimoires' },
      { id: 'held-items', label: 'Held Items' },
      { id: 'high-tech', label: 'High-Tech' },
      { id: 'intelligent', label: 'Intelligent Items' },
      { id: 'materials', label: 'Materials' },
      { id: 'relics', label: 'Relics' },
      { id: 'runes', label: 'Runes' },
      { id: 'services', label: 'Services' },
      { id: 'shields', label: 'Shields' },
      { id: 'siege-weapons', label: 'Siege Weapons' },
      { id: 'snares', label: 'Snares' },
      { id: 'spellhearts', label: 'Spellhearts' },
      { id: 'staves', label: 'Staves' },
      { id: 'structures', label: 'Structures' },
      { id: 'tattoos', label: 'Tattoos' },
      { id: 'trade-goods', label: 'Trade Goods' },
      { id: 'vehicles', label: 'Vehicles' },
      { id: 'wands', label: 'Wands' },
      { id: 'weapons', label: 'Weapons' },
      { id: 'worn-items', label: 'Worn Items' },
      { id: 'other', label: 'Other' },
    ] },
    { id: 'rarity', label: 'Rarity', kind: 'chips', options: RARITY, accessor: (i) => i.rarity },
    { id: 'consumable', label: 'Consumable type', kind: 'chips', options: [
      { id: 'potion', label: 'Potion' },
      { id: 'scroll', label: 'Scroll' },
      { id: 'wand', label: 'Wand' },
      { id: 'oil', label: 'Oil' },
      { id: 'talisman', label: 'Talisman' },
      { id: 'ammunition', label: 'Ammunition' },
      { id: 'other', label: 'Other' },
    ], accessor: (i) => (i.itemType === 'consumable' ? i.consumableType ?? 'other' : '') },
    { id: 'traits', label: 'Traits', kind: 'traits', accessor: (i) => i.traits },
    // --- Armor facets (auto-hidden when the list has no armor) ---
    { id: 'armorCategory', label: 'Armor category', kind: 'chips', mode: 'any', options: ARMOR_CATEGORY_OPTS, accessor: (i) => (i.itemType === 'armor' ? i.category : '') },
    { id: 'armorGroup', label: 'Armor group', kind: 'chips', mode: 'any', options: ARMOR_GROUP_OPTS, accessor: (i) => (i.itemType === 'armor' ? i.group ?? '' : '') },
    // --- Weapon facets (auto-hidden when the list has no weapons) ---
    { id: 'weaponCategory', label: 'Weapon category', kind: 'chips', mode: 'any', options: WEAPON_CATEGORY_OPTS, accessor: (i) => (i.itemType === 'weapon' ? i.category : '') },
    { id: 'weaponGroup', label: 'Weapon group', kind: 'chips', mode: 'any', options: WEAPON_GROUP_OPTS, accessor: (i) => (i.itemType === 'weapon' ? i.group : '') },
    { id: 'weaponType', label: 'Weapon type', kind: 'chips', mode: 'any', options: [
      { id: 'melee', label: 'Melee' },
      { id: 'ranged', label: 'Ranged' },
    ], accessor: weaponHandedKinds },
    // Damage type with a runtime any/all toggle (AoN's "match any" vs "match all" of the selected types).
    { id: 'damageType', label: 'Damage type', kind: 'chipsToggle', options: [
      { id: 'bludgeoning', label: 'Bludgeoning' },
      { id: 'piercing', label: 'Piercing' },
      { id: 'slashing', label: 'Slashing' },
      { id: 'acid', label: 'Acid' },
      { id: 'cold', label: 'Cold' },
      { id: 'electricity', label: 'Electricity' },
      { id: 'fire', label: 'Fire' },
      { id: 'force', label: 'Force' },
      { id: 'mental', label: 'Mental' },
      { id: 'poison', label: 'Poison' },
      { id: 'sonic', label: 'Sonic' },
      { id: 'spirit', label: 'Spirit' },
      { id: 'vitality', label: 'Vitality' },
      { id: 'void', label: 'Void' },
      { id: 'untyped', label: 'Untyped' },
    ], accessor: weaponDamageTypes },
    { id: 'reload', label: 'Reload', kind: 'chips', mode: 'any', options: [
      { id: '0', label: '0' },
      { id: '1', label: '1' },
      { id: '2', label: '2' },
      { id: 'min', label: '1 Minute' },
    ], accessor: (i) => weaponReloadToken(i) },
    { id: 'hands', label: 'Hands', kind: 'chips', mode: 'any', options: [
      { id: '-1', label: '-1' },
      { id: '0+', label: '0+' },
      { id: '1', label: '1' },
      { id: '1 or 2', label: '1 or 2' },
      { id: '1+', label: '1+' },
      { id: '2', label: '2' },
    ], accessor: itemHandsToken },
    { id: 'level', label: 'Level', kind: 'range', stops: ITEM_LEVEL_STOPS, magnitude: (i) => i.level },
    { id: 'price', label: 'Price', kind: 'range', stops: PRICE_STOPS, magnitude: (i) => coinsToCp(i.price) },
    { id: 'bulk', label: 'Bulk', kind: 'range', stops: BULK_STOPS, magnitude: (i) => i.bulk },
    { id: 'damageDie', label: 'Damage die', kind: 'range', stops: DAMAGE_DIE_STOPS, magnitude: damageDieFaces },
    { id: 'weaponRange', label: 'Weapon range', kind: 'range', stops: WEAPON_RANGE_STOPS, magnitude: weaponRangeFeet },
  ],
};

/** Property-rune picker filters. Typed over the rune's equipment twin (content.items[runeId]),
 *  which carries description/traits/rarity/level (the thin RuneDef does not). Item-type chip is
 *  omitted — every rune twin is itemType 'equipment'. */
export const RUNE_SPEC: FilterSpec<Item> = {
  fields: [
    { id: 'desc', label: 'Description', kind: 'text', accessor: (i) => `${i.name}\n${i.description}`, placeholder: 'Any text in the name or description' },
    { id: 'rarity', label: 'Rarity', kind: 'chips', options: RARITY, accessor: (i) => i.rarity },
    { id: 'traits', label: 'Traits', kind: 'traits', accessor: (i) => i.traits },
    { id: 'level', label: 'Level', kind: 'range', stops: ITEM_LEVEL_STOPS, magnitude: (i) => i.level },
  ],
};

/** The feat filter set (lighter — the picker list is already slot-constrained by level/category). */
export const FEAT_SPEC: FilterSpec<Feat> = {
  fields: [
    { id: 'desc', label: 'Description', kind: 'text', accessor: (f) => `${f.name}\n${f.description}`, placeholder: 'Any text in the name or description' },
    { id: 'rarity', label: 'Rarity', kind: 'chips', options: RARITY, accessor: (f) => f.rarity },
    { id: 'cast', label: 'Action cost', kind: 'castTime', accessor: (f) => f.actionCost },
    { id: 'traits', label: 'Traits', kind: 'traits', accessor: (f) => f.traits },
    { id: 'level', label: 'Level', kind: 'range', stops: FEAT_LEVEL_STOPS, magnitude: (f) => f.level },
  ],
};
