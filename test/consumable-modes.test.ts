import { describe, it, expect } from 'vitest';
import { modeRelevant, activeModesTouch, modeTargetLabel, playerModeLibrary } from '../src/rules/modes';
import { statHasActiveMode, statMarkClass } from '../src/rules/explain';
import { useConsumable, rest, addInventoryItem, type PlayState } from '../src/rules/play';
import type { ModeDef } from '../src/rules/types';
import { content, build } from './_content';

const itemModes = (): ModeDef[] =>
  Object.values(content().modes).filter((m) => m.fromItemId) as ModeDef[];

const SKILLS = new Set([
  'acrobatics', 'arcana', 'athletics', 'crafting', 'deception', 'diplomacy', 'intimidation',
  'medicine', 'nature', 'occultism', 'performance', 'religion', 'society', 'stealth', 'survival', 'thievery',
]);

describe('consumable modes: the data', () => {
  it('ships one mode per consumable that changes you for a stated span of time', () => {
    // Not a floor pulled from thin air: the extraction pass covered 231 consumables whose text pairs
    // a duration with a typed bonus, and 211 of them survived the verify pass as real modes. Ruling F
    // then added 12 more — items whose benefit goes to an ALLY for a stated time, where the activator
    // gets a display-only pill so they can see it is running.
    // +65 from the deferred-toggle pass, once a mode could carry resistances/immunities/senses rather
    // than only numeric check bonuses — activated items whose effect is "resistance 5 to fire for 1
    // minute", or a sense, which previously had nowhere to live at all.
    // +12 once a mode could also carry a SPEED: four activated fly items, plus the eight siccatite
    // shield variants (two per shield — the resistance type depends on hot vs cold siccatite, which
    // the item record does not state, so the player switches on the one matching their shield).
    // +10 for Emotion Surge: the relic's emotion decides which of ten skills gets the bonus, and the
    // item record never says which emotion a given relic has — so, like the siccatite shields, one
    // mode per emotion and the player switches on the true one.
    // +19 from the full item audit (2026-08-04): items that had never been examined at all, whose
    // text pairs an activation with a stated span — the same shape as every entry above, found by
    // selecting on what the record HAS rather than on whether its wording matched a pattern.
    expect(itemModes().length).toBe(329);
  });

  it('every item mode points at an item that actually exists', () => {
    const items = content().items;
    const orphans = itemModes().filter((m) => !items[m.fromItemId!]).map((m) => m.id);
    expect(orphans).toEqual([]);
  });

  it('every item mode says how long it lasts', () => {
    // A mode with no duration is indistinguishable from a permanent one, and the whole point of an
    // elixir is that it wears off.
    expect(itemModes().filter((m) => !m.duration).map((m) => m.id)).toEqual([]);
  });

  it('no skill or save modifier names a target the engine does not have', () => {
    const bad: string[] = [];
    for (const m of itemModes()) {
      for (const mod of m.modifiers) {
        if (mod.target === 'skill' && mod.detail && !SKILLS.has(mod.detail)) bad.push(`${m.id}: ${mod.detail}`);
        if (mod.target === 'save' && mod.detail && !['fortitude', 'reflex', 'will'].includes(mod.detail))
          bad.push(`${m.id}: ${mod.detail}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('a detail-less skill modifier always carries a condition', () => {
    // modeMatches reads an absent `detail` as "every skill". That is only ever right for a bonus the
    // text itself spans across skills and narrows by situation instead ("checks to Recall
    // Knowledge") — so an unconditional one would silently buff all sixteen.
    const loose = itemModes().flatMap((m) =>
      m.modifiers.filter((mod) => mod.target === 'skill' && !mod.detail && !mod.appliesWhen).map(() => m.id),
    );
    expect(loose).toEqual([]);
  });

  it('every modifier has a real, non-zero value', () => {
    const bad = itemModes().flatMap((m) =>
      m.modifiers.filter((mod) => typeof mod.value !== 'number' || !mod.value).map(() => m.id),
    );
    expect(bad).toEqual([]);
  });

  it('a mode that moves no number still explains itself', () => {
    // These are the timed states with nothing to add up (concealment, a fly Speed, an immunity). The
    // note IS the mode, so one without a note would render as an empty pill.
    const silent = itemModes().filter((m) => !m.modifiers.length && !m.note).map((m) => m.id);
    expect(silent).toEqual([]);
  });
});

describe('consumable modes: hidden from the player list', () => {
  it('an item mode is never offered in the Modes panel', () => {
    // It belongs to its consumable — you get it by drinking the thing, not by picking it off a list.
    const offered = itemModes().filter((m) => modeRelevant(m, 'fighter', 'human', new Set())).map((m) => m.id);
    expect(offered).toEqual([]);
  });

  it('an item mode is not in the "your modes" library either', () => {
    // The leak modeRelevant did NOT cover: every screen listing "your modes" built its list from
    // content.modes by excluding only the hand-authored catalog, so all 211 item modes landed in the
    // player's own editable list — offering Edit and Delete on regenerated core data — and showed up
    // under search, which deliberately bypasses modeRelevant.
    const all = Object.values(content().modes) as ModeDef[];
    expect(all.some((m) => m.fromItemId)).toBe(true); // they are in content...
    expect(playerModeLibrary(all).some((m) => m.fromItemId)).toBe(false); // ...but never in the library
  });

  it('the library still keeps the player’s own modes', () => {
    const mine: ModeDef = { id: 'mine', name: 'Mine', modifiers: [] };
    const scoped: ModeDef = { id: 'scoped', name: 'Scoped', charId: 'c1', modifiers: [] };
    const other: ModeDef = { id: 'other', name: 'Other', charId: 'c2', modifiers: [] };
    const item: ModeDef = { id: 'i', name: 'I', fromItemId: 'x', modifiers: [] };
    expect(playerModeLibrary([mine, scoped, other, item], 'c1').map((m) => m.id)).toEqual(['mine', 'scoped']);
    expect(playerModeLibrary([mine, scoped, other, item]).map((m) => m.id)).toEqual(['mine', 'scoped', 'other']);
  });

  it('an ordinary catalog mode is still offered', () => {
    const ordinary = Object.values(content().modes).find((m) => !m.fromItemId && !m.classes && !m.ancestries && !m.feats);
    if (ordinary) expect(modeRelevant(ordinary as ModeDef, 'fighter', 'human', new Set())).toBe(true);
  });
});

describe('consumable modes: using one', () => {
  const bock = () => itemModes().find((m) => m.fromItemId === 'boulderhead-bock')!;

  const withBock = (qty: number): PlayState => {
    let play: PlayState = { inventory: [] };
    play = addInventoryItem(play, 'boulderhead-bock', { quantity: qty });
    return play;
  };

  it('drinking one drops the quantity and switches the mode on', () => {
    const play = withBock(2);
    const id = play.inventory![0].instanceId;
    const after = useConsumable(play, id, content().modes);
    expect(after.inventory![0].quantity).toBe(1);
    expect(after.activeModes).toContain(bock().id);
  });

  it('drinking the last one removes the item but leaves the mode running', () => {
    const play = withBock(1);
    const id = play.inventory![0].instanceId;
    const after = useConsumable(play, id, content().modes);
    expect(after.inventory).toHaveLength(0);
    expect(after.activeModes).toContain(bock().id);
  });

  it('a second dose does not toggle the first one back off', () => {
    const play = withBock(3);
    const id = play.inventory![0].instanceId;
    const after = useConsumable(useConsumable(play, id, content().modes), id, content().modes);
    expect(after.inventory![0].quantity).toBe(1);
    expect(after.activeModes).toEqual([bock().id]);
  });
});

describe('consumable modes: resting', () => {
  it('an item mode is gone after a rest', () => {
    const play: PlayState = { activeModes: [itemModes().find((m) => m.fromItemId === 'boulderhead-bock')!.id] };
    const after = rest(play, { level: 5, conMod: 2, modeDefs: content().modes });
    expect(after.activeModes).toEqual([]);
  });

  it('one that outlasts a night keeps running', () => {
    // An addiction suppressant runs for a full day, which genuinely spans a night's sleep.
    const day = itemModes().find((m) => m.survivesRest);
    expect(day).toBeTruthy();
    const after = rest({ activeModes: [day!.id] }, { level: 5, conMod: 2, modeDefs: content().modes });
    expect(after.activeModes).toEqual([day!.id]);
  });

  it('a mode the player toggled on themselves is untouched', () => {
    // Only ITEM modes clear — a stance or a class toggle is the player's own state to manage.
    const after = rest({ activeModes: ['cat-were-hybrid'] }, { level: 5, conMod: 2, modeDefs: content().modes });
    expect(after.activeModes).toEqual(['cat-were-hybrid']);
  });
});

describe('mode highlighting', () => {
  const ch = (modes: ModeDef[]) => ({ ...build('fighter', 5), activeModes: modes });

  it('an unconditional mode marks the stat it moves', () => {
    // This is the whole fix: before it, a mode raised your Perception and marked nothing, so there
    // was no way to tell which of your numbers a running mode was responsible for.
    const m: ModeDef = { id: 'x', name: 'X', modifiers: [{ value: 2, type: 'status', target: 'perception' }] };
    expect(statHasActiveMode(ch([m]), { kind: 'perception' })).toBe(true);
    expect(statHasActiveMode(ch([m]), { kind: 'ac' })).toBe(false);
  });

  it('the solid highlight and the situational star are separate marks', () => {
    const uncond: ModeDef = { id: 'u', name: 'U', modifiers: [{ value: 2, type: 'status', target: 'ac' }] };
    const cond: ModeDef = { id: 'c', name: 'C', modifiers: [{ value: 2, type: 'status', target: 'ac', appliesWhen: 'when prone' }] };
    // Unconditional: highlighted (the number moved) but NOT starred — a `*` promises a note worth
    // reading and there is none.
    expect(statMarkClass(ch([uncond]), { kind: 'ac' })).toBe(' mode-lit');
    // Conditional: starred (read the condition) and highlighted.
    expect(statMarkClass(ch([cond]), { kind: 'ac' })).toBe(' has-mode mode-lit');
    expect(statMarkClass(ch([]), { kind: 'ac' })).toBe('');
  });

  it('an all-checks mode highlights every check it actually moves', () => {
    const m: ModeDef = { id: 'h', name: 'Heroism', modifiers: [{ value: 1, type: 'status', target: 'all-checks' }] };
    expect(activeModesTouch([m], { kind: 'perception' })).toBe(true);
    expect(activeModesTouch([m], { kind: 'save', detail: 'will' })).toBe(true);
    expect(activeModesTouch([m], { kind: 'ac' })).toBe(false);
  });
});

describe('mode detail popup', () => {
  it('names the stat each modifier targets', () => {
    expect(modeTargetLabel({ value: 1, type: 'item', target: 'save', detail: 'fortitude' })).toBe('Fortitude');
    expect(modeTargetLabel({ value: 1, type: 'item', target: 'ac' })).toBe('AC');
    expect(modeTargetLabel({ value: 1, type: 'item', target: 'save' })).toBe('saves');
    expect(modeTargetLabel({ value: 1, type: 'item', target: 'spell-dc' })).toBe('Spell DC');
  });
});
