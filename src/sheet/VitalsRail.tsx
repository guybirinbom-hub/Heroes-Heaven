import { Fragment, useEffect, useState, type ReactNode } from 'react';
import type { Character, ContentDatabase, Item, ModeDef, SenseEntry } from '../rules/types';
import { SAVES } from '../rules/types';
import { dyingDeathThreshold } from '../rules/conditions';
import {
  abilityMod,
  conditionalResistances,
  deriveAc,
  deriveClassDc,
  deriveDefenses,
  deriveMaxHp,
  derivePerception,
  deriveSave,
  deriveShield,
  deriveSpecialStats,
  deriveSpeeds,
  deriveSpellcasting,
  formatMod,
  modeGateIds,
  stateGrantSummary,
  type DefenseSource,
} from '../rules/derive';
import { deriveInitiative, initiativeInfluenceDetail } from '../rules/initiative';
import { isRestrictedReaction } from '../rules/reactions';
import {
  addCondition,
  applyDamage,
  applyHeal,
  bumpResource,
  removeCondition,
  stepConditionValue,
  setHeroPoints,
  setMythicPoints,
  setHp,
  setShieldDamage,
  setTempHp,
  toggleMode,
  toggleResource,
  updateInventoryItem,
  MAX_HERO_POINTS,
  MAX_MYTHIC_POINTS,
  type PlayUpdater,
} from '../rules/play';
import { useCustomization, DEFAULT_RAIL_ORDER } from '../data/customization';
import { CATALOG_MODES, contentGatedModes, playerModeLibrary } from '../rules/modes';
import { resourcesForCharacter, resourceMaxFor } from '../rules/classResources';
import { explainDefense, markNote, markTooltip, nameOfRecord, recordMarkersFor, saveDcHasSituational, situationalTitle, statHasSituational, statMarkClass, type StatBreakdown, type StatRef } from '../rules/explain';
import { StatDetailModal } from './StatDetailModal';
import { ConditionsModal } from './ConditionsModal';
import { ItemDetail } from './ItemDetail';
import { ItemEditorModal } from './ItemEditorModal';
import { InfoTerm } from './InfoTerm';
import { ModeDetailModal } from './ModeDetailModal';
import { MythicRules, mythicDestinies } from './MythicRules';
import { senseDesc, languageDesc, DAILY_LANGUAGE_NOTE } from '../rules/glossary';
import { RankPill, SituationalStar } from './widgets';
import { useIsMobile } from './useIsMobile';
import { HpNumpadModal } from './HpNumpadModal';

const SAVE_LABEL: Record<string, string> = { fortitude: 'Fortitude', reflex: 'Reflex', will: 'Will' };
// Abbreviated labels for the compact 4-across saves strip on mobile (shown via CSS at <=720px).
const SAVE_SHORT: Record<string, string> = { fortitude: 'Fort', reflex: 'Ref', will: 'Will' };
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

/**
 * One resistance / weakness / immunity, clickable, showing WHERE it came from.
 *
 * A bare "Fire 2" is not actionable: with four resistances a player cannot tell which one disappears
 * if they take the cloak off. So each entry opens the same description popup the rest of the sheet
 * uses, listing every contributing source.
 *
 * Two things the list has to be honest about:
 *  • Same-type resistances DO NOT stack in Pathfinder 2e — the highest applies. A source that lost is
 *    still shown, marked superseded, because "my ring does nothing right now" is exactly what the
 *    player needs to know.
 *  • A grant that only applies sometimes ("while raging") gets a `*`, matching how conditional
 *    bonuses are already marked everywhere else on the sheet.
 */
function IwrTerm({
  label,
  sources,
  first,
  title = 'How is this calculated?',
  onOpen,
}: {
  label: string;
  sources?: DefenseSource[];
  first: boolean;
  /** Hover text. Defaults to the IWR wording; the Initiative value asks a different question. */
  title?: string;
  onOpen: () => void;
}) {
  const conditional = sources?.some((s) => s.condition);
  return (
    <span>
      {first ? '' : ', '}
      <span
        className="info-term"
        role="button"
        tabIndex={0}
        title={title}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen();
          }
        }}
      >
        {label}
      </span>
      {conditional && (
        <span className="iwr-cond" title="Only applies in certain situations — click for details" aria-label="conditional">
          *
        </span>
      )}
    </span>
  );
}

/**
 * The record behind an extra reaction, so its popup note opens like every other situational line.
 *
 * `extraReactions[].from` is the display NAME (build.ts stores the name, not the id), so it has to be
 * mapped back. A name with no match — a homebrew record that was deleted, say — simply has no opener,
 * which is what `SituationalNote` already means by leaving `sourceId` off.
 */
