import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { ContentDatabase, DescRef } from '../rules/types';
import { useContent } from './ContentContext';
import { nodeClassOf, usePinDesc, type PinNode } from './PinContext';
import { lookupRef, type DescNode } from './descref';
import { RichText } from './RichText';
import { useBackHandler, useEscapeClose } from './useEscapeClose';
import { isMobileNow } from './useIsMobile';
import { AstRenderer } from './AstRenderer';
import { TrustMarker } from './TrustMarker';
import { unencodedNamed } from '../data/trustGate';
import { astSlug, useAstNode } from './useAst';
import { loadAstIndex, loadBucketAst } from './astStore';
import { RemasteredLine, remasteredAsOf } from './RemasteredLine';
import { isRecordRef, type CardRecord, type OursLine, type RecordCardProps } from './cardModel';
import { textOf, treeHasSource, withoutItemLists } from './astVisibility';
import type { AstNode } from './astStore';
import { SHARED_FEATURE_FOOTER, classOwnFeatureId, sharedFeatureBook, sharedFeatureFallback } from '../rules/featureText';
import { FUTURE_TREATMENT, LEVEL_FOLDS, linkClassOf, pointerOf, printedSet, scopeTree, withPointer } from './cardScope';
import { DescBody } from './DescBody';
import type { SourceInfo } from '../rules/types';
import { browseResolvesStubs, mineResolvesStubs, useStubbedTree } from './astStubs';

/**
 * THE record card (docs/card-design.md section 2 rule 1). Card step 3 extracted it, unchanged, from
 * DescriptionModal's three branches — the page (ast) popup, the loading placeholder, and the curated
 * markdown / homebrew fallback — so every surface can later render one component.
 *
 * Step 3 builds `mode: 'browse'` with `chrome: 'popup'` only: today's search popup, byte for byte
 * (test/card-browse.test.tsx). Its class names stay exactly DescriptionModal's (.ast-modal,
 * .picker.info-modal …), so PopupSizeLock's SELF_SIZED list and sheet.css need no change. The other
 * modes / chrome came in later steps (below); the reserved props still unread here (stats, transform) are declared in
 * cardModel.ts and not read yet.
 *
 * Step 5 builds `mode: 'mine'` (StatDetailModal's full text): the same shells with a
 * `card-mine` class added — `.ast-modal` is no `.picker`, so PopupSizeLock never pins it, and
 * `.picker.info-modal` is already SELF_SIZED, so the card grows with its content and PopupSizeLock is
 * unchanged. The page lane draws through AstRenderer's `card` prop (the printed set, furniture, dim
 * lines); the browse branches below are untouched.
 *
 * Built in and always present: Back (once drilled in, or with onBackToSource), the PinStar (where a
 * PinContext exists), close, and the TrustMarker. There is NO "Full page" button (owner ruling
 * 2026-10-02, section 13). The card owns drill-in: each click on a linked word pushes that term onto
 * a stack; Back pops one level; Escape, the X and a click outside close the whole chain (onExit).
 *
 * Step 6 builds `mode: 'gm'` with `chrome: 'embed'` (EmbedRecordCard below): the GM screen page.
 *
 * Step 10 adds `leadControls` (the strike popup's Attack / Damage and gated critical specialization):
 * drawn above the text on every 'mine' lane — first in the page's body (AstRenderer `lead`), in the
 * loading placeholder, and above the no-page text — never on a page opened from a link inside the card.
 *
 * Step 14 adds `chrome: 'inset'` (InsetRecordCard below: the 'mine' card's body inside ItemDetail's own
 * frame) and embedded page stubs (src/sheet/astStubs.ts): the inset card draws them when asked (`stubs`),
 * the browse card draws them on an item page.
 *
 * Item 7 of the owner's online list adds `chrome: 'window'` (WindowRecordCard below): the page inside the
 * initiative tracker's floating window or GM-screen pane.
 */
export function RecordCard(props: RecordCardProps) {
  // Two components, not one with a branch: the popup registers on the dismiss stack (useEscapeClose)
  // and an embedded page must not, so the choice is made before any hook runs. Card step 14's inset
  // card (inside ItemDetail's own popup frame, which owns the dismiss entry) registers none either.
  if (props.chrome === 'embed') return <EmbedRecordCard {...props} />;
  if (props.chrome === 'window') return <WindowRecordCard {...props} />;
  if (props.chrome === 'inset') return <InsetRecordCard {...props} />;
  return <PopupRecordCard {...props} />;
}

