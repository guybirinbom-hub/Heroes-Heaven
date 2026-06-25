import { useEffect, useState, type ReactNode } from 'react';
import type { Character, ContentDatabase, InventoryItem, Item } from '../rules/types';
import { deriveBulk, containerLoads, effectiveItemBulk } from '../rules/derive';
import { isAttachable, planAttach } from '../rules/attachments';
import {
  addInventoryItem,
  attachItem,
  buyItem,
  removeInventoryItem,
  setCurrency,
  setMonsterParts,
  setItemCounter,
  setItemQuantity,
  toggleItemFlag,
  updateInventoryItem,
  type PlayState,
} from '../rules/play';
import { chargesFor, itemCounters } from '../rules/itemUses';
import { monsterPartsEnabled } from '../rules/sources';
import { formatPrice, grp } from '../rules/wealth';
import { loadHomebrewSources } from '../data/storage';
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
  if (item.itemType === 'weapon' || item.itemType === 'shield') return { flag: 'equipped', on: 'Wielded', off: 'Wield' };
  return null;
}

/** Equipment-typed gear that's expended / used in quantity — a torch burns out, caltrops and
 *  marbles scatter, pitons get hammered in and left — but that the source data doesn't tag
 *  'consumable'. Listed by id so they get the inline +/- stepper like potions do, even when the
 *  player happens to carry just one. (Most other expendables — rations, candles, chalk, oils,
 *  alchemical items — are already itemType 'consumable'; ammunition carries the 'consumable' trait.) */
const EXPENDABLE_GEAR = new Set(['torch', 'caltrops', 'marbles', 'piton']);

/** Items whose quantity changes often in play (consumables, ammunition, thrown weapons, expendable
 *  gear, or anything carried as a stack) keep the inline +/- stepper on the card. A single stable
 *  piece (one weapon, one suit of armor, a worn item) shows no counter and is re-counted from the
 *  item popup instead. Rations match via itemType==='consumable' (they carry NO traits); ammunition
 *  is itemType 'equipment' + the 'consumable' trait; thrown weapons carry 'thrown' OR a range-suffixed
 *  'thrown-N' trait — matched the same way derive.ts identifies thrown weapons. */
