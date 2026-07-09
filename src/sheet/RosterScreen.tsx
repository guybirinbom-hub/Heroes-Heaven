import { useRef, useState } from 'react';
import type { ContentDatabase, Item, ModeDef } from '../rules/types';
import type { SavedChar } from '../data/storage';
import { applyPlayState } from '../rules/play';
import { deriveMaxHp } from '../rules/derive';
import { exportWg, exportNative, importCharacter, type ImportReport } from '../data/transfer';
import { PageMenu } from './PageMenu';
import { WindowControls } from './WindowControls';
import { sanitizeImportedPortrait } from './imageUtil';
import { usePortrait } from './usePortrait';
import { confirmDialog, chooseDialog } from './confirm';
import { HeroesHeavenLogo } from './Logo';
import { downloadText } from './download';

type Filter = 'all' | 'active' | 'archived';

/** A roster card's portrait — shows the on-device sharp copy when present, else the compressed one,
 *  else the initials. Its own component so it can use the portrait hook inside the roster's map(). */
function RosterCardPortrait({ portrait, portraitRef, initials }: { portrait?: string; portraitRef?: string; initials: string }) {
  const shown = usePortrait(portraitRef, portrait);
  return portrait ? <img src={shown} alt="" /> : <>{initials}</>;
}

function fileSlug(name: string): string {
  return (name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
}

/** Shrink any embedded data-URL portraits an imported file carries (a WG export stores the image
 *  verbatim — multi-MB base64 that would be deep-copied into every undo step). Same downscale as
 *  an in-app upload; a huge portrait that can't be re-encoded is dropped rather than stored raw. */
async function sanitizePortraits(saved: SavedChar): Promise<SavedChar> {
  const out = { ...saved };
  const buildPortrait = saved.character.appearance?.portrait;
  const cleanBuild = await sanitizeImportedPortrait(buildPortrait);
  if (cleanBuild !== buildPortrait) {
    out.character = { ...out.character, appearance: { ...out.character.appearance, portrait: cleanBuild } };
  }
  const playPortrait = saved.play?.appearance?.portrait;
  if (saved.play?.appearance) {
    const cleanPlay = await sanitizeImportedPortrait(playPortrait);
    if (cleanPlay !== playPortrait) {
      out.play = { ...saved.play, appearance: { ...saved.play.appearance, portrait: cleanPlay } };
    }
  }
  return out;
}

/** The character roster: search, filter, import/export, and per-character cards with actions.
 *  Renders straight from localStorage — `content` is null while core.json is still loading, in
 *  which case content-derived card details (HP, ancestry/class names) show placeholders. */
export function RosterScreen({
  roster,
  activeId,
  content,
  onOpen,
  onNew,
  onImport,
  onDuplicate,
  onArchive,
  onDelete,
  onOpenHomebrew,
  onOpenCampaigns,
  onOpenSettings,
  onSaveMode,
  onDeleteMode,
}: {
  roster: SavedChar[];
  activeId: string;
  content: ContentDatabase | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onImport: (saved: SavedChar, customItems?: Item[], customModes?: ModeDef[]) => void | Promise<boolean>;
  onDuplicate: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string) => void;
  onOpenHomebrew?: () => void;
  /** Provided ONLY when signed in — absent hides the Campaigns menu item. */
  onOpenCampaigns?: () => void;
  onOpenSettings?: () => void;
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('active');
  const [query, setQuery] = useState('');
  const [exportFor, setExportFor] = useState<string | null>(null);
  const [result, setResult] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const activeCount = roster.filter((c) => !c.archived).length;
  const archivedCount = roster.filter((c) => c.archived).length;
  const q = query.trim().toLowerCase();

  const shown = roster.filter((c) => {
    if (filter === 'active' && c.archived) return false;
    if (filter === 'archived' && !c.archived) return false;
    if (!q) return true;
    const anc = content && c.character.ancestryId ? content.ancestries[c.character.ancestryId]?.name : '';
    const cls = content && c.character.classId ? content.classes[c.character.classId]?.name : '';
    return [c.character.name, anc, cls].some((s) => (s ?? '').toLowerCase().includes(q));
  });

  const tabs: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: roster.length },
    { id: 'active', label: 'Active', n: activeCount },
    { id: 'archived', label: 'Archived', n: archivedCount },
  ];

  const handleFile = (file: File | undefined) => {
    if (!file || !content) return; // import needs the content database to resolve entries

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const { saved, report, customItems, customModes } = importCharacter(String(reader.result), content);
        setError(null);
        // onImport may prompt on a name collision; it returns false if the user cancelled. Only show
        // the success report when the import was actually applied.
        const applied = await onImport(await sanitizePortraits(saved), customItems, customModes);
        if (applied !== false) setResult(report);
      } catch (e) {
        setResult(null);
        setError((e as Error).message);
      }
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  };

  const doExport = (c: SavedChar, target: 'wg' | 'native') => {
    if (target === 'wg' && !content) return; // WG export resolves against the content database
    setExportFor(null);
    try {
      const text = target === 'wg' && content ? exportWg(c, content) : exportNative(c);
      downloadText(`${fileSlug(c.character.name)}${target === 'wg' ? '.wg' : '.codex'}.json`, text);
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="roster-screen">
      <header className="chrome" data-tauri-drag-region>
        <div className="chrome-brand" data-tauri-drag-region>
          <HeroesHeavenLogo className="chrome-logo" /> Heroes Heaven
        </div>
        <PageMenu
          items={[
            ...(onOpenHomebrew ? [{ label: 'Homebrew', icon: 'ti-flask', onClick: onOpenHomebrew }] : []),
            ...(onOpenCampaigns ? [{ label: 'Campaigns', icon: 'ti-flag', onClick: onOpenCampaigns }] : []),
          ]}
          onOpenSettings={onOpenSettings}
          modes={content?.modes}
          characters={roster.map((c) => ({ id: c.id, name: c.character.name }))}
          onSaveMode={onSaveMode}
          onDeleteMode={onDeleteMode}
        />
        <WindowControls />
      </header>

      <div className="roster-body">
        <div className="roster-hero">
          <div>
            <h1 className="roster-title">Characters</h1>
            <div className="roster-sub">
              {activeCount} active{archivedCount ? ` · ${archivedCount} archived` : ''}
              {!content && <span className="roster-loading"> · loading game data…</span>}
            </div>
          </div>
          <div className="roster-hero-actions">
            <button
              className="add-item-btn ghost"
              disabled={!content}
              title={content ? undefined : 'Available once game data finishes loading'}
              onClick={() => fileRef.current?.click()}
            >
              <i className="ti ti-upload" aria-hidden="true" /> Import
            </button>
            <button className="add-item-btn" onClick={onNew}>
              <i className="ti ti-user-plus" aria-hidden="true" /> New character
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                handleFile(e.currentTarget.files?.[0]);
                e.currentTarget.value = '';
              }}
            />
          </div>
        </div>

        <div className="roster-controls">
          <div className="roster-tabs">
            {tabs.map((t) => (
              <button key={t.id} className={'rtab' + (filter === t.id ? ' on' : '')} onClick={() => setFilter(t.id)}>
                {t.label} <span className="rtab-n">{t.n}</span>
              </button>
            ))}
          </div>
          <div className="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input placeholder="Search characters" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>

        <div className="roster-grid">
          {shown.map((c) => {
            // Before the content database arrives, render from the saved character alone —
            // the derived stats (current/max HP) need content, so that row shows a placeholder.
            const ch = content ? applyPlayState(c.character, c.play, content) : c.character;
            const anc = content && ch.ancestryId ? content.ancestries[ch.ancestryId]?.name : undefined;
            const cls = content && ch.classId ? content.classes[ch.classId]?.name : undefined;
            const hpMax = content ? deriveMaxHp(ch, content) : null;
            const initials = ch.name.slice(0, 2).toUpperCase();
            return (
              <div className={'rcard' + (c.id === activeId ? ' active' : '')} key={c.id}>
                <button className="rcard-open" onClick={() => onOpen(c.id)} title="Open character sheet">
                  <span className="rcard-portrait">
                    <RosterCardPortrait portrait={ch.appearance?.portrait} portraitRef={ch.appearance?.portraitRef} initials={initials} />
                  </span>
                  <div className="rcard-info">
                    <div className="rcard-name">
                      {ch.name}
                      {c.archived && <span className="rcard-arch">archived</span>}
                    </div>
                    <div className="rcard-meta">
                      {content ? `${anc ?? '—'} · ${cls ?? '—'} · ` : ''}level {ch.level}
                    </div>
                    {hpMax !== null ? (
                      <div className="rcard-stats">
                        <span className="rcard-hp">
                          <i className="ti ti-heart" aria-hidden="true" /> {ch.hitPoints.current} / {hpMax}
                        </span>
                        <span className="rcard-hero">
                          {Array.from({ length: 3 }, (_, i) => (
                            <span key={i} className={'pip' + (i < ch.heroPoints ? ' on' : '')} />
                          ))}
                        </span>
                      </div>
                    ) : (
                      <div className="rcard-stats rcard-stats-loading">loading…</div>
                    )}
                  </div>
                </button>
                <div className="rcard-actions">
                  <div className="rcard-export">
                    <button title="Export" onClick={() => setExportFor(exportFor === c.id ? null : c.id)}>
                      <i className="ti ti-upload" aria-hidden="true" />
                    </button>
                    {exportFor === c.id && (
                      <>
                        <div className="rcard-export-back" onClick={() => setExportFor(null)} />
                        <div className="rcard-export-menu" role="menu">
                          <div className="rxm-q">Export to Wanderer&apos;s Guide?</div>
                          <button role="menuitem" disabled={!content} onClick={() => doExport(c, 'wg')}>
                            <i className="ti ti-external-link" aria-hidden="true" /> Yes — Wanderer&apos;s Guide
                          </button>
                          <button role="menuitem" onClick={() => doExport(c, 'native')}>
                            <i className="ti ti-device-floppy" aria-hidden="true" /> No — Heroes Heaven file (lossless .codex)
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <button title="Duplicate" onClick={() => onDuplicate(c.id)}>
                    <i className="ti ti-copy" aria-hidden="true" />
                  </button>
                  <button title={c.archived ? 'Unarchive' : 'Archive'} onClick={() => onArchive(c.id, !c.archived)}>
                    <i className={'ti ' + (c.archived ? 'ti-archive-off' : 'ti-archive')} aria-hidden="true" />
                  </button>
                  <button
                    title="Delete"
                    className="danger"
                    onClick={async () => {
                      // Only ARCHIVED characters can be deleted — a guard against fat-fingering away
                      // an in-use character. A non-archived character offers to archive first (not delete).
                      if (!c.archived) {
                        const choice = await chooseDialog({
                          title: `Archive ${ch.name} first`,
                          message: `Only archived characters can be deleted. Archive “${ch.name}” first, then delete it.`,
                          buttons: [
                            { value: 'archive', label: 'Archive now', primary: true },
                            { value: 'cancel', label: 'Cancel' },
                          ],
                        });
                        if (choice === 'archive') onArchive(c.id, true);
                        return;
                      }
                      if (
                        await confirmDialog({
                          title: `Delete ${ch.name}?`,
                          message: "This can't be undone.",
                          confirmLabel: 'Delete',
                          danger: true,
                        })
                      )
                        onDelete(c.id);
                    }}
                  >
                    <i className="ti ti-trash" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
          {shown.length === 0 &&
            (roster.length === 0 ? (
              // A genuinely empty roster (fresh install / deleted the last character): a friendly
              // welcome with a clear call to action, not a terse one-liner.
              <div className="roster-empty roster-empty-welcome">
                <HeroesHeavenLogo className="roster-empty-logo" />
                <div className="roster-empty-title">No characters yet</div>
                <div className="roster-empty-sub">Create your first character to get started, or import one you already have.</div>
                <div className="roster-empty-cta">
                  <button className="add-item-btn" onClick={onNew}>
                    <i className="ti ti-user-plus" aria-hidden="true" /> Create your first character
                  </button>
                  <button className="btn" onClick={() => fileRef.current?.click()}>
                    <i className="ti ti-upload" aria-hidden="true" /> Import
                  </button>
                </div>
              </div>
            ) : (
              <div className="roster-empty">
                {q ? 'No characters match your search.' : filter === 'archived' ? 'No archived characters.' : 'No characters yet.'}
              </div>
            ))}
        </div>
      </div>

      {error && (
        <div className="picker-overlay" onClick={() => setError(null)}>
          <div className="picker confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>
                <i className="ti ti-alert-triangle" aria-hidden="true" /> Import failed
              </span>
              <button className="picker-close" onClick={() => setError(null)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div className="confirm-body">
              <p>{error}</p>
            </div>
            <div className="confirm-actions">
              <button className="btn-primary" onClick={() => setError(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="picker-overlay" onClick={() => setResult(null)}>
          <div className="picker confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>
                <i className="ti ti-check" aria-hidden="true" /> Imported from {result.source}
              </span>
              <button className="picker-close" onClick={() => setResult(null)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div className="confirm-body import-report">
              {result.resolved.length > 0 && (
                <>
                  <div className="ir-label">Brought across</div>
                  <ul className="ir-good">
                    {result.resolved.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
              {result.warnings.length > 0 && (
                <>
                  <div className="ir-label">{result.lossless ? 'Notes' : 'Limitations & dropped content'}</div>
                  <ul className="ir-warn">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="confirm-actions">
              <button className="btn-primary" onClick={() => setResult(null)}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
