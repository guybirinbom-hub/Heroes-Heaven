import { useEffect, useMemo, useState } from 'react';
import type { Character, ContentDatabase, Item, ModeDef } from '../rules/types';
import { addXp, setXp, setTempSpeed, togglePinnedDesc, descId, type PlayState } from '../rules/play';
import { abilityMod, deriveSpeeds } from '../rules/derive';
import type { BuildState } from '../rules/build';
import { explainStat, type StatRef } from '../rules/explain';
import { roll as rollDice, rollCheck, type RollResult, type DicePreset } from '../rules/dice';
import { PinContext, type PinDescApi } from './PinContext';
import { StatDetailModal } from './StatDetailModal';
import { DiceDrawer } from './DiceDrawer';
import { VitalsRail } from './VitalsRail';
import { CompanionsTab } from './CompanionsTab';
import { MainTab } from './MainTab';
import { SpellsTab } from './SpellsTab';
import { InventoryTab } from './InventoryTab';
import { FeatsTab } from './FeatsTab';
import { DetailsTab } from './DetailsTab';
import { NotesTab } from './NotesTab';
import { SettingsPage } from './SettingsPage';
import { WindowControls } from './WindowControls';
import { useIsMobile } from './useIsMobile';
import { HeroesHeavenLogo } from './Logo';

const TABS = ['Main', 'Spells', 'Inventory', 'Feats & features', 'Companions', 'Notes', 'Details'];

/** Icon + short label for each tab in the mobile bottom navigation bar. */
const TAB_META: Record<string, { icon: string; short: string }> = {
  Main: { icon: 'ti-layout-grid', short: 'Play' },
  Spells: { icon: 'ti-sparkles', short: 'Spells' },
  Inventory: { icon: 'ti-briefcase', short: 'Items' },
  'Feats & features': { icon: 'ti-award', short: 'Feats' },
  Companions: { icon: 'ti-paw', short: 'Allies' },
  Notes: { icon: 'ti-notebook', short: 'Notes' },
  Details: { icon: 'ti-id-badge-2', short: 'Details' },
};
const TAB_KEY = 'wanderers-codex:tab:v1';

function initialTab(): string {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t && TABS.includes(t) ? t : 'Main';
  } catch {
    return 'Main';
  }
}

const DICE_KEY = 'wanderers-codex:dice:v1';
const PRESET_KEY = 'wanderers-codex:dice-presets:v1';

/** Dice-roll history persists across reloads so a session's rolls aren't lost. */
function initialRolls(): RollResult[] {
  try {
    const raw = localStorage.getItem(DICE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as RollResult[]).slice(0, 40) : [];
  } catch {
    return [];
  }
}

/** Saved roll presets (device-global, like the roll history) — e.g. damage rolls (2d12+8). */
function initialPresets(): DicePreset[] {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as DicePreset[]).slice(0, 40) : [];
  } catch {
    return [];
  }
}

