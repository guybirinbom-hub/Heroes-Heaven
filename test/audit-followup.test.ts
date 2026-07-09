import { describe, it, expect } from 'vitest';
import { build, firstSubclass, content } from './_content';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild } from '../src/rules/build';
import { deriveMaxHp, deriveStrikes, derivePerception, deriveSave } from '../src/rules/derive';
import { deriveFamiliar } from '../src/rules/companions';
import { skillActionsFor } from '../src/rules/skillActions';
import { explainStat } from '../src/rules/explain';
import { CATALOG_MODE_MAP } from '../src/rules/modes';
import { attachItem } from '../src/rules/play';
import type { ActiveCondition, InventoryItem } from '../src/rules/types';

describe('affixing a talisman from a stack peels off a single unit', () => {
  it('splits a quantity-3 stack into one affixed (qty 1) + a loose stack (qty 2)', () => {
    const play = {
      inventory: [
        { instanceId: 'inv-0', itemId: 'weapon-host', quantity: 1, equipped: true },
        { instanceId: 'inv-1', itemId: 'talisman', quantity: 3 },
      ],
    } as never;
    const next = attachItem(play, 'inv-1', 'inv-0');
    const loose = next.inventory.find((i) => i.instanceId === 'inv-1')!;
    const affixed = next.inventory.find((i) => i.attachedTo === 'inv-0')!;
    expect(loose.quantity).toBe(2);
    expect(affixed.quantity).toBe(1);
    expect(affixed.instanceId).not.toBe('inv-1');
  });

  it('flips the existing instance when quantity is 1 (no extra instance)', () => {
    const play = { inventory: [{ instanceId: 'inv-1', itemId: 'talisman', quantity: 1 }] } as never;
    const next = attachItem(play, 'inv-1', 'host');
    expect(next.inventory).toHaveLength(1);
    expect(next.inventory[0].attachedTo).toBe('host');
  });
});

describe('stat breakdowns reconcile — listed parts sum to the displayed total', () => {
  const sumParts = (b: { parts: { value: number }[] }) => b.parts.reduce((t, p) => t + (p.value ?? 0), 0);

  it('AC breakdown with a raised buckler shows +1 (not a flat +2) and reconciles', () => {
    const base = build('fighter', 1, { keyAbility: 'str' });
    const ch = {
      ...base,
      inventory: [{ instanceId: 's1', itemId: 'buckler', quantity: 1, equipped: true }],
      activeModes: [CATALOG_MODE_MAP['cat-raise-shield']],
    } as never;
    const b = explainStat(ch, content(), { kind: 'ac' });
    expect(sumParts(b)).toBe(Number(b.totalText));
    expect(b.parts.find((p) => /shield/i.test(p.label))?.value).toBe(1);
  });

  it('two same-type circumstance mode bonuses do not double-count', () => {
    const base = build('fighter', 5, { keyAbility: 'str' });
    const ch = { ...base, activeModes: [CATALOG_MODE_MAP['cat-take-cover'], CATALOG_MODE_MAP['cat-greater-cover']] } as never;
    const b = explainStat(ch, content(), { kind: 'ac' });
    expect(sumParts(b)).toBe(Number(b.totalText));
  });

  it('HP breakdown uses the higher Dual-Class per-level HP and reconciles', () => {
    const ch = build('wizard', 5, {
      variantRules: { dualClass: true },
      classId2: 'barbarian',
      subclassId2: firstSubclass('barbarian'),
    });
    const b = explainStat(ch, content(), { kind: 'hp' });
    expect(sumParts(b)).toBe(Number(b.totalText));
  });

  it('HP breakdown with a manual override shows a single reconciling part', () => {
    const base = build('fighter', 5);
    const ch = { ...base, hitPoints: { ...base.hitPoints, maxOverride: 99 } } as never;
    const b = explainStat(ch, content(), { kind: 'hp' });
    expect(b.totalText).toBe('99');
    expect(sumParts(b)).toBe(99);
  });
});

