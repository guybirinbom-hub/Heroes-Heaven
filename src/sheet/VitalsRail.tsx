import { useEffect, useState } from 'react';
import type { Character, ContentDatabase, Item, ModeDef, SenseEntry } from '../rules/types';
import { SAVES } from '../rules/types';
import {
  abilityMod,
  deriveAc,
  deriveClassDc,
  deriveDefenses,
  deriveMaxHp,
  derivePerception,
  deriveSave,
  deriveShield,
  deriveSpeeds,
  deriveSpellcasting,
  formatMod,
} from '../rules/derive';
import {
  addCondition,
  applyDamage,
  applyHeal,
  removeCondition,
  setConditionValue,
  setHeroPoints,
  setHp,
  setResource,
  setShieldDamage,
  setTempHp,
  toggleMode,
  toggleResource,
  updateInventoryItem,
  MAX_HERO_POINTS,
  type PlayState,
} from '../rules/play';
import { usePrefs } from '../data/prefs';
import { CATALOG_MODES, CATALOG_MODE_MAP } from '../rules/modes';
import { CLASS_RESOURCES, resourceMax } from '../rules/classResources';
import { statHasConditionalMode, type StatRef } from '../rules/explain';
import { ConditionsModal } from './ConditionsModal';
import { ItemDetail } from './ItemDetail';
import { ItemEditorModal } from './ItemEditorModal';
import { InfoTerm } from './InfoTerm';
import { senseDesc, languageDesc } from '../rules/glossary';
import { RankPill } from './widgets';

