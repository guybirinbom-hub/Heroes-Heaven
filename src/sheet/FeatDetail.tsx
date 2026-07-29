import type { ActionCost, DescRef } from '../rules/types';
import { ActionGlyph, isActionCost } from './widgets';
import { DescBody } from './DescBody';
import { InfoTerm } from './InfoTerm';
import { PinStar } from './PinStar';
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
  /** The core.json feat id, for rows that are real feats (features and heritages leave it unset).
   *  Needed to look up per-day uses; `key` can't serve, since it embeds the level for uniqueness. */
  featId?: string;
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
          <DescBody description={entry.description} descRefs={entry.descRefs} onExit={onClose} astKey={entry.isFeature ? 'classFeatures' : 'feats'} astId={astSlug(entry.name)} />
        </div>
      </div>
    </div>
  );
}