// ponytail: linear scan of two collections, on the popup's click only; index it if it ever runs per render.
function reactionSource(
  content: ContentDatabase,
  from: string,
): { sourceId?: string; sourceCollection?: 'feats' | 'classFeatures' } {
  for (const k of ['feats', 'classFeatures'] as const) {
    const hit = Object.values((content[k] ?? {}) as Record<string, { id: string; name: string }>).find((r) => r.name === from);
    if (hit) return { sourceId: hit.id, sourceCollection: k };
  }
  return {};
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
  onPlay?: PlayUpdater;
  /** Open the breakdown panel for a stat (clicking any number). */
  onOpenStat?: (ref: StatRef) => void;
  onSaveMode?: (mode: ModeDef) => void;
  onDeleteMode?: (id: string) => void;
  /** Register an edited item (enables editing the shield from its rail name). */
  onCreateItem?: (item: Item) => void;
}) {
  const [hpAmt, setHpAmt] = useState('');
  // Shield-HP draft (null = show the live value): a controlled number input that wrote on every keystroke
  // snapped the shield to full HP the moment you cleared it to retype — buffer + commit on blur/Enter.
  const [shDraft, setShDraft] = useState<string | null>(null);
  /** Damage/repair amount for the shield's own HP row (separate from the character's hpAmt). */
  const [shAmt, setShAmt] = useState('');
  const { hpCommandEntry, shieldAutoHardness, hpIwrButtons, showSaveDCs, railOrder, railHidden } = useCustomization();
  const [condOpen, setCondOpen] = useState(false);
  /** The mode whose detail popup is open — clicking a pill opens it. */
  const [modeInfo, setModeInfo] = useState<ModeDef | null>(null);
  /** The "what changes this condition for me" popup — ruling D's condition marker. */
  const [condMark, setCondMark] = useState<{ name: string; marks: { sourceId: string; value?: string; note: string }[] } | null>(null);
  // A resistance/weakness/immunity opens the SAME breakdown modal every other stat uses, rather than a
  // prose popup — one visual language for "how is this number made". The Initiative row uses it too,
  // with an empty calculation, so its list of influences renders through the one path.
  const [defBreak, setDefBreak] = useState<StatBreakdown | null>(null);
  const [shieldDetailOpen, setShieldDetailOpen] = useState(false);
  const [shieldEditOpen, setShieldEditOpen] = useState(false);
  const [mythicRulesOpen, setMythicRulesOpen] = useState(false);
  const hpMax = deriveMaxHp(character, content);
  // 5 with Diehard, else the usual 4. Doomed still steps it down from here.
  const deathBase = character.dyingThreshold ?? 4;
  // …and how much less Doomed counts (Vivacious Gnome: 1). Both ride into every death-threshold read.
  const doomedCut = character.doomedReduction ?? 0;
  // Editable current-HP field (click the number to set it directly).
  const isMobile = useIsMobile();
  const [numpadOpen, setNumpadOpen] = useState(false);
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
  const perception = derivePerception(character, content);
  const initiative = deriveInitiative(character, content);
  // The gate for the Initiative row AND the whole content of its popup — one call, both halves.
  const initInfluences = initiativeInfluenceDetail(character, content);
  // …and whether any of them is OUTSIDE that number, which is what the row's star says. An influence
  // that applies on every initiative roll (Incredible Initiative, ponderous armour) is in the number
  // instead — see `InitiativeInfluence.inNumber`, which is the whole rule and is asked here, on the
  // list this component already holds, rather than through a second helper that could disagree.
  const initHasSituational = initInfluences.some((i) => !i.inNumber);
  // Everything that changes how many reactions this character gets. No count is printed anywhere —
  // see reactions.ts — so this list is both the gate for the row and the whole of its popup.
  const reactionChanges = character.extraReactions ?? [];
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
  /* `against`-only resistances are withheld from charDefenses.resistances by design, so this list is
     the only way they reach the rail — see conditionalResistances in derive.ts. */
  const condResistances = conditionalResistances(charDefenses);

  // Base-class resources PLUS any granted by an owned archetype dedication (Barbarian/Swashbuckler…).
  // Rage and Panache are SIGNATURE STATES: they get a prominent one-tap card of their own (below) and
  // gate actions on the sheet, so drop them from the generic row here — for base class AND archetype
  // users alike — to avoid showing the same toggle twice.
  const STATE_RESOURCES = ['rage', 'panache', 'hunt-prey', 'unleash-psyche'];
  const allResources = resourcesForCharacter(character.classId, new Set(character.feats.map((f) => f.featId)));
  const classResources = allResources.filter((r) => !STATE_RESOURCES.includes(r.id));
  const stateResources = allResources.filter((r) => STATE_RESOURCES.includes(r.id));
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
    if (onPlay && n) onPlay((p) => applyDamage(p, n, hpMax, deathBase, doomedCut));
    setHpAmt('');
  };
  const heal = () => {
    const n = hpNum();
    if (onPlay && n) onPlay((p) => applyHeal(p, n, hpMax));
    setHpAmt('');
  };
  // Shield damage/repair, mirroring the HP row. Damage is reduced by the shield's Hardness when the
  // "Auto-subtract shield Hardness" customization is on (PF2e: a shield prevents damage up to its
  // Hardness). This deliberately affects ONLY the shield — the player's own HP is entered separately.
  const shNum = () => Math.abs(parseInt(shAmt, 10)) || 0;
  const shieldDamageBy = () => {
    const raw = shNum();
    setShAmt('');
    if (!onPlay || !raw || !shield) return;
    const applied = shieldAutoHardness ? Math.max(0, raw - shield.hardness) : raw;
    if (!applied) return; // fully absorbed by Hardness
    onPlay((p) => setShieldDamage(p, (p.shieldDamage ?? 0) + applied, shield.hp), 'shield-hp');
  };
  const shieldRepair = () => {
    const n = shNum();
    setShAmt('');
    if (!onPlay || !n || !shield) return;
    onPlay((p) => setShieldDamage(p, (p.shieldDamage ?? 0) - n, shield.hp), 'shield-hp');
  };
  // Quick-HP-entry command field (Settings → Customization): "N" = damage, "-N" = heal, "tN" = temp HP.
  const runHpCommand = () => {
    const raw = hpAmt.trim();
    setHpAmt('');
    if (!onPlay || !raw) return;
    let m: RegExpMatchArray | null;
    if ((m = raw.match(/^t\s*(\d+)$/i))) onPlay((p) => setTempHp(p, Math.max(0, parseInt(m![1], 10))));
    else if ((m = raw.match(/^-\s*(\d+)$/))) onPlay((p) => applyHeal(p, parseInt(m![1], 10), hpMax));
    else if ((m = raw.match(/^\+?\s*(\d+)$/))) onPlay((p) => applyDamage(p, parseInt(m![1], 10), hpMax, deathBase, doomedCut));
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
    // Spell damage has no total of its own — each spell rolls its own dice — so this tile exists only
    // to carry conditional bonuses (Dangerous Sorcery, Channeler's Stance). Showing it unconditionally
    // would put a permanent "varies" next to two real numbers, so it appears only when it has content.
    const spellDamage: StatRef = { kind: 'spellDamage', entryId: entry.id };
    if (statHasSituational(character, spellDamage, content)) {
      defenses.push({ label: 'Spell damage', value: 'varies', ref: spellDamage });
    }
  }

  // Rail cards keyed by id so Customize can reorder / hide them. Conditional cards resolve to null when
  // they have no content (or don't apply to the class) and are simply skipped.
  const cards: Record<string, ReactNode> = {};
  cards.hp = (
      <section className="card">
        <div
          className={
            'ct' +
            (onOpenStat ? ' openable' : '') +
            statMarkClass(character, { kind: 'hp' }, content)
          }
          onClick={onOpenStat ? () => onOpenStat({ kind: 'hp' }) : undefined}
          title={onOpenStat ? 'How is this calculated?' : undefined}
        >
          <i className="ti ti-heart" aria-hidden="true" />
          Hit points
          {statHasSituational(character, { kind: 'hp' }, content) && <SituationalStar />}
        </div>
        <div className="hp-line">
          {onPlay ? (
            isMobile ? (
              <button
                type="button"
                className="hp-cur hp-cur-tap"
                aria-label="Edit hit points"
                title="Edit hit points"
                onClick={() => setNumpadOpen(true)}
              >
                {character.hitPoints.current}
              </button>
            ) : (
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
            )
          ) : (
            <span className="hp-cur">{character.hitPoints.current}</span>
          )}
          <span className="hp-max">/ {hpMax}</span>
          {onPlay && !hpCommandEntry && !isMobile ? (
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
            character.hitPoints.temp > 0 && <span className="hp-temp">+{character.hitPoints.temp} temp</span>
          )}
        </div>
        <div className="hp-track">
          <div className={'hp-fill' + (hpPct <= 25 ? ' crit' : hpPct <= 50 ? ' low' : '')} style={{ width: hpPct + '%' }} />
        </div>
        {onPlay && !isMobile &&
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
              className={'tile' + (d.title ? ' has-note' : '') + (onOpenStat ? ' openable' : '') + statMarkClass(character, d.ref, content)}
              key={d.label}
              title={d.title ?? (onOpenStat ? 'How is this calculated?' : undefined)}
              onClick={onOpenStat ? () => onOpenStat(d.ref) : undefined}
            >
              <div className="tlab">
                {d.label}
                {statHasSituational(character, d.ref, content) && <SituationalStar />}
              </div>
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
                <span className="sh-hp-read" title="Shield HP">
                  <input
                    className="sh-hp-input"
                    type="number"
                    value={shDraft ?? String(shield.current)}
                    aria-label="Current shield HP"
                    onFocus={(e) => {
                      setShDraft(String(shield.current));
                      e.currentTarget.select();
                    }}
                    onChange={(e) => setShDraft(e.target.value.replace(/[^0-9]/g, ''))}
                    onBlur={() => {
                      const n = parseInt(shDraft ?? '', 10);
                      if (Number.isFinite(n)) onPlay((p) => setShieldDamage(p, shield.hp - Math.max(0, Math.min(shield.hp, n)), shield.hp));
                      setShDraft(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                  />
                  <span className="sh-hp-max">/ {shield.hp}</span>
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
            {onPlay && (
              /* Same Damage / amount / Repair shape as the character's own HP row, instead of the old
               * ±1 stepper. With "Auto-subtract shield Hardness" on (Customize), the number you type is
               * the INCOMING hit and the shield loses damage − Hardness; your own HP is never touched. */
              <div className="hp-edit sh-edit">
                <button className="hp-heal" onClick={shieldRepair} title="Repair shield">
                  <i className="ti ti-plus" aria-hidden="true" /> Repair
                </button>
                <input
                  type="number"
                  className="hp-amt"
                  value={shAmt}
                  placeholder="HP"
                  aria-label="Amount to damage or repair the shield"
                  onChange={(e) => setShAmt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') shieldDamageBy();
                  }}
                />
                <button
                  className="hp-dmg"
                  onClick={shieldDamageBy}
                  title={
                    shieldAutoHardness
                      ? `Shield takes the hit — Hardness ${shield.hardness} is subtracted automatically`
                      : 'Shield takes this much damage (Hardness not applied)'
                  }
                >
                  <i className="ti ti-droplet" aria-hidden="true" /> Damage
                </button>
              </div>
            )}
            {/* bug 2026-09-15: shield runes — the popup's "with the rune" line is computed by
                deriveShield, which needs the owner (a feat-granted reinforcing tier, the
                Monster-Parts variant switch). Without `character` the rail's OWN shield popup was
                the one place that could not print what the rail prints. */}
            {shieldDetailOpen && shieldEntry && shieldItem && (
              <ItemDetail
                inv={shieldEntry.inv}
                item={shieldItem}
                content={content}
                inventory={character.inventory}
                feats={character.feats}
                character={character}
                charLevel={character.level}
                onPlay={onPlay}
                activeModes={character.activeModes}
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
                character={character}
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
  );
  cards.saves = (
      <section className="card">
        <div className="ct">
          <i className="ti ti-shield-checkered" aria-hidden="true" />
          {/* bug 2026-09-16: rail perception — Perception is back beside the saves, where the owner
              wants to read it. Initiative stays out of this card: it is only ever shown when something
              actually changes it, and that row lives in Essentials (see below). */}
          Saves
        </div>
        <div className="saves-strip">
        {SAVES.map((s) => {
          const d = deriveSave(character, s, content);
          return (
            <div
              className={'stat-row' + (onOpenStat ? ' rollable' : '') + statMarkClass(character, { kind: 'save', save: s }, content)}
              key={s}
              onClick={onOpenStat ? () => onOpenStat({ kind: 'save', save: s }) : undefined}
              title={onOpenStat ? `${SAVE_LABEL[s]} — how is this calculated?` : undefined}
            >
              <RankPill rank={d.rank} />
              <span className="stat-name">
                {SAVE_LABEL[s]}
                {/* The star carries the clause itself — a Spellguard Shield's "while the shield is
                    Raised" — rather than the generic "open for details", which is what a
                    comparable app shows on the same row. */}
                {statHasSituational(character, { kind: 'save', save: s }, content) && (
                  <SituationalStar title={situationalTitle(character, { kind: 'save', save: s }, content)} />
                )}
              </span>
              <span className="stat-short">{SAVE_SHORT[s]}</span>
              {/* Ruling D: a bonus that only moves the DC others roll against gets its `*` HERE, not
                  beside the save's name — the save you roll gets nothing from it. */}
              {showSaveDCs && (
                <span className="stat-dc" title="Save DC">
                  DC {10 + d.modifier}
                  {saveDcHasSituational(character, s, content) && <SituationalStar />}
                </span>
              )}
              <span className="stat-mod">{formatMod(d.modifier)}</span>
            </div>
          );
        })}
        {/* bug 2026-09-16: rail perception — back on this card, in the shape it had before it left:
            rank pill, situational star, its own DC when the setting is on. Initiative did NOT come
            back with it — that row appears in Essentials only when something changes it. */}
        <div
          className={'stat-row' + (onOpenStat ? ' rollable' : '') + statMarkClass(character, { kind: 'perception' }, content)}
          onClick={onOpenStat ? () => onOpenStat({ kind: 'perception' }) : undefined}
          title={onOpenStat ? 'Perception — how is this calculated?' : undefined}
        >
          <RankPill rank={perception.rank} />
          <span className="stat-name">
            Perception
            {statHasSituational(character, { kind: 'perception' }, content) && <SituationalStar />}
          </span>
          <span className="stat-short">Perc</span>
          {/* Perception has a DC too — it's what a Sneaking or Hiding creature rolls against, and it
              was the one number on this card the setting didn't cover. */}
          {showSaveDCs && (
            <span className="stat-dc" title="Perception DC">
              DC {10 + perception.modifier}
            </span>
          )}
          <span className="stat-mod">{formatMod(perception.modifier)}</span>
        </div>
        </div>
      </section>
  );
  cards.movement = (
      <section className="card">
        <div className="ct">
          <i className="ti ti-bolt" aria-hidden="true" />
          {/* bug 2026-09-15: rail initiative — a general name, because the card also holds Reactions
              and (when anything affects it) Initiative. Perception went back to the saves card on
              2026-09-16; the name still fits what is left. */}
          Essentials
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
        <div className="kv-cubes">
        <div
          className={
            'rail-kv' +
            (onOpenStat ? ' openable' : '') +
            (hasTempSpeed ? ' has-temp' : '') +
            statMarkClass(character, { kind: 'speed' }, content)
          }
          onClick={onOpenStat ? () => onOpenStat({ kind: 'speed' }) : undefined}
          title={onOpenStat ? 'Speed — how is this calculated? Set a temporary Speed here.' : undefined}
        >
          <span className="kv-label">
            Speed
            {statHasSituational(character, { kind: 'speed' }, content) && <SituationalStar />}
          </span>
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
        {/* Extra RESTRICTED reactions. Every character has one unrestricted reaction per round; 15
            feats grant a second one usable only for a named thing, and nothing tracked reactions at
            all, so all 15 were a sentence on the Feats tab and no number anywhere. */}
        {/* bug 2026-09-15: rail reactions — owner: *"i don't want the whole text block there because
            it's too big … add a Reactions row … and that popup will show the full explanation."* So
            the row carries one pressable thing and nothing else, and the FULL untrimmed wording lives
            in the popup, exactly the shape the Initiative row below uses. */}
        {/* bug 2026-09-16: rail reactions — owner, on a guardian reading "2 per round": that second
            reaction *"can only be used for guardian reactions"*, so the number was a promise the rules
            do not keep. Counting only the unrestricted extras left "1 per round", which is true of
            every character alive — so, second ruling the same day: *"don't show 1 per round … if a
            character has something with reaction amount changes then add the reaction line and have a
            `*` and the `*` when clicked shows the reaction changes."* No number, ever. The row exists
            only when something changes the count, and the star IS the value. */}
        {reactionChanges.length > 0 && (
          <div className="rail-kv">
            <span className="kv-label">Reactions</span>
            <span className="iwr-val">
              {/* bug 2026-09-16 (refutation): this star is the row's ONLY control, and as a bare
                  `.cond-mark` it measured 7.4 × 0 px. That class is `inline-flex` and its only child,
                  `.sit-star`, carries `line-height: 0` — beside a condition pill, which is pressable
                  itself, the star is a garnish and the collapsed box never showed; here the whole row
                  is the button, so all a finger could hit was the glyph overflowing a box with no
                  height, wearing the `cursor: help` `.sit-star` sets rather than a pointer.
                  So: a real target, and the 09-15 ruling's *"dotted line underneath so that the player
                  will know it's pressable"* under the whole of it — `.rail-star-btn` in sheet.css,
                  which also un-collapses the glyph `.sit-star` assumes is sitting inside a line of
                  text. `.cond-mark` itself now carries a 24 × 24 target for the stars beside the
                  condition pills, which are tapped on a phone too. */}
              <button
                className="cond-mark rail-star-btn"
                aria-label="What changes your reactions"
                /* The clause the star SAYS, like every other star on this sheet — on the BUTTON, so it
                   covers the whole target (a child with no `title` of its own inherits the tooltip). */
                title={reactionChanges
                  .map((r) => (isRestrictedReaction(r) ? `${r.from}: usable only for ${r.usableFor}` : `${r.from}: +${r.count} reaction`))
                  .join('\n')}
                onClick={() =>
                  setDefBreak({
                    title: 'Reactions',
                    subtitle: 'everyone gets one reaction each round — this is what changes that',
                    // No total: the count is exactly what the owner took off this row. No parts and no
                    // timeline either — a reaction is not a calculated modifier, so the only thing to
                    // say is which record changes it and what the extra may be spent on.
                    totalText: '',
                    parts: [],
                    timeline: [],
                    // Nothing in this list is a bonus the player "applies when it fits" — it is who
                    // gave them the extra reaction — so it does not wear that heading.
                    situationalLabel: 'What gives you extra reactions',
                    // EVERY change, restricted or not, each with its own printed clause.
                    situational: reactionChanges.map((r) => ({
                      text: isRestrictedReaction(r)
                        ? `+${r.count} reaction — usable only for ${r.usableFor} — ${r.from}`
                        : `+${r.count} reaction — ${r.from}`,
                      ...reactionSource(content, r.from),
                    })),
                  })
                }
              >
                <sup className="sit-star" aria-hidden="true">
                  *
                </sup>
              </button>
            </span>
          </div>
        )}
        {/* Initiative ONLY when something actually changes it. "In pf2e initiative isn't always
            perception" — but usually it IS, and a row that repeated the Perception number every time
            taught the player nothing. `initiativeInfluenceDetail` is the gate and the popup's whole
            content; it deliberately excludes the plain Perception/skill terms. */}
        {initInfluences.length > 0 && (
          <div className="rail-kv">
            <span className="kv-label">Initiative</span>
            <span className="iwr-val">
              <IwrTerm
                first
                label={`${formatMod(initiative.modifier)} (${initiative.label})`}
                title="What affects your initiative?"
                onOpen={() =>
                  setDefBreak({
                    title: 'Initiative',
                    subtitle: `rolled with ${initiative.label}`,
                    totalText: formatMod(initiative.modifier),
                    // No parts, no timeline, no description: those would be the PERCEPTION breakdown,
                    // which is one click away on its own row. This popup answers one question — what
                    // makes my initiative different from that number.
                    parts: [],
                    timeline: [],
                    /*
                     * bug 2026-09-16 (refutation): this list is NOT "situational (apply when it fits)".
                     * Some of it always applies — ponderous armour's check penalty is on every single
                     * initiative roll — and printing "always applies" under a heading that says the
                     * opposite made the popup argue with itself.
                     */
                    situationalLabel: 'What changes your initiative',
                    // TWO kinds, and only two — owner, 2026-09-16: a number for what always applies, a
                    // star for what applies only sometimes. The third label this list used to carry
                    // ("every initiative roll — add it yourself") was homework the engine could do,
                    // and now does: an always-on bonus is inside the value above.
                    situational: initInfluences.map(({ note, inNumber }) => ({
                      ...note,
                      text: `${note.text} ${inNumber ? '(in the number)' : '(only sometimes — apply it yourself)'}`,
                    })),
                  })
                }
              />
              {/* bug 2026-09-16: rail initiative — the star means one thing, "not in that number".
                  "On initiative rolls" is not a sometimes-clause on the Initiative row, it is the row,
                  so it is counted instead — see `ALWAYS_ON_WHEN` and `initiativeTerms`. */}
              {initHasSituational && <SituationalStar title="Something affects your initiative only in certain situations — open for details" />}
            </span>
          </div>
        )}
        <div className="rail-kv">
          <span className="kv-label">Senses</span>
          <span className="iwr-val senses-val">
            {/* Q13: a superseded rung of the vision ladder is HELD but not printed — see deriveDefenses. */}
            {charDefenses.senses.filter((s) => !s.superseded).map((s, i) => (
              <span key={s.name}>
                {i > 0 ? ', ' : ''}
                <InfoTerm title={senseLabel(s)} description={senseDesc(s.name)}>
                  {senseLabel(s)}
                </InfoTerm>
                {/* A range that belongs to ONE stimulus, not to the sense — Carcharodon Merfolk:
                    *"You gain scent as an imprecise sense with a range of 30 feet. However, you can
                    smell spilled blood at a range of 120 feet in the air and 500 feet in the water."*
                    The label can only print the sense's own range, so the second sentence lived
                    nowhere but the description prose. Rendered on the row, which is where WG binds
                    it (injectText onto the scent sense itself). */}
                {s.note && <span className="sh-sub"> — {s.note}</span>}
              </span>
            ))}
          </span>
        </div>
        </div>
      </section>
  );
  cards.defenses =
    charDefenses.resistances.length > 0 ||
    condResistances.length > 0 ||
    charDefenses.weaknesses.length > 0 ||
    charDefenses.immunities.length > 0 ||
    charDefenses.negativeHealing ? (
        <section className="card">
          <div className="ct">
            <i className="ti ti-shield-half" aria-hidden="true" />
            Defenses
          </div>
          {charDefenses.negativeHealing && (
            <div className="rail-kv">
              <span className="kv-label">Void healing</span>
              <span className="iwr-val">
                <InfoTerm title="Void healing" description="You are healed by void (negative) energy and harmed by vitality (positive) energy, as if you were undead.">
                  healed by void, harmed by vitality
                </InfoTerm>
              </span>
            </div>
          )}
          {charDefenses.resistances.length > 0 && (
            <div className="rail-kv">
              <span className="kv-label">Resistances</span>
              <span className="iwr-val">
                {charDefenses.resistances.map((r, i) => (
                  <IwrTerm
                    key={r.type}
                    first={i === 0}
                    label={`${typeLabel(r.type)} ${r.value}`}
                    sources={charDefenses.sources?.[`resistance:${r.type}`]}
                    onOpen={() => setDefBreak(explainDefense(charDefenses, 'resistance', r.type))}
                  />
                ))}
              </span>
            </div>
          )}
          {/* Its own row: the number applies only against a named source, so printing it beside the
              always-on resistances would claim one the character usually does not have. */}
          {condResistances.length > 0 && (
            <div className="rail-kv">
              <span className="kv-label">Situational resistances</span>
              <span className="iwr-val">
                {condResistances.map((r, i) => (
                  <IwrTerm
                    key={r.type}
                    first={i === 0}
                    label={`${typeLabel(r.type)} ${r.value}`}
                    sources={charDefenses.sources?.[`resistance:${r.type}`]}
                    onOpen={() => setDefBreak(explainDefense(charDefenses, 'resistance', r.type))}
                  />
                ))}
              </span>
            </div>
          )}
          {charDefenses.weaknesses.length > 0 && (
            <div className="rail-kv">
              <span className="kv-label">Weaknesses</span>
              <span className="iwr-val">
                {charDefenses.weaknesses.map((w, i) => (
                  <IwrTerm
                    key={w.type}
                    first={i === 0}
                    label={`${typeLabel(w.type)} ${w.value}`}
                    sources={charDefenses.sources?.[`weakness:${w.type}`]}
                    onOpen={() => setDefBreak(explainDefense(charDefenses, 'weakness', w.type))}
                  />
                ))}
              </span>
            </div>
          )}
          {charDefenses.immunities.length > 0 && (
            <div className="rail-kv">
              <span className="kv-label">Immunities</span>
              <span className="iwr-val">
                {charDefenses.immunities.map((t, i) => (
                  <IwrTerm
                    key={t}
                    first={i === 0}
                    label={typeLabel(t)}
                    sources={charDefenses.sources?.[`immunity:${t}`]}
                    onOpen={() => setDefBreak(explainDefense(charDefenses, 'immunity', t))}
                  />
                ))}
              </span>
            </div>
          )}
        </section>
    ) : null;
  // Secondary class DCs from multiclass dedications (Fighter/Ranger/Rogue/Alchemist Dedication).
  cards.multiclassDc = character.secondaryClassDcs?.length ? (
    <section className="card">
      <div className="ct">
        <i className="ti ti-shield-bolt" aria-hidden="true" />
        Multiclass DCs
      </div>
      {character.secondaryClassDcs.map((d) => (
        <div className="rail-kv" key={d.classId}>
          <span className="kv-label">{d.name} DC</span>
          <span className="iwr-val">
            {/* The rank was hardcoded "trained" here as well as in the DC, so Alchemical Power and
                Officer's Expertise/Mastery could not show what they raise it to. */}
            {d.dc} <span className="mc-key">({d.keyAbility.toUpperCase()}, {d.rank ?? 'trained'})</span>
          </span>
        </div>
      ))}
    </section>
  ) : null;
  /*
   * NAMED statistics that no other row on this sheet is labelled for — the kineticist's impulse
   * attack roll, a scroll's DC under Scroll Thaumaturgy. See the `specialStatistic` lane.
   *
   * A SEPARATE card from "Multiclass DCs" on purpose. That one answers "what is my borrowed class
   * DC" — the same statistic another class already has a row for — while these are numbers the
   * player can find nowhere else. Folding them together would also have meant renaming the
   * `multiclassDc` rail key, which every saved rail order and the Customize editor's label map key
   * off, for no gain to the reader.
   */
  const specialStats = deriveSpecialStats(character, content);
  cards.specialStats = specialStats.length ? (
    <section className="card">
      <div className="ct">
        <i className="ti ti-math-symbols" aria-hidden="true" />
        Special statistics
      </div>
      {specialStats.map((s) => (
        <div
          className={'rail-kv' + (onOpenStat ? ' openable' : '')}
          key={s.key}
          onClick={onOpenStat ? () => onOpenStat({ kind: 'specialStat', statKey: s.key }) : undefined}
          title={onOpenStat ? `${s.name} — how is this calculated?` : undefined}
        >
          <span className="kv-label">{s.name}</span>
          <span className="iwr-val">
            {s.kind === 'dc' ? s.value : formatMod(s.value)}{' '}
            {/* The basis is not decoration: the statistic has no proficiency track of its own, so the
                player needs to see which class DC raising it would raise this number too. */}
            <span className="mc-key">
              ({s.basisLabel}{s.borrowed ? ', archetype' : ''}, {s.rank})
            </span>
          </span>
        </div>
      ))}
    </section>
  ) : null;
  cards.resources =
    classResources.length > 0 ? (
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
            const max = resourceMaxFor(r, character, abilityMods);
            return (
              <div className="rail-kv" key={r.id}>
                <span className="kv-label" title={r.note}>
                  {r.name}
                </span>
                {onPlay ? (
                  <span className="res-step">
                    <button aria-label="Decrease" onClick={() => onPlay((p) => bumpResource(p, r.id, val, -1, max), `res:${r.id}`)}>
                      <i className="ti ti-minus" aria-hidden="true" />
                    </button>
                    <span className="res-val">
                      {val} / {max}
                    </span>
                    <button aria-label="Increase" onClick={() => onPlay((p) => bumpResource(p, r.id, val, 1, max), `res:${r.id}`)}>
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
    ) : null;
  // Signature STATE toggles — Rage and Panache — as prominent one-tap cards, shown for a base-class OR
  // an archetype-dedication holder. Each drives the SAME class-resource value as the (now-hidden) generic
  // row and gates the "needs <state>" badges on the Main tab's action list. One card per state the
  // character has, under the shared 'panache' rail slot (kept for saved rail-order compatibility).
  const STATE_UI: Record<string, { label: string; on: string; off: string; onHint: string; offHint: string; icon: string; onIcon: string; offIcon: string }> = {
    rage: { label: 'Rage', on: 'Raging', off: 'Not raging', onHint: 'Tap to end rage', offHint: 'Tap to enter rage', icon: 'ti-flame', onIcon: 'ti-flame-filled', offIcon: 'ti-flame' },
    panache: { label: 'Panache', on: 'Panache', off: 'No panache', onHint: 'Tap to spend', offHint: 'Tap to gain', icon: 'ti-sparkles', onIcon: 'ti-flame-filled', offIcon: 'ti-flame' },
    'hunt-prey': { label: 'Hunt Prey', on: 'Prey marked', off: 'No prey', onHint: 'Tap to clear prey', offHint: 'Tap to mark prey', icon: 'ti-crosshair', onIcon: 'ti-crosshair', offIcon: 'ti-crosshair' },
    'unleash-psyche': { label: 'Unleash Psyche', on: 'Unleashed', off: 'Not unleashed', onHint: 'Tap to end', offHint: 'Tap to unleash', icon: 'ti-brain', onIcon: 'ti-brain', offIcon: 'ti-brain' },
  };
  cards.panache = stateResources.length ? (
    <>
      {stateResources.map((r) => {
        const ui = STATE_UI[r.id];
        const on = !!(resourceVals[r.id] ?? 0);
        // Principle C: what entering this state grants has to be readable BEFORE you enter it. A
        // barbarian could not see that raging gives them Acute Vision's darkvision until they raged.
        const grants = stateGrantSummary(character, content, r.id);
        return (
          <section key={r.id} className={`card state-card state-${r.id}` + (on ? ' on' : '')}>
            <div className="ct">
              <i className={'ti ' + ui.icon} aria-hidden="true" />
              {ui.label}
            </div>
            {onPlay ? (
              <button type="button" className={'state-toggle' + (on ? ' on' : '')} aria-pressed={on} title={r.note} onClick={() => onPlay((p) => toggleResource(p, r.id))}>
                <i className={'ti ' + (on ? ui.onIcon : ui.offIcon)} aria-hidden="true" />
                <span className="state-name">{on ? ui.on : ui.off}</span>
                <span className="state-hint">{on ? ui.onHint : ui.offHint}</span>
              </button>
            ) : (
              <div className={'state-toggle' + (on ? ' on' : '')} aria-disabled="true">
                <i className={'ti ' + (on ? ui.onIcon : ui.offIcon)} aria-hidden="true" />
                <span className="state-name">{on ? ui.on : ui.off}</span>
              </div>
            )}
            {grants.length > 0 && (
              <div className="state-grants">
                <span className="sg-head">{ui.label} grants</span>
                {grants.map((g) => (
                  <div key={g.from}>
                    <span className="sg-from">{g.from}</span> {[...g.senses.map(senseLabel), ...g.other].join(', ')}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  ) : null;
  // Champion: an at-a-glance card naming the chosen Cause (its tenets + signature reaction + aura live in
  // the description popup). A reminder only — the reaction's numbers are target-specific, so nothing derives.
  const cause = character.classId === 'champion' && character.subclassId ? content.classFeatures[character.subclassId] : undefined;
  cards.champion = cause ? (
      <section className="card">
        <div className="ct">
          <i className="ti ti-shield-half" aria-hidden="true" />
          Cause
        </div>
        <div className="pill-wrap">
          <InfoTerm className="lang-pill" title={cause.name} description={cause.description} descRefs={cause.descRefs} descKey="classFeatures">
            {cause.name}
          </InfoTerm>
        </div>
      </section>
  ) : null;
  // Mythic (War of Immortals): the mythic-points pool (spend 1 to reroll a check or save — Rewrite Fate)
  // plus at-a-glance chips for the chosen Calling and Destiny (the L12 dedication the character took),
  // and a shortcut into the in-app Mythic rules reference. Only shown for mythic characters.
  const mythicCalling =
    character.mythicEnabled && character.mythicCalling ? content.classFeatures[character.mythicCalling] : undefined;
  // The destiny is an explicit choice (build.mythicDestiny). Characters built before that existed
  // fall back to the old inference — whichever destiny dedication is in their feat list — so an
  // existing sheet keeps showing its destiny without being re-edited.
  const mythicDestiny = character.mythicEnabled
    ? (() => {
        const groups = mythicDestinies(content);
        if (character.mythicDestiny) return groups.find((g) => g.slug === character.mythicDestiny);
        const taken = new Set(character.feats.map((f) => f.featId));
        return groups.find((g) => g.dedication && taken.has(g.dedication.id));
      })()
    : undefined;
  cards.mythic = character.mythicEnabled ? (
      <section className="card">
        <div className="ct">
          <i className="ti ti-flame" aria-hidden="true" />
          Mythic
        </div>
        <div className="rail-kv">
          <span className="kv-label">Mythic points</span>
          <span className="pips">
            {Array.from({ length: MAX_MYTHIC_POINTS }, (_, i) => {
              const on = i < (character.mythicPoints ?? 0);
              const cls = 'pip mythic' + (on ? ' on' : '') + (onPlay ? ' interactive' : '');
              return onPlay ? (
                <button
                  key={i}
                  className={cls}
                  aria-label={`Set mythic points to ${i + 1 === (character.mythicPoints ?? 0) ? i : i + 1}`}
                  onClick={() => onPlay((p) => setMythicPoints(p, i + 1 === (character.mythicPoints ?? 0) ? i : i + 1))}
                />
              ) : (
                <span key={i} className={cls} />
              );
            })}
          </span>
        </div>
        <div className="pill-wrap">
          {mythicCalling && (
            <InfoTerm
              className="lang-pill"
              title={mythicCalling.name}
              description={mythicCalling.description}
              descRefs={mythicCalling.descRefs}
              descKey="classFeatures"
            >
              {mythicCalling.name}
            </InfoTerm>
          )}
          {mythicDestiny?.dedication && (
            <InfoTerm
              className="lang-pill"
              title={mythicDestiny.dedication.name}
              description={mythicDestiny.dedication.description}
              descRefs={mythicDestiny.dedication.descRefs}
              descKey="feats"
            >
              {mythicDestiny.name}
            </InfoTerm>
          )}
          <button type="button" className="lang-pill mythic-rules-pill" onClick={() => setMythicRulesOpen(true)}>
            <i className="ti ti-book-2" aria-hidden="true" /> Rules
          </button>
        </div>
        <p className="mythic-note">
          Spend 1 point to reroll a failed skill check or save at mythic proficiency (Rewrite Fate). Mythic points last
          one session: you start each with 3. Regain 2 for slaying a mythic foe, 3 for a mythic deed, 1 for following
          your Calling&rsquo;s edicts.
        </p>
      </section>
  ) : null;
  cards.conditions = (
      <section className="card">
        <div className="ct">
          <i className="ti ti-urgent" aria-hidden="true" />
          Conditions
        </div>
        <div className="pill-wrap cond-wrap">
          {character.conditions.map((c) => {
            const def = content.conditions[c.id];
            const name = def?.name ?? conditionLabel(c.id);
            const valued = def?.valued;
            // Dying at/above its death threshold (4, reduced by Doomed) means the character is DEAD —
            // make that unmistakable instead of showing the same neutral pill as Dying 1.
            const doomedVal = character.conditions.find((x) => x.id === 'doomed')?.value ?? 0;
            const dead = c.id === 'dying' && (c.value ?? 1) >= dyingDeathThreshold(doomedVal, deathBase, doomedCut);
            // Ruling D: something that changes how a condition works FOR YOU (The Survivor and Dying)
            // marks the condition itself — there is no stat row it could sit on, and starring the
            // nearest roll would claim a bonus it does not give.
            const marks = recordMarkersFor(character, content, 'condition', c.id);
            // bug 2026-09-16: derived conditions — `applyPlayState` worked this one out (Bulk, an
            // active mode) and says so on the entry itself, so it is not the player's to remove: it
            // goes when its cause goes. It used to wear a remove button that silently did nothing.
            // Read off the condition, never re-derived here — see ActiveCondition.derivedFrom.
            const auto = c.derivedFrom;
            return (
              <span className={'cond-pill' + (dead ? ' cond-dead' : '') + (auto ? ' cond-auto' : '')} key={c.id}>
                <InfoTerm title={name} description={def?.description} descRefs={def?.descRefs} descKey="conditions">
                  {dead ? `Dead — ${name}` : name}
                </InfoTerm>
                {marks.length > 0 && (
                  <button
                    className="cond-mark"
                    // Attributed AND de-duplicated: this used to print notes alone, so a note that
                    // opens with its own record name was the only attribution — and the popup below,
                    // which prints the name itself, showed it twice. `markTooltip` does both.
                    title={markTooltip(content, marks)}
                    onClick={() => setCondMark({ name, marks })}
                    aria-label={`What changes ${name} for you`}
                  >
                    <SituationalStar />
                  </button>
                )}
                {/* bug 2026-09-16 (second pass): a DERIVED valued condition keeps its value but not its
                    stepper. The lock already said the condition is not the player's to remove, while
                    the ± beside it still offered to change the one thing about it they cannot change:
                    the value comes from the cause (a mode's Enfeebled 1, Bulk), and `applyPlayState`
                    re-derives it on the next pass. A dead control is worse than none. */}
                {valued && onPlay && !auto ? (
                  <span className="cond-pill-step">
                    <button aria-label="Decrease" onClick={() => onPlay((p) => stepConditionValue(p, c.id, -1), `cond:${c.id}`)}>
                      −
                    </button>
                    {c.value ?? 1}
                    <button aria-label="Increase" onClick={() => onPlay((p) => stepConditionValue(p, c.id, 1), `cond:${c.id}`)}>
                      +
                    </button>
                  </span>
                ) : (
                  c.value ? ' ' + c.value : ''
                )}
                {/*
                 * THE RECOVERY DC, on the one pill where it is the number you need.
                 *
                 * A dying character rolls a flat check at the start of their turn against DC 10 + their
                 * dying value, and nine records change that DC — Toughness's *"you reduce the DC of
                 * recovery checks by 1"* among them. None had a field, so the reduction lived nowhere and
                 * the player had to remember it. Shown here rather than starred on a stat, because a flat
                 * check has no stat row to sit on — the same reasoning as ruling D above, which marks the
                 * condition itself.
                 */}
                {c.id === 'dying' && !dead && (() => {
                  /*
                   * DC 10 + your dying value, less any reduction — except for the two records that
                   * restate the formula rather than reducing it: Mountain's Stoutness only reduces it at
                   * Dying 1 (`recoveryDcOnlyAtDying`), and Nine Lives Catfolk does not add the dying
                   * value at all (`recoveryDcIgnoresDyingValue`).
                   */
                  const dying = c.value ?? 1;
                  const gate = character.recoveryDcOnlyAtDying;
                  const cut = gate != null && dying > gate ? 0 : character.recoveryDcReduction ?? 0;
                  const dc = 10 + (character.recoveryDcIgnoresDyingValue ? 0 : dying) - cut;
                  const why = [
                    character.recoveryDcIgnoresDyingValue ? 'your dying value is not added' : null,
                    cut ? `reduced by ${cut}` : null,
                    gate != null && dying > gate ? `your reduction applies only at Dying ${gate}` : null,
                  ].filter(Boolean).join('; ');
                  return (
                    <span className="cond-pill-dc" title={`Flat check at the start of your turn: DC 10 + your dying value${why ? ` — ${why}` : ''}.`}>
                      {`recovery DC ${dc}`}
                    </span>
                  );
                })()}
                {auto ? (
                  <span
                    className="cond-auto-lock"
                    title={`Automatic — from ${auto}. It clears itself when its cause does.`}
                    aria-label={`${name} is automatic (from ${auto}) and cannot be removed`}
                  >
                    <i className="ti ti-lock" aria-hidden="true" />
                    {`from ${auto.replace(/ —.*$/, '')}`}
                  </span>
                ) : (
                  onPlay && (
                    <button className="cond-pill-x" aria-label={`Remove ${name}`} onClick={() => onPlay((p) => removeCondition(p, c.id))}>
                      <i className="ti ti-x" aria-hidden="true" />
                    </button>
                  )
                )}
              </span>
            );
          })}
          {(character.activeModes ?? []).map((m) => (
            <span className="cond-pill mode-pill" key={m.id}>
              {/* The pill is CLICKABLE: a mode's own text was previously only a hover tooltip, which
                  is unreachable on a phone and easy to miss anywhere else. A display-only mode (a
                  timed state with no numbers — fast healing, concealment) is ENTIRELY its note, so
                  hiding that behind a tooltip hid the whole point of it. */}
              <button className="mode-pill-name" onClick={() => setModeInfo(m)} title="What is this?">
                {m.name}
                {m.duration && <span className="mode-pill-dur">{m.duration}</span>}
              </button>
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
  );
  cards.languages = (
      <section className="card">
        <div className="ct">
          <i className="ti ti-language" aria-hidden="true" />
          Languages
        </div>
        <div className="pill-wrap">
          {character.languages.map((id) => {
            // Recalled at daily preparations, not known — see the same marking on the Details tab.
            const today = character.dailyLanguages?.includes(id);
            const name = content.languages[id]?.name ?? id;
            return (
              <InfoTerm
                className={'lang-pill' + (today ? ' granted-trait' : '')}
                key={id}
                title={today ? `${name} — recalled today` : name}
                description={today ? `${languageDesc(id)} ${DAILY_LANGUAGE_NOTE}` : languageDesc(id)}
              >
                {name}
              </InfoTerm>
            );
          })}
        </div>
      </section>
  );

  const hidden = new Set(railHidden ?? []);
  const savedOrder = (railOrder && railOrder.length ? railOrder : DEFAULT_RAIL_ORDER).filter((id) => DEFAULT_RAIL_ORDER.includes(id));
  const cardOrder = [...savedOrder, ...DEFAULT_RAIL_ORDER.filter((id) => !savedOrder.includes(id))];

  return (
    <aside className="rail">
      {cardOrder.filter((id) => !hidden.has(id)).map((id) => (cards[id] ? <Fragment key={id}>{cards[id]}</Fragment> : null))}

      {mythicRulesOpen && <MythicRules content={content} onClose={() => setMythicRulesOpen(false)} />}

      {numpadOpen && isMobile && onPlay && (
        <HpNumpadModal
          current={character.hitPoints.current}
          max={hpMax}
          temp={character.hitPoints.temp}
          onDamage={(n) => onPlay((p) => applyDamage(p, n, hpMax, deathBase, doomedCut))}
          onHeal={(n) => onPlay((p) => applyHeal(p, n, hpMax))}
          onSetHp={(n) => onPlay((p) => setHp(p, n, hpMax))}
          onSetTemp={(n) => onPlay((p) => setTempHp(p, n))}
          onClose={() => setNumpadOpen(false)}
          resistances={hpIwrButtons === false ? [] : charDefenses.resistances}
          weaknesses={hpIwrButtons === false ? [] : charDefenses.weaknesses}
        />
      )}

      {/* Ruling D: what one of the character's own records changes about this condition. */}
      {condMark && (
        <div className="picker-overlay" onClick={() => setCondMark(null)}>
          <div className="picker confirm-modal" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <span>{condMark.name} — what changes it for you</span>
              <button className="picker-close" onClick={() => setCondMark(null)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            </div>
            <div className="confirm-body">
              <ul className="mode-info-mods">
                {condMark.marks.map((m, i) => (
                  <li key={i}>
                    <strong>{nameOfRecord(content, m.sourceId)}</strong> — {markNote(content, m)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* A mode's detail: what it does, how long it lasts, and every stat it touches. For a
          display-only mode the note IS the mode, so this is the only place it can be read. */}
      {modeInfo && <ModeDetailModal mode={modeInfo} onClose={() => setModeInfo(null)} />}
      {defBreak && (
        <StatDetailModal breakdown={defBreak} character={character} content={content} onClose={() => setDefBreak(null)} />
      )}
      {condOpen && onPlay && (
        <ConditionsModal
          // The Kingmaker book's conditions (Mired, Routed, Weary, …) are ALL army conditions — they
          // apply to armies in the Warfare rules, not to a player character — so they never belong in
          // the PC conditions picker, even with Kingmaker enabled.
          conditions={Object.fromEntries(
            Object.entries(content.conditions).filter(([, cd]) => !/kingmaker/i.test(cd.source?.book ?? '')),
          )}
          // bug 2026-09-16: derived conditions — the entries carry their own `derivedFrom`, so the
          // picker wears the same lock the rail pills wear without a second opinion about the cause.
          active={character.conditions}
          onAdd={(id, valued) => onPlay((p) => addCondition(p, id, valued ? 1 : undefined))}
          onRemove={(id) => onPlay((p) => removeCondition(p, id))}
          onStepValue={(id, delta) => onPlay((p) => stepConditionValue(p, id, delta), `cond:${id}`)}
          onClose={() => setCondOpen(false)}
          modesEnabled
          library={playerModeLibrary(Object.values(content.modes), charKey)}
          // Authored, GATED modes are content, not the player's own: they belong in the predefined
          // section, which `modeRelevant` filters, rather than in "Your modes", which it does not.
          // `catalog` stays the hand-written templates — the mode editor offers it as a starting
          // point, and a 38-entry aura list is not a template.
          predefined={[...CATALOG_MODES, ...contentGatedModes(Object.values(content.modes))]}
          catalog={CATALOG_MODES}
          classId={character.classId}
          ancestryId={character.ancestryId}
          // Class FEATURES too, not just feats. A mode gated on a class-feature id (an oracle's
          // cursebound stages, a thaumaturge's Amulet benefit) could never match a set built from
          // character.feats — those ids live in ownedFeatureIds. Every mode shipped before this
          // gated on a dedication FEAT, so the gap never showed until class-feature modes existed.
          featIds={modeGateIds(character, content)}
          charKey={charKey}
          charName={character.name}
          // This character's own Lore subjects, so a custom mode can point at one by name.
          lores={Object.keys(character.proficiencies.skills).filter((k) => k.startsWith('lore:'))}
          activeModeIds={(character.activeModes ?? []).map((m) => m.id)}
          onToggleMode={(id) => onPlay((p) => toggleMode(p, id, content.modes))}
          onSaveMode={onSaveMode}
          onDeleteMode={onDeleteMode}
        />
      )}
    </aside>
  );
}
