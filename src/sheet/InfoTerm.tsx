import { useState, type ReactNode } from 'react';
import type { DescRef } from '../rules/types';
import { DescriptionModal } from './DescriptionModal';
import { RecordCard } from './RecordCard';
import { PinContext, usePinDesc, type PinDescApi, type PinNode } from './PinContext';
import type { CardScope, OursLine } from './cardModel';
import type { DescNode } from './descref';

/**
 * A term that reveals its description when clicked. Renders a subtly-underlined, focusable
 * span that opens a description popup (with cross-reference navigation — see DescriptionModal).
 * When no description is available, it renders the children as plain text (not clickable).
 *
 * Card step 20 (docs/card-design.md section 2 rule 2, section 6): a caller that knows the record passes
 * its id (`descSlug`, with `descKey` its bucket), so the popup opens THAT record's page — never whichever
 * record the display name slugs to. With `mine` the popup is the record's 'mine' card (the Details-tab
 * class card): scoped to the character, its star pinning {key, slug, title, mode: 'mine'}.
 */
export function InfoTerm({
  children,
  title,
  description,
  descRefs,
  className,
  descKey,
  descSlug,
  mine,
  ours,
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
  /** Card step 20: the record's own id in `descKey` — the popup and its pin are that record, by id.
   *  Absent = the name lookup it always had. */
  // card step 20: CompanionsTab wiring waits for the companions lane
  descSlug?: string;
  /** Card step 20: open the record's 'mine' card at this scope (needs `descKey` and `descSlug`). */
  mine?: { scope?: CardScope };
  /** The 'mine' card's ours lines (docs/card-design.md section 4) — a background's own `note` ("this
   *  record works; here is the part you apply yourself"), drawn in the card's ours box and carried on its
   *  pin, as the Feats tab's card does for a feat. Read only with `mine`: a browse card has no ours box. */
  ours?: OursLine[];
}) {
  const [open, setOpen] = useState(false);
  if (!description) return <span className={className}>{children}</span>;
  const node: DescNode = { title, description, descRefs, key: descKey, ...(descSlug ? { slug: descSlug } : {}) };
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
      {open && (mine && descKey && descSlug
        ? <MineTermCard node={node} scope={mine.scope} ours={ours} onClose={() => setOpen(false)} />
        : <DescriptionModal root={node} onClose={() => setOpen(false)} />)}
    </>
  );
}

/**
 * The pin a 'mine' term card's built-in star works on: for the record the card opened (its first node),
 * the node carries mode 'mine' — stored on the pin by play.ts pinOf, so the Pinned list reopens it as the
 * 'mine' card at the character's level (card step 19, MainTab PinnedDescCard). A page opened from a link
 * inside the card is a browse card and pins as it always did. The mode is never part of the identity.
 * The card's ours lines (a background's note) ride on that pin as FeatDetail's do (play.ts pinOf keeps
 * kinds choice / mark / note), so the Pinned list reopens the card with its box.
 */
export function mineTermPin(pin: PinDescApi, cardNode: DescNode, ours?: OursLine[]): PinDescApi {
  const mark = (n: PinNode): PinNode =>
    n.key === cardNode.key && n.slug === cardNode.slug && n.title === cardNode.title
      ? { ...n, mode: 'mine', ...(ours?.length ? { ours } : {}) }
      : n;
  return { ...pin, has: (n) => pin.has(mark(n)), toggle: (n) => pin.toggle(mark(n)) };
}

/** Card step 20: a term's record as a 'mine' card — printed set empty (no stat rows of its own), the
 *  parts the character does not have yet folded (owner ruling Q1 = A), no "Full page" button (section 13). */
function MineTermCard({ node, scope, ours, onClose }: { node: DescNode; scope?: CardScope; ours?: OursLine[]; onClose: () => void }) {
  const pin = usePinDesc();
  return (
    <PinContext.Provider value={pin ? mineTermPin(pin, node, ours) : null}>
      <RecordCard node={node} mode="mine" chrome="popup" scope={scope} printed={[]} ours={ours?.length ? ours : undefined} onExit={onClose} />
    </PinContext.Provider>
  );
}
