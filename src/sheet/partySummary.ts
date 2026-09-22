// Compact card data for the party page — computed by each owner at publish time (so teammates render
// a small summary without pulling the whole sheet). Everything is wrapped defensively: a partial or
// odd character must never throw the publish/sync path.
import type { ActiveCondition, Character, ContentDatabase, ProficiencyRank } from '../rules/types';
import { deriveMaxHp, deriveAc, derivePerception } from '../rules/derive';

export interface PartySummary {
  name: string;
  ancestry?: string;
  className?: string;
  level: number;
  hpCur: number;
  hpMax: number;
  hpTemp?: number;
  ac: number;
  perception: number;
  /** The rank behind `perception`, so the card can draw the same proficiency pill the sheet does.
   *  Optional: a summary published before this field existed simply has no pill. */
  perceptionRank?: ProficiencyRank;
  /** `derivedFrom` is the cause a condition the SHEET worked out carries (Bulk, an active mode) —
   *  the card shows those locked, exactly as the owner's own rail does.
   *
   *  `id` is the condition's rules id, and it is what lets a GM's device line this list up with its
   *  OWN derivation of the same character (see `memberConditions`). It is optional because rows
   *  published before this field existed only carry the display name; `summaryConditionId` falls
   *  back to the lower-cased name, which is the same join the tracker already uses. */
  conditions: { id?: string; name: string; value?: number; derivedFrom?: string }[];
  modes: string[];
  /** Feats the PARTY shares rather than the individual: a capability any member can use because one
   *  member has it. Battleforger is the first — it prepares another character's gear, so the control
   *  belongs on everyone's items once one person in the party has the feat. */
  sharedFeats?: string[];
  /** Compressed portrait (synced copy) for the card avatar, when the character has one. */
  portrait?: string;
}

/** Feats whose benefit reaches the whole party, so a teammate having one enables it for everyone. */
export const PARTY_SHARED_FEATS = ['battleforger'];

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Build the small card summary from a live (play-applied) character. Never throws. */
export function computeSummary(c: Character, content: ContentDatabase): PartySummary {
  const safe = <T,>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  const hpMax = safe(() => deriveMaxHp(c, content), c.hitPoints?.current ?? 0);
  // One derive, two fields — the card draws the rank's pill beside the modifier.
  const perc = safe<{ modifier: number; rank?: ProficiencyRank }>(() => derivePerception(c), { modifier: 0 });
  return {
    name: c.name || 'Unnamed',
    ancestry: c.ancestryId ? content.ancestries[c.ancestryId]?.name : undefined,
    className: c.classId ? content.classes[c.classId]?.name : undefined,
    level: c.level ?? 0,
    hpCur: c.hitPoints?.current ?? hpMax,
    hpMax,
    hpTemp: c.hitPoints?.temp || undefined,
    ac: safe(() => deriveAc(c, content).value, 10),
    perception: perc.modifier,
    perceptionRank: perc.rank,
    sharedFeats: PARTY_SHARED_FEATS.filter((f) => (c.feats ?? []).some((x) => x.featId === f)),
    conditions: (c.conditions ?? []).map((cond) => ({
      // The id travels with the name now: a teammate's device has to be able to tell WHICH condition
      // this is, not just how to print it — `memberConditions` joins on it.
      id: cond.id,
      name: content.conditions?.[cond.id]?.name ?? cap(cond.id),
      value: cond.value,
      derivedFrom: cond.derivedFrom,
    })),
    modes: (c.activeModes ?? []).map((m) => m.name).filter(Boolean),
    // The party list draws this in a small round slot, so send the player's own square crop when they
    // made one — a centre crop of a full-body portrait shows a torso to the rest of the table.
    portrait: c.appearance?.avatar ?? c.appearance?.portrait,
  };
}

/** The rules id behind a summary chip. Rows published before `id` existed only carry the display
 *  name, so fall back to the lower-cased name — the same join the tracker seam uses for its rows. */
export function summaryConditionId(c: { id?: string; name: string }): string {
  return c.id || c.name.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * THE CONDITIONS A PARTY MEMBER HAS — one answer for the card and for the sheet.
 *
 * The card and the GM's sheet used to answer this question from two different places and could
 * therefore disagree, which is exactly what the owner hit: the card said **Encumbered** and the
 * sheet he opened from it said nothing anywhere.
 *
 *   • the CARD draws `campaign_characters.summary`, which the OWNER's app computed, on the owner's
 *     device, against the OWNER's content database;
 *   • the SHEET re-derives the live character from `campaign_characters.sheet` with THIS device's
 *     content database.
 *
 * Encumbered is derived from item Bulk (`deriveBulk` reads `db.items[…].bulk`), so the two answers
 * part company the moment the two databases differ at all — a player on a newer release, homebrew
 * gear the GM's copy has never seen, a data update only one side has installed. Nothing reconciled
 * them and nothing told the GM they disagreed.
 *
 * So: this device's own derivation is the base (it is the one the sheet's numbers are computed
 * from), and any condition the owner's app said it DERIVED — Bulk, an active mode — that we could
 * not reproduce is carried in beside it, still marked with the cause the owner's app gave. Only
 * derived entries: a condition somebody APPLIED is already inside the published play state, so it
 * comes through the normal overlay and must not be added twice. Nothing is ever removed here, and
 * nothing written here is ever written back into play state — a carried entry keeps `derivedFrom`,
 * so every surface already treats it as locked and it disappears when its cause does.
 */
