import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { applyPlayState, initialPlay } from '../rules/play';
import { gmPendingEdit, gmPendingVersion, resolvePendingGmEdit, subscribeGmPending } from '../sheet/gmSync';
import { deriveMaxHp } from '../rules/derive';
import { fetchMemberSheet, fetchPublishedSheet, pushGmEdit, subscribeMemberSheet, type PartyMember } from '../data/party';
import { memberSummary, type PartySummary } from '../sheet/partySummary';
import type { SavedChar } from '../data/storage';
import type { Character, ContentDatabase } from '../rules/types';
import { useCombatStore } from '../../tracker/src/store/combatStore';
import type { Combatant } from '../../tracker/src/types/pf2e';

/*
 * THE SHEET IS THE TRUTH — for a campaign's player characters, and only for them.
 *
 * "The conditions and HP the players have are on their sheets, and what the GM sees is what they
 * have." So a PC row in the initiative order is not a copy of a character the GM types damage into;
 * it is a WINDOW onto the player's published sheet:
 *
 *   sheet → tracker  the player's live sheet (fetchMemberSheet + subscribeMemberSheet) writes the
 *                    PC combatant's HP and conditions. Whenever the sheet moves, the sheet wins.
 *   tracker → sheet  a condition or damage the GM applies to a PC in the tracker is pushed to the
 *                    player through the existing GM-edit channel (pushGmEdit → gm_character_edits),
 *                    so it lands on their sheet like any other condition.
 *
 * NPC / monster rows are untouched — they have no sheet and stay entirely tracker-local.
 *
 * ⚠ NEVER OVERWRITE A PLAYER'S OWN NEWER EDIT. Three rules keep that true:
 *   1. a push re-bases on a FRESH read of the server (`fetchPublishedSheet`), never on the snapshot
 *      this screen happens to be holding — the same guard GmEditSheet.pushToPlayer uses. When the GM
 *      has an edit of their own still waiting, that unapplied edit is the newer version and is what
 *      the push builds on; otherwise it is the player's published sheet;
 *   2. a push writes ONLY `play.damage` and `play.conditions`, so nothing else of theirs is carried;
 *   3. when the sheet and the tracker have BOTH moved since the last agreement, the sheet wins and
 *      the tracker's value is discarded — the player's own edit is never the one that loses.
 * The applied-once stamps on the player's side (`editsToApply` in ../sheet/gmSync.ts) then make the
 * landing idempotent however long the row lingers.
 *
 * Part of the removable seam; see ./README.md.
 */

/** The only two things a tracker row and a character sheet both own. */
export interface PcVitals {
  currentHP: number;
  maxHP: number;
  /** Heroes Heaven condition ids — which are the tracker's lower-cased condition names. */
  conditions: { id: string; value?: number }[];
}

/**
 * Does a GM's DAMAGE in the tracker reach the player's sheet?
 *
 * Conditions are settled (the owner asked for them); HP is the assumption. This is the one switch:
 * false makes "GMs don't edit PC HP in the tracker" true — the sheet still drives the row's HP, the
 * GM's own damage just stops being published — without touching anything else.
 */
const GM_EDITS_PC_HP = true;

let _cid = 0;

/** Conditions Heroes Heaven actually has a rules entry for. A tracker-only condition (a custom one
 *  the GM typed) has no id on the sheet, so it is neither pushed nor reconciled — it simply stays. */
function known(list: { id: string; value?: number }[], content: ContentDatabase): { id: string; value?: number }[] {
  return list.filter((c) => !!content.conditions?.[c.id]);
}

/** What the sheet SHOWS: the build with play overlaid (damage taken, conditions in effect). */
export function livePlay(sheet: SavedChar, content: ContentDatabase): Character {
  try {
    return applyPlayState(sheet.character, sheet.play, content);
  } catch {
    return sheet.character;
  }
}

