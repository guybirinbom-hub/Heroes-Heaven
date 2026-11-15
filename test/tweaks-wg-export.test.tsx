// @vitest-environment jsdom
import { act, createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { RosterScreen } from '../src/sheet/RosterScreen';
import { exportNative, exportWg } from '../src/data/transfer';
import { downloadText } from '../src/sheet/download';
import { tweaksWgCannotCarry, wgRowText } from '../src/rules/blocks/wgExport';
import { BLOCK_KINDS } from '../src/rules/blocks/registry';
import { readTweaks } from '../src/rules/blocks/stored';
import type { SavedChar } from '../src/data/storage';
import type { BuildOverrides, CharacterOptions } from '../src/rules/types';

/**
 * Tweaks part B, WP9a (plan B20; docs/overrides-redesign.md Building blocks item 6): a Wanderer's Guide file has
 * nowhere to put a tweak — `exportWg` writes the numbers of the live ones and drops `overrides`. Before such an
 * export the roster lists EVERY stored tweak (a paused one, one that starts later, all of them while Tweaks is
 * off, and the blocks this version keeps unread) and asks; Cancel writes no file. Synthetic characters only.
 */
vi.mock('../src/data/transfer', async (orig) => ({
  ...(await orig<typeof import('../src/data/transfer')>()),
  exportWg: vi.fn(() => '{"wg":true}'),
  exportNative: vi.fn(() => '{"codex":true}'),
}));
vi.mock('../src/sheet/download', async (orig) => ({
  ...(await orig<typeof import('../src/sheet/download')>()),
  downloadText: vi.fn(async () => 'saved' as const),
}));

const db = content();
const noop = () => undefined;
const LANGUAGE = Object.keys(db.languages).sort()[0];
const FEAT = Object.values(db.feats).find((f) => f.level === 1 && (f.traits ?? []).includes('general'))!;

/** A level-5 fighter carrying `overrides` (and `options`), as a roster entry. */
function hero(overrides?: BuildOverrides, options?: CharacterOptions): SavedChar {
  return { id: 'w1', character: build('fighter', 5, { name: 'Wren', ...(overrides ? { overrides } : {}), ...(options ? { options } : {}) }) };
}

/** Three tweaks, each with a meta "at least" / reason as the write door stores them. */
const THREE: BuildOverrides = {
  attributes: { str: 18 },
  proficiencies: { stealth: 'expert' },
  addedLanguages: [LANGUAGE],
  meta: {
    'proficiencies:stealth': { mode: 'atLeast', of: 'expert', reason: 'scout training' },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tweaksWgCannotCarry — what the list says', () => {
  it('three live tweaks, three lines', () => {
    const lines = tweaksWgCannotCarry(hero(THREE), db);
    expect(lines).toHaveLength(3);
    expect(lines).toContain('Strength score set to 18');
    expect(lines).toContain('Stealth: at least expert (scout training)');
    expect(lines).toContain(`Language added: ${db.languages[LANGUAGE].name}`);
    // MUTATION PROOF: mark every line "(off now)" (drop the entryLive test) and this fails.
    for (const l of lines) expect(l, 'a live tweak was called off').not.toContain('off now');
  });

  it('no tweak at all, an empty list', () => {
    expect(tweaksWgCannotCarry(hero(), db)).toEqual([]);
    expect(tweaksWgCannotCarry(hero({}), db)).toEqual([]);
  });

  it('paused tweaks are listed as off — its own switch, and a start level above the character', () => {
    const lines = tweaksWgCannotCarry(
      hero({
        ...THREE,
        meta: {
          ...THREE.meta,
          'attributes:str': { of: '18', on: false },
          [`addedLanguages:${LANGUAGE}`]: { of: LANGUAGE, from: 7 },
        },
      }),
      db,
    );
    expect(lines).toHaveLength(3);
    expect(lines).toContain('Strength score set to 18 (off now)');
    expect(lines).toContain(`Language added: ${db.languages[LANGUAGE].name} (off now)`);
    expect(lines).toContain('Stealth: at least expert (scout training)');
  });

  it('with Tweaks off every tweak is listed as off', () => {
    const lines = tweaksWgCannotCarry(hero({ ...THREE, v: 2 } as BuildOverrides, { overridesEnabled: false } as CharacterOptions), db);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l).toMatch(/\(off now\)$/);
  });

  it('a newer-version block is listed, and so is a stored entry this version cannot read', () => {
    const lines = tweaksWgCannotCarry(
      hero({
        proficiencies: { athletics: 'Expert' as never },
        blocks: [
          { id: 't1', kind: 'number.add', v: 99, target: 'ac', value: 1 },
          { id: 't2', kind: 'number.add', v: 1, target: 'save:fortitude', value: 1, bonusType: 'status' },
        ],
      } as BuildOverrides),
      db,
    );
    expect(lines).toContain('A tweak (Bonus or penalty) made by a newer version of the app');
    expect(lines).toContain('Fortitude save +1 status');
    expect(lines.some((l) => l.startsWith('Athletics: set to ?') && l.includes("can't be read"))).toBe(true);
    expect(lines).toHaveLength(3);
    // A rank whose mode a newer app wrote (B20; WP6 fix round 1) says so.
    const newerMode = tweaksWgCannotCarry(hero({ v: 3, proficiencies: { stealth: 'expert' }, meta: { 'proficiencies:stealth': { of: 'expert', mode: 'atMost' } } } as unknown as BuildOverrides), db);
    expect(newerMode).toHaveLength(1);
    expect(newerMode[0]).toContain('(made in a newer version)');
  });

  it('records are named from the content; a given feat says its level', () => {
    const lines = tweaksWgCannotCarry(hero({ addedFeats: [{ featId: FEAT.id, level: 3 }], removedFeatIds: ['no-such-feat'] } as BuildOverrides), db);
    expect(lines).toContain(`Feat given: ${FEAT.name} (level 3)`);
    // A record the content does not hold is still listed, by its id (decision 13).
    expect(lines).toContain('Feat removed: no-such-feat');
  });

  it('a spell attack / spell DC tweak names its casting entry by name, never its id (plan B WP6 carry-over)', () => {
    const cleric = build('cleric', 5, { name: 'Wren' });
    const entry = cleric.spellcasting[0];
    expect(entry, 'fixture: the cleric has a casting entry').toBeDefined();
    expect(entry.name, 'fixture: the entry name differs from its id').not.toBe(entry.id);
    const saved: SavedChar = {
      id: 'w2',
      character: build('cleric', 5, {
        name: 'Wren',
        overrides: {
          blocks: [
            { id: 't1', kind: 'number.add', v: 1, target: `spell-dc@casting-entry:${entry.id}`, value: 1 },
            { id: 't2', kind: 'number.add', v: 1, target: 'spell-attack@casting-entry:gone-entry', value: 2 },
          ],
        } as BuildOverrides,
      }),
    };
    const lines = tweaksWgCannotCarry(saved, db);
    expect(lines).toContain(`Spell DC (${entry.name}) +1`);
    for (const l of lines) expect(l).not.toContain(`(${entry.id})`);
    // An entry the character no longer has keeps its id, so the player still sees which one it was.
    expect(lines).toContain('Spell attack (gone-entry) +2');
  });

  // tweaks p2 WP1 (plan C34): every registry kind has its own line — a kind that fell to rowText's `default:` would
  // print only its bare title, which names no place, rule, record or number. One stored tweak per kind, read back
  // through the same reader the export uses.
  const ONE_OF_EACH: Record<string, BuildOverrides> = {
    'number.add': { blocks: [{ id: 't1', kind: 'number.add', v: 1, target: 'ac', value: 1 }] },
    'attribute.add': { blocks: [{ id: 't1', kind: 'attribute.add', v: 1, target: 'score:dex', value: 2 }] },
    'number.set': { blocks: [{ id: 't1', kind: 'number.set', v: 1, target: 'ac', value: 20 }] },
    'number.atLeast': { blocks: [{ id: 't1', kind: 'number.atLeast', v: 1, target: 'perception', value: 10 }] },
    'number.setMaxHp': { maxHp: 40 },
    'attribute.set': { attributes: { con: 18 } },
    'rank.atLeast': { proficiencies: { stealth: 'expert' }, meta: { 'proficiencies:stealth': { of: 'expert', mode: 'atLeast' } } },
    'rank.exactly': { proficiencies: { stealth: 'expert' }, meta: { 'proficiencies:stealth': { of: 'expert', mode: 'exactly' } } },
    'rank.legacySet': { proficiencies: { classDc: 'legendary' } },
    'grant.feat': { addedFeats: [{ featId: FEAT.id, level: 3, category: 'general' }] },
    'grant.classFeature': { addedFeatures: [{ featureId: 'shield-block', level: 1 }] },
    'grant.language': { addedLanguages: [LANGUAGE] },
    'grant.spell': { addedSpells: [{ spellId: 'fireball', rank: 3 }] },
    'remove.feat': { removedFeatIds: [FEAT.id] },
    'choice.allowAnyway': { allowedFeats: [FEAT.id] },
    'text.edit': { contentEdits: { feats: { [FEAT.id]: { name: 'Tougher' } } } } as BuildOverrides,
    'choice.allowAnywayAnyPicker': { blocks: [{ id: 't1_aaaa', kind: 'choice.allowAnywayAnyPicker', v: 1, picker: 'heritage', record: 'ancient-elf' }] },
    'choice.anyList': { blocks: [{ id: 't1_aaaa', kind: 'choice.anyList', v: 1, record: FEAT.id, rule: 'list' }] },
    'choice.moreTakes': { blocks: [{ id: 't1_aaaa', kind: 'choice.moreTakes', v: 1, record: FEAT.id, times: 1 }] },
    'choice.addPlace': { blocks: [{ id: 't1_aaaa', kind: 'choice.addPlace', v: 1, place: 'feat', level: 4, category: 'class', n: 483920 }] },
    'remove.choicePlace': { blocks: [{ id: 't1_aaaa', kind: 'remove.choicePlace', v: 1, place: 'feat', level: 4, category: 'class', ordinal: 0 }] },
    'choice.changeAnswer': { blocks: [{ id: 't1_aaaa', kind: 'choice.changeAnswer', v: 1, question: 'skillSlot', record: 'rogue-dedication', index: 0, value: 'stealth' }] },
    'choice.editOptions': { blocks: [{ id: 't1_aaaa', kind: 'choice.editOptions', v: 1, question: 'choice', record: 'variable-core', add: ['fire'] }] },
  } as Record<string, BuildOverrides>;

  it('every registry kind has a one-of-each fixture here (a new kind cannot skip the line test)', () => {
    expect(BLOCK_KINDS.map((k) => k.id).filter((id) => !ONE_OF_EACH[id])).toEqual([]);
  });

  // WP13 (C34 shrunk to the built kinds): a not-yet kind's stored block reads as a newer app's, so the export lists it
  // as one ("A tweak (…) made by a newer version of the app") and rowText has no case for it.
  const APPLIED = BLOCK_KINDS.filter((k) => k.applies !== 'not-yet');
  it.each(BLOCK_KINDS.filter((k) => k.applies === 'not-yet').map((k) => [k.id, k.title] as const))('%s: listed as made by a newer version, never as a working tweak', (id, title) => {
    expect(readTweaks(ONE_OF_EACH[id]).instances, `${id} is never read as a working tweak`).toEqual([]);
    expect(tweaksWgCannotCarry(hero(ONE_OF_EACH[id]), db)).toEqual([`A tweak (${title}) made by a newer version of the app`]);
  });

  it.each(APPLIED.map((k) => [k.id, k.title] as const))('%s: its line is its own, never the bare title', (id, title) => {
    const inst = readTweaks(ONE_OF_EACH[id]).instances.find((i) => i.kind === id);
    expect(inst, `fixture: the stored ${id} reads back as that kind`).toBeDefined();
    const line = wgRowText(inst!, db, []);
    expect(line).not.toBe(title);
    expect(line).not.toMatch(/undefined/);
    // …and the export's own list carries that line (an old rank entry is listed as the read-time sort sorts it,
    // the test below, so it has no line of its own there).
    if (id !== 'rank.legacySet') expect(tweaksWgCannotCarry(hero(ONE_OF_EACH[id]), db)).toContain(line);
  });

  it('a paused phase-2 choice tweak is listed "(off now)"', () => {
    const lines = tweaksWgCannotCarry(hero({ blocks: [{ id: 't1_aaaa', kind: 'choice.anyList', v: 1, record: FEAT.id, rule: 'level', on: false }] } as BuildOverrides), db);
    expect(lines).toEqual([`Picked from any list: ${FEAT.name}, past the feat's level (off now)`]);
  });

  it('an old rank entry reads as the sheet sorts it (the read-time sort)', () => {
    const saved = hero({ proficiencies: { athletics: 'legendary' } } as BuildOverrides);
    const sort = saved.character.tweakRankSort?.athletics;
    expect(sort, 'the fixture has no read-time sort').toBeDefined();
    expect(tweaksWgCannotCarry(saved, db)).toEqual([`Athletics: ${sort === 'atLeast' ? 'at least' : 'exactly'} legendary`]);
  });
});

