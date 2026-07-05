import { useState } from 'react';
import type { Item, InventoryItem, ItemImbuement, ItemMonsterPart, ProficiencyKey } from '../rules/types';
import { SKILLS } from '../rules/types';
import { setItemMonsterPart, spendBankedParts, returnBankedParts, type PlayUpdater } from '../rules/play';
import {
  type MpItemKind,
  weaponRefinement,
  armorRefinement,
  shieldRefinement,
  senseSkillRefinement,
  imbueSlots,
  refinementCost,
  itemLevelForValue,
  propertyLevelForValue,
  imbuedLevelCap,
  propertiesForKind,
  getMpProperty,
  resolvePath,
  formatMpDamage,
  salvageValue,
  itemPartValue,
  MP_ITEM_KINDS,
} from '../rules/monsterParts';
import { confirmDialog } from './confirm';
import { MonsterPartsRules } from './MonsterPartsRules';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const gp = (n: number) => `${n.toLocaleString()} gp`;

/** Total banked-parts gp for a character (sums the ledger entries). */
export function characterBankedGp(bankedParts: { entries?: { gp: number }[] } | undefined): number {
  return (bankedParts?.entries ?? []).reduce((s, e) => s + Math.max(0, e.gp), 0);
}

/** Weapon/armor/shield are auto-classified by itemType; other worn gear (equipment) is refined as a
 *  Perception or skill item, a track the player chooses (stored on monsterPart.kind). */
function autoKind(item: Item): MpItemKind | null {
  if (item.itemType === 'weapon') return 'weapon';
  if (item.itemType === 'armor') return 'armor';
  if (item.itemType === 'shield') return 'shield';
  return null;
}

/** Whether this item type can ever take Monster Parts (weapon/armor/shield, or worn equipment as a
 *  Perception/skill item). Consumables, treasure, containers can't. */
export function itemCanUseMonsterParts(item: Item | undefined): boolean {
  if (!item) return false;
  return autoKind(item) !== null || item.itemType === 'equipment';
}

