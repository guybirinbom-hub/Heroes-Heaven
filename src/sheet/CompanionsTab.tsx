import { useRef, useState, type ReactNode } from 'react';
import type { ActiveCondition, Character, ContentDatabase, CompanionConfig, CompanionKind, SimpleCompanion } from '../rules/types';
import {
  deriveAnimalCompanion,
  deriveEidolon,
  deriveFamiliar,
  type AnimalCompanionBlock,
  type EidolonBlock,
  type FamiliarBlock,
} from '../rules/companions';
import {
  addCompanionCondition,
  addCompanionItem,
  addPlayCompanion,
  buyCompanionItem,
  removeCompanionCondition,
  removeCompanionItem,
  removePlayCompanion,
  setCompanionConditionValue,
  setCompanionItemQty,
  toggleCompanionItemFlag,
  updatePlayCompanion,
  type PlayState,
} from '../rules/play';
import { formatMod } from '../rules/derive';
import { SPECIFIC_FAMILIARS } from '../rules/specificFamiliars';
import { ActionGlyph } from './widgets';
import { ConditionsModal } from './ConditionsModal';
import { AddItemsModal } from './AddItemsModal';
import { downscaleImage } from './imageUtil';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const KIND_ICON: Record<CompanionKind, string> = { animal: 'ti-paw', familiar: 'ti-feather', eidolon: 'ti-flare', follower: 'ti-user', pet: 'ti-mood-smile' };

/** Display label + icon for a companion (animals may be constructs). */
function kindMeta(cfg: CompanionConfig, content: ContentDatabase): { label: string; icon: string } {
  if (cfg.kind === 'animal') {
    const t = cfg.typeId ? content.animalCompanions[cfg.typeId] : undefined;
    if (t?.category === 'construct') return { label: 'Construct companion', icon: 'ti-robot' };
    return { label: 'Animal companion', icon: 'ti-paw' };
  }
  if (cfg.kind === 'familiar') return { label: 'Familiar', icon: 'ti-feather' };
  if (cfg.kind === 'eidolon') return { label: 'Eidolon', icon: 'ti-flare' };
  if (cfg.kind === 'follower') return { label: 'Follower', icon: 'ti-user' };
  return { label: 'Pet', icon: 'ti-mood-smile' };
}

/* ============================ Add companion ============================ */

type AddCat = 'all' | 'animal' | 'construct' | 'familiar' | 'eidolon' | 'follower' | 'pet';
const ADD_CATS: { id: AddCat; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'animal', label: 'Animal' },
  { id: 'construct', label: 'Construct' },
  { id: 'familiar', label: 'Familiar' },
  { id: 'eidolon', label: 'Eidolon' },
  { id: 'follower', label: 'Follower' },
  { id: 'pet', label: 'Pet' },
];

interface AddRow {
  kind: CompanionKind;
  cat: AddCat;
  /** Animal/construct type id, eidolon option id, specific-familiar id ('' = generic), follower/pet id. */
  typeId: string;
  name: string;
}

function addRows(content: ContentDatabase): AddRow[] {
  const animalsAll = Object.values(content.animalCompanions);
  const animals: AddRow[] = animalsAll.filter((t) => t.category !== 'construct').map((t) => ({ kind: 'animal', cat: 'animal', typeId: t.id, name: t.name }));
  const constructs: AddRow[] = animalsAll.filter((t) => t.category === 'construct').map((t) => ({ kind: 'animal', cat: 'construct', typeId: t.id, name: t.name }));
  const familiars: AddRow[] = [
    { kind: 'familiar', cat: 'familiar', typeId: '', name: 'Familiar (generic)' },
    ...SPECIFIC_FAMILIARS.map((f) => ({ kind: 'familiar' as const, cat: 'familiar' as const, typeId: f.id, name: f.name })),
  ];
  const eidolons: AddRow[] = (content.classes.summoner?.subclass?.options ?? []).map((o) => ({ kind: 'eidolon', cat: 'eidolon', typeId: o.id, name: o.name }));
  const followers: AddRow[] = Object.values(content.followers ?? {}).map((f) => ({ kind: 'follower', cat: 'follower', typeId: f.id, name: f.name }));
  const pets: AddRow[] = Object.values(content.pets ?? {}).map((p) => ({ kind: 'pet', cat: 'pet', typeId: p.id, name: p.name }));
  return [...animals, ...constructs, ...familiars, ...eidolons, ...followers, ...pets];
}

function rowToConfig(r: AddRow): Omit<CompanionConfig, 'id'> {
  if (r.kind === 'animal') return { kind: 'animal', name: '', typeId: r.typeId, maturity: 'young' };
  if (r.kind === 'eidolon') return { kind: 'eidolon', name: '', typeId: r.typeId };
  if (r.kind === 'familiar') return { kind: 'familiar', name: '', abilities: [], specificFamiliarId: r.typeId || undefined };
  return { kind: r.kind, name: '', typeId: r.typeId }; // follower / pet
}

