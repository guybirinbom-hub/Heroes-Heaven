// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { emptyBuild, isArchetypeSubstituteOption, levelGrants, type BuildState } from '../src/rules/build';
import { ownedFeatureIds } from '../src/rules/derive';
import type { Character, ClassDef, SubclassOption } from '../src/rules/types';

/**
 * A SUPPRESSED FEATURE TAKES ITS PICK WITH IT.
 *
 * `classArchetype.suppressFeatures` names a class FEATURE, but the player's answer to that feature is
 * stored on an OPTION: the wizard's thesis lives in `extraChoices.thesis`, which declares
 * `featureId: 'arcane-thesis'`; a subclass declares its carrier the same way (`subclass.featureId`).
 * The last fix removed the feature from the owned set, the feat-grant loop and the advancement rows —
 * and the option lane went straight past all three. A War Mage — *"You do not gain the arcane bond or
 * arcane thesis class features"* (AoN archetype-331) — or a Runelord — *"Instead of an arcane thesis,
 * you gain a personal rune"* (archetype-303) — with Improved Familiar Attunement still selected kept
 * the Familiar feat that thesis grants.
 *
 * The two halves are tested where each one lives: the GRANTS on built characters, the QUESTION on the
 * rendered Builder. A picker the engine ignores is worse than a wrong grant — the player answers it,
 * and nothing happens.
 */
const db = () => content();
const noop = () => undefined;
const hasFeat = (ch: Character, id: string) => ch.feats.some((f) => f.featId === id);

/** A wizard with a thesis selected, optionally carrying a class archetype's dedication at 2nd. */
const wizard = (carrier?: string, over: Partial<BuildState> = {}) =>
  build('wizard', 5, {
    subclassId: 'school-of-battle-magic',
    extraChoices: { thesis: ['improved-familiar-attunement'] },
    ...(carrier ? { featPicks: { '2:class:0': carrier } } : {}),
    ...over,
  });

/** Every (archetype carrier → suppressed pick group) pair the shipped data actually contains. */
function suppressedPickLanes() {
  const c = db();
  const out: { carrier: string; classId: string; featureId: string; optionIds: string[] }[] = [];
  for (const [carrier, rec] of Object.entries(c.feats)) {
    const ca = rec.classArchetype;
    if (!ca?.suppressFeatures?.length) continue;
    for (const classId of Array.isArray(ca.classId) ? ca.classId : [ca.classId]) {
      const cls = c.classes[classId] as ClassDef | undefined;
      const groups: { featureId?: string; options: SubclassOption[] }[] = [...(cls?.subclass ? [cls.subclass] : []), ...(cls?.extraChoices ?? [])];
      for (const g of groups) {
        if (g.featureId && ca.suppressFeatures.includes(g.featureId))
          // …minus the archetype's OWN substitute, which is authored inside the list it removes
          // (Palatine Detective's esoterica) and is the one option that must keep granting.
          out.push({ carrier, classId, featureId: g.featureId, optionIds: g.options.map((o) => o.id).filter((id) => !isArchetypeSubstituteOption(id, c)) });
      }
    }
  }
  return out;
}

describe('a suppressed feature’s OPTION stops granting', () => {
  it('a War Mage wizard does not get the Familiar feat from the thesis it no longer has', () => {
    const ch = wizard('war-mage-dedication');
    expect(ch.classArchetype?.suppressedFeatures).toContain('arcane-thesis');
    expect(hasFeat(ch, 'familiar')).toBe(false);
    // …and nothing else on the character is sourced from the dead pick either.
    expect(ch.feats.filter((f) => f.grantedBy === 'improved-familiar-attunement')).toEqual([]);
  });

  it('a Runelord wizard likewise', () => {
    expect(hasFeat(wizard('runelord-dedication'), 'familiar')).toBe(false);
  });

  it('a plain wizard with the same thesis still gets it', () => {
    expect(hasFeat(wizard(), 'familiar')).toBe(true);
  });

  /*
   * BLAST RADIUS — every class archetype that suppresses a feature owning an extraChoices/subclass
   * pick, walked from the data rather than from the two that were measured. Two lanes exist today
   * (wizard `thesis` under War Mage + Runelord, investigator `methodology` under Palatine Detective);
   * an archetype authored onto a third inherits this the moment it ships.
   */
  it('no archetype leaves a grant coming from the pick it removed', () => {
    const lanes = suppressedPickLanes();
    expect(lanes.length).toBeGreaterThan(0); // the walk must not be silently empty
    const offenders: string[] = [];
    for (const lane of lanes) {
      const cls = db().classes[lane.classId] as ClassDef;
      const group = (cls.extraChoices ?? []).find((g) => g.featureId === lane.featureId);
      // Select EVERY option of the removed pick (a subclass takes one, a group takes its first).
      const over: Partial<BuildState> = group
        ? { extraChoices: { [group.id]: lane.optionIds } }
        : { subclassId: lane.optionIds[0] };
      const ch = build(lane.classId, 20, { featPicks: { '2:class:0': lane.carrier }, ...over });
      for (const f of ch.feats) if (f.grantedBy && lane.optionIds.includes(f.grantedBy)) offenders.push(`${lane.carrier}: ${f.featId} from ${f.grantedBy}`);
    }
    expect(offenders).toEqual([]);
  });

  /* THE EXCEPTION, guarded from the other side. *"Instead of choosing a methodology from others
   * available to the investigator class, you have the esoterica methodology"* (archetype-306) — the
   * app ships esoterica AS a methodology option, so a blanket "drop every option of a suppressed
   * group" would leave a Palatine Detective with no methodology at all: a worse answer than the wrong
   * one. Esoterica trains Occultism or Religion and grants Quick Identification. */
  it('a Palatine Detective investigator keeps the methodology the archetype substitutes', () => {
    const ch = build('investigator', 5, { subclassId: 'palatine-detective', featPicks: { '2:class:0': 'palatine-detective-dedication' } });
    expect(hasFeat(ch, 'quick-identification')).toBe(true);
    // …while a generic methodology, chosen by the same character, grants nothing.
    const wrong = build('investigator', 5, { subclassId: 'alchemical-sciences-methodology', featPicks: { '2:class:0': 'palatine-detective-dedication' } });
    expect(hasFeat(wrong, 'alchemical-crafting')).toBe(false);
    // …and a plain investigator with that methodology still gets it.
    expect(hasFeat(build('investigator', 5, { subclassId: 'alchemical-sciences-methodology' }), 'alchemical-crafting')).toBe(true);
  });
});

