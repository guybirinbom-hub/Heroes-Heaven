import { useEffect, useRef, useState, type ReactNode } from 'react';

/** One entry of a slot card's menu ("Remove this place"). */
export interface SlotCardMenuItem {
  label: string;
  icon: string;
  onSelect: () => void;
}

/** The card menu: a "⋯" button beside the card that opens its entries; a tap outside or Escape closes it. Also the
 *  skill-increase and boost cards' menu (WP14). */
export function CardMenu({ items }: { items: readonly SlotCardMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return (
    <div className="lvl-menu-wrap" ref={ref}>
      <button className="lvl-menu-btn" type="button" aria-label="More for this place" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <i className="ti ti-dots" aria-hidden="true" />
      </button>
      {open && (
        <div className="lvl-menu" role="menu">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              role="menuitem"
              className="lvl-menu-item"
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              <i className={'ti ' + it.icon} aria-hidden="true" /> {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One feat slot card on a level page (Tweaks phase 2 WP6 step 1, plan work/tweaks-phase2-notes/plan.md): the card
 * button, Replace and Clear for a filled slot, and the lines under it (`children`: the Tweak mark, TrustMarker,
 * the prerequisite and "Not valid for this slot" notes, the feat's note and its own questions). The Builder's
 * printed slots draw it; `menu` is the card menu (WP6 step 2: "Remove this place", Tweaks on only), WP7 draws extra
 * places with it.
 *
 * A FILLED slot: clicking the card shows the feat's description (`onCard`); Replace swaps it. An EMPTY slot:
 * clicking opens the picker. `invalid`: why the triangle is on the card (prerequisites no longer met).
 * test/slot-card-dom.test.tsx holds the DOM byte-equal to the cards the Builder drew inline before.
 */
export function FeatSlotCard({
  label,
  icon,
  picked,
  pickedName,
  invalid,
  onCard,
  onReplace,
  onClear,
  menu,
  children,
}: {
  label: string;
  icon: string;
  picked: boolean;
  pickedName?: string;
  invalid?: string;
  onCard: () => void;
  onReplace: () => void;
  onClear: () => void;
  /** The card menu's entries; none = no menu button. */
  menu?: readonly SlotCardMenuItem[];
  children?: ReactNode;
}) {
  return (
    <div className="lvl-slot-wrap">
      <div className="lvl-slot">
        <button
          className={'lvl-card' + (picked ? '' : ' empty')}
          type="button"
          data-ctl="slot"
          data-ctl-title={label}
          data-ctl-state={picked ? 'picked' : 'empty'}
          title={picked ? 'Show description' : undefined}
          onClick={onCard}
        >
          <span className="lvl-card-icon">
            <i className={'ti ' + icon} aria-hidden="true" />
          </span>
          <div className="lvl-card-text">
            <div className="lvl-card-label">{label}</div>
            <div className="lvl-card-val">{picked ? pickedName : 'Choose…'}</div>
          </div>
          {picked && invalid !== undefined && (
            <span className="lvl-invalid" title={invalid}>
              <i className="ti ti-alert-triangle" aria-hidden="true" />
            </span>
          )}
          {!picked && <span className="lvl-pending">!</span>}
        </button>
        {picked && (
          <>
            <button className="lvl-replace-btn" type="button" onClick={onReplace}>
              <i className="ti ti-repeat" aria-hidden="true" /> Replace
            </button>
            <button className="lvl-clear-btn" type="button" aria-label="Clear feat" onClick={onClear}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </>
        )}
        {menu && menu.length > 0 && <CardMenu items={menu} />}
      </div>
      {children}
    </div>
  );
}
