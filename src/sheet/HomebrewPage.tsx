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
  loadSyncOwner,
  loadTombstones,
  loadRevived,
  campaignHbCacheKnown,
  campaignMemberIds,
  type HomebrewContent,
  type HomebrewSource,
  type HomebrewType,
} from '../data/storage';
import {
  accountStateHere,
  campaignHomebrewStorageFull,
  exportCampaignSource,
  refreshCampaignHomebrew,
  sharedSourceCampaigns,
  type AccountHere,
} from '../data/campaignHomebrew';
import { hasSyncedOnce } from '../data/cloudSync';
import { BACKUP_APP, HOMEBREW_EXPORT_KIND, UnreadableBackupError, homebrewFilename, readHomebrewFile } from '../data/backup';
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

/** What an import did with one outcome (added, skipped as held, …): entries by type, sources apart. */
type Tally = { by: Partial<Record<HomebrewType, number>>; sources: number };
const tally = (): Tally => ({ by: {}, sources: 0 });
const bump = (t: Tally, type: HomebrewType) => {
  t.by[type] = (t.by[type] ?? 0) + 1;
};

/**
 * Merge an imported file into this device WITHOUT overwriting anything (the never-overwrite rule).
 *  - An id this device already holds is left exactly as it is, whether the file's copy is identical
 *    or older: the player's copy wins and is not re-stamped.
 *  - An id this device holds through a CAMPAIGN (a GM's shared homebrew, data/campaignHomebrew.ts) is
 *    not written either, nor is any entry filed under a campaign's source. An own copy under one of
 *    those ids would sit ON TOP of the GM's live copy for good (data/index.ts mergeWithSeed: own entries
 *    are layer 3), and a GM's own Homebrew export carries exactly those ids. The app never writes one
 *    anywhere else: exportCampaignSource gives its copies new ids, convertGone writes only ids the player
 *    doesn't hold.
 *  - An id this device DELETED (a tombstone newer than any re-create, synced from any device) stays
 *    deleted, and so does every entry filed under a source deleted that way — whether or not the file
 *    carries that source. saveHomebrewEntry stamps what it writes as re-created NOW, which beats the
 *    tombstone on every synced device — so writing one of these would bring a deletion back everywhere.
 *  - Only ids this device has never held are written, through the ordinary writers. Those writers
 *    swallow a full storage, so what counts as added is only what is on disk afterwards (as
 *    convertGone counts), and an entry of a source that did not land is not written at all.
 *  - Every KEPT list (a source kept from a campaign, data/campaignHomebrew.ts) is written LAST, as
 *    convertGone writes its kept source last: saveHomebrewEntry reads a write into a kept source as the
 *    player editing that entry and strips it off the list, so a kept source the file carries goes on
 *    disk without its list first (so the entries can be gated on it landing), and the list after the
 *    entries — and a kept source this device already holds ends the import with the list it began with.
 *  - Every record the file holds is counted somewhere — sources the same way as entries — so the notice
 *    never says a file "holds no homebrew" when it held something this device already has, deleted or
 *    gets from a campaign, or something that couldn't be read.
 */
