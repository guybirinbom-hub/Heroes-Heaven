import { type ReactNode, useId, useMemo, useState } from 'react';
import { attachItem, detachItem, removeInventoryItem, setItemQuantity, updateInventoryItem, addInventoryItem, setItemMonsterPart, type PlayUpdater } from '../rules/play';
import { canAttachTo } from '../rules/attachments';
import { FilterableSelect, PickerRow, descNodeOf } from './FilterableSelect';
import { RUNE_SPEC } from './filterSpecs';
import type {
  ArmorCategory,
  ArmorRunes,
  Character,
  Coins,
  ConsumableItem,
  ContentDatabase,
  DieSize,
  InventoryItem,
  Item,
  Rarity,
  Size,
  SpellRank,
  WeaponCategory,
  WeaponRunes,
} from '../rules/types';
import { MonsterPartsPanel, itemCanUseMonsterParts } from './MonsterPartsEditor';
import { availableMonsterParts, salvageToMonsterPart, MONSTER_PART_TAGS } from '../rules/monsterParts';
import { PopupSelect, SearchSelect } from '../builder/shared';
import { RichEditor } from './RichEditor';
import { useIsMobile } from './useIsMobile';
import { useEscapeClose } from './useEscapeClose';
import { confirmDialog } from './confirm';

/* ---- option catalogs ---- */
const ITEM_TYPES: { value: Item['itemType']; label: string }[] = [
  { value: 'equipment', label: 'General' },
  { value: 'weapon', label: 'Weapon' },
  { value: 'armor', label: 'Armor' },
  { value: 'shield', label: 'Shield' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'container', label: 'Container' },
  { value: 'treasure', label: 'Treasure' },
];
const SIZES: Size[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];
const DICE: DieSize[] = ['d4', 'd6', 'd8', 'd10', 'd12'];
const DAMAGE_TYPES = ['bludgeoning', 'piercing', 'slashing', 'acid', 'cold', 'electricity', 'fire', 'sonic', 'vitality', 'void', 'mental', 'poison', 'bleed', 'force', 'spirit', 'untyped'];
const WEAPON_CATS: WeaponCategory[] = ['unarmed', 'simple', 'martial', 'advanced'];
const ARMOR_CATS: ArmorCategory[] = ['unarmored', 'light', 'medium', 'heavy'];
const WEAPON_GROUPS = ['axe', 'bomb', 'bow', 'brawling', 'club', 'crossbow', 'dart', 'firearm', 'flail', 'hammer', 'knife', 'pick', 'polearm', 'shield', 'sling', 'spear', 'sword'];
const ARMOR_GROUPS = ['cloth', 'leather', 'chain', 'composite', 'plate', 'wood'];
const MATERIALS = ['adamantine', 'cold-iron', 'dawnsilver', 'darkwood', 'dragonhide', 'orichalcum', 'silver', 'sovereign-steel', 'noqual', 'abysium', 'djezet', 'inubrix', 'siccatite', 'warpglass', 'peachwood'];
const CONSUMABLE_TYPES = ['potion', 'scroll', 'wand', 'oil', 'talisman', 'ammunition', 'other'];
const FREQ_PER = ['day', 'hour', 'minute', 'round', 'turn'];
const HANDS = [
  { value: '', label: '—' },
  { value: '1', label: '1' },
  { value: '1+', label: '1+' },
  { value: '2', label: '2' },
];
const TYPE_ICON: Record<string, string> = {
  weapon: 'ti-sword', armor: 'ti-shirt', shield: 'ti-shield', consumable: 'ti-flask', container: 'ti-backpack', equipment: 'ti-package', treasure: 'ti-coin',
};
const TYPE_LABEL: Record<string, string> = {
  equipment: 'General', weapon: 'Weapon', armor: 'Armor', shield: 'Shield', consumable: 'Consumable', container: 'Container', treasure: 'Treasure',
};

/* ---- helpers ---- */
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const label = (s: string) => cap(s.replace(/-/g, ' '));

/** Sentinel option value for the "Monster Part" entry in the material dropdown (variant rule on). */
const MONSTER_PART_OPT = '__monster-part__';
const num = (s: string, dflt = 0) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : dflt;
};
const str = (n?: number) => (n != null ? String(n) : '');
/** A rich-text field whose HTML has no actual text/glyph content reads as empty (e.g. a stray <br>). */
const richEmpty = (s: string) => !s.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim();
const cleanRich = (s: string) => (richEmpty(s) ? '' : s.trim());
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
const rand = () => Math.random().toString(36).slice(2, 7);

