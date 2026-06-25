import { describe, it, expect } from 'vitest';
import { formatPrice, formatCoins, grp } from '../src/rules/wealth';
import { decodeEntities, cleanRun, toPlainText } from '../src/sheet/RichText';
import { formatMpDamage } from '../src/rules/monsterParts';

describe('price/coin formatting (audit fixes #15–17)', () => {
  it('lists every denomination instead of only the highest', () => {
    expect(formatPrice({ gp: 2, sp: 5 })).toBe('2 gp, 5 sp');
    expect(formatPrice({ pp: 1, gp: 2, sp: 3, cp: 4 })).toBe('1 pp, 2 gp, 3 sp, 4 cp');
  });
  it('groups thousands', () => {
    expect(formatPrice({ gp: 90000 })).toBe('90,000 gp');
    expect(formatCoins({ gp: 112000 })).toBe('112,000 gp');
    expect(grp(1234567)).toBe('1,234,567');
  });
  it('uses a consistent empty token (default —, overridable)', () => {
    expect(formatPrice(undefined)).toBe('—');
    expect(formatPrice({})).toBe('—');
    expect(formatPrice({ gp: 0 })).toBe('—');
    expect(formatPrice(undefined, 'free')).toBe('free');
  });
});

describe('authored-text entity/tag cleanup (audit fixes #1, #3)', () => {
  it('decodes common HTML entities', () => {
    expect(decodeEntities('2 &times; level')).toBe('2 × level');
    expect(decodeEntities('rock &amp; roll')).toBe('rock & roll');
    expect(decodeEntities('see&nbsp;here')).toBe('see here');
    expect(decodeEntities('&#8212; dash')).toBe('— dash');
  });
  it('cleanRun strips residual raw HTML tags after decoding', () => {
    expect(cleanRun('x<sup>2</sup>')).toBe('x2');
    expect(cleanRun('a <strong>bold</strong> word')).toBe('a bold word');
  });
  it('toPlainText (preview blurb) decodes entities and strips tags', () => {
    expect(toPlainText('Deal 2 &times; your level')).toBe('Deal 2 × your level');
    expect(toPlainText('Roll <strong>now</strong>')).toBe('Roll now');
  });
});

describe('Monster Parts damage formatting (audit fixes #11, #12)', () => {
  it('flat damage has no stray "+", persistent reads naturally', () => {
    expect(formatMpDamage({ flat: 1, type: 'fire' })).toBe('1 fire');
    expect(formatMpDamage({ flat: 1, type: 'fire', persistent: true })).toBe('1 persistent fire');
    expect(formatMpDamage({ dice: 1, die: 'd6', type: 'fire' })).toBe('1d6 fire');
  });
  it('the "untyped" placeholder resolves to the weapon base type (Bane/Wild)', () => {
    expect(formatMpDamage({ dice: 1, die: 'd6', type: 'untyped' }, 'slashing')).toBe('1d6 slashing');
    expect(formatMpDamage({ dice: 1, die: 'd6', type: 'untyped' })).toBe("1d6 weapon's type");
  });
});
