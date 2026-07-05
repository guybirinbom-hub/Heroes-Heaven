import { useMemo } from 'react';
import type { Coins, ContentDatabase, Item } from '../rules/types';
import { canAfford } from '../rules/play';
import { formatPrice } from '../rules/wealth';
import { FilterableSelect, descNodeOf } from './FilterableSelect';
import { ITEM_SPEC, SERVICE_MARK } from './filterSpecs';

/** Browse the item catalog and Buy (deduct coins) or Give (free) items to the character. Services
 *  also appear here (searchable by name/description) but are REFERENCE-ONLY — they aren't inventory
 *  you carry, so they have no Buy/Give, just a description to read. */
export function AddItemsModal({
  content,
  currency,
  onBuy,
  onGive,
  onClose,
}: {
  content: ContentDatabase;
  currency: Coins;
  onBuy: (itemId: string) => void;
  onGive: (itemId: string) => void;
  onClose: () => void;
}) {
  // Services rendered as look-only catalog rows: shape them as minimal "equipment" entries so they
  // pass the item filters, and keep the original (string price + the look-only flag) by id.
  const services = useMemo(() => Object.values(content.services ?? {}), [content]);
  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);
  const items = useMemo(() => {
    const svcEntries: Item[] = services.map(
      (s) =>
        ({
          id: s.id,
          name: s.name,
          level: s.level ?? 0,
          itemType: 'equipment',
          // Tag with the sentinel so itemCategories routes these to the "Services" chip.
          traits: [...(s.traits ?? []), SERVICE_MARK],
          rarity: 'common',
          bulk: 0,
          price: undefined,
          description: s.description ?? '',
        }) as Item,
    );
    return [...Object.values(content.items), ...svcEntries].sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  }, [content, services]);

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
        const node = descNodeOf(it, svc ? 'services' : 'items');
        const info = (
          <>
            <div className="ai-name">{it.name}</div>
            <div className="ai-meta">
              {svc ? 'service' : it.itemType} · lvl {it.level} · {svc ? svc.price ?? 'varies' : formatPrice(it.price)}
              {!svc && it.rarity !== 'common' ? ` · ${it.rarity}` : ''}
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
