import { useState } from 'react';
import type { Item, InventoryItem, ItemImbuement, ItemMonsterPart, ProficiencyKey } from '../rules/types';
import { SKILLS } from '../rules/types';
import { setItemMonsterPart, type PlayUpdater } from '../rules/play';
import {
  type MpItemKind,
  type AvailableParts,
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
  hasMatchingPart,
  propertyRequirementTags,
  MP_ITEM_KINDS,
} from '../rules/monsterParts';
import { confirmDialog } from './confirm';
import { MonsterPartsRules } from './MonsterPartsRules';
import { MpProse } from './MpProse';
import { MpPathTerm, MpPropertyTerm } from './MpTermLinks';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const gp = (n: number) => `${n.toLocaleString()} gp`;

/** Weapon/armor/shield are auto-classified by itemType; other worn gear (equipment) is refined as a
 *  Perception or skill item, a track the player chooses (stored on monsterPart.kind). */
function autoKind(item: Item): MpItemKind | null {
  if (item.itemType === 'weapon') return 'weapon';
  if (item.itemType === 'armor') return 'armor';
  if (item.itemType === 'shield') return 'shield';
  return null;
}

/** Whether this item type can ever take Monster Parts (weapon/armor/shield, or worn equipment as a
 *  Perception/skill item). Consumables, treasure, containers can't. A created monster-PART item is a raw
 *  resource, never a refined gear item, so it's excluded. */