/**
 * …AND THE CHARACTER STOPS CARRYING IT OUT TO THE SHEET.
 *
 * `grantOptions` / `ownedSubclassId` are build-time filters — they only stop buildCharacter's own
 * loops. The emitted Character used to hand the raw `subclassId` and `classChoices` to
 * `ownedFeatureIds`, the sheet's single choke point, which rebuilds ownership from exactly those two
 * fields and subtracts only `classArchetype.suppressedFeatures` — the FEATURE ids, never the option
 * ids. Measured before the fix on a level-13 War Mage: `ownedFeatureIds` returned
 * `improved-familiar-attunement`, so its actions/limitedUses/situational bonuses/mode gates were all
 * live, and the Feats tab printed an "Arcane Thesis: Improved Familiar Attunement" row for a feature
 * the character does not have (*"You do not gain the arcane bond or arcane thesis class features"*,
 * AoN archetype-331). A Palatine Detective still owned a generic methodology the same way
 * (*"Instead of choosing a methodology from others available to the investigator class, you have the
 * esoterica methodology"*, archetype-306) — Quick Tincture and all.
 */
describe('the emitted Character carries no suppressed pick', () => {
  const wiz13 = (carrier?: string) =>
    build('wizard', 13, {
      subclassId: 'school-of-battle-magic',
      extraChoices: { thesis: ['improved-familiar-attunement'] },
      ...(carrier ? { featPicks: { '2:class:0': carrier } } : {}),
    });

  it('a War Mage neither owns nor displays the thesis option', () => {
    const war = wiz13('war-mage-dedication');
    expect(ownedFeatureIds(war, db()).has('improved-familiar-attunement')).toBe(false);
    expect((war.classChoices ?? []).map((c) => c.id)).not.toContain('improved-familiar-attunement');
    // The arcane SCHOOL is untouched — only the suppressed group's options go.
    expect((war.classChoices ?? []).map((c) => c.id)).toContain('school-of-battle-magic');
    const plain = wiz13();
    expect(ownedFeatureIds(plain, db()).has('improved-familiar-attunement')).toBe(true);
    expect((plain.classChoices ?? []).map((c) => c.id)).toContain('improved-familiar-attunement');
  });

  it('a Palatine Detective carrying a generic methodology owns none of it', () => {
    const pd = build('investigator', 5, { subclassId: 'alchemical-sciences-methodology', featPicks: { '2:class:0': 'palatine-detective-dedication' } });
    expect(pd.subclassId).toBeNull();
    expect(ownedFeatureIds(pd, db()).has('alchemical-sciences-methodology')).toBe(false);
    expect((pd.classChoices ?? []).map((c) => c.id)).not.toContain('alchemical-sciences-methodology');
    // …and the substitute the archetype DOES hand over survives, subclass id and all.
    const real = build('investigator', 5, { subclassId: 'palatine-detective', featPicks: { '2:class:0': 'palatine-detective-dedication' } });
    expect(real.subclassId).toBe('palatine-detective');
    expect(ownedFeatureIds(real, db()).has('palatine-detective')).toBe(true);
  });

  /* The dual-class twin: `ownedFeatureIds` reads `[c.subclassId, c.subclassId2]` as one pair, and the
   * archetype resolver already matches `build.classId2`, so the SECOND class's suppressed methodology
   * has to go the same way. */
  it('…including on the second class of a dual-class character', () => {
    const dual = build('wizard', 5, {
      subclassId: 'school-of-battle-magic',
      classId2: 'investigator',
      subclassId2: 'alchemical-sciences-methodology',
      variantRules: { dualClass: true },
      featPicks: { '2:class:0': 'palatine-detective-dedication' },
    });
    expect(dual.subclassId2 ?? null).toBeNull();
    expect(ownedFeatureIds(dual, db()).has('alchemical-sciences-methodology')).toBe(false);
  });
});