/**
 * Item 7 of the owner's online list (2026-10-01: "Search everything results open in the tracker's
 * movable, windowed stat-block popup, not a static popup") — mode 'gm', chrome 'window': the page inside
 * the initiative tracker's floating window or GM-screen pane (CampaignTracker.tsx HostPage), the ONE
 * page both draw.
 *  - The window is the frame: its tab is the title and its header carries the star (the host's
 *    controls), so there is no overlay, name, Back, star or close here, and nothing goes on the dismiss
 *    stack (Escape is the window's — CampaignTracker closes the top window).
 *  - Under that header, the rest of the popup's page head: the action glyph, the level badge, the
 *    Archives link, the TrustMarker (where the popup draws it: in the head's controls, beside the badge)
 *    and the trait chips (AstRenderer `windowHead`), then the whole page with its stat lines — the very
 *    body 'embed' draws (nothing dropped; the GM reads Range / Duration mid-fight). The marker is the
 *    page's, not the window header's: it is a line of words that can name what is not applied, which a
 *    one-row header shared with the tabs and the close button has no room to wrap, and a pane holding two
 *    tabs draws no header at all. A record with no page draws it above its text, as the popup does.
 *  - A linked word, a trait chip and the "Remastered as" name open through the host with the point they
 *    were clicked at (onOpenRef): another window there. A record with no page shows its text (DescBody),
 *    whose links go the same way (onOpenRecord) instead of opening a popup inside the window.
 *  - 'embed' is left exactly as it was: test/card-hostpage.test.tsx keeps it equal to the pre-card page.
 */
function WindowRecordCard({ record, content: hostContent, onOpenRef }: RecordCardProps) {
  const ctxContent = useContent();
  const db = hostContent ?? ctxContent;
  const ref = record && isRecordRef(record) ? record : undefined;
  const rec = ref ? (db as unknown as Record<string, Record<string, { description?: string; descRefs?: DescRef[] }> | undefined> | null)?.[ref.bucket]?.[ref.id] : undefined;
  const { node, loading } = useAstNode(ref?.bucket, ref?.id);
  const open = onOpenRef ?? noOpen;
  const ra = ref ? remasteredAsOf(db, ref) : undefined;
  if (record && !isRecordRef(record)) return <div className="ast-win ast-win-text"><DescBody description={record.text} descRefs={record.refs} onOpenRecord={open} /></div>;
  if (!ref || !rec) return <div className="ast-win ast-win-text"><p className="sd-ours">This page is not in this version of Heroes Heaven.</p></div>;
  const marker = <TrustMarker bucket={ref.bucket} id={ref.id} />;
  if (node) return <AstRenderer node={node} windowHead selfRef={`${ref.bucket}:${ref.id}`} onOpenRef={open} headerControls={marker} footer={ra ? <RemasteredLine ra={ra} onOpen={open} /> : null} />;
  if (loading) return <div className="ast-win"><div className="ast-body ast-loading" aria-busy="true">{marker}</div></div>;
  return <div className="ast-win ast-win-text">{marker}<DescBody description={rec.description} descRefs={rec.descRefs} remasteredAs={ra} onOpenRecord={open} /></div>;
}

/**
 * Card step 6 — mode 'gm', chrome 'embed' (docs/card-design.md section 6: "gm: HostPage … The whole page
 * with its stat lines, embed chrome"). The page a GM pinned to the GM screen (CampaignTracker.tsx
 * HostPage), drawn byte for byte as HostPage drew it before the card (test/card-hostpage.test.tsx):
 *  - the tracker window owns the frame, so there is no overlay, header, Back, star or close, and nothing
 *    goes on the dismiss stack (useEscapeClose would arm the phone's Back trap on mount);
 *  - the whole page with its stat lines (Range, Duration, Source …) — nothing is dropped, as on browse;
 *  - a linked word and the "Remastered as" name open through the host (onOpenRef: the GM's own popup),
 *    since an embedded page has no stack to drill into;
 *  - a record with no page shows its text (DescBody); one this version does not ship says so.
 * The record is read off the host's `content` when given (the tracker holds its own), else the context.
 */
