import { useMemo } from 'react';
import { listValues } from '../data';
import type { Coins, ContentDatabase, Item } from '../rules/types';
import { canAfford } from '../rules/play';
import { formatPrice, parsePrice } from '../rules/wealth';
import { FilterableSelect, descNodeOf } from './FilterableSelect';
import { ITEM_SPEC } from './filterSpecs';

/** A vehicle/siege catalog pick routed to the companion system. `kind` selects the catalog map;
 *  `typeId` is the vehicle/siege id. */
export interface CompanionPick {
  kind: 'vehicle' | 'siege';
  typeId: string;
}

/** Browse the item catalog and Buy (deduct coins) or Give (free) items to the character. Services
 *  also appear here (searchable by name/description) but are REFERENCE-ONLY — they aren't inventory
 *  you carry, so they have no Buy/Give, just a description to read.
 *
 *  Vehicles & siege weapons ALSO appear here (they live in the companion catalog, not content.items).
 *  When `onBuyCompanion`/`onGiveCompanion` are provided, picking one routes to the companion-add path
 *  (it becomes a companion, not an inventory item). Without those callbacks — e.g. the companion-gear
 *  Add-item picker — vehicles/siege are omitted, since a companion can't carry a vehicle. */
export function AddItemsModal({
  content,
  currency,
  onBuy,
  onGive,
  onBuyCompanion,
  onGiveCompanion,
  onClose,
  hideLegacy,
}: {
  content: ContentDatabase;
  currency: Coins;
  /** When true, legacy/legacy-era items are hidden from the browse list (per-character setting). */
  hideLegacy?: boolean;
  onBuy: (itemId: string) => void;
  onGive: (itemId: string) => void;
  /** Buy a vehicle/siege as a companion (deduct its price). Omit to hide vehicles/siege entirely. */
  onBuyCompanion?: (pick: CompanionPick) => void;
  /** Add a vehicle/siege as a companion for free. Omit to hide vehicles/siege entirely. */
  onGiveCompanion?: (pick: CompanionPick) => void;
  onClose: () => void;
}) {
  const companionCatalog = !!(onBuyCompanion || onGiveCompanion);
  // Services rendered as look-only catalog rows: shape them as minimal "equipment" entries so they
  // pass the item filters, and keep the original (string price + the look-only flag) by id.
  const services = useMemo(() => Object.values(content.services ?? {}), [content]);
  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  // Vehicle/siege catalog entries (companion system) shaped as `equipment` Items so they pass the
  // item filters, tagged with a sentinel trait so itemCategories routes them to Vehicles / Siege.
  // Keep the ORIGINAL price string + kind, keyed by the synthetic id, so Buy/Give can route it to
  // the companion-add path and deduct the right coins. Bulk 0 — a companion never touches item Bulk.
  const companionPickById = useMemo(() => {
    const m = new Map<string, { pick: CompanionPick; price?: string }>();
    if (!companionCatalog) return m;
    for (const v of Object.values(content.vehicles ?? {})) m.set(v.id, { pick: { kind: 'vehicle', typeId: v.id }, price: v.price });
    for (const s of Object.values(content.siegeWeapons ?? {})) m.set(s.id, { pick: { kind: 'siege', typeId: s.id }, price: s.price });
    return m;
  }, [content, companionCatalog]);
  const items = useMemo(() => {
    const svcEntries: Item[] = services.map(
      (s) =>
        ({
          id: s.id,
          name: s.name,
          level: s.level ?? 0,
          itemType: 'equipment',
          // Marked via `catalogKind` (an internal field), NOT a fake trait — itemCategories routes
          // these to the "Services" chip. Anything put in `traits` is user-visible somewhere.
          catalogKind: 'service',
          traits: s.traits ?? [],
          rarity: 'common',
          bulk: 0,
          price: undefined,
          description: s.description ?? '',
        }) as Item,
    );
    const vehicleEntries: Item[] = companionCatalog
      ? [
          ...Object.values(content.vehicles ?? {}).map(
            (v) =>
              ({
                id: v.id,
                name: v.name,
                level: v.level,
                itemType: 'equipment',
                catalogKind: 'vehicle',
                traits: v.traits ?? [],
                rarity: 'common',
                bulk: 0,
                price: parsePrice(v.price),
                description: v.description ?? '',
              }) as Item,
          ),
          ...Object.values(content.siegeWeapons ?? {}).map(
            (s) =>
              ({
                id: s.id,
                name: s.name,
                level: s.level,
                itemType: 'equipment',
                catalogKind: 'siege',
                traits: s.traits ?? [],
                rarity: 'common',
                bulk: 0,
                price: parsePrice(s.price),
                description: s.description ?? '',
              }) as Item,
          ),
        ]
      : [];
    const items = listValues(content, content.items).filter((i) => {
      const e = (i as { edition?: string }).edition;
      if (e === 'superseded') return false; // renamed/outdated half of a remaster change — always hidden
      if (hideLegacy && (e === 'legacy' || e === 'legacy-era')) return false;
      return true;
    });
    return [...items, ...svcEntries, ...vehicleEntries].sort(
      (a, b) => a.level - b.level || a.name.localeCompare(b.name),
    );
  }, [content, services, companionCatalog, hideLegacy]);

  return (
    <FilterableSelect
      title="Add items"
      icon="ti-briefcase"
      items={items}
      spec={ITEM_SPEC}
      rowKey={(it) => it.id}
      onClose={onClose}
      renderRow={(it, openDesc) => {
        const svc = serviceById.get(it.id);
        const comp = companionPickById.get(it.id);
        const descKey = svc ? 'services' : comp ? (comp.pick.kind === 'vehicle' ? 'vehicles' : 'siegeWeapons') : 'items';
        const node = descNodeOf(it, descKey);
        const compAffordable = comp ? canAfford(currency, it.price) : true;
        const info = (
          <>
            <div className="ai-name">{it.name}</div>
            <div className="ai-meta">
              {svc ? 'service' : comp ? (comp.pick.kind === 'vehicle' ? 'vehicle' : 'siege weapon') : it.itemType} · lvl {it.level} ·{' '}
              {svc ? svc.price ?? 'varies' : comp ? comp.price ?? 'free' : formatPrice(it.price)}
              {!svc && !comp && it.rarity !== 'common' ? ` · ${it.rarity}` : ''}
            </div>
          </>
        );
        return (
          <div className="ai-row">
            {node ? (
              <button type="button" className="ai-info ai-info-btn" onClick={() => openDesc(node)} title="View description">
                {info}
              </button>
            ) : (
              <div className="ai-info">{info}</div>
            )}
            <div className="ai-buy">
              {svc ? (
                <span className="ai-reference" title="Reference only — services aren't added to your inventory">
                  reference
                </span>
              ) : comp ? (
                <>
                  <button
                    disabled={!compAffordable}
                    title={compAffordable ? 'Buy — adds it as a companion' : 'Not enough coins'}
                    onClick={() => onBuyCompanion?.(comp.pick)}
                  >
                    Buy
                  </button>
                  <button className="give" title="Add for free as a companion" onClick={() => onGiveCompanion?.(comp.pick)}>
                    Give
                  </button>
                </>
              ) : (
                <>
                  <button disabled={!canAfford(currency, it.price)} title={canAfford(currency, it.price) ? 'Buy (deduct coins)' : 'Not enough coins'} onClick={() => onBuy(it.id)}>
                    Buy
                  </button>
                  <button className="give" title="Add for free" onClick={() => onGive(it.id)}>
                    Give
                  </button>
                </>
              )}
            </div>
          </div>
        );
      }}
    />
  );
}
