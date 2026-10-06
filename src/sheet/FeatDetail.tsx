import type { ActionCost, DescRef, LimitedUses } from '../rules/types';
import { ActionGlyph, isActionCost } from './widgets';
import { DescBody, remasteredAsOf } from './DescBody';
import { InfoTerm } from './InfoTerm';
import { PinStar } from './PinStar';
import { usePinDesc, type PinDescApi } from './PinContext';
import { TrustMarker } from './TrustMarker';
import { useContent } from './ContentContext';
import { useEscapeClose } from './useEscapeClose';
import { traitDesc, traitLabel } from '../rules/glossary';
import { astSlug, useAstNode } from './useAst';
import type { DescNode } from './descref';
import type { AstNode } from './astStore';
import { textOf } from './astVisibility';
import { oursLineText, type OursLine } from './cardModel';
import { OursBox, OursUseLines } from './OursBox';

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
  /** The Feats-tab row's plain-text preview: the description plus the pick / marker / note words that
   *  used to be appended to it, so the row reads exactly as before. Absent = toPlainText(description). */
  preview?: string;
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
 * ⚠ What the player reopens today is the STORED pin, and togglePinnedDesc (play.ts) stores
 * {title, description, descRefs, key} — the slug is dropped until card step 19 stores it. So of this
 * node only the KEY reaches the Pinned list now: a heritage pin (key 'heritages') reopens the heritages
 * page by the slug of its name; a pick in the title or a shared name still reopens by name until step 19.
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
    // Card step 8 (section 4): the pin carries the same ours lines the popup draws, as data beside the
    // node. ⚠ What reaches the reopened pin is decided by the store (play.ts togglePinnedDesc keeps
    // title / description / descRefs / key) and by the popup that opens it (DescriptionModal hands
    // RecordCard no `ours`); both are outside this step — see card step 19, and pinDescriptionOf below.
    ...(entry.ours?.length ? { ours: entry.ours } : {}),
  };
}

/** DescBody's rich-HTML test (DescBody.tsx:15 HTML_TAG, not exported): a description it would draw as
 *  HTML rather than markdown. Kept in step with that one so the bridge below never switches a lane. */
