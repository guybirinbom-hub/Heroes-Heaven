import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import type { BuildState } from '../src/rules/build';
import { characterSituationalIds, recordMarkersFor, statHasSituational } from '../src/rules/explain';
import { featSituationalFor } from '../src/rules/situationalBonuses';

const db = content();

/**
 * Wanderer's-Guide parity batch 27, STARS lane: printed heritage clauses that reached no row on the
 * sheet, plus three hand edits to rows the situational lane had generated with the wrong wording.
 *
 * Same discipline as batches 25 and 26: every assertion goes through the reader the SHEET uses —
 * `characterSituationalIds` / `recordMarkersFor` over a BUILT character — never over the registry
 * literal. An entry keyed to an id the character never contributes is invisible in play, so asserting
 * the table itself would prove nothing.
 */
type Ref = { kind: string; skill?: string; save?: string };

/** The situational clauses one owned record puts on a stat row, as the sheet would read them. */
const starsFrom = (heritageId: string, ancestryId: string, ref: Ref, sourceId = heritageId) => {
  const c = build('fighter', 5, { heritageId, ancestryId } as Partial<BuildState>);
  return featSituationalFor(characterSituationalIds(c, db), ref).filter((s) => s.id === sourceId);
};

/** The `when :: bonus` strings on that row, joined — what the player reads in the stat popup. */
const text = (heritageId: string, ancestryId: string, ref: Ref, sourceId = heritageId) =>
  starsFrom(heritageId, ancestryId, ref, sourceId)
    .map((s) => `${s.when} :: ${s.bonus}`)
    .join(' | ');

/** The action/condition marks a heritage puts on one row, by source id. */
const marks = (heritageId: string, ancestryId: string, on: 'action' | 'condition', id: string) => {
  const c = build('fighter', 5, { heritageId, ancestryId } as Partial<BuildState>);
  return recordMarkersFor(c, db, on, id).filter((m) => m.sourceId === heritageId);
};

describe('flat-check clauses reach the row the player rolls on', () => {
  it('Stormtossed Tengu: rain and fog concealment (heritage-358)', () => {
    /* Printed: "You automatically succeed at the flat check to target a concealed creature if that
     * creature is concealed only by rain or fog." The record carried only the electricity resistance,
     * and WG carries only that too. */
    const t = text('stormtossed-tengu', 'tengu', { kind: 'strikeAttack' });
    expect(t).toContain('concealed only by rain or fog');
    expect(t).toContain('automatically succeed at the flat check');
  });

  it('Thickcoat Shoony: snow concealment, plus BOTH environmental steps (heritage-57)', () => {
    /* Printed: "…you treat environmental cold effects as if they were one step less extreme… You
     * don't need to succeed at a flat check to target a concealed creature if that creature is
     * concealed only by snow. Unless you wear protective gear or take shelter, environmental heat
     * effects are one step more extreme for you." Only the cold resistance had ever shipped. */
    expect(text('thickcoat-shoony', 'shoony', { kind: 'strikeAttack' })).toContain('concealed only by snow');
    const saves = text('thickcoat-shoony', 'shoony', { kind: 'save', save: 'fortitude' });
    expect(saves).toContain('treat the cold as one step less extreme');
    // The heat clause is a PENALTY, and print's "Unless…" is not optional.
    expect(saves).toContain('unless you wear protective gear or take shelter');
    expect(saves).toContain('one step MORE extreme');
  });
});

describe('the environmental-cold sentence, four more heritages', () => {
  it.each([
    ['mountaineer-samsaran', 'samsaran'],
    ['glacier-cavern-minotaur', 'minotaur'],
    ['snow-rat', 'ratfolk'],
    ['winter-orc', 'orc'],
  ])('%s treats environmental cold as one step less extreme', (heritageId, ancestryId) => {
    /* Printed word for word on all four (heritage-387, -304, -352, -278): "You treat environmental
     * cold effects as if they were one step less extreme…" — the same sentence b25 and b26 already
     * carry for naari / winter-catfolk / desert-elf / snow-goblin / frozen-wind-kitsune /
     * wintertouched-human, which simply did not reach these records. */
    const t = text(heritageId, ancestryId, { kind: 'save', save: 'fortitude' });
    expect(t).toContain('against environmental cold effects');
    expect(t).toContain('treat the cold as one step less extreme');
  });
});

