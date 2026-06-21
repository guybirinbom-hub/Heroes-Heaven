import { describe, it, expect } from 'vitest';
import {
  emptyPlay,
  setTempSpeed,
  setPortrait,
  applyPlayState,
  playForRebuild,
  type PlayState,
} from '../src/rules/play';
import { explainStat } from '../src/rules/explain';
import { deriveSpeeds } from '../src/rules/derive';
import { build, content } from './_content';

const c = content();

describe('temporary Speed override', () => {
  it('setTempSpeed stores the value; undefined or a negative clears it', () => {
    let p = setTempSpeed(emptyPlay(), 40);
    expect(p.tempSpeed).toBe(40);
    p = setTempSpeed(p, undefined);
    expect(p.tempSpeed).toBeUndefined();
    expect(setTempSpeed(emptyPlay(), -10).tempSpeed).toBeUndefined();
    expect(setTempSpeed(emptyPlay(), 30.6).tempSpeed).toBe(31); // rounded
  });

  it('applyPlayState surfaces tempSpeed as character.speedOverride', () => {
    const ch = build('fighter', 5);
    const out = applyPlayState(ch, setTempSpeed(emptyPlay(), 35), c);
    expect(out.speedOverride).toBe(35);
    // No override → undefined.
    expect(applyPlayState(ch, emptyPlay(), c).speedOverride).toBeUndefined();
  });

  it('playForRebuild preserves the temporary Speed through an edit/rebuild', () => {
    const p: PlayState = setTempSpeed(emptyPlay(), 45);
    expect(playForRebuild(p).tempSpeed).toBe(45);
  });

  it('the Speed breakdown matches deriveSpeeds, and an override replaces the total', () => {
    const ch = build('fighter', 5);
    const natural = deriveSpeeds(ch, c).land ?? 0;
    const b = explainStat(ch, c, { kind: 'speed' });
    expect(b.title).toBe('Speed');
    expect(b.totalText).toBe(`${natural} ft`);
    expect(b.parts.some((p) => /Temporary/i.test(p.label))).toBe(false);

    // With an active override the total becomes the override and a "Temporary Speed" part appears.
    const over = applyPlayState(ch, setTempSpeed(emptyPlay(), natural + 10), c);
    const b2 = explainStat(over, c, { kind: 'speed' });
    expect(b2.totalText).toBe(`${natural + 10} ft`);
    const temp = b2.parts.find((p) => /Temporary/i.test(p.label));
    expect(temp?.value).toBe(10);
  });
});

describe('portrait import', () => {
  it('setPortrait stores a data URL; null clears it', () => {
    const url = 'data:image/png;base64,AAAA';
    let p = setPortrait(emptyPlay(), url);
    expect(p.appearance?.portrait).toBe(url);
    p = setPortrait(p, null);
    expect(p.appearance?.portrait).toBeUndefined();
  });

  it('applyPlayState merges the portrait onto character.appearance', () => {
    const ch = build('cleric', 1);
    const url = 'data:image/png;base64,BBBB';
    const out = applyPlayState(ch, setPortrait(emptyPlay(), url), c);
    expect(out.appearance?.portrait).toBe(url);
  });

  it('playForRebuild keeps the appearance through a rebuild', () => {
    const url = 'data:image/png;base64,CCCC';
    const p = setPortrait(emptyPlay(), url);
    expect(playForRebuild(p).appearance?.portrait).toBe(url);
  });
});
