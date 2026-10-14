import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { coinsToCp, payFrom } from '../src/rules/wealth';
import { buyCompanion, buyCompanionItem, buyItem, type PlayState } from '../src/rules/play';
import type { Coins } from '../src/rules/types';

/*
 * bug 2026-10-14 (the owner's list): "when i bought a item my platinum was converted to gold".
 * Every buy ran the whole purse through copper and back out of cpToCoins, which has no pp — so ANY
 * purchase silently turned all platinum into gold. Buying now pays like a shop counter: the coins
 * that fit, and one bigger coin broken only when the smaller ones run out.
 */

const play = (currency: Coins) => ({ currency, inventory: [] }) as unknown as PlayState;

describe('payFrom: paying never converts coins it does not have to', () => {
  it('breaks ONE platinum for a gold purchase and keeps the other nine', () => {
    expect(payFrom({ pp: 10 }, 500)).toEqual({ pp: 9, gp: 5 });
  });

  it('pays with gold the purse already has and leaves platinum alone', () => {
    expect(payFrom({ pp: 10, gp: 3, sp: 4 }, 500)).toEqual({ pp: 9, gp: 8, sp: 4 });
    expect(payFrom({ pp: 10, gp: 30 }, 500)).toEqual({ pp: 10, gp: 25 });
  });

  it('pays silver prices with silver before breaking platinum', () => {
    expect(payFrom({ pp: 1, sp: 50 }, 300)).toEqual({ pp: 1, sp: 20 });
  });

  it('breaks the SMALLEST coin that covers the rest, and gives change below it', () => {
    // 1 gp 5 sp owed; 1 gp in hand pays 1 gp, then a platinum is broken for the 5 sp.
    expect(payFrom({ pp: 2, gp: 1 }, 150)).toEqual({ pp: 1, gp: 9, sp: 5 });
  });

  it('refuses a price the purse cannot cover and changes nothing', () => {
    expect(payFrom({ gp: 1 }, 101)).toBeUndefined();
    expect(payFrom(undefined, 1)).toBeUndefined();
  });

  // Brute force, independent of payFrom: can the purse hand over EXACTLY this price, no change needed?
  const exactPayExists = (w: Required<Coins>, price: number) => {
    for (let a = 0; a <= w.pp; a++)
      for (let b = 0; b <= w.gp; b++)
        for (let s = 0; s <= w.sp; s++) {
          const rest = price - a * 1000 - b * 100 - s * 10;
          if (rest >= 0 && rest <= w.cp) return true;
        }
    return false;
  };

  it('never loses or invents money, never goes negative, and makes change only when no exact payment exists', () => {
    // Deterministic sweep over many purses and prices — not random, so a failure always repeats.
    for (let pp = 0; pp <= 3; pp++)
      for (let gp = 0; gp <= 12; gp += 3)
        for (let sp = 0; sp <= 12; sp += 4)
          for (let cp = 0; cp <= 12; cp += 6)
            for (const price of [0, 1, 7, 10, 55, 99, 100, 101, 250, 999, 1000, 1001, 2345, 4000]) {
              const wallet = { pp, gp, sp, cp };
              const total = coinsToCp(wallet);
              const out = payFrom(wallet, price);
              if (price > total) {
                expect(out).toBeUndefined();
                continue;
              }
              expect(out).toBeDefined();
              expect(coinsToCp(out)).toBe(total - price);
              for (const v of Object.values(out!)) expect(v).toBeGreaterThanOrEqual(0);
              // No coin grows (= nothing was broken into change) when the purse could pay exactly.
              if (exactPayExists(wallet, price))
                for (const k of ['pp', 'gp', 'sp', 'cp'] as const) expect(out![k] ?? 0).toBeLessThanOrEqual(wallet[k]);
            }
  });
});

describe('every buy keeps the platinum', () => {
  it('buyItem', () => {
    expect(buyItem(play({ pp: 10 }), 'rope', { gp: 5 }).currency).toEqual({ pp: 9, gp: 5 });
  });
  it('buyCompanionItem', () => {
    const p = { ...play({ pp: 10 }), companions: [{ id: 'c1', kind: 'animal', inventory: [] }] } as unknown as PlayState;
    expect(buyCompanionItem(p, 'c1', 'rope', { gp: 5 }).currency).toEqual({ pp: 9, gp: 5 });
  });
  it('buyCompanion', () => {
    expect(buyCompanion(play({ pp: 10 }), { kind: 'vehicle', name: 'Cart' } as never, { gp: 5 }).currency).toEqual({ pp: 9, gp: 5 });
  });
  it('an unaffordable buy changes nothing', () => {
    const before = play({ gp: 1 });
    expect(buyItem(before, 'rope', { gp: 2 })).toBe(before);
  });
});

describe('guard: nothing pays through the copper round-trip again', () => {
  // cpToCoins(coinsToCp(wallet) - …) is the exact shape that dropped every pp. Any NEW spender written
  // that way fails here; spending goes through payFrom.
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f)) files.push(p);
    }
  };
  walk(join(__dirname, '..', 'src'));
  walk(join(__dirname, '..', 'tracker', 'src'));

  it('finds no cpToCoins(coinsToCp(…) − …) anywhere in the app', () => {
    const bad = files.filter((f) => /cpToCoins\(\s*coinsToCp\(/.test(readFileSync(f, 'utf8')));
    expect(bad).toEqual([]);
  });

  it('the guard pattern catches the old code (planted case)', () => {
    const OLD = 'const remaining = cpToCoins(coinsToCp(play.currency) - coinsToCp(price));';
    expect(/cpToCoins\(\s*coinsToCp\(/.test(OLD)).toBe(true);
  });
});
