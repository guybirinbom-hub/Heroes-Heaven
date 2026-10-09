import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ContentDatabase } from '../rules/types';
import type { SavedChar } from '../data/storage';
import { applyPlayState } from '../rules/play';
import { rememberPartyCapabilities } from '../data/partyCapabilities';
import { fetchParty, fetchMemberRow, fetchPendingGmEdits, currentUserId, kickFromParty, subscribeParty, subscribeMemberSheet, type PartyMember } from '../data/party';
import {
  gmEditRefused,
  gmEditSchemaOutdated,
  gmPendingEdit,
  gmPendingVersion,
  memberPublishedRow,
  pendingEditStillStands,
  resolvePendingGmEdit,
  subscribeGmPending,
} from './gmSync';
import { memberCardSummary, useMemberSheets } from './memberSheets';
import { memberConditions, memberSummary, type PartySummary } from './partySummary';
import { CharacterSheet } from './CharacterSheet';
import { GmEditSheet, type GmEditHandle } from './GmEditSheet';
import { confirmDialog } from './confirm';
import { RankPill } from './widgets';
import { useBackHandler } from './useEscapeClose';

const LOAD_ERROR = "Couldn't load the party. Check your connection, or that the campaign SQL has been run.";

/** One array, so switching the member loader off can't look like a new list every render. */
const NO_MEMBERS: PartyMember[] = [];

interface ViewingState {
  campaignId: string;
  ownerId: string;
  charId: string;
  sheet: SavedChar;
  /**
   * The PLAYER's published summary, carried into the sheet so the two can't disagree about a
   * condition their app derived and this device can't.
   *
   * ⚠ It is re-read with the sheet on every refresh (`fetchMemberRow`), never captured at open time.
   * A carried pill is locked and says "it disappears when its cause does" — and when this was frozen
   * at open, it didn't: the player dropped the loot, republished, the HP and inventory on the GM's
   * screen updated around a stale "Encumbered" that only closing the sheet could clear.
   */
  summary?: PartySummary;
  /**
   * The signed-in account AT OPEN TIME — the raw answer, so both questions below are asked of the
   * same one: "is this mine?" (the label) and "is this positively someone else's?" (GM edit).
   *
   * ⚠ Stored rather than re-read while rendering. A GM-edit warning that flashes on your own
   * character and then corrects itself is the owner's report all over again, just faster. `null`
   * means the account was not known when the card was opened, which is neither yes nor no.
   */
  myId: string | null;
}

/**
 * "A GM edit is waiting for this character" — module state, so it re-renders every card and sheet at
 * once. The version counter is the store's snapshot; see ./gmSync.ts for what puts an edit in it and
 * what takes it out again.
 */
export function useGmPendingVersion(): number {
  return useSyncExternalStore(subscribeGmPending, gmPendingVersion, gmPendingVersion);
}

/** The signed-in account's id once auth has ANSWERED. `authChecked` is what tells "still asking"
 *  from "genuinely signed out" — `myId` is null for both. */