/**
 * THE ONE SUMMARY every GM-side surface draws for a member whose SHEET this device holds.
 *
 * Here, taking the whole member, rather than written out at each call site: the published summary
 * is not an optional extra the caller may decide to withhold. It was withheld while a GM edit of
 * ours was pending, and that re-created the owner's own report for the length of the pending window
 * — the "Encumbered" only the PLAYER's app can work out (their content database, their item Bulk)
 * vanished from the cards and the sheet the moment the GM pressed Update. Only DERIVED chips are
 * ever carried, every surface locks those, so there is not one a GM edit could have taken off; what
 * the player's app derives changes when the PLAYER publishes again, and until then it is still true.
 */
export function gmMemberSummary(mem: PartyMember, sheet: SavedChar, content: ContentDatabase): PartySummary {
  return memberSummary(livePlay(sheet, content), content, mem.summary);
}

function maxHpOf(live: Character, content: ContentDatabase): number {
  try {
    return deriveMaxHp(live, content);
  } catch {
    return live.hitPoints?.current ?? 0;
  }
}

export function vitalsFromSheet(sheet: SavedChar, content: ContentDatabase): PcVitals {
  const live = livePlay(sheet, content);
  const max = maxHpOf(live, content);
  /*
   * The AUTHORED conditions, not the overlay's. applyPlayState ADDS derived ones — encumbered from
   * bulk, a mode's granted conditions — that `play.conditions` deliberately never stores ("the
   * condition has to disappear the moment the mode goes"). Reading those back would push the sheet a
   * condition it computes for itself, and it would never be able to drop it again.
   */
  const authored = sheet.play?.conditions ?? sheet.character.conditions ?? [];
  return {
    currentHP: live.hitPoints?.current ?? max,
    maxHP: max,
    conditions: known(authored.map((c) => ({ id: c.id, value: c.value })), content),
  };
}

export function vitalsFromCombatant(c: Combatant, content: ContentDatabase): PcVitals {
  return {
    currentHP: c.currentHP,
    maxHP: c.maxHP,
    conditions: known(c.conditions.map((x) => ({ id: x.name.trim().toLowerCase(), value: x.value })), content),
  };
}

/**
 * The identity the two sides are compared on.
 *
 * Max HP is deliberately OUT: it is derived from the build, the tracker has no way to edit it for a
 * PC, and the party bridge seeds it from the published summary — so a one-point disagreement there
 * would otherwise read as "the GM changed something" on every single reconcile.
 */
export function vitalsKey(v: PcVitals): string {
  return `${v.currentHP}|${v.conditions.map((c) => `${c.id}:${c.value ?? ''}`).sort().join(',')}`;
}

/** The player's sheet with the GM's HP + conditions written into play state — and nothing else. */
export function sheetWithVitals(sheet: SavedChar, v: PcVitals, content: ContentDatabase): SavedChar {
  const play = { ...initialPlay(sheet.character, content), ...(sheet.play ?? {}) };
  const max = vitalsFromSheet(sheet, content).maxHP;
  // Conditions HH has no entry for are the player's (homebrew, a future book) — keep them as they are.
  const mine = (play.conditions ?? []).filter((c) => !content.conditions?.[c.id]);
  return {
    ...sheet,
    play: {
      ...play,
      conditions: [...mine, ...v.conditions.map((c) => (c.value == null ? { id: c.id } : { id: c.id, value: c.value }))],
      ...(GM_EDITS_PC_HP ? { damage: Math.max(0, Math.min(max, max - v.currentHP)) } : {}),
    },
  };
}

