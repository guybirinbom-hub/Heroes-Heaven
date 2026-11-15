// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { confirmCastingChanges } from '../src/builder/tweaks/castingConfirm';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { castingEntryChanges, openForTweaks } from '../src/rules/blocks/save';
import { setTweaksSwitch, writeTweak } from '../src/rules/blocks/write';
import { applyPlayState, initialPlay, playForRebuild, type PlayState } from '../src/rules/play';
import { rebuildRoster } from '../src/data/rebuild';
import type { SavedChar } from '../src/data/storage';
import type { Character, FeatCategory, SpellcastingEntry } from '../src/rules/types';

/**
 * A SAVE THAT CHANGES A SPELLCASTING ENTRY ASKS FIRST (Tweaks part B, WP4; decision B16; open point 8 of
 * docs/overrides-redesign.md Part 3; work/tweaks-part-b-notes/plan.md section 1 "WP4").
 *
 * Open point 8's FIRST step: the launch rebuild (`rebuildRoster` → `buildCharacter`) already applies case D —
 * a cleric GIVEN Flexible Spellcaster Dedication through Tweaks comes back spontaneous on load, exactly as a
 * picked one. (The 2026-10-20 browser note that it did not was a stale-module artefact.) Then: the Builder's
 * Save names every casting entry it changes (blocks/save.ts `castingEntryChanges`; the dialog is
 * builder/tweaks/castingConfirm.tsx) — whatever changed it, a pause or Tweaks switched off included — and the
 * spells the player prepared or chose stay stored (`playForRebuild` keeps every key), so a resume or a switch
 * back on brings them back. The dialog says so; these tests are why it may.
 *
 * MUTATION PROOF (wp4-report.md; each run alone, 2026-10-21): `submit` without the casting check fails "Keep
 * editing…"; a `castingEntryChanges` that skips a removed entry fails both pause tests and "castingEntryChanges
 * names the cleric entry…" (its synthetic removed entry); the dialog text naming a cause again ("remove the
 * feat, or turn the tweak back on") fails "Keep editing…" (fix round). Synthetic characters only.
 */

const db = content();

function hero(classId: string, level: number, more: Partial<BuildState> = {}): BuildState {
  const cls = db.classes[classId];
  return {
    ...emptyBuild(),
    name: 'Casting fixture',
    level,
    classId,
    keyAbility: cls.keyAbility[0] as BuildState['keyAbility'],
    ancestryId: 'human',
    backgroundId: 'acolyte',
    subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
    ...more,
  } as BuildState;
}
const give = (b: BuildState, featId: string, level: number, category: FeatCategory = 'class'): BuildState =>
  ({ ...b, overrides: { addedFeats: [{ featId, level, category }] } }) as BuildState;
const entry = (c: Character, id: string): SpellcastingEntry | undefined => c.spellcasting.find((e) => e.id === id);

const FSD = 'flexible-spellcaster-dedication';
const CLERIC = (): BuildState => hero('cleric', 4, { subclassId: 'cloistered-cleric' });

/* ─────────────────────────────── the Builder, mounted ─────────────────────────────── */

