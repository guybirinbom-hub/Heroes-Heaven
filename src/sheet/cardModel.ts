import type { ReactNode } from 'react';
import type { ContentDatabase, DescRef } from '../rules/types';
import type { AstNode } from './astStore';
import type { DescNode } from './descref';

/**
 * Types for the record card (docs/card-design.md sections 2, 4 and 6). A plain .ts file, so the
 * step-4 guard can import the same shapes through jiti (jiti cannot parse .tsx).
 *
 * Step 3 builds only `mode: 'browse'` with `chrome: 'popup'` — DescriptionModal's popup, unchanged.
 * The other modes, the embed chrome and the reserved props are declared here so later steps add
 * behaviour without reshaping the component's contract. Step 5 builds `mode: 'mine'` with
 * `chrome: 'popup'` (StatDetailModal's full text): `printed`, the footer and `fallbackText` are read.
 * Step 6 builds `mode: 'gm'` with `chrome: 'embed'` (CampaignTracker's HostPage, the GM screen page):
 * `record`, `content` and `onOpenRef` are read; no frame, no stack, nothing on the dismiss stack.
 * Step 9 (the Main-tab action popup, CARD_ON.actionDetail) reads `controls` and `headerActions`.
 */

/** browse = today's search popup, never scoped; mine = the sheet's "what is yours"; gm = HostPage. */
export type CardMode = 'browse' | 'mine' | 'gm';
/** popup = an overlay with its own header and close; embed = inside another page (HostPage). */
export type CardChrome = 'popup' | 'embed';

/** A record by identity: the card reads its name and text off the content, by {bucket, id}. */
export interface CardRecordRef {
  bucket: string;
  id: string;
}
/** A record by its words: homebrew and glossary pages, which have no Archives page of their own. */
export interface CardRecordText {
  title: string;
  text: string;
  /** The text is the homebrew editor's rich HTML. Step 3: rendered by the same fallback as today. */
  html?: boolean;
  refs?: DescRef[];
}
export type CardRecord = CardRecordRef | CardRecordText;

export const isRecordRef = (r: CardRecord): r is CardRecordRef =>
  typeof (r as CardRecordRef).bucket === 'string' && typeof (r as CardRecordRef).id === 'string';

/**
 * Everything the app adds to a card sits in ONE ours box after the body (section 4), each line
 * attributed to the record it came from. Kinds, in the design's words:
 */
export type OursKind =
  /** "Your choice: Fire — note". */
  | 'choice'
  /** Principles A and C; the ally-facing marker of Ruling F. */
  | 'mark'
  /** The note for a marked action cost (today only a row star). */
  | 'actionMark'
  /** The record's own note. */
  | 'note'
  /** enhancedBy, out of a print-styled stat row. */
  | 'enhancement'
  /** A spell note, as SpellsTab prints it today. */
  | 'spellNote'
  /** "At your level (7): 2d6", only where derive computes the value. */
  | 'atYourLevel'
  /** upgradedBy / maxByLevel retunes of a use counter. */
  | 'usesRetune'
  /** "Your rank (trained): DC 15". */
  | 'skillTier'
  /** Critical specialization, only where the page prints none. */
  | 'critSpec'
  /** Strike's fist / blast / natural-attack blurbs. */
  | 'blurb'
  /** desk #158 "Remastered as". */
  | 'remastered'
  /** desk #152 empty note. */
  | 'empty'
  /** "No Archives page — text from our older import". */
  | 'noPage'
  /**
   * Card step 8: the player's Overrides edit of this record's text ("Change an existing feat/feature",
   * BuildOverrides.contentEdits, applied by build.ts applyOverrides). Shown wherever the card draws the
   * Archives page instead of the edited text, so the edit is never silently lost.
   */
  | 'override'
  /**
   * Card step 8: a homebrew record's typed Trigger / Requirements / Frequency / Access field
   * (types.ts Feat.trigger …, written by homebrewSchemas.ts), drawn as a use line above the body —
   * marked ours, never styled as print. `label` carries the line's label.
   */
  | 'useLine';

export const OURS_KINDS: readonly OursKind[] = [
  'choice', 'mark', 'actionMark', 'note', 'enhancement', 'spellNote', 'atYourLevel',
  'usesRetune', 'skillTier', 'critSpec', 'blurb', 'remastered', 'empty', 'noPage',
  'override', 'useLine',
];

export interface OursLine {
  kind: OursKind;
  /** The record this line comes from (another feat's marker names that feat). */
  from?: { bucket: string; id: string; name: string };
  /** A use line's label ("Trigger", "Frequency" …); the other kinds leave it unset. */
  label?: string;
  text: string;
}

/** The words of one ours line as the box prints them (attribution, label, text) — what a search over a
 *  row's ours lines matches, so the box and the search read the same string. */