export function CharacterSheet({
  character,
  content,
  onPlay,
  onRest,
  onOpenRoster,
  onEdit,
  onCreateItem,
  onSaveMode,
  onDeleteMode,
  onOpenHomebrew,
  charKey,
  characters,
  build,
}: {
  character: Character;
  content: ContentDatabase;
  build?: BuildState;
  onPlay?: (fn: (play: PlayState) => PlayState) => void;
  onCreateItem?: (item: Item) => void;
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
  /** This character's roster id — scopes character-specific modes. */
  charKey?: string;
  /** All roster characters (id + name) — for the Settings → Modes scope picker / labels. */
  characters?: { id: string; name: string }[];
  onRest?: () => void;
  onOpenRoster?: () => void;
  onEdit?: () => void;
  /** Navigate to the full-screen Homebrew page. */
  onOpenHomebrew?: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const isMobile = useIsMobile();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restOpen, setRestOpen] = useState(false);
  const [portraitOpen, setPortraitOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // non-fatal
    }
  }, [tab]);
  const [xpDraft, setXpDraft] = useState(String(character.xp));
  const [xpAdd, setXpAdd] = useState('');
  // Keep the editable XP field in sync when the value changes elsewhere (rest, edit, …).
  useEffect(() => setXpDraft(String(character.xp)), [character.xp]);
  const [rolls, setRolls] = useState<RollResult[]>(initialRolls);
  const [presets, setPresets] = useState<DicePreset[]>(initialPresets);
  const [diceOpen, setDiceOpen] = useState(false);
  const [statRef, setStatRef] = useState<StatRef | null>(null);
  useEffect(() => {
    try {
      localStorage.setItem(DICE_KEY, JSON.stringify(rolls));
    } catch {
      // non-fatal
    }
  }, [rolls]);
  useEffect(() => {
    try {
      localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
    } catch {
      // non-fatal
    }
  }, [presets]);

  const pushRoll = (r: RollResult) => {
    setRolls((prev) => [r, ...prev].slice(0, 40));
    setDiceOpen(true);
  };
  /** Click-to-roll a 1d20 + modifier check (saves, skills, attacks). Suppressed when the dice roller
   *  is turned off, so no roll buttons appear anywhere. */
  const diceOff = !!character.options?.diceRollerOff;
  const rollCheckFn = diceOff ? undefined : (label: string, modifier: number) => pushRoll(rollCheck(label, modifier));

  const commitAddXp = () => {
    const n = parseInt(xpAdd, 10);
    if (onPlay && Number.isFinite(n) && n !== 0) onPlay((p) => addXp(p, n));
    setXpAdd('');
  };
  const commitXp = () => {
    const n = parseInt(xpDraft, 10);
    if (onPlay && Number.isFinite(n)) onPlay((p) => setXp(p, n));
    else setXpDraft(String(character.xp));
  };

  const ancestry = character.ancestryId ? content.ancestries[character.ancestryId] : undefined;
  const cls = character.classId ? content.classes[character.classId] : undefined;
  const initials = character.name.slice(0, 2).toUpperCase();
  const portrait = character.appearance?.portrait;

  // Lets description popups anywhere in the sheet offer a "favorite" star (only in play mode).
  const pinApi: PinDescApi | null = useMemo(() => {
    if (!onPlay) return null;
    return {
      has: (node) => {
        const id = descId(node);
        return (character.pinnedDescs ?? []).some((d) => descId(d) === id);
      },
      toggle: (node) => onPlay((p) => togglePinnedDesc(p, node)),
    };
  }, [onPlay, character.pinnedDescs]);

  return (
    <PinContext.Provider value={pinApi}>
    <div className="ws-app">
      <header className="chrome" data-tauri-drag-region>
        <div className="chrome-brand" data-tauri-drag-region>
          <HeroesHeavenLogo className="chrome-logo" /> Heroes Heaven
        </div>
        <WindowControls />
      </header>

      <div className="identity">
        {portrait ? (
          <button
            type="button"
            className="portrait portrait-btn"
            title={isMobile ? 'Menu' : 'View portrait'}
            aria-label={isMobile ? 'Open menu' : 'View portrait full size'}
            onClick={() => (isMobile ? setMenuOpen(true) : setPortraitOpen(true))}
          >
            <img src={portrait} alt="" className="portrait-img" />
          </button>
        ) : isMobile ? (
          <button
            type="button"
            className="portrait portrait-btn"
            title="Menu"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            {initials}
          </button>
        ) : (
          <div className="portrait">{initials}</div>
        )}
        <div className="identity-name">
          <div className="char-name">
            <span className="char-name-text">{character.name}</span>
            <span className="level-chip">Level {character.level}</span>
          </div>
          <div className="char-sub">
            <span className="lk">{ancestry?.name}</span> · <span className="lk">{cls?.name}</span>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              className={'tab' + (t === tab ? ' on' : '')}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="level-stack">
          {onPlay ? (
            <div className="xp-group">
              <span className="xp-field">
                <input
                  className="xp-input"
                  type="text"
                  inputMode="numeric"
                  value={xpDraft}
                  aria-label="Experience points"
                  title="Experience points — type to set the total"
                  onChange={(e) => setXpDraft(e.target.value.replace(/[^0-9]/g, ''))}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={commitXp}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      commitXp();
                      e.currentTarget.blur();
                    }
                    if (e.key === 'Escape') {
                      setXpDraft(String(character.xp));
                      e.currentTarget.blur();
                    }
                  }}
                />
                <span className="xp-suffix">xp</span>
              </span>
              <span className="xp-div" aria-hidden="true" />
              <input
                className="xp-add-input"
                type="text"
                inputMode="numeric"
                value={xpAdd}
                placeholder="+ XP"
                aria-label="Experience points to add"
                title="Add XP to the total"
                onChange={(e) => setXpAdd(e.target.value.replace(/[^0-9-]/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitAddXp();
                }}
              />
              <button className="xp-add-btn" onClick={commitAddXp}>
                Add
              </button>
            </div>
          ) : (
            <span className="xp">{character.xp.toLocaleString()} xp</span>
          )}
        </div>
        {onRest && (
          <button className="icon-btn" title="Daily preparations" onClick={() => setRestOpen(true)}>
            <i className="ti ti-bed" aria-hidden="true" />
          </button>
        )}
        {!diceOff && (
          <button className="icon-btn" title="Dice roller" onClick={() => setDiceOpen(true)}>
            <i className="ti ti-dice" aria-hidden="true" />
          </button>
        )}
        <button className="icon-btn" title="Menu" onClick={() => setMenuOpen((o) => !o)}>
          <i className="ti ti-menu-2" aria-hidden="true" />
        </button>
        {menuOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="topmenu" role="menu">
              {onEdit && (
                <button
                  className="topmenu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onEdit();
                  }}
                >
                  <i className="ti ti-edit" aria-hidden="true" /> Edit character
                </button>
              )}
              <button
                className="topmenu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setSettingsOpen(true);
                }}
              >
                <i className="ti ti-settings" aria-hidden="true" /> Settings
              </button>
              <button
                className="topmenu-item"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenHomebrew?.();
                }}
              >
                <i className="ti ti-flask" aria-hidden="true" /> Homebrew
              </button>
              {onOpenRoster && (
                <button
                  className="topmenu-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenRoster();
                  }}
                >
                  <i className="ti ti-users" aria-hidden="true" /> Characters
                </button>
              )}
            </div>
          </>
        )}
        {settingsOpen && (
          <SettingsPage
            onClose={() => setSettingsOpen(false)}
            modes={content.modes}
            characters={characters}
            onSaveMode={onSaveMode}
            onDeleteMode={onDeleteMode}
          />
        )}
        {portraitOpen && portrait && (
          <div className="portrait-lightbox" onClick={() => setPortraitOpen(false)} role="dialog" aria-label="Portrait">
            <img src={portrait} alt={`${character.name} portrait`} className="portrait-lightbox-img" />
            <button className="portrait-lightbox-close" onClick={() => setPortraitOpen(false)} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <div className="body">
        {(!isMobile || tab === 'Main') && (
          <VitalsRail character={character} content={content} charKey={charKey} onPlay={onPlay} onOpenStat={setStatRef} onSaveMode={onSaveMode} onDeleteMode={onDeleteMode} onCreateItem={onCreateItem} />
        )}
        <main className="content">
          {tab === 'Main' ? (
            <MainTab character={character} content={content} onPlay={onPlay} onRoll={rollCheckFn} onOpenStat={setStatRef} />
          ) : tab === 'Spells' ? (
            <SpellsTab character={character} content={content} onPlay={onPlay} onOpenStat={setStatRef} />
          ) : tab === 'Inventory' ? (
            <InventoryTab character={character} content={content} onPlay={onPlay} onCreateItem={onCreateItem} />
          ) : tab === 'Feats & features' ? (
            <FeatsTab character={character} content={content} />
          ) : tab === 'Details' ? (
            <DetailsTab character={character} content={content} onPlay={onPlay} />
          ) : tab === 'Notes' ? (
            <NotesTab character={character} onPlay={onPlay} />
          ) : tab === 'Companions' ? (
            <CompanionsTab character={character} content={content} onPlay={onPlay} />
          ) : (
            // Every tab in TABS has a branch above; this is just a safe neutral fallback.
            <MainTab character={character} content={content} onPlay={onPlay} onRoll={rollCheckFn} onOpenStat={setStatRef} />
          )}
        </main>
      </div>

      {isMobile && (
        <nav className="mtabs" role="tablist" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              className={'mtab' + (t === tab ? ' on' : '')}
              onClick={() => setTab(t)}
            >
              <i className={'ti ' + TAB_META[t].icon} aria-hidden="true" />
              <span className="mtab-label">{TAB_META[t].short}</span>
            </button>
          ))}
        </nav>
      )}

      {diceOpen && (
        <DiceDrawer
          rolls={rolls}
          presets={presets}
          onRoll={(label, count, sides, modifier) => pushRoll(rollDice(label, count, sides, modifier))}
          onClear={() => setRolls([])}
          onSavePreset={(p) => setPresets((prev) => [{ ...p, id: `p-${Math.random().toString(36).slice(2, 9)}` }, ...prev].slice(0, 40))}
          onDeletePreset={(id) => setPresets((prev) => prev.filter((p) => p.id !== id))}
          onClose={() => setDiceOpen(false)}
        />
      )}

      {statRef && (
        <StatDetailModal
          breakdown={explainStat(character, content, statRef, build)}
          character={character}
          content={content}
          onRoll={rollCheckFn}
          onClose={() => setStatRef(null)}
          editor={
            statRef.kind === 'speed' && onPlay ? (
              <SpeedTempControl character={character} content={content} onPlay={onPlay} />
            ) : undefined
          }
        />
      )}

      {restOpen && onRest && (
        <div className="picker-overlay" onClick={() => setRestOpen(false)}>
          <div className="picker confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>
                <i className="ti ti-moon" aria-hidden="true" /> Daily preparations
              </span>
              <button className="picker-close" onClick={() => setRestOpen(false)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div className="confirm-body">
              <p>A full night's rest, then preparing for the day. This will:</p>
              <ul>
                <li>
                  Recover <strong>{character.level * Math.max(1, abilityMod(character.abilities.con))} HP</strong> (Con
                  modifier × level — not a full heal)
                </li>
                <li>Refresh spell slots, focus points, and daily-use abilities</li>
                <li>Refill tracked item uses that reset daily (wands, staves, per-day items)</li>
                <li>Clear temporary HP</li>
                <li>Remove Fatigued, Wounded, and Dying; reduce Doomed and Drained by 1</li>
              </ul>
              <p className="confirm-note">Hero points are session-based and aren't changed.</p>
            </div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={() => setRestOpen(false)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  onRest();
                  setRestOpen(false);
                }}
              >
                Prepare for the day
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </PinContext.Provider>
  );
}

