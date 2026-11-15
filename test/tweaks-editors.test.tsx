// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import {
  addEditor,
  buttonIn,
  chooserLabels,
  enter,
  focus,
  hero,
  leave,
  levelBox,
  mountTweaks,
  numberBox,
  openMenu,
  openRow,
  pick,
  press,
  pressedOption,
  rowBy,
  rows,
  settle,
  typeInto,
} from './_tweaks-harness';
import { emptyBuild } from '../src/rules/build';
import type { BlockInstance } from '../src/rules/blocks/registry';
import { extraCopiesHeld } from '../src/builder/tweaks/ChoiceEditor';
import { placeNotReached } from '../src/builder/tweaks/model';

/**
 * THE TWEAKS EDITORS (plan B WP7; work/tweaks-part-b-notes/plan.md section 1 "WP7", sections 4.5-4.6, open
 * points 1, 6, 8; docs/overrides-redesign.md decisions 9, 13, 22-24; gold-set R12).
 *
 * Every built kind is added through its own editor, read back with its `of`, paused, resumed and deleted
 * without a question; the record pickers offer feats of any level and ignore Sources; "Add a Lore" keys the
 * typed subject through loreKey and refuses a blank or a bare "Lore"; the rank editors open on "At least";
 * a Lore added here reaches the level-3 skill-increase picker; the attribute set shows the score without
 * attribute.add; a set stores the book number under it (`baselineFor`), and not while a tweak sits inside
 * that book number; "Give a feat" says when the feat changes a casting entry; editing a given feat's level
 * moves its meta; a broken feat is fixed with "Point to another"; a newer-version block survives an edit
 * beside it, the Save, the roster write and the cloud push byte for byte. Synthetic characters only.
 *
 * MUTATION PROOF (wp7-report.md, each on a temp copy): `baselineFor` without the WP7 guard → "a set stores
 * no baseline while a tweak sits inside its book number" fails; the Add editor's Lore refusal dropped →
 * "Add a Lore … refuses" fails; `castingNoteFor` returning null → the casting-note it() fails; the page's
 * open row not following a moved key → "editing a given feat's level moves its meta" fails. Fix round: the
 * Strength guard on a Str/Dex skill or on Speed dropped, or the skill-attribute swap guard dropped → "baselineFor
 * names no number…" fails (stealth 1, speed 20, medicine 7); the door keeping an emptied text edit → "a text
 * edit row keeps only what differs…" fails; the row's spell pick keeping the old rank → "pointing a given
 * spell's row…" fails.
 */

const server = vi.hoisted(() => ({ chars: new Map<string, Record<string, unknown>>() }));
vi.mock('../src/data/supabase', () => {
  function from(table: string) {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => Promise.resolve({ data: [], error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (ok: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
      upsert: (row: Record<string, unknown>) => {
        if (table === 'campaign_characters') server.chars.set(`${row.campaign_id as string}|${row.char_id as string}`, row);
        return Promise.resolve({ error: null });
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
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'player-tw' } } } }),
        getUser: async () => ({ data: { user: { id: 'player-tw' } } }),
        signOut: async () => ({ error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
      },
    },
    isCloudSyncEnabled: true,
    isCloudConfigured: true,
  };
});
vi.mock('../src/sheet/download', () => ({
  downloadText: vi.fn(async () => 'saved'),
  fileSlug: (s: string) => s.replace(/\W+/g, '-').toLowerCase(),
}));

const { Builder } = await import('../src/builder/Builder');
const { buildCharacter } = await import('../src/rules/build');
const { initialPlay } = await import('../src/rules/play');
const { readTweaks } = await import('../src/rules/blocks/stored');
const { baselineFor } = await import('../src/rules/blocks/baseline');
const { pinAddedIds, writeTweak, writeTweaks } = await import('../src/rules/blocks/write');
const { BLOCK_KINDS, blockKind } = await import('../src/rules/blocks/registry');
const { loreKey } = await import('../src/rules/loreKey');
const { enabledBookSet } = await import('../src/rules/sources');
const { carryStoredOverrides } = await import('../src/data/rebuild');
const { saveRoster, loadRoster } = await import('../src/data/storage');
const { publishCharacter } = await import('../src/data/party');
import type { BuildState } from '../src/rules/build';
import type { BuildOverrides, Character } from '../src/rules/types';
import type { SavedChar } from '../src/data/storage';
import type { PartySummary } from '../src/sheet/partySummary';

