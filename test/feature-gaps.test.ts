import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { levelGrants } from '../src/rules/build';
import { deriveStrikes } from '../src/rules/derive';
import type { Character } from '../src/rules/types';

/** Every spell id referenced by a character's spellcasting (cantrips + repertoire + prepared). */
function allSpellIds(ch: Character): Set<string> {
  const ids = new Set<string>();
  for (const e of ch.spellcasting) {
    for (const c of e.cantrips ?? []) ids.add(c);
    for (const arr of Object.values(e.repertoire ?? {})) for (const id of arr) ids.add(id);
    for (const arr of Object.values(e.prepared ?? {})) for (const s of arr) if (s.spellId) ids.add(s.spellId);
  }
  return ids;
}

describe('feature-gap fixes (granted spells/feats, deity, champion devotion)', () => {
  it('sorcerer bloodline grants its Sorcerous Gifts into the repertoire', () => {
    const ch = build('sorcerer', 5, { subclassId: 'bloodline-aberrant' });
    const ids = allSpellIds(ch);
    expect(ids.has('phantom-pain')).toBe(true); // 1st-rank gift, castable at L5
    expect(ids.has('daze')).toBe(true); // cantrip gift
    // The bloodline FOCUS spell stays a focus spell, not a repertoire grant.
    const main = ch.spellcasting.find((e) => e.type === 'spontaneous');
    const mainRepertoire = new Set(Object.values(main?.repertoire ?? {}).flat());
    expect(mainRepertoire.has('tentacular-limbs')).toBe(false);
  });

  it('oracle mystery grants its bonus spells into the repertoire', () => {
    const ch = build('oracle', 5, { subclassId: 'ancestors' });
    expect(allSpellIds(ch).has('guidance')).toBe(true);
  });

  it('bard muse grants its feat and its repertoire spell', () => {
    const ch = build('bard', 1, { subclassId: 'maestro' });
    expect(ch.feats.some((f) => f.featId === 'lingering-composition')).toBe(true);
    expect(allSpellIds(ch).has('soothe')).toBe(true);
  });

  it('champion: deity favored-weapon override + a devotion focus spell + focus pool', () => {
    const ch = build('champion', 3, { deityId: 'sarenrae' });
    // deity-champion is now recognized -> favored-weapon training applies.
    expect(ch.proficiencies.weaponOverrides?.scimitar).toBe('trained');
    // Devotion grants a focus pool + the font-based devotion spell (Sarenrae allows heal).
    expect(ch.focus?.max ?? 0).toBeGreaterThanOrEqual(1);
    const focus = ch.spellcasting.find((e) => e.type === 'focus');
    expect(Object.values(focus?.repertoire ?? {}).flat()).toContain('lay-on-hands');
  });

  it('champion devotion respects an explicit Shields of the Spirit pick', () => {
    const ch = build('champion', 3, { deityId: 'sarenrae', devotionSpell: 'shields-of-the-spirit' });
    const focus = ch.spellcasting.find((e) => e.type === 'focus');
    expect(Object.values(focus?.repertoire ?? {}).flat()).toContain('shields-of-the-spirit');
  });

  it('a focus-granting archetype feat gives a non-caster a focus pool + the spell', () => {
    const ch = build('fighter', 4, { featPicks: { '2:class:0': 'blessed-one-dedication' } });
    expect(ch.focus?.max ?? 0).toBeGreaterThanOrEqual(1);
    const focus = ch.spellcasting.find((e) => e.type === 'focus');
    expect(Object.values(focus?.repertoire ?? {}).flat()).toContain('lay-on-hands');
  });

  it('monk Path to Perfection raises the chosen saves to master/legendary', () => {
    const ch = build('monk', 15, { pathToPerfection: ['will', 'fortitude', 'will'] });
    expect(ch.proficiencies.saves.will).toBe('legendary'); // L7 master → L15 legendary
    expect(ch.proficiencies.saves.fortitude).toBe('master'); // L11 master
    // A save that was never picked stays at its base rank (not master).
    expect(['untrained', 'trained', 'expert']).toContain(ch.proficiencies.saves.reflex);
  });

  it('monk Path to Perfection only applies a tier once its level is reached', () => {
    const ch = build('monk', 7, { pathToPerfection: ['will', 'fortitude', 'will'] });
    expect(ch.proficiencies.saves.will).toBe('master'); // L7 applied
    expect(ch.proficiencies.saves.fortitude).not.toBe('master'); // L11 not yet reached
  });

  it('Sorcerer Draconic dragon exemplar sets the spell tradition + second bloodline skill', () => {
    const ch = build('sorcerer', 5, { subclassId: 'bloodline-draconic', dragonExemplar: 'divine' });
    expect(ch.spellcasting.find((e) => e.type === 'spontaneous')?.tradition).toBe('divine');
    expect(ch.proficiencies.skills.religion).toBe('trained'); // the divine dragon's skill
    expect(ch.proficiencies.skills.intimidation).toBe('trained'); // the bloodline's first skill (always)
    // Default (no pick) falls back to the first exemplar (arcane).
    const dflt = build('sorcerer', 5, { subclassId: 'bloodline-draconic' });
    expect(dflt.spellcasting.find((e) => e.type === 'spontaneous')?.tradition).toBe('arcane');
  });

  it('spontaneous caster archetypes emit a spontaneous (repertoire) pool, not prepared', () => {
    // Sorcerer dedication is spontaneous — its archetype entry must be a repertoire, not prepared slots.
    const ch = build('fighter', 8, {
      keyAbility: 'str',
      featPicks: { '2:class:0': 'sorcerer-dedication', '4:class:0': 'basic-sorcerer-spellcasting' },
      archetypeTradition: 'occult',
      spells: { 1: ['bless'] },
    });
    const arch = ch.spellcasting.find((e) => e.id === 'sorcerer-dedication-casting');
    expect(arch?.type).toBe('spontaneous');
    expect(arch?.repertoire).toBeDefined();
    expect(Object.values(arch?.repertoire ?? {}).flat()).toContain('bless');
    // A cleric dedication stays prepared.
    const prep = build('fighter', 8, {
      keyAbility: 'str',
      featPicks: { '2:class:0': 'cleric-dedication', '4:class:0': 'basic-cleric-spellcasting' },
    });
    expect(prep.spellcasting.find((e) => e.id === 'cleric-dedication-casting')?.type).toBe('prepared');
  });

  it('Summoner Dedication grants an eidolon + a spontaneous pool in the eidolon’s tradition', () => {
    const ch = build('fighter', 8, {
      keyAbility: 'str',
      featPicks: { '2:class:0': 'summoner-dedication', '6:class:0': 'basic-summoner-spellcasting' },
      archetypeEidolonType: 'beast-eidolon', // primal
      spells: { 1: ['summon-animal'] },
    });
    const arch = ch.spellcasting.find((e) => e.id === 'summoner-dedication-casting');
    expect(arch?.type).toBe('spontaneous');
    expect(arch?.tradition).toBe('primal'); // tradition derived from the beast eidolon
    expect(ch.companions?.some((c) => c.kind === 'eidolon' && c.typeId === 'beast-eidolon')).toBe(true);
  });

  it('Fighter gains a bonus (Combat/Improved Flexibility) feat slot at L9 and L15 only', () => {
    const c = content();
    expect(levelGrants(9, 'fighter', c).featSlots).toContain('bonus');
    expect(levelGrants(15, 'fighter', c).featSlots).toContain('bonus');
    expect(levelGrants(7, 'fighter', c).featSlots).not.toContain('bonus'); // not before L9
    expect(levelGrants(9, 'wizard', c).featSlots).not.toContain('bonus'); // fighter-only
  });

  it('a heritage innate spell appears as an at-will innate spell source', () => {
    const ch = build('fighter', 1, { ancestryId: 'elf', heritageId: 'seer-elf' });
    const innate = ch.spellcasting.find((e) => e.type === 'innate');
    expect(innate).toBeDefined();
    expect(innate?.cantrips).toContain('detect-magic'); // Seer Elf grants it as an arcane innate cantrip
    expect(innate?.tradition).toBe('arcane');
  });

  it('a carried staff / wand exposes its held spells as a read-only item spell source', () => {
    const ch = build('wizard', 9, {
      keyAbility: 'int',
      inventory: [
        { itemId: 'accursed-staff-greater', quantity: 1, worn: false, equipped: true },
        { itemId: 'arboreal-wand-rank-2', quantity: 1, worn: false, equipped: false },
      ],
    });
    const staff = ch.spellcasting.find((e) => e.type === 'items' && e.name.includes('Accursed Staff'));
    expect(staff).toBeDefined();
    expect(staff?.cantrips).toContain('daze'); // cantrip held by the staff
    expect(Object.values(staff?.repertoire ?? {}).flat()).toContain('bane'); // 1st-rank held spell
    const wand = ch.spellcasting.find((e) => e.type === 'items' && e.name.includes('Arboreal Wand'));
    expect(Object.values(wand?.repertoire ?? {}).flat()).toContain('heal');
  });

  it('two casters: a Wizard taking Sorcerer Dedication gets a SECOND, independent spell pool', () => {
    const ch = build('wizard', 8, {
      subclassId: 'school-of-battle-magic',
      keyAbility: 'int',
      spells: { 1: ['force-barrage'] }, // the wizard's own (arcane) spellbook
      featPicks: { '2:class:0': 'sorcerer-dedication', '4:class:0': 'basic-sorcerer-spellcasting' },
      archetypeSpells: { cantrips: ['daze'], spells: { 1: ['bless'] }, tradition: 'divine', keyAbility: 'cha' },
    });
    const wiz = ch.spellcasting.find((e) => e.id === 'wizard-casting');
    const arch = ch.spellcasting.find((e) => e.id === 'sorcerer-dedication-casting');
    expect(wiz).toBeDefined();
    expect(arch).toBeDefined(); // the gate that previously suppressed this is gone
    expect(wiz?.tradition).toBe('arcane');
    expect(arch?.tradition).toBe('divine'); // sorcerer dedication = choice-tradition, set on the archetype surface
    // The two pools are independent: the wizard's spellbook has force-barrage, the archetype has bless.
    expect(Object.values(wiz?.spellbook ?? {}).flat()).toContain('force-barrage');
    // Sorcerer dedication is spontaneous → its archetype pool is a repertoire.
    const archSpells = Object.values(arch?.repertoire ?? {}).flat();
    expect(archSpells).toContain('bless');
    expect(archSpells).not.toContain('force-barrage'); // no cross-contamination
    expect(arch?.cantrips).toContain('daze');
  });

  it('Wizard gets one extra (curriculum) prepared slot of each rank vs a base full caster', () => {
    const wiz = build('wizard', 5, { subclassId: 'school-of-battle-magic', keyAbility: 'int' });
    const wPrep = wiz.spellcasting.find((e) => e.type === 'prepared');
    // Cleric (also a full caster, no curriculum slot) is the baseline.
    const clr = build('cleric', 5, { subclassId: 'cloistered-cleric', keyAbility: 'wis' });
    const cPrep = clr.spellcasting.find((e) => e.type === 'prepared');
    for (const rank of Object.keys(cPrep?.prepared ?? {})) {
      const r = Number(rank);
      expect((wPrep?.prepared?.[r]?.length ?? 0), `rank ${r}`).toBe((cPrep?.prepared?.[r]?.length ?? 0) + 1);
    }
  });

  it('Eldritch Archer / Beast Gunner / Psychic dedications grant an archetype spell pool (tradition + key)', () => {
    // Eldritch Archer: tradition of your choice (honored), Charisma key, slots from Basic Spellcasting.
    const ea = build('fighter', 8, {
      featPicks: { '6:class:0': 'eldritch-archer-dedication', '8:class:0': 'basic-eldritch-archer-spellcasting' },
      archetypeTradition: 'occult',
    });
    const eaEntry = ea.spellcasting.find((e) => e.id === 'eldritch-archer-dedication-casting');
    expect(eaEntry?.tradition).toBe('occult');
    expect(eaEntry?.keyAbility).toBe('cha');
    expect(eaEntry?.type).toBe('spontaneous'); // Guns & Gears casters are spontaneous
    expect(Object.keys(eaEntry?.repertoire ?? {}).length).toBeGreaterThan(0);

    // Beast Gunner: tradition constrained to arcane/primal — an illegal pick falls back to default.
    const bg = build('fighter', 8, {
      featPicks: { '6:class:0': 'beast-gunner-dedication', '8:class:0': 'basic-beast-gunner-spellcasting' },
      archetypeTradition: 'occult',
    });
    expect(['arcane', 'primal']).toContain(bg.spellcasting.find((e) => e.id === 'beast-gunner-dedication-casting')?.tradition);

    // Psychic: occult tradition, key attribute Int by default, Cha when chosen.
    const psy = build('fighter', 4, {
      featPicks: { '2:class:0': 'psychic-dedication', '4:class:0': 'basic-psychic-spellcasting' },
      archetypeKeyAbility: 'cha',
    });
    const psyEntry = psy.spellcasting.find((e) => e.id === 'psychic-dedication-casting');
    expect(psyEntry?.tradition).toBe('occult');
    expect(psyEntry?.keyAbility).toBe('cha');
  });

  it('Kineticist Elemental Blast appears as a rollable strike per element, scaling dice by level', () => {
    const l1 = build('kineticist', 1, { extraChoices: { element: ['fire-gate'] }, keyAbility: 'con' });
    const blasts1 = deriveStrikes(l1, content()).filter((s) => s.instanceId.startsWith('blast:'));
    expect(blasts1.map((b) => b.name)).toContain('Elemental Blast (Fire)');
    // 1 die at L1, fire d6; a 2-action blast adds the Con modifier (+1 here) as a status bonus to damage.
    expect(blasts1[0].damage).toMatch(/^1d6\+1 /);
    expect(blasts1[0].dmgAbMod).toBe(1); // Con +1 (build helper Con 12)
    expect(blasts1[0].ranged).toBe(true);
    // Two elements → two blasts; dice scale to 2 at L5.
    const l5 = build('kineticist', 5, { extraChoices: { element: ['fire-gate', 'earth-gate'] }, keyAbility: 'con' });
    const blasts5 = deriveStrikes(l5, content()).filter((s) => s.instanceId.startsWith('blast:'));
    expect(blasts5.length).toBe(2);
    expect(blasts5.find((b) => b.name.includes('Earth'))?.damage).toMatch(/^2d8\+1 /); // earth d8, 2 dice + Con at L5
  });

  it('Kineticist Expand the Portal grants a bonus impulse feat (when not forking)', () => {
    const ch = build('kineticist', 5, {
      extraChoices: { element: ['fire-gate', 'water-gate'] },
      keyAbility: 'con',
      gateExpands: { '5': 'burning-jet' }, // Expand at the L5 threshold (no fork)
    });
    expect(ch.feats.some((f) => f.featId === 'burning-jet')).toBe(true);
    // Forking instead suppresses the bonus impulse.
    const forked = build('kineticist', 5, {
      extraChoices: { element: ['fire-gate', 'water-gate'] },
      keyAbility: 'con',
      gateForks: { '5': 'earth-gate' },
      gateExpands: { '5': 'burning-jet' },
    });
    expect(forked.feats.some((f) => f.featId === 'burning-jet')).toBe(false);
  });

  it('Kineticist Fork the Path adds a new element (skill grant + impulse access) once the threshold is reached', () => {
    // Air+earth gate at L1, fork to fire at the L5 Gate's Threshold.
    const ch = build('kineticist', 5, {
      extraChoices: { element: ['air-gate', 'earth-gate'] },
      gateForks: { '5': 'fire-gate' },
      keyAbility: 'con',
    });
    // Fire's skill grant (Intimidation) now applies alongside air (Stealth) + earth (Athletics).
    expect(ch.proficiencies.skills.intimidation).toBe('trained');
    expect(ch.proficiencies.skills.stealth).toBe('trained');
    expect(ch.proficiencies.skills.athletics).toBe('trained');

    // A fork keyed to a threshold the character hasn't reached yet does nothing.
    const low = build('kineticist', 3, {
      extraChoices: { element: ['air-gate', 'earth-gate'] },
      gateForks: { '5': 'fire-gate' },
      keyAbility: 'con',
    });
    expect(low.proficiencies.skills.intimidation ?? 'untrained').toBe('untrained');
  });

  it('Inventor resolves tiered modifications, gated by innovation type, armor base, and level', () => {
    // Armor innovation, Power Suit: a non-gated mod + a power-suit-only mod are both valid.
    const ps = build('inventor', 7, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'power-suit',
      inventorModifications: { initial: 'muscular-exoskeleton', breakthrough: 'dense-plating' },
    });
    expect(ps.inventor?.innovationType).toBe('armor');
    expect(ps.inventor?.armorStats).toBe('power-suit');
    expect(ps.inventor?.modifications.initial).toBe('muscular-exoskeleton'); // power-suit mod, allowed
    expect(ps.inventor?.modifications.breakthrough).toBe('dense-plating'); // L7 reached

    // A power-suit-only mod is rejected under a Subterfuge Suit base.
    const sub = build('inventor', 1, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'subterfuge-suit',
      inventorModifications: { initial: 'muscular-exoskeleton' },
    });
    expect(sub.inventor?.modifications.initial).toBeUndefined();

    // Breakthrough doesn't count until level 7.
    const low = build('inventor', 3, {
      subclassId: 'armor-innovation',
      inventorArmorStats: 'power-suit',
      inventorModifications: { initial: 'harmonic-oscillator', breakthrough: 'dense-plating' },
    });
    expect(low.inventor?.modifications.initial).toBe('harmonic-oscillator');
    expect(low.inventor?.modifications.breakthrough).toBeUndefined();

    // A weapon innovation rejects an armor modification.
    const wpn = build('inventor', 1, {
      subclassId: 'weapon-innovation',
      inventorModifications: { initial: 'harmonic-oscillator' },
    });
    expect(wpn.inventor?.innovationType).toBe('weapon');
    expect(wpn.inventor?.modifications.initial).toBeUndefined(); // armor mod not valid for weapon
    const wpn2 = build('inventor', 1, {
      subclassId: 'weapon-innovation',
      inventorModifications: { initial: 'advanced-design' },
    });
    expect(wpn2.inventor?.modifications.initial).toBe('advanced-design');
  });

  it('Exemplar Dominion Epithet grants Energized Spark with the restricted energy-type choice', () => {
    // Born of the Bones of the Earth restricts Energized Spark to earth/fire; default = first (earth).
    const dflt = build('exemplar', 7, { extraChoices: { 'dominion-epithet': ['born-of-the-bones-of-the-earth'] } });
    const es = dflt.feats.find((f) => f.featId === 'energized-spark');
    expect(es).toBeDefined();
    expect(es?.choice?.value).toBe('earth');
    expect(es?.level).toBe(7); // attributed to the dominion-epithet unlock level

    // An explicit pick is honored.
    const fire = build('exemplar', 7, {
      extraChoices: { 'dominion-epithet': ['born-of-the-bones-of-the-earth'] },
      grantedChoiceFeatTraits: { 'grant:born-of-the-bones-of-the-earth:energized-spark': 'fire' },
    });
    expect(fire.feats.find((f) => f.featId === 'energized-spark')?.choice?.value).toBe('fire');

    // Peerless under Heaven does NOT grant Energized Spark.
    const peerless = build('exemplar', 7, { extraChoices: { 'dominion-epithet': ['peerless-under-heaven'] } });
    expect(peerless.feats.some((f) => f.featId === 'energized-spark')).toBe(false);
  });

  it('Cleric Battle Creed gets the Battle Font (4/5/6 Bane-or-Bless slots, class-DC) not the heal/harm font', () => {
    const l3 = build('cleric', 3, { subclassId: 'battle-creed', keyAbility: 'wis', deityId: 'sarenrae' });
    const font3 = l3.spellcasting.find((e) => e.type === 'prepared')?.font;
    expect(font3?.type).toBe('battle');
    expect(font3?.slots).toBe(4); // 4 below L5
    expect(font3?.useClassDc).toBe(true);
    expect(font3?.allowed).toEqual(['bane', 'bless']);
    expect(build('cleric', 5, { subclassId: 'battle-creed', keyAbility: 'wis', deityId: 'sarenrae' }).spellcasting.find((e) => e.type === 'prepared')?.font?.slots).toBe(5);
    expect(build('cleric', 15, { subclassId: 'battle-creed', keyAbility: 'wis', deityId: 'sarenrae' }).spellcasting.find((e) => e.type === 'prepared')?.font?.slots).toBe(6);
    // A cloistered cleric still gets the normal heal/harm font.
    const clo = build('cleric', 5, { subclassId: 'cloistered-cleric', keyAbility: 'wis', deityId: 'sarenrae', divineFont: 'heal' });
    expect(clo.spellcasting.find((e) => e.type === 'prepared')?.font?.type).toBe('heal');
  });

  it('Cleric Battle Creed uses the reduced Battle Harbinger casting (two-rank), not full casting', () => {
    const bc = build('cleric', 9, { subclassId: 'battle-creed', keyAbility: 'wis' });
    const prep = bc.spellcasting.find((e) => e.type === 'prepared');
    const counts = Object.fromEntries(Object.entries(prep?.prepared ?? {}).map(([r, a]) => [r, a.length]));
    expect(counts).toEqual({ 4: 2, 5: 1 }); // two-rank table at L9: rank 5 just unlocked → 1 slot (fills to 2 at L10)
    // A cloistered cleric at the same level is a full caster (3 slots across many ranks).
    const clo = build('cleric', 9, { subclassId: 'cloistered-cleric', keyAbility: 'wis' });
    const cloPrep = clo.spellcasting.find((e) => e.type === 'prepared');
    expect(Object.values(cloPrep?.prepared ?? {}).flat().length).toBeGreaterThan(
      Object.values(prep?.prepared ?? {}).flat().length,
    );
    // Battle Creed never gets a 10th-rank slot (it loses Miraculous Spell).
    const bc20 = build('cleric', 20, { subclassId: 'battle-creed', keyAbility: 'wis' });
    const bc20prep = bc20.spellcasting.find((e) => e.type === 'prepared');
    expect(Object.keys(bc20prep?.prepared ?? {})).not.toContain('10');
    expect(bc20prep?.proficiency).toBe('expert'); // casting caps at expert (no master/legendary)
  });

  it('Cleric Battle Creed grants the martial creed ladder and omits Resolute Faith’s Will master@9', () => {
    const l1 = build('cleric', 1, { subclassId: 'battle-creed', keyAbility: 'wis' });
    expect(l1.proficiencies.attacks.martial).toBe('trained'); // martial weapons (cloistered has none)
    expect(l1.proficiencies.defenses.medium).toBe('trained'); // medium armor
    expect(l1.proficiencies.saves.fortitude).toBe('expert'); // Initial Creed
    // No Resolute Faith → Will is NOT master at 9 (cloistered/warpriest would be).
    const l9 = build('cleric', 9, { subclassId: 'battle-creed', keyAbility: 'wis' });
    expect(l9.proficiencies.saves.will).not.toBe('master');
    const cloistered9 = build('cleric', 9, { subclassId: 'cloistered-cleric', keyAbility: 'wis' });
    expect(cloistered9.proficiencies.saves.will).toBe('master'); // contrast: cloistered DOES get it
    // True Creed (15) → Will master; Final Creed (19) → class DC legendary.
    const l20 = build('cleric', 20, { subclassId: 'battle-creed', keyAbility: 'wis' });
    expect(l20.proficiencies.saves.will).toBe('master');
    expect(l20.proficiencies.saves.fortitude).toBe('master');
    expect(l20.proficiencies.classDc).toBe('legendary');
  });

  it('commander folio: size grows with level and only unlocked-tier tactics are kept', () => {
    // A basic + an expert tactic; at L1 only the basic survives (expert locked, folio max 5).
    const l1 = build('commander', 1, { commanderTactics: ['pincer-attack', 'alley-oop'] });
    expect(l1.commanderTactics?.folioMax).toBe(5);
    expect(l1.commanderTactics?.maxTier).toBe('basic');
    expect(l1.commanderTactics?.folio).toContain('pincer-attack'); // basic — kept
    expect(l1.commanderTactics?.folio).not.toContain('alley-oop'); // expert — filtered out at L1

    // At L7 the folio grows to 7 and expert tactics become legal.
    const l7 = build('commander', 7, { commanderTactics: ['pincer-attack', 'alley-oop'] });
    expect(l7.commanderTactics?.folioMax).toBe(7);
    expect(l7.commanderTactics?.maxTier).toBe('expert');
    expect(l7.commanderTactics?.folio).toEqual(expect.arrayContaining(['pincer-attack', 'alley-oop']));
  });

  it('commander folio is clamped to its capacity', () => {
    const many = ['pincer-attack', 'reload', 'strike-hard', 'double-team', 'end-it', 'naval-training'];
    const ch = build('commander', 1, { commanderTactics: many });
    // Only ids that actually exist as tactics are kept, then clamped to 5.
    expect((ch.commanderTactics?.folio.length ?? 0)).toBeLessThanOrEqual(5);
  });

  it('rogue Avenger racket requires a deity and grants its favored-weapon training', () => {
    const ch = build('rogue', 3, { subclassId: 'avenger', deityId: 'sarenrae' });
    // usesDeity is now true for the Avenger racket -> the deity's favored weapon is trained.
    expect(ch.proficiencies.weaponOverrides?.scimitar).toBe('trained');
  });

  it('a subclass restricted skill choice trains the picked skill (Pistolero / Empiricism)', () => {
    // Default = first allowed option (Deception for the Pistolero way).
    const dflt = build('gunslinger', 1, { subclassId: 'way-of-the-pistolero' });
    expect(dflt.proficiencies.skills.deception).toBe('trained');
    // Explicit pick is honored…
    const intim = build('gunslinger', 1, { subclassId: 'way-of-the-pistolero', subclassSkill: 'intimidation' });
    expect(intim.proficiencies.skills.intimidation).toBe('trained');
    expect(intim.proficiencies.skills.deception ?? 'untrained').toBe('untrained');
    // …but an out-of-list pick is ignored, falling back to the first allowed option.
    const bad = build('gunslinger', 1, { subclassId: 'way-of-the-pistolero', subclassSkill: 'athletics' });
    expect(bad.proficiencies.skills.deception).toBe('trained');
    // Investigator Empiricism trains a chosen Int skill.
    const emp = build('investigator', 1, { subclassId: 'empiricism-methodology', subclassSkill: 'occultism' });
    expect(emp.proficiencies.skills.occultism).toBe('trained');
  });

  it('Advanced/Greater Bloodline grant the chosen bloodline’s advanced & greater focus spells', () => {
    const ch = build('sorcerer', 12, {
      subclassId: 'bloodline-aberrant',
      featPicks: { '6:class:0': 'advanced-bloodline', '12:class:0': 'greater-bloodline' },
    });
    const focus = ch.spellcasting.find((e) => e.type === 'focus');
    const rep = new Set(Object.values(focus?.repertoire ?? {}).flat());
    expect(rep.has('tentacular-limbs')).toBe(true); // initial (bloodline)
    expect(rep.has('aberrant-whispers')).toBe(true); // advanced (feat)
    expect(rep.has('unusual-anatomy')).toBe(true); // greater (feat)
    expect(ch.focus?.max).toBe(3); // 1 (bloodline) + 1 (advanced) + 1 (greater), capped at 3
  });

  it('animist grants only the PRIMARY apparition its vessel focus spell', () => {
    const apps = ['crafter-in-the-vault', 'custodian-of-groves-and-gardens'];
    // Explicit primary = the custodian -> only its vessel spell is a focus spell.
    const ch = build('animist', 1, {
      extraChoices: { apparition: apps },
      primaryApparition: 'custodian-of-groves-and-gardens',
    });
    const focus = ch.spellcasting.find((e) => e.type === 'focus');
    const repertoire = new Set(Object.values(focus?.repertoire ?? {}).flat());
    expect(repertoire.has('garden-of-healing')).toBe(true); // custodian's vessel spell
    expect(repertoire.has('traveling-workshop')).toBe(false); // crafter's vessel spell — NOT granted

    // Default (no explicit primary) falls back to the first attuned apparition.
    const dflt = build('animist', 1, { extraChoices: { apparition: apps } });
    const dfltRep = new Set(
      Object.values(dflt.spellcasting.find((e) => e.type === 'focus')?.repertoire ?? {}).flat(),
    );
    expect(dfltRep.has('traveling-workshop')).toBe(true);
    expect(dfltRep.has('garden-of-healing')).toBe(false);
  });

  it('druid Voice of Nature grants the chosen feat (default Animal Empathy)', () => {
    const dflt = build('druid', 1, {});
    expect(dflt.feats.some((f) => f.featId === 'animal-empathy')).toBe(true);
    const plant = build('druid', 1, { voiceOfNature: 'plant-empathy' });
    expect(plant.feats.some((f) => f.featId === 'plant-empathy')).toBe(true);
    expect(plant.feats.some((f) => f.featId === 'animal-empathy')).toBe(false);
  });
});