function mergeHomebrewImport(sources: Record<string, HomebrewSource>, incoming: Partial<HomebrewContent>) {
  const tombs = loadTombstones();
  const revived = loadRevived();
  // The cloud merge's own test (data/cloudMerge.ts dropTombstoned): a tombstone at or after the last
  // re-create wins.
  const deletedHere = (key: string) => tombs[key] !== undefined && tombs[key] >= (revived[key] ?? 0);
  const haveSources = loadHomebrewSources();
  const haveContent = loadHomebrewContent();
  const camps = Object.values(loadCampaignHbCache());
  const campaignSources = new Set(camps.flatMap((c) => Object.keys(c.sources ?? {})));
  const campaignHolds = (type: HomebrewType, id: string) => camps.some((c) => !!c.content?.[type]?.[id]);
  // `unread`: a record that isn't one (no id) or is of a type this build doesn't know.
  const out = { added: tally(), have: tally(), shared: tally(), deleted: tally(), failed: 0, unread: 0 };

  // The kept list each source must hold when the import ends: its own for one this device already
  // holds; the file's for one the import writes — less any key naming an entry this device already
  // holds filed under that source, which is the player's and is never pushed under a GM's live copy.
  const keptWant = new Map<string, NonNullable<HomebrewSource['kept']>>();
  for (const s of Object.values(haveSources)) {
    if (s?.kept && Array.isArray(s.kept.ids)) keptWant.set(s.id, { ...s.kept, ids: [...s.kept.ids] });
  }
  const wroteSources: { id: string; json: string }[] = [];
  for (const src of Object.values(sources)) {
    if (!src || typeof src !== 'object' || typeof src.id !== 'string') {
      out.unread++;
      continue;
    }
    // The same three skips as an entry's below, counted the same way.
    if (haveSources[src.id]) {
      out.have.sources++;
      continue;
    }
    if (campaignSources.has(src.id)) {
      out.shared.sources++;
      continue;
    }
    if (deletedHere(`hbsrc:${src.id}`)) {
      out.deleted.sources++;
      continue;
    }
    let write: HomebrewSource = src;
    if (src.kept !== undefined) {
      const { kept, ...bare } = src;
      write = bare;
      // A kept list that isn't one (a hand-made file) is left off: saveHomebrewEntry and the sources
      // list both read it as { from: string, ids: string[] }.
      const ok = !!kept && typeof kept === 'object' && typeof kept.from === 'string' && Array.isArray(kept.ids) && kept.ids.every((k) => typeof k === 'string');
      if (ok) {
        const ids = kept.ids.filter((key) => {
          const at = key.indexOf(':');
          const type = key.slice(0, at) as HomebrewType;
          if (at < 1 || !HOMEBREW_TYPES.includes(type)) return true;
          const held = haveContent[type][key.slice(at + 1)] as { homebrewSourceId?: unknown } | undefined;
          return held?.homebrewSourceId !== src.id;
        });
        keptWant.set(src.id, { ...kept, ids });
      }
    }
    saveHomebrewSource(write);
    // Held from here on, as an entry's write is below: a hand-made file carrying this id under a second
    // key is skipped as held — written over this copy, the on-disk check would count this copy as one
    // the storage refused.
    haveSources[src.id] = write;
    wroteSources.push({ id: src.id, json: JSON.stringify(write) });
  }
  const sourcesNow = loadHomebrewSources();
  const failedSources = new Set<string>();
  for (const w of wroteSources) {
    if (JSON.stringify(sourcesNow[w.id]) === w.json) {
      haveSources[w.id] = sourcesNow[w.id];
      out.added.sources++;
    } else {
      failedSources.add(w.id);
      keptWant.delete(w.id);
      out.failed++;
    }
  }

  // A bucket of a type this build doesn't know (a newer version's export) is held, not read. `incoming`
  // is the FILE's content, never the game database: test/archive-coverage.test.tsx lists every walk over
  // the database by its name, so the file's own content is never called `content` here.
  for (const [key, bucket] of Object.entries(incoming as Record<string, unknown>)) {
    if (!(HOMEBREW_TYPES as string[]).includes(key) && !!bucket && typeof bucket === 'object') out.unread += Object.keys(bucket).length;
  }
  const wrote: { type: HomebrewType; id: string; json: string }[] = [];
  for (const type of HOMEBREW_TYPES) {
    const bucket = incoming[type];
    if (!bucket || typeof bucket !== 'object') continue;
    for (const raw of Object.values(bucket) as unknown[]) {
      const entry = raw as { id?: unknown; homebrewSourceId?: unknown } | null;
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') {
        out.unread++;
        continue;
      }
      const id = entry.id;
      const sid = typeof entry.homebrewSourceId === 'string' ? entry.homebrewSourceId : undefined;
      if (haveContent[type][id]) {
        bump(out.have, type);
        continue;
      }
      if (campaignHolds(type, id) || (sid !== undefined && campaignSources.has(sid) && !haveSources[sid])) {
        bump(out.shared, type);
        continue;
      }
      if (deletedHere(`hb:${type}:${id}`) || (sid !== undefined && deletedHere(`hbsrc:${sid}`))) {
        bump(out.deleted, type);
        continue;
      }
      if (sid !== undefined && failedSources.has(sid)) {
        out.failed++;
        continue;
      }
      // Sanitize HTML fields at rest so a poisoned imported/shared file never persists an active
      // payload (the editor + display both sanitize on use too, but clean-at-rest is defense in depth).
      const clean = sanitizeEntryHtml(entry) as unknown as HomebrewContent[typeof type][string];
      saveHomebrewEntry(type, clean);
      (haveContent[type] as Record<string, unknown>)[id] = clean;
      wrote.push({ type, id, json: JSON.stringify(clean) });
    }
  }
  const contentNow = loadHomebrewContent();
  for (const w of wrote) {
    if (JSON.stringify(contentNow[w.type][w.id]) === w.json) bump(out.added, w.type);
    else out.failed++;
  }

  // The kept lists LAST (see above). Only a list that is not on disk as wanted is written, so a
  // file that touched no kept source writes nothing here.
  const sourcesAfter = loadHomebrewSources();
  for (const [id, kept] of keptWant) {
    const now = sourcesAfter[id];
    if (!now || JSON.stringify(now.kept ?? null) === JSON.stringify(kept)) continue;
    const want = { ...now, kept };
    saveHomebrewSource(want);
    if (JSON.stringify(loadHomebrewSources()[id]) !== JSON.stringify(want)) out.failed++;
  }
  return out;
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** What one entry of each type is counted as in the import notice: "1 feat", "2 ancestries". */
const NOUN: Record<HomebrewType, [one: string, many: string]> = {
  items: ['item', 'items'],
  feats: ['feat', 'feats'],
  spells: ['spell', 'spells'],
  ancestries: ['ancestry', 'ancestries'],
  heritages: ['heritage', 'heritages'],
  backgrounds: ['background', 'backgrounds'],
  actions: ['action', 'actions'],
  deities: ['deity', 'deities'],
};

