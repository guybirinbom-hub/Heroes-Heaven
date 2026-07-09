import { Fragment, useRef, useState, type ReactNode } from 'react';
import { isMobileNow } from './useIsMobile';
import { traitDesc, senseDesc } from '../rules/glossary';
import type { ActionCost, ActiveCondition, Character, Coins, ContentDatabase, CompanionConfig, CompanionKind, DamageType, EidolonConfig, ModeDef, SimpleCompanion, VehicleStat, SiegeWeaponStat } from '../rules/types';
import {
  deriveAnimalCompanion,
  deriveEidolon,
  deriveFamiliar,
  EIDOLON_PRIMARY_OPTIONS,
  type AnimalCompanionBlock,
  type EidolonBlock,
  type FamiliarBlock,
} from '../rules/companions';
import { toPlainText } from './RichText';
import { parsePrice } from '../rules/wealth';
import { confirmDialog } from './confirm';
import {
  addCompanionCondition,
  addCompanionItem,
  addPlayCompanion,
  applyCompanionDamage,
  applyCompanionHeal,
  buyCompanion,
  buyCompanionItem,
  canAfford,
  removeCompanionCondition,
  removeCompanionItem,
  removePlayCompanion,
  setCompanionConditionValue,
  setCompanionHp,
  setCompanionItemQty,
  setCompanionTempHp,
  toggleCompanionItemFlag,
  toggleCompanionMode,
  updatePlayCompanion,
  type PlayUpdater,
} from '../rules/play';
import { formatMod } from '../rules/derive';
import { HpControl } from './HpControl';
import { SPECIFIC_FAMILIARS } from '../rules/specificFamiliars';
import { ActionGlyph } from './widgets';
import { InfoTerm } from './InfoTerm';
import { ConditionsModal } from './ConditionsModal';
import { CATALOG_MODES, CATALOG_MODE_MAP } from '../rules/modes';
import { AddItemsModal } from './AddItemsModal';
import { processPortrait } from './imageUtil';
import { usePortrait } from './usePortrait';
import { newPortraitRef, setSharpPortrait } from '../data/portraitStore';

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A companion's portrait — on-device sharp copy when present, else the compressed one, else the kind
 *  icon. Its own component so the portrait hook can run inside the companion switcher's map(). */
function CompanionPortrait({ portrait, portraitRef, className, icon }: { portrait?: string; portraitRef?: string; className: string; icon: string }) {
  const shown = usePortrait(portraitRef, portrait);
  return portrait ? <img src={shown} alt="" className={className} /> : <i className={'ti ' + icon} aria-hidden="true" />;
}

const KIND_ICON: Record<CompanionKind, string> = { animal: 'ti-paw', familiar: 'ti-feather', eidolon: 'ti-flare', follower: 'ti-user', pet: 'ti-mood-smile', vehicle: 'ti-wheel', siege: 'ti-bow' };

/** Display label + icon for a companion (animals may be constructs; vehicles/siege weapons too). */
function kindMeta(cfg: CompanionConfig, content: ContentDatabase): { label: string; icon: string } {
  if (cfg.kind === 'animal') {
    const t = cfg.typeId ? content.animalCompanions[cfg.typeId] : undefined;
    if (t?.category === 'construct') return { label: 'Construct companion', icon: 'ti-robot' };
    return { label: 'Animal companion', icon: 'ti-paw' };
  }
  if (cfg.kind === 'familiar') return { label: 'Familiar', icon: 'ti-feather' };
  if (cfg.kind === 'eidolon') return { label: 'Eidolon', icon: 'ti-flare' };
  if (cfg.kind === 'follower') return { label: 'Follower', icon: 'ti-user' };
  if (cfg.kind === 'vehicle') return { label: 'Vehicle', icon: 'ti-wheel' };
  if (cfg.kind === 'siege') return { label: 'Siege weapon', icon: 'ti-bow' };
  return { label: 'Pet', icon: 'ti-mood-smile' };
}

/* ============================ Add companion ============================ */

type AddCat = 'all' | 'animal' | 'construct' | 'familiar' | 'eidolon' | 'follower' | 'pet' | 'vehicle' | 'siege';
const ADD_CATS: { id: AddCat; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'animal', label: 'Animal' },
  { id: 'construct', label: 'Construct' },
  { id: 'familiar', label: 'Familiar' },
  { id: 'eidolon', label: 'Eidolon' },
  { id: 'follower', label: 'Follower' },
  { id: 'pet', label: 'Pet' },
  { id: 'vehicle', label: 'Vehicle' },
  { id: 'siege', label: 'Siege' },
];

