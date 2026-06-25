import { useState } from 'react';
import type { Item, InventoryItem } from '../rules/types';
import { SKILLS } from '../rules/types';
import { setItemMonsterPart, type PlayState } from '../rules/play';
import {
  type MpItemKind,
  weaponRefinement,
  armorRefinement,
  shieldRefinement,
  senseSkillRefinement,
  imbueSlots,
  refinementCost,
  propertiesForKind,
  getMpProperty,
  resolvePath,
  formatMpDamage,
} from '../rules/monsterParts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Weapon/armor/shield are auto-classified by itemType; other worn gear is refined as a Perception or
 *  skill item, a track the player chooses (stored on monsterPart.kind). */
function autoKind(item: Item): MpItemKind | null {
  if (item.itemType === 'weapon') return 'weapon';
  if (item.itemType === 'armor') return 'armor';
  if (item.itemType === 'shield') return 'shield';
  return null;
}

function refineSummary(kind: MpItemKind, level: number): string[] {
  if (kind === 'weapon') {
    const r = weaponRefinement(level);
    return [
      r.attack ? `+${r.attack} item bonus to attack rolls` : '',
      r.extraDice ? `+${r.extraDice} weapon damage ${r.extraDice > 1 ? 'dice' : 'die'} (striking)` : '',
    ].filter(Boolean);
  }
  if (kind === 'armor') {
    const r = armorRefinement(level);
    return [r.ac ? `+${r.ac} item bonus to AC` : '', r.saves ? `+${r.saves} item bonus to saves` : ''].filter(Boolean);
  }
  if (kind === 'shield') {
    const r = shieldRefinement(level);
    return r.hardness ? [`Hardness ${r.hardness} · HP ${r.hp} · BT ${r.bt}`] : [];
  }
  // Perception / skill items (Tables 4D/4E).
  const b = senseSkillRefinement(level).bonus;
  if (!b) return [];
  return [`+${b} item bonus to ${kind === 'perception' ? 'Perception' : 'the chosen skill'}`];
}

