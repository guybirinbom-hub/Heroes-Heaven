import { useEffect, useRef, useState } from 'react';
import { getAppearance, setAccent, setFont, setStyle, setTheme } from '../theme/theme-manager';
import { getZoom, setZoom, subscribeZoom } from '../theme/zoom';
import { loadRoster, loadSyncMeta, wipeAllData } from '../data/storage';
import { backupCharCount, backupFilename, createBackup, parseBackup, restoreBackup } from '../data/backup';
import { cancelPersist, flushPersist } from '../data/persist';
import { downloadText } from './download';
import { chooseDialog, confirmDialog } from './confirm';
import { isMobilePlatform, isTauri } from '../platform';
import { isCloudSyncEnabled } from '../data/supabase';
import { useAuth, signOut } from '../data/useAuth';
import { getDeviceInfo, setLoginSkipped } from '../data/device';
import { setPref, usePrefs } from '../data/prefs';
import { CustomizationEditor } from './CustomizationEditor';
import { useGlobalCustomization, setGlobalCustomizationField, DEFAULT_CUSTOMIZATION } from '../data/customization';
import { PageMenu } from './PageMenu';
// Removable integration — deleting src/integration/ plus these two imports and the 'tracker'
// entries above/below restores the original Settings. See src/integration/README.md.
import { TRACKER_IN_CAMPAIGN } from '../integration/enabled';
import { TrackerSettingsSection } from '../integration/TrackerSettingsSection';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';
import type { Customization, ModeDef } from '../rules/types';
import { CATALOG_MODES, CATALOG_MODE_MAP } from '../rules/modes';
import { ModeEditor, summarizeMod } from './ModesPanel';
import { useIsMobile } from './useIsMobile';
import { useBackHandler } from './useEscapeClose';

type SectionId = 'appearance' | 'modes' | 'tracker' | 'backup' | 'account' | 'about' | 'uninstall';
const ALL_SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: 'ti-palette' },
  { id: 'modes', label: 'Modes', icon: 'ti-toggle-left' },
  // Removable integration — see src/integration/README.md.
  { id: 'tracker', label: 'Initiative tracker', icon: 'ti-swords' },
  { id: 'backup', label: 'Backup', icon: 'ti-database-export' },
  { id: 'account', label: 'Account', icon: 'ti-user' },
  { id: 'about', label: 'About', icon: 'ti-info-circle' },
  { id: 'uninstall', label: 'Uninstall', icon: 'ti-trash' },
];
// Uninstall only where there's an installed app to remove: the Tauri shells (Windows desktop,
// Android). Account wherever cloud sync is configured (web + installed app); hidden when there's
// no account system at all.
const SECTIONS = ALL_SECTIONS.filter(
  (s) =>
    (s.id !== 'uninstall' || isTauri) &&
    (s.id !== 'account' || isCloudSyncEnabled) &&
    // The tracker section disappears with the integration — see src/integration/README.md.
    (s.id !== 'tracker' || TRACKER_IN_CAMPAIGN),
);

/** Appearance = the device-global default look + behaviour for the app and every character sheet: the full
 *  appearance axes (palette / style / font / accent / zoom) AND the sheet-customization options, in one
 *  place. Each character can override any of it from its own Customize drawer; this is what they start
 *  from. A couple of device-only options that can't sensibly differ per character (popup-size memory,
 *  builder sources) live here too. */
