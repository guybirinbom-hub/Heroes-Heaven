import { useState, type ReactNode } from 'react';
import type { DescRef } from '../rules/types';
import { DescriptionModal } from './DescriptionModal';

/**
 * A term that reveals its description when clicked. Renders a subtly-underlined, focusable
 * span that opens a description popup (with cross-reference navigation — see DescriptionModal).
 * When no description is available, it renders the children as plain text (not clickable).
 */
export function InfoTerm({
  children,
  title,
  description,
  descRefs,
  className,
  descKey,
}: {
  children: ReactNode;
  title: string;
  description?: string;
  descRefs?: DescRef[];
  className?: string;
  /** Originating content-map name ('feats'/'classFeatures'/…), threaded into the pin identity so
   *  same-named entries from different maps don't collide. (Named `descKey`, not `key`, which React
   *  reserves.) */
  descKey?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!description) return <span className={className}>{children}</span>;
  return (
    <>
      <span
        className={(className ? className + ' ' : '') + 'info-term'}
        role="button"
        tabIndex={0}
        title="Show description"
        // stopPropagation because an InfoTerm is frequently nested inside a clickable row (a feat in
        // the Feats & features list, an item card). Clicking the term means "explain THIS word", never
        // "and also open whatever contains it" — without this, a trait chip opened two popups at once.
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
      >
        {children}
      </span>
      {open && <DescriptionModal root={{ title, description, descRefs, key: descKey }} onClose={() => setOpen(false)} />}
    </>
  );
}
