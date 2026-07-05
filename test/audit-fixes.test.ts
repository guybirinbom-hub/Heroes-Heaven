import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { deriveStrikes, deriveMaxHp, deriveAc, deriveSpeeds } from '../src/rules/derive';
import { normalizePlay, normalizeCharacter } from '../src/rules/normalize';
import { applyPlayState } from '../src/rules/play';
import { deriveFamiliar } from '../src/rules/companions';
import { attachHostTypes } from '../src/rules/attachments';

// Regression tests for the full-app audit fixes (see .audit-worklist.json).
describe('audit fixes — advancement & proficiency', () => {
  it('Bard Will save advances: master@9 (Performer’s Heart), legendary@17 (Greater)', () => {
    expect(build('bard', 8, { keyAbility: 'cha' }).proficiencies.saves.will).toBe('expert');
    expect(build('bard', 9, { keyAbility: 'cha' }).proficiencies.saves.will).toBe('master');
    expect(build('bard', 17, { keyAbility: 'cha' }).proficiencies.saves.will).toBe('legendary');
  });

  it('Magus Reflex save advances to expert@5 (Lightning Reflexes)', () => {
    expect(build('magus', 4, { keyAbility: 'int' }).proficiencies.saves.reflex).toBe('trained');
    expect(build('magus', 5, { keyAbility: 'int' }).proficiencies.saves.reflex).toBe('expert');
  });

  it('Thaumaturge trains ONE esoteric skill (not all four) + Esoteric Lore', () => {
    // Clear the background so only the CLASS grants are measured (a background could also train one of these).
    const ch = build('thaumaturge', 1, { keyAbility: 'cha', backgroundId: null });
    const eso = ['arcana', 'nature', 'occultism', 'religion'].filter((s) => (ch.proficiencies.skills[s] ?? 'untrained') !== 'untrained');
    expect(eso.length).toBe(1); // exactly one (default arcana), not four
    expect(ch.proficiencies.skills['lore:esoteric']).toBe('trained');
    const pick = build('thaumaturge', 1, { keyAbility: 'cha', backgroundId: null, subclassSkill: 'religion' });
    expect(pick.proficiencies.skills.religion).toBe('trained');
    expect(pick.proficiencies.skills.arcana ?? 'untrained').toBe('untrained');
  });

  it('Bard still has its two genuinely-fixed trained skills (Occultism + Performance)', () => {
    const ch = build('bard', 1, { keyAbility: 'cha' });
    expect(ch.proficiencies.skills.occultism).toBe('trained');
    expect(ch.proficiencies.skills.performance).toBe('trained');
  });

  it('Alchemist bombs use the bomb-group proficiency (trained@1 / expert@7 / master@15), not untrained martial', () => {
    expect(build('alchemist', 1, { keyAbility: 'int' }).proficiencies.weaponGroups?.bomb).toBe('trained');
    expect(build('alchemist', 7, { keyAbility: 'int' }).proficiencies.weaponGroups?.bomb).toBe('expert');
    expect(build('alchemist', 15, { keyAbility: 'int' }).proficiencies.weaponGroups?.bomb).toBe('master');
    expect(build('alchemist', 1, { keyAbility: 'int' }).proficiencies.attacks.martial).toBe('untrained');
    // A wielded bomb derives as a real strike (the group rank beats the untrained category via betterRank).
    const ch = build('alchemist', 1, { keyAbility: 'int', inventory: [{ itemId: 'acid-flask-lesser', quantity: 1, worn: false, equipped: true }] });
    expect(deriveStrikes(ch, content()).some((s) => /acid flask/i.test(s.name))).toBe(true);
  });

  it('Gunslinger firearms are expert (group proficiency) from level 1', () => {
    expect(build('gunslinger', 1, { keyAbility: 'dex' }).proficiencies.weaponGroups?.firearm).toBe('expert');
  });
});

