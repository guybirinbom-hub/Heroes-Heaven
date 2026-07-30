import { describe, it, expect } from 'vitest';
import { poolSituationalLines, type SituationalLine } from '../src/rules/situationalBonuses';
import { explainStat } from '../src/rules/explain';
import type { Character, Item, ContentDatabase, ModeDef } from '../src/rules/types';
import { content, build } from './_content';

const line = (source: string, bonus: string, when: string): SituationalLine => ({ source, bonus, when });
const sources = (ls: SituationalLine[]) => ls.map((l) => l.source);

describe('same type, same trigger — only the best survives', () => {
  it('a +1 item and a +2 item on the same trigger collapse to the +2', () => {
    // The owner's example, verbatim: "if i have +1 item bonus and a +2 item bonus it will only show
    // the +2". Two lines read as +3 to a player; the total was only ever +2.
    const out = poolSituationalLines([line('Ring', '+1 item', 'while hiding'), line('Cloak', '+2 item', 'while hiding')]);
    expect(sources(out)).toEqual(['Cloak']);
  });

  it('order does not decide the winner', () => {
    const out = poolSituationalLines([line('Cloak', '+2 item', 'while hiding'), line('Ring', '+1 item', 'while hiding')]);
    expect(sources(out)).toEqual(['Cloak']);
  });

  it('penalties follow the same rule, worst-wins', () => {
    const out = poolSituationalLines([line('A', '-1 status', 'when frightened'), line('B', '-2 status', 'when frightened')]);
    expect(sources(out)).toEqual(['B']);
  });

  it('a bonus and a penalty of the same type both survive — they both apply', () => {
    const out = poolSituationalLines([line('Good', '+2 item', 'in dim light'), line('Bad', '-1 item', 'in dim light')]);
    expect(sources(out).sort()).toEqual(['Bad', 'Good']);
  });

  it('trigger text compares loosely enough to be useful', () => {
    // Case and trailing punctuation are noise, not a difference in meaning.
    const out = poolSituationalLines([line('A', '+1 item', 'Against Undead.'), line('B', '+2 item', 'against undead')]);
    expect(sources(out)).toEqual(['B']);
  });
});

describe('anything else shows both', () => {
  it('different triggers both show, even at the same type', () => {
    // The amended ruling: "show both if the string doesn't match." No attempt is made to reason about
    // whether two differently-worded triggers could overlap — the player decides at the table.
    const out = poolSituationalLines([line('A', '+1 item', 'while hiding'), line('B', '+2 item', 'against undead')]);
    expect(sources(out).sort()).toEqual(['A', 'B']);
  });

  it('different types both show — they stack', () => {
    const out = poolSituationalLines([line('A', '+1 item', 'while hiding'), line('B', '+2 status', 'while hiding')]);
    expect(sources(out).sort()).toEqual(['A', 'B']);
  });

  it('untyped bonuses never supersede one another — they sum', () => {
    const out = poolSituationalLines([line('A', '+1 untyped', 'while hiding'), line('B', '+2 untyped', 'while hiding')]);
    expect(sources(out).sort()).toEqual(['A', 'B']);
    // A bonus with no type word is untyped too.
    expect(poolSituationalLines([line('A', '+1', 'x'), line('B', '+2', 'x')])).toHaveLength(2);
  });

  it('a bonus with no number is never pooled away', () => {
    // "roll d10s instead of d8s" has no magnitude to compare, so nothing can supersede it.
    const out = poolSituationalLines([
      line('Magic Hands', 'roll d10s instead of d8s', 'when you Treat Wounds'),
      line('Other', '+2 item', 'when you Treat Wounds'),
    ]);
    expect(sources(out).sort()).toEqual(['Magic Hands', 'Other']);
  });

  it('an empty list stays empty and a single line is untouched', () => {
    expect(poolSituationalLines([])).toEqual([]);
    const one = [line('A', '+1 item', 'x')];
    expect(poolSituationalLines(one)).toEqual(one);
  });
});

describe('the rule reaches the real star list', () => {
  // Not a unit of the pooler — the whole path, through explainStat, across BOTH lanes: an active
  // mode's conditional modifier and an item's registry entry are the same thing to a player, so they
  // have to pool against each other.
  const ITEM: Item = {
    id: 'custom-stack-charm',
    name: 'Stack Charm',
    itemType: 'equipment',
    level: 1,
    traits: [],
    rarity: 'common',
    description: '',
    situational: [{ targets: [{ kind: 'skill', detail: 'stealth' }], when: 'while sneaking', bonus: '+3 status' }],
  };
  const db = (): ContentDatabase => {
    const base = content();
    return { ...base, items: { ...base.items, [ITEM.id]: ITEM } };
  };
  const mode = (value: number): ModeDef => ({
    id: 'm',
    name: 'Big Mode',
    modifiers: [{ value, type: 'status', target: 'skill', detail: 'stealth', appliesWhen: 'while sneaking' }],
  });
  const ch = (m: ModeDef): Character => ({
    ...build('fighter', 5),
    inventory: [{ instanceId: 'i1', itemId: ITEM.id, quantity: 1, invested: true }],
    activeModes: [m],
  });

  it('a stronger mode supersedes an item entry on the same trigger', () => {
    const lines = (explainStat(ch(mode(5)), db(), { kind: 'skill', skill: 'stealth' }).situational ?? []).map((s) => s.text);
    expect(lines.filter((l) => /while sneaking/.test(l))).toEqual(['+5 status from Big Mode — while sneaking']);
  });

  it('a weaker mode is superseded by the item entry', () => {
    const lines = (explainStat(ch(mode(1)), db(), { kind: 'skill', skill: 'stealth' }).situational ?? []).map((s) => s.text);
    expect(lines.filter((l) => /while sneaking/.test(l))).toEqual(['+3 status from Stack Charm — while sneaking']);
  });

  it('an exact tie keeps one line, not two', () => {
    // Equal magnitude of the same type on the same trigger: you get one of them, so one line. Which
    // name survives is arbitrary — that two lines would read as +6 is not.
    const lines = (explainStat(ch(mode(3)), db(), { kind: 'skill', skill: 'stealth' }).situational ?? []).map((s) => s.text);
    expect(lines.filter((l) => /while sneaking/.test(l))).toHaveLength(1);
  });

  it('a different trigger keeps both lines', () => {
    const other: ModeDef = {
      id: 'm2',
      name: 'Other Mode',
      modifiers: [{ value: 2, type: 'status', target: 'skill', detail: 'stealth', appliesWhen: 'in darkness' }],
    };
    const lines = (explainStat(ch(other), db(), { kind: 'skill', skill: 'stealth' }).situational ?? []).map((s) => s.text);
    expect(lines.some((l) => /Other Mode/.test(l))).toBe(true);
    expect(lines.some((l) => /Stack Charm/.test(l))).toBe(true);
  });
});
