import { useSyncExternalStore } from 'react';

/*
 * Shared UI state for the tracker mounted inside a campaign.
 *
 * WHY THIS EXISTS: the tracker's own App.tsx keeps Search / GM Screen / Custom / Encounters in LOCAL
 * component state. Option B puts those buttons in Heroes Heaven's top bar (row 1) while the panels
 * they open render in the tracker body (row 2) — two different components, so the state must live
 * outside both. It isn't prop-drilled because HH's chrome is rendered by CampaignsPage, which
 * shouldn't have to know what a "GM Screen" is.
 *
 * WHY NOT ZUSTAND (which the tracker itself uses): this file lives in HH's src/, and Node resolves
 * from the importing file upward — HH has no zustand, and adding one would mean touching HH's
 * package.json, breaking the "HH's build is untouched" property that makes this integration
 * removable. React's own useSyncExternalStore does the job in ~20 lines with no dependency.
 *
 * Part of the removable seam — deleted with src/integration/.
 */

/**
 * What the main pane shows.
 *
 * 'combatant' is the tracker's own tiling workspace (PaneLayout + layoutStore): a tree of panes,
 * each a tabbed stack of stat blocks and reference popups. It is the tracker's main view and the
 * only thing that can show more than one combatant at once.
 *
 * It was missing from this type, and that omission WAS the bug: with no 'combatant' view there was
 * nowhere for a clicked combatant to go, so the campaign showed one thing at a time chosen by
 * "follow the turn" instead of by the user. Matches `mainFocus` in the tracker's own App.tsx.
 */
export type MainView = 'combatant' | 'party' | 'gm';

export interface TrackerUiState {
  searchOpen: boolean;
  customOpen: boolean;
  encountersOpen: boolean;
  /** The tracker's "Customize" panel (theme/style for the GM's view) is open. */
  appearanceOpen: boolean;
  mainView: MainView;
  /**
   * Bumped every time the user picks a main view, INCLUDING re-picking the current one.
   *
   * A sheet can be covering the pane, and "show me the dashboard" while the dashboard is already
   * the selected view is a real, common request — turn-following opens a sheet without changing
   * mainView, so watching mainView alone would ignore the click that puts it away.
   *
   * It's a nonce rather than the store simply owning "is a sheet open" because closing a sheet is
   * asynchronous and refusable: a dirty sheet prompts, and the GM can cancel. Only the component
   * holding the sheet can honour that, so the store records the REQUEST and lets it decide.
   */
  paneRequest: number;
  /**
   * Bumped when the user asks for the campaign's settings page.
   *
   * Same reason as paneRequest, but the stakes are higher: leaving the campaign view UNMOUNTS the
   * tracker and the GM's sheet with it, discarding an unpushed working copy. The button lives in
   * Heroes Heaven's chrome — OUTSIDE CampaignTracker — so it cannot see whether a sheet is dirty and
   * must not navigate on its own. It asks; CampaignTracker prompts and decides.
   */
  settingsRequest: number;
}

const INITIAL: TrackerUiState = {
  searchOpen: false, customOpen: false, encountersOpen: false, appearanceOpen: false, mainView: 'party',
  paneRequest: 0, settingsRequest: 0,
};

let state: TrackerUiState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<TrackerUiState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const getSnapshot = () => state;

/** Read the shared tracker UI state (re-renders on change). */
export function useTrackerUi(): TrackerUiState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const trackerUi = {
  setSearch: (searchOpen: boolean) => set({ searchOpen }),
  setCustom: (customOpen: boolean) => set({ customOpen }),
  setEncounters: (encountersOpen: boolean) => set({ encountersOpen }),
  setAppearance: (appearanceOpen: boolean) => set({ appearanceOpen }),
  /** Show a main view, and ask whatever is covering the pane to get out of the way. */
  showMain: (mainView: MainView) => set({ mainView, paneRequest: state.paneRequest + 1 }),
  /** Ask to leave for the campaign's settings page. CampaignTracker decides — it may prompt first. */
  requestCampaignSettings: () => set({ settingsRequest: state.settingsRequest + 1 }),
  /** Close everything — used when leaving the campaign so panels don't reappear on re-entry. */
  reset: () => set(INITIAL),
};
