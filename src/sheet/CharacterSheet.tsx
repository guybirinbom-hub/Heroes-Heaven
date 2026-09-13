import { useEffect, useMemo, useRef, useState } from 'react';
import type { Character, ContentDatabase, Customization, Item, ModeDef } from '../rules/types';
import {
  addXp,
  setXp,
  setTempSpeed,
  togglePinnedDesc,
  descId,
  setItemCounter,
  updateInventoryItem,
  setAlchemyItem,
  toggleExpended,
  setSlotsUsed,
  poolKey,
  slotKeyOf,
  type PlayUpdater,
} from '../rules/play';
import { canPrepareStaff, chargeCounterId, highestSlotRank, isStaff, openSlots, type OpenSlot } from '../rules/itemUses';
import { AlchemyPicker } from './AlchemyPanel';
import { abilityMod, deriveSpeeds, setPlusOnMods } from '../rules/derive';
import type { BuildState } from '../rules/build';
import { explainStat, type StatRef } from '../rules/explain';
import {
  dailyChoicesFor,
  unansweredDailyChoices,
  dailyChoiceLabel,
} from '../rules/dailyChoices';
import { dailyItemSlots, dailyItemOptions } from '../rules/dailyItems';
import { PopupSelect } from '../builder/shared';
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
import { useCustomization, densityStyleId, applyGlobalCustomizationDom, SHEET_TABS } from '../data/customization';
import { applySheetOverlay } from '../theme/theme-manager';
import { applyZoomOverlay, applyGlobalZoom } from '../theme/zoom';
import { CustomizeModal } from './CustomizeModal';
import { PageMenu } from './PageMenu';
import { WindowControls } from './WindowControls';
import { useIsMobile, useShowUndoButtons } from './useIsMobile';
import { useAvatar, usePortrait } from './usePortrait';
import { PartyPage } from './PartyPage';
import { loadCampaigns } from '../data/storage';
import { useBackHandler } from './useEscapeClose';
import { HeroesHeavenLogo } from './Logo';
import { playerFacingContent } from '../rules/cursedItems';

const TABS = SHEET_TABS;
// Mobile gets an extra "Actions" page (actions + activities split off Main); desktop keeps them on Main.
const MOBILE_TABS = ['Main', 'Actions', ...SHEET_TABS.slice(1)];

/** Icon + short label for each tab in the mobile bottom navigation bar. */
const TAB_META: Record<string, { icon: string; short: string }> = {
  Main: { icon: 'ti-layout-grid', short: 'Main' },
  Actions: { icon: 'ti-swords', short: 'Actions' },
  Spells: { icon: 'ti-sparkles', short: 'Spells' },
  Inventory: { icon: 'ti-briefcase', short: 'Items' },
  'Feats & features': { icon: 'ti-award', short: 'Feats' },
  Companions: { icon: 'ti-paw', short: 'Allies' },
  Notes: { icon: 'ti-notebook', short: 'Notes' },
  Details: { icon: 'ti-id-badge-2', short: 'Details' },
};
const TAB_KEY = 'wanderers-codex:tab:v1';
/** "1st"/"2nd"/"3rd" for a spell rank. */
const ordinal = (r: number) => (r === 1 ? '1st' : r === 2 ? '2nd' : r === 3 ? '3rd' : `${r}th`);