function AppearanceSection() {
  const [, force] = useState(0);
  const tick = () => force((n) => n + 1);
  useEffect(() => subscribeZoom(tick), []);
  const globalCustom = useGlobalCustomization();
  const prefs = usePrefs();
  const isMobile = useIsMobile();
  const app = getAppearance();
  // The device appearance axes live in theme-manager/zoom; the rest is the global customization default.
  const value: Customization = {
    ...globalCustom,
    themeId: app.themeId,
    styleId: app.styleId,
    fontId: app.fontId,
    accentColor: app.accent ?? undefined,
    zoom: getZoom(),
  };
  // Route the appearance-axis keys to the device setters (and force a re-render, since those don't
  // notify); everything else is the global customization default.
  const onChange = <K extends keyof Customization>(key: K, val: Customization[K] | undefined) => {
    switch (key) {
      case 'themeId':
        setTheme(val as string);
        tick();
        break;
      case 'styleId':
        setStyle(val as string);
        tick();
        break;
      case 'fontId':
        setFont(val as string);
        tick();
        break;
      case 'accentColor':
        setAccent((val as string | undefined) ?? null);
        tick();
        break;
      case 'zoom':
        setZoom((val as number | undefined) ?? 1);
        tick();
        break;
      default:
        setGlobalCustomizationField(key, val);
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-h">Appearance</h3>
      <p className="settings-desc">
        The default look and behaviour of the app and every character sheet. Each character can override any of this from
        its own Customize drawer (its menu → Customize); this is what they start from.
      </p>

      <CustomizationEditor value={value} base={DEFAULT_CUSTOMIZATION} scope="global" onChange={onChange} />

      <div className="menu-label">Sources</div>
      <div className="menu-row">
        <button className={'chip' + (prefs.showNicheSources ? ' active' : '')} onClick={() => setPref('showNicheSources', !prefs.showNicheSources)}>
          Show niche sources — {prefs.showNicheSources ? 'on' : 'off'}
        </button>
      </div>
      <p className="settings-desc">
        Adds the niche <strong>Other</strong> shelf (Pathfinder Society scenarios, blog articles, and Free RPG Day
        specials) to the character builder's Sources list. Hidden by default to keep that list short.
      </p>

      {!isMobile && (
        <>
          <div className="menu-label">Popups</div>
          <div className="menu-row">
            <button className={'chip' + (prefs.popupSizeSync ? ' active' : '')} onClick={() => setPref('popupSizeSync', !prefs.popupSizeSync)}>
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
      // createBackup() reads localStorage directly, so force out any pending debounced roster write
      // first — otherwise a just-made change (still in the debounce window) would be missing from
      // the exported backup. See data/persist.ts.
      flushPersist();
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
        // Drop any pending debounced roster write BEFORE restoring: otherwise the beforeunload flush
        // fired by reload() below would write our stale in-memory roster over the freshly-restored
        // data. Cancel it, restore, then reload to pick up the restored storage. See data/persist.ts.
        cancelPersist();
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

/** Relative "x ago" for the last-synced line — coarse on purpose (no live ticking needed). */
function timeAgo(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** The "Last synced from ⟨device⟩ · ⟨time⟩" line. Reads the cached sync metadata and refreshes when a
 *  sync completes (cloudSync dispatches 'hh-synced'). */
function LastSyncedLine() {
  const [, bump] = useState(0);
  useEffect(() => {
    const on = () => bump((n) => n + 1);
    window.addEventListener('hh-synced', on);
    return () => window.removeEventListener('hh-synced', on);
  }, []);
  const meta = loadSyncMeta();
  if (!meta.lastEditedAt || !meta.lastDevice) return null;
  const thisDevice = meta.lastDevice.id === getDeviceInfo().id;
  return (
    <p className="settings-desc settings-sub">
      Last synced {timeAgo(meta.lastEditedAt)}
      {thisDevice ? ' from this device' : ` from ${meta.lastDevice.label}`}.
    </p>
  );
}

/** Sign in / out. Cloud sync keeps the roster safe, so signing out is non-destructive (the local copy
 *  stays too). On the installed app a user may be signed out by choice ("use offline") — offer a way
 *  back in. */
function AccountSection() {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);

  if (auth.status === 'signed-in') {
    return (
      <div className="settings-section">
        <h3 className="settings-h">Account</h3>
        <p className="settings-desc">
          Signed in — your characters are backed up to the cloud and load on any device you sign in on.
        </p>
        <div className="menu-label">Signed in as</div>
        <p className="settings-desc">
          <strong>{auth.email ?? '—'}</strong>
        </p>
        <LastSyncedLine />
        <div className="menu-row">
          <button className="btn" disabled={busy} onClick={() => { setBusy(true); void signOut(); }}>
            <i className="ti ti-logout" aria-hidden="true" /> Sign out
          </button>
        </div>
      </div>
    );
  }

  // Signed out (installed app, "use offline"): local-only, with a way to sign in. Signing in clears
  // the skip and reloads so the login screen shows; the pending roster is flushed first.
  return (
    <div className="settings-section">
      <h3 className="settings-h">Account</h3>
      <p className="settings-desc">
        Not signed in — your characters live on this device only. Sign in to back them up to your account and sync
        across your devices.
      </p>
      <div className="menu-row">
        <button
          className="btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setLoginSkipped(false);
            flushPersist();
            window.location.reload();
          }}
        >
          <i className="ti ti-login" aria-hidden="true" /> Sign in
        </button>
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="settings-section">
      <h3 className="settings-h">Heroes Heaven</h3>
      <p className="settings-desc">
        A Pathfinder Second Edition character builder and play sheet. Your characters live on this device and work fully
        offline; if you sign in, they&rsquo;re also backed up to your account and sync across your devices.
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

/** Ask the OS to remove the app, and erase all local data. Returns a message to show if the program
 *  couldn't be removed automatically. Both Tauri shells have the `uninstall_app` command, but the
 *  ORDER and the pre-wipe differ by platform:
 *
 *  - Android: `uninstall_app` only OPENS the system "uninstall this app?" dialog, which the user can
 *    CANCEL. So we trigger it FIRST and DON'T pre-wipe — pre-wiping would leave the app installed but
 *    permanently empty if they cancel. Android clears the app's data on an actual uninstall anyway.
 *  - Desktop (Windows): the NSIS uninstaller doesn't clear our localStorage, so we DO wipe first,
 *    then launch it (the app exits and the uninstaller takes over). */
async function runUninstall(): Promise<string | null> {
  // Drop any pending debounced roster write so the beforeunload flush (on reload/exit below) can't
  // resurrect the roster we're about to wipe. See data/persist.ts.
  cancelPersist();
  if (isTauri && isMobilePlatform) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      // Trigger the cancelable OS dialog FIRST; do not pre-wipe (Android wipes data on real removal).
      await invoke('uninstall_app');
      return 'Confirm removing the app in the dialog Android shows. Your data is deleted when the app is removed.';
    } catch {
      // Older build without the command, a portable/dev run, or the OS refused — fall back to a
      // manual wipe + instructions (no OS uninstall happened, so the data must be cleared here).
      wipeAllData();
      return 'Your data has been erased. To remove the app itself, uninstall Heroes Heaven from your device’s app manager.';
    }
  }
  if (isTauri) {
    // Desktop: wipe our data (the NSIS uninstaller won't), then hand off to the uninstaller.
    wipeAllData();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('uninstall_app');
      return null; // on success the app has already exited (message never shows).
    } catch {
      return 'Your data has been erased. To remove the application itself, uninstall “Heroes Heaven” from Windows Settings → Apps.';
    }
  }
  // Plain browser tab: nothing is installed — wiping the data is the whole action.
  wipeAllData();
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
        {isMobilePlatform
          ? 'Removes the app and everything it has stored on this device; Android will ask you to confirm removing the app. Everything lives locally — there is no cloud backup, so this cannot be undone.'
          : 'Remove Heroes Heaven and everything it has stored on this device. Everything lives locally — there is no cloud backup, so this cannot be undone.'}
      </p>
      <div className="danger-zone">
        <div className="menu-label">This permanently deletes</div>
        <ul className="danger-list">
          <li>
            {charCount} saved character{charCount === 1 ? '' : 's'} and all play state
          </li>
          <li>Every homebrew item and custom mode</li>
          <li>Your theme, zoom, and all other preferences</li>
          <li>{isMobilePlatform ? 'The app itself — Android will show its own “uninstall this app?” dialog to confirm' : 'On the desktop app: the program itself (launches the system uninstaller, then closes)'}</li>
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
  onOpenRoster,
  onOpenHomebrew,
  onOpenCampaigns,
  modes,
  characters,
  onSaveMode,
  onDeleteMode,
}: {
  onClose: () => void;
  onOpenRoster?: () => void;
  onOpenHomebrew?: () => void;
  onOpenCampaigns?: () => void;
  modes?: Record<string, ModeDef>;
  characters?: { id: string; name: string }[];
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
}) {
  const [section, setSection] = useState<SectionId>('appearance');
  const isMobile = useIsMobile();
  // Mobile: a full-screen page that opens to a Cards grid; null = show the cards, else drill into a section.
  const [mobileSection, setMobileSection] = useState<SectionId | null>(null);
  // Android Back / Escape: a drilled-in mobile section steps back to the cards; otherwise the page closes
  // (returns to wherever it was opened from). Conditions are mutually exclusive so only one fires.
  useBackHandler(!isMobile || mobileSection === null, onClose);
  useBackHandler(isMobile && mobileSection !== null, () => setMobileSection(null));

  const renderSection = (id: SectionId) => (
    <>
      {id === 'appearance' && <AppearanceSection />}
      {id === 'modes' && <ModesSection modes={modes} characters={characters} onSaveMode={onSaveMode} onDeleteMode={onDeleteMode} />}
      {id === 'tracker' && TRACKER_IN_CAMPAIGN && <TrackerSettingsSection />}
      {id === 'backup' && <BackupSection />}
      {id === 'account' && <AccountSection />}
      {id === 'about' && <AboutSection />}
      {id === 'uninstall' && <UninstallSection />}
    </>
  );

  const headTitle = isMobile && mobileSection ? SECTIONS.find((s) => s.id === mobileSection)?.label ?? 'Settings' : 'Settings';

  return (
    <div className="ws-app subpage settings-subpage">
      <header className="chrome" data-tauri-drag-region>
        <div className="chrome-brand" data-tauri-drag-region>
          <HeroesHeavenLogo className="chrome-logo" /> Heroes Heaven
        </div>
        <PageMenu
          items={[
            ...(onOpenRoster ? [{ label: 'Characters', icon: 'ti-users', onClick: onOpenRoster }] : []),
            ...(onOpenHomebrew ? [{ label: 'Homebrew', icon: 'ti-flask', onClick: onOpenHomebrew }] : []),
            ...(onOpenCampaigns ? [{ label: 'Campaigns', icon: 'ti-flag', onClick: onOpenCampaigns }] : []),
          ]}
        />
        <WindowControls />
      </header>
      <div className="subpage-bar">
        {isMobile && mobileSection && (
          <button className="icon-btn" aria-label="Back to settings" onClick={() => setMobileSection(null)}>
            <i className="ti ti-arrow-left" aria-hidden="true" />
          </button>
        )}
        <h2 className="subpage-title">
          <i className="ti ti-settings" aria-hidden="true" /> {headTitle}
        </h2>
        {/* Mobile: the .chrome hamburger is hidden, so the nav menu lives here — the on-screen way out
            of Settings (to Characters / Homebrew / Campaigns) besides the Android Back button. */}
        {isMobile && (
          <PageMenu
            items={[
              ...(onOpenRoster ? [{ label: 'Characters', icon: 'ti-users', onClick: onOpenRoster }] : []),
              ...(onOpenHomebrew ? [{ label: 'Homebrew', icon: 'ti-flask', onClick: onOpenHomebrew }] : []),
              ...(onOpenCampaigns ? [{ label: 'Campaigns', icon: 'ti-flag', onClick: onOpenCampaigns }] : []),
            ]}
          />
        )}
      </div>
      <div className="subpage-body settings-subpage-body">
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