describe('familiar Tough ability raises HP to 7×level', () => {
  it('a familiar with Tough has 7×level HP (vs 5×level without)', () => {
    const ch = build('wizard', 5);
    const plain = deriveFamiliar({ id: 'f', kind: 'familiar', name: 'Owl' } as never, ch, content());
    const tough = deriveFamiliar({ id: 'f', kind: 'familiar', name: 'Owl', abilities: ['tough'] } as never, ch, content());
    expect(plain.hp).toBe(5 * 5);
    expect(tough.hp).toBe(7 * 5);
  });
});

describe('Demoralize is available untrained', () => {
  it('appears in the Intimidation actions for an untrained character', () => {
    const actions = skillActionsFor('intimidation', 'untrained', () => false);
    expect(actions.some((a) => a.name === 'Demoralize')).toBe(true);
  });
});

const equipped = (itemId: string): InventoryItem =>
  ({ instanceId: itemId, itemId, quantity: 1, equipped: true }) as InventoryItem;

describe('weapon Deadly / Fatal / Two-Hand traits surface in strike damage', () => {
  const strikeFor = (itemId: string, conditions: ActiveCondition[] = []) => {
    const ch = build('fighter', 5, { keyAbility: 'str' });
    return deriveStrikes({ ...ch, conditions, inventory: [equipped(itemId)] }, content()).find((s) => s.base === itemId);
  };

  it('Deadly dN adds bonus crit dice (rapier → deadly d8)', () => {
    expect(strikeFor('rapier')?.damage).toMatch(/\(plus 1d8 on a crit\)/);
  });

  it('Fatal dN is noted (pick → fatal d10)', () => {
    expect(strikeFor('pick')?.damage).toMatch(/\(fatal d10\)/);
  });

  it('Two-Hand dN shows the two-handed damage die (bastard sword → d12)', () => {
    expect(strikeFor('bastard-sword')?.damage).toMatch(/d12.*two-handed/);
  });
});

describe('condition fixes', () => {
  const stupefied = (v: number): ActiveCondition => ({ id: 'stupefied', value: v }) as ActiveCondition;

  it('Stupefied penalizes Perception (a Wisdom-based roll) and Will saves', () => {
    // Per RAW, Stupefied applies to Wisdom-based rolls and DCs; Perception uses Wisdom (Foundry's Perception
    // check carries the `wis-based` domain that Stupefied targets), so it takes the penalty.
    const ch = build('cleric', 5);
    const stup = { ...ch, conditions: [stupefied(2)] };
    expect(derivePerception(stup).modifier).toBe(derivePerception(ch).modifier - 2);
    expect(deriveSave(stup, 'will', content()).modifier).toBe(deriveSave(ch, 'will', content()).modifier - 2);
  });

  it('Clumsy penalizes a thrown-weapon (Strength) attack roll', () => {
    const ch = build('fighter', 5, { keyAbility: 'str' });
    const atk = (conds: ActiveCondition[]) =>
      deriveStrikes({ ...ch, conditions: conds, inventory: [equipped('javelin')] }, content()).find((s) => s.base === 'javelin')!
        .attack[0];
    expect(atk([{ id: 'clumsy', value: 2 } as ActiveCondition])).toBe(atk([]) - 2);
  });
});

// Regression tests for the bugs found in the full-app audit (2026-06).

// Regression tests for the bugs found in the full-app audit (2026-06).

describe('build-time HP includes max-HP feats so new characters start at full HP', () => {
  it('a Fighter with Toughness starts current === max (no phantom damage)', () => {
    const ch = build('fighter', 5, {
      overrides: { addedFeats: [{ featId: 'toughness', level: 1, category: 'general' }] },
    });
    expect(ch.hitPoints.current).toBe(deriveMaxHp(ch, content()));
    // Toughness adds HP equal to your level (5).
    expect(ch.hitPoints.current - build('fighter', 5).hitPoints.current).toBe(5);
  });
});

