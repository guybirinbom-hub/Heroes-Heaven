import { useMemo, useState } from 'react';
import type { ContentDatabase, Item } from '../rules/types';
import {
  loadHomebrewSources,
  saveHomebrewSource,
  deleteHomebrewSource,
  saveHomebrewEntry,
  deleteHomebrewEntry,
  newRosterId,
  type HomebrewContent,
  type HomebrewSource,
  type HomebrewType,
} from '../data/storage';
import {
  HOMEBREW_SCHEMAS,
  SCHEMA_BY_TYPE,
  homebrewId,
  type HBField,
  type HBForm,
  type HBSchema,
} from './homebrewSchemas';
import { MONSTER_PARTS_CAPABILITY } from '../rules/sources';
import { ItemEditorModal } from './ItemEditorModal';
import { confirmDialog } from './confirm';
import { RichEditor } from './RichEditor';
import { useEscapeClose } from './useEscapeClose';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';

type EntryRec = Record<string, unknown> & { id: string; name: string; homebrewSourceId?: string };

/** Generic field-driven editor for a non-item homebrew type. */
function HBEditorModal({
  schema,
  initial,
  sourceId,
  content,
  onSave,
  onClose,
}: {
  schema: HBSchema;
  initial?: EntryRec;
  sourceId: string;
  content: ContentDatabase;
  onSave: (type: HomebrewType, entry: EntryRec) => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const [form, setForm] = useState<HBForm>(() => schema.toForm(initial ?? {}));
  const set = (k: string, v: string | string[]) => setForm((f) => ({ ...f, [k]: v }));

  // Heritage's ancestry dropdown is populated from the live content DB.
  const ancestryOptions = useMemo(
    () => [
      { value: '', label: '— choose ancestry —' },
      { value: '__versatile__', label: 'Versatile (any ancestry)' },
      ...Object.values(content.ancestries)
        .map((a) => ({ value: a.id, label: a.name }))
        .sort((x, y) => x.label.localeCompare(y.label)),
    ],
    [content],
  );

  const save = () => {
    const name = (form.name as string)?.trim();
    if (!name) return;
    const id = initial?.id ?? homebrewId(schema.type, name);
    const entry = schema.toEntry(form, { id, sourceId }) as EntryRec;
    onSave(schema.type, entry);
    onClose();
  };

  const renderField = (field: HBField) => {
    const v = form[field.key];
    const options = field.key === 'ancestryId' ? ancestryOptions : field.options;
    switch (field.kind) {
      case 'rich':
        return <RichEditor initialHtml={(v as string) || ''} onChange={(html) => set(field.key, html)} placeholder={field.placeholder} />;
      case 'select':
        return (
          <select className="hb-input" value={(v as string) || ''} onChange={(e) => set(field.key, e.target.value)}>
            {(options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        );
      case 'multi':
        return (
          <div className="hb-checks">
            {(options ?? []).map((o) => {
              const on = Array.isArray(v) && (v as string[]).includes(o.value);
              return (
                <button
                  type="button"
                  key={o.value}
                  className={'chip' + (on ? ' active' : '')}
                  onClick={() => {
                    const cur = Array.isArray(v) ? (v as string[]) : [];
                    set(field.key, on ? cur.filter((x) => x !== o.value) : [...cur, o.value]);
                  }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        );
      case 'list':
        return (
          <input
            className="hb-input"
            type="text"
            value={Array.isArray(v) ? (v as string[]).join(', ') : ''}
            placeholder={field.placeholder}
            onChange={(e) => set(field.key, e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
          />
        );
      case 'number':
        return (
          <input
            className="hb-input"
            type="number"
            value={(v as string) ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => set(field.key, e.target.value)}
          />
        );
      default:
        return (
          <input
            className="hb-input"
            type="text"
            value={(v as string) ?? ''}
            placeholder={field.placeholder}
            onChange={(e) => set(field.key, e.target.value)}
          />
        );
    }
  };

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker hb-editor" role="dialog" aria-label={`${initial ? 'Edit' : 'New'} ${schema.label}`} onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          {initial ? 'Edit' : 'New'} {schema.label}
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="hb-form">
          {schema.fields.map((field) => (
            <label key={field.key} className={'hb-field' + (field.half ? ' half' : '') + (field.kind === 'rich' || field.kind === 'multi' ? ' full' : '')}>
              <span className="hb-label">
                {field.label}
                {field.required ? ' *' : ''}
              </span>
              {renderField(field)}
              {field.help && <span className="hb-help">{field.help}</span>}
            </label>
          ))}
        </div>
        <div className="hb-form-actions">
          <button className="chip" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={!(form.name as string)?.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

/** The Homebrew manager — create Sources and author content within them. */
export function HomebrewPage({
  content,
  onChanged,
  onClose,
}: {
  content: ContentDatabase;
  /** Called after any homebrew mutation so the host can refresh the live content DB. */
  onChanged: () => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const [sources, setSources] = useState<Record<string, HomebrewSource>>(() => loadHomebrewSources());
  const saveEntry = (type: HomebrewType, entry: EntryRec) => {
    saveHomebrewEntry(type, entry as unknown as HomebrewContent[typeof type][string]);
    onChanged();
  };
  const deleteEntry = (type: HomebrewType, id: string) => {
    deleteHomebrewEntry(type, id);
    onChanged();
  };
  const sourceList = useMemo(() => Object.values(sources).sort((a, b) => a.name.localeCompare(b.name)), [sources]);
  const [selectedId, setSelectedId] = useState<string | null>(() => sourceList[0]?.id ?? null);
  const [editing, setEditing] = useState<{ type: HomebrewType; entry?: EntryRec } | null>(null);

  const selected = selectedId ? sources[selectedId] : null;

  const persistSource = (src: HomebrewSource) => {
    saveHomebrewSource(src);
    setSources((s) => ({ ...s, [src.id]: src }));
  };
  const createSource = () => {
    const src: HomebrewSource = { id: `hbsrc-${newRosterId()}`, name: 'New source' };
    persistSource(src);
    setSelectedId(src.id);
  };
  const removeSource = async (id: string) => {
    if (
      !(await confirmDialog({
        title: 'Delete this source?',
        message: "Everything in it is deleted too. This can't be undone.",
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    deleteHomebrewSource(id);
    onChanged();
    setSources((s) => {
      const next = { ...s };
      delete next[id];
      return next;
    });
    setSelectedId((cur) => (cur === id ? null : cur));
  };

  // Entries of a given type belonging to the selected source (read from the live content DB).
  const entriesOf = (type: HomebrewType): EntryRec[] =>
    Object.values((content[type] ?? {}) as unknown as Record<string, EntryRec>)
      .filter((e) => e.homebrewSourceId === selectedId)
      .sort((a, b) => a.name.localeCompare(b.name));

  const ITEM_TYPE: HomebrewType = 'items';

  return (
    <div className="hb-page">
      <header className="chrome" data-tauri-drag-region>
        <div className="chrome-brand" data-tauri-drag-region>
          <button className="icon-btn hb-back" onClick={onClose} title="Back" aria-label="Back to character">
            <i className="ti ti-arrow-left" aria-hidden="true" />
          </button>
          <HeroesHeavenLogo className="chrome-logo" /> Homebrew
        </div>
        <WindowControls />
      </header>
      <div className="settings-body">
          <nav className="settings-nav" aria-label="Homebrew sources">
            {sourceList.map((src) => (
              <button
                key={src.id}
                className={'settings-navitem' + (selectedId === src.id ? ' active' : '')}
                onClick={() => setSelectedId(src.id)}
              >
                <i className="ti ti-folder" aria-hidden="true" /> {src.name}
              </button>
            ))}
            <button className="settings-navitem hb-new-source" onClick={createSource}>
              <i className="ti ti-plus" aria-hidden="true" /> New source
            </button>
          </nav>
          <div className="settings-pane">
            {!selected ? (
              <div className="settings-section">
                <h3 className="settings-h">Homebrew</h3>
                <p className="settings-desc">
                  Create a <strong>source</strong> to hold your custom content. Everything you make in it — items,
                  feats, spells, ancestries, heritages, backgrounds, and actions — appears throughout the app
                  alongside official content and can be toggled per character under Setup → Sources.
                </p>
                <button className="btn-primary" onClick={createSource}>
                  <i className="ti ti-plus" aria-hidden="true" /> New source
                </button>
              </div>
            ) : (
              <div className="settings-section">
                <div className="hb-source-head">
                  <input
                    className="hb-input hb-source-name"
                    value={selected.name}
                    aria-label="Source name"
                    onChange={(e) => persistSource({ ...selected, name: e.target.value })}
                  />
                  <button className="chip danger" onClick={() => removeSource(selected.id)}>
                    <i className="ti ti-trash" aria-hidden="true" /> Delete source
                  </button>
                </div>

                <label className="hb-unlock">
                  <input
                    type="checkbox"
                    checked={selected.unlocks?.includes(MONSTER_PARTS_CAPABILITY) ?? false}
                    onChange={(e) => {
                      const set = new Set(selected.unlocks ?? []);
                      if (e.target.checked) set.add(MONSTER_PARTS_CAPABILITY);
                      else set.delete(MONSTER_PARTS_CAPABILITY);
                      persistSource({ ...selected, unlocks: set.size ? [...set] : undefined });
                    }}
                  />
                  <span>
                    <strong>Unlocks the Monster Parts subsystem.</strong> A character who enables this source (Setup → Sources) can
                    refine &amp; imbue gear from monster parts in the Inventory tab.
                  </span>
                </label>

                {/* Items — reuse the full item editor */}
                <div className="hb-type">
                  <div className="hb-type-head">
                    <span>
                      <i className="ti ti-briefcase" aria-hidden="true" /> Items
                    </span>
                    <button className="chip" onClick={() => setEditing({ type: ITEM_TYPE })}>
                      <i className="ti ti-plus" aria-hidden="true" /> Add
                    </button>
                  </div>
                  {entriesOf(ITEM_TYPE).map((e) => (
                    <div className="hb-entry" key={e.id}>
                      <button className="hb-entry-name" onClick={() => setEditing({ type: ITEM_TYPE, entry: e })}>
                        {e.name}
                      </button>
                      <button
                        className="hb-entry-del"
                        aria-label={`Delete ${e.name}`}
                        onClick={() => deleteEntry(ITEM_TYPE, e.id)}
                      >
                        <i className="ti ti-trash" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Schema-driven types */}
                {HOMEBREW_SCHEMAS.map((schema) => (
                  <div className="hb-type" key={schema.type}>
                    <div className="hb-type-head">
                      <span>
                        <i className={'ti ' + schema.icon} aria-hidden="true" />{' '}
                        {schema.label.endsWith('y') ? schema.label.slice(0, -1) + 'ies' : schema.label + 's'}
                      </span>
                      <button className="chip" onClick={() => setEditing({ type: schema.type })}>
                        <i className="ti ti-plus" aria-hidden="true" /> Add
                      </button>
                    </div>
                    {entriesOf(schema.type).map((e) => (
                      <div className="hb-entry" key={e.id}>
                        <button className="hb-entry-name" onClick={() => setEditing({ type: schema.type, entry: e })}>
                          {e.name}
                        </button>
                        <button
                          className="hb-entry-del"
                          aria-label={`Delete ${e.name}`}
                          onClick={() => deleteEntry(schema.type, e.id)}
                        >
                          <i className="ti ti-trash" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      {/* Editors */}
      {editing && editing.type === 'items' && selected && (
        <ItemEditorModal
          mode={editing.entry ? 'edit' : 'create'}
          item={editing.entry as unknown as Item | undefined}
          content={content}
          onSave={(item) => {
            saveEntry('items', {
              ...(item as unknown as EntryRec),
              source: { license: 'homebrew' },
              homebrewSourceId: selected.id,
            });
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
      {editing && editing.type !== 'items' && selected && (
        <HBEditorModal
          schema={SCHEMA_BY_TYPE[editing.type]}
          initial={editing.entry}
          sourceId={selected.id}
          content={content}
          onSave={(type, entry) => {
            saveEntry(type, entry);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
