import { PC_SKILLS, ABILITIES, type PcStats, type PcDetailConfig, type ProfRank } from '../../tracker/src/utils/pcDetail';
import type { ProficiencyRank } from '../rules/types';
import { RankPill } from '../sheet/widgets';

/*
 * The extra stat sections for a party card, following the tracker's "Stats shown" (PcDetailConfig).
 *
 * TWO pieces, because the card is two rows (owner's pick, 2026-09-17):
 *   PcSavesCells      → Fort/Ref/Will, beside AC in ROW 1's band;
 *   PcStatsCardExtra  → ROW 2 — Speed & DCs, then Skills, then Abilities BELOW the skills (the
 *                       owner's order), then Senses & Languages. Full card width, so the grids run
 *                       wide: DCs three-up, skills four-up, the six abilities on one line.
 *
 * The card itself shows HP, AC, Perception and the ancestry/class sub-line, so neither piece
 * repeats those. Turning a section on in "Stats shown" makes it appear on every card. (The
 * defenses/perception/ancestry toggles govern the card's own core, which is always shown — the
 * numbers are never hidden, only added to.)
 *
 * Compact by design — this lives inside a party card, not the spacious detail panel (PcStatsDisplay).
 * Part of the removable seam; see ./README.md.
 */

const fmt = (n: number | undefined) => (n == null ? '—' : n >= 0 ? `+${n}` : `${n}`);
const plain = (n: number | undefined) => (n == null ? '—' : String(n));

const RANK_OF: Record<ProfRank, ProficiencyRank> = {
  U: 'untrained',
  T: 'trained',
  E: 'expert',
  M: 'master',
  L: 'legendary',
};

/**
 * THE SHEET'S OWN proficiency pill, from the tracker's rank letter.
 *
 * Owner, 2026-09-16: *"don't make the skills that they are untrained at gray, instead I want the
 * same proficiency circles that the skills in the character sheet have"*. So this is `RankPill` —
 * the very component the Skills list and the Proficiencies grid use — and an untrained skill gets
 * the untrained pill rather than a faded row. No rank at all still means untrained: the tracker's
 * PcSkill leaves `prof` off for a skill nobody filled in.
 */
function Prof({ p }: { p?: ProfRank }) {
  return <RankPill rank={RANK_OF[p ?? 'U']} />;
}

function Section({ label, rows, children }: { label: string; rows?: string; children: React.ReactNode }) {
  return (
    <div className="party-sec">
      <div className="party-lab">{label}</div>
      <div className={rows ?? 'party-kv'}>{children}</div>
    </div>
  );
}

/** Fort/Ref/Will for ROW 1's band, where they sit beside AC as label-over-value tiles.
 *  A fragment, not a box: the AC cell beside them belongs to the card itself. */
export function PcSavesCells({ stats, detail }: { stats: PcStats; detail: PcDetailConfig }) {
  if (!detail.saves) return null;
  return (
    <>
      <span className="party-def">
        <span className="party-lab">Fort</span>
        <b>{fmt(stats.fortMod)}<Prof p={stats.fortProf} /></b>
      </span>
      <span className="party-def">
        <span className="party-lab">Ref</span>
        <b>{fmt(stats.refMod)}<Prof p={stats.refProf} /></b>
      </span>
      <span className="party-def">
        <span className="party-lab">Will</span>
        <b>{fmt(stats.willMod)}<Prof p={stats.willProf} /></b>
      </span>
    </>
  );
}

/**
 * Is there ANYTHING for the card's second row to draw?
 *
 * The card draws row 2 — and the rule above it — from the slot it is HANDED, not from what that
 * slot renders. So a slot holding this component is truthy even on a "Stats shown" preset that
 * turns every section off (Minimal, Name only), and the card grew a blank bordered band. One
 * predicate, used both by the early return below and by the seam's slot builder
 * (CampaignTracker.cardExtra), so the two can't drift apart.
 *
 * (Still `hasRightColumn`: it is the seam's import, and the seam belongs to another lane. The
 * "right column" it names has been ROW 2 since 2026-09-17.)
 *
 * The conditions mirror the sections one for one: each `true` here is exactly one section below.
 */
export function hasRightColumn(stats: PcStats, detail: PcDetailConfig): boolean {
  return !!(
    detail.speedDCs ||
    detail.skills ||
    detail.abilities ||
    (detail.sensesLangs && (stats.senses || stats.languages))
  );
}

export function PcStatsCardExtra({ stats, detail }: { stats: PcStats; detail: PcDetailConfig }) {
  if (!hasRightColumn(stats, detail)) return null;
  const st = stats;
  const sections: React.ReactNode[] = [];

  if (detail.speedDCs) {
    sections.push(
      <Section key="dcs" label={'Speed & DCs'} rows="party-kv two">
        <span><span className="party-k">Spd</span> {st.speed == null ? '—' : `${st.speed} ft`}</span>
        <span><span className="party-k">Class</span> {plain(st.classDC)}</span>
        {st.spellDC != null && <span><span className="party-k">Spell</span> {plain(st.spellDC)}</span>}
      </Section>,
    );
  }

  if (detail.skills) {
    // EVERY skill, not just the ones with an entry: the GM asking for a Nature check wants to see
    // that nobody is trained in it, and a missing row reads as missing data rather than untrained.
    sections.push(
      <Section key="skills" label="Skills" rows="party-skills">
        {PC_SKILLS.map((sk) => {
          const s = st.skills?.[sk];
          return (
            <span className="party-sk" key={sk} title={sk}>
              <span className="party-k">{sk.slice(0, 4)}</span> {fmt(s?.mod)}
              <Prof p={s?.prof} />
            </span>
          );
        })}
      </Section>,
    );
  }

  // Below the skills, on the owner's instruction — the numbers a GM reads least often go last.
  if (detail.abilities) {
    sections.push(
      <Section key="abil" label="Abilities">
        {ABILITIES.map(({ key, label }) => (
          <span key={key}><span className="party-k">{label}</span> {fmt(st[key] as number | undefined)}</span>
        ))}
      </Section>,
    );
  }

  if (detail.sensesLangs && (st.senses || st.languages)) {
    sections.push(
      <div className="party-sl" key="sl">
        {st.senses && <div><b>Senses</b> {st.senses}</div>}
        {st.languages && <div><b>Languages</b> {st.languages}</div>}
      </div>,
    );
  }

  return <>{sections}</>;
}
