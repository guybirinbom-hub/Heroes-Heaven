import { useState } from 'react';
import type { ModeDef, ModeModifier, ModeTargetKind, ModifierType } from '../rules/types';
import { SKILLS, SAVES } from '../rules/types';
import { MODE_TARGETS, MODIFIER_TYPES, modeRelevant } from '../rules/modes';
import { usePrefs, togglePinnedMode } from '../data/prefs';

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
export function summarizeMod(mod: ModeModifier): string {
  const typed = mod.type === 'untyped' ? '' : ` ${mod.type}`;
  return `${formatMod(mod.value)}${typed} to ${targetLabel(mod)}${mod.appliesWhen ? ` — ${mod.appliesWhen}` : ''}`;
}

const newModifier = (): ModeModifier => ({ value: 1, type: 'status', target: 'all-checks' });

/** A scope a user-created mode can belong to — null id = universal (every character). */
export interface ScopeOption {
  id: string | null;
  name: string;
}

/** The "Modes" tab: toggle predefined class/ancestry/archetype modes (gated to your character), plus
 *  your own saved modes. Pin a star to keep a mode visible at the top even when it's gated out. */
export function ModesPanel({
  library,
  predefined,
  catalog,
  classId,
  ancestryId,
  featIds,
  activeIds,
  charKey,
  charName,
  onToggle,
  onSave,
  onDelete,
}: {
  library: ModeDef[];
  predefined: ModeDef[];
  catalog: ModeDef[];
  classId?: string | null;
  ancestryId?: string | null;
  /** Feat ids this character has — gates archetype modes (a mode's `feats` list). */
  featIds?: ReadonlySet<string>;
  activeIds: string[];
  /** Roster id of the character whose panel this is — for creating character-specific modes. */
  charKey?: string;
  charName?: string;
  onToggle: (id: string) => void;
  onSave: (mode: ModeDef) => void;
  onDelete: (id: string) => void;
}) {
  const prefs = usePrefs();
  const [editing, setEditing] = useState<ModeDef | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');

  const scopeOptions: ScopeOption[] = charKey
    ? [
        { id: null, name: 'All characters' },
        { id: charKey, name: charName ? `Only ${charName}` : 'Only this character' },
      ]
    : [{ id: null, name: 'All characters' }];

  if (editing) {
    return (
      <ModeEditor
        draft={editing}
        catalog={catalog}
        scopeOptions={scopeOptions}
        onChange={setEditing}
        onCancel={() => setEditing(null)}
        onSave={() => {
          if (editing.name.trim()) onSave({ ...editing, name: editing.name.trim() });
          setEditing(null);
        }}
        onDelete={
          library.some((m) => m.id === editing.id)
            ? () => {
                onDelete(editing.id);
                setEditing(null);
              }
            : undefined
        }
      />
    );
  }

  const active = new Set(activeIds);
  const pinned = new Set(prefs.pinnedModes ?? []);
  const ql = q.trim().toLowerCase();
  const matches = (m: ModeDef) => !ql || m.name.toLowerCase().includes(ql);

  // A predefined mode is on the default (non-search, non-show-all) list if it's relevant to the
  // character, OR force-shown because it's pinned or currently active (so a gated mode the player
  // turned on — or starred — never disappears).
  const relevant = (md: ModeDef) => modeRelevant(md, classId, ancestryId, featIds);
  const forceShow = (md: ModeDef) => pinned.has(md.id) || active.has(md.id);
  const defaultShow = (md: ModeDef) => relevant(md) || forceShow(md);

  const allModes = [...library, ...predefined];
  const editableIds = new Set(library.map((m) => m.id));
  const pinnedList = allModes.filter((m) => pinned.has(m.id) && matches(m));

  // Predefined shown in the categorized section (search → all; show-all → all; else default set),
  // minus the ones already surfaced in the Pinned section.
  const shownPredef = (ql || showAll ? predefined : predefined.filter(defaultShow))
    .filter(matches)
    .filter((m) => !pinned.has(m.id));
  const hiddenCount = predefined.filter((md) => !relevant(md)).length;

  const groups: { cat: string; list: ModeDef[] }[] = [];
  for (const md of shownPredef) {
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
    const isPinned = pinned.has(mode.id);
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
          <div className="mode-name">
            {mode.name}
            {editable && mode.charId && <span className="mode-scope-tag" title="Only this character">★ this character</span>}
          </div>
          {mode.modifiers.length > 0 && <div className="mode-mods">{mode.modifiers.map(summarizeMod).join(' · ')}</div>}
          {mode.note && <div className="mode-note">{mode.note}</div>}
          {mode.modifiers.length === 0 && !mode.note && <div className="mode-mods">no modifiers</div>}
        </div>
        <button
          className={'mode-pin' + (isPinned ? ' on' : '')}
          aria-label={isPinned ? 'Unpin' : 'Pin to top'}
          aria-pressed={isPinned}
          title={isPinned ? 'Unpin' : 'Pin to top'}
          onClick={() => togglePinnedMode(mode.id)}
        >
          <i className="ti ti-star" aria-hidden="true" />
        </button>
        {editable && (
          <button className="mode-edit" aria-label="Edit" onClick={() => setEditing(structuredClone(mode))}>
            <i className="ti ti-edit" aria-hidden="true" />
          </button>
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

      {pinnedList.length > 0 && (
        <>
          <div className="modes-section-head">
            <span className="modes-section-title">Pinned</span>
          </div>
          <div className="modes-list">{pinnedList.map((mode) => row(mode, editableIds.has(mode.id)))}</div>
        </>
      )}

      <div className="modes-section-head">
        <span className="modes-section-title">Your modes</span>
      </div>
      {library.filter((m) => !pinned.has(m.id)).filter(matches).length === 0 ? (
        <div className="acts-empty">
          {library.length === 0
            ? 'No custom modes yet. Create one with “New mode” — optionally starting from a template.'
            : 'All your custom modes are pinned above.'}
        </div>
      ) : (
        <div className="modes-list">{library.filter((m) => !pinned.has(m.id)).filter(matches).map((mode) => row(mode, true))}</div>
      )}

      <div className="modes-section-head">
        <span className="modes-section-title">Class, ancestry &amp; archetype modes</span>
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

/** The create/edit-a-mode form. Exported so Settings → Modes can reuse it (with the full roster as
 *  scope options). `scopeOptions` drives the universal-vs-character control. */
export function ModeEditor({
  draft,
  catalog,
  scopeOptions = [{ id: null, name: 'All characters' }],
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: ModeDef;
  catalog: ModeDef[];
  scopeOptions?: ScopeOption[];
  onChange: (m: ModeDef) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Provided only when editing an existing custom mode — renders a Delete button. */
  onDelete?: () => void;
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

      {scopeOptions.length > 1 && (
        <label className="me-field">
          <span className="me-label">Available to</span>
          <select
            value={draft.charId ?? ''}
            onChange={(e) => onChange({ ...draft, charId: e.target.value || undefined })}
          >
            {scopeOptions.map((s) => (
              <option key={s.id ?? '__all__'} value={s.id ?? ''}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

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
        {onDelete && (
          <button className="btn-danger me-delete" onClick={onDelete}>
            <i className="ti ti-trash" aria-hidden="true" /> Delete
          </button>
        )}
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
