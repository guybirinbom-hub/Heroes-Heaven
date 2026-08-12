import { useMemo, useState } from 'react';
import type { ModeDef, ModeModifier, ModifierType } from '../rules/types';
import {
  MODE_TARGETS,
  MODIFIER_TYPES,
  modeRelevant,
  modeTargetLabel,
  modeTargetOptions,
  parseTargetKey,
  targetKey,
  type ModeTargetOption,
} from '../rules/modes';
import { usePrefs, togglePinnedMode } from '../data/prefs';
import { ModeDetailModal } from './ModeDetailModal';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const formatMod = (n: number) => (n >= 0 ? `+${n}` : String(n));

/** Human label for a modifier's target (incl. the save/skill detail). */
function targetLabel(mod: ModeModifier): string {
  if (mod.target === 'save') return mod.detail ? `${cap(mod.detail)} save` : 'Saving throws';
  if (mod.target === 'skill') return mod.detail ? (mod.detail.startsWith('lore:') ? cap(mod.detail.slice(5)) + ' Lore' : cap(mod.detail)) : 'Skills';
  // Every other kind carries its own detail-free label, and 'ability' spells the attribute out.
  if (mod.target === 'ability') return modeTargetLabel(mod);
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
  library: libraryProp,
  predefined: predefinedProp,
  catalog,
  classId,
  ancestryId,
  featIds,
  activeIds,
  charKey,
  charName,
  lores,
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
  /** This character's Lore keys, so a custom mode can target one. */
  lores?: string[];
  onToggle: (id: string) => void;
  onSave: (mode: ModeDef) => void;
  onDelete: (id: string) => void;
}) {
  const prefs = usePrefs();
  const [editing, setEditing] = useState<ModeDef | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  // The mode whose full write-up is open on top of the list.
  const [reading, setReading] = useState<ModeDef | null>(null);

  // An item mode belongs to its consumable — you get it by drinking the thing. It is not the
  // player's to pick, edit, pin or delete, so it is stripped here rather than at each call site:
  // the callers build `library` from content.modes, where an item mode looks exactly like a saved
  // one. (`modeRelevant` rejects them too, but search and "show all" deliberately bypass that gate.)
  const library = libraryProp.filter((m) => !m.fromItemId);
  const predefined = predefinedProp.filter((m) => !m.fromItemId);

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
        lores={lores}
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
        {/* Pressing the body READS the mode — it opens the full write-up rather than toggling, so
            reading one never accidentally activates it. The circle is the sole activate control. */}
        <button type="button" className="mode-info cond-row-open" title={`Read ${mode.name}`} onClick={() => setReading(mode)}>
          <div className="mode-name">
            {mode.name}
            {editable && mode.charId && <span className="mode-scope-tag" title="Only this character">★ this character</span>}
          </div>
          {mode.modifiers.length > 0 && <div className="mode-mods">{mode.modifiers.map(summarizeMod).join(' · ')}</div>}
          {mode.note && <div className="mode-note">{mode.note}</div>}
          {mode.modifiers.length === 0 && !mode.note && <div className="mode-mods">no modifiers</div>}
        </button>
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
      {reading && <ModeDetailModal mode={reading} onClose={() => setReading(null)} />}
    </div>
  );
}

/**
 * Pick what a modifier points at, by typing.
 *
 * A `<select>` of ten kinds plus a follow-up dropdown for "which save" / "which skill" meant the thing
 * you wanted was two controls deep and never where you looked. This is one control over the whole flat
 * list — "Reflex save", "Stealth", "Strength modifier", "Maximum HP" all one search away.
 */
function TargetPicker({
  options,
  value,
  onChange,
}: {
  options: ModeTargetOption[];
  value: string;
  onChange: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = options.find((o) => o.value === value);
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? options.filter((o) => (o.label + ' ' + o.group + ' ' + (o.alias ?? '')).toLowerCase().includes(ql))
    : options;
  // Keep the picker's own headings, but only for the groups that survived the search.
  const groups: { name: string; list: ModeTargetOption[] }[] = [];
  for (const o of shown) {
    let g = groups.find((x) => x.name === o.group);
    if (!g) groups.push((g = { name: o.group, list: [] }));
    g.list.push(o);
  }
  return (
    <>
      <button
        type="button"
        className="me-target"
        aria-label="Target"
        title="What this modifier changes"
        onClick={() => {
          setQ('');
          setOpen(true);
        }}
      >
        <span className="me-target-val">{current?.label ?? 'Choose a target…'}</span>
        <i className="ti ti-selector" aria-hidden="true" />
      </button>
      {open && (
        <div className="picker-overlay" onClick={() => setOpen(false)}>
          <div className="picker me-target-picker" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>What does this change?</span>
              <button className="picker-close" onClick={() => setOpen(false)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div className="picker-controls">
              <div className="search">
                <i className="ti ti-search" aria-hidden="true" />
                <input autoFocus placeholder="Search — “reflex”, “stealth”, “speed”…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <span className="ss-count">{shown.length}</span>
            </div>
            <div className="cond-list">
              {groups.map((g) => (
                <div className="modes-cat-block" key={g.name}>
                  <div className="modes-cat">{g.name}</div>
                  <div className="me-target-grid">
                    {g.list.map((o) => (
                      <button
                        type="button"
                        key={o.value}
                        className={'me-target-opt' + (o.value === value ? ' on' : '')}
                        onClick={() => {
                          onChange(o.value);
                          setOpen(false);
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              {shown.length === 0 && <div className="acts-empty">Nothing matches “{q}”.</div>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** The create/edit-a-mode form. Exported so Settings → Modes can reuse it (with the full roster as
 *  scope options). `scopeOptions` drives the universal-vs-character control. */
export function ModeEditor({
  draft,
  catalog,
  scopeOptions = [{ id: null, name: 'All characters' }],
  lores = [],
  onChange,
  onSave,
  onCancel,
  onDelete,
}: {
  draft: ModeDef;
  catalog: ModeDef[];
  scopeOptions?: ScopeOption[];
  /** This character's own Lore keys ('lore:warfare'), so a mode can target one. Empty in the
   *  character-less editor (Settings → Modes), where there is no character to read them off. */
  lores?: string[];
  onChange: (m: ModeDef) => void;
  onSave: () => void;
  onCancel: () => void;
  /** Provided only when editing an existing custom mode — renders a Delete button. */
  onDelete?: () => void;
}) {
  const targetOptions = useMemo(() => modeTargetOptions(lores), [lores]);
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
            <TargetPicker
              options={targetOptions}
              value={targetKey(mod.target, mod.detail)}
              onChange={(key) => {
                const { kind, detail } = parseTargetKey(key);
                setMod(i, { target: kind, detail });
              }}
            />
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
