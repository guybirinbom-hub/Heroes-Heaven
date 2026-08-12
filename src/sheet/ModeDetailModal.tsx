import type { ModeDef } from '../rules/types';
import { modeTargetLabel } from '../rules/modes';
import { formatMod } from '../rules/derive';
import { useEscapeClose } from './useEscapeClose';

/**
 * What a mode actually does, in full: how long it lasts, its note, and every modifier spelled out one
 * per line rather than squashed into the one-line summary the list shows.
 *
 * Shared by the rail's active-mode pills and the Modes list, so pressing a mode means the same thing
 * wherever you press it.
 */
export function ModeDetailModal({ mode, onClose }: { mode: ModeDef; onClose: () => void }) {
  useEscapeClose(onClose);
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker confirm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={mode.name}>
        <div className="picker-head">
          <span>{mode.name}</span>
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="confirm-body">
          {mode.duration && <p className="mode-info-dur">Lasts {mode.duration}.</p>}
          {mode.note && <p>{mode.note}</p>}
          {mode.modifiers.length > 0 ? (
            <ul className="mode-info-mods">
              {mode.modifiers.map((mod, i) => (
                <li key={i}>
                  <strong>{formatMod(mod.value)}</strong> {mod.type} to {modeTargetLabel(mod)}
                  {mod.appliesWhen && <span className="mode-info-when"> — {mod.appliesWhen}</span>}
                </li>
              ))}
            </ul>
          ) : (
            !mode.note && <p>Nothing on the sheet changes — this is here so you can see it is running.</p>
          )}
        </div>
      </div>
    </div>
  );
}