interface AddRow {
  kind: CompanionKind;
  cat: AddCat;
  /** Animal/construct type id, eidolon option id, specific-familiar id ('' = generic), follower/pet/vehicle/siege id. */
  typeId: string;
  name: string;
  /** Vehicles & siege weapons cost coin — their price string ("100 gp"); absent = free companion. */
  price?: string;
  note?: string;
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
  const vehicles: AddRow[] = Object.values(content.vehicles ?? {})
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map((v) => ({ kind: 'vehicle', cat: 'vehicle', typeId: v.id, name: v.name, price: v.price, note: `Level ${v.level}` }));
  const siege: AddRow[] = Object.values(content.siegeWeapons ?? {})
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
    .map((s) => ({ kind: 'siege', cat: 'siege', typeId: s.id, name: s.name, price: s.price, note: `Level ${s.level}` }));
  return [...animals, ...constructs, ...familiars, ...eidolons, ...followers, ...pets, ...vehicles, ...siege];
}

function rowToConfig(r: AddRow): Omit<CompanionConfig, 'id'> {
  if (r.kind === 'animal') return { kind: 'animal', name: '', typeId: r.typeId, maturity: 'young' };
  if (r.kind === 'eidolon') return { kind: 'eidolon', name: '', typeId: r.typeId };
  if (r.kind === 'familiar') return { kind: 'familiar', name: '', abilities: [], specificFamiliarId: r.typeId || undefined };
  return { kind: r.kind, name: '', typeId: r.typeId }; // follower / pet / vehicle / siege
}