export const oursLineText = (l: OursLine): string =>
  `${l.from ? `${l.from.name}: ` : ''}${l.label ? `${l.label} ` : ''}${l.text}`;

/**
 * What a 'mine' card is scoped by (section 6). Browse never scopes. Card step 13a reads `level`,
 * `classId`, `subclassId` and the three ownership sets below (src/sheet/cardScope.ts scopeTree).
 * Every ownership set is OPTIONAL and an absent one means UNKNOWN, never "owns nothing" (UNKNOWN ≠
 * EMPTY): with it absent, a section gated on ownership follows the level rule alone, so it is shown
 * once the character's level reaches it.
 */
export interface CardScope {
  level: number;
  classId?: string;
  subclassId?: string;
  picks?: Record<string, string>;
  ranks?: Record<string, number>;
  /** The class-choice option ids the character owns at its level (Character.classChoices ids). */
  owned?: string[];
  /**
   * Thaumaturge implements, as build.ts pushBenefit decided them (Character.classChoices): `owned` the
   * implements (initiate benefit), `adept` / `paragon` the implements whose adept / paragon benefit the
   * build granted. Absent = UNKNOWN (no implement pick on the character).
   */
  implements?: { owned: string[]; adept: string[]; paragon: string[] };
  /**
   * Kineticist kinetic elements (air, earth, fire, metal, water, wood) from the gate picks, forks
   * included; `single` is the element of a SINGLE gate (exactly one element taken at level 1), absent
   * for a dual gate. Absent = UNKNOWN (no gate pick on the character).
   */
  elements?: { owned: string[]; single?: string };
  /** Inventor innovation type ('armor' | 'weapon' | 'construct' | 'light-mortar'). Absent = UNKNOWN. */
  innovation?: string;
}

/** Section 2 rule 1: the card's props. */
export interface RecordCardProps {
  /** The record, by {bucket, id} or by its words. Exactly one of `record` / `node`. */
  record?: CardRecord;
  /**
   * A description-stack node handed over as-is: today's browse callers (DescriptionModal's `root`).
   * The card never rebuilds it, so the pin it stores and the title it matches are the caller's own
   * object. Steps 7a/19 move callers to `record` ids.
   */
  node?: DescNode;
  mode: CardMode;
  chrome: CardChrome;
  /** Reserved for 'mine' (step 5+). */
  scope?: CardScope;
  /** Reserved: the surface's stat rows (step 5+). */
  stats?: ReactNode;
  /**
   * 'mine' only (card step 5): the labels the surface's own stat rows print — the PRINTED SET that
   * replaces hideMeta (section 2 rule 4.2, plan F1). A page header line is left off only when its label
   * is in this set. Absent = empty: every labelled page line shows (StatDetailModal prints no rows).
   */
  printed?: readonly string[];
  /**
   * Controls above the text — use counters, Cast-at, item choices (section 2 rule 4.3). Card step 9
   * draws them on the 'mine' NO-PAGE lane, between the TrustMarker and the old text (the action popup's
   * trait chips: a page draws its own chips in its header). The page lane has no slot above its body
   * yet — AstRenderer owns that markup — so a page-lane control (Strike's Attack / Damage, step 10; the
   * item controls, step 14) needs that slot first; nothing is drawn there today.
   */
  controls?: ReactNode;
  /**
   * Extra buttons in the header, before Back / pin / close, on the record the surface opened (the
   * stack's first node) only: a page opened from a link inside the card is a browse card (section 6).
   * Card step 9: the action popup's own cost glyph (data-ours), skill label, prepare toggle and action pin.
   */
  headerActions?: ReactNode;
  /** Reserved: a tree transform (heightening, step 17). */
  transform?: (node: AstNode) => AstNode;
  /** The ours box, after the body. */
  ours?: OursLine[];
  /** 'mine': text shown (marked as ours, desk #152) when the record has no page and no description. */
  fallbackText?: string;
  /** Extra footer content, after the RemasteredLine, inside the scrolling body. */
  footer?: ReactNode;
  /**
   * Chrome 'popup': dismiss the WHOLE popup chain — the X, Escape, and clicking outside. Every popup
   * caller passes it. Chrome 'embed' has no exit (the host window owns the frame) and omits it.
   */
  onExit?: () => void;
  /**
   * Chrome 'embed' (card step 6): where a linked word or the "Remastered as" name opens. An embedded page
   * has no stack to drill into, so the host opens it (HostPage: the GM's own description popup).
   */
  onOpenRef?: (bucket: string, id: string) => void;
  /**
   * Chrome 'embed': the host's content database, read for the record. The campaign tracker holds its
   * own (CampaignTracker's `content` prop) and is not always mounted under the app's ContentContext.
   */
  content?: ContentDatabase;
  /** When given, Back shows at the first level too and calls this (returns to the popup this opened from). */
  onBackToSource?: () => void;
}