const db = content();
const FIGHTER = (ov?: BuildOverrides, more: Partial<BuildState> = {}) => hero(db, 'fighter', 5, ov, more);
const cleanups: (() => void)[] = [];
afterEach(async () => {
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
function mount(b: BuildState, opts?: Parameters<typeof mountTweaks>[2]) {
  const r = mountTweaks(db, b, opts);
  cleanups.push(r.stop);
  return r;
}
const confirmBox = () => document.querySelector('.confirm-modal');
const instOf = (ov: BuildOverrides | undefined, kind: string) => readTweaks(ov).instances.filter((i) => i.kind === kind);
const metaOf = (ov: BuildOverrides | undefined) => (ov?.meta ?? {}) as Record<string, Record<string, unknown>>;
const addButton = (host: ParentNode) => addEditor(host)?.querySelector<HTMLButtonElement>('button.tw-add-go') ?? null;
async function chooseOption(host: HTMLElement, label: string) {
  await press([...addEditor(host)!.querySelectorAll('.tw-chooser button.tw-opt')].find((b) => (b.textContent ?? '').trim() === label));
}

/* ─────────────────────────────── every built kind, through its editor ─────────────────────────────── */

/** Choose a target, then type a number. */
const targetAndNumber = (target: string, n: string) => async (h: HTMLElement) => {
  await pick(addEditor(h)!, 'What', target);
  await enter(numberBox(addEditor(h)!), n);
};
/** How a player adds one tweak of each kind: the menu, then the parts. */
const RECIPES: Record<string, { menu: string; fill: (host: HTMLElement) => Promise<void> }> = {
  'number.add': { menu: 'Bonus or penalty', fill: targetAndNumber('Athletics', '2') },
  'attribute.add': { menu: 'Bonus or penalty', fill: targetAndNumber('Strength score', '2') },
  'number.set': { menu: 'Set a number', fill: targetAndNumber('AC', '20') },
  'number.setMaxHp': { menu: 'Set a number', fill: targetAndNumber('Maximum HP', '30') },
  'number.atLeast': {
    menu: 'Set a number',
    fill: async (h) => {
      await pick(addEditor(h)!, 'What', 'AC');
      await chooseOption(h, 'At least');
      await enter(numberBox(addEditor(h)!), '25');
    },
  },
  'attribute.set': { menu: 'Set a number', fill: targetAndNumber('Dexterity score', '16') },
  'rank.atLeast': {
    menu: 'Rank (skill, save…)',
    fill: async (h) => {
      await pick(addEditor(h)!, 'What', 'Stealth');
      await pick(addEditor(h)!, 'Rank', 'Expert');
    },
  },
  'rank.exactly': {
    menu: 'Rank (skill, save…)',
    fill: async (h) => {
      await pick(addEditor(h)!, 'What', 'Stealth');
      await chooseOption(h, 'Exactly');
      await pick(addEditor(h)!, 'Rank', 'Expert');
    },
  },
  'grant.feat': { menu: 'Give a feat', fill: async (h) => pick(addEditor(h)!, 'Feat', 'Fleet') },
  'grant.language': { menu: 'Add a language', fill: async (h) => pick(addEditor(h)!, 'Language', 'Draconic') },
  'grant.spell': { menu: 'Add a spell', fill: async (h) => pick(addEditor(h)!, 'Spell', 'Fireball') },
  'grant.classFeature': { menu: 'Give a class feature', fill: async (h) => pick(addEditor(h)!, 'Class feature', 'Juggernaut') },
  // The fighter's acolyte background gives Student of the Canon.
  'remove.feat': { menu: 'Remove something', fill: async (h) => pick(addEditor(h)!, 'Feat', 'Student of the Canon') },
  'choice.allowAnyway': { menu: '"Take anyway" in a picker', fill: async (h) => pick(addEditor(h)!, 'Feat', 'Fleet') },
  // tweaks p2 WP4: the other pickers' Take anyway — a heritage of another ancestry on the human fighter.
  'choice.allowAnywayAnyPicker': {
    menu: '"Take anyway" in another picker',
    fill: async (h) => {
      await pick(addEditor(h)!, 'Picker', 'Heritage');
      await pick(addEditor(h)!, 'Heritage', 'Ancient Elf');
    },
  },
  // tweaks p2 WP5: the feat and the one rule it may break.
  'choice.anyList': {
    menu: 'Pick from any list',
    fill: async (h) => {
      await pick(addEditor(h)!, 'Feat', 'Toughness');
      await pick(addEditor(h)!, 'Rule', "The feat place's list");
    },
  },
  // tweaks p2 WP6: a printed feat slot this character's pages draw.
  'remove.choicePlace': {
    menu: 'Remove a place',
    fill: async (h) => {
      await pick(addEditor(h)!, 'Place', 'Level 4 · Class feat');
    },
  },
  // tweaks p2 WP7: an extra feat place — its level and its feat kind (the door draws its `n`).
  'choice.addPlace': {
    menu: 'Add a place',
    fill: async (h) => {
      await enter(addEditor(h)!.querySelector<HTMLInputElement>('input[aria-label="At level"]'), '4');
      await pick(addEditor(h)!, 'Feat kind', 'Class');
    },
  },
  // tweaks p2 WP8: the feat; the count starts at 1 more time (its floor: the copies used past the book, none here).
  'choice.moreTakes': {
    menu: 'Take a feat more times',
    fill: async (h) => {
      await pick(addEditor(h)!, 'Feat', 'Toughness');
    },
  },
  'text.edit': {
    menu: 'Change a description or name',
    fill: async (h) => {
      await pick(addEditor(h)!, 'Feat or class feature', 'Toughness');
      await enter(addEditor(h)!.querySelector('input[aria-label="Name"]'), 'Tougher');
    },
  },
};
const BUILT = BLOCK_KINDS.filter((k) => k.editor?.built).map((k) => k.id);

describe('every built kind, through its editor', () => {
  it('every built kind has a recipe here', () => {
    expect(BUILT.filter((k) => !RECIPES[k])).toEqual([]);
  });

  it.each(BUILT)('%s: added through its editor, read back with of, paused, resumed, deleted without a question', async (kind) => {
    const r = mount(FIGHTER());
    const recipe = RECIPES[kind];
    await openMenu(r.host, recipe.menu);
    await recipe.fill(r.host);
    await enter(addEditor(r.host)!.querySelector('input[aria-label="Reason"]'), 'Table ruling');
    expect(addEditor(r.host)!.querySelector('.tw-missing'), 'nothing missing').toBeNull();
    await press(addButton(r.host));
    expect(addEditor(r.host), 'Add closes the editor').toBeNull();
    const added = instOf(r.build().overrides, kind);
    expect(added.length, `one ${kind} stored`).toBe(1);
    const inst = added[0];
    // Read back with its reason; an old-key entry's meta carries `of` (open point 1); a block is its own record.
    expect(inst.reason).toBe('Table ruling');
    if (blockKind(kind)!.storage.in === 'legacy') expect(metaOf(r.build().overrides)[inst.key], `${inst.key}: its meta has its of`).toMatchObject({ reason: 'Table ruling', of: expect.any(String) });
    else expect(inst.key).toMatch(/^blocks:/);
    expect(inst.on).toBe(true);
    // The new tweak opens as its row.
    const row = openRow(r.host)!;
    expect(row?.dataset.key).toBe(inst.key);
    await press(row.querySelector('.tw-toggle'));
    expect(instOf(r.build().overrides, kind)[0].on, 'paused').toBe(false);
    await press(openRow(r.host)!.querySelector('.tw-toggle'));
    expect(instOf(r.build().overrides, kind)[0].on, 'resumed').toBe(true);
    await press(openRow(r.host)!.querySelector('button.tw-del'));
    expect(confirmBox(), 'no question').toBeNull();
    expect(instOf(r.build().overrides, kind)).toEqual([]);
  });
});

/* Tweaks phase 2 WP1 check, F5 (fixed after 2e53715; wp1-report.md "Check findings F1-F5"): when the page's
 * updater is handed a build newer than the one it rendered, it writes again — and the retry minted a NEW random
 * block id while the row the page opened was computed from the first try, so the open row named a block that was
 * never stored. The retry pins the first try's ids now (`pinAddedIds`). Failed on 2e53715's TweaksPage.tsx
 * (proved once, the plant removed). */
describe('a write retried on a newer build (F5)', () => {
  it('the row the page opens is the block that was stored, and the newer write is kept', async () => {
    const other = { id: 't9_zzzz', kind: 'number.add', v: 1, target: 'save:will', value: 1, reason: 'Other tab' };
    const r = mount(FIGHTER(), {
      newer: (b) => ({ ...b, overrides: { ...(b.overrides ?? {}), blocks: [...((b.overrides?.blocks as unknown[]) ?? []), other] } as BuildOverrides }),
    });
    await openMenu(r.host, 'Bonus or penalty');
    await targetAndNumber('Athletics', '2')(r.host);
    await press(addButton(r.host));
    const mine = instOf(r.build().overrides, 'number.add').filter((i) => i.target === 'skill:athletics');
    expect(mine, 'one Athletics bonus stored').toHaveLength(1);
    expect(instOf(r.build().overrides, 'number.add').map((i) => i.key), "the newer build's block is kept").toContain('blocks:t9_zzzz');
    expect(openRow(r.host)?.dataset.key, 'the open row is the stored block').toBe(mine[0].key);
  });

  it('pinAddedIds: a retry keeps the id the first try minted, unless the newer build already holds it', () => {
    const add = { op: 'add', draft: { kind: 'number.add', target: 'skill:athletics', value: 2 } } as const;
    const first = writeTweaks({ overrides: { v: 2 } }, [add]);
    const id = first.ids![0]!;
    expect(id).toMatch(/^t1_[0-9a-z]{4}$/);
    const newer = { overrides: { v: 2, blocks: [{ id: 't5_aaaa', kind: 'number.add', v: 1, target: 'ac', value: 1 }] } as BuildOverrides };
    const again = writeTweaks(newer, pinAddedIds([add], first));
    expect((again.overrides!.blocks as { id: string }[]).map((b) => b.id)).toEqual(['t5_aaaa', id]);
    const clash = { overrides: { v: 2, blocks: [{ id, kind: 'mystery', v: 9 }] } as BuildOverrides };
    const fresh = writeTweaks(clash, pinAddedIds([add], first));
    expect((fresh.overrides!.blocks as { id: string }[])[1].id).not.toBe(id);
    // a write that adds no block pins nothing
    expect(pinAddedIds([{ op: 'remove', key: 'blocks:t1' }], first)).toEqual([{ op: 'remove', key: 'blocks:t1' }]);
  });
});

/* ─────────────────────────────── the record pickers ─────────────────────────────── */

describe('the record pickers', () => {
  it('Give a feat offers feats of any level (problem 6)', async () => {
    const r = mount(hero(db, 'fighter', 1));
    expect(db.feats['true-perception']?.level).toBe(19);
    await openMenu(r.host, 'Give a feat');
    await pick(addEditor(r.host)!, 'Feat', 'True Perception');
    await press(addButton(r.host));
    expect(r.build().overrides?.addedFeats).toEqual([{ featId: 'true-perception', level: 1, category: 'general' }]);
  });

  it('the record pickers ignore Sources (gold-set R12, out of scope on purpose)', async () => {
    // A feat and a spell from books a default character (Core only) has switched off.
    const core = enabledBookSet(undefined);
    const unique = <T extends { name: string; source?: { book?: string } }>(list: T[]) =>
      list.find((x) => x.source?.book && !core.has(x.source.book) && list.filter((y) => y.name === x.name).length === 1)!;
    const feat = unique(Object.values(db.feats) as never[]) as unknown as { id: string; name: string };
    const spell = unique(Object.values(db.spells) as never[]) as unknown as { id: string; name: string };
    expect(feat && spell, 'fixture: an off-book feat and spell').toBeTruthy();
    const { host } = openBuilder(FIGHTER());
    await press(host.querySelector('.builder-head button.b-tweaks'));
    await openMenu(host, 'Give a feat');
    await pick(addEditor(host)!, 'Feat', feat.name);
    await press(addButton(host));
    await openMenu(host, 'Add a spell');
    await pick(addEditor(host)!, 'Spell', spell.name);
    await press(addButton(host));
    expect(rowBy(host, feat.name), 'the off-book feat is given').toBeDefined();
    expect(rows(host).some((x) => (x.querySelector('.tw-row-what')?.textContent ?? '').includes(spell.name)), 'the off-book spell is added').toBe(true);
  });

  it("an off-book feat given in this session asks its own question at once, and the Tweaks button's dot says so (WP10 final check, finding 1)", async () => {
    // Masterful Obfuscation: a Society Guide feat (off on a Core-only character) asking a build-time skill.
    // The Builder's Sources-filtered content kept only the ids chosen when it last ran, so a feat given
    // after the Builder opened was missing from it: no question, no dot, until Save and reopen.
    const f = db.feats['masterful-obfuscation'];
    expect(f?.choice?.kind, 'fixture: a build-time skill choice').toBe('skills');
    expect(enabledBookSet(undefined).has(f!.source!.book!), 'fixture: its book is off by default').toBe(false);
    const { host } = openBuilder(FIGHTER());
    await press(host.querySelector('.builder-head button.b-tweaks'));
    expect(host.querySelector('.builder-head button.b-tweaks.has-dot'), 'nothing owed before').toBeNull();
    await openMenu(host, 'Give a feat');
    await pick(addEditor(host)!, 'Feat', f!.name);
    await press(addButton(host));
    const qs = host.querySelector('[data-feat-questions="masterful-obfuscation"]');
    expect(qs, 'its questions render under its row').toBeTruthy();
    expect(qs!.querySelector('[data-ctl-title]'), 'with a control to answer').toBeTruthy();
    expect(host.querySelector('.builder-head button.b-tweaks.has-dot'), 'the Tweaks button says one needs a look').toBeTruthy();
  });

  it('a feat already given by a tweak is offered greyed, saying why', async () => {
    const r = mount(FIGHTER({ v: 2, addedFeats: [{ featId: 'fleet', level: 1, category: 'general' }] } as BuildOverrides));
    await openMenu(r.host, 'Give a feat');
    await press(addEditor(r.host)!.querySelector('[data-ctl-title="Feat"]'));
    const ov = document.querySelector('.picker-overlay')!;
    typeInto(ov.querySelector<HTMLInputElement>('input.name-input')!, 'Fleet');
    await settle();
    const row = [...ov.querySelectorAll('.pick-row')].find((x) => (x.querySelector('.picker-name')?.textContent ?? '').trim() === 'Fleet')!;
    expect(buttonIn(row, 'Select')!.disabled).toBe(true);
    expect(row.textContent).toContain('Already a tweak');
  });
});

/* ─────────────────────────────── Lores and ranks ─────────────────────────────── */

describe('Add a Lore and the rank editors (spec 5, 11)', () => {
  it("Add a Lore takes any subject, keys it by loreKey, refuses a blank or a bare 'Lore'", async () => {
    const r = mount(FIGHTER());
    let ed = await openMenu(r.host, 'Add a Lore');
    const subject = () => addEditor(r.host)!.querySelector<HTMLInputElement>('input[aria-label="Lore subject"]')!;
    expect(addButton(r.host)!.disabled, 'blank').toBe(true);
    expect(ed.querySelector('.tw-missing')?.textContent).toBe('Type a subject');
    typeInto(subject(), '   ');
    await settle();
    expect(addButton(r.host)!.disabled, 'spaces only').toBe(true);
    typeInto(subject(), 'Lore');
    await settle();
    expect(addEditor(r.host)!.querySelector('[data-part="target"] .tw-part-note.refusal')?.textContent?.trim()).toBe("Name the subject, not just 'Lore'");
    expect(addButton(r.host)!.disabled).toBe(true);
    typeInto(subject(), 'Underwater Basket Weaving');
    await settle();
    expect(addButton(r.host)!.disabled).toBe(false);
    await press(addButton(r.host));
    const key = loreKey('Underwater Basket Weaving')!;
    expect(key).toBe('lore:underwater-basket-weaving');
    expect(r.build().overrides?.proficiencies).toEqual({ [key]: 'trained' });
    expect(metaOf(r.build().overrides)[`proficiencies:${key}`]).toMatchObject({ mode: 'atLeast', of: 'trained' });
    // The same subject again, spelled another way: its row already holds a rank tweak.
    ed = await openMenu(r.host, 'Add a Lore');
    typeInto(subject(), 'underwater basket weaving lore');
    await settle();
    expect(addEditor(r.host)!.querySelector('[data-part="target"] .tw-part-note.refusal')?.textContent?.trim()).toBe('Already has a rank tweak — open it in the list');
    expect(addButton(r.host)!.disabled).toBe(true);
    void ed;
  });

  it('Add a Lore offers At least and Exactly; Exactly stores an exact hold', async () => {
    const r = mount(FIGHTER());
    const ed = await openMenu(r.host, 'Add a Lore');
    expect(chooserLabels(ed)).toEqual(['At least', 'Exactly']);
    typeInto(ed.querySelector<HTMLInputElement>('input[aria-label="Lore subject"]')!, 'Sailing');
    await settle();
    await chooseOption(r.host, 'Exactly');
    await pick(addEditor(r.host)!, 'Rank', 'Master');
    await press(addButton(r.host));
    expect(r.build().overrides?.proficiencies).toEqual({ 'lore:sailing': 'master' });
    expect(metaOf(r.build().overrides)['proficiencies:lore:sailing']).toMatchObject({ mode: 'exactly' });
  });

  it('the Rank editor opens on At least', async () => {
    const r = mount(FIGHTER());
    const ed = await openMenu(r.host, 'Rank (skill, save…)');
    await pick(ed, 'What', 'Stealth');
    expect(pressedOption(addEditor(r.host)!)).toBe('At least');
    await press(addButton(r.host));
    expect(r.build().overrides?.proficiencies).toEqual({ stealth: 'trained' });
    expect(metaOf(r.build().overrides)['proficiencies:stealth']).toMatchObject({ mode: 'atLeast' });
  });

  it('a Lore added in Tweaks is offered by the level-3 skill-increase picker (spec 11)', async () => {
    const { host } = openBuilder(hero(db, 'fighter', 3));
    await press(host.querySelector('.builder-head button.b-tweaks'));
    const ed = await openMenu(host, 'Add a Lore');
    typeInto(ed.querySelector<HTMLInputElement>('input[aria-label="Lore subject"]')!, 'Sailing');
    await settle();
    await press(addButton(host));
    await press([...host.querySelectorAll('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '3'));
    const ctl = host.querySelector('[data-ctl-title="Skill increase"]');
    expect(ctl, 'the level-3 skill increase').toBeTruthy();
    await press(ctl!.querySelector('.ss-replace') ?? ctl);
    const names = [...document.querySelectorAll('.picker-overlay .picker-item .picker-name')].map((n) => (n.textContent ?? '').trim());
    expect(names.some((n) => n.startsWith('Sailing Lore')), `offered: ${names.join(', ')}`).toBe(true);
  });
});

/* ─────────────────────────────── numbers: the book under a set ─────────────────────────────── */

describe('sets and the book number (decision 9, open point 6)', () => {
  it('the attribute set editor shows and takes the score without attribute.add tweaks (open point 6)', async () => {
    const ov = { v: 2, blocks: [{ id: 't1', kind: 'attribute.add', v: 1, target: 'score:str', value: 2 }] } as BuildOverrides;
    const before = buildCharacter(FIGHTER(ov), db);
    expect(before.abilities.str, 'fixture: the +2 is live').toBe(12);
    const r = mount(FIGHTER(ov));
    await openMenu(r.host, 'Set a number');
    await pick(addEditor(r.host)!, 'What', 'Strength score');
    expect(numberBox(addEditor(r.host)!)!.placeholder, 'the book score, without the +2').toBe('book: 10');
    await enter(numberBox(addEditor(r.host)!), '18');
    await press(addButton(r.host));
    expect(r.build().overrides?.attributes).toEqual({ str: 18 });
    expect(numberBox(openRow(r.host)!)!.value, 'the row shows the set score, not 20').toBe('18');
  });

  it('adding a set stores baseline = baselineFor(that target): max HP, a score, AC', async () => {
    const start = FIGHTER();
    const ch = buildCharacter(start, db);
    const want = { hp: baselineFor(ch, db, 'max-hp', start), dex: baselineFor(ch, db, 'score:dex', start), ac: baselineFor(ch, db, 'ac', start) };
    expect(want).toEqual({ hp: ch.hitPoints.current, dex: 12, ac: 18 });
    const r = mount(start);
    // AC before the Dex set: once Dex is set, AC's book number holds a tweak (the next it()).
    for (const [label, n] of [['AC', '20'], ['Maximum HP', '30'], ['Dexterity score', '16']] as const) {
      await openMenu(r.host, 'Set a number');
      await pick(addEditor(r.host)!, 'What', label);
      await enter(numberBox(addEditor(r.host)!), n);
      await press(addButton(r.host));
    }
    const ov = r.build().overrides!;
    expect(metaOf(ov)['maxHp:max-hp']?.baseline).toBe(want.hp);
    expect(metaOf(ov)['attributes:dex']?.baseline).toBe(want.dex);
    expect((ov.blocks as { kind: string; target: string; baseline?: number }[]).find((b) => b.kind === 'number.set' && b.target === 'ac')?.baseline).toBe(want.ac);
  });

  it('a set stores no baseline while a tweak sits inside its book number (AC under a Dex set; a skill under a rank tweak)', async () => {
    const ov = { v: 2, attributes: { dex: 16 }, proficiencies: { stealth: 'expert' } } as BuildOverrides;
    const r = mount(FIGHTER(ov));
    for (const [label, n] of [['AC', '20'], ['Stealth', '9'], ['Athletics', '7']] as const) {
      await openMenu(r.host, 'Set a number');
      await pick(addEditor(r.host)!, 'What', label);
      await enter(numberBox(addEditor(r.host)!), n);
      await press(addButton(r.host));
    }
    const sets = (r.build().overrides!.blocks as { target: string; baseline?: number }[]).filter((b) => b.target);
    expect(sets.find((b) => b.target === 'ac')?.baseline, 'AC: Dex is set').toBeUndefined();
    expect(sets.find((b) => b.target === 'skill:stealth')?.baseline, 'Stealth: a rank tweak').toBeUndefined();
    expect(sets.find((b) => b.target === 'skill:athletics')?.baseline, 'Athletics: nothing inside it').toBe(0);
  });

  it('baselineFor names no number while a tweak feeds its base line, target by target', () => {
    const at = (ov: BuildOverrides, target: string) => {
      const b = FIGHTER(ov);
      return baselineFor(buildCharacter(b, db), db, target, b);
    };
    const add = (target: string, value = 2) => ({ v: 2, blocks: [{ id: 't1', kind: 'attribute.add', v: 1, target, value }] }) as BuildOverrides;
    // The attribute each number adds.
    expect(at(add('score:dex'), 'ac')).toBeUndefined();
    expect(at(add('score:con'), 'save:fortitude')).toBeUndefined();
    expect(at(add('score:dex'), 'save:reflex')).toBeUndefined();
    expect(at(add('score:wis'), 'save:will')).toBeUndefined();
    expect(at(add('score:wis'), 'perception')).toBeUndefined();
    expect(at(add('score:str'), 'skill:athletics')).toBeUndefined();
    expect(at(add('score:dex'), 'class-dc'), "the fixture fighter's key attribute is Dexterity").toBeUndefined();
    expect(at(add('score:str'), 'class-dc')).toBeTypeOf('number');
    expect(at(add('score:wis'), 'initiative')).toBeUndefined();
    // …and not an unrelated one.
    expect(at(add('score:cha'), 'ac')).toBe(18);
    expect(at(add('score:str'), 'save:will')).toBeTypeOf('number');
    // The rank of its proficiency term.
    expect(at({ v: 2, proficiencies: { athletics: 'master' } } as BuildOverrides, 'skill:athletics')).toBeUndefined();
    expect(at({ v: 2, proficiencies: { will: 'master' } } as BuildOverrides, 'save:will')).toBeUndefined();
    expect(at({ v: 2, proficiencies: { perception: 'master' } } as BuildOverrides, 'initiative')).toBeUndefined();
    expect(at({ v: 2, proficiencies: { athletics: 'master' } } as BuildOverrides, 'skill:stealth')).toBeTypeOf('number');
    // Initiative reads Perception: a Perception tweak is inside it.
    expect(at({ v: 2, blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'perception', value: 1 }] } as BuildOverrides, 'initiative')).toBeUndefined();

    // WP7 fix round: Strength through worn armor's Strength entry. Full plate (Strength +4) has a check penalty
    // on the Strength and Dexterity skills and a Speed penalty; meeting the entry removes the first and cuts
    // the second by 5 feet (derive.ts meetsArmorStrength), and both are BOOK terms.
    const PLATE = { inventory: [{ instanceId: 'arm', itemId: 'full-plate', quantity: 1, worn: true }] } as Partial<BuildState>;
    const worn = (ov: BuildOverrides | undefined, target: string) => {
      const b = FIGHTER(ov, PLATE);
      return baselineFor(buildCharacter(b, db), db, target, b);
    };
    expect(worn(undefined, 'skill:stealth'), 'premise: the plate check penalty in the book number').toBe(-2);
    expect(worn(undefined, 'speed:land'), 'premise: the plate Speed penalty in the book number').toBe(15);
    for (const ov of [add('score:str', 8), { v: 2, attributes: { str: 18 } } as BuildOverrides]) {
      for (const t of ['skill:stealth', 'skill:acrobatics', 'skill:thievery', 'speed:land']) expect(worn(ov, t), `${t} under ${JSON.stringify(ov)}`).toBeUndefined();
      expect(worn(ov, 'skill:medicine'), 'a Wisdom skill takes no check penalty').toBe(worn(undefined, 'skill:medicine'));
    }
    expect(worn(add('score:cha'), 'speed:land'), 'an unrelated attribute').toBe(15);
    expect(worn(add('score:cha'), 'skill:stealth')).toBe(-2);
    // A skill-attribute swap: Officer's Medical Training rolls Medicine with the better of Wisdom and
    // Intelligence, so an Intelligence tweak decides which, even one that leaves Wisdom rolled.
    const omt = { featId: 'officers-medical-training', level: 1, category: db.feats['officers-medical-training'].category };
    expect(at({ v: 2, addedFeats: [omt] } as BuildOverrides, 'skill:medicine'), 'premise: the feat alone').toBeTypeOf('number');
    expect(at({ v: 2, addedFeats: [omt], attributes: { int: 8 } } as BuildOverrides, 'skill:medicine')).toBeUndefined();
  });
});

/* ─────────────────────────────── casting, levels, broken, the row editor ─────────────────────────────── */

describe('the editors write what the player changed, and only that', () => {
  it('giving Flexible Spellcaster Dedication to a cleric shows the casting note in the Give-a-feat editor (open point 8)', async () => {
    const cleric = hero(db, 'cleric', 4, undefined, { subclassId: 'cloistered-cleric' });
    const entry = buildCharacter(cleric, db).spellcasting.find((e) => e.id === 'cleric-casting')!;
    expect(entry.type, 'fixture: a prepared cleric').toBe('prepared');
    const r = mount(cleric);
    await openMenu(r.host, 'Give a feat');
    await pick(addEditor(r.host)!, 'Feat', 'Toughness');
    expect(addEditor(r.host)!.querySelector('[data-part="record"] .tw-part-note'), 'a feat that changes no casting: no note').toBeNull();
    await pick(addEditor(r.host)!, 'Feat', 'Flexible Spellcaster Dedication');
    await enter(levelBox(addEditor(r.host)!), '2');
    expect(addEditor(r.host)!.querySelector('[data-part="record"] .tw-part-note')?.textContent?.trim()).toBe(
      `This changes ${entry.name}: prepared → spontaneous. Spells you prepared stay saved.`,
    );
    expect(r.build().overrides, 'the note writes nothing').toBeUndefined();
  });

  it("editing a given feat's level moves its meta (open point 1), and the row stays open", async () => {
    const ov = {
      v: 2,
      addedFeats: [{ featId: 'toughness', level: 3, category: 'general' }],
      meta: { 'addedFeats:toughness@3': { reason: 'Guild training', of: 'toughness@3' } },
    } as unknown as BuildOverrides;
    const r = mount(FIGHTER(ov));
    await press(rowBy(r.host, 'Toughness')!.querySelector('.tw-row-head'));
    expect(levelBox(openRow(r.host)!)!.value).toBe('3');
    await enter(levelBox(openRow(r.host)!), '5');
    const after = r.build().overrides!;
    expect(after.addedFeats).toEqual([{ featId: 'toughness', level: 5, category: 'general' }]);
    expect(metaOf(after)['addedFeats:toughness@3'], 'the old key is gone').toBeUndefined();
    expect(metaOf(after)['addedFeats:toughness@5']).toMatchObject({ reason: 'Guild training', of: 'toughness@5' });
    expect(openRow(r.host)?.dataset.key, 'the open row followed its tweak').toBe('addedFeats:toughness@5');
  });

  it('a broken feat id is fixed with Point to another', async () => {
    const r = mount(FIGHTER({ v: 2, addedFeats: [{ featId: 'no-such-feat-x', level: 2, category: 'general' }] } as BuildOverrides));
    const row = rows(r.host)[0];
    expect(row.classList.contains('broken')).toBe(true);
    await press(row.querySelector('.tw-row-head'));
    expect(openRow(r.host)!.querySelector('.tw-parts'), 'no parts on a broken row').toBeNull();
    await pick(openRow(r.host)!, 'Point to another', 'Toughness');
    expect(r.build().overrides?.addedFeats).toEqual([{ featId: 'toughness', level: 2, category: 'general' }]);
    expect(rowBy(r.host, 'Toughness')!.classList.contains('broken')).toBe(false);
  });

  it('a row writes each change at once; an emptied number removes the tweak', async () => {
    const ov = { v: 2, blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 1, reason: 'Guild' }] } as BuildOverrides;
    const r = mount(FIGHTER(ov));
    await press(rowBy(r.host, 'Athletics +1')!.querySelector('.tw-row-head'));
    await enter(numberBox(openRow(r.host)!), '3');
    expect(r.build().overrides?.blocks).toEqual([{ id: 't1', kind: 'number.add', v: 1, target: 'skill:athletics', value: 3, reason: 'Guild' }]);
    await enter(openRow(r.host)!.querySelector('input[aria-label="Reason"]'), 'Guild training');
    expect((r.build().overrides?.blocks as { reason?: string }[])[0].reason).toBe('Guild training');
    await enter(numberBox(openRow(r.host)!), '');
    expect(r.build().overrides?.blocks ?? [], 'emptied and left: the tweak goes').toEqual([]);
  });

  it("a Maximum HP 'Set to' made 'At least' is one remove + add keeping its reason, start level and on/off", async () => {
    const ov = { v: 2, maxHp: 40, meta: { 'maxHp:max-hp': { reason: 'House rule', of: '40', from: 3, on: false } } } as unknown as BuildOverrides;
    const r = mount(FIGHTER(ov));
    await press(r.host.querySelector('li.tw-row[data-kind="number.setMaxHp"] .tw-row-head'));
    const ed = openRow(r.host)!;
    expect([...ed.querySelectorAll('.tw-chooser button.tw-opt')].map((b) => (b.textContent ?? '').trim())).toEqual(['Set to', 'At least']);
    await press([...ed.querySelectorAll('.tw-chooser button.tw-opt')].find((b) => (b.textContent ?? '').trim() === 'At least'));
    const after = r.build().overrides!;
    expect(after.maxHp).toBeUndefined();
    expect(metaOf(after)['maxHp:max-hp']).toBeUndefined();
    expect(after.blocks).toEqual([expect.objectContaining({ kind: 'number.atLeast', target: 'max-hp', value: 40, reason: 'House rule', from: 3, on: false })]);
    expect(openRow(r.host)?.dataset.kind, 'the row followed it').toBe('number.atLeast');
  });

  it('a text edit row keeps only what differs from the book; typed back to the book, the field clears', async () => {
    const ov = { v: 2, contentEdits: { feats: { toughness: { name: 'Tougher' } } } } as unknown as BuildOverrides;
    const r = mount(FIGHTER(ov));
    await press(rows(r.host)[0].querySelector('.tw-row-head'));
    const name = () => openRow(r.host)!.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
    expect(name().value).toBe('Tougher');
    expect(openRow(r.host)!.querySelector<HTMLTextAreaElement>('textarea[aria-label="Description"]')!.value, 'the book text').toBe(db.feats.toughness.description);
    await enter(openRow(r.host)!.querySelector('textarea[aria-label="Description"]'), 'Mine.');
    expect(r.build().overrides?.contentEdits).toEqual({ feats: { toughness: { name: 'Tougher', description: 'Mine.' } } });
    await enter(name(), db.feats.toughness.name);
    expect(r.build().overrides?.contentEdits).toEqual({ feats: { toughness: { description: 'Mine.' } } });
    // WP7 fix round: the last changed field typed back to the book leaves an edit that changes nothing,
    // so the tweak goes (no "Your text: Toughness" row, no count).
    await enter(openRow(r.host)!.querySelector('textarea[aria-label="Description"]'), db.feats.toughness.description);
    expect(r.build().overrides?.contentEdits).toBeUndefined();
    expect(rows(r.host).length, 'the row is gone').toBe(0);
  });

  it("pointing a given spell's row at another spell gives it THAT spell's own rank, as the Add editor does (WP7 fix round)", async () => {
    const ov = { v: 2, addedSpells: [{ spellId: 'fireball', rank: 3 }] } as unknown as BuildOverrides;
    const r = mount(FIGHTER(ov));
    await press(rowBy(r.host, 'Fireball (rank 3)')!.querySelector('.tw-row-head'));
    await pick(openRow(r.host)!, 'Spell', 'Shield');
    const own = db.spells.shield.rank ?? 1;
    expect(own, "premise: Shield's own rank is not the old 3").not.toBe(3);
    expect(r.build().overrides?.addedSpells).toEqual([{ spellId: 'shield', rank: own }]);
    expect(rowBy(r.host, /^Shield/)?.querySelector('.tw-row-what')?.textContent).toBe(`Shield (${own === 0 ? 'cantrip' : `rank ${own}`})`);
  });

  it('the Add editor holds a draft until Add; Cancel throws it away; the draft counts as pending', async () => {
    const pending: boolean[] = [];
    const r = mount(FIGHTER(), { onPending: (d) => pending.push(d) });
    await openMenu(r.host, 'Bonus or penalty');
    await pick(addEditor(r.host)!, 'What', 'Athletics');
    expect(pending).toEqual([true]);
    await enter(numberBox(addEditor(r.host)!), '2');
    expect(r.build().overrides, 'nothing written before Add').toBeUndefined();
    await press(buttonIn(addEditor(r.host), 'Cancel'));
    expect(addEditor(r.host)).toBeNull();
    expect(pending).toEqual([true, false]);
    expect(r.build().overrides).toBeUndefined();
    // "Add" pressed while the number box still has its text: what is typed is added.
    await openMenu(r.host, 'Bonus or penalty');
    await pick(addEditor(r.host)!, 'What', 'Athletics');
    const box = numberBox(addEditor(r.host)!)!;
    focus(box);
    typeInto(box, '4');
    await press(addButton(r.host));
    expect((r.build().overrides?.blocks as { value: number }[])[0].value).toBe(4);
    expect(pending.at(-1)).toBe(false);
    void leave;
  });
});

/* ─────────────────────────────── the write door: several writes as one ─────────────────────────────── */

describe('writeTweaks (blocks/write.ts, WP7)', () => {
  it('applies each write against the one before; one refusal refuses them all and writes nothing', () => {
    const host = { overrides: { v: 2, maxHp: 40 } as BuildOverrides };
    const both = writeTweaks(host, [
      { op: 'remove', key: 'maxHp:max-hp' },
      { op: 'add', draft: { kind: 'number.atLeast', target: 'max-hp', value: 40 } },
    ]);
    expect(both.refused).toBeUndefined();
    expect(both.overrides?.maxHp).toBeUndefined();
    expect(both.overrides?.blocks).toEqual([expect.objectContaining({ kind: 'number.atLeast', target: 'max-hp', value: 40 })]);
    const refused = writeTweaks(host, [
      { op: 'remove', key: 'maxHp:max-hp' },
      { op: 'update', key: 'no-such-key', draft: { value: 1 } },
    ]);
    expect(refused.refused).toBe('no tweak "no-such-key"');
    expect(refused.overrides, "the host's own object").toBe(host.overrides);
    // One write: the same as writeTweak.
    const one = { op: 'add', draft: { kind: 'grant.language', record: 'draconic' } } as const;
    expect(writeTweaks(host, [one])).toEqual(writeTweak(host, one));
  });
});

/* ─────────────────────────────── the Builder: Save, the roster, the push ─────────────────────────────── */

function openBuilder(initial: BuildState) {
  const created: BuildState[] = [];
  const r = renderDom(createElement(Builder, { content: db, initial, onCancel: () => undefined, onCreate: (b: BuildState) => void created.push(b) }));
  cleanups.push(r.stop);
  return { host: r.host, created };
}

describe('UNKNOWN ≠ EMPTY: a block made by a newer version (item 13)', () => {
  it("survives an edit next to it, the Save, the roster write and the cloud push: the pushed build.overrides.blocks holds it byte for byte", async () => {
    const NEWER = { id: 'f1', kind: 'number.add', v: 9, target: 'skill:athletics', value: 1, future: { stack: ['a', 1, { deep: true }] } };
    const UNKNOWN_KIND = { id: 'f2', kind: 'speed.fly-later', v: 1, target: 'speed:fly', value: 30, note: 'ünïcödé ✓' };
    const ov = {
      v: 2,
      blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'save:will', value: 1 }, NEWER, UNKNOWN_KIND],
    } as unknown as BuildOverrides;
    const initial = FIGHTER(ov);
    const { host, created } = openBuilder(initial);
    await press(host.querySelector('.builder-head button.b-tweaks'));
    expect(host.querySelectorAll('li.tw-row.newer').length, 'both listed read-only').toBe(2);
    // An edit next to them, through the row editor.
    await press(rowBy(host, 'Will save +1')!.querySelector('.tw-row-head'));
    await enter(numberBox(openRow(host)!), '2');
    await press(host.querySelector('button.b-create'));
    for (let i = 0; i < 4 && confirmBox(); i++) await press(buttonIn(confirmBox(), 'Save anyway'));
    expect(created.length, 'saved').toBe(1);
    const saved = created[0];
    const blocks = saved.overrides!.blocks as unknown[];
    expect(blocks[0]).toMatchObject({ id: 't1', value: 2 });
    expect(JSON.stringify(blocks.slice(1))).toBe(JSON.stringify([NEWER, UNKNOWN_KIND]));
    // App.onCreate: the character built from the saved build, the stored character's own fields carried.
    const character: Character = carryStoredOverrides(buildCharacter(saved, db), buildCharacter(initial, db));
    const sc: SavedChar = { id: 'pc-tw-newer', build: saved, character, play: initialPlay(character, db) };
    expect(saveRoster([sc])).toBe(true);
    const back = loadRoster().find((x) => x.id === 'pc-tw-newer')!;
    expect(JSON.stringify((back.build!.overrides!.blocks as unknown[]).slice(1)), 'the roster write').toBe(JSON.stringify([NEWER, UNKNOWN_KIND]));
    await act(async () => {
      await publishCharacter('camp-tw', back.id, back.character.name, {} as PartySummary, back);
    });
    const pushed = server.chars.get('camp-tw|pc-tw-newer')?.sheet as SavedChar | undefined;
    expect(pushed, 'pushed').toBeTruthy();
    expect(JSON.stringify((pushed!.build!.overrides!.blocks as unknown[]).slice(1)), 'the cloud push').toBe(JSON.stringify([NEWER, UNKNOWN_KIND]));
  });
});

