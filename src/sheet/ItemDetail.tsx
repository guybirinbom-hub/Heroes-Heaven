import { useState } from 'react';
import type { Character, ContentDatabase, InventoryItem, Item, ItemDesignation } from '../rules/types';
import { removeInventoryItem, setItemCounter, setItemDesignation, setItemQuantity, toggleItemMode, updateInventoryItem, useConsumable, type PlayUpdater } from '../rules/play';
import { containerOptionsFor } from '../rules/derive';
import { formatPrice } from '../rules/wealth';
import { useEscapeClose } from './useEscapeClose';
import { useIsMobile } from './useIsMobile';
import { confirmDialog } from './confirm';
import { chargesFor, itemCounters } from '../rules/itemUses';
import { traitDesc, traitLabel } from '../rules/glossary';
import { InfoTerm } from './InfoTerm';
import { DescBody } from './DescBody';
import { CritSpecText } from './CritSpecText';
import { critSpec } from '../rules/critSpec';
import { PinStar } from './PinStar';
import { ActionGlyph } from './widgets';
import { mpApplied } from '../rules/monsterParts';
import { MpProse } from './MpProse';
import { MpPathTerm, MpPropertyTerm } from './MpTermLinks';
import { FilterableSelect, PickerRow, descNodeOf } from './FilterableSelect';
import { SPELL_SPEC_BUILDER } from './filterSpecs';
import { isFormulaBook } from '../rules/formulaBook';
import { FormulaBookPanel } from './FormulaBookPanel';

const ordinalRank = (n: number): string => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

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

/** Usage is stored as a Foundry slug ("held-in-one-hand", "held-in-two-hands"), which read as raw
 *  data on the item card. Turn it into prose. */
