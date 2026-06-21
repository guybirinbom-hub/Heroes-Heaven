import { useState } from 'react';
import type { DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { lookupRef, type DescNode } from './descref';
import { RichText } from './RichText';
import { DescriptionModal } from './DescriptionModal';

/**
 * Renders an inline description with its cross-references linkified; clicking a link opens the
 * recursive description popup (with Back). Drop-in replacement for `<p>{description}</p>` in
 * detail views.
 */
export function DescBody({
  description,
  descRefs,
  className = 'sd-desc',
}: {
  description?: string;
  descRefs?: DescRef[];
  className?: string;
  /** @deprecated RichText now emits block elements, so the container is always a div. */
  as?: 'p' | 'div';
}) {
  const content = useContent();
  const [node, setNode] = useState<DescNode | null>(null);
  if (!description) return null;
  // Always a <div>: RichText renders block-level content (paragraphs, lists, tables, dividers)
  // which is invalid inside a <p>.
  return (
    <>
      <div className={className}>
        <RichText
          text={description}
          refs={descRefs}
          onOpen={(ref: DescRef) => {
            const n = content ? lookupRef(content, ref) : null;
            if (n) setNode(n);
          }}
        />
      </div>
      {node && <DescriptionModal root={node} onClose={() => setNode(null)} />}
    </>
  );
}