function EmbedRecordCard({ record, content: hostContent, onOpenRef }: RecordCardProps) {
  const ctxContent = useContent();
  const db = hostContent ?? ctxContent;
  const ref = record && isRecordRef(record) ? record : undefined;
  const rec = ref ? (db as unknown as Record<string, Record<string, { description?: string; descRefs?: DescRef[] }> | undefined> | null)?.[ref.bucket]?.[ref.id] : undefined;
  const { node, loading } = useAstNode(ref?.bucket, ref?.id);
  const open = onOpenRef ?? noOpen;
  // desk #158: a pinned old printing says what it was remastered as; the name opens the reprint through the host.
  const ra = ref ? remasteredAsOf(db, ref) : undefined;
  if (record && !isRecordRef(record)) return <DescBody description={record.text} descRefs={record.refs} />;
  if (!ref || !rec) return <p className="sd-ours">This page is not in this version of Heroes Heaven.</p>;
  if (node) return <AstRenderer node={node} bodyOnly selfRef={`${ref.bucket}:${ref.id}`} onOpenRef={open} footer={ra ? <RemasteredLine ra={ra} onOpen={open} /> : null} />;
  if (loading) return <div className="ast-body ast-loading" aria-busy="true" />;
  return <DescBody description={rec.description} descRefs={rec.descRefs} remasteredAs={ra} />;
}
const noOpen = () => undefined;

/**
 * Card step 14 — chrome 'inset', mode 'mine' (docs/card-design.md section 2 rules 4–6, section 5 "Item
 * controls and computed rows", section 9 row 14): the card's BODY where ItemDetail drew the item's
 * description. ItemDetail keeps its frame — header (name, PinStar, edit, remove, close), sub-line,
 * TrustMarker, trait / rune chips, the stat block (itemStatRows), every control in its order, and the
 * phone Remove bar outside the scrolling body — and owns the dismiss entry, so this registers none.
 *  - Page lane: the record's page by {bucket, id} through the same cuts as the popup 'mine' card — the
 *    printed set (`printed`, the frame's stat-row labels) in place of hideMeta, so a header line the stat
 *    block already printed is left off (S-printed) and every other page line shows once, in the page's
 *    words (Activate, Access, Craft Requirements, Usage …); S-furniture; the item lists cut (S-items);
 *    the character's folds (scopeTree). With `stubs` the embedded page stubs draw their pages
 *    (astStubs.ts): a weapon's group effect, an armor's specialization.
 *  - While the page loads: the quiet placeholder ItemDetail always showed (no flash of the old text).
 *  - No-page lane: the old text through DescBody's own branches, then the footer lines every mine card
 *    carries (our Source line, the RemasteredLine, desk #152's empty note, "Homebrew" / "Not from the
 *    Archives — our text" / the could-not-load line).
 *  - A linked word (and the "Remastered as" name) opens the browse card over the item, Back returning to
 *    it — what the item's DescBody did.
 */
