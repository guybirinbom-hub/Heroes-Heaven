import { useEffect, useRef, useState } from 'react';
import type { DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { usePinDesc } from './PinContext';
import { lookupRef, type DescNode } from './descref';
import { RichText } from './RichText';
import { useEscapeClose } from './useEscapeClose';
import { AstRenderer } from './AstRenderer';
import { astSlug, useAstNode } from './useAst';

/**
 * A description popup that can drill into the descriptions of terms it mentions. Each click on
 * a linked word pushes that term's description onto a stack; "Back" pops one level. Recurses
 * arbitrarily deep. Renders the new ast (the approved look) when the record has one; otherwise
 * falls back to the curated-markdown RichText path.
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
  const exit = onExit ?? onClose;
  useEscapeClose(exit);
  const pin = usePinDesc();
  const [stack, setStack] = useState<DescNode[]>([root]);
  const cur = stack[stack.length - 1];
  const pinned = pin?.has(cur) ?? false;
  // explicit slug (from a resolved cross-ref) or best-effort from the title, so any titled node can
  // resolve its ast; a miss simply falls back to the RichText path.
  const curSlug = cur.slug ?? astSlug(cur.title);
  const { node: astNode, bucket: astBucket, loading: astLoading } = useAstNode(cur.key, curSlug);

  // Re-fit the popup to each node's text (the modal element persists across the stack).
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = modalRef.current;
    if (el) { el.style.width = ''; el.style.height = ''; }
  }, [cur]);

  // Open a linked term: from a markdown DescRef (fallback path) …
  const open = (ref: DescRef) => {
    if (!content) return;
    const node = lookupRef(content, ref);
    if (node) setStack((s) => [...s, node]);
  };
  // … or from an ast cross-link (resolved "bucket:slug").
  const openRef = (bucket: string, slug: string) => {
    const rec = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>> | null)?.[bucket]?.[slug];
    if (rec) setStack((s) => [...s, { title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: bucket, slug }]);
  };
  const back = () => { if (stack.length > 1) setStack((s) => s.slice(0, -1)); else onClose(); };
  const showBack = stack.length > 1 || !!backToSource;

  const controls = (
    <>
      {showBack && (
        <button className="info-back" aria-label="Back to previous description"
          onClick={(e) => { e.stopPropagation(); back(); }}>
          <i className="ti ti-chevron-left" aria-hidden="true" /> Back
        </button>
      )}
      {pin && (
        <button className={'info-star' + (pinned ? ' on' : '')}
          title={pinned ? 'Remove from Pinned' : 'Favorite — add to Pinned'}
          aria-label={pinned ? 'Remove from Pinned' : 'Add to Pinned'} aria-pressed={pinned}
          onClick={(e) => { e.stopPropagation(); pin.toggle(cur); }}>
          <i className="ti ti-star" aria-hidden="true" />
        </button>
      )}
      <button className="picker-close" onClick={exit} aria-label="Close">
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </>
  );

  // Ast path — the design-approved popup, with HH's Back/pin/close in its header.
  if (astNode) {
    return (
      <div className="picker-overlay" onClick={exit}>
        <div ref={modalRef} className="ast-modal" onClick={(e) => e.stopPropagation()}>
          <AstRenderer node={astNode} selfRef={`${astBucket}:${curSlug}`} onOpenRef={openRef} headerControls={controls} />
        </div>
      </div>
    );
  }

  // The record HAS an ast still loading: show the popup shell + a placeholder body instead of flashing the
  // plain-text/markdown fallback (which looks like a different, wrong layout for a beat).
  if (astLoading) {
    return (
      <div className="picker-overlay" onClick={exit}>
        <div ref={modalRef} className="ast-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ast-pop">
            <div className="ast-bar" />
            <div className="ast-head">
              <span className="ast-name">{cur.title}</span>
              <span className="ast-head-right"><span className="ast-controls">{controls}</span></span>
            </div>
            <div className="ast-body ast-loading" aria-busy="true" />
          </div>
        </div>
      </div>
    );
  }

  // Fallback — curated markdown / homebrew HTML.
  return (
    <div className="picker-overlay" onClick={exit}>
      <div ref={modalRef} className="picker info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {showBack && (
            <button className="info-back" aria-label="Back to previous description"
              onClick={(e) => { e.stopPropagation(); back(); }}>
              <i className="ti ti-chevron-left" aria-hidden="true" /> Back
            </button>
          )}
          <span className="info-title">{cur.title}</span>
          {pin && (
            <button className={'info-star' + (pinned ? ' on' : '')}
              title={pinned ? 'Remove from Pinned' : 'Favorite — add to Pinned'}
              aria-label={pinned ? 'Remove from Pinned' : 'Add to Pinned'} aria-pressed={pinned}
              onClick={(e) => { e.stopPropagation(); pin.toggle(cur); }}>
              <i className="ti ti-star" aria-hidden="true" />
            </button>
          )}
          <button className="picker-close" onClick={exit} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="info-body">
          <RichText text={cur.description} refs={cur.descRefs} onOpen={open} selfLabel={cur.title} />
        </div>
      </div>
    </div>
  );
}
