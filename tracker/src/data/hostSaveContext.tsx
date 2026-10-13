import { createContext, useContext } from 'react'

/*
 * HH → tracker bridge for SAVING A FILE (null default, like the other host contexts).
 *
 * The tracker's own exports — saved encounters (EncounterManager → encounterTransfer.downloadEncounters)
 * and encounter tables (SettingsModal's EncounterTablesSection) — downloaded through a temporary
 * object-URL anchor. A browser and the PC app save that; the Android app's WebView has no download
 * listener and ignores it, so on the phone those exports saved NOTHING (item 8 of the owner's list, the
 * Android half: "on android have both options"). Inside Heroes Heaven the host supplies its one
 * platform-aware export (src/sheet/download.ts `downloadText`): the anchor on the web and the PC app, the
 * app's own "Save to folder" / "Share" chooser on the Android app. With no provider (the standalone
 * tracker on port 1421) this is null and the tracker's own anchor download runs as before
 * (../utils/saveTextFile.ts).
 *
 * ONE named-arguments object, never two positional strings: Heroes Heaven's homebrew export once passed
 * (text, filename) to a (filename, text) helper and tsc accepted it.
 */
export interface HostSaveFile {
  filename: string
  text: string
  /** The file's media type ('application/json' for every tracker export). */
  mime: string
}

/** What became of the file: saved, handed to the share sheet, or nothing (the player cancelled). */
export type HostSaveOutcome = 'saved' | 'shared' | 'cancelled'

/** Save or share `file` the host's way. It may THROW synchronously (a name the host refuses) or reject
 *  (a failed save or share); saveTextFile turns both into one rejected promise for the caller. */
export type HostSave = (file: HostSaveFile) => Promise<HostSaveOutcome>

const HostSaveContext = createContext<HostSave | null>(null)
export const HostSaveProvider = HostSaveContext.Provider
export function useHostSave(): HostSave | null {
  return useContext(HostSaveContext)
}
