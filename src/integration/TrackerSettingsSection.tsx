/// <reference path="../../tracker/src/types/electron.d.ts" />
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
 * NOT included from the tracker's modal: Appearance (Heroes Heaven's own Appearance section governs
 * the look — one appearance system, not two) and Backup & Data (the whole-app backup covers it).
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

  return (
    <div className="tracker-settings">
      <p className="settings-desc">
        Settings for the initiative tracker inside a campaign. The tracker&rsquo;s look follows this
        app&rsquo;s Appearance, and its data is covered by Backup.
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
          {/* campaignDriven: in Heroes Heaven, Monster Parts follows the campaign's Battlezoo
              variant rule (set in the campaign's own settings), so no manual switch here. */}
          {group === 'display' && <DisplaySection campaignDriven />}
          {group === 'statblock' && <StatBlockSection />}
          {group === 'sources' && <SourcesSection />}
          {group === 'timer' && <TimerSection />}
          {group === 'players' && <PlayersSection />}
          {group === 'conditions' && <ConditionsSection />}
          {group === 'encounter-tables' && <EncounterTablesSection />}
        </GameDataProvider>
      </div>
    </div>
  );
}