function InsetRecordCard({ record, node, scope, printed, ours, footer, fallbackText, stubs, onExit }: RecordCardProps) {
  const content = useContent();
  const root = node ?? nodeOfRecord(record, content);
  const slug = root.slug ?? astSlug(root.title);
  const { node: astNode, bucket: astBucket, loading } = useAstNode(root.key, slug);
  const host = astBucket ?? root.key ?? '';
  const ptr = pointerOf(host, slug, scope);
  const ptrAt = ptr ? ptr.pageKey.indexOf(':') : -1;
  const { node: ptrPage } = useAstNode(ptr ? ptr.pageKey.slice(0, ptrAt) : undefined, ptr ? ptr.pageKey.slice(ptrAt + 1) : undefined);
  const shared = !loading ? sharedFeatureView(root, slug, astNode, scope?.classId, content) : null;
  const scoped = astNode && !shared?.otherClassPage
    ? withPointer(scopeTree(withoutItemLists(astNode), scope, LEVEL_FOLDS, FUTURE_TREATMENT), ptrPage, ptr, scope, LEVEL_FOLDS, FUTURE_TREATMENT)
    : undefined;
  const { tree: page } = useStubbedTree(scoped, `${host}:${slug}`, content, !!stubs);
  const pageFailed = usePageLoadFailed(!loading && !astNode, host || undefined, slug);
  const [drill, setDrill] = useState<DescNode | null>(null);
  const openRef = (bucket: string, s: string) => {
    const rec = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>> | null)?.[bucket]?.[s];
    if (rec) setDrill({ title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: bucket, slug: s });
  };
  const close = () => setDrill(null);
  const drillCard = drill ? <RecordCard node={drill} mode="browse" chrome="popup" onExit={onExit ?? close} onBackToSource={onExit ? close : undefined} /> : null;
  const ra = remasteredAsOf(content, { bucket: root.key, id: slug });
  const remastered = ra ? <RemasteredLine ra={ra} onOpen={openRef} /> : null;
  const oursBox = ours && ours.length > 0 ? <OursBox lines={ours} /> : null;
  const curRec = root.key ? (content as unknown as Record<string, Record<string, { source?: SourceInfo } | undefined> | undefined> | null)?.[root.key]?.[slug] : undefined;
  const homebrew = slug.startsWith('hb-') || curRec?.source?.license === 'homebrew';
  // Package M: a shared feature's paragraph names its class's book, never the shared record's (sharedFeatureBook).
  const sourceLine = shared
    ? (shared.book ? <SourceLine book={shared.book} /> : null)
    : curRec?.source?.book ? <SourceLine book={curRec.source.book} page={curRec.source.page} /> : null;

  if (page) {
    return (
      <>
        <div className="sd-desc card-inset">
          <AstRenderer node={page} bodyOnly selfRef={`${astBucket}:${slug}`} onOpenRef={openRef} card={{ printed: printedSet(printed) }}
            footer={<>{oursBox}{sourceLine && !treeHasSource(page) ? sourceLine : null}{remastered}{footer}</>} />
        </div>
        {drillCard}
      </>
    );
  }
  if (loading) return <div className="sd-desc card-inset ast-loading" aria-busy="true">{oursBox}</div>;
  const emptyNote = !root.description && fallbackText ? <p className="sd-ours sd-unprinted">{fallbackText}</p> : null;
  return (
    <>
      <div className="sd-desc card-inset">
        {/* DescBody's own markdown / rich-HTML branches, no tree key (section 5): it never reaches a page. */}
        {shared?.pending
          ? <div className="card-inset-text ast-loading" aria-busy="true" />
          : <DescBody description={shared ? shared.text : root.description} descRefs={root.descRefs} className="card-inset-text" onExit={onExit} />}
        {oursBox}
        {sourceLine}
        {remastered}
        {emptyNote}
        {homebrew
          ? <p className="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">Homebrew</p>
          : shared
            ? <p className="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">{SHARED_FEATURE_FOOTER}</p>
            : !root.key || pageFailed === undefined
              ? null
              : pageFailed
                ? <p className="sd-ours card-nopage" data-ours="" data-ours-kind="pageFailed">The Archives page could not load on this device — our text</p>
                : <p className="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">Not from the Archives — our text</p>}
        {footer}
      </div>
      {drillCard}
    </>
  );
}

