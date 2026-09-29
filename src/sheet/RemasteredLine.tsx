/**
 * desk #158 — the reprint that ships beside a record built from the older printing.
 *
 * Written by the data chain (scripts/lib/reprint.mjs shippedTwin -> build-map.mjs -> stamp-aonid.mjs),
 * never by hand, and guarded by scripts/reprint-check.mjs (every `remasteredAs` IS the shipped twin).
 *
 * Its own file so DescBody (detail views), DescriptionModal (every search / ref-link popup) and the GM
 * screen's pinned pages share one line without importing each other.
 */
export type RemasteredAs = { bucket: string; id: string; name: string };

/** Read that link off a record when the caller holds a view model — or only a bucket/slug — rather than
 *  the record itself. An item-bonus line or a trait is only ever reached this way. */
export function remasteredAsOf(content: unknown, ref: { bucket?: string; id?: string }): RemasteredAs | undefined {
  if (!ref.bucket || !ref.id) return undefined;
  return (content as Record<string, Record<string, { remasteredAs?: RemasteredAs }> | undefined> | null)?.[ref.bucket]?.[ref.id]?.remasteredAs;
}

/** "Remastered as <name>" — the name opens the reprint's record, of whatever bucket, in the caller's popup.
 *  Marked `sd-ours`: the book never printed this line, we did. */
export function RemasteredLine({ ra, onOpen }: { ra: RemasteredAs; onOpen: (bucket: string, id: string) => void }) {
  return (
    <p className="sd-ours sd-remastered">
      Remastered as{' '}
      <a className="ref-link" href="#" onClick={(e) => { e.preventDefault(); onOpen(ra.bucket, ra.id); }}>
        {ra.name}
      </a>
    </p>
  );
}
