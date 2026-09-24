import type { Customization } from '../rules/types';
import { DEFAULT_RAIL_ORDER, RAIL_CARD_LABELS, HIDEABLE_TABS } from '../data/customization';
import { themeConsumableColor } from '../theme/theme-manager';
import { getTheme, themeList } from '../theme/themes';
import { PaletteTile } from '../theme/PaletteTile';
import { styleList } from '../theme/styles';
import { fontList } from '../theme/fonts';
import { ZOOM_MAX, ZOOM_MIN } from '../theme/zoom';
import { useIsMobile } from './useIsMobile';

const ACCENTS = [
  '#6366f1', '#818cf8', '#0ea5e9', '#22d3ee', '#14b8a6', '#10b981', '#84cc16', '#c9a227',
  '#f59e0b', '#f97316', '#ef4444', '#f43f5e', '#ec4899', '#a855f7',
];

const PORTRAIT_SHAPES: { id: NonNullable<Customization['portraitShape']>; label: string }[] = [
  { id: 'circle', label: 'Circle' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'square', label: 'Square' },
];

/** How Daily preparations handles choices the rules re-make each morning. */
const DAILY_PREP_MODES: { id: NonNullable<Customization['dailyPrepPrompt']>; label: string }[] = [
  { id: 'ask', label: 'Ask each time' },
  { id: 'reuse', label: 'Reuse my last pick' },
];

/** How much an inventory card shows. Absent = 'essentials'. */
const ITEM_CARD_DETAILS: { id: NonNullable<Customization['itemCardDetail']>; label: string }[] = [
  { id: 'essentials', label: 'Essentials' },
  { id: 'compact', label: 'Compact' },
  { id: 'standard', label: 'Standard' },
];

/** How many COMPACT rows sit side by side. Absent = 'one'. Offered only while Compact is chosen. */
const COMPACT_COLUMNS: { id: NonNullable<Customization['compactColumns']>; label: string }[] = [
  { id: 'one', label: 'One wide row' },
  { id: 'three', label: 'Three columns' },
];

/** How the inventory lays its cards out, in all three looks. Absent = 'grid'. */
const INVENTORY_LAYOUTS: { id: NonNullable<Customization['inventoryLayout']>; label: string }[] = [
  { id: 'grid', label: 'Grid' },
  { id: 'flow', label: 'Flow' },
];

/** Where XP rides in the rail's Hit points card. Absent = 'chip'. */
const XP_DISPLAYS: { id: NonNullable<Customization['xpDisplay']>; label: string }[] = [
  { id: 'chip', label: 'Chip in the title' },
  { id: 'line', label: 'Line with a bar' },
];

/** Keys whose control is a simple on/off chip. */
type BoolKey =
  | 'showLevelChip'
  | 'showSubline'
  | 'plusOnMods'
  | 'showSaveDCs'
  | 'autoHideEmpty'
  | 'hpCommandEntry'
  | 'shieldAutoHardness'
  | 'hpIwrButtons'
  | 'compactActions'
  | 'showSlotBadges'
  | 'consumableHighlight'
  | 'inventoryReorderArrows'
  | 'scrollbarAccent'
  | 'notesShowRail';

/** Normalize a saved rail order to the full set (known ids first in saved order, then any missing). */
function normalizeRailOrder(order?: string[]): string[] {
  const saved = (order ?? []).filter((id) => DEFAULT_RAIL_ORDER.includes(id));
  return [...saved, ...DEFAULT_RAIL_ORDER.filter((id) => !saved.includes(id))];
}

/**
 * The full customization control set — the device Appearance axes (palette / style / font / accent /
 * zoom) AND the sheet options — used for BOTH the device-global default (Settings → Appearance,
 * scope="global") and a single character's override (Customize drawer, scope="character").
 *
 * `value` is the RAW value for this scope (the character's override, or a combined global object). A
 * field ABSENT here is inherited from `base`. Controls display the resolved value (value ?? base) but
 * drive their "inherited" state off the raw `value`; clearing a field (onChange key, undefined) makes it
 * inherit again. In the global scope the parent routes the appearance-axis keys to the device setters, so
 * those never carry an "inherit" state (they're always concrete) and no "Match device" chip is shown.
 */
