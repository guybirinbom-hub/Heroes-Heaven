/**
 * desk #158 — the reprint that ships beside a record built from the older printing.
 *
 * Written by the data chain (scripts/lib/reprint.mjs shippedTwin -> build-map.mjs -> stamp-aonid.mjs),
 * never by hand, and guarded by scripts/reprint-check.mjs (every `remasteredAs` IS the shipped twin).
 *
 * Only a TYPE comes from cardModel.ts (erased at build), so this small file pulls in nothing new.
 *
 * Its own file so DescBody (detail views), DescriptionModal (every search / ref-link popup) and the GM
 * screen's pinned pages share one line without importing each other.
 */
import type { OpenAt } from './cardModel';

export type RemasteredAs = { bucket: string; id: string; name: string };

/** Read that link off a record when the caller holds a view model — or only a bucket/slug — rather than
 *  the record itself. An item-bonus line or a trait is only ever reached this way. */
export function remasteredAsOf(content: unknown, ref: { bucket?: string; id?: string }): RemasteredAs | undefined {
  if (!ref.bucket || !ref.id) return undefined;
  return (content as Record<string, Record<string, { remasteredAs?: RemasteredAs }> | undefined> | null)?.[ref.bucket]?.[ref.id]?.remasteredAs;
}

/** Where a click activated a link (cardModel OpenAt): the pointer — or, for the click a browser makes of
 *  Enter on a focused link or button, which has no pointer (`detail` 0 at client 0, 0), the link's own
 *  box, as AstRenderer's keyAt does for a key press. Without this a keyboard-opened tracker window landed
 *  in the top-left corner. Here, not in cardModel, so this small file still pulls in nothing at runtime;
 *  DescBody uses it too. */
export function clickPoint(e: { clientX: number; clientY: number; detail: number }, link: Element | null): OpenAt {
  if (e.detail === 0 && e.clientX === 0 && e.clientY === 0 && link) {
    const r = link.getBoundingClientRect();
    return { x: r.left, y: r.bottom };
  }
  return { x: e.clientX, y: e.clientY };
}

/** "Remastered as <name>" — the name opens the reprint's record, of whatever bucket, in the caller's popup.
 *  Marked `sd-ours`: the book never printed this line, we did. `at` is where the name was clicked
 *  (cardModel OpenAt) — the tracker opens the reprint as a window there (item 7); other callers ignore it. */
export function RemasteredLine({ ra, onOpen }: { ra: RemasteredAs; onOpen: (bucket: string, id: string, at?: OpenAt) => void }) {
  return (
    <p className="sd-ours sd-remastered">
      Remastered as{' '}
      <a className="ref-link" href="#" onClick={(e) => { e.preventDefault(); onOpen(ra.bucket, ra.id, clickPoint(e, e.currentTarget)); }}>
        {ra.name}
      </a>
    </p>
  );
}