export function useMyId(): { myId: string | null; authChecked: boolean } {
  const [myId, setMyId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  useEffect(() => {
    void currentUserId()
      .then(setMyId)
      .finally(() => setAuthChecked(true));
  }, []);
  return { myId, authChecked };
}

/**
 * "This member IS the signed-in user, and the character is on THIS device" — the one test every
 * campaign surface asks before opening a card. Answers the roster id to open, or null.
 *
 * Your own character is never a GM-edit target and never a read-only copy of your own published row:
 * the published row is a shadow of what this device holds, so editing it there is edit-and-lose, and
 * reading it there is being shown your own sheet through a keyhole.
 *
 * `charId` IS the roster id — App publishes `sc.id` (see its publish effect), and roster ids survive
 * cloud sync between a user's devices — so the match is BY ID ONLY. The owner's ruling: no name
 * fallback. A different local character that merely shares the published name is not this character,
 * and opening it on a name guess would be the WRONG sheet.
 */
export function ownRosterId(
  member: { ownerId: string; charId: string; name?: string },
  myId: string | null,
  roster?: { id: string; name: string }[],
): string | null {
  if (!myId || member.ownerId !== myId || !roster?.length) return null;
  return roster.some((c) => c.id === member.charId) ? member.charId : null;
}

/**
 * "We KNOW this member is somebody else" — the ONLY answer that may open a GM-edit sheet.
 *
 * ⚠ This is not `ownerId !== myId`, and the difference is the whole bug. `myId` is null while the
 * auth answer is still in flight AND when it failed, and `ownerId !== null` is true of your own card
 * too — so that test hands a GM their own character wearing "GM editing X — changes reach the player
 * only when you Update" in precisely the window a GM taps a card (the party list paints as soon as
 * its own fetch lands, which is a different request from the auth one). Not knowing answers FALSE:
 * read the sheet, don't edit it. A sheet read by mistake costs a tap; a sheet edited by mistake is
 * work the owning device silently overwrites on its next publish.
 *
 * Exported because the tracker's card has to ask the same question, and asking it a second way is
 * how the two surfaces came apart in the first place.
 */
export function knownToBeOther(ownerId: string, myId: string | null): boolean {
  return !!myId && ownerId !== myId;
}

/** Teammate-sheet viewer shared by the party page and the GM campaign detail. Returns the full-screen
 *  sheet element (or null) plus an `open(campaignId, charId, ownerId)` to load + show it. Render
 *  `sheetEl` with an early return from the host page so the sheet takes over the screen. With
 *  `{ gmEdit: true }` (GM campaign detail) the sheet is fully editable and can push changes back to the
 *  player; otherwise it's a read-only view.
 *
 *  `roster` + `onOpenOwn` are what make YOUR OWN card open YOUR OWN sheet instead of either of those
 *  (see ownRosterId). Both omitted → every card behaves exactly as it did. */
export function useMemberViewer(
  content: ContentDatabase,
  options?: {
    gmEdit?: boolean;
    /** This device's characters (id + name) — the host already has them; App passes the roster down. */
    roster?: { id: string; name: string }[];
    /** Navigate to one of this device's own characters. Absent → no own-sheet route from here. */
    onOpenOwn?: (charId: string) => void;
  },
) {
  const [viewing, setViewing] = useState<ViewingState | null>(null);
  /*
   * Escape / Android-back leave the sheet the same way its own back arrow does. On the GM-edit sheet
   * that means ASKING first (GmEditSheet's confirmLeave: Update / Discard / Cancel when there are
   * unsent changes) — this used to `setViewing(null)` outright, binning an unpushed working copy on
   * one key press while the arrow beside it asked. A read-only sheet has nothing to lose.
   */
  const gmSheetRef = useRef<GmEditHandle>(null);
  useBackHandler(!!viewing, () => {
    const gm = gmSheetRef.current;
    if (!gm) {
      setViewing(null);
      return;
    }
    void gm.confirmLeave().then((ok) => {
      if (ok) setViewing(null);
    });
  });
  // The summary is read HERE, from the same row as the sheet, rather than taken from the card that
  // opened it — see ViewingState.summary for what a card-supplied one could not do.
  const open = async (campaignId: string, charId: string, ownerId: string): Promise<boolean> => {
    /*
     * YOUR OWN character goes to YOUR OWN sheet, and nothing is fetched on the way: the live
     * character this device holds is the one to open, not the snapshot it last published.
     *
     * ⚠ The account is READ HERE, not taken from a rendered `useMyId()`. That hook answers null
     * until auth comes back, and a card tapped inside that window — the first seconds on the
     * campaign page, which is exactly when a GM taps one — would have been judged "not mine" and
     * opened the editor on the owner's own character. `currentUserId` is a local storage read
     * (../data/party), so waiting for it here costs no round-trip.
     */
    const uid = await currentUserId();
    const mine = ownRosterId({ ownerId, charId }, uid, options?.roster);
    if (mine && options?.onOpenOwn) {
      options.onOpenOwn(mine);
      return true;
    }
    const { sheet, summary } = await fetchMemberRow(campaignId, charId);
    if (sheet && sheet.character) {
      setViewing({ campaignId, ownerId, charId, sheet, summary, myId: uid });
      return true;
    }
    return false;
  };
  // A GM's own push changes nothing on the server the pull below watches, so the store that holds it
  // is the trigger: reopen/refresh the sheet on it too, or the sheet under the card would still be
  // showing the pre-Update character.
  const pendingVersion = useGmPendingVersion();

  /*
   * Keep the OPEN sheet live.
   *
   * `open()` takes a snapshot, and until now that snapshot was the whole story: a GM reading a player's
   * sheet saw whatever was published the instant they tapped the card, for as long as they left it
   * open. Subscribing to that one row means the player taking damage, spending a slot or picking up an
   * item shows on the GM's screen as it happens.
   *
   * The GM's EDITING view is deliberately not force-updated here — it owns a working copy, and
   * replacing that out from under a half-finished edit would destroy the GM's work. GmEditSheet takes
   * the live sheet as a prop and decides for itself (adopt it when clean, flag it when dirty).
   */
  const campaignId = viewing?.campaignId;
  const charId = viewing?.charId;
  const pull = useCallback(() => {
    if (!campaignId || !charId) return;
    void fetchMemberRow(campaignId, charId).then(({ sheet, summary, read }) => {
      if (!sheet?.character) return;
      setViewing((v) => {
        // Guard against a late response for a sheet the viewer has since closed or swapped away from.
        if (!v || v.campaignId !== campaignId || v.charId !== charId) return v;
        // The SUMMARY moves with the sheet: a re-publish that drops a derived condition has to drop
        // the carried pill with it, and that pill is joined from this field.
        //
        // ⚠ …but only when the read actually ANSWERED. A failed read (`read === false`) hands back
        // `undefined` here, and writing that in would erase the player's carried "Encumbered" from
        // an open GM sheet on one bad response — the owner's own symptom, from a network blip rather
        // than from anything the player did. The sheet half of the same response already works this
        // way (the pending overlay stands), and only a NEWER player publish may change what is
        // carried. Keep what we had, and the next successful read moves it on.
        const next = read ? summary : v.summary;
        // Skip identical payloads so an unchanged re-publish doesn't re-render the whole sheet.
        return JSON.stringify(v.sheet) !== JSON.stringify(sheet) || JSON.stringify(v.summary) !== JSON.stringify(next)
          ? { ...v, sheet, summary: next }
          : v;
      });
    });
  }, [campaignId, charId]);
  /*
   * The SUBSCRIPTION's own effect — and `pendingVersion` is deliberately not one of its deps.
   *
   * Every Update bumps that counter, and so does every point of damage the GM applies in the tracker
   * (its push → pushGmEdit → rememberGmEdit). Having it here tore this channel down and re-joined
   * the same deterministic topic in the same tick, with the leave still in flight — a Supabase
   * footgun whose symptom is a feed that quietly stops delivering, which is the very "the GM is
   * looking at stale data" complaint being fixed. Only the re-PULL needs to follow the store.
   */
  useEffect(() => {
    if (!campaignId || !charId) return;
    pull();
    return subscribeMemberSheet(campaignId, charId, pull);
  }, [campaignId, charId, pull]);
  // A GM's own push changes nothing on the server, so no Realtime event ever arrives for it: this is
  // what re-reads the overlay. A plain refetch, no channels touched.
  useEffect(() => {
    pull();
  }, [pendingVersion, pull]);
  /* ⚠ The published summary STAYS while a GM edit of ours is waiting. Standing it down there was the
   * owner's own symptom all over again — press Update and the "Encumbered" only the player's app can
   * work out disappears from the sheet for the whole pending window. Only DERIVED chips are ever
   * carried, and a derived chip is locked on every surface, so there is none a GM edit could have
   * taken off; what the player's app derives changes when the PLAYER publishes, and not before. */
  const summary = viewing?.summary;
  let sheetEl = null;
  if (viewing) {
    /*
     * YOUR character, published from a device this roster isn't.
     *
     * `open()` above could find no roster entry to send you to, so this is the copy on the server —
     * and it must not be handed to the GM editor. A GM edit of your own row is refused downstream
     * anyway (gmSync scopes the pending store to the account that pushed and won't answer with an
     * edit about your own character), so "editable" here would mean typing into a sheet that the
     * owning device's next publish overwrites without a word. It reads instead, and says which
     * character you are looking at rather than claiming you are GM-editing a player.
     *
     * ⚠ The two are asked SEPARATELY, and the GM sheet needs the stronger one. "Not known to be
     * mine" is not "known to be someone else's": with no answer from auth both are false, and the
     * sheet then reads without the label — never edits. See knownToBeOther.
     */
    const ownElsewhere = !!viewing.myId && viewing.ownerId === viewing.myId;
    if (options?.gmEdit && knownToBeOther(viewing.ownerId, viewing.myId)) {
      sheetEl = (
        <div className="party-viewer">
          <GmEditSheet
            key={viewing.charId}
            ref={gmSheetRef}
            initial={viewing.sheet}
            live={viewing.sheet}
            summary={summary}
            content={content}
            campaignId={viewing.campaignId}
            playerOwnerId={viewing.ownerId}
            onExit={() => setViewing(null)}
          />
        </div>
      );
    } else {
      // Read-only: derive the live character from the published SavedChar (play overlaid on the build).
      let live;
      try {
        live = applyPlayState(viewing.sheet.character, viewing.sheet.play, content);
      } catch {
        live = viewing.sheet.character;
      }
      // …through the same one function the card and the GM's sheet use, so a teammate's view can't be
      // the one that goes quiet about a condition the card is showing.
      const merged = memberConditions(live.conditions ?? [], summary?.conditions);
      if (merged !== (live.conditions ?? [])) live = { ...live, conditions: merged };
      sheetEl = (
        <div className="party-viewer">
          <CharacterSheet
            character={live}
            content={content}
            charKey="party-member"
            characters={[]}
            readOnly
            readOnlyNote={ownElsewhere ? `${live.name} — your character, published from another device` : undefined}
            onBack={() => setViewing(null)}
          />
        </div>
      );
    }
  }
  return { sheetEl, open };
}

/** The party for one campaign — member cards (+ GM kick). Tapping a card calls `onView(member)`; the
 *  host loads the read-only sheet via useMemberViewer. */
export function PartyMembers({
  campaignId,
  isGm,
  content,
  summarize,
  onView,
  onMembers,
  localMembers,
  renderExtra,
}: {
  campaignId: string;
  isGm: boolean;
  /** Needed only to re-read a card whose GM edit hasn't reached the player yet — the summary the
   *  server holds is the pre-edit one, so the card is recomputed from the pending sheet. Omitted →
   *  the published summaries, exactly as before. */
  content?: ContentDatabase;
  /**
   * What THIS device makes of the member, when the host holds their full sheet.
   *
   * `m.summary` is the column the PLAYER's app wrote, on the player's device, against the player's
   * content database. A card drawing it raw and a sheet re-derived here part company the moment the
   * two databases do — Encumbered comes out of item Bulk — and that disagreement between two cards
   * for the same character, on the same screen, is what the owner reported. The host that has the
   * sheets (the tracker) passes its own reconciliation in through here, so the dashboard card, the
   * pane card and the sheet a card opens are all the same answer.
   *
   * Omitted → this component loads the members' sheets ITSELF and reconciles them the same way (see
   * `loadSheets` below). It used to fall back to the published summary, which is what left the plain
   * party page and the GM's campaign detail disagreeing with the sheets their own cards open.
   */
  summarize?: (m: PartyMember) => PartySummary | undefined;
  onView: (m: PartyMember) => void;
  /**
   * Every list this component loads, handed to the host — the first fetch and every Realtime refresh.
   *
   * The tracker integration builds its combat party from the campaign's members, and it can't read
   * them out of here: this component only mounts INSIDE the tracker's party view, which needs that
   * party to exist first. So the host fetches once itself and keeps in step through this.
   */
  onMembers?: (list: PartyMember[]) => void;
  /**
   * Extra content for each card — the tracker integration passes the "Stats shown" sections here
   * (saves, abilities, skills, …) built from the real character, plus the header's turn chip and
   * add-to-initiative button. A render prop, not tracker types, so this component stays pure: the
   * real (non-tracker) party page passes nothing and is unchanged.
   */
  renderExtra?: (m: PartyMember) => PartyCardSlots;
  /**
   * Render THESE members instead of fetching from the server.
   *
   * The party is normally published to Supabase, so it needs an account. The tracker integration
   * passes locally-derived members while testing without login (src/integration/) — the cards, the
   * summaries and the open-sheet behaviour are then exactly the real ones, just fed from the local
   * roster. Omitted → the normal server-backed behaviour, unchanged.
   */
  localMembers?: PartyMember[];
}) {
  const [members, setMembers] = useState<PartyMember[] | null>(null);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  // `myId` is null both BEFORE the auth check resolves and when genuinely signed out, which is why
  // the hook answers both — otherwise the signed-out notice below flashes for a signed-in user.
  const { myId, authChecked } = useMyId();
  // Read through a ref: a host passing an inline arrow must not restart the fetch + subscription.
  const onMembersRef = useRef(onMembers);
  onMembersRef.current = onMembers;

  useEffect(() => {
    // Local members are supplied by the host — never fetch or subscribe.
    if (localMembers) return;
    if (!campaignId) return;
    let cancelled = false;
    // `showLoading` only on the first load — a live Realtime refresh shouldn't flash the spinner.
    const refresh = (showLoading: boolean) => {
      if (showLoading) setMembers(null);
      setError('');
      fetchParty(campaignId)
        .then((list) => {
          if (cancelled) return;
          // A FAILED read is not an empty party. Keep the cards already on screen, say what happened,
          // and above all don't hand the host an empty list: the tracker mirrors this into its own
          // party store, where an empty list means "everyone left" and prunes them for real.
          if (!list) {
            setError(LOAD_ERROR);
            return;
          }
          setMembers(list);
          onMembersRef.current?.(list);
          // Cache the party's SHARED capabilities (Battleforger). The item editor renders
          // synchronously and cannot await the party, so it reads what the last fetch saw.
          rememberPartyCapabilities(campaignId, list.map((m) => m.summary));
        })
        .catch(() => {
          if (!cancelled) setError(LOAD_ERROR);
        });
    };
    refresh(true);
    // Live: refresh the cards the moment any member publishes/updates/leaves a character.
    const unsub = subscribeParty(campaignId, () => refresh(false));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [campaignId, reload, localMembers]);

  /*
   * A GM edit that hasn't reached the player yet, drawn on the card.
   *
   * `summary` is a column the PLAYER writes, so it still describes the pre-edit character however
   * long the edit waits — press Update, come back to the party page, and nothing had moved. The
   * pending sheet is re-summarised here instead, through `memberSummary` on the same play-overlaid
   * character the owner's app would have published, so the card says what the GM did. It is a view:
   * nothing here is ever written to `campaign_characters`.
   *
   * ⚠ AND IT HAS TO STAND DOWN. The first version of this read the pending store with no staleness
   * test at all, and no code path reachable from this page could ever prune it: the card showed the
   * GM's pushed sheet and the "waiting" chip forever, HIDING the player's real current state, across
   * reloads. The member row now carries `updatedAt` (the player's own publish stamp), which is the
   * whole question — see `pendingEditStillStands`.
   */
  const pendingVersion = useGmPendingVersion();
  useEffect(() => {
    // Also covers the GM's OTHER devices and a reload. It prunes as well as adds now: a row the
    // player's app has applied and deleted is gone from the server, and its chip goes with it.
    if (!localMembers && campaignId && isGm) void fetchPendingGmEdits(campaignId);
  }, [campaignId, isGm, localMembers]);
  // What the cards actually render: host-supplied members win over the fetched list.
  const fetched = localMembers ?? members;
  useEffect(() => {
    // THE PRUNER, reached from the party page at last. `resolvePendingGmEdit` is the one place an
    // overtaken edit is dropped, so doing it here is what makes the chip disappear on the cards, the
    // tracker pane and the sheet together. No sheet — the stamp, and the player's app's refusal
    // receipt (F1, 2026-10: "not applied"), are the entire question here.
    if (!campaignId || !fetched) return;
    for (const m of fetched)
      if (m.updatedAt || m.gmRefusedAt) resolvePendingGmEdit(campaignId, m.charId, memberPublishedRow(m));
  }, [fetched, campaignId]);

  /*
   * THE CARDS' OWN SHEETS — what the plain party surfaces never had.
   *
   * `m.summary` is a column the PLAYER's app wrote, on the player's device, against the PLAYER's
   * content database; the sheet a card opens is re-derived here, against THIS one. Encumbered comes
   * out of item Bulk, so a card drawing that column raw and the sheet behind it disagree the moment
   * the two databases do — the owner's report, on the two surfaces (a character's Party button, the
   * GM's campaign detail) that the tracker-side fix could not reach, because the loader lived behind
   * the lazy tracker chunk. It lives in ./memberSheets now: one row read and one subscription per
   * member, reconciled through the one function the tracker calls.
   *
   * Three ways in, and only one of them fetches:
   *   • a host that passes `summarize` (the tracker) already holds every sheet — off, so nothing is
   *     read or subscribed twice;
   *   • `localMembers` are this device's own roster, never published to a campaign — off, there is
   *     no row to read;
   *   • no `content` to derive against — off, and the published summary is all the card can say.
   *
   * There is no flash of the wrong thing: until a member's sheet lands `summarizeOwn` answers
   * `undefined` and the card draws the published summary, exactly as it did before.
   */
  const loadSheets = !summarize && !!content && !localMembers;
  const sheets = useMemberSheets(loadSheets ? campaignId : '', loadSheets ? (fetched ?? NO_MEMBERS) : NO_MEMBERS);
  const summarizeOwn = useCallback(
    (m: PartyMember): PartySummary | undefined => {
      const sheet = sheets.get(m.charId);
      if (!sheet || !content) return undefined;
      // A GM's pending edit is already inside that sheet — `fetchMemberSheet` overlays it, and that
      // store only ever answers the account that pushed it, so a PLAYER on this same page has
      // nothing to fold in and sees the published character (../sheet/gmSync.ts).
      //
      // ⚠ …EXCEPT ON THE VIEWER'S OWN CHARACTER, and this is the second half of the belt that sits
      // on `pending` twenty lines below. The read itself now refuses such an overlay — it sees the
      // published row's `owner_id`, so an edit whose own row never recorded one is judged there and
      // the SHEET a card opens is covered too (../sheet/gmSync.ts → resolvePendingGmEdit). This
      // stays as the belt for the one case that read cannot answer: a row it never got.
      if (m.ownerId === myId && gmPendingEdit(campaignId, m.charId)) return undefined;
      return memberCardSummary(m, sheet, content);
    },
    [sheets, content, myId, campaignId],
  );
  const summarizeFor = summarize ?? summarizeOwn;
  const shown = useMemo(
    () =>
      fetched?.map((m) => {
        const edit = gmPendingEdit(campaignId, m.charId);
        // The same test the effect above prunes by, applied while rendering so the FIRST paint is
        // already right — a stale overlay must never flash up before the effect clears it.
        //
        // ⚠ AND NEVER ON THE VIEWER'S OWN CHARACTER. A GM's edit is silent by design: the player is
        // not told, and this page is a page PLAYERS open. The store is scoped to the account that
        // pushed (gmSync.setGmPendingAccount), so another player's browser holds nothing to draw,
        // and `gmPendingEdit` itself refuses to answer with an edit about the signed-in account's
        // own character — that is the rule's home, reached by every surface. The `m.ownerId` test
        // here is the belt for an edit whose row recorded no owner, which that one cannot judge.
        const pending = !!edit && m.ownerId !== myId && pendingEditStillStands(edit, memberPublishedRow(m));
        // …or the player's app REFUSED his last push (F1, 2026-10): the card shows their version, and
        // says his change did not land. Never on the viewer's own character, by the same belt.
        const refused = !pending && m.ownerId !== myId && gmEditRefused(campaignId, m.charId);
        // A host that holds the sheet has already done the whole job — this device's derivation, plus
        // any derived chip only the player's app could reach, and the pending edit folded in (the
        // sheets it works from are the overlaid ones). Its answer is the card's answer, so the two
        // cards the tracker draws for one character cannot say different things again.
        const derived = summarizeFor(m);
        if (derived) return { member: { ...m, name: derived.name || m.name, summary: derived }, pending, refused };
        if (!pending || !edit || !content) return { member: m, pending, refused };
        try {
          const live = applyPlayState(edit.sheet.character, edit.sheet.play, content);
          // `memberSummary`, so a pending edit does not cost the card everything only the PLAYER's
          // app could work out. A bare `computeSummary` here made pressing Update wipe a carried
          // "Encumbered" off the card for the whole pending window — the owner's original symptom,
          // re-created by the fix for the other half of it.
          return { member: { ...m, name: live.name || m.name, summary: memberSummary(live, content, m.summary) }, pending, refused };
        } catch {
          return { member: m, pending, refused }; // a sheet that won't compute is never worth a broken card
        }
      }) ?? null,
    // The pending store is module state; `pendingVersion` is what says it moved. `summarize` is in
    // the deps because it closes over the host's sheets: a member's sheet arriving is exactly when
    // these cards have to be recomputed, and the host re-rendering is the only signal for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetched, campaignId, content, pendingVersion, summarizeFor, myId],
  );

  const kick = async (m: PartyMember) => {
    const ok = await confirmDialog({
      title: `Remove ${m.name}’s player?`,
      message: "Their characters leave this party and they can't rejoin unless you re-share the code. This removes every character that player shared with the campaign.",
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;
    const res = await kickFromParty(campaignId, m.ownerId);
    if (res.ok) setReload((r) => r + 1);
    else setError(res.error);
  };

  // The database still lacks the F1 columns (the SQL was not re-run): GM edits cannot reach players
  // until it is, and the GM is told where — never left to find his Updates silently going nowhere.
  // Read on every render: the flag bumps `pendingVersion` when it is first set, which re-renders this.
  const schemaOutdated = isGm && !localMembers && gmEditSchemaOutdated();

  return (
    <>
      {error && <p className="login-error" role="alert">{error}</p>}
      {schemaOutdated && (
        <div className="gm-pending-strip" role="status">
          <i className="ti ti-database-exclamation" aria-hidden="true" />
          <span>
            GM changes can’t reach players yet — this campaign’s database needs supabase-campaign-characters.sql run
            once in the Supabase SQL editor.
          </span>
        </div>
      )}
      {shown === null && !error ? (
        <div className="party-loading"><span className="app-loading-spin" aria-hidden="true" /> Loading party…</div>
      ) : shown && shown.length === 0 && !localMembers && authChecked && myId === null ? (
        // The party lives on the server and its row-level security only answers signed-in users, so
        // a signed-out session ("use offline") gets an empty list rather than an error. Say that,
        // instead of implying nobody has shared a character.
        <div className="party-empty">Sign in to see this campaign’s party — the member list is stored on the server.</div>
      ) : shown && shown.length === 0 ? (
        <div className="party-empty">No one has shared a character with this campaign yet. Characters appear here once a member attaches one (Builder → Setup → Campaigns) and their app syncs.</div>
      ) : (
        <div className="party-grid">
          {(shown ?? []).map(({ member: m, pending, refused }) => (
            <PartyCard
              key={m.charId}
              member={m}
              pending={pending}
              refused={refused}
              isMine={m.ownerId === myId}
              showKick={isGm && !!myId && m.ownerId !== myId}
              onOpen={() => onView(m)}
              onKick={() => void kick(m)}
              extra={renderExtra?.(m)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/**
 * What a party card carries when it is dragged.
 *
 * The GM drags a player's card onto the initiative rail to put that PC in the order; the seam
 * (src/integration/CampaignTracker.tsx) is what accepts the drop. Declared here, next to the drag
 * source, so the two can't disagree about the type or the payload.
 */
export const PARTY_MEMBER_DRAG = 'application/x-hh-party-member';
export interface PartyMemberDrag {
  charId: string;
  name: string;
  maxHP?: number;
}

/**
 * The three places a host can put its own content on a card.
 *
 * The card is two rows (the owner's pick, 2026-09-17), so one opaque node no longer fits: the saves
 * belong beside AC in row 1's band, the rest is row 2, and the turn chip + the add-to-initiative
 * button belong in the header beside the chevron. Named slots keep the layout here, where the CSS
 * is, instead of in whatever the host hands over.
 */
export interface PartyCardSlots {
  /** Header, between the name and the chevron — the tracker's turn-timer chip and "+" button. */
  header?: React.ReactNode;
  /** Row 1, inside the AC/Fort/Ref/Will block. */
  saves?: React.ReactNode;
  /** The whole of ROW 2: Speed & DCs, Skills, Abilities, Senses & Languages. Falsy → no row 2. */
  right?: React.ReactNode;
}

function hpColor(cur: number, max: number): string {
  if (max <= 0) return 'var(--app-accent)';
  const f = cur / max;
  if (f <= 0.35) return 'var(--app-danger, #ef4444)';
  if (f < 1) return 'var(--app-warn, #e0a63a)';
  return 'var(--app-good, #22c55e)';
}

export function PartyCard({
  member,
  isMine,
  pending,
  refused,
  showKick,
  onOpen,
  onKick,
  extra,
}: {
  member: PartyMember;
  isMine: boolean;
  /** GM only: this card is showing an edit the player's app hasn't picked up yet. */
  pending?: boolean;
  /** GM only: the player's app REFUSED his last push (they changed the character first), so the card
   *  shows their version and says his change was not applied. */
  refused?: boolean;
  /** GM only. Omitted (the card in a PC's tracker pane) → no kick button, and no chevron offset. */
  showKick?: boolean;
  onOpen: () => void;
  onKick?: () => void;
  extra?: PartyCardSlots;
}) {
  const s: PartySummary = member.summary ?? ({} as PartySummary);
  const initials = (s.name || member.name || '—').slice(0, 2).toUpperCase();
  const sub = [s.ancestry, s.className && `${s.className} ${s.level ?? ''}`.trim()].filter(Boolean).join(' ');
  const hpMax = s.hpMax ?? 0;
  const pct = hpMax > 0 ? Math.max(0, Math.min(100, Math.round(((s.hpCur ?? hpMax) / hpMax) * 100))) : 0;
  return (
    <div
      className="party-card"
      role="button"
      tabIndex={0}
      // Drag a card onto the initiative rail to add that PC to the order. Inert everywhere else —
      // the campaign detail panel has nothing that accepts this type.
      draggable
      onDragStart={(e) => {
        const payload: PartyMemberDrag = { charId: member.charId, name: member.name, maxHP: s.hpMax };
        e.dataTransfer.setData(PARTY_MEMBER_DRAG, JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={onOpen}
      onKeyDown={(e) => {
        // Only the card's OWN key presses open the sheet. A keydown bubbling out of a control inside
        // it (the "+", the kick) is that control's activation: swallowing it here would preventDefault
        // the browser's click-from-Enter and open the sheet instead, so those buttons would be
        // mouse-only. stopPropagation on their click covers the mouse half; this covers the keyboard.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="party-card-h">
        <span className="party-av">{s.portrait ? <img src={s.portrait} alt="" /> : initials}</span>
        <span className="party-card-id">
          <span className="party-card-name">
            {s.name || member.name}
            {isMine && <span className="party-you"> · you</span>}
          </span>
          <span className="party-card-sub">{sub || '—'}</span>
        </span>
        {/* This card is drawn from the GM's own last Update, not from what the player published —
            say so, rather than letting them wonder which of the two they are reading. */}
        {pending && (
          <span className="party-pending" title="Waiting — the player’s app hasn’t picked this change up yet.">
            <i className="ti ti-cloud-upload" aria-hidden="true" /> waiting
          </span>
        )}
        {refused && !pending && (
          <span
            className="party-pending party-refused"
            title="Not applied — the player changed this character before their app picked up your change."
          >
            <i className="ti ti-cloud-x" aria-hidden="true" /> not applied
          </span>
        )}
        {/* The host's header controls (turn chip, add-to-initiative). Their own clicks are theirs —
            they must not also open the sheet. */}
        {extra?.header && (
          <span className="party-card-tools" onClick={(e) => e.stopPropagation()}>
            {extra.header}
          </span>
        )}
        <i className="ti ti-chevron-right party-chev" aria-hidden="true" />
      </div>
      {/* Two ROWS (the owner's pick, 2026-09-17): row 1 is the band the GM reads while a turn is
          running — HP + chips on the left, then Perception and AC/saves across; row 2 is the
          full-width reference band they look up between turns. On a phone row 1's right-hand group
          wraps under the left one (see sheet.css, <=720px). */}
      <div className={'party-card-body' + (extra?.right ? ' has-right' : '')}>
        <div className="party-row-turn">
          <div className="party-turn-l">
            <div className="party-hp">
              <span className="party-lab">HP</span>
              <span className="party-stat-v">
                {s.hpCur ?? hpMax}
                {hpMax ? ` / ${hpMax}` : ''}
                {s.hpTemp ? <span className="party-temp"> +{s.hpTemp}</span> : null}
              </span>
              <span className="party-hpbar"><span style={{ width: pct + '%', background: hpColor(s.hpCur ?? hpMax, hpMax) }} /></span>
            </div>
            {((s.conditions?.length ?? 0) > 0 || (s.modes?.length ?? 0) > 0) && (
              <div className="party-chips">
                {(s.conditions ?? []).map((c, i) => (
                  // A condition the SHEET worked out (Bulk, an active mode) carries its cause and
                  // wears a lock here, the same way the owner's own rail marks it — nobody at the
                  // table can take it off, it goes when its cause goes.
                  <span className={'party-cond' + (c.derivedFrom ? ' is-auto' : '')} key={'c' + i} title={c.derivedFrom || undefined}>
                    {c.name}
                    {c.value ? ` ${c.value}` : ''}
                    {c.derivedFrom && <i className="ti ti-lock party-cond-lock" aria-hidden="true" />}
                  </span>
                ))}
                {(s.modes ?? []).map((m, i) => (
                  <span className="party-mode" key={'m' + i}>{m}</span>
                ))}
              </div>
            )}
          </div>
          {/* The numbers a GM calls for mid-turn, across the band past the divider: Perception with
              its circle, then AC and the saves as label-over-value tiles. Part of the card's own
              surface, so a click here still opens the sheet, exactly as it used to. */}
          <div className="party-turn-r">
            <div className="party-perc">
              <span className="party-lab">Perception</span>
              <span className="party-perc-v">
                {s.perception >= 0 ? '+' : ''}
                {s.perception ?? 0}
                {s.perceptionRank && <RankPill rank={s.perceptionRank} />}
              </span>
            </div>
            <div className="party-defs">
              <span className="party-def">
                <span className="party-lab">AC</span>
                <b>{s.ac ?? '—'}</b>
              </span>
              {extra?.saves}
            </div>
          </div>
        </div>
        {/* ROW 2 — the host's Speed & DCs, Skills, Abilities, Senses, full card width. Omitted
            entirely when the "Stats shown" preset leaves nothing to draw, so there is no empty band
            and no divider. A click on the numbers is not navigation, so it doesn't open the sheet. */}
        {extra?.right && (
          <div className="party-row-ref" onClick={(e) => e.stopPropagation()}>
            {extra.right}
          </div>
        )}
        {/* Bottom-left of the card, under row 2 (owner 2026-09-16: *"the remove player button
            doesn't need a row of its own, put it in the bottom left"*).
            DEVIATION from the approved mockup (card-two-rows.html), pending the owner's nod: the
            mockup puts this button INSIDE `.party-row-ref`. It sits in the body instead, after that
            row, because a "Stats shown" preset that hides every reference section drops row 2 — and
            with it the GM's only remove control. Pixel-identical on a normal card (row 2 has no
            padding-bottom); the difference shows only on a card with no row 2. */}
        {showKick && onKick && (
          <button
            className="party-kick"
            title="Remove from party"
            aria-label="Remove from party"
            onClick={(e) => {
              e.stopPropagation();
              onKick();
            }}
          >
            <i className="ti ti-trash" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
