// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, Component, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Combatant, Creature } from '../tracker/src/types/pf2e';
import {
  deleteCustomCreature,
  loadCustomCreatures,
  reloadCustomCreatures,
  saveCustomCreature,
} from '../tracker/src/data/dataStore';
import { applyBackup, mergeValue, parseCreaturesFromText } from '../tracker/src/utils/dataTransfer';
import { importEncountersFromText } from '../tracker/src/utils/encounterTransfer';
import { cancelPersist, readEncounterStore, useCombatStore } from '../tracker/src/store/combatStore';
import { usePartyStore } from '../tracker/src/store/partyStore';
import { GameDataProvider } from '../tracker/src/data/gameDataContext';
import { MonsterSearch } from '../tracker/src/components/MonsterSearch';
import { CreaturePickerModal } from '../tracker/src/components/CreaturePickerModal';
import { TextConverter } from '../tracker/src/components/TextConverter';
import { CombatantDetail } from '../tracker/src/components/CombatantDetail';
import { InitiativeTracker } from '../tracker/src/components/InitiativeTracker';

// A renderer failure no stat-block check can foresee, set off by one made-up name only: it proves the
// panel's preview contains whatever still breaks the stat block. Every other name renders for real.
vi.mock('../tracker/src/components/StatBlock', async (importOriginal) => {
  const real = await importOriginal<typeof import('../tracker/src/components/StatBlock')>();
  const { createElement } = await import('react');
  return {
    ...real,
    StatBlock: (p: Parameters<typeof real.StatBlock>[0]) => {
      if (p.combatant.creature?.name === 'Test Renderer Trap') throw new Error('Test renderer trap');
      return createElement(real.StatBlock, p);
    },
  };
});

/**
 * A BROKEN HOMEBREW STAT BLOCK IS SKIPPED — NEVER A CRASH, NEVER DROPPED (found 2026-10-02, v0.1.41).
 *
 * The tracker's homebrew list (`pf2e-custom-creatures`) held one entry that was an ARRAY wrapping a
 * raw-bestiary creature, with no name and no id of its own. The list surfaces read `.name.toLowerCase()`
 * off it and the whole tracker went down every time. The owner's ruling: "change the tracker so a
 * broken stat block is skipped instead of crashing the whole tracker".
 *
 *  (a) every reader of the list skips an array, a nameless object, null or a string — and an entry
 *      that HAS a name but a field the lists read of the wrong type (traits as text, level as an
 *      object, a numeric source, weaknesses as text), a name and nothing else, a raw bestiary entry
 *      stored flat, or no id of its own. The lists are opened with a trait filter on, because that
 *      filter is saved and every entry without a traits list crashed it on each open;
 *  (b) skipped is not deleted (UNKNOWN ≠ EMPTY): saving or deleting ANOTHER creature writes each of
 *      those entries back byte-for-byte, two creatures without an id are never edited or deleted
 *      together, and a merge (merge-import, the GM mirror's first contact) keeps every entry — every
 *      copy, and a stored value that is not a list. Only this list: parties still drop an entry with
 *      no id, because one kept there loads zero parties and the next write empties them;
 *  (c) the door is shut where it opened. JSON pasted into the custom-creature panel went to
 *      saveCustomCreature unchecked; pasted as a LIST, `c.id = uid()` landed on the array and
 *      JSON.stringify wrote the array without it — exactly the `[[{…}]]`, no-id entry that was found.
 *      The panel's preview and builder read the same paste, and a refused save says why in preview;
 *  (d) a stat block is read WHOLE, not just what the lists read: a thin one ({ name, traits, defenses })
 *      was saved and then took the tracker down on the board (Elite XP ran Object.entries(skills), the
 *      stat block ran senses.flatMap), and `languages: "Common"` crashed the stat block. Missing fields
 *      are filled in; a field of the wrong type is refused with the reason;
 *  (e) one id, one entry, and the app never writes one creature over another: an Overwrite of a
 *      creature whose stored copy is skipped replaces that copy (it used to sit beside it under the same
 *      id, and the next merge kept one of the two); a merge keeps two entries that share an id on one
 *      side; a NEW save of pasted JSON never takes another creature's id; an image upload goes onto the
 *      stored entry instead of writing the board's older copy over it, and says so when it cannot.
 *
 * Synthetic fixtures only.
 */

const KEY = 'pf2e-custom-creatures';

function beast(id: string, name: string, level = 1): Creature {
  return {
    id, name, source: 'Homebrew', level, traits: ['beast'], perception: 6, senses: [], languages: [],
    skills: {}, str: 3, dex: 1, con: 2, int: -4, wis: 1, cha: -2, items: [], speed: { walk: 30 },
    attacks: [], spellcasting: [], abilities: [],
    defenses: { ac: 16, fort: 8, ref: 5, will: 4, hp: 20, immunities: [], resistances: [], weaknesses: [] },
    isHazard: false,
  } as unknown as Creature;
}

