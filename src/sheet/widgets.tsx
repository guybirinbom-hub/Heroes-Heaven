import type { ActionCost, ProficiencyRank } from '../rules/types';

const RANK_LETTER: Record<ProficiencyRank, string> = {
  untrained: 'U',
  trained: 'T',
  expert: 'E',
  master: 'M',
  legendary: 'L',
};
const RANK_COLOR: Record<ProficiencyRank, string> = {
  untrained: 'var(--app-text-dim)',
  trained: 'var(--app-good)',
  expert: 'var(--app-accent)',
  master: 'var(--app-warn)',
  legendary: 'var(--app-bad)',
};
const RANK_LABEL: Record<ProficiencyRank, string> = {
  untrained: 'Untrained',
  trained: 'Trained',
  expert: 'Expert',
  master: 'Master',
  legendary: 'Legendary',
};

/** A color-coded proficiency-rank pill (U/T/E/M/L). */
export function RankPill({ rank }: { rank: ProficiencyRank }) {
  return (
    <span className="rank-pill" style={{ color: RANK_COLOR[rank] }} title={RANK_LABEL[rank]}>
      {RANK_LETTER[rank]}
    </span>
  );
}

const ACTION_TITLE: Record<number, string> = {
  1: 'One action',
  2: 'Two actions',
  3: 'Three actions',
};

/** A single action-icon glyph from the Pathfinder2eActions font (the icon set
 *  Archives of Nethys uses). Color is inherited from the surrounding text. */
function Glyph({ char, title }: { char: string; title: string }) {
  return (
    <span className="pf2-action" role="img" aria-label={title} title={title}>
      {char}
    </span>
  );
}

/** True only for an action cost that ActionGlyph renders as glyph(s) — actions/reaction/free/variable.
 *  Passive and duration costs render nothing, so a caller's "Activate" label/row must gate on this to
 *  avoid an empty glyph slot. */
export function isActionCost(c?: ActionCost): boolean {
  return !!c && (c.type === 'actions' || c.type === 'reaction' || c.type === 'free' || c.type === 'variable');
}

/** Renders an action cost as Archives-of-Nethys action-icon glyphs. */
export function ActionGlyph({ cost }: { cost?: ActionCost }) {
  if (!cost) return null;
  switch (cost.type) {
    case 'actions':
      return <Glyph char={String(cost.value)} title={ACTION_TITLE[cost.value] ?? `${cost.value} actions`} />;
    case 'free':
      return <Glyph char="4" title="Free action" />;
    case 'reaction':
      return <Glyph char="5" title="Reaction" />;
    case 'variable':
      return (
        <span className="pf2-action-range">
          <Glyph char={String(cost.min)} title={ACTION_TITLE[cost.min] ?? `${cost.min} actions`} />
          <span className="pf2-action-sep">–</span>
          <Glyph char={String(cost.max)} title={ACTION_TITLE[cost.max] ?? `${cost.max} actions`} />
        </span>
      );
    default:
      return null;
  }
}