/** Write the sheet's vitals onto one PC combatant. The tracker keeps no PC HP of its own. */
function writeVitals(cid: string, v: PcVitals, content: ContentDatabase): void {
  useCombatStore.setState((s: { combatants: Combatant[] }) => {
    const c = s.combatants.find((x) => x.id === cid);
    if (!c) return;
    if (v.maxHP > 0) c.maxHP = v.maxHP;
    c.currentHP = Math.max(0, Math.min(v.currentHP, c.maxHP));
    c.isDefeated = c.currentHP === 0;
    // Keep a badge the GM already set (its duration is theirs) and every tracker-only condition;
    // replace only the ones the sheet is authoritative for.
    const keep = c.conditions.filter((x) => !content.conditions?.[x.name.trim().toLowerCase()]);
    const fromSheet = v.conditions.map((cond) => {
      const had = c.conditions.find((x) => x.name.trim().toLowerCase() === cond.id);
      return had ? { ...had, value: cond.value } : { id: `hh-${cond.id}-${++_cid}`, name: cond.id, value: cond.value, isPermanent: true };
    });
    c.conditions = [...keep, ...fromSheet];
  });
}

/** Push the GM's change to the player. Re-based on their newest sheet, carrying only the vitals.
 *
 *  Answers with the PUSH's own stamp (`pendingAt`), or `null` when the server refused it — a
 *  refusal (RLS, offline) must not be mistaken for a landed change, or the GM's damage is silently
 *  dropped. The stamp is what the echo test below recognises a push by; `''` means the server took
 *  it but left us no stamp to recognise it with, which costs a re-read and never a value. */
async function pushVitals(
  campaignId: string,
  mem: PartyMember,
  v: PcVitals,
  content: ContentDatabase,
  fallback: SavedChar,
): Promise<string | null> {
  // One read of the PUBLISHED row, then the overlay applied here rather than inside the fetch, so
  // this push gets two things from the same look: the newest sheet to build on (which is the GM's
  // own still-unapplied edit when there is one — re-basing on the pre-edit row would upsert straight
  // over it), and the published stamp that edit was based on, which is what lets the overlay stand
  // down later without ever comparing two devices' clocks.
  const row = await fetchPublishedSheet(campaignId, mem.charId);
  const current = resolvePendingGmEdit(campaignId, mem.charId, row);
  const base = current?.character ? current : fallback;
  // `mem.updatedAt` is the fallback when that read FAILED: it is the same column, off the same
  // (player's) clock, read by the party list — older, therefore safe. What it must never be is
  // nothing, because an edit with no base falls back to comparing the GM's clock against the
  // player's, which is the one comparison this whole path exists to avoid. rememberGmEdit also
  // refuses to overwrite a base it already holds; this is the other half.
  const res = await pushGmEdit(
    campaignId,
    mem.charId,
    mem.ownerId,
    sheetWithVitals(base, v, content),
    row?.updatedAt ?? mem.updatedAt,
  );
  // The push we just recorded, by the stamp it carries — `rememberGmEdit` ran inside `pushGmEdit`,
  // synchronously, the moment the server accepted it.
  return res.ok ? gmPendingEdit(campaignId, mem.charId)?.pushedAt ?? '' : null;
}

/**
 * Every member's published sheet, kept live.
 *
 * One subscription per member, exactly as the member viewer keeps ONE open sheet live — the GM is
 * looking at the whole party at once here, so all of them have to follow.
 */