const SAVE_LABEL: Record<string, string> = { fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will' };
const SENSE_LABEL: Record<string, string> = {
  normal: 'Normal vision',
  'low-light': 'Low-light vision',
  'low-light-vision': 'Low-light vision',
  darkvision: 'Darkvision',
  'greater-darkvision': 'Greater darkvision',
};
function senseLabel(s: SenseEntry): string {
  const base = SENSE_LABEL[s.name] ?? s.name.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  const detail = [s.acuity, s.range ? `${s.range} ft` : null].filter(Boolean).join(' ');
  return detail ? `${base} (${detail})` : base;
}
/** Title-case a damage/effect type, e.g. "cold-iron" → "Cold iron". */
function typeLabel(t: string): string {
  const s = t.replace(/-/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function conditionLabel(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** The vitals rail that sits to the left of every tab. */
export function VitalsRail({
  character,
  content,
  charKey,
  onPlay,
  onOpenStat,
  onSaveMode,
  onDeleteMode,
  onCreateItem,
}: {
  character: Character;
  content: ContentDatabase;
  /** Roster id of this character — scopes character-specific modes. */
  charKey?: string;
  onPlay?: (fn: (play: PlayState) => PlayState) => void;
  /** Open the breakdown panel for a stat (clicking any number). */
  onOpenStat?: (ref: StatRef) => void;
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
  /** Register an edited item (enables editing the shield from its rail name). */
  onCreateItem?: (item: Item) => void;
}) {
  const [hpAmt, setHpAmt] = useState('');
  const { hpCommandEntry } = usePrefs();
  const [condOpen, setCondOpen] = useState(false);
  const [shieldDetailOpen, setShieldDetailOpen] = useState(false);
  const [shieldEditOpen, setShieldEditOpen] = useState(false);
  const hpMax = deriveMaxHp(character, content);
  // Editable current-HP field (click the number to set it directly).
  const [hpDraft, setHpDraft] = useState(String(character.hitPoints.current));
  useEffect(() => setHpDraft(String(character.hitPoints.current)), [character.hitPoints.current]);
  const commitHp = () => {
    const n = parseInt(hpDraft, 10);
    if (onPlay && Number.isFinite(n)) onPlay((p) => setHp(p, n, hpMax));
    else setHpDraft(String(character.hitPoints.current));
  };
  // Temp HP is edited inline where it's shown (the "+N temp" in the HP line).
  const [tempDraft, setTempDraft] = useState(String(character.hitPoints.temp));
  useEffect(() => setTempDraft(String(character.hitPoints.temp)), [character.hitPoints.temp]);
  const commitTemp = () => {
    const n = parseInt(tempDraft, 10);
    if (onPlay && Number.isFinite(n)) onPlay((p) => setTempHp(p, Math.max(0, n)));
    else setTempDraft(String(character.hitPoints.temp));
  };
  const hpPct = hpMax > 0 ? Math.round((character.hitPoints.current / hpMax) * 100) : 0;
  const ac = deriveAc(character, content);
  const classDc = deriveClassDc(character);
  // The rail shows one Spell DC: prefer a full tradition pool (prepared/spontaneous/innate) over a
  // focus-only pool, and the highest DC among candidates. A focus-only class still shows its focus DC.
  const scEntries = (character.spellcasting ?? []).map((e) => ({ e, sc: deriveSpellcasting(character, e) }));
  const primary =
    scEntries.filter((x) => x.e.type !== 'focus').sort((a, b) => b.sc.dc - a.sc.dc)[0] ?? scEntries[0];
  const entry = primary?.e;
  const sc = primary?.sc ?? null;
  const perception = derivePerception(character);
  const speeds = deriveSpeeds(character, content);
  // A temporary Speed override (Hasted/Slowed/…) replaces the derived land Speed and is highlighted.
  const speedOverride = character.speedOverride;
  const hasTempSpeed = speedOverride != null && speedOverride !== speeds.land;
  const effectiveLand = speedOverride ?? speeds.land;
  const shield = deriveShield(character, content);
  // Recover the actual equipped/worn shield stack so its name can open the item description
  // (deriveShield returns only display fields). Mirrors deriveShield's own selection.
  const shieldEntry = shield
    ? character.inventory
        .map((inv) => ({ inv, item: content.items[inv.itemId] }))
        .find((x) => (x.inv.equipped || x.inv.worn) && x.item?.itemType === 'shield')
    : undefined;
  const shieldItem = shieldEntry?.item;
  const hasShield = !!shield;
  // If the shield is unequipped/removed/swapped while a shield popup is open, close it so it
  // can't auto-reopen when another shield's block remounts.
  useEffect(() => {
    if (!hasShield) {
      setShieldDetailOpen(false);
      setShieldEditOpen(false);
    }
  }, [hasShield]);
  const charDefenses = deriveDefenses(character, content);

  const classResources = (character.classId && CLASS_RESOURCES[character.classId]) || [];
  const resourceVals = character.classResources ?? {};
  const abilityMods = {
    str: abilityMod(character.abilities.str),
    dex: abilityMod(character.abilities.dex),
    con: abilityMod(character.abilities.con),
    int: abilityMod(character.abilities.int),
    wis: abilityMod(character.abilities.wis),
    cha: abilityMod(character.abilities.cha),
  };

  const hpNum = () => Math.abs(parseInt(hpAmt, 10)) || 0;
  const damage = () => {
    const n = hpNum();
    if (onPlay && n) onPlay((p) => applyDamage(p, n, hpMax));
    setHpAmt('');
  };
  const heal = () => {
    const n = hpNum();
    if (onPlay && n) onPlay((p) => applyHeal(p, n, hpMax));
    setHpAmt('');
  };
  // Quick-HP-entry command field (Settings → Customization): "N" = damage, "-N" = heal, "tN" = temp HP.
  const runHpCommand = () => {
    const raw = hpAmt.trim();
    setHpAmt('');
    if (!onPlay || !raw) return;
    let m: RegExpMatchArray | null;
    if ((m = raw.match(/^t\s*(\d+)$/i))) onPlay((p) => setTempHp(p, Math.max(0, parseInt(m![1], 10))));
    else if ((m = raw.match(/^-\s*(\d+)$/))) onPlay((p) => applyHeal(p, parseInt(m![1], 10), hpMax));
    else if ((m = raw.match(/^\+?\s*(\d+)$/))) onPlay((p) => applyDamage(p, parseInt(m![1], 10), hpMax));
  };

  const acTitle =
    ac.dexCap != null && abilityMods.dex > ac.dexCap
      ? `Dexterity capped at +${ac.dexCap} by armor`
      : undefined;
  const defenses: { label: string; value: string | number; title?: string; ref: StatRef }[] = [
    { label: 'Armor class', value: ac.value, title: acTitle, ref: { kind: 'ac' } },
    { label: 'Class DC', value: classDc.dc, ref: { kind: 'classDc' } },
  ];
  if (sc && entry) {
    defenses.push(
      { label: 'Spell DC', value: sc.dc, ref: { kind: 'spell', entryId: entry.id, which: 'dc' } },
      { label: 'Spell attack', value: formatMod(sc.attack), ref: { kind: 'spell', entryId: entry.id, which: 'attack' } },
    );
  }

  return (
    <aside className="rail">
      <section className="card">
        <div
          className={'ct' + (onOpenStat ? ' openable' : '')}
          onClick={onOpenStat ? () => onOpenStat({ kind: 'hp' }) : undefined}
          title={onOpenStat ? 'How is this calculated?' : undefined}
        >
          <i className="ti ti-heart" aria-hidden="true" />
          Hit points
        </div>
        <div className="hp-line">
          {onPlay ? (
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
                  setHpDraft(String(character.hitPoints.current));
                  e.currentTarget.blur();
                }
              }}
            />
          ) : (
            <span className="hp-cur">{character.hitPoints.current}</span>
          )}
          <span className="hp-max">/ {hpMax}</span>
          {onPlay && !hpCommandEntry ? (
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
                    setTempDraft(String(character.hitPoints.temp));
                    e.currentTarget.blur();
                  }
                }}
              />
              temp
            </span>
          ) : (
            <span className="hp-temp">+{character.hitPoints.temp} temp</span>
          )}
        </div>
        <div className="hp-track">
          <div className="hp-fill" style={{ width: hpPct + '%' }} />
        </div>
        {onPlay &&
          (hpCommandEntry ? (
            <div className="hp-edit hp-edit-cmd">
              <input
                type="text"
                className="hp-amt hp-cmd"
                value={hpAmt}
                placeholder="N dmg · -N heal · tN temp"
                aria-label="Quick HP entry — type a number for damage, -N to heal, tN for temporary HP, then Enter"
                title="Type a number for damage, -N to heal, tN for temporary HP, then press Enter"
                onChange={(e) => setHpAmt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    runHpCommand();
                    e.currentTarget.blur();
                  }
                  if (e.key === 'Escape') {
                    setHpAmt('');
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
              <input
                type="number"
                className="hp-amt"
                value={hpAmt}
                placeholder="HP"
                aria-label="Amount to damage or heal"
                onChange={(e) => setHpAmt(e.target.value)}
              />
              <button className="hp-dmg" onClick={damage} title="Take damage">
                <i className="ti ti-droplet" aria-hidden="true" /> Damage
              </button>
            </div>
          ))}
        <div className="defs">
          {defenses.map((d) => (
            <div
              className={'tile' + (d.title ? ' has-note' : '') + (onOpenStat ? ' openable' : '') + (statHasConditionalMode(character, d.ref) ? ' has-mode' : '')}
              key={d.label}
              title={d.title ?? (onOpenStat ? 'How is this calculated?' : undefined)}
              onClick={onOpenStat ? () => onOpenStat(d.ref) : undefined}
            >
              <div className="tlab">{d.label}</div>
              <div className="tval">{d.value}</div>
            </div>
          ))}
        </div>
        {shield && (
          <div className="shield-block">
            <div className="shield-line" title={shield.name}>
              <i className="ti ti-shield" aria-hidden="true" />
              {shieldItem ? (
                <button
                  type="button"
                  className="sh-name sh-name-btn"
                  title="View details"
                  onClick={() => setShieldDetailOpen(true)}
                >
                  {shield.name}
                </button>
              ) : (
                <span className="sh-name">{shield.name}</span>
              )}
              {shield.broken && (
                <span className="sh-broken">{shield.current <= 0 ? 'Destroyed' : 'Broken'}</span>
              )}
              {onPlay ? (
                <span className="res-step sh-step" title="Shield HP — − for damage taken, + to repair">
                  <button
                    aria-label="Shield takes 1 damage"
                    onClick={() => onPlay((p) => setShieldDamage(p, (character.shieldDamage ?? 0) + 1, shield.hp))}
                  >
                    <i className="ti ti-minus" aria-hidden="true" />
                  </button>
                  <input
                    className="sh-hp-input"
                    type="number"
                    value={shield.current}
                    aria-label="Current shield HP"
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      onPlay((p) => setShieldDamage(p, shield.hp - (Number.isFinite(v) ? v : shield.hp), shield.hp));
                    }}
                  />
                  <span className="sh-hp-max">/ {shield.hp}</span>
                  <button
                    aria-label="Repair shield 1"
                    onClick={() => onPlay((p) => setShieldDamage(p, (character.shieldDamage ?? 0) - 1, shield.hp))}
                  >
                    <i className="ti ti-plus" aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <span className="sh-hp">
                  HP {shield.current} / {shield.hp}
                </span>
              )}
            </div>
            <div className="shield-meta-row">
              <span className="sh-ac">+{shield.ac} AC</span>
              <span className="sh-meta">
                Hardness {shield.hardness} · BT {shield.brokenThreshold}
              </span>
            </div>
            {shieldDetailOpen && shieldEntry && shieldItem && (
              <ItemDetail
                inv={shieldEntry.inv}
                item={shieldItem}
                content={content}
                inventory={character.inventory}
                onPlay={onPlay}
                onClose={() => setShieldDetailOpen(false)}
                onEdit={onCreateItem ? () => { setShieldDetailOpen(false); setShieldEditOpen(true); } : undefined}
              />
            )}
            {shieldEditOpen && shieldEntry && shieldItem && onCreateItem && (
              <ItemEditorModal
                mode="edit"
                item={shieldItem}
                inv={shieldEntry.inv}
                inventory={character.inventory}
                content={content}
                onPlay={onPlay}
                maxSpellRank={Math.min(10, Math.max(1, Math.ceil(character.level / 2)))}
                onSave={(it) => {
                  onCreateItem(it);
                  // Copy-on-write for a built-in shield: repoint only this character's instance.
                  if (onPlay && shieldEntry.inv && it.id !== shieldEntry.inv.itemId) {
                    onPlay((p) => updateInventoryItem(p, shieldEntry.inv.instanceId, { itemId: it.id }));
                  }
                  setShieldEditOpen(false);
                }}
                onClose={() => setShieldEditOpen(false)}
              />
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="ct">
          <i className="ti ti-shield-checkered" aria-hidden="true" />
          Saves &amp; perception
        </div>
        {SAVES.map((s) => {
          const d = deriveSave(character, s, content);
          return (
            <div
              className={'stat-row' + (onOpenStat ? ' rollable' : '') + (statHasConditionalMode(character, { kind: 'save', save: s }) ? ' has-mode' : '')}
              key={s}
              onClick={onOpenStat ? () => onOpenStat({ kind: 'save', save: s }) : undefined}
              title={onOpenStat ? `${SAVE_LABEL[s]} — how is this calculated?` : undefined}
            >
              <RankPill rank={d.rank} />
              <span className="stat-name">{SAVE_LABEL[s]}</span>
              <span className="stat-mod">{formatMod(d.modifier)}</span>
            </div>
          );
        })}
        <div
          className={'stat-row' + (onOpenStat ? ' rollable' : '') + (statHasConditionalMode(character, { kind: 'perception' }) ? ' has-mode' : '')}
          onClick={onOpenStat ? () => onOpenStat({ kind: 'perception' }) : undefined}
          title={onOpenStat ? 'Perception — how is this calculated?' : undefined}
        >
          <RankPill rank={perception.rank} />
          <span className="stat-name">Perception</span>
          <span className="stat-mod">{formatMod(perception.modifier)}</span>
        </div>
      </section>

      <section className="card">
        <div className="ct">
          <i className="ti ti-bolt" aria-hidden="true" />
          Hero points &amp; movement
        </div>
        <div className="rail-kv">
          <span className="kv-label">Hero points</span>
          <span className="pips">
            {Array.from({ length: MAX_HERO_POINTS }, (_, i) => {
              const on = i < character.heroPoints;
              const cls = 'pip' + (on ? ' on' : '') + (onPlay ? ' interactive' : '');
              // Clicking the highest filled pip spends it; clicking elsewhere fills up to it.
              return onPlay ? (
                <button
                  key={i}
                  className={cls}
                  aria-label={`Set hero points to ${i + 1 === character.heroPoints ? i : i + 1}`}
                  onClick={() => onPlay((p) => setHeroPoints(p, i + 1 === character.heroPoints ? i : i + 1))}
                />
              ) : (
                <span key={i} className={cls} />
              );
            })}
          </span>
        </div>
        <div
          className={'rail-kv' + (onOpenStat ? ' openable' : '') + (hasTempSpeed ? ' has-temp' : '')}
          onClick={onOpenStat ? () => onOpenStat({ kind: 'speed' }) : undefined}
          title={onOpenStat ? 'Speed — how is this calculated? Set a temporary Speed here.' : undefined}
        >
          <span className="kv-label">Speed</span>
          <span className="iwr-val">
            {([
              ['', effectiveLand],
              ['Fly', speeds.fly],
              ['Swim', speeds.swim],
              ['Climb', speeds.climb],
              ['Burrow', speeds.burrow],
            ] as const)
              .filter(([, v]) => v != null)
              .map(([label, v]) => `${label ? label + ' ' : ''}${v} ft`)
              .join(' · ') || '0 ft'}
            {hasTempSpeed && <i className="ti ti-bolt sh-temp-flag" aria-hidden="true" title="Temporary Speed active" />}
          </span>
        </div>
        <div className="rail-kv">
          <span className="kv-label">Senses</span>
          <span className="iwr-val senses-val">
            {charDefenses.senses.map((s, i) => (
              <span key={s.name}>
                {i > 0 ? ', ' : ''}
                <InfoTerm title={senseLabel(s)} description={senseDesc(s.name)}>
                  {senseLabel(s)}
                </InfoTerm>
              </span>
            ))}
          </span>
        </div>
      </section>

      {(charDefenses.resistances.length > 0 || charDefenses.weaknesses.length > 0 || charDefenses.immunities.length > 0) && (
        <section className="card">
          <div className="ct">
            <i className="ti ti-shield-half" aria-hidden="true" />
            Defenses
          </div>
          {charDefenses.resistances.length > 0 && (
            <div className="rail-kv">
              <span className="kv-label">Resistances</span>
              <span className="iwr-val">{charDefenses.resistances.map((r) => `${typeLabel(r.type)} ${r.value}`).join(', ')}</span>
            </div>
          )}
          {charDefenses.weaknesses.length > 0 && (
            <div className="rail-kv">
              <span className="kv-label">Weaknesses</span>
              <span className="iwr-val">{charDefenses.weaknesses.map((w) => `${typeLabel(w.type)} ${w.value}`).join(', ')}</span>
            </div>
          )}
          {charDefenses.immunities.length > 0 && (
            <div className="rail-kv">
              <span className="kv-label">Immunities</span>
              <span className="iwr-val">{charDefenses.immunities.map(typeLabel).join(', ')}</span>
            </div>
          )}
        </section>
      )}

      {classResources.length > 0 && (
        <section className="card">
          <div className="ct">
            <i className="ti ti-flame-filled" aria-hidden="true" />
            Class resources
          </div>
          {classResources.map((r) => {
            const val = resourceVals[r.id] ?? 0;
            if (r.kind === 'toggle') {
              return (
                <div className="rail-kv" key={r.id}>
                  <span className="kv-label" title={r.note}>
                    {r.name}
                  </span>
                  {onPlay ? (
                    <button
                      className={'res-toggle' + (val ? ' on' : '')}
                      onClick={() => onPlay((p) => toggleResource(p, r.id))}
                    >
                      {val ? 'On' : 'Off'}
                    </button>
                  ) : (
                    <span>{val ? 'On' : 'Off'}</span>
                  )}
                </div>
              );
            }
            const max = resourceMax(r, character.level, abilityMods);
            return (
              <div className="rail-kv" key={r.id}>
                <span className="kv-label" title={r.note}>
                  {r.name}
                </span>
                {onPlay ? (
                  <span className="res-step">
                    <button aria-label="Decrease" onClick={() => onPlay((p) => setResource(p, r.id, val - 1, max))}>
                      <i className="ti ti-minus" aria-hidden="true" />
                    </button>
                    <span className="res-val">
                      {val} / {max}
                    </span>
                    <button aria-label="Increase" onClick={() => onPlay((p) => setResource(p, r.id, val + 1, max))}>
                      <i className="ti ti-plus" aria-hidden="true" />
                    </button>
                  </span>
                ) : (
                  <span>
                    {val} / {max}
                  </span>
                )}
              </div>
            );
          })}
        </section>
      )}

      <section className="card">
        <div className="ct">
          <i className="ti ti-urgent" aria-hidden="true" />
          Conditions
        </div>
        <div className="pill-wrap">
          {character.conditions.map((c) => {
            const def = content.conditions[c.id];
            const name = def?.name ?? conditionLabel(c.id);
            const valued = def?.valued;
            return (
              <span className="cond-pill" key={c.id} title={def?.description}>
                {name}
                {valued && onPlay ? (
                  <span className="cond-pill-step">
                    <button aria-label="Decrease" onClick={() => onPlay((p) => setConditionValue(p, c.id, (c.value ?? 1) - 1))}>
                      −
                    </button>
                    {c.value ?? 1}
                    <button aria-label="Increase" onClick={() => onPlay((p) => setConditionValue(p, c.id, (c.value ?? 1) + 1))}>
                      +
                    </button>
                  </span>
                ) : (
                  c.value ? ' ' + c.value : ''
                )}
                {onPlay && (
                  <button className="cond-pill-x" aria-label={`Remove ${name}`} onClick={() => onPlay((p) => removeCondition(p, c.id))}>
                    <i className="ti ti-x" aria-hidden="true" />
                  </button>
                )}
              </span>
            );
          })}
          {(character.activeModes ?? []).map((m) => (
            <span className="cond-pill mode-pill" key={m.id} title={m.note ?? m.name}>
              {m.name}
              {onPlay && (
                <button
                  className="cond-pill-x"
                  aria-label={`Deactivate ${m.name}`}
                  onClick={() => onPlay((p) => toggleMode(p, m.id, content.modes))}
                >
                  <i className="ti ti-x" aria-hidden="true" />
                </button>
              )}
            </span>
          ))}
          {onPlay && (
            <button className="add-btn" onClick={() => setCondOpen(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> Add
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <div className="ct">
          <i className="ti ti-language" aria-hidden="true" />
          Languages
        </div>
        <div className="pill-wrap">
          {character.languages.map((id) => (
            <InfoTerm className="lang-pill" key={id} title={content.languages[id]?.name ?? id} description={languageDesc(id)}>
              {content.languages[id]?.name ?? id}
            </InfoTerm>
          ))}
        </div>
      </section>

      {condOpen && onPlay && (
        <ConditionsModal
          conditions={content.conditions}
          active={character.conditions}
          onAdd={(id, valued) => onPlay((p) => addCondition(p, id, valued ? 1 : undefined))}
          onRemove={(id) => onPlay((p) => removeCondition(p, id))}
          onSetValue={(id, value) => onPlay((p) => setConditionValue(p, id, value))}
          onClose={() => setCondOpen(false)}
          modesEnabled
          library={Object.values(content.modes).filter((m) => !CATALOG_MODE_MAP[m.id] && (!m.charId || m.charId === charKey))}
          predefined={CATALOG_MODES}
          catalog={CATALOG_MODES}
          classId={character.classId}
          ancestryId={character.ancestryId}
          featIds={new Set(character.feats.map((f) => f.featId))}
          charKey={charKey}
          charName={character.name}
          activeModeIds={(character.activeModes ?? []).map((m) => m.id)}
          onToggleMode={(id) => onPlay((p) => toggleMode(p, id, content.modes))}
          onSaveMode={onSaveMode}
          onDeleteMode={onDeleteMode}
        />
      )}
    </aside>
  );
}
