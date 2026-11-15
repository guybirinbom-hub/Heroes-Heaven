// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import type { SavedChar } from '../src/data/storage';
import type { BuildState } from '../src/rules/build';
import type { BuildOverrides, Character } from '../src/rules/types';

/**
 * LOADING AN OLD CHARACTER IS NEVER AN EDIT (Tweaks part B, plan WP3; docs/overrides-redesign.md spec
 * item 2: "on load, before any save"; the standing rule "a player's change must never be overwritten by
 * the app"; work/tweaks-part-b-notes/plan.md decisions B3, B4, B27).
 *
 * Part B sorts an old character's rank entries ON READ (blocks/migrate.ts, build.ts `legacyRankSort`):
 * the sort is a DERIVED field (`Character.tweakRankSort`) and the stored overrides stay as they were — no
 * `mode` written into meta, no `v`, no `moved`, no new authoredKey, no timestamp, nothing pushed. The launch
 * path is measured end to end: the stored roster string → `parseRoster` → `rebuildRoster` →
 * `noteDerivedRefresh` → the persist's `noteRosterChange`, with a fake server that records every write.
 * The character carries the SAMPLE overrides of test/overrides-write.test.tsx (the old shape, frozen in
 * scripts/blocks-parity-snapshot.mjs) plus import leftovers (an import-stamped given feat) and old rank
 * entries the sort takes. Synthetic characters only.
 */

const server = vi.hoisted(() => ({ writes: [] as { table: string; row: unknown }[], editWrites: [] as unknown[] }));

vi.mock('../src/data/supabase', () => {
  function from(table: string) {
    const answer = () => ({ data: [], error: null });
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => Promise.resolve(answer()),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (ok: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(answer()).then(ok),
      upsert: (row: unknown) => {
        server.writes.push({ table, row });
        if (table === 'gm_character_edits') server.editWrites.push(row);
        return Promise.resolve({ error: null });
      },
      insert: (row: unknown) => {
        server.writes.push({ table, row });
        return Promise.resolve({ error: null });
      },
      update: (row: unknown) => {
        server.writes.push({ table, row });
        return q;
      },
      delete: () => q,
    };
    return q;
  }
  const channel = {
    on: () => channel,
    subscribe(cb?: (s: string) => void) {
      cb?.('SUBSCRIBED');
      return channel;
    },
  };
  return {
    supabase: {
      from,
      rpc: (name: string, args: unknown) => {
        server.writes.push({ table: `rpc:${name}`, row: args });
        return Promise.resolve({ data: null, error: null });
      },
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'player-1' } } } }),
        getUser: async () => ({ data: { user: { id: 'player-1' } } }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
    isCloudSyncEnabled: true,
    isCloudConfigured: true,
  };
});

const { buildCharacter, emptyBuild } = await import('../src/rules/build');
const { parseRoster, loadCharUpdated, saveCharUpdated } = await import('../src/data/storage');
const { rebuildRoster } = await import('../src/data/rebuild');
const { authoredKey } = await import('../src/data/authored');
const { noteDerivedRefresh, noteRosterChange } = await import('../src/data/cloudSync');
const { openForTweaks } = await import('../src/rules/blocks/save');

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

/** SAMPLE plus what an old character also holds: import leftovers and old rank entries the sort takes
 *  (case A — a later increase; case B — a lower rank; a raw Lore key — the Lore-row move). */
const OLD: BuildOverrides = {
  ...SAMPLE,
  addedFeats: [...(SAMPLE.addedFeats ?? []), { featId: 'fleet', level: 3, category: 'general' }],
  proficiencies: { athletics: 'expert', thievery: 'trained', fortitude: 'trained', 'lore:Sailing Lore': 'trained' },
  meta: { ...SAMPLE.meta, 'addedFeats:fleet@3': { source: 'import', of: 'fleet@3' } },
} as BuildOverrides;

const BUILD: BuildState = {
  ...emptyBuild(),
  name: 'Load fixture',
  level: 7,
  classId: 'fighter',
  keyAbility: 'str',
  ancestryId: 'human',
  backgroundId: 'acolyte',
  subclassId: (db.classes.fighter.subclass?.options[0]?.id as string) ?? null,
  levelBoosts: ['str', 'dex', 'con', 'wis'],
  skillIncreases: { 3: 'athletics', 5: 'thievery', 7: 'stealth' },
  overrides: OLD,
} as BuildState;

/** The roster as an older engine stored it: the derived cache it wrote (no `tweakRankSort` — that engine
 *  had none), the build and play the player authored, and a carried field (currency). */
