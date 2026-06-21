import { usePinDesc } from './PinContext';
import type { DescNode } from './descref';

/**
 * Favorite star for a description detail modal — pins/unpins it to the Main-tab Pinned section.
 * Uses the PinContext, so it renders nothing outside play mode (e.g. the builder), matching the
 * star already shown by the recursive DescriptionModal. Drop it into any detail-modal header.
 */
export function PinStar({ node }: { node: DescNode }) {
  const pin = usePinDesc();
  if (!pin) return null;
  const pinned = pin.has(node);
  return (
    <button
      type="button"
      className={'info-star' + (pinned ? ' on' : '')}
      title={pinned ? 'Remove from Pinned' : 'Favorite — add to Pinned'}
      aria-label={pinned ? 'Remove from Pinned' : 'Add to Pinned'}
      aria-pressed={pinned}
      onClick={(e) => {
        e.stopPropagation();
        pin.toggle(node);
      }}
    >
      <i className="ti ti-star" aria-hidden="true" />
    </button>
  );
}
