// @vitest-environment jsdom
// jsdom so a later append to this file can render a builder control without moving the header; the
// engine assertions below are pure and unaffected by the environment.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { content } from './_content';
import { renderDom, renderText } from './_render';
import { Builder } from '../src/builder/Builder';
import { VitalsRail } from '../src/sheet/VitalsRail';
import { MainTab } from '../src/sheet/MainTab';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { creatureTraitsOf, deriveBulk, deriveDefenses, modeGateIds } from '../src/rules/derive';
import { CATALOG_MODE_MAP, modeRelevant } from '../src/rules/modes';
import { senseDesc } from '../src/rules/glossary';
import type { Character, ContentDatabase } from '../src/rules/types';

const db = content();

/**
 * Wanderer's-Guide parity batch 27 — the ENGINE half (types + build).
 *
 * Every assertion is made on a BUILT character. Where the carrier is a DATA row the data lane
 * authors, BOTH legs patch the record explicitly — the "with the row" leg and the "row stripped" leg —
 * so neither flips the moment the row lands.
 */

/** The shipped content with one heritage record patched — the row the data lane will author. */
const withHeritage = (id: string, patch: Record<string, unknown>): ContentDatabase =>
  ({ ...db, heritages: { ...db.heritages, [id]: { ...db.heritages[id], ...patch } } }) as ContentDatabase;

/** …and one feat record, for the Grand Metamorphosis rows. */
const withFeat = (id: string, patch: Record<string, unknown>): ContentDatabase =>
  ({ ...db, feats: { ...db.feats, [id]: { ...db.feats[id], ...patch } } }) as ContentDatabase;

const hero = (over: Partial<BuildState>, content_ = db): Character =>
  buildCharacter(
    { ...emptyBuild(), name: 't', level: 1, classId: 'wizard', keyAbility: 'int', backgroundId: 'acrobat', ...over } as BuildState,
    content_,
  );