function initialTab(): string {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return t && MOBILE_TABS.includes(t) ? t : 'Main';
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
  content: rawContent,
  onPlay,
  onRest,
  onOpenRoster,
  onEdit,
  undo,
  redo,
  canUndo,
  canRedo,
  onCreateItem,
  onSaveMode,
  onDeleteMode,
  onOpenHomebrew,
  onOpenCampaigns,
  onOpenSettings,
  onCustomize,
  globalCustomization,
  onLeaveCampaign,
  partyEnabled,
  readOnly,
  gmEdit,
  onBack,
  charKey,
  build,
}: {
  character: Character;
  content: ContentDatabase;
  build?: BuildState;
  onPlay?: PlayUpdater;
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
  /** Roster undo/redo, surfaced as header buttons. Absent ⇒ the buttons are not rendered (the sheet
   *  is also used read-only, e.g. a teammate's sheet in a campaign, where undoing makes no sense). */
  undo?: () => void;
  redo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Navigate to the full-screen Homebrew page. */
  onOpenHomebrew?: () => void;
  /** Navigate to the Campaigns page. Provided ONLY when signed in — absent hides the menu item. */
  onOpenCampaigns?: () => void;
  /** Navigate to the Settings page (now a full page, not a modal). */
  onOpenSettings?: () => void;
  /** Edit this character's stored data (used by the Customize drawer to write its customization override). */
  onCustomize?: (fn: (c: Character) => Character) => void;
  /** The device-global customization default — the Customize drawer's inherit base + Make-global-default source. */
  globalCustomization?: Customization;
  /** Player leaves a campaign entirely (drops the membership + detaches all characters). */
  onLeaveCampaign?: (campaignId: string) => void;
  /** Signed in → the Party button may show (still only when the character is attached to a campaign). */
  partyEnabled?: boolean;
  /** Render as a look-but-don't-touch view of someone else's character (party page): no menu, no
   *  mutations, and a Back button instead. */
  readOnly?: boolean;
  /** GM editing a player's character (from the campaign detail): fully editable, no nav hamburger, and
   *  a top-bar [edit-build · export · Update · Back] set. `onUpdate` pushes to the player (silently);
   *  `onExport` downloads the file. Mutually exclusive with `readOnly`. */
  gmEdit?: { onUpdate: () => void; onExport: () => void; busy?: boolean };
  onBack?: () => void;
}) {
  const custom = useCustomization();
  // Only the PRIMARY, editable sheet owns the per-character look. Nested read-only / GM-edit sheets
  // (party viewer, GM edit) render inside the primary sheet's DOM overlay and must NOT re-apply or, on
  // unmount, revert it — otherwise closing a teammate's sheet clobbers your own sheet's overlay, and the
  // teammate's sheet would paint with YOUR customization (see review). They just inherit the ambient look.
  const primarySheet = !readOnly && !gmEdit;
  // A cursed item a GM planted HIDDEN shows the player its uncursed twin — name, description and
  // bonuses — so they cannot tell it apart. Swapping it in the CONTENT means every consumer below
  // (item card, inventory, passiveEffects, the stat breakdowns) is disguised at once without any of
  // them knowing. The GM's own view (gmEdit) deliberately keeps the true records, because the whole
  // point of the ruling is that the GM sees the character's real numbers.
  const content = useMemo(
    () => (gmEdit ? rawContent : playerFacingContent(rawContent, character.inventory)),
    [gmEdit, rawContent, character.inventory],
  );
  // The positive-modifier "+" is a display option. Set the module flag DURING render (before children
  // render) so every stat reads the right value on this paint — only the primary sheet does this.
  if (primarySheet) setPlusOnMods(custom.plusOnMods !== false);
  const [tab, setTab] = useState(() => {
    const persisted = initialTab();
    return custom.defaultTab && MOBILE_TABS.includes(custom.defaultTab) ? custom.defaultTab : persisted;
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const [partyOpen, setPartyOpen] = useState(false);
  const isMobile = useIsMobile();
  const showUndoButtons = useShowUndoButtons();
  // Notes fill the sheet: no vitals rail, and the body stops scrolling so the page list and the editor
  // own their own scroll (a note is as long as you make it — the whole sheet shouldn't grow with it).
  const notesFull = tab === 'Notes' && custom.notesShowRail !== true;
  // Desktop tab strip: when there are more tabs than fit, show ◂ / ▸ buttons to scroll the row.
  const tabsRef = useRef<HTMLElement>(null);
  const [tabScroll, setTabScroll] = useState({ left: false, right: false });
  const updateTabScroll = () => {
    const el = tabsRef.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    // Only update on a real change — the ResizeObserver below can fire on every layout tick, and an
    // unchanged object would re-render the whole sheet each time.
    setTabScroll((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  };
  // Instant, not smooth: smooth scrollBy is a no-op in the app's WebView. Re-measure right after (the
  // instant scroll is synchronous) so the ◂/▸ visibility updates even if the scroll event lags.
  const scrollTabs = (dir: -1 | 1) => {
    tabsRef.current?.scrollBy({ left: dir * 220 });
    updateTabScroll();
  };
  // --- customization-driven tab visibility (hide tabs; auto-hide empty Companions/Spells) ---
  const hiddenTabs = new Set(custom.hiddenTabs ?? []);
  const isTabEmpty = (t: string) =>
    !!custom.autoHideEmpty &&
    ((t === 'Companions' && (character.companions?.length ?? 0) === 0) ||
      (t === 'Spells' && (character.spellcasting?.length ?? 0) === 0));
  // Main and (mobile) Actions are always available; everything else can be hidden or auto-hidden.
  const tabVisible = (t: string) => t === 'Main' || t === 'Actions' || (!hiddenTabs.has(t) && !isTabEmpty(t));
  const visibleTabs = TABS.filter(tabVisible);
  const visibleMobileTabs = MOBILE_TABS.filter(tabVisible);
  // Campaigns this character is attached to (for the Party button + view). Falls back to a placeholder
  // name if the membership isn't cached on this device.
  const attachedCampaigns = useMemo(() => {
    const ids = character.campaignIds ?? [];
    if (!ids.length) return [];
    const byId = new Map(loadCampaigns().map((m) => [m.id, m]));
    return ids.map((id) => byId.get(id) ?? { id, code: '', role: 'player' as const, name: 'Campaign' });
  }, [character.campaignIds]);
  const showParty = !readOnly && !gmEdit && !!partyEnabled && (character.campaignIds?.length ?? 0) > 0;
  useBackHandler(partyOpen, () => setPartyOpen(false));
  const [restOpen, setRestOpen] = useState(false);
  // --- daily preparations: choices re-made each morning (Environmental Adaptability, Mask of Power) ---
  const dailyChoices = useMemo(() => dailyChoicesFor(character, content), [character, content]);
  const storedDaily = character.dailyChoices;
  // 'reuse' keeps last night's answers silently; but a choice never answered still has to be asked
  // once — that first answer is what there is to reuse.
  const reuseDaily = custom.dailyPrepPrompt === 'reuse';
  const needsAsking = reuseDaily ? unansweredDailyChoices(dailyChoices, storedDaily) : dailyChoices;
  // Pending edits inside the open modal, so cancelling discards them.
  const [dailyDraft, setDailyDraft] = useState<Record<string, string>>({});
  const dailyAnswer = (key: string) => dailyDraft[key] ?? storedDaily?.[key] ?? '';
  // Temporary items made at daily preparations (scroll caches, Scroll Adept, Herbal Forager).
  const dailyItems = useMemo(() => dailyItemSlots(character, content), [character, content]);
  const [dailyItemDraft, setDailyItemDraft] = useState<Record<string, string>>({});
  const dailyItemAnswer = (key: string) => dailyItemDraft[key] ?? character.dailyItems?.[key] ?? '';
  /*
   * STAVES. GM Core "Preparing a Staff": *"During your daily preparations, you can prepare a staff
   * you're holding. It gains a number of charges equal to the rank of your highest-rank spell slot
   * (you can't prepare a staff if you have no spell slots). You can expend one spell slot to add a
   * number of charges to the staff equal to that slot's rank."*
   *
   * The app refilled staves overnight to a pool sized by the STAFF'S LEVEL and never asked. Two more
   * printed limits ride on the same step: *"No one can prepare more than one staff per day"* — so ONE
   * staff is chosen and every other carried staff goes to 0 for the day — and *"You can prepare a
   * staff only if you have at least one of the staff's spells on your spell list"*, which is read
   * through tradition in `canPrepareStaff`. The expended slot follows the chosen staff, since the
   * rules allow one of those a day too.
   */
  const staffCharges = highestSlotRank(character);
  const staves = useMemo(
    () => character.inventory.filter((iv) => isStaff(content.items[iv.itemId])),
    [character.inventory, content.items],
  );
  /** The carried staves this caster's own spell list lets them prepare at all. */
  const preparableStaves = useMemo(
    () => staves.filter((iv) => canPrepareStaff(content.items[iv.itemId], iv, character, content.spells)),
    [staves, character, content.items, content.spells],
  );
  const slotOptions = useMemo(() => (staves.length ? openSlots(character) : []), [staves.length, character]);
  const [staffSlotKey, setStaffSlotKey] = useState('');
  const [staffPick, setStaffPick] = useState<string | null>(null);
  const optKeyOf = (o: OpenSlot) => `${o.entryId}:${o.rank}`;
  // Default to the staff prepared last time (the only one carrying a prepared pool), else the first
  // one they can prepare — a player with a single staff never has to answer a question at all.
  const chosenStaff =
    staffPick ?? (preparableStaves.find((iv) => iv.staffCharges != null) ?? preparableStaves[0])?.instanceId ?? null;
  const staffBonus = slotOptions.find((o) => optKeyOf(o) === staffSlotKey)?.rank ?? 0;
  const showStaves = staves.length > 0 && staffCharges > 0;
  /* ADVANCED ALCHEMY — "during your daily preparations you create infused items". Same gate the
   * Main-tab panel uses (`character.advancedAlchemy`), so the archetype alchemist who has Quick
   * Alchemy WITHOUT the daily budget is not offered one here either. */
  const alchemyBudget = character.advancedAlchemy?.max ?? 0;
  const [alchemyDraft, setAlchemyDraft] = useState<Record<string, number>>({});
  const [alchemyPicker, setAlchemyPicker] = useState(false);
  const alchemyPrepared = Object.values(alchemyDraft).reduce((a, b) => a + b, 0);
  /**
   * Close the Daily preparations dialog WITHOUT preparing — and throw the morning's picks away.
   *
   * Owner: *"if I want to press Cancel the resources still got filled"*. Every close path only flipped
   * `restOpen`, so a daily choice or a daily item picked and then cancelled stayed in the draft: it
   * came back pre-selected on the next open, it re-enabled "Prepare for the day" for a question the
   * player had not answered that morning, and the next confirm committed it. Cancel now means cancel.
   */
  const closeRest = () => {
    setRestOpen(false);
    setDailyDraft({});
    setDailyItemDraft({});
    setStaffSlotKey('');
    setStaffPick(null);
    setAlchemyDraft({});
    setAlchemyPicker(false);
  };
  const [customizeOpen, setCustomizeOpen] = useState(false);
  useBackHandler(customizeOpen, () => setCustomizeOpen(false));
  const [portraitOpen, setPortraitOpen] = useState(false);
  // Android Back (mobile): unwind one step — close the portrait / rest sheet, else drop back to
  // the home tab — instead of exiting the app. (The menu, popups and Settings handle their own Back.)
  useBackHandler(isMobile && portraitOpen, () => setPortraitOpen(false));
  useBackHandler(isMobile && restOpen, closeRest);
  useBackHandler(isMobile && tab !== 'Main', () => setTab('Main'));
  useEffect(() => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // non-fatal
    }
  }, [tab]);
  // The tab key is device-global, but the desktop tab strip only renders TABS (no mobile-only "Actions").
  // If a mobile-selected "Actions" is restored at desktop width, no desktop tab would be highlighted — so
  // fold it back to Main on desktop (the desktop Actions content is already identical to Main).
  useEffect(() => {
    const list = isMobile ? visibleMobileTabs : visibleTabs;
    if (!list.includes(tab)) setTab('Main');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, tab, custom.hiddenTabs, custom.autoHideEmpty, character.companions?.length, character.spellcasting?.length]);
  // Keep the ◂/▸ tab-scroll buttons in sync with the desktop tab strip's scroll position + width.
  useEffect(() => {
    updateTabScroll();
    const el = tabsRef.current;
    el?.addEventListener('scroll', updateTabScroll, { passive: true });
    window.addEventListener('resize', updateTabScroll);
    // Two failure modes made the ▸ arrow linger after every tab already fit:
    //  1. the mount measurement runs before the strip's flex layout (and web fonts) have settled, so
    //     it sees a too-small width and latches "can scroll right" — then nothing re-measures,
    //     because the user has no reason to scroll or resize the window. Deferred re-measures fix it.
    //  2. the strip's width changes with NO window resize — the sheet lives in resizable panes (the
    //     campaign tracker). A ResizeObserver on the strip catches that.
    const timers = [
      window.setTimeout(updateTabScroll, 0),
      window.setTimeout(updateTabScroll, 250),
    ];
    void document.fonts?.ready?.then(updateTabScroll).catch(() => {});
    let ro: ResizeObserver | undefined;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateTabScroll);
      ro.observe(el);
    }
    return () => {
      el?.removeEventListener('scroll', updateTabScroll);
      window.removeEventListener('resize', updateTabScroll);
      timers.forEach((t) => window.clearTimeout(t));
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, visibleTabs.length, showParty]);
  // Switching to a different character resets to that character's default tab (only if it set one).
  const charKeyRef = useRef(charKey);
  useEffect(() => {
    if (charKeyRef.current === charKey) return;
    charKeyRef.current = charKey;
    if (custom.defaultTab && MOBILE_TABS.includes(custom.defaultTab)) setTab(custom.defaultTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charKey]);
  // Overlay this character's look (accent, density spacing, consumable colour, accent scrollbars) onto
  // <html> while the sheet is open; revert to the global default on unmount / character change. Only the
  // primary sheet does this (a nested read-only/GM sheet must not touch the DOM overlay).
  useEffect(() => {
    if (!primarySheet) return;
    applySheetOverlay({
      themeId: custom.themeId ?? null,
      styleId: custom.styleId ?? densityStyleId(custom.density) ?? null,
      fontId: custom.fontId ?? null,
      accent: custom.accentColor ?? null,
      consumable: custom.consumableColor ?? null,
    });
    document.documentElement.classList.toggle('sb-accent', !!custom.scrollbarAccent);
    // A per-character zoom is a phone setting now: on desktop the zoom control is gone (Ctrl +/− owns
    // it), and honouring a stored override there would silently fight every Ctrl+wheel the moment this
    // effect re-ran. The stored value is left alone so a phone still uses it.
    if (isMobile && custom.zoom != null) applyZoomOverlay(custom.zoom);
    else applyGlobalZoom();
    return () => {
      applyGlobalCustomizationDom();
      applyGlobalZoom();
    };
  }, [primarySheet, isMobile, custom.themeId, custom.styleId, custom.density, custom.fontId, custom.accentColor, custom.consumableColor, custom.scrollbarAccent, custom.zoom]);
  // Reset the positive-modifier "+" display flag to its default when leaving the sheet (primary only).
  useEffect(() => {
    if (!primarySheet) return;
    return () => setPlusOnMods(true);
  }, [primarySheet]);
  // Start each tab at the top. The shell is clamped to the viewport on both desktop and mobile now, so
  // the inner .body element is the scroller — the window reset is kept for any layout that still scrolls
  // the document (and costs nothing when it doesn't).
  useEffect(() => {
    window.scrollTo(0, 0);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
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
  const diceOff = character.options?.diceRollerOff ?? true;
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
  // On-device sharp copy (installed app) when present, else the compressed/synced one. Used for the
  // full-size lightbox; the little round avatar beside the name uses the player's own square crop.
  const shownPortrait = usePortrait(character.appearance?.portraitRef, portrait);
  const avatar = useAvatar(character.appearance);

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

  if (partyOpen) {
    return (
      <PartyPage
        content={content}
        campaigns={attachedCampaigns}
        onClose={() => setPartyOpen(false)}
        onLeave={
          onLeaveCampaign
            ? (id) => {
                onLeaveCampaign(id);
                setPartyOpen(false); // this character is no longer attached → close the party view
              }
            : undefined
        }
      />
    );
  }

  return (
    <PinContext.Provider value={pinApi}>
    <div className={'ws-app' + (readOnly ? ' ws-readonly' : '')}>
      {readOnly && (
        <div className="ro-frame-tab">
          <i className="ti ti-eye" aria-hidden="true" /> Viewing {character.name} · read-only
        </div>
      )}
      {gmEdit && (
        <div className={'gm-edit-tab' + (isMobile ? ' is-mobile' : '')}>
          <i className="ti ti-wand" aria-hidden="true" /> GM editing {character.name} — changes reach the player only when you <strong>Update</strong>
        </div>
      )}
      <header className="chrome" data-tauri-drag-region>
        <div className="chrome-brand" data-tauri-drag-region>
          <HeroesHeavenLogo className="chrome-logo" /> Heroes Heaven
        </div>
        {!readOnly && !gmEdit && (
          <PageMenu
            items={[
              ...(onOpenHomebrew ? [{ label: 'Homebrew', icon: 'ti-flask', onClick: onOpenHomebrew }] : []),
              ...(onOpenCampaigns ? [{ label: 'Campaigns', icon: 'ti-flag', onClick: onOpenCampaigns }] : []),
              ...(onOpenRoster ? [{ label: 'Characters', icon: 'ti-users', onClick: onOpenRoster }] : []),
            ]}
            onOpenSettings={onOpenSettings}
          />
        )}
        <WindowControls />
      </header>

      <div className="identity">
        {portrait ? (
          <button
            type="button"
            className="portrait portrait-btn"
            data-shape={custom.portraitShape ?? 'circle'}
            title="View portrait"
            aria-label="View portrait full size"
            onClick={() => setPortraitOpen(true)}
          >
            <img src={avatar} alt="" className="portrait-img" />
          </button>
        ) : (
          <div className="portrait" data-shape={custom.portraitShape ?? 'circle'}>{initials}</div>
        )}
        <div className="identity-name">
          <div className="char-name">
            <span className="char-name-text">{character.name}</span>
            {custom.showLevelChip !== false && <span className="level-chip">Level {character.level}</span>}
          </div>
          {custom.showSubline !== false && (ancestry?.name || cls?.name) && (
            // Only join with "·" when BOTH sides exist — an unfinished character (no ancestry or no
            // class yet) otherwise showed a bare " · " with nothing around it.
            <div className="char-sub">
              {ancestry?.name && <span className="lk">{ancestry.name}</span>}
              {ancestry?.name && cls?.name ? ' · ' : ''}
              {cls?.name && <span className="lk">{cls.name}</span>}
            </div>
          )}
        </div>
        <div className="tabs-wrap">
          {tabScroll.left && (
            <button type="button" className="tabs-arrow" aria-label="Scroll tabs left" onClick={() => scrollTabs(-1)}>
              <i className="ti ti-chevron-left" aria-hidden="true" />
            </button>
          )}
          <nav className="tabs" role="tablist" ref={tabsRef}>
            {visibleTabs.map((t) => (
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
            {/* Party — a tab-styled action (opens the party overlay), only when this character is in a
                campaign. Desktop only (this .tabs strip is hidden on mobile; phones use the top-bar icon). */}
            {showParty && (
              <button type="button" className="tab party-tab" onClick={() => setPartyOpen(true)}>
                <i className="ti ti-users" aria-hidden="true" /> Party
              </button>
            )}
          </nav>
          {tabScroll.right && (
            <button type="button" className="tabs-arrow" aria-label="Scroll tabs right" onClick={() => scrollTabs(1)}>
              <i className="ti ti-chevron-right" aria-hidden="true" />
            </button>
          )}
        </div>
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
        {/* Phone: Party lives in the top bar beside Rest (this .icon-btn row is hidden-ish on desktop's
            wide bar; the desktop entry is the .tabs Party button above). */}
        {showParty && isMobile && (
          <button className="icon-btn" title="Party" aria-label="Party" onClick={() => setPartyOpen(true)}>
            <i className="ti ti-users" aria-hidden="true" />
          </button>
        )}
        {!readOnly && !gmEdit && onRest && (
          <button className="icon-btn" title="Daily preparations" onClick={() => setRestOpen(true)}>
            <i className="ti ti-bed" aria-hidden="true" />
          </button>
        )}
        {!readOnly && !gmEdit && !diceOff && (
          <button className="icon-btn" title="Dice roller" onClick={() => setDiceOpen(true)}>
            <i className="ti ti-dice" aria-hidden="true" />
          </button>
        )}
        {gmEdit ? (
          // GM edit: builder access + export + push-to-player, then Back (→ campaign detail). No nav
          // hamburger — the GM is editing one player's character, not navigating their own app.
          <>
            {onEdit && (
              <button className="icon-btn" title="Edit in builder" aria-label="Edit in builder" onClick={onEdit}>
                <i className="ti ti-edit" aria-hidden="true" />
              </button>
            )}
            <button className="icon-btn" title="Export character file" aria-label="Export character file" onClick={gmEdit.onExport}>
              <i className="ti ti-download" aria-hidden="true" />
            </button>
            <button className="btn-primary gm-update-btn" disabled={gmEdit.busy} onClick={gmEdit.onUpdate}>
              <i className="ti ti-cloud-upload" aria-hidden="true" /> Update
            </button>
            <button className="icon-btn" title="Back to campaign" aria-label="Back to campaign" onClick={onBack}>
              <i className="ti ti-arrow-left" aria-hidden="true" />
            </button>
          </>
        ) : readOnly ? (
          <button className="icon-btn" title="Back to party" aria-label="Back to party" onClick={onBack}>
            <i className="ti ti-arrow-left" aria-hidden="true" />
          </button>
        ) : (
          // Desktop: Edit + Customize are quick-access icons; the nav hamburger lives in the (hidden-on-
          // mobile) chrome bar. Mobile: the chrome bar is hidden, so the hamburger is rendered here and
          // Customize is moved INTO it (still per-character); Edit stays a quick-access icon.
          <>
            {/* Undo/redo were keyboard-only (Ctrl+Z / Ctrl+Shift+Z) — invisible on a tablet and
                undiscoverable everywhere else. The tracker has had these buttons all along.
                Settings → Interface can hide them again; on a phone header, where four controls is
                already a crowd, 'auto' does that by default. The shortcuts stay live either way. */}
            {showUndoButtons && undo && (
              <button className="icon-btn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={!canUndo} onClick={() => canUndo && undo()}>
                <i className="ti ti-arrow-back-up" aria-hidden="true" />
              </button>
            )}
            {showUndoButtons && redo && (
              <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={!canRedo} onClick={() => canRedo && redo()}>
                <i className="ti ti-arrow-forward-up" aria-hidden="true" />
              </button>
            )}
            {onEdit && (
              <button className="icon-btn" title="Edit character" aria-label="Edit character" onClick={onEdit}>
                <i className="ti ti-edit" aria-hidden="true" />
              </button>
            )}
            {!isMobile && onCustomize && (
              <button className="icon-btn" title="Customize" aria-label="Customize" onClick={() => setCustomizeOpen(true)}>
                <i className="ti ti-adjustments" aria-hidden="true" />
              </button>
            )}
            {isMobile && (
              <PageMenu
                items={[
                  ...(onOpenHomebrew ? [{ label: 'Homebrew', icon: 'ti-flask', onClick: onOpenHomebrew }] : []),
                  ...(onOpenCampaigns ? [{ label: 'Campaigns', icon: 'ti-flag', onClick: onOpenCampaigns }] : []),
                  ...(onOpenRoster ? [{ label: 'Characters', icon: 'ti-users', onClick: onOpenRoster }] : []),
                  ...(onCustomize ? [{ label: 'Customize', icon: 'ti-adjustments', onClick: () => setCustomizeOpen(true) }] : []),
                ]}
                onOpenSettings={onOpenSettings}
              />
            )}
          </>
        )}
        {portraitOpen && portrait && (
          <div className="portrait-lightbox" onClick={() => setPortraitOpen(false)} role="dialog" aria-label="Portrait">
            <img src={shownPortrait} alt={`${character.name} portrait`} className="portrait-lightbox-img" />
            <button className="portrait-lightbox-close" onClick={() => setPortraitOpen(false)} aria-label="Close">
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Notes get the whole width and own their scrolling: the rail is a play surface and this is a
          writing one (Customize → "Vitals rail on Notes" brings it back). */}
      <div className={'body' + (notesFull ? ' body-notes' : '')} ref={bodyRef}>
        {(!isMobile || tab === 'Main') && !notesFull && (
          <VitalsRail character={character} content={content} charKey={charKey} onPlay={onPlay} onOpenStat={setStatRef} onSaveMode={onSaveMode} onDeleteMode={onDeleteMode} onCreateItem={onCreateItem} />
        )}
        <main className="content">
          {tab === 'Main' ? (
            <MainTab character={character} content={content} onPlay={onPlay} onRoll={rollCheckFn} onOpenStat={setStatRef} section={isMobile ? 'main' : 'all'} />
          ) : tab === 'Actions' ? (
            <MainTab character={character} content={content} onPlay={onPlay} onRoll={rollCheckFn} onOpenStat={setStatRef} section={isMobile ? 'actions' : 'all'} />
          ) : tab === 'Spells' ? (
            <SpellsTab character={character} content={content} onPlay={onPlay} onOpenStat={setStatRef} />
          ) : tab === 'Inventory' ? (
            <InventoryTab character={character} content={content} onPlay={onPlay} onCreateItem={onCreateItem} gmView={!!gmEdit} />
          ) : tab === 'Feats & features' ? (
            <FeatsTab character={character} content={content} onPlay={onPlay} />
          ) : tab === 'Details' ? (
            <DetailsTab character={character} content={content} onPlay={onPlay} />
          ) : tab === 'Notes' ? (
            <NotesTab character={character} onPlay={onPlay} hidePrivate={readOnly} />
          ) : tab === 'Companions' ? (
            <CompanionsTab character={character} content={content} onPlay={onPlay} onSaveMode={onSaveMode} onDeleteMode={onDeleteMode} onCreateItem={onCreateItem} charKey={charKey} />
          ) : (
            // Every tab in TABS has a branch above; this is just a safe neutral fallback.
            <MainTab character={character} content={content} onPlay={onPlay} onRoll={rollCheckFn} onOpenStat={setStatRef} />
          )}
        </main>
      </div>

      {isMobile && (
        <nav className="mtabs" role="tablist" aria-label="Sections">
          {visibleMobileTabs.map((t) => (
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
        <div className="picker-overlay" onClick={closeRest}>
          <div className="picker confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>
                <i className="ti ti-moon" aria-hidden="true" /> Daily preparations
              </span>
              <button className="picker-close" onClick={closeRest} aria-label="Close">
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

              {/* Choices the rules re-make each morning. With "reuse", only never-answered ones show. */}
              {needsAsking.length > 0 && (
                <div className="daily-picks">
                  <h4 className="daily-picks-head">Choices for today</h4>
                  {needsAsking.map((ch) => (
                    <div className="daily-pick" key={ch.key}>
                      <div className="daily-pick-prompt">
                        {ch.prompt}
                        <span className="daily-pick-src">{ch.recordName}</span>
                      </div>
                      {ch.kind === 'text' ? (
                        // Quick Study's Lore subject and Call Gun's bonded weapon have no closed
                        // option set, so chips would misrepresent them — the player types it.
                        <input
                          className="daily-text"
                          type="text"
                          placeholder={`${ch.prompt}…`}
                          value={dailyAnswer(ch.key)}
                          onChange={(e) => setDailyDraft((d) => ({ ...d, [ch.key]: e.target.value }))}
                        />
                      ) : ch.kind === 'open' ? (
                        // An OPEN daily pick resolves from content — Aroden's Innovation offers every
                        // general feat of 3rd level or lower, far too many for chips.
                        <select
                          className="daily-text"
                          value={dailyAnswer(ch.key)}
                          onChange={(e) => setDailyDraft((d) => ({ ...d, [ch.key]: e.target.value }))}
                        >
                          <option value="">{`${ch.prompt}…`}</option>
                          {ch.options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.note ? `${o.label} (${o.note})` : o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="daily-pick-opts">
                          {ch.options.map((o) => (
                            <button
                              key={o.value}
                              type="button"
                              className={'daily-opt' + (dailyAnswer(ch.key) === o.value ? ' on' : '')}
                              title={o.description}
                              onClick={() => setDailyDraft((d) => ({ ...d, [ch.key]: o.value }))}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* The record's own caveat about its OWN answer — "this proficiency lasts
                          until you prepare again… you can't use it as a prerequisite". The def has
                          always carried it and there was nowhere to put it, so seven records printed
                          their most important rule to nobody. */}
                      {ch.note && <p className="confirm-note daily-pick-note">{ch.note}</p>}
                    </div>
                  ))}
                </div>
              )}

              {/* TEMPORARY ITEMS made during daily preparations — the scroll caches, Scroll Adept,
                  Herbal Forager. Seven records of this shape delivered nothing, because the only
                  field for it (advancedAlchemy) was alchemist-only and hardcoded to alchemical
                  items. Kept beside the daily choices, because that is when they are made. */}
              {dailyItems.length > 0 && (
                <div className="daily-choices">
                  <p className="confirm-note">Temporary items you make today:</p>
                  {dailyItems.map((slot) => {
                    const opts = dailyItemOptions(slot, character, content);
                    return (
                      <div className="daily-choice" key={slot.key}>
                        <div className="daily-choice-q">
                          {slot.label} <span className="sb-trait">{slot.sourceName}</span>
                        </div>
                        {opts.length === 0 ? (
                          <p className="confirm-note">
                            Nothing you can choose yet
                            {slot.fromSpellbook ? ' — no spell of that rank in your spellbook' : ''}.
                          </p>
                        ) : (
                          <PopupSelect
                            title={slot.label}
                            placeholder="Choose…"
                            value={dailyItemAnswer(slot.key)}
                            onChange={(v) => setDailyItemDraft((d) => ({ ...d, [slot.key]: v }))}
                            options={opts.map((o) => ({ value: o.id, label: o.name, description: o.note }))}
                          />
                        )}
                        {slot.note && <p className="confirm-note">{slot.note}</p>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* STAVES. A staff is prepared during daily preparations and gains charges equal to the
                  rank of your highest-rank spell slot — the app used to refill it to a pool sized by
                  the STAFF'S OWN level and never asked. Hidden for a character with no spell slots:
                  "you can't prepare a staff if you have no spell slots". */}
              {showStaves && (
                <div className="daily-choices">
                  <p className="confirm-note">Staves you prepare today:</p>
                  {staves.map((iv) => {
                    const it = content.items[iv.itemId];
                    const canPrep = preparableStaves.some((p) => p.instanceId === iv.instanceId);
                    const chosen = canPrep && iv.instanceId === chosenStaff;
                    return (
                      <div className="daily-choice" key={iv.instanceId}>
                        <div className="daily-choice-q">
                          {it?.name ?? iv.itemId}{' '}
                          <span className="sb-trait">
                            {!canPrep
                              ? 'Can’t prepare — none of its spells are on your spell list'
                              : chosen
                                ? `Prepare: ${staffCharges + staffBonus} charges`
                                : 'Not prepared today — 0 charges'}
                          </span>
                        </div>
                        {/* Only asked when there is a choice to make: one staff needs no radio. */}
                        {canPrep && preparableStaves.length > 1 && (
                          <div className="daily-pick-opts">
                            <button
                              type="button"
                              className={'daily-opt' + (chosen ? ' on' : '')}
                              onClick={() => setStaffPick(iv.instanceId)}
                            >
                              Prepare this staff
                            </button>
                          </div>
                        )}
                        {chosen && slotOptions.length > 0 && (
                          <PopupSelect
                            title="Expend a spell slot"
                            placeholder="Also expend a spell slot…"
                            value={staffSlotKey}
                            clearLabel="Don’t expend a slot"
                            onChange={(v) => setStaffSlotKey(v)}
                            options={slotOptions.map((o) => ({
                              value: optKeyOf(o),
                              label: `${ordinal(o.rank)}-rank slot (+${o.rank} charges)`,
                              note: slotOptions.some((x) => x.entryId !== o.entryId) ? o.entryName : undefined,
                            }))}
                          />
                        )}
                      </div>
                    );
                  })}
                  <p className="confirm-note">
                    A staff gains charges equal to the rank of your highest-rank spell slot ({staffCharges}). You may
                    expend one spell slot per day to add its rank on top, and no one can prepare more than one staff
                    per day.
                  </p>
                </div>
              )}

              {/* ADVANCED ALCHEMY. "During your daily preparations, you create infused items" — the
                  step the dialog never had, so the one thing an alchemist does every morning was only
                  reachable from a panel on another tab. The Main-tab panel stays for mid-day changes. */}
              {character.advancedAlchemy && (
                <div className="daily-choices">
                  <p className="confirm-note">
                    Advanced Alchemy — today’s infused items ({alchemyPrepared}/{alchemyBudget}):
                  </p>
                  {Object.entries(alchemyDraft).map(([itemId, qty]) => (
                    <div className="alchemy-row" key={itemId}>
                      <span className="alchemy-item-name">{content.items[itemId]?.name ?? itemId}</span>
                      <span className="alchemy-qty">
                        <button
                          type="button"
                          aria-label="Fewer"
                          onClick={() =>
                            setAlchemyDraft((d) => {
                              const next = { ...d, [itemId]: (d[itemId] ?? 0) - 1 };
                              if (next[itemId] <= 0) delete next[itemId];
                              return next;
                            })
                          }
                        >
                          −
                        </button>
                        <b>{qty}</b>
                        <button
                          type="button"
                          aria-label="More"
                          disabled={alchemyPrepared >= alchemyBudget}
                          onClick={() => setAlchemyDraft((d) => ({ ...d, [itemId]: (d[itemId] ?? 0) + 1 }))}
                        >
                          +
                        </button>
                      </span>
                    </div>
                  ))}
                  <button type="button" className="btn" onClick={() => setAlchemyPicker(true)}>
                    <i className="ti ti-flask" aria-hidden="true" /> Prepare item
                  </button>
                </div>
              )}

              {/* With "reuse" on and everything already answered, say what is being kept — a silent
                  re-application the player can't see is indistinguishable from a bug. */}
              {reuseDaily && needsAsking.length === 0 && dailyChoices.length > 0 && (
                <p className="confirm-note daily-keeping">
                  Keeping your last choices:{' '}
                  {dailyChoices
                    .map((ch) => `${ch.recordName} — ${dailyChoiceLabel(ch, storedDaily) ?? 'not set'}`)
                    .join(' · ')}
                </p>
              )}
            </div>
            <div className="confirm-actions">
              <button className="btn-ghost" onClick={closeRest}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={needsAsking.some((ch) => !dailyAnswer(ch.key))}
                title={
                  needsAsking.some((ch) => !dailyAnswer(ch.key))
                    ? 'Make each of today’s choices first'
                    : undefined
                }
                onClick={() => {
                  if (onPlay && (Object.keys(dailyDraft).length || Object.keys(dailyItemDraft).length)) {
                    onPlay((p) => ({
                      ...p,
                      dailyChoices: { ...(p.dailyChoices ?? {}), ...dailyDraft },
                      dailyItems: { ...(p.dailyItems ?? {}), ...dailyItemDraft },
                    }));
                  }
                  onRest();
                  /*
                   * AFTER onRest(), and that ordering is load-bearing. Both go through the same
                   * updatePlay queue, and rest() refills every counter to its STORED max, wipes
                   * expendedSlots/slotsUsed and clears yesterday's infused items — so a staff
                   * prepared, a slot expended or an item made before it would be undone by the same
                   * button press that made them.
                   */
                  if (onPlay && (showStaves || Object.keys(alchemyDraft).length)) {
                    onPlay((p) => {
                      let next = p;
                      if (showStaves) {
                        // ONE staff per day. Every other carried staff is explicitly zeroed rather
                        // than skipped: rest() refills each counter to its stored max, so a staff
                        // left alone would quietly keep yesterday's charges forever.
                        for (const iv of staves) {
                          const max = iv.instanceId === chosenStaff ? staffCharges + staffBonus : 0;
                          const cid = chargeCounterId(content.items[iv.itemId]) ?? 'pool';
                          next = updateInventoryItem(next, iv.instanceId, { staffCharges: max });
                          next = setItemCounter(next, iv.instanceId, cid, { current: max, max, resetsOnRest: true });
                        }
                        const opt = chosenStaff ? slotOptions.find((o) => optKeyOf(o) === staffSlotKey) : undefined;
                        if (opt)
                          next = opt.pool
                            ? setSlotsUsed(next, poolKey(opt.entryId, opt.rank), opt.pool.used + 1, opt.pool.max)
                            : toggleExpended(next, slotKeyOf(opt.entryId, opt.rank, opt.index ?? 0, opt.slot));
                      }
                      for (const [itemId, qty] of Object.entries(alchemyDraft)) next = setAlchemyItem(next, itemId, qty);
                      return next;
                    });
                  }
                  setDailyDraft({});
                  setDailyItemDraft({});
                  setStaffSlotKey('');
                  setStaffPick(null);
                  setAlchemyDraft({});
                  setRestOpen(false);
                }}
              >
                Prepare for the day
              </button>
            </div>
          </div>
          {/* The SAME picker the Main-tab panel opens, so the two surfaces cannot disagree about what
              this alchemist can make. Its picks land in the draft, not in play — Cancel discards. */}
          {alchemyPicker && character.advancedAlchemy && (
            <AlchemyPicker
              character={character}
              content={content}
              mode="advanced"
              prep={alchemyDraft}
              budget={alchemyBudget}
              spent={alchemyPrepared >= alchemyBudget}
              onPick={(itemId) =>
                setAlchemyDraft((d) => {
                  const total = Object.values(d).reduce((a, b) => a + b, 0);
                  return total >= alchemyBudget ? d : { ...d, [itemId]: (d[itemId] ?? 0) + 1 };
                })
              }
              onClose={() => setAlchemyPicker(false)}
            />
          )}
        </div>
      )}

      {customizeOpen && onCustomize && (
        <CustomizeModal
          character={character}
          globalDefault={globalCustomization ?? {}}
          onCustomize={onCustomize}
          onClose={() => setCustomizeOpen(false)}
        />
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
  onPlay: PlayUpdater;
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
    // Coalesced: the ±5 bump buttons are scrubbed to a target Speed — one undo step, not one per click.
    onPlay((p) => setTempSpeed(p, v === defaultLand ? undefined : v), 'temp-speed');
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