describe('…and the Builder stops ASKING the question', () => {
  /** Mount the Builder and open page 0 — the origins page, where the class's choice groups live. */
  const mount = (b: BuildState) => {
    const r = renderDom(<Builder content={db()} initial={b} onCancel={noop} onCreate={noop} />);
    r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === '0') ?? null);
    return r;
  };
  const subcard = (host: HTMLElement, label: string) => host.querySelector<HTMLElement>(`[data-subcard="${label}"]`);
  const raw = (over: Partial<BuildState>): BuildState => ({
    ...emptyBuild(),
    name: 't',
    level: 5,
    classId: 'wizard',
    ancestryId: Object.keys(db().ancestries)[0],
    backgroundId: Object.keys(db().backgrounds)[0],
    keyAbility: 'int',
    subclassId: 'school-of-battle-magic',
    extraChoices: { thesis: ['improved-familiar-attunement'] },
    ...over,
  });

  it('greys the Arcane Thesis card for a War Mage and names what removed it', () => {
    const r = mount(raw({ featPicks: { '2:class:0': 'war-mage-dedication' } }));
    const card = subcard(r.host, 'Arcane Thesis');
    expect(card).toBeTruthy(); // shown with the reason, not silently deleted (owner ruling Q27)
    expect(card!.querySelector('[data-suppressed-by]')?.getAttribute('data-suppressed-by')).toBe('War Mage Dedication');
    expect(card!.textContent).toContain('Removed by War Mage Dedication');
    // No control at all: a pick stored here is now thrown away by buildCharacter. `[data-ctl]` is the
    // marker every builder control carries (and what the experience harness counts).
    expect(card!.querySelector('[data-ctl]')).toBeNull();
    r.stop();
  });

  it('leaves the plain wizard’s thesis picker live', () => {
    const r = mount(raw({}));
    const card = subcard(r.host, 'Arcane Thesis');
    expect(card).toBeTruthy();
    expect(card!.querySelector('[data-suppressed-by]')).toBeNull();
    expect(card!.querySelector('[data-ctl]')).toBeTruthy();
    r.stop();
  });
});

/**
 * ITEM B — `levelGrants` was archetype-blind, so the Builder's level-by-level list disagreed with the
 * sheet: it dropped features only through the subclass option, and knew nothing about the features an
 * archetype ADDS. War Mage, AoN archetype-331: *"You gain the war magic class feature at 1st level"* /
 * *"You do not gain the arcane bond or arcane thesis class features"*.
 */
describe('the Builder’s level list matches what the archetype grants', () => {
  const rows = (b: BuildState) =>
    levelGrants(1, b.classId, db(), b.subclassId, b.variantRules, b.classId2, b.subclassId2, b.mythicEnabled, Object.values(b.featPicks ?? {}).filter(Boolean) as string[], b)
      .features.map((f) => f.name);
  const base: BuildState = { ...emptyBuild(), name: 't', level: 5, classId: 'wizard', ancestryId: Object.keys(content().ancestries)[0], backgroundId: Object.keys(content().backgrounds)[0], keyAbility: 'int', subclassId: 'school-of-battle-magic' };

  it('levelGrants drops the suppressed level-1 features and lists the added ones', () => {
    const war = rows({ ...base, featPicks: { '2:class:0': 'war-mage-dedication' } });
    expect(war).not.toContain('Arcane Bond');
    expect(war).not.toContain('Arcane Thesis');
    expect(war).toContain('War Magic');
    const plain = rows(base);
    expect(plain).toContain('Arcane Bond');
    expect(plain).toContain('Arcane Thesis');
    expect(plain).not.toContain('War Magic');
  });

  it('…and that is what the rendered level-1 page prints', () => {
    const open1 = (b: BuildState) => {
      const r = renderDom(<Builder content={db()} initial={b} onCancel={noop} onCreate={noop} />);
      r.click([...r.host.querySelectorAll<HTMLButtonElement>('button.lchip')].find((x) => (x.textContent ?? '').trim() === '1') ?? null);
      return { r, names: [...r.host.querySelectorAll('.lvl-gain-name')].map((n) => (n.textContent ?? '').trim()) };
    };
    const war = open1({ ...base, featPicks: { '2:class:0': 'war-mage-dedication' } });
    expect(war.names).not.toContain('Arcane Bond');
    expect(war.names).toContain('War Magic');
    war.r.stop();
    const plain = open1(base);
    expect(plain.names).toContain('Arcane Bond');
    expect(plain.names).not.toContain('War Magic');
    plain.r.stop();
  });
});