function keepsInlineQuantity(item: Item, quantity = 1): boolean {
  const traits = item.traits ?? [];
  if (item.itemType === 'consumable') return true;
  if (traits.includes('consumable')) return true;
  if (item.itemType === 'weapon' && (traits.includes('thrown') || traits.some((t) => t.startsWith('thrown-')))) return true;
  if (EXPENDABLE_GEAR.has(item.id)) return true;
  // "Things the player uses an amount of and not just one" — any item carried as a stack (qty > 1)
  // gets the live counter rather than a static ×N badge.
  if (quantity > 1) return true;
  return false;
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
  onDragStartItem,
  onDragEndItem,
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
  onPlay?: (fn: (play: PlayState) => PlayState) => void;
  investedCount?: number;
  /** "Individual day tracking of rations" option — suppress the Rations days counter. */
  rationsDayTracking?: boolean;
  onDragStartItem?: (instanceId: string) => void;
  onDragEndItem?: () => void;
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
  const inlineQty = keepsInlineQuantity(item, inv.quantity);
  // The delete button moved to the item detail popup, so only render the actions row when there's
  // still a control to show — otherwise plain items would keep an empty 7px-margin gap.
  const hasActions = !!inv.attachedTo || !!equip || !!investable || counters.length > 0 || inlineQty;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className={
        'inv-card' +
        (inv.invested ? ' invested' : '') +
        ' clickable' +
        (onPlay ? ' draggable' : '') +
        (attachHost && attachValid ? ' attach-target' : '') +
        (attachOver && attachValid ? ' attach-over' : '')
      }
      onClick={onOpen}
      draggable={!!onPlay}
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
          <div className="inv-actions" onClick={stop}>
            {inv.attachedTo && <span className="inv-affixed" title="Affixed to another item">Affixed</span>}
            {equip && !inv.attachedTo && (
              <button
                className={'inv-act' + (inv[equip.flag] ? ' on' : '')}
                onClick={() => onPlay((p) => toggleItemFlag(p, inv.instanceId, equip.flag))}
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
                onClick={() => onPlay((p) => toggleItemFlag(p, inv.instanceId, 'invested'))}
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
                  onClick={() => onPlay((p) => setItemCounter(p, inv.instanceId, u.id, chargesFor(u, u.current - 1)))}
                >
                  <i className="ti ti-minus" aria-hidden="true" />
                </button>
                <span className="inv-uses-n">
                  {u.current}/{u.max}
                </span>
                <button
                  aria-label={`Restore a use (${u.label})`}
                  disabled={u.current >= u.max}
                  onClick={() => onPlay((p) => setItemCounter(p, inv.instanceId, u.id, chargesFor(u, u.current + 1)))}
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
                  onClick={() => onPlay((p) => setItemQuantity(p, inv.instanceId, inv.quantity - 1))}
                >
                  <i className="ti ti-minus" aria-hidden="true" />
                </button>
                <span>{inv.quantity}</span>
                <button aria-label="Increase quantity" onClick={() => onPlay((p) => setItemQuantity(p, inv.instanceId, inv.quantity + 1))}>
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
function UnknownItemCard({ inv, onPlay }: { inv: InventoryItem; onPlay?: (fn: (play: PlayState) => PlayState) => void }) {
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

export function InventoryTab({
  character,
  content,
  onPlay,
  onCreateItem,
}: {
  character: Character;
  content: ContentDatabase;
  onPlay?: (fn: (play: PlayState) => PlayState) => void;
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
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
  // The Monster Parts subsystem (refine/imbue) is unlocked by a homebrew Source the character enabled.
  const mpOn = monsterPartsEnabled(character, loadHomebrewSources());
  const bankedParts = character.monsterParts ?? 0;

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
  const endDrag = () => {
    setDragId(null);
    setOverId(null);
    setAttachOver(null);
  };
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
    const expanded = !collapsed.has(id);
    const droppable = dropKind != null && !!onPlay;
    const validHere = droppable && dragId != null && canDrop(dropKind!);
    return (
      <div
        className={'inv-group' + (overId === id && validHere ? ' drop-ok' : '')}
        onDragOver={
          droppable
            ? (e) => {
                if (!validHere) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overId !== id) setOverId(id);
              }
            : undefined
        }
        onDrop={
          droppable
            ? (e) => {
                e.preventDefault();
                const did = e.dataTransfer.getData('text/plain') || dragId;
                if (did && validHere) moveTo(did, dropKind!);
                endDrag();
              }
            : undefined
        }
      >
        <div className="inv-sec" onClick={() => toggle(id)}>
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
                  onDragStartItem={setDragId}
                  onDragEndItem={endDrag}
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
          const enc = character.options?.ignoreBulk ? '' : bulk.total > bulk.max ? 'over' : bulk.total > bulk.encumberedAt ? 'encumbered' : '';
          return (
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
                  value={coins[d] || ''}
                  placeholder="0"
                  aria-label={d}
                  onChange={(e) => onPlay((p) => setCurrency(p, { ...coins, [d]: Math.max(0, parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0) }))}
                />
              ) : (
                <>{grp(coins[d] ?? 0)} </>
              )}
              {d}
            </span>
          ))}
        </span>
        {mpOn && (
          <span className="bulk-badge mp-badge" title="Banked monster parts (gp-value) for refining & imbuing gear">
            <i className="ti ti-bone" aria-hidden="true" /> Parts{' '}
            {onPlay ? (
              <input
                className="coin-input mp-parts-input"
                type="text"
                inputMode="numeric"
                value={bankedParts || ''}
                placeholder="0"
                aria-label="Banked monster parts"
                onChange={(e) => onPlay((p) => setMonsterParts(p, parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0))}
              />
            ) : (
              <strong>{grp(bankedParts)}</strong>
            )}{' '}
            gp
          </span>
        )}
      </div>

      <Group id="equipped" title="Equipped" items={equipped} dropKind="equipped" />
      <Group id="carried" title="Carried" items={carried} dropKind="carried" />
      {containers.map((c) => {
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
      })}

      {detail && (
        <ItemDetail
          inv={character.inventory.find((i) => i.instanceId === detail.inv.instanceId) ?? detail.inv}
          item={detail.item}
          content={content}
          onClose={() => setDetail(null)}
          onPlay={onPlay}
          inventory={character.inventory}
          rationsDayTracking={rationsDayTracking}
          monsterPartsOn={mpOn}
          charLevel={character.level}
          onEdit={onCreateItem ? (it, iv) => setEditTarget({ item: it, inv: iv }) : undefined}
        />
      )}
      {addOpen && onPlay && (
        <AddItemsModal
          content={content}
          currency={coins}
          onBuy={(id) => onPlay((p) => buyItem(p, id, content.items[id]?.price))}
          onGive={(id) => onPlay((p) => addInventoryItem(p, id))}
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
