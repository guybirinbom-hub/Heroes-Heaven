import { describe, it, expect } from 'vitest';
import { parseFeet, parseDurationSeconds } from '../src/rules/filterValues';

describe('parseFeet — range/area prose → feet', () => {
  it('reads plain foot values', () => {
    expect(parseFeet('30 feet')).toBe(30);
    expect(parseFeet('15-foot emanation')).toBe(15);
    expect(parseFeet('120 feet')).toBe(120);
  });
  it('maps touch/self/absent to 0', () => {
    expect(parseFeet('touch')).toBe(0);
    expect(parseFeet('self')).toBe(0);
    expect(parseFeet(undefined)).toBe(0);
    expect(parseFeet('')).toBe(0);
  });
  it('maps unlimited/planetary to Infinity', () => {
    expect(parseFeet('unlimited')).toBe(Infinity);
    expect(parseFeet('planetary')).toBe(Infinity);
  });
  it('converts miles', () => {
    expect(parseFeet('1 mile')).toBe(5280);
    expect(parseFeet('2 miles')).toBe(10560);
  });
});

describe('parseDurationSeconds — duration prose → seconds', () => {
  it('reads common units', () => {
    expect(parseDurationSeconds('1 round')).toBe(6);
    expect(parseDurationSeconds('1 minute')).toBe(60);
    expect(parseDurationSeconds('10 minutes')).toBe(600);
    expect(parseDurationSeconds('1 hour')).toBe(3600);
    expect(parseDurationSeconds('1 day')).toBe(86400);
    expect(parseDurationSeconds('1 week')).toBe(604800);
  });
  it('maps instant/absent to 0 and permanent/unlimited to Infinity', () => {
    expect(parseDurationSeconds(undefined)).toBe(0);
    expect(parseDurationSeconds('instantaneous')).toBe(0);
    expect(parseDurationSeconds('permanent')).toBe(Infinity);
    expect(parseDurationSeconds('unlimited')).toBe(Infinity);
  });
  it('treats sustained as a short, bounded duration', () => {
    expect(parseDurationSeconds('sustained')).toBe(60);
    expect(parseDurationSeconds('sustained up to 1 minute')).toBe(60);
  });
});
