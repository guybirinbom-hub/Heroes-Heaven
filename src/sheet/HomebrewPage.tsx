import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import type { ContentDatabase, Item, ModeDef } from '../rules/types';
import {
  loadHomebrewSources,
  loadHomebrewContent,
  saveHomebrewSource,
  deleteHomebrewSource,
  saveHomebrewEntry,
  deleteHomebrewEntry,
  newRosterId,
  HOMEBREW_TYPES,
  type HomebrewContent,
  type HomebrewSource,
  type HomebrewType,
} from '../data/storage';
import { downloadText } from './download';
import {
  HOMEBREW_SCHEMAS,
  SCHEMA_BY_TYPE,
  homebrewId,
  type HBField,
  type HBForm,
  type HBSchema,
} from './homebrewSchemas';
import { ItemEditorModal } from './ItemEditorModal';
import { confirmDialog } from './confirm';
import { RichEditor } from './RichEditor';
import { useEscapeClose, useBackHandler } from './useEscapeClose';
import { useIsMobile } from './useIsMobile';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';
import { PageMenu } from './PageMenu';
import { MonsterPartsRules } from './MonsterPartsRules';

/** Sentinel "source" id for the read-only Monster Parts rules reference (not a real homebrew source,
 *  so it's never editable, exported, or imported). */