/** "1 feat" / "2 spells" when every entry is one type, "3 entries" when they are mixed — then the
 *  sources: "2 feats and 1 source", "1 source". '' when the tally is empty. */
function counted(t: Tally): string {
  const types = HOMEBREW_TYPES.filter((type) => (t.by[type] ?? 0) > 0);
  const n = types.reduce((sum, type) => sum + (t.by[type] ?? 0), 0);
  const entries = !n ? '' : types.length === 1 ? plural(n, ...NOUN[types[0]]) : plural(n, 'entry', 'entries');
  return [entries, t.sources ? plural(t.sources, 'source') : ''].filter(Boolean).join(' and ');
}

/**
 * UNKNOWN ≠ EMPTY: may an import judge this device's homebrew yet? Two things it reads can be unknown.
 *  - The account's synced data. Signed in (data/campaignHomebrew.ts accountStateHere: an auth client
 *    that can't answer counts as signed in), until this session's first cloud pull lands this device
 *    holds its UNSYNCED copy: a fresh device's empty membership list, which reads as "no campaigns", and
 *    an own store missing every deletion and later edit made on another device — which
 *    mergeHomebrewImport would judge against, and saveHomebrewEntry would stamp as re-created NOW, so
 *    they would win everywhere at the next sync. App's portrait clean-up waits for the same pull
 *    (hasSyncedOnce); signed out, or with no cloud at all, this device's data is the whole truth.
 *  - The campaign homebrew. mergeHomebrewImport's never-write-over-a-campaign check reads the campaign
 *    cache, which reads {} both for "pulled for this account, and nothing is shared" and for "never
 *    pulled here / pulled for another account", and holds nothing yet of a campaign joined since the last
 *    pull; only storage.ts campaignHbCacheKnown tells them apart (this page never reads the cache's format
 *    itself). A player-role membership (campaignMemberIds: the ones a pull reads for — not the signed-out
 *    local table, and with an id) with no full read known for this account means the import cannot tell
 *    a GM's id from a new one; with none, there is nothing to tell apart.
 */
function campaignHomebrewUnknown(account: AccountHere): boolean {
  if (account === 'signed-in' && !hasSyncedOnce()) return true;
  const player = campaignMemberIds('player').length > 0;
  return player && !campaignHbCacheKnown(loadSyncOwner());
}

/** Why an import that is still UNKNOWN after its pull can't run, in the player's terms. The owner
 *  ruling's text (2026-10-01) is the general answer; two causes it doesn't fit get their own remedy —
 *  signed out no pull can run at all, and a full storage is not a connection or a GM problem.
 *  RULED by the orchestrator (2026-10-01, settle round 5), not open questions:
 *   - the three wordings stay as they are: signed out "… Sign in, then try again."; the full storage's
 *     "… its storage is full. Free up some space, then try again."; the general text for everything else;
 *   - the pre-sync gate (campaignHomebrewUnknown) stays for EVERY signed-in import, an account with no
 *     campaign included — UNKNOWN ≠ EMPTY; signed out, an import proceeds against this device's own data. */
