import { useEffect, useRef, useState } from 'react';
import { themeList } from '../theme/themes';
import { styleList } from '../theme/styles';
import { fontList } from '../theme/fonts';
import { getAppearance, setAccent, setFont, setStyle, setTheme } from '../theme/theme-manager';
import { bumpZoom, getZoom, resetZoom, subscribeZoom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from '../theme/zoom';
import { loadRoster, wipeAllData } from '../data/storage';
import { backupCharCount, backupFilename, createBackup, parseBackup, restoreBackup } from '../data/backup';
import { downloadText } from './download';
import { chooseDialog, confirmDialog } from './confirm';
import { isDesktopApp, isMobilePlatform } from '../platform';
import { setPref, usePrefs } from '../data/prefs';
import type { ModeDef } from '../rules/types';
import { CATALOG_MODES, CATALOG_MODE_MAP } from '../rules/modes';
import { ModeEditor, summarizeMod } from './ModesPanel';
import { useIsMobile } from './useIsMobile';
import { useBackHandler } from './useEscapeClose';

const ACCENTS = [
  '#6366f1', '#818cf8', '#0ea5e9', '#22d3ee', '#14b8a6', '#10b981', '#84cc16', '#c9a227',
  '#f59e0b', '#f97316', '#ef4444', '#f43f5e', '#ec4899', '#a855f7',
];

type SectionId = 'appearance' | 'customization' | 'modes' | 'backup' | 'about' | 'uninstall';
const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'ti-palette' },
  { id: 'customization', label: 'Customization', icon: 'ti-adjustments' },
  { id: 'modes', label: 'Modes', icon: 'ti-toggle-left' },
  { id: 'backup', label: 'Backup', icon: 'ti-database-export' },
  { id: 'about', label: 'About', icon: 'ti-info-circle' },
  { id: 'uninstall', label: 'Uninstall', icon: 'ti-trash' },
];

/** Per-device tweaks to how the sheet behaves. */
function CustomizationSection() {
  const prefs = usePrefs();
  const isMobile = useIsMobile();
  return (
    <div className="settings-section">
      <h3 className="settings-h">Customization</h3>
      <p className="settings-desc">Tweak how parts of the character sheet behave. Saved on this device.</p>

      {!isMobile && (
        <>
          <div className="menu-label">Hit points</div>
          <div className="menu-row">
            <button
              className={'chip' + (prefs.hpCommandEntry ? ' active' : '')}
              onClick={() => setPref('hpCommandEntry', !prefs.hpCommandEntry)}
            >
              Quick HP entry — {prefs.hpCommandEntry ? 'on' : 'off'}
            </button>
          </div>
          <p className="settings-desc">
            When on, the Damage and Heal buttons and the temporary-HP box are replaced by a single field: type a number
            for <strong>damage</strong>, <strong>-N</strong> to <strong>heal</strong>, <strong>tN</strong> for{' '}
            <strong>temporary HP</strong>, then Enter. You can still set current HP directly by typing into the HP value.
          </p>
        </>
      )}

      <div className="menu-label">Actions list</div>
      <div className="menu-row">
        <button
          className={'chip' + (prefs.compactActions ? ' active' : '')}
          onClick={() => setPref('compactActions', !prefs.compactActions)}
        >
          Compact actions — {prefs.compactActions ? 'on' : 'off'}
        </button>
      </div>
      <p className="settings-desc">
        When on, the Actions tab shows each action as a compact chip — just its name and action cost — so many fit on
        a row. Click a chip to open a popup with its full description, where you can also favorite it.
      </p>

      {isMobile && (
        <>
          <div className="menu-label">Spells</div>
          <div className="menu-row">
            <button
              className={'chip' + (prefs.showSlotBadges ? ' active' : '')}
              onClick={() => setPref('showSlotBadges', !prefs.showSlotBadges)}
            >
              Slot count on rank tabs — {prefs.showSlotBadges ? 'on' : 'off'}
            </button>
          </div>
          <p className="settings-desc">
            Shows a small <strong>available / total</strong> badge on each spell rank tab (and Focus), so you can see how
            many slots you have left without opening each rank.
          </p>
        </>
      )}

      {!isMobile && (
        <>
          <div className="menu-label">Popups</div>
          <div className="menu-row">
            <button
              className={'chip' + (prefs.popupSizeSync ? ' active' : '')}
              onClick={() => setPref('popupSizeSync', !prefs.popupSizeSync)}
            >
              Apply popup size to all — {prefs.popupSizeSync ? 'on' : 'off'}
            </button>
          </div>
          <p className="settings-desc">
            Popups can be resized by dragging the grip in their bottom-right corner. By default each popup resets to its
            normal size. When this is on, resizing any popup makes <strong>every</strong> popup open at that size until you
            change it again (saved on this device).
          </p>
        </>
      )}

      <div className="menu-label">Sources</div>
      <div className="menu-row">
        <button
          className={'chip' + (prefs.showNicheSources ? ' active' : '')}
          onClick={() => setPref('showNicheSources', !prefs.showNicheSources)}
        >
          Show niche sources — {prefs.showNicheSources ? 'on' : 'off'}
        </button>
      </div>
      <p className="settings-desc">
        Adds the niche <strong>Other</strong> shelf (Pathfinder Society scenarios, blog articles, and Free RPG Day
        specials) to the character builder's Sources list. Hidden by default to keep that list short.
      </p>

      {!isMobile && (
        <>
          <div className="menu-label">Scrollbars</div>
          <div className="menu-row">
            <button
              className={'chip' + (prefs.scrollbarAccent ? ' active' : '')}
              onClick={() => setPref('scrollbarAccent', !prefs.scrollbarAccent)}
            >
              Accent scrollbars — {prefs.scrollbarAccent ? 'on' : 'off'}
            </button>
          </div>
          <p className="settings-desc">
            Scrollbars are a thin neutral grey by default. Turn this on to tint them with your <strong>accent</strong> colour
            instead.
          </p>
        </>
      )}
    </div>
  );
}