export function itemCanUseMonsterParts(item: Item | undefined): boolean {
  if (!item) return false;
  if (item.isMonsterPart) return false;
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

/** The reference-only Monster-Parts editor for the item-detail popup / editor modal: refine the item and
 *  imbue properties by setting their value/level FREELY (no bank, no deduction). The character's
 *  harvested monster-part inventory items are shown as an informational "Available" reference, and each
 *  property gets a purely-informational tag-match hint. The item stores refineValue + imbuements as
 *  before, so derive is unchanged. */
export function MonsterPartsSection({
  inv,
  item,
  charLevel,
  available,
  onSalvage,
  onPlay,
}: {
  inv: InventoryItem;
  item: Item;
  charLevel: number;
  /** The character's harvested monster parts (total gp + union of tags), for the reference display. */
  available: AvailableParts;
  /** Salvage this item into a generic monster-part inventory item (registers + adds it). Phase-2 wiring;
   *  when absent, the salvage button is hidden. */
  onSalvage?: () => void;
  onPlay: PlayUpdater;
}) {
  const [adding, setAdding] = useState(false);
  const auto = autoKind(item);
  const mp = inv.monsterPart;
  const canChooseTrack = !auto && item.itemType === 'equipment';
  const kind: MpItemKind | null = auto ?? mp?.kind ?? null;
  const availTags = new Set(available.tags);

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
        <span className="mp-hint">Choose the item-bonus track this gear uses, then set its refined level.</span>
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

  // Refine freely: the effective refined level is capped at the character's level, but the player may
  // set the stored value to any threshold up to level 20 (reference-only — no parts are consumed).
  const canRaiseRefine = refineLevel < 20;
  const raiseRefine = () => {
    if (!canRaiseRefine) return;
    put({ refineValue: refinementCost(refineLevel + 1, kind) });
  };
  const lowerRefine = () => {
    if (refineLevel <= 0) return;
    const targetValue = refineLevel <= 1 ? 0 : refinementCost(refineLevel - 1, kind);
    const newLevel = itemLevelForValue(targetValue, kind);
    const newSlots = imbueSlots(kind, Math.min(newLevel, charLevel));
    const trimmed = blob.imbuements.slice(0, newSlots);
    put({ refineValue: targetValue, imbuements: trimmed });
  };

  const patchImb = (i: number, patch: Partial<ItemImbuement>) =>
    put({ imbuements: blob.imbuements.map((im, idx) => (idx === i ? { ...im, ...patch } : im)) });

  const removeImb = (i: number) => put({ imbuements: blob.imbuements.filter((_, idx) => idx !== i) });

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

  // Raise/lower an imbued property's value freely (capped at item level AND character level).
  const raiseImb = (i: number) => {
    const im = blob.imbuements[i];
    const lvl = propertyLevelForValue(im.value, kind);
    const levelCap = imbuedLevelCap(cappedLevel, charLevel);
    if (lvl >= levelCap || lvl >= 20) return;
    put({ imbuements: blob.imbuements.map((x, idx) => (idx === i ? { ...x, value: refinementCost(lvl + 1, kind) } : x)) });
  };
  const lowerImb = (i: number) => {
    const im = blob.imbuements[i];
    const lvl = propertyLevelForValue(im.value, kind);
    if (lvl <= 0) return;
    const targetValue = lvl <= 1 ? 0 : refinementCost(lvl - 1, kind);
    put({ imbuements: blob.imbuements.map((x, idx) => (idx === i ? { ...x, value: targetValue } : x)) });
  };

  const options = propertiesForKind(kind);
  const totalInvested = itemPartValue(blob);

  const salvage = async () => {
    if (!onSalvage) return;
    const recover = salvageValue(blob);
    if (
      !(await confirmDialog({
        title: 'Salvage this item?',
        message: `Salvaging breaks down its refinement + imbuements (${gp(totalInvested)} of parts) into a generic monster-part item worth ${gp(
          recover,
        )} (50%), added to your inventory. The item reverts to a mundane item. You can undo with Ctrl+Z.`,
        confirmLabel: 'Salvage',
        danger: true,
      }))
    )
      return;
    onSalvage();
  };

  return (
    <div className="mp-section">
      <span className="mp-title">
        <i className="ti ti-bone" aria-hidden="true" /> Monster Parts
      </span>

      {/* Read-only reference: the harvested parts the character holds (value + tags). */}
      <div className="mp-avail">
        <i className="ti ti-package" aria-hidden="true" /> Available: <strong>{gp(available.totalGp)}</strong>
        {available.tags.length > 0 ? <span className="mp-avail-tags"> — {available.tags.join(', ')}</span> : <span className="mp-avail-tags"> — no tags</span>}
      </div>

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
              disabled={!canRaiseRefine}
              aria-label="Raise refinement"
              title={canRaiseRefine ? `Next level holds ${gp(refinementCost(refineLevel + 1, kind))} of parts` : 'Max level'}
            >
              <i className="ti ti-plus" aria-hidden="true" />
            </button>
          </span>
        </div>
        <div className="mp-cost-line">
          <span>{gp(blob.refineValue)} in parts</span>
          {canRaiseRefine && <span className="mp-cost-need">next level: {gp(refinementCost(refineLevel + 1, kind))}</span>}
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
            const canRaise = rawLvl < levelCap && rawLvl < 20;
            // Informational: does the character hold a part matching this property's requirement?
            const reqTags = prop ? propertyRequirementTags(prop.id) : [];
            const matched = prop ? hasMatchingPart(prop.id, availTags) : true;
            return (
              <div className="mp-imbue" key={i}>
                <div className="mp-imbue-top">
                  <span className="mp-imbue-name">
                    {prop ? <MpPropertyTerm prop={prop} /> : im.propertyId}
                  </span>
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
                      disabled={!canRaise}
                      aria-label="Raise property level"
                      title={canRaise ? `Next level holds ${gp(refinementCost(rawLvl + 1, kind))} of parts` : 'At the level cap'}
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
                  {canRaise && <span className="mp-cost-need">next: {gp(refinementCost(rawLvl + 1, kind))}</span>}
                </div>
                <div className="mp-imbue-ctrls">
                  {prop && prop.paths.length > 1 && (
                    <>
                      <span className="mp-path-label">
                        Path: <MpPathTerm pathId={path?.id ?? im.path}>{path?.name ?? im.path}</MpPathTerm>
                      </span>
                      <select className="mp-select" value={im.path} onChange={(e) => patchImb(i, { path: e.target.value })} aria-label="Path">
                        {prop.paths.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </>
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
                {effects.length > 0 && (
                  <div className="mp-imbue-eff">
                    Applies each hit: <MpProse text={effects.join(' · ')} />
                  </div>
                )}
                {prop && (
                  <div className="mp-req">
                    <i className="ti ti-info-circle" aria-hidden="true" /> <MpProse text={prop.requirement} />
                  </div>
                )}
                {reqTags.length > 0 && (
                  <div className={'mp-match' + (matched ? ' ok' : ' miss')}>
                    <i className={'ti ' + (matched ? 'ti-check' : 'ti-alert-triangle')} aria-hidden="true" />{' '}
                    {matched ? 'You hold a matching part.' : `No matching part held (needs: ${reqTags.join(' / ')}).`}
                  </div>
                )}
                {r && r.riders.length > 0 && (
                  <ul className="mp-riders">
                    {r.riders.map((rd) => (
                      <li key={rd.level}>
                        <span className="mp-rider-lvl">{rd.level}</span> <MpProse text={rd.text} />
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

      {totalInvested > 0 && onSalvage && (
        <button className="mp-salvage" onClick={salvage}>
          <i className="ti ti-recycle" aria-hidden="true" /> Salvage — recover {gp(salvageValue(blob))} (50%) as a monster-part item
        </button>
      )}
    </div>
  );
}

/** The "Use Monster Parts" switch + editor. Shown wherever runes are edited, for an eligible item when
 *  the Monster Parts variant rule is on. Turning it ON puts the item into Monster-Parts mode (it then
 *  ignores runes/materials); turning it OFF drops the blob (confirming first if refine/imbue values were
 *  set — nothing is refunded, since the reference-only model never consumed parts). */
export function MonsterPartsPanel({
  inv,
  item,
  charLevel,
  available,
  onSalvage,
  onPlay,
}: {
  inv: InventoryItem;
  item: Item;
  charLevel: number;
  available: AvailableParts;
  onSalvage?: () => void;
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
      if (
        !(await confirmDialog({
          title: 'Turn off Monster Parts?',
          message: `This item is refined/imbued (${gp(invested)} of parts). Turning off drops that and reverts it to a mundane runed item. You can undo with Ctrl+Z.`,
          confirmLabel: 'Turn off',
          danger: true,
        }))
      )
        return;
    }
    onPlay((p) => setItemMonsterPart(p, inv.instanceId, undefined));
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
      {on && (
        <MonsterPartsSection
          inv={inv}
          item={item}
          charLevel={charLevel}
          available={available}
          onSalvage={onSalvage}
          onPlay={onPlay}
        />
      )}
      {rulesOpen && <MonsterPartsRules onClose={() => setRulesOpen(false)} />}
    </div>
  );
}
