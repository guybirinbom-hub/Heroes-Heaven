import { useMemo } from 'react';
import type { Coins, ContentDatabase } from '../rules/types';
import { canAfford } from '../rules/play';
import { FilterableSelect, descNodeOf } from './FilterableSelect';
import { ITEM_SPEC } from './filterSpecs';

function priceLabel(p?: Coins): string {
  if (!p) return 'free';
  if (p.pp) return `${p.pp} pp`;
  if (p.gp) return `${p.gp} gp`;
  if (p.sp) return `${p.sp} sp`;
  if (p.cp) return `${p.cp} cp`;
  return 'free';
}

/** Browse the item catalog and Buy (deduct coins) or Give (free) items to the character. */
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
  const items = useMemo(
    () => Object.values(content.items).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name)),
    [content],
  );

  return (
    <FilterableSelect
      title="Add items"
      icon="ti-briefcase"
      items={items}
      spec={ITEM_SPEC}
      rowKey={(it) => it.id}
      onClose={onClose}
      renderRow={(it, openDesc) => {
        const afford = canAfford(currency, it.price);
        const node = descNodeOf(it, 'items');
        const info = (
          <>
            <div className="ai-name">{it.name}</div>
            <div className="ai-meta">
              {it.itemType} · lvl {it.level} · {priceLabel(it.price)}
              {it.rarity !== 'common' ? ` · ${it.rarity}` : ''}
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
              <button disabled={!afford} title={afford ? 'Buy (deduct coins)' : 'Not enough coins'} onClick={() => onBuy(it.id)}>
                Buy
              </button>
              <button className="give" title="Add for free" onClick={() => onGive(it.id)}>
                Give
              </button>
            </div>
          </div>
        );
      }}
    />
  );
}