/** A creature as the raw bestiary files hold it — not the tracker's own Creature shape. */
const RAW_BEAST = {
  name: 'Test Beast Raw', source: 'Made Up', level: 2, traits: ['beast'],
  perception: { std: 7 }, abilityMods: { str: 3, dex: 1, con: 2, int: -4, wis: 1, cha: -2 },
  abilities: { top: [], mid: [], bot: [] },
  defenses: { ac: { std: 17 }, hp: [{ hp: 30 }], savingThrows: { fort: { std: 9 }, ref: { std: 6 }, will: { std: 5 } } },
  attacks: [{ range: 'Melee', name: 'jaws', attack: 9, traits: [], damage: '1d8+3 piercing' }],
};

const A = beast('test-beast-a', 'Test Beast');
const B = beast('test-beast-b', 'Test Beast Mate', 2);
/** The shape that was found: one entry that is an array wrapping a raw creature. */
const WRAPPED = [RAW_BEAST];
const NO_NAME = { id: 'test-no-name', level: 1, traits: [] };
const BROKEN: unknown[] = [WRAPPED, NO_NAME, null, 'a stray string'];
const STORED: unknown[] = [A, ...BROKEN, B];

/** A beast with no id of its own (JSON drops the undefined). */
function idless(name: string): Record<string, unknown> {
  return { ...beast('', name), id: undefined };
}
/** Entries that HAVE a name, yet each crashed a homebrew list once the name check let it through. */
const NAMED_BROKEN: unknown[] = [
  { ...beast('test-traits-text', 'Test Traits Text'), traits: 'beast' },
  { ...beast('test-level-object', 'Test Level Object'), level: { std: 2 } },
  { ...beast('test-source-number', 'Test Source Number'), source: 7 },
  { ...beast('test-weakness-text', 'Test Weakness Text'), defenses: { ...A.defenses, weaknesses: 'fire 5' } },
  { id: 'test-lone', name: 'Test Lone' },
  { ...RAW_BEAST, id: 'test-raw-flat' },
  idless('Test Idless'),
];
const TRAIT_FILTER_ON = JSON.stringify({ filters: { traits: { beast: 'yes' } } });
/** A homebrew entry from before the fix whose level did not survive (JSON writes NaN as null): skipped. */
const OLD = { ...beast('test-old', 'Test Old'), level: null } as unknown as Creature;
/** As little as a stat block can be: a name, traits and a defenses block. */
const THIN = { id: 'test-thin', name: 'Test Thin', traits: ['beast'], defenses: { hp: 12 } };

function onBoard(creature: Creature, id: string): Combatant {
  return {
    id, name: creature.name, creature, isPC: false, isAlly: false, initiative: null, currentHP: 20, maxHP: 20,
    tempHP: 0, conditions: [], isElite: false, isWeak: false, notes: '', isDefeated: false,
  };
}
/** Pick an image in the open stat block's Upload Image input and let the FileReader finish. */
async function uploadImage(): Promise<void> {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('no image input');
  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'test.png', { type: 'image/png' })] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

function seed(list: unknown): string {
  const text = typeof list === 'string' ? list : JSON.stringify(list);
  localStorage.setItem(KEY, text);
  reloadCustomCreatures();
  return text;
}
const stored = () => localStorage.getItem(KEY);

// ── Browser bits jsdom lacks, and the tracker's /data files (an empty bestiary; every other file 404s,
//    which each loader degrades to an empty map) ──────────────────────────────────────────────────────
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
(globalThis as Record<string, unknown>).ResizeObserver ??= NoopObserver;
(globalThis as Record<string, unknown>).IntersectionObserver ??= NoopObserver;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
window.matchMedia = ((q: string) => ({
  matches: false, media: q, onchange: null,
  addListener: () => undefined, removeListener: () => undefined,
  addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
})) as typeof window.matchMedia;
vi.stubGlobal('fetch', async (url: string) =>
  String(url).endsWith('/data/index.json')
    ? { ok: true, status: 200, json: async () => [] }
    : { ok: false, status: 404, json: async () => ({}) });
vi.spyOn(console, 'error').mockImplementation(() => undefined);

// ── Render plumbing: a boundary that records what a surface threw ──────────────────────────────────
class Catch extends Component<{ children: ReactNode; onError: (e: Error) => void }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { this.props.onError(err); }
  render() { return this.state.err ? null : this.props.children; }
}

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let caught: string[] = [];

