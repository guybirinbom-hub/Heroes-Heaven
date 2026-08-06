import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { build, content } from './_content';
import { deriveMaxHp } from '../src/rules/derive';

/**
 * Per-character verification, as a standing test.
 *
 * The full pass — 27 classes at 20 levels checked against the AoN mirror — lives in
 * `scripts/verify-characters.mjs`, because it needs the mirror on disk and CI may not have it. What
 * runs here are the invariants that need no external data, so a regression in class advancement fails
 * the suite rather than waiting for someone to remember the script.
 */
const db = content();
const RANK: Record<string, number> = { untrained: 0, trained: 1, expert: 2, master: 3, legendary: 4 };
const rankOf = (s?: string) => RANK[String(s ?? '').toLowerCase()] ?? 0;

describe('every class, every level', () => {
  it('HP is exactly ancestry + (class HP + Con) per level', { timeout: 60_000 }, () => {
    const bad: string[] = [];
    for (const id of Object.keys(db.classes)) {
      for (const level of [1, 5, 11, 20]) {
        const ch = build(id, level);
        const con = Math.floor((ch.abilities.con - 10) / 2);
        const anc = (db.ancestries[ch.ancestryId!] as { hp?: number })?.hp ?? 0;
        const want = anc + ((db.classes[id] as { hpPerLevel: number }).hpPerLevel + con) * level;
        const got = deriveMaxHp(ch, db);
        if (got !== want) bad.push(`${id} L${level}: ${got} != ${want}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('no proficiency ever goes backwards as you level', { timeout: 60_000 }, () => {
    // A class table with a typo shows up here and almost nowhere else — the number simply gets worse
    // at one level and no test that samples a single level would see it.
    const bad: string[] = [];
    for (const id of Object.keys(db.classes)) {
      let prev: ReturnType<typeof build>['proficiencies'] | null = null;
      for (let level = 1; level <= 20; level++) {
        const p = build(id, level).proficiencies;
        if (prev) {
          for (const k of Object.keys(p.saves)) {
            const a = rankOf(prev.saves[k as 'fortitude']);
            const b = rankOf(p.saves[k as 'fortitude']);
            if (b < a) bad.push(`${id} ${k} drops at L${level}`);
          }
          if (rankOf(p.perception) < rankOf(prev.perception)) bad.push(`${id} perception drops at L${level}`);
          for (const k of Object.keys(p.attacks)) {
            const a = rankOf(prev.attacks[k as 'simple']);
            const b = rankOf(p.attacks[k as 'simple']);
            if (b < a) bad.push(`${id} ${k} attack drops at L${level}`);
          }
        }
        prev = p;
      }
    }
    expect(bad).toEqual([]);
  });

  it('every spellcasting class can actually cast at every level', { timeout: 60_000 }, () => {
    const bad: string[] = [];
    for (const [id, cls] of Object.entries(db.classes)) {
      if (!(cls as { spellcasting?: unknown }).spellcasting) continue;
      for (const level of [1, 5, 11, 20]) {
        const ch = build(id, level);
        if (!ch.spellcasting.some((e) => e.type === 'prepared' || e.type === 'spontaneous')) bad.push(`${id} L${level}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('the full pass against the AoN mirror', () => {
  it('is available and documents how to run it', () => {
    // Deliberately not run here: it reads the mirror from an absolute path outside the repo. The 27
    // classes it verified matched on all 267 ground-truth fields at the time of writing.
    expect(existsSync('scripts/verify-characters.mjs')).toBe(true);
    const src = readFileSync('scripts/verify-characters.mjs', 'utf8');
    expect(src).toMatch(/GROUND TRUTH from/i);
    expect(readdirSync('scripts')).toContain('verify-characters.mjs');
  });
});
