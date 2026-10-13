import { useState } from 'react';
import {
  DisplaySection,
  StatBlockSection,
  SourcesSection,
  TimerSection,
  PlayersSection,
  ConditionsSection,
  EncounterTablesSection,
} from '../../tracker/src/components/SettingsModal';
import { GameDataProvider } from '../../tracker/src/data/gameDataContext';
import { HostSaveProvider } from '../../tracker/src/data/hostSaveContext';
import { closeTopTrackerModal, useTrackerModalCount } from '../../tracker/src/utils/spendEscape';
import { downloadText } from '../sheet/download';
import { useBackHandler } from '../sheet/useEscapeClose';
import '../../tracker/dist-css/tracker.scoped.css';
import './tracker-settings.css';

/*
 * "Initiative tracker" inside Heroes Heaven's Settings.
 *
 * The tracker's 7 setting groups are the REAL components, imported from its own SettingsModal —
 * not reimplementations. They keep working on the tracker's own stores, so a setting changed here
 * is the same setting the tracker reads. The tracker's standalone modal still works unchanged.
 *
 * `.tracker-root` is LOAD-BEARING (see CampaignTracker) — it confines the tracker's stylesheet,
 * which carries Tailwind's Preflight, to this subtree. Without it, Preflight would collapse Heroes
 * Heaven's own headings.
 *
 * GameDataProvider is required because several groups (Sources, Conditions, Stat Blocks) read the
 * game data; without it they'd render empty.
 *
 * HostSaveProvider hands the Encounter tables group's Export the app's one export helper
 * (src/sheet/download.ts): the anchor on the web and the PC app, Save to folder / Share on the Android
 * app, whose WebView ignores the tracker's own anchor download (item 8). It passes no dialog style: this
 * is Heroes Heaven's Settings page, and the app's own look is the right one for a pop-up here.
 *
 * ANDROID'S BACK CLOSES THE TRACKER MODAL ON TOP (G7s, 2026-10-13). The tracker's modals opened here — the
 * encounter-table editor and its Link picker, the custom-condition editor, its Delete confirm — close
 * themselves on Escape (tracker/src/utils/spendEscape useEscapeCloses), a key Back never sends: on the
 * phone Back reached the Settings page's own handler and closed the whole page over the half-made table.
 * While any is open a Back handler sits above the page's (a cover) and closes the top one.
 * test/bug-tracker-escape-boxes.test.tsx (BACK).
 *
 * NOT included from the tracker's modal: Appearance (the look is Heroes Heaven's own appearance system —
 * the app's Appearance, or the tracker-only look a GM sets with a campaign's "Customize tracker
 * appearance" button, ./TrackerCustomize.tsx; one system, not two) and Backup & Data (the whole-app
 * backup covers it).
 */

type GroupId = 'display' | 'statblock' | 'sources' | 'timer' | 'players' | 'conditions' | 'encounter-tables';

const GROUPS: { id: GroupId; label: string; icon: string }[] = [
  { id: 'display', label: 'Display', icon: 'ti-eye' },
  { id: 'statblock', label: 'Stat blocks', icon: 'ti-layout-list' },
  { id: 'sources', label: 'Sources', icon: 'ti-books' },
  { id: 'timer', label: 'Turn timer', icon: 'ti-clock' },
  { id: 'players', label: 'Player characters', icon: 'ti-users' },
  { id: 'conditions', label: 'Conditions', icon: 'ti-alert-triangle' },
  { id: 'encounter-tables', label: 'Encounter tables', icon: 'ti-table' },
];

export function TrackerSettingsSection() {
  const [group, setGroup] = useState<GroupId>('display');
  const modalCount = useTrackerModalCount();
  useBackHandler(
    modalCount > 0,
    () => {
      closeTopTrackerModal();
    },
    { cover: true },
  );

  return (
    <div className="tracker-settings">
      <p className="settings-desc">
        Settings for the initiative tracker inside a campaign. The tracker has its own look: set it
        with Customize (the palette button in a campaign&rsquo;s top bar) &mdash; until you do, it
        follows this app&rsquo;s Appearance. Its data is covered by Backup.
      </p>

      <div className="seg tracker-settings-nav" role="tablist" aria-label="Initiative tracker settings">
        {GROUPS.map((g) => (
          <button
            key={g.id}
            role="tab"
            aria-selected={group === g.id}
            className={'seg-btn' + (group === g.id ? ' on' : '')}
            onClick={() => setGroup(g.id)}
          >
            <i className={'ti ' + g.icon} aria-hidden="true" /> {g.label}
          </button>
        ))}
      </div>

      <div className="tracker-root tracker-settings-body">
        <GameDataProvider>
        <HostSaveProvider value={downloadText}>
          {/* campaignDriven: in Heroes Heaven, Monster Parts follows the campaign's Battlezoo
              variant rule (set in the campaign's own settings), so no manual switch here. */}
          {group === 'display' && <DisplaySection campaignDriven />}
          {group === 'statblock' && <StatBlockSection />}
          {group === 'sources' && <SourcesSection />}
          {group === 'timer' && <TimerSection />}
          {/* campaignDriven: a campaign card's HP bar stays with "Defenses" off (the owner's answer on
              item 3: "hp doesn't go with defense"), so the switch is described as AC only here. */}
          {group === 'players' && <PlayersSection campaignDriven />}
          {group === 'conditions' && <ConditionsSection />}
          {group === 'encounter-tables' && <EncounterTablesSection />}
        </HostSaveProvider>
        </GameDataProvider>
      </div>
    </div>
  );
}
