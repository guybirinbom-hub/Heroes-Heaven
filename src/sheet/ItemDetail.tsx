import { useState } from 'react';
import type { Coins, ContentDatabase, InventoryItem, Item } from '../rules/types';
import { removeInventoryItem, setItemCounter, setItemQuantity, updateInventoryItem, type PlayState } from '../rules/play';
import { useEscapeClose } from './useEscapeClose';
import { chargesFor, itemCounters } from '../rules/itemUses';
import { traitDesc } from '../rules/glossary';
import { InfoTerm } from './InfoTerm';
import { DescBody } from './DescBody';
import { CritSpecText } from './CritSpecText';
import { critSpec } from '../rules/critSpec';
import { PinStar } from './PinStar';
import { ActionGlyph } from './widgets';
import { FilterableSelect, PickerRow, descNodeOf } from './FilterableSelect';
import { SPELL_SPEC_BUILDER } from './filterSpecs';
import { MonsterPartsSection } from './MonsterPartsEditor';

const ordinalRank = (n: number): string => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

function formatPrice(p?: Coins): string {
  if (!p) return '—';
  const parts: string[] = [];
  if (p.pp) parts.push(`${p.pp} pp`);
  if (p.gp) parts.push(`${p.gp} gp`);
  if (p.sp) parts.push(`${p.sp} sp`);
  if (p.cp) parts.push(`${p.cp} cp`);
  return parts.length ? parts.join(', ') : '—';
}

