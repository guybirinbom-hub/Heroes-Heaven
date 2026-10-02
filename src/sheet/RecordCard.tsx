import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { ContentDatabase, DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { usePinDesc } from './PinContext';
import { lookupRef, type DescNode } from './descref';
import { RichText } from './RichText';
import { useEscapeClose } from './useEscapeClose';
import { AstRenderer } from './AstRenderer';
import { TrustMarker } from './TrustMarker';
import { unencodedNamed } from '../data/trustGate';
import { astSlug, useAstNode } from './useAst';
import { loadAstIndex, loadBucketAst } from './astStore';
import { RemasteredLine, remasteredAsOf } from './RemasteredLine';
import { isRecordRef, type CardRecord, type OursLine, type RecordCardProps } from './cardModel';
import { treeHasSource, withoutItemLists } from './astVisibility';
import { printedSet } from './cardScope';
import { DescBody } from './DescBody';
import type { SourceInfo } from '../rules/types';

/**
 * THE record card (docs/card-design.md section 2 rule 1). Card step 3 extracted it, unchanged, from
 * DescriptionModal's three branches — the page (ast) popup, the loading placeholder, and the curated
 * markdown / homebrew fallback — so every surface can later render one component.
 *
 * Step 3 builds `mode: 'browse'` with `chrome: 'popup'` only: today's search popup, byte for byte
 * (test/card-browse.test.tsx). Its class names stay exactly DescriptionModal's (.ast-modal,
 * .picker.info-modal …), so PopupSizeLock's SELF_SIZED list and sheet.css need no change. The other
 * modes / chrome and the reserved props (scope, stats, controls, transform) are declared in
 * cardModel.ts and not read yet.
 *
 * Step 5 builds `mode: 'mine'` (StatDetailModal's full text, CARD_ON.statDetail): the same shells with a
 * `card-mine` class added — `.ast-modal` is no `.picker`, so PopupSizeLock never pins it, and
 * `.picker.info-modal` is already SELF_SIZED, so the card grows with its content and PopupSizeLock is
 * unchanged. The page lane draws through AstRenderer's `card` prop (the printed set, furniture, dim
 * lines); the browse branches below are untouched.
 *
 * Built in and always present: Back (once drilled in, or with onBackToSource), the PinStar (where a
 * PinContext exists), close, and the TrustMarker. There is NO "Full page" button (owner ruling
 * 2026-10-02, section 13). The card owns drill-in: each click on a linked word pushes that term onto
 * a stack; Back pops one level; Escape, the X and a click outside close the whole chain (onExit).
 */
export function RecordCard({ record, node, mode, printed, headerActions, ours, footer, fallbackText, onExit, onBackToSource }: RecordCardProps) {
  const content = useContent();
  const exit = onExit;
  useEscapeClose(exit);
  const pin = usePinDesc();
  const [stack, setStack] = useState<DescNode[]>(() => [node ?? nodeOfRecord(record, content)]);
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
    if (el) { el.style.width = ''; el.style.height = ''; el.style.removeProperty('--ast-cap'); }
  }, [cur]);
  // `.ast-modal` auto-sizes to its text up to a comfortable READING width (760px). That cap also clamped
  // the inline width `resize: both` writes, so dragging the corner could never make the popup wider —
  // it just sprang back. Grabbing the grip lifts the cap to the viewport for the rest of this popup's
  // life; switching nodes (above) restores the reading width.
  const liftCapOnGrip = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = modalRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const GRIP = 22;
    if (e.clientX >= r.right - GRIP && e.clientY >= r.bottom - GRIP) {
      el.style.setProperty('--ast-cap', 'calc(94vw / var(--zoom, 1))');
    }
  };

  // Open a linked term: from a markdown DescRef (fallback path) …
  const open = (ref: DescRef) => {
    if (!content) return;
    const n = lookupRef(content, ref);
    if (n) setStack((s) => [...s, n]);
  };
  // … or from an ast cross-link (resolved "bucket:slug").
  const openRef = (bucket: string, slug: string) => {
    const rec = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>> | null)?.[bucket]?.[slug];
    if (rec) setStack((s) => [...s, { title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: bucket, slug }]);
  };
  /* desk #158 — the old printing says what it was remastered as, and the name opens that record here, on
     this stack, whatever its bucket. Read by bucket/slug off the content, because this popup holds a
     node, not the record: an item-bonus line or a trait reaches the player no other way. */
  const ra = remasteredAsOf(content, { bucket: cur.key, id: curSlug });
  const remastered = ra ? <RemasteredLine ra={ra} onOpen={openRef} /> : null;
  const back = () => { if (stack.length > 1) setStack((s) => s.slice(0, -1)); else onBackToSource?.(); };
  const showBack = stack.length > 1 || !!onBackToSource;

  /* "Not yet verified", for whichever node of the stack is open. A node whose key/slug does not
     resolve to a gated record renders nothing, which is every glossary term and every homebrew page.
     A Builder origin / class-option row opens as `key: 'origin'`, which names no bucket: those resolve
     by exact name among the records created with no rules encoded (unencodedNamed). */
  const origin = cur.key === 'origin'
    ? unencodedNamed(cur.title, content as unknown as Record<string, Record<string, { name?: string }>> | null)
    : undefined;
  const marker = <TrustMarker bucket={origin?.bucket ?? cur.key} id={origin?.id ?? curSlug} />;

  // The ours box (section 4) sits after the body; the caller's footer after the RemasteredLine. With
  // neither, the body's tail is the RemasteredLine alone, exactly as DescriptionModal rendered it.
  const oursBox = ours && ours.length > 0 ? <OursBox lines={ours} /> : null;
  const tail: ReactNode = oursBox || footer ? <>{oursBox}{remastered}{footer}</> : remastered;

  const controls = (
    <>
      {headerActions}
      {showBack && (
        <button className="info-back" aria-label="Back to previous description"
          onClick={(e) => { e.stopPropagation(); back(); }}>
          <i className="ti ti-chevron-left" aria-hidden="true" /> Back
        </button>
      )}
      {pin && (
        <button className={'info-star' + (pinned ? ' on' : '')}
          title={pinned ? `Remove from ${pin.where ?? 'Pinned'}` : `Favorite — add to ${pin.where ?? 'Pinned'}`}
          aria-label={pinned ? `Remove from ${pin.where ?? 'Pinned'}` : `Add to ${pin.where ?? 'Pinned'}`} aria-pressed={pinned}
          onClick={(e) => { e.stopPropagation(); pin.toggle(cur); }}>
          <i className="ti ti-star" aria-hidden="true" />
        </button>
      )}
      <button className="picker-close" onClick={exit} aria-label="Close">
        <i className="ti ti-x" aria-hidden="true" />
      </button>
    </>
  );

  /* Card step 5 — 'mine' (section 2 rules 4–5, section 13). It applies to the record the surface opened,
     the stack's first node; a linked term drilled into from it opens as a browse card (section 6 lists
     ref-link drill-in under browse). The page lane draws the tree with the surface's printed set in
     place of hideMeta, without the appended item lists (S-items, as DescBody did). The no-page lane
     draws the old text through DescBody's own branches and says so. After the body, BOTH lanes keep
     section 2 rule 4's order: the ours box (4.5), then the footer (4.6) — our dimmed Source line (only
     where the page prints none), the RemasteredLine, the desk #152 empty note, the no-page /
     could-not-load line — and the caller's footer last. */
  const mine = mode === 'mine' && stack.length === 1;
  const pageFailed = usePageLoadFailed(mine && !astLoading && !astNode, astBucket ?? cur.key, curSlug);
  const curRec = mine && cur.key ? (content as unknown as Record<string, Record<string, { source?: SourceInfo; id?: string } | undefined> | undefined> | null)?.[cur.key]?.[curSlug] : undefined;
  const homebrew = mine && (curSlug.startsWith('hb-') || curRec?.source?.license === 'homebrew');
  // Our Source line, read off the record's fields — marked ours on BOTH lanes: it is not the page's words.
  const sourceLine = curRec?.source?.book
    ? <div data-ours="" className="card-foot-source"><p className="card-dim card-source"><strong>Source</strong> {curRec.source.book}{curRec.source.page ? ` pg. ${curRec.source.page}` : ''}</p></div>
    : null;
  // desk #152: the old text is empty and there is no page — said once, in the footer (rule 4.6).
  const emptyNote = !cur.description && fallbackText ? <p className="sd-ours sd-unprinted">{fallbackText}</p> : null;

  if (mine && astNode) {
    const shown = withoutItemLists(astNode);
    // Our Source line stands in only where the page prints none. (Measured: 0 of the 2,774 statDetail
    // page rows lack a Source line today, so it is kept for the surfaces still to come.)
    const ownSource = sourceLine && !treeHasSource(shown) ? sourceLine : null;
    return (
      <div className="picker-overlay" onClick={exit}>
        <div ref={modalRef} className="ast-modal card-mine" onPointerDown={liftCapOnGrip} onClick={(e) => e.stopPropagation()}>
          <AstRenderer node={shown} selfRef={`${astBucket}:${curSlug}`} onOpenRef={openRef} card={{ printed: printedSet(printed) }}
            headerControls={<>{marker}{controls}</>} footer={<>{oursBox}{ownSource}{remastered}{footer}</>} />
        </div>
      </div>
    );
  }
  if (mine && !astLoading) {
    return (
      <div className="picker-overlay" onClick={exit}>
        <div ref={modalRef} className="picker info-modal card-mine" onClick={(e) => e.stopPropagation()}>
          <div className="picker-head">
            {headerActions}
            {showBack && (
              <button className="info-back" aria-label="Back to previous description"
                onClick={(e) => { e.stopPropagation(); back(); }}>
                <i className="ti ti-chevron-left" aria-hidden="true" /> Back
              </button>
            )}
            <span className="info-title">{cur.title}</span>
            {pin && (
              <button className={'info-star' + (pinned ? ' on' : '')}
                title={pinned ? `Remove from ${pin.where ?? 'Pinned'}` : `Favorite — add to ${pin.where ?? 'Pinned'}`}
                aria-label={pinned ? `Remove from ${pin.where ?? 'Pinned'}` : `Add to ${pin.where ?? 'Pinned'}`} aria-pressed={pinned}
                onClick={(e) => { e.stopPropagation(); pin.toggle(cur); }}>
                <i className="ti ti-star" aria-hidden="true" />
              </button>
            )}
            <button className="picker-close" onClick={exit} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
          <div className="info-body card-body">
            {marker}
            {/* The fallback lane is DescBody's own markdown / rich-HTML branches, untouched (section 5):
                no tree key, so it never reaches a page. desk #152's empty note is drawn below, in the
                footer's place (rule 4.6), with DescBody's markup, rather than as DescBody's emptyNote. */}
            <DescBody description={cur.description} descRefs={cur.descRefs} onExit={exit} />
            {oursBox}
            {sourceLine}
            {remastered}
            {emptyNote}
            {homebrew
              ? <p className="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">Homebrew</p>
              : !cur.key || pageFailed === undefined
                ? null
                : pageFailed
                  ? <p className="sd-ours card-nopage" data-ours="" data-ours-kind="pageFailed">The Archives page could not load on this device — text from our older import</p>
                  : <p className="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">No Archives page — text from our older import</p>}
            {footer}
          </div>
        </div>
      </div>
    );
  }

  // Ast path — the design-approved popup, with HH's Back/pin/close in its header.
  if (astNode) {
    return (
      <div className="picker-overlay" onClick={exit}>
        <div ref={modalRef} className="ast-modal" onPointerDown={liftCapOnGrip} onClick={(e) => e.stopPropagation()}>
          {/* The ast popup owns its own head + body markup; this component reaches it through two slots:
              `headerControls` (the trust marker, pin and close) and `footer`, where desk #158's
              "Remastered as" line goes — after the page's prose, inside the scrolling body. */}
          <AstRenderer node={astNode} selfRef={`${astBucket}:${curSlug}`} onOpenRef={openRef} headerControls={<>{marker}{controls}</>} footer={tail} />
        </div>
      </div>
    );
  }

  // The record HAS an ast still loading: show the popup shell + a placeholder body instead of flashing the
  // plain-text/markdown fallback (which looks like a different, wrong layout for a beat).
  if (astLoading) {
    return (
      <div className="picker-overlay" onClick={exit}>
        <div ref={modalRef} className={mine ? 'ast-modal card-mine' : 'ast-modal'} onPointerDown={liftCapOnGrip} onClick={(e) => e.stopPropagation()}>
          <div className="ast-pop">
            <div className="ast-bar" />
            <div className="ast-head">
              <span className="ast-name">{cur.title}</span>
              <span className="ast-head-right"><span className="ast-controls">{controls}</span></span>
            </div>
            {/* Inside the body, so it picks up the body's padding rather than sitting flush against
                the popup edge — and so the warning is there from the first frame, not after the ast
                lands. */}
            <div className="ast-body ast-loading" aria-busy="true">{marker}</div>
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
          {/* headerActions sit where the page branch puts them: straight before Back, so a caller's
              buttons keep one order — actions, Back, star, close — on every branch (card step 4). */}
          {headerActions}
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
          {marker}
          <RichText text={cur.description} refs={cur.descRefs} onOpen={open} selfLabel={cur.title} />
          {tail}
        </div>
      </div>
    </div>
  );
}

