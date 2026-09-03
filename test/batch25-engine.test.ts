// @vitest-environment jsdom
// jsdom because ONE of the readers pinned below is a builder control, not an engine function:
// Dragonblood's "add Draconic to your ancestry's list" is delivered by LanguageEditor's option list,
// and the only honest way to ask whether a menu widened is to render it. The engine tests above and
// below are pure and unaffected by the environment.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { EffectChoicesPicker, LanguageEditor } from '../src/builder/shared';
import { CATALOG_MODES, modeRelevant } from '../src/rules/modes';
import { deriveDefenses, deriveMaxHp, deriveSave, deriveSpeeds, deriveStrikes, modeGateIds } from '../src/rules/derive';
import type { BuilderActions } from '../src/builder/shared';
import {
  buildCharacter,
  choiceFlagAnswer,
  deriveBuildFromCharacter,
  emptyBuild,
  grantedChoiceKey,
  narrowSpellFilter,
  type BuildState,
} from '../src/rules/build';
import type { ContentDatabase } from '../src/rules/types';

const db = content();

/**
 * Wanderer's-Guide parity batch 25 — the ENGINE half (types + build).
 *
 * Every assertion is made on a BUILT character. Where the finding's carrier is a DATA row authored by
 * the data agent (Stoutheart Centaur's `ancestryHp`, Budding Speaker Centaur's tradition `choice`),
 * the test builds against a patched copy of the content database: the point is that the READER fires
 * the moment the row lands, which is the half that lives in code.
 */

/** The shipped content with one heritage record patched — the row the data lane will author. */
const withHeritage = (id: string, patch: Record<string, unknown>): ContentDatabase => ({
  ...db,
  heritages: { ...db.heritages, [id]: { ...db.heritages[id], ...patch } },
}) as ContentDatabase;

const hero = (over: Partial<BuildState>, content_ = db) =>
  buildCharacter({ ...emptyBuild(), name: 't', level: 1, classId: 'wizard', keyAbility: 'int', backgroundId: 'acrobat', ...over } as BuildState, content_);

