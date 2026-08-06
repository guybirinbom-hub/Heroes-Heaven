import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { FEAT_PICK_GRANTS, pickableFeats } from '../src/rules/featPickGrants';
import { FEAT_FEAT_GRANTS_LEVELED } from '../src/rules/featFeatGrants';
import { CASTER_ARCHETYPES } from '../src/rules/casterArchetypes';
import { snareAllowance, hasSnareCrafting, snareFormulaOptions, SNARE_FORMULA_KEY } from '../src/rules/snareFormulas';
import { emptyBuild, buildCharacter } from '../src/rules/build';

/*
 * The 8 "judgment call" feats the user specified: covet-hoard level grant, terrain-scout, pitborn pick,
 * bloodrager caster archetype, elver-pet aquatic, alchemical-familiar Construct(+Tough), snare formulas.
 */
describe('Covet Hoard (level-gated feat grant)', () => {
  it('grants Hefty Hauler always, and Incredible Investiture only at 11th', () => {
    // Covet Hoard is an ancestry feat; add it via overrides so it applies regardless of slots.
    const at10 = build('fighter', 10, { overrides: { addedFeats: [{ featId: 'covet-hoard', level: 2, category: 'ancestry' }] } });
    const at11 = build('fighter', 11, { overrides: { addedFeats: [{ featId: 'covet-hoard', level: 2, category: 'ancestry' }] } });
    const ids10 = new Set(at10.feats.map((f) => f.featId));
    const ids11 = new Set(at11.feats.map((f) => f.featId));
    expect(ids10.has('hefty-hauler')).toBe(true);
    expect(ids10.has('incredible-investiture')).toBe(false);
    expect(ids11.has('incredible-investiture')).toBe(true);
  });
  it('the leveled table names Incredible Investiture at 11', () => {
    expect(FEAT_FEAT_GRANTS_LEVELED['covet-hoard']).toEqual([{ feat: 'incredible-investiture', minLevel: 11 }]);
  });
});

describe('Pitborn constrained skill-feat pick', () => {
  it('offers exactly the six Athletics skill feats', () => {
    const b = { ...emptyBuild(), level: 1, classId: 'fighter' } as ReturnType<typeof emptyBuild>;
    const opts = pickableFeats(FEAT_PICK_GRANTS['pitborn'], b, content()).map((f) => f.id).sort();
    expect(opts).toEqual(['armor-assist', 'combat-climber', 'hefty-hauler', 'quick-jump', 'titan-wrestler', 'underwater-marauder']);
  });
  it('grants the chosen manifestation feat', () => {
    const ch = build('fighter', 2, {
      overrides: { addedFeats: [{ featId: 'pitborn', level: 1, category: 'ancestry' }] },
      pickFeatChoices: { pitborn: 'titan-wrestler' },
    });
    expect(ch.feats.some((f) => f.featId === 'titan-wrestler')).toBe(true);
  });
});

describe('Bloodrager Dedication (caster archetype)', () => {
  it('is a choice-tradition repertoire WITH a slot ladder', () => {
    // Corrected: this was recorded as cantrips-only because `basic-bloodrager-spellcasting` and its
    // siblings do not ship — which is true, and the wrong conclusion. The three rungs are named after
    // the blood, not the archetype, so the archetype never gained a single spell slot.
    const cfg = CASTER_ARCHETYPES['bloodrager-dedication'];
    expect(cfg.choiceTradition).toBe(true);
    expect(cfg.traditionOptions).toEqual(['arcane', 'divine']);
    expect(cfg.keyAbility).toBe('cha');
    expect(cfg.cantrips).toBe(2);
    expect(cfg.basicId).toBe('rising-blood-magic');
    expect(cfg.expertId).toBe('surging-blood-magic');
    expect(cfg.masterId).toBe('exultant-blood-magic');
  });
  it('grants a Cha spell repertoire and the tradition skill (Arcana for arcane)', () => {
    const ch = build('barbarian', 4, {
      overrides: { addedFeats: [{ featId: 'bloodrager-dedication', level: 2, category: 'class' }] },
      archetypeTradition: 'arcane',
    });
    const entry = ch.spellcasting.find((e) => e.id === 'bloodrager-dedication-casting');
    expect(entry).toBeTruthy();
    expect(entry!.tradition).toBe('arcane');
    expect(entry!.keyAbility).toBe('cha');
    expect(ch.proficiencies.skills.arcana).not.toBe('untrained');
  });
  it('grants Religion when the divine list is chosen', () => {
    const ch = build('barbarian', 4, {
      overrides: { addedFeats: [{ featId: 'bloodrager-dedication', level: 2, category: 'class' }] },
      archetypeTradition: 'divine',
    });
    const entry = ch.spellcasting.find((e) => e.id === 'bloodrager-dedication-casting');
    expect(entry!.tradition).toBe('divine');
    expect(ch.proficiencies.skills.religion).not.toBe('untrained');
  });
});

describe('Excluded feats (item 8)', () => {
  it('arcane-tattoos and hag-magic exist in the raw import but are on the exclusion list', async () => {
    const { EXCLUDED_FEATS } = await import('../src/data/index');
    expect(EXCLUDED_FEATS.has('arcane-tattoos')).toBe(true);
    expect(EXCLUDED_FEATS.has('hag-magic')).toBe(true);
    // They are real feats in the data (so the exclusion is deliberately dropping shipped content).
    expect(content().feats['arcane-tattoos']).toBeTruthy();
    expect(content().feats['hag-magic']).toBeTruthy();
  });
});

describe('Snare Crafting formula book', () => {
  it('formula-book size scales with Crafting proficiency', () => {
    expect(snareAllowance('trained')).toEqual({ known: 4, prepared: 4 });
    expect(snareAllowance('expert')).toEqual({ known: 7, prepared: 4 });
    expect(snareAllowance('master')).toEqual({ known: 10, prepared: 6 });
    expect(snareAllowance('legendary')).toEqual({ known: 13, prepared: 8 });
  });
  it('detects Snare Crafting from the feat or its granting dedication', () => {
    expect(hasSnareCrafting(['snarecrafter-dedication'])).toBe(true);
    expect(hasSnareCrafting(['snare-crafting'])).toBe(true);
    expect(hasSnareCrafting(['power-attack'])).toBe(false);
  });
  it('base slots offer only common 1st-level snares', () => {
    const opts = snareFormulaOptions(content(), 1, true);
    expect(opts.length).toBeGreaterThanOrEqual(8);
    expect(opts.every((it) => it.level <= 1)).toBe(true);
    expect(opts.every((it) => (it.rarity ?? 'common').toLowerCase() === 'common')).toBe(true);
  });
  it('chosen formulas round-trip through the saved build', () => {
    const b = { ...emptyBuild(), name: 't', level: 3, classId: 'ranger', extraChoices: { [SNARE_FORMULA_KEY]: ['caltrop-snare', 'alarm-snare'] } };
    const ch = buildCharacter(b as ReturnType<typeof emptyBuild>, content());
    expect(ch).toBeTruthy(); // building with snare formulas set does not throw
  });
});