describe('audit fixes — spellcasting', () => {
  it('Two-rank caster (magus) gets a full 2 slots of a newly-unlocked top rank: L5 → 2× rank 3 (per AoN)', () => {
    const entry = build('magus', 5, { keyAbility: 'int' }).spellcasting.find((e) => e.id === 'magus-casting')!;
    expect(entry.prepared?.[2]?.length).toBe(2);
    expect(entry.prepared?.[3]?.length).toBe(2); // AoN magus table: 3rd rank arrives with its full 2 slots at L5
    const l6 = build('magus', 6, { keyAbility: 'int' }).spellcasting.find((e) => e.id === 'magus-casting')!;
    expect(l6.prepared?.[3]?.length).toBe(2);
  });

  it('Sorcerer bloodline-granted spells are recorded in grantedRepertoire (so they do not eat the known cap)', () => {
    const ch = build('sorcerer', 3, { keyAbility: 'cha', subclassId: 'bloodline-angelic' });
    const entry = ch.spellcasting.find((e) => e.repertoire);
    expect(entry?.grantedRepertoire && Object.keys(entry.grantedRepertoire).length).toBeGreaterThan(0);
    // Every granted id is present in the repertoire of its rank.
    for (const [rank, ids] of Object.entries(entry!.grantedRepertoire!)) {
      for (const id of ids) expect(entry!.repertoire?.[Number(rank)]).toContain(id);
    }
  });
});

describe('audit fixes — max HP feats', () => {
  it('Toughness adds +level to max HP; Thick Hide Mask adds a flat +20', () => {
    const ch = build('fighter', 5, { keyAbility: 'str' });
    const base = deriveMaxHp(ch, content());
    const withToughness = { ...ch, feats: [...ch.feats, { featId: 'toughness', level: 1 }] };
    expect(deriveMaxHp(withToughness, content())).toBe(base + ch.level); // +5 at level 5
    const withMask = { ...ch, feats: [...ch.feats, { featId: 'thick-hide-mask', level: 1 }] };
    expect(deriveMaxHp(withMask, content())).toBe(base + 20);
  });
});

describe('audit fixes — derive (strikes / AC / speed)', () => {
  it('Every character has a baseline Fist strike even with no weapon equipped', () => {
    const ch = build('fighter', 1, { keyAbility: 'str' });
    const fist = deriveStrikes(ch, content()).find((s) => s.name === 'Fist');
    expect(fist).toBeDefined();
    expect(fist!.traits).toEqual(expect.arrayContaining(['agile', 'finesse', 'unarmed']));
  });

  it('Wearing a barding-category armor does not produce NaN AC', () => {
    const ch = build('fighter', 3, {
      keyAbility: 'str',
      inventory: [{ itemId: 'anti-dragon-barding', quantity: 1, worn: true, equipped: false }],
    });
    const ac = deriveAc(ch, content()).value;
    expect(Number.isFinite(ac)).toBe(true);
  });

  it('Armor Speed penalty reduces ALL movement types, not just land', () => {
    // Seaweed Leshy has swim 20; full plate is −10 (Str 4 ⇒ not met at default scores ⇒ full penalty).
    const ch = build('druid', 1, {
      keyAbility: 'wis',
      ancestryId: 'leshy',
      heritageId: 'seaweed-leshy',
      inventory: [{ itemId: 'full-plate', quantity: 1, worn: true, equipped: false }],
    });
    const sp = deriveSpeeds(ch, content());
    expect(sp.land).toBe(15); // 25 − 10
    expect(sp.swim).toBe(10); // 20 − 10  (previously stayed 20)
  });
});