/** The temporary-Speed editor shown inside the Speed breakdown panel: type a Speed to apply
 *  it (highlighting the rail), or reset to return to the derived default. */
function SpeedTempControl({
  character,
  content,
  onPlay,
}: {
  character: Character;
  content: ContentDatabase;
  onPlay: (fn: (play: PlayState) => PlayState) => void;
}) {
  const defaultLand = deriveSpeeds(character, content).land ?? 0;
  const override = character.speedOverride;
  const active = override != null && override !== defaultLand;
  // Pre-fill with the current effective Speed (default, or the active override) so a +5/-5 tweak
  // is a quick bump rather than typing from scratch.
  const [draft, setDraft] = useState(String(override ?? defaultLand));
  useEffect(() => setDraft(String(override ?? defaultLand)), [override, defaultLand]);
  // Setting it back to the default clears the override (no lingering highlight).
  const apply = (val: number) => {
    const v = Math.max(0, val);
    setDraft(String(v));
    onPlay((p) => setTempSpeed(p, v === defaultLand ? undefined : v));
  };
  const commit = () => {
    const n = parseInt(draft, 10);
    if (draft === '' || !Number.isFinite(n)) setDraft(String(override ?? defaultLand));
    else apply(n);
  };
  const bump = (d: number) => apply((parseInt(draft, 10) || defaultLand) + d);
  return (
    <div className="speed-temp">
      <div className="sd-sec-label">Temporary Speed</div>
      <div className="speed-temp-row">
        <button className="speed-step" aria-label="Reduce Speed by 5 feet" onClick={() => bump(-5)}>
          <i className="ti ti-minus" aria-hidden="true" />
        </button>
        <input
          className="speed-temp-input"
          type="text"
          inputMode="numeric"
          value={draft}
          aria-label="Temporary land Speed in feet"
          onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              e.currentTarget.blur();
            }
          }}
        />
        <span className="speed-temp-unit">ft</span>
        <button className="speed-step" aria-label="Increase Speed by 5 feet" onClick={() => bump(5)}>
          <i className="ti ti-plus" aria-hidden="true" />
        </button>
        <button
          className="speed-temp-reset"
          disabled={!active}
          onClick={() => onPlay((p) => setTempSpeed(p, undefined))}
        >
          Reset to {defaultLand} ft
        </button>
      </div>
      <p className="speed-temp-note">
        Starts at your {defaultLand}-ft Speed — tap − / + (5 ft) or type to set a temporary Speed (Hasted, Slowed,
        difficult terrain…). It highlights your Speed until you reset it.
      </p>
    </div>
  );
}
