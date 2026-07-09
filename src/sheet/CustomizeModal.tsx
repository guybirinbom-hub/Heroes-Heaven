import type { Character, Customization } from '../rules/types';
import { effectiveCustomization, isCustomizationEmpty, withCustomizationField, setGlobalCustomization, densityStyleId } from '../data/customization';
import { getAppearance, setTheme, setStyle, setFont, setAccent } from '../theme/theme-manager';
import { getZoom, setZoom } from '../theme/zoom';
import { CustomizationEditor } from './CustomizationEditor';
import { confirmDialog } from './confirm';

/**
 * Per-character Customize — a right-side DRAWER over the sheet (not a page) so changes preview live on the
 * sheet behind it. Edits this character's override; the editor shows the effective look (device Appearance
 * + global default + override). "Make global default" splits the effective look back to its homes — the
 * appearance axes to the device Appearance, the sheet options to the global customization default — so
 * every not-yet-customized character adopts it, without touching characters that have their own overrides.
 */
export function CustomizeModal({
  character,
  globalDefault,
  onCustomize,
  onClose,
}: {
  character: Character;
  globalDefault: Customization;
  onCustomize: (fn: (c: Character) => Character) => void;
  onClose: () => void;
}) {
  const override = character.customization;
  const customized = !isCustomizationEmpty(override);
  const app = getAppearance();
  // What an unset override field inherits: the sheet options from the global default, and the appearance
  // axes (palette/style/font/accent/zoom) from the device Appearance.
  const base: Customization = {
    ...effectiveCustomization(globalDefault, null),
    themeId: app.themeId,
    styleId: app.styleId,
    fontId: app.fontId,
    accentColor: app.accent ?? undefined,
    zoom: getZoom(),
  };

  const onChangeOverride = <K extends keyof Customization>(key: K, val: Customization[K] | undefined) =>
    onCustomize((c) => ({ ...c, customization: withCustomizationField(c.customization, key, val) }));

  const makeGlobal = async () => {
    const ok = await confirmDialog({
      title: 'Make this the global default?',
      message: (
        <>
          Every character that hasn&rsquo;t been customized will now use <strong>{character.name}</strong>&rsquo;s look.
          Characters you&rsquo;ve already customized keep their own settings.
        </>
      ),
      confirmLabel: 'Make default',
    });
    if (!ok) return;
    const eff = effectiveCustomization(globalDefault, override);
    const dev = getAppearance();
    // Appearance axes live at the device level; write this character's EFFECTIVE look there. Fall back to
    // the current device value for any axis the character didn't override, so promoting a character that
    // only changed (say) its palette doesn't wipe the device's style/font/accent/zoom. A legacy `density`
    // folds into the device Style so on- and off-sheet spacing agree.
    setTheme(eff.themeId ?? dev.themeId);
    setStyle(eff.styleId ?? densityStyleId(eff.density) ?? dev.styleId);
    setFont(eff.fontId ?? dev.fontId);
    setAccent(eff.accentColor ?? dev.accent ?? null);
    setZoom(eff.zoom ?? getZoom());
    // Everything else is the global sheet-customization default. setGlobalCustomization strips the
    // device-level appearance axes; drop the now-redundant density too (it's folded into the device Style).
    setGlobalCustomization({ ...eff, density: undefined });
  };

  const reset = async () => {
    const ok = await confirmDialog({
      title: 'Reset to the global default?',
      message: <>This clears {character.name}&rsquo;s own customization so it follows the global default again.</>,
      confirmLabel: 'Reset',
      danger: true,
    });
    if (ok) onCustomize((c) => ({ ...c, customization: undefined }));
  };

  return (
    <div className="cust-drawer-wrap" role="dialog" aria-label="Customize character">
      <div className="cust-drawer-backdrop" onClick={onClose} />
      <div className="cust-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="cust-drawer-head">
          <span className="cust-drawer-title">
            <i className="ti ti-adjustments" aria-hidden="true" /> Customize — {character.name}
          </span>
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="cust-drawer-actions">
          <button className="btn" onClick={makeGlobal}>
            <i className="ti ti-star" aria-hidden="true" /> Make global default
          </button>
          <button className="btn" disabled={!customized} onClick={reset}>
            <i className="ti ti-rotate" aria-hidden="true" /> Reset
          </button>
        </div>
        {!customized && <p className="settings-desc cust-drawer-note">This character follows the global default.</p>}
        <div className="cust-drawer-body">
          <CustomizationEditor value={override ?? {}} base={base} onChange={onChangeOverride} scope="character" />
        </div>
      </div>
    </div>
  );
}
