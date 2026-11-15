import type { ModeDef } from '../rules/types';
import { modeTargetLabel } from '../rules/modes';
import { formatMod } from '../rules/derive';
import { useEscapeClose } from './useEscapeClose';
import { TrustMarker } from './TrustMarker';
import { trustHeldBack } from '../data/trustGate';

/**
 * What a mode actually does, in full: how long it lasts, its note, and every modifier spelled out one
 * per line rather than squashed into the one-line summary the list shows.
 *
 * Shared by the rail's active-mode pills and the Modes list, so pressing a mode means the same thing
 * wherever you press it.
 */
export function ModeDetailModal({ mode, onClose }: { mode: ModeDef; onClose: () => void }) {
  useEscapeClose(onClose);
  const held = !!trustHeldBack('modes', mode.id)?.length;
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
          {/* A mode the trust gate holds back keeps its toggle and applies nothing — the line says so
              under the name, above the text, as every record popup does (see TrustMarker). Not in the
              head: that row is a no-wrap flex row, so the line landed between the name and the X. */}
          <TrustMarker bucket="modes" id={mode.id} />
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
            !mode.note &&
            (held ? (
              /* Held back, not designed to do nothing: the sentence below would read as intent. The
                 marker above already says "Not yet verified", so this does not repeat it. */
              <p>Nothing on the sheet changes until its rules are verified.</p>
            ) : (
              <p>Nothing on the sheet changes — this is here so you can see it is running.</p>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
