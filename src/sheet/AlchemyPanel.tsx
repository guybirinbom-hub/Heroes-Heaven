import { useMemo, useState } from 'react';
import type { AbilityId, Character, ContentDatabase } from '../rules/types';
import { abilityMod } from '../rules/derive';
import { CLASS_RESOURCES, resourceMaxFor } from '../rules/classResources';
import { setAlchemyItem, quickAlchemy, type PlayUpdater } from '../rules/play';
import { craftableFormulas } from '../rules/formulaBook';
import { PickerRow, descNodeOf } from './FilterableSelect';
import { DescriptionModal } from './DescriptionModal';
import type { DescNode } from './descref';

/**
 * Alchemist play aid (Remaster): the day's infused items ("what I made today") + Quick Alchemy.
 * - Advanced Alchemy: prepare up to 4 + Int alchemical items (≤ your level) — a usable list with qty
 *   steppers + Use. No coin/vial cost (they're your daily infused items).
 * - Quick Alchemy: spend one Versatile Vial to make an item on the fly (beyond the daily budget).
 * The picker offers every alchemical item you're eligible for — you pick the ones you actually know —
 * plus anything a formula book grants you "as alchemical consumables" (ruling Q19).
 */
export function AlchemyPanel({ character, content, onPlay }: { character: Character; content: ContentDatabase; onPlay?: PlayUpdater }) {
  const [picker, setPicker] = useState<null | 'advanced' | 'quick'>(null);
  const [q, setQ] = useState('');
  const [descNode, setDescNode] = useState<DescNode | null>(null);

  const intMod = abilityMod(character.abilities.int);
  // Advanced Alchemy: 4 + Int items during daily prep, unless a feat raised it (Efficient Alchemy →
  // 6 + Int; Advanced Efficient Alchemy → 8 + Int, 10 + Int from 16th). This was a hardcoded 4 + Int,
  // which is why owning either feat changed nothing on this panel.
  const budget = character.advancedAlchemy?.max ?? 4 + intMod;
  const budgetSource = character.advancedAlchemy?.source;
  const levelSource = character.advancedAlchemy?.levelSource;
  const vialDef = (CLASS_RESOURCES['alchemist'] ?? []).find((r) => r.id === 'versatile-vials');
  const abilityMods = Object.fromEntries(Object.entries(character.abilities).map(([k, v]) => [k, abilityMod(v as number)])) as Record<AbilityId, number>;
  const vialMax = vialDef ? resourceMaxFor(vialDef, character, abilityMods) : 2 + intMod;
  const vialsCur = character.classResources?.['versatile-vials'] ?? vialMax;
  const prep = character.alchemyPrep ?? {};
  const preparedCount = Object.values(prep).reduce((a, b) => a + b, 0);

  // Which items Advanced Alchemy can make is capped by the ADVANCED ALCHEMY LEVEL, not the character
  // level. They are the same for an alchemist and diverge for an archetype one: Master Alchemy sets
  // it to 7 at 12th, so this list was showing an archetype alchemist items they cannot make.
  const alchLevel = character.advancedAlchemy?.level ?? character.level;
  const eligible = useMemo(() => {
    const out = Object.values(content.items).filter((it) => (it.traits ?? []).includes('alchemical') && (it.level ?? 0) <= alchLevel);
    // Ruling Q19: a formula the book holds "as alchemical consumables" is makeable even though the
    // item is not itself alchemical — Improbable Elixirs' potions are the case. Pool membership only:
    // the formula never becomes an inventory copy, and losing the book empties this again.
    const have = new Set(out.map((it) => it.id));
    for (const id of craftableFormulas(character, content)) {
      const it = content.items[id];
      if (it && !have.has(id) && (it.level ?? 0) <= alchLevel) out.push(it);
    }
    return out;
  }, [content, character, alchLevel]);
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
        <span className="alchemy-meta" title={budgetSource ? `Daily maximum raised to ${budget} by ${budgetSource}` : undefined}>
          Versatile Vials {vialsCur}/{vialMax} · prepared {preparedCount}/{budget}
          {/* The advanced alchemy LEVEL, which decides WHICH items you can make. Shown only when it
              differs from your own level, i.e. when a feat set it. */}
          {alchLevel !== character.level ? (
            <span title={levelSource ? `Advanced alchemy level ${alchLevel} from ${levelSource}` : undefined}>
              {' · alchemy level '}
              {alchLevel}
            </span>
          ) : null}
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
              {/* Both routes bail in silence — `pick` returns the state untouched past the daily
                  budget, and `quickAlchemy` does the same with no vial left. The picker stays open
                  after each make, so the vial case is reached just by pressing Make one time too
                  many, and every row still read as live. Q27: it has to look spent. */}
              {shown.map((it) => {
                const node = descNodeOf({ name: it.name, description: it.description, descRefs: it.descRefs }, 'items');
                const spent = picker === 'quick' ? vialsCur < 1 : preparedCount >= budget;
                return (
                  <PickerRow
                    key={it.id}
                    name={it.name}
                    lead={<span className="alchemy-pick-lvl">Lvl {it.level ?? 0}</span>}
                    chosen={(prep[it.id] ?? 0) > 0}
                    onOpenDesc={node ? () => setDescNode(node) : undefined}
                    selectLabel={picker === 'quick' ? 'Make' : 'Prepare'}
                    selectDisabled={spent}
                    disabledReason={
                      spent
                        ? picker === 'quick'
                          ? 'No Versatile Vial left — Quick Alchemy costs one.'
                          : `You have prepared your daily maximum (${budget}). Remove one first.`
                        : undefined
                    }
                    onSelect={() => pick(it.id)}
                  />
                );
              })}
              {shown.length === 0 && <div className="acts-empty">No alchemical items match.</div>}
            </div>
          </div>
        </div>
      )}
      {descNode && <DescriptionModal root={descNode} onClose={() => setDescNode(null)} />}
    </div>
  );
}