function storedRosterString(build: BuildState = BUILD): string {
  const { tweakRankSort: _derivedLater, ...older } = buildCharacter(build, db) as Character & { tweakRankSort?: unknown };
  const sc = { id: 'old-1', build, character: { ...older, currency: { gp: 12 } }, play: { xp: 40 } } as unknown as SavedChar;
  return JSON.stringify([sc]);
}

/** One launch, as the app runs it, and everything a load could have written. */
function launch(raw: string, rebuild: (r: SavedChar[]) => SavedChar[] = (r) => rebuildRoster(r, db)) {
  const stored = parseRoster(raw);
  noteDerivedRefresh(stored); // the device's baseline: what the last persist left in storage
  const rebuilt = rebuild(stored);
  noteDerivedRefresh(rebuilt);
  noteRosterChange(rebuilt); // the persist that follows the launch rebuild
  vi.advanceTimersByTime(10_000); // any push the persist scheduled would fire now
  return { stored, rebuilt };
}

describe('tweaks: loading an old character is never an edit (plan WP3, spec item 2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    saveCharUpdated({ 'old-1': 1000 });
    server.writes.length = 0;
    server.editWrites.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('loading an old character with SAMPLE overrides and import leftovers changes no authoredKey, no build byte, stamps nothing and pushes nothing', () => {
    const raw = storedRosterString();
    const { stored, rebuilt } = launch(raw);
    // The baseline is the PARSED sheet: parseRoster's own normalising of play (defaults filled in) is older
    // than part B and has its own authored-key pairing (storage.ts `loadedAuthored`); the build it never touches.
    const before = stored[0];
    expect(JSON.stringify(before.build), 'parseRoster keeps the stored build byte for byte').toBe(JSON.stringify((JSON.parse(raw)[0] as SavedChar).build));
    const [sc] = rebuilt;
    // Premise: the read-time sort really ran on this load — the rebuild derived it, and it moves numbers.
    expect(sc.character.tweakRankSort, 'fixture: the old entries were sorted on read').toEqual({
      athletics: 'atLeast',
      thievery: 'atLeast',
      fortitude: 'exactly',
      'lore:Sailing Lore': 'atLeast',
    });
    expect(sc.character.proficiencies.skills.thievery, 'fixture: case A moved a number').toBe('expert');
    // …and wrote nothing the player authored.
    expect(JSON.stringify(sc.build), 'no build byte changed').toBe(JSON.stringify(before.build));
    expect(authoredKey(sc)).toBe(authoredKey(before));
    expect(sc.build?.overrides?.v, 'no Tweaks version stamped').toBeUndefined();
    expect(sc.build?.overrides?.meta, 'no mode / moved stamped into meta').toEqual(OLD.meta);
    expect(JSON.stringify(sc.character.overrides), 'the character carries the stored overrides, untouched').toBe(JSON.stringify(OLD));
    expect(sc.play).toEqual(before.play);
    expect(loadCharUpdated(), 'no "updated now" timestamp').toEqual({ 'old-1': 1000 });
    expect(server.editWrites, 'nothing pushed').toEqual([]);
    expect(server.writes, 'nothing written to the server at all').toEqual([]);
    // A second launch from what the first one persisted is the same again (the sort is never written back).
    const second = launch(JSON.stringify(rebuilt));
    expect(JSON.stringify(second.rebuilt[0].build)).toBe(JSON.stringify(before.build));
    expect(loadCharUpdated()).toEqual({ 'old-1': 1000 });
  });

  it('tweaks p2 WP1 (C36): a character holding every phase-2 kind — live, paused, newer and unreadable — loads and opens with no byte, authoredKey, stamp or push changed', () => {
    // tweaks p2 WP1: one block of every phase-2 choice kind (and every closed set's newer / unreadable keep), on
    // an old-shape character (no `v`) and on a Tweaks-on one. A load is never an edit, and no phase-2 kind is
    // stamped or written on load or on Builder open (plan C36). WP13: t3 (a skill increase taken anyway, WP12), t11 and
    // t12 ("Change an answer", "Edit a list") come after the record rebuild and read as a newer version's — kept the same.
    const P2_BLOCKS = [
      { id: 't2_a1b2', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'heritage', record: 'ancient-elf', reason: 'GM' },
      { id: 't3_a1b2', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'skillIncrease', record: 'stealth', rule: 'cap', level: 5, lane: 'main' },
      { id: 't4_a1b2', kind: 'choice.anyList', v: 1, record: 'toughness', rule: 'list', on: false },
      { id: 't5_a1b2', kind: 'choice.moreTakes', v: 1, record: 'fleet', times: 1 },
      { id: 't6_a1b2', kind: 'choice.addPlace', v: 1, place: 'feat', level: 4, category: 'general', n: 483920 },
      { id: 't7_a1b2', kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 5, skill: 'stealth' },
      { id: 't8_a1b2', kind: 'choice.addPlace', v: 1, place: 'boost', level: 5, attribute: 'dex' },
      { id: 't9_a1b2', kind: 'remove.choicePlace', v: 1, place: 'feat', level: 2, category: 'class', ordinal: 0 },
      { id: 't10_a1b2', kind: 'remove.choicePlace', v: 1, place: 'skillIncrease', level: 3, lane: 'main' },
      { id: 't11_a1b2', kind: 'choice.changeAnswer', v: 1, question: 'skillSlot', record: 'rogue-dedication', index: 0, value: 'lore:sailing' },
      { id: 't12_a1b2', kind: 'choice.editOptions', v: 1, question: 'choice', record: 'variable-core', add: ['fire'], remove: ['cold'] },
      { id: 't13_a1b2', kind: 'choice.addPlace', v: 1, place: 'cantrip', level: 3 }, // newer-version
      { id: 't14_a1b2', kind: 'choice.addPlace', v: 1, place: 'boost', level: 5, attribute: 'luck' }, // unreadable
    ];
    const featPicks = { ...BUILD.featPicks, '4:extrageneral:483920': 'toughness' };
    for (const [label, ov, options] of [
      ['an old-shape character (no v)', { ...OLD, blocks: [...(OLD.blocks ?? []), ...P2_BLOCKS] }, undefined],
      ['a Tweaks-on character (v: 2)', { v: 2, blocks: P2_BLOCKS }, { overridesEnabled: true }],
    ] as const) {
      const build = { ...BUILD, featPicks, overrides: ov as BuildOverrides, ...(options ? { options } : {}) } as BuildState;
      saveCharUpdated({ 'old-1': 1000 });
      server.writes.length = 0;
      server.editWrites.length = 0;
      const raw = storedRosterString(build);
      const { stored, rebuilt } = launch(raw);
      const before = stored[0];
      const [sc] = rebuilt;
      expect(JSON.stringify(sc.build), `${label}: no build byte changed`).toBe(JSON.stringify(before.build));
      expect(authoredKey(sc), `${label}: authoredKey`).toBe(authoredKey(before));
      expect(JSON.stringify(sc.build?.overrides?.blocks), `${label}: every block kept byte for byte, in order`).toBe(JSON.stringify(ov.blocks));
      expect(loadCharUpdated(), `${label}: no "updated now" timestamp`).toEqual({ 'old-1': 1000 });
      expect(server.editWrites, `${label}: nothing pushed`).toEqual([]);
      expect(server.writes, `${label}: nothing written to the server`).toEqual([]);
      // Builder open: the Tweaks-on draft is the build ITSELF (nothing to stamp); an old-shape draft gets the
      // phase-1 stamps only (v, the old entries' meta) and every phase-2 block rides along untouched.
      const opened = openForTweaks(sc.build!, db);
      if (options) expect(opened, `${label}: Builder open stamps nothing`).toBe(sc.build);
      expect(JSON.stringify(opened.overrides?.blocks), `${label}: Builder open writes no phase-2 block`).toBe(JSON.stringify(ov.blocks));
    }
  });

  it('mutation proof: a load that wrote v: 2 fails this test', () => {
    // The load the rule forbids: the rebuild also "upgrades" the stored overrides to the Tweaks version.
    const stampingLoad = (r: SavedChar[]) =>
      rebuildRoster(r, db).map((c) => (c.build ? { ...c, build: { ...c.build, overrides: { ...c.build.overrides, v: 2 } } } : c)) as SavedChar[];
    const raw = storedRosterString();
    const { stored, rebuilt } = launch(raw, stampingLoad);
    const before = stored[0];
    // Each of the first test's guards sees it: the build bytes and the authoredKey move…
    expect(JSON.stringify(rebuilt[0].build)).not.toBe(JSON.stringify(before.build));
    expect(authoredKey(rebuilt[0])).not.toBe(authoredKey(before));
    expect(rebuilt[0].build?.overrides?.v).toBe(2);
    // …while the timestamp alone would NOT have caught it (a derived refresh moves the baseline), which is
    // why the test reads the build and the authoredKey, not only the clock.
    expect(loadCharUpdated()).toEqual({ 'old-1': 1000 });
    // And a real edit after the load still stamps: the clock guard is live, not blind.
    noteRosterChange([{ ...rebuilt[0], play: { xp: 41 } } as unknown as SavedChar]);
    expect(loadCharUpdated()['old-1']).toBeGreaterThan(1000);
  });
});