/** Appearance controls — palette, style, accent — driving the theme system live. */
function AppearanceSection() {
  const [appearance, setLocal] = useState(getAppearance());
  const sync = () => setLocal(getAppearance());
  const [zoom, setZoomLocal] = useState(getZoom());
  useEffect(() => subscribeZoom(setZoomLocal), []);
  const isMobile = useIsMobile();

  return (
    <div className="settings-section">
      <h3 className="settings-h">Appearance</h3>
      <p className="settings-desc">
        Pick a colour palette, interface style, and accent. Changes apply instantly and are saved on this device.
      </p>

      <div className="menu-label">Palette</div>
      <div className="menu-row">
        {themeList.map((t) => (
          <button
            key={t.id}
            className={'chip' + (appearance.themeId === t.id ? ' active' : '')}
            onClick={() => {
              setTheme(t.id);
              sync();
            }}
          >
            <span className="chip-swatch" style={{ background: t.tokens['--app-accent'] }} />
            {t.name}
          </button>
        ))}
      </div>

      <div className="menu-label">Style</div>
      <div className="menu-row">
        {styleList.map((s) => (
          <button
            key={s.id}
            className={'chip' + (appearance.styleId === s.id ? ' active' : '')}
            onClick={() => {
              setStyle(s.id);
              sync();
            }}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="menu-label">Font</div>
      <div className="menu-row">
        {fontList.map((f) => (
          <button
            key={f.id}
            className={'chip' + (appearance.fontId === f.id ? ' active' : '')}
            style={{ fontFamily: f.stack }}
            onClick={() => {
              setFont(f.id);
              sync();
            }}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div className="menu-label">Accent</div>
      <div className="menu-row">
        <button
          className={'chip' + (appearance.accent === null ? ' active' : '')}
          onClick={() => {
            setAccent(null);
            sync();
          }}
        >
          Theme default
        </button>
        {ACCENTS.map((c) => (
          <button
            key={c}
            className={'accent-swatch' + (appearance.accent === c ? ' active' : '')}
            style={{ background: c }}
            aria-label={'accent ' + c}
            onClick={() => {
              setAccent(c);
              sync();
            }}
          />
        ))}
      </div>

      <div className="menu-label">Zoom</div>
      <div className="menu-row zoom-row">
        <button className="chip" aria-label="Zoom out" onClick={() => bumpZoom(isMobile ? -0.05 : -ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>
          <i className="ti ti-minus" aria-hidden="true" />
        </button>
        <span className="zoom-val">{Math.round(zoom * 100)}%</span>
        <button className="chip" aria-label="Zoom in" onClick={() => bumpZoom(isMobile ? 0.05 : ZOOM_STEP)} disabled={zoom >= (isMobile ? 1 : ZOOM_MAX)}>
          <i className="ti ti-plus" aria-hidden="true" />
        </button>
        <button className="chip" onClick={() => resetZoom()} disabled={zoom === 1}>
          Reset
        </button>
      </div>
      <p className="settings-desc">
        {isMobile ? 'Zoom out to fit more on screen.' : 'Also: hold Ctrl and scroll the wheel, or press Ctrl with + / − / 0.'}
      </p>
    </div>
  );
}

/** Whole-device backup: export everything the app has stored into one file, or restore such a
 *  file (replacing all characters, homebrew, and settings on this device, then reloading). */
function BackupSection() {
  const fileRef = useRef<HTMLInputElement>(null);
  const charCount = loadRoster().length;

  const showError = (message: string) =>
    void chooseDialog({ title: 'Import failed', message, buttons: [{ value: 'ok', label: 'OK', primary: true }] });

  const doExport = () => {
    try {
      downloadText(backupFilename(), createBackup());
    } catch (e) {
      showError(`Export failed: ${(e as Error).message}`);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const env = parseBackup(String(reader.result));
        const n = backupCharCount(env);
        const when = env.savedAt?.slice(0, 10) || 'an unknown date';
        const ok = await confirmDialog({
          title: 'Restore this backup?',
          message: (
            <>
              This replaces <strong>ALL</strong> characters, homebrew, and settings on this device with the backup from{' '}
              {when}
              {n !== null ? ` (${n} character${n === 1 ? '' : 's'})` : ''}. This can’t be undone.
            </>
          ),
          confirmLabel: 'Replace everything',
          danger: true,
        });
        if (!ok) return;
        restoreBackup(env);
        window.location.reload();
      } catch (e) {
        showError((e as Error).message);
      }
    };
    reader.onerror = () => showError('Could not read that file.');
    reader.readAsText(file);
  };

  return (
    <div className="settings-section">
      <h3 className="settings-h">Backup</h3>
      <p className="settings-desc">
        Everything lives on this device only. Export it all into a single file to keep a backup or move to another
        device, and import such a file to restore it.
      </p>

      <div className="menu-label">Export</div>
      <div className="menu-row">
        <button className="add-item-btn" onClick={doExport}>
          <i className="ti ti-file-export" aria-hidden="true" /> Export everything
        </button>
      </div>
      <p className="settings-desc">
        Downloads one file with your {charCount} saved character{charCount === 1 ? '' : 's'}, all homebrew, custom
        modes, and every setting.
      </p>

      <div className="menu-label">Import</div>
      <div className="menu-row">
        <button className="add-item-btn ghost" onClick={() => fileRef.current?.click()}>
          <i className="ti ti-file-import" aria-hidden="true" /> Import backup…
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
      <p className="settings-desc">
        Restores a backup file, <strong>replacing</strong> all characters, homebrew, and settings currently on this
        device. The app reloads afterwards.
      </p>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settings-section">
      <h3 className="settings-h">Heroes Heaven</h3>
      <p className="settings-desc">
        A local Pathfinder Second Edition character builder and play sheet. Your characters live on this device — nothing
        is uploaded anywhere.
      </p>
      <div className="menu-label">Game data</div>
      <p className="settings-desc">
        Rules content is imported from the community Foundry VTT Pathfinder 2e project, covering the published player
        options across the game&rsquo;s sourcebooks. Pathfinder and its rules are &copy; Paizo Inc.; this is an
        unofficial fan-made tool and is not affiliated with or endorsed by Paizo.
      </p>
    </div>
  );
}

/** Erase all local data, then (in the desktop build) launch the OS uninstaller. Returns a message
 *  to show if the program itself couldn't be removed automatically (data is wiped either way). */
async function runUninstall(): Promise<string | null> {
  wipeAllData();
  // The OS uninstaller is desktop-only (it launches the Windows uninstaller). On mobile/browser there's
  // no such command — wiping data is the action; the app itself is removed from the launcher/app store.
  if (isDesktopApp) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('uninstall_app'); // on success the app exits and the uninstaller takes over
      return null;
    } catch {
      // Older build without the command, a portable run, or no uninstaller found.
      return 'Your data has been erased. To remove the application itself, uninstall “Heroes Heaven” from Windows Settings → Apps.';
    }
  }
  if (isMobilePlatform) return 'Your data has been erased. To remove the app itself, uninstall Heroes Heaven from your device’s app manager.';
  window.location.reload();
  return null;
}

const CONFIRM_WORD = 'UNINSTALL';

/** Danger zone: permanently erase every saved character + setting, and (on desktop) uninstall the app. */
function UninstallSection() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const charCount = loadRoster().length;
  const ready = typed.trim().toUpperCase() === CONFIRM_WORD;

  const doUninstall = async () => {
    setBusy(true);
    const msg = await runUninstall();
    setBusy(false);
    if (msg) setStatus(msg);
  };

  return (
    <div className="settings-section">
      <h3 className="settings-h">Uninstall</h3>
      <p className="settings-desc">
        Remove Heroes Heaven and everything it has stored on this device. Everything lives locally — there is no
        cloud backup, so this cannot be undone.
      </p>
      <div className="danger-zone">
        <div className="menu-label">This permanently deletes</div>
        <ul className="danger-list">
          <li>
            {charCount} saved character{charCount === 1 ? '' : 's'} and all play state
          </li>
          <li>Every homebrew item and custom mode</li>
          <li>Your theme, zoom, and all other preferences</li>
          <li>{isMobilePlatform ? 'The app itself — remove it from your device’s app manager afterward' : 'On the desktop app: the program itself (launches the system uninstaller, then closes)'}</li>
        </ul>
        {status ? (
          <p className="settings-desc danger-note">{status}</p>
        ) : !confirming ? (
          <button className="btn-danger" onClick={() => setConfirming(true)}>
            <i className="ti ti-trash" aria-hidden="true" /> Uninstall Heroes Heaven…
          </button>
        ) : (
          <div className="danger-confirm">
            <label className="danger-confirm-label">
              Type <strong>{CONFIRM_WORD}</strong> to confirm:
            </label>
            <input
              className="name-input"
              value={typed}
              autoFocus
              placeholder={CONFIRM_WORD}
              spellCheck={false}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && ready && !busy) doUninstall();
              }}
            />
            <div className="danger-actions">
              <button
                className="btn-ghost"
                disabled={busy}
                onClick={() => {
                  setConfirming(false);
                  setTyped('');
                }}
              >
                Cancel
              </button>
              <button className="btn-danger" disabled={!ready || busy} onClick={doUninstall}>
                {busy ? 'Uninstalling…' : 'Permanently uninstall'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Manage every custom mode in one place — universal ones and the per-character ones created from
 *  inside a character's Modes panel — with create / edit / delete and a scope (which characters). */
function ModesSection({
  modes = {},
  characters = [],
  onSaveMode,
  onDeleteMode,
}: {
  modes?: Record<string, ModeDef>;
  characters?: { id: string; name: string }[];
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
}) {
  const [editing, setEditing] = useState<ModeDef | null>(null);
  const custom = Object.values(modes).filter((m) => !CATALOG_MODE_MAP[m.id]);
  const scopeOptions = [{ id: null as string | null, name: 'All characters' }, ...characters.map((c) => ({ id: c.id, name: c.name }))];

  if (editing) {
    return (
      <div className="settings-section">
        <h3 className="settings-h">{custom.some((m) => m.id === editing.id) ? 'Edit mode' : 'New mode'}</h3>
        <ModeEditor
          draft={editing}
          catalog={CATALOG_MODES}
          scopeOptions={scopeOptions}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() => {
            if (editing.name.trim()) onSaveMode?.({ ...editing, name: editing.name.trim() });
            setEditing(null);
          }}
          onDelete={
            custom.some((m) => m.id === editing.id)
              ? () => {
                  onDeleteMode?.(editing.id);
                  setEditing(null);
                }
              : undefined
          }
        />
      </div>
    );
  }

  const summary = (m: ModeDef) => (m.modifiers.length ? m.modifiers.map(summarizeMod).join(' · ') : m.note || 'no modifiers');
  const row = (m: ModeDef) => (
    <div className="set-mode-row" key={m.id}>
      <div className="set-mode-info">
        <div className="set-mode-name">{m.name}</div>
        <div className="set-mode-mods">{summary(m)}</div>
      </div>
      <button className="mode-edit" aria-label="Edit" onClick={() => setEditing(structuredClone(m))}>
        <i className="ti ti-edit" aria-hidden="true" />
      </button>
    </div>
  );

  const universal = custom.filter((m) => !m.charId);
  const perChar = characters.map((c) => ({ c, list: custom.filter((m) => m.charId === c.id) })).filter((g) => g.list.length);
  const orphan = custom.filter((m) => m.charId && !characters.some((c) => c.id === m.charId));

  return (
    <div className="settings-section">
      <div className="set-modes-head">
        <div>
          <h3 className="settings-h">Modes</h3>
          <p className="settings-desc" style={{ margin: 0 }}>
            Create and edit your custom modes. A mode can be available to <strong>all characters</strong> or scoped to a
            single one. Built-in class/ancestry modes aren't listed here.
          </p>
        </div>
        <button
          className="add-item-btn"
          onClick={() => setEditing({ id: `mode-${Date.now().toString(36)}`, name: '', modifiers: [{ value: 1, type: 'status', target: 'all-checks' }] })}
        >
          <i className="ti ti-plus" aria-hidden="true" /> New mode
        </button>
      </div>

      {custom.length === 0 ? (
        <div className="acts-empty">No custom modes yet. Create one with “New mode”.</div>
      ) : (
        <>
          <div className="set-modes-group-title">All characters</div>
          {universal.length ? <div className="set-modes-list">{universal.map(row)}</div> : <div className="acts-empty">None.</div>}
          {perChar.map((g) => (
            <div key={g.c.id}>
              <div className="set-modes-group-title">Only {g.c.name}</div>
              <div className="set-modes-list">{g.list.map(row)}</div>
            </div>
          ))}
          {orphan.length > 0 && (
            <>
              <div className="set-modes-group-title">Orphaned (character deleted)</div>
              <div className="set-modes-list">{orphan.map(row)}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Multi-section Settings page. Appearance is the first section; more can be added to SECTIONS. */
export function SettingsPage({
  onClose,
  modes,
  characters,
  onSaveMode,
  onDeleteMode,
}: {
  onClose: () => void;
  modes?: Record<string, ModeDef>;
  characters?: { id: string; name: string }[];
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
}) {
  const [section, setSection] = useState<SectionId>('appearance');
  const isMobile = useIsMobile();
  // Mobile: a full-screen page that opens to a Cards grid; null = show the cards, else drill into a section.
  const [mobileSection, setMobileSection] = useState<SectionId | null>(null);
  // Android Back / Escape (mobile only): a drilled-in section steps back to the cards; the cards view closes the page.
  useBackHandler(isMobile, onClose);
  useBackHandler(isMobile && mobileSection !== null, () => setMobileSection(null));

  const renderSection = (id: SectionId) => (
    <>
      {id === 'appearance' && <AppearanceSection />}
      {id === 'customization' && <CustomizationSection />}
      {id === 'modes' && <ModesSection modes={modes} characters={characters} onSaveMode={onSaveMode} onDeleteMode={onDeleteMode} />}
      {id === 'backup' && <BackupSection />}
      {id === 'about' && <AboutSection />}
      {id === 'uninstall' && <UninstallSection />}
    </>
  );

  const headTitle = isMobile && mobileSection ? SECTIONS.find((s) => s.id === mobileSection)?.label ?? 'Settings' : 'Settings';

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div
        className={'picker settings-modal' + (isMobile ? ' settings-page-m' : '')}
        role="dialog"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="picker-head">
          {isMobile && mobileSection && (
            <button className="icon-btn settings-back" aria-label="Back to settings" onClick={() => setMobileSection(null)}>
              <i className="ti ti-arrow-left" aria-hidden="true" />
            </button>
          )}
          {headTitle}
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        {isMobile ? (
          mobileSection === null ? (
            <div className="settings-cards">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  className={'settings-card' + (s.id === 'uninstall' ? ' danger' : '')}
                  onClick={() => setMobileSection(s.id)}
                >
                  <i className={'ti ' + s.icon} aria-hidden="true" />
                  <span>{s.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="settings-pane">{renderSection(mobileSection)}</div>
          )
        ) : (
          <div className="settings-body">
            <nav className="settings-nav" aria-label="Settings sections">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  className={'settings-navitem' + (section === s.id ? ' active' : '')}
                  onClick={() => setSection(s.id)}
                >
                  <i className={'ti ' + s.icon} aria-hidden="true" /> {s.label}
                </button>
              ))}
            </nav>
            <div className="settings-pane">{renderSection(section)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