describe('poison afflictions step down for two more heritages', () => {
  it.each([
    ['reef-merfolk', 'merfolk'],
    ['venom-resistant-vishkanya', 'vishkanya'],
  ])('%s reduces an affliction stage on every success', (heritageId, ancestryId) => {
    /* Printed on both (heritage-301, -230): "each of your successful saving throws against a poison
     * affliction reduces its stage by 2, or by 1 for a virulent poison. Each critical success against
     * an ongoing poison reduces its stage by 3, or by 2 for a virulent poison." Both records carried
     * only the poison resistance — the same gap Strong-Blooded Dwarf's star already closes. */
    const t = text(heritageId, ancestryId, { kind: 'save', save: 'fortitude' });
    expect(t).toContain('against a poison affliction');
    expect(t).toContain('each success reduces the stage by 2 (1 if virulent)');
    expect(t).toContain('each critical success by 3 (2 if virulent)');
  });
});

describe('Healer Samsaran heals themselves harder (heritage-386)', () => {
  it('the level rider rides the Hit-Points row', () => {
    /* Printed: "When you use Medicine to Treat Wounds on yourself, you can use your special
     * techniques to add your level to the Hit Points you regain from the treatment." */
    const t = text('healer-samsaran', 'samsaran', { kind: 'hp' });
    expect(t).toContain('when you Treat Wounds on yourself');
    expect(t).toContain('add your level to the Hit Points you regain');
  });
});

describe('Shifting Skeleton: the bonus printed inside Rearrange Bones (action-2261)', () => {
  it('reaches Deception through the heritage GRANTED ACTION, not the heritage id', () => {
    /* Printed inside the action: "…this counts as setting up a disguise for the Impersonate use of
     * Deception, and grants a +1 status bonus to those Deception checks." The star is keyed by the
     * action, so this also pins the grantsActions route in `characterSituationalIds` — key it by the
     * heritage instead and it would fire for a character who never got the action. */
    const t = text('shifting-skeleton', 'skeleton', { kind: 'skill', skill: 'deception' }, 'rearrange-bones');
    expect(t).toContain('to Impersonate after you Rearrange Bones');
    expect(t).toContain('+1 status');
    // POSITIVE CONTROL on the route: a skeleton with a different heritage gets no such star.
    expect(text('sturdy-skeleton', 'skeleton', { kind: 'skill', skill: 'deception' }, 'rearrange-bones')).toBe('');
  });
});

describe('Waning Moon Sarangay: the once-per-day fortune reroll (heritage-394)', () => {
  /* Printed: "You become trained in your choice of Acrobatics, Crafting, or Performance. Once per
   * day, when you roll a critical failure with the chosen skill, you can reroll the check, taking
   * the new result, even if it's worse. Rerolling in this way is a fortune effect." The record had
   * the 1/day pips and the picker; no skill row said anything about the reroll. The star rides the
   * CHOSEN skill only — a CHOICE_SITUATIONAL entry reached through the heritage's effectChoices
   * answer (explain.ts feeds `answeredEffectOptions` into `choiceSituationalFor`), not all three. */
  /* Through the SHEET's reader (`statHasSituational`, the star on a skill row), because a choice star
   * is not keyed by record id — `featSituationalFor(ids)` cannot see it by design. A fighter sarangay
   * carries no other star on these three skills, so the boolean is the star. */
  const starred = (answer: string | undefined, skill: string) => {
    const c = build('fighter', 5, {
      heritageId: 'waning-moon-sarangay',
      ancestryId: 'sarangay',
      ...(answer ? { effectChoices: { 'waning-moon-sarangay:trained-skill': answer } } : {}),
    } as Partial<BuildState>);
    return statHasSituational(c, { kind: 'skill', skill }, db);
  };

  it('lands on the ONE skill the player chose, and on no other', () => {
    expect(starred('crafting', 'crafting')).toBe(true);
    expect(starred('crafting', 'acrobatics')).toBe(false);
    expect(starred('crafting', 'performance')).toBe(false);
    expect(starred('acrobatics', 'acrobatics')).toBe(true);
    expect(starred('acrobatics', 'crafting')).toBe(false);
  });

  it('unanswered, it follows the skill-only default (options[0], batch 25) — the star sits where the training sits', () => {
    // A skill-only heritage picker trains options[0] until answered (`effectChoiceDefault`), and the
    // reroll must never point at a skill the sheet is NOT training: Acrobatics only.
    expect(starred(undefined, 'acrobatics')).toBe(true);
    expect(starred(undefined, 'crafting')).toBe(false);
    expect(starred(undefined, 'performance')).toBe(false);
  });
});

