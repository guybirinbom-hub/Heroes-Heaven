import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes } from '../src/rules/derive';

/**
 * Caustic Nectar grants "a nectar ranged unarmed attack" and the app had no such Strike, so Potent
 * Nectar — whose entire content is adding damage to it — had nothing to attach to.
 */
const db = content();
const nectar = (ch: ReturnType<typeof build>) => deriveStrikes(ch, db).find((s) => /nectar/i.test(s.name));

const withFeats = (picks: Record<string, string>, effectChoices?: Record<string, string>) =>
  build('fighter', 18, { featPicks: picks, ...(effectChoices ? { effectChoices } : {}) } as never);

describe('Caustic Nectar', () => {
  it('grants a ranged unarmed Strike at 1d4 acid with a 20-foot increment', () => {
    const s = nectar(withFeats({ '1:ancestry:0': 'caustic-nectar' }));
    expect(s, 'no nectar Strike on the sheet').toBeTruthy();
    expect(s!.damage).toMatch(/1d4/);
    expect(s!.damage).toMatch(/acid/i);
    expect(s!.range).toBe(20);
  });

  it('carries no critical specialization, which its text explicitly denies', () => {
    const s = nectar(withFeats({ '1:ancestry:0': 'caustic-nectar' }));
    expect(s!.critSpec ?? null).toBeFalsy();
    expect(db.feats['caustic-nectar'].note).toMatch(/sickened/i);
  });

  it('a character without the feat has no nectar Strike', () => {
    expect(nectar(build('fighter', 18))).toBeUndefined();
  });
});

describe('Potent Nectar — a permanent one-of-two choice', () => {
  const picks = { '1:ancestry:0': 'caustic-nectar', '18:class:0': 'potent-nectar' };

  it('the sticky branch adds 1d4 persistent acid', () => {
    const s = nectar(withFeats(picks, { 'potent-nectar:potent-nectar': 'sticky' }));
    expect(s!.damage).toMatch(/1d4 persistent acid/i);
    expect(s!.damage).not.toMatch(/splash/i);
  });

  it('the splash branch adds 1d4 acid splash instead', () => {
    const s = nectar(withFeats(picks, { 'potent-nectar:potent-nectar': 'splash' }));
    expect(s!.damage).toMatch(/1d4 acid splash/i);
    expect(s!.damage).not.toMatch(/persistent/i);
  });

  it('the rider lands on the NECTAR only, not on every unarmed Strike', () => {
    // `appliesTo: 'unarmed'` would have put the acid on the character's Fist as well. This is the
    // reason `strikeName` exists.
    const ch = withFeats(picks, { 'potent-nectar:potent-nectar': 'sticky' });
    const fist = deriveStrikes(ch, db).find((s) => /fist/i.test(s.name));
    expect(fist, 'no Fist to compare against').toBeTruthy();
    expect(fist!.damage).not.toMatch(/acid/i);
  });

  it('answering nothing grants nothing', () => {
    const s = nectar(withFeats(picks));
    expect(s!.damage).not.toMatch(/persistent|splash/i);
  });
});