describe('batch 25 — heritage carriers the engine could not reach', () => {
  /* "You gain 10 Hit Points from your ancestry INSTEAD OF 8" — Stoutheart Centaur. The heritage asks
   * no question, so `alternateAttributes.hp` (gated on `heritageChoiceAnswer === whenChoice`) could
   * never carry it and the sheet showed the centaur's 8 at every level. */
  it('Heritage.ancestryHp overrides the ancestry HP outright', () => {
    const b = { ancestryId: 'centaur', heritageId: 'stoutheart-centaur' } as Partial<BuildState>;
    // The SHIPPED row (batch 25) against the same record with the field stripped.
    expect(db.heritages['stoutheart-centaur'].ancestryHp).toBe(10);
    const stripped = withHeritage('stoutheart-centaur', { ancestryHp: undefined });
    expect(db.ancestries['centaur'].hp, 'the printed "instead of 8"').toBe(8);
    expect(deriveMaxHp(hero(b), db) - deriveMaxHp(hero(b, stripped), stripped)).toBe(2);
  });

  it('ancestryHp does not disturb the Mightyfall Kobold package it sits above', () => {
    const kobold = (choice?: string) =>
      deriveMaxHp(
        hero({ ancestryId: 'kobold', heritageId: 'mightyfall-kobold', ...(choice ? { featChoices: { 'heritage:mightyfall-kobold': choice } } : {}) } as Partial<BuildState>),
        db,
      );
    expect(kobold('kaiju') - kobold('normal')).toBe(5);
  });

  /* "You're trained in all simple and martial weapons" — Warrior Android. `grantSourcesForProficiency`
   * was `feats + owned class features`, so a FEAT_GRANTS row keyed to a heritage id could not fire;
   * the record shipped a dataWarning telling the player to apply it by hand instead. */
  it('a FEAT_GRANTS row keyed to a HERITAGE reaches the proficiency pass', () => {
    const wizard = hero({ ancestryId: 'android' } as Partial<BuildState>);
    expect(wizard.proficiencies.attacks.martial, 'a wizard is untrained in martial').toBe('untrained');
    const warrior = hero({ ancestryId: 'android', heritageId: 'warrior-android' } as Partial<BuildState>);
    expect(warrior.proficiencies.attacks.simple).toBe('trained');
    expect(warrior.proficiencies.attacks.martial).toBe('trained');
  });

  /* "You become trained in Athletics (OR ANOTHER SKILL if you're already trained in Athletics)" —
   * Laborer Android; the same shape on Impersonator Android for Deception. The printed skill is the
   * answer and the 16-option picker is only the escape hatch, but an unanswered multi-option pick
   * resolved to nothing, so the default sheet trained no skill at all. */
  it('an unanswered heritage effect choice resolves to its first (printed) option', () => {
    expect(hero({ ancestryId: 'android', heritageId: 'laborer-android' } as Partial<BuildState>).proficiencies.skills.athletics).toBe('trained');
    expect(hero({ ancestryId: 'android', heritageId: 'impersonator-android' } as Partial<BuildState>).proficiencies.skills.deception).toBe('trained');
  });

  it('…and an ANSWERED one still wins over the default', () => {
    const ch = hero({
      ancestryId: 'android',
      heritageId: 'laborer-android',
      effectChoices: { 'laborer-android:trained-skill': 'stealth' },
    } as Partial<BuildState>);
    expect(ch.proficiencies.skills.stealth).toBe('trained');
    expect(ch.proficiencies.skills.athletics ?? 'untrained').toBe('untrained');
  });

  it('the default is scoped to SKILL-only lists — a real either/or still grants nothing', () => {
    // "Choose if you are aquatic or water-dwelling" (Swimming Animal) is a genuine question: its
    // branches grant a creature trait and Speeds, so neither may be handed over unasked.
    const swimmer = hero({ ancestryId: 'awakened-animal', heritageId: 'swimming-animal' } as Partial<BuildState>);
    expect((swimmer.chosenCreatureTraits ?? []).some((t) => t.trait === 'aquatic')).toBe(false);
    expect((swimmer.effectPicks ?? []).some((p) => p.recordId === 'swimming-animal')).toBe(false);
  });

  it('…and to heritages — a FEAT’s unanswered either/or still grants nothing', () => {
    // Inner Fire is "primal or arcane", two branches each with a grant, and neither is a default:
    // an unanswered either/or on a FEAT must still hand nothing over.
    const ch = hero({ overrides: { addedFeats: [{ featId: 'inner-fire', level: 1 }] } } as Partial<BuildState>);
    expect(ch.feats.some((f) => f.featId === 'inner-fire'), 'the feat is actually on the character').toBe(true);
    expect(db.feats['inner-fire'].effectChoices?.[0].options?.length).toBeGreaterThan(1);
    expect((ch.effectPicks ?? []).some((p) => p.recordId === 'inner-fire')).toBe(false);
    // …and it still resolves once answered.
    const answered = hero({
      overrides: { addedFeats: [{ featId: 'inner-fire', level: 1 }] },
      effectChoices: { 'inner-fire:inner-fire-tradition': 'arcane' },
    } as Partial<BuildState>);
    expect((answered.effectPicks ?? []).some((p) => p.recordId === 'inner-fire')).toBe(true);
  });

  /* "…gain the Specialty Crafting skill feat, BUT YOU CAN PICK TWO DIFFERENT SPECIALTIES INSTEAD OF
   * ONE" — Anvil Dwarf. WG grants the feat twice; we granted it once. */
  it('Anvil Dwarf takes Specialty Crafting twice, the second taking keyed by variant', () => {
    const dwarf = hero({ ancestryId: 'dwarf', heritageId: 'anvil-dwarf' } as Partial<BuildState>);
    const takes = dwarf.feats.filter((f) => f.featId === 'specialty-crafting');
    expect(takes.length).toBe(2);
    expect(takes.filter((f) => f.grantVariant === 'heritage').length).toBe(1);
    expect(takes.filter((f) => !f.grantVariant).length).toBe(1);
  });

  it('each Anvil Dwarf taking answers its OWN specialty', () => {
    expect(grantedChoiceKey('specialty-crafting', 'heritage')).toBe('specialty-crafting#heritage');
    expect(grantedChoiceKey('specialty-crafting'), 'the bare key stays the first taking’s').toBe('specialty-crafting');
    const dwarf = hero({
      ancestryId: 'dwarf',
      heritageId: 'anvil-dwarf',
      grantedFeatChoices: { 'specialty-crafting': 'blacksmithing', 'specialty-crafting#heritage': 'weaving' },
    } as Partial<BuildState>);
    const second = dwarf.feats.find((f) => f.featId === 'specialty-crafting' && f.grantVariant === 'heritage');
    expect(second?.choice?.value).toBe('weaving');
    expect(second?.choice?.label).toBe('Weaving');
    // …and the answer survives a rebuild from the character (import / campaign copy).
    expect(deriveBuildFromCharacter(dwarf, db).grantedFeatChoices?.['specialty-crafting#heritage']).toBe('weaving');
  });

  /* "Select divine or primal… THIS CHOICE CAN'T BE CHANGED. You gain one cantrip from the chosen
   * spell list." — Budding Speaker Centaur. The engine lane (heritage `choice.flag` →
   * `traditionFromChoiceFlag`) already exists; this pins that the data row will fire, because the
   * heritage's cantrip list is otherwise both traditions at once. */
  it('a heritage choice.flag narrows the heritage’s own cantrip spellFilter', () => {
    const patched = withHeritage('budding-speaker-centaur', {
      choice: {
        prompt: 'Select divine or primal',
        flag: 'speakerTradition',
        options: [
          { value: 'divine', label: 'Divine (Faithspeaker)' },
          { value: 'primal', label: 'Primal (Greenspeaker)' },
        ],
      },
      effectChoices: [
        {
          ...db.heritages['budding-speaker-centaur'].effectChoices![0],
          spellFilter: { ...db.heritages['budding-speaker-centaur'].effectChoices![0].spellFilter!, traditionFromChoiceFlag: 'speakerTradition' },
        },
      ],
    });
    const b = {
      ...emptyBuild(),
      name: 't',
      level: 1,
      classId: 'wizard',
      keyAbility: 'int',
      backgroundId: 'acrobat',
      ancestryId: 'centaur',
      heritageId: 'budding-speaker-centaur',
      featChoices: { 'heritage:budding-speaker-centaur': 'divine' },
    } as BuildState;
    expect(choiceFlagAnswer('speakerTradition', b, patched)).toBe('divine');
    const filter = patched.heritages['budding-speaker-centaur'].effectChoices![0].spellFilter!;
    expect(narrowSpellFilter(filter, b, patched).traditions).toEqual(['divine']);
    // Unanswered stays wide, so a half-built character sees the whole list rather than an empty one.
    expect(narrowSpellFilter(filter, { ...b, featChoices: {} } as BuildState, patched).traditions).toEqual(['divine', 'primal']);
  });
});