describe('audit fixes — companions & items', () => {
  it('Familiar Speed reflects movement abilities (Fast Movement → 40; Flier adds fly 25)', () => {
    const ch = build('wizard', 5, { keyAbility: 'int' });
    const cfg = { id: 'fam1', kind: 'familiar', name: 'Sprite', abilities: ['flier', 'fast-movement'] } as never;
    const fam = deriveFamiliar(cfg, ch, content());
    expect(fam.speed).toBe(40);
    expect(fam.extraSpeeds).toContain('fly 25 feet');
    const plain = deriveFamiliar({ id: 'f2', kind: 'familiar', name: 'Rat', abilities: [] } as never, ch, content());
    expect(plain.speed).toBe(25);
    expect(plain.extraSpeeds).toEqual([]);
  });

  it('A firearm-only talisman attaches to weapons, not armor/shields', () => {
    const hosts = attachHostTypes(content().items['adaptive-cogwheel']);
    expect(hosts).toContain('weapon');
    expect(hosts).not.toContain('armor');
    expect(hosts).not.toContain('shield');
  });
});

describe('audit fixes — content integrity (importer)', () => {
  const db = content();

  it('Every class-feature reference resolves to a real feature (no raw-slug fallbacks)', () => {
    const unresolved: string[] = [];
    for (const c of Object.values(db.classes)) for (const f of c.features ?? []) if (!db.classFeatures[f.featureId]) unresolved.push(`${c.id}:${f.featureId}`);
    expect(unresolved).toEqual([]);
  });

  it('No innate-spell grant references an unresolved ChoiceSet template', () => {
    const bad: string[] = [];
    for (const f of Object.values(db.feats)) for (const g of f.innateSpells ?? []) if (String(g.spellId).includes('{')) bad.push(g.spellId);
    expect(bad).toEqual([]);
  });

  it('The Knight Vigilant and Guardian "Keep Up the Good Fight" feats both survive the slug collision', () => {
    expect(db.feats['keep-up-the-good-fight']).toBeDefined();
    expect(db.feats['keep-up-the-good-fight-knight-vigilant']?.archetype).toBe('knight-vigilant');
  });

  it('No spell renders an "N or N" casting time as plain-text duration', () => {
    const bad = Object.values(db.spells).filter((s) => s.cast?.type === 'duration' && /^\d\s*or\s*\d$/.test((s.cast as { text?: string }).text ?? ''));
    expect(bad).toEqual([]);
  });
});

describe('audit fixes — robustness', () => {
  it('normalizePlay coerces malformed fields so applyPlayState cannot crash', () => {
    const bad: unknown = {
      conditions: 'nope',
      activeModes: 5,
      inventory: { x: 1 },
      preparedTactics: 'a',
      expendedSlots: [1, 2],
      damage: 'x',
    };
    const p = normalizePlay(bad);
    expect(Array.isArray(p.conditions)).toBe(true);
    expect(Array.isArray(p.activeModes)).toBe(true);
    expect(Array.isArray(p.inventory)).toBe(true);
    expect(Array.isArray(p.preparedTactics)).toBe(true);
    expect(p.expendedSlots).toEqual({}); // an array is coerced back to {}
    expect(p.damage).toBe(0);
    const ch = build('fighter', 1, { keyAbility: 'str' });
    expect(() => applyPlayState(ch, p, content())).not.toThrow();
    // A totally non-object play must also be survivable.
    expect(() => applyPlayState(ch, normalizePlay('garbage'), content())).not.toThrow();
  });

  it('normalizeCharacter coerces malformed structural fields (companions/skillIncreases/etc.)', () => {
    const c = normalizeCharacter({ name: 'X', companions: 'oops', skillIncreases: 5, classChoices: {}, pinned: 'no' });
    expect(Array.isArray(c.companions)).toBe(true);
    expect(Array.isArray(c.skillIncreases)).toBe(true);
    expect(Array.isArray(c.classChoices)).toBe(true);
    expect(Array.isArray(c.pinned)).toBe(true);
    // A genuinely-absent field stays absent (not forced to []).
    expect(normalizeCharacter({ name: 'Y' }).companions).toBeUndefined();
  });
});