function cantImportYet(account: AccountHere): string {
  if (account === 'signed-out') return "Your campaign homebrew couldn't be read on this device yet. Sign in, then try again.";
  if (campaignHomebrewStorageFull())
    return "Your campaign homebrew couldn't be saved on this device — its storage is full. Free up some space, then try again.";
  return "Your campaign homebrew couldn't be read on this device yet. Try again when you're online. If it keeps failing, ask your GM to check the campaign setup.";
}

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
    try {
      // app + kind are what readHomebrewFile recognises an export by.
      const payload = { app: BACKUP_APP, kind: HOMEBREW_EXPORT_KIND, version: 1, sources: loadHomebrewSources(), content: loadHomebrewContent() };
      downloadText({ filename: homebrewFilename(), text: JSON.stringify(payload, null, 2) });
    } catch (e) {
      void chooseDialog({ title: 'Export failed', message: (e as Error).message, buttons: [{ value: 'ok', label: 'OK', primary: true }] });
    }
  };
  // One import at a time: `importRun` from the moment a file is picked until its notice closes (a pick
  // that arrives meanwhile is dropped); `readingCampaigns` while it waits on the campaign homebrew read
  // below, which can take a while — the Import chips show it and take no new pick.
  const importRun = useRef(false);
  const [readingCampaigns, setReadingCampaigns] = useState(false);
  // Closing the page cancels an import still waiting: nothing is written, and no notice opens over
  // whatever screen the player went to.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const importHomebrew = () => {
    if (!importRun.current) fileRef.current?.click();
  };
  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-importing the same file
    if (!file || importRun.current) return;
    importRun.current = true;
    try {
      await runImport(file);
    } finally {
      importRun.current = false;
      if (mounted.current) setReadingCampaigns(false);
    }
  };
  const runImport = async (file: File) => {
    // Notices, not questions — by the time one shows, the import already happened (or never could).
    const notice = (title: string, message: string, label = 'Done') =>
      chooseDialog({ title, message, buttons: [{ value: 'ok', label, primary: true }] });
    let read: ReturnType<typeof readHomebrewFile>;
    try {
      read = readHomebrewFile(await file.text());
    } catch (err) {
      // A backup this version can't read (a newer format, no data section) says why in its own words;
      // anything else simply isn't one of ours.
      const why = err instanceof UnreadableBackupError ? err.message : "That file isn't a Heroes Heaven homebrew export or backup.";
      await notice("Couldn't import", why, 'OK');
      return;
    }
    if (read.from === 'old-empty-export') {
      // Never point at Settings → Restore here: a restore REPLACES everything on the device.
      await notice(
        'Nothing to import',
        'This file was made by an older version of Heroes Heaven, whose homebrew export saved only the file’s name — it holds no homebrew. Your homebrew is still in the app; export it again for a file that holds it.',
        'OK',
      );
      return;
    }
    // UNKNOWN ≠ EMPTY: before writing anything, the import must know this account's synced data and
    // which ids a campaign shares here. Owner ruling (2026-10-01): try a pull NOW — the same bounded pull
    // the app's focus and online triggers run (it can't run before this session's first cloud pull, nor
    // signed out) — and refuse only if this device still doesn't know. Never import while unknown.
    const account = await accountStateHere();
    if (!mounted.current) return; // the page closed while the session was read: cancelled
    if (campaignHomebrewUnknown(account)) {
      setReadingCampaigns(true);
      try {
        await refreshCampaignHomebrew();
      } catch {
        /* a pull that failed leaves it unknown: refused just below */
      }
      if (!mounted.current) return; // the page closed while it waited: cancelled
      setReadingCampaigns(false);
      if (campaignHomebrewUnknown(account)) {
        await notice("Can't import yet", cantImportYet(account), 'OK');
        return;
      }
    }
    const r = mergeHomebrewImport(read.sources, read.content);
    const added = counted(r.added);
    if (added) onChanged();
    setSources(loadHomebrewSources());
    const what = [
      added ? `Added ${added}.` : '',
      counted(r.have) ? `Skipped ${counted(r.have)} you already have — yours are unchanged.` : '',
      counted(r.shared) ? `Skipped ${counted(r.shared)} a campaign already shares with you.` : '',
      counted(r.deleted) ? `Left out ${counted(r.deleted)} you deleted.` : '',
      r.unread ? `Left out ${r.unread} that couldn't be read.` : '',
      r.failed ? `${r.failed} couldn't be saved — this device's storage is full.` : '',
    ].filter(Boolean);
    const parts = [
      // Only when the file held no record at all: every source and entry in it is counted above.
      what.length ? '' : 'That file holds no homebrew.',
      ...what,
      read.from === 'backup' ? 'Only the homebrew in this backup was read; nothing else on this device changed.' : '',
      Object.keys(r.added.by).length ? 'Enable their source per character under Setup → Sources.' : '',
    ].filter(Boolean);
    const title = r.failed ? 'Import incomplete' : added ? 'Homebrew imported' : 'Nothing new to import';
    await notice(title, parts.join(' '));
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

  /** The Import chip (phone list and desktop sidebar), and what it shows while an import waits on the
   *  campaign homebrew read. */
  const importChip = (label: string) => (
    <>
      <button className="chip" onClick={importHomebrew} disabled={readingCampaigns} aria-busy={readingCampaigns || undefined}>
        {readingCampaigns ? (
          <>
            <i className="ti ti-loader-2 spin" aria-hidden="true" /> Importing…
          </>
        ) : (
          <>
            <i className="ti ti-upload" aria-hidden="true" /> {label}
          </>
        )}
      </button>
      {readingCampaigns && (
        <p className="settings-desc settings-sub hb-import-wait" role="status" style={{ flexBasis: '100%', margin: 0 }}>
          Reading your campaign homebrew before importing…
        </p>
      )}
    </>
  );

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
            {importChip('Import homebrew')}
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
              {importChip('Import')}
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
