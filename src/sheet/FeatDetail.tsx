import type { ActionCost, Character, DescRef, LimitedUses } from '../rules/types';
import { ActionGlyph, isActionCost } from './widgets';
import { InfoTerm } from './InfoTerm';
import { PinContext, usePinDesc, type PinDescApi } from './PinContext';
import { RecordCard } from './RecordCard';
import { scopeOfCharacter, withPick } from './cardScope';
import { oursHeaderCost } from './MainTab';
import { useContent } from './ContentContext';
import { traitDesc, traitLabel } from '../rules/glossary';
import { astSlug, useAstNode } from './useAst';
import type { DescNode } from './descref';
import type { AstNode } from './astStore';
import { textOf } from './astVisibility';
import { oursLineText, type OursLine } from './cardModel';
import { OursUseLines } from './OursBox';

export interface FeatEntry {
  key: string;
  name: string;
  level: number;
  traits: string[];
  actionCost?: ActionCost;
  description: string;
  descRefs?: DescRef[];
  isFeature: boolean;
  /** For a CLASS FEATURE row: its `content.classFeatures` id, so a feature printing "Frequency once
   *  per day" can draw use pips the way a feat does. 21 class features carry `limitedUses` and drew
   *  nothing, because the pip lookup only consulted `content.feats` and a feature row had no id. */
  featureId?: string;
  /** The builder CARD HEADING this pick came from ("Bloodline", "Hunter's Edge", "Kinetic Gate
   *  (elements)"). Rendered as a plain tag beside Feature/Granted. It is NOT a PF2e trait, so it must
   *  never be put in `traits`: that showed it as a trait pill AND made traitDesc() manufacture a
   *  "<name>: a trait. Feats, items, spells… interact with anything that has this trait." sentence
   *  for something that is not a trait at all. */
  groupLabel?: string;
  bucket: string;
  rarity?: string;
  prerequisites?: string[];
  /** When set, this feat was auto-granted by another feat — the granting feat's display name. */
  grantedBy?: string;
  /** When set, this feat's ENHANCEMENT tier is running, and this is the record that turned it on. */
  enhancedBy?: string;
  /** The core.json feat id, for rows that are real feats (features and heritages leave it unset).
   *  Needed to look up per-day uses; `key` can't serve, since it embeds the level for uniqueness. */
  featId?: string;
  /** A HERITAGE or BACKGROUND row's own record, for the same reason `featureId` exists. Twelve of
   *  them carry `limitedUses` ("once per day") and drew no pips, because featUse() was only ever
   *  handed a feat or a class feature and these rows carry neither id. */
  usesRecord?: { limitedUses?: LimitedUses };
  /** A HERITAGE row's own `content.heritages` id. Heritages are an ordinary gated bucket (WG encodes
   *  them as rows, so they are not chassis — docs/trust-gate.md §2), and without an id the 42 gated
   *  ones would print their full text on the sheet with nothing to say why none of it applies. */
  heritageId?: string;
  /** The `content.classFeatures` id of a row that is a class feature but carries no `featureId`: a
   *  SUBCLASS or extra-choice pick (a rogue's Ruffian racket, a witch's Lesson of Calamity — 51 of
   *  the 105 gated class features reach the sheet this way), an inventor modification, an
   *  override-granted feature. Deliberately NOT `featureId`: that field also drives the use pips, and
   *  a "not yet verified" line must not put a new control on the row. */
  trustFeatureId?: string;
  /**
   * Card step 8 (docs/card-design.md section 4, row F2): everything the app adds to this row — the
   * player's pick ("Your choice: …"), another record's marker (principles A / C, Ruling F), the record's
   * own note, the running enhancement tier, a use-counter retune, an Overrides text edit, a homebrew
   * record's typed use lines. FeatDetail draws them in ONE box marked `data-ours` after the body (use
   * lines above it), on the page lane and the markdown lane alike; none of it is ever appended to
   * `description` as text, so a pick can no longer turn a markdown table into raw `| --- |` (T3).
   *
   * Optional, because a dozen places build a FeatEntry: one built without it (a test fixture, an older
   * caller) renders exactly as it did before this step — featStatRows keeps its Enhancement row for it.
   * featEntries always sets it (an empty list when the row has nothing of ours).
   */
  ours?: OursLine[];
}