const cleanups: (() => void)[] = [];
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
const confirmBox = () => document.querySelector('.confirm-modal');
const confirmTitle = () => confirmBox()?.querySelector('.picker-head')?.textContent?.trim() ?? '';
const buttonIn = (root: ParentNode | null, label: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
async function press(b: Element | null | undefined) {
  if (!b) throw new Error('no such button');
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

function openBuilder(initial: BuildState) {
  const created: BuildState[] = [];
  const r = renderDom(createElement(Builder, { content: db, initial, onCancel: () => undefined, onCreate: (b: BuildState) => void created.push(b) }));
  cleanups.push(r.stop);
  return { r, created };
}

/** Press Save; answer "choices left" with Save anyway, and the casting question with `casting`. Returns the
 *  casting questions asked: title and text. */
async function save(host: HTMLElement, casting: 'Save anyway' | 'Keep editing'): Promise<{ title: string; text: string }[]> {
  const asked: { title: string; text: string }[] = [];
  await press(host.querySelector('button.b-create'));
  for (let i = 0; i < 4 && confirmBox(); i++) {
    const title = confirmTitle();
    if (title.startsWith('This changes')) {
      asked.push({ title, text: confirmBox()?.textContent ?? '' });
      await press(buttonIn(confirmBox(), casting));
    } else await press(buttonIn(confirmBox(), 'Save anyway'));
  }
  return asked;
}

/* ─────────────────────────────── open point 8, step 1 ─────────────────────────────── */

describe('open point 8: the launch rebuild already applies case D', () => {
  it('the launch rebuild already turns a cleric given Flexible Spellcaster Dedication spontaneous', () => {
    const given = give(CLERIC(), FSD, 2);
    const picked = { ...CLERIC(), featPicks: { ...CLERIC().featPicks, '2:class:0': FSD } } as BuildState;
    // The roster as an OLDER engine stored it: the derived cache built without case D (the given feat not
    // held), the build the player authored. Through JSON, as storage holds it.
    const stale = buildCharacter(CLERIC(), db);
    expect(entry(stale, 'cleric-casting')?.type, 'fixture: the stored cache says prepared').toBe('prepared');
    const roster = JSON.parse(JSON.stringify([{ id: 'pc-cleric', build: given, character: stale, play: initialPlay(stale, db) }])) as SavedChar[];
    const [launched] = rebuildRoster(roster, db);
    const e = entry(launched.character, 'cleric-casting');
    expect(e?.type, 'the launch rebuild makes it spontaneous').toBe('spontaneous');
    expect(e?.spellCollection).toBe(4);
    expect(e).toEqual(entry(buildCharacter(picked, db), 'cleric-casting'));
    // Loading is not an edit: the build comes back byte-equal.
    expect(JSON.stringify(launched.build)).toBe(JSON.stringify(roster[0].build));
  }, 60_000);
});

/* ─────────────────────────────── B16: the check and the question ─────────────────────────────── */

describe('B16: a Save that changes a casting entry asks first', () => {
  it('castingEntryChanges names the cleric entry: prepared → spontaneous', () => {
    const before = buildCharacter(CLERIC(), db);
    const after = buildCharacter(give(CLERIC(), FSD, 2), db);
    const changes = castingEntryChanges(before, after);
    expect(changes).toEqual([{ id: 'cleric-casting', name: entry(before, 'cleric-casting')!.name, what: ['prepared → spontaneous'] }]);
    expect(castingEntryChanges(after, before)[0].what).toEqual(['spontaneous → prepared']);
    // The other shapes B16 names, on synthetic entries.
    const e = (x: Partial<SpellcastingEntry>): SpellcastingEntry => ({ id: 'x', name: 'X casting', type: 'prepared', tradition: 'arcane', keyAbility: 'int', proficiency: 'trained', cantrips: [], ...x }) as SpellcastingEntry;
    const ch = (a: SpellcastingEntry[], b: SpellcastingEntry[]) => castingEntryChanges({ spellcasting: a } as Character, { spellcasting: b } as Character);
    const slot = { spellId: null, expended: false };
    expect(ch([e({ prepared: { 1: [slot, slot] } })], [e({ prepared: {} })])[0].what).toEqual(['no prepared spell slots left']);
    expect(ch([e({ type: 'spontaneous', slots: { 1: { max: 3, used: 0 }, 2: { max: 2, used: 0 } } })], [e({ type: 'spontaneous', slots: { 1: { max: 3, used: 0 } } })])[0].what).toEqual(['repertoire 5 → 3 spells']);
    expect(ch([e({ cantripCap: 5 })], [e({ cantripCap: 4 })])[0].what).toEqual(['cantrips 5 → 4']);
    expect(ch([e({})], [])[0].what).toEqual(['removed']);
    // Granted lists (focus, innate, items, ritual) hold no choice of the player's: never asked about.
    expect(ch([e({ type: 'innate' }), e({ id: 'f', type: 'focus' })], [])).toEqual([]);
    // A level-up, a new entry, a bigger repertoire: nothing to ask.
    expect(ch([e({ cantripCap: 4, prepared: { 1: [slot] } })], [e({ cantripCap: 5, prepared: { 1: [slot, slot] } }), e({ id: 'y' })])).toEqual([]);
  });

  it('no casting change, no dialog', async () => {
    const c = buildCharacter(CLERIC(), db);
    expect(castingEntryChanges(c, c)).toEqual([]);
    await expect(confirmCastingChanges([])).resolves.toBe(true);
    expect(confirmBox(), 'no change asks nothing').toBeNull();
    // Through the Builder: the cleric saved as it is — only "choices left", never "This changes".
    const { r, created } = openBuilder(CLERIC());
    const asked = await save(r.host, 'Keep editing');
    expect(asked).toEqual([]);
    expect(created.length).toBe(1);
  }, 120_000);

  it('Keep editing leaves onCreate uncalled', async () => {
    // A cleric given Flexible Spellcaster Dedication, Tweaks switched OFF in the Builder: the given feat stops
    // counting, the entry goes back to prepared — a casting change.
    const { r, created } = openBuilder(give(CLERIC(), FSD, 2));
    const setup = [...r.host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === 'Setup');
    expect(setup, 'the Setup page button').toBeDefined();
    await press(setup);
    const toggle = r.host.querySelector<HTMLButtonElement>('button.ovr-opt');
    expect(toggle?.classList.contains('on'), 'the old character reads ON (stamped at open)').toBe(true);
    await press(toggle);
    // Plan B WP6 (section 5.3): switching Tweaks off now asks first, listing what stops counting.
    expect(confirmTitle(), 'the switch-off question').toBe('Turn off Tweaks?');
    await press(buttonIn(confirmBox(), 'Turn off'));
    expect(r.host.querySelector('button.ovr-opt')?.classList.contains('on'), 'switched off').toBe(false);

    const asked = await save(r.host, 'Keep editing');
    expect(asked.length, 'the casting question was asked').toBe(1);
    // The question names the entry as it WAS (blocks/save.ts `was.name`): the flexible cleric's, which since the
    // 2026-10-23 rename says spontaneous. It matched the plain cleric's name before only because the flexible
    // entry kept the stale "prepared" name.
    expect(asked[0].title).toBe('This changes Divine spontaneous spellcasting');
    expect(entry(buildCharacter(CLERIC(), db), 'cleric-casting')!.name, 'and the plain cleric it goes back to').toBe('Divine prepared spellcasting');
    expect(asked[0].text).toContain('spontaneous → prepared');
    expect(asked[0].text).toContain('stay saved');
    // The text names no cause: the same question fires on a level-down or a class change, where neither
    // "remove the feat" nor "turn the tweak back on" is the way back (checker finding, WP4 fix round).
    expect(asked[0].text).toContain('come back if the change is undone');
    expect(asked[0].text).not.toMatch(/remove the feat|tweak back on/);
    expect(created, 'Keep editing: nothing stored').toEqual([]);
    expect(r.host.querySelector('.builder-head'), 'still in the Builder').not.toBeNull();

    const again = await save(r.host, 'Save anyway');
    expect(again.length).toBe(1);
    expect(created.length, 'Save anyway stores it').toBe(1);
    expect(created[0].options?.overridesEnabled).toBe(false);
    expect(created[0].overrides?.v).toBe(2);
    expect(created[0].overrides?.addedFeats, 'the given feat itself is kept').toEqual([{ featId: FSD, level: 2, category: 'class' }]);
  }, 180_000);
});

/* ─────────────────────────────── the player's spells stay stored ─────────────────────────────── */

/** One Save as App's onCreate runs it: the new character, and the play state carried through playForRebuild. */
function saveAs(prevBuild: BuildState, nextBuild: BuildState, play: PlayState): { prev: Character; next: Character; play: PlayState } {
  const prev = buildCharacter(prevBuild, db);
  const next = buildCharacter(nextBuild, db);
  return { prev, next, play: playForRebuild(play, next, prev) };
}

describe("the player's prepared and chosen spells stay stored through a casting change", () => {
  it('playForRebuild keeps every preparedSpells key', () => {
    const before = CLERIC();
    const c = buildCharacter(before, db);
    const play: PlayState = {
      ...initialPlay(c, db),
      preparedSpells: { 'cleric-casting:1:0': 'bless', 'cleric-casting:1:1': 'heal', 'cleric-casting:2:0': 'sound-burst', 'cleric-casting:cantrip:0': 'divine-lance' },
      repertoireSpells: { 'cleric-casting': { 1: ['bless'] } },
    };
    const s = saveAs(before, give(before, FSD, 2), play);
    expect(castingEntryChanges(s.prev, s.next).length, 'fixture: a casting change').toBe(1);
    expect(s.play.preparedSpells).toEqual(play.preparedSpells);
    expect(s.play.repertoireSpells).toEqual(play.repertoireSpells);
  });

  /** Pause a given feat (its own switch), save, resume, save — the keys survive both Saves, and the resumed
   *  character draws them again. `off` / `on` make the two builds. */
  function pauseAndResume(active: BuildState, off: (b: BuildState) => BuildState, play: PlayState) {
    const paused = off(active);
    const s1 = saveAs(active, paused, play);
    const s2 = saveAs(paused, active, s1.play);
    return { s1, s2 };
  }

  const WIZ = 'wizard-dedication-casting';
  const fighterWizard = () => openForTweaks(give(hero('fighter', 4), 'wizard-dedication', 2), db);
  const clericFlexible = () => openForTweaks(give(CLERIC(), FSD, 2), db);
  const pauseGiven = (key: string) => (b: BuildState) => ({ ...b, overrides: writeTweak(b, { op: 'setOn', key, on: false }).overrides }) as BuildState;
  const switchOff = (b: BuildState) => ({ ...b, ...setTweaksSwitch(b, false) }) as BuildState;

  for (const [how, offFor] of [
    ['its own switch', (key: string) => pauseGiven(key)],
    ['the master switch off', (_key: string) => switchOff],
  ] as const) {
    it(`pausing a given casting dedication and saving keeps its preparedSpells / known-spell keys, and resuming restores them — ${how}`, () => {
      // (1) An entry GONE: a fighter given Wizard Dedication, two cantrips prepared on the sheet.
      const fw = fighterWizard();
      const fc = buildCharacter(fw, db);
      const fPlay: PlayState = { ...initialPlay(fc, db), preparedSpells: { [`${WIZ}:cantrip:0`]: 'electric-arc', [`${WIZ}:cantrip:1`]: 'shield' } };
      expect(applyPlayState(fc, fPlay, db).spellcasting.find((e) => e.id === WIZ)?.cantrips, 'fixture: drawn while active').toEqual(['electric-arc', 'shield']);
      const f = pauseAndResume(fw, offFor('addedFeats:wizard-dedication@2'), fPlay);
      expect(entry(f.s1.next, WIZ), 'paused: the entry is gone').toBeUndefined();
      expect(castingEntryChanges(f.s1.prev, f.s1.next), 'the casting confirm fires: an entry gone').toEqual([{ id: WIZ, name: entry(fc, WIZ)!.name, what: ['removed'] }]);
      expect(f.s1.play.preparedSpells, 'kept through the paused Save').toEqual(fPlay.preparedSpells);
      expect(castingEntryChanges(f.s2.prev, f.s2.next), 'resuming adds the entry back: nothing to ask').toEqual([]);
      expect(f.s2.play.preparedSpells).toEqual(fPlay.preparedSpells);
      expect(applyPlayState(f.s2.next, f.s2.play, db).spellcasting.find((e) => e.id === WIZ)?.cantrips, 'resumed: drawn again').toEqual(['electric-arc', 'shield']);

      // (2) A type change: a cleric given Flexible Spellcaster Dedication, collection spells chosen on the sheet.
      const cf = clericFlexible();
      const cc = buildCharacter(cf, db);
      const cPlay: PlayState = {
        ...initialPlay(cc, db),
        repertoireSpells: { 'cleric-casting': { 1: ['bless', 'heal'] } },
        preparedSpells: { 'cleric-casting:1:0': 'bless' },
      };
      expect(applyPlayState(cc, cPlay, db).spellcasting.find((e) => e.id === 'cleric-casting')?.repertoire?.[1], 'fixture: drawn while active').toEqual(['bless', 'heal']);
      const c = pauseAndResume(cf, offFor(`addedFeats:${FSD}@2`), cPlay);
      expect(castingEntryChanges(c.s1.prev, c.s1.next)[0]?.what, 'the casting confirm fires').toEqual(['spontaneous → prepared']);
      expect(c.s1.play.repertoireSpells).toEqual(cPlay.repertoireSpells);
      expect(c.s1.play.preparedSpells).toEqual(cPlay.preparedSpells);
      expect(c.s2.play.repertoireSpells).toEqual(cPlay.repertoireSpells);
      const resumed = applyPlayState(c.s2.next, c.s2.play, db).spellcasting.find((e) => e.id === 'cleric-casting');
      expect(resumed?.type).toBe('spontaneous');
      expect(resumed?.repertoire?.[1], 'resumed: the collection is drawn again').toEqual(['bless', 'heal']);
    }, 60_000);
  }
});
