import type { ActionCost, DescRef } from '../rules/types';
import { ActionGlyph, isActionCost } from './widgets';
import { DescBody } from './DescBody';
import { InfoTerm } from './InfoTerm';
import { PinStar } from './PinStar';
import { useContent } from './ContentContext';
import { useEscapeClose } from './useEscapeClose';
import { traitDesc } from '../rules/glossary';

export interface FeatEntry {
  key: string;
  name: string;
  level: number;
  traits: string[];
  actionCost?: ActionCost;
  description: string;
  descRefs?: DescRef[];
  isFeature: boolean;
  bucket: string;
  rarity?: string;
  prerequisites?: string[];
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
            {entry.rarity && entry.rarity !== 'common' ? ` · ${cap(entry.rarity)}` : ''}
          </div>
          {entry.traits.length > 0 && (
            <div className="sd-traits">
              {entry.traits.map((t) => (
                <InfoTerm className="ff-trait" key={t} title={cap(t)} description={traitDesc(t, content)}>
                  {t}
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
          <DescBody description={entry.description} descRefs={entry.descRefs} onExit={onClose} />
        </div>
      </div>
    </div>
  );
}