function formatBulk(b: number): string {
  if (b === 0) return '—';
  if (b === 0.1) return 'L';
  return String(b);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const TYPE_LABEL: Record<string, string> = {
  weapon: 'Weapon',
  armor: 'Armor',
  shield: 'Shield',
  consumable: 'Consumable',
  container: 'Container',
  equipment: 'Equipment',
  treasure: 'Treasure',
};

/** A row in the item stat block. */
function Stat({ k, v }: { k: string; v: string | number | undefined }) {
  if (v === undefined || v === '' || v === null) return null;
  return (
    <div className="sd-stat">
      <span className="sd-stat-k">{k}</span>
      <span className="sd-stat-v">{v}</span>
    </div>
  );
}

/** Per-type stat rows. */
function typeStats(item: Item, content: ContentDatabase): { k: string; v: string | number | undefined }[] {
  switch (item.itemType) {
    case 'weapon':
      return [
        { k: 'Category', v: cap(item.category) },
        { k: 'Group', v: item.group ? cap(item.group) : undefined },
        { k: 'Damage', v: `${item.damage.dice}${item.damage.die} ${item.damage.type}` },
        { k: 'Range', v: item.range ? `${item.range} ft` : undefined },
        { k: 'Reload', v: item.reload },
      ];
    case 'armor':
      return [
        { k: 'Category', v: cap(item.category) },
        { k: 'AC bonus', v: `+${item.acBonus}` },
        { k: 'Dex cap', v: item.dexCap != null ? `+${item.dexCap}` : undefined },
        { k: 'Check penalty', v: item.checkPenalty ? String(item.checkPenalty) : undefined },
        { k: 'Speed penalty', v: item.speedPenalty ? `${item.speedPenalty} ft` : undefined },
        { k: 'Strength', v: item.strength },
      ];
    case 'shield':
      return [
        { k: 'AC bonus', v: `+${item.acBonus}` },
        { k: 'Hardness', v: item.hardness },
        { k: 'HP', v: `${item.hp} (BT ${item.brokenThreshold})` },
      ];
    case 'consumable': {
      const sp = item.spell ? content.spells[item.spell.spellId] : undefined;
      return [
        { k: 'Type', v: item.consumableType ? cap(item.consumableType) : undefined },
        { k: 'Uses', v: item.uses ? `${item.uses.current} / ${item.uses.max}` : undefined },
        { k: 'Spell', v: sp ? `${sp.name} (rank ${item.spell!.rank})` : undefined },
      ];
    }
    case 'container':
      return [
        { k: 'Capacity', v: item.capacity ? `${item.capacity.bulk} Bulk` : undefined },
        { k: 'Ignores', v: item.ignoredBulk ? `${item.ignoredBulk} Bulk` : undefined },
      ];
    default:
      return [];
  }
}

const REINFORCING_NAMES = ['', 'Minor', 'Lesser', 'Moderate', 'Greater', 'Major', 'Supreme'];

function runeLines(inv: InventoryItem): string[] {
  const r = inv.runes as
    | { potency?: number; striking?: string; resilient?: string; reinforcing?: number; property?: string[] }
    | undefined;
  if (!r) return [];
  const out: string[] = [];
  if (r.potency) out.push(`+${r.potency} potency`);
  if (r.striking) out.push(`${cap(r.striking)} striking`);
  if (r.resilient) out.push(`${cap(r.resilient)} resilient`);
  if (r.reinforcing) out.push(`${REINFORCING_NAMES[r.reinforcing]} reinforcing`);
  for (const p of r.property ?? []) out.push(cap(p.replace(/-/g, ' ')));
  return out;
}

/** Special item categories worth badging prominently (they're plain traits in the data). */
const CATEGORY_TAGS = ['intelligent', 'cursed', 'relic', 'artifact', 'apex'];

/** A friendly material label, e.g. "Cold iron (high)". */
function materialLabel(item: Item): string | undefined {
  if (!item.material) return undefined;
  return cap(item.material.type.replace(/-/g, ' ')) + (item.material.grade ? ` (${item.material.grade})` : '');
}

/** A friendly worn body-slot from a "worn…" usage string, e.g. "wornring" → "Ring". */
function wornSlot(usage?: string): string | undefined {
  if (!usage || !usage.startsWith('worn')) return undefined;
  const rest = usage.replace(/^worn-?/, '');
  return rest ? cap(rest.replace(/-/g, ' ')) : 'Worn';
}

/** Full item detail overlay (reuses the .picker / .sd-* chrome). */
export function ItemDetail({
  inv,
  item,
  content,
  onClose,
  onPlay,
  inventory = [],
  rationsDayTracking = false,
  monsterPartsOn = false,
  charLevel = 1,
  onEdit,
}: {
  inv: InventoryItem;
  item: Item;
  content: ContentDatabase;
  onClose: () => void;
  onPlay?: (fn: (play: PlayState) => PlayState) => void;
  /** The character's full inventory — needed to show affixed attachments. */
  inventory?: InventoryItem[];
  /** "Individual day tracking of rations" option — suppress the Rations days counter. */
  rationsDayTracking?: boolean;
  /** Whether the Monster Parts subsystem is unlocked for this character (shows refine/imbue controls). */
  monsterPartsOn?: boolean;
  /** Character level — caps refinement / imbued-property levels. */
  charLevel?: number;
  /** Opens the item editor for this item + instance (runes/attachments live there). */
  onEdit?: (item: Item, inv: InventoryItem) => void;
}) {
  useEscapeClose(onClose);
  const [pickingSpell, setPickingSpell] = useState(false);
  const runes = runeLines(inv);
  const counters = rationsDayTracking && item.id === 'rations' ? [] : itemCounters(item, inv);
  const id = inv.instanceId;
  const storedSpell = inv.heldSpell ? content.spells[inv.heldSpell] : undefined;
  // Spells legal for a generic scroll/wand: the slot's rank, the right tradition (if locked), no rituals.
  const slotSpellOptions = item.spellSlot
    ? Object.values(content.spells).filter(
        (s) =>
          s.rank === item.spellSlot!.rank &&
          !s.ritual &&
          (!item.spellSlot!.traditions?.length || (s.traditions ?? []).some((t) => item.spellSlot!.traditions!.includes(t))),
      )
    : [];
  // Any item can be edited when an editor is wired in. A homebrew item edits in place;
  // a built-in item is copied for this character (copy-on-write). Runes live on the edit page.
  const editable = !!onEdit;
  const attached = inventory.filter((i) => i.attachedTo === inv.instanceId);
  // If THIS item is affixed to something, name the host so the card can show it.
  const host = inv.attachedTo ? inventory.find((i) => i.instanceId === inv.attachedTo) : undefined;
  const hostName = host ? content.items[host.itemId]?.name : undefined;
  return (
    <>
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker spell-detail" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {item.name}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, alignItems: 'center' }}>
            <PinStar node={{ title: item.name, description: item.description, descRefs: item.descRefs, key: 'items' }} />
            {editable && (
              <i className="ti ti-pencil" style={{ cursor: 'pointer' }} title="Edit item" onClick={() => onEdit!(item, inv)} aria-label="Edit item" />
            )}
            <button className="picker-close" onClick={onClose} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="sd-body">
          <div className="sd-sub">
            {TYPE_LABEL[item.itemType] ?? item.itemType} · level {item.level}
            {item.rarity && item.rarity !== 'common' ? ` · ${cap(item.rarity)}` : ''}
          </div>
          {item.traits?.length > 0 && (
            <div className="sd-traits">
              {[...item.traits]
                .sort((a, b) => (CATEGORY_TAGS.includes(b) ? 1 : 0) - (CATEGORY_TAGS.includes(a) ? 1 : 0))
                .map((t) => (
                  <InfoTerm className={'ff-trait' + (CATEGORY_TAGS.includes(t) ? ' category' : '')} key={t} title={cap(t)} description={traitDesc(t, content)}>
                    {t}
                  </InfoTerm>
                ))}
            </div>
          )}
          {runes.length > 0 && (
            <div className="sd-traits">
              {runes.map((r) => (
                <span className="ff-trait rune" key={r}>
                  {r}
                </span>
              ))}
            </div>
          )}
          <div className="sd-stats">
            {typeStats(item, content).map((s) => (
              <Stat key={s.k} k={s.k} v={s.v} />
            ))}
            <Stat k="Material" v={materialLabel(item)} />
            <Stat k="Worn slot" v={wornSlot(item.usage)} />
            <Stat k="Price" v={formatPrice(item.price)} />
            <Stat k="Bulk" v={formatBulk(item.bulk)} />
            <Stat k="Usage" v={wornSlot(item.usage) ? undefined : item.usage} />
            <Stat k="Hands" v={item.hands ? String(item.hands) : undefined} />
          </div>
          {attached.length > 0 && (
            <div className="sd-attach">
              <span className="sd-uses-title">Attached</span>
              <ul className="sd-attach-list">
                {attached.map((a) => (
                  <li key={a.instanceId}>
                    <span className="sd-attach-name">{content.items[a.itemId]?.name ?? a.itemId}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {inv.attachedTo && (
            <div className="sd-attach">
              <span className="sd-rune-hint">Affixed to {hostName ?? 'an item'}.</span>
            </div>
          )}
          {onPlay && counters.length > 0 && (
            <div className="sd-uses">
              <span className="sd-uses-title">Uses</span>
              {counters.map((u) => (
                <span className="sd-uses-row" key={u.id}>
                  <button
                    className="sd-uses-btn"
                    onClick={() => onPlay((p) => setItemCounter(p, id, u.id, chargesFor(u, u.current - 1)))}
                    disabled={u.current <= 0}
                    aria-label="Spend a use"
                  >
                    <i className="ti ti-minus" aria-hidden="true" />
                  </button>
                  <span className="sd-uses-count">
                    <strong>{u.current}</strong> / {u.max}
                  </span>
                  <button
                    className="sd-uses-btn"
                    onClick={() => onPlay((p) => setItemCounter(p, id, u.id, chargesFor(u, u.current + 1)))}
                    disabled={u.current >= u.max}
                    aria-label="Restore a use"
                  >
                    <i className="ti ti-plus" aria-hidden="true" />
                  </button>
                  <span className="sd-uses-per">{u.label}</span>
                </span>
              ))}
              {counters.some((u) => u.resetsOnRest) && <span className="sd-uses-hint">Refills on daily preparations.</span>}
            </div>
          )}
          {onPlay && (
            <div className="sd-uses">
              <span className="sd-uses-title">Quantity</span>
              <span className="sd-uses-row">
                <button
                  className="sd-uses-btn"
                  onClick={() => onPlay((p) => setItemQuantity(p, id, inv.quantity - 1))}
                  disabled={inv.quantity <= 1}
                  aria-label="Decrease quantity"
                >
                  <i className="ti ti-minus" aria-hidden="true" />
                </button>
                <span className="sd-uses-count">
                  <strong>{inv.quantity}</strong>
                </span>
                <button
                  className="sd-uses-btn"
                  onClick={() => onPlay((p) => setItemQuantity(p, id, inv.quantity + 1))}
                  aria-label="Increase quantity"
                >
                  <i className="ti ti-plus" aria-hidden="true" />
                </button>
              </span>
            </div>
          )}
          {item.spellSlot && (
            <div className="sd-uses">
              <span className="sd-uses-title">Stored spell</span>
              {onPlay ? (
                <button className="ec-chip on" onClick={() => setPickingSpell(true)}>
                  {storedSpell ? storedSpell.name : `Choose a ${ordinalRank(item.spellSlot.rank)}-rank spell…`}
                </button>
              ) : (
                <span className="sd-uses-count">{storedSpell ? storedSpell.name : 'none chosen'}</span>
              )}
              <span className="sd-uses-hint">
                Any {ordinalRank(item.spellSlot.rank)}-rank
                {item.spellSlot.traditions?.length ? ` ${item.spellSlot.traditions.map(cap).join('/')}` : ''} spell on your spell list.
              </span>
            </div>
          )}
          {item.itemType === 'weapon' && critSpec(item.group) && (
            <div className="sd-uses sd-critspec">
              <span className="sd-uses-title">Critical specialization · {item.group}</span>
              <div className="sd-critspec-text">
                <CritSpecText text={critSpec(item.group)!} content={content} />
              </div>
              <span className="sd-uses-hint">Applies on a critical hit if you have critical specialization with this weapon group.</span>
            </div>
          )}
          {onPlay && monsterPartsOn && <MonsterPartsSection inv={inv} item={item} charLevel={charLevel} onPlay={onPlay} />}
          <DescBody description={item.description} descRefs={item.descRefs} onExit={onClose} />
          {onPlay && (
            <div className="sd-remove">
              <button
                className="sd-remove-btn"
                aria-label="Remove item"
                onClick={() => {
                  onPlay((p) => removeInventoryItem(p, id));
                  onClose();
                }}
              >
                <i className="ti ti-trash" aria-hidden="true" /> Remove item
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
    {pickingSpell && item.spellSlot && onPlay && (
      <FilterableSelect
        title={`Store a ${ordinalRank(item.spellSlot.rank)}-rank spell`}
        items={slotSpellOptions}
        spec={SPELL_SPEC_BUILDER}
        rowKey={(s) => s.id}
        onClose={() => setPickingSpell(false)}
        headerExtra={
          inv.heldSpell ? (
            <button
              className="fsel-arch"
              onClick={() => {
                onPlay((p) => updateInventoryItem(p, id, { heldSpell: undefined }));
                setPickingSpell(false);
              }}
            >
              Clear
            </button>
          ) : undefined
        }
        renderRow={(s, openDesc) => {
          const node = descNodeOf(s, 'spells');
          return (
            <PickerRow
              lead={
                <span className="spell-cost">
                  <ActionGlyph cost={s.cast} />
                </span>
              }
              name={s.name}
              meta={<div className="picker-traits">{ordinalRank(s.rank)} rank</div>}
              onOpenDesc={node ? () => openDesc(node) : undefined}
              selectLabel="Store"
              onSelect={() => {
                onPlay((p) => updateInventoryItem(p, id, { heldSpell: s.id }));
                setPickingSpell(false);
              }}
            />
          );
        }}
      />
    )}
    </>
  );
}
