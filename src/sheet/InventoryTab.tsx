import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Character, CompanionConfig, ContentDatabase, InventoryItem, Item, SiegeWeaponStat, VehicleStat } from '../rules/types';
import { useIsMobile } from './useIsMobile';
import { deriveBulk, containerLoads, effectiveItemBulk } from '../rules/derive';
import { isAttachable, planAttach } from '../rules/attachments';
import {
  addInventoryItem,
  addPlayCompanion,
  attachItem,
  buyCompanion,
  buyItem,
  removeInventoryItem,
  removePlayCompanion,
  setCurrency,
  setItemCounter,
  setItemQuantity,
  toggleItemFlag,
  updateInventoryItem,
  type PlayUpdater,
} from '../rules/play';
import { parsePrice } from '../rules/wealth';
import type { CompanionPick } from './AddItemsModal';
import { chargesFor, itemCounters } from '../rules/itemUses';
import { formatPrice, grp } from '../rules/wealth';
import { ItemDetail } from './ItemDetail';
import { confirmDialog } from './confirm';
import { ActionGlyph, isActionCost } from './widgets';
import { AddItemsModal } from './AddItemsModal';
import { ItemEditorModal } from './ItemEditorModal';

const TYPE_ICON: Record<string, string> = {
  weapon: 'ti-sword',
  armor: 'ti-shirt',
  shield: 'ti-shield',
  consumable: 'ti-flask',
  container: 'ti-backpack',
  equipment: 'ti-package',
  treasure: 'ti-coin',
};

function formatBulk(b: number): string {
  if (b === 0) return '—';
  if (b === 0.1) return 'L';
  return String(b);
}


/** A scroll/wand reads as "Scroll of <Spell>"; otherwise the item's own name. */
function displayName(item: Item, content: ContentDatabase): string {
  if (item.itemType === 'consumable' && item.spell && (item.consumableType === 'scroll' || item.consumableType === 'wand')) {
    const sp = content.spells[item.spell.spellId];
    if (sp) return `${item.consumableType === 'wand' ? 'Wand' : 'Scroll'} of ${sp.name}`;
  }
  return item.name;
}

/** Special item categories worth badging on the card (they're plain traits in the data). */
const CATEGORY_TAGS = ['intelligent', 'cursed', 'relic', 'artifact', 'apex'];
const capWord = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function stateBadge(inv: InventoryItem): { label: string; kind: string } | null {
  if (inv.invested) return { label: 'Invested', kind: 'invested' };
  if (inv.equipped) return { label: 'Wielded', kind: 'worn' };
  if (inv.worn) return { label: 'Worn', kind: 'worn' };
  return null;
}

/** The primary equip action for an item type: armor is worn, weapons/shields are wielded. */
function equipControl(item: Item): { flag: 'worn' | 'equipped'; on: string; off: string } | null {
  if (item.itemType === 'armor') return { flag: 'worn', on: 'Worn', off: 'Wear' };
  // Material/precious-metal placeholder "weapons" (ingots, chunks) carry no damage object — they aren't
  // really wieldable, so don't offer a Wield control (deriveStrike guards the same case for safety).
  if (item.itemType === 'weapon' && !item.damage) return null;
  if (item.itemType === 'weapon' || item.itemType === 'shield') return { flag: 'equipped', on: 'Wielded', off: 'Wield' };
  return null;
}

/** Equipment-typed gear that's expended / used in quantity — a torch burns out, caltrops and
 *  marbles scatter, pitons get hammered in and left — but that the source data doesn't tag
 *  'consumable'. Listed by id so they get the inline +/- stepper like potions do, even when the
 *  player happens to carry just one. (Most other expendables — rations, candles, chalk, oils,
 *  alchemical items — are already itemType 'consumable'; ammunition carries the 'consumable' trait.) */
const EXPENDABLE_GEAR = new Set(['torch', 'caltrops', 'marbles', 'piton']);

/** Which item CATEGORIES keep the inline +/- quantity stepper on the card (the rest show a static ×N
 *  badge next to the name when carried as a stack). Per the user's rule, only genuinely stocked/expended
 *  goods get the stepper:
 *    • Consumables    — itemType 'consumable' (potions, oils, scrolls, candles, chalk, rations, …)
 *    • Trade Goods    — itemType 'treasure' (gems, art objects, coins, precious-material objects)
 *    • Alchemical     — the 'alchemical' trait (bombs, elixirs, poisons, …)
 *    • Materials      — the 'precious' trait = raw precious-material goods (adamantine/mithral chunks &
 *                       ingots). NOT item.material, which flags weapons/armor MADE OF a material — a
 *                       cold-iron longsword is a weapon, so it stays ×N.
 *    • Ammunition     — the 'consumable' trait; Thrown weapons — 'thrown' / 'thrown-N' (used in quantity)
 *  Everything else (weapons, armor, shields, worn/held gear, and most Adventuring Gear like a backpack,
 *  rope, or lantern) shows ×N even when stacked. Adventuring Gear that IS expended but the source doesn't
 *  tag 'consumable' — a torch burns out, caltrops/marbles scatter, a piton is left behind — is curated in
 *  EXPENDABLE_GEAR. */
function keepsInlineQuantity(item: Item): boolean {
  const traits = item.traits ?? [];
  if (item.itemType === 'consumable' || item.itemType === 'treasure') return true;
  if (traits.includes('alchemical') || traits.includes('precious') || traits.includes('consumable')) return true;
  if (item.itemType === 'weapon' && (traits.includes('thrown') || traits.some((t) => t.startsWith('thrown-')))) return true;
  if (EXPENDABLE_GEAR.has(item.id)) return true;
  return false;
}

/** A consumable for the purposes of the inventory colour-highlight: itemType 'consumable' (potions,
 *  oils, scrolls, elixirs, …) OR anything carrying the 'consumable' trait (ammunition, etc.). Matches
 *  the consumable arm of keepsInlineQuantity so the highlighted items are exactly the expendables. */
function isConsumable(item: Item): boolean {
  return item.itemType === 'consumable' || (item.traits ?? []).includes('consumable');
}

/** PF2e caps a character at 10 invested magic items. */
const INVESTED_LIMIT = 10;

