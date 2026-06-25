import { useRef, useState } from 'react';
import type { ContentDatabase } from '../rules/types';
import type { SavedChar } from '../data/storage';
import { applyPlayState } from '../rules/play';
import { deriveMaxHp } from '../rules/derive';
import { exportWg, exportNative, importCharacter, type ImportReport } from '../data/transfer';
import { WindowControls } from './WindowControls';
import { confirmDialog } from './confirm';
import { HeroesHeavenLogo } from './Logo';

type Filter = 'all' | 'active' | 'archived';

/** Trigger a browser download of a text file. */
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fileSlug(name: string): string {
  return (name || 'character').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
}

/** The character roster: search, filter, import/export, and per-character cards with actions. */
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
}: {
  roster: SavedChar[];
  activeId: string;
  content: ContentDatabase;
  onOpen: (id: string) => void;
  onNew: () => void;
  onImport: (saved: SavedChar) => void;
  onDuplicate: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string) => void;
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
    const anc = c.character.ancestryId ? content.ancestries[c.character.ancestryId]?.name : '';
    const cls = c.character.classId ? content.classes[c.character.classId]?.name : '';
    return [c.character.name, anc, cls].some((s) => (s ?? '').toLowerCase().includes(q));
  });

  const tabs: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: roster.length },
    { id: 'active', label: 'Active', n: activeCount },
    { id: 'archived', label: 'Archived', n: archivedCount },
  ];

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { saved, report } = importCharacter(String(reader.result), content);
        onImport(saved);
        setError(null);
        setResult(report);
      } catch (e) {
        setResult(null);
        setError((e as Error).message);
      }
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  };

  const doExport = (c: SavedChar, target: 'wg' | 'native') => {
    setExportFor(null);
    try {
      const text = target === 'wg' ? exportWg(c, content) : exportNative(c);
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
        <WindowControls />
      </header>

      <div className="roster-body">
        <div className="roster-hero">
          <div>
            <h1 className="roster-title">Characters</h1>
            <div className="roster-sub">
              {activeCount} active{archivedCount ? ` · ${archivedCount} archived` : ''}
            </div>
          </div>
          <div className="roster-hero-actions">
            <button className="add-item-btn ghost" onClick={() => fileRef.current?.click()}>
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
            const ch = applyPlayState(c.character, c.play, content);
            const anc = ch.ancestryId ? content.ancestries[ch.ancestryId]?.name : undefined;
            const cls = ch.classId ? content.classes[ch.classId]?.name : undefined;
            const hpMax = deriveMaxHp(ch, content);
            const initials = ch.name.slice(0, 2).toUpperCase();
            return (
              <div className={'rcard' + (c.id === activeId ? ' active' : '')} key={c.id}>
                <button className="rcard-open" onClick={() => onOpen(c.id)} title="Open character sheet">
                  <span className="rcard-portrait">
                    {ch.appearance?.portrait ? <img src={ch.appearance.portrait} alt="" /> : initials}
                  </span>
                  <div className="rcard-info">
                    <div className="rcard-name">
                      {ch.name}
                      {c.archived && <span className="rcard-arch">archived</span>}
                    </div>
                    <div className="rcard-meta">
                      {anc ?? '—'} · {cls ?? '—'} · level {ch.level}
                    </div>
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
                          <button role="menuitem" onClick={() => doExport(c, 'wg')}>
                            <i className="ti ti-external-link" aria-hidden="true" /> Yes — Wanderer&apos;s Guide
                          </button>
                          <button role="menuitem" onClick={() => doExport(c, 'native')}>
                            <i className="ti ti-device-floppy" aria-hidden="true" /> No — Codex file (lossless)
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
          {shown.length === 0 && (
            <div className="roster-empty">
              {q ? 'No characters match your search.' : filter === 'archived' ? 'No archived characters.' : 'No characters yet.'}
            </div>
          )}
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