/** Two-step picker: choose a type (category), then the specific companion. */
function AddCompanionModal({ content, currency, onAdd, onClose }: { content: ContentDatabase; currency?: Coins; onAdd: (r: AddRow, buy: boolean) => void; onClose: () => void }) {
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
            <input autoFocus={!isMobileNow()} placeholder="Search companions" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="cond-list">
          {rows.map((r) => {
            const priced = (r.kind === 'vehicle' || r.kind === 'siege') && !!r.price;
            const coins = priced ? parsePrice(r.price) : undefined;
            const affordable = !coins || canAfford(currency, coins);
            return (
              <div
                key={r.kind + ':' + r.cat + ':' + r.typeId}
                className="cond-row"
                role={priced ? undefined : 'button'}
                tabIndex={priced ? undefined : 0}
                onClick={priced ? undefined : () => onAdd(r, false)}
              >
                <span className="cond-row-check">
                  <i className={'ti ' + (r.cat === 'construct' ? 'ti-robot' : KIND_ICON[r.kind])} aria-hidden="true" />
                </span>
                <div className="cond-row-text">
                  <div className="cond-row-name">
                    {r.name}
                    <span className="cond-valued-tag">{r.cat === 'all' ? r.kind : r.cat}</span>
                    {r.note && <span className="cmp-add-note">{r.note}</span>}
                  </div>
                  {priced && <div className="cond-row-desc">{r.price}</div>}
                </div>
                {priced ? (
                  <span className="cmp-add-buy">
                    <button className="comp-manage-btn" disabled={!affordable} title={affordable ? `Buy for ${r.price}` : `You can't afford ${r.price}`} onClick={() => onAdd(r, true)}>
                      <i className="ti ti-coins" aria-hidden="true" /> Buy
                    </button>
                    <button className="comp-manage-btn ghost" title="Add without paying" onClick={() => onAdd(r, false)}>
                      Free
                    </button>
                  </span>
                ) : (
                  <span className="picker-add-hint">
                    <i className="ti ti-plus" aria-hidden="true" /> Add
                  </span>
                )}
              </div>
            );
          })}
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
            <input autoFocus={!isMobileNow()} placeholder="Search abilities" value={q} onChange={(e) => setQ(e.target.value)} />
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
                  {a.description && <div className="cond-row-desc">{toPlainText(a.description)}</div>}
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
                  <div className="cond-row-desc">{toPlainText(s.description)}</div>
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

function CompanionConditions({ compId, conditions, modes, content, onPlay, onOpen }: { compId: string; conditions: ActiveCondition[]; modes: ModeDef[]; content: ContentDatabase; onPlay?: PlayUpdater; onOpen: () => void }) {
  if (!onPlay && conditions.length === 0 && modes.length === 0) return null;
  return (
    <div className="sb-conditions">
      {conditions.map((c) => {
        const def = content.conditions[c.id];
        const name = def?.name ?? cap(c.id);
        return (
          <span className="cond-pill" key={c.id}>
            <InfoTerm title={name} description={def?.description} descRefs={def?.descRefs} descKey="conditions">
              {name}
            </InfoTerm>
            {def?.valued && onPlay ? (
              <span className="cond-pill-step">
                <button aria-label="Decrease" onClick={() => onPlay((p) => setCompanionConditionValue(p, compId, c.id, (c.value ?? 1) - 1), `ccond:${compId}:${c.id}`)}>−</button>
                {c.value ?? 1}
                <button aria-label="Increase" onClick={() => onPlay((p) => setCompanionConditionValue(p, compId, c.id, (c.value ?? 1) + 1), `ccond:${compId}:${c.id}`)}>+</button>
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
      {modes.map((m) => (
        <span className="mode-pill" key={m.id} title={m.note}>
          {m.name}
          {onPlay && (
            <button className="cond-pill-x" aria-label={`Turn off ${m.name}`} onClick={() => onPlay((p) => toggleCompanionMode(p, compId, m.id, content.modes))}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {onPlay && (
        <button className="add-btn" onClick={onOpen}>
          <i className="ti ti-plus" aria-hidden="true" /> Condition / Mode
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

// Animal-companion "Advanced maneuver" strings are "Name (cost): text" with the cost spelled out as
// words in core.json — map the word to an ActionCost so it renders as the action-cost GLYPH, not text.
const MANEUVER_COST: Record<string, ActionCost> = {
  'single action': { type: 'actions', value: 1 },
  'one action': { type: 'actions', value: 1 },
  '1 action': { type: 'actions', value: 1 },
  'two actions': { type: 'actions', value: 2 },
  '2 actions': { type: 'actions', value: 2 },
  'three actions': { type: 'actions', value: 3 },
  '3 actions': { type: 'actions', value: 3 },
  reaction: { type: 'reaction' },
  free: { type: 'free' },
  'free action': { type: 'free' },
};
function maneuverNode(maneuver: string): ReactNode {
  const m = maneuver.match(/^(.*?)\s*\(([^)]+)\)\s*:?\s*/);
  if (!m) return maneuver;
  const name = m[1].trim();
  const paren = m[2].trim();
  const rest = maneuver.slice(m[0].length);
  const cost = MANEUVER_COST[paren.toLowerCase()];
  return (
    <>
      {name} {cost ? <ActionGlyph cost={cost} /> : `(${paren})`}
      {rest ? <>: {rest}</> : null}
    </>
  );
}

// Stat-block terms that have a description (creature/weapon traits + senses) → tappable InfoTerm.
// traitDesc/senseDesc resolve via the glossary (no content needed for the common ones).
function TraitChipTerm({ trait, label, accent }: { trait: string; label: string; accent?: boolean }) {
  return (
    <InfoTerm className={'sb-trait' + (accent ? ' sb-trait-accent' : '')} title={cap(trait)} description={traitDesc(trait)}>
      {label}
    </InfoTerm>
  );
}
function TraitParen({ traits }: { traits: string[] }) {
  if (!traits.length) return null;
  return (
    <>
      {' ('}
      {traits.map((t, j) => (
        <Fragment key={t}>
          {j > 0 ? ', ' : ''}
          <InfoTerm title={cap(t)} description={traitDesc(t)}>{t}</InfoTerm>
        </Fragment>
      ))}
      {')'}
    </>
  );
}
/** A companion Strike is Melee unless a trait marks it ranged/thrown (rare — a wielded ranged/thrown
 *  weapon). Returns the range string when present (e.g. "20 ft"), '' for ranged-with-no-number, or null
 *  for melee. */
function attackRange(traits: string[]): string | null {
  for (const t of traits) {
    const m = /^(?:thrown|range(?:-increment)?)[- ]?(\d+)/i.exec(t);
    if (m) return `${m[1]} ft`;
    if (/^(?:thrown|ranged)$/i.test(t)) return '';
  }
  return null;
}
/** One companion attack line (animal companion + eidolon share this): Melee/Ranged label + 1-action
 *  Strike glyph + name, to-hit, traits, damage. */
function AttackLine({ a }: { a: { name: string; attack: number; damage: string; traits: string[] } }) {
  const range = attackRange(a.traits);
  return (
    <div className="sb-line">
      <b>{range === null ? 'Melee' : 'Ranged'}</b> <ActionGlyph cost={{ type: 'actions', value: 1 }} /> {a.name} {formatMod(a.attack)}
      {range ? `, range ${range}` : ''}
      <TraitParen traits={a.traits} />, <b>Damage</b> {a.damage}
    </div>
  );
}
function SenseList({ senses }: { senses: string[] }) {
  if (!senses.length) return null;
  return (
    <>
      {'; '}
      {senses.map((s, j) => (
        <Fragment key={s}>
          {j > 0 ? ', ' : ''}
          <InfoTerm title={cap(s)} description={senseDesc(s)}>{s}</InfoTerm>
        </Fragment>
      ))}
    </>
  );
}

function AnimalBlock({ b, cond, hp }: { b: AnimalCompanionBlock; cond?: ReactNode; hp?: ReactNode }) {
  const isConstruct = b.category === 'construct';
  const over = b.bulk.carried > b.bulk.max;
  return (
    <StatBlock name={b.name} kind={isConstruct ? 'Construct companion' : 'Animal companion'} level={b.level} icon={isConstruct ? 'ti-robot' : 'ti-paw'}>
      <div className="sb-traits">
        <TraitChipTerm trait={isConstruct ? 'construct' : 'animal'} label={isConstruct ? 'Construct' : 'Animal'} />
        <span className="sb-trait">{b.size}</span>
        <span className="sb-trait sb-trait-accent">{cap(b.maturity)}</span>
        {b.specialization && <span className="sb-trait sb-trait-accent">{b.specialization.name}</span>}
      </div>
      {cond}
      <div className="sb-line">
        <b>Perception</b> {formatMod(b.perception.modifier)}
        <SenseList senses={b.senses} />
      </div>
      <div className="sb-line">
        <b>Skills</b> {b.skills.map((s) => `${s.name} ${formatMod(s.modifier)}`).join(', ')}
      </div>
      <div className="sb-line sb-muted">{abilityLine(b.abilities)}</div>
      <div className="sb-div" />
      <div className="sb-line">
        <b>AC</b> {b.ac}; <b>Fort</b> {formatMod(b.saves.fortitude.modifier)}, <b>Ref</b> {formatMod(b.saves.reflex.modifier)}, <b>Will</b> {formatMod(b.saves.will.modifier)}
      </div>
      {hp ? (
        <>
          <div className="sb-hp-block">{hp}</div>
          <div className="sb-line">
            <b>Speed</b> {speedText(b.speeds)}
          </div>
        </>
      ) : (
        <div className="sb-line">
          <b>HP</b> {b.hp}; <b>Speed</b> {speedText(b.speeds)}
        </div>
      )}
      {b.attacks.map((a, i) => (
        <AttackLine a={a} key={i} />
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
          <b>Advanced maneuver</b> {maneuverNode(b.maneuver)}
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

function FamiliarBlockView({ b, cond, hp }: { b: FamiliarBlock; cond?: ReactNode; hp?: ReactNode }) {
  const sf = b.specific;
  return (
    <StatBlock name={b.name} kind={sf ? 'Specific familiar' : 'Familiar'} level={b.level} icon="ti-feather">
      <div className="sb-traits">
        <span className="sb-trait">Minion</span>
        <span className="sb-trait">Tiny</span>
        {sf?.traits.map((t) => (
          <TraitChipTerm key={t} trait={t} label={cap(t)} />
        ))}
      </div>
      {cond}
      <div className="sb-line">
        <b>Perception</b> {formatMod(b.perception)}
      </div>
      <div className="sb-line sb-muted">Uses your AC, saves, and Perception (shown); HP equal to 5 × your level.</div>
      <div className="sb-div" />
      <SaveLine ac={b.ac} saves={b.saves} />
      {hp ? (
        <>
          <div className="sb-hp-block">{hp}</div>
          <div className="sb-line">
            <b>Speed</b> {b.speed} feet{b.extraSpeeds.length ? `, ${b.extraSpeeds.join(', ')}` : ''}
          </div>
        </>
      ) : (
        <div className="sb-line">
          <b>HP</b> {b.hp}; <b>Speed</b> {b.speed} feet{b.extraSpeeds.length ? `, ${b.extraSpeeds.join(', ')}` : ''}
        </div>
      )}
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
  const [descOpen, setDescOpen] = useState(false);
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
      <div className="sb-line">
        {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a, i) => (
          <span key={a}>
            {i > 0 ? ', ' : ''}
            <b>{a.toUpperCase()}</b> {b.abilities[a] >= 0 ? `+${b.abilities[a]}` : b.abilities[a]}
          </span>
        ))}
      </div>
      {b.attacks.map((a, i) => (
        <AttackLine a={a} key={i} />
      ))}
      <div className="sb-line sb-muted">Shares your Hit Points; uses your AC, saves &amp; Perception.</div>
      <div className="sb-line">
        <b>Manifest Eidolon</b> <ActionGlyph cost={{ type: 'actions', value: 3 }} /> (concentrate{b.tradition ? `, ${b.tradition}` : ''}) — it appears in an adjacent open
        space and can immediately take 1 action; if already manifested, you unmanifest it instead. It must stay within 100 ft of you, and unmanifests if you drop to 0 HP.
      </div>
      <div className="sb-div" />
      <SaveLine ac={b.ac} saves={b.saves} />
      <div className="sb-line">
        <b>HP</b> {b.hp} (shared); <b>Speed</b> {b.speed} feet
      </div>
      {b.description && (
        <>
          <div className="sb-div" />
          <div className="sb-line sb-muted">
            {descOpen || b.description.length <= 320 ? b.description : b.description.slice(0, 320) + '… '}
            {b.description.length > 320 && (
              <button type="button" className="sb-more" onClick={() => setDescOpen((o) => !o)}>
                {descOpen ? 'less' : 'more'}
              </button>
            )}
          </div>
        </>
      )}
    </StatBlock>
  );
}

function SimpleCompanionView({ sc, name, cond }: { sc: SimpleCompanion; name: string; cond?: ReactNode }) {
  return (
    <StatBlock name={name || sc.name} kind={cap(sc.kind)} icon={sc.kind === 'pet' ? 'ti-mood-smile' : 'ti-user'}>
      <div className="sb-traits">{(sc.traits ?? []).map((t) => <TraitChipTerm key={t} trait={t} label={cap(t)} />)}</div>
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

/** A vehicle or siege-weapon stat block (companion-styled). HP is trackable; siege weapons add an
 *  attack line. No conditions row (per design). */
function VehicleBlock({
  v,
  kindLabel,
  icon,
  hp,
  bt,
  status,
  attacks,
}: {
  v: VehicleStat;
  kindLabel: string;
  icon: string;
  hp: ReactNode;
  bt: number;
  status: string | null;
  attacks?: SiegeWeaponStat['attacks'];
}) {
  return (
    <StatBlock name={v.name} kind={kindLabel} level={v.level} icon={icon}>
      <div className="sb-traits">
        <span className="sb-trait">{v.size}</span>
        {(v.traits ?? []).map((t) => (
          <TraitChipTerm key={t} trait={t} label={cap(t.replace(/-/g, ' '))} />
        ))}
        {status && <span className={'sb-trait ' + (status === 'Destroyed' ? 'sb-trait-bad' : 'sb-trait-warn')}>{status}</span>}
      </div>
      {v.pilotingDC != null && (
        <div className="sb-line">
          <b>Piloting</b> DC {v.pilotingDC}
        </div>
      )}
      <div className="sb-line">
        {v.crew && (
          <>
            <b>Crew</b> {v.crew}
          </>
        )}
        {v.space && (
          <>
            {v.crew ? ' · ' : ''}
            <b>Space</b> {v.space}
          </>
        )}
        {v.price && (
          <>
            {' · '}
            <b>Price</b> {v.price}
          </>
        )}
      </div>
      <div className="sb-div" />
      <div className="sb-line">
        <b>AC</b> {v.ac}
        {v.fort != null && (
          <>
            ; <b>Fort</b> {formatMod(v.fort)}
          </>
        )}
        ; <b>Hardness</b> {v.hardness}
      </div>
      <div className="sb-hp-block">
        {hp}
        <div className="sb-line sb-muted sb-hp-bt">Broken Threshold {bt}</div>
      </div>
      {v.speeds && (
        <div className="sb-line">
          <b>Speed</b> {v.speeds}
        </div>
      )}
      {v.collision && (
        <div className="sb-line">
          <b>Collision</b> {v.collision}
        </div>
      )}
      {attacks && attacks.length > 0 && (
        <>
          <div className="sb-div" />
          {attacks.map((a, i) => (
            <div className="sb-line" key={i}>
              <b>{a.range ? 'Ranged' : 'Melee'}</b> <ActionGlyph cost={{ type: 'actions', value: 1 }} /> {a.name}
              {a.bonus != null ? ` ${formatMod(a.bonus)}` : ''}
              {a.range ? `, range ${a.range}` : ''}
              {a.damage ? (
                <>
                  , <b>Damage</b> {a.damage}
                </>
              ) : (
                ''
              )}
              {a.reload ? ` (reload ${a.reload})` : ''}
            </div>
          ))}
        </>
      )}
      <div className="sb-line sb-muted">Immunities {v.immunities && v.immunities.length ? v.immunities.join(', ') : 'object immunities'}</div>
      {v.description && (
        <>
          <div className="sb-div" />
          <div className="sb-line sb-muted">{v.description}</div>
        </>
      )}
    </StatBlock>
  );
}

/* ============================ Inventory (player-style, Bulk-managed) ============================ */

function CompanionInventory({ cfg, content, onPlay, onAdd, bulkMax }: { cfg: CompanionConfig; content: ContentDatabase; onPlay: PlayUpdater; onAdd: () => void; bulkMax?: number }) {
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
                  <button aria-label="Decrease quantity" disabled={inv.quantity <= 1} onClick={() => onPlay((p) => setCompanionItemQty(p, cfg.id, inv.instanceId, inv.quantity - 1), `cqty:${cfg.id}:${inv.instanceId}`)}>
                    <i className="ti ti-minus" aria-hidden="true" />
                  </button>
                  <span>{inv.quantity}</span>
                  <button aria-label="Increase quantity" onClick={() => onPlay((p) => setCompanionItemQty(p, cfg.id, inv.instanceId, inv.quantity + 1), `cqty:${cfg.id}:${inv.instanceId}`)}>
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

const MATURITIES = ['young', 'mature', 'nimble', 'savage', 'specialized', 'specialized-savage'];
const MATURITY_LABEL: Record<string, string> = { 'specialized': 'Specialized (nimble)', 'specialized-savage': 'Specialized (savage)' };
/** An eidolon's unarmed attack damage type is its form's physical type (GM may allow others). */
const EID_DMG_TYPES: DamageType[] = ['bludgeoning', 'piercing', 'slashing'];

function EditChoices({ cfg, content, onPlay, onAbilities, onSpecialization }: { cfg: CompanionConfig; content: ContentDatabase; onPlay: PlayUpdater; onAbilities: () => void; onSpecialization: () => void }) {
  const set = (patch: Partial<CompanionConfig>) => onPlay((p) => updatePlayCompanion(p, cfg.id, patch));
  const ec: EidolonConfig = cfg.eidolon ?? {};
  const setEid = (patch: Partial<EidolonConfig>) => set({ eidolon: { ...ec, ...patch } });
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
                  {MATURITY_LABEL[mt] ?? cap(mt)}
                </button>
              ))}
            </div>
          </div>
          <div className="cmp-note">Advance your companion's maturity as you gain the feats that grant it.</div>
          {(cfg.maturity === 'specialized' || cfg.maturity === 'specialized-savage') && (
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
        <>
          <div className="cmp-crow">
            <span className="cmp-lbl">Eidolon</span>
            <select className="osel" aria-label="Eidolon type" value={cfg.typeId ?? ''} onChange={(e) => set({ typeId: e.target.value })}>
              {(content.classes.summoner?.subclass?.options ?? []).map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>

          <div className="cmp-crow cmp-crow-top">
            <span className="cmp-lbl">Ability mods</span>
            <div className="eid-abils">
              {(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).map((a) => (
                <label key={a} className="eid-abil">
                  <span>{a.toUpperCase()}</span>
                  <input
                    type="number"
                    className="eid-num"
                    value={ec.abilities?.[a] ?? ''}
                    placeholder="—"
                    aria-label={`Eidolon ${a.toUpperCase()} modifier`}
                    onChange={(e) => setEid({ abilities: { ...(ec.abilities ?? {}), [a]: e.target.value === '' ? undefined : parseInt(e.target.value, 10) || 0 } })}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="cmp-hint">From your Eidolon Array + ability boosts (the eidolon boosts at the same levels you do).</div>

          <div className="cmp-crow">
            <span className="cmp-lbl">AC item bonus</span>
            <input type="number" className="eid-num" value={ec.acItemBonus ?? ''} placeholder="0" aria-label="AC item bonus from array" onChange={(e) => setEid({ acItemBonus: e.target.value === '' ? undefined : parseInt(e.target.value, 10) || 0 })} />
            <span className="cmp-lbl">Dex cap</span>
            <input type="number" className="eid-num" value={ec.dexCap ?? ''} placeholder="—" aria-label="Dexterity cap from array" onChange={(e) => setEid({ dexCap: e.target.value === '' ? undefined : parseInt(e.target.value, 10) })} />
          </div>

          <div className="cmp-crow cmp-crow-top">
            <span className="cmp-lbl">Primary atk</span>
            <div className="eid-atk">
              <input className="comp-name eid-form" value={ec.primary?.name ?? ''} placeholder="Claw, Jaws…" aria-label="Primary attack form" onChange={(e) => setEid({ primary: { ...ec.primary, name: e.target.value } })} />
              <select className="osel" aria-label="Primary damage type" value={ec.primary?.damageType ?? 'slashing'} onChange={(e) => setEid({ primary: { ...ec.primary, damageType: e.target.value as DamageType } })}>
                {EID_DMG_TYPES.map((d) => (
                  <option key={d} value={d}>{cap(d)}</option>
                ))}
              </select>
              <select className="osel" aria-label="Primary attack statistics" value={ec.primary?.option ?? 'd6-forceful'} onChange={(e) => setEid({ primary: { ...ec.primary, option: e.target.value } })}>
                {EIDOLON_PRIMARY_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="cmp-crow cmp-crow-top">
            <span className="cmp-lbl">Secondary</span>
            <div className="eid-atk">
              <input className="comp-name eid-form" value={ec.secondary?.name ?? ''} placeholder="Tail, Fist…" aria-label="Secondary attack form" onChange={(e) => setEid({ secondary: { ...ec.secondary, name: e.target.value } })} />
              <select className="osel" aria-label="Secondary damage type" value={ec.secondary?.damageType ?? 'slashing'} onChange={(e) => setEid({ secondary: { ...ec.secondary, damageType: e.target.value as DamageType } })}>
                {EID_DMG_TYPES.map((d) => (
                  <option key={d} value={d}>{cap(d)}</option>
                ))}
              </select>
              <span className="cmp-hint eid-fixed">1d6 · agile, finesse</span>
            </div>
          </div>
        </>
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

      {(cfg.kind === 'vehicle' || cfg.kind === 'siege') && (
        <div className="cmp-crow">
          <span className="cmp-lbl">Type</span>
          <select className="osel" aria-label="Type" value={cfg.typeId ?? ''} onChange={(e) => set({ typeId: e.target.value })}>
            {Object.values((cfg.kind === 'vehicle' ? content.vehicles : content.siegeWeapons) ?? {})
              .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} (Lv {v.level})
                </option>
              ))}
          </select>
        </div>
      )}
    </div>
  );
}

/* ============================ Main tab ============================ */

export function CompanionsTab({ character, content, onPlay, onSaveMode, onDeleteMode, charKey }: { character: Character; content: ContentDatabase; onPlay?: PlayUpdater; onSaveMode?: (mode: ModeDef) => void; onDeleteMode?: (id: string) => void; charKey?: string }) {
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
  const modesOf = (id: string): ModeDef[] => character.companionModes?.[id] ?? [];
  // Per-companion HP tracker (current = max − tracked damage), wired to the companion-HP mutations.
  const hpTrackerFor = (id: string, max: number): ReactNode => {
    const st = character.companionHp?.[id] ?? { damage: 0, temp: 0 };
    return (
      <HpControl
        current={Math.max(0, max - st.damage)}
        max={max}
        temp={st.temp}
        editable={!!onPlay}
        onSetCurrent={onPlay ? (n) => onPlay((p) => setCompanionHp(p, id, n, max)) : undefined}
        onSetTemp={onPlay ? (n) => onPlay((p) => setCompanionTempHp(p, id, n)) : undefined}
        onDamage={onPlay ? (n) => onPlay((p) => applyCompanionDamage(p, id, n, max)) : undefined}
        onHeal={onPlay ? (n) => onPlay((p) => applyCompanionHeal(p, id, n, max)) : undefined}
      />
    );
  };
  // Vehicles/siege weapons show their OWN level; creatures track the character's level.
  const companionLevel = (cfg: CompanionConfig): number => {
    if (cfg.kind === 'vehicle' && cfg.typeId) return content.vehicles?.[cfg.typeId]?.level ?? character.level;
    if (cfg.kind === 'siege' && cfg.typeId) return content.siegeWeapons?.[cfg.typeId]?.level ?? character.level;
    return character.level;
  };
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
    // Compressed copy → synced companion data; sharp copy (installed app) → on-device store.
    processPortrait(file)
      .then(async ({ compressed, sharp }) => {
        let ref: string | undefined;
        if (sharp) {
          ref = newPortraitRef();
          await setSharpPortrait(ref, sharp);
        }
        onPlay((p) => updatePlayCompanion(p, cfgId, { portrait: compressed, portraitRef: ref }));
        // The replaced sharp copy is NOT eagerly deleted (would break undo); the startup GC reclaims it.
      })
      .catch(() => {});
  };
  const addCompanion = (r: AddRow, buy: boolean) => {
    if (!onPlay) return;
    const cfg = rowToConfig(r);
    if (buy) onPlay((p) => buyCompanion(p, cfg, parsePrice(r.price)));
    else onPlay((p) => addPlayCompanion(p, cfg));
    setAddOpen(false);
  };

  /** Derive + render the selected companion's stat block. */
  const renderBlock = (cfg: CompanionConfig): { node: ReactNode; bulkMax?: number } => {
    const cond = <CompanionConditions compId={cfg.id} conditions={condsOf(cfg.id)} modes={modesOf(cfg.id)} content={content} onPlay={onPlay} onOpen={() => setCondFor(cfg.id)} />;
    // Vehicles & siege weapons: own stat block, trackable HP, no conditions row.
    if (cfg.kind === 'vehicle' || cfg.kind === 'siege') {
      const v: VehicleStat | SiegeWeaponStat | undefined = cfg.typeId
        ? cfg.kind === 'vehicle'
          ? content.vehicles?.[cfg.typeId]
          : content.siegeWeapons?.[cfg.typeId]
        : undefined;
      const label = cfg.kind === 'vehicle' ? 'Vehicle' : 'Siege weapon';
      if (!v) return { node: <StatBlock name={cfg.name || label} kind={label} icon={KIND_ICON[cfg.kind]}><div className="sb-line sb-muted">Pick a type in Edit.</div></StatBlock> };
      const max = v.hp;
      const st = character.companionHp?.[cfg.id] ?? { damage: 0, temp: 0 };
      const cur = Math.max(0, max - st.damage);
      const bt = v.brokenThreshold ?? Math.floor(max / 2);
      const status = cur <= 0 ? 'Destroyed' : cur <= bt ? 'Broken' : null;
      return {
        node: (
          <VehicleBlock
            v={v}
            kindLabel={label}
            icon={KIND_ICON[cfg.kind]}
            hp={hpTrackerFor(cfg.id, max)}
            bt={bt}
            status={status}
            attacks={cfg.kind === 'siege' ? (v as SiegeWeaponStat).attacks : undefined}
          />
        ),
      };
    }
    if (cfg.kind === 'animal') {
      const type = cfg.typeId ? content.animalCompanions[cfg.typeId] : undefined;
      if (!type) return { node: <StatBlock name={cfg.name || 'Animal companion'} kind="Animal companion" icon="ti-paw"><div className="sb-line sb-muted">Pick a type in Edit.</div></StatBlock> };
      const b = deriveAnimalCompanion(cfg, type, character.level, content, condsOf(cfg.id), !!character.variantRules?.proficiencyWithoutLevel, modesOf(cfg.id));
      return { node: <AnimalBlock b={b} cond={cond} hp={hpTrackerFor(cfg.id, b.hp)} />, bulkMax: b.bulk.max };
    }
    if (cfg.kind === 'familiar') {
      const b = deriveFamiliar(cfg, character, content, condsOf(cfg.id), modesOf(cfg.id));
      return { node: <FamiliarBlockView b={b} cond={cond} hp={hpTrackerFor(cfg.id, b.hp)} /> };
    }
    if (cfg.kind === 'eidolon') return { node: <EidolonBlockView b={deriveEidolon(cfg, character, content, condsOf(cfg.id), modesOf(cfg.id))} cond={cond} /> };
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
          onSetValue={(id, value) => onPlay((p) => setCompanionConditionValue(p, condFor, id, value), `ccond:${condFor}:${id}`)}
          onClose={() => setCondFor(null)}
          modesEnabled
          library={Object.values(content.modes).filter((m) => !CATALOG_MODE_MAP[m.id] && (!m.charId || m.charId === charKey))}
          predefined={CATALOG_MODES}
          catalog={CATALOG_MODES}
          classId={character.classId}
          ancestryId={character.ancestryId}
          featIds={new Set(character.feats.map((f) => f.featId))}
          charKey={charKey}
          activeModeIds={modesOf(condFor).map((m) => m.id)}
          onToggleMode={(id) => onPlay((p) => toggleCompanionMode(p, condFor, id, content.modes))}
          onSaveMode={onSaveMode}
          onDeleteMode={onDeleteMode}
        />
      )}
      {addOpen && onPlay && <AddCompanionModal content={content} currency={character.currency} onAdd={addCompanion} onClose={() => setAddOpen(false)} />}
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
              <span className="av"><CompanionPortrait portrait={cfg.portrait} portraitRef={cfg.portraitRef} className="cmp-av-img" icon={meta.icon} /></span>
              {cfg.name || meta.label}
              <span className="lv">Lv {companionLevel(cfg)}</span>
            </button>
          );
        })}
        {addBtn}
      </div>

      <div className="cmp-statcard">
        <div className="cmp-head">
          {canEdit ? (
            <button className="cmp-port cmp-port-edit" type="button" title="Set portrait" onClick={() => { if (isAuto(current)) materializeAuto(current); portraitInputRef.current?.click(); }}>
              <CompanionPortrait portrait={current.portrait} portraitRef={current.portraitRef} className="cmp-port-img" icon={kindMeta(current, content).icon} />
              <span className="cmp-port-badge"><i className="ti ti-camera" aria-hidden="true" /></span>
            </button>
          ) : (
            <span className="cmp-port">
              <CompanionPortrait portrait={current.portrait} portraitRef={current.portraitRef} className="cmp-port-img" icon={kindMeta(current, content).icon} />
            </span>
          )}
          <input ref={portraitInputRef} type="file" accept="image/*" className="cmp-port-file" onChange={(e) => importPortrait(current.id, e)} aria-hidden="true" tabIndex={-1} />
          <div className="cmp-titleblock">
            <div className="cmp-name">{current.name || kindMeta(current, content).label}</div>
            <div className="cmp-tag">{kindMeta(current, content).label} · Level {companionLevel(current)}</div>
          </div>
          {canEdit && (
            <div className="cmp-modes">
              <button className={mode === 'stats' ? 'on' : ''} title="Stat block" onClick={() => enterMode('stats')}><i className="ti ti-layout-list" aria-hidden="true" /></button>
              <button className={mode === 'edit' ? 'on' : ''} title="Edit choices" onClick={() => enterMode('edit')}><i className="ti ti-pencil" aria-hidden="true" /></button>
              <button className={mode === 'inv' ? 'on' : ''} title="Inventory" onClick={() => enterMode('inv')}><i className="ti ti-backpack" aria-hidden="true" /></button>
              {!isAuto(current) && (
                <button
                  className="cmp-del"
                  title="Remove companion"
                  onClick={async () => {
                    if (
                      !(await confirmDialog({
                        title: `Remove ${current.name || kindMeta(current, content).label}?`,
                        message: "This can't be undone.",
                        confirmLabel: 'Remove',
                        danger: true,
                      }))
                    )
                      return;
                    onPlay?.((p) => removePlayCompanion(p, current.id));
                    setSelId(null);
                  }}
                >
                  <i className="ti ti-trash" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="cmp-body" key={mode}>
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
