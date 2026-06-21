/*
 * Dice roller.
 *
 * Pure-ish helpers for rolling dice and building a result record. The randomness
 * lives in `rollDie`, which is only ever called from UI event handlers (a Roll
 * button, a click-to-roll on a stat) — never during render — so the rest of the
 * app stays deterministic.
 */
export type DieSides = 4 | 6 | 8 | 10 | 12 | 20 | 100;

export interface RollResult {
  id: string;
  /** What was rolled, e.g. "Reflex", "Scimitar attack", "Custom". */
  label: string;
  /** Human formula, e.g. "1d20+7", "2d6+4". */
  formula: string;
  /** The individual die faces rolled. */
  dice: number[];
  modifier: number;
  total: number;
  /** Present for a single d20 check: the natural face + a crit/fumble flag. */
  d20?: { natural: number; outcome?: 'crit' | 'fumble' };
}

/** A saved roll configuration the player can re-fire with one click (e.g. "Greatsword dmg" = 2d12+8). */
export interface DicePreset {
  id: string;
  label: string;
  count: number;
  sides: DieSides;
  modifier: number;
}

let _seq = 0;
function nextId(): string {
  // A random suffix keeps ids unique even after a reload (where _seq resets to 0 but the
  // persisted roll history still holds roll-1, roll-2, …) — avoids duplicate React keys.
  // Safe: nextId is only called from roll(), which runs in event handlers, never render.
  return `roll-${++_seq}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Roll one die with the given number of sides (1..sides). */
export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function formatFormula(count: number, sides: number, modifier: number): string {
  const mod = modifier > 0 ? `+${modifier}` : modifier < 0 ? `${modifier}` : '';
  return `${count}d${sides}${mod}`;
}

/** Roll `count`d`sides` + modifier. A single d20 gets a crit (nat 20) / fumble (nat 1) flag. */
export function roll(label: string, count: number, sides: number, modifier: number): RollResult {
  const n = Math.max(1, Math.min(100, Math.round(count)));
  const dice: number[] = [];
  for (let i = 0; i < n; i++) dice.push(rollDie(sides));
  const total = dice.reduce((a, b) => a + b, 0) + modifier;
  const result: RollResult = {
    id: nextId(),
    label,
    formula: formatFormula(n, sides, modifier),
    dice,
    modifier,
    total,
  };
  if (n === 1 && sides === 20) {
    const natural = dice[0];
    result.d20 = { natural, outcome: natural === 20 ? 'crit' : natural === 1 ? 'fumble' : undefined };
  }
  return result;
}

/** A 1d20 + modifier check (the common case: saves, perception, skills, attacks). */
export function rollCheck(label: string, modifier: number): RollResult {
  return roll(label, 1, 20, modifier);
}