const MP_RULES_ID = '__mp-rules__';

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
  onOpenRoster,
  onOpenCampaigns,
  onSaveMode,
  onDeleteMode,
  characters,
}: {
  content: ContentDatabase;
  /** Called after any homebrew mutation so the host can refresh the live content DB. */
  onChanged: () => void;
  onClose: () => void;
  onOpenRoster?: () => void;
  /** Provided ONLY when signed in — absent hides the Campaigns menu item. */
  onOpenCampaigns?: () => void;
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
  characters?: { id: string; name: string }[];
}) {
  useEscapeClose(onClose);
  const isMobile = useIsMobile();
  // Mobile drill-in: the page opens on the sources LIST; tapping a source drills into its content
  // pane. Android Back / Escape / the header arrow steps back to the list (desktop keeps the
  // sidebar+pane layout and is untouched).
  const [mobileOpen, setMobileOpen] = useState(false);
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

  const isMpRules = selectedId === MP_RULES_ID;
  const selected = selectedId && !isMpRules ? sources[selectedId] : null;
  const drilledIn = isMobile && mobileOpen && (!!selected || isMpRules);
  // Android Back / Escape from a drilled-in source returns to the sources list.
  useBackHandler(drilledIn, () => setMobileOpen(false));

  const persistSource = (src: HomebrewSource) => {
    saveHomebrewSource(src);
    setSources((s) => ({ ...s, [src.id]: src }));
  };
  const createSource = () => {
    const src: HomebrewSource = { id: `hbsrc-${newRosterId()}`, name: 'New source' };
    persistSource(src);
    setSelectedId(src.id);
    setMobileOpen(true); // on a phone, drill straight into the new source
  };

  // Export / import all homebrew (sources + content) as a shareable JSON file.
  const fileRef = useRef<HTMLInputElement>(null);
  const exportHomebrew = () => {
    const payload = { app: 'heroes-heaven', kind: 'homebrew', version: 1, sources: loadHomebrewSources(), content: loadHomebrewContent() };
    downloadText(JSON.stringify(payload, null, 2), 'heroes-heaven-homebrew.json');
  };
  const importHomebrew = () => fileRef.current?.click();
  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as { sources?: Record<string, HomebrewSource>; content?: Partial<HomebrewContent> };
      if (!data || (!data.sources && !data.content)) throw new Error('not a homebrew file');
      let n = 0;
      for (const src of Object.values(data.sources ?? {})) persistSource(src); // merges (keeps existing)
      for (const type of HOMEBREW_TYPES) {
        for (const entry of Object.values(data.content?.[type] ?? {})) {
          saveHomebrewEntry(type, entry as HomebrewContent[typeof type][string]);
          n++;
        }
      }
      onChanged();
      setSources(loadHomebrewSources());
      await confirmDialog({
        title: 'Homebrew imported',
        message: `Added ${n} item${n === 1 ? '' : 's'} from the file. Enable their source per character under Setup → Sources.`,
        confirmLabel: 'Done',
      });
    } catch {
      await confirmDialog({ title: "Couldn't import", message: "That file isn't a Heroes Heaven homebrew export.", confirmLabel: 'OK' });
    }
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
    setMobileOpen(false); // a deleted source drops back to the sources list on a phone
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
          {/* No top-level back arrow — the hamburger is the navigation (Escape / Android-back also close
              the page via useEscapeClose). The arrow only appears to step back OUT of a drilled-in
              source on a phone. */}
          {drilledIn && (
            <button
              className="icon-btn hb-back"
              onClick={() => setMobileOpen(false)}
              title="Back"
              aria-label="Back to sources"
            >
              <i className="ti ti-arrow-left" aria-hidden="true" />
            </button>
          )}
          <HeroesHeavenLogo className="chrome-logo" />{' '}
          {drilledIn ? (isMpRules ? 'Monster Parts Rules' : selected?.name || 'Homebrew') : 'Homebrew'}
        </div>
        <PageMenu
          items={[
            ...(onOpenRoster ? [{ label: 'Characters', icon: 'ti-users', onClick: onOpenRoster }] : []),
            ...(onOpenCampaigns ? [{ label: 'Campaigns', icon: 'ti-flag', onClick: onOpenCampaigns }] : []),
          ]}
          modes={content.modes}
          characters={characters}
          onSaveMode={onSaveMode}
          onDeleteMode={onDeleteMode}
        />
        <WindowControls />
      </header>
      <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />

      {isMobile && !drilledIn ? (
        /* Phone: the 168px sidebar layout doesn't fit — drill in from a full-width sources list instead. */
        <div className="hb-sources-m">
          <p className="hb-sources-hint">
            A <strong>source</strong> holds your custom content — items, feats, spells, ancestries, heritages,
            backgrounds, and actions. Tap one to open it; enable it per character under Setup → Sources.
          </p>
          <button
            className="hb-source-row hb-special"
            onClick={() => {
              setSelectedId(MP_RULES_ID);
              setMobileOpen(true);
            }}
          >
            <i className="ti ti-bone" aria-hidden="true" />
            <span className="hb-row-name">Monster Parts Rules</span>
            <i className="ti ti-chevron-right hb-row-chev" aria-hidden="true" />
          </button>
          {sourceList.map((src) => (
            <button
              key={src.id}
              className="hb-source-row"
              onClick={() => {
                setSelectedId(src.id);
                setMobileOpen(true);
              }}
            >
              <i className="ti ti-folder" aria-hidden="true" />
              <span className="hb-row-name">{src.name}</span>
              <i className="ti ti-chevron-right hb-row-chev" aria-hidden="true" />
            </button>
          ))}
          <button className="hb-source-row hb-row-new" onClick={createSource}>
            <i className="ti ti-plus" aria-hidden="true" />
            <span className="hb-row-name">New source</span>
          </button>
          <div className="hb-io-row">
            <button className="chip" onClick={exportHomebrew}>
              <i className="ti ti-download" aria-hidden="true" /> Export homebrew
            </button>
            <button className="chip" onClick={importHomebrew}>
              <i className="ti ti-upload" aria-hidden="true" /> Import homebrew
            </button>
          </div>
        </div>
      ) : (
      <div className="settings-body">
          <nav className="settings-nav" aria-label="Homebrew sources">
            <button
              className={'settings-navitem hb-special' + (isMpRules ? ' active' : '')}
              onClick={() => setSelectedId(MP_RULES_ID)}
            >
              <i className="ti ti-bone" aria-hidden="true" /> Monster Parts Rules
            </button>
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
            <div className="hb-io-row">
              <button className="chip" onClick={exportHomebrew}>
                <i className="ti ti-download" aria-hidden="true" /> Export
              </button>
              <button className="chip" onClick={importHomebrew}>
                <i className="ti ti-upload" aria-hidden="true" /> Import
              </button>
            </div>
          </nav>
          <div className="settings-pane">
            {isMpRules ? (
              <MonsterPartsRules embedded />
            ) : !selected ? (
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
      )}

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