/* ─── engine agent 1 ends here; a second engine agent appends its describe blocks below ─── */

/**
 * Batch 25 — the DERIVE half: five readers that had no carrier, each asked of a BUILT character.
 *
 * Where the carrier is a DATA row the data agent authors, the test builds against a patched copy of
 * the content database, exactly as the block above does: the point under test is that the reader
 * fires the moment the row lands.
 */
describe('batch 25 — derive readers the records could not reach', () => {
  /* *"You gain a swim Speed of 10 feet and the amphibious trait. LIKE ALL CREATURES WITH THE
   * AMPHIBIOUS TRAIT, YOU CAN BREATHE BOTH WATER AND AIR."* — Undine. The trait IS the statement, so
   * the aggregation asks the derived trait set instead of demanding a per-record flag; six chassis
   * and heritages were reporting no water breathing at once. */
  describe('the amphibious trait means you breathe water', () => {
    const breathes = (over: Partial<BuildState>) => deriveDefenses(hero(over), db).breathesWater;

    it.each([
      ['undine (versatile, on a human)', { ancestryId: 'human', heritageId: 'undine' }],
      ['aquatic elf', { ancestryId: 'elf', heritageId: 'aquatic-elf' }],
      ['tidepool dragonet', { ancestryId: 'dragonet', heritageId: 'tidepool-dragonet' }],
      ['the azarketi chassis', { ancestryId: 'azarketi' }],
      ['the merfolk chassis', { ancestryId: 'merfolk' }],
      ['the athamaru chassis', { ancestryId: 'athamaru' }],
    ])('%s breathes water', (_label, over) => {
      expect(breathes(over as Partial<BuildState>)).toBe(true);
    });

    it('a character with no amphibious trait still does not, and the explicit flag still works', () => {
      expect(breathes({ ancestryId: 'human', heritageId: 'skilled-human' })).toBe(false);
      // seaweed-leshy carries breathesWater outright — the guard must not have displaced the flag lane.
      expect(breathes({ ancestryId: 'leshy', heritageId: 'seaweed-leshy' })).toBe(true);
    });
  });

  /* *"You have a swim Speed of 20 feet, and if you can move on land, you have base Speed of 20
   * feet."* — Swimming Animal, water-dwelling branch. The awakened-animal chassis walks at 5, and a
   * granted `speeds.land` is ADDITIVE (it would produce 25), so the branch needs the FLOOR lane —
   * per-ANSWER, because the record's other branch (aquatic) prints no land Speed and keeps the 5. */
  describe('an ANSWER can floor the land Speed', () => {
    const waterDwelling = () =>
      hero({ ancestryId: 'awakened-animal', heritageId: 'swimming-animal', effectChoices: { 'swimming-animal:aquatic-or-water-dwelling': 'water-dwelling' } } as Partial<BuildState>);

    it('the chassis walks at 5 until something floors it — the AQUATIC branch prints no land Speed', () => {
      expect(db.ancestries['awakened-animal'].speeds?.land).toBe(5);
      const aquatic = hero({ ancestryId: 'awakened-animal', heritageId: 'swimming-animal', effectChoices: { 'swimming-animal:aquatic-or-water-dwelling': 'aquatic' } } as Partial<BuildState>);
      expect(aquatic.chosenEffects?.speeds?.swim).toBe(30);
      expect(deriveSpeeds(aquatic, db).land).toBe(5);
      // …and the shipped water-dwelling row (batch 25) floors it at the printed 20, not 5 + 20.
      const ch = waterDwelling();
      expect(ch.chosenEffects?.speeds?.swim).toBe(20);
      expect(deriveSpeeds(ch, db).land).toBe(20);
    });

    /* END TO END, from the authored row to the walked Speed. The first version of this test injected
     * `chosenEffects.landSpeedMin` by hand and passed while the lane was still dead: `mergeEffect`
     * (build.ts) copied senses/IWR/speeds/whileActive/strikeDamage/staffSpells and NOTHING else, so an
     * `EffectGrant.landSpeedMin` was computed and dropped before it could reach `chosenEffects`. Build
     * the real character against the real row, or the reader is pinned and the wiring is not. */
    it('an authored landSpeedMin on the water-dwelling option raises the land Speed TO 20, not BY 20', () => {
      const rec = db.heritages['swimming-animal'];
      const ec = rec.effectChoices![0];
      const patched = withHeritage('swimming-animal', {
        effectChoices: [{ ...ec, options: ec.options!.map((o) => (o.value === 'water-dwelling' ? { ...o, grant: { ...o.grant, landSpeedMin: 20 } } : o)) }],
      });
      const ch = hero({ ancestryId: 'awakened-animal', heritageId: 'swimming-animal', effectChoices: { 'swimming-animal:aquatic-or-water-dwelling': 'water-dwelling' } } as Partial<BuildState>, patched);
      expect(ch.chosenEffects?.landSpeedMin, 'mergeEffect must carry the field through to chosenEffects').toBe(20);
      expect(deriveSpeeds(ch, patched).land).toBe(20);
      // …and the sibling branch on the SAME patched record still walks the chassis 5.
      const aquatic = hero({ ancestryId: 'awakened-animal', heritageId: 'swimming-animal', effectChoices: { 'swimming-animal:aquatic-or-water-dwelling': 'aquatic' } } as Partial<BuildState>, patched);
      expect(deriveSpeeds(aquatic, patched).land).toBe(5);
    });

    it('the aquatic branch keeps the chassis 5 — the floor is per-answer, never per-record', () => {
      const aquatic = hero({ ancestryId: 'awakened-animal', heritageId: 'swimming-animal', effectChoices: { 'swimming-animal:aquatic-or-water-dwelling': 'aquatic' } } as Partial<BuildState>);
      expect(aquatic.chosenEffects?.landSpeedMin).toBeUndefined();
      expect(deriveSpeeds(aquatic, db).land).toBe(5);
    });
  });

  /* *"Add Draconic to your ancestry's list of additional languages (allowing you to choose it as a
   * language if your Intelligence modifier is positive)."* — Dragonblood. Print WIDENS the menu; it
   * does not hand the language over, so `grantsLanguages` would have been wrong. The list is the
   * ancestry's, so the widened entry is labelled after the HERITAGE that added it. */
  describe("a heritage widens the ancestry's additional-languages list", () => {
    const languageOptions = (content_: ContentDatabase, over: Partial<BuildState>) => {
      const b = { ...emptyBuild(), name: 't', level: 1, classId: 'wizard', keyAbility: 'int', backgroundId: 'acrobat', ancestryId: 'human', ...over } as BuildState;
      const r = renderDom(createElement(LanguageEditor, { build: b, actions: {} as BuilderActions, content: content_ }));
      // The options live inside the popup, which opens on the slot control — the same click a player makes.
      r.click(r.host.querySelector('[data-ctl="popup"]'));
      const text = r.host.textContent ?? '';
      r.stop();
      return text;
    };

    it('Draconic is tagged as the DRAGONBLOOD list, not the human one', () => {
      const patched = withHeritage('dragonblood', { addsLanguageOptions: ['draconic'] });
      expect(db.ancestries['human'].languages.options ?? []).not.toContain('draconic');
      expect(languageOptions(patched, { heritageId: 'dragonblood' })).toContain('Draconic · Dragonblood list');
    });

    it('without the row Draconic is still offered, just unlisted — print widens a menu, it does not grant', () => {
      // The shipped record carries the row (batch 25); strip it to see the un-widened menu.
      expect(db.heritages['dragonblood'].addsLanguageOptions).toEqual(['draconic']);
      const stripped = withHeritage('dragonblood', { addsLanguageOptions: undefined });
      const plain = languageOptions(stripped, { heritageId: 'dragonblood' });
      expect(plain).toContain('Draconic');
      expect(plain).not.toContain('Draconic · ');
      expect(languageOptions(db, { heritageId: 'dragonblood' })).toContain('Draconic · Dragonblood list');
    });

    it("the ancestry's own list keeps its ancestry label", () => {
      const patched = withHeritage('dragonblood', { addsLanguageOptions: ['draconic'] });
      const dwarf = languageOptions(patched, { ancestryId: 'dwarf', heritageId: 'dragonblood' });
      const listed = db.ancestries['dwarf'].languages.options ?? [];
      expect(listed.length).toBeGreaterThan(0);
      expect(dwarf).toContain(`${db.languages[listed[0]].name} · Dwarf list`);
      expect(dwarf).toContain('Draconic · Dragonblood list');
    });
  });

  /* *"You have a 10-foot aura that grants any ally in it a +1 circumstance bonus to saving throws
   * against fear; this is an emotion and mental effect."* — Hopeful Athamaru. Ally-facing, so it is
   * carried as a mode NOTE (the cat-bless shape) with no self modifier, gated on the heritage id —
   * which `modeGateIds` already puts in the gate set. */
  describe('the hope aura reaches the player as a heritage-gated mode', () => {
    const mode = () => CATALOG_MODES.find((m) => m.id === 'cat-hope-aura');

    it('is offered to a Hopeful Athamaru and to nobody else', () => {
      const m = mode();
      expect(m, 'cat-hope-aura is missing from the catalogue').toBeTruthy();
      const relevant = (heritageId: string) => {
        const ch = hero({ ancestryId: 'athamaru', heritageId } as Partial<BuildState>);
        return modeRelevant(m!, ch.classId, ch.ancestryId, modeGateIds(ch, db));
      };
      expect(relevant('hopeful-athamaru')).toBe(true);
      const otherAthamaru = Object.values(db.heritages).find((h) => h.ancestryId === 'athamaru' && h.id !== 'hopeful-athamaru');
      expect(otherAthamaru, 'need a second athamaru heritage as the negative control').toBeTruthy();
      expect(relevant(otherAthamaru!.id)).toBe(false);
    });

    it('states the ALLY bonus and claims no bonus for the athamaru', () => {
      const m = mode()!;
      expect(m.note).toContain('+1 circumstance bonus to saving throws against fear');
      // The character does not get it, so a self modifier would be a lie on their own save line.
      expect(m.modifiers).toEqual([]);
    });
  });

  /* *"You gain a +1 circumstance bonus to Reflex saving throws"* (Ponygait Centaur) and *"you gain a
   * +2 status bonus to Fortitude and Will saving throws"* (Peerless Form). Neither names a trigger,
   * so neither is situational — but there was no numeric save carrier at all and both were parked on
   * situationalBonuses.ts, which is DISPLAY-ONLY by its own header. */
  describe('a record can state an unconditional save bonus as a NUMBER', () => {
    const centaur = { ancestryId: 'centaur', heritageId: 'ponygait-centaur' } as Partial<BuildState>;
    // The SHIPPED row (batch 25) against the same record with the field stripped.
    const stripped = () => withHeritage('ponygait-centaur', { saveBonuses: undefined });

    it("Ponygait Centaur's +1 circumstance moves the Reflex total", () => {
      expect(db.heritages['ponygait-centaur'].saveBonuses).toEqual([{ save: 'reflex', value: 1, type: 'circumstance' }]);
      const s = stripped();
      expect(deriveSave(hero(centaur), 'reflex', db).modifier - deriveSave(hero(centaur, s), 'reflex', s).modifier).toBe(1);
    });

    it('and only the save it names', () => {
      const s = stripped();
      for (const save of ['fortitude', 'will'] as const) {
        expect(deriveSave(hero(centaur), save, db).modifier).toBe(deriveSave(hero(centaur, s), save, s).modifier);
      }
    });

    it('it pools by TYPE — Take Cover does not stack a second circumstance bonus on top', () => {
      const s = stripped();
      const cover = CATALOG_MODES.find((m) => m.id === 'cat-take-cover')!;
      const plain = deriveSave(hero(centaur, s), 'reflex', s).modifier;
      const withCover = deriveSave({ ...hero(centaur), activeModes: [cover] }, 'reflex', db).modifier;
      // Cover is +2 circumstance and the heritage +1 circumstance: the better one stands, so +2 total.
      expect(withCover - plain).toBe(2);
    });

    it('a FEAT carrier works too — Peerless Form is the same shape on two saves', () => {
      // Shipped (batch 25): the two status rows replaced the display-only star in situationalBonuses.ts.
      expect(db.feats['peerless-form'].saveBonuses).toEqual([
        { save: 'fortitude', value: 2, type: 'status' },
        { save: 'will', value: 2, type: 'status' },
      ]);
      const s = { ...db, feats: { ...db.feats, 'peerless-form': { ...db.feats['peerless-form'], saveBonuses: undefined } } } as ContentDatabase;
      const monk = (content_: ContentDatabase) =>
        buildCharacter({ ...emptyBuild(), name: 't', level: 14, classId: 'monk', keyAbility: 'str', ancestryId: 'human', backgroundId: 'acrobat', featPicks: { '14:class': 'peerless-form' } } as BuildState, content_);
      expect(monk(db).feats.some((f) => f.featId === 'peerless-form')).toBe(true);
      for (const save of ['fortitude', 'will'] as const) {
        expect(deriveSave(monk(db), save, db).modifier - deriveSave(monk(s), save, s).modifier).toBe(2);
      }
      expect(deriveSave(monk(db), 'reflex', db).modifier).toBe(deriveSave(monk(s), 'reflex', s).modifier);
    });
  });

  /* Howl of the Wild, Animal Attacks sidebar: *"Your heritage gives you a special unarmed attack INSTEAD OF
   * the fist unarmed attack humanoids typically gain."* Two halves, both new in batch 25: the heritage's
   * own picker answer reaches collectGrantedNaturals (the tagged rows were all dropped before), and the
   * baseline Fist steps aside once a heritage attack is present — for this ancestry only. */
  describe('an awakened animal has its animal attack instead of a Fist', () => {
    const animal = (heritageId: string, pick?: string) =>
      hero({ ancestryId: 'awakened-animal', heritageId, ...(pick ? { effectChoices: { [`${heritageId}:${heritageId}-attack`]: pick } } : {}) } as Partial<BuildState>);
    const names = (ch: ReturnType<typeof hero>) => deriveStrikes(ch, db).map((s) => s.name);

    it('the answered pick is the Strike, and the Fist is gone', () => {
      expect(db.ancestries['awakened-animal'].heritageAttackReplacesFist).toBe(true);
      const jaws = animal('climbing-animal', 'jaws');
      expect(jaws.naturalAttacks?.map((n) => [n.name, n.source])).toEqual([['Jaws', 'climbing-animal']]);
      expect(names(jaws)).toContain('Jaws');
      expect(names(jaws)).not.toContain('Fist');
    });

    it('unanswered, the character still has a Fist to Strike with', () => {
      const none = animal('flying-animal');
      expect(none.naturalAttacks ?? []).toEqual([]);
      expect(names(none)).toContain('Fist');
    });

    it('an ancestry without the flag keeps the Fist beside its heritage attack (Razortooth Goblin)', () => {
      const goblin = hero({ ancestryId: 'goblin', heritageId: 'razortooth-goblin' } as Partial<BuildState>);
      expect(goblin.naturalAttacks?.some((n) => n.source === 'razortooth-goblin')).toBe(true);
      expect(names(goblin)).toContain('Fist');
    });
  });
});

