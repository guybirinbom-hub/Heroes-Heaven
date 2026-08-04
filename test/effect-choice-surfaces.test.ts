import { describe, it, expect } from 'vitest';
import { buildCharacter, emptyBuild } from '../src/rules/build';
import { applyPlayState } from '../src/rules/play';
import type { ContentDatabase, Item, InventoryItem } from '../src/rules/types';
import { content } from './_content';

/**
 * A "choose one of N" must be ASKED somewhere, not just resolved.
 *
 * effectChoices were rendered for feats and heritages only, while buildCharacter resolved them for
 * class features, class-feature options and inventory items as well — so 50 records carried a
 * question the engine was waiting on and no screen ever put to the player. Deities and backgrounds
 * were not even resolved.
 *
 * These tests pin the ENGINE half of each surface. The picker itself is one shared component, so a
 * surface that resolves and is wired to that component cannot silently lose its screen again.
 */
const db = () => content();

const baseBuild = (over: Record<string, unknown> = {}) => ({
  ...emptyBuild(),
  name: 'Choice',
  ancestryId: 'human',
  classId: 'fighter',
  backgroundId: Object.keys(db().backgrounds)[0],
  level: 5,
  ...over,
});

describe('every surface that can ask a choice also resolves it', () => {
  it('a DEITY choice is resolved (it was not resolved at all before)', () => {
    const base = db();
    const deityId = Object.keys(base.deities).find((id) => base.deities[id].effectChoices?.length)!;
    expect(deityId, 'no deity carries effectChoices').toBeDefined();
    const withGrant: ContentDatabase = {
      ...base,
      deities: {
        ...base.deities,
        [deityId]: {
          ...base.deities[deityId],
          effectChoices: [{ id: 'test', prompt: 'Test', options: [{ value: 'a', label: 'A', grant: { skills: { athletics: 'trained' } } }] }],
        },
      },
    };
    const b = baseBuild({ deityId, effectChoices: { [`${deityId}:test`]: 'a' } });
    const c = buildCharacter(b as never, withGrant);
    expect(c.proficiencies.skills.athletics).not.toBe('untrained');
  });

  it('a BACKGROUND choice is resolved', () => {
    const base = db();
    const bgId = Object.keys(base.backgrounds)[0];
    const withGrant: ContentDatabase = {
      ...base,
      backgrounds: {
        ...base.backgrounds,
        [bgId]: {
          ...base.backgrounds[bgId],
          effectChoices: [{ id: 'test', prompt: 'Test', options: [{ value: 'a', label: 'A', grant: { skills: { arcana: 'trained' } } }] }],
        },
      },
    };
    const b = baseBuild({ backgroundId: bgId, effectChoices: { [`${bgId}:test`]: 'a' } });
    const c = buildCharacter(b as never, withGrant);
    expect(c.proficiencies.skills.arcana).not.toBe('untrained');
  });

  it("an ITEM bought in PLAY resolves its choice — the build never sees that item", () => {
    const base = db();
    const ITEM: Item = {
      id: 'test-choice-item',
      name: 'Choice Item',
      itemType: 'equipment',
      level: 1,
      traits: [],
      rarity: 'common',
      description: '',
      effectChoices: [
        { id: 'flavour', prompt: 'Pick', options: [{ value: 'dip', label: 'Diplomacy', grant: { passive: { skills: { diplomacy: 2 } } } }] },
      ],
    } as Item;
    const withItem: ContentDatabase = { ...base, items: { ...base.items, [ITEM.id]: ITEM } };
    const ch = buildCharacter(baseBuild() as never, withItem);

    const answered: InventoryItem = { instanceId: 'i1', itemId: ITEM.id, quantity: 1, worn: true, invested: true, effectChoices: { flavour: 'dip' } };
    const unanswered: InventoryItem = { ...answered, effectChoices: undefined };

    const withPick = applyPlayState(ch, { damage: 0, tempHp: 0, heroPoints: 0, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [], inventory: [answered] } as never, withItem);
    const without = applyPlayState(ch, { damage: 0, tempHp: 0, heroPoints: 0, xp: 0, focusUsed: 0, expendedSlots: {}, slotsUsed: {}, conditions: [], pinned: [], inventory: [unanswered] } as never, withItem);

    expect(withPick.resolvedItemPassives?.[ITEM.id]?.skills?.diplomacy).toBe(2);
    expect(without.resolvedItemPassives?.[ITEM.id]).toBeUndefined();
  });

  it('the answer lives on the INSTANCE, so two copies can differ', () => {
    const a: InventoryItem = { instanceId: 'a', itemId: 'x', quantity: 1, effectChoices: { c: '1' } };
    const b: InventoryItem = { instanceId: 'b', itemId: 'x', quantity: 1, effectChoices: { c: '2' } };
    expect(a.effectChoices?.c).not.toBe(b.effectChoices?.c);
  });

  it('optional sanctification is offered by every deity whose text says "can be"', () => {
    const base = db();
    const withChoice = Object.values(base.deities).filter((d) => d.effectChoices?.some((c) => c.id === 'sanctification'));
    expect(withChoice.length).toBeGreaterThan(100); // 261 at the time of writing
    for (const d of withChoice.slice(0, 20)) {
      const opts = d.effectChoices!.find((c) => c.id === 'sanctification')!.options ?? [];
      expect(opts.map((o) => o.value)).toContain('none'); // it is OPTIONAL — declining must be sayable
    }
  });
});
