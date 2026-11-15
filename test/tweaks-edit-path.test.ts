// @vitest-environment jsdom
import { act, createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';

/**
 * BOTH EDIT PATHS KEEP THE STORED BUILD (Tweaks part B, WP4; work/tweaks-part-b-notes/plan.md section 1
 * "WP4", open point 3; docs/overrides-redesign.md Part 3).
 *
 * The player's App (`onEdit`) and the GM's edit sheet (`openBuilder`) open the Builder on
 * src/data/editBuild.ts `editableBuildOf`: the STORED build whenever there is one. The reverse build
 * (`deriveBuildFromCharacter`) cannot tell a class-skill pick from a rank a tweak made (blocks-rank-seams'
 * KNOWN LIMIT test, kept), so it runs only for a build-less character — and if it throws there is NO build
 * to open: `editableBuildOf` answers null and both hosts refuse to open the Builder (2026-10-23). It used to
 * open a blank build that kept only `overrides` and `options`, and a Save from it replaced the character
 * whole — feats, items and spells gone (test/lostchar-save-import.test.tsx mounts both hosts on it).
 *
 * How "never reverse-derives" is observed: the character handed in is a Proxy that throws on any read, so
 * a reverse build (which reads the character) cannot run unnoticed. The GM path is mounted, with a
 * pass-through spy on `editableBuildOf`; the App path (the whole app shell) is pinned by its source.
 *
 * MUTATION PROOF (wp4-report.md; each run alone, 2026-10-21): `editableBuildOf` deriving first
 * (`deriveBuildFromCharacter(...)` before the `saved.build` test) fails "both edit paths…" (the character was
 * read) and "the reverse-derive fallback…" (the throw now escapes the try); its catch returning a blank
 * build again fails "the reverse-derive fallback…" (2026-10-23); GmEditSheet's openBuilder back on
 * `work.build ?? deriveBuildFromCharacter(...)` fails "both edit paths…" (the spy is never called).
 * Fix round (each run alone, 2026-10-21): the open stamp building a classless build anyway, or stamping
 * `{ of, moved }` on the entries it cannot measure, fails "the fallback's blank build gets no mode…" (each alone).
 * Synthetic characters only.
 */

vi.mock('../src/data/editBuild', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/data/editBuild')>();
  return { ...real, editableBuildOf: vi.fn(real.editableBuildOf) };
});

const { buildCharacter, deriveBuildFromCharacter, emptyBuild } = await import('../src/rules/build');
const editBuild = await import('../src/data/editBuild');
const editable = vi.mocked(editBuild.editableBuildOf);
const { editableBuildOf } = editBuild;
const { Builder } = await import('../src/builder/Builder');
const { GmEditSheet } = await import('../src/sheet/GmEditSheet');
const { initialPlay } = await import('../src/rules/play');
const { openForTweaks, stampTweaksSave } = await import('../src/rules/blocks/save');
import type { BuildState } from '../src/rules/build';
import type { SavedChar } from '../src/data/storage';
import type { BuildOverrides, Character, ProficiencyRank, TweakMeta } from '../src/rules/types';

const db = content();
const ROOT = join(__dirname, '..');

function hero(classId: string, level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 'Edit path fixture',
    level,
    classId,
    keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : 'str') as BuildState['keyAbility'],
    ancestryId: 'human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    ...more,
  } as BuildState;
}

/** "Exactly expert" Athletics, stored as part B stores it (the old key + its meta). */
const EXACTLY_EXPERT_ATHLETICS: BuildOverrides = {
  proficiencies: { athletics: 'expert' as ProficiencyRank },
  meta: { 'proficiencies:athletics': { of: 'expert', mode: 'exactly' } },
} as BuildOverrides;

const saved = (b: BuildState, withBuild = true): SavedChar => {
  const character = buildCharacter(b, db);
  return { id: 'pc-edit', character, ...(withBuild ? { build: b } : {}), play: initialPlay(character, db) } as SavedChar;
};

/** The character, except that reading anything but `allow` throws: a reverse build cannot run on it. */
function untouchable(c: Character, allow: readonly string[] = []): Character {
  return new Proxy(c, {
    get(t, p) {
      if (typeof p === 'string' && allow.includes(p)) return (t as unknown as Record<string, unknown>)[p];
      throw new Error(`the character was read (${String(p)})`);
    },
  });
}

