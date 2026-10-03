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
import { astSlug } from './useAst';
import type { DescNode } from './descref';

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
  if (entry.enhancedBy) rows.push({ k: 'Enhancement', v: `active — granted by ${entry.enhancedBy}` });
  return rows;
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
export function featPinNode(entry: FeatEntry): DescNode {
  const ref = trustRefOf(entry);
  return {
    title: entry.name,
    description: entry.description,
    descRefs: entry.descRefs,
    key: ref.bucket ?? featLegacyPinKey(entry),
    ...(ref.id ? { slug: ref.id } : {}),
  };
}

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
export function featStarNode(entry: FeatEntry, pin: PinDescApi | null): DescNode {
  const node = featPinNode(entry);
  const legacyKey = featLegacyPinKey(entry);
  if (!pin || node.key === legacyKey) return node;
  const { slug: _slug, ...rest } = node;
  const legacy: DescNode = { ...rest, key: legacyKey };
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
        </div>
      </div>
    </div>
  );
}
