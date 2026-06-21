import { useState } from 'react';
import type { ModeDef, ModeModifier, ModeTargetKind, ModifierType } from '../rules/types';
import { SKILLS, SAVES } from '../rules/types';
import { MODE_TARGETS, MODIFIER_TYPES, modeRelevant } from '../rules/modes';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const formatMod = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** Human label for a modifier's target (incl. the save/skill detail). */
function targetLabel(mod: ModeModifier): string {
  if (mod.target === 'save') return mod.detail ? `${cap(mod.detail)} save` : 'Saving throws';
  if (mod.target === 'skill') return mod.detail ? (mod.detail.startsWith('lore:') ? cap(mod.detail.slice(5)) + ' Lore' : cap(mod.detail)) : 'Skills';
  return MODE_TARGETS.find((t) => t.kind === mod.target)?.label ?? mod.target;
}
function summarizeMod(mod: ModeModifier): string {
  const typed = mod.type === 'untyped' ? '' : ` ${mod.type}`;
  return `${formatMod(mod.value)}${typed} to ${targetLabel(mod)}${mod.appliesWhen ? ` — ${mod.appliesWhen}` : ''}`;
}

const newModifier = (): ModeModifier => ({ value: 1, type: 'status', target: 'all-checks' });

/** The "Modes" tab: toggle predefined class/ancestry modes (gated to your character), plus your
 *  own saved modes (toggle on/off, create from a template, edit/delete). */
