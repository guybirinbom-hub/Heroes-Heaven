import { useState } from 'react';
import type { ActiveCondition, Condition, ModeDef } from '../rules/types';
import { ModesPanel } from './ModesPanel';
import { DescBody } from './DescBody';
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
  onSetValue,
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
  activeModeIds = [],
  onToggleMode,
  onSaveMode,
  onDeleteMode,
}: {
  conditions: Record<string, Condition>;
  active: ActiveCondition[];
  onAdd: (id: string, valued: boolean) => void;
  onRemove: (id: string) => void;
  onSetValue: (id: string, value: number) => void;
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
  activeModeIds?: string[];
  onToggleMode?: (id: string) => void;
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
}) {
  useEscapeClose(onClose);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'conditions' | 'modes'>('conditions');
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
            <input autoFocus placeholder="Search conditions" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="ss-count">{list.length}</span>
        </div>
        <div className="cond-list">
          {list.map((c) => {
            const on = activeIds.has(c.id);
            const val = active.find((a) => a.id === c.id)?.value;
            return (
              <div
                key={c.id}
                className={'cond-row' + (on ? ' on' : '')}
                role="button"
                tabIndex={0}
                onClick={() => (on ? onRemove(c.id) : onAdd(c.id, c.valued))}
                onKeyDown={(e) =>
                  (e.key === 'Enter' || e.key === ' ') &&
                  (e.preventDefault(), on ? onRemove(c.id) : onAdd(c.id, c.valued))
                }
              >
                <span className="cond-row-check">{on && <i className="ti ti-check" aria-hidden="true" />}</span>
                <div className="cond-row-text">
                  <div className="cond-row-name">
                    {c.name}
                    {c.valued && <span className="cond-valued-tag">valued</span>}
                  </div>
                  {c.description && <DescBody description={c.description} descRefs={c.descRefs} className="cond-row-desc" as="div" />}
                </div>
                {on && c.valued && (
                  <span className="cond-stepper" onClick={(e) => e.stopPropagation()}>
                    <button aria-label="Decrease" onClick={() => onSetValue(c.id, (val ?? 1) - 1)}>
                      <i className="ti ti-minus" aria-hidden="true" />
                    </button>
                    <span className="cond-val">{val ?? 1}</span>
                    <button aria-label="Increase" onClick={() => onSetValue(c.id, (val ?? 1) + 1)}>
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
      </div>
    </div>
  );
}