describe('Dual Class spellcasting proficiency stays on each class chassis', () => {
  it("a bard+magus dual-class caps the magus entry at master (bard's legendary does not leak)", () => {
    const ch = build('bard', 19, {
      variantRules: { dualClass: true },
      classId2: 'magus',
      subclassId2: firstSubclass('magus'),
    });
    const magus = ch.spellcasting.find((e) => e.id === 'magus-casting');
    const bard = ch.spellcasting.find((e) => e.id === 'bard-casting');
    expect(magus?.proficiency).toBe('master'); // magus tops at master@17
    expect(bard?.proficiency).toBe('legendary'); // bard reaches legendary@19
  });

  it('a dual-class 2nd-caster entry with a NON-CANONICAL id keeps its 2nd class spells across derive→build', () => {
    const c = content();
    // fighter (non-caster primary) + wizard (2nd class caster) with second-class spells stocked.
    const ch = buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 5,
        classId: 'fighter',
        ancestryId: Object.keys(c.ancestries)[0],
        backgroundId: Object.keys(c.backgrounds)[0],
        keyAbility: 'str',
        subclassId: firstSubclass('fighter'),
        variantRules: { dualClass: true },
        classId2: 'wizard',
        subclassId2: firstSubclass('wizard'),
        spells2: { 1: ['grease'], 2: ['acid-arrow'] },
      },
      c,
    );
    // Simulate an imported / hand-authored character whose 2nd-caster entry uses a non-canonical id
    // (not `wizard-casting`). The old exact-id lookup would fail to find it and silently drop spells2.
    const imported = {
      ...ch,
      spellcasting: ch.spellcasting.map((e) => (e.id === 'wizard-casting' ? { ...e, id: 'wizard-arcane-imported' } : e)),
    };
    const rb = deriveBuildFromCharacter(imported, c);
    // The structural fallback recovers the second class's spells into spells2…
    expect(rb.spells2?.[1]).toContain('grease');
    expect(rb.spells2?.[2]).toContain('acid-arrow');
    // …and rebuilding reproduces a wizard entry that still carries them.
    const rebuilt = buildCharacter({ ...rb, classId2: 'wizard' }, c);
    const wiz = rebuilt.spellcasting.find((e) => e.id === 'wizard-casting');
    expect(Object.values(wiz?.spellbook ?? {}).flat()).toEqual(expect.arrayContaining(['grease', 'acid-arrow']));
  });

  it('a native (canonical-id) dual-class round-trip still recovers the 2nd class spells exactly', () => {
    const c = content();
    const ch = buildCharacter(
      {
        ...emptyBuild(),
        name: 't',
        level: 5,
        classId: 'fighter',
        ancestryId: Object.keys(c.ancestries)[0],
        backgroundId: Object.keys(c.backgrounds)[0],
        keyAbility: 'str',
        subclassId: firstSubclass('fighter'),
        variantRules: { dualClass: true },
        classId2: 'wizard',
        subclassId2: firstSubclass('wizard'),
        spells2: { 1: ['grease'], 2: ['acid-arrow'] },
      },
      c,
    );
    const rb = deriveBuildFromCharacter(ch, c);
    expect(rb.spells2?.[1]).toContain('grease');
    expect(rb.spells2?.[2]).toContain('acid-arrow');
  });
});

describe('rogue Ruffian/Avenger medium-armor advances with light armor', () => {
  it('Ruffian medium armor: trained at L1, expert at L13, master at L19', () => {
    expect(build('rogue', 1, { subclassId: 'ruffian' }).proficiencies.defenses.medium).toBe('trained');
    expect(build('rogue', 13, { subclassId: 'ruffian' }).proficiencies.defenses.medium).toBe('expert');
    expect(build('rogue', 19, { subclassId: 'ruffian' }).proficiencies.defenses.medium).toBe('master');
  });

  it('Avenger medium armor mirrors light armor at L13/L19', () => {
    expect(build('rogue', 13, { subclassId: 'avenger' }).proficiencies.defenses.medium).toBe('expert');
    expect(build('rogue', 19, { subclassId: 'avenger' }).proficiencies.defenses.medium).toBe('master');
  });

  it('a non-medium racket (Scoundrel) leaves medium at untrained', () => {
    const ch = build('rogue', 19, { subclassId: 'scoundrel' });
    expect(ch.proficiencies.defenses.medium).toBe('untrained');
    expect(ch.proficiencies.defenses.light).toBe('master');
  });
});
