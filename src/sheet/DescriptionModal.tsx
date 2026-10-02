import type { DescNode } from './descref';
import { RecordCard } from './RecordCard';

/**
 * A description popup that can drill into the descriptions of terms it mentions. Each click on
 * a linked word pushes that term's description onto a stack; "Back" pops one level. Recurses
 * arbitrarily deep. Renders the new ast (the approved look) when the record has one; otherwise
 * falls back to the curated-markdown RichText path.
 *
 * Card step 3 (docs/card-design.md section 9): this popup IS the browse card. Its page / loading /
 * fallback branches moved, unchanged, into RecordCard (mode 'browse', chrome 'popup'); the markup is
 * byte-equal (test/card-browse.test.tsx) and keeps its class names, so PopupSizeLock and sheet.css
 * are untouched. The root node is handed over as-is, so a pin stores the caller's own object.
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
  return (
    <RecordCard
      node={root}
      mode="browse"
      chrome="popup"
      onExit={onExit ?? onClose}
      onBackToSource={backToSource ? onClose : undefined}
    />
  );
}
