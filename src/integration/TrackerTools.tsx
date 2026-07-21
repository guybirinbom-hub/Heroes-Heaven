import { useTrackerUi, trackerUi } from './trackerUiStore';

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
  const { searchOpen, customOpen, encountersOpen, mainView } = useTrackerUi();

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

  return (
    <div className="tracker-tools">
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
