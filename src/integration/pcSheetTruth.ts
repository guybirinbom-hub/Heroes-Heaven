import { useCallback, useEffect, useState } from 'react';
import { applyPlayState, initialPlay } from '../rules/play';
import { deriveMaxHp } from '../rules/derive';
import { fetchMemberSheet, pushGmEdit, subscribeMemberSheet, type PartyMember } from '../data/party';
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
 *   1. a push re-bases on the player's NEWEST published sheet (a fresh fetchMemberSheet), never on
 *      the snapshot this screen happens to be holding — the same guard GmEditSheet.pushToPlayer uses;
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
 *  Reports whether the server actually took it — a refusal (RLS, offline) must not be mistaken for a
 *  landed change, or the GM's damage is silently dropped. */
async function pushVitals(
  campaignId: string,
  mem: PartyMember,
  v: PcVitals,
  content: ContentDatabase,
  fallback: SavedChar,
): Promise<boolean> {
  const current = await fetchMemberSheet(campaignId, mem.charId);
  const base = current?.character ? current : fallback;
  const res = await pushGmEdit(campaignId, mem.charId, mem.ownerId, sheetWithVitals(base, v, content));
  return res.ok;
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
  useEffect(() => {
    if (!campaignId || !ids) return;
    let cancelled = false;
    const unsubs = ids.split(',').map((charId) => {
      const pull = () => {
        void fetchMemberSheet(campaignId, charId).then((s) => {
          if (cancelled || !s?.character) return;
          // Skip an identical re-publish so an echo doesn't re-render the whole party.
          setSheets((prev) =>
            JSON.stringify(prev.get(charId)) === JSON.stringify(s) ? prev : new Map(prev).set(charId, s),
          );
        });
      };
      pull();
      return subscribeMemberSheet(campaignId, charId, pull);
    });
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [campaignId, ids]);
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
   */
  const [seen] = useState(() => new Map<string, { sheet: string; agreed: string }>());

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
      // The sheet moved (or this PC has never been synced): the sheet wins, always. This is also what
      // makes a simultaneous change safe — the player's edit is never the one discarded.
      if (!st || st.sheet !== skey) {
        seen.set(mem.charId, { sheet: skey, agreed: skey });
        writeVitals(c.id, sv, content);
        continue;
      }
      const cv = vitalsFromCombatant(c, content);
      const ckey = vitalsKey(cv);
      if (ckey === st.agreed) continue; // in step
      seen.set(mem.charId, { sheet: st.sheet, agreed: ckey }); // the GM moved it here → publish, once
      void pushVitals(campaignId, mem, cv, content, sheet).then((ok) => {
        // A REFUSED push must not leave the row stamped as agreed — that is what made a failed push
        // unrepeatable, so a GM whose edit the server rejected never found out and the player never
        // got it. Roll the stamp back (unless a newer pass has already moved it on) and the next
        // pass re-pushes. Deliberately no retry from here: the pass runs on the next change anyway,
        // and re-entering it would spin hot against a server that is still refusing.
        const cur = seen.get(mem.charId);
        if (!ok && cur?.agreed === ckey) seen.set(mem.charId, { sheet: cur.sheet, agreed: st.agreed });
      });
    }
  }, [seen, campaignId, members, sheetById, content]);

  useEffect(() => {
    reconcile();
    return useCombatStore.subscribe(reconcile);
  }, [reconcile]);
}