function refineSummary(kind: MpItemKind, level: number): string[] {
  if (kind === 'weapon') {
    const r = weaponRefinement(level);
    return [
      r.attack ? `+${r.attack} item bonus to attack rolls` : '',
      r.extraDice ? `+${r.extraDice} weapon damage ${r.extraDice > 1 ? 'dice' : 'die'}` : '',
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
  const b = senseSkillRefinement(level).bonus;
  if (!b) return [];
  return [`+${b} item bonus to ${kind === 'perception' ? 'Perception' : 'the chosen skill'}`];
}

/** A gated Monster-Parts editor for the item-detail popup / editor modal: refine the item and imbue
 *  properties, allocating banked parts by value. Parts levels are derived from the assigned gp value. */
export function MonsterPartsSection({
  inv,
  item,
  charLevel,
  bankedGp,
  onPlay,
}: {
  inv: InventoryItem;
  item: Item;
  charLevel: number;
  /** Total banked-parts gp on hand (from character.bankedParts) — the allocatable pool. */
  bankedGp: number;
  onPlay: PlayUpdater;
}) {
  const [adding, setAdding] = useState(false);
  const auto = autoKind(item);
  const mp = inv.monsterPart;
  const canChooseTrack = !auto && item.itemType === 'equipment';
  const kind: MpItemKind | null = auto ?? mp?.kind ?? null;
  const bank = bankedGp;

  if (!kind && !canChooseTrack) return null;

  const write = (next: ItemMonsterPart | undefined) => onPlay((p) => setItemMonsterPart(p, inv.instanceId, next));

  // ── Track chooser for worn equipment (Perception vs skill item) ──
  if (!kind) {
    return (
      <div className="mp-section">
        <span className="mp-title">
          <i className="ti ti-bone" aria-hidden="true" /> Monster Parts
        </span>
        <span className="mp-row-label">Refine this worn item as a…</span>
        <div className="mp-btn-row">
          <button className="mp-add-btn" onClick={() => write({ kind: 'perception', refineValue: 0, imbuements: [] })}>
            Perception item
          </button>
          <button className="mp-add-btn" onClick={() => write({ kind: 'skill', refineValue: 0, imbuements: [] })}>
            Skill item
          </button>
        </div>
        <span className="mp-hint">Choose the item-bonus track this gear uses, then allocate parts to refine it.</span>
      </div>
    );
  }

  // A live blob always exists past here (auto items may not have one yet — synthesize an empty one).
  const blob: ItemMonsterPart = mp ?? { kind, refineValue: 0, imbuements: [] };
  const put = (patch: Partial<ItemMonsterPart>) => write({ ...blob, ...patch });

  const refineLevel = itemLevelForValue(blob.refineValue, kind);
  const cappedLevel = Math.min(refineLevel, charLevel);
  const slots = imbueSlots(kind, cappedLevel);
  const kindReq = MP_ITEM_KINDS.find((k) => k.id === kind)?.requirement ?? '';
  const baseType = item.itemType === 'weapon' ? item.damage.type : undefined;

  // Move refinement UP to the next threshold: allocate (cost(next) − current value) from the bank.
  const canRaiseRefine = refineLevel < 20 && refineLevel < charLevel;
  const raiseRefineCost = canRaiseRefine ? refinementCost(refineLevel + 1, kind) - blob.refineValue : 0;
  const raiseRefine = () => {
    if (!canRaiseRefine || raiseRefineCost > bank) return;
    onPlay((p) => {
      let next = spendBankedParts(p, raiseRefineCost);
      next = setItemMonsterPart(next, inv.instanceId, { ...blob, refineValue: refinementCost(refineLevel + 1, kind) });
      return next;
    });
  };
  // Move refinement DOWN one threshold: return (current value − cost(level−1)) to the bank. At level 1,
  // drop to 0 (return the whole refine value) and trim imbuements that lost their slots.
  const lowerRefine = () => {
    if (refineLevel <= 0) return;
    const targetValue = refineLevel <= 1 ? 0 : refinementCost(refineLevel - 1, kind);
    const refund = blob.refineValue - targetValue;
    const newLevel = itemLevelForValue(targetValue, kind);
    const newSlots = imbueSlots(kind, Math.min(newLevel, charLevel));
    const trimmed = blob.imbuements.slice(0, newSlots);
    onPlay((p) => {
      let next = returnBankedParts(p, refund, 'Refinement refund');
      next = setItemMonsterPart(next, inv.instanceId, { ...blob, refineValue: targetValue, imbuements: trimmed });
      return next;
    });
  };

  const patchImb = (i: number, patch: Partial<ItemImbuement>) =>
    put({ imbuements: blob.imbuements.map((im, idx) => (idx === i ? { ...im, ...patch } : im)) });

  const removeImb = (i: number) => {
    const im = blob.imbuements[i];
    const refund = im.value;
    const next = blob.imbuements.filter((_, idx) => idx !== i);
    onPlay((p) => {
      let np = returnBankedParts(p, refund, 'Imbuement refund');
      np = setItemMonsterPart(np, inv.instanceId, { ...blob, imbuements: next });
      return np;
    });
  };

  const addImb = (propertyId: string) => {
    const prop = getMpProperty(propertyId);
    if (!prop) return;
    put({
      imbuements: [
        ...blob.imbuements,
        { propertyId, path: prop.paths[0].id, value: 0, choice: prop.choiceOptions?.[0] },
      ],
    });
    setAdding(false);
  };

  // Raise an imbued property to its next level threshold (capped at item level AND character level).
  const raiseImb = (i: number) => {
    const im = blob.imbuements[i];
    const lvl = propertyLevelForValue(im.value, kind);
    const levelCap = imbuedLevelCap(cappedLevel, charLevel);
    if (lvl >= levelCap || lvl >= 20) return;
    const cost = refinementCost(lvl + 1, kind) - im.value;
    if (cost > bank) return;
    onPlay((p) => {
      let np = spendBankedParts(p, cost);
      np = setItemMonsterPart(np, inv.instanceId, {
        ...blob,
        imbuements: blob.imbuements.map((x, idx) => (idx === i ? { ...x, value: refinementCost(lvl + 1, kind) } : x)),
      });
      return np;
    });
  };
  const lowerImb = (i: number) => {
    const im = blob.imbuements[i];
    const lvl = propertyLevelForValue(im.value, kind);
    if (lvl <= 0) return;
    const targetValue = lvl <= 1 ? 0 : refinementCost(lvl - 1, kind);
    const refund = im.value - targetValue;
    onPlay((p) => {
      let np = returnBankedParts(p, refund, 'Imbuement refund');
      np = setItemMonsterPart(np, inv.instanceId, {
        ...blob,
        imbuements: blob.imbuements.map((x, idx) => (idx === i ? { ...x, value: targetValue } : x)),
      });
      return np;
    });
  };

  const options = propertiesForKind(kind);
  const totalInvested = itemPartValue(blob);

  const salvage = async () => {
    const recover = salvageValue(blob);
    if (
      !(await confirmDialog({
        title: 'Salvage this item?',
        message: `Salvaging breaks down its refinement + imbuements (${gp(totalInvested)} of parts) and returns ${gp(
          recover,
        )} (50%) to your banked parts. The item reverts to a mundane item. You can undo with Ctrl+Z.`,
        confirmLabel: 'Salvage',
        danger: true,
      }))
    )
      return;
    onPlay((p) => {
      let np = returnBankedParts(p, recover, 'Salvaged parts');
      np = setItemMonsterPart(np, inv.instanceId, undefined);
      return np;
    });
  };

  return (
    <div className="mp-section">
      <span className="mp-title">
        <i className="ti ti-bone" aria-hidden="true" /> Monster Parts
        <span className="mp-bank">bank {gp(bank)}</span>
      </span>

      {/* Track switcher for worn equipment (Perception vs skill item — both use the same cost column,
          so the refine value carries over unchanged). */}
      {canChooseTrack && (
        <div className="mp-field">
          <span className="mp-row-label">Refined as a</span>
          <div className="seg" role="radiogroup" aria-label="Item track">
            {(['perception', 'skill'] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                className={'seg-btn' + (kind === k ? ' on' : '')}
                onClick={() => put({ kind: k })}
              >
                {k === 'perception' ? 'Perception item' : 'Skill item'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Refinement */}
      <div className="mp-block">
        <div className="mp-block-head">
          <span className="mp-row-label">
            Refined — item level <strong>{refineLevel || '—'}</strong>
            {refineLevel > charLevel && <span className="mp-warn"> (capped at your level {charLevel})</span>}
          </span>
          <span className="mp-stepper">
            <button className="mp-step" onClick={lowerRefine} disabled={refineLevel <= 0} aria-label="Lower refinement">
              <i className="ti ti-minus" aria-hidden="true" />
            </button>
            <button
              className="mp-step"
              onClick={raiseRefine}
              disabled={!canRaiseRefine || raiseRefineCost > bank}
              aria-label="Raise refinement"
              title={canRaiseRefine ? `Costs ${gp(raiseRefineCost)} of parts` : refineLevel >= charLevel ? 'Capped at your level' : 'Max level'}
            >
              <i className="ti ti-plus" aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="mp-cost-line">
          <span>{gp(blob.refineValue)} in parts</span>
          {canRaiseRefine && (
            <span className={raiseRefineCost > bank ? 'mp-cost-need mp-short' : 'mp-cost-need'}>
              next level: +{gp(raiseRefineCost)}
            </span>
          )}
        </div>
        {refineSummary(kind, cappedLevel).length > 0 && (
          <ul className="mp-effects">
            {refineSummary(kind, cappedLevel).map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        )}
        <span className="mp-req">
          <i className="ti ti-info-circle" aria-hidden="true" /> {kindReq}
        </span>
      </div>

      {kind === 'skill' && refineLevel > 0 && (
        <div className="mp-field">
          <span className="mp-row-label">Skill the bonus applies to</span>
          <select
            className="mp-select"
            value={blob.skillKey ?? ''}
            onChange={(e) => put({ skillKey: (e.target.value || undefined) as ProficiencyKey | undefined })}
            aria-label="Skill the bonus applies to"
          >
            <option value="">Choose a skill…</option>
            {SKILLS.map((s) => (
              <option key={s} value={s}>
                {cap(s)}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Imbuements */}
      {refineLevel > 0 && (
        <div className="mp-block">
          <div className="mp-block-head">
            <span className="mp-row-label">
              Imbued properties{' '}
              <span className="mp-slots">
                {blob.imbuements.length}/{slots} slot{slots === 1 ? '' : 's'}
              </span>
            </span>
          </div>
          {slots === 0 && <span className="mp-hint">Refine higher to unlock imbuing slots.</span>}

          {blob.imbuements.map((im, i) => {
            const prop = getMpProperty(im.propertyId);
            const path = prop?.paths.find((p) => p.id === im.path) ?? prop?.paths[0];
            const rawLvl = propertyLevelForValue(im.value, kind);
            const effLvl = Math.min(rawLvl, imbuedLevelCap(cappedLevel, charLevel));
            const r = path ? resolvePath(path, effLvl) : null;
            const effects: string[] = [];
            if (r?.addDamage) effects.push(formatMpDamage(r.addDamage, baseType));
            if (r?.persistentDamage) effects.push(formatMpDamage(r.persistentDamage, baseType));
            if (prop?.resistance && im.choice) effects.push(`resistance ${effLvl} (${im.choice})`);
            const levelCap = imbuedLevelCap(cappedLevel, charLevel);
            const nextCost = rawLvl < 20 ? refinementCost(rawLvl + 1, kind) - im.value : 0;
            const canRaise = rawLvl < levelCap && rawLvl < 20;
            return (
              <div className="mp-imbue" key={i}>
                <div className="mp-imbue-top">
                  <span className="mp-imbue-name">{prop?.name ?? im.propertyId}</span>
                  <span className="mp-stepper">
                    <button className="mp-step" onClick={() => lowerImb(i)} disabled={rawLvl <= 0} aria-label="Lower property level">
                      <i className="ti ti-minus" aria-hidden="true" />
                    </button>
                    <span className="mp-imbue-lvl">
                      lvl <strong>{effLvl || '—'}</strong>
                    </span>
                    <button
                      className="mp-step"
                      onClick={() => raiseImb(i)}
                      disabled={!canRaise || nextCost > bank}
                      aria-label="Raise property level"
                      title={canRaise ? `Costs ${gp(nextCost)} of parts` : 'At the level cap'}
                    >
                      <i className="ti ti-plus" aria-hidden="true" />
                    </button>
                  </span>
                  <button className="mp-imbue-del" onClick={() => removeImb(i)} aria-label="Remove property" title="Remove">
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                </div>
                <div className="mp-cost-line">
                  <span>{gp(im.value)} in parts</span>
                  {rawLvl > effLvl && <span className="mp-warn">shown at cap (item/level lvl {effLvl})</span>}
                  {canRaise && <span className={nextCost > bank ? 'mp-cost-need mp-short' : 'mp-cost-need'}>next: +{gp(nextCost)}</span>}
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
                    <select
                      className="mp-select"
                      value={im.choice ?? ''}
                      onChange={(e) => patchImb(i, { choice: e.target.value })}
                      aria-label={prop.choicePrompt ?? 'Choice'}
                    >
                      {prop.choiceOptions.map((o) => (
                        <option key={o} value={o}>
                          {cap(o)}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {effects.length > 0 && <div className="mp-imbue-eff">Applies each hit: {effects.join(' · ')}</div>}
                {prop && <div className="mp-req"><i className="ti ti-info-circle" aria-hidden="true" /> {prop.requirement}</div>}
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

          {slots > 0 &&
            blob.imbuements.length < slots &&
            (adding ? (
              <select
                className="mp-select mp-add-select"
                defaultValue=""
                onChange={(e) => e.target.value && addImb(e.target.value)}
                aria-label="Choose a property to imbue"
              >
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
        </div>
      )}

      {totalInvested > 0 && (
        <button className="mp-salvage" onClick={salvage}>
          <i className="ti ti-recycle" aria-hidden="true" /> Salvage — recover {gp(salvageValue(blob))} (50%)
        </button>
      )}
    </div>
  );
}

/** The "Use Monster Parts" switch + editor. Shown wherever runes are edited, for an eligible item when
 *  the Monster Parts variant rule is on. Turning it ON puts the item into Monster-Parts mode (it then
 *  ignores runes/materials); turning it OFF salvages nothing automatically but drops the blob — so it
 *  confirms first if parts were invested (recovering 50% to the bank on confirm). */
export function MonsterPartsPanel({
  inv,
  item,
  charLevel,
  bankedGp,
  onPlay,
}: {
  inv: InventoryItem;
  item: Item;
  charLevel: number;
  bankedGp: number;
  onPlay: PlayUpdater;
}) {
  const [rulesOpen, setRulesOpen] = useState(false);
  if (!itemCanUseMonsterParts(item)) return null;
  const on = !!inv.monsterPart;

  const turnOn = () => {
    const auto = autoKind(item);
    // Auto-kind items (weapon/armor/shield) get an empty blob immediately; worn equipment shows the
    // Perception/skill track chooser first (blob created when the player picks a track).
    if (auto) onPlay((p) => setItemMonsterPart(p, inv.instanceId, { kind: auto, refineValue: 0, imbuements: [] }));
    else onPlay((p) => setItemMonsterPart(p, inv.instanceId, { kind: 'perception', refineValue: 0, imbuements: [] }));
  };
  const turnOff = async () => {
    const invested = itemPartValue(inv.monsterPart);
    if (invested > 0) {
      const recover = salvageValue(inv.monsterPart);
      if (
        !(await confirmDialog({
          title: 'Turn off Monster Parts?',
          message: `This item has ${gp(invested)} of parts invested. Turning off salvages them, returning ${gp(
            recover,
          )} (50%) to your bank. You can undo with Ctrl+Z.`,
          confirmLabel: 'Turn off & salvage',
          danger: true,
        }))
      )
        return;
      onPlay((p) => {
        let np = returnBankedParts(p, recover, 'Salvaged parts');
        np = setItemMonsterPart(np, inv.instanceId, undefined);
        return np;
      });
    } else {
      onPlay((p) => setItemMonsterPart(p, inv.instanceId, undefined));
    }
  };

  return (
    <div className="mp-panel">
      <label className="mp-switch">
        <input type="checkbox" checked={on} onChange={() => (on ? turnOff() : turnOn())} />
        <span>Use Monster Parts</span>
        <span className="mp-switch-hint">refine &amp; imbue with parts instead of runes/materials</span>
        <button type="button" className="mp-rules-link" onClick={() => setRulesOpen(true)}>
          <i className="ti ti-book-2" aria-hidden="true" /> Rules
        </button>
      </label>
      {on && <MonsterPartsSection inv={inv} item={item} charLevel={charLevel} bankedGp={bankedGp} onPlay={onPlay} />}
      {rulesOpen && <MonsterPartsRules onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