export function CustomizationEditor({
  value,
  base,
  onChange,
  scope,
}: {
  value: Customization;
  base: Customization;
  onChange: <K extends keyof Customization>(key: K, val: Customization[K] | undefined) => void;
  scope: 'global' | 'character';
}) {
  const isMobile = useIsMobile();
  const perChar = scope === 'character';
  const railOrder = normalizeRailOrder(value.railOrder ?? base.railOrder);
  const railHidden = new Set(value.railHidden ?? base.railHidden ?? []);
  const hiddenTabs = new Set(value.hiddenTabs ?? base.hiddenTabs ?? []);

  // A boolean chip: shows the resolved on/off; toggling to the inherited value clears the field (inherit).
  const boolChip = (key: BoolKey, label: string) => {
    const cur = (value[key] ?? base[key]) as boolean | undefined;
    return (
      <button
        className={'chip' + (cur ? ' active' : '')}
        onClick={() => {
          const next = !cur;
          onChange(key, next === base[key] ? undefined : next);
        }}
      >
        {label} — {cur ? 'on' : 'off'}
      </button>
    );
  };

  // A single-choice axis (style/font). In character scope a leading "Match device" chip clears it.
  // The palette axis has its own row below — its options are drawn as miniatures, not chips.
  const axisRow = (
    key: 'styleId' | 'fontId',
    label: string,
    items: { id: string; name: string; stack?: string }[],
  ) => {
    const resolved = value[key] ?? base[key];
    return (
      <>
        <div className="menu-label">{label}</div>
        <div className="menu-row">
          {perChar && (
            <button className={'chip' + (value[key] == null ? ' active' : '')} onClick={() => onChange(key, undefined)}>
              Match device
            </button>
          )}
          {items.map((it) => {
            const active = perChar ? value[key] === it.id : resolved === it.id;
            return (
              <button
                key={it.id}
                className={'chip' + (active ? ' active' : '')}
                style={it.stack ? { fontFamily: it.stack } : undefined}
                onClick={() => onChange(key, it.id)}
              >
                {it.name}
              </button>
            );
          })}
        </div>
      </>
    );
  };

  const moveRail = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= railOrder.length) return;
    const arr = [...railOrder];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    onChange('railOrder', arr);
  };
  const toggleRailHidden = (id: string) => {
    const next = new Set(railHidden);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange('railHidden', [...next]);
  };
  const toggleTabHidden = (t: string) => {
    const next = new Set(hiddenTabs);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    onChange('hiddenTabs', [...next]);
  };

  const curShape = value.portraitShape ?? base.portraitShape ?? 'circle';
  const curDailyPrep = value.dailyPrepPrompt ?? base.dailyPrepPrompt ?? 'ask';
  const curXpDisplay = value.xpDisplay ?? base.xpDisplay ?? 'chip';
  const curItemCard = value.itemCardDetail ?? base.itemCardDetail ?? 'essentials';
  const curCompactCols = value.compactColumns ?? base.compactColumns ?? 'one';
  const curLayout = value.inventoryLayout ?? base.inventoryLayout ?? 'grid';
  const consumableOn = (value.consumableHighlight ?? base.consumableHighlight) as boolean | undefined;
  const consumableColor = value.consumableColor ?? base.consumableColor ?? themeConsumableColor();
  const curDefaultTab = value.defaultTab ?? base.defaultTab ?? '';
  // Keep the current default in the list even if that tab is now hidden, so the <select> never goes blank.
  const visibleTabsForDefault = ['Main', ...HIDEABLE_TABS.filter((t) => !hiddenTabs.has(t) || t === curDefaultTab)];
  // The accent the picker opens on is the one actually PAINTED, so dragging the native picker starts
  // from what's on screen rather than snapping to some default. Mirrors applyOverlayResolved's accent
  // fallback: a character that overrides the palette but leaves the accent alone gets THAT palette's
  // accent, not the device's (no cross-theme accent bleed).
  const inheritedAccent = perChar && value.themeId ? undefined : base.accentColor;
  const themeAccent = getTheme(value.themeId ?? base.themeId)?.tokens['--app-accent'] ?? ACCENTS[0];
  const curAccent = value.accentColor ?? inheritedAccent ?? themeAccent;
  // A hex the presets don't offer. Same field, same save/sync path — the swatches simply stop matching.
  const accentIsCustom = value.accentColor != null && !ACCENTS.includes(value.accentColor);
  const curZoom = value.zoom ?? base.zoom ?? 1;
  // Zoom caps at 1.0 on phones (matches the device zoom clamp) so the "+" doesn't dead-click past 100%.
  const zMax = isMobile ? 1 : ZOOM_MAX;
  const bumpZoomTo = (delta: number) => onChange('zoom', Math.min(zMax, Math.max(ZOOM_MIN, Math.round((curZoom + delta) * 20) / 20)));

  return (
    <div className="custom-editor">
      {perChar && (
        <p className="settings-desc">
          Changes here apply to this character only, live. Anything you leave untouched follows the global default
          (Settings → Appearance). Use the buttons above to make this look the global default, or reset it back.
        </p>
      )}

      {/* Appearance axes */}
      <div className="menu-label">Palette</div>
      <div className="menu-row">
        {perChar && (
          <button className={'chip' + (value.themeId == null ? ' active' : '')} onClick={() => onChange('themeId', undefined)}>
            Match device
          </button>
        )}
        {themeList.map((t) => (
          <PaletteTile
            key={t.id}
            theme={t}
            // Per-character, an unset field means "match device" — pass it through so nothing shows as
            // chosen here and the Match device chip is the one lit.
            selectedId={perChar ? value.themeId : value.themeId ?? base.themeId}
            onPick={() => onChange('themeId', t.id)}
          />
        ))}
      </div>
      {axisRow('styleId', 'Style', styleList.map((s) => ({ id: s.id, name: s.name })))}
      {axisRow('fontId', 'Font', fontList.map((f) => ({ id: f.id, name: f.name, stack: f.stack })))}

      <div className="menu-label">Accent colour</div>
      <div className="menu-row">
        <button className={'chip' + (value.accentColor == null ? ' active' : '')} onClick={() => onChange('accentColor', undefined)}>
          {perChar ? 'Match device' : 'Theme default'}
        </button>
        {ACCENTS.map((c) => (
          <button
            key={c}
            className={'accent-swatch' + (value.accentColor === c ? ' active' : '')}
            style={{ background: c }}
            aria-label={'accent ' + c}
            onClick={() => onChange('accentColor', c)}
          />
        ))}
        {/* Any colour at all. The fourteen swatches above are shortcuts, not the limit — this writes the
            same accentColor field, so a hand-picked hex saves, syncs and applies exactly like a preset. */}
        <label className={'color-field' + (accentIsCustom ? ' active' : '')} title="Any accent colour">
          <input
            type="color"
            value={curAccent}
            aria-label="Custom accent colour"
            onChange={(e) => onChange('accentColor', e.target.value)}
          />
          <span>{accentIsCustom ? curAccent : 'Custom'}</span>
        </label>
      </div>

      {/* Phones only. On a desktop keyboard Ctrl +/−/0 and Ctrl+wheel already zoom, and that level is
          persisted across restarts — a second way to set it just competed with the one people use. */}
      {isMobile && (
        <>
          <div className="menu-label">Zoom</div>
          <div className="menu-row zoom-row">
            {perChar && (
              <button className={'chip' + (value.zoom == null ? ' active' : '')} onClick={() => onChange('zoom', undefined)}>
                Match device
              </button>
            )}
            <button className="chip" aria-label="Zoom out" onClick={() => bumpZoomTo(-0.1)} disabled={curZoom <= ZOOM_MIN}>
              <i className="ti ti-minus" aria-hidden="true" />
            </button>
            <span className="zoom-val">{Math.round(curZoom * 100)}%</span>
            <button className="chip" aria-label="Zoom in" onClick={() => bumpZoomTo(0.1)} disabled={curZoom >= zMax}>
              <i className="ti ti-plus" aria-hidden="true" />
            </button>
          </div>
        </>
      )}

      {/* Per-character look */}
      <div className="menu-label">Portrait shape</div>
      <div className="menu-row">
        {PORTRAIT_SHAPES.map((s) => (
          <button
            key={s.id}
            className={'chip' + (curShape === s.id ? ' active' : '')}
            onClick={() => onChange('portraitShape', s.id === (base.portraitShape ?? 'circle') ? undefined : s.id)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="menu-label">Name line</div>
      <div className="menu-row">
        {boolChip('showLevelChip', 'Level chip')}
        {boolChip('showSubline', 'Ancestry · class subline')}
      </div>

      {/* Rail & tabs */}
      <div className="menu-label">Sidebar cards</div>
      <p className="settings-desc" style={{ marginTop: 0 }}>Reorder or hide the cards in the left rail.</p>
      <div className="rail-editor">
        {railOrder.map((id, i) => (
          <div className={'rail-editor-row' + (railHidden.has(id) ? ' off' : '')} key={id}>
            <span className="rail-editor-name">{RAIL_CARD_LABELS[id] ?? id}</span>
            <span className="rail-editor-actions">
              <button aria-label="Move up" disabled={i === 0} onClick={() => moveRail(i, -1)}>
                <i className="ti ti-chevron-up" aria-hidden="true" />
              </button>
              <button aria-label="Move down" disabled={i === railOrder.length - 1} onClick={() => moveRail(i, 1)}>
                <i className="ti ti-chevron-down" aria-hidden="true" />
              </button>
              <button aria-label={railHidden.has(id) ? 'Show card' : 'Hide card'} className="rail-editor-eye" onClick={() => toggleRailHidden(id)}>
                <i className={'ti ' + (railHidden.has(id) ? 'ti-eye-off' : 'ti-eye')} aria-hidden="true" />
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="menu-label">Tabs</div>
      <p className="settings-desc" style={{ marginTop: 0 }}>Hide tabs you don't use (Main always stays).</p>
      <div className="menu-row">
        {HIDEABLE_TABS.map((t) => (
          <button key={t} className={'chip' + (!hiddenTabs.has(t) ? ' active' : '')} onClick={() => toggleTabHidden(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="menu-label">Opens on</div>
      <div className="menu-row">
        <label className="custom-select">
          <select value={curDefaultTab} onChange={(e) => onChange('defaultTab', e.target.value || undefined)}>
            <option value="">Remember last tab</option>
            {visibleTabsForDefault.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="menu-label">Notes</div>
      <div className="menu-row">{boolChip('notesShowRail', 'Vitals rail on the Notes tab')}</div>
      <p className="settings-desc" style={{ marginTop: 0 }}>
        Off by default: notes are for writing, and the rail costs them a fifth of the width. Turn it on to keep
        HP, saves and conditions beside the page.
      </p>

      {/* Content & behaviour */}
      <div className="menu-label">Numbers</div>
      <div className="menu-row">
        {boolChip('plusOnMods', 'Show + on modifiers')}
        {boolChip('showSaveDCs', 'Show DCs')}
      </div>

      <div className="menu-label">Sections</div>
      <div className="menu-row">{boolChip('autoHideEmpty', 'Auto-hide empty tabs')}</div>
      <p className="settings-desc" style={{ marginTop: 0 }}>Hides the Spells and Companions tabs when this character has none.</p>

      <div className="menu-label">Hit points</div>
      <div className="menu-row">{boolChip('hpCommandEntry', 'Quick HP entry')}</div>
      <p className="settings-desc" style={{ marginTop: 0 }}>
        Replaces the Damage / Heal buttons with one field: a number damages, <strong>-N</strong> heals, <strong>tN</strong>{' '}
        sets temp HP.
      </p>

      <div className="menu-label">XP display</div>
      <div className="menu-row">
        {XP_DISPLAYS.map((m) => (
          <button
            key={m.id}
            className={'chip' + (curXpDisplay === m.id ? ' active' : '')}
            onClick={() => onChange('xpDisplay', m.id === (base.xpDisplay ?? 'chip') ? undefined : m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="settings-desc" style={{ marginTop: 0 }}>
        XP sits in the Hit points card. <strong>Chip in the title</strong> rides in the card's title row and costs no
        height; <strong>Line with a bar</strong> adds a thin <strong>XP 340 / 1000</strong> row with a progress bar above
        the HP numbers. Press either one to set the total or add XP — on the phone too.
      </p>

      <div className="menu-label">Daily preparations</div>
      <div className="menu-row">
        {DAILY_PREP_MODES.map((m) => (
          <button
            key={m.id}
            className={'chip' + (curDailyPrep === m.id ? ' active' : '')}
            onClick={() => onChange('dailyPrepPrompt', m.id === (base.dailyPrepPrompt ?? 'ask') ? undefined : m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="settings-desc" style={{ marginTop: 0 }}>
        Some feats are re-chosen every morning — Environmental Adaptability's cold-or-heat, for one.{' '}
        <strong>Ask each time</strong> offers those choices whenever you rest.{' '}
        <strong>Reuse my last pick</strong> keeps what you chose before without asking; if you've never
        chosen, the next rest asks once and reuses that answer from then on.
      </p>

      <div className="menu-label">Resistances &amp; weaknesses</div>
      <div className="menu-row">{boolChip('hpIwrButtons', 'One-tap damage adjusters')}</div>
      <p className="settings-desc" style={{ marginTop: 0 }}>
        In the HP entry pad, type the damage you took and tap <strong>Resistance fire 5</strong> (or a weakness) to apply the
        maths for you. Only shown while entering damage, and only for a character that actually has one. Immunity isn't
        offered — immune damage is 0, so there's nothing to type.
      </p>

      <div className="menu-label">Shield</div>
      <div className="menu-row">{boolChip('shieldAutoHardness', 'Auto-subtract Hardness')}</div>
      <p className="settings-desc" style={{ marginTop: 0 }}>
        In the side rail, the number you type into the shield's Damage box is the hit the shield took — its{' '}
        <strong>Hardness</strong> is subtracted automatically. Off = the shield loses exactly what you type. Your own HP is
        never changed either way.
      </p>

      <div className="menu-label">Actions list</div>
      <div className="menu-row">{boolChip('compactActions', 'Compact actions')}</div>

      {isMobile && (
        <>
          <div className="menu-label">Spells</div>
          <div className="menu-row">{boolChip('showSlotBadges', 'Slot count on rank tabs')}</div>
        </>
      )}

      <div className="menu-label">Item card detail</div>
      <div className="menu-row">
        {ITEM_CARD_DETAILS.map((m) => (
          <button
            key={m.id}
            className={'chip' + (curItemCard === m.id ? ' active' : '')}
            onClick={() => onChange('itemCardDetail', m.id === (base.itemCardDetail ?? 'essentials') ? undefined : m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="settings-desc" style={{ marginTop: 0 }}>
        How much each inventory card shows. <strong>Essentials</strong> keeps the name, quantity, Bulk and price, and
        under them only what changes in play — equipped, invested, charges, runes. <strong>Compact</strong> is one line
        an item (the price appears when you point at the row). <strong>Standard</strong> is the older, taller card with
        the item level and every button. Whatever a smaller card leaves out is still in the item's own page.
      </p>

      <div className="menu-label">Reorder arrows</div>
      <div className="menu-row">{boolChip('inventoryReorderArrows', 'Up/down arrows on each row')}</div>
      <p className="settings-desc" style={{ marginTop: 0 }}>
        On a <strong>phone</strong>, two arrows on every inventory row that move the item up or down within its
        section, so you can put your gear in the order you want it. On a computer you drag a row between its
        neighbours instead — a line shows where it will land — so the arrows are not shown there.
      </p>

      {/* Compact's alone — the taller cards read fine three across — so the control is only here while
          Compact is the chosen look, rather than sitting greyed out under every other one. */}
      {curItemCard === 'compact' && (
        <>
          <div className="menu-label">Compact rows</div>
          <div className="menu-row">
            {COMPACT_COLUMNS.map((m) => (
              <button
                key={m.id}
                className={'chip' + (curCompactCols === m.id ? ' active' : '')}
                onClick={() => onChange('compactColumns', m.id === (base.compactColumns ?? 'one') ? undefined : m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="settings-desc" style={{ marginTop: 0 }}>
            For the <strong>Compact</strong> look. <strong>One wide row</strong> gives each item the whole width on a
            computer, so its tags — worn, wielded, invested, charges — sit beside the name instead of waiting in the
            item's page; on a <strong>phone</strong> there is only ever one item across either way, so what it buys
            there instead is that a tag which doesn't fit beside the name wraps onto a second line under it rather
            than being left out. <strong>Three columns</strong> fits three items across on a computer and falls back
            to that same single phone row, but there a tag still only shows when the row has room for the whole of
            it, and the rest wait in the item's page. <strong>Flow</strong> below never leaves a tag out either, in
            every look and at every width, and with Flow chosen this setting has nothing left to decide.
          </p>
        </>
      )}

      <div className="menu-label">Inventory layout</div>
      <div className="menu-row">
        {INVENTORY_LAYOUTS.map((m) => (
          <button
            key={m.id}
            className={'chip' + (curLayout === m.id ? ' active' : '')}
            onClick={() => onChange('inventoryLayout', m.id === (base.inventoryLayout ?? 'grid') ? undefined : m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="settings-desc" style={{ marginTop: 0 }}>
        <strong>Grid</strong> lays the items out in equal cells. <strong>Flow</strong> makes each item exactly as wide
        as its own name and tags and wraps them across the page like words in a paragraph — a rope takes a short card,
        a Greater Striking Longsword a long one. Works with all three looks above.
      </p>

      <div className="menu-label">Consumables</div>
      <div className="menu-row">{boolChip('consumableHighlight', 'Colour-code consumables')}</div>
      {consumableOn && (
        <div className="menu-row consumable-row">
          <label className="color-field" title="Highlight colour for consumable inventory cards">
            <input type="color" value={consumableColor} aria-label="Consumable highlight colour" onChange={(e) => onChange('consumableColor', e.target.value)} />
            <span>{value.consumableColor ? 'Custom colour' : 'Theme default'}</span>
          </label>
          <button className="chip" onClick={() => onChange('consumableColor', undefined)} disabled={value.consumableColor === undefined}>
            Use theme default
          </button>
        </div>
      )}

      <div className="menu-label">Scrollbars</div>
      <div className="menu-row">{boolChip('scrollbarAccent', 'Accent scrollbars')}</div>
    </div>
  );
}
