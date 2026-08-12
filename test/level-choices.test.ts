import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { emptyBuild, levelChoices, setupMissing, subclassAnchorLevel, type BuildState } from '../src/rules/build';

/*
 * One list of what is still unchosen, for the whole build.
 *
 * Before this there were two functions that disagreed: setupMissing checked thirteen origin fields,
 * and a separate pendingCount inside the builder checked four per-level ones. Only the first reached
 * the Create/Save confirmation, so a level-12 character with nine empty feat slots saved in silence,
 * and a green "all set" badge could sit on a kineticist with no element chosen.
 *
 * These tests pin the three properties that matter: it sees the per-level slots, it sees the class
 * subsystems, and setupMissing still means exactly what it used to mean (the origin page).
 */

const c = content();

const base = (extra: Partial<BuildState> = {}): BuildState => ({
  ...emptyBuild(),
  ancestryId: 'human',
  heritageId: 'skilled-human',
  backgroundId: 'acolyte',
  ...extra,
});

describe('setupMissing keeps its old meaning', () => {
  it('is exactly the page-0 entries of levelChoices', () => {
    const b = base({ classId: 'fighter', level: 5 });
    const page0 = levelChoices(b, c).filter((m) => m.page === 0).map((m) => m.label);
    expect(setupMissing(b, c)).toEqual(page0);
  });

  it('still reports the origin gaps it always did', () => {
    const b = base({ classId: 'fighter' });
    const missing = setupMissing(b, c);
    expect(missing).toContain('Ancestry boosts (2)');
    expect(missing).toContain('Background boosts (2)');
  });
});

describe('it sees the per-level choices setupMissing never did', () => {
  it('reports an unfilled feat slot, on the level that owns it', () => {
    const b = base({ classId: 'fighter', level: 4 });
    const all = levelChoices(b, c);
    const featRows = all.filter((m) => m.page >= 1 && /feat/i.test(m.label));
    expect(featRows.length).toBeGreaterThan(0);
    // Every level row names its own level, so a flat list still tells you where to go.
    for (const r of featRows) expect(r.label.startsWith(`Level ${r.page} —`)).toBe(true);
    // …and none of them leaked onto the origin page.
    expect(setupMissing(b, c).some((s) => /^Level /.test(s))).toBe(false);
  });

  it('reports an unmade skill increase', () => {
    const b = base({ classId: 'fighter', level: 3 });
    expect(levelChoices(b, c).some((m) => m.label.includes('skill increase'))).toBe(true);
  });

  it('a filled feat slot stops being reported', () => {
    // The slot key's index is the position in the level's whole featSlots array, not a per-category
    // counter: a level-1 fighter has ['ancestry', 'class'], so the class feat is index 1.
    const b = base({ classId: 'fighter', level: 1 });
    const before = levelChoices(b, c).filter((m) => m.page === 1);
    expect(before.map((m) => m.label)).toEqual(['Level 1 — ancestry feat', 'Level 1 — class feat']);
    const withPick: BuildState = { ...b, featPicks: { ...b.featPicks, '1:class:1': 'sudden-charge' } };
    expect(levelChoices(withPick, c).filter((m) => m.page === 1).map((m) => m.label)).toEqual([
      'Level 1 — ancestry feat',
    ]);
  });

  it("a picked feat's follow-up choice stops being reported once ANSWERED", () => {
    // The picker writes to featChoices under the SLOT key; grantedFeatChoices is keyed by feat id and
    // belongs to feats the character was GIVEN. Reading only the latter left the answer invisible, so
    // the level kept a permanent "1 choice left" tag nothing on the page could clear — and levelChoices
    // could never reach zero, which is what the Create/Save completeness check reads.
    const b = base({ classId: 'fighter', level: 6, featPicks: { '6:class:0': 'eidolons-wrath' } });
    const asked = (x: BuildState) => levelChoices(x, c).filter((m) => /Eidolon/i.test(m.label)).map((m) => m.label);
    expect(asked(b)).toEqual(["Eidolon's Wrath — choose"]);
    expect(asked({ ...b, featChoices: { '6:class:0': 'fire' } })).toEqual([]);
    // The granted route still works — a different store for a different case, not a replacement.
    expect(asked({ ...b, grantedFeatChoices: { 'eidolons-wrath': 'fire' } })).toEqual([]);
  });

  it('a MULTI-pick choice is answered only when EVERY pick is', () => {
    // choiceKeys fans a picks:N choice out to `key#0`, `key#1`, … Answering one must not clear the tag,
    // or the builder would call the level complete with half a choice made.
    const multi = Object.entries(c.feats).find(([, f]) => (f.choice?.picks ?? 1) > 1);
    expect(multi, 'no shipped multi-pick feat to test against').toBeTruthy();
    const [featId, feat] = multi!;
    const b = base({ classId: 'fighter', level: 6, featPicks: { '6:class:0': featId } });
    const asked = (x: BuildState) => levelChoices(x, c).filter((m) => m.label.startsWith(feat.name)).length;
    expect(asked(b)).toBe(1);
    expect(asked({ ...b, featChoices: { '6:class:0#0': 'x' } })).toBe(1); // one of N — still outstanding
  });

  it('never reports a level above the character', () => {
    const b = base({ classId: 'fighter', level: 3 });
    expect(levelChoices(b, c).every((m) => m.page <= 3)).toBe(true);
  });
});