/** Two-step picker: choose a type (category), then the specific companion. */
function AddCompanionModal({ content, onAdd, onClose }: { content: ContentDatabase; onAdd: (r: AddRow) => void; onClose: () => void }) {
  const [cat, setCat] = useState<AddCat>('all');
  const [q, setQ] = useState('');
  const ql = q.trim().toLowerCase();
  const rows = addRows(content).filter((r) => (cat === 'all' || r.cat === cat) && (!ql || r.name.toLowerCase().includes(ql)));
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker cond-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          Add companion
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="picker-controls" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div className="seg seg-wrap">
            {ADD_CATS.map((c) => (
              <button key={c.id} type="button" role="tab" aria-selected={cat === c.id} className={'seg-btn' + (cat === c.id ? ' on' : '')} onClick={() => setCat(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input autoFocus placeholder="Search companions" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="cond-list">
          {rows.map((r) => (
            <div key={r.kind + ':' + r.cat + ':' + r.typeId} className="cond-row" role="button" tabIndex={0} onClick={() => onAdd(r)}>
              <span className="cond-row-check">
                <i className={'ti ' + (r.cat === 'construct' ? 'ti-robot' : KIND_ICON[r.kind])} aria-hidden="true" />
              </span>
              <div className="cond-row-text">
                <div className="cond-row-name">
                  {r.name}
                  <span className="cond-valued-tag">{r.cat === 'all' ? r.kind : r.cat}</span>
                </div>
              </div>
              <span className="picker-add-hint">
                <i className="ti ti-plus" aria-hidden="true" /> Add
              </span>
            </div>
          ))}
          {rows.length === 0 && <div className="acts-empty">No companions match.</div>}
        </div>
      </div>
    </div>
  );
}

/* ============================ Choice pickers ============================ */

function FamiliarAbilityPicker({ content, chosen, onToggle, onClose }: { content: ContentDatabase; chosen: string[]; onToggle: (id: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const has = new Set(chosen);
  const list = Object.values(content.familiarAbilities)
    .filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker cond-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          Familiar abilities
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="picker-controls">
          <div className="search">
            <i className="ti ti-search" aria-hidden="true" />
            <input autoFocus placeholder="Search abilities" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="ss-count">{chosen.length} chosen</span>
        </div>
        <div className="cond-list">
          {list.map((a) => {
            const on = has.has(a.id);
            return (
              <div key={a.id} className={'cond-row' + (on ? ' on' : '')} role="button" tabIndex={0} onClick={() => onToggle(a.id)}>
                <span className="cond-row-check">{on && <i className="ti ti-check" aria-hidden="true" />}</span>
                <div className="cond-row-text">
                  <div className="cond-row-name">
                    {a.name}
                    {a.kind === 'master' && <span className="cond-valued-tag">master</span>}
                  </div>
                  {a.description && <div className="cond-row-desc">{a.description}</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SpecializationPicker({ content, chosen, onPick, onClose }: { content: ContentDatabase; chosen?: string; onPick: (id: string | undefined) => void; onClose: () => void }) {
  const list = Object.values(content.companionSpecializations ?? {});
  return (
    <div className="picker-overlay" onClick={onClose}>
      <div className="picker cond-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picker-head">
          Choose a specialization
          <button className="picker-close" onClick={onClose} aria-label="Close">
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <div className="cond-list">
          {list.map((s) => {
            const on = chosen === s.id;
            return (
              <div key={s.id} className={'cond-row' + (on ? ' on' : '')} role="button" tabIndex={0} onClick={() => { onPick(on ? undefined : s.id); onClose(); }}>
                <span className="cond-row-check">{on && <i className="ti ti-check" aria-hidden="true" />}</span>
                <div className="cond-row-text">
                  <div className="cond-row-name">{s.name}</div>
                  <div className="cond-row-desc">{s.description}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ============================ Stat-block views ============================ */

function speedText(s: AnimalCompanionBlock['speeds']): string {
  const parts: string[] = [];
  if (s.land) parts.push(`${s.land} feet`);
  if (s.fly) parts.push(`fly ${s.fly} feet`);
  if (s.swim) parts.push(`swim ${s.swim} feet`);
  if (s.climb) parts.push(`climb ${s.climb} feet`);
  if (s.burrow) parts.push(`burrow ${s.burrow} feet`);
  return parts.join(', ') || '—';
}
function abilityLine(a: AnimalCompanionBlock['abilities']): string {
  return (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((k) => `${cap(k)} ${formatMod(a[k])}`).join(', ');
}

function CompanionConditions({ compId, conditions, content, onPlay, onOpen }: { compId: string; conditions: ActiveCondition[]; content: ContentDatabase; onPlay?: (fn: (play: PlayState) => PlayState) => void; onOpen: () => void }) {
  if (!onPlay && conditions.length === 0) return null;
  return (
    <div className="sb-conditions">
      {conditions.map((c) => {
        const def = content.conditions[c.id];
        const name = def?.name ?? cap(c.id);
        return (
          <span className="cond-pill" key={c.id} title={def?.description}>
            {name}
            {def?.valued && onPlay ? (
              <span className="cond-pill-step">
                <button aria-label="Decrease" onClick={() => onPlay((p) => setCompanionConditionValue(p, compId, c.id, (c.value ?? 1) - 1))}>−</button>
                {c.value ?? 1}
                <button aria-label="Increase" onClick={() => onPlay((p) => setCompanionConditionValue(p, compId, c.id, (c.value ?? 1) + 1))}>+</button>
              </span>
            ) : (
              c.value ? ' ' + c.value : ''
            )}
            {onPlay && (
              <button className="cond-pill-x" aria-label={`Remove ${name}`} onClick={() => onPlay((p) => removeCompanionCondition(p, compId, c.id))}>
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            )}
          </span>
        );
      })}
      {onPlay && (
        <button className="add-btn" onClick={onOpen}>
          <i className="ti ti-plus" aria-hidden="true" /> Condition
        </button>
      )}
    </div>
  );
}

function StatBlock({ name, kind, level, icon, children }: { name: string; kind: string; level?: number; icon: string; children: ReactNode }) {
  return (
    <section className="statblock">
      <div className="sb-bar" />
      <div className="sb-body">
        <div className="sb-title">
          <span className="sb-name">
            <i className={'ti ' + icon} aria-hidden="true" /> {name}
          </span>
          <span className="sb-level">
            {kind}
            {level ? ` ${level}` : ''}
          </span>
        </div>
        {children}
      </div>
    </section>
  );
}

function AnimalBlock({ b, cond }: { b: AnimalCompanionBlock; cond?: ReactNode }) {
  const isConstruct = b.category === 'construct';
  const over = b.bulk.carried > b.bulk.max;
  return (
    <StatBlock name={b.name} kind={isConstruct ? 'Construct companion' : 'Animal companion'} level={b.level} icon={isConstruct ? 'ti-robot' : 'ti-paw'}>
      <div className="sb-traits">
        <span className="sb-trait">{isConstruct ? 'Construct' : 'Animal'}</span>
        <span className="sb-trait">{b.size}</span>
        <span className="sb-trait sb-trait-accent">{cap(b.maturity)}</span>
        {b.specialization && <span className="sb-trait sb-trait-accent">{b.specialization.name}</span>}
      </div>
      {cond}
      <div className="sb-line">
        <b>Perception</b> {formatMod(b.perception.modifier)}
        {b.senses.length > 0 && `; ${b.senses.join(', ')}`}
      </div>
      <div className="sb-line">
        <b>Skills</b> {b.skills.map((s) => `${s.name} ${formatMod(s.modifier)}`).join(', ')}
      </div>
      <div className="sb-line sb-muted">{abilityLine(b.abilities)}</div>
      <div className="sb-div" />
      <div className="sb-line">
        <b>AC</b> {b.ac}; <b>Fort</b> {formatMod(b.saves.fortitude.modifier)}, <b>Ref</b> {formatMod(b.saves.reflex.modifier)}, <b>Will</b> {formatMod(b.saves.will.modifier)}
      </div>
      <div className="sb-line">
        <b>HP</b> {b.hp}; <b>Speed</b> {speedText(b.speeds)}
      </div>
      {b.attacks.map((a, i) => (
        <div className="sb-line" key={i}>
          <b>Melee</b> <ActionGlyph cost={{ type: 'actions', value: 1 }} /> {a.name} {formatMod(a.attack)}
          {a.traits.length > 0 && ` (${a.traits.join(', ')})`}, <b>Damage</b> {a.damage}
        </div>
      ))}
      {b.gearNote && (
        <div className="sb-line sb-muted">
          <i className="ti ti-shield-bolt" aria-hidden="true" /> Equipped: {b.gearNote} — folded into the stats above.
        </div>
      )}
      <div className={'sb-line sb-muted' + (over ? ' sb-over' : '')}>
        <i className="ti ti-weight" aria-hidden="true" /> Bulk {b.bulk.carried} / {b.bulk.max}
        {over && ' — over capacity'}
      </div>
      {(b.support || b.maneuver) && <div className="sb-div" />}
      {b.support && (
        <div className="sb-line">
          <b>Support</b> <ActionGlyph cost={{ type: 'actions', value: 1 }} /> {b.support}
        </div>
      )}
      {b.maneuver && (
        <div className="sb-line">
          <b>Advanced maneuver</b> {b.maneuver}
        </div>
      )}
    </StatBlock>
  );
}

function SaveLine({ ac, saves }: { ac: number; saves: { fortitude: number; reflex: number; will: number } }) {
  return (
    <div className="sb-line">
      <b>AC</b> {ac}; <b>Fort</b> {formatMod(saves.fortitude)}, <b>Ref</b> {formatMod(saves.reflex)}, <b>Will</b> {formatMod(saves.will)}
    </div>
  );
}

function FamiliarBlockView({ b, cond }: { b: FamiliarBlock; cond?: ReactNode }) {
  const sf = b.specific;
  return (
    <StatBlock name={b.name} kind={sf ? 'Specific familiar' : 'Familiar'} level={b.level} icon="ti-feather">
      <div className="sb-traits">
        <span className="sb-trait">Minion</span>
        <span className="sb-trait">Tiny</span>
        {sf?.traits.map((t) => (
          <span className="sb-trait" key={t}>
            {cap(t)}
          </span>
        ))}
      </div>
      {cond}
      <div className="sb-line">
        <b>Perception</b> {formatMod(b.perception)}
      </div>
      <div className="sb-line sb-muted">Uses your AC, saves, and Perception (shown); HP equal to 5 × your level.</div>
      <div className="sb-div" />
      <SaveLine ac={b.ac} saves={b.saves} />
      <div className="sb-line">
        <b>HP</b> {b.hp}; <b>Speed</b> {b.speed} feet{b.extraSpeeds.length ? `, ${b.extraSpeeds.join(', ')}` : ''}
      </div>
      {sf && (
        <>
          <div className="sb-div" />
          <div className="sb-line">
            <b>Required abilities</b> ({sf.requiredCount} min) {sf.requiredAbilities.join(', ')}
          </div>
          {sf.specials.map((s) => (
            <div className="sb-line" key={s.name}>
              <b>{s.name}</b> {s.cost && <ActionGlyph cost={s.cost} />} {s.desc}
            </div>
          ))}
          {sf.note && <div className="sb-line sb-muted">{sf.note}</div>}
        </>
      )}
      <div className="sb-div" />
      <div className="sb-line sb-muted">Chosen familiar abilities ({b.abilities.length})</div>
      {b.abilities.length === 0 ? (
        <div className="sb-line sb-muted">None chosen yet — add some in Edit, including this familiar's required abilities.</div>
      ) : (
        b.abilities.map((a) => (
          <div className="sb-line" key={a.id}>
            <b>{a.name}</b> {a.kind === 'master' && <span className="sb-trait sb-trait-accent">master</span>} {a.description}
          </div>
        ))
      )}
    </StatBlock>
  );
}

function EidolonBlockView({ b, cond }: { b: EidolonBlock; cond?: ReactNode }) {
  return (
    <StatBlock name={b.name} kind="Eidolon" icon="ti-flare">
      <div className="sb-traits">
        <span className="sb-trait">Eidolon</span>
        {b.tradition && <span className="sb-trait sb-trait-accent">{cap(b.tradition)}</span>}
      </div>
      {cond}
      <div className="sb-line">
        <b>Perception</b> {formatMod(b.perception)}
      </div>
      {b.skills.length > 0 && (
        <div className="sb-line">
          <b>Trained skills</b> {b.skills.map(cap).join(', ')}
        </div>
      )}
      <div className="sb-line sb-muted">
        Shares your Hit Points; uses your AC, saves &amp; Perception. Manifest with <ActionGlyph cost={{ type: 'actions', value: 1 }} />.
      </div>
      <div className="sb-div" />
      <SaveLine ac={b.ac} saves={b.saves} />
      <div className="sb-line">
        <b>HP</b> {b.hp} (shared); <b>Speed</b> {b.speed} feet
      </div>
      {b.description && (
        <>
          <div className="sb-div" />
          <div className="sb-line sb-muted">{b.description.slice(0, 320)}</div>
        </>
      )}
    </StatBlock>
  );
}

function SimpleCompanionView({ sc, name, cond }: { sc: SimpleCompanion; name: string; cond?: ReactNode }) {
  return (
    <StatBlock name={name || sc.name} kind={cap(sc.kind)} icon={sc.kind === 'pet' ? 'ti-mood-smile' : 'ti-user'}>
      <div className="sb-traits">{(sc.traits ?? []).map((t) => <span className="sb-trait" key={t}>{cap(t)}</span>)}</div>
      {cond}
      <div className="sb-line">{sc.description}</div>
      {sc.notes && (
        <>
          <div className="sb-div" />
          <div className="sb-line sb-muted">{sc.notes}</div>
        </>
      )}
    </StatBlock>
  );
}

/* ============================ Inventory (player-style, Bulk-managed) ============================ */

function CompanionInventory({ cfg, content, onPlay, onAdd, bulkMax }: { cfg: CompanionConfig; content: ContentDatabase; onPlay: (fn: (play: PlayState) => PlayState) => void; onAdd: () => void; bulkMax?: number }) {
  const items = cfg.inventory ?? [];
  const carried = Math.round(items.reduce((sum, inv) => sum + (content.items[inv.itemId]?.bulk || 0) * inv.quantity, 0) * 10) / 10;
  const over = bulkMax != null && carried > bulkMax;
  return (
    <div className="comp-inv">
      <div className="comp-inv-head">
        <span className={'cmp-bulk' + (over ? ' over' : '')}>
          <i className="ti ti-weight" aria-hidden="true" /> Bulk {carried}
          {bulkMax != null ? ` / ${bulkMax}` : ''}
          {over && ' — over capacity'}
        </span>
        <button className="comp-manage-btn" onClick={onAdd}>
          <i className="ti ti-plus" aria-hidden="true" /> Add item
        </button>
      </div>
      {items.length === 0 ? (
        <div className="sb-line sb-muted">No gear yet. A companion can carry anything that fits its Bulk.</div>
      ) : (
        <ul className="comp-inv-list">
          {items.map((inv) => {
            const item = content.items[inv.itemId];
            const flag: 'worn' | 'equipped' = item?.itemType === 'armor' ? 'worn' : 'equipped';
            const equippable = item?.itemType === 'armor' || item?.itemType === 'weapon' || item?.itemType === 'shield';
            const on = !!inv[flag];
            const b = item?.bulk ?? 0;
            return (
              <li className="comp-inv-row" key={inv.instanceId}>
                <span className="comp-inv-name">
                  {item?.name ?? inv.itemId}
                  {inv.quantity > 1 ? ` ×${inv.quantity}` : ''}
                  <span className="comp-inv-bulk">{b === 0 ? '—' : b === 0.1 ? 'L' : b} Bulk</span>
                </span>
                {equippable && (
                  <button className={'inv-act' + (on ? ' on' : '')} onClick={() => onPlay((p) => toggleCompanionItemFlag(p, cfg.id, inv.instanceId, flag))}>
                    {flag === 'worn' ? (on ? 'Worn' : 'Wear') : on ? 'Wielded' : 'Wield'}
                  </button>
                )}
                <span className="inv-qtystep">
                  <button aria-label="Decrease quantity" disabled={inv.quantity <= 1} onClick={() => onPlay((p) => setCompanionItemQty(p, cfg.id, inv.instanceId, inv.quantity - 1))}>
                    <i className="ti ti-minus" aria-hidden="true" />
                  </button>
                  <span>{inv.quantity}</span>
                  <button aria-label="Increase quantity" onClick={() => onPlay((p) => setCompanionItemQty(p, cfg.id, inv.instanceId, inv.quantity + 1))}>
                    <i className="ti ti-plus" aria-hidden="true" />
                  </button>
                </span>
                <button className="comp-remove" aria-label="Remove item" onClick={() => onPlay((p) => removeCompanionItem(p, cfg.id, inv.instanceId))}>
                  <i className="ti ti-trash" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ============================ Edit · choices panel ============================ */

const MATURITIES = ['young', 'mature', 'nimble', 'savage', 'specialized'];

function EditChoices({ cfg, content, onPlay, onAbilities, onSpecialization }: { cfg: CompanionConfig; content: ContentDatabase; onPlay: (fn: (play: PlayState) => PlayState) => void; onAbilities: () => void; onSpecialization: () => void }) {
  const set = (patch: Partial<CompanionConfig>) => onPlay((p) => updatePlayCompanion(p, cfg.id, patch));
  const type = cfg.kind === 'animal' && cfg.typeId ? content.animalCompanions[cfg.typeId] : undefined;
  const isConstruct = type?.category === 'construct';
  const animalOpts = Object.values(content.animalCompanions).filter((t) => (t.category === 'construct') === isConstruct);
  const spec = cfg.specialization ? content.companionSpecializations?.[cfg.specialization] : undefined;
  return (
    <div className="cmp-edit">
      <div className="cmp-edit-h">
        <i className="ti ti-arrow-up-circle" aria-hidden="true" /> Advancement &amp; choices
      </div>

      <div className="cmp-crow">
        <span className="cmp-lbl">Name</span>
        <input className="comp-name" placeholder={kindMeta(cfg, content).label} value={cfg.name} onChange={(e) => set({ name: e.target.value })} />
      </div>

      {cfg.kind === 'animal' && (
        <>
          <div className="cmp-crow">
            <span className="cmp-lbl">{isConstruct ? 'Construct' : 'Type'}</span>
            <select className="osel" aria-label="Companion type" value={cfg.typeId ?? ''} onChange={(e) => set({ typeId: e.target.value })}>
              {animalOpts.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="cmp-crow">
            <span className="cmp-lbl">Maturity</span>
            <div className="cmp-seg">
              {MATURITIES.map((mt) => (
                <button key={mt} type="button" className={cfg.maturity === mt || (!cfg.maturity && mt === 'young') ? 'on' : ''} onClick={() => set({ maturity: mt })}>
                  {cap(mt)}
                </button>
              ))}
            </div>
          </div>
          <div className="cmp-note">Advance your companion's maturity as you gain the feats that grant it.</div>
          {cfg.maturity === 'specialized' && (
            <div className="cmp-crow">
              <span className="cmp-lbl">Specialization</span>
              <button className={'cmp-chip' + (spec ? ' filled' : ' empty')} onClick={onSpecialization}>
                {spec ? (
                  <>
                    {spec.name} <i className="ti ti-pencil" aria-hidden="true" />
                  </>
                ) : (
                  <>
                    <i className="ti ti-plus" aria-hidden="true" /> select specialization
                  </>
                )}
              </button>
            </div>
          )}
          {spec?.note && <div className="cmp-note">{spec.note}</div>}
        </>
      )}

      {cfg.kind === 'familiar' && (
        <>
          <div className="cmp-crow">
            <span className="cmp-lbl">Familiar</span>
            <select className="osel" aria-label="Specific familiar" value={cfg.specificFamiliarId ?? ''} onChange={(e) => set({ specificFamiliarId: e.target.value || undefined })}>
              <option value="">Generic familiar</option>
              {SPECIFIC_FAMILIARS.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
          <div className="cmp-crow">
            <span className="cmp-lbl">Abilities</span>
            <button className="cmp-chip filled" onClick={onAbilities}>
              <i className="ti ti-sparkles" aria-hidden="true" /> {(cfg.abilities ?? []).length} chosen
            </button>
          </div>
          <div className="cmp-note">Your class and feats determine how many familiar abilities you can choose.</div>
        </>
      )}

      {cfg.kind === 'eidolon' && (
        <div className="cmp-crow">
          <span className="cmp-lbl">Eidolon</span>
          <select className="osel" aria-label="Eidolon type" value={cfg.typeId ?? ''} onChange={(e) => set({ typeId: e.target.value })}>
            {(content.classes.summoner?.subclass?.options ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      )}

      {(cfg.kind === 'follower' || cfg.kind === 'pet') && (
        <div className="cmp-crow">
          <span className="cmp-lbl">{cap(cfg.kind)}</span>
          <select className="osel" aria-label="Type" value={cfg.typeId ?? ''} onChange={(e) => set({ typeId: e.target.value })}>
            {Object.values((cfg.kind === 'follower' ? content.followers : content.pets) ?? {}).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/* ============================ Main tab ============================ */

export function CompanionsTab({ character, content, onPlay }: { character: Character; content: ContentDatabase; onPlay?: (fn: (play: PlayState) => PlayState) => void }) {
  const explicit = character.companions ?? [];
  const explicitIds = new Set(explicit.map((c) => c.id));
  const autoEidolon: CompanionConfig[] =
    character.classId === 'summoner' && character.subclassId && !explicit.some((c) => c.kind === 'eidolon')
      ? [{ id: 'eidolon-auto', kind: 'eidolon', name: '', typeId: character.subclassId }]
      : [];
  const companions = [...explicit, ...autoEidolon];

  const [selId, setSelId] = useState<string | null>(null);
  const [mode, setMode] = useState<'stats' | 'edit' | 'inv'>('stats');
  const [addOpen, setAddOpen] = useState(false);
  const [condFor, setCondFor] = useState<string | null>(null);
  const [abilityFor, setAbilityFor] = useState<string | null>(null);
  const [specFor, setSpecFor] = useState<string | null>(null);
  const [invAddFor, setInvAddFor] = useState<string | null>(null);

  const current = companions.find((c) => c.id === selId) ?? companions[0];
  const condsOf = (id: string): ActiveCondition[] => character.companionConditions?.[id] ?? [];
  const AUTO_ID = 'eidolon-auto';
  const isAuto = (cfg: CompanionConfig) => cfg.id === AUTO_ID;
  // The summoner's eidolon is shown automatically (synthetic). It's editable too — the first edit
  // persists it as a real companion so renaming/subtype/gear/portrait stick.
  const editable = (cfg: CompanionConfig) => !!onPlay && (explicitIds.has(cfg.id) || isAuto(cfg));
  // Persist the synthetic eidolon as a real companion and select it. Returns nothing; the next
  // render resolves `current` to the now-real companion (same predicted id) so edits target it.
  const materializeAuto = (cfg: CompanionConfig) => {
    if (!onPlay) return;
    const max = explicit.reduce((m, c) => Math.max(m, Number(/(\d+)$/.exec(c.id)?.[1] ?? -1)), -1);
    setSelId(`cmp-${max + 1}`); // matches play.ts nextCompanionId
    onPlay((p) => addPlayCompanion(p, { kind: 'eidolon', name: cfg.name || '', typeId: cfg.typeId }));
  };
  // Switch the card mode; entering an editing mode on the synthetic eidolon materializes it first.
  const enterMode = (m: 'stats' | 'edit' | 'inv') => {
    if (m !== 'stats' && isAuto(current)) materializeAuto(current);
    setMode(m);
  };

  const select = (id: string) => {
    setSelId(id);
    setMode('stats');
  };

  // Portrait import: read the chosen image as a data URL and store it on the companion.
  const portraitInputRef = useRef<HTMLInputElement>(null);
  const importPortrait = (cfgId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file || !onPlay) return;
    // Downscale before storing — uncapped photos blow the localStorage quota.
    downscaleImage(file)
      .then((url) => onPlay((p) => updatePlayCompanion(p, cfgId, { portrait: url })))
      .catch(() => {});
  };
  const addCompanion = (r: AddRow) => {
    if (!onPlay) return;
    onPlay((p) => addPlayCompanion(p, rowToConfig(r)));
    setAddOpen(false);
  };

  /** Derive + render the selected companion's stat block. */
  const renderBlock = (cfg: CompanionConfig): { node: ReactNode; bulkMax?: number } => {
    const cond = <CompanionConditions compId={cfg.id} conditions={condsOf(cfg.id)} content={content} onPlay={onPlay} onOpen={() => setCondFor(cfg.id)} />;
    if (cfg.kind === 'animal') {
      const type = cfg.typeId ? content.animalCompanions[cfg.typeId] : undefined;
      if (!type) return { node: <StatBlock name={cfg.name || 'Animal companion'} kind="Animal companion" icon="ti-paw"><div className="sb-line sb-muted">Pick a type in Edit.</div></StatBlock> };
      const b = deriveAnimalCompanion(cfg, type, character.level, content, condsOf(cfg.id), !!character.variantRules?.proficiencyWithoutLevel);
      return { node: <AnimalBlock b={b} cond={cond} />, bulkMax: b.bulk.max };
    }
    if (cfg.kind === 'familiar') return { node: <FamiliarBlockView b={deriveFamiliar(cfg, character, content, condsOf(cfg.id))} cond={cond} /> };
    if (cfg.kind === 'eidolon') return { node: <EidolonBlockView b={deriveEidolon(cfg, character, content, condsOf(cfg.id))} cond={cond} /> };
    const sc = cfg.typeId ? (cfg.kind === 'follower' ? content.followers : content.pets)?.[cfg.typeId] : undefined;
    if (!sc) return { node: <StatBlock name={cfg.name || cap(cfg.kind)} kind={cap(cfg.kind)} icon={KIND_ICON[cfg.kind]}><div className="sb-line sb-muted">Pick a type in Edit.</div></StatBlock> };
    return { node: <SimpleCompanionView sc={sc} name={cfg.name} cond={cond} /> };
  };

  const addBtn = onPlay && (
    <button className="cmp-add" onClick={() => setAddOpen(true)}>
      <i className="ti ti-plus" aria-hidden="true" /> Add companion
    </button>
  );

  const modals = (
    <>
      {condFor && onPlay && (
        <ConditionsModal
          conditions={content.conditions}
          active={condsOf(condFor)}
          onAdd={(id, valued) => onPlay((p) => addCompanionCondition(p, condFor, id, valued ? 1 : undefined))}
          onRemove={(id) => onPlay((p) => removeCompanionCondition(p, condFor, id))}
          onSetValue={(id, value) => onPlay((p) => setCompanionConditionValue(p, condFor, id, value))}
          onClose={() => setCondFor(null)}
        />
      )}
      {addOpen && onPlay && <AddCompanionModal content={content} onAdd={addCompanion} onClose={() => setAddOpen(false)} />}
      {invAddFor && onPlay && (
        <AddItemsModal
          content={content}
          currency={character.currency}
          onGive={(itemId) => onPlay((p) => addCompanionItem(p, invAddFor, itemId))}
          onBuy={(itemId) => onPlay((p) => buyCompanionItem(p, invAddFor, itemId, content.items[itemId]?.price))}
          onClose={() => setInvAddFor(null)}
        />
      )}
      {abilityFor && onPlay && (() => {
        const comp = explicit.find((c) => c.id === abilityFor);
        const chosen = comp?.abilities ?? [];
        return (
          <FamiliarAbilityPicker
            content={content}
            chosen={chosen}
            onToggle={(aid) => onPlay((p) => updatePlayCompanion(p, abilityFor, { abilities: chosen.includes(aid) ? chosen.filter((x) => x !== aid) : [...chosen, aid] }))}
            onClose={() => setAbilityFor(null)}
          />
        );
      })()}
      {specFor && onPlay && (() => {
        const comp = explicit.find((c) => c.id === specFor);
        return (
          <SpecializationPicker
            content={content}
            chosen={comp?.specialization}
            onPick={(id) => onPlay((p) => updatePlayCompanion(p, specFor, { specialization: id }))}
            onClose={() => setSpecFor(null)}
          />
        );
      })()}
    </>
  );

  if (companions.length === 0) {
    return (
      <div className="placeholder">
        <i className="ti ti-paw" aria-hidden="true" />
        <span>No companions</span>
        {onPlay ? <div style={{ marginTop: 10 }}>{addBtn}</div> : <span className="ph-sub">Add a companion in the builder.</span>}
        {modals}
      </div>
    );
  }

  if (!current) return <div className="placeholder">{modals}</div>;
  const block = renderBlock(current);
  const canEdit = editable(current);

  return (
    <div className="maincol">
      <div className="cmp-switch">
        {companions.map((cfg) => {
          const meta = kindMeta(cfg, content);
          const on = cfg.id === current.id;
          return (
            <button key={cfg.id} className={'cmp-pill' + (on ? ' active' : '')} onClick={() => select(cfg.id)}>
              <span className="av">{cfg.portrait ? <img src={cfg.portrait} alt="" className="cmp-av-img" /> : <i className={'ti ' + meta.icon} aria-hidden="true" />}</span>
              {cfg.name || meta.label}
              <span className="lv">Lv {character.level}</span>
            </button>
          );
        })}
        {addBtn}
      </div>

      <div className="cmp-card">
        <div className="cmp-head">
          {canEdit ? (
            <button className="cmp-port cmp-port-edit" type="button" title="Set portrait" onClick={() => { if (isAuto(current)) materializeAuto(current); portraitInputRef.current?.click(); }}>
              {current.portrait ? <img src={current.portrait} alt="" className="cmp-port-img" /> : <i className={'ti ' + kindMeta(current, content).icon} aria-hidden="true" />}
              <span className="cmp-port-badge"><i className="ti ti-camera" aria-hidden="true" /></span>
            </button>
          ) : (
            <span className="cmp-port">
              {current.portrait ? <img src={current.portrait} alt="" className="cmp-port-img" /> : <i className={'ti ' + kindMeta(current, content).icon} aria-hidden="true" />}
            </span>
          )}
          <input ref={portraitInputRef} type="file" accept="image/*" className="cmp-port-file" onChange={(e) => importPortrait(current.id, e)} aria-hidden="true" tabIndex={-1} />
          <div className="cmp-titleblock">
            <div className="cmp-name">{current.name || kindMeta(current, content).label}</div>
            <div className="cmp-tag">{kindMeta(current, content).label} · Level {character.level}</div>
          </div>
          {canEdit && (
            <div className="cmp-modes">
              <button className={mode === 'stats' ? 'on' : ''} title="Stat block" onClick={() => enterMode('stats')}><i className="ti ti-layout-list" aria-hidden="true" /></button>
              <button className={mode === 'edit' ? 'on' : ''} title="Edit choices" onClick={() => enterMode('edit')}><i className="ti ti-pencil" aria-hidden="true" /></button>
              <button className={mode === 'inv' ? 'on' : ''} title="Inventory" onClick={() => enterMode('inv')}><i className="ti ti-backpack" aria-hidden="true" /></button>
              {!isAuto(current) && (
                <button className="cmp-del" title="Remove companion" onClick={() => { onPlay?.((p) => removePlayCompanion(p, current.id)); setSelId(null); }}><i className="ti ti-trash" aria-hidden="true" /></button>
              )}
            </div>
          )}
        </div>
        <div className="cmp-body">
          {(!canEdit || mode === 'stats') && block.node}
          {canEdit && mode === 'edit' && onPlay && (
            <EditChoices cfg={current} content={content} onPlay={onPlay} onAbilities={() => setAbilityFor(current.id)} onSpecialization={() => setSpecFor(current.id)} />
          )}
          {canEdit && mode === 'inv' && onPlay && (
            <CompanionInventory cfg={current} content={content} onPlay={onPlay} onAdd={() => setInvAddFor(current.id)} bulkMax={block.bulkMax} />
          )}
        </div>
      </div>
      {modals}
    </div>
  );
}