export function memberConditions(local: ActiveCondition[], published: PartySummary['conditions'] | undefined): ActiveCondition[] {
  const carried = carriedDerivedConditions(local.map((c) => c.id), published);
  if (!carried.length) return local;
  return [
    ...local,
    ...carried.map((p) => ({ id: p.id!, ...(p.value != null ? { value: p.value } : {}), derivedFrom: p.derivedFrom })),
  ];
}

/** What a carried condition's cause is prefixed with, so the GM can read it against their OWN
 *  numbers: the pill says Encumbered while this device's Inventory says "Bulk 3 / 5", and the only
 *  thing that makes those two readable together is saying whose device worked it out. */
const PLAYER_DERIVED = 'the player’s own app — ';

/**
 * THE RULE ITSELF — which of the owner's DERIVED chips this device's own list is missing.
 *
 * Both shapes of the same question go through here: the sheet asks it about `ActiveCondition[]`
 * (`memberConditions`) and the cards ask it about summary chips (`memberSummary`). One rule, so the
 * card a GM taps and the sheet it opens cannot end up with two different answers again.
 *
 * ⚠ The carried entry's cause is RE-LABELLED. The GM's own Inventory still reads "Bulk 3 / 5" from
 * this device's data, so a pill saying only "from Bulk — carrying 20 of 5" contradicts the number
 * right beside it. Saying whose device worked it out is what makes the two readable together.
 */
export function carriedDerivedConditions(
  haveIds: Iterable<string | undefined>,
  published: PartySummary['conditions'] | undefined,
): PartySummary['conditions'] {
  if (!published?.length) return [];
  const have = new Set(haveIds);
  const carried: PartySummary['conditions'] = [];
  for (const p of published) {
    // Only DERIVED entries. A condition somebody APPLIED is already inside the published play state,
    // so it arrives through the normal overlay and must not be added a second time.
    if (!p.derivedFrom) continue;
    const id = summaryConditionId(p);
    if (have.has(id)) continue;
    have.add(id);
    // Idempotent: a summary that has already been through here (the tracker reconciles once for the
    // card and the sheet reconciles again over the top) must not collect the label twice.
    const from = p.derivedFrom.startsWith(PLAYER_DERIVED) ? p.derivedFrom : PLAYER_DERIVED + p.derivedFrom;
    carried.push({ ...p, id, derivedFrom: from });
  }
  return carried;
}

/**
 * The summary ANY card should draw for a member whose sheet this device holds — a GM's or, since
 * the loader moved out of the tracker chunk (./memberSheets.ts), a PLAYER's own party page.
 *
 * The published summary is the player's own verdict, computed on their device against their content
 * database; `computeSummary` here is this device's. The tracker had both, in two different places —
 * the dashboard card drew the published one and the pane card re-derived its own — so the two cards
 * for the same character could disagree about Encumbered while sitting on the same screen. This is
 * the one answer: this device's derivation, plus any derived chip only the player's app could reach.
 *
 * ⚠ `published` IS PASSED EVEN WHILE A GM EDIT OF OURS IS WAITING — and this paragraph used to say
 * the opposite, which is the instruction that put the owner's own report back on his screen. The
 * reasoning was that the published summary describes the character before the edit, so joining it
 * on could carry back a condition the GM had just removed. It cannot: only entries the player's app
 * marked DERIVED are ever carried (`carriedDerivedConditions`), every surface locks those, and a
 * locked chip is not one a GM edit could have taken off. Withholding it cost the GM the
 * "Encumbered" only the PLAYER's app can work out — their content database, their item Bulk — for
 * the whole pending window, which between sessions is days. What the player's app derives changes
 * when the PLAYER publishes again, and nothing else may change it. Both callers
 * (`memberCardSummary` in ./memberSheets.ts and the card in ./PartyMembers.tsx) pass the member's
 * own summary for exactly that reason.
 */
export function memberSummary(c: Character, content: ContentDatabase, published?: PartySummary): PartySummary {
  const s = computeSummary(c, content);
  const carried = carriedDerivedConditions(s.conditions.map(summaryConditionId), published?.conditions);
  return carried.length ? { ...s, conditions: [...s.conditions, ...carried] } : s;
}
