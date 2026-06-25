/*
 * Money: starting wealth by level + coin conversion helpers.
 *
 * Level 1 is the canonical 15 gp. Higher levels use the PF2e "Character Wealth"
 * creation guideline (a single gp lump sum for building a higher-level character);
 * it's a GM-adjustable guide, so treat it as a budget hint, not a hard rule.
 */
import type { Coins } from './types';

export const STARTING_WEALTH_GP: Record<number, number> = {
  1: 15,
  2: 30,
  3: 75,
  4: 140,
  5: 270,
  6: 520,
  7: 720,
  8: 1000,
  9: 1500,
  10: 2000,
  11: 2800,
  12: 4000,
  13: 6000,
  14: 9000,
  15: 13000,
  16: 20000,
  17: 30000,
  18: 45000,
  19: 69000,
  20: 112000,
};

export function startingWealthGp(level: number): number {
  return STARTING_WEALTH_GP[Math.min(20, Math.max(1, level))] ?? 15;
}

/** All coin denominations reduced to copper. */
export function coinsToCp(c: Coins | undefined): number {
  if (!c) return 0;
  return (c.pp ?? 0) * 1000 + (c.gp ?? 0) * 100 + (c.sp ?? 0) * 10 + (c.cp ?? 0);
}

/** Copper split back into gp / sp / cp (no pp — keeps the wallet readable). */
export function cpToCoins(cp: number): Coins {
  let r = Math.max(0, Math.round(cp));
  const gp = Math.floor(r / 100);
  r -= gp * 100;
  const sp = Math.floor(r / 10);
  r -= sp * 10;
  const out: Coins = {};
  if (gp) out.gp = gp;
  if (sp) out.sp = sp;
  if (r) out.cp = r;
  return out;
}

/** Group an integer with thousands separators (deterministic en-US): 90000 → "90,000". */
export function grp(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatCoins(c: Coins | undefined): string {
  if (!c) return '0 gp';
  const parts: string[] = [];
  if (c.pp) parts.push(`${grp(c.pp)} pp`);
  if (c.gp) parts.push(`${grp(c.gp)} gp`);
  if (c.sp) parts.push(`${grp(c.sp)} sp`);
  if (c.cp) parts.push(`${grp(c.cp)} cp`);
  return parts.length ? parts.join(' ') : '0 gp';
}

/** Format a price, listing EVERY present denomination (so "2 gp 5 sp" never loses the silver) with
 *  thousands grouping. Returns `empty` (default "—") when there's no positive value. The single shared
 *  price formatter — use this everywhere instead of per-file copies. */
export function formatPrice(p: Coins | undefined, empty = '—'): string {
  if (!p) return empty;
  const parts: string[] = [];
  if (p.pp) parts.push(`${grp(p.pp)} pp`);
  if (p.gp) parts.push(`${grp(p.gp)} gp`);
  if (p.sp) parts.push(`${grp(p.sp)} sp`);
  if (p.cp) parts.push(`${grp(p.cp)} cp`);
  return parts.length ? parts.join(', ') : empty;
}