const cleanups: (() => void)[] = [];
beforeEach(() => {
  // A block body: a hook that RETURNS a function has it run as a teardown (mockClear returns the mock).
  editable.mockClear();
});
afterEach(async () => {
  for (let i = 0; i < 4 && document.querySelector('.confirm-modal'); i++) {
    const keep = [...document.querySelectorAll('.confirm-modal .confirm-actions button')][0];
    await act(async () => {
      keep?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await settle();
  }
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* already unmounted */
    }
  }
  await settle();
  for (const n of [...document.body.children]) n.remove();
});
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
}
async function press(b: Element | null | undefined) {
  if (!b) throw new Error('no such button');
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}
const buttonIn = (root: ParentNode | null, label: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
async function save(root: ParentNode) {
  await press(root.querySelector('button.b-create'));
  for (let i = 0; i < 4 && document.querySelector('.confirm-modal'); i++) await press(buttonIn(document.querySelector('.confirm-modal'), 'Save anyway'));
}

describe('the edit paths (open point 3)', () => {
  it('both edit paths use the stored build and never reverse-derive one when it exists', async () => {
    // The one function: the stored build itself; the character is never read (no reverse build).
    const b = hero('fighter', 3, { overrides: EXACTLY_EXPERT_ATHLETICS } as Partial<BuildState>);
    const sc = saved(b);
    const got = editableBuildOf({ ...sc, character: untouchable(sc.character) }, db);
    expect(got?.build).toBe(sc.build);
    expect(got?.derived).toBe(false);
    // A build-less character: the reverse build.
    const back = editableBuildOf(saved(b, false), db);
    expect(back?.derived).toBe(true);
    expect(back?.build.classId).toBe('fighter');

    // The GM path, mounted: "Edit in builder" goes through editableBuildOf, on the stored build, and the
    // Builder opens on it (its name).
    const r = renderDom(createElement(GmEditSheet, { initial: sc, live: sc, content: db, campaignId: 'camp-test', playerOwnerId: 'player-test', onExit: () => undefined }));
    cleanups.push(r.stop);
    editable.mockClear(); // only the Edit press is measured
    await press(document.querySelector('button[aria-label="Edit in builder"]'));
    expect(document.querySelector('.builder-head'), "the GM's Builder is open").not.toBeNull();
    expect(editable, 'the GM path opens the Builder through editableBuildOf').toHaveBeenCalledTimes(1);
    expect(editable.mock.results[0].value, 'on the stored build, not a reverse one').toEqual({ build: sc.build, derived: false });
    expect((document.querySelector('.builder-head input.name-input') as HTMLInputElement | null)?.value).toBe('Edit path fixture');

    // The App path: its onEdit hands the stored build through the same function, and neither host calls the
    // reverse build itself any more (App is the whole shell; its source is the pin).
    const app = readFileSync(join(ROOT, 'src/App.tsx'), 'utf8');
    const gm = readFileSync(join(ROOT, 'src/sheet/GmEditSheet.tsx'), 'utf8');
    const onEdit = /onEdit=\{\(\) => \{([\s\S]*?)\n\s*\}\}/.exec(app)?.[1] ?? '';
    // WP6 (5cf6a5c) made onEdit keep editableBuildOf's whole answer (`eb`), so the Builder also learns whether
    // the build was reverse-derived; the build it opens is still editableBuildOf's.
    expect(onEdit, 'App onEdit').toMatch(/const eb = editableBuildOf\(active, ownDb\);/);
    expect(onEdit, 'App onEdit').toMatch(/setEditing\(\{ id: active\.id, build: eb\.build\b/);
    for (const [name, src] of [['App.tsx', app], ['GmEditSheet.tsx', gm]] as const) {
      expect(src, `${name} reverse-derives only through editableBuildOf`).not.toMatch(/deriveBuildFromCharacter\(/);
      expect(src, name).toMatch(/editableBuildOf\(/);
    }
  }, 120_000);

  it('wizard classSkills [athletics] + exactly expert Athletics keeps athletics in classSkills through a Builder save round trip', async () => {
    const b = hero('wizard', 1, { classSkills: ['athletics', 'stealth'], overrides: EXACTLY_EXPERT_ATHLETICS } as Partial<BuildState>);
    const sc = saved(JSON.parse(JSON.stringify(b)) as BuildState);
    // Premise (blocks-rank-seams' KNOWN LIMIT, kept): the reverse build loses the pick.
    expect(deriveBuildFromCharacter(sc.character, db).classSkills).not.toContain('athletics');
    // The edit path opens the stored build; the Builder saves it back with the pick.
    const created: BuildState[] = [];
    const r = renderDom(createElement(Builder, { content: db, initial: editableBuildOf(sc, db)!.build, onCancel: () => undefined, onCreate: (x: BuildState) => void created.push(x) }));
    cleanups.push(r.stop);
    await save(r.host);
    expect(created.length, 'onCreate fired').toBe(1);
    expect(created[0].classSkills).toContain('athletics');
    expect(created[0].classSkills).toContain('stealth');
    // …and the character it makes still holds Athletics exactly at expert.
    expect(buildCharacter(created[0], db).proficiencies.skills.athletics).toBe('expert');
  }, 120_000);

  it('the reverse-derive fallback opens NOTHING: no blank build whose Save would replace the character', () => {
    // 2026-10-23 (Guy's goal "pressing Save can never wipe a character"; decided in his main chat: refuse).
    // This used to pin a blank build carrying only `overrides` and `options` — and a Save from that blank
    // build replaced the stored character whole, so its feats, items and spells were gone.
    const ov = { ...EXACTLY_EXPERT_ATHLETICS, addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }], v: 2 } as BuildOverrides;
    const b = hero('fighter', 3, { overrides: ov, options: { overridesEnabled: true, deepBackground: true } } as Partial<BuildState>);
    const none = saved(b, false);
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      // An unusual character the reverse build cannot read (only its tweaks and switch can be).
      const odd = untouchable(none.character, ['overrides', 'options']);
      expect(() => deriveBuildFromCharacter(odd, db), 'fixture: the reverse build throws on it').toThrow();
      expect(editableBuildOf({ ...none, character: odd }, db), 'no build to open').toBeNull();
      expect(quiet).toHaveBeenCalled();
      // The same with neither tweaks nor switch: still nothing to open.
      const plain = saved(hero('fighter', 1), false);
      const bare = untouchable({ ...plain.character, overrides: undefined, options: undefined } as Character, ['overrides', 'options']);
      expect(editableBuildOf({ ...plain, character: bare }, db)).toBeNull();
    } finally {
      quiet.mockRestore();
    }
  });

  it('a classless build with tweaks gets no mode and no baseline at open; the first Save of the rebuilt character stamps them as its sheet sorts', () => {
    // Old entries with no meta on a fighter L7: Fortitude TRAINED (the class makes it expert at 1, so the
    // real sheet sorts it "exactly"), Athletics expert, Str 18, max HP 60.
    // (This was the reverse-derive fallback's blank build until 2026-10-23; editableBuildOf no longer makes
    // one, but blocks/save.ts still meets a classless build, so its stamp is pinned on one made here.)
    const ov = { proficiencies: { fortitude: 'trained', athletics: 'expert' }, attributes: { str: 18 }, maxHp: 60 } as BuildOverrides;
    const real = hero('fighter', 7, { overrides: ov } as Partial<BuildState>);
    const blank: BuildState = { ...emptyBuild(), overrides: ov };
    expect(blank.classId, 'fixture: a classless build').toBeFalsy();
    // At open: no sheet to sort or measure against, so the ranks and sets are left as stored (no `{ of,
    // moved }` either, which would make their meta "matching" for good and lose the baseline).
    const draft = openForTweaks(blank, db);
    const meta = (draft.overrides!.meta ?? {}) as Record<string, TweakMeta>;
    for (const k of ['proficiencies:fortitude', 'proficiencies:athletics', 'attributes:str', 'maxHp:max-hp']) expect(meta[k], k).toBeUndefined();
    expect(Object.values(meta).some((m) => m.mode !== undefined || m.baseline !== undefined), 'no mode, no baseline').toBe(false);
    expect(draft.overrides!.v, 'v and the switch are stamped as always').toBe(2);
    // The player rebuilds the class in that session and saves: the Save stamp sorts and measures against the
    // rebuilt sheet — exactly what opening the real build would have stamped.
    const rebuilt = { ...real, overrides: draft.overrides, options: draft.options } as BuildState;
    const savedMeta = stampTweaksSave(rebuilt, db).overrides!.meta as Record<string, TweakMeta>;
    expect(buildCharacter(real, db).tweakRankSort?.fortitude, 'fixture: the real sheet sorts Fortitude "exactly"').toBe('exactly');
    expect(savedMeta['proficiencies:fortitude']).toEqual({ of: 'trained', moved: true, mode: 'exactly' });
    expect(savedMeta).toEqual(openForTweaks(real, db).overrides!.meta);
    expect(savedMeta['attributes:str'].baseline, 'the Str baseline is the boosted score, not 10').not.toBe(10);
    expect(savedMeta['maxHp:max-hp'].baseline, 'the max-HP baseline is the book maximum, not 0').toBeGreaterThan(0);
  }, 60_000);
});