describe('three generated rows corrected against print', () => {
  it('Sacred Nagaji covers both DCs, both maneuvers, and the saves clause (heritage-183)', () => {
    /* Printed: "You gain a +2 circumstance bonus on your Fortitude or Reflex DC against attempts to
     * Grapple or Trip you. This bonus also applies to saving throws against effects that would grab
     * you, restrain you, or knock you prone." The rows split Fort=Grapple / Reflex=Trip and stopped
     * before the second sentence. */
    /* House shape (the b25 rock-dwarf three-row shape, now shared with strong-oak): one row per DC
     * naming BOTH maneuvers, plus a save:'all' row for the printed second sentence. */
    const fort = text('sacred-nagaji', 'nagaji', { kind: 'save', save: 'fortitude' });
    const reflex = text('sacred-nagaji', 'nagaji', { kind: 'save', save: 'reflex' });
    const will = text('sacred-nagaji', 'nagaji', { kind: 'save', save: 'will' });
    expect(fort).toContain('to your Fortitude DC against attempts to Grapple or Trip you');
    expect(reflex).toContain('to your Reflex DC against attempts to Grapple or Trip you');
    for (const t of [fort, reflex, will]) {
      expect(t).toContain('grab you, restrain you, or knock you prone');
      expect(t).toContain('+2 circumstance');
    }
    // the elided wording is gone from both
    expect(fort).not.toContain('against attempts to Grapple you…');
    expect(reflex).not.toContain('against attempts to Trip you…');
    // …and strong-oak (b26) prints the same sentence and now shares the shape.
    expect(text('strong-oak', 'ghoran', { kind: 'save', save: 'will' })).toContain('grab you, restrain you, or knock you prone');
    expect(text('strong-oak', 'ghoran', { kind: 'save', save: 'fortitude' })).toContain('to your Fortitude DC against attempts to Grapple or Trip you');
    // ruling H's one-line cap, which the widened strings have to stay inside
    for (const s of [
      ...starsFrom('sacred-nagaji', 'nagaji', { kind: 'save', save: 'fortitude' }),
      ...starsFrom('sacred-nagaji', 'nagaji', { kind: 'save', save: 'reflex' }),
    ])
      expect(s.when.length).toBeLessThanOrEqual(120);
  });

  it('Kanchil states all three printed targets (heritage-381)', () => {
    /* Printed: "…a +1 circumstance bonus to Deception checks to Lie when specifically attempting to
     * avoid danger or punishment…, to Deception DCs against Sense Motive checks to uncover such lies,
     * and to initiative rolls when you roll Deception for initiative." Only the first shipped, and
     * its trailing ellipsis was where the DC clause belonged. */
    const dec = text('kanchil', 'sprite', { kind: 'skill', skill: 'deception' });
    expect(dec).toContain('to Lie specifically to avoid danger or punishment');
    expect(dec).toContain('your Deception DC vs Sense Motive to uncover it');
    expect(dec).not.toContain('avoid danger or punishment…');
    const init = text('kanchil', 'sprite', { kind: 'initiative' });
    expect(init).toContain('when you roll Deception for initiative');
    expect(init).toContain('+1 circumstance');
  });

  it('Respite of Cloudless Paths steps heat AND cold down (heritage-409)', () => {
    /* Printed: "Both environmental heat effects and environmental cold effects are one step less
     * extreme for you…, and you gain a +1 circumstance bonus to saving throws against environmental
     * features or hazards, such as floods, rockslides, and sandstorms." Only the +1 half shipped. */
    const t = text('respite-of-cloudless-paths', 'yaksha', { kind: 'save', save: 'reflex' });
    expect(t).toContain('treat the heat as one step less extreme');
    expect(t).toContain('treat the cold as one step less extreme');
    // the half that was already right is untouched
    expect(t).toContain('against environmental features or hazards');
    expect(t).toContain('+1 circumstance');
  });
});

