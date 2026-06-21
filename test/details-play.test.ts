import { describe, it, expect } from 'vitest';
import { emptyPlay, setDetail, applyPlayState, type PlayState } from '../src/rules/play';
import { content, build } from './_content';

// Backs the editable "General" section: bio fields edited in play merge over the build's
// details (so build-set fields like deityId survive).
describe('editable bio details', () => {
  it('setDetail sets a field; empty string clears it', () => {
    let p = setDetail(emptyPlay(), 'alignment', 'NG');
    expect(p.details?.alignment).toBe('NG');
    p = setDetail(p, 'alignment', '');
    expect(p.details?.alignment).toBeUndefined();
  });

  it('applyPlayState merges play details over the build, keeping unset build fields', () => {
    const ch = build('cleric', 1);
    let p: PlayState = setDetail(emptyPlay(), 'age', '30');
    p = setDetail(p, 'height', "6'2\"");
    const out = applyPlayState(ch, p, content());
    expect(out.details.age).toBe('30');
    expect(out.details.height).toBe("6'2\"");
    if (ch.details.deityId) expect(out.details.deityId).toBe(ch.details.deityId);
  });
});
