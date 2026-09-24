import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
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
  listCampaignHbSources,
  loadCampaignHbCache,
  type HomebrewContent,
  type HomebrewSource,
  type HomebrewType,
} from '../data/storage';
import { exportCampaignSource, sharedSourceCampaigns } from '../data/campaignHomebrew';
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
import { chooseDialog, confirmDialog } from './confirm';
import { sanitizeEntryHtml } from './sanitizeHtml';
import { RichEditor } from './RichEditor';
import { useEscapeClose, useBackHandler } from './useEscapeClose';
import { useIsMobile } from './useIsMobile';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';
import { PageMenu } from './PageMenu';
import { MonsterPartsRules } from './MonsterPartsRules';
import { MythicRules } from './MythicRules';
import { KingmakerRules } from './KingmakerRules';

/** Sentinel "source" ids for the read-only rules references (not real homebrew sources,
 *  so they're never editable, exported, or imported). */
const MP_RULES_ID = '__mp-rules__';
const MYTHIC_RULES_ID = '__mythic-rules__';
const KINGMAKER_RULES_ID = '__kingmaker-rules__';

type EntryRec = Record<string, unknown> & { id: string; name: string; homebrewSourceId?: string };

/** Every authorable type in page order: Items (its own full editor) first, then the schema-driven ones. */
const TYPE_GROUPS: { type: HomebrewType; label: string; icon: string }[] = [
  { type: 'items', label: 'Items', icon: 'ti-briefcase' },
  ...HOMEBREW_SCHEMAS.map((s) => ({
    type: s.type,
    label: s.label.endsWith('y') ? s.label.slice(0, -1) + 'ies' : s.label + 's',
    icon: s.icon,
  })),
];
const byName = (a: EntryRec, b: EntryRec) => a.name.localeCompare(b.name);

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
  // `content` reaches both converters so a schema that STORES ids but ASKS for names (the deity's
  // favored weapons and cleric spells) can resolve each way round.
  const [form, setForm] = useState<HBForm>(() => schema.toForm(initial ?? {}, content));
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
    const entry = schema.toEntry(form, { id, sourceId, content }) as EntryRec;
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
  onOpenSettings,
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
  onOpenSettings?: () => void;
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
  // entriesOf/ownContent below read storage fresh on every render rather than holding their own state
  // (unlike `sources`), so deleting an entry needs its own nudge to re-render this component — bumped
  // in deleteEntry, otherwise the list would only refresh once the parent's async onChanged→content
  // round-trip lands.
  const [, refreshEntries] = useState(0);
  // A background refresh (a sync, a GM's campaign edit) hands App a new content DB while this page is
  // open, so re-read what storage now holds each time one arrives.
  useEffect(() => setSources(loadHomebrewSources()), [content]);
  // Campaign homebrew: this device's last pulled copy of what the GMs of the player's campaigns share.
  // Read-only here; its own selection so `selected` (and both editors' guards) stay own-only.
  // `content` is the dependency because a new one is the "a refresh landed" signal.
  const campaignSources = useMemo(() => listCampaignHbSources().sort((a, b) => a.name.localeCompare(b.name)), [content]);
  const [campaignSel, setCampaignSel] = useState<{ campaignId: string; sourceId: string } | null>(null);
  // The list holds each shared source once, so the source id alone finds it.
  const campaignRow = campaignSel ? campaignSources.find((s) => s.id === campaignSel.sourceId) : undefined;
  // GM side, desktop only — phones have no GM side and make no network call. Which of MY sources my
  // campaigns share; null = unknown, and then nothing is claimed either way.
  const [sharedMap, setSharedMap] = useState<Record<string, string[]> | null>(null);
  useEffect(() => {
    if (isMobile) return;
    let live = true;
    sharedSourceCampaigns().then(
      (m) => {
        if (live) setSharedMap(m);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []); // once, on mount
  const sharedWith = (id: string) => (!isMobile && sharedMap?.[id]?.length ? sharedMap[id].join(', ') : '');
  const saveEntry = (type: HomebrewType, entry: EntryRec) => {
    saveHomebrewEntry(type, entry as unknown as HomebrewContent[typeof type][string]);
    onChanged();
  };
  const deleteEntry = async (type: HomebrewType, entry: EntryRec) => {
    // A player's own content must never be lost by one mis-tap — same shape as removeSource's confirm.
    // What a deleted entry does to a character that holds it depends on the type: an item row keeps
    // its id and draws "Unknown item", a feat pick drops off the Feats tab, a prepared cantrip reads
    // "Empty cantrip" — so the message says "lose it", not one type's wording. When the entry's source
    // is shared with a campaign, the players' copies are NOT deleted: convertGone keeps an entry a
    // character still uses (src/data/campaignHomebrew.ts), so the message says so, like removeSource.
    const players = sharedWith(entry.homebrewSourceId ?? '');
    if (
      !(await confirmDialog({
        title: `Delete ${entry.name}?`,
        message:
          "It's removed from your homebrew and your characters lose it — this can't be undone." +
          (players ? ` Players in ${players} keep a copy as their own homebrew.` : ''),
        confirmLabel: 'Delete',
        danger: true,
      }))
    )
      return;
    deleteHomebrewEntry(type, entry.id);
    onChanged();
    refreshEntries((n) => n + 1);
  };
  const sourceList = useMemo(() => Object.values(sources).sort((a, b) => a.name.localeCompare(b.name)), [sources]);
  const [selectedId, setSelectedId] = useState<string | null>(() => sourceList[0]?.id ?? null);
  const [editing, setEditing] = useState<{ type: HomebrewType; entry?: EntryRec } | null>(null);

  const isMpRules = selectedId === MP_RULES_ID;
  const isMythicRules = selectedId === MYTHIC_RULES_ID;
  const isKingmakerRules = selectedId === KINGMAKER_RULES_ID;
  const isRulesRef = isMpRules || isMythicRules || isKingmakerRules;
  const selected = selectedId && !isRulesRef ? sources[selectedId] : null;
  const drilledIn = isMobile && mobileOpen && (!!selected || isRulesRef || !!campaignRow);
  // Android Back / Escape from a drilled-in source returns to the sources list.
  useBackHandler(drilledIn, () => setMobileOpen(false));
  // Open a row (a no-op for mobileOpen on desktop, where drilledIn needs isMobile).
  const open = (id: string) => {
    setSelectedId(id);
    setCampaignSel(null);
    setMobileOpen(true);
  };
  const openCampaign = (row: { id: string; campaignId: string }) => {
    setCampaignSel({ campaignId: row.campaignId, sourceId: row.id });
    setSelectedId(null);
    setMobileOpen(true);
  };

  const persistSource = (src: HomebrewSource) => {
    saveHomebrewSource(src);
    setSources((s) => ({ ...s, [src.id]: src }));
  };
  const createSource = () => {
    const src: HomebrewSource = { id: `hbsrc-${newRosterId()}`, name: 'New source' };
    persistSource(src);
    open(src.id); // on a phone, drill straight into the new source
  };
  // A campaign source → a separate own copy with new ids, which the GM's changes never reach.
  const exportCampaign = async (row: { id: string; campaignId: string }) => {
    const newId = exportCampaignSource(row.campaignId, row.id);
    // Notices, not questions: one button (a Cancel beside them would offer to undo what already happened).
    if (!newId) {
      await chooseDialog({ title: "Couldn't copy", message: 'That source is no longer on this device.', buttons: [{ value: 'ok', label: 'OK', primary: true }] });
      return;
    }
    onChanged();
    setSources(loadHomebrewSources());
    open(newId);
    await chooseDialog({
      title: 'Copied to your homebrew',
      message: "It's yours now — your GM's changes won't reach it. Turn it on per character under Setup → Sources.",
      buttons: [{ value: 'ok', label: 'Done', primary: true }],
    });
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
          // Sanitize HTML fields at rest so a poisoned imported/shared file never persists an active
          // payload (the editor + display both sanitize on use too, but clean-at-rest is defense in depth).
          saveHomebrewEntry(type, sanitizeEntryHtml(entry) as HomebrewContent[typeof type][string]);
          n++;
        }
      }
      onChanged();
      setSources(loadHomebrewSources());
      // A notice, not a question — the import already happened (a Cancel here would undo nothing).
      await chooseDialog({
        title: 'Homebrew imported',
        message: `Added ${n} item${n === 1 ? '' : 's'} from the file. Enable their source per character under Setup → Sources.`,
        buttons: [{ value: 'ok', label: 'Done', primary: true }],
      });
    } catch {
      await chooseDialog({ title: "Couldn't import", message: "That file isn't a Heroes Heaven homebrew export.", buttons: [{ value: 'ok', label: 'OK', primary: true }] });
    }
  };
  const removeSource = async (id: string) => {
    const players = sharedWith(id);
    if (
      !(await confirmDialog({
        title: 'Delete this source?',
        message:
          "Everything in it is deleted too. This can't be undone." +
          (players ? ` Players in ${players} keep a copy as their own homebrew.` : ''),
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

  // Entries of a given type belonging to the selected source. Read from STORAGE, not the content DB:
  // there, a live campaign copy shadows a kept entry the player never edited, and the kept one must
  // still list under its own source.
  const ownContent = selected || campaignRow ? loadHomebrewContent() : null;
  const entriesOf = (type: HomebrewType): EntryRec[] =>
    Object.values((ownContent?.[type] ?? {}) as unknown as Record<string, EntryRec>)
      .filter((e) => e.homebrewSourceId === selectedId)
      .sort(byName);

  // The open campaign source's entries, from this device's last pulled copy (shown offline too).
  const campaignCopy = campaignRow ? loadCampaignHbCache()[campaignRow.campaignId] : undefined;
  const campaignEntriesOf = (type: HomebrewType): EntryRec[] =>
    Object.values((campaignCopy?.content?.[type] ?? {}) as unknown as Record<string, EntryRec>)
      .filter((e) => e.homebrewSourceId === campaignRow?.id)
      .sort(byName);
  // The player's own entry with the same id wins over the GM's copy (data/index.ts mergeWithSeed) —
  // unless it is a KEPT entry never edited since, which sits under the live copy.
  const ownVersionUsed = (type: HomebrewType, id: string) => {
    const own = ownContent?.[type][id] as unknown as EntryRec | undefined;
    return !!own && !sources[own.homebrewSourceId ?? '']?.kept?.ids.includes(`${type}:${id}`);
  };
  const updated = campaignCopy?.updatedAt ? new Date(campaignCopy.updatedAt) : null;

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
          {drilledIn
            ? isMpRules
              ? 'Monster Parts Rules'
              : isMythicRules
                ? 'Mythic Rules'
                : isKingmakerRules
                  ? 'Kingmaker Rules'
                  : (campaignRow ?? selected)?.name || 'Homebrew'
            : 'Homebrew'}
        </div>
        <PageMenu
          items={[
            ...(onOpenRoster ? [{ label: 'Characters', icon: 'ti-users', onClick: onOpenRoster }] : []),
            ...(onOpenCampaigns ? [{ label: 'Campaigns', icon: 'ti-flag', onClick: onOpenCampaigns }] : []),
          ]}
          onOpenSettings={onOpenSettings}
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
          <button className="hb-source-row hb-special" onClick={() => open(MP_RULES_ID)}>
            <i className="ti ti-bone" aria-hidden="true" />
            <span className="hb-row-name">Monster Parts Rules</span>
            <i className="ti ti-chevron-right hb-row-chev" aria-hidden="true" />
          </button>
          <button className="hb-source-row hb-special" onClick={() => open(MYTHIC_RULES_ID)}>
            <i className="ti ti-flame" aria-hidden="true" />
            <span className="hb-row-name">Mythic Rules</span>
            <i className="ti ti-chevron-right hb-row-chev" aria-hidden="true" />
          </button>
          <button className="hb-source-row hb-special" onClick={() => open(KINGMAKER_RULES_ID)}>
            <i className="ti ti-crown" aria-hidden="true" />
            <span className="hb-row-name">Kingmaker Rules</span>
            <i className="ti ti-chevron-right hb-row-chev" aria-hidden="true" />
          </button>
          {sourceList.map((src) => (
            <button key={src.id} className="hb-source-row" onClick={() => open(src.id)}>
              <i className="ti ti-folder" aria-hidden="true" />
              <span className="hb-row-name">
                {src.name}
                {src.kept && <small className="hb-row-sub">Kept from {src.kept.from}</small>}
              </span>
              <i className="ti ti-chevron-right hb-row-chev" aria-hidden="true" />
            </button>
          ))}
          {campaignSources.length > 0 && <div className="hb-group-head">From campaigns</div>}
          {campaignSources.map((cs) => (
            <button key={cs.id} className="hb-source-row" onClick={() => openCampaign(cs)}>
              <i className="ti ti-lock" aria-hidden="true" />
              <span className="hb-row-name">
                {cs.name}
                <small className="hb-row-sub">{cs.campaignName}</small>
              </span>
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
            <button className={'settings-navitem hb-special' + (isMpRules ? ' active' : '')} onClick={() => open(MP_RULES_ID)}>
              <i className="ti ti-bone" aria-hidden="true" /> Monster Parts Rules
            </button>
            <button className={'settings-navitem hb-special' + (isMythicRules ? ' active' : '')} onClick={() => open(MYTHIC_RULES_ID)}>
              <i className="ti ti-flame" aria-hidden="true" /> Mythic Rules
            </button>
            <button
              className={'settings-navitem hb-special' + (isKingmakerRules ? ' active' : '')}
              onClick={() => open(KINGMAKER_RULES_ID)}
            >
              <i className="ti ti-crown" aria-hidden="true" /> Kingmaker Rules
            </button>
            {sourceList.map((src) => (
              <button
                key={src.id}
                className={'settings-navitem' + (selectedId === src.id ? ' active' : '')}
                onClick={() => open(src.id)}
              >
                <i className="ti ti-folder" aria-hidden="true" />
                <span className="hb-nav-label">
                  {src.name}
                  {src.kept && <small className="hb-row-sub">Kept from {src.kept.from}</small>}
                </span>
              </button>
            ))}
            {campaignSources.length > 0 && <div className="hb-group-head">From campaigns</div>}
            {campaignSources.map((cs) => (
              <button
                key={cs.id}
                className={'settings-navitem' + (campaignRow?.id === cs.id ? ' active' : '')}
                onClick={() => openCampaign(cs)}
              >
                <i className="ti ti-lock" aria-hidden="true" />
                <span className="hb-nav-label">
                  {cs.name}
                  <small className="hb-row-sub">{cs.campaignName}</small>
                </span>
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
            ) : isMythicRules ? (
              <MythicRules content={content} embedded />
            ) : isKingmakerRules ? (
              <KingmakerRules content={content} embedded />
            ) : campaignRow ? (
              /* A GM's shared source: read-only, no Add / Delete / rename — only the GM edits the campaign copy. */
              <div className="settings-section">
                <h3 className="settings-h">{campaignRow.name}</h3>
                <p className="settings-desc">
                  Shared by your GM in “{campaignRow.campaignName}”. It updates when your GM changes it, and only
                  your GM can edit it.
                </p>
                {updated && !isNaN(updated.getTime()) && (
                  <p className="settings-desc settings-sub">
                    Updated {updated.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                )}
                <button className="btn-primary hb-export-copy" onClick={() => exportCampaign(campaignRow)}>
                  <i className="ti ti-copy" aria-hidden="true" /> Export to my homebrew
                </button>
                {TYPE_GROUPS.map((g) => {
                  const entries = campaignEntriesOf(g.type);
                  return entries.length === 0 ? null : (
                    <div className="hb-type" key={g.type}>
                      <div className="hb-type-head">
                        <span>
                          <i className={'ti ' + g.icon} aria-hidden="true" /> {g.label}
                        </span>
                      </div>
                      {entries.map((e) => (
                        <div className="hb-entry" key={e.id}>
                          <span className="hb-entry-text">
                            {e.name}
                            {ownVersionUsed(g.type, e.id) && <small className="hb-entry-own"> — your own version is used</small>}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : !selected ? (
              <div className="settings-section">
                <h3 className="settings-h">Homebrew</h3>
                <p className="settings-desc">
                  Create a <strong>source</strong> to hold your custom content. Everything you make in it — items,
                  feats, spells, ancestries, heritages, backgrounds, deities, and actions — appears throughout the app
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
                {selected.kept && <p className="settings-desc settings-sub">Kept from {selected.kept.from}</p>}
                {sharedWith(selected.id) && (
                  <p className="settings-desc settings-sub">
                    Shared with {sharedWith(selected.id)} — your edits reach its players automatically.
                  </p>
                )}

                {/* Items open the full item editor; every other type its schema-driven one. */}
                {TYPE_GROUPS.map((g) => (
                  <div className="hb-type" key={g.type}>
                    <div className="hb-type-head">
                      <span>
                        <i className={'ti ' + g.icon} aria-hidden="true" /> {g.label}
                      </span>
                      <button className="chip" onClick={() => setEditing({ type: g.type })}>
                        <i className="ti ti-plus" aria-hidden="true" /> Add
                      </button>
                    </div>
                    {entriesOf(g.type).map((e) => (
                      <div className="hb-entry" key={e.id}>
                        <button className="hb-entry-name" onClick={() => setEditing({ type: g.type, entry: e })}>
                          {e.name}
                        </button>
                        <button className="hb-entry-del" aria-label={`Delete ${e.name}`} onClick={() => deleteEntry(g.type, e)}>
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
