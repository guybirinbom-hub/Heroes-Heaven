import { useEffect, useState } from 'react';
import { usePrefs } from '../data/prefs';

/**
 * The HP tracker UI used in the sidebar — current/max + temp, a fill bar, and either Damage/Heal
 * buttons or the quick-entry command field (Settings → Customization). Reused for companions,
 * vehicles, and siege weapons so their HP works exactly like the character's. Stateless about HOW
 * to mutate — the caller passes set/damage/heal handlers.
 */
export function HpControl({
  current,
  max,
  temp,
  editable = true,
  onSetCurrent,
  onSetTemp,
  onDamage,
  onHeal,
}: {
  current: number;
  max: number;
  temp: number;
  editable?: boolean;
  onSetCurrent?: (n: number) => void;
  onSetTemp?: (n: number) => void;
  onDamage?: (n: number) => void;
  onHeal?: (n: number) => void;
}) {
  const { hpCommandEntry } = usePrefs();
  const live = editable && !!onSetCurrent;
  const [hpDraft, setHpDraft] = useState(String(current));
  useEffect(() => setHpDraft(String(current)), [current]);
  const [tempDraft, setTempDraft] = useState(String(temp));
  useEffect(() => setTempDraft(String(temp)), [temp]);
  const [amt, setAmt] = useState('');

  const commitHp = () => {
    const n = parseInt(hpDraft, 10);
    if (live && Number.isFinite(n)) onSetCurrent!(n);
    else setHpDraft(String(current));
  };
  const commitTemp = () => {
    const n = parseInt(tempDraft, 10);
    if (live && Number.isFinite(n)) onSetTemp?.(Math.max(0, n));
    else setTempDraft(String(temp));
  };
  const num = () => Math.abs(parseInt(amt, 10)) || 0;
  const damage = () => {
    const n = num();
    if (n) onDamage?.(n);
    setAmt('');
  };
  const heal = () => {
    const n = num();
    if (n) onHeal?.(n);
    setAmt('');
  };
  // Quick-entry command: "N" = damage, "-N" = heal, "tN" = temp HP.
  const runCommand = () => {
    const raw = amt.trim();
    setAmt('');
    if (!raw) return;
    let m: RegExpMatchArray | null;
    if ((m = raw.match(/^t\s*(\d+)$/i))) onSetTemp?.(Math.max(0, parseInt(m[1], 10)));
    else if ((m = raw.match(/^-\s*(\d+)$/))) onHeal?.(parseInt(m[1], 10));
    else if ((m = raw.match(/^\+?\s*(\d+)$/))) onDamage?.(parseInt(m[1], 10));
  };
  const pct = max > 0 ? Math.round((Math.max(0, current) / max) * 100) : 0;

  return (
    <>
      <div className="hp-line">
        {live ? (
          <input
            className="hp-cur hp-cur-input"
            type="text"
            inputMode="numeric"
            value={hpDraft}
            aria-label="Current hit points — type to set"
            title="Set current HP"
            onChange={(e) => setHpDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commitHp}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitHp();
                e.currentTarget.blur();
              }
              if (e.key === 'Escape') {
                setHpDraft(String(current));
                e.currentTarget.blur();
              }
            }}
          />
        ) : (
          <span className="hp-cur">{current}</span>
        )}
        <span className="hp-max">/ {max}</span>
        {live && !hpCommandEntry ? (
          <span className="hp-temp" title="Temporary HP — type to set">
            +
            <input
              className="hp-temp-input"
              type="text"
              inputMode="numeric"
              value={tempDraft}
              aria-label="Temporary hit points — type to set"
              onChange={(e) => setTempDraft(e.target.value.replace(/[^0-9]/g, ''))}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={commitTemp}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  commitTemp();
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  setTempDraft(String(temp));
                  e.currentTarget.blur();
                }
              }}
            />
            temp
          </span>
        ) : (
          temp > 0 && <span className="hp-temp">+{temp} temp</span>
        )}
      </div>
      <div className="hp-track">
        <div className="hp-fill" style={{ width: pct + '%' }} />
      </div>
      {live &&
        (hpCommandEntry ? (
          <div className="hp-edit hp-edit-cmd">
            <input
              type="text"
              className="hp-amt hp-cmd"
              value={amt}
              placeholder="N dmg · -N heal · tN temp"
              aria-label="Quick HP entry — type a number for damage, -N to heal, tN for temporary HP, then Enter"
              onChange={(e) => setAmt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  runCommand();
                  e.currentTarget.blur();
                }
                if (e.key === 'Escape') {
                  setAmt('');
                  e.currentTarget.blur();
                }
              }}
            />
          </div>
        ) : (
          <div className="hp-edit">
            <button className="hp-heal" onClick={heal} title="Heal">
              <i className="ti ti-plus" aria-hidden="true" /> Heal
            </button>
            <input type="number" className="hp-amt" value={amt} placeholder="HP" aria-label="Amount to damage or heal" onChange={(e) => setAmt(e.target.value)} />
            <button className="hp-dmg" onClick={damage} title="Take damage">
              <i className="ti ti-droplet" aria-hidden="true" /> Damage
            </button>
          </div>
        ))}
    </>
  );
}