/** Which core.json record a row is showing, for TrustMarker. A row built from something with no id
 *  of its own (a background's granted line) answers nothing and the marker stays away — see the
 *  reasoning on TrustMarker's own props. */
export function trustRefOf(e: FeatEntry): { bucket?: string; id?: string } {
  if (e.featId) return { bucket: 'feats', id: e.featId };
  if (e.featureId) return { bucket: 'classFeatures', id: e.featureId };
  if (e.trustFeatureId) return { bucket: 'classFeatures', id: e.trustFeatureId };
  if (e.heritageId) return { bucket: 'heritages', id: e.heritageId };
  return {};
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One stat row of the feat popup. `Activate` carries the cost its glyph draws instead of a value. */
export type FeatStatRow = { k: 'Activate'; cost: ActionCost } | { k: 'Prerequisites' | 'Enhancement'; v: string };

/**
 * The feat / feature / heritage popup's stat rows, in the order it prints them: the Activate glyph line,
 * Prerequisites, and the running Enhancement tier. Card step 1: exported so the card's printed set
 * (docs/card-design.md section 2 rule 4.2) reads the SAME rows the popup renders; FeatDetail renders
 * from this and nothing else.
 */
export function featStatRows(entry: FeatEntry): FeatStatRow[] {
  const rows: FeatStatRow[] = [];
  if (entry.actionCost && isActionCost(entry.actionCost)) rows.push({ k: 'Activate', cost: entry.actionCost });
  if (entry.prerequisites?.length) rows.push({ k: 'Prerequisites', v: entry.prerequisites.join(', ') });
  // Card step 8 (section 4, kind `enhancement`): the running tier is OURS — the book prints the
  // Enhancement paragraph, the app adds only that you have it — so an entry that carries ours lines
  // (every featEntries row) says it in the ours box, not in this print-styled stat row. An entry built
  // without ours lines keeps the row it always had.
  if (entry.enhancedBy && entry.ours === undefined) rows.push({ k: 'Enhancement', v: enhancementText(entry.enhancedBy) });
  return rows;
}

/** The enhancement tier's words, one copy for the stat row and the ours line. */
export const enhancementText = (from: string) => `active — granted by ${from}`;

/** A use line's label printed on the record's own text: a paragraph of the page tree that opens with
 *  that bold label, or (no page) a markdown / HTML line of the description that does. */
function labelPrinted(label: string, ast: AstNode | null, description: string): boolean {
  const want = label.toLowerCase();
  if (ast) {
    let found = false;
    (function walk(n: AstNode) {
      if (found) return;
      if (n.t === 'p') {
        const first = (n.c || []).find((x) => !(x.t === 'text' && !textOf(x).trim()));
        if (first?.t === 'b' && textOf(first).trim().toLowerCase().startsWith(want)) { found = true; return; }
      }
      for (const c of n.c || []) walk(c);
    })(ast);
    return found;
  }
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\n|>)\\s*(\\*\\*|<strong>|<b>)?\\s*${esc}\\b`, 'i').test(description);
}

/**
 * The ours lines this popup draws, split by where they go (card step 8):
 *  - `use`: a homebrew record's typed use lines, above the body — only those whose label the record's
 *    own text does not already print (the page tree when one is drawn, else the description), and none
 *    while the page is still loading;
 *  - `box`: everything else, after the body. An Overrides text edit (`override`) is drawn only where the
 *    PAGE is shown: on the markdown lane the body already IS the edited text.
 */
export function featOursSplit(
  entry: FeatEntry,
  page: { ast: AstNode | null; loading: boolean },
): { use: OursLine[]; box: OursLine[] } {
  const ours = entry.ours ?? [];
  const use = page.loading ? [] : ours.filter((l) => l.kind === 'useLine' && !labelPrinted(l.label ?? '', page.ast, entry.description));
  const box = ours.filter((l) => l.kind !== 'useLine' && (l.kind !== 'override' || !!page.ast));
  return { use, box };
}

/**
 * The node this popup's PinStar hands to the pin, by {bucket, id} (card step 7a, docs/card-design.md
 * section 2 rule 2): a pinned popup opens the record the row was opened FROM, never whichever record
 * its display name slugs to. The name carries the pick ("Caustic Nectar (Acid)") and can be another
 * record's name ("Zombie Horde" is also the Clockwork Reanimator feat), so the slug of the title missed
 * or landed on the wrong page; a heritage row was keyed 'classFeatures' and never found its page at
 * all. A row with no record id of its own keeps the key and the title lookup it always had.
 *
 * Card step 19: the store (play.ts togglePinnedDesc → pinOf) keeps the slug, the mode ('mine': the
 * character's own record) and the choice / mark / note ours lines, so the Pinned list reopens THIS record
 * (MainTab PinnedDescCard) and draws its box on the page lane.
 *
 * The title is left exactly as shown, so a pin saved earlier (identity `key:title`, play.ts descId) is
 * still found by the star of the same feat or feature; only a heritage row's key changes, to the
 * bucket its page lives in (featStarNode keeps the old heritage pins found).
 */
export function featPinNode(entry: FeatEntry): FeatPinNode {
  const ref = trustRefOf(entry);
  return {
    title: entry.name,
    description: pinDescriptionOf(entry),
    descRefs: entry.descRefs,
    key: ref.bucket ?? featLegacyPinKey(entry),
    ...(ref.id ? { slug: ref.id } : {}),
    mode: 'mine',
    // Card step 8 (section 4): the pin carries the same ours lines the popup draws, as data beside the
    // node; card step 19 stores the choice / mark / note ones (play.ts pinOf) and MainTab's PinnedDescCard
    // draws them in the reopened card's box. The description keeps pinDescriptionOf's words for the
    // no-page lane and for a device still on an older version (additive synced shape).
    ...(entry.ours?.length ? { ours: entry.ours } : {}),
  };
}

/** DescBody's rich-HTML test (DescBody.tsx:15 HTML_TAG, not exported): a description it would draw as
 *  HTML rather than markdown. Kept in step with that one so pinDescriptionOf never switches a lane. */
const PIN_HTML_TAG = /<(a|strong|em|b|i|u|s|h[1-6]|ul|ol|li|blockquote|span|br|div|p|hr|mark)\b/i;
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The STORED pin's description: the row's text plus the box's words.
 *
 * Before card step 8 the pin's description was the row's description with the pick, the markers and the
 * note appended. Card step 19 stores the choice / mark / note lines on the pin as `ours` (play.ts pinOf),
 * and MainTab's PinnedDescCard draws them in the reopened card's box — but only over a PAGE. A reopened
 * pin whose record has no page draws this description (the box is left off there, so its words are said
 * once), and a device still on an older version reads only the description (additive synced shape). So
 * the pin — and only the pin — still carries the box's words after the record's text; the popup itself
 * never does (its box is `data-ours`).
 *
 * Unlike the old concatenation it never changes DescBody's lane: on a markdown description each line is
 * a markdown paragraph with `<` escaped, so a kineticist gate's table stays a table (T3); only an HTML
 * description gets `<p>` lines. Left out: an Overrides edit (on the no-page lane the description already
 * IS the edited text) and a homebrew use line whose label the text already prints.
 *
 * Card step 19 kept this (it did not drop it): the no-page lane and older devices still read it.
 *
 * Card step 18: an `atYourLevel` line is NEVER stored. It is derive's CURRENT value for the character at
 * its level; frozen into the description it would go stale at the next level and read as the record's own
 * words (unmarked). MainTab's PinnedDescCard draws it live, marked ours, from the same builder
 * (cardAtLevel.ts atLevelLines) whenever the character still holds the record.
 */
export function pinDescriptionOf(entry: FeatEntry): string {
  const lines = (entry.ours ?? []).filter(
    (l) =>
      l.kind !== 'override' &&
      l.kind !== 'atYourLevel' &&
      (l.kind !== 'useLine' || !labelPrinted(l.label ?? '', null, entry.description)),
  );
  if (lines.length === 0) return entry.description;
  const words = lines.map(oursLineText);
  if (PIN_HTML_TAG.test(entry.description)) return entry.description + words.map((w) => `<p>${escapeHtml(w)}</p>`).join('');
  return [entry.description, ...words.map((w) => w.replace(/</g, '&lt;'))].filter(Boolean).join('\n\n');
}

/** The node FeatDetail's star hands to the pin: a description node plus the row's ours lines. */
export type FeatPinNode = DescNode & { ours?: OursLine[]; mode?: 'browse' | 'mine' | 'gm' };

/** The key this popup's pin carried before card step 7a (a heritage row was keyed 'classFeatures'). */
function featLegacyPinKey(entry: FeatEntry): string {
  return entry.isFeature ? 'classFeatures' : 'feats';
}

/**
 * The node the star SHOWS and TOGGLES. Never-overwrite (CLAUDE.md): a pin saved before card step 7a
 * carries the key the row had then and no record id, and such a pin is matched by its legacy `key:title`
 * (play.ts samePin falls back to descId when either side lacks an id), so a heritage pinned earlier
 * ({key:'classFeatures', title}) would not match the new 'heritages' node: the star would read "not
 * pinned", the old pin could not be removed from here, and pressing it would pin it twice. When the
 * character holds that old pin (and not a new one), the star shows it as pinned and pressing it removes
 * THAT pin; no stored pin is rewritten. A pin that stores its id is matched by {bucket, id} (card step 19,
 * play.ts samePin), whatever its title says.
 */
export function featStarNode(entry: FeatEntry, pin: PinDescApi | null): FeatPinNode {
  const node = featPinNode(entry);
  const legacyKey = featLegacyPinKey(entry);
  if (!pin || node.key === legacyKey) return node;
  const { slug: _slug, ...rest } = node;
  const legacy: FeatPinNode = { ...rest, key: legacyKey };
  return !pin.has(node) && pin.has(legacy) ? legacy : node;
}

/** FeatDetail's props. `character` scopes the card (card step 11); a caller without one gets the page whole. */
export interface FeatDetailProps {
  entry: FeatEntry;
  onClose: () => void;
  /** The character whose row this is: the 'mine' card folds what it does not have yet (scopeOfCharacter). */
  character?: Character | null;
}

/**
 * The record a row's card opens, by {bucket, id} (section 2 rule 2): a feat by its feat id, a class
 * feature (or a subclass / choice row) by its classFeatures id, and a HERITAGE row by its heritage id in
 * the heritages bucket — rule 2(a): the legacy popup looked in classFeatures by the slug of the heritage's
 * name and resolved 0 of 336, though 333 have a page. A row with no record id of its own keeps the name
 * lookup it always had.
 */
export function featPageOf(entry: FeatEntry): { bucket: string; id: string } {
  const ref = trustRefOf(entry);
  if (ref.bucket === 'heritages' && ref.id) return { bucket: 'heritages', id: ref.id };
  const bucket = entry.isFeature ? 'classFeatures' : 'feats';
  return { bucket, id: ref.bucket === bucket && ref.id ? ref.id : astSlug(entry.name) };
}

/**
 * The player's pick, as the card header's subtitle (section 2 rule 4.1: "the pick suffix as a subtitle,
 * never part of the lookup"; section 5 "pickSuffix in the name — header subtitle only; lookup by id").
 * FeatsTab writes a feat's choice label and any pick into the row's NAME ("Assurance (Athletics)",
 * "Caustic Nectar (Acid)"); the page lane draws the page's own name, so without this the pick was on no
 * part of the card. It is what the row's name adds after the record's own name — each "(…)" group, joined
 * — and undefined when the name adds nothing or does not start with the record's name (a row with no
 * record id of its own, a renamed record: nothing is guessed).
 */
export function featPickSuffix(entry: FeatEntry, content: unknown): string | undefined {
  const ref = trustRefOf(entry);
  const own = ref.bucket && ref.id
    ? (content as Record<string, Record<string, { name?: string } | undefined> | undefined> | null)?.[ref.bucket]?.[ref.id]?.name
    : undefined;
  if (!own) return undefined;
  const name = entry.name.trim();
  if (!name.toLowerCase().startsWith(own.trim().toLowerCase())) return undefined;
  const rest = name.slice(own.trim().length).trim();
  if (!rest) return undefined;
  const groups = [...rest.matchAll(/\(([^()]*)\)/g)];
  return groups.length && groups.map((m) => m[0]).join(' ') === rest.replace(/\s+/g, ' ') ? groups.map((m) => m[1].trim()).join(', ') : rest;
}

/**
 * The pin the card's built-in star works on. RecordCard's star toggles the node it opened (the stack's
 * first node), which carries the row's own text so the no-page lane draws it; the pin must stay the one
 * the legacy star stored — featStarNode: the ours lines, the stored pin's description (pinDescriptionOf), the mode, and an old
 * heritage pin found under its old key (never-overwrite). So, for that first node only, `has` and
 * `toggle` see the star's node; a page opened from a link inside the card pins as it always did.
 */
export function featCardPin(pin: PinDescApi, cardNode: DescNode, starNode: FeatPinNode): PinDescApi {
  const isCardNode = (n: DescNode) => n.key === cardNode.key && n.slug === cardNode.slug && n.title === cardNode.title;
  return { ...pin, has: (n) => pin.has(isCardNode(n) ? starNode : n), toggle: (n) => pin.toggle(isCardNode(n) ? starNode : n) };
}

/**
 * The feat / feature / heritage / choice-row popup: the row's record as a 'mine' card (card step 11,
 * docs/card-design.md section 9 row 11; section 2 rules 4–5; plan F1). Card step 22 removed the legacy
 * popup it replaced.
 *  - The page's use lines (Frequency, Trigger, Requirements, Access, Cost, Prerequisites) show once each,
 *    in the page's words, before the prose: the popup prints NO stat rows over a page, so its printed set
 *    is empty — the Prerequisites field row is not drawn when a page exists, so the page's own
 *    Prerequisites wording shows (102 worded differently, 11 empty fields; print wins, R12).
 *  - The page header's own cost glyph is print; ours (data-ours) joins the header only where the page's
 *    header does not print the row's cost (MainTab oursHeaderCost, the action card's rule).
 *  - S-furniture leaves ("… leads to", navigation); Source and the reference lines are dimmed (the card).
 *  - The parts the character does not have yet fold (scopeOfCharacter); the row's pick (featPickSuffix,
 *    card step 13c) highlights its printed option and folds the other options (withPick).
 *  - The ours box after the body: picks, markers, notes, the running enhancement, use-counter retunes,
 *    an Overrides edit where the page is drawn (featOursSplit, card step 8).
 *  - No page (or a page that is not the record's own): the old text through the card's no-page lane, with
 *    the legacy popup's sub-line, trait chips, Prerequisites field row and a homebrew record's typed use
 *    lines above it (the card draws its controls on that lane only).
 * The builder card heading this pick came from (groupLabel) is ours, a tag in the header; so is the pick
 * itself over a page (featPickSuffix — the page's header prints the record's name, never the row's).
 */
export function FeatDetail({ entry, onClose, character }: FeatDetailProps) {
  const content = useContent();
  const page = featPageOf(entry);
  // The same lookup the card makes (cached): whether a page is drawn decides which homebrew use lines
  // the record's own text already prints, whether an Overrides edit needs its ours line, and whether the
  // page's header already prints the row's cost.
  const { node: pageAst, loading: pageLoading } = useAstNode(page.bucket, page.id);
  const ours = featOursSplit(entry, { ast: pageAst ?? null, loading: !!pageLoading });
  const stats = featStatRows(entry);
  const activate = stats.find((r): r is Extract<FeatStatRow, { k: 'Activate' }> => r.k === 'Activate');
  const prerequisites = stats.find((r): r is Extract<FeatStatRow, { v: string }> => r.k === 'Prerequisites')?.v;
  // An entry built without ours lines (featStatRows gives it an Enhancement stat row) keeps that fact on the
  // card as the ours line featEntries would have made — the card prints no stat rows of its own.
  const enhancement = stats.find((r): r is Extract<FeatStatRow, { v: string }> => r.k === 'Enhancement')?.v;
  const box: OursLine[] = enhancement !== undefined ? [...ours.box, { kind: 'enhancement', text: `Enhancement ${enhancement}` }] : ours.box;
  const cardNode: DescNode = { title: entry.name, description: entry.description, descRefs: entry.descRefs, key: page.bucket, slug: page.id };
  const pin = usePinDesc();
  const starNode = featStarNode(entry, pin);
  const cardPin = pin ? featCardPin(pin, cardNode, starNode) : null;
  // The pick, as the header subtitle — only over a page: the loading and no-page lanes title the card
  // with the row's name, which already carries it.
  const pickSub = pageAst ? featPickSuffix(entry, content) : undefined;
  const headerActions = (
    <>
      {pickSub && (
        <span className="card-pick-sub" data-ours="" data-ours-kind="pick" title="Your pick">{pickSub}</span>
      )}
      {activate && oursHeaderCost(activate.cost, pageAst ?? null) && (
        <span className="action-cost action-detail-cost card-ours-cost" data-ours="" title="The cost on your sheet">
          <ActionGlyph cost={activate.cost} />
        </span>
      )}
      {entry.groupLabel && (
        <span className="ff-tag card-ours-group" data-ours="" title={`Chosen for ${entry.groupLabel}`}>{entry.groupLabel}</span>
      )}
    </>
  );
  const kind = entry.isFeature ? 'Feature' : `${entry.bucket} feat`;
  const controls = (
    <>
      <div className="sd-sub" data-ours="">
        {kind} · level {entry.level}
        {entry.rarity && entry.rarity !== 'common' ? ` · ${cap(entry.rarity)}` : ''}
      </div>
      {entry.traits.length > 0 && (
        <div className="sd-traits">
          {entry.traits.map((t) => (
            <InfoTerm className="ff-trait" key={t} title={traitLabel(t)} description={traitDesc(t, content)}>
              {traitLabel(t)}
            </InfoTerm>
          ))}
        </div>
      )}
      {prerequisites !== undefined ? (
        <div className="sd-stats">
          <div className="sd-stat">
            <span className="sd-stat-k">Prerequisites</span>
            <span className="sd-stat-v">{prerequisites}</span>
          </div>
        </div>
      ) : null}
      <OursUseLines lines={ours.use} />
    </>
  );
  return (
    <PinContext.Provider value={cardPin}>
      <RecordCard
        node={cardNode}
        mode="mine"
        chrome="popup"
        scope={withPick(scopeOfCharacter(character), page.bucket, page.id, featPickSuffix(entry, content))}
        printed={[]}
        headerActions={headerActions}
        controls={controls}
        ours={box}
        onExit={onClose}
      />
    </PinContext.Provider>
  );
}
