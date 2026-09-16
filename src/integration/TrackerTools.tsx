import { useEffect, useRef } from 'react';
import { useTrackerUi, trackerUi } from './trackerUiStore';
import { TurnTimerWidget } from '../../tracker/src/components/TurnTimerWidget';
import { useSettingsStore } from '../../tracker/src/store/settingsStore';
import { useTrackerAppearance } from './trackerAppearance';
import { resolveAppearanceVars } from '../theme/theme-manager';

/*
 * The tracker's tools, rendered in Heroes Heaven's TOP BAR (Option B, row 1).
 *
 * These were buttons inside the tracker's own titlebar; the panels they open are rendered by
 * CampaignTracker (row 2) and coordinated through trackerUiStore.
 *
 * Deliberately styled with HH's OWN chrome classes (.icon-btn), not the tracker's — this row IS
 * Heroes Heaven's chrome, so it should look like it. Part of the removable seam.
 */
export function TrackerTools() {
  const { searchOpen, customOpen, encountersOpen, mainView, boardReady } = useTrackerUi();
  const turnTimerEnabled = useSettingsStore((s) => s.turnTimerEnabled);

  /*
   * THE TOP BAR FOLLOWS THE TRACKER'S OWN PALETTE.
   *
   * "Customize tracker appearance" paints the tracker with trackerAppearance's tokens, and
   * CampaignTracker applies them as inline `--app-*` variables on `.tracker-root.campaign-tracker`.
   * This bar is NOT inside that element — it's Heroes Heaven's `header.chrome`, a sibling — so it
   * kept resolving `--app-surface-2` / `--app-accent` from <html>, i.e. the app-wide palette. Pick
   * Ember for the tracker and the body went Ember while the bar above it stayed Midnight, for good:
   * reloading doesn't fix it, because the override is tracker-scoped by design and the bar was
   * never in scope.
   *
   * The tools ARE the tracker, so the bar that holds them is painted with the same tokens: we copy
   * them onto the header this component is mounted in, and take them off again when the tracker
   * view goes away (or the GM resets the override to "inherit"). Reaching up to the host element is
   * deliberate — it keeps the whole thing inside the removable seam, with nothing to unpick in
   * CampaignsPage. See ./README.md.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  // The STATE, not useTrackerVars(): the resolved map is a fresh object on every render, which would
  // re-run this effect (strip + rewrite every token on the header) on every keystroke in the tracker.
  // The state object only changes when the GM actually changes an axis. `null` = inherit the app's
  // appearance, and then the header is left exactly as Heroes Heaven painted it.
  const app = useTrackerAppearance();
  useEffect(() => {
    const header = rootRef.current?.closest('header') as HTMLElement | null;
    if (!header || !app) return;
    const { vars } = resolveAppearanceVars(app.themeId, app.styleId, app.fontId, app.accent, null);
    const names = Object.keys(vars);
    for (const n of names) header.style.setProperty(n, vars[n]);
    return () => {
      for (const n of names) header.style.removeProperty(n);
    };
  }, [app, boardReady]);

  /**
   * `on: undefined` means "this button doesn't have an on/off state" — it navigates. Such a button
   * must not carry aria-pressed at all: aria-pressed="false" tells a screen reader it IS a toggle
   * and is currently OFF, which is a lie about what pressing it does.
   */
  const btn = (on: boolean | undefined, title: string, icon: string, onClick: () => void, label: string) => (
    <button
      className="icon-btn tracker-tool"
      data-on={on || undefined}
      title={title}
      aria-label={title}
      aria-pressed={on}
      onClick={onClick}
    >
      <i className={'ti ' + icon} aria-hidden="true" />
      <span className="tracker-tool-label">{label}</span>
    </button>
  );

  // Nothing here may run before the board is the campaign's own — the turn-timer chip below writes
  // into the combat store, which until then persists to the standalone tracker's board (see
  // `boardReady` in trackerUiStore). The tracker body shows "Opening the table…" for the same window.
  if (!boardReady) return null;

  return (
    <div className="tracker-tools" ref={rootRef}>
      {/* The turn timer lives here in the top bar (it used to sit in the initiative rail). Wrapped in
          `.tracker-root` because this row is Heroes Heaven's chrome — OUTSIDE the tracker's wrapper —
          and the widget's colours are tracker CSS variables scoped to `.tracker-root`. Self-gated on
          the "Timer" setting; the widget reads only the shared combat/settings stores. Adding a
          combatant is the rail's "Add combatants" button now, so no top-bar Add button. */}
      {turnTimerEnabled && (
        <div className="tracker-root tracker-tools-timer">
          <TurnTimerWidget />
        </div>
      )}
      {btn(searchOpen, 'Search everything — conditions, spells, items, traits, actions (Ctrl+K)', 'ti-search', () => trackerUi.setSearch(true), 'Search')}
      {/* Party — the way back to the dashboard from whatever is covering the pane. A sheet can take
          the pane on its own now (clicking a card, or combat reaching a PC's turn), so without this
          there'd be no way to ask for the player cards back. */}
      {btn(mainView === 'party', 'Party — every player’s card at a glance', 'ti-users', () => trackerUi.showMain('party'), 'Party')}
      {btn(mainView === 'gm', 'GM Screen — saved notes & references kept across every combat', 'ti-layout-board', () => trackerUi.showMain('gm'), 'GM Screen')}
      {btn(customOpen, 'Paste a stat block to convert it into a custom creature', 'ti-pencil', () => trackerUi.setCustom(true), 'Custom')}
      {btn(encountersOpen, 'Saved encounters', 'ti-device-floppy', () => trackerUi.setEncounters(true), 'Encounters')}
      {/*
       * The campaign's own settings — default rules, share code, delete. These used to be a strip
       * permanently across the top of the combat; they're once-in-a-while controls, so they belong
       * behind a button.
       *
       * Labelled "Campaign", not "Settings", deliberately: the hamburger two elements to the right
       * already opens Heroes Heaven's app Settings, and two buttons called Settings in one bar
       * meaning different things is a mis-click waiting to happen.
       *
       * It REQUESTS rather than navigates: opening settings leaves the campaign view, which unmounts
       * the GM's open sheet and would silently bin an unpushed working copy. This button sits in HH's
       * chrome and can't see that, so CampaignTracker gets to prompt first.
       */}
      {btn(undefined, 'Campaign settings — default rules, share code, and delete', 'ti-settings', trackerUi.requestCampaignSettings, 'Campaign')}
    </div>
  );
}