describe('batch 27 — heritage carriers (engine 1: types + build)', () => {
  /*
   * sacred-nagaji#fangs
   * "INSTEAD OF a fangs unarmed attack, you have a tail attack that deals 1d6 bludgeoning damage, is in
   * the brawling weapon group, and has the finesse and unarmed traits." (AoN heritage-217)
   *
   * collectGrantedNaturals dedupes on the Strike's own lowercased name, so the heritage's Tail and the
   * nagaji chassis's Fangs both survived and a sacred nagaji fought with two unarmed attacks.
   */
  it("a heritage's replacesStrikes suppresses the ancestry Strike it names", () => {
    const names = (ch: Character) => (ch.naturalAttacks ?? []).map((n) => n.name);
    const replacing = withHeritage('sacred-nagaji', { replacesStrikes: ['Fangs'] });
    // …and the same record with the field STRIPPED, which is what it ships as today.
    const stripped = withHeritage('sacred-nagaji', { replacesStrikes: undefined });

    const sacred = (c_: ContentDatabase) => hero({ ancestryId: 'nagaji', heritageId: 'sacred-nagaji' }, c_);
    expect(names(sacred(replacing))).toContain('Tail');
    expect(names(sacred(replacing)), 'print gives the tail INSTEAD OF the fangs').not.toContain('Fangs');
    expect(names(sacred(stripped)), 'without the row both survive — the defect this closes').toContain('Fangs');

    // Only the heritage that prints it: a hooded nagaji's Venomous Spit is additive, so it keeps Fangs.
    const hooded = names(hero({ ancestryId: 'nagaji', heritageId: 'hooded-nagaji' }, replacing));
    expect(hooded).toContain('Fangs');
    expect(hooded).toContain('Venomous Spit');
  });

  /*
   * deep-orc#terrain-expertise-unbound
   * "You gain the Terrain Expertise skill feat FOR UNDERGROUND TERRAIN and the Combat Climber skill
   * feat." (AoN heritage-274) — the granted feat's ten-option terrain question is never rendered for a
   * granted feat, so the Survival star hung off an empty answer. FEAT_GRANT_BOUND_CHOICE is code, so
   * this runs on the SHIPPED data.
   */
  it('deep orc pins its granted Terrain Expertise to underground', () => {
    const orc = hero({ ancestryId: 'orc', heritageId: 'deep-orc' });
    const te = orc.feats.find((f) => f.featId === 'terrain-expertise');
    expect(te, 'the heritage grants it through FEAT_FEAT_GRANTS').toBeTruthy();
    expect(te!.choice?.value).toBe('underground');
    expect(db.feats['terrain-expertise'].choice?.options?.some((o) => o.value === 'underground')).toBe(true);
    // The other half of the same sentence still arrives.
    expect(orc.feats.some((f) => f.featId === 'combat-climber')).toBe(true);
  });

  /*
   * respite-of-a-thousand-roofs#crafting + #cooking-lore
   * "you become trained in Crafting and Cooking Lore, and you gain the Improvise Tool skill feat"
   * (AoN heritage-411). The record shipped a dataWarning telling the player to apply it by hand — a
   * stale rejection from before grantSourcesForProficiency reached heritages. FEAT_GRANTS is code, so
   * this too runs on the shipped data.
   */
  it('respite of a thousand roofs trains Crafting AND Cooking Lore', () => {
    const control = hero({ ancestryId: 'yaksha', heritageId: 'respite-of-loam-and-leaf' });
    expect(control.proficiencies.skills.crafting, 'a yaksha wizard has no other source for it').toBe('untrained');

    const yaksha = hero({ ancestryId: 'yaksha', heritageId: 'respite-of-a-thousand-roofs' });
    expect(yaksha.proficiencies.skills.crafting).toBe('trained');
    // A FIXED Lore subject, not a loreChoices slot — print names Cooking Lore outright.
    expect(yaksha.proficiencies.skills['lore:cooking']).toBe('trained');
    expect(yaksha.feats.some((f) => f.featId === 'improvise-tool'), 'the feat half was already covered').toBe(true);
  });

  /*
   * lorekeeper-shisk#expert (the LORE half)
   * "You become trained in one Intelligence- or Wisdom-based skill of your choice and a Lore skill of
   * your choice… At 5th level, you become expert in the CHOSEN SKILLS." (AoN heritage-179)
   *
   * The skill half rides skillProgressionFromChoice (the data lane's row); a TYPED Lore has no option
   * to read a rank off, so its half needed a carrier of its own and sat at trained to 20th.
   */
  it("a heritage's loreProgression steps the Lore the player typed", () => {
    const rows = { loreChoices: 1, loreProgression: [{ level: 5, rank: 'expert' }] };
    const laddered = withHeritage('lorekeeper-shisk', rows);
    const stripped = withHeritage('lorekeeper-shisk', { ...rows, loreProgression: undefined });
    const shisk = (c_: ContentDatabase, level: number) =>
      hero({ level, ancestryId: 'shisk', heritageId: 'lorekeeper-shisk', heritageLore: ['Cooking'] }, c_)
        .proficiencies.skills['lore:cooking'];

    expect(shisk(laddered, 4), 'the step is printed at 5th, not before').toBe('trained');
    expect(shisk(laddered, 5)).toBe('expert');
    expect(shisk(stripped, 5), 'without the row the Lore never advances — the defect this closes').toBe('trained');
  });

  /*
   * THE SURKI CLUSTER — breaker/lantern/hardshell/elytron.
   *
   * Grand Metamorphosis (Feat 9): "One of your nodes has adapted into a new magic-emitting organ. You
   * gain ONE of the evolutions from your surki heritage." All four heritages carried the Evolution as an
   * unconditional record-level `grantsActions`, and the feat's own `surkiEvolution` flag had no reader
   * anywhere in src/ — so a 1st-level surki had the action and the 9th-level pick granted nothing.
   */
  const EVOLUTIONS = {
    id: 'evolution',
    prompt: 'Evolution',
    options: [
      { value: 'lantern-lens', label: 'Lantern — Focusing Lens', grant: { grantsActions: ['lantern-beam'] } },
      {
        value: 'elytron-wings',
        label: 'Elytron — Energized Wings',
        grant: { innateSpells: [{ spellId: 'fly', usesPerDay: 1, traditionFromChoiceFlag: 'magiphageTradition' }] },
      },
    ],
  };
  /** The post-row Grand Metamorphosis: the inert `choice` replaced by grant-carrying effectChoices. */
  const gm = (extra: Record<string, unknown> = {}) =>
    withFeat('grand-metamorphosis', { choice: undefined, effectChoices: [EVOLUTIONS], ...extra });
  /** A 9th-level surki who took the feat, with the heritage's ungated grants stripped as print requires. */
  const surki = (c_: ContentDatabase, heritageId: string, answer?: string, tradition = 'primal') =>
    hero(
      {
        level: 9,
        ancestryId: 'surki',
        heritageId,
        featPicks: { '9:ancestry:0': 'grand-metamorphosis' },
        featChoices: { 'ancestry:surki': tradition },
        ...(answer ? { effectChoices: { 'grand-metamorphosis:evolution': answer } } : {}),
      },
      { ...c_, heritages: { ...c_.heritages, [heritageId]: { ...c_.heritages[heritageId], grantsActions: undefined, innateSpells: undefined } } } as ContentDatabase,
    );

  it("an effectChoices option's grantsActions reaches the character", () => {
    const chosen = surki(gm(), 'lantern-surki', 'lantern-lens');
    expect(chosen.feats.some((f) => f.featId === 'grand-metamorphosis'), 'the 9th-level feat is placed').toBe(true);
    expect(chosen.grantedActionIds ?? []).toContain('lantern-beam');

    // …and ONLY through the pick: unanswered, the evolution is not had. (Two options, so nothing
    // auto-applies — which is the whole point of moving it off the 1st-level heritage record.)
    expect(surki(gm(), 'lantern-surki').grantedActionIds ?? []).not.toContain('lantern-beam');
  });

  /*
   * elytron-surki#fly-tradition
   * The surki ancestry's magiphage tradition "changes the tradition of all surki spells and magical
   * actions to that tradition", so the Evolution's Fly follows the player's answer. Option-level innate
   * grants were pushed BARE, skipping `asGranted`, so `traditionFromChoiceFlag` was never resolved and
   * every surki's Fly fell back to the spell's first tradition (arcane).
   */
  it("an option's innateSpells resolves traditionFromChoiceFlag against the ancestry's answer", () => {
    const traditions = (ch: Character) =>
      ch.spellcasting.find((s) => s.id === 'innate-casting')?.spellTraditions ?? {};

    expect(db.spells.fly.traditions?.[0], 'the fallback that was being taken').toBe('arcane');
    expect(traditions(surki(gm(), 'elytron-surki', 'elytron-wings', 'primal')).fly).toBe('primal');
    expect(traditions(surki(gm(), 'elytron-surki', 'elytron-wings', 'occult')).fly).toBe('occult');

    // …and with the flag stripped from the row, the old fallback — so the assertion above is the flag's.
    const flagless = gm({
      effectChoices: [
        { ...EVOLUTIONS, options: [EVOLUTIONS.options[0], { ...EVOLUTIONS.options[1], grant: { innateSpells: [{ spellId: 'fly', usesPerDay: 1 }] } }] },
      ],
    });
    expect(traditions(surki(flagless, 'elytron-surki', 'elytron-wings', 'primal')).fly).toBe('arcane');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────────────────────────
 * END OF ENGINE AGENT 1's SECTION — append new describe blocks BELOW this line.
 * ───────────────────────────────────────────────────────────────────────────────────────────────── */

/*
 * Batch 27 — the DERIVE/EXPLAIN/DISPLAY half (engine agent 2).
 *
 * Same rule as above: where the carrier is a data row somebody else authors, the "with the row" leg
 * patches the record explicitly and the "without" leg strips it, so neither flips when the row lands.
 */
describe('batch 27 — derive, modes, glossary and the sheet side (engine 2)', () => {
  /*
   * tsukumogami-poppet#fire-not-removed
   * "If your body is primarily wood or cloth, you have the normal poppet weakness to fire. If your body
   * is primarily metal, you're INSTEAD weak to electricity; if it's primarily ceramic, you're INSTEAD
   * weak to cold." (AoN heritage-383, over the poppet chassis' Flammable.)
   *
   * The only remover in the engine walked FEATS, so nothing could drop the ancestry's fire weakness and
   * a metal tsukumogami was weak to fire AND electricity at once.
   */
  const MATERIAL = {
    id: 'poppet-material',
    prompt: "Choose your body's primary material",
    options: [
      { value: 'wood-cloth', label: 'Wood or cloth', grant: { weaknesses: [{ type: 'fire', value: 'max(1,floor(@actor.level/3))' }] } },
      { value: 'metal', label: 'Metal', grant: { weaknesses: [{ type: 'electricity', value: 'max(1,floor(@actor.level/3))' }], removesWeaknesses: ['fire'] } },
      { value: 'ceramic', label: 'Ceramic', grant: { weaknesses: [{ type: 'cold', value: 'max(1,floor(@actor.level/3))' }], removesWeaknesses: ['fire'] } },
    ],
  };
  /** The heritage with the removal authored, and the same record with only that field stripped. */
  const material = (removing: boolean): ContentDatabase =>
    withHeritage('tsukumogami-poppet', {
      effectChoices: [
        {
          ...MATERIAL,
          options: MATERIAL.options.map((o) => (removing ? o : { ...o, grant: { ...o.grant, removesWeaknesses: undefined } })),
        },
      ],
    });
  const poppet = (answer: string, c_: ContentDatabase): Character =>
    hero(
      { ancestryId: 'poppet', heritageId: 'tsukumogami-poppet', effectChoices: { 'tsukumogami-poppet:poppet-material': answer } },
      c_,
    );
  const weakTypes = (ch: Character, c_: ContentDatabase) => deriveDefenses(ch, c_).weaknesses.map((w) => w.type);

  it("an answered heritage option can REMOVE the chassis weakness it replaces", () => {
    const withRow = material(true);
    expect(weakTypes(poppet('metal', withRow), withRow), 'metal is weak to electricity').toContain('electricity');
    expect(weakTypes(poppet('metal', withRow), withRow), '"INSTEAD of" fire — the defect this closes').not.toContain('fire');
    expect(weakTypes(poppet('ceramic', withRow), withRow)).toContain('cold');
    expect(weakTypes(poppet('ceramic', withRow), withRow)).not.toContain('fire');

    // The branch that keeps it: a wooden poppet has "the normal poppet weakness to fire" and nothing else.
    expect(weakTypes(poppet('wood-cloth', withRow), withRow)).toEqual(['fire']);

    // …and with the field stripped, fire survives beside electricity — what shipped before this.
    const without = material(false);
    expect(weakTypes(poppet('metal', without), without)).toContain('fire');
  });

  /*
   * breaker-surki#evolved-claw
   * "**Evolution** … You can spend an Interact action to increase your claw unarmed attack's damage to
   * 1d6; grant it the magical, razing, and versatile force traits; and remove the agile trait."
   *
   * A TOGGLE (print gives a second action to retract it), gated on the 9th-level Grand Metamorphosis
   * answer — which no mode could reach, because `modeGateIds` emitted `<record>:<answer>` keys only for
   * a `choice`, never for an `effectChoices` pick.
   */
  it("a mode gates on an effectChoices ANSWER, so only the picked evolution is offered", () => {
    const wedge = CATALOG_MODE_MAP['cat-breaker-wedge'];
    expect(wedge, 'the Digging Wedge toggle exists').toBeTruthy();
    expect(wedge.grantedStrikes?.[0].die, 'print: "increase your claw unarmed attack\'s damage to 1d6"').toBe('d6');
    expect(wedge.grantedStrikes?.[0].traits).toEqual(expect.arrayContaining(['magical', 'razing', 'versatile-force']));
    expect(wedge.grantedStrikes?.[0].traits, 'print: "and remove the agile trait"').not.toContain('agile');

    const evolutions = {
      id: 'evolution',
      prompt: 'Evolution',
      options: [
        { value: 'breaker-wedge', label: 'Breaker — Digging Wedge' },
        { value: 'breaker-spikes', label: 'Breaker — Claw Spikes' },
      ],
    };
    const c_ = withFeat('grand-metamorphosis', { choice: undefined, effectChoices: [evolutions] });
    const breaker = (answer?: string) =>
      hero(
        {
          level: 9,
          ancestryId: 'surki',
          heritageId: 'breaker-surki',
          featPicks: { '9:ancestry:0': 'grand-metamorphosis' },
          ...(answer ? { effectChoices: { 'grand-metamorphosis:evolution': answer } } : {}),
        },
        c_,
      );
    const offered = (answer?: string) => modeRelevant(wedge, 'wizard', 'surki', modeGateIds(breaker(answer), c_));

    expect(modeGateIds(breaker('breaker-wedge'), c_)).toContain('grand-metamorphosis:breaker-wedge');
    expect(offered('breaker-wedge')).toBe(true);
    // The OTHER evolution, and no evolution at all: the wedge belongs to neither.
    expect(offered('breaker-spikes'), 'print gives ONE of the evolutions').toBe(false);
    expect(offered()).toBe(false);
  });

  /*
   * shimmertongue-nagaji#magicsense-acuity
   * "You gain magicsense as a VAGUE sense that has a range of 30 feet."
   *
   * The record was already authored `acuity: 'vague'`, so the sheet printed "Magicsense (vague 30 ft)"
   * over a glossary tooltip that called the same sense imprecise.
   */
  it("the magicsense blurb agrees with the acuity every magicsense grant is authored with", () => {
    const nagaji = hero({ ancestryId: 'nagaji', heritageId: 'shimmertongue-nagaji' });
    const ms = deriveDefenses(nagaji, db).senses.find((s) => s.name === 'magicsense');
    expect(ms?.acuity, 'the record itself').toBe('vague');
    expect(senseDesc('magicsense')).toContain('vague');
    expect(senseDesc('magicsense'), 'the tooltip used to contradict the label beside it').not.toContain('imprecise');
  });

  /*
   * carcharodon-merfolk#blood-range
   * "You gain scent as an imprecise sense with a range of 30 feet. However, you can smell spilled blood
   * at a range of 120 feet in the air and 500 feet in the water."
   *
   * The second sentence has no home in a sense's own range, so it reached no pixel — SenseEntry.note
   * (engine agent 1) carries it and the Senses row prints it beside the sense.
   */
  it("a sense's stimulus-specific note reaches the Senses row", () => {
    const NOTE = 'You smell spilled blood at 120 feet in the air and 500 feet in the water.';
    const withNote = withHeritage('carcharodon-merfolk', { senses: [{ name: 'scent', range: 30, acuity: 'imprecise', note: NOTE }] });
    const merfolk = (c_: ContentDatabase) => hero({ ancestryId: 'merfolk', heritageId: 'carcharodon-merfolk' }, c_);

    const shown = (c_: ContentDatabase) =>
      renderText(createElement(VitalsRail, { character: merfolk(c_), content: c_ }));
    expect(shown(withNote)).toContain(NOTE);
    // …and stripped, the row says only "scent 30 ft (imprecise)" — the state that lost the sentence.
    expect(shown(withHeritage('carcharodon-merfolk', { senses: [{ name: 'scent', range: 30, acuity: 'imprecise' }] }))).not.toContain(NOTE);
  });

  /*
   * monstrous-skeleton + born-of-vegetation — the harness reported NO CONTROL for either.
   *
   * "You gain a claw, horn, tail, or wing unarmed attack…" (heritage-202) and "You gain your choice of
   * the plant or fungus trait" (heritage-416). Both are `effectChoices` rows the data lane authors; this
   * pins that the builder's heritage picker is not gated on anything they lack, so the question appears
   * the moment the row lands — and that the answer reaches the character.
   */
  it('a heritage effectChoices row renders its picker and its answer applies', () => {
    const skeleton = withHeritage('monstrous-skeleton', {
      effectChoices: [
        {
          id: 'attack',
          prompt: 'Select a skeletal attack',
          options: [
            { value: 'claw', label: 'Claw' },
            { value: 'horn', label: 'Horn' },
            { value: 'tail', label: 'Tail' },
            { value: 'wing', label: 'Wing' },
          ],
        },
      ],
    });
    const vegetation = withHeritage('born-of-vegetation', {
      effectChoices: [
        {
          id: 'form-trait',
          prompt: 'Plant or fungus trait',
          options: [
            { value: 'plant', label: 'Plant', grant: { grantsCreatureTraits: ['plant'] } },
            { value: 'fungus', label: 'Fungus', grant: { grantsCreatureTraits: ['fungus'] } },
          ],
        },
      ],
    });

    const prompts = (c_: ContentDatabase, ancestryId: string, heritageId: string): string[] => {
      const initial = { ...emptyBuild(), name: 't', level: 1, classId: 'fighter', keyAbility: 'str', ancestryId, heritageId } as BuildState;
      const r = renderDom(
        createElement(Builder, { content: c_, initial, onCancel: () => undefined, onCreate: () => undefined }),
      );
      // Page 0 is Origins — where the ancestry, heritage and their pickers live.
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === '0') ?? null);
      const titles = [...r.host.querySelectorAll<HTMLElement>('[data-ctl]')].map((el) => el.dataset.ctlTitle ?? '');
      r.stop();
      return titles;
    };

    expect(prompts(skeleton, 'skeleton', 'monstrous-skeleton')).toContain('Select a skeletal attack');
    expect(prompts(vegetation, 'yaoguai', 'born-of-vegetation')).toContain('Plant or fungus trait');
    // No control at all without the row — the harness's "NO CONTROL", proving the assertion above.
    expect(prompts(db, 'skeleton', 'monstrous-skeleton')).not.toContain('Select a skeletal attack');

    // …and the four choiceValue-tagged Strikes, dropped today because there is no answer to match.
    const claw = hero({ ancestryId: 'skeleton', heritageId: 'monstrous-skeleton', effectChoices: { 'monstrous-skeleton:attack': 'claw' } }, skeleton);
    expect((claw.naturalAttacks ?? []).map((n) => n.name)).toContain('Claw');
    expect(hero({ ancestryId: 'skeleton', heritageId: 'monstrous-skeleton' }, db).naturalAttacks ?? []).toHaveLength(0);

    // The vegetation answer is load-bearing: Yaoguai Form keys its +1 off which trait you hold.
    const plant = hero({ ancestryId: 'yaoguai', heritageId: 'born-of-vegetation', effectChoices: { 'born-of-vegetation:form-trait': 'plant' } }, vegetation);
    expect(creatureTraitsOf(plant, vegetation).map((t) => t.trait)).toContain('plant');
  });

  /*
   * deny-lady-nanbyos-charity#bulk (engine agent 1 declared the pair; this is its reader)
   * "You can carry 1 more Bulk before becoming encumbered and 2 more before reaching your maximum."
   *
   * ⚠ The VALUES are on the Rulings Desk (print's +1/+2 against WG's flat +2/+2), so the test asserts
   * only that the two thresholds move INDEPENDENTLY — which is the half no field could express before.
   */
  /*
   * lantern-surki#evolution-overgrant — THE SHEET HALF (added by the verifier).
   *
   * *"You gain ONE of the evolutions from your surki heritage"* (Grand Metamorphosis, Feat 9). The
   * answer's action reached `Character.grantedActionIds`, but MainTab's granted-action walk read
   * RECORDS only, so the evolution the player picked appeared on no action list — measured on a real
   * MainTab: with the answer applied and the heritage's 1st-level grant stripped, the Actions sub-tab
   * did not name Lantern Beam. Without this, the whole surki cluster moves nothing a player can see.
   */
  it("an action an ANSWER granted reaches the Main tab's action list", () => {
    const gmActions = withFeat('grand-metamorphosis', {
      choice: undefined,
      effectChoices: [
        {
          id: 'evolution',
          prompt: 'Evolution',
          options: [
            { value: 'lantern-lens', label: 'Lantern — Focusing Lens', grant: { grantsActions: ['lantern-beam'] } },
            { value: 'lantern-strobe', label: 'Lantern — Secondary Emitters' },
          ],
        },
      ],
    });
    // …with the heritage's ungated 1st-level grant gone, which is the row the data lane authors: the
    // action must be there because of the ANSWER, not because the record still hands it out.
    const c_ = {
      ...gmActions,
      heritages: { ...gmActions.heritages, 'lantern-surki': { ...gmActions.heritages['lantern-surki'], grantsActions: undefined } },
    } as ContentDatabase;
    const surkiAt9 = (answer?: string) =>
      hero(
        {
          level: 9,
          ancestryId: 'surki',
          heritageId: 'lantern-surki',
          featPicks: { '9:ancestry:0': 'grand-metamorphosis' },
          ...(answer ? { effectChoices: { 'grand-metamorphosis:evolution': answer } } : {}),
        },
        c_,
      );
    // The Main tab opens on Strikes; the action list is one click away, exactly as for a player.
    const actionsPane = (answer?: string) =>
      renderText(createElement(MainTab, { character: surkiAt9(answer), content: c_, onPlay: () => undefined }), ['Actions']);

    expect(surkiAt9('lantern-lens').grantedActionIds ?? []).toContain('lantern-beam');
    expect(actionsPane('lantern-lens')).toContain('Lantern Beam');
    // The other evolution, and none: the action belongs only to the player who picked it.
    expect(actionsPane('lantern-strobe')).not.toContain('Lantern Beam');
    expect(actionsPane()).not.toContain('Lantern Beam');
  });

  it("a heritage moves the encumbered and maximum Bulk thresholds by different amounts", () => {
    const base = hero({ ancestryId: 'human', heritageId: 'skilled-human' });
    const plain = deriveBulk(base, db);
    const patched = withHeritage('skilled-human', { bulkLimitBonus: 1, bulkMaxBonus: 1 });
    const moved = deriveBulk(hero({ ancestryId: 'human', heritageId: 'skilled-human' }, patched), patched);

    expect(moved.encumberedAt, '+1 before encumbered').toBe(plain.encumberedAt + 1);
    expect(moved.max, '…and +2 in all before the maximum').toBe(plain.max + 2);
  });
});