/** ALL-CAPS names → Title Case (people often paste shouting names). */
function tidyName(s: string): string {
  const trimmed = s.trim();
  if (/[a-zA-Z]/.test(trimmed) && trimmed === trimmed.toUpperCase()) {
    return trimmed.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return trimmed;
}

function coins(pp: string, gp: string, sp: string, cp: string): Coins | undefined {
  const o: Coins = {};
  const p = Math.max(0, num(pp)), g = Math.max(0, num(gp)), s = Math.max(0, num(sp)), c = Math.max(0, num(cp));
  if (p) o.pp = p;
  if (g) o.gp = g;
  if (s) o.sp = s;
  if (c) o.cp = c;
  return Object.keys(o).length ? o : undefined;
}

/** Build a {value,label} list for an open-vocab picker, keeping the current custom value visible.
 *  (No "None" pseudo-option — clearing is the picker's clearLabel ACTION, not an option row.) */
function optList(vals: string[], cur: string): { value: string; label: string }[] {
  const opts = vals.map((v) => ({ value: v, label: label(v) }));
  if (cur && !vals.includes(cur)) opts.push({ value: cur, label: label(cur) });
  return opts;
}

interface Draft {
  itemType: Item['itemType'];
  name: string;
  level: string;
  rarity: Rarity;
  traits: string[];
  pp: string; gp: string; sp: string; cp: string;
  bulk: string;
  size: Size | '';
  hands: string;
  usage: string;
  matType: string;
  matGrade: '' | 'low' | 'standard' | 'high';
  freqMax: string; freqPer: string;
  srcBook: string; srcPage: string;
  description: string;
  craft: string;
  wCat: WeaponCategory; wGroup: string; wDice: string; wDie: DieSize; wType: string; wRange: string; wReload: string;
  aCat: ArmorCategory; aGroup: string; aAc: string; aDex: string; aCheck: string; aSpeed: string; aStr: string;
  sAc: string; sHard: string; sHp: string; sBt: string; sSpeed: string;
  cType: string; cUsesMax: string; cUsesCur: string; cSpellId: string; cSpellRank: string;
  capBulk: string; ignoredBulk: string;
  tpp: string; tgp: string; tsp: string; tcp: string;
  /** Monster-part authoring: when on, this item is a harvested monster part (Price = its part value). */
  isMonsterPart: boolean;
  /** Chosen vocabulary + free-text tags for the part (energy types, senses, creature types, …). */
  mpTags: string[];
}

function defaults(): Draft {
  return {
    itemType: 'equipment', name: '', level: '0', rarity: 'common', traits: [],
    pp: '', gp: '', sp: '', cp: '', bulk: '', size: '', hands: '', usage: '',
    matType: '', matGrade: '', freqMax: '', freqPer: 'day', srcBook: '', srcPage: '',
    description: '', craft: '',
    wCat: 'martial', wGroup: '', wDice: '1', wDie: 'd6', wType: 'slashing', wRange: '', wReload: '',
    aCat: 'light', aGroup: '', aAc: '1', aDex: '4', aCheck: '0', aSpeed: '0', aStr: '',
    sAc: '2', sHard: '5', sHp: '20', sBt: '10', sSpeed: '0',
    cType: '', cUsesMax: '', cUsesCur: '', cSpellId: '', cSpellRank: '1',
    capBulk: '', ignoredBulk: '',
    tpp: '', tgp: '', tsp: '', tcp: '',
    isMonsterPart: false, mpTags: [],
  };
}

/** Map an existing item back into editable form state. */
function fromItem(it: Item): Draft {
  const d = defaults();
  d.itemType = it.itemType;
  d.name = it.name;
  d.level = str(it.level);
  d.rarity = it.rarity ?? 'common';
  d.traits = [...(it.traits ?? [])];
  d.pp = str(it.price?.pp); d.gp = str(it.price?.gp); d.sp = str(it.price?.sp); d.cp = str(it.price?.cp);
  d.bulk = str(it.bulk);
  d.size = it.size ?? '';
  d.hands = it.hands != null ? String(it.hands) : '';
  d.usage = it.usage ?? '';
  d.matType = it.material?.type ?? '';
  d.matGrade = it.material?.grade ?? '';
  d.freqMax = it.frequency ? String(it.frequency.max) : '';
  d.freqPer = it.frequency?.per ?? 'day';
  d.srcBook = it.source?.book ?? '';
  d.srcPage = it.source?.page != null ? String(it.source.page) : '';
  d.description = it.description ?? '';
  d.craft = it.craftRequirements ?? '';
  d.isMonsterPart = !!it.isMonsterPart;
  d.mpTags = [...(it.monsterPartTags ?? [])];
  switch (it.itemType) {
    case 'weapon':
      d.wCat = it.category; d.wGroup = it.group; d.wDice = String(it.damage.dice); d.wDie = it.damage.die; d.wType = it.damage.type;
      d.wRange = str(it.range); d.wReload = str(it.reload);
      break;
    case 'armor':
      d.aCat = it.category; d.aGroup = it.group ?? ''; d.aAc = str(it.acBonus); d.aDex = str(it.dexCap ?? 4);
      d.aCheck = it.checkPenalty ? String(Math.abs(it.checkPenalty)) : '0';
      d.aSpeed = it.speedPenalty ? String(Math.abs(it.speedPenalty)) : '0';
      d.aStr = str(it.strength);
      break;
    case 'shield':
      d.sAc = str(it.acBonus); d.sHard = str(it.hardness); d.sHp = str(it.hp); d.sBt = str(it.brokenThreshold);
      d.sSpeed = it.speedPenalty ? String(Math.abs(it.speedPenalty)) : '0';
      break;
    case 'consumable':
      d.cType = it.consumableType ?? '';
      if (it.uses) { d.cUsesMax = String(it.uses.max); d.cUsesCur = String(it.uses.current); }
      if (it.spell) { d.cSpellId = it.spell.spellId; d.cSpellRank = String(it.spell.rank); }
      break;
    case 'container':
      d.capBulk = str(it.capacity?.bulk); d.ignoredBulk = str(it.ignoredBulk);
      break;
    case 'treasure':
      d.tpp = str(it.value?.pp); d.tgp = str(it.value?.gp); d.tsp = str(it.value?.sp); d.tcp = str(it.value?.cp);
      break;
  }
  return d;
}

/** Grouped vocabulary chips + a free-text box for a monster part's descriptor tags. Selecting a
 *  vocabulary chip toggles it; the free-text box adds anything else (comma/Enter separated). Tags are
 *  stored lowercased; free tags outside the vocabulary render as an extra "chosen" row. */
function MonsterPartTagPicker({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [text, setText] = useState('');
  const set = new Set(tags.map((t) => t.toLowerCase()));
  const toggle = (t: string) => {
    const lc = t.toLowerCase();
    onChange(set.has(lc) ? tags.filter((x) => x.toLowerCase() !== lc) : [...tags, lc]);
  };
  const commit = () => {
    const add = text.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (add.length) onChange([...tags, ...add.filter((a) => !set.has(a))]);
    setText('');
  };
  // Free-text tags = chosen tags not present in any vocabulary group.
  const vocab = new Set(MONSTER_PART_TAGS.flatMap((g) => g.tags));
  const freeTags = tags.filter((t) => !vocab.has(t.toLowerCase()));
  return (
    <div className="mp-tagpick">
      {MONSTER_PART_TAGS.map((g) => (
        <div className="mp-taggroup" key={g.group}>
          <span className="mp-taggroup-h">{g.group}</span>
          <div className="mp-tagchips">
            {g.tags.map((t) => (
              <button
                type="button"
                key={t}
                className={'mp-tagchip' + (set.has(t) ? ' on' : '')}
                onClick={() => toggle(t)}
                aria-pressed={set.has(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="mp-taggroup">
        <span className="mp-taggroup-h">Other (free text)</span>
        {freeTags.length > 0 && (
          <div className="mp-tagchips">
            {freeTags.map((t) => (
              <button type="button" key={t} className="mp-tagchip on" onClick={() => toggle(t)} aria-pressed>
                {t} <i className="ti ti-x" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <input
          className="mp-tagfree"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } }}
          onBlur={commit}
          placeholder="Add a custom tag…"
          aria-label="Add a custom monster-part tag"
        />
      </div>
    </div>
  );
}

/**
 * Unified create / edit modal for an item definition. In edit mode it is pre-filled from
 * `item` and preserves its id (so the homebrew store updates in place); in create mode it
 * mints a fresh id. The accordion only shows the sections that apply to the chosen Group.
 */
export function ItemEditorModal({
  mode,
  item,
  inv,
  inventory = [],
  content,
  character,
  maxSpellRank = 10,
  onPlay,
  onCreateItem,
  onSave,
  onClose,
}: {
  mode: 'create' | 'edit';
  item?: Item;
  /** The owned instance being edited (enables the Runes & upgrades section). */
  inv?: InventoryItem;
  /** Full inventory — needed to affix/peel attachments. */
  inventory?: InventoryItem[];
  content: ContentDatabase;
  /** The owning character — enables the Monster Parts panel (level + variant gate + banked parts). */
  character?: Character;
  /** Highest spell rank a bound scroll/wand may hold (caps the rank picker). */
  maxSpellRank?: number;
  /** Mutate play state — needed to etch runes / affix attachments on the instance. */
  onPlay?: PlayUpdater;
  /** Register a new item definition — needed to salvage a Monster-Parts item into a generic part. */
  onCreateItem?: (item: Item) => void;
  onSave: (item: Item) => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const [d, setD] = useState<Draft>(() => (item ? fromItem(item) : defaults()));
  const [open, setOpen] = useState<Set<string>>(
    () => new Set(['additional', ...(item?.itemType ? [item.itemType] : []), ...(inv ? ['runes'] : [])]),
  );
  const [baseId, setBaseId] = useState<string | null>(null);
  // The rich-text editors are uncontrolled; bump this key to remount them when the description is
  // replaced wholesale (copy-from-item, reset) so they reflect the new value.
  const [editorKey, setEditorKey] = useState(0);
  const upd = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const isMobile = useIsMobile();
  const isOpen = (id: string) => open.has(id);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const setType = (t: Item['itemType']) => {
    upd({ itemType: t });
    setOpen((prev) => new Set([...prev, t, 'additional']));
  };

  const itemOpts = useMemo(
    () =>
      Object.values(content.items)
        .map((i) => ({ id: i.id, name: i.name, note: `${TYPE_LABEL[i.itemType] ?? i.itemType} · lvl ${i.level}` }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [content.items],
  );
  const spellOpts = useMemo(
    () =>
      Object.values(content.spells)
        .filter((s) => s.rank >= 1 && s.rank <= maxSpellRank && !(s.traits ?? []).includes('focus') && !(s.traits ?? []).includes('ritual'))
        .map((s) => ({ id: s.id, name: s.name, note: `Rank ${s.rank} · ${(s.traditions ?? []).join('/')}` }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [content.spells, maxSpellRank],
  );
  const traitVocab = useMemo(() => {
    const set = new Set<string>();
    for (const i of Object.values(content.items)) for (const t of i.traits ?? []) set.add(t);
    return [...set].sort();
  }, [content.items]);

  /** Copy a picked item's stats into the form (keeps a non-empty name/description). */
  const applyBase = (b?: Item) => {
    if (!b) return;
    setD((prev) => {
      const next: Draft = {
        ...prev,
        itemType: b.itemType,
        name: prev.name.trim() ? prev.name : b.name,
        level: str(b.level),
        rarity: b.rarity ?? 'common',
        traits: [...(b.traits ?? [])],
        pp: str(b.price?.pp), gp: str(b.price?.gp), sp: str(b.price?.sp), cp: str(b.price?.cp),
        bulk: str(b.bulk),
        size: b.size ?? '',
        hands: b.hands != null ? String(b.hands) : '',
        usage: b.usage ?? '',
        matType: b.material?.type ?? '',
        matGrade: b.material?.grade ?? '',
        description: prev.description.trim() ? prev.description : b.description ?? '',
      };
      if (b.itemType === 'weapon') {
        next.wCat = b.category; next.wGroup = b.group; next.wDice = String(b.damage.dice); next.wDie = b.damage.die; next.wType = b.damage.type;
        next.wRange = str(b.range); next.wReload = str(b.reload);
      } else if (b.itemType === 'armor') {
        next.aCat = b.category; next.aGroup = b.group ?? ''; next.aAc = str(b.acBonus); next.aDex = str(b.dexCap ?? 4);
        next.aCheck = b.checkPenalty ? String(Math.abs(b.checkPenalty)) : '0';
        next.aSpeed = b.speedPenalty ? String(Math.abs(b.speedPenalty)) : '0';
        next.aStr = str(b.strength);
      } else if (b.itemType === 'shield') {
        next.sAc = str(b.acBonus); next.sHard = str(b.hardness); next.sHp = str(b.hp); next.sBt = str(b.brokenThreshold);
      } else if (b.itemType === 'container') {
        next.capBulk = str(b.capacity?.bulk); next.ignoredBulk = str(b.ignoredBulk);
      }
      return next;
    });
    setOpen((prev) => new Set([...prev, b.itemType, 'additional']));
    setEditorKey((k) => k + 1); // reflect a copied description in the (uncontrolled) editor
  };

  const build = (): Item | null => {
    const name = tidyName(d.name);
    if (!name) return null;
    const price = coins(d.pp, d.gp, d.sp, d.cp);
    const source = {
      ...(d.srcBook.trim() ? { book: d.srcBook.trim() } : {}),
      ...(d.srcPage.trim() ? { page: num(d.srcPage) } : {}),
      // Preserve a built-in item's original ORC/OGL attribution when editing it; brand-new
      // items are homebrew. (Attribution must travel with the data — see types.ts.)
      license: (mode === 'edit' ? item?.source?.license : undefined) ?? 'homebrew',
    };
    // Homebrew items (and copies) edit in place; editing a BUILT-IN item is copy-on-write —
    // mint a fresh id so only this character's instance (repointed by the caller) changes.
    const editingHomebrew = mode === 'edit' && !!item && (item.source?.license === 'homebrew' || item.id.startsWith('custom-'));
    const base = {
      id: editingHomebrew && item ? item.id : `custom-${slugify(name)}-${rand()}`,
      name,
      traits: d.traits.map((t) => t.trim().toLowerCase()).filter(Boolean),
      rarity: d.rarity,
      description: cleanRich(d.description),
      level: num(d.level),
      bulk: num(d.bulk),
      ...(price ? { price } : {}),
      ...(d.size ? { size: d.size } : {}),
      ...(d.hands ? { hands: (d.hands === '1+' ? '1+' : num(d.hands)) as 0 | 1 | 2 | '1+' } : {}),
      ...(d.usage.trim() ? { usage: d.usage.trim() } : {}),
      ...(d.matType.trim() ? { material: { type: d.matType.trim(), ...(d.matGrade ? { grade: d.matGrade } : {}) } } : {}),
      ...(d.freqMax.trim() ? { frequency: { max: num(d.freqMax), per: d.freqPer || 'day' } } : {}),
      ...(cleanRich(d.craft) ? { craftRequirements: cleanRich(d.craft) } : {}),
      ...(item?.descRefs ? { descRefs: item.descRefs } : {}),
      // Monster-part authoring: `isMonsterPart` marks the item a harvested part (Price = its value);
      // its tags carry the vocabulary/free-text descriptors. An empty tag list is still a valid part.
      ...(d.isMonsterPart ? { isMonsterPart: true as const, monsterPartTags: d.mpTags.map((t) => t.trim().toLowerCase()).filter(Boolean) } : {}),
      source,
    };
    switch (d.itemType) {
      case 'weapon':
        return {
          ...base, itemType: 'weapon', category: d.wCat, group: d.wGroup.trim() || 'club',
          damage: { dice: Math.max(1, num(d.wDice, 1)), die: d.wDie, type: d.wType },
          ...(d.wRange.trim() ? { range: num(d.wRange) } : {}),
          ...(d.wReload.trim() ? { reload: num(d.wReload) } : {}),
        };
      case 'armor':
        return {
          ...base, itemType: 'armor', category: d.aCat, acBonus: num(d.aAc), dexCap: num(d.aDex, 4),
          checkPenalty: -Math.abs(num(d.aCheck)),
          ...(d.aGroup.trim() ? { group: d.aGroup.trim() } : {}),
          ...(num(d.aSpeed) ? { speedPenalty: -Math.abs(num(d.aSpeed)) } : {}),
          ...(d.aStr.trim() ? { strength: num(d.aStr) } : {}),
        };
      case 'shield':
        return {
          ...base, itemType: 'shield', acBonus: num(d.sAc, 2), hardness: num(d.sHard, 5), hp: num(d.sHp, 20),
          brokenThreshold: num(d.sBt, Math.floor(num(d.sHp, 20) / 2)),
          ...(num(d.sSpeed) ? { speedPenalty: -Math.abs(num(d.sSpeed)) } : {}),
        };
      case 'consumable':
        return {
          ...base, itemType: 'consumable',
          ...(d.cType ? { consumableType: d.cType as ConsumableItem['consumableType'] } : {}),
          ...(d.cUsesMax.trim() ? { uses: { max: num(d.cUsesMax), current: num(d.cUsesCur || d.cUsesMax) } } : {}),
          ...((d.cType === 'scroll' || d.cType === 'wand') && d.cSpellId ? { spell: { spellId: d.cSpellId, rank: num(d.cSpellRank, 1) as SpellRank } } : {}),
        };
      case 'container':
        return {
          ...base, itemType: 'container',
          ...(d.capBulk.trim() ? { capacity: { bulk: num(d.capBulk) } } : {}),
          ...(d.ignoredBulk.trim() ? { ignoredBulk: num(d.ignoredBulk) } : {}),
        };
      case 'treasure':
        return { ...base, itemType: 'treasure', value: coins(d.tpp, d.tgp, d.tsp, d.tcp) ?? {} };
      default:
        return { ...base, itemType: 'equipment' };
    }
  };

  const save = () => {
    const it = build();
    if (it) {
      onSave(it);
      onClose();
    }
  };

  // Monster Parts (variant rule): eligible items may switch to Monster-Parts mode, which REPLACES the
  // rune/material editors. Gate on the character's variant flag + an owned instance to mutate.
  const mpVariantOn = !!character?.variantRules?.monsterParts;
  const mpEligible = mpVariantOn && !!onPlay && !!inv && !!item && itemCanUseMonsterParts(item);
  const mpActiveHere = mpEligible && !!inv?.monsterPart;
  // Reference-only: the character's harvested monster-part inventory items (total gp + union of tags).
  const availableParts = availableMonsterParts(character?.inventory, content);

  // Salvage: break the item's refine/imbue value into a generic monster-part INVENTORY item (50% of
  // the value), register it + add it to the bag, then clear this item's Monster-Parts data. Needs the
  // instance (onPlay) + an item-def registrar (onCreateItem).
  const canSalvage = mpActiveHere && !!onPlay && !!onCreateItem && !!inv?.monsterPart;
  const onSalvage = canSalvage
    ? () => {
        const part = salvageToMonsterPart(inv!.monsterPart, item!.name);
        if (!part) return;
        onCreateItem!(part);
        onPlay!((p) => addInventoryItem(setItemMonsterPart(p, inv!.instanceId, undefined), part.id));
      }
    : undefined;

  let additionalCount = 0;
  if (d.matType) additionalCount++;
  if (d.freqMax) additionalCount++;
  if (d.srcBook || d.srcPage) additionalCount++;
  if (d.usage) additionalCount++;
  if (d.size) additionalCount++;
  if (d.itemType !== 'equipment') additionalCount++;

  /** One collapsible accordion row inside Additional fields. */
  const AccRow = ({ id, icon, name, summary, children }: { id: string; icon: string; name: string; summary?: string; children: React.ReactNode }) => {
    const o = isOpen(id);
    return (
      <div className="ie-acc-row">
        <div className={'ie-acc-h' + (o ? ' open' : '')} onClick={() => toggle(id)}>
          <span className="ie-acc-ic"><i className={'ti ' + icon} aria-hidden="true" /></span>
          <span className="nm">{name}</span>
          {!o && summary && <span className="ie-acc-sum">{summary}</span>}
          <i className={'ti ' + (o ? 'ti-chevron-up' : 'ti-chevron-down')} style={{ color: 'var(--app-text-faint)' }} aria-hidden="true" />
        </div>
        {o && <div className="ie-acc-b">{children}</div>}
      </div>
    );
  };

  const coinRow = (keys: ('pp' | 'gp' | 'sp' | 'cp' | 'tpp' | 'tgp' | 'tsp' | 'tcp')[], labels: string[]) => (
    <div className="ie-coins">
      {keys.map((k, i) => (
        <label key={k}>
          <input type="number" min={0} value={d[k]} onChange={(e) => upd({ [k]: e.target.value } as Partial<Draft>)} />
          <span>{labels[i]}</span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="picker-overlay">
      <div className="picker item-edit" onClick={(e) => e.stopPropagation()}>
        <div className="ie-head">
          <div>
            <div className="ie-title">{mode === 'edit' ? 'Edit item' : 'Create item'}</div>
            <div className="ie-crumb">
              <i className={'ti ' + (TYPE_ICON[d.itemType] ?? 'ti-package')} aria-hidden="true" /> {TYPE_LABEL[d.itemType]}
              <span style={{ color: 'var(--app-text-faint)' }}>·</span> <b>{d.name.trim() || 'Unnamed item'}</b>
            </div>
          </div>
          <i className="ti ti-x ie-x" onClick={onClose} aria-label="Close" />
        </div>

        <div className="ci-body">
          {/* ---- Core (always visible) ---- */}
          <div className="ie-grid3">
            <label className="ci-field">
              <span>Group</span>
              <select value={d.itemType} onChange={(e) => setType(e.target.value as Item['itemType'])}>
                {ITEM_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="ci-field">
              <span>Lvl</span>
              <input type="number" value={d.level} onChange={(e) => upd({ level: e.target.value })} />
            </label>
            <div className="ci-field">
              <span>Rarity</span>
              {isMobile ? (
                <select value={d.rarity} onChange={(e) => upd({ rarity: e.target.value as Rarity })}>
                  {(['common', 'uncommon', 'rare', 'unique'] as Rarity[]).map((r) => (
                    <option key={r} value={r}>{cap(r)}</option>
                  ))}
                </select>
              ) : (
                <div className="ie-pills">
                  {(['common', 'uncommon', 'rare', 'unique'] as Rarity[]).map((r) => (
                    <button type="button" key={r} className={d.rarity === r ? 'on' : ''} onClick={() => upd({ rarity: r })}>{cap(r)}</button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <label className="ci-field">
            <span>Name <span className="ie-req">✦</span></span>
            <input autoFocus={!isMobile} value={d.name} onChange={(e) => upd({ name: e.target.value })} placeholder="e.g. Stormcaller blade" />
          </label>

          <div className="ci-field">
            <span>Traits</span>
            <TraitInput value={d.traits} onChange={(t) => upd({ traits: t })} vocab={traitVocab} />
          </div>

          <div className="ie-grid3">
            <div className="ci-field">
              <span>{d.isMonsterPart ? 'Part value (price)' : 'Price'}</span>
              {coinRow(['pp', 'gp', 'sp', 'cp'], ['pp', 'gp', 'sp', 'cp'])}
            </div>
            <label className="ci-field">
              <span>Bulk</span>
              <input type="number" step="0.1" min={0} value={d.bulk} onChange={(e) => upd({ bulk: e.target.value })} placeholder="0" />
            </label>
            <label className="ci-field">
              <span>Size</span>
              <select value={d.size} onChange={(e) => upd({ size: e.target.value as Size | '' })}>
                <option value="">—</option>
                {SIZES.map((s) => (
                  <option key={s} value={s}>{cap(s)}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="ie-grid2">
            <label className="ci-field">
              <span>Hands</span>
              <select value={d.hands} onChange={(e) => upd({ hands: e.target.value })}>
                {HANDS.map((h) => (
                  <option key={h.value} value={h.value}>{h.label}</option>
                ))}
              </select>
            </label>
            <label className="ci-field">
              <span>Usage</span>
              <input value={d.usage} onChange={(e) => upd({ usage: e.target.value })} placeholder="e.g. held in 2 hands" />
            </label>
          </div>

          {/* ---- Additional fields ---- */}
          <div className="ie-collap">
            <div className="ie-collap-h" onClick={() => toggle('additional')}>
              <i className={'ti ' + (isOpen('additional') ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
              <span className="ttl">Additional fields</span>
              <span className="ie-badge">{additionalCount} set</span>
            </div>
            {isOpen('additional') && (
              <div className="ie-collap-b">
                <div className="ci-field">
                  <span>Base item</span>
                  <SearchSelect bare label="Base item" value={baseId} options={itemOpts} placeholder="Start from an existing item…" onChange={(id) => { setBaseId(id); applyBase(content.items[id]); }} />
                </div>

                <div className="ie-acc">
                  {d.itemType === 'weapon' && (
                    <AccRow id="weapon" icon="ti-sword" name="Weapon" summary={`${d.wDice}${d.wDie} ${d.wType}`}>
                      <div className="ie-grid3">
                        <label className="ci-field"><span>Num dice</span><input type="number" min={1} value={d.wDice} onChange={(e) => upd({ wDice: e.target.value })} /></label>
                        <label className="ci-field"><span>Damage die</span><select value={d.wDie} onChange={(e) => upd({ wDie: e.target.value as DieSize })}>{DICE.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
                        <label className="ci-field"><span>Damage type</span><select value={d.wType} onChange={(e) => upd({ wType: e.target.value })}>{DAMAGE_TYPES.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
                      </div>
                      <div className="ie-grid3">
                        <label className="ci-field"><span>Category</span><select value={d.wCat} onChange={(e) => upd({ wCat: e.target.value as WeaponCategory })}>{WEAPON_CATS.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></label>
                        <div className="ci-field"><span>Weapon group</span><PopupSelect title="Weapon group" placeholder="Choose group" value={d.wGroup || ''} options={optList(WEAPON_GROUPS, d.wGroup)} clearLabel="Clear" onChange={(v) => upd({ wGroup: v })} addCustom={{ label: 'Custom group…', placeholder: 'e.g. laser', onAdd: (t) => upd({ wGroup: slugify(t) }) }} /></div>
                        <label className="ci-field"><span>Range (ft)</span><input type="number" min={0} value={d.wRange} onChange={(e) => upd({ wRange: e.target.value })} placeholder="—" /></label>
                      </div>
                      <div className="ie-grid3">
                        <label className="ci-field"><span>Reload</span><input type="number" min={0} value={d.wReload} onChange={(e) => upd({ wReload: e.target.value })} placeholder="—" /></label>
                      </div>
                    </AccRow>
                  )}

                  {d.itemType === 'armor' && (
                    <AccRow id="armor" icon="ti-shirt" name="Armor" summary={`+${num(d.aAc)} AC`}>
                      <div className="ie-grid3">
                        <label className="ci-field"><span>Category</span><select value={d.aCat} onChange={(e) => upd({ aCat: e.target.value as ArmorCategory })}>{ARMOR_CATS.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></label>
                        <label className="ci-field"><span>AC bonus</span><input type="number" value={d.aAc} onChange={(e) => upd({ aAc: e.target.value })} /></label>
                        <label className="ci-field"><span>Dex cap</span><input type="number" value={d.aDex} onChange={(e) => upd({ aDex: e.target.value })} /></label>
                      </div>
                      <div className="ie-grid3">
                        <label className="ci-field"><span>Check penalty</span><input type="number" value={d.aCheck} onChange={(e) => upd({ aCheck: e.target.value })} /></label>
                        <label className="ci-field"><span>Speed penalty</span><input type="number" value={d.aSpeed} onChange={(e) => upd({ aSpeed: e.target.value })} /></label>
                        <label className="ci-field"><span>Min Str</span><input type="number" value={d.aStr} onChange={(e) => upd({ aStr: e.target.value })} placeholder="—" /></label>
                      </div>
                      <div className="ci-field"><span>Armor group</span><PopupSelect title="Armor group" placeholder="Choose group" value={d.aGroup || ''} options={optList(ARMOR_GROUPS, d.aGroup)} clearLabel="Clear" onChange={(v) => upd({ aGroup: v })} addCustom={{ label: 'Custom group…', placeholder: 'e.g. skeletal', onAdd: (t) => upd({ aGroup: slugify(t) }) }} /></div>
                    </AccRow>
                  )}

                  {d.itemType === 'shield' && (
                    <AccRow id="shield" icon="ti-shield" name="Shield" summary={`Hardness ${num(d.sHard)} · ${num(d.sHp)} HP`}>
                      <div className="ie-grid3">
                        <label className="ci-field"><span>AC bonus</span><input type="number" value={d.sAc} onChange={(e) => upd({ sAc: e.target.value })} /></label>
                        <label className="ci-field"><span>Hardness</span><input type="number" value={d.sHard} onChange={(e) => upd({ sHard: e.target.value })} /></label>
                        <label className="ci-field"><span>Speed penalty</span><input type="number" value={d.sSpeed} onChange={(e) => upd({ sSpeed: e.target.value })} /></label>
                      </div>
                      <div className="ie-grid3">
                        <label className="ci-field"><span>Max HP</span><input type="number" value={d.sHp} onChange={(e) => upd({ sHp: e.target.value })} /></label>
                        <label className="ci-field"><span>Broken threshold</span><input type="number" value={d.sBt} onChange={(e) => upd({ sBt: e.target.value })} /></label>
                        <div className="ci-field"><span>&nbsp;</span><span className="ie-hint">½ Max HP = {Math.floor(num(d.sHp) / 2)}</span></div>
                      </div>
                    </AccRow>
                  )}

                  {d.itemType === 'consumable' && (
                    <AccRow id="consumable" icon="ti-flask" name="Consumable" summary={d.cType ? cap(d.cType) : undefined}>
                      <div className="ie-grid3">
                        <label className="ci-field"><span>Type</span><select value={d.cType} onChange={(e) => upd({ cType: e.target.value })}><option value="">—</option>{CONSUMABLE_TYPES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select></label>
                        <label className="ci-field"><span>Uses (max)</span><input type="number" min={0} value={d.cUsesMax} onChange={(e) => upd({ cUsesMax: e.target.value })} placeholder="—" /></label>
                        <label className="ci-field"><span>Uses (current)</span><input type="number" min={0} value={d.cUsesCur} onChange={(e) => upd({ cUsesCur: e.target.value })} placeholder="—" /></label>
                      </div>
                      {(d.cType === 'scroll' || d.cType === 'wand') && (
                        <div className="ie-grid2">
                          <div className="ci-field"><span>Bound spell</span><SearchSelect bare label="Spell" value={d.cSpellId || null} options={spellOpts} placeholder="Choose a spell" onChange={(id) => upd({ cSpellId: id })} /></div>
                          <label className="ci-field"><span>Spell rank</span><select value={d.cSpellRank} onChange={(e) => upd({ cSpellRank: e.target.value })}>{Array.from({ length: Math.max(1, maxSpellRank) }, (_, i) => i + 1).map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
                        </div>
                      )}
                    </AccRow>
                  )}

                  {d.itemType === 'container' && (
                    <AccRow id="container" icon="ti-backpack" name="Container" summary={d.capBulk ? `${num(d.capBulk)} Bulk` : undefined}>
                      <div className="ie-grid2">
                        <label className="ci-field"><span>Capacity (Bulk)</span><input type="number" min={0} value={d.capBulk} onChange={(e) => upd({ capBulk: e.target.value })} placeholder="—" /></label>
                        <label className="ci-field"><span>Bulk ignored</span><input type="number" min={0} value={d.ignoredBulk} onChange={(e) => upd({ ignoredBulk: e.target.value })} placeholder="—" /></label>
                      </div>
                    </AccRow>
                  )}

                  {d.itemType === 'treasure' && (
                    <AccRow id="treasure" icon="ti-coin" name="Treasure value">
                      <div className="ci-field"><span>Value</span>{coinRow(['tpp', 'tgp', 'tsp', 'tcp'], ['pp', 'gp', 'sp', 'cp'])}</div>
                    </AccRow>
                  )}

                  {onPlay && inv && item && (item.itemType === 'weapon' || item.itemType === 'armor' || item.itemType === 'shield') && (
                    <AccRow id="runes" icon="ti-sparkles" name={mpActiveHere ? 'Monster Parts' : 'Runes & upgrades'}>
                      {mpEligible && <MonsterPartsPanel inv={inv} item={item} charLevel={character?.level ?? 1} available={availableParts} onPlay={onPlay} onSalvage={onSalvage} />}
                      {/* A Monster-Parts item ignores runes/attachments (either/or) — hide the rune editor. */}
                      {!mpActiveHere && (
                        <>
                          <RuneEditor inv={inv} item={item} content={content} onPlay={onPlay} />
                          <AttachmentsSection host={inv} hostItem={item} inventory={inventory} content={content} onPlay={onPlay} />
                          <span className="ie-hint">Runes and attachments apply to this specific item right away.</span>
                        </>
                      )}
                    </AccRow>
                  )}

                  {/* Worn equipment (Perception/skill item) has no rune editor, but can still take Monster
                      Parts — give it its own panel. */}
                  {mpEligible && item && item.itemType === 'equipment' && inv && onPlay && (
                    <AccRow id="monster-parts" icon="ti-bone" name="Monster Parts">
                      <MonsterPartsPanel inv={inv} item={item} charLevel={character?.level ?? 1} available={availableParts} onPlay={onPlay} onSalvage={onSalvage} />
                    </AccRow>
                  )}

                  {!mpActiveHere && (d.itemType !== 'treasure' || mpVariantOn) && (
                    <AccRow id="material" icon="ti-diamond" name="Material" summary={d.isMonsterPart ? 'Monster Part' : d.matType ? label(d.matType) : 'none'}>
                      <div className="ie-grid2">
                        <div className="ci-field"><span>Precious material</span><PopupSelect title="Precious material" placeholder="None" value={d.isMonsterPart ? MONSTER_PART_OPT : (d.matType || '')} options={mpVariantOn ? [{ value: MONSTER_PART_OPT, label: 'Monster Part' }, ...optList(MATERIALS, d.matType)] : optList(MATERIALS, d.matType)} clearLabel="Clear" onChange={(v) => { if (v === MONSTER_PART_OPT) upd({ isMonsterPart: true, matType: '' }); else upd({ matType: v, isMonsterPart: false }); }} addCustom={{ label: 'Custom material…', placeholder: 'e.g. living steel', onAdd: (t) => upd({ matType: slugify(t), isMonsterPart: false }) }} /></div>
                        {d.isMonsterPart ? (
                          <div className="ci-field">
                            <span>Part tags</span>
                            <MonsterPartTagPicker tags={d.mpTags} onChange={(t) => upd({ mpTags: t })} />
                            <span className="ie-hint">Tag what this part came from (energy/damage types, senses, creature types, skills…). Tags are optional and drive only the informational "matching part" hints when refining/imbuing.</span>
                          </div>
                        ) : (
                          <label className="ci-field"><span>Grade</span><select value={d.matGrade} onChange={(e) => upd({ matGrade: e.target.value as Draft['matGrade'] })}><option value="">—</option><option value="low">Low</option><option value="standard">Standard</option><option value="high">High</option></select></label>
                        )}
                      </div>
                    </AccRow>
                  )}

                  <AccRow id="more" icon="ti-dots" name="More" summary={d.freqMax ? `${num(d.freqMax)}/${d.freqPer}` : undefined}>
                    <div className="ie-grid3">
                      <label className="ci-field"><span>Frequency (max)</span><input type="number" min={0} value={d.freqMax} onChange={(e) => upd({ freqMax: e.target.value })} placeholder="—" /></label>
                      <label className="ci-field"><span>Per</span><select value={d.freqPer} onChange={(e) => upd({ freqPer: e.target.value })}>{FREQ_PER.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
                      <div className="ci-field" />
                    </div>
                    <div className="ie-grid2">
                      <label className="ci-field"><span>Source book</span><input value={d.srcBook} onChange={(e) => upd({ srcBook: e.target.value })} placeholder="e.g. Player Core" /></label>
                      <label className="ci-field"><span>Page</span><input type="number" min={0} value={d.srcPage} onChange={(e) => upd({ srcPage: e.target.value })} placeholder="—" /></label>
                    </div>
                  </AccRow>
                </div>

                <div className="ci-field">
                  <span>Description <span className="ie-req">✦</span></span>
                  <div className="ie-rich">
                    <RichEditor key={`desc-${editorKey}`} initialHtml={d.description} onChange={(html) => upd({ description: html })} enableRefLink hideToolbarUntilFocus placeholder="What the item does…" />
                  </div>
                </div>
                <div className="ci-field">
                  <span>Craft requirements</span>
                  <div className="ie-rich ie-rich-sm">
                    <RichEditor key={`craft-${editorKey}`} initialHtml={d.craft} onChange={(html) => upd({ craft: html })} enableRefLink hideToolbarUntilFocus placeholder="e.g. Supply one casting of fireball" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ---- Operations ---- */}
          <div className="ie-collap">
            <div className="ie-collap-h" onClick={() => toggle('ops')}>
              <i className={'ti ' + (isOpen('ops') ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
              <span className="ttl">Operations</span>
            </div>
            {isOpen('ops') && (
              <div className="ie-collap-b">
                <button className="ci-cancel" style={{ alignSelf: 'flex-start' }} onClick={() => { setD(item ? fromItem(item) : defaults()); setBaseId(null); setEditorKey((k) => k + 1); }}>
                  <i className="ti ti-refresh" aria-hidden="true" /> Reset {mode === 'edit' ? 'changes' : 'form'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="ie-foot">
          <div className="ie-status">{d.name.trim() ? (mode === 'edit' ? 'Editing existing item' : 'New item · adds to your inventory') : 'Name is required'}</div>
          <div className="ie-btns">
            <button className="ci-cancel" onClick={onClose}>Cancel</button>
            <button className="ci-save" disabled={!d.name.trim()} onClick={save}>
              <i className="ti ti-device-floppy" aria-hidden="true" /> Save item
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** A chip multi-select for traits with a native-datalist typeahead over the known vocab. */
function TraitInput({ value, onChange, vocab }: { value: string[]; onChange: (t: string[]) => void; vocab: string[] }) {
  const [text, setText] = useState('');
  const listId = useId();
  const add = (t: string) => {
    const v = t.trim().toLowerCase();
    if (v && !value.includes(v)) onChange([...value, v]);
    setText('');
  };
  return (
    <div className="ie-chips">
      {value.map((t) => (
        <span className="ie-chip" key={t}>
          {t}
          <i className="ti ti-x" onClick={() => onChange(value.filter((x) => x !== t))} aria-hidden="true" />
        </span>
      ))}
      <input
        className="ie-chip-input"
        list={listId}
        placeholder={value.length ? 'add trait…' : 'magical, evocation…'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id={listId}>
        {vocab.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}

/** Etch/edit runes on a weapon or armor: fundamental slots + property slots (count = potency). */
function RuneEditor({
  inv,
  item,
  content,
  onPlay,
}: {
  inv: InventoryItem;
  item: Item;
  content: ContentDatabase;
  onPlay: PlayUpdater;
}) {
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  // Property runes carry their rich data (description/traits/level) only on their equipment twin
  // content.items[runeId]; join here so the search popup can show + filter them.
  const propItems = useMemo(
    () =>
      Object.values(content.runes)
        .filter((r) => r.slot === item.itemType && r.kind === 'property')
        .map((r) => content.items[r.id])
        .filter((it): it is Item => !!it),
    [content, item.itemType],
  );
  if (item.itemType !== 'weapon' && item.itemType !== 'armor' && item.itemType !== 'shield') return null;
  const runes = (inv.runes ?? {}) as WeaponRunes & ArmorRunes;
  const apply = (next: WeaponRunes | ArmorRunes) => onPlay((p) => updateInventoryItem(p, inv.instanceId, { runes: next }));

  // Shields take only a reinforcing rune (raises Hardness/HP/BT).
  if (item.itemType === 'shield') {
    const REINFORCING_LABELS = ['', 'Minor', 'Lesser', 'Moderate', 'Greater', 'Major', 'Supreme'];
    return (
      <div className="sd-runes">
        <span className="sd-uses-title">Runes</span>
        <div className="sd-rune-row">
          <label className="sd-rune-field">
            Reinforcing
            <select
              value={runes.reinforcing ?? ''}
              onChange={(e) => apply({ ...runes, reinforcing: (e.target.value ? Number(e.target.value) : undefined) as ArmorRunes['reinforcing'] })}
            >
              <option value="">None</option>
              {[1, 2, 3, 4, 5, 6].map((t) => (
                <option key={t} value={t}>
                  {REINFORCING_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    );
  }

  const slot = item.itemType; // 'weapon' | 'armor'
  const potency = runes.potency ?? 0;
  const propSlots = Math.min(potency, 3);
  const setProperty = (i: number, id: string) => {
    const property = [...(runes.property ?? [])];
    if (id) property[i] = id;
    else property.splice(i, 1);
    apply({ ...runes, property });
  };

  let propPicker: ReactNode = null;
  if (pickingSlot != null) {
    const slotIdx = pickingSlot;
    const current = (runes.property ?? [])[slotIdx];
    propPicker = (
      <FilterableSelect
        title={`Property rune ${slotIdx + 1}`}
        items={propItems}
        spec={RUNE_SPEC}
        rowKey={(it) => it.id}
        onClose={() => setPickingSlot(null)}
        headerExtra={
          current ? (
            <button
              className="fsel-arch"
              onClick={() => {
                setProperty(slotIdx, '');
                setPickingSlot(null);
              }}
            >
              Clear
            </button>
          ) : undefined
        }
        renderRow={(it, openDesc) => {
          const node = descNodeOf(it, 'items');
          const r = content.runes[it.id];
          const usedElsewhere = (runes.property ?? []).some((p, idx) => idx !== slotIdx && p === it.id);
          return (
            <PickerRow
              lead={<span className="ff-trait">lvl {it.level}</span>}
              name={it.name}
              meta={<div className="picker-traits">{r?.damage ? `+${r.damage.dice}${r.damage.die} ${r.damage.type}` : `Level ${it.level}`}</div>}
              onOpenDesc={node ? () => openDesc(node) : undefined}
              selectLabel="Etch"
              chosen={current === it.id}
              selectDisabled={usedElsewhere}
              onSelect={() => {
                setProperty(slotIdx, it.id);
                setPickingSlot(null);
              }}
            />
          );
        }}
      />
    );
  }

  return (
    <>
    <div className="sd-runes">
      <span className="sd-uses-title">Runes</span>
      <div className="sd-rune-row">
        <label className="sd-rune-field">
          Potency
          <select
            value={potency}
            onChange={(e) => {
              const v = Number(e.target.value);
              apply({ ...runes, potency: v as 0 | 1 | 2 | 3, property: (runes.property ?? []).slice(0, Math.min(v, 3)) });
            }}
          >
            <option value={0}>None</option>
            <option value={1}>+1</option>
            <option value={2}>+2</option>
            <option value={3}>+3</option>
          </select>
        </label>
        {slot === 'weapon' ? (
          <label className="sd-rune-field">
            Striking
            <select value={runes.striking ?? ''} onChange={(e) => apply({ ...runes, striking: (e.target.value || undefined) as WeaponRunes['striking'] })}>
              <option value="">None</option>
              <option value="striking">Striking</option>
              <option value="greater">Greater</option>
              <option value="major">Major</option>
            </select>
          </label>
        ) : (
          <label className="sd-rune-field">
            Resilient
            <select value={runes.resilient ?? ''} onChange={(e) => apply({ ...runes, resilient: (e.target.value || undefined) as ArmorRunes['resilient'] })}>
              <option value="">None</option>
              <option value="resilient">Resilient</option>
              <option value="greater">Greater</option>
              <option value="major">Major</option>
            </select>
          </label>
        )}
      </div>
      {propSlots > 0 ? (
        <div className="sd-rune-props">
          {Array.from({ length: propSlots }, (_, i) => {
            const chosenId = (runes.property ?? [])[i];
            const chosenName = chosenId ? content.items[chosenId]?.name ?? content.runes[chosenId]?.name ?? chosenId : null;
            return (
              <div className="sd-rune-field" key={i}>
                Property {i + 1}
                <button
                  type="button"
                  className={'sd-rune-pick' + (chosenName ? ' is-picked' : ' is-empty')}
                  onClick={() => setPickingSlot(i)}
                >
                  <span className="sd-rune-pick-val">{chosenName ?? 'Add a rune…'}</span>
                  {chosenName ? (
                    <span
                      className="sd-rune-clear"
                      role="button"
                      aria-label="Remove rune"
                      onClick={(e) => {
                        e.stopPropagation();
                        setProperty(i, '');
                      }}
                    >
                      <i className="ti ti-x" aria-hidden="true" />
                    </span>
                  ) : (
                    <i className="ti ti-search" aria-hidden="true" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <span className="sd-rune-hint">Add a potency rune to unlock property-rune slots.</span>
      )}
    </div>
    {propPicker}
    </>
  );
}

/** Affix/peel talismans, spellhearts, and banners onto a weapon/armor/shield host. */
function AttachmentsSection({
  host,
  hostItem,
  inventory,
  content,
  onPlay,
}: {
  host: InventoryItem;
  hostItem: Item;
  inventory: InventoryItem[];
  content: ContentDatabase;
  onPlay: PlayUpdater;
}) {
  if (!['weapon', 'armor', 'shield'].includes(hostItem.itemType)) return null;
  const attached = inventory.filter((i) => i.attachedTo === host.instanceId);
  const candidates = inventory.filter((i) => {
    if (i.instanceId === host.instanceId || i.attachedTo) return false;
    const def = content.items[i.itemId];
    return !!def && canAttachTo(def, hostItem.itemType);
  });

  return (
    <div className="sd-attach">
      <span className="sd-uses-title">Attached</span>
      {attached.length === 0 ? (
        <span className="sd-rune-hint">Nothing affixed.</span>
      ) : (
        <ul className="sd-attach-list">
          {attached.map((a) => {
            const def = content.items[a.itemId];
            const isTalisman = def?.itemType === 'consumable' && def.consumableType === 'talisman';
            return (
              <li key={a.instanceId}>
                <span className="sd-attach-name">{def?.name ?? a.itemId}</span>
                {isTalisman && (
                  <button
                    className="sd-attach-btn"
                    title="Activate — a talisman is consumed when used"
                    onClick={async () => {
                      if (
                        await confirmDialog({
                          title: `Activate ${def?.name ?? 'talisman'}?`,
                          message: 'A talisman is consumed when activated.',
                          confirmLabel: 'Activate',
                          danger: true,
                        })
                      )
                        onPlay((p) => (a.quantity > 1 ? setItemQuantity(p, a.instanceId, a.quantity - 1) : removeInventoryItem(p, a.instanceId)));
                    }}
                  >
                    Activate
                  </button>
                )}
                <button className="sd-attach-btn" onClick={() => onPlay((p) => detachItem(p, a.instanceId))}>
                  Peel
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {candidates.length > 0 && (
        <select
          className="sd-attach-add"
          value=""
          onChange={(e) => {
            if (e.target.value) onPlay((p) => attachItem(p, e.target.value, host.instanceId));
          }}
        >
          <option value="">Affix an item…</option>
          {candidates.map((c) => (
            <option key={c.instanceId} value={c.instanceId}>
              {content.items[c.itemId]?.name ?? c.itemId}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