export function useMemberSheets(campaignId: string, members: PartyMember[]): Map<string, SavedChar> {
  const [sheets, setSheets] = useState<Map<string, SavedChar>>(() => new Map());
  const ids = members.map((m) => m.charId).join(',');
  const pendingVersion = useSyncExternalStore(subscribeGmPending, gmPendingVersion, gmPendingVersion);
  // The list as it stands right now, so a response for a member who has since left the party is
  // dropped instead of re-adding them. (It replaces the per-effect `cancelled` flag, which no longer
  // works now that the pull outlives any one effect.)
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const pull = useCallback(
    (charId: string) => {
      void fetchMemberSheet(campaignId, charId).then((s) => {
        if (!s?.character || !idsRef.current.split(',').includes(charId)) return;
        // Skip an identical re-publish so an echo doesn't re-render the whole party.
        setSheets((prev) => (JSON.stringify(prev.get(charId)) === JSON.stringify(s) ? prev : new Map(prev).set(charId, s)));
      });
    },
    [campaignId],
  );
  /*
   * THE SUBSCRIPTIONS — one channel per member, and nothing about a GM's own edit belongs in here.
   *
   * `pendingVersion` used to be a dep of this effect, which meant every Update AND every point of
   * damage the GM applied (pushVitals → pushGmEdit → rememberGmEdit) tore down and instantly re-joined
   * one channel per member, each on the same deterministic topic, with the leave still in flight.
   * Mid-combat that is N leave/join pairs per damage entry on identical topic names — and a Realtime
   * feed that quietly stops delivering is precisely the "the GM is looking at stale data" fault this
   * whole change exists to remove.
   */
  useEffect(() => {
    if (!campaignId || !ids) return;
    const unsubs = ids.split(',').map((charId) => {
      pull(charId);
      return subscribeMemberSheet(campaignId, charId, () => pull(charId));
    });
    return () => {
      for (const u of unsubs) u();
    };
  }, [campaignId, ids, pull]);
  /*
   * The re-PULL, and only the re-pull — for the ONE character whose pending edit actually moved.
   *
   * A GM's own Update doesn't touch `campaign_characters`, so no Realtime event ever arrives for it
   * and this map would keep answering with the pre-edit sheet until the player's device came online.
   * `fetchMemberSheet` overlays the pending edit (src/data/party.ts); this is what makes it re-ask.
   *
   * It also closes a clobber door on the way past: `pushVitals` re-bases on the overlaid sheet, so a
   * damage push that arrived while a sheet edit was still pending used to be built on the published
   * (pre-edit) sheet and upserted over the GM's own waiting row, silently dropping it.
   *
   * ⚠ The counter is campaign-wide, so a bare re-run of this refetched EVERY member on every push —
   * and every single point of damage is a push. That is N HTTP reads per damage entry mid-combat,
   * and a drop inside one of them bumps the counter again and re-runs the whole fan-out. The stamp
   * of each member's own pending edit is what changed or didn't, so only that member is re-read.
   */
  const pendingSig = useRef(new Map<string, string>());
  useEffect(() => {
    if (!campaignId || !ids) return;
    for (const charId of ids.split(',')) {
      const sig = gmPendingEdit(campaignId, charId)?.pushedAt ?? '';
      if (pendingSig.current.get(charId) === sig) continue;
      pendingSig.current.set(charId, sig);
      pull(charId);
    }
  }, [campaignId, ids, pendingVersion, pull]);
  return sheets;
}

/**
 * Hold the PC rows and the players' sheets in step, in both directions.
 *
 * Runs on every combat-store change (the GM applying damage or a condition) and whenever a sheet
 * arrives, so neither side can drift. See the conflict rules at the top of this file.
 */
