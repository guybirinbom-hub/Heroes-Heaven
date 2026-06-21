import { useState } from 'react';
import type { DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { usePinDesc } from './PinContext';
import { lookupRef, type DescNode } from './descref';
import { RichText } from './RichText';
import { useEscapeClose } from './useEscapeClose';

/**
 * A description popup that can drill into the descriptions of terms it mentions. Each click on
 * a linked word pushes that term's description onto a stack; "Back" pops one level. Recurses
 * arbitrarily deep. Reuses the .picker modal shell.
 */
export function DescriptionModal({ root, onClose }: { root: DescNode; onClose: () => void }) {
  const content = useContent();
  useEscapeClose(onClose);
  const pin = usePinDesc();
  // Drilling into a linked term pushes onto the stack; Back (shown when stack.length > 1) walks the
  // term chain back. The first term has no Back — Close returns to the source it was opened from.
  const [stack, setStack] = useState<DescNode[]>([root]);
  const cur = stack[stack.length - 1];
  const pinned = pin?.has(cur) ?? false;

  const open = (ref: DescRef) => {
    if (!content) return;
    const node = lookupRef(content, ref);
    if (node) setStack((s) => [...s, node]);
  };
  const back = () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {stack.length > 1 && (
            <button
              className="info-back"
              aria-label="Back to previous description"
              onClick={(e) => {
                e.stopPropagation();
                back();
              }}
            >
              <i className="ti ti-chevron-left" aria-hidden="true" /> Back
            </button>
          )}
          <span className="info-title">{cur.title}</span>
          {pin && (
            <button
              className={'info-star' + (pinned ? ' on' : '')}
              title={pinned ? 'Remove from Pinned' : 'Favorite — add to Pinned'}
              aria-label={pinned ? 'Remove from Pinned' : 'Add to Pinned'}
              aria-pressed={pinned}
              onClick={(e) => {
                e.stopPropagation();
                pin.toggle(cur);
              }}
            >
              <i className="ti ti-star" aria-hidden="true" />
            </button>
          )}
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="info-body">
          <RichText text={cur.description} refs={cur.descRefs} onOpen={open} />
        </div>
      </div>
    </div>
  );
}