/* ─────────────── Tweaks phase 2, WP2: the choice parts, the shared choice look, the choice row editor ─────────────── */

const P2 = await import('../src/builder/tweaks/choiceParts');

describe('tweaks p2 WP2: each choice part alone', () => {
  const show = (el: React.ReactElement) => {
    const r = renderDom(el);
    cleanups.push(r.stop);
    return r;
  };

  it('picker, rule and count: their own data-part, their words; count never goes below the copies taken', () => {
    const p = show(<P2.PickerPart value="heritage" onChange={() => {}} />);
    expect(p.host.querySelector('[data-part="picker"]')?.textContent).toContain('Heritage');
    const r = show(<P2.RulePart rules={['list', 'level']} value="level" onChange={() => {}} />);
    expect(r.host.querySelector('[data-part="rule"]')).not.toBeNull();
    const commits: number[] = [];
    const c = show(<P2.CountPart value={2} floor={2} onCommit={(n) => commits.push(n)} />);
    expect(c.host.querySelector('[data-part="count"] .tw-part-note')?.textContent).toContain('At least 2');
    const box = c.host.querySelector<HTMLInputElement>('input[aria-label="More times"]')!;
    focus(box);
    typeInto(box, '1');
    leave(box);
    expect(commits.at(-1), 'raised to the floor').toBe(2);
  });

  it('place: a feat place asks level and kind; a removed boost asks set and which one (shown 1-based, stored 0-based)', () => {
    const patches: unknown[] = [];
    const add = show(<P2.PlacePart mode="add" value={{ place: 'feat', level: 4, category: 'class' }} onChange={(x) => patches.push(x)} />);
    const labels = (h: HTMLElement) => [...h.querySelectorAll('.tw-place-field-label')].map((e) => e.textContent);
    expect(labels(add.host)).toEqual(['Kind', 'At level', 'Feat kind']);
    const rm = show(<P2.PlacePart mode="remove" value={{ place: 'boost', set: 'free', index: 2 }} onChange={(x) => patches.push(x)} />);
    expect(labels(rm.host)).toEqual(['Kind', 'Set', 'Which boost']);
    expect(rm.host.querySelector<HTMLInputElement>('input[aria-label="Which boost"]')?.value).toBe('3');
    const filled = show(<P2.PlacePart mode="add" value={{ place: 'feat', level: 4, category: 'class' }} filled="Toughness" onChange={() => {}} />);
    expect(filled.host.querySelector('input[aria-label="At level"]'), 'a filled place greys its level (C12)').toBeNull();
    expect(filled.host.querySelector('.tw-part-note')?.textContent).toContain('remove the feat first');
  });

  it('answer: a typed value never holds a comma (C27)', () => {
    const got: string[] = [];
    const a = show(<P2.AnswerPart mode="value" value={undefined} onCommit={(v) => got.push(v)} />);
    const box = a.host.querySelector<HTMLInputElement>('[data-part="answer"] input')!;
    focus(box);
    typeInto(box, 'fire, cold');
    expect(a.host.querySelector('[data-part="answer"] .tw-part-note.refusal')?.textContent).toContain('A comma would split this answer in two.');
    leave(box);
    expect(got).toEqual([]);
    focus(box);
    typeInto(box, 'fire');
    leave(box);
    expect(got).toEqual(['fire']);
  });

  it('options: a removed option stays listed, greyed, with why; a locked one cannot be removed; the add box refuses a comma', () => {
    const edits: { add: string[]; remove: string[] }[] = [];
    const o = show(
      <P2.OptionsPart
        options={[
          { value: 'stealth', label: 'Stealth' },
          { value: 'thievery', label: 'Thievery' },
          { value: 'arcana', label: 'Arcana' },
        ]}
        add={['lore:sailing']}
        remove={['thievery']}
        locked={{ arcana: 'Answer it first' }}
        onChange={(e) => edits.push(e)}
      />,
    );
    const row = (v: string) => [...o.host.querySelectorAll<HTMLElement>('.tw-option')].find((li) => li.textContent?.includes(v))!;
    expect(row('Thievery').className).toContain('removed');
    expect(row('Thievery').textContent).toContain('Removed from this list by your tweak');
    expect(row('Arcana').querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
    expect(row('lore:sailing').textContent).toContain('added');
    o.click(row('Stealth').querySelector('input'));
    expect(edits.at(-1)).toEqual({ add: ['lore:sailing'], remove: ['thievery', 'stealth'] });
    const box = o.host.querySelector<HTMLInputElement>('input[aria-label="Add an option"]')!;
    typeInto(box, 'a, b');
    expect(o.host.querySelector('.tw-part-note.refusal')?.textContent).toContain('A comma would split this answer in two.');
    expect(o.host.querySelector<HTMLButtonElement>('button.tw-option-add-go')?.disabled).toBe(true);
  });
});

describe('tweaks p2 WP2: the shared choice look (BreakableOptionRow, KeptAnswerRow, PlaceCardShell)', () => {
  const show = (el: React.ReactElement) => {
    const r = renderDom(el);
    cleanups.push(r.stop);
    return r;
  };

  it('a breakable row stays a disabled row with the book reason; its button is a separate element', () => {
    let acted = 0;
    const r = show(<P2.BreakableOptionRow name="Ancient Elf" reason="Requires the Elf ancestry" onAct={() => acted++} />);
    expect(r.host.querySelector<HTMLButtonElement>('.pick-body')?.disabled).toBe(true);
    expect(r.host.querySelector('.picker-why')?.textContent).toBe('Requires the Elf ancestry');
    const act2 = r.host.querySelector<HTMLButtonElement>('button.tw-break-act')!;
    expect(act2.textContent).toBe('Take anyway');
    r.click(act2);
    expect(acted).toBe(1);
    const again = show(<P2.BreakableOptionRow name="Toughness" reason="Taken once already" action="again" onAct={() => {}} />);
    expect(again.host.querySelector('button.tw-break-act')?.textContent).toBe('Take again');
    // Guy's taste answer (2026-10-24, "Real button"): the picker's own Choose button look, not a text link.
    expect(act2.classList.contains('pick-add'), 'Take anyway wears the Choose button class').toBe(true);
  });

  it('a kept row says it does not count, and offers its action', () => {
    let restored = 0;
    const r = show(<P2.KeptAnswerRow answer="Stealth" status="kept, doesn't count (place removed)" action={{ label: 'Restore', onClick: () => restored++ }} />);
    expect(r.host.querySelector('.tw-kept-line')?.textContent).toBe("Stealth — kept, doesn't count (place removed)");
    r.click(r.host.querySelector('button.tw-kept-act'));
    expect(restored).toBe(1);
  });

  it('an extra-place card: live holds its slot; paused says so with Turn on; Tweaks off greys it with no control at all', () => {
    const chip = (state: 'live' | 'paused') => <span className="tw-mark" data-mark-state={state} />;
    const live = show(
      <P2.PlaceCardShell title="Extra class feat" state="live" placeKey="2:extraclass:1" mark={chip('live')}>
        <span className="slot">Toughness</span>
      </P2.PlaceCardShell>,
    );
    expect(live.host.querySelector('[data-place-key="2:extraclass:1"] .slot')).not.toBeNull();
    // Guy's taste answer (2026-10-24, "Normal card + chip"): the slot sits in a slot row with the chip beside it.
    expect(live.host.querySelector('.tw-place-row.lvl-slot > .slot + .tw-mark'), 'the chip beside the card').not.toBeNull();
    let on = 0;
    const paused = show(<P2.PlaceCardShell title="Extra class feat" state="paused" held="Toughness" onTurnOn={() => on++} mark={chip('paused')} />);
    expect(paused.host.querySelector('.tw-place-plain .lvl-card-val')?.textContent, 'a greyed normal card names its pick').toBe('Toughness');
    expect(paused.host.querySelector('.tw-mark[data-mark-state="paused"]'), 'paused keeps its chip').not.toBeNull();
    expect(paused.host.querySelector('.tw-place-note')?.textContent).toContain("Paused: Toughness doesn’t count while paused");
    paused.click(paused.host.querySelector('button.tw-place-on'));
    expect(on).toBe(1);
    const off = show(
      <P2.PlaceCardShell title="Extra class feat" state="off" held="Toughness" onTurnOn={() => on++} mark={<button type="button">Tweak</button>}>
        <button type="button">Change</button>
      </P2.PlaceCardShell>,
    );
    expect(off.host.querySelector('.tw-place-note')?.textContent).toContain('Tweaks are off: Toughness doesn’t count');
    expect(off.host.querySelectorAll('button'), 'C42: no controls while Tweaks are off').toHaveLength(0);
  });
});

const { tweakRows } = await import('../src/builder/tweaks/model');
describe('tweaks p2 WP2: each choice kind as a row (check finding 7)', () => {
  const heritage = Object.keys(db.heritages)[0];
  const BLOCKS = [
    { id: 't1_rowa', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'heritage', record: heritage },
    // WP13: was a skill-increase allow (WP12, after the record rebuild); the extra skill increase is the built kind whose
    // skill can break.
    { id: 't2_rowa', kind: 'choice.addPlace', v: 1, place: 'skillIncrease', level: 3, skill: 'no-such-skill' },
    { id: 't3_rowa', kind: 'choice.anyList', v: 1, record: 'toughness', rule: 'level' },
    { id: 't4_rowa', kind: 'choice.moreTakes', v: 1, record: 'toughness', times: 1 },
    { id: 't5_rowa', kind: 'choice.addPlace', v: 1, place: 'feat', level: 4, category: 'class', n: 1 },
    { id: 't6_rowa', kind: 'remove.choicePlace', v: 1, place: 'boost', set: 'free', index: 0 },
    // a background that asks a trained-skill choice (Acolyte asks none: its answer tweak would be Broken)
    { id: 't7_rowa', kind: 'choice.changeAnswer', v: 1, question: 'backgroundSkill', record: 'animal-wrangler', value: 'stealth' },
    { id: 't8_rowa', kind: 'choice.editOptions', v: 1, question: 'backgroundSkill', record: 'animal-wrangler', add: ['stealth'] },
  ];

  it('row text, broken reason, Point to another and Go to, kind by kind', () => {
    const b = FIGHTER({ v: 2, blocks: BLOCKS } as unknown as BuildOverrides);
    const rs = tweakRows(b, buildCharacter(b, db), db);
    const by = (id: string) => rs.find((r) => r.key === `blocks:${id}`)!;
    for (const r of rs) {
      expect(r.what, r.key).toBeTruthy();
      expect(r.what, r.key).not.toMatch(/undefined|NaN|\[object/);
    }
    expect(by('t1_rowa').broken).toBeFalsy();
    expect(by('t1_rowa').goTo).toEqual({ page: 'setup' });
    expect(by('t2_rowa').broken, 'an unknown skill is Broken').toBeTruthy();
    expect(by('t2_rowa').repoint, 'another skill, written to its skill').toEqual({ answer: 'skill' });
    expect(by('t3_rowa').repoint).toBeUndefined();
    expect(by('t4_rowa').what).toContain('may be taken 1 more time');
    expect(by('t5_rowa').what).toContain('empty');
    expect(by('t5_rowa').goTo).toEqual({ page: 4, placeKey: '4:extraclass:1' });
    expect(by('t6_rowa').goTo).toBeDefined();
    // WP13: "Change an answer" and "Edit a list" come after the record rebuild: read-only rows, kept and never applied.
    expect(rs.find((r) => r.key === 'blocks:t7_rowa'), 'no working row').toBeUndefined();
    expect(rs.find((r) => r.key === 'blocks:t8_rowa'), 'no working row').toBeUndefined();
    const newer = rs.filter((r) => r.kind === 'foreign');
    expect(newer.map((r) => r.what)).toEqual(['Answer a choice outside its list', "Edit a choice's list"]);
    for (const r of newer) {
      expect(r.readOnly).toBe(true);
      expect(r.chips.map((c) => c.text)).toEqual(['Made in a newer version']);
      expect(r.goTo).toBeUndefined();
    }
  });

  it('a broken extra skill increase is pointed at another skill from its row, and keeps its id', async () => {
    const r = mount(FIGHTER({ v: 2, blocks: [BLOCKS[1]] } as unknown as BuildOverrides));
    const row = r.host.querySelector<HTMLElement>('li.tw-row[data-key="blocks:t2_rowa"]')!;
    await press(row.querySelector('.tw-row-head'));
    await pick(openRow(r.host)!, 'Point to another', 'Stealth');
    const stored = (r.build().overrides!.blocks as { id: string; skill?: string }[]).find((x) => x.id === 't2_rowa');
    expect(stored?.skill).toBe('stealth');
  });

  it('a removed place shows its place as words only; an extra place never offers another kind', async () => {
    const r = mount(FIGHTER({ v: 2, blocks: [BLOCKS[5], BLOCKS[4]] } as unknown as BuildOverrides));
    await press(r.host.querySelector('li.tw-row[data-key="blocks:t6_rowa"] .tw-row-head'));
    const rm = openRow(r.host)!.querySelector('[data-part="place"]')!;
    expect(rm.querySelector('input, button'), 'nothing to change on a removed place').toBeNull();
    expect(rm.textContent).toContain('Attribute boost');
    await press(r.host.querySelector('li.tw-row[data-key="blocks:t5_rowa"] .tw-row-head'));
    const add = openRow(r.host)!.querySelector('[data-part="place"]')!;
    expect([...add.querySelectorAll('button')].some((x) => /Feat place|Skill increase/.test(x.textContent ?? '')), 'the kind is not a control').toBe(false);
    expect(add.querySelector('input[aria-label="At level"]'), 'an empty place may move').not.toBeNull();
  });

  // Second check, finding 1: the row-editor locks are guarded, not just drawn. A place holding a feat never moves
  // (C12: its feat would be left with no slot); a feat allowed more takes keeps its feat.
  it('an extra place holding a feat cannot move; a more-takes tweak keeps its feat', async () => {
    const r = mount(FIGHTER({ v: 2, blocks: [BLOCKS[4], BLOCKS[3]] } as unknown as BuildOverrides, { featPicks: { '4:extraclass:1': 'toughness' } } as Partial<BuildState>));
    await press(r.host.querySelector('li.tw-row[data-key="blocks:t5_rowa"] .tw-row-head'));
    const place = openRow(r.host)!.querySelector('[data-part="place"]')!;
    expect(place.querySelector('input[aria-label="At level"]'), 'a filled place keeps its level').toBeNull();
    expect(place.textContent).toContain('Holds Toughness');
    await press(r.host.querySelector('li.tw-row[data-key="blocks:t4_rowa"] .tw-row-head'));
    const rec = openRow(r.host)!.querySelector('[data-part="record"]')!;
    expect(rec.querySelector('input, button'), 'the feat is words, not a control').toBeNull();
  });
});

describe('tweaks p2 WP2: a stored choice tweak on the Tweaks page', () => {
  const MORE = { id: 't1_aaaa', kind: 'choice.moreTakes', v: 1, record: 'toughness', times: 1, reason: 'GM boon' };

  it('sits under "Choices"; its editor shows its own parts and writes each change in place (same id)', async () => {
    const r = mount(FIGHTER({ v: 2, blocks: [MORE] } as BuildOverrides));
    const group = r.host.querySelector<HTMLElement>('section.tw-group[data-group="Choices"]');
    expect(group, 'the Choices group').not.toBeNull();
    const row = group!.querySelector<HTMLElement>('li.tw-row')!;
    await press(row.querySelector('.tw-row-head'));
    const ed = openRow(r.host)!;
    expect([...ed.querySelectorAll<HTMLElement>('.tw-parts > [data-part]')].map((e) => e.dataset.part)).toEqual(['record', 'count', 'reason']);
    await enter(ed.querySelector<HTMLInputElement>('input[aria-label="More times"]'), '3');
    const stored = (r.build().overrides!.blocks as { id: string; times?: number }[]).find((b) => b.id === 't1_aaaa');
    expect(stored?.times).toBe(3);
  });

  /* WP1's open finding (wp1-report.md last section): when the retry on a newer build was REFUSED, the page still
   * kept the row the first try made as its open row — a key no block had — and said nothing. The open-row key has
   * no <li>, so the notice is what this test can see: it failed before the fix (planted once: the refusal not
   * recorded → no notice). */
  it('a retry the newer build refuses opens no row and says why', async () => {
    const r = mount(FIGHTER(), {
      newer: (b) => ({ ...b, overrides: { ...(b.overrides ?? {}), maxHp: 50 } as BuildOverrides }),
    });
    await openMenu(r.host, 'Set a number');
    await targetAndNumber('Maximum HP', '30')(r.host);
    await press(addButton(r.host));
    await settle();
    expect(r.build().overrides?.maxHp, "the newer build's own value is kept").toBe(50);
    expect(openRow(r.host), 'no row is open').toBeNull();
    expect(r.host.querySelector('.tw-notice')?.textContent).toContain('Not saved: maximum HP is already set by a tweak');
  });
});

describe('merge check fixes (2026-10-24)', () => {
  const db = content();
  it('"Take a feat more times": the count never goes below the extra copies already held', () => {
    const b = { ...emptyBuild(), level: 5, featPicks: { '1:general:0': 'fleet', '3:general:0': 'fleet', '5:general:0': 'fleet' } };
    expect(extraCopiesHeld(b, db, 'fleet'), 'three Fleets, book limit one: two extra').toBe(2);
    expect(extraCopiesHeld({ ...b, featPicks: { '1:general:0': 'fleet' } }, db, 'fleet'), 'one copy: the floor stays 1').toBe(1);
    expect(extraCopiesHeld(b, db, undefined)).toBe(1);
  });
  // WP13: was a skill-increase allow (WP12, after the record rebuild); an extra skill increase is the built place-bound tweak.
  it('an extra skill increase above the level is "not reached" for the chip AND the switch-off list', () => {
    const place = { kind: 'choice.addPlace', params: { place: 'skillIncrease', level: 9, skill: 'stealth' } } as unknown as BlockInstance;
    expect(placeNotReached(place, { level: 5 })).toBe(true);
    expect(placeNotReached(place, { level: 9 })).toBe(false);
    const heritage = { kind: 'choice.allowAnywayAnyPicker', record: 'ancient-elf', params: { picker: 'heritage' } } as unknown as BlockInstance;
    expect(placeNotReached(heritage, { level: 1 }), 'a heritage allow has no place').toBe(false);
  });
});
