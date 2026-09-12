import type { ActionCost, DescRef, LimitedUses } from '../rules/types';
import { ActionGlyph, isActionCost } from './widgets';
import { DescBody, remasteredAsOf } from './DescBody';
import { InfoTerm } from './InfoTerm';
import { PinStar } from './PinStar';
import { TrustMarker } from './TrustMarker';
import { useContent } from './ContentContext';
import { useEscapeClose } from './useEscapeClose';
import { traitDesc, traitLabel } from '../rules/glossary';
import { astSlug } from './useAst';

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

/** Read-only detail overlay for a feat / feature / heritage (reuses the .picker / .sd-* chrome). */
export function FeatDetail({ entry, onClose }: { entry: FeatEntry; onClose: () => void }) {
  const content = useContent();
  useEscapeClose(onClose);
  const kind = entry.isFeature ? 'Feature' : `${entry.bucket} feat`;
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker spell-detail" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {entry.name}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <PinStar node={{ title: entry.name, description: entry.description, descRefs: entry.descRefs, key: entry.isFeature ? 'classFeatures' : 'feats' }} />
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
          {isActionCost(entry.actionCost) && (
            <div className="sd-activate">
              <strong>Activate</strong> <ActionGlyph cost={entry.actionCost} />
            </div>
          )}
          {entry.prerequisites?.length ? (
            <div className="sd-stats">
              <div className="sd-stat">
                <span className="sd-stat-k">Prerequisites</span>
                <span className="sd-stat-v">{entry.prerequisites.join(', ')}</span>
              </div>
            </div>
          ) : null}
          {/* The ENHANCEMENT tier, when it is running. Rendered HERE rather than appended to the
              description because a record with an ast renders from the ast and DescBody discards the
              description string entirely — the Enhancement paragraph itself is already in that prose,
              so what this adds is the one fact the printed text cannot carry: that YOU have it. */}
          {entry.enhancedBy ? (
            <div className="sd-stats">
              <div className="sd-stat">
                <span className="sd-stat-k">Enhancement</span>
                <span className="sd-stat-v">active — granted by {entry.enhancedBy}</span>
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
            astKey={entry.isFeature ? 'classFeatures' : 'feats'}
            astId={astSlug(entry.name)}
            remasteredAs={remasteredAsOf(content, trustRefOf(entry))}
          />
        </div>
      </div>
    </div>
  );
}
