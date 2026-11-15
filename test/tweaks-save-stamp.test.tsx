// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';

/**
 * THE SAVE PATH STAMP (Tweaks part B, WP4; work/tweaks-part-b-notes/plan.md section 1 "WP4", section 3.3,
 * decisions B4, B15, B27; docs/overrides-redesign.md spec items 1-3).
 *
 * Opening the Builder stamps the DRAFT once (`openForTweaks`, blocks/save.ts): `v: max(2, stored v)`, the
 * Tweaks switch as it reads today (an old character reads ON), and on every old entry without matching meta
 * `{ of, moved: true }` plus `mode` (ranks, THE sort the sheet used) and `baseline` (sets). Storage changes
 * only when the player presses Save (`stampTweaksSave`, the same stamp, idempotent); Cancel stores nothing and
 * asks nothing. Opening moves no number: every overrides character of the parity snapshot builds the same
 * numbers before and after the stamp, under both trust gates (test/tweaks-save-stamp-numbers.test.ts, the
 * node-environment half of this file).
 *
 * The fixture is the SAMPLE of test/overrides-write.test.tsx in its frozen OLD shape (no `v`, no mode /
 * moved / source — as scripts/blocks-parity-snapshot.mjs keeps it), on a synthetic level-5 fighter.
 *
 * MUTATION PROOF (wp4-report.md; each run alone, 2026-10-21): each of these turns the named it() red —
 *  - the Builder initializer back on `initial ?? emptyBuild()` (no open stamp): "opening the Builder stamps…"
 *    (the hidden-card character's Options switch shows OFF at open, the draft carries no switch) and "a second
 *    Save…" (its source pin of the initializer); test/tweaks-casting-confirm's "Keep editing…" too;
 *  - `submit` handing `onCreate(build)` without `stampTweaksSave`: "a second Save…" (its source pin — the open
 *    stamp already stamped every entry, so no mounted Save can tell; the function's own stamp of an entry
 *    added after open is checked there directly);
 *  - the stamp keeping a stale meta's `on` / `from` (spread of the stale meta): "a stale meta keeps its reason…";
 *  - the stamp writing `v: 2` over a stored `v: 3`: "… keep v: 3 (B27)…".
 * Fix round (checker findings; each run alone in the WP4-only worktree, 2026-10-21):
 *  - freezing any matching rank meta (`freezable` = any object, a mode it does not know included): "a rank
 *    meta whose mode this version does not know…" (`atMost` came back `atLeast`);
 *  - an import rank stamped `moved`, and a stamp that keeps only the 13 known overrides keys: "a key this
 *    version does not know…" (each alone);
 *  - max HP's baseline taken under a live Con set, or under a Con attribute.add (each alone): "a max-HP set
 *    beside a live Con tweak…" (baseline 78 / 68 stored).
 */

vi.mock('../src/sheet/download', () => ({
  downloadText: vi.fn(async () => 'saved'),
  fileSlug: (s: string) => s.replace(/\W+/g, '-').toLowerCase(),
}));

const { Builder } = await import('../src/builder/Builder');
const { GmEditSheet } = await import('../src/sheet/GmEditSheet');
const { buildCharacter, emptyBuild } = await import('../src/rules/build');
const { openForTweaks, stampTweaksSave } = await import('../src/rules/blocks/save');
const { tweaksSwitchOn } = await import('../src/rules/blocks/stored');
const { setTweaksSwitch } = await import('../src/rules/blocks/write');
const { deriveMaxHp, deriveSkill } = await import('../src/rules/derive');
const { initialPlay } = await import('../src/rules/play');
const { downloadText } = await import('../src/sheet/download');
import type { BuildState } from '../src/rules/build';
import type { SavedChar } from '../src/data/storage';
import type { BuildOverrides, ContentDatabase, TweakMeta } from '../src/rules/types';

const db = content();

/** The SAMPLE overrides (test/overrides-write.test.tsx, frozen old shape: no mode / source / moved, no `v`). */
const SAMPLE: BuildOverrides = {
  allowedFeats: ['toughness'],
  addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }],
  addedFeatures: [{ featureId: 'shield-block', level: 1 }],
  removedFeatIds: ['shield-block'],
  attributes: { dex: 8 },
  proficiencies: { athletics: 'expert' },
  addedLanguages: ['draconic'],
  addedSpells: [{ spellId: 'shield', rank: 0 }],
  maxHp: 30,
  contentEdits: { feats: { toughness: { name: 'Tougher' } } },
  blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1 }],
  meta: { 'proficiencies:athletics': { reason: 'Guild training', of: 'expert' } },
} as BuildOverrides;

