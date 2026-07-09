import type { Customization } from '../rules/types';
import { DEFAULT_RAIL_ORDER, RAIL_CARD_LABELS, HIDEABLE_TABS } from '../data/customization';
import { themeConsumableColor } from '../theme/theme-manager';
import { themeList } from '../theme/themes';
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

/** Keys whose control is a simple on/off chip. */
type BoolKey =
  | 'showLevelChip'
  | 'showSubline'
  | 'plusOnMods'
  | 'showSaveDCs'
  | 'autoHideEmpty'
  | 'hpCommandEntry'
  | 'compactActions'
  | 'showSlotBadges'
  | 'consumableHighlight'
  | 'scrollbarAccent';

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

  // A single-choice axis (palette/style/font). In character scope a leading "Match device" chip clears it.
  const axisRow = (
    key: 'themeId' | 'styleId' | 'fontId',
    label: string,
    items: { id: string; name: string; swatch?: string; stack?: string }[],
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
                {it.swatch && <span className="chip-swatch" style={{ background: it.swatch }} />}
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
  const consumableOn = (value.consumableHighlight ?? base.consumableHighlight) as boolean | undefined;
  const consumableColor = value.consumableColor ?? base.consumableColor ?? themeConsumableColor();
  const curDefaultTab = value.defaultTab ?? base.defaultTab ?? '';
  // Keep the current default in the list even if that tab is now hidden, so the <select> never goes blank.
  const visibleTabsForDefault = ['Main', ...HIDEABLE_TABS.filter((t) => !hiddenTabs.has(t) || t === curDefaultTab)];
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
      {axisRow('themeId', 'Palette', themeList.map((t) => ({ id: t.id, name: t.name, swatch: t.tokens['--app-accent'] })))}
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
      </div>

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

      {/* Content & behaviour */}
      <div className="menu-label">Numbers</div>
      <div className="menu-row">
        {boolChip('plusOnMods', 'Show + on modifiers')}
        {boolChip('showSaveDCs', 'Show save DCs')}
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

      <div className="menu-label">Actions list</div>
      <div className="menu-row">{boolChip('compactActions', 'Compact actions')}</div>

      {isMobile && (
        <>
          <div className="menu-label">Spells</div>
          <div className="menu-row">{boolChip('showSlotBadges', 'Slot count on rank tabs')}</div>
        </>
      )}

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