/** A gated "Monster Parts" section for the item-detail popup: refine the item and imbue properties. */
export function MonsterPartsSection({
  inv,
  item,
  charLevel,
  onPlay,
}: {
  inv: InventoryItem;
  item: Item;
  charLevel: number;
  onPlay: (fn: (play: PlayState) => PlayState) => void;
}) {
  const [adding, setAdding] = useState(false);
  const auto = autoKind(item);
  const mp = inv.monsterPart ?? {};
  // Refinable iff it's a weapon/armor/shield, or worn equipment the player can assign a track to.
  const canChooseTrack = !auto && item.itemType === 'equipment';
  const kind: MpItemKind | null = auto ?? mp.kind ?? null;
  if (!kind && !canChooseTrack) return null;

  const refinedLevel = mp.refinedLevel ?? 0;
  const imbuements = mp.imbuements ?? [];
  const imbueCap = Math.min(refinedLevel, charLevel);
  // Bane/Wild deal the weapon's own damage type (stored as 'untyped'); resolve it for the effect line.
  const baseType = item.itemType === 'weapon' ? item.damage.type : undefined;

  const write = (next: InventoryItem['monsterPart'] | undefined) => onPlay((p) => setItemMonsterPart(p, inv.instanceId, next));
  // Merge a patch onto the existing blob so the chosen track (kind/skillKey) survives refine/imbue edits.
  const put = (patch: Partial<NonNullable<InventoryItem['monsterPart']>>) => write({ ...mp, ...patch });

  // Worn equipment with no track chosen yet: offer the Perception / skill choice (Tables 4D/4E).
  if (!kind) {
    return (
      <div className="sd-uses mp-section">
        <span className="sd-uses-title">
          <i className="ti ti-bone" aria-hidden="true" /> Monster Parts
        </span>
        <span className="mp-row-label">Refine this worn item as a…</span>
        <div className="mp-imbue-ctrls">
          <button className="mp-add-btn" onClick={() => put({ kind: 'perception' })}>
            Perception item
          </button>
          <button className="mp-add-btn" onClick={() => put({ kind: 'skill' })}>
            Skill item
          </button>
        </div>
        <span className="sd-uses-hint">Choose the item-bonus track this gear uses, then set its refinement level.</span>
      </div>
    );
  }

  const slots = imbueSlots(kind, refinedLevel);
  const setRefined = (lvl: number) => {
    const clamped = Math.max(0, Math.min(charLevel, lvl));
    if (clamped === 0) {
      // Auto-kind items clear entirely; a chosen Perception/skill track is kept so the chooser doesn't reappear.
      return auto ? write(undefined) : put({ refinedLevel: undefined, imbuements: undefined });
    }
    const slotsNow = imbueSlots(kind, clamped);
    const trimmed = imbuements.slice(0, slotsNow).map((im) => ({ ...im, level: Math.min(im.level, clamped) }));
    put({ refinedLevel: clamped, imbuements: trimmed.length ? trimmed : undefined });
  };
  const patchImb = (i: number, patch: Partial<(typeof imbuements)[number]>) =>
    put({ imbuements: imbuements.map((im, idx) => (idx === i ? { ...im, ...patch } : im)) });
  const removeImb = (i: number) => {
    const next = imbuements.filter((_, idx) => idx !== i);
    put({ imbuements: next.length ? next : undefined });
  };
  const addImb = (propertyId: string) => {
    const prop = getMpProperty(propertyId);
    if (!prop) return;
    put({ imbuements: [...imbuements, { propertyId, path: prop.paths[0].id, level: 1, choice: prop.choiceOptions?.[0] }] });
    setAdding(false);
  };

  const options = propertiesForKind(kind);

  return (
    <div className="sd-uses mp-section">
      <span className="sd-uses-title">
        <i className="ti ti-bone" aria-hidden="true" /> Monster Parts
      </span>

      {/* Refinement */}
      <div className="mp-refine">
        <span className="mp-row-label">Refined to level</span>
        <span className="sd-uses-row">
          <button className="sd-uses-btn" onClick={() => setRefined(refinedLevel - 1)} disabled={refinedLevel <= 0} aria-label="Lower refinement">
            <i className="ti ti-minus" aria-hidden="true" />
          </button>
          <span className="sd-uses-count">
            <strong>{refinedLevel || '—'}</strong>
          </span>
          <button className="sd-uses-btn" onClick={() => setRefined(refinedLevel + 1)} disabled={refinedLevel >= charLevel} aria-label="Raise refinement">
            <i className="ti ti-plus" aria-hidden="true" />
          </button>
        </span>
        {refinedLevel > 0 && <span className="mp-cost">{refinementCost(refinedLevel, kind).toLocaleString()} gp in parts</span>}
      </div>

      {kind === 'skill' && refinedLevel > 0 && (
        <div className="mp-imbue-ctrls">
          <span className="mp-row-label">Skill</span>
          <select className="mp-select" value={mp.skillKey ?? ''} onChange={(e) => put({ skillKey: e.target.value })} aria-label="Skill the bonus applies to">
            <option value="" disabled>
              Choose a skill…
            </option>
            {SKILLS.map((s) => (
              <option key={s} value={s}>
                {cap(s)}
              </option>
            ))}
          </select>
        </div>
      )}

      {refinedLevel === 0 ? (
        <span className="sd-uses-hint">
          Refine this {kind === 'perception' || kind === 'skill' ? `${kind} item` : kind} from monster parts to grant
          fundamental-rune-equivalent bonuses (it then uses parts instead of runes).
        </span>
      ) : (
        <>
          {refineSummary(kind, refinedLevel).length > 0 && (
            <ul className="mp-effects">
              {refineSummary(kind, refinedLevel).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}

          {/* Imbuements */}
          <div className="mp-imbue-head">
            <span className="mp-row-label">
              Imbued properties <span className="mp-slots">{imbuements.length}/{slots} slot{slots === 1 ? '' : 's'}</span>
            </span>
          </div>
          {slots === 0 && <span className="sd-uses-hint">Refine higher to unlock imbuing slots.</span>}

          {imbuements.map((im, i) => {
            const prop = getMpProperty(im.propertyId);
            const path = prop?.paths.find((p) => p.id === im.path) ?? prop?.paths[0];
            const r = path ? resolvePath(path, im.level) : null;
            const effects: string[] = [];
            if (r?.addDamage) effects.push(formatMpDamage(r.addDamage, baseType));
            if (r?.persistentDamage) effects.push(formatMpDamage(r.persistentDamage, baseType));
            if (prop?.resistance && im.choice) effects.push(`resistance ${im.level} (${im.choice})`);
            return (
              <div className="mp-imbue" key={i}>
                <div className="mp-imbue-top">
                  <span className="mp-imbue-name">{prop?.name ?? im.propertyId}</span>
                  <span className="sd-uses-row">
                    <button className="sd-uses-btn" onClick={() => patchImb(i, { level: Math.max(1, im.level - 1) })} disabled={im.level <= 1} aria-label="Lower property level">
                      <i className="ti ti-minus" aria-hidden="true" />
                    </button>
                    <span className="sd-uses-count">
                      lvl <strong>{im.level}</strong>
                    </span>
                    <button
                      className="sd-uses-btn"
                      onClick={() => patchImb(i, { level: Math.min(imbueCap, im.level + 1) })}
                      disabled={im.level >= imbueCap}
                      aria-label="Raise property level"
                    >
                      <i className="ti ti-plus" aria-hidden="true" />
                    </button>
                  </span>
                  <button className="mp-imbue-del" onClick={() => removeImb(i)} aria-label="Remove property" title="Remove">
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
                <div className="mp-imbue-ctrls">
                  {prop && prop.paths.length > 1 && (
                    <select className="mp-select" value={im.path} onChange={(e) => patchImb(i, { path: e.target.value })} aria-label="Path">
                      {prop.paths.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {prop?.choiceOptions && prop.choiceOptions.length > 0 && (
                    <select className="mp-select" value={im.choice ?? ''} onChange={(e) => patchImb(i, { choice: e.target.value })} aria-label={prop.choicePrompt ?? 'Choice'}>
                      {prop.choiceOptions.map((o) => (
                        <option key={o} value={o}>
                          {cap(o)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {effects.length > 0 && <div className="mp-imbue-eff">Strikes/effect: {effects.join(' · ')}</div>}
                {r && r.riders.length > 0 && (
                  <ul className="mp-riders">
                    {r.riders.map((rd) => (
                      <li key={rd.level}>
                        <span className="mp-rider-lvl">{rd.level}</span> {rd.text}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}

          {imbuements.length < slots &&
            (adding ? (
              <select className="mp-select mp-add-select" defaultValue="" onChange={(e) => e.target.value && addImb(e.target.value)} aria-label="Choose a property to imbue">
                <option value="" disabled>
                  Choose a property…
                </option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : (
              <button className="mp-add-btn" onClick={() => setAdding(true)}>
                <i className="ti ti-plus" aria-hidden="true" /> Imbue a property
              </button>
            ))}
        </>
      )}
    </div>
  );
}