function fighter(overrides?: BuildOverrides, more: Partial<BuildState> = {}): BuildState {
  const b = {
    ...emptyBuild(),
    name: 'Stamp fixture',
    level: 5,
    classId: 'fighter',
    keyAbility: 'str',
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    subclassId: (db.classes.fighter.subclass?.options[0]?.id as string) ?? null,
    levelBoosts: ['str', 'dex', 'con', 'wis'],
    skillIncreases: { 3: 'athletics', 5: 'thievery' },
    ...more,
    ...(overrides ? { overrides } : {}),
  } as BuildState;
  // As the roster holds it: read back through JSON.
  return JSON.parse(JSON.stringify(b)) as BuildState;
}

/** The old hidden-card character: `overridesEnabled: false` stored, no `v` (it always counted). */
const HIDDEN_CARD = (): BuildState =>
  fighter({ proficiencies: { thievery: 'trained', fortitude: 'trained', perception: 'trained' } } as BuildOverrides, { options: { overridesEnabled: false } } as Partial<BuildState>);

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
const confirmTitle = () => confirmBox()?.querySelector('.picker-head')?.textContent?.trim() ?? null;
const buttonIn = (root: ParentNode | null, label: string) =>
  [...(root?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement | undefined;
async function press(b: Element | null | undefined) {
  if (!b) throw new Error('no such button');
  await act(async () => {
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

function openBuilder(initial?: BuildState, host: ContentDatabase = db) {
  const created: BuildState[] = [];
  let cancelled = 0;
  const r = renderDom(createElement(Builder, { content: host, initial, onCancel: () => void (cancelled += 1), onCreate: (b: BuildState) => void created.push(b) }));
  cleanups.push(r.stop);
  return { r, created, cancelled: () => cancelled };
}

/** Press Save and answer every "choices left" question with "Save anyway"; the titles of every question
 *  asked are returned. */
async function save(r: { host: HTMLElement }): Promise<string[]> {
  const asked: string[] = [];
  await press(r.host.querySelector('button.b-create'));
  for (let i = 0; i < 4 && confirmBox(); i++) {
    asked.push(confirmTitle() ?? '');
    await press(buttonIn(confirmBox(), 'Save anyway'));
  }
  return asked;
}

const json = (x: unknown) => JSON.stringify(x);
const OLD_KEYS = ['allowedFeats', 'addedFeats', 'addedFeatures', 'removedFeatIds', 'attributes', 'proficiencies', 'addedLanguages', 'addedSpells', 'maxHp', 'contentEdits', 'blocks'] as const;

/* ─────────────────────────────── the open stamp ─────────────────────────────── */

describe('the Builder-open stamp (B4)', () => {
  it('opening the Builder stamps v: 2, the switch, and each old entry\'s mode, of, moved and baseline into the draft only', async () => {
    const initial = fighter(SAMPLE);
    const before = json(initial);
    const sheet = buildCharacter(initial, db);
    const draft = openForTweaks(initial, db);
    expect(json(initial), 'the stored build is never touched').toBe(before);
    expect(draft).not.toBe(initial);
    expect(draft.overrides!.v).toBe(2);
    expect(draft.options?.overridesEnabled).toBe(true);

    const meta = draft.overrides!.meta as Record<string, TweakMeta>;
    // A rank: THE sort the sheet used, the old reason kept (its meta matched).
    expect(sheet.tweakRankSort?.athletics, 'fixture: the sheet sorts the old Athletics entry').toMatch(/^(atLeast|exactly)$/);
    expect(meta['proficiencies:athletics']).toEqual({ reason: 'Guild training', of: 'expert', mode: sheet.tweakRankSort!.athletics, moved: true });
    // The sets: the book number they replaced.
    const noDex = buildCharacter(fighter({ ...SAMPLE, attributes: undefined } as BuildOverrides), db);
    expect(meta['attributes:dex']).toEqual({ of: '8', moved: true, baseline: noDex.abilities.dex });
    expect(noDex.abilities.dex, 'fixture: the set really replaces another score').not.toBe(8);
    const noSet = fighter({ ...SAMPLE, maxHp: undefined } as BuildOverrides);
    const bookHp = deriveMaxHp(buildCharacter(noSet, db), db);
    expect(meta['maxHp:max-hp']).toEqual({ of: '30', moved: true, baseline: bookHp });
    expect(bookHp, 'fixture: the set really replaces another maximum').not.toBe(30);
    // Every other old entry: of + moved, nothing else.
    for (const k of ['addedFeats:toughness@1', 'addedFeatures:shield-block@1', 'removedFeatIds:shield-block', 'allowedFeats:toughness', 'addedLanguages:draconic', 'addedSpells:shield@0', 'contentEdits:feats/toughness'])
      expect(Object.keys(meta[k] ?? {}).sort(), k).toEqual(['moved', 'of']);
    // A stored block is not an old entry: no meta for it.
    expect(Object.keys(meta).some((k) => k.startsWith('blocks') || k.includes('t1'))).toBe(false);

    // …and the Builder holds that draft without storing it: Cancel leaves at once, nothing created.
    const b = openBuilder(initial);
    await press(b.r.host.querySelector('.builder-head .b-cancel'));
    expect(confirmBox(), 'Cancel asks nothing').toBeNull();
    expect(b.cancelled()).toBe(1);
    expect(b.created).toEqual([]);
    expect(json(initial)).toBe(before);

    // The draft IS the stamped one: the hidden-card character (overridesEnabled: false stored, no v) shows the
    // Options switch ON in the Builder, as its tweaks read — and its stored build is still untouched.
    const hidden = HIDDEN_CARD();
    const hiddenBefore = json(hidden);
    const h = openBuilder(hidden);
    const setup = [...h.r.host.querySelectorAll('.lstrip button')].find((x) => (x.textContent ?? '').trim() === 'Setup');
    await press(setup);
    expect(h.r.host.querySelector('button.ovr-opt')?.classList.contains('on'), 'the draft carries the stamped switch').toBe(true);
    expect(json(hidden)).toBe(hiddenBefore);
  }, 120_000);

  // "Opening the Builder moves no number" (every overrides character of the parity snapshot, both gates) is
  // test/tweaks-save-stamp-numbers.test.ts: the snapshot instrument runs in the node environment only (its
  // `fileURLToPath(new URL(…))` refuses jsdom's URL).

  it.each([
    ['SAMPLE', () => fighter(SAMPLE)],
    ['the hidden-card character (overridesEnabled: false stored, v absent)', HIDDEN_CARD],
  ])('ON by read before the first save; the stored switch is obeyed after it — %s', (_name, make) => {
    const initial = make();
    expect(initial.overrides!.v, 'fixture: never saved by a Tweaks-aware app').toBeUndefined();
    expect(tweaksSwitchOn(initial), 'an old character reads ON').toBe(true);
    const draft = openForTweaks(initial, db);
    expect(draft.overrides!.v).toBe(2);
    expect(draft.options?.overridesEnabled, 'stamped as it read: ON').toBe(true);
    expect(tweaksSwitchOn(draft)).toBe(true);
    // From now on the stored switch is the authority.
    const off = { ...draft, ...setTweaksSwitch(draft, false) } as BuildState;
    expect(tweaksSwitchOn(off)).toBe(false);
    // …and a re-stamp never turns it back on.
    expect(stampTweaksSave(off, db)).toBe(off);
    expect(tweaksSwitchOn(stampTweaksSave(off, db))).toBe(false);
  });
});

/* ─────────────────────────────── Save ─────────────────────────────── */

describe('Save stores the stamp (stampTweaksSave in submit)', () => {
  it('Save writes v: 2 and overridesEnabled together; Cancel writes nothing and asks nothing', async () => {
    const initial = fighter(SAMPLE);
    const before = json(initial);
    const a = openBuilder(initial);
    await save(a.r);
    expect(a.created.length, 'onCreate fired once').toBe(1);
    const saved = a.created[0];
    expect(saved.overrides!.v).toBe(2);
    expect(saved.options?.overridesEnabled).toBe(true);
    expect(saved.overrides).toEqual(openForTweaks(initial, db).overrides);
    expect(json(initial)).toBe(before);

    const b = openBuilder(fighter(SAMPLE));
    await press(b.r.host.querySelector('.builder-head .b-cancel'));
    expect(confirmBox(), 'Cancel asks nothing').toBeNull();
    expect(b.cancelled()).toBe(1);
    expect(b.created).toEqual([]);
  }, 120_000);

  it('the first Save of SAMPLE changes no old key: every old key byte-equal (the raw lore: key stays raw); only v and meta added', async () => {
    // SAMPLE plus a RAW Lore key (`lore:Sailing Lore`, the old card's form): spec 1, older apps read these keys.
    const ov = { ...SAMPLE, proficiencies: { athletics: 'expert', 'lore:Sailing Lore': 'trained' } } as BuildOverrides;
    const initial = fighter(ov);
    const a = openBuilder(initial);
    await save(a.r);
    expect(a.created.length).toBe(1);
    const saved = a.created[0].overrides as Record<string, unknown>;
    for (const k of OLD_KEYS) expect(json(saved[k]), k).toBe(json((ov as Record<string, unknown>)[k]));
    expect(Object.keys(saved.proficiencies as object)).toEqual(['athletics', 'lore:Sailing Lore']);
    expect(Object.keys(saved).sort()).toEqual([...OLD_KEYS, 'meta', 'v'].sort());
    // The old meta key is kept, extended — never dropped.
    expect((saved.meta as Record<string, TweakMeta>)['proficiencies:athletics']).toMatchObject({ reason: 'Guild training', of: 'expert', moved: true });
    expect((saved.meta as Record<string, TweakMeta>)['proficiencies:lore:Sailing Lore']).toMatchObject({ of: 'trained', moved: true, mode: 'atLeast' });
    // Nothing else of the build moved but the switch.
    const { overrides: _o, options: o1, ...restSaved } = a.created[0];
    const { overrides: _i, options: o0, ...restInitial } = initial;
    expect(restSaved).toEqual(restInitial);
    expect({ ...(o1 ?? {}), overridesEnabled: undefined }).toEqual({ ...(o0 ?? {}), overridesEnabled: undefined });
  }, 120_000);

  it('a stale meta keeps its reason through the open stamp; its on, from, source and baseline do not come back (opening moves no number)', () => {
    // An older app re-valued both entries (Dex 12 → 8, Athletics master → expert): the meta was written for
    // the old values, so the reader ignores it today — the entries are ON, from level 1, not imported.
    const stale: BuildOverrides = {
      attributes: { dex: 8 },
      proficiencies: { athletics: 'expert' },
      meta: {
        'attributes:dex': { reason: 'Old wound', of: '12', on: false, from: 3, source: 'import', baseline: 99, moved: true },
        'proficiencies:athletics': { reason: 'Old guild', of: 'master', on: false, from: 4, mode: 'exactly' },
      },
    } as BuildOverrides;
    const initial = fighter(stale);
    const draft = openForTweaks(initial, db);
    const meta = draft.overrides!.meta as Record<string, TweakMeta>;
    const noDex = buildCharacter(fighter({ proficiencies: { athletics: 'expert' } } as BuildOverrides), db);
    expect(meta['attributes:dex']).toEqual({ reason: 'Old wound', of: '8', moved: true, baseline: noDex.abilities.dex });
    const sort = buildCharacter(initial, db).tweakRankSort;
    expect(sort?.athletics, 'fixture: the stale rank entry is sorted on read').toMatch(/^(atLeast|exactly)$/);
    expect(meta['proficiencies:athletics']).toEqual({ reason: 'Old guild', of: 'expert', moved: true, mode: sort!.athletics });

    const sheet = (b: BuildState): Record<string, unknown> => {
      const c = buildCharacter(b, db);
      const ath = deriveSkill(c, 'athletics', db);
      return { abilities: c.abilities, athletics: [ath.modifier, ath.rank], hp: deriveMaxHp(c, db) };
    };
    expect(sheet(draft)).toEqual(sheet(initial));
    expect(buildCharacter(initial, db).abilities.dex, 'fixture: the stale "paused" is really ignored today').toBe(8);
  }, 60_000);

  it('a second Save of a stamped build writes nothing more', async () => {
    const once = openForTweaks(fighter(SAMPLE), db);
    expect(stampTweaksSave(once, db)).toBe(once);
    expect(openForTweaks(once, db)).toBe(once);
    // …except an entry an un-routed writer added since the open stamp (the old card writes no meta): only it.
    const added = { ...once, overrides: { ...once.overrides, addedLanguages: ['draconic', 'elven'] } } as BuildState;
    const saved2 = stampTweaksSave(added, db);
    const m2 = saved2.overrides!.meta as Record<string, TweakMeta>;
    expect(m2['addedLanguages:elven']).toEqual({ of: 'elven', moved: true });
    expect({ ...m2, 'addedLanguages:elven': undefined }).toEqual({ ...(once.overrides!.meta as object), 'addedLanguages:elven': undefined });
    // The Builder's Save runs it on what it hands over (its source line is the pin: App/GM hosts store that).
    const src = (await import('node:fs')).readFileSync(`${__dirname}/../src/builder/Builder.tsx`, 'utf8');
    // skill-order WP9 (plan 3.3, D13): Save now also stamps `skillOrder` on the Tweaks-stamped build, and the open
    // runs openForSkillOrder after openForTweaks; the pins follow the new shape, same meaning.
    expect(src).toMatch(/const stamped = stampTweaksSave\(build, baseContent\);\s*onCreate\(skillOrderNotice \? stampSkillOrderSave\(stamped, baseContent\) : stamped\);/);
    expect(src).toMatch(/useUndoableState<BuildState>\(\s*[\s\S]{0,700}?if \(!initial\) return emptyBuild\(\);\s*const opened = openForTweaks\(initial, baseContent\);/);
    // Through the Builder: the stored (stamped) build comes back byte-equal.
    const stored = JSON.parse(JSON.stringify(once)) as BuildState;
    const a = openBuilder(stored);
    await save(a.r);
    expect(a.created.length).toBe(1);
    expect(json(a.created[0].overrides)).toBe(json(stored.overrides));
    expect(a.created[0].options).toEqual(stored.options);
  }, 120_000);

  it('a character with no overrides gets no overrides object', async () => {
    const plain = fighter();
    expect(plain.overrides).toBeUndefined();
    expect(openForTweaks(plain, db)).toBe(plain);
    expect(stampTweaksSave(plain, db)).toBe(plain);
    // An empty shell (B15) is no tweak either: nothing stamped.
    const shell = fighter({ attributes: {}, addedFeats: [], meta: {} } as BuildOverrides);
    expect(openForTweaks(shell, db)).toBe(shell);
    const a = openBuilder(plain);
    await save(a.r);
    expect(a.created.length).toBe(1);
    expect('overrides' in a.created[0] ? a.created[0].overrides : undefined).toBeUndefined();
    expect(a.created[0].options).toEqual(plain.options);
  }, 120_000);

  it('the GM\'s Builder stamps the same way, and only on Save', async () => {
    const build = fighter(SAMPLE);
    const character = buildCharacter(build, db);
    const sheet: SavedChar = { id: 'pc-stamp', character, build, play: initialPlay(character, db) } as SavedChar;
    const exported: string[] = [];
    vi.mocked(downloadText).mockImplementation(async (a: { text: string }) => {
      exported.push(a.text);
      return 'saved';
    });
    const r = renderDom(
      createElement(GmEditSheet, { initial: sheet, live: sheet, content: db, campaignId: 'camp-test', playerOwnerId: 'player-test', onExit: () => undefined }),
    );
    cleanups.push(r.stop);
    const byLabel = (l: string) => document.querySelector(`button[aria-label="${l}"]`);
    const exportBuild = async (): Promise<BuildState> => {
      await press(byLabel('Export character file'));
      return JSON.parse(exported[exported.length - 1]).build as BuildState;
    };
    // Opening and leaving the GM's Builder stores nothing (never on openBuilder, never in a view).
    await press(byLabel('Edit in builder'));
    expect(document.querySelector('.builder-head'), 'the GM\'s Builder is open').not.toBeNull();
    await press(document.querySelector('.builder-head .b-cancel'));
    expect(confirmBox(), 'Cancel asks nothing').toBeNull();
    const afterCancel = await exportBuild();
    expect(json(afterCancel.overrides)).toBe(json(build.overrides));
    expect(afterCancel.overrides?.v).toBeUndefined();
    // Save stamps it, exactly as the player's Builder does.
    await press(byLabel('Edit in builder'));
    await save({ host: document.body });
    expect(document.querySelector('.builder-head'), 'back on the GM\'s sheet').toBeNull();
    const afterSave = await exportBuild();
    expect(afterSave.overrides).toEqual(openForTweaks(build, db).overrides);
    expect(afterSave.overrides?.v).toBe(2);
    expect(afterSave.options?.overridesEnabled).toBe(true);
  }, 180_000);

  it('stampTweaksSave / openForTweaks keep v: 3 (B27): a newer app\'s v is never lowered', () => {
    // A newer app saved this: v 3, its switch stored as the authority (off here), plus an old entry it left.
    const newer = fighter({ ...SAMPLE, v: 3 } as BuildOverrides, { options: { overridesEnabled: false } } as Partial<BuildState>);
    for (const f of [openForTweaks, stampTweaksSave]) {
      const out = f(newer, db);
      expect(out.overrides!.v, f.name).toBe(3);
      expect(out.options?.overridesEnabled, `${f.name}: the stored switch is the authority`).toBe(false);
      expect((out.overrides!.meta as Record<string, TweakMeta>)['attributes:dex'], f.name).toMatchObject({ of: '8', moved: true });
    }
    // A stamped v: 3 build re-stamps to itself.
    const once = openForTweaks(newer, db);
    expect(stampTweaksSave(once, db)).toBe(once);
    // A meta a newer app wrote as something other than a map is kept as it is; nothing is stamped into it.
    const odd = fighter({ attributes: { dex: 8 }, meta: 'opaque' } as unknown as BuildOverrides);
    const s = openForTweaks(odd, db);
    expect(s.overrides!.meta).toBe('opaque');
    expect(s.overrides!.v).toBe(2);
  });
});

/* ─────────────────────── UNKNOWN ≠ EMPTY, and the numbers the stamp may not store ─────────────────────── */

describe('what the stamp keeps as it is (checker findings, WP4 fix round)', () => {
  it('a rank meta whose mode this version does not know is never rewritten (a newer app\'s "atMost"), at open or at Save', () => {
    // A newer app saved this: v 3, a rank kind this app has no name for, and one old entry it left unstamped
    // (the Dex set, so the stamp really runs and returns a new build).
    const unknownMode = { of: 'trained', mode: 'atMost', reason: 'newer app' };
    const newer = fighter({ v: 3, proficiencies: { athletics: 'trained' }, attributes: { dex: 8 }, meta: { 'proficiencies:athletics': unknownMode } } as unknown as BuildOverrides);
    for (const f of [openForTweaks, stampTweaksSave]) {
      const out = f(newer, db);
      expect(out, `${f.name}: the Dex entry is stamped, so the stamp ran`).not.toBe(newer);
      const meta = out.overrides!.meta as Record<string, unknown>;
      expect(json(meta['proficiencies:athletics']), `${f.name}: the newer app's meta, byte-equal`).toBe(json(unknownMode));
      expect(meta['attributes:dex'], f.name).toMatchObject({ of: '8', moved: true });
      expect(out.overrides!.v, f.name).toBe(3);
    }
    // The Save after the open stamps nothing more over it.
    const once = openForTweaks(newer, db);
    expect(stampTweaksSave(once, db)).toBe(once);
  }, 60_000);

  it('a key this version does not know and a newer-version block come through byte-equal; an import-stamped rank gets its mode and never `moved`', () => {
    const ov = {
      proficiencies: { athletics: 'expert' },
      meta: { 'proficiencies:athletics': { of: 'expert', source: 'import' } },
      futureKey: { x: 1 },
      blocks: [{ id: 't9', kind: 'future.kind', v: 9 }],
    } as unknown as BuildOverrides;
    const initial = fighter(ov);
    const sort = buildCharacter(initial, db).tweakRankSort;
    expect(sort?.athletics, 'fixture: the import rank is sorted on read').toMatch(/^(atLeast|exactly)$/);
    for (const f of [openForTweaks, stampTweaksSave]) {
      const out = f(initial, db).overrides as Record<string, unknown>;
      expect(json(out.futureKey), `${f.name}: a key this version does not know`).toBe(json({ x: 1 }));
      expect(json(out.blocks), `${f.name}: a block a newer version wrote`).toBe(json((ov as Record<string, unknown>).blocks));
      expect(Object.keys(out).sort(), f.name).toEqual(['blocks', 'futureKey', 'meta', 'proficiencies', 'v']);
      // Plan 3.3 step 4: an import's rank is frozen like any other, but it was never moved from Overrides.
      expect((out.meta as Record<string, TweakMeta>)['proficiencies:athletics'], f.name).toEqual({ of: 'expert', source: 'import', mode: sort!.athletics });
    }
  }, 60_000);

  it('a max-HP set beside a live Con tweak stores no baseline (its book line would carry the tweak); the Con set keeps its own', () => {
    const ov = { attributes: { con: 18 }, maxHp: 60 } as BuildOverrides;
    const meta = openForTweaks(fighter(ov), db).overrides!.meta as Record<string, TweakMeta>;
    expect(meta['maxHp:max-hp']).toEqual({ of: '60', moved: true });
    const noCon = buildCharacter(fighter({ maxHp: 60 } as BuildOverrides), db);
    expect(noCon.abilities.con, 'fixture: the set really moves Con').not.toBe(18);
    expect(meta['attributes:con']).toEqual({ of: '18', moved: true, baseline: noCon.abilities.con });
    // A Con +2 block (attribute.add) is inside the base line too.
    const added = fighter({ maxHp: 60, blocks: [{ id: 'c2', kind: 'attribute.add', v: 1, target: 'score:con', value: 2 }] } as BuildOverrides);
    expect((openForTweaks(added, db).overrides!.meta as Record<string, TweakMeta>)['maxHp:max-hp']).toEqual({ of: '60', moved: true });
    // A PAUSED Con set is no tweak on the sheet: the baseline is the book maximum again.
    const paused = fighter({ ...ov, meta: { 'attributes:con': { of: '18', on: false } } } as BuildOverrides);
    const pm = openForTweaks(paused, db).overrides!.meta as Record<string, TweakMeta>;
    expect(pm['maxHp:max-hp']).toEqual({ of: '60', moved: true, baseline: deriveMaxHp(buildCharacter(fighter(), db), db) });
    expect(pm['attributes:con'], 'the paused set\'s own meta is left as stored').toEqual({ of: '18', on: false });
  }, 60_000);
});

/* ─────────────────────────────── WP10 fix round 1 ─────────────────────────────── */

/**
 * THE BROWSER TEST'S MAJOR FAILURE (work/tweaks-part-b-notes/browser-report.md, steps 9 / 14 / 16): a feat given
 * on the Tweaks page WITHOUT a reason was saved as `meta { of, moved: true }` and shown "Moved from Overrides" —
 * on a cleric that never had Overrides too. The write door dropped a meta holding only `of` (`compactMeta`), so
 * the new entry had NO meta, and the Save stamp marks every entry without meta as an old moved one (plan 3.3
 * step 3). The same held for a language, spell, removal, "take anyway", text edit, set score and max-HP set added
 * without a reason, for a moved entry's first edit (B11: the next Save stamped it moved again) and for a resumed
 * pause. MUTATION PROOF (wp10-fix-report.md): `compactMeta` back on "nothing when only `of` is left" turns both
 * it()s red.
 */
describe('a tweak made on the page is never "Moved from Overrides" (WP10 fix round 1)', () => {
  const on = { options: { overridesEnabled: true } } as Partial<BuildState>;
  const movedKeys = (b: BuildState) =>
    Object.entries((b.overrides?.meta ?? {}) as Record<string, TweakMeta>)
      .filter(([, m]) => m.moved)
      .map(([k]) => k);

  it('every old-key kind added without a reason, a moved entry\'s first edit and a pause / resume: the Save stamp marks none of them moved', async () => {
    const { writeTweak } = await import('../src/rules/blocks/write');
    const { readTweaks } = await import('../src/rules/blocks/stored');
    const drafts = [
      { kind: 'grant.feat', record: 'fleet', level: 1, category: 'general' },
      { kind: 'grant.classFeature', record: 'reactive-strike', level: 1 },
      { kind: 'grant.language', record: 'draconic' },
      { kind: 'grant.spell', record: 'shield', spellRank: 0 },
      { kind: 'remove.feat', record: 'toughness' },
      { kind: 'choice.allowAnyway', record: 'fleet' },
      { kind: 'text.edit', record: 'feats/toughness', text: { name: 'Tougher' } },
      { kind: 'attribute.set', target: 'score:dex', value: 16 },
      { kind: 'number.setMaxHp', target: 'max-hp', value: 40 },
      { kind: 'rank.atLeast', target: 'skill:stealth', rank: 'expert' },
    ] as const;
    let b = openForTweaks(fighter(undefined, on), db);
    for (const d of drafts) {
      const r = writeTweak(b, { op: 'add', draft: d as never });
      expect(r.refused, `${d.kind} refused`).toBeUndefined();
      b = { ...b, overrides: r.overrides };
    }
    // …and one of them paused and resumed.
    const fleetKey = readTweaks(b.overrides).instances.find((i) => i.key.startsWith('addedFeats:fleet'))!.key;
    for (const flag of [false, true]) b = { ...b, overrides: writeTweak(b, { op: 'setOn', key: fleetKey, on: flag }).overrides };
    expect(readTweaks(b.overrides).instances.length, 'fixture: every kind stored').toBe(drafts.length);
    const saved = stampTweaksSave(b, db);
    expect(movedKeys(saved)).toEqual([]);
    expect(readTweaks(saved.overrides).instances.filter((i) => i.moved).map((i) => i.key)).toEqual([]);

    // A MOVED entry's first edit makes it the player's own (B11), and the next Save leaves it so.
    const old = openForTweaks(fighter({ addedLanguages: ['draconic'], addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }] } as BuildOverrides), db);
    expect(movedKeys(old).sort(), 'fixture: the open stamp moved both').toEqual(['addedFeats:toughness@1', 'addedLanguages:draconic']);
    let e = { ...old, overrides: writeTweak(old, { op: 'update', key: 'addedFeats:toughness@1', draft: { level: 2 } }).overrides };
    e = { ...e, overrides: writeTweak(e, { op: 'repoint', key: 'addedLanguages:draconic', record: 'elven' }).overrides };
    expect(movedKeys(stampTweaksSave(e, db))).toEqual([]);
  }, 60_000);

  it('a feat, language and spell given on the Tweaks page without a reason are saved without "moved", on a character that never had Overrides', async () => {
    const { addEditor, openMenu, pick } = await import('./_tweaks-harness');
    const a = openBuilder(fighter(undefined, on));
    await press(a.r.host.querySelector('.builder-head button.b-tweaks'));
    for (const [menu, title, name] of [
      ['Give a feat', 'Feat', 'Fleet'],
      ['Add a language', 'Language', 'Draconic'],
      ['Add a spell', 'Spell', 'Fireball'],
    ] as const) {
      await openMenu(a.r.host, menu);
      await pick(addEditor(a.r.host)!, title, name);
      await press(addEditor(a.r.host)!.querySelector('button.tw-add-go'));
      expect(addEditor(a.r.host), `${menu}: Add closes the editor`).toBeNull();
    }
    expect(a.r.host.querySelector('.tw-chip-moved'), 'nothing reads "Moved from Overrides" before the Save').toBeNull();
    await save(a.r);
    expect(a.created.length).toBe(1);
    const stored = a.created[0];
    const meta = (stored.overrides?.meta ?? {}) as Record<string, TweakMeta>;
    expect(Object.keys(meta).sort(), 'each one keeps its own { of }').toEqual(['addedFeats:fleet@1', 'addedLanguages:draconic', 'addedSpells:fireball@3']);
    expect(movedKeys(stored)).toEqual([]);
    // Opened again (the next session): still nothing moved, and no row says so.
    const again = openBuilder(JSON.parse(JSON.stringify(stored)) as BuildState);
    await press(again.r.host.querySelector('.builder-head button.b-tweaks'));
    expect(again.r.host.querySelectorAll('li.tw-row').length, 'fixture: the three rows').toBe(3);
    expect(again.r.host.querySelector('.tw-chip-moved')).toBeNull();
  }, 120_000);
});