/* ─── verifier's block: the two gaps the reports named as "outside my files" ─── */
describe('batch 25 — what the PLAYER sees matches what the engine granted', () => {
  /*
   * Laborer Android's *"You become trained in Athletics (or another skill if you're already trained in
   * Athletics)"* now trains Athletics on an UNANSWERED build (build.ts resolvePick's skill-only
   * default). The builder control still rendered `value ?? ''` — blank — so the sheet said trained and
   * the origin page said nothing was chosen: the same question answered two different ways depending
   * on which screen you were looking at. Both sides now read `effectChoiceDefault`.
   */
  it('the heritage picker SHOWS the skill the engine defaulted to', () => {
    const b = { ...emptyBuild(), name: 't', level: 1, classId: 'wizard', keyAbility: 'int', backgroundId: 'acrobat', ancestryId: 'android', heritageId: 'laborer-android' } as BuildState;
    expect(buildCharacter(b, db).proficiencies.skills['athletics'], 'the engine grants it unanswered').toBe('trained');
    const r = renderDom(createElement(EffectChoicesPicker, { recordId: 'laborer-android', choices: db.heritages['laborer-android'].effectChoices, build: b, actions: {} as BuilderActions, content: db }));
    const ctl = r.host.querySelector('[data-ctl="popup"]');
    expect(ctl?.getAttribute('data-ctl-state'), 'a blank control would deny a training the sheet has').toBe('picked');
    expect(r.host.textContent).toContain('Athletics');
    r.stop();
  });

  it('a REAL either/or still shows blank — the default is skill-only, on both sides', () => {
    // Swimming Animal's *"Choose if you are aquatic or water-dwelling"* grants a trait and a Speed, so
    // no answer may be assumed; the control must keep asking.
    const b = { ...emptyBuild(), name: 't', level: 1, classId: 'wizard', keyAbility: 'int', backgroundId: 'acrobat', ancestryId: 'awakened-animal', heritageId: 'swimming-animal' } as BuildState;
    const r = renderDom(createElement(EffectChoicesPicker, { recordId: 'swimming-animal', choices: db.heritages['swimming-animal'].effectChoices, build: b, actions: {} as BuilderActions, content: db }));
    expect(r.host.querySelector('[data-ctl="popup"]')?.getAttribute('data-ctl-state')).toBe('empty');
    r.stop();
  });

  it('a stored answer still wins over the default in the control', () => {
    const b = { ...emptyBuild(), name: 't', level: 1, classId: 'wizard', keyAbility: 'int', backgroundId: 'acrobat', ancestryId: 'android', heritageId: 'laborer-android', effectChoices: { 'laborer-android:trained-skill': 'stealth' } } as BuildState;
    const r = renderDom(createElement(EffectChoicesPicker, { recordId: 'laborer-android', choices: db.heritages['laborer-android'].effectChoices, build: b, actions: {} as BuilderActions, content: db }));
    expect(r.host.textContent).toContain('Stealth');
    r.stop();
  });
});
