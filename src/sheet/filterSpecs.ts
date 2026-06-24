import type { Feat, Item, Spell } from '../rules/types';
import type { FilterSpec } from './FilterableSelect';
import {
  AREA_STOPS,
  BULK_STOPS,
  DURATION_STOPS,
  FEAT_LEVEL_STOPS,
  ITEM_LEVEL_STOPS,
  PRICE_STOPS,
  RANGE_STOPS,
  RANK_STOPS,
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

/** The AoN-style equipment "Category" tokens for one item — an item can belong to several (a magic
 *  staff is Staves + Held Items + maybe Materials). Categories with no reliable signal in the data
 *  (Vehicles/Siege Weapons/Services live in separate maps; Customizations/Assistive/Adventuring Gear
 *  have no trait) are intentionally absent. Empty chips auto-hide, so over-listing is harmless. */
function itemCategories(i: Item): string[] {
  const c: string[] = [];
  const u = i.usage ?? '';
  const t = i.traits ?? [];
  const has = (trait: string) => t.includes(trait);
  // itemType-driven
  if (i.itemType === 'weapon') c.push('weapons');
  else if (i.itemType === 'armor') c.push('armor');
  else if (i.itemType === 'shield') c.push('shields');
  else if (i.itemType === 'consumable') c.push('consumables');
  else if (i.itemType === 'treasure') c.push('trade-goods');
  // trait-driven (each trait maps 1:1 to an AoN category)
  if (has('apex')) c.push('apex');
  if (has('snare')) c.push('snares');
  if (has('tattoo')) c.push('tattoos');
  if (has('spellheart')) c.push('spellhearts');
  if (has('staff')) c.push('staves');
  if (has('wand') || (i.itemType === 'consumable' && i.consumableType === 'wand')) c.push('wands');
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
  if (has('tech')) c.push('high-tech');
  if (has('alchemical')) c.push('alchemical');
  if (has('figurehead')) c.push('figurehead');
  if (has('companion')) c.push('animals-and-gear');
  // material-driven
  if (i.material || has('precious')) c.push('materials');
  // usage-driven
  if (/^etched/.test(u)) c.push('runes');
  if (/^worn/.test(u)) c.push('worn-items');
  if (/^held-in/.test(u)) c.push('held-items');
  // catch-all so nothing falls through the filter entirely
  if (c.length === 0) c.push('other');
  return c;
}

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
      { id: 'alchemical', label: 'Alchemical Items' },
      { id: 'animals-and-gear', label: 'Animals and Gear' },
      { id: 'apex', label: 'Apex Items' },
      { id: 'armor', label: 'Armor' },
      { id: 'artifacts', label: 'Artifacts' },
      { id: 'censer', label: 'Censer' },
      { id: 'consumables', label: 'Consumables' },
      { id: 'contracts', label: 'Contracts' },
      { id: 'cursed', label: 'Cursed Items' },
      { id: 'figurehead', label: 'Figurehead' },
      { id: 'grafts', label: 'Grafts' },
      { id: 'grimoires', label: 'Grimoires' },
      { id: 'held-items', label: 'Held Items' },
      { id: 'high-tech', label: 'High-Tech' },
      { id: 'intelligent', label: 'Intelligent Items' },
      { id: 'materials', label: 'Materials' },
      { id: 'relics', label: 'Relics' },
      { id: 'runes', label: 'Runes' },
      { id: 'shields', label: 'Shields' },
      { id: 'snares', label: 'Snares' },
      { id: 'spellhearts', label: 'Spellhearts' },
      { id: 'staves', label: 'Staves' },
      { id: 'structures', label: 'Structures' },
      { id: 'tattoos', label: 'Tattoos' },
      { id: 'trade-goods', label: 'Trade Goods' },
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
    { id: 'level', label: 'Level', kind: 'range', stops: ITEM_LEVEL_STOPS, magnitude: (i) => i.level },
    { id: 'price', label: 'Price', kind: 'range', stops: PRICE_STOPS, magnitude: (i) => coinsToCp(i.price) },
    { id: 'bulk', label: 'Bulk', kind: 'range', stops: BULK_STOPS, magnitude: (i) => i.bulk },
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
