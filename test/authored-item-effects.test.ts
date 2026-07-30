import { describe, it, expect } from 'vitest';
import { statHasSituational, explainStat } from '../src/rules/explain';
import { deriveSkill, derivePerception, deriveAc, deriveSave } from '../src/rules/derive';
import type { Character, ContentDatabase, Item, SituationalBonus } from '../src/rules/types';
import { content, build } from './_content';

/** A copy of the content database with one extra item — how a homebrew/edited item reaches the app. */
function withItem(item: Item): ContentDatabase {
  const db = content();
  return { ...db, items: { ...db.items, [item.id]: item } };
}

const AUTHORED: Item = {
  id: 'custom-test-charm',
  name: 'Test Charm',
  itemType: 'equipment',
  level: 1,
  traits: [],
  rarity: 'common',
  description: '',
  situational: [
    { targets: [{ kind: 'skill', detail: 'stealth' }], when: 'in dim light', bonus: '+2 circumstance' },
    { targets: [{ kind: 'save', detail: 'all' }, { kind: 'perception' }], when: 'against undead', bonus: '+1 status' },
  ],
  passiveEffects: { ac: 1, skills: { athletics: 2 } },
};

/** The charm, in the character's hands and switched on (or not). */
function charWith(inUse: boolean, item: Item = AUTHORED): Character {
  const c = build('fighter', 5);
  return { ...c, inventory: [{ instanceId: 'i1', itemId: item.id, quantity: 1, invested: inUse }] };
}

describe('authored conditional effects reach the sheet', () => {
  const db = () => withItem(AUTHORED);

  it('stars every stat the authored entry names', () => {
    const c = charWith(true);
    expect(statHasSituational(c, { kind: 'skill', skill: 'stealth' }, db())).toBe(true);
    expect(statHasSituational(c, { kind: 'save', save: 'will' }, db())).toBe(true);
    expect(statHasSituational(c, { kind: 'save', save: 'fortitude' }, db())).toBe(true);
    expect(statHasSituational(c, { kind: 'perception' }, db())).toBe(true);
  });

  it('leaves stats it does not name alone', () => {
    const c = charWith(true);
    expect(statHasSituational(c, { kind: 'skill', skill: 'thievery' }, db())).toBe(false);
  });

  it('the trigger and the bonus are readable in the stat’s breakdown', () => {
    // A `*` with nothing behind it is worse than no `*` — the note is the whole payload.
    const lines = (explainStat(charWith(true), db(), { kind: 'skill', skill: 'stealth' }).situational ?? []).map((s) => s.text);
    expect(lines.join(' | ')).toContain('+2 circumstance from Test Charm — in dim light');
  });

  it('an item sitting in your pack grants nothing', () => {
    // Matches how shipped item bonuses behave: a charm you are not wearing is not a bonus you have.
    const c = charWith(false);
    expect(statHasSituational(c, { kind: 'skill', skill: 'stealth' }, db())).toBe(false);
    expect(explainStat(c, db(), { kind: 'skill', skill: 'stealth' }).situational ?? []).toEqual([]);
  });

  it('nothing authored is folded into the number', () => {
    // The point of the conditional lane: it only applies sometimes, so the total must not include it.
    const on = deriveSkill(charWith(true), 'stealth', db()).modifier;
    const off = deriveSkill(charWith(false), 'stealth', db()).modifier;
    expect(on).toBe(off);
  });
});

describe('authored always-on bonuses do change the number', () => {
  const db = () => withItem(AUTHORED);

  it('an item bonus to a skill lands in the total', () => {
    expect(deriveSkill(charWith(true), 'athletics', db()).modifier).toBe(deriveSkill(charWith(false), 'athletics', db()).modifier + 2);
  });

  it('an item bonus to AC lands in the total', () => {
    expect(deriveAc(charWith(true), db()).value).toBe(deriveAc(charWith(false), db()).value + 1);
  });

  it('a stat with no authored bonus is untouched', () => {
    expect(derivePerception(charWith(true), db()).modifier).toBe(derivePerception(charWith(false), db()).modifier);
  });
});

describe('a passive item bonus is explained, not just applied', () => {
  // Pre-existing gap the authored lane exposed: explain.ts never looked at passiveEffects, so ANY
  // worn magic item with one (Bracers of Armor, a Cloak of Elvenkind) moved the number while the
  // listed parts stayed the same — they stopped adding up to the total, with nothing to blame.
  const db = () => withItem(AUTHORED);
  const sum = (parts: { value: number }[]) => parts.reduce((n, p) => n + p.value, 0);

  it('AC lists the item and its parts add up', () => {
    const b = explainStat(charWith(true), db(), { kind: 'ac' });
    expect(b.parts.map((p) => p.label)).toContain('Test Charm');
    expect(sum(b.parts)).toBe(Number(b.totalText));
  });

  it('a skill lists the item and its parts add up', () => {
    const b = explainStat(charWith(true), db(), { kind: 'skill', skill: 'athletics' });
    expect(b.parts.map((p) => p.label)).toContain('Test Charm');
    expect(sum(b.parts)).toBe(deriveSkill(charWith(true), 'athletics', db()).modifier);
  });

  it('saves list the item and their parts add up', () => {
    const item: Item = { ...AUTHORED, id: 'custom-save-charm', passiveEffects: { saves: 2 } };
    const d = withItem(item);
    const c = charWith(true, item);
    const b = explainStat(c, d, { kind: 'save', save: 'will' });
    expect(b.parts.map((p) => p.label)).toContain('Test Charm');
    expect(sum(b.parts)).toBe(deriveSave(c, 'will', d).modifier);
  });

  it('Perception lists the item and its parts add up', () => {
    const item: Item = { ...AUTHORED, id: 'custom-perc-charm', passiveEffects: { perception: 2 } };
    const d = withItem(item);
    const c = charWith(true, item);
    const b = explainStat(c, d, { kind: 'perception' });
    expect(b.parts.map((p) => p.label)).toContain('Test Charm');
    expect(sum(b.parts)).toBe(derivePerception(c, d).modifier);
  });

  it('the item is not listed when it is only being carried', () => {
    const b = explainStat(charWith(false), db(), { kind: 'ac' });
    expect(b.parts.map((p) => p.label)).not.toContain('Test Charm');
    expect(sum(b.parts)).toBe(Number(b.totalText));
  });
});

describe('authored entries coexist with shipped ones', () => {
  it('an authored entry ADDS to an item’s shipped situational bonuses', () => {
    // Editing a shipped item is copy-on-write onto the same registry key in the general case; an
    // authored entry must never silently replace what the item already grants.
    const db = content();
    const shippedId = Object.keys(db.items).find((id) => {
      const c = { ...build('fighter', 5), inventory: [{ instanceId: 'i1', itemId: id, quantity: 1, invested: true }] };
      return statHasSituational(c as Character, { kind: 'perception' }, db);
    });
    expect(shippedId).toBeTruthy();

    const extra: SituationalBonus = {
      targets: [{ kind: 'skill', detail: 'thievery' }],
      when: 'my table lets this apply',
      bonus: '+1 circumstance',
    };
    const patched = withItem({ ...db.items[shippedId!], situational: [extra] });
    const c = charWith(true, patched.items[shippedId!]);
    // Both survive: the shipped Perception star AND the authored Thievery one.
    expect(statHasSituational(c, { kind: 'perception' }, patched)).toBe(true);
    expect(statHasSituational(c, { kind: 'skill', skill: 'thievery' }, patched)).toBe(true);
  });
});
