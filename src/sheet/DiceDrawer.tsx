import { useState } from 'react';
import type { DieSides, DicePreset, RollResult } from '../rules/dice';
import { useEscapeClose } from './useEscapeClose';
import { confirmDialog } from './confirm';

const DICE: DieSides[] = [4, 6, 8, 10, 12, 20, 100];

/** The dice roller drawer: a manual roller on top, saved presets, then the roll history. */
export function DiceDrawer({
  rolls,
  presets,
  onRoll,
  onClear,
  onSavePreset,
  onDeletePreset,
  onClose,
}: {
  rolls: RollResult[];
  presets: DicePreset[];
  onRoll: (label: string, count: number, sides: number, modifier: number) => void;
  onClear: () => void;
  onSavePreset: (p: Omit<DicePreset, 'id'>) => void;
  onDeletePreset: (id: string) => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const [count, setCount] = useState(1);
  const [sides, setSides] = useState<DieSides>(20);
  const [modifier, setModifier] = useState(0);
  const [label, setLabel] = useState('');

  function rollNow() {
    onRoll(label.trim() || `${count}d${sides}`, count, sides, modifier);
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside className="dice-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span>
            <i className="ti ti-dice" aria-hidden="true" /> Dice roller
          </span>
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className="dice-config">
          <input
            className="dice-label"
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && rollNow()}
          />
          <div className="dice-row">
            <label>
              Count
              <input
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))}
              />
            </label>
            <label>
              Die
              <select value={sides} onChange={(e) => setSides(Number(e.target.value) as DieSides)}>
                {DICE.map((d) => (
                  <option key={d} value={d}>
                    d{d}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Mod
              <input type="number" value={modifier} onChange={(e) => setModifier(parseInt(e.target.value, 10) || 0)} />
            </label>
            <button className="dice-roll-btn" onClick={rollNow}>
              Roll
            </button>
          </div>
          <div className="dice-quick">
            {DICE.map((d) => (
              <button key={d} className="dice-quick-btn" title={`Roll 1d${d}`} onClick={() => onRoll(`d${d}`, 1, d, 0)}>
                d{d}
              </button>
            ))}
          </div>
        </div>

        <div className="dice-hist-head">
          <span>Presets</span>
          <button
            className="dice-save"
            title="Save the current Count/Die/Mod as a preset"
            onClick={() => onSavePreset({ label: label.trim() || `${count}d${sides}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`, count, sides, modifier })}
          >
            + Save current
          </button>
        </div>
        <div className="dice-quick">
          {presets.length === 0 && <div className="dice-empty">No presets. Set a roll above and “Save current” (e.g. damage 2d12+8).</div>}
          {presets.map((p) => (
            <span key={p.id} className="dice-preset">
              <button className="dice-quick-btn" title={`Roll ${p.count}d${p.sides}${p.modifier ? (p.modifier > 0 ? `+${p.modifier}` : p.modifier) : ''}`} onClick={() => onRoll(p.label, p.count, p.sides, p.modifier)}>
                {p.label}
              </button>
              <button
                className="dice-preset-x"
                title="Delete preset"
                aria-label="Delete preset"
                onClick={async () => {
                  if (await confirmDialog({ title: `Delete preset “${p.label}”?`, confirmLabel: 'Delete', danger: true }))
                    onDeletePreset(p.id);
                }}
              >
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>

        <div className="dice-hist-head">
          <span>History</span>
          {rolls.length > 0 && (
            <button
              className="dice-clear"
              title="Clear the roll history"
              onClick={async () => {
                if (await confirmDialog({ title: 'Clear roll history?', message: 'All past rolls are removed.', confirmLabel: 'Clear', danger: true }))
                  onClear();
              }}
            >
              <i className="ti ti-trash" aria-hidden="true" /> Clear
            </button>
          )}
        </div>
        <div className="dice-hist">
          {rolls.length === 0 && <div className="dice-empty">No rolls yet. Roll some dice or click a stat on the sheet.</div>}
          {rolls.map((r) => (
            <div className={'dice-entry' + (r.d20?.outcome ? ' ' + r.d20.outcome : '')} key={r.id}>
              <div className="dice-entry-main">
                <span className="dice-entry-label">{r.label}</span>
                <span className="dice-entry-total">{r.total}</span>
              </div>
              <div className="dice-entry-detail">
                <span className="dice-entry-formula">{r.formula}</span>
                <span className="dice-entry-faces">
                  [{r.dice.join(', ')}]
                  {r.modifier ? (r.modifier > 0 ? ` +${r.modifier}` : ` ${r.modifier}`) : ''}
                </span>
                {r.d20?.outcome === 'crit' && <span className="dice-flag crit">nat 20</span>}
                {r.d20?.outcome === 'fumble' && <span className="dice-flag fumble">nat 1</span>}
              </div>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
