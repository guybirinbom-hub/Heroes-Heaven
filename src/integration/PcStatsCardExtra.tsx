import { PC_SKILLS, ABILITIES, PROF_LABEL, type PcStats, type PcDetailConfig, type ProfRank } from '../../tracker/src/utils/pcDetail';

/*
 * The extra stat sections for a party card, following the tracker's "Stats shown" (PcDetailConfig).
 *
 * The card already shows the core strip (HP · AC · Perception) and the ancestry/class sub-line, so
 * this deliberately renders only the sections that AREN'T already there: saving throws, ability
 * modifiers, skills, speed & DCs, and senses & languages. Turning one on in "Stats shown" makes it
 * appear on every card. (The defenses/perception/ancestry toggles govern the card's core, which is
 * always shown — the numbers are never hidden, only added to.)
 *
 * Compact by design — this lives inside a party card, not the spacious detail panel (PcStatsDisplay).
 * Part of the removable seam; see ./README.md.
 */

const fmt = (n: number | undefined) => (n == null ? '—' : n >= 0 ? `+${n}` : `${n}`);
const plain = (n: number | undefined) => (n == null ? '—' : String(n));

function Prof({ p }: { p?: ProfRank }) {
  if (!p || p === 'U') return null;
  return (
    <sup title={PROF_LABEL[p]} style={{ fontSize: 8, color: 'var(--app-accent)', marginLeft: 1 }}>
      {p}
    </sup>
  );
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2px 10px',
  fontSize: 11,
  fontFamily: 'var(--app-font-mono, ui-monospace, monospace)',
  color: 'var(--app-text)',
};
const labStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--app-text-dim)',
  marginBottom: 3,
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={labStyle}>{label}</div>
      <div style={rowStyle}>{children}</div>
    </div>
  );
}

export function PcStatsCardExtra({ stats, detail }: { stats: PcStats; detail: PcDetailConfig }) {
  const st = stats;
  const enteredSkills = PC_SKILLS.filter((sk) => {
    const s = st.skills?.[sk];
    return s && (s.mod != null || (s.prof && s.prof !== 'U'));
  });

  const sections: React.ReactNode[] = [];

  if (detail.saves) {
    sections.push(
      <Section key="saves" label="Saves">
        <span>Fort {fmt(st.fortMod)}<Prof p={st.fortProf} /></span>
        <span>Ref {fmt(st.refMod)}<Prof p={st.refProf} /></span>
        <span>Will {fmt(st.willMod)}<Prof p={st.willProf} /></span>
      </Section>,
    );
  }

  if (detail.abilities) {
    sections.push(
      <Section key="abil" label="Abilities">
        {ABILITIES.map(({ key, label }) => (
          <span key={key}>{label} {fmt(st[key] as number | undefined)}</span>
        ))}
      </Section>,
    );
  }

  if (detail.speedDCs) {
    sections.push(
      <Section key="dcs" label="Speed & DCs">
        <span>Speed {st.speed == null ? '—' : `${st.speed} ft`}</span>
        <span>Class DC {plain(st.classDC)}</span>
        {st.spellDC != null && <span>Spell DC {plain(st.spellDC)}</span>}
      </Section>,
    );
  }

  if (detail.skills && enteredSkills.length > 0) {
    sections.push(
      <Section key="skills" label="Skills">
        {enteredSkills.map((sk) => (
          <span key={sk}>
            {sk} {fmt(st.skills![sk].mod)}
            <Prof p={st.skills![sk].prof} />
          </span>
        ))}
      </Section>,
    );
  }

  if (detail.sensesLangs && (st.senses || st.languages)) {
    sections.push(
      <div key="sl" style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--app-text-dim)' }}>
        {st.senses && (
          <div>
            <span style={{ color: 'var(--app-text)', fontWeight: 600 }}>Senses</span> {st.senses}
          </div>
        )}
        {st.languages && (
          <div>
            <span style={{ color: 'var(--app-text)', fontWeight: 600 }}>Languages</span> {st.languages}
          </div>
        )}
      </div>,
    );
  }

  if (sections.length === 0) return null;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{sections}</div>;
}