export function ModesPanel({
  library,
  predefined,
  catalog,
  classId,
  ancestryId,
  activeIds,
  onToggle,
  onSave,
  onDelete,
}: {
  library: ModeDef[];
  predefined: ModeDef[];
  catalog: ModeDef[];
  classId?: string | null;
  ancestryId?: string | null;
  activeIds: string[];
  onToggle: (id: string) => void;
  onSave: (mode: ModeDef) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<ModeDef | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');

  if (editing) {
    return (
      <ModeEditor
        draft={editing}
        catalog={catalog}
        onChange={setEditing}
        onCancel={() => setEditing(null)}
        onSave={() => {
          if (editing.name.trim()) onSave({ ...editing, name: editing.name.trim() });
          setEditing(null);
        }}
      />
    );
  }

  const active = new Set(activeIds);
  const ql = q.trim().toLowerCase();
  const matches = (m: ModeDef) => !ql || m.name.toLowerCase().includes(ql);
  const relevant = predefined.filter((md) => modeRelevant(md, classId, ancestryId));
  // A search spans every predefined mode (ignoring class/ancestry gating); otherwise show the
  // relevant set (or all when "Show all" is ticked).
  const shown = (ql ? predefined : showAll ? predefined : relevant).filter(matches);
  const hiddenCount = predefined.length - relevant.length;

  // Group the shown predefined modes by category, preserving catalog order.
  const groups: { cat: string; list: ModeDef[] }[] = [];
  for (const md of shown) {
    const cat = md.category ?? 'Other';
    let g = groups.find((x) => x.cat === cat);
    if (!g) {
      g = { cat, list: [] };
      groups.push(g);
    }
    g.list.push(md);
  }

  const row = (mode: ModeDef, editable: boolean) => {
    const on = active.has(mode.id);
    return (
      <div className={'mode-row' + (on ? ' on' : '')} key={mode.id}>
        <button
          className={'mode-toggle' + (on ? ' on' : '')}
          aria-label={on ? 'Deactivate' : 'Activate'}
          onClick={() => onToggle(mode.id)}
        >
          <i className={'ti ' + (on ? 'ti-circle-check' : 'ti-circle')} aria-hidden="true" />
        </button>
        <div className="mode-info" onClick={() => onToggle(mode.id)}>
          <div className="mode-name">{mode.name}</div>
          {mode.modifiers.length > 0 && <div className="mode-mods">{mode.modifiers.map(summarizeMod).join(' · ')}</div>}
          {mode.note && <div className="mode-note">{mode.note}</div>}
          {mode.modifiers.length === 0 && !mode.note && <div className="mode-mods">no modifiers</div>}
        </div>
        {editable && (
          <>
            <button className="mode-edit" aria-label="Edit" onClick={() => setEditing(structuredClone(mode))}>
              <i className="ti ti-edit" aria-hidden="true" />
            </button>
            <button className="mode-del" aria-label="Delete" onClick={() => onDelete(mode.id)}>
              <i className="ti ti-trash" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    );
  };

  return (
    <div className="modes-panel">
      <div className="modes-top">
        <span className="modes-hint">Toggle a mode to apply it. Conditional modifiers underline the stat instead of changing it.</span>
        <button
          className="add-item-btn"
          onClick={() => setEditing({ id: `mode-${Date.now().toString(36)}`, name: '', modifiers: [newModifier()] })}
        >
          <i className="ti ti-plus" aria-hidden="true" /> New mode
        </button>
      </div>

      <div className="search modes-search">
        <i className="ti ti-search" aria-hidden="true" />
        <input placeholder="Search modes" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="modes-section-head">
        <span className="modes-section-title">Your modes</span>
      </div>
      {library.length === 0 ? (
        <div className="acts-empty">No custom modes yet. Create one with “New mode” — optionally starting from a template.</div>
      ) : (
        <div className="modes-list">{library.filter(matches).map((mode) => row(mode, true))}</div>
      )}

      <div className="modes-section-head">
        <span className="modes-section-title">Class &amp; ancestry modes</span>
        {hiddenCount > 0 && (
          <label className="modes-showall">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            Show all ({hiddenCount} more)
          </label>
        )}
      </div>
      {groups.length === 0 ? (
        <div className="acts-empty">No predefined modes match this character. Tick “Show all” to browse every mode.</div>
      ) : (
        groups.map((g) => (
          <div className="modes-cat-block" key={g.cat}>
            <div className="modes-cat">{g.cat}</div>
            <div className="modes-list">{g.list.map((mode) => row(mode, false))}</div>
          </div>
        ))
      )}
    </div>
  );
}

function ModeEditor({
  draft,
  catalog,
  onChange,
  onSave,
  onCancel,
}: {
  draft: ModeDef;
  catalog: ModeDef[];
  onChange: (m: ModeDef) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const setMod = (i: number, patch: Partial<ModeModifier>) =>
    onChange({ ...draft, modifiers: draft.modifiers.map((m, j) => (j === i ? { ...m, ...patch } : m)) });
  const removeMod = (i: number) => onChange({ ...draft, modifiers: draft.modifiers.filter((_, j) => j !== i) });

  const applyTemplate = (id: string) => {
    const t = catalog.find((c) => c.id === id);
    if (!t) return;
    onChange({ ...draft, name: draft.name.trim() || t.name, modifiers: structuredClone(t.modifiers) });
  };

  return (
    <div className="mode-editor">
      <label className="me-field">
        <span className="me-label">Mode name</span>
        <input value={draft.name} placeholder="e.g. Inspired" onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>

      <label className="me-field">
        <span className="me-label">Start from a template (optional)</span>
        <select value="" onChange={(e) => e.target.value && applyTemplate(e.target.value)}>
          <option value="">— blank —</option>
          {Object.entries(
            catalog.reduce<Record<string, ModeDef[]>>((acc, c) => {
              (acc[c.category ?? 'Other'] ??= []).push(c);
              return acc;
            }, {}),
          ).map(([cat, list]) => (
            <optgroup label={cat} key={cat}>
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="me-mods-label">Modifiers</div>
      {draft.modifiers.map((mod, i) => {
        const needsDetail = MODE_TARGETS.find((t) => t.kind === mod.target)?.needsDetail;
        return (
          <div className="me-mod" key={i}>
            <input
              className="me-val"
              type="number"
              value={mod.value}
              aria-label="Value"
              onChange={(e) => setMod(i, { value: parseInt(e.target.value, 10) || 0 })}
            />
            <select value={mod.type} aria-label="Type" onChange={(e) => setMod(i, { type: e.target.value as ModifierType })}>
              {MODIFIER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {cap(t)}
                </option>
              ))}
            </select>
            <select
              value={mod.target}
              aria-label="Target"
              onChange={(e) => setMod(i, { target: e.target.value as ModeTargetKind, detail: undefined })}
            >
              {MODE_TARGETS.map((t) => (
                <option key={t.kind} value={t.kind}>
                  {t.label}
                </option>
              ))}
            </select>
            {needsDetail === 'save' && (
              <select value={mod.detail ?? ''} aria-label="Which save" onChange={(e) => setMod(i, { detail: e.target.value || undefined })}>
                <option value="">All saves</option>
                {SAVES.map((s) => (
                  <option key={s} value={s}>
                    {cap(s)}
                  </option>
                ))}
              </select>
            )}
            {needsDetail === 'skill' && (
              <select value={mod.detail ?? ''} aria-label="Which skill" onChange={(e) => setMod(i, { detail: e.target.value || undefined })}>
                <option value="">All skills</option>
                {SKILLS.map((s) => (
                  <option key={s} value={s}>
                    {cap(s)}
                  </option>
                ))}
              </select>
            )}
            <input
              className="me-when"
              value={mod.appliesWhen ?? ''}
              placeholder="applies when… (leave blank = always)"
              onChange={(e) => setMod(i, { appliesWhen: e.target.value || undefined })}
            />
            <button className="me-rm" aria-label="Remove modifier" onClick={() => removeMod(i)}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        );
      })}
      <button className="me-add" onClick={() => onChange({ ...draft, modifiers: [...draft.modifiers, newModifier()] })}>
        <i className="ti ti-plus" aria-hidden="true" /> Add modifier
      </button>

      <div className="me-actions">
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn-primary" disabled={!draft.name.trim()} onClick={onSave}>
          Save mode
        </button>
      </div>
    </div>
  );
}