/* ─────────────────────────────── the roster dialog ─────────────────────────────── */

function openRoster(saved: SavedChar) {
  return renderDom(
    createElement(RosterScreen, {
      roster: [saved],
      activeId: saved.id,
      content: db,
      onOpen: noop,
      onNew: noop,
      onImport: noop,
      onDuplicate: noop,
      onArchive: noop,
      onDelete: noop,
    }),
  );
}
const flush = () => act(async () => void (await new Promise((res) => setTimeout(res, 0))));
const button = (needle: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => (b.textContent ?? '').includes(needle)) ?? null;

async function chooseWg(r: ReturnType<typeof openRoster>) {
  r.click(r.host.querySelector('.rcard-actions button[title="Export"]'));
  await flush();
  r.click(button("Wanderer's Guide"));
  await flush();
}
const warning = () => [...document.querySelectorAll('.confirm-modal')].find((m) => (m.textContent ?? '').includes("Some tweaks can't go to Wanderer's Guide")) ?? null;
/** A button of the warning itself (never another dialog's). */
const answer = (label: string) => [...(warning()?.querySelectorAll<HTMLButtonElement>('.confirm-actions button') ?? [])].find((b) => b.textContent === label) ?? null;

describe('the roster asks before a Wanderer’s Guide export', () => {
  it('no tweak at all, no dialog — the file is written', async () => {
    const r = openRoster(hero());
    await chooseWg(r);
    expect(warning(), 'a character with no tweak was asked').toBeNull();
    expect(vi.mocked(exportWg)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadText)).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('lists the tweaks, and "Export anyway" writes the file', async () => {
    const r = openRoster(hero(THREE));
    await chooseWg(r);
    const dlg = warning();
    expect(dlg, 'no warning before the export').toBeTruthy();
    const items = [...dlg!.querySelectorAll('li')].map((li) => li.textContent);
    expect(items).toHaveLength(3);
    expect(items).toContain('Strength score set to 18');
    // The dialog box clips at 92vh (`.picker` overflow: hidden): a long list must scroll inside itself, or
    // "Export anyway" falls out of reach on a phone.
    const list = dlg!.querySelector<HTMLElement>('ul.wg-tweaks-lost')!;
    expect(list.style.overflowY, 'a long list would push the buttons out of the clipped dialog').toBe('auto');
    expect(list.style.maxHeight).not.toBe('');
    expect(dlg!.textContent).toContain('a re-import will not bring any of them back as tweaks');
    expect(vi.mocked(downloadText), 'the file was written before the answer').not.toHaveBeenCalled();
    r.click(answer('Export anyway'));
    await flush();
    expect(vi.mocked(exportWg)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadText)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadText).mock.calls[0][0].filename).toBe('wren.wg.json');
    r.stop();
  });

  it('with Tweaks off the export still warns', async () => {
    const r = openRoster(hero({ ...THREE, v: 2 } as BuildOverrides, { overridesEnabled: false } as CharacterOptions));
    await chooseWg(r);
    const dlg = warning();
    expect(dlg, 'Tweaks off skipped the warning').toBeTruthy();
    for (const li of dlg!.querySelectorAll('li')) expect(li.textContent).toContain('(off now)');
    r.click(answer('Cancel'));
    await flush();
    r.stop();
  });

  it('Cancel writes no file', async () => {
    const r = openRoster(hero(THREE));
    await chooseWg(r);
    expect(warning()).toBeTruthy();
    r.click(answer('Cancel'));
    await flush();
    expect(warning(), 'Cancel left the warning open').toBeNull();
    expect(vi.mocked(exportWg)).not.toHaveBeenCalled();
    expect(vi.mocked(exportNative)).not.toHaveBeenCalled();
    expect(vi.mocked(downloadText)).not.toHaveBeenCalled();
    r.stop();
  });

  it('the lossless .codex export never asks', async () => {
    const r = openRoster(hero(THREE));
    r.click(r.host.querySelector('.rcard-actions button[title="Export"]'));
    await flush();
    r.click(button('Heroes Heaven file'));
    await flush();
    expect(warning()).toBeNull();
    expect(vi.mocked(exportNative)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(downloadText)).toHaveBeenCalledTimes(1);
    r.stop();
  });
});