function ItemCard({
  inv,
  item,
  content,
  onOpen,
  onPlay,
  investedCount = 0,
  rationsDayTracking = false,
  isMobile = false,
  onDragStartItem,
  onDragEndItem,
  onHoldDrag,
  dragging = false,
  attachHost = false,
  attachValid = false,
  attachOver = false,
  onAttachOver,
  onAttachLeave,
  onAttachDrop,
}: {
  inv: InventoryItem;
  item: Item;
  content: ContentDatabase;
  onOpen: () => void;
  onPlay?: PlayUpdater;
  investedCount?: number;
  /** "Individual day tracking of rations" option — suppress the Rations days counter. */
  rationsDayTracking?: boolean;
  /** Phone layout: disable the desktop HTML5 drag (cards aren't draggable on touch). */
  isMobile?: boolean;
  onDragStartItem?: (instanceId: string) => void;
  onDragEndItem?: () => void;
  /** Phone hold-to-move: press-and-hold the card to pick the item up (pointerdown starts the hold timer). */
  onHoldDrag?: (instanceId: string, e: React.PointerEvent) => void;
  /** This card is the one currently being lifted on mobile — dim it in place while it's "in transit". */
  dragging?: boolean;
  /** This card is a potential drop target for the attachment/rune currently being dragged. */
  attachHost?: boolean;
  /** The dragged attachment/rune would actually be accepted here (drives the green outline). */
  attachValid?: boolean;
  attachOver?: boolean;
  onAttachOver?: (instanceId: string) => void;
  onAttachLeave?: () => void;
  onAttachDrop?: (srcId: string, hostId: string) => void;
}) {
  const badge = stateBadge(inv);
  const equip = equipControl(item);
  const counters = rationsDayTracking && item.id === 'rations' ? [] : itemCounters(item, inv);
  const investable = item.traits?.includes('invested');
  const inlineQty = keepsInlineQuantity(item);
  // The delete button moved to the item detail popup, so only render the actions row when there's
  // still a control to show — otherwise plain items would keep an empty 7px-margin gap.
  const hasActions = !!inv.attachedTo || !!equip || !!investable || counters.length > 0 || inlineQty;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className={
        'inv-card' +
        (inv.invested ? ' invested' : '') +
        (isConsumable(item) ? ' consumable' : '') +
        ' clickable' +
        (onPlay ? ' draggable' : '') +
        (dragging ? ' inv-dragging' : '') +
        (attachHost && attachValid ? ' attach-target' : '') +
        (attachOver && attachValid ? ' attach-over' : '')
      }
      onClick={onOpen}
      onPointerDown={onHoldDrag ? (e) => onHoldDrag(inv.instanceId, e) : undefined}
      draggable={!!onPlay && !isMobile}
      onDragStart={
        onPlay
          ? (e) => {
              e.dataTransfer.setData('text/plain', inv.instanceId);
              e.dataTransfer.effectAllowed = 'copyMove';
              onDragStartItem?.(inv.instanceId);
            }
          : undefined
      }
      onDragEnd={onPlay ? () => onDragEndItem?.() : undefined}
      onDragOver={
        attachHost
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = attachValid ? 'copy' : 'none';
              onAttachOver?.(inv.instanceId);
            }
          : undefined
      }
      onDragLeave={attachHost ? () => onAttachLeave?.() : undefined}
      onDrop={
        attachHost
          ? (e) => {
              e.preventDefault();
              e.stopPropagation(); // win over the enclosing Group's relocate drop
              onAttachDrop?.(e.dataTransfer.getData('text/plain'), inv.instanceId);
            }
          : undefined
      }
    >
      <span className="inv-icon">
        <i className={'ti ' + (TYPE_ICON[item.itemType] ?? 'ti-package')} aria-hidden="true" />
      </span>
      <div className="inv-mid">
        <div className="inv-name-line">
          <span className="inv-name">{displayName(item, content)}</span>
          {!inlineQty && inv.quantity > 1 && <span className="inv-qty">×{inv.quantity}</span>}
          {(item.traits ?? [])
            .filter((t) => CATEGORY_TAGS.includes(t))
            .map((t) => (
              <span className="inv-badge category" key={t}>
                {capWord(t)}
              </span>
            ))}
          {isActionCost(item.activationCost) && (
            <span className="inv-act-cost" title="Activation cost">
              <ActionGlyph cost={item.activationCost} />
            </span>
          )}
        </div>
        <div className="inv-sub">
          level {item.level} · {formatPrice(item.price)}
          {item.material ? ` · ${capWord(item.material.type.replace(/-/g, ' '))}` : ''}
        </div>
        {onPlay && hasActions && (
          <div className="inv-actions">
            {inv.attachedTo && <span className="inv-affixed" title="Affixed to another item">Affixed</span>}
            {equip && !inv.attachedTo && (
              <button
                className={'inv-act' + (inv[equip.flag] ? ' on' : '')}
                onClick={(e) => { stop(e); onPlay((p) => toggleItemFlag(p, inv.instanceId, equip.flag)); }}
              >
                {inv[equip.flag] ? equip.on : equip.off}
              </button>
            )}
            {investable && (
              <button
                className={'inv-act' + (inv.invested ? ' on' : '')}
                disabled={!inv.invested && investedCount >= INVESTED_LIMIT}
                title={
                  !inv.invested && investedCount >= INVESTED_LIMIT
                    ? `You can invest at most ${INVESTED_LIMIT} items`
                    : undefined
                }
                onClick={(e) => { stop(e); onPlay((p) => toggleItemFlag(p, inv.instanceId, 'invested')); }}
              >
                {inv.invested ? 'Invested' : 'Invest'}
              </button>
            )}
            {counters.map((u) => (
              <span className="inv-uses" key={u.id} title={`${u.label}${u.resetsOnRest ? ' — refills on daily preparations' : ''}`}>
                <i className="ti ti-battery-2" aria-hidden="true" />
                <button
                  aria-label={`Spend a use (${u.label})`}
                  disabled={u.current <= 0}
                  onClick={(e) => { stop(e); onPlay((p) => setItemCounter(p, inv.instanceId, u.id, chargesFor(u, u.current - 1)), `uses:${inv.instanceId}:${u.id}`); }}
                >
                  <i className="ti ti-minus" aria-hidden="true" />
                </button>
                <span className="inv-uses-n">
                  {u.current}/{u.max}
                </span>
                <button
                  aria-label={`Restore a use (${u.label})`}
                  disabled={u.current >= u.max}
                  onClick={(e) => { stop(e); onPlay((p) => setItemCounter(p, inv.instanceId, u.id, chargesFor(u, u.current + 1)), `uses:${inv.instanceId}:${u.id}`); }}
                >
                  <i className="ti ti-plus" aria-hidden="true" />
                </button>
              </span>
            ))}
            {inlineQty && (
              <span className="inv-qtystep">
                <button
                  aria-label="Decrease quantity"
                  disabled={inv.quantity <= 1}
                  title={inv.quantity <= 1 ? 'Use the trash button to remove' : undefined}
                  onClick={(e) => { stop(e); onPlay((p) => setItemQuantity(p, inv.instanceId, inv.quantity - 1), `qty:${inv.instanceId}`); }}
                >
                  <i className="ti ti-minus" aria-hidden="true" />
                </button>
                <span>{inv.quantity}</span>
                <button aria-label="Increase quantity" onClick={(e) => { stop(e); onPlay((p) => setItemQuantity(p, inv.instanceId, inv.quantity + 1), `qty:${inv.instanceId}`); }}>
                  <i className="ti ti-plus" aria-hidden="true" />
                </button>
              </span>
            )}
          </div>
        )}
      </div>
      <div className="inv-bulk">
        <div className="inv-bval">{formatBulk(item.bulk)}</div>
        <div className="inv-blbl">bulk</div>
      </div>
      {/* In interactive mode the highlighted equip/invest button already shows this state, so the
          static badge would be a redundant second "Worn"/"Wielded"/"Invested". Only show it read-only. */}
      {badge && !onPlay && <span className={'inv-badge ' + badge.kind}>{badge.label}</span>}
    </div>
  );
}

