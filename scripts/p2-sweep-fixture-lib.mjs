/*
 * The zero-marks sweep's characters, picked from the parity snapshot's specs (Tweaks phase 2, WP4) — the ONE body
 * both scripts/p2-sweep-fixture.mjs (writes test/fixtures/p2-sweep-specs.json) and test/p2-sweep-fixture-fresh.test.ts
 * (WP4 finish, C9: fails when the specs changed and the fixture was not re-made) use. See the script for what the
 * two lists hold and why `subclass-anyway` is not in the positive control.
 */

/** The cases whose pick a mark names on a Builder page (Setup cards, a feat slot, an answer, a spell chip). */
export const MARKED = ['heritage-anyway', 'background-anyway', 'deity-anyway', 'sanctification-anyway', 'spell-anyway-open', 'spell-anyway', 'dedication-early'];

export const FIXTURE_NOTE = 'Written by scripts/p2-sweep-fixture.mjs from the parity snapshot specs; synthetic characters only.';

const PHASE2 = /^(choice\.(?!allowAnyway$)|remove\.choicePlace$)/;
const namesAPick = (b) => {
  const ov = b.overrides ?? {};
  if (ov.allowedFeats?.length) return true;
  return (ov.blocks ?? []).some((x) => typeof x?.kind === 'string' && (x.kind === 'choice.allowAnyway' || PHASE2.test(x.kind)));
};

/** The fixture's content for the engine `E` (`loadEngine`'s result) and the parity script's `isTwinId`. */
export function sweepFixtureOf(E, isTwinId) {
  const specs = E.specs;
  const p2Main = specs.filter((s) => /^overrides:p2-[a-z0-9-]+?:/.test(s.id) && !/-(paused|off):/.test(s.id) && !/^overrides:p2-[a-z0-9-]+-(paused|off):/.test(s.id));
  const zero = [];
  for (const s of p2Main) if (isTwinId(s.id)) zero.push({ id: s.id, build: s.build });
  const old = specs.filter((s) => /^overrides:/.test(s.id) && !/^overrides:p2-/.test(s.id) && !isTwinId(s.id) && !namesAPick(s.build));
  const step = Math.max(1, Math.floor(old.length / 30));
  for (const s of old.filter((_, i) => i % step === 0).slice(0, 30)) zero.push({ id: s.id, build: s.build });
  const marked = [];
  for (const kase of MARKED) {
    const live = specs.find((s) => s.id.startsWith(`overrides:p2-${kase}:`) && !isTwinId(s.id));
    const off = specs.find((s) => s.id.startsWith(`overrides:p2-${kase}-off:`) && !isTwinId(s.id));
    if (!live) throw new Error(`no parity spec for p2 case ${kase}`);
    marked.push({ id: live.id, build: live.build, ...(off ? { off: { id: off.id, build: off.build } } : {}) });
  }
  return { note: FIXTURE_NOTE, zero, marked };
}