describe('heritage clauses that change an action or a condition', () => {
  it('Shadow of the Courtier rerolls a failed Make an Impression (heritage-401)', () => {
    /* Printed: "Once per day, if you fail, but not critically fail, a check to Make an Impression,
     * you can play it off as part of a performance, allowing you to reroll the check; this is a
     * fortune effect." The record carried only the 1/day pips and the Impressive Performance grant. */
    const m = marks('shadow-of-the-courtier', 'wayang', 'action', 'make-an-impression');
    expect(m).toHaveLength(1);
    expect(m[0].value).toBe('1/day reroll on a failure');
    expect(m[0].note).toContain('reroll');
    expect(m[0].note).toContain('fortune');
  });

  it('Sailfish Merfolk can Swim before either jump (heritage-302)', () => {
    /* Printed: "…and you can Swim instead of Striding before attempting the jump." Only the +1
     * Athletics star shipped, on our side and on WG's. */
    for (const action of ['high-jump', 'long-jump'] as const) {
      const m = marks('sailfish-merfolk', 'merfolk', 'action', action);
      expect(m).toHaveLength(1);
      expect(m[0].note).toContain('Swim instead of Striding');
    }
  });

  it('Paddler Shoony ignores bog terrain (heritage-56)', () => {
    /* Printed: "You ignore difficult terrain and greater difficult terrain from bogs." A separate
     * sentence from the Swim clause the record's own degreeShifts carries. */
    for (const action of ['stride', 'step'] as const) {
      const m = marks('paddler-shoony', 'shoony', 'action', action);
      expect(m).toHaveLength(1);
      expect(m[0].note).toContain('greater difficult terrain from bogs');
    }
  });

  it('Wilderness Samsaran ignores undergrowth (heritage-390)', () => {
    /* Printed: "You can ignore difficult terrain from trees, foliage, and undergrowth." */
    const m = marks('wilderness-samsaran', 'samsaran', 'action', 'stride');
    expect(m).toHaveLength(1);
    expect(m[0].note).toContain('trees, foliage, and undergrowth');
  });

  it('Nyktera Seeks in a 60-foot cone (heritage-144)', () => {
    /* Printed FIRST sentence: "As long as you can hear normally, you can use the Seek action to sense
     * undetected creatures in a 60-foot cone instead of a 30-foot cone." Only the second sentence
     * (the +2) had a carrier on either side. */
    const m = marks('nyktera', 'sprite', 'action', 'seek');
    expect(m).toHaveLength(1);
    expect(m[0].value).toBe('60-foot cone');
    expect(m[0].note).toContain('60-foot cone instead of a 30-foot cone');
    // POSITIVE CONTROL: the +2 star the record already had is still on Perception.
    expect(text('nyktera', 'sprite', { kind: 'perception' })).toContain('+2 circumstance');
  });

  it('Born of Vegetation heals better in yaoguai form (heritage-416)', () => {
    /* Printed: "When anyone uses the Medicine skill to Treat your Wounds, add your level to the Hit
     * Points you regain from that treatment. Additionally, the creature attempting the check gains a
     * +1 circumstance bonus if you have the plant trait and are in bright light, or the fungus trait
     * and are in darkness." The +1 is on ANOTHER creature's check, so it can be no star of this
     * character's — the Treat Wounds row is where both halves are read. */
    const m = marks('born-of-vegetation', 'yaoguai', 'action', 'treat-wounds');
    expect(m).toHaveLength(1);
    expect(m[0].note).toContain('add your level to the HP you regain');
    expect(m[0].note).toContain('bright light');
    // POSITIVE CONTROL: the Humanoid Form star the record already had is untouched.
    expect(text('born-of-vegetation', 'yaoguai', { kind: 'skill', skill: 'medicine' })).toContain('Administer First Aid');
  });

  it('Virtuous Tanuki eats while sickened and drinks without falling over (heritage-400)', () => {
    /* Printed: "You can eat and drink things when you're sickened." and "You can't become
     * incapacitated by conventional alcohol if you don't wish to be." The sickened condition's own
     * shipped text states the unqualified ban on willingly ingesting anything. */
    const sick = marks('virtuous-tanuki', 'tanuki', 'condition', 'sickened');
    expect(sick).toHaveLength(1);
    expect(sick[0].note).toContain('eat and drink while sickened');
    const drunk = marks('virtuous-tanuki', 'tanuki', 'condition', 'unconscious');
    expect(drunk).toHaveLength(1);
    expect(drunk[0].note).toContain('alcohol');
  });

  it('Courageous Tanuki keeps one action while fleeing (heritage-398)', () => {
    /* Printed: "When you have the fleeing condition, instead of having to spend all your actions
     * trying to escape, you can act normally for one action but must still spend the remainder of
     * your actions fleeing." */
    const m = marks('courageous-tanuki', 'tanuki', 'condition', 'fleeing');
    expect(m).toHaveLength(1);
    expect(m[0].note).toContain('act normally for one action');
    // POSITIVE CONTROL: the +10-foot Speed star coexists with the mark, by design.
    expect(text('courageous-tanuki', 'tanuki', { kind: 'speed' })).toContain('+10 feet circumstance');
  });

  it('Shadow Rat coerces animals, and animals like it less (heritage-351)', () => {
    /* Printed: "You gain the trained proficiency rank in Intimidation and can use Intimidation to
     * Coerce animals. When you Demoralize an animal, you don't take a penalty for not sharing a
     * language with it." plus the drawback "Animals' attitudes toward you begin one degree worse than
     * normal…" — WG injects the first two onto those action rows and models the drawback nowhere. */
    const coerce = marks('shadow-rat', 'ratfolk', 'action', 'coerce');
    expect(coerce).toHaveLength(1);
    expect(coerce[0].note).toContain('Coerce animals');
    const demoralize = marks('shadow-rat', 'ratfolk', 'action', 'demoralize');
    expect(demoralize).toHaveLength(1);
    expect(demoralize[0].note).toContain('not sharing a language');
    const attitude = marks('shadow-rat', 'ratfolk', 'condition', 'unfriendly');
    expect(attitude).toHaveLength(1);
    expect(attitude[0].note).toContain('one degree worse');
  });

  /* Ruling H caps a one-line note at 120 characters, "the full text staying in the description a
   * click away". Scoped to this batch's own ids, as batch 26's guard is: notes authored before the
   * ruling are longer, and widening the guard is a separate cleanup rather than a licence to add. */
  it('every batch-27 marker note stays inside ruling H one-line cap', () => {
    for (const [heritageId, ancestryId, on, id] of [
      ['shadow-of-the-courtier', 'wayang', 'action', 'make-an-impression'],
      ['sailfish-merfolk', 'merfolk', 'action', 'high-jump'],
      ['sailfish-merfolk', 'merfolk', 'action', 'long-jump'],
      ['paddler-shoony', 'shoony', 'action', 'stride'],
      ['paddler-shoony', 'shoony', 'action', 'step'],
      ['wilderness-samsaran', 'samsaran', 'action', 'stride'],
      ['nyktera', 'sprite', 'action', 'seek'],
      ['born-of-vegetation', 'yaoguai', 'action', 'treat-wounds'],
      ['virtuous-tanuki', 'tanuki', 'condition', 'sickened'],
      ['virtuous-tanuki', 'tanuki', 'condition', 'unconscious'],
      ['courageous-tanuki', 'tanuki', 'condition', 'fleeing'],
      ['shadow-rat', 'ratfolk', 'action', 'coerce'],
      ['shadow-rat', 'ratfolk', 'action', 'demoralize'],
      ['shadow-rat', 'ratfolk', 'condition', 'unfriendly'],
    ] as const)
      for (const m of marks(heritageId, ancestryId, on, id)) expect(m.note.length).toBeLessThanOrEqual(120);
  });
});