async function mount(el: ReactNode): Promise<void> {
  if (root) {
    await act(async () => { root!.unmount(); });
    host?.remove();
  }
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<Catch onError={(e) => caught.push(e.message)}>{el}</Catch>); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
}

function outputBox(): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Parsed JSON"]');
  if (!el) throw new Error('no JSON output box');
  return el;
}
async function typeInto(el: HTMLTextAreaElement, value: string): Promise<void> {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(label: string): Promise<void> {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === label);
  if (!b) throw new Error(`no "${label}" button`);
  await act(async () => { b.click(); });
}

beforeEach(() => {
  localStorage.clear();
  reloadCustomCreatures();
  useCombatStore.setState({ combatants: [] });
  cancelPersist();
  caught = [];
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = null;
  host = null;
  document.body.innerHTML = '';
  cancelPersist();
});

describe('a broken homebrew stat block is skipped, never a crash, never dropped', () => {
  it('(a) the list reads past the found [[{…}]] entry, a nameless object, null and a string', () => {
    seed([WRAPPED]);
    expect(loadCustomCreatures()).toEqual([]);

    seed(STORED);
    expect(loadCustomCreatures().map((c) => c.name)).toEqual(['Test Beast', 'Test Beast Mate']);

    // A stored value that is not a list at all is read as no creatures, not handed out as the list.
    seed('{"stray":true}');
    expect(loadCustomCreatures()).toEqual([]);
  });

  it('(a) the Add-combatants search renders past it and still lists the real creatures', async () => {
    seed(STORED);
    await mount(<GameDataProvider><MonsterSearch onClose={() => undefined} /></GameDataProvider>);
    expect(caught).toEqual([]);
    expect(document.body.textContent).toContain('Test Beast Mate');
  });

  it('(a) the Link-stat-block picker renders past it and still lists the real creatures', async () => {
    seed(STORED);
    await mount(<CreaturePickerModal onSelect={() => undefined} onClose={() => undefined} />);
    expect(caught).toEqual([]);
    expect(document.body.textContent).toContain('Test Beast Mate');
  });

  it('(a) an entry with a name but a field of the wrong type, or no id of its own, is skipped as well', () => {
    seed([A, ...NAMED_BROKEN, B]);
    expect(loadCustomCreatures().map((c) => c.name)).toEqual(['Test Beast', 'Test Beast Mate']);

    // …and stays stored: a save writes it back, and a delete by its id cannot reach it.
    const C = beast('test-beast-c', 'Test Beast Pup');
    saveCustomCreature(C);
    expect(stored()).toBe(JSON.stringify([A, ...NAMED_BROKEN, B, C]));
    deleteCustomCreature('test-lone');
    deleteCustomCreature('test-raw-flat');
    expect(stored()).toBe(JSON.stringify([A, ...NAMED_BROKEN, B, C]));
  });

  it('(a) the Add-combatants search renders past every one of them with the saved trait filter on', async () => {
    seed([A, ...BROKEN, ...NAMED_BROKEN, B]);
    localStorage.setItem('pf2e-monster-search-state', TRAIT_FILTER_ON);
    await mount(<GameDataProvider><MonsterSearch onClose={() => undefined} /></GameDataProvider>);
    expect(caught).toEqual([]);
    expect(document.body.textContent).toContain('Test Beast Mate');
  });

  it('(a) the Link-stat-block picker renders past every one of them', async () => {
    seed([A, ...BROKEN, ...NAMED_BROKEN, B]);
    await mount(<CreaturePickerModal onSelect={() => undefined} onClose={() => undefined} />);
    expect(caught).toEqual([]);
    expect(document.body.textContent).toContain('Test Beast Mate');
  });

  it('(a) an imported encounter file still resolves a homebrew creature by name', async () => {
    seed(STORED);
    const r = await importEncountersFromText(JSON.stringify({
      version: 1, exportedAt: '2026-10-02T00:00:00.000Z',
      encounters: [{
        name: 'Test fight', savedAt: '2026-10-02T00:00:00.000Z',
        combatants: [{ name: 'Test Beast', creatureName: 'Test Beast', isPC: false, maxHP: 20, isElite: false, isWeak: false, notes: '' }],
      }],
    }));
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(readEncounterStore()['Test fight'].combatants[0].creature?.id).toBe(A.id);
  });

  it('(b) saving or deleting ANOTHER creature writes every broken entry back byte-for-byte', () => {
    seed(STORED);
    const C = beast('test-beast-c', 'Test Beast Pup');
    expect(saveCustomCreature(C)).toBe(true);
    expect(stored()).toBe(JSON.stringify([...STORED, C]));

    const A2 = { ...A, level: 4 };
    saveCustomCreature(A2);
    expect(stored()).toBe(JSON.stringify([A2, ...BROKEN, B, C]));

    deleteCustomCreature(B.id);
    expect(stored()).toBe(JSON.stringify([A2, ...BROKEN, C]));
    // Nothing lists a broken entry, so nothing deletes it either.
    deleteCustomCreature(NO_NAME.id);
    expect(stored()).toBe(JSON.stringify([A2, ...BROKEN, C]));

    reloadCustomCreatures();
    expect(loadCustomCreatures().map((c) => c.id)).toEqual([A.id, C.id]);
  });

  it('(b) the panel\'s Delete on a creature with no id removes nothing — it removed every id-less one', async () => {
    const before = seed([idless('Test Idless One'), idless('Test Idless Two'), A]);
    deleteCustomCreature(undefined as unknown as string);
    expect(stored()).toBe(before);

    // The panel opened on a board combatant carrying that creature (linked, or imported by name).
    await mount(<TextConverter existing={idless('Test Idless One') as unknown as Creature} onClose={() => undefined} />);
    await click('🗑 Delete');
    await click('Yes, Delete');
    expect(stored()).toBe(before);
  });

  it('(b) the panel\'s Overwrite on a creature with no id saves a new entry, never over every id-less one', async () => {
    const I1 = idless('Test Idless One');
    const I2 = idless('Test Idless Two');
    seed([I1, I2, A]);
    await mount(<TextConverter existing={I1 as unknown as Creature} onClose={() => undefined} />);
    await typeInto(outputBox(), JSON.stringify({ ...I1, level: 5 }, null, 2));
    await click('Save Changes…');
    await click('Overwrite "Test Idless One"');
    const list = JSON.parse(stored()!) as Record<string, unknown>[];
    expect(JSON.stringify(list.slice(0, 3))).toBe(JSON.stringify([I1, I2, A]));
    expect(list).toHaveLength(4);
    expect(list[3]).toMatchObject({ name: 'Test Idless One', level: 5 });
    expect(typeof list[3].id === 'string' && list[3].id !== '').toBe(true);
  });

  it('(b) a stored value that is not a list is kept, as an entry, when a creature is saved', () => {
    seed('{"stray":true}');
    saveCustomCreature(A);
    expect(stored()).toBe(JSON.stringify([{ stray: true }, A]));

    seed('not json{');
    saveCustomCreature(A);
    expect(stored()).toBe(JSON.stringify(['not json{', A]));
  });

  it('(b) a merge keeps an entry with no id — a merge-import or the GM mirror\'s first contact dropped it', () => {
    const local = JSON.stringify([A, WRAPPED]);
    const cloud = JSON.stringify([B, WRAPPED, 'a stray string']);
    // Both sides' copies of the same broken entry come out as one.
    expect(JSON.parse(mergeValue(KEY, cloud, local))).toEqual([B, WRAPPED, 'a stray string', A]);
  });

  it('(b) a merge keeps every copy of a broken entry, and a side whose value is not a list', () => {
    // Two copies on one side stay two; the same entry on the other side adds none.
    expect(JSON.parse(mergeValue(KEY, '[]', JSON.stringify([null, null, A])))).toEqual([null, null, A]);
    expect(JSON.parse(mergeValue(KEY, JSON.stringify([WRAPPED]), JSON.stringify([WRAPPED, WRAPPED]))))
      .toEqual([WRAPPED, WRAPPED]);
    // First contact merges (cloud, this device): neither side is written over for not being a list.
    expect(JSON.parse(mergeValue(KEY, JSON.stringify([B]), '{"stray":true}'))).toEqual([B, { stray: true }]);
    expect(JSON.parse(mergeValue(KEY, '{"cloudStray":true}', JSON.stringify([A, B]))))
      .toEqual([{ cloudStray: true }, A, B]);
    expect(JSON.parse(mergeValue(KEY, 'not json{', JSON.stringify([A])))).toEqual(['not json{', A]);
  });

  it('(b) the cloud\'s copy of a broken entry, keys re-ordered by jsonb, merges with this device\'s as one', () => {
    // gm_tracker_state.value is jsonb: every object comes back with its keys in Postgres's order, so the
    // same entry never had the same text on both sides and first contact stored it twice.
    const reorder = (v: unknown): unknown => Array.isArray(v) ? v.map(reorder)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).reverse().map(k => [k, reorder((v as Record<string, unknown>)[k])]))
        : v;
    const cloud = JSON.stringify(reorder([B, WRAPPED, NO_NAME]));
    expect(cloud).not.toBe(JSON.stringify([B, WRAPPED, NO_NAME]));
    const merged = JSON.parse(mergeValue(KEY, cloud, JSON.stringify([A, WRAPPED, NO_NAME]))) as unknown[];
    expect(merged).toHaveLength(4);
    expect(merged).toEqual([B, WRAPPED, NO_NAME, A]);
  });

  it('(b) only this list keeps them — a merge still drops a party with no id, or zero parties load', () => {
    const P = { id: 'test-party', name: 'Test Party', level: 1, players: [], isFavorite: false };
    localStorage.setItem('pf2e-parties', JSON.stringify([P]));
    applyBackup({ 'pf2e-parties': JSON.stringify([null]) }, 'merge');
    usePartyStore.getState().reloadFromStorage();
    expect(usePartyStore.getState().parties.map((p) => p.name)).toEqual(['Test Party']);
  });

  it('(c) JSON pasted as a LIST into the custom-creature panel is refused, never stored as [[{…}]]', async () => {
    const onClose = vi.fn();
    await mount(<TextConverter onClose={onClose} />);
    await typeInto(outputBox(), JSON.stringify(WRAPPED, null, 2));

    await click('Save to Homebrew');
    expect(stored()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('not a stat block');

    await click('Save & Add to Encounter');
    expect(stored()).toBeNull();
    expect(useCombatStore.getState().combatants).toHaveLength(0);
    expect(caught).toEqual([]);
  });

  it('(c) a name and nothing else, or a raw bestiary entry, is refused with the reason', async () => {
    await mount(<TextConverter onClose={() => undefined} />);
    await typeInto(outputBox(), JSON.stringify({ name: 'Test Lone' }));
    await click('Save to Homebrew');
    expect(stored()).toBeNull();
    expect(document.body.textContent).toContain('"traits" must be a list of words');

    await typeInto(outputBox(), JSON.stringify(RAW_BEAST, null, 2));
    await click('Save to Homebrew');
    expect(stored()).toBeNull();
    expect(document.body.textContent).toContain('"perception" must be a number');
  });

  it('(c) with Preview on a refused save says why, and a block the renderer chokes on fails in the preview only', async () => {
    await mount(<GameDataProvider><TextConverter onClose={() => undefined} /></GameDataProvider>);
    await typeInto(outputBox(), JSON.stringify(WRAPPED, null, 2));
    await click('👁 Preview');
    await click('Save to Homebrew');
    expect(stored()).toBeNull();
    expect(document.body.textContent).toContain('That JSON is not a stat block: paste one creature, not a list.');
    expect(document.body.textContent).toContain('Not a stat block — cannot preview');

    // A real stat block previews…
    await click('{ } JSON');
    await typeInto(outputBox(), JSON.stringify(B, null, 2));
    await click('👁 Preview');
    expect(document.body.textContent).not.toContain('Something went wrong');
    expect(document.body.textContent).toContain('Perception +6');
    // …a sense that isn't text (it passed the old check and broke the renderer) is refused up front…
    await click('{ } JSON');
    await typeInto(outputBox(), JSON.stringify({ ...B, senses: [5] }, null, 2));
    await click('👁 Preview');
    expect(document.body.textContent).toContain('Not a stat block — cannot preview');
    // …and a renderer failure nothing could foresee stays in the pane.
    // (jsdom echoes the error the pane's boundary caught to the console; cancelling it keeps the log clean.)
    const quiet = (e: ErrorEvent) => e.preventDefault();
    window.addEventListener('error', quiet);
    try {
      await click('{ } JSON');
      await typeInto(outputBox(), JSON.stringify({ ...B, name: 'Test Renderer Trap' }, null, 2));
      await click('👁 Preview');
    } finally {
      window.removeEventListener('error', quiet);
    }
    expect(document.body.textContent).toContain('Something went wrong in this preview');
    expect(caught).toEqual([]);
  });

  it('(c) the builder never seeds itself from a paste that is not a stat block', async () => {
    await mount(<TextConverter onClose={() => undefined} />);
    await typeInto(outputBox(), JSON.stringify(RAW_BEAST, null, 2));
    await click('Builder');
    expect(caught).toEqual([]);
  });

  it('(c) the panel\'s Import JSON reads a backup whose homebrew value is not a list, without throwing', () => {
    const backup = (value: unknown) => JSON.stringify({ kind: 'pf2e-full-backup', data: { [KEY]: JSON.stringify(value) } });
    expect(parseCreaturesFromText(backup({ stray: true }))).toMatchObject({ ok: false, creatures: [] });
    const one = parseCreaturesFromText(backup(B));
    expect(one.ok).toBe(true);
    expect(one.creatures.map((c) => c.name)).toEqual(['Test Beast Mate']);
  });

  it('(c) saveCustomCreature itself refuses anything that is not a stat block — the backstop for every caller', () => {
    const before = seed([A]);
    for (const bad of [...BROKEN, ...NAMED_BROKEN]) {
      const ok = saveCustomCreature(bad as Creature);
      expect(stored()).toBe(before);
      expect(ok).toBe(false);
    }
    expect(loadCustomCreatures().map((c) => c.name)).toEqual(['Test Beast']);
  });

  it('(b)(c) with the broken entry stored, the panel still saves a real creature and writes the broken one back', async () => {
    seed([WRAPPED]);
    const onClose = vi.fn();
    await mount(<TextConverter onClose={onClose} />);
    await typeInto(outputBox(), JSON.stringify(B, null, 2));
    await click('Save to Homebrew');
    expect(stored()).toBe(JSON.stringify([WRAPPED, B]));
    expect(onClose).toHaveBeenCalled();
  });

  it('(d) a thin stat block saved from the panel works on the board — Elite XP and the stat block', async () => {
    await mount(<TextConverter onClose={() => undefined} />);
    await typeInto(outputBox(), JSON.stringify({ name: 'Test Thin', traits: ['beast'], defenses: { hp: 12 } }));
    await click('Save & Add to Encounter');
    const filled = { skills: {}, senses: [], languages: [], items: [], speed: {}, attacks: [], spellcasting: [], abilities: [] };
    expect(JSON.parse(stored()!)[0]).toMatchObject({ name: 'Test Thin', ...filled });
    const [c] = useCombatStore.getState().combatants;
    expect(c.creature).toMatchObject(filled);

    useCombatStore.getState().setEliteWeak(c.id, 'elite');
    await mount(<GameDataProvider><InitiativeTracker /></GameDataProvider>);
    expect(caught).toEqual([]);
    await mount(<GameDataProvider><CombatantDetail combatant={useCombatStore.getState().combatants[0]} /></GameDataProvider>);
    expect(caught).toEqual([]);
    expect(document.body.textContent).toContain('Test Thin');
  });

  it('(d) an encounter file naming a thin stored homebrew creature as Elite loads onto a working board', async () => {
    seed([THIN]);
    const r = await importEncountersFromText(JSON.stringify({
      version: 1, exportedAt: '2026-10-02T00:00:00.000Z',
      encounters: [{
        name: 'Test thin fight', savedAt: '2026-10-02T00:00:00.000Z',
        combatants: [{ name: 'Test Thin', creatureName: 'Test Thin', isPC: false, maxHP: 12, isElite: true, isWeak: false, notes: '' }],
      }],
    }));
    expect(r.ok).toBe(true);
    useCombatStore.getState().loadEncounter('Test thin fight', new Map());
    expect(useCombatStore.getState().combatants[0].isElite).toBe(true);
    await mount(<GameDataProvider><InitiativeTracker /></GameDataProvider>);
    expect(caught).toEqual([]);
    // Read with its missing fields filled in; stored exactly as it was.
    expect(stored()).toBe(JSON.stringify([THIN]));
  });

  it('(d) a field of the wrong type anywhere in the block is refused with the reason, and skipped when stored', async () => {
    const LANG = { ...B, id: 'test-lang', name: 'Test Lang', languages: 'Common' };
    const ATTACK = { ...B, id: 'test-attack', name: 'Test Attack', attacks: [{ name: 'jaws', attack: 9, damage: 5 }] };
    const before = seed([A, LANG, ATTACK]);
    expect(loadCustomCreatures().map((c) => c.id)).toEqual([A.id]);

    await mount(<TextConverter onClose={() => undefined} />);
    await typeInto(outputBox(), JSON.stringify({ ...LANG, id: 'test-lang-2', name: 'Test Lang Two' }, null, 2));
    await click('Save to Homebrew');
    expect(document.body.textContent).toContain('"languages" must be a list of words');
    await typeInto(outputBox(), JSON.stringify({ ...ATTACK, id: 'test-attack-2', name: 'Test Attack Two' }, null, 2));
    await click('Save to Homebrew');
    expect(document.body.textContent).toContain('"attacks[0].damage" must be text');
    expect(stored()).toBe(before);
  });

  it('(d) Import JSON fills in a thin attack and refuses one of the wrong shape, with the reason', () => {
    const ok = parseCreaturesFromText(JSON.stringify({ ...B, attacks: [{ name: 'jaws', attack: 9, damage: '1d8' }] }));
    expect(ok.ok).toBe(true);
    expect(ok.creatures[0].attacks[0]).toMatchObject({ traits: [], types: [], effects: [], isAgile: false });
    const bad = parseCreaturesFromText(JSON.stringify({ ...B, attacks: [{ name: 'jaws', attack: '+9' }] }));
    expect(bad).toMatchObject({ ok: false, creatures: [] });
    expect(bad.error).toContain('"attacks[0].attack" must be a number');
  });

  it('(d) Import JSON names a refused creature even when others in the file loaded — it left it out silently', () => {
    const both = parseCreaturesFromText(JSON.stringify([A, { ...B, attacks: [{ name: 'jaws', attack: '+9' }] }]));
    expect(both.ok).toBe(true);
    expect(both.creatures.map(c => c.name)).toEqual(['Test Beast']);
    expect(both.skipped).toEqual(['"Test Beast Mate": "attacks[0].attack" must be a number']);
    expect(parseCreaturesFromText(JSON.stringify([A, B])).skipped).toBeUndefined();
    // A named creature that is not creature-shaped at all (no defenses block) is named too; junk is not.
    const lone = parseCreaturesFromText(JSON.stringify([A, { id: 'test-lone', name: 'Test Lone', traits: ['beast'] }, null]));
    expect(lone.skipped).toEqual(['"Test Lone": it needs a "defenses" block']);
    // A file where nothing loads names every refused creature, not just the first.
    const none = parseCreaturesFromText(JSON.stringify([
      { ...A, name: 'Test X', attacks: [{ name: 'jaws', attack: '+9' }] },
      { ...B, name: 'Test Y', attacks: [{ name: 'claw', attack: '+7' }] },
    ]));
    expect(none.ok).toBe(false);
    expect(none.skipped).toHaveLength(2);
    expect(none.error).toContain('"Test X"');
    expect(none.error).toContain('"Test Y"');
  });

  it('(d) the panel\'s Import JSON lists every creature and file left out, across files, in one sentence', async () => {
    const files = [
      new File([JSON.stringify([A])], 'one.json'),
      new File([JSON.stringify([
        { ...A, name: 'Test X', attacks: [{ name: 'jaws', attack: '+9' }] },
        { ...B, name: 'Test Y', attacks: [{ name: 'claw', attack: '+7' }] },
      ])], 'two.json'),
      new File(['not json{'], 'three.json'),
    ];
    const make = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = make(tag);
      if (tag === 'input') {
        Object.defineProperty(el, 'files', { value: files });
        (el as HTMLInputElement).click = () => { void (el as HTMLInputElement).onchange?.(new Event('change')); };
      }
      return el;
    }) as typeof document.createElement);
    try {
      await mount(<TextConverter onClose={() => undefined} />);
      await click('Import JSON');
      for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    } finally {
      spy.mockRestore();
    }
    const msg = [...document.querySelectorAll('span')].find((s) => s.textContent?.startsWith('Loaded "'))?.textContent ?? '';
    expect(msg).toContain('Loaded "Test Beast" for review');
    expect(msg).toContain('Not loaded (3): "Test X": "attacks[0].attack" must be a number; "Test Y": ');
    expect(msg).toContain('three.json: That file is not valid JSON.');
    expect(msg).not.toContain('..');
    expect(caught).toEqual([]);
  });

  it('(d) Import JSON across files where nothing loads names every creature and file, not just the last error', async () => {
    const files = [
      new File(['not json{'], 'one.json'),
      new File([JSON.stringify([{ ...A, name: 'Test X', attacks: [{ name: 'jaws', attack: '+9' }] }])], 'two.json'),
    ];
    const make = document.createElement.bind(document);
    const spy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = make(tag);
      if (tag === 'input') {
        Object.defineProperty(el, 'files', { value: files });
        (el as HTMLInputElement).click = () => { void (el as HTMLInputElement).onchange?.(new Event('change')); };
      }
      return el;
    }) as typeof document.createElement);
    try {
      await mount(<TextConverter onClose={() => undefined} />);
      await click('Import JSON');
      for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    } finally {
      spy.mockRestore();
    }
    const msg = [...document.querySelectorAll('span')].find((s) => s.textContent?.startsWith('Nothing loaded'))?.textContent;
    expect(msg).toBe('Nothing loaded: one.json: That file is not valid JSON; "Test X": "attacks[0].attack" must be a number.');
    expect(stored()).toBeNull();
    expect(caught).toEqual([]);
  });

  it('(d) the Edit panel opens on a board creature the lists would skip, without crashing', async () => {
    await mount(<TextConverter existing={{ ...A, traits: undefined } as unknown as Creature} onClose={() => undefined} />);
    expect(caught).toEqual([]);
    expect(outputBox().value).toContain('Test Beast');
  });

  it('(e) Overwrite on a creature whose stored copy is skipped replaces that copy — one id, one entry', async () => {
    seed([A, OLD, B]);
    await mount(<TextConverter existing={OLD} onClose={() => undefined} />);
    const FIXED = { ...OLD, level: 3 };
    await typeInto(outputBox(), JSON.stringify(FIXED, null, 2));
    await click('Save Changes…');
    await click('Overwrite "Test Old"');
    expect(stored()).toBe(JSON.stringify([A, FIXED, B]));
    expect(loadCustomCreatures().map((c) => c.id)).toEqual([A.id, OLD.id, B.id]);
  });

  it('(e) a merge keeps two entries that share an id on one side — it kept only one of them', () => {
    const FIXED = { ...OLD, level: 3 };
    const OLD2 = { ...OLD, level: 'three' };
    const A4 = { ...A, level: 4 };
    expect(JSON.parse(mergeValue(KEY, '[]', JSON.stringify([OLD, FIXED])))).toEqual([OLD, FIXED]);
    expect(JSON.parse(mergeValue(KEY, '[]', JSON.stringify([OLD, OLD2])))).toEqual([OLD, OLD2]);
    expect(JSON.parse(mergeValue(KEY, '[]', JSON.stringify([A, A4])))).toEqual([A, A4]);
    // Across the two sides a usable entry is still matched by its id, the incoming copy winning…
    expect(JSON.parse(mergeValue(KEY, JSON.stringify([A, B]), JSON.stringify([A4])))).toEqual([A4, B]);
    // …and a skipped entry neither displaces a usable one with its id nor is displaced by it.
    expect(JSON.parse(mergeValue(KEY, JSON.stringify([FIXED]), JSON.stringify([OLD])))).toEqual([FIXED, OLD]);
    expect(JSON.parse(mergeValue(KEY, JSON.stringify([OLD]), JSON.stringify([FIXED])))).toEqual([OLD, FIXED]);
  });

  it('(e) a NEW save of pasted JSON never takes another creature\'s id — a renamed copy replaced it', async () => {
    seed([A, OLD]);
    await mount(<TextConverter onClose={() => undefined} />);
    await typeInto(outputBox(), JSON.stringify({ ...A, name: 'Test Bravo' }, null, 2));
    await click('Save to Homebrew');
    let list = JSON.parse(stored()!) as Record<string, unknown>[];
    expect(JSON.stringify(list.slice(0, 2))).toBe(JSON.stringify([A, OLD]));
    expect(list[2]).toMatchObject({ name: 'Test Bravo' });

    // The same for a skipped entry's id (a corrected copy of it), through Save & Add.
    await mount(<TextConverter onClose={() => undefined} />);
    await typeInto(outputBox(), JSON.stringify({ ...OLD, name: 'Test Old Fixed', level: 3 }, null, 2));
    await click('Save & Add to Encounter');
    list = JSON.parse(stored()!) as Record<string, unknown>[];
    expect(JSON.stringify(list.slice(0, 2))).toBe(JSON.stringify([A, OLD]));
    expect(list[3]).toMatchObject({ name: 'Test Old Fixed', level: 3 });
    expect(new Set(list.map((e) => e.id)).size).toBe(4);
  });

  it('(e) an image upload goes onto the stored entry, never the board\'s older copy, and says so when it cannot', async () => {
    const A4 = { ...A, level: 4 };  // edited in the homebrew after the fight was set up
    seed([A4, OLD]);
    const ca = onBoard(A, 'test-combatant-a');  // the board still holds the level-1 copy
    useCombatStore.setState({ combatants: [ca] });
    await mount(<GameDataProvider><CombatantDetail combatant={ca} /></GameDataProvider>);
    await uploadImage();
    const list = JSON.parse(stored()!) as Record<string, unknown>[];
    expect(list[0]).toMatchObject({ id: A.id, level: 4 });
    expect(list[0].image).toMatch(/^data:image\/png/);
    expect(JSON.stringify(list.slice(1))).toBe(JSON.stringify([OLD]));

    // A creature whose stored copy is skipped: the board shows the image, the stored copy is left as it is.
    const before = stored();
    const co = onBoard({ ...OLD, level: 3 } as Creature, 'test-combatant-old');
    useCombatStore.setState({ combatants: [co] });
    await mount(<GameDataProvider><CombatantDetail combatant={co} /></GameDataProvider>);
    await uploadImage();
    expect(stored()).toBe(before);
    expect(useCombatStore.getState().combatants[0].creature?.image).toMatch(/^data:image\/png/);
    expect(document.body.textContent).toContain('Image shown on the board only: this creature\'s homebrew stat block can\'t be read');
    expect(caught).toEqual([]);
  });
});
