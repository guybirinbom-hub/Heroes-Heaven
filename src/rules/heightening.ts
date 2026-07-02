import type { Spell } from './types';

/*
 * Spell heightening helpers (pure text parsing).
 *
 * A spell's description bundles its base effect with any "Heightened (...)" entries.
 * Two trigger forms: "(+N)" (relative — applies once the cast rank is N above the base)
 * and "(Nth)" (absolute — applies at cast rank N or higher). The sheet uses these to
 * highlight which heightened effects are active at a chosen cast rank.
 */

/** Split a description into its base text and any "Heightened (...)" entries.
 *  Tolerates the markdown-lite the importer emits: a "**Heightened (…)**" bold label and a
 *  trailing "---" divider that separated the base text from the heightening list. */
export function splitHeightening(desc: string): { base: string; heightening: string[] } {
  const re = /\*{0,2}Heightened\s*\(/;
  const idx = desc.search(re);
  if (idx === -1) return { base: desc.trim(), heightening: [] };
  return {
    // Drop a markdown divider (and surrounding blank lines) that fronted the heightening list.
    base: desc.slice(0, idx).replace(/(?:\n|\s)*-{3,}\s*$/, '').trim(),
    // Split before each "Heightened (…)" label. The `(?<![*])` guard anchors the split to the START
    // of a `**` bold run — without it a variable-length `\*{0,2}` lookahead also matches BETWEEN the
    // two asterisks and right before the word, shearing "**Heightened" into orphan "*" fragments that
    // render as stray asterisks. Entries keep their `**…**` so the label still renders bold.
    heightening: desc
      .slice(idx)
      .split(/(?<![*])(?=\*{0,2}Heightened\s*\()/)
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/** Parse a heightening entry's trigger: "(+1)" → relative, "(2nd)" → absolute rank. */
export function heightenTrigger(entry: string): { type: 'rel' | 'abs'; n: number } | null {
  // Tolerate the leading `**` bold marker the entry keeps for display.
  let m = entry.match(/^\*{0,2}Heightened\s*\(\+(\d+)\)/);
  if (m) return { type: 'rel', n: Number(m[1]) };
  m = entry.match(/^\*{0,2}Heightened\s*\((\d+)(?:st|nd|rd|th)\)/);
  if (m) return { type: 'abs', n: Number(m[1]) };
  return null;
}

/** Whether a heightening entry applies when a `base`-rank spell is cast at `rank`. */
export function heighteningApplies(entry: string, base: number, rank: number): boolean {
  const t = heightenTrigger(entry);
  if (!t) return false;
  return t.type === 'rel' ? rank >= base + t.n : rank >= t.n;
}

// --- Upcast value computation (drives the inline "→ X" displays) ---

type Dice = { sizes: Record<number, number>; flat: number };

function parseFormula(f: string): Dice {
  const sizes: Record<number, number> = {};
  let flat = 0;
  for (const raw of f.replace(/\s+/g, '').split(/(?=[+-])/)) {
    const tok = raw.replace(/^\+/, '');
    const m = tok.match(/^(-?)(\d*)d(\d+)$/);
    if (m) {
      const sign = m[1] === '-' ? -1 : 1;
      const n = m[2] === '' ? 1 : Number(m[2]);
      sizes[Number(m[3])] = (sizes[Number(m[3])] || 0) + sign * n;
    } else if (/^-?\d+$/.test(tok)) {
      flat += Number(tok);
    }
  }
  return { sizes, flat };
}

function fmtFormula(d: Dice): string {
  const parts = Object.keys(d.sizes)
    .map(Number)
    .sort((a, b) => b - a)
    .filter((s) => d.sizes[s] !== 0)
    .map((s) => `${d.sizes[s]}d${s}`);
  let out = parts.join(' + ');
  if (d.flat > 0) out += (out ? '+' : '') + d.flat;
  else if (d.flat < 0) out += String(d.flat);
  return out || '0';
}

/** Add `incr` to `base` `times` times: add("6d6","2d6",2)="10d6"; add("1d10+4","1d10+4",2)="3d10+12". */
export function addDice(base: string, incr: string, times: number): string {
  if (times <= 0 || !incr) return base;
  const b = parseFormula(base);
  const i = parseFormula(incr);
  for (const s of Object.keys(i.sizes)) b.sizes[Number(s)] = (b.sizes[Number(s)] || 0) + i.sizes[Number(s)] * times;
  b.flat += i.flat * times;
  return fmtFormula(b);
}

/** Steps a base-rank spell takes when heightened to `castRank` at the given interval. */
export function heightenSteps(baseRank: number, castRank: number, interval: number): number {
  return Math.max(0, Math.floor((castRank - baseRank) / interval));
}

/** Highest fixed-heightening level at or below `castRank` (cantrip auto-heighten / per-rank effects). */
function fixedLevelAt(levels: Record<string, { damage?: string; area?: number }>, castRank: number) {
  let best: { damage?: string; area?: number } | undefined;
  let bestRank = -1;
  for (const [k, lv] of Object.entries(levels)) {
    const rank = Number(k);
    if (lv && rank <= castRank && rank > bestRank) {
      bestRank = rank;
      best = lv;
    }
  }
  return best;
}

/** The heightened damage formula when `spell` is cast at `castRank`, or null if it doesn't change. */
export function scaleDamage(spell: Spell, castRank: number): string | null {
  const h = spell.heightening;
  const base = spell.baseDamage;
  if (!base || !h) return null;
  if (h.type === 'interval' && h.damageIncr) {
    const out = addDice(base, h.damageIncr, heightenSteps(Math.max(1, spell.rank), castRank, h.interval));
    return out !== base ? out : null;
  }
  if (h.type === 'fixed') {
    const lv = fixedLevelAt(h.levels as Record<string, { damage?: string; area?: number }>, castRank);
    return lv?.damage && lv.damage !== base ? lv.damage : null;
  }
  return null;
}

/** The heightened area (feet) when `spell` is cast at `castRank`, or null if it doesn't change. */
export function scaleArea(spell: Spell, castRank: number): number | null {
  const h = spell.heightening;
  const base = spell.baseArea;
  if (!base || !h) return null;
  if (h.type === 'interval' && h.areaIncr) {
    const steps = heightenSteps(Math.max(1, spell.rank), castRank, h.interval);
    return steps > 0 ? base.value + h.areaIncr * steps : null;
  }
  if (h.type === 'fixed') {
    const lv = fixedLevelAt(h.levels as Record<string, { damage?: string; area?: number }>, castRank);
    return lv?.area != null && lv.area !== base.value ? lv.area : null;
  }
  return null;
}
