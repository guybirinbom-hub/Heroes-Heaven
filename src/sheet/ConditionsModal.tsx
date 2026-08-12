import { useState } from 'react';
import { isMobileNow } from './useIsMobile';
import type { ActiveCondition, Condition, ModeDef } from '../rules/types';
import { ModesPanel } from './ModesPanel';
import { DescriptionModal } from './DescriptionModal';
import { toPlainText } from './RichText';
import { useEscapeClose } from './useEscapeClose';

/**
 * Browse + apply PF2e conditions, and (for a character) manage toggleable Modes. Clicking a
 * condition toggles it on/off; valued conditions (Frightened, Clumsy, …) get a −/＋ stepper.
 */
export function ConditionsModal({
  conditions,
  active,
  onAdd,
  onRemove,
  onStepValue,
  onClose,
  modesEnabled,
  library = [],
  predefined = [],
  catalog = [],
  classId,
  ancestryId,
  featIds,
  charKey,
  charName,
  lores,
  activeModeIds = [],
  onToggleMode,
  onSaveMode,
  onDeleteMode,
}: {
  conditions: Record<string, Condition>;
  active: ActiveCondition[];
  onAdd: (id: string, valued: boolean) => void;
  onRemove: (id: string) => void;
  /** Nudge a valued condition by ±1. A DELTA, not a target value — see stepConditionValue. */
  onStepValue: (id: string, delta: number) => void;
  onClose: () => void;
  /** Show the Modes tab (character sheet only — not companions). */
  modesEnabled?: boolean;
  library?: ModeDef[];
  /** App-provided modes, directly toggleable + gated by class/ancestry. */
  predefined?: ModeDef[];
  catalog?: ModeDef[];
  classId?: string | null;
  ancestryId?: string | null;
  featIds?: ReadonlySet<string>;
  charKey?: string;
  charName?: string;
  /** This character's Lore keys, so a custom mode can target one. */
  lores?: string[];
  activeModeIds?: string[];
  onToggleMode?: (id: string) => void;
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
}) {
  useEscapeClose(onClose);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'conditions' | 'modes'>('conditions');
  // The condition whose full rules page is open on top of this list.
  const [reading, setReading] = useState<Condition | null>(null);
  const activeIds = new Set(active.map((c) => c.id));
  const list = Object.values(conditions)
    .filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker cond-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {modesEnabled ? 'Conditions & modes' : 'Conditions'}
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        {modesEnabled && (
          <div className="modal-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'conditions'} className={'mtab' + (tab === 'conditions' ? ' on' : '')} onClick={() => setTab('conditions')}>
              Conditions
            </button>
            <button type="button" role="tab" aria-selected={tab === 'modes'} className={'mtab' + (tab === 'modes' ? ' on' : '')} onClick={() => setTab('modes')}>
              Modes
            </button>
          </div>
        )}
        {modesEnabled && tab === 'modes' ? (
          <ModesPanel
            library={library}
            predefined={predefined}
            catalog={catalog}
            classId={classId}
            ancestryId={ancestryId}
            featIds={featIds}
            charKey={charKey}
            charName={charName}
            lores={lores}
            activeIds={activeModeIds}
            onToggle={(id) => onToggleMode?.(id)}
            onSave={(m) => onSaveMode?.(m)}
            onDelete={(id) => onDeleteMode?.(id)}
          />
        ) : (
          <>
            <div className="picker-controls">
          <div className="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input autoFocus={!isMobileNow()} placeholder="Search conditions" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="ss-count">{list.length}</span>
        </div>
        {/* Laid out exactly like the Modes list next door: a circle on the left that is the ONLY
            toggle, the name and a clamped blurb in the middle, and the row itself opening the full
            rules page. Two lists that do the same job now look like they do. */}
        <div className="modes-list cond-list">
          {list.map((c) => {
            const on = activeIds.has(c.id);
            const val = active.find((a) => a.id === c.id)?.value;
            return (
              <div key={c.id} className={'mode-row cond-row' + (on ? ' on' : '')}>
                <button
                  className={'mode-toggle' + (on ? ' on' : '')}
                  aria-label={on ? `Remove ${c.name}` : `Apply ${c.name}`}
                  aria-pressed={on}
                  title={on ? 'Remove' : 'Apply'}
                  onClick={() => (on ? onRemove(c.id) : onAdd(c.id, c.valued))}
                >
                  <i className={'ti ' + (on ? 'ti-circle-check' : 'ti-circle')} aria-hidden="true" />
                </button>
                <button type="button" className="mode-info cond-row-open" title={`Read ${c.name}`} onClick={() => setReading(c)}>
                  <div className="mode-name">
                    {c.name}
                    {c.valued && <span className="cond-valued-tag">valued</span>}
                  </div>
                  {/* Plain text, line-clamped. The rich renderer put links and block elements in here,
                      which is what made the clamp slice through the middle of a line. */}
                  {c.description && <div className="cond-row-desc">{toPlainText(c.description)}</div>}
                </button>
                {on && c.valued && (
                  <span className="cond-stepper">
                    {/* Deltas, not absolutes: see stepConditionValue — computing "val + 1" out here made
                        two fast taps write the same number twice. */}
                    <button aria-label={`Decrease ${c.name}`} onClick={() => onStepValue(c.id, -1)}>
                      <i className="ti ti-minus" aria-hidden="true" />
                    </button>
                    <span className="cond-val">{val ?? 1}</span>
                    <button aria-label={`Increase ${c.name}`} onClick={() => onStepValue(c.id, 1)}>
                      <i className="ti ti-plus" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            );
          })}
            </div>
          </>
        )}
        {reading && (
          <DescriptionModal
            root={{ title: reading.name, description: reading.description ?? '', descRefs: reading.descRefs, key: 'conditions', slug: reading.id }}
            onClose={() => setReading(null)}
          />
        )}
      </div>
    </div>
  );
}
