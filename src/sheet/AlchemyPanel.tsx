import { useMemo, useState } from 'react';
import type { AbilityId, Character, ContentDatabase } from '../rules/types';
import { abilityMod } from '../rules/derive';
import { CLASS_RESOURCES, resourceMax } from '../rules/classResources';
import { setAlchemyItem, quickAlchemy, type PlayUpdater } from '../rules/play';

/**
 * Alchemist play aid (Remaster): the day's infused items ("what I made today") + Quick Alchemy.
 * - Advanced Alchemy: prepare up to 4 + Int alchemical items (≤ your level) — a usable list with qty
 *   steppers + Use. No coin/vial cost (they're your daily infused items).
 * - Quick Alchemy: spend one Versatile Vial to make an item on the fly (beyond the daily budget).
 * Formulas aren't tracked, so the picker offers every alchemical item you're eligible for — you pick
 * the ones you actually know.
 */
export function AlchemyPanel({ character, content, onPlay }: { character: Character; content: ContentDatabase; onPlay?: PlayUpdater }) {
  const [picker, setPicker] = useState<null | 'advanced' | 'quick'>(null);
  const [q, setQ] = useState('');

  const intMod = abilityMod(character.abilities.int);
  const budget = 4 + intMod; // Advanced Alchemy: 4 + Int items during daily prep
  const vialDef = (CLASS_RESOURCES['alchemist'] ?? []).find((r) => r.id === 'versatile-vials');
  const abilityMods = Object.fromEntries(Object.entries(character.abilities).map(([k, v]) => [k, abilityMod(v as number)])) as Record<AbilityId, number>;
  const vialMax = vialDef ? resourceMax(vialDef, character.level, abilityMods) : 2 + intMod;
  const vialsCur = character.classResources?.['versatile-vials'] ?? vialMax;
  const prep = character.alchemyPrep ?? {};
  const preparedCount = Object.values(prep).reduce((a, b) => a + b, 0);

  const eligible = useMemo(
    () => Object.values(content.items).filter((it) => (it.traits ?? []).includes('alchemical') && (it.level ?? 0) <= character.level),
    [content.items, character.level],
  );
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return eligible
      .filter((it) => !s || it.name.toLowerCase().includes(s))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 80);
  }, [eligible, q]);

  if (!onPlay) return null; // read-only viewer — no controls

  const pick = (itemId: string) => {
    if (picker === 'quick') {
      onPlay((p) => quickAlchemy(p, itemId, p.resources?.['versatile-vials'] ?? vialMax, vialMax));
    } else {
      onPlay((p) => {
        const total = Object.values(p.alchemyPrep ?? {}).reduce((a, b) => a + b, 0);
        if (total >= budget) return p; // Advanced Alchemy budget reached
        return setAlchemyItem(p, itemId, (p.alchemyPrep?.[itemId] ?? 0) + 1);
      });
    }
  };
  const bump = (itemId: string, delta: number) => onPlay((p) => setAlchemyItem(p, itemId, (p.alchemyPrep?.[itemId] ?? 0) + delta));

  return (
    <div className="alchemy-panel">
      <div className="alchemy-head">
        <span className="alchemy-title">Alchemy</span>
        <span className="alchemy-meta">
          Versatile Vials {vialsCur}/{vialMax} · prepared {preparedCount}/{budget}
        </span>
      </div>
      <div className="alchemy-actions">
        <button type="button" className="btn" onClick={() => { setPicker('advanced'); setQ(''); }}>
          <i className="ti ti-flask" aria-hidden="true" /> Prepare item
        </button>
        <button
          type="button"
          className="btn"
          disabled={vialsCur < 1}
          title={vialsCur < 1 ? 'No Versatile Vials left' : 'Spend a Versatile Vial to make an item now'}
          onClick={() => { setPicker('quick'); setQ(''); }}
        >
          <i className="ti ti-bolt" aria-hidden="true" /> Quick Alchemy (−1 vial)
        </button>
      </div>
      {Object.keys(prep).length > 0 && (
        <div className="alchemy-list">
          {Object.entries(prep).map(([itemId, qty]) => (
            <div className="alchemy-row" key={itemId}>
              <span className="alchemy-item-name">{content.items[itemId]?.name ?? itemId}</span>
              <span className="alchemy-qty">
                <button type="button" aria-label="Fewer" onClick={() => bump(itemId, -1)}>−</button>
                <b>{qty}</b>
                <button type="button" aria-label="More" onClick={() => bump(itemId, 1)}>+</button>
              </span>
              <button type="button" className="alchemy-use" onClick={() => bump(itemId, -1)}>Use</button>
            </div>
          ))}
        </div>
      )}
      {picker && (
        <div className="picker-overlay" onClick={() => setPicker(null)}>
          <div className="picker alchemy-picker" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span className="info-title">{picker === 'quick' ? 'Quick Alchemy — spend a vial' : 'Prepare an infused item'}</span>
              <button type="button" className="picker-close" onClick={() => setPicker(null)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            {picker === 'advanced' && preparedCount >= budget && (
              <p className="alchemy-cap-note">You've prepared your daily maximum ({budget}). Remove one to prepare another.</p>
            )}
            <input className="hb-input" autoFocus placeholder="Search alchemical items…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="alchemy-pick-list">
              {shown.map((it) => (
                <button type="button" key={it.id} className="alchemy-pick" onClick={() => pick(it.id)}>
                  <span>{it.name}</span>
                  <span className="alchemy-pick-lvl">Lvl {it.level ?? 0}</span>
                </button>
              ))}
              {shown.length === 0 && <div className="acts-empty">No alchemical items match.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