/** Fallback card for an inventory entry whose item definition is missing from the data,
 *  so it stays visible and removable instead of silently vanishing. */
function UnknownItemCard({ inv, onPlay }: { inv: InventoryItem; onPlay?: PlayUpdater }) {
  return (
    <div className="inv-card unknown">
      <span className="inv-icon">
        <i className="ti ti-help" aria-hidden="true" />
      </span>
      <div className="inv-mid">
        <div className="inv-name-line">
          <span className="inv-name">Unknown item</span>
          {inv.quantity > 1 && <span className="inv-qty">×{inv.quantity}</span>}
        </div>
        <div className="inv-sub">missing data ({inv.itemId})</div>
        {onPlay && (
          <div className="inv-actions">
            <button
              className="inv-act danger"
              aria-label="Remove item"
              onClick={() => onPlay((p) => removeInventoryItem(p, inv.instanceId))}
            >
              <i className="ti ti-trash" aria-hidden="true" /> Remove
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** The character's vehicle & siege-weapon companions, shown as a bulk-EXEMPT section of the Inventory
 *  (they live in the companion system — see the Companions tab — but are surfaced here since players
 *  think of them as owned gear). Each row is a compact stat line + a Remove control that deletes the
 *  underlying companion (so it also disappears from the Companions tab). Not carried, so it never
 *  contributes to the Bulk total. */
function VehicleSiegeSection({
  character,
  content,
  onPlay,
}: {
  character: Character;
  content: ContentDatabase;
  onPlay?: PlayUpdater;
}) {
  const rows = (character.companions ?? [])
    .filter((c): c is CompanionConfig & { kind: 'vehicle' | 'siege' } => c.kind === 'vehicle' || c.kind === 'siege')
    .map((cfg) => {
      const v: VehicleStat | SiegeWeaponStat | undefined =
        cfg.typeId ? (cfg.kind === 'vehicle' ? content.vehicles?.[cfg.typeId] : content.siegeWeapons?.[cfg.typeId]) : undefined;
      return { cfg, v };
    });
  if (rows.length === 0) return null;
  const remove = async (cfg: CompanionConfig, label: string) => {
    if (!onPlay) return;
    if (!(await confirmDialog({ title: `Remove ${label}?`, message: "This removes it from your Companions too. This can't be undone.", confirmLabel: 'Remove', danger: true }))) return;
    onPlay((p) => removePlayCompanion(p, cfg.id));
  };
  return (
    <div className="inv-group">
      <div className="inv-sec inv-sec-static">
        <i className="ti ti-wheel" aria-hidden="true" />
        <span className="inv-sec-title">Vehicles &amp; Siege Weapons</span>
        <span className="inv-count">
          {rows.length} item{rows.length === 1 ? '' : 's'}
        </span>
        <span className="ignore-chip" title="Vehicles and siege weapons don't count toward your carried Bulk">
          no Bulk
        </span>
      </div>
      <div className="inv-grid">
        {rows.map(({ cfg, v }) => {
          const kindLabel = cfg.kind === 'vehicle' ? 'Vehicle' : 'Siege weapon';
          const name = cfg.name || v?.name || kindLabel;
          const st = character.companionHp?.[cfg.id];
          const max = v?.hp;
          const cur = max != null ? Math.max(0, max - (st?.damage ?? 0)) : undefined;
          return (
            <div className="inv-card" key={cfg.id}>
              <span className="inv-icon">
                <i className={'ti ' + (cfg.kind === 'vehicle' ? 'ti-wheel' : 'ti-bow')} aria-hidden="true" />
              </span>
              <div className="inv-mid">
                <div className="inv-name-line">
                  <span className="inv-name">{name}</span>
                </div>
                <div className="inv-sub">
                  {kindLabel}
                  {v ? ` · level ${v.level} · AC ${v.ac} · Hardness ${v.hardness}` : ' · pick a type in Companions'}
                  {v && cur != null ? ` · HP ${cur}/${v.hp}` : ''}
                </div>
                {onPlay && (
                  <div className="inv-actions">
                    <button className="inv-act danger" aria-label={`Remove ${name}`} onClick={() => remove(cfg, name)}>
                      <i className="ti ti-trash" aria-hidden="true" /> Remove
                    </button>
                  </div>
                )}
              </div>
              {v && (
                <div className="inv-bulk">
                  <div className="inv-bval">—</div>
                  <div className="inv-blbl">bulk</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function InventoryTab({
  character,
  content,
  onPlay,
  onCreateItem,
}: {
  character: Character;
  content: ContentDatabase;
  onPlay?: PlayUpdater;
  onCreateItem?: (item: Item) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<{ inv: InventoryItem; item: Item } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const rationsDayTracking = !!character.options?.rationsDayTracking;
  const [editTarget, setEditTarget] = useState<{ item: Item; inv: InventoryItem } | null>(null);
  // A bound scroll/wand can't hold a spell above what the character could cast.
  const maxSpellRank = Math.min(10, Math.max(1, Math.ceil(character.level / 2)));
  const [query, setQuery] = useState('');
  // Coin-input drafts (denomination → typed string, absent = show live value): the coin fields wrote to
  // the wallet on every keystroke, so clearing one to retype briefly wrote 0 and could lose money if
  // interrupted. Buffer per denomination, commit on blur/Enter.
  const [coinDraft, setCoinDraft] = useState<Record<string, string>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  // Mobile hold-to-move: press-and-hold an item card to pick it up. `holdRef` tracks the pointer; once
  // the hold arms, `ghost` is the floating item icon that follows the finger (the source card hides and
  // the open section collapses so only tabs + headers remain as drop targets), and `dropTarget` is the
  // tab/header currently under the finger. Reliable because the card is `touch-action:none` (a scroll
  // can never steal the grab) and the pointer is captured on <html> at arm (so hiding the card mid-drag
  // can't cancel it); pointer events are read off `window`.
  const holdRef = useRef<{ id: string; startX: number; startY: number; lastX: number; lastY: number; active: boolean; pointerId: number; holdTimer: number | null; scrolling: boolean; scrollEl: HTMLElement | null } | null>(null);
  const [ghost, setGhost] = useState<{ id: string; x: number; y: number; icon: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Mobile-only: which tab's item list is shown. 'equipped' | 'carried' | a container instanceId.
  // The open accordion section: a section id, or null = all closed. Tabs open a section; a header taps
  // toggles it (so the user can collapse everything).
  const [activeTab, setActiveTab] = useState<string | null>('equipped');
  // drag-to-attach: the host card currently hovered, and a transient "why it can't attach" message.
  const [attachOver, setAttachOver] = useState<string | null>(null);
  const [attachMsg, setAttachMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!attachMsg) return;
    const t = setTimeout(() => setAttachMsg(null), 6000);
    return () => clearTimeout(t);
  }, [attachMsg]);
  const bulk = deriveBulk(character, content);
  const coins = character.currency;
  const loads = containerLoads(character, content);

  const resolve = (inv: InventoryItem) => content.items[inv.itemId];
  const q = query.trim().toLowerCase();
  const match = (inv: InventoryItem) => !q || (resolve(inv) && displayName(resolve(inv)!, content).toLowerCase().includes(q));

  const containers = character.inventory.filter((inv) => resolve(inv)?.itemType === 'container');
  const containerIds = new Set(containers.map((c) => c.instanceId));
  const isContainer = (inv: InventoryItem) => containerIds.has(inv.instanceId);
  // "Loose" = top level: not validly inside a container. A container item is loose unless it
  // is itself nested in another container (orphaned contents fall back here, not vanish).
  const loose = character.inventory.filter((inv) => !(inv.containerInstanceId && containerIds.has(inv.containerInstanceId)));
  // A container is shown among the Carried items (or inside its parent), never "Equipped".
  // Its own contents render in a separate section below. Other items split by their flags.
  const equipped = loose.filter((inv) => !isContainer(inv) && (inv.worn || inv.equipped || inv.invested)).filter(match);
  const carried = loose.filter((inv) => isContainer(inv) || !(inv.worn || inv.equipped || inv.invested)).filter(match);
  // Only items that are actually investable (carry the `invested` trait) count toward the
  // 10-item cap — not anything that happens to have a stale invested flag.
  const investedCount = character.inventory.filter((inv) => inv.invested && resolve(inv)?.traits?.includes('invested')).length;

  // --- drag & drop: relocate an item between Equipped / Carried / a container ---
  const draggedInv = dragId ? character.inventory.find((i) => i.instanceId === dragId) : null;
  const draggedItem = draggedInv ? resolve(draggedInv) : null;
  // The dragged item is a rune or an affixable → weapon/armor/shield cards become attach targets.
  const draggingAttachable = !!draggedItem && (isAttachable(draggedItem) || !!content.runes[draggedItem.id]);
  const isEquippable = (item?: Item) =>
    !!item &&
    (item.itemType === 'armor' ||
      item.itemType === 'weapon' ||
      item.itemType === 'shield' ||
      !!item.traits?.includes('invested'));
  /** True if `childId` sits inside `ancestorId` (directly or transitively) — used to block
   *  dropping a container into its own descendant (which would make a cycle). */
  const isInside = (childId: string, ancestorId: string): boolean => {
    let cur = character.inventory.find((i) => i.instanceId === childId);
    const seen = new Set<string>();
    while (cur?.containerInstanceId && !seen.has(cur.containerInstanceId)) {
      if (cur.containerInstanceId === ancestorId) return true;
      seen.add(cur.containerInstanceId);
      cur = character.inventory.find((i) => i.instanceId === cur!.containerInstanceId);
    }
    return false;
  };
  /** Whether `rawBulk` of an item fits in container `dest` given its capacity. If the item is
   *  already in that container its own Bulk is discounted. No capacity data → no limit. */
  const fitsIn = (dest: string, rawBulk: number, alreadyIn: boolean) => {
    const load = loads[dest];
    if (!load || load.capacity == null) return true;
    return load.used - (alreadyIn ? rawBulk : 0) + rawBulk <= load.capacity + 1e-9;
  };
  /** Whether the item currently being dragged may be dropped on a target. `dest` is
   *  'equipped' / 'carried' / a container instanceId. */
  const canDrop = (dest: string) => {
    if (!draggedItem || !dragId) return false;
    if (dest === 'equipped') {
      if (!isEquippable(draggedItem)) return false; // containers aren't equippable
      // Dragging onto Equipped invests anything that isn't armor/weapon/shield — enforce the same
      // 10-item invested cap the Invest button does, so drag-and-drop can't slip past it.
      const wouldInvest = !['armor', 'weapon', 'shield'].includes(draggedItem.itemType);
      if (wouldInvest && !draggedInv?.invested && investedCount >= INVESTED_LIMIT) return false;
      return true;
    }
    if (dest === 'carried') return true;
    // a container target: not itself, not into its own descendant (no cycles), and it must fit.
    // Use the dragged item's EFFECTIVE Bulk (incl. its own container contents) so a loaded
    // container can't be stuffed into one too small to hold it.
    const effBulk = effectiveItemBulk(character, content, dragId);
    return dragId !== dest && !isInside(dest, dragId) && fitsIn(dest, effBulk, draggedInv?.containerInstanceId === dest);
  };
  const moveTo = (instanceId: string, dest: string) => {
    if (!onPlay) return;
    const inv = character.inventory.find((i) => i.instanceId === instanceId);
    const item = inv && resolve(inv);
    if (!item) return;
    let patch: Partial<InventoryItem>;
    if (dest === 'equipped') {
      if (!isEquippable(item)) return;
      if (item.itemType === 'armor') patch = { worn: true, equipped: false, invested: false, containerInstanceId: undefined };
      else if (item.itemType === 'weapon' || item.itemType === 'shield')
        patch = { equipped: true, worn: false, invested: false, containerInstanceId: undefined };
      else {
        // Investing is capped at 10 (the Invest condition limit) — match the Invest button's guard.
        if (!inv.invested && investedCount >= INVESTED_LIMIT) return;
        patch = { invested: true, worn: false, equipped: false, containerInstanceId: undefined };
      }
    } else if (dest === 'carried') {
      patch = { worn: false, equipped: false, invested: false, containerInstanceId: undefined };
    } else {
      if (dest === instanceId || isInside(dest, instanceId)) return; // no self / cycle
      if (!fitsIn(dest, effectiveItemBulk(character, content, instanceId), inv.containerInstanceId === dest)) return; // over capacity
      patch = { containerInstanceId: dest, worn: false, equipped: false, invested: false };
    }
    onPlay((p) => updateInventoryItem(p, instanceId, patch));
  };
  // A SYNCHRONOUS mirror of dragId. setDragId (React state) doesn't apply until the next render, so
  // during the first `dragover` events right after `dragstart` the handler closure still sees
  // dragId===null — and a drop target only accepts a drop if `dragover` calls preventDefault(). The
  // old code gated preventDefault on state, so the FIRST drag was marked "no drop" by the browser and
  // silently failed (you had to drag twice). onDragOver/onDrop below read this ref instead.
  const startDrag = (id: string) => {
    dragIdRef.current = id;
    setDragId(id);
  };
  const endDrag = () => {
    dragIdRef.current = null;
    setDragId(null);
    setOverId(null);
    setAttachOver(null);
  };
  // Safety net: a card's React onDragEnd is unreliable when the list re-renders mid-drag (setting
  // dragId re-renders the whole inventory), which left the source container highlighted after a
  // cancelled move. A window-level `dragend` ALWAYS fires when the drag operation ends (drop or
  // cancel) and is bound to window (not the re-rendering card), so the drag UI always resets.
  useEffect(() => {
    const reset = () => {
      dragIdRef.current = null;
      setDragId(null);
      setOverId(null);
      setAttachOver(null);
    };
    window.addEventListener('dragend', reset);
    return () => window.removeEventListener('dragend', reset);
  }, []);

  // --- mobile hold-to-move controller (see holdRef comment above) ---
  const dropDestAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    return (el?.closest('[data-drop-dest]') as HTMLElement | null)?.dataset.dropDest ?? null;
  };
  const cleanupHold = () => {
    const d = holdRef.current;
    if (d) {
      if (d.holdTimer != null) clearTimeout(d.holdTimer);
      window.removeEventListener('pointermove', onHoldMove);
      window.removeEventListener('pointerup', onHoldEnd);
      window.removeEventListener('pointercancel', onHoldEnd);
      try {
        document.documentElement.releasePointerCapture(d.pointerId);
      } catch {
        /* capture may already be released */
      }
    }
    holdRef.current = null;
    setGhost(null);
    setDropTarget(null);
  };
  const armHold = () => {
    const d = holdRef.current;
    if (!d || d.active) return;
    d.active = true;
    // Capture on <html> (a stable element) BEFORE the source card hides/collapses, so the drag can't be
    // cancelled by the card unmounting; window listeners keep receiving the events.
    try {
      document.documentElement.setPointerCapture(d.pointerId);
    } catch {
      /* capture unsupported — window listeners still fire */
    }
    const inv = character.inventory.find((i) => i.instanceId === d.id);
    const item = inv ? resolve(inv) : undefined;
    const icon = item ? TYPE_ICON[item.itemType] ?? 'ti-package' : 'ti-package';
    setGhost({ id: d.id, x: d.lastX, y: d.lastY, icon });
    try {
      navigator.vibrate?.(12); // a little buzz: "picked up"
    } catch {
      /* no vibration support — non-fatal */
    }
  };
  // The nearest scrollable ancestor of the item rows (or the page) — we scroll it ourselves on a swipe,
  // because the rows are touch-action:none (so the browser never scrolls them and can't steal a hold).
  const scrollParentOf = (el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
      const oy = getComputedStyle(node).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight + 2) return node;
      node = node.parentElement;
    }
    return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
  };
  const onHoldMove = (e: PointerEvent) => {
    const d = holdRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (d.active) {
      // Dragging: the ghost follows the finger; the tab/header under it lights up as the drop target.
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY } : g));
      setDropTarget(dropDestAt(e.clientX, e.clientY));
      return;
    }
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    if (d.scrolling) {
      if (d.scrollEl) d.scrollEl.scrollTop -= dy; // follow the finger (no browser fling, but rock-solid)
      return;
    }
    // Still deciding: a clear swipe past the slop = a scroll → cancel the pending hold and start scrolling;
    // otherwise keep waiting for the long-press timer to arm the grab.
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 10) {
      if (d.holdTimer != null) {
        clearTimeout(d.holdTimer);
        d.holdTimer = null;
      }
      d.scrolling = true;
      if (d.scrollEl) d.scrollEl.scrollTop -= dy;
    }
  };
  const onHoldEnd = (e: PointerEvent) => {
    const d = holdRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const wasActive = d.active;
    const id = d.id;
    const dest = wasActive && e.type !== 'pointercancel' ? dropDestAt(e.clientX, e.clientY) : null;
    cleanupHold();
    if (dest && dest !== id) {
      moveTo(id, dest); // moveTo validates fit / equippable
      setActiveTab(dest); // open the section it landed in (a tab or a header both carry the dest)
    }
  };
  const startHold = (instanceId: string, e: React.PointerEvent) => {
    if (!onPlay) return;
    if (e.button != null && e.button > 0) return; // primary button / touch only
    holdRef.current = {
      id: instanceId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      active: false,
      pointerId: e.pointerId,
      holdTimer: window.setTimeout(armHold, 450), // longer hold so a quick swipe scrolls instead of grabbing
      scrolling: false,
      scrollEl: scrollParentOf(e.currentTarget as HTMLElement),
    };
    window.addEventListener('pointermove', onHoldMove);
    window.addEventListener('pointerup', onHoldEnd);
    window.addEventListener('pointercancel', onHoldEnd);
  };
  useEffect(() => () => cleanupHold(), []);

  // If the open accordion section vanishes (its container was moved/removed), fall back to Equipped.
  useEffect(() => {
    if (isMobile && activeTab !== null && activeTab !== 'equipped' && activeTab !== 'carried' && !containerIds.has(activeTab)) setActiveTab('equipped');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, activeTab, containers.map((c) => c.instanceId).join(',')]);
  /** Drop an attachment/rune onto a host card: validate, confirm, then etch the rune (and consume
   *  the loose rune) or affix the attachment. On failure, surface the specific reason. */
  const attachDrop = async (rawSrcId: string, hostId: string) => {
    setAttachOver(null);
    const srcId = rawSrcId || dragId || '';
    if (!onPlay || !srcId || srcId === hostId) {
      endDrag();
      return;
    }
    const attInv = character.inventory.find((i) => i.instanceId === srcId);
    const hostInv = character.inventory.find((i) => i.instanceId === hostId);
    const attDef = attInv && resolve(attInv);
    const hostDef = hostInv && resolve(hostInv);
    if (!attInv || !hostInv || !attDef || !hostDef) {
      endDrag();
      return;
    }
    const plan = planAttach(attDef, attInv, hostDef, hostInv, character.inventory, content);
    if (!plan.ok) {
      setAttachMsg(plan.reason);
      endDrag();
      return;
    }
    endDrag(); // the drop is done — reset the drag UI before the (async) confirm modal
    if (await confirmDialog({ title: `${plan.verb} ${attDef.name} ${plan.prep} ${hostDef.name}?`, confirmLabel: plan.verb })) {
      if (plan.action === 'affix') {
        onPlay((p) => attachItem(p, srcId, hostId));
      } else {
        onPlay((p) => {
          let next = updateInventoryItem(p, hostId, { runes: plan.runes });
          if (plan.consume) next = attInv.quantity > 1 ? setItemQuantity(next, srcId, attInv.quantity - 1) : removeInventoryItem(next, srcId);
          return next;
        });
      }
      setAttachMsg(null);
    }
  };

  function toggle(id: string) {
    setCollapsed((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function open(inv: InventoryItem) {
    const item = resolve(inv);
    if (item) setDetail({ inv, item });
  }

  function Group({
    id,
    title,
    items,
    right,
    lead,
    dropKind,
    emptyHint,
  }: {
    id: string;
    title: string;
    items: InventoryItem[];
    right?: ReactNode;
    lead?: ReactNode;
    /** Where items dropped on this group go: 'equipped' / 'carried' / a container instanceId. */
    dropKind?: string;
    /** Shown in place of an empty grid (e.g. an empty container is still a drop target). */
    emptyHint?: string;
  }) {
    // Mobile = accordion: exactly one section open (driven by activeTab). The open section STAYS open
    // during a drag — collapsing it would UNMOUNT the card the touch started on, and Android fires
    // `touchcancel` when an active touch's target is removed, silently killing the drop (this is why it
    // armed+vibrated but never moved). Collapsed sections still show their header, and the sticky tab
    // row exposes every destination, so all drop targets stay reachable. Desktop = independent toggles.
    // During a mobile hold-drag every section collapses to just its header, so the whole tab row + all
    // headers are visible as drop targets and only the floating icon shows under the finger.
    const expanded = isMobile ? id === activeTab && !ghost : !collapsed.has(id);
    const droppable = dropKind != null && !!onPlay;
    const validHere = droppable && dragId != null && canDrop(dropKind!);
    return (
      <div
        className={'inv-group' + (overId === id && validHere ? ' drop-ok' : '')}
        onDragOver={
          droppable
            ? (e) => {
                // preventDefault (which is what ALLOWS the drop) must fire from the first dragover of
                // the gesture — gate on the synchronous ref, not the async `validHere` state, or the
                // first drag fails. moveTo() re-validates the actual drop, so this stays correct.
                if (!dragIdRef.current) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overId !== id) setOverId(id);
              }
            : undefined
        }
        onDragLeave={
          droppable
            ? (e) => {
                // Clear this container's highlight only when the cursor truly leaves it (ignore
                // dragleave events fired while moving between the container's own child cards).
                if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) {
                  setOverId((cur) => (cur === id ? null : cur));
                }
              }
            : undefined
        }
        onDrop={
          droppable
            ? (e) => {
                e.preventDefault();
                const did = e.dataTransfer.getData('text/plain') || dragIdRef.current;
                // No `validHere` gate: moveTo() self-validates (equip/invest-cap/self/cycle/capacity)
                // and no-ops an illegal drop, so we don't depend on the lagging React state here.
                if (did) moveTo(did, dropKind!);
                endDrag();
              }
            : undefined
        }
      >
        <div
          className={'inv-sec' + (ghost && dropTarget === dropKind ? ' drop-over' : '')}
          data-drop-dest={dropKind}
          onClick={() => (isMobile ? setActiveTab(activeTab === id ? null : id) : toggle(id))}
        >
          <i className={'ti ' + (expanded ? 'ti-chevron-down' : 'ti-chevron-right')} aria-hidden="true" />
          <span className="inv-sec-title">{title}</span>
          <span className="inv-count">{items.length} item{items.length === 1 ? '' : 's'}</span>
          {right}
        </div>
        {expanded && (
          <div className="inv-grid">
            {lead}
            {items.map((inv) => {
              const item = resolve(inv);
              if (!item) return <UnknownItemCard key={inv.instanceId} inv={inv} onPlay={onPlay} />;
              // While dragging a rune/attachment, weapon/armor/shield cards become attach targets;
              // run the planner so only valid hosts light up and the drop knows the exact reason.
              const isHostType = item.itemType === 'weapon' || item.itemType === 'armor' || item.itemType === 'shield';
              const attachHost = !!onPlay && draggingAttachable && isHostType && inv.instanceId !== dragId;
              const plan = attachHost && draggedItem && draggedInv ? planAttach(draggedItem, draggedInv, item, inv, character.inventory, content) : null;
              return (
                <ItemCard
                  key={inv.instanceId}
                  inv={inv}
                  item={item}
                  content={content}
                  onOpen={() => open(inv)}
                  onPlay={onPlay}
                  investedCount={investedCount}
                  rationsDayTracking={rationsDayTracking}
                  isMobile={isMobile}
                  onDragStartItem={startDrag}
                  onDragEndItem={endDrag}
                  onHoldDrag={isMobile ? startHold : undefined}
                  dragging={ghost?.id === inv.instanceId}
                  attachHost={attachHost}
                  attachValid={!!plan?.ok}
                  attachOver={attachOver === inv.instanceId}
                  onAttachOver={setAttachOver}
                  onAttachLeave={() => setAttachOver((cur) => (cur === inv.instanceId ? null : cur))}
                  onAttachDrop={attachDrop}
                />
              );
            })}
            {!lead && items.length === 0 && emptyHint && <div className="inv-empty-hint">{emptyHint}</div>}
          </div>
        )}
      </div>
    );
  }

  const coinDenoms: ('pp' | 'gp' | 'sp' | 'cp')[] = ['pp', 'gp', 'sp', 'cp'];

  return (
    <div className="maincol">
      {ghost && (
        <div className="inv-drag-ghost" style={{ left: ghost.x, top: ghost.y }} aria-hidden="true">
          <i className={'ti ' + ghost.icon} />
        </div>
      )}
      <div className="inv-top">
        <div className="search">
          <i className="ti ti-search" aria-hidden="true" />
          <input placeholder="Search items" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {onPlay && (
          <button className="add-item-btn" onClick={() => setAddOpen(true)}>
            <i className="ti ti-plus" aria-hidden="true" /> Add item
          </button>
        )}
        {onPlay && onCreateItem && (
          <button className="add-item-btn" onClick={() => setCreateOpen(true)}>
            <i className="ti ti-wand" aria-hidden="true" /> Create item
          </button>
        )}
      </div>

      {attachMsg && (
        <div className="inv-attach-error" role="alert">
          <i className="ti ti-alert-triangle" aria-hidden="true" />
          <span>{attachMsg}</span>
          <button className="inv-attach-dismiss" aria-label="Dismiss" onClick={() => setAttachMsg(null)}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className="inv-meta">
        {(() => {
          // "Ignore Bulk Limit" option: never flag encumbered/overloaded.
          const enc = character.options?.ignoreBulk ? '' : bulk.encTotal > bulk.max ? 'over' : bulk.encTotal > bulk.encumberedAt ? 'encumbered' : '';
          return (
            <>
              <span
                className={'bulk-badge' + (enc ? ' ' + enc : '')}
                title={`Carrying ${bulk.total} Bulk. You can carry up to ${bulk.encumberedAt} Bulk with no penalty; carrying more makes you encumbered (Clumsy 1, −10 ft Speed). The most you can carry at all is ${bulk.max} Bulk.`}
              >
                <i className="ti ti-weight" aria-hidden="true" /> Bulk{' '}
                <strong>
                  {bulk.total} / {bulk.encumberedAt}
                </strong>
                <span className="bulk-state"> · max {bulk.max}</span>
                {enc === 'encumbered' && <span className="bulk-state"> · encumbered</span>}
                {enc === 'over' && <span className="bulk-state"> · overloaded</span>}
              </span>
              {/* Phone-only inline consequence (CSS hides it on desktop, which keeps the hover title). */}
              {enc && (
                <span className={'bulk-penalty ' + enc}>
                  {enc === 'over'
                    ? 'Overloaded — over your max Bulk; you can’t carry more.'
                    : 'Encumbered — Clumsy 1 and −10 ft Speed.'}
                </span>
              )}
            </>
          );
        })()}
        {investedCount > 0 && (
          <span className={'bulk-badge' + (investedCount > INVESTED_LIMIT ? ' over' : '')} title="Invested magic items (max 10)">
            <i className="ti ti-sparkles" aria-hidden="true" /> Invested{' '}
            <strong>
              {investedCount} / {INVESTED_LIMIT}
            </strong>
          </span>
        )}
        <span className={'coins' + (onPlay ? ' editable' : '')}>
          {coinDenoms.map((d) => (
            <span className="coin" key={d}>
              <i className={'coin-dot ' + d} />
              {onPlay ? (
                <input
                  className="coin-input"
                  type="text"
                  inputMode="numeric"
                  value={d in coinDraft ? coinDraft[d] : String(coins[d] || '')}
                  placeholder="0"
                  aria-label={d}
                  onFocus={(e) => {
                    setCoinDraft((cd) => ({ ...cd, [d]: String(coins[d] || '') }));
                    e.currentTarget.select();
                  }}
                  onChange={(e) => setCoinDraft((cd) => ({ ...cd, [d]: e.target.value.replace(/[^0-9]/g, '') }))}
                  onBlur={() => {
                    const v = Math.max(0, parseInt(coinDraft[d] ?? '', 10) || 0);
                    onPlay((p) => setCurrency(p, { ...coins, [d]: v }));
                    setCoinDraft((cd) => {
                      const n = { ...cd };
                      delete n[d];
                      return n;
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                />
              ) : (
                <>{grp(coins[d] ?? 0)} </>
              )}
              {d}
            </span>
          ))}
        </span>
      </div>

      {(() => {
        // Per-container section data (contents + Bulk-load chip) — shared by both layouts.
        const containerGroup = (c: InventoryItem) => {
          const item = resolve(c);
          const contents = character.inventory.filter((inv) => inv.containerInstanceId === c.instanceId).filter(match);
          const load = loads[c.instanceId];
          // The container item itself lives in its location section (Carried, or a parent
          // container) — this section shows only what's INSIDE it, plus its Bulk load.
          const right =
            load && load.capacity != null ? (
              <span className={'ignore-chip' + (load.used > load.capacity + 1e-9 ? ' over' : '')} title="Bulk held / capacity">
                {load.used} / {load.capacity} Bulk
              </span>
            ) : undefined;
          return (
            <Group
              key={c.instanceId}
              id={c.instanceId}
              title={item ? `In ${item.name}` : 'In container'}
              items={contents}
              dropKind={c.instanceId}
              right={right}
              emptyHint="Drag items here to store them"
            />
          );
        };

        // Equipped, Carried, then each container — stacked. Desktop = independent collapse toggles;
        // mobile = accordion (one section open at a time, driven by activeTab; headers double as the
        // drag drop-targets, so dropping an item on a header moves it there and opens that section).
        return (
          <>
            {isMobile && (
              <div className={'subtabs spell-subtabs inv-tabs' + (ghost ? ' inv-tabs-drag' : '')} role="tablist">
                <button data-drop-dest="equipped" className={'stab' + (activeTab === 'equipped' ? ' on' : '') + (ghost && dropTarget === 'equipped' ? ' drop-over' : '')} onClick={() => setActiveTab('equipped')}>
                  Equipped
                </button>
                <button data-drop-dest="carried" className={'stab' + (activeTab === 'carried' ? ' on' : '') + (ghost && dropTarget === 'carried' ? ' drop-over' : '')} onClick={() => setActiveTab('carried')}>
                  Carried
                </button>
                {containers.map((c) => {
                  const item = resolve(c);
                  return (
                    <button key={c.instanceId} data-drop-dest={c.instanceId} className={'stab' + (activeTab === c.instanceId ? ' on' : '') + (ghost && dropTarget === c.instanceId ? ' drop-over' : '')} onClick={() => setActiveTab(c.instanceId)}>
                      {item ? item.name : 'Container'}
                    </button>
                  );
                })}
              </div>
            )}
            <Group id="equipped" title="Equipped" items={equipped} dropKind="equipped" />
            <Group id="carried" title="Carried" items={carried} dropKind="carried" />
            {containers.map(containerGroup)}
            <VehicleSiegeSection character={character} content={content} onPlay={onPlay} />
          </>
        );
      })()}

      {detail && (
        <ItemDetail
          inv={character.inventory.find((i) => i.instanceId === detail.inv.instanceId) ?? detail.inv}
          item={detail.item}
          content={content}
          onClose={() => setDetail(null)}
          onPlay={onPlay}
          inventory={character.inventory}
          rationsDayTracking={rationsDayTracking}
          onEdit={onCreateItem ? (it, iv) => setEditTarget({ item: it, inv: iv }) : undefined}
        />
      )}
      {addOpen && onPlay && (
        <AddItemsModal
          content={content}
          currency={coins}
          onBuy={(id) => onPlay((p) => buyItem(p, id, content.items[id]?.price))}
          onGive={(id) => onPlay((p) => addInventoryItem(p, id))}
          onBuyCompanion={(pick) => {
            // A vehicle/siege pick routes to the COMPANION system (same path as the Companions-tab
            // Add picker): append a CompanionConfig to play.companions and deduct the coin price.
            const price = pick.kind === 'vehicle' ? content.vehicles?.[pick.typeId]?.price : content.siegeWeapons?.[pick.typeId]?.price;
            onPlay((p) => buyCompanion(p, { kind: pick.kind, name: '', typeId: pick.typeId } as Omit<CompanionConfig, 'id'>, parsePrice(price)));
          }}
          onGiveCompanion={(pick: CompanionPick) =>
            onPlay((p) => addPlayCompanion(p, { kind: pick.kind, name: '', typeId: pick.typeId } as Omit<CompanionConfig, 'id'>))
          }
          onClose={() => setAddOpen(false)}
        />
      )}
      {createOpen && onPlay && onCreateItem && (
        <ItemEditorModal
          mode="create"
          content={content}
          maxSpellRank={maxSpellRank}
          onSave={(item) => {
            onCreateItem(item);
            onPlay((p) => addInventoryItem(p, item.id));
          }}
          onClose={() => setCreateOpen(false)}
        />
      )}
      {editTarget && onCreateItem && (
        <ItemEditorModal
          mode="edit"
          item={editTarget.item}
          inv={character.inventory.find((i) => i.instanceId === editTarget.inv.instanceId) ?? editTarget.inv}
          inventory={character.inventory}
          content={content}
          maxSpellRank={maxSpellRank}
          onPlay={onPlay}
          onSave={(item) => {
            onCreateItem(item);
            // Copy-on-write: editing a built-in item yields a new id; repoint only THIS
            // character's instance to it (other characters keep the original).
            if (onPlay && item.id !== editTarget.inv.itemId) {
              onPlay((p) => updateInventoryItem(p, editTarget.inv.instanceId, { itemId: item.id }));
            }
            // Keep an open detail view (same instance) in sync with the just-saved item.
            setDetail((cur) =>
              cur && cur.inv.instanceId === editTarget.inv.instanceId ? { item, inv: { ...cur.inv, itemId: item.id } } : cur,
            );
            setEditTarget(null);
          }}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