export function usePcSheetTruth(args: {
  campaignId: string;
  members: PartyMember[];
  sheetById: Map<string, SavedChar>;
  content: ContentDatabase;
}): void {
  const { campaignId, members, sheetById, content } = args;
  /*
   * charId → what we last saw on each side.
   *  `sheet`  the sheet's vitals as of the last look. A DIFFERENT value means the sheet really moved.
   *  `agreed` the value the row is expected to hold — the sheet's, or the GM's own change once pushed.
   *
   * Two keys rather than one because a push doesn't change the published sheet: the player's app
   * applies the edit and re-publishes, and until it does `fetchMemberSheet` still answers with the
   * pre-edit sheet. Comparing against `agreed` alone would read that unchanged sheet as "the sheet
   * moved" and revert the GM's damage on the spot, then un-revert when the echo landed.
   *
   *  `pushed` the STAMPS of the pushes we made and are still waiting to see come back.
   *
   * ⚠ That third field is not optional any more. `fetchMemberSheet` overlays this device's own
   * pending edit, so a push now DOES move the sheet we read — our own value arrives here looking
   * exactly like the player publishing it. With two damage entries inside one round trip the row
   * goes V1, V2, and then push 1's overlay lands, reads as "the sheet moved", and drags the row
   * visibly back to V1. Worse, if push 2 is then refused, the rollback below restores `agreed` while
   * `sheet` has already advanced — and the GM's V2 is dropped with nothing left to re-push it.
   *
   * ⚠⚠ STAMPS, NOT VALUES. It held the vitals we had pushed, and asked "is this the same HP and
   * conditions as something of ours?" — so a genuine PLAYER publish that happened to land on a value
   * we pushed at some point (they healed back to full, they took the same five) was swallowed as our
   * own echo, and the GM went on reading an HP the player no longer had. Whether the sheet in hand
   * is our push is a question about the ROW, not about its contents, and `updated_at` is what
   * answers it: a pending edit only stands while no newer player publish exists (see
   * `pendingEditStillStands`), so "a push of ours is still standing" is that comparison, made on the
   * player's own clock, and a publish newer than our push can never read as an echo.
   */
  const [seen] = useState(() => new Map<string, { sheet: string; agreed: string; pushed: Set<string> }>());

  const reconcile = useCallback(() => {
    const combatants = useCombatStore.getState().combatants;
    for (const mem of members) {
      const sheet = sheetById.get(mem.charId);
      if (!sheet) continue;
      // The tracker joins combatants to characters by name — the same join the rest of the seam uses.
      const c = combatants.find((x) => x.isPC && x.name.trim().toLowerCase() === mem.name.trim().toLowerCase());
      if (!c) continue;
      const sv = vitalsFromSheet(sheet, content);
      const skey = vitalsKey(sv);
      const st = seen.get(mem.charId);
      // Our own push, coming back through the overlay. The row already holds it (or something newer
      // we pushed after it), so there is nothing to write — only the "last seen" mark moves on.
      // Not doing this is what let a late echo drag the row back to an earlier value.
      //
      // The overlay is the ONLY way a push of ours can come back looking like a sheet move, and it
      // only stands while the player has published nothing newer — so a push of ours still standing
      // IS the echo, and a publish with a newer `campaign_characters.updated_at` has already
      // dropped it (`resolvePendingGmEdit`, inside the read that handed us this sheet) and is the
      // player moving, whatever value it carries.
      const pend = gmPendingEdit(campaignId, mem.charId);
      const echo = !!st && st.sheet !== skey && !!pend && st.pushed.has(pend.pushedAt);
      // The sheet moved (or this PC has never been synced): the sheet wins, always. This is also what
      // makes a simultaneous change safe — the player's edit is never the one discarded.
      if (!st || (st.sheet !== skey && !echo)) {
        seen.set(mem.charId, { sheet: skey, agreed: skey, pushed: new Set() });
        writeVitals(c.id, sv, content);
        continue;
      }
      if (echo) seen.set(mem.charId, { ...st, sheet: skey });
      const cv = vitalsFromCombatant(c, content);
      const ckey = vitalsKey(cv);
      if (ckey === st.agreed) continue; // in step
      // the GM moved it here → publish, once
      seen.set(mem.charId, { sheet: skey, agreed: ckey, pushed: st.pushed });
      void pushVitals(campaignId, mem, cv, content, sheet).then((stamp) => {
        // A REFUSED push must not leave the row stamped as agreed — that is what made a failed push
        // unrepeatable, so a GM whose edit the server rejected never found out and the player never
        // got it. Roll the stamp back (unless a newer pass has already moved it on) and the next
        // pass re-pushes. Deliberately no retry from here: the pass runs on the next change anyway,
        // and re-entering it would spin hot against a server that is still refusing.
        const cur = seen.get(mem.charId);
        if (stamp) cur?.pushed.add(stamp); // …so this PUSH is recognised when it echoes back
        else if (stamp === null && cur?.agreed === ckey)
          seen.set(mem.charId, { sheet: cur.sheet, agreed: st.agreed, pushed: cur.pushed });
      });
    }
  }, [seen, campaignId, members, sheetById, content]);

  useEffect(() => {
    reconcile();
    return useCombatStore.subscribe(reconcile);
  }, [reconcile]);
}
