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
export function DescriptionModal({
  root,
  onClose,
  onExit,
  backToSource,
}: {
  root: DescNode;
  onClose: () => void;
  /** Dismiss the WHOLE popup chain (the X, Escape, and clicking outside). Defaults to onClose. */
  onExit?: () => void;
  /** Show Back even at the first level; there it returns (via onClose) to the popup this opened from. */
  backToSource?: boolean;
}) {
  const content = useContent();
  // X / Escape / click-outside dismiss the whole chain (onExit); Back steps up one level, and at the
  // first level returns to the source the popup was opened from (onClose).
  const exit = onExit ?? onClose;
  useEscapeClose(exit);
  const pin = usePinDesc();
  const [stack, setStack] = useState<DescNode[]>([root]);
  const cur = stack[stack.length - 1];
  const pinned = pin?.has(cur) ?? false;

  const open = (ref: DescRef) => {
    if (!content) return;
    const node = lookupRef(content, ref);
    if (node) setStack((s) => [...s, node]);
  };
  const back = () => {
    if (stack.length > 1) setStack((s) => s.slice(0, -1));
    else onClose();
  };
  const showBack = stack.length > 1 || !!backToSource;

  return (
    <div className="picker-overlay" onClick={exit}>
      <div className="picker info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {showBack && (
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
          <button className="picker-close" onClick={exit} aria-label="Close">
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
