import { usePinDesc, type PinNode } from './PinContext';

/**
 * Favorite star for a description detail modal — pins/unpins it to the Main-tab Pinned section.
 * Uses the PinContext, so it renders nothing outside play mode (e.g. the builder), matching the
 * star already shown by the recursive DescriptionModal. Drop it into any detail-modal header.
 */
export function PinStar({ node }: { node: PinNode }) {
  const pin = usePinDesc();
  if (!pin) return null;
  const pinned = pin.has(node);
  return (
    <button
      type="button"
      className={'info-star' + (pinned ? ' on' : '')}
      title={pinned ? `Remove from ${pin.where ?? 'Pinned'}` : `Favorite — add to ${pin.where ?? 'Pinned'}`}
      aria-label={pinned ? `Remove from ${pin.where ?? 'Pinned'}` : `Add to ${pin.where ?? 'Pinned'}`}
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