function usageLabel(usage?: string): string | undefined {
  if (!usage) return undefined;
  const s = usage.replace(/-/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  charLevel = 1,
  activeModes = [],
  designationKinds = [],
  feats = [],
  gmView = false,
  onEdit,
  character,
}: {
  inv: InventoryItem;
  item: Item;
  content: ContentDatabase;
  onClose: () => void;
  onPlay?: PlayUpdater;
  /** The character's full inventory — needed to show affixed attachments. */
  inventory?: InventoryItem[];
  /** The character's feats — only so the stow control sizes containers the same way the Inventory
   *  tab does (Pack Rat adds 50% to a mundane container). Omitted = printed capacity. */
  feats?: Character["feats"];
  /** The GM’s view of a shared character — unlocks planting a cursed item disguised as its twin. */
  gmView?: boolean;
  /** "Individual day tracking of rations" option — suppress the Rations days counter. */
  rationsDayTracking?: boolean;
  /** Character level — caps the applied Monster-Parts effect readout. */
  charLevel?: number;
  /** The modes currently switched on — so a non-consumable's Activate button knows its own state. */
  activeModes?: readonly { id: string }[];
  /** Designations this character's class can use ('innovation' for an inventor, …). The caller knows
   *  the class; this component renders only what it is given. Empty = no designation control. */
  designationKinds?: readonly { kind: ItemDesignation; label: string }[];
  /** Opens the item editor for this item + instance (runes/attachments live there). */
  onEdit?: (item: Item, inv: InventoryItem) => void;
  /** The owner — the ONE control here that needs the whole character rather than a slice of it: a
   *  formula book's empty slots come from every feat and class feature the character owns. */
  character?: Character;
}) {
  useEscapeClose(onClose);
  const isMobile = useIsMobile();
  const [pickingSpell, setPickingSpell] = useState(false);
  const runes = runeLines(inv);
  // The mode this item carries, if any. A consumable switches its own on when used; anything else
  // needs the Activate control below, or the mode is unreachable.
  const itemMode = Object.values(content.modes ?? {}).find((m) => m.fromItemId === item.id);
  const itemModeOn = !!itemMode && activeModes.some((m) => m.id === itemMode.id);
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
  // Applied Monster-Parts effects (refinement benefits + imbued property effects) for the readout.
  const applied = mpApplied(inv.monsterPart, item.itemType === 'weapon' ? item.damage.type : undefined, charLevel);
  // Shared by the header trash icon and the footer "Remove item" button — one confirm, one path.
  const removeItem = async () => {
    if (!onPlay) return;
    // A cursed item that STICKS cannot simply be taken off. The app does not enforce that — the GM
    // does — so this tells the player to ask, rather than letting them discover later that it came
    // back. Remove still works: it is a table aid, not a lock.
    const stuckOk = item.stuck
      ? await confirmDialog({
          title: `${item.name} won't come off`,
          message:
            "This item can't simply be removed — ask your GM whether you can be rid of it, and how. Removing it here only changes your sheet; it doesn't ask anyone for you.",
          confirmLabel: 'Remove anyway',
          cancelLabel: 'Keep it',
          danger: true,
        })
      : await confirmDialog({ title: `Remove ${item.name}?`, message: 'This removes the item (and any runes or attachments on it) from your inventory. You can undo with Ctrl+Z.', confirmLabel: 'Remove', danger: true });
    if (!stuckOk) return;
    onPlay((p) => removeInventoryItem(p, id));
    onClose();
  };
  const attached = inventory.filter((i) => i.attachedTo === inv.instanceId);
  // If THIS item is affixed to something, name the host so the card can show it.
  const host = inv.attachedTo ? inventory.find((i) => i.instanceId === inv.attachedTo) : undefined;
  const hostName = host ? content.items[host.itemId]?.name : undefined;
  return (
    <>
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker spell-detail" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="sd-head-name">{item.name}</span>
          <span className="sd-head-actions">
            <PinStar node={{ title: item.name, description: item.description, descRefs: item.descRefs, key: 'items' }} />
            {editable && (
              <i className="ti ti-pencil" style={{ cursor: 'pointer' }} title="Edit item" onClick={() => onEdit!(item, inv)} aria-label="Edit item" />
            )}
            {/* Delete lives in the ALWAYS-VISIBLE header. On a phone it is joined by the pinned
             * Remove bar below the body (a tap target beats a 15px icon in a crowded header); on
             * desktop this icon is the only one. Same confirm dialog either way. */}
            {onPlay && (
              <button className="picker-close sd-head-remove" onClick={removeItem} aria-label={`Remove ${item.name}`} title="Remove item">
                <i className="ti ti-trash" aria-hidden="true" />
              </button>
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
                  <InfoTerm className={'ff-trait' + (CATEGORY_TAGS.includes(t) ? ' category' : '')} key={t} title={traitLabel(t)} description={traitDesc(t, content)}>
                  {traitLabel(t)}
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
          {item.isMonsterPart && (
            <div className="sd-traits">
              <span className="ff-trait category">
                <i className="ti ti-bone" aria-hidden="true" /> Monster Part
              </span>
              {(item.monsterPartTags ?? []).map((t) => (
                <span className="ff-trait" key={t}>
                  {t}
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
            <Stat k="Usage" v={wornSlot(item.usage) ? undefined : usageLabel(item.usage)} />
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
          {/* A formula book IS its contents, so they sit above the item's own controls. */}
          {character && isFormulaBook(item) && (
            <FormulaBookPanel character={character} inv={inv} content={content} onPlay={onPlay} />
          )}
          {/* An item that says "choose one of N". The engine has always been ready to use the answer
              (buildCharacter resolves it for build gear, applyPlayState for gear bought in play), but
              nothing ever ASKED — 33 items carried a question with no screen to answer it on. It sits
              here, on the item itself, because that is where the player is holding it. */}
          {onPlay && (item.effectChoices ?? []).length > 0 && (
            <div className="sd-uses">
              <span className="sd-uses-title">Choices</span>
              {(item.effectChoices ?? []).map((ch) => {
                const value = inv.effectChoices?.[ch.id] ?? '';
                return (
                  <label className="sd-choice-row" key={ch.id}>
                    <span className="sd-choice-prompt">{ch.prompt}</span>
                    <select
                      value={value}
                      onChange={(e) =>
                        onPlay((p) => updateInventoryItem(p, inv.instanceId, { effectChoices: { ...(inv.effectChoices ?? {}), [ch.id]: e.currentTarget.value } }))
                      }
                    >
                      <option value="">Choose…</option>
                      {(ch.options ?? []).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          )}
          {/* The item's own embedded question ("Tradition", "Skill", the Lore a tattoo records).
              Nine of these set `daily: true` and are asked at daily preparations; the other ten were
              asked nowhere at all. The answer is kept beside the effect-choice answers, keyed by the
              choice's flag. */}
          {onPlay && item.choice && !item.choice.daily && (
            <div className="sd-uses">
              <span className="sd-uses-title">{item.choice.prompt}</span>
              <label className="sd-choice-row">
                {item.choice.kind === 'array' && (item.choice.options ?? []).length > 0 ? (
                  <select
                    value={inv.effectChoices?.[item.choice.flag] ?? ''}
                    onChange={(e) =>
                      onPlay((p) =>
                        updateInventoryItem(p, inv.instanceId, {
                          effectChoices: { ...(inv.effectChoices ?? {}), [item.choice!.flag]: e.currentTarget.value },
                        }),
                      )
                    }
                  >
                    <option value="">Choose…</option>
                    {(item.choice.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="Type an answer…"
                    value={inv.effectChoices?.[item.choice.flag] ?? ''}
                    onChange={(e) =>
                      onPlay((p) =>
                        updateInventoryItem(p, inv.instanceId, {
                          effectChoices: { ...(inv.effectChoices ?? {}), [item.choice!.flag]: e.currentTarget.value },
                        }),
                      )
                    }
                  />
                )}
              </label>
              {item.choice.inert && <div className="sd-choice-note">{item.choice.inert}</div>}
            </div>
          )}
          {onPlay && counters.length > 0 && (
            <div className="sd-uses">
              <span className="sd-uses-title">Uses</span>
              {counters.map((u) => (
                <span className="sd-uses-row" key={u.id}>
                  <button
                    className="sd-uses-btn"
                    onClick={() => onPlay((p) => setItemCounter(p, id, u.id, chargesFor(u, u.current - 1)), `uses:${id}:${u.id}`)}
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
                    onClick={() => onPlay((p) => setItemCounter(p, id, u.id, chargesFor(u, u.current + 1)), `uses:${id}:${u.id}`)}
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
          {/* Consuming one: quantity -1, and the item goes away entirely when that was the last of
              them. If the item carries a mode (an elixir that runs for a few minutes) this is what
              switches it on — item modes are hidden from the Modes panel, so using it is the only way. */}
          {onPlay && item.itemType === 'consumable' && (
            <div className="sd-uses">
              <span className="sd-uses-title">Use</span>
              <span className="sd-uses-row">
                <button className="sd-use-btn" onClick={() => onPlay((p) => useConsumable(p, id, content.modes), `use:${id}`)}>
                  <i className="ti ti-flask" aria-hidden="true" /> Use one
                </button>
                {inv.quantity <= 1 && <span className="sd-uses-hint">This is your last one — using it removes the item.</span>}
              </span>
            </div>
          )}
          {/* A NON-consumable that carries a mode — a Devilwing Badge, an activated shield. Item modes
              are hidden from the Modes panel, and "Use one" only shows for consumables, so 72 shipped
              modes had no route to the sheet at all. Activating does not spend the item. */}
          {onPlay && item.itemType !== 'consumable' && itemMode && (
            <div className="sd-uses">
              <span className="sd-uses-title">Activate</span>
              <span className="sd-uses-row">
                <button
                  className={'sd-use-btn' + (itemModeOn ? ' on' : '')}
                  onClick={() => onPlay((p) => toggleItemMode(p, id, content.modes), `mode:${id}`)}
                >
                  <i className={'ti ' + (itemModeOn ? 'ti-player-stop' : 'ti-player-play')} aria-hidden="true" />{' '}
                  {itemModeOn ? `Stop ${itemMode.name}` : itemMode.name}
                </button>
                {itemMode.duration && <span className="sd-uses-hint">{itemMode.duration}</span>}
              </span>
            </div>
          )}
          {/* Which class thing this item IS. Nothing linked a class choice to an inventory item, so
              every "your innovation gains…" modification pointed at an object the app could not name.
              Exclusive: marking one moves the designation off whatever held it before. */}
          {/* PLANT THIS CURSED ITEM HIDDEN. The subsystem behind it — the player sees the innocent
              twin, its name, description and bonuses, while the GM view keeps the true record — was
              fully wired in the rules layer and could never fire: no item carried `disguisedAs` and
              nothing anywhere set `hiddenCurse`. GM-only, because a player toggling it would be
              telling themselves the secret. */}
          {onPlay && gmView && item.disguisedAs && (
            <label className="sd-choice-row sd-hidden-curse">
              <input
                type="checkbox"
                checked={!!inv.hiddenCurse}
                onChange={(e) =>
                  onPlay((p) => updateInventoryItem(p, inv.instanceId, { hiddenCurse: e.currentTarget.checked || undefined }))
                }
              />
              <span>
                Planted hidden — the player sees {content.items[item.disguisedAs]?.name ?? item.disguisedAs}
              </span>
            </label>
          )}
          {onPlay && designationKinds.length > 0 && (
            <div className="sd-uses">
              <span className="sd-uses-title">This is my</span>
              <span className="sd-uses-row">
                {designationKinds.map(({ kind, label }) => {
                  const on = (inv.designations ?? []).includes(kind);
                  return (
                    <button
                      key={kind}
                      className={'sd-use-btn' + (on ? ' on' : '')}
                      title={on ? `Stop treating this as your ${label.toLowerCase()}` : `Treat this item as your ${label.toLowerCase()}`}
                      onClick={() => onPlay((p) => setItemDesignation(p, id, kind, !on), `desig:${id}:${kind}`)}
                    >
                      <i className={'ti ' + (on ? 'ti-check' : 'ti-plus')} aria-hidden="true" /> {label}
                    </button>
                  );
                })}
              </span>
            </div>
          )}
          {onPlay && (
            <div className="sd-uses">
              <span className="sd-uses-title">Quantity</span>
              <span className="sd-uses-row">
                <button
                  className="sd-uses-btn"
                  onClick={() => onPlay((p) => setItemQuantity(p, id, inv.quantity - 1), `qty:${id}`)}
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
                  onClick={() => onPlay((p) => setItemQuantity(p, id, inv.quantity + 1), `qty:${id}`)}
                  aria-label="Increase quantity"
                >
                  <i className="ti ti-plus" aria-hidden="true" />
                </button>
              </span>
            </div>
          )}
          {onPlay &&
            (() => {
              // Stow this item in a container (or take it out). This is the tap-friendly path — the
              // Inventory tab also allows drag-and-drop, but that's disabled on touch, so without this
              // control phone users can't nest anything and a backpack's ignored Bulk never applies.
              const opts = containerOptionsFor(inventory, content, id, feats);
              const currentId = inv.containerInstanceId;
              if (opts.length === 0 && !currentId) return null; // nothing to stow into and not stowed
              const currentName = currentId
                ? content.items[inventory.find((i) => i.instanceId === currentId)?.itemId ?? '']?.name ?? 'a container'
                : null;
              const stow = (dest?: string) =>
                onPlay(
                  (p) =>
                    updateInventoryItem(
                      p,
                      id,
                      dest
                        ? { containerInstanceId: dest, worn: false, equipped: false, invested: false }
                        : { containerInstanceId: undefined },
                    ),
                  `stow:${id}`,
                );
              return (
                <div className="sd-uses">
                  <span className="sd-uses-title">Container</span>
                  <div className="sd-container-chips">
                    <button className={'ec-chip' + (!currentId ? ' on' : '')} onClick={() => stow(undefined)}>
                      Carried
                    </button>
                    {opts.map((o) => (
                      <button
                        key={o.instanceId}
                        className={'ec-chip' + (o.current ? ' on' : '')}
                        disabled={!o.fits && !o.current}
                        onClick={() => stow(o.instanceId)}
                        title={
                          o.capacity != null
                            ? `${o.used}/${o.capacity} Bulk used${!o.fits && !o.current ? ' — no room' : ''}`
                            : undefined
                        }
                      >
                        {o.name}
                      </button>
                    ))}
                  </div>
                  <span className="sd-uses-hint">
                    {currentId
                      ? `Stowed in ${currentName} — a worn backpack ignores the first 2 Bulk of its contents.`
                      : 'Stow this in a worn container (e.g. a backpack ignores the first 2 Bulk it holds) to reduce your Bulk.'}
                  </span>
                </div>
              );
            })()}
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
              <span className="sd-uses-title">Critical specialization · {cap(item.group ?? '')}</span>
              <div className="sd-critspec-text">
                <CritSpecText text={critSpec(item.group)!} content={content} />
              </div>
              <span className="sd-uses-hint">Applies on a critical hit if you have critical specialization with this weapon group.</span>
            </div>
          )}
          {applied && (applied.refineLines.length > 0 || applied.imbuements.length > 0) && (
            <div className="sd-uses sd-mp-applied">
              <span className="sd-uses-title">
                <i className="ti ti-bone" aria-hidden="true" /> Monster Parts — refined item level {applied.refinedLevel || '—'}
              </span>
              {applied.refineLines.length > 0 && (
                <ul className="sd-mp-list">
                  {applied.refineLines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
              {applied.imbuements.map((im, i) => (
                <div className="sd-mp-imbue" key={i}>
                  <span className="sd-mp-imbue-name">
                    <MpPropertyTerm propertyId={im.propertyId}>{im.name}</MpPropertyTerm>
                    {im.pathName ? (
                      <>
                        {' · '}
                        <MpPathTerm pathId={im.pathId}>{im.pathName}</MpPathTerm>
                      </>
                    ) : (
                      ''
                    )}{' '}
                    <span className="sd-mp-imbue-lvl">lvl {im.level}</span>
                  </span>
                  {im.effects.length > 0 && (
                    <span className="sd-mp-imbue-eff">
                      <MpProse text={im.effects.join(' · ')} />
                    </span>
                  )}
                </div>
              ))}
              <span className="sd-uses-hint">These effects apply to this item while it's wielded/worn.</span>
            </div>
          )}
          <DescBody description={item.description} descRefs={item.descRefs} onExit={onClose} astKey="items" astId={item.id} />
        </div>
        {/* Remove: a PHONE-only bar, and deliberately a sibling of .sd-body rather than the last thing
         * inside it. As part of the scrolling panel it sat below the item's full description — a long
         * scroll past on a phone, which read as "there is no way to delete this". Here it is always on
         * screen. Desktop doesn't render it at all: the header's trash icon is already always visible,
         * and two controls for one destructive action is one too many. */}
        {onPlay && isMobile && (
          <div className="sd-remove">
            <button className="sd-remove-btn" aria-label={`Remove ${item.name}`} onClick={removeItem}>
              <i className="ti ti-trash" aria-hidden="true" /> Remove item
            </button>
          </div>
        )}
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