const PIN_HTML_TAG = /<(a|strong|em|b|i|u|s|h[1-6]|ul|ol|li|blockquote|span|br|div|p|hr|mark)\b/i;
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The STORED pin's description — a BRIDGE until card step 19 stores `ours` on the pin.
 *
 * Before card step 8 the pin's description was the row's description with the pick, the markers and the
 * note appended, and that is all togglePinnedDesc (play.ts:2235) keeps. A reopened pin whose record has
 * no page draws that description, so dropping the appended words lost them from the pin (dedication-to-
 * the-five's note, any no-page pick or marker). So the pin — and only the pin — still carries the box's
 * words after the record's text, as before; the popup itself never does (its box is `data-ours`).
 *
 * Unlike the old concatenation it never changes DescBody's lane: on a markdown description each line is
 * a markdown paragraph with `<` escaped, so a kineticist gate's table stays a table (T3); only an HTML
 * description gets `<p>` lines. Left out: an Overrides edit (on the no-page lane the description already
 * IS the edited text) and a homebrew use line whose label the text already prints.
 *
 * Step 19 drops this: the stored pin keeps `ours`, and the reopened card draws the box.
 */
export function pinDescriptionOf(entry: FeatEntry): string {
  const lines = (entry.ours ?? []).filter(
    (l) => l.kind !== 'override' && (l.kind !== 'useLine' || !labelPrinted(l.label ?? '', null, entry.description)),
  );
  if (lines.length === 0) return entry.description;
  const words = lines.map(oursLineText);
  if (PIN_HTML_TAG.test(entry.description)) return entry.description + words.map((w) => `<p>${escapeHtml(w)}</p>`).join('');
  return [entry.description, ...words.map((w) => w.replace(/</g, '&lt;'))].filter(Boolean).join('\n\n');
}

/** The node FeatDetail's star hands to the pin: a description node plus the row's ours lines. */
export type FeatPinNode = DescNode & { ours?: OursLine[] };

/** The key this popup's pin carried before card step 7a (a heritage row was keyed 'classFeatures'). */
function featLegacyPinKey(entry: FeatEntry): string {
  return entry.isFeature ? 'classFeatures' : 'feats';
}

/**
 * The node the star SHOWS and TOGGLES. Never-overwrite (CLAUDE.md): a pin saved before card step 7a
 * carries the key the row had then, and pin identity is `key:title` (play.ts descId), so a heritage
 * pinned earlier ({key:'classFeatures', title}) would not match the new 'heritages' node: the star would
 * read "not pinned", the old pin could not be removed from here, and pressing it would pin it twice.
 * When the character holds that old pin (and not a new one), the star shows it as pinned and pressing
 * it removes THAT pin; no stored pin is rewritten. Matching stored pins by id is card step 19.
 */
export function featStarNode(entry: FeatEntry, pin: PinDescApi | null): FeatPinNode {
  const node = featPinNode(entry);
  const legacyKey = featLegacyPinKey(entry);
  if (!pin || node.key === legacyKey) return node;
  const { slug: _slug, ...rest } = node;
  const legacy: FeatPinNode = { ...rest, key: legacyKey };
  return !pin.has(node) && pin.has(legacy) ? legacy : node;
}

/** Read-only detail overlay for a feat / feature / heritage (reuses the .picker / .sd-* chrome). */
export function FeatDetail({ entry, onClose }: { entry: FeatEntry; onClose: () => void }) {
  const content = useContent();
  useEscapeClose(onClose);
  const kind = entry.isFeature ? 'Feature' : `${entry.bucket} feat`;
  /* The row's OWN page when the row knows its record: the slug of its NAME is another record's key
   * whenever two share a name (the Impossible Magic "Zombie Horde" opened the Clockwork Reanimator
   * feat — see descNodeOf). A row with no id of its own keeps the name lookup it always had. */
  const astKey = entry.isFeature ? 'classFeatures' : 'feats';
  const ref = trustRefOf(entry);
  const astId = ref.bucket === astKey && ref.id ? ref.id : astSlug(entry.name);
  const stats = featStatRows(entry);
  const activate = stats.find((r): r is Extract<FeatStatRow, { k: 'Activate' }> => r.k === 'Activate');
  const valueOf = (k: 'Prerequisites' | 'Enhancement') =>
    stats.find((r): r is Extract<FeatStatRow, { v: string }> => r.k === k)?.v;
  const prerequisites = valueOf('Prerequisites');
  const enhancement = valueOf('Enhancement');
  const pinNode = featStarNode(entry, usePinDesc());
  // Which lane DescBody draws (the same hook, the same cache): the page decides whether an Overrides
  // edit needs its ours line and which homebrew use lines the record's own text already prints.
  const { node: pageAst, loading: pageLoading } = useAstNode(astKey, astId);
  const ours = featOursSplit(entry, { ast: pageAst ?? null, loading: !!pageLoading });
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker spell-detail" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {entry.name}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <PinStar node={pinNode} />
            <button className="picker-close" onClick={onClose} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="sd-body">
          <div className="sd-sub">
            {kind} · level {entry.level}
            {entry.groupLabel ? ` · ${entry.groupLabel}` : ''}
            {entry.rarity && entry.rarity !== 'common' ? ` · ${cap(entry.rarity)}` : ''}
          </div>
          {/* Under the name, above the text — same position as the list row, the item popup and the
              builder pick, so the line reads the same wherever the player meets it. */}
          <TrustMarker {...trustRefOf(entry)} />
          {entry.traits.length > 0 && (
            <div className="sd-traits">
              {entry.traits.map((t) => (
                <InfoTerm className="ff-trait" key={t} title={traitLabel(t)} description={traitDesc(t, content)}>
                  {traitLabel(t)}
                </InfoTerm>
              ))}
            </div>
          )}
          {activate && (
            <div className="sd-activate">
              <strong>Activate</strong> <ActionGlyph cost={activate.cost} />
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
          {/* The ENHANCEMENT tier, when it is running. Rendered HERE rather than appended to the
              description because a record with an ast renders from the ast and DescBody discards the
              description string entirely — the Enhancement paragraph itself is already in that prose,
              so what this adds is the one fact the printed text cannot carry: that YOU have it. */}
          {enhancement !== undefined ? (
            <div className="sd-stats">
              <div className="sd-stat">
                <span className="sd-stat-k">Enhancement</span>
                <span className="sd-stat-v">{enhancement}</span>
              </div>
            </div>
          ) : null}
          {/* Card step 8: a homebrew record's typed use lines (Trigger, Requirements, Frequency, Access) —
              their first reader. Above the body, where use lines go, but ours: never styled as print. */}
          <OursUseLines lines={ours.use} />
          {/* desk #158: read the link off the record this row is showing, via the SAME ref TrustMarker
              above already resolves — a FeatEntry is a view model built in a dozen places, and
              threading one more field through all of them would be a far bigger change than a lookup. */}
          <DescBody
            description={entry.description}
            descRefs={entry.descRefs}
            onExit={onClose}
            astKey={astKey}
            astId={astId}
            remasteredAs={remasteredAsOf(content, ref)}
          />
          {/* Card step 8 (section 4): the ours box, after the body on BOTH lanes — DescBody picks the
              page or the markdown, and this box follows either. */}
          <OursBox lines={ours.box} />
        </div>
      </div>
    </div>
  );
}
