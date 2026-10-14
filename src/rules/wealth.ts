/*
 * Money: starting wealth by level (reference table, NOT applied) + coin conversion helpers.
 *
 * A new character starts with 0 gold at every level (the owner's call, 2026-09-17) — buildCharacter
 * no longer calls startingWealthGp(), so this table has no callers in src/ (only its own test still
 * exercises it). It's the PF2e "Character Wealth" creation guideline (a single gp lump sum for
 * building a higher-level character) kept here as a GM-adjustable budget hint, wired up wherever a
 * future higher-level-creation flow wants to offer it.
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

const DENOMS = [
  ['pp', 1000],
  ['gp', 100],
  ['sp', 10],
  ['cp', 1],
] as const;

/**
 * Pay `priceCp` out of a wallet the way a person at a shop counter would: hand over the coins that
 * fit, break ONE larger coin only when the smaller ones run out, and take the change in the coins
 * below it. Every other coin stays exactly as it was. Returns undefined when the wallet can't cover it.
 *
 * bug 2026-10-14: buying ran the whole purse through copper and back out of `cpToCoins`, which has no
 * pp — so buying a 5 gp item with 10 pp in the purse left 95 gp and no platinum at all.
 */
export function payFrom(wallet: Coins | undefined, priceCp: number): Coins | undefined {
  const cost = Math.max(0, Math.round(priceCp));
  if (cost > coinsToCp(wallet)) return undefined;
  const have = { pp: wallet?.pp ?? 0, gp: wallet?.gp ?? 0, sp: wallet?.sp ?? 0, cp: wallet?.cp ?? 0 };
  let owed = cost;
  // Largest coin first, but only coins worth no more than what is still owed.
  for (const [k, v] of DENOMS) {
    const use = Math.min(have[k], Math.floor(owed / v));
    have[k] -= use;
    owed -= use * v;
  }
  if (owed > 0) {
    // Every coin still held is worth more than what is owed, so break the smallest one.
    const broken = [...DENOMS].reverse().find(([k]) => have[k] > 0);
    if (!broken) return undefined;
    have[broken[0]] -= 1;
    let change = broken[1] - owed;
    for (const [k, v] of DENOMS) {
      if (v >= broken[1]) continue;
      const n = Math.floor(change / v);
      have[k] += n;
      change -= n * v;
    }
  }
  // Empty denominations are left out, the same shape the purse always had after a purchase.
  const out: Coins = {};
  for (const [k] of DENOMS) if (have[k]) out[k] = have[k];
  return out;
}

/** Copper split back into gp / sp / cp (no pp — keeps the wallet readable). Never use it to pay
 *  from a wallet: it turns every platinum piece into gold. `payFrom` is the paying helper. */
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

/** Parse a price STRING ("1,000 gp", "5 sp", "2 gp 5 sp", "—") into Coins, or undefined if it has no
 *  positive value. Curated companion/vehicle/siege catalog prices are stored as strings; this is the
 *  single shared parser for them. */
export function parsePrice(s?: string): Coins | undefined {
  if (!s) return undefined;
  const o: Coins = {};
  for (const m of s.matchAll(/([\d,]+)\s*(pp|gp|sp|cp)/gi)) {
    const n = parseInt(m[1].replace(/,/g, ''), 10);
    const k = m[2].toLowerCase() as keyof Coins;
    if (n) o[k] = (o[k] ?? 0) + n;
  }
  return Object.keys(o).length ? o : undefined;
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

/** The pack-item shapes both helpers below need — a bare structural type so callers can pass an Item,
 *  a homebrew draft or a hand-built test record without importing the full union. */
type Priced = { price?: Coins; packOf?: number };

/**
 * THE price-times-quantity helper. Ammunition prints one price for a whole pack ("1 sp (price for
 * 10)") while inventory counts PIECES, so every per-quantity charge — buying, the builder's gear
 * budget — must divide by `packOf` or a player pays ten times over for a quiver of arrows. Every call
 * site that multiplies a price by a quantity goes through here rather than reimplementing the
 * division; `pieces` defaults to 1 so it reads as "what does one of these cost".
 */
export function itemPriceCp(item: Priced | undefined, pieces = 1): number {
  return Math.round((coinsToCp(item?.price) * pieces) / Math.max(1, item?.packOf ?? 1));
}

/** Format an item's PRINTED price, saying what the pack holds when it is a pack item: "1 sp per 10".
 *  The printed figure is kept as-is — dividing it would show arrows at "1 cp" and disagree with every
 *  price list the player can look up. */
export function formatItemPrice(item: Priced | undefined, empty = '—'): string {
  const s = formatPrice(item?.price, empty);
  return item?.packOf && item.packOf > 1 && s !== empty ? `${s} per ${item.packOf}` : s;
}
