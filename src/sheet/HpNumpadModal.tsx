import { useState } from 'react';
import { useEscapeClose } from './useEscapeClose';

type Mode = 'damage' | 'heal' | 'temp' | 'set';
// Set mode isn't a segment — it's entered by tapping the current-HP number in the readout.
const MODES: { id: Exclude<Mode, 'set'>; label: string }[] = [
  { id: 'damage', label: 'Damage' },
  { id: 'heal', label: 'Heal' },
  { id: 'temp', label: 'Temp' },
];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Mobile HP entry: tap the HP display to open this numpad (no OS keyboard). Mode-first — pick
 * Damage / Heal / Temp / Set, type an amount on the on-screen pad (or a quick chip), and one Apply
 * button (re-labelled by mode) commits via the real play.ts mutators. A live preview mirrors those
 * mutators so what you see equals what Apply does, and the modal stays open so hits can be stacked.
 */
export function HpNumpadModal({
  current,
  max,
  temp,
  onDamage,
  onHeal,
  onSetHp,
  onSetTemp,
  onClose,
}: {
  current: number;
  max: number;
  temp: number;
  onDamage: (n: number) => void;
  onHeal: (n: number) => void;
  onSetHp: (n: number) => void;
  onSetTemp: (n: number) => void;
  onClose: () => void;
}) {
  useEscapeClose(onClose);
  const [mode, setMode] = useState<Mode>('damage');
  const [value, setValue] = useState('');
  const n = Math.abs(parseInt(value, 10)) || 0;

  // Live preview — mirrors the mutators (which compute HP math with conditions clear).
  let projected = current;
  let projTemp = temp;
  if (mode === 'damage') {
    projTemp = Math.max(0, temp - n);
    projected = clamp(current - Math.max(0, n - temp), 0, max);
  } else if (mode === 'heal') {
    projected = clamp(current + n, 0, max);
  } else if (mode === 'temp') {
    projTemp = n;
  } else {
    projected = clamp(n, 0, max);
  }
  const tempChanged = projTemp !== temp;
  const lethal = mode === 'damage' && n > 0 && projected <= 0;
  const applyDisabled = (mode === 'damage' || mode === 'heal') && n === 0;

  const apply = () => {
    if (applyDisabled) return;
    if (mode === 'damage') onDamage(n);
    else if (mode === 'heal') onHeal(n);
    else if (mode === 'temp') onSetTemp(n);
    else onSetHp(n);
    onClose(); // applying any entry (damage / heal / temp / set) closes the numpad
  };

  const press = (d: string) => setValue((v) => (v === '' ? d : String(parseInt(v + d, 10))).slice(0, 4));
  const applyLabel =
    mode === 'damage' ? `Deal Damage${n ? ` (${n})` : ''}`
      : mode === 'heal' ? `Heal${n ? ` (${n})` : ''}`
        : mode === 'temp' ? `Set Temp HP (${n})`
          : `Set HP (${n})`;

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker hp-numpad" role="dialog" aria-modal="true" aria-label="Hit points" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <span className="info-title">Hit points</span>
          <button className="picker-close" aria-label="Close" onClick={onClose}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        <div className={'np-readout' + (mode === 'damage' ? ' dmg' : mode === 'heal' ? ' heal' : mode === 'set' ? ' set' : '')}>
          <button type="button" className="np-from-tap" title="Tap to set HP directly" aria-label="Set HP directly" onClick={() => setMode('set')}>
            {current}
          </button>
          {mode !== 'temp' && (
            <>
              <i className="ti ti-arrow-right" aria-hidden="true" />
              <span className="to">{projected}</span>
            </>
          )}
          {lethal && <span className="np-dying"> · 0 HP · Dying</span>}
        </div>
        {tempChanged && (
          <div className="np-readout-sub">
            temp {temp} → {projTemp}
          </div>
        )}

        <div className="seg">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={'seg-btn' + (mode === m.id ? ' on' : '')} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>

        <div className={'np-display' + (value === '' ? ' empty' : '')}>{value === '' ? '0' : value}</div>

        <div className="np-grid">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} type="button" className="np-key" onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button type="button" className="np-key np-util" onClick={() => setValue('')} aria-label="Clear">
            C
          </button>
          <button type="button" className="np-key" onClick={() => press('0')}>
            0
          </button>
          <button type="button" className="np-key np-util" onClick={() => setValue((v) => v.slice(0, -1))} aria-label="Backspace">
            <i className="ti ti-backspace" aria-hidden="true" />
          </button>
        </div>

        <button type="button" className="btn-primary np-apply" disabled={applyDisabled} onClick={apply}>
          {applyLabel}
        </button>
      </div>
    </div>
  );
}