/** The popup card (modes 'browse' and 'mine', chrome 'popup'). */
function PopupRecordCard({ record, node, mode, scope, printed, controls: bodyControls, leadControls, headerActions, ours, footer, fallbackText, onExit, onBackToSource }: RecordCardProps) {
  const content = useContent();
  const exit = onExit;
  useEscapeClose(exit);
  // The VIEWPORT, not useIsMobile(): a tracker pane forces the phone layout on a desktop, and there
  // Escape must keep closing the whole chain. Same test the dismiss stack arms the phone's Back with.
  const isMobile = isMobileNow();
  const pin = usePinDesc();
  const [stack, setStack] = useState<DescNode[]>(() => [node ?? nodeOfRecord(record, content)]);
  const cur = stack[stack.length - 1];
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

  /* Package M (2026-10-16): a class feature linked from a class's page (or from a mine card, for the
     character's class) opens the record that class lists for it (featureText.ts classOwnFeatureId): the
     magus page's "weapon expertise" opens the magus's Weapon Expertise, the swashbuckler table's "weapon
     mastery" its Martial Weapon Mastery — not the shared record whose page is the Thaumaturge's. The class
     is the nearest class page on the stack up to the link, else the character's (cardScope.ts
     linkClassOf). Any other link opens what it names, as before. */
  const trail = (upto: number) => stack.slice(0, upto + 1).map((n) => ({ key: n.key, slug: n.slug ?? astSlug(n.title), classId: nodeClassOf(n) }));
  const ownId = (bucket: string | undefined, slug: string) =>
    bucket === 'classFeatures' && content ? classOwnFeatureId(slug, linkClassOf(trail(stack.length - 1), scope?.classId), content) : slug;
  const mine = mode === 'mine' && stack.length === 1;
  /* Card step 12 / package M: the class the open node is read for — the mine card's scope (else, with no
     character, the class its node carries); a page opened from a link: the nearest class page on the stack
     below it, else the character's (linkClassOf); the stack's first node of a browse card: the class it
     carries (package M round 2 — a pin reopened from the Pinned list keeps the class it was read for,
     PinnedDesc.classId), else none, as before (search). */
  const viewerClass = mine
    ? scope?.classId ?? nodeClassOf(cur)
    : stack.length > 1 ? linkClassOf(trail(stack.length - 2), scope?.classId) : nodeClassOf(cur);
  /* Polish round (docs/card-design.md section 6: "A pin made from the sheet reopens as mine at the
     character's current level"; section 7: "new pins store bucket + id + mode"): the built-in star of the
     record a 'mine' card opened — the action card, StatDetailModal's full text, any mine card without a
     star of its own — hands over its {key, slug, title} with mode 'mine', as FeatDetail / ItemDetail /
     StrikeDetailModal do, so MainTab's PinnedDescCard reopens it as the character's own card. A page
     opened from a link inside the card is a browse card (section 6) and pins as it always did; a browse
     card's star stores no mode, so a pin made from search keeps reopening as browse. The mode is never
     part of the identity (play.ts samePin): has() reads the same pin either way.
     Package M round 2 (section 7, "Pins keep the class"): a CLASS FEATURE's star also stores the class it
     is read for (`classId`) — a linked Perception Expertise starred under the Cleric page, a Dual Class
     second-class row — so the reopened card reads that class's paragraph, not the shared record's page. Not
     part of the identity either; a node read for no class (search) stores none and reopens as before. */
  const pinClass = cur.key === 'classFeatures' ? viewerClass : undefined;
  // With nothing to add, the star hands over the node itself, as it always did (test/card-browse.test.tsx).
  const pinNode: PinNode = mine || pinClass
    ? { ...cur, ...(mine ? { mode: 'mine' as const } : {}), ...(pinClass ? { classId: pinClass } : {}) }
    : cur;
  const pinned = pin?.has(pinNode) ?? false;
  // Open a linked term: from an ast cross-link (resolved "bucket:slug") …
  const openRef = (bucket: string, slug: string) => {
    const id = ownId(bucket, slug);
    const rec = (content as unknown as Record<string, Record<string, { name: string; description?: string; descRefs?: DescRef[] }>> | null)?.[bucket]?.[id];
    if (rec) setStack((s) => [...s, { title: rec.name, description: rec.description ?? '', descRefs: rec.descRefs, key: bucket, slug: id }]);
  };
  // … or from a markdown DescRef (fallback path).
  const open = (ref: DescRef) => {
    if (!content) return;
    const n = lookupRef(content, ref);
    if (n?.key && n.slug && ownId(n.key, n.slug) !== n.slug) openRef(n.key, n.slug);
    else if (n) setStack((s) => [...s, n]);
  };
  /* desk #158 — the old printing says what it was remastered as, and the name opens that record here, on
     this stack, whatever its bucket. Read by bucket/slug off the content, because this popup holds a
     node, not the record: an item-bonus line or a trait reaches the player no other way. */
  const ra = remasteredAsOf(content, { bucket: cur.key, id: curSlug });
  const remastered = ra ? <RemasteredLine ra={ra} onOpen={openRef} /> : null;
  const back = () => { if (stack.length > 1) setStack((s) => s.slice(0, -1)); else onBackToSource?.(); };
  const showBack = stack.length > 1 || !!onBackToSource;
  /* On a phone the hardware Back does what the card's own Back button does: one page back after you
     followed a link inside the card (or back to the popup this one opened from). It used to close the
     whole description chain, while the visible "‹ Back" went one step — two Backs that disagreed
     (phone audit B5/C12/D11, 2026-10-14). Pushed while there is somewhere to go back to, so it sits
     above this card's own close entry. Desktop Escape still closes the whole chain, as documented. */
  useBackHandler(isMobile && showBack, back);

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
  const tail: ReactNode = stack.length === 1 && (oursBox || footer) ? <>{oursBox}{remastered}{footer}</> : remastered;

  /* The surface's headerActions belong to the record it opened — the stack's first node. A page opened
     from a link inside the card is a browse card (section 6), so it never carries them: the action pin
     there would pin the action, the prepare toggle would prepare it (card step 9, refuter round 2). */
  const controls = (
    <>
      {stack.length === 1 ? headerActions : null}
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
          onClick={(e) => { e.stopPropagation(); pin.toggle(pinNode); }}>
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
     could-not-load line — and the caller's footer last. (`mine` is computed above, beside the star.) */
  /* Card step 13a (section 3; owner ruling Q1 = A): a pointer row ("listed in your cause") shows the
     matching section of the character's subclass page — loaded here, before any branch returns. */
  const ptr = mine ? pointerOf(astBucket ?? cur.key, curSlug, scope) : null;
  const ptrAt = ptr ? ptr.pageKey.indexOf(':') : -1;
  const { node: ptrPage } = useAstNode(ptr ? ptr.pageKey.slice(0, ptrAt) : undefined, ptr ? ptr.pageKey.slice(ptrAt + 1) : undefined);
  const pageFailed = usePageLoadFailed(mine && !astLoading && !astNode, astBucket ?? cur.key, curSlug);
  const curRec = mine && cur.key ? (content as unknown as Record<string, Record<string, { source?: SourceInfo; id?: string } | undefined> | undefined> | null)?.[cur.key]?.[curSlug] : undefined;
  const homebrew = mine && (curSlug.startsWith('hb-') || curRec?.source?.license === 'homebrew');
  // desk #152: the old text is empty and there is no page — said once, in the footer (rule 4.6).
  const emptyNote = mine && !cur.description && fallbackText ? <p className="sd-ours sd-unprinted">{fallbackText}</p> : null;
  /* Card step 12 (section 7, "Shared class features"): a class feature the viewer's class shares whose
     page is another class's (Weapon Specialization's is the Thaumaturge's, Reflex Expertise's the
     Guardian's — featureText.ts sharedFeatureFallback, the guard's CLASS_MISMATCH rule) is drawn from our
     older text, cut to the viewer's own class paragraph, with its own footer — a page exists, just not
     for this class. Per-class pages come with the data rebuild. Not decided while the page loads.
     Package M (2026-10-16): a page opened from a link inside the card gets it too — read for the nearest
     class page on the stack below it (a class card, or a class page opened from search or a link, however
     many links deep), else the character's (the mine card's scope); with neither (search, a description's
     link) it stays the record's own page, as before. When that class's paragraph applies, the node draws
     this no-page lane. Package M round 2: and the first node of a browse card that carries its class (a
     reopened pin, `viewerClass` above). */
  const shared = (mine || stack.length > 1 || !!nodeClassOf(cur)) && !astLoading ? sharedFeatureView(cur, curSlug, astNode, viewerClass, content) : null;
  // Our Source line, read off the record's fields — marked ours on BOTH lanes: it is not the page's words.
  // Package M: under a shared feature's class paragraph, the class's own book (sharedFeatureBook), never the
  // shared record's (the swashbuckler's Player Core 2 paragraph read "Dark Archive", the Thaumaturge's).
  const sourceLine = shared
    ? (shared.book ? <SourceLine book={shared.book} /> : null)
    : curRec?.source?.book ? <SourceLine book={curRec.source.book} page={curRec.source.page} /> : null;
  /* Card step 10: the surface's controls that stay above the text on every mine lane (cardModel
     leadControls — Strike's Attack / Damage and its gated critical specialization). The record the
     surface opened only: a page opened from a link inside the card is a browse card (section 6). */
  const lead = mine && leadControls ? <div className="card-controls card-lead">{leadControls}</div> : null;
  /* Card step 14 (section 2 rule 6; src/sheet/astStubs.ts): the browse card of an item page draws the
     pages its stubs embed — a weapon's group effect, an armor's specialization — one level deep, as the
     item's own card does. A page whose stub buckets are still loading draws its stubs empty for a beat.
     Which buckets draw them is browseResolvesStubs (astStubs.ts).
     Card step 14b: every bucket in STUB_HOST_BUCKETS, an archetype page's feats as a compact linked list,
     and a stub no record's page answers as its name (a link when a record exists for it). */
  const stubHost = astBucket ?? cur.key ?? '';
  /* Card step 13a: with the character's scope, the sections it does not have yet fold (scopeTree reads
     only scripts/data/level-folds.json; FUTURE_TREATMENT is the one switch), applying impulse "Level"
     entries are highlighted, and a pointer row gains its subclass section. No scope → the page whole.
     Card step 13c: the record's own pick (scope.picks["bucket:id"]) scopes its choose-one blocks. */
  const mineTree = mine && astNode && !shared?.otherClassPage
    ? withPointer(scopeTree(withoutItemLists(astNode), scope, LEVEL_FOLDS, FUTURE_TREATMENT, `${cur.key}:${curSlug}`), ptrPage, ptr, scope, LEVEL_FOLDS, FUTURE_TREATMENT)
    : undefined;
  /* Card step 14b (section 2 rule 6): the 'mine' popup draws the pages its record's stubs embed too —
     Rage's class feature shows the Rage action — for every bucket but items (mineResolvesStubs: the Strike
     card keeps its gate; an item's own card is ItemDetail's inset). The stubs resolve AFTER the host page
     is scoped, so the folds (13a / 13c) apply to the host page only and an embedded page is drawn as it
     ships: it is another record's page, never the character's. */
  const stubBase = mine ? mineTree : shared?.otherClassPage ? undefined : astNode;
  const { tree: stubbed } = useStubbedTree(stubBase, `${stubHost}:${curSlug}`, content,
    !!stubBase && (mine ? mineResolvesStubs(stubHost) : browseResolvesStubs(stubHost)));
  const browseTree = mine ? undefined : stubbed;

  if (mine && astNode && mineTree) {
    const shown = stubbed ?? mineTree;
    // Our Source line stands in only where the page prints none — the host page's own lines, never an
    // embedded page's. (Measured: 0 of the 2,774 statDetail page rows lack a Source line today, so it is
    // kept for the surfaces still to come.)
    const ownSource = sourceLine && !treeHasSource(mineTree) ? sourceLine : null;
    return (
      <div className="picker-overlay" onClick={exit}>
        <div ref={modalRef} className="ast-modal card-mine" onPointerDown={liftCapOnGrip} onClick={(e) => e.stopPropagation()}>
          <AstRenderer node={shown} selfRef={`${astBucket}:${curSlug}`} onOpenRef={openRef} card={{ printed: printedSet(printed) }}
            headerControls={<>{marker}{controls}</>} footer={<>{oursBox}{ownSource}{remastered}{footer}</>} lead={lead ?? undefined} />
        </div>
      </div>
    );
  }
  // The no-page lane: the mine card without its page, and (package M) a linked shared feature read for a
  // class. The surface's own parts — header actions, controls, ours box, footer — belong to the record the
  // surface opened, so a linked node draws none of them.
  if ((mine || shared) && !astLoading) {
    return (
      <div className="picker-overlay" onClick={exit}>
        <div ref={modalRef} className="picker info-modal card-mine" onClick={(e) => e.stopPropagation()}>
          <div className="picker-head">
            {mine ? headerActions : null}
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
                onClick={(e) => { e.stopPropagation(); pin.toggle(pinNode); }}>
                <i className="ti ti-star" aria-hidden="true" />
              </button>
            )}
            <button className="picker-close" onClick={exit} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
          <div className="info-body card-body">
            {marker}
            {lead}
            {/* Card step 9 (section 2 rule 4.3): the surface's controls, above the text. */}
            {mine && bodyControls ? <div className="card-controls">{bodyControls}</div> : null}
            {/* The fallback lane is DescBody's own markdown / rich-HTML branches, untouched (section 5):
                no tree key, so it never reaches a page. desk #152's empty note is drawn below, in the
                footer's place (rule 4.6), with DescBody's markup, rather than as DescBody's emptyNote.
                Package M: a shared feature whose text has not arrived yet (descriptions load after
                core.json) shows the quiet placeholder, never the other class's page. */}
            {shared?.pending
              ? <div className="sd-desc ast-loading" aria-busy="true" />
              : <DescBody description={shared ? shared.text : cur.description} descRefs={cur.descRefs} onExit={exit} />}
            {mine ? oursBox : null}
            {sourceLine}
            {remastered}
            {emptyNote}
            {homebrew
              ? <p className="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">Homebrew</p>
              : shared
                ? <p className="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">{SHARED_FEATURE_FOOTER}</p>
                : !cur.key || pageFailed === undefined
                  ? null
                  : pageFailed
                    ? <p className="sd-ours card-nopage" data-ours="" data-ours-kind="pageFailed">The Archives page could not load on this device — our text</p>
                    : <p className="sd-ours card-nopage" data-ours="" data-ours-kind="noPage">Not from the Archives — our text</p>}
            {mine ? footer : null}
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
          <AstRenderer node={browseTree ?? astNode} selfRef={`${astBucket}:${curSlug}`} onOpenRef={openRef} headerControls={<>{marker}{controls}</>} footer={tail} />
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
                lands. Card step 11 (section 5, "footer and ours slot on every branch"): a mine card keeps
                its ours box here too, so the pick / marker / note is on screen from the first frame. */}
            {/* Card step 10: the lead controls too (Strike's Attack / Damage), so they never vanish for a beat. */}
            <div className="ast-body ast-loading" aria-busy="true">{marker}{mine ? lead : null}{mine ? oursBox : null}</div>
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
              buttons keep one order — actions, Back, star, close — on every branch (card step 4). Like the
              page and loading branches, only on the stack's first node: a linked page whose bucket
              failed to load lands here as a browse card and carries none (card step 9, fixer round 3). */}
          {stack.length === 1 ? headerActions : null}
          {showBack && (
            <button className="info-back" aria-label="Back to previous description"
              onClick={(e) => { e.stopPropagation(); back(); }}>
              <i className="ti ti-chevron-left" aria-hidden="true" /> Back
            </button>
          )}
          <span className="info-title">{cur.title}</span>
          {/* The star names where it pins, as the page and mine branches do: inside the tracker that is
              the GM screen, not "Pinned" (the owner's 2026-10-01 list, item 1 — this branch said Pinned). */}
          {pin && (
            <button className={'info-star' + (pinned ? ' on' : '')}
              title={pinned ? `Remove from ${pin.where ?? 'Pinned'}` : `Favorite — add to ${pin.where ?? 'Pinned'}`}
              aria-label={pinned ? `Remove from ${pin.where ?? 'Pinned'}` : `Add to ${pin.where ?? 'Pinned'}`} aria-pressed={pinned}
              onClick={(e) => { e.stopPropagation(); pin.toggle(pinNode); }}>
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

/** Section 2 rule 3: "Not from the Archives" is a claim, so the mine card makes it only when the record's
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

/** Card step 12: the viewer's view of a shared class feature (featureText.ts sharedFeatureFallback) — null
 *  unless the record is a class feature, a viewing class is known, and the fallback applies. `text` is the
 *  record's own text cut to the viewer's class paragraph; `pending` (package M) says that text has not
 *  arrived yet (the descriptions load after core.json); `book` is the Source line's book: the viewing
 *  class's own (sharedFeatureBook), never the shared record's. */
function sharedFeatureView(cur: DescNode, slug: string, page: AstNode | undefined, viewerClass: string | undefined, content: ContentDatabase | null):
  { text: string; otherClassPage: boolean; pending: boolean; book: string | undefined } | null {
  if (!content || cur.key !== 'classFeatures' || !viewerClass) return null;
  const text = sharedFeatureFallback(slug, viewerClass, page ? textOf(page) : undefined, content);
  if (text === null) return null;
  return { text, otherClassPage: !!page, pending: content.classFeatures?.[slug]?.description === undefined, book: sharedFeatureBook(viewerClass, content) };
}

/** Our Source line (rule 4.6), dimmed and marked ours: it is read off fields, never the page's words. */
function SourceLine({ book, page }: { book: string; page?: number }) {
  return <div data-ours="" className="card-foot-source"><p className="card-dim card-source"><strong>Source</strong> {book}{page ? ` pg. ${page}` : ''}</p></div>;
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