describe('it sees the class subsystems that nothing counted before', () => {
  it('a kineticist with no element chosen is not "all set"', () => {
    const b = base({ classId: 'kineticist', level: 1 });
    const labels = levelChoices(b, c).map((m) => m.label);
    // The kineticist's element group comes through the generic extraChoices branch.
    const groups = (c.classes.kineticist?.extraChoices ?? []).map((g) => g.name);
    expect(groups.length).toBeGreaterThan(0);
    expect(labels.some((l) => groups.some((g) => l.startsWith(g)))).toBe(true);
  });

  it('counts down as elements are picked, and clears at the last one', () => {
    // A level-1 kineticist's Kinetic Gate takes TWO elements, so the row has to count down rather
    // than disappear on the first pick.
    const b = base({ classId: 'kineticist', level: 1 });
    const group = (c.classes.kineticist?.extraChoices ?? [])[0];
    expect(group).toBeTruthy();
    const [a, d] = group.options.map((o) => o.id);
    const rows = (bs: BuildState) => levelChoices(bs, c).filter((m) => m.label.startsWith(group.name)).map((m) => m.label);

    expect(rows(b)).toEqual([`${group.name} (2)`]);
    expect(rows({ ...b, extraChoices: { ...b.extraChoices, [group.id]: [a] } })).toEqual([group.name]);
    expect(rows({ ...b, extraChoices: { ...b.extraChoices, [group.id]: [a, d] } })).toEqual([]);
  });

  it('a group not yet unlocked at this level is not asked for', () => {
    // Every reported group must actually be available at the character's level.
    const b = base({ classId: 'thaumaturge', level: 1 });
    const groups = c.classes.thaumaturge?.extraChoices ?? [];
    const reported = levelChoices(b, c).map((m) => m.label);
    for (const g of groups) {
      const unlockedAt = Math.min(...Object.keys(g.pickByLevel).map(Number));
      if (unlockedAt > 1) expect(reported.some((l) => l.startsWith(g.name))).toBe(false);
    }
  });
});

describe('the subclass is owed by exactly one level', () => {
  it('a barbarian owes its Instinct at the level that grants it, and only there', () => {
    const b = base({ classId: 'barbarian', level: 5 });
    const lvl = subclassAnchorLevel(b, c);
    expect(lvl).toBeTruthy();
    const rows = levelChoices(b, c).filter((m) => /instinct/i.test(m.label));
    expect(rows.length).toBe(1);
    expect(rows[0].page).toBe(lvl);
  });

  it('choosing it clears the row', () => {
    const b = base({ classId: 'barbarian', level: 5 });
    const sub = c.classes.barbarian?.subclass?.options[0]?.id;
    expect(sub).toBeTruthy();
    expect(levelChoices({ ...b, subclassId: sub }, c).some((m) => /instinct/i.test(m.label))).toBe(false);
  });
});

describe('a fully-built character reports nothing', () => {
  it('the count only ever goes down as choices are made', () => {
    const b = base({ classId: 'fighter', level: 2 });
    const start = levelChoices(b, c).length;
    const step1 = levelChoices({ ...b, ancestryBoosts: ['str', 'con'] }, c).length;
    expect(step1).toBeLessThan(start);
  });

  it('an empty build does not throw', () => {
    expect(() => levelChoices(emptyBuild(), c)).not.toThrow();
  });
});
