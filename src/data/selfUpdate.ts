/*
 * The Windows app's "Install the update" (Guy, 2026-11-08: "can you make that button install the newest
 * version or must we make it link to the repo?").
 *
 * The banner's button used to open the installer's GitHub link, and in the app it opened nothing at all
 * (the link permission was missing; src-tauri/capabilities/default.json now grants it). On the Windows
 * app the button now installs instead: tauri-plugin-updater reads the newest release's latest.json,
 * downloads the installer it names, refuses it unless its signature matches the pubkey in
 * tauri.conf.json, then runs it in passive mode (a progress window, no clicks) and restarts the app.
 *
 * Two clicks: "Install the update" downloads and stops at "Install now", so the app never closes while
 * the player is in the middle of something they started during the download. Installing closes the app
 * at once, so two things happen first, the same as the X button's close: unsaved work (a new character
 * in the builder, an open editor) gets the app's own question, and every pending local write is flushed.
 * Anything that goes wrong before the install — no latest.json on that release (every release before the
 * self-install came without one), offline, too slow, a bad signature — opens the installer link in the
 * browser instead, so the player still gets the update. The phone never comes here: an APK can't install
 * itself, so it keeps the download link. test/update-button.test.tsx.
 */

/** How long the download may take before the banner gives up and hands the link to the browser. */
export const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

/** The part of tauri-plugin-updater's Update object this flow uses. */
export interface DownloadableUpdate {
  download(onEvent?: (e: DownloadEvent) => void, options?: { timeout?: number }): Promise<void>;
  install(): Promise<void>;
}
/** tauri-plugin-updater's DownloadEvent, as far as the progress line needs it. */
export type DownloadEvent =
  | { event: 'Started'; data: { contentLength?: number } }
  | { event: 'Progress'; data: { chunkLength: number } }
  | { event: 'Finished' };

export type InstallStage =
  | { kind: 'idle' }
  | { kind: 'checking' }
  /** percent is null while the download's size is unknown. */
  | { kind: 'downloading'; percent: number | null }
  /** Downloaded (or the player chose "Keep editing"): the next click installs without downloading again. */
  | { kind: 'downloaded' }
  | { kind: 'installing' }
  /** The in-app route failed, so the installer link went to the browser. */
  | { kind: 'browser' };

export interface InstallDeps {
  /** tauri-plugin-updater's check(): the newer update, or null when latest.json names nothing newer. */
  check: () => Promise<DownloadableUpdate | null>;
  hasUnsavedWork: () => boolean;
  /** The app's own question; true = install anyway. */
  askInstallAnyway: () => Promise<boolean>;
  /** Flush every pending write right before the app closes (the same flushes the app runs on close). */
  flush: () => void;
  /** The install failed and the app keeps running: undo the close-time side effects of flush. */
  resume: () => void;
  /** The fallback: hand the installer link to the browser. */
  openInBrowser: () => Promise<void>;
  onStage: (stage: InstallStage) => void;
}

async function toBrowser(deps: InstallDeps): Promise<'browser'> {
  deps.onStage({ kind: 'browser' });
  try {
    await deps.openInBrowser();
  } catch {
    // Nothing else can open it; the release notes link is still on the banner.
  }
  return 'browser';
}

/** Check and download. Resolves the downloaded update, or 'browser' when it fell back to the link. */
export async function downloadUpdate(deps: InstallDeps): Promise<DownloadableUpdate | 'browser'> {
  deps.onStage({ kind: 'checking' });
  let update: DownloadableUpdate | null;
  try {
    update = await deps.check();
  } catch {
    update = null;
  }
  if (!update) return toBrowser(deps);
  let total = 0;
  let got = 0;
  deps.onStage({ kind: 'downloading', percent: null });
  try {
    await update.download(
      (e) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0;
        else if (e.event === 'Progress') {
          got += e.data.chunkLength;
          deps.onStage({ kind: 'downloading', percent: total > 0 ? Math.min(100, Math.floor((got * 100) / total)) : null });
        }
      },
      { timeout: DOWNLOAD_TIMEOUT_MS },
    );
  } catch {
    return toBrowser(deps);
  }
  deps.onStage({ kind: 'downloaded' }); // the banner now offers "Install now"
  return update;
}

/**
 * Install a downloaded update: ask first while anything is unsaved, flush, install (the app closes and
 * the installer restarts it). 'kept-editing' = the player said no; the update stays downloaded.
 */
export async function installDownloaded(
  update: DownloadableUpdate,
  deps: InstallDeps,
): Promise<'installing' | 'kept-editing' | 'browser'> {
  if (deps.hasUnsavedWork() && !(await deps.askInstallAnyway())) {
    deps.onStage({ kind: 'downloaded' });
    return 'kept-editing';
  }
  deps.flush();
  deps.onStage({ kind: 'installing' });
  try {
    await update.install();
  } catch {
    // The app keeps running (an antivirus blocked the installer, the temp write failed): undo what the
    // flush switched off for a close, so live sync comes back.
    deps.resume();
    return toBrowser(deps);
  }
  return 'installing';
}

