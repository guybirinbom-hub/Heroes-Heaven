import { describe, it, expect } from 'vitest';
import { genCampaignCode, normalizeCode } from '../src/data/campaigns';

// Share codes must be easy to read aloud + type (no ambiguous 0/O, 1/I/L) and normalize consistently, so
// a GM's code and a player's typed code always resolve to the same lookup key.
const ALPHABET = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/;

describe('genCampaignCode', () => {
  it('is 6 chars from the unambiguous alphabet by default', () => {
    for (let i = 0; i < 300; i++) {
      const code = genCampaignCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(ALPHABET);
    }
  });

  it('honors a custom length', () => {
    expect(genCampaignCode(4)).toHaveLength(4);
    expect(genCampaignCode(10)).toHaveLength(10);
  });

  it('is not obviously constant (draws on randomness)', () => {
    const seen = new Set(Array.from({ length: 50 }, () => genCampaignCode()));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('normalizeCode', () => {
  it('uppercases and strips spaces + dashes', () => {
    expect(normalizeCode(' ab-cd ef ')).toBe('ABCDEF');
    expect(normalizeCode('abc234')).toBe('ABC234');
    expect(normalizeCode('A B C')).toBe('ABC');
    expect(normalizeCode('')).toBe('');
  });

  it('round-trips a generated code unchanged', () => {
    const code = genCampaignCode();
    expect(normalizeCode(code)).toBe(code);
  });
});
