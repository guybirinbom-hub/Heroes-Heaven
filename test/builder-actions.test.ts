import { describe, it, expect } from 'vitest';
import { useBuilderActions } from '../src/builder/shared';
import { emptyBuild, type BuildState } from '../src/rules/build';
import { content } from './_content';

// useBuilderActions is a plain factory (no React hooks); drive it with a mock setBuild.
function harness(initial: Partial<BuildState>) {
  let state: BuildState = { ...emptyBuild(), ...initial };
  const setBuild = (fn: BuildState | ((b: BuildState) => BuildState)) => {
    state = typeof fn === 'function' ? (fn as (b: BuildState) => BuildState)(state) : fn;
  };
  const actions = useBuilderActions(setBuild as never, content());
  return { actions, get: () => state };
}

describe('builder: stale picks pruned on origin change', () => {
  it('changeAncestry drops ancestry-category feat picks but keeps class/skill picks', () => {
    const h = harness({
      ancestryId: 'human',
      featPicks: { '1:ancestry:0': 'natural-ambition', '2:class:0': 'a-class-feat' },
      featChoices: { '1:ancestry:0': 'whatever' },
    });
    h.actions.changeAncestry('elf');
    expect(h.get().featPicks['1:ancestry:0']).toBeUndefined();
    expect(h.get().featChoices['1:ancestry:0']).toBeUndefined();
    expect(h.get().featPicks['2:class:0']).toBe('a-class-feat');
    expect(h.get().ancestryId).toBe('elf');
  });

  it('changeDeity re-defaults a Domain-feat choice the new deity lacks', () => {
    const c = content();
    const domainFeat = Object.values(c.feats).find((f) => (f as { choice?: { kind?: string } }).choice?.kind === 'domains');
    const deities = Object.values(c.deities).filter((d) => (d.domains?.length ?? 0) > 0);
    // find deities A, B where A has a domain B does not
    let A, B, dom;
    outer: for (const a of deities)
      for (const b of deities) {
        if (a.id === b.id) continue;
        const d = a.domains!.find((x) => !b.domains!.includes(x));
        if (d) {
          A = a;
          B = b;
          dom = d;
          break outer;
        }
      }
    expect(domainFeat, 'a domains-kind feat should exist').toBeTruthy();
    expect(A && B && dom, 'two deities with differing domains should exist').toBeTruthy();
    const h = harness({
      deityId: A!.id,
      featPicks: { '1:class:0': domainFeat!.id },
      featChoices: { '1:class:0': dom! },
    });
    h.actions.changeDeity(B!.id);
    // the stale domain (absent from B) is re-defaulted to B's first domain
    expect(B!.domains!.includes(h.get().featChoices['1:class:0'])).toBe(true);
  });
});