/** Section 2 rule 3: "No Archives page" is a claim, so the mine card makes it only when the record's
 *  page bucket ARRIVED and does not hold it. loadBucketAst resolves {} on any fetch or decode error (no
 *  DecompressionStream on an old WebView, offline with the bucket not cached — astStore.ts
 *  fetchBucketAst), and no shipped bucket is empty, so an empty bucket means "did not load". A slug the
 *  page index names is expected to have a page; an index that itself came back empty proves nothing,
 *  so it counts as "did not load" too. A bucket with no file at all (an empty map) and a slug the
 *  loaded index does not name is a record with no page. Undefined until both reads settle (both come
 *  from the module caches once the tree lookup has finished, so the line appears in the same tick). */
function usePageLoadFailed(active: boolean, bucket: string | undefined, slug: string): boolean | undefined {
  const [failed, setFailed] = useState<{ key: string; value: boolean } | undefined>(undefined);
  const key = `${bucket ?? ''}:${slug}`;
  useEffect(() => {
    if (!active) return;
    let alive = true;
    Promise.all([bucket ? loadBucketAst(bucket) : Promise.resolve({}), loadAstIndex()]).then(([map, index]) => {
      const bucketEmpty = Object.keys(map).length === 0;
      const indexEmpty = Object.keys(index).length === 0;
      if (alive) setFailed({ key, value: bucketEmpty && (indexEmpty || slug in index) });
    }, () => { if (alive) setFailed({ key, value: true }); });
    return () => { alive = false; };
  }, [active, bucket, slug, key]);
  return active && failed?.key === key ? failed.value : undefined;
}

/** The stack's first node for a `record` prop: by {bucket, id} the same node a cross-link opens
 *  (openRef above); by its words, a title + text node with no bucket, so it never resolves a page. */
function nodeOfRecord(record: CardRecord | undefined, content: ContentDatabase | null): DescNode {
  if (!record) return { title: '', description: '' };
  if (isRecordRef(record)) {
    const rec = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>> | null)?.[record.bucket]?.[record.id];
    return { title: rec?.name ?? record.id, description: rec?.description ?? '', descRefs: rec?.descRefs, key: record.bucket, slug: record.id };
  }
  return { title: record.title, description: record.text, descRefs: record.refs };
}

/** Section 4: one box after the body, marked `data-ours`, each line attributed to its source record. */
function OursBox({ lines }: { lines: OursLine[] }) {
  return (
    <div className="card-ours" data-ours="">
      {lines.map((l, i) => (
        <p key={`${l.kind}:${i}`} className={`sd-ours card-ours-${l.kind}`} data-ours-kind={l.kind}>
          {l.from ? <span className="card-ours-from">{l.from.name}: </span> : null}
          {l.text}
        </p>
      ))}
    </div>
  );
}
