// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { additionalClassSkills, buildCharacter, buildUsesDeity, emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import { askedAtDailyPrep } from '../src/rules/derive';
import { FEAT_SITUATIONAL } from '../src/rules/situationalBonuses';
import { sheetLoreKeys } from '../src/rules/explain';
import { addInventoryItem, applyPlayState, initialPlay } from '../src/rules/play';

/**
 * THE FIRST SWEEP OF GATE 9 (EXPERIENCE), 2026-09-02 — every real gap it found, pinned on the RENDERED
 * builder, because each of these was a control the player could not reach while the data behind it
 * was already at parity with Wanderer's Guide (the four data comparers passed all of them).
 */
const c = () => content();
const noop = () => undefined;

function slotKey(level: number, classId: string, category: string, subclassId: string | null = null): string {
  const g = levelGrants(level, classId, c(), subclassId, undefined, null, null, false, []);
  const i = g.featSlots.findIndex((s) => s === category);
  expect(i, `no ${category} slot at level ${level} for ${classId}`).toBeGreaterThanOrEqual(0);
  return `${level}:${category}:${i}`;
}

const host = (over: Partial<BuildState>): BuildState => ({
  ...emptyBuild(),
  name: 't',
  level: 1,
  classId: 'fighter',
  ancestryId: 'human',
  heritageId: 'skilled-human',
  backgroundId: 'acolyte',
  keyAbility: 'str',
  ...over,
});

/** Controls on one builder page: `[data-ctl]` nodes as {ctl, title, options} plus the page text. */
function page(b: BuildState, label: string) {
  const r = renderDom(<Builder content={c()} initial={b} onCancel={noop} onCreate={noop} />);
  const tab = [...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((x) => (x.textContent ?? '').trim() === label);
  r.click(tab ?? null);
  const ctls = [...r.host.querySelectorAll<HTMLElement>('[data-ctl]')].map((el) => ({ ctl: el.dataset.ctl, title: el.dataset.ctlTitle ?? '', options: Number(el.dataset.ctlOptions ?? 0) }));
  const text = r.host.textContent ?? '';
  r.stop();
  return { ctls, text };
}

describe("domains-initial-spell-pick — WG's 'Choose an Initial Domain Spell' on every single-pick domains feat", () => {
  it("Deity's Domain (champion) offers the initial domain spell picker beside the domain, like Domain Initiate", () => {
    const cls = c().classes.champion;
    const b = host({ classId: 'champion', subclassId: (cls.subclass?.options[0]?.id as string) ?? null, keyAbility: 'str', deityId: 'sarenrae', featPicks: { [slotKey(1, 'champion', 'class', (cls.subclass?.options[0]?.id as string) ?? null)]: 'deitys-domain' } });
    const { ctls, text } = page(b, '1');
    expect(text).toContain("Deity's Domain");
    expect(ctls.some((x) => x.ctl === 'popup' && x.title === 'Initial domain spell'), JSON.stringify(ctls.map((x) => x.title))).toBe(true);
  });
});

describe('archetype-cantrip-cap — Psi Development raises the archetype caster\'s cantrip openings on the level page', () => {
  it('a fighter with Psychic Dedication + Psi Development gets a 2-opening Cantrip rail', () => {
    const b = host({ level: 6, featPicks: { [slotKey(2, 'fighter', 'class')]: 'psychic-dedication', [slotKey(6, 'fighter', 'class')]: 'psi-development' } });
    const found = ['1', '2', '3', '4', '5', '6'].flatMap((p) => page(b, p).ctls.filter((x) => x.ctl === 'spell' && x.title === 'Cantrip'));
    expect(found.length, 'the archetype cantrip rail renders on some level page').toBeGreaterThan(0);
    expect(Math.max(...found.map((x) => x.options))).toBe(2);
  });
});

describe('granted-choice-picker-subclassless-class — a granted feat asks its question on a class with no subclass', () => {
  it("Devil Allies (via Order Training on a fighter) renders its own choice", () => {
    const ded = slotKey(2, 'fighter', 'class');
    const ot = slotKey(8, 'fighter', 'class');
    const b = host({ level: 8, featPicks: { [ded]: 'hellknight-dedication', [ot]: 'order-training' }, pickFeatChoices: { [ot]: 'devil-allies' } });
    const prompt = c().feats['devil-allies'].choice?.prompt ?? '';
    expect(prompt).not.toBe('');
    const { text } = page(b, '1');
    expect(text).toContain('Devil Allies');
    expect(text).toContain(prompt);
  });
});

describe("bonus-skill-increase-control — the swashbuckler's Stylish Tricks increase has a card", () => {
  it('level 3 renders a Bonus skill increase picker', () => {
    const cls = c().classes.swashbuckler;
    const b = host({ level: 3, classId: 'swashbuckler', subclassId: (cls.subclass?.options[0]?.id as string) ?? null, keyAbility: 'dex' });
    const { ctls } = page(b, '3');
    expect(ctls.some((x) => x.ctl === 'popup' && x.title === 'Bonus skill increase'), JSON.stringify(ctls.map((x) => x.title))).toBe(true);
  });
});

describe('deity-picker-gate — a background that reads the deity makes the Deity card render', () => {
  it('Raised by Belief on a fighter uses the deity', () => {
    expect(buildUsesDeity(host({ backgroundId: 'raised-by-belief' }), c())).toBe(true);
    const { ctls } = page(host({ backgroundId: 'raised-by-belief' }), '0');
    expect(ctls.some((x) => x.ctl === 'search' && x.title === 'Deity'), JSON.stringify(ctls.map((x) => x.title))).toBe(true);
  });
});

describe('builder-daily-choice-guard — a DAILY background choice is not asked in the builder (Q23)', () => {
  it("Professional Letter Writer's daily choice has no builder control", () => {
    const bg = c().backgrounds['professional-letter-writer'];
    expect(bg.choice && askedAtDailyPrep(bg.choice as never)).toBe(true);
    const { ctls } = page(host({ backgroundId: 'professional-letter-writer' }), '0');
    const prompt = bg.choice!.prompt;
    expect(ctls.some((x) => x.title === prompt)).toBe(false);
  });
});

describe('refuter round (2026-09-02) — what the adversarial pass found behind the instrument artefacts', () => {
  it('summoner-dedication casts nothing until Basic Summoner Spellcasting (print and WG both withhold it)', () => {
    const at2 = host({ level: 2, featPicks: { [slotKey(2, 'fighter', 'class')]: 'summoner-dedication' } });
    const ch2 = buildCharacter(at2, c());
    expect(ch2.spellcasting.some((s) => s.id.startsWith('summoner-dedication')), 'no casting entry at the dedication').toBe(false);
    expect(page(at2, '2').ctls.some((x) => x.ctl === 'spell' && x.title === 'Cantrip'), 'no cantrip rail at the dedication').toBe(false);
    const at6 = host({ level: 6, featPicks: { [slotKey(2, 'fighter', 'class')]: 'summoner-dedication', [slotKey(6, 'fighter', 'class')]: 'basic-summoner-spellcasting' } });
    const ch6 = buildCharacter(at6, c());
    expect(ch6.spellcasting.some((s) => s.id.startsWith('summoner-dedication')), 'the Basic feat brings the casting').toBe(true);
    const rails = ['1', '2', '3', '4', '5', '6'].flatMap((p) => page(at6, p).ctls.filter((x) => x.ctl === 'spell' && x.title === 'Cantrip'));
    expect(Math.max(0, ...rails.map((x) => x.options)), 'two cantrips, from the Basic feat').toBe(2);
  });

  it('grim-fascination is asked once — the class chassis no longer carries a duplicate group', () => {
    expect(c().classes.necromancer.extraChoices ?? []).toHaveLength(0);
    const b = host({ classId: 'necromancer', subclassId: (c().classes.necromancer.subclass?.options[0]?.id as string) ?? null, keyAbility: 'int' });
    const zero = page(b, '0').ctls.filter((x) => /grim fascination/i.test(x.title));
    expect(zero, 'no Grim Fascination popup on the chassis page').toHaveLength(0);
    // The class feature's own picker still asks it, once.
    const one = page(b, '1').ctls.filter((x) => /grim fascination/i.test(x.title));
    expect(one).toHaveLength(1);
  });

  it('molten-wit asks its skill once and trains the answered skill', () => {
    const k = slotKey(1, 'fighter', 'ancestry');
    // Human-typed ifrit host: the feat's own answer is the only skill question.
    const b = host({ featPicks: { [k]: 'molten-wit' }, featChoices: { [k]: 'diplomacy' } });
    const { ctls } = page(b, '1');
    const skillCtls = ctls.filter((x) => x.ctl === 'popup' && /skill/i.test(x.title));
    expect(skillCtls.map((x) => x.title), 'exactly one skill control').toHaveLength(1);
    const ch = buildCharacter(b, c());
    expect(ch.proficiencies.skills.diplomacy).toBe('trained');
    expect(ch.feats.some((f) => f.featId === 'group-impression')).toBe(true);
    // Unanswered: nothing is silently trained.
    const un = buildCharacter(host({ featPicks: { [k]: 'molten-wit' } }), c());
    expect(un.proficiencies.skills.deception ?? 'untrained').toBe('untrained');
  });

  it('advanced-red-mantis-magic is gated on Basic Red Mantis Magic like WG gates it', () => {
    const f = c().feats['advanced-red-mantis-magic'];
    expect(f.prerequisites).toEqual(['Basic Red Mantis Magic']);
    expect(f.archetype).toBe('red-mantis-assassin');
  });

  it('two items the third sweep found inert: Marked Playing Cards (+1 Games Lore star, like Loaded Dice) and the Assisting rune (+1 Bulk limit)', () => {
    expect(FEAT_SITUATIONAL['marked-playing-cards']?.[0]?.targets).toEqual([{ kind: 'skill', detail: 'lore:games' }]);
    expect((c().items['assisting'] as { passiveEffects?: { bulkLimitBonus?: number } }).passiveEffects?.bulkLimitBonus).toBe(1);
  });

  it("an item's Lore star gets an UNTRAINED Lore row to sit on (WG's createValue SKILL_LORE_GAMES = U)", () => {
    const base = buildCharacter(host({}), c());
    expect(sheetLoreKeys(base, c())).not.toContain('lore:games');
    const play = addInventoryItem(initialPlay(base, c()), 'marked-playing-cards', { worn: true, equipped: true, invested: true });
    const withCards = applyPlayState(base, play, c());
    expect(sheetLoreKeys(withCards, c())).toContain('lore:games');
  });

  it('harrow-ritualist offers all six printed rituals, Commune with Nature included', () => {
    expect(c().spells['commune-with-nature']?.ritual).toBe(true);
    const opts = c().feats['harrow-ritualist'].choice?.options ?? [];
    expect(opts.map((o) => o.value)).toEqual(['astral-projection', 'call-spirit', 'commune', 'commune-with-nature', 'collective-memories', 'binding-circle']);
  });
});

describe("int-boost-adds-a-trained-skill — the owner's cleric was one skill short of his Wanderer's Guide sheet", () => {
  // Cleric: 2 + Int additional skills. Int 12 at level 1 (+1) → 3; the level-3 boost makes it 14 (+2) → 4.
  const cleric = (level: number) =>
    host({
      level,
      classId: 'cleric',
      subclassId: 'cloistered-cleric',
      keyAbility: 'wis',
      deityId: 'sarenrae',
      ancestryBoosts: ['int'],
      levelBoosts: ['wis', 'cha', 'con', 'dex'],
      attributeBoosts: { 3: ['int', null, null, null] } as never,
      variantRules: { gradualBoosts: true } as never,
      classSkills: ['diplomacy', 'society', 'lore:cooking', 'arcana'],
    });
  it('counts the class skills off the CURRENT Intelligence modifier', () => {
    const c1 = buildCharacter(cleric(1), c());
    const c3 = buildCharacter(cleric(3), c());
    expect(c1.abilities.int).toBe(12);
    expect(c3.abilities.int).toBe(14);
    expect(additionalClassSkills(cleric(1), c())).toBe(3);
    expect(additionalClassSkills(cleric(3), c())).toBe(4);
    // The fourth pick is really trained once the boost lands, and not before.
    expect(c1.proficiencies.skills.arcana).toBe('untrained');
    expect(c3.proficiencies.skills.arcana).toBe('trained');
  });
});

describe('data authored for the sweep (scripts/data/effect-backfill.json)', () => {
  it('Dragon Disciple Dedication is a focus-only casting grant', () => {
    expect((c().feats['dragon-disciple-dedication'].spellcastingGrant as { focusOnly?: boolean }).focusOnly).toBe(true);
  });
  it('Eldritch Researcher and Nantambu Chime-Ringer ask the tradition first and narrow the cantrip to it', () => {
    for (const [id, flag] of [['eldritch-researcher-dedication', 'eldritchResearcherTradition'], ['nantambu-chime-ringer-dedication', 'nantambuTradition']] as const) {
      const f = c().feats[id];
      expect(f.choice?.flag).toBe(flag);
      expect(f.effectChoices?.[0]?.spellFilter?.traditionFromChoiceFlag).toBe(flag);
      const b = host({ level: 2, featPicks: { [slotKey(2, 'fighter', 'class')]: id } });
      const { ctls } = page(b, '2');
      expect(ctls.some((x) => x.ctl === 'popup' && x.title === 'Tradition'), `${id}: ${JSON.stringify(ctls.map((x) => x.title))}`).toBe(true);
    }
  });
  it('Harrow-Chosen asks the card suit (fixing one boost) and records the alignment', () => {
    const bg = c().backgrounds['harrow-chosen'];
    expect(bg.choice?.flag).toBe('harrowSuit');
    expect(Object.keys(bg.abilityBoostsByChoice ?? {})).toHaveLength(6);
    const { ctls } = page(host({ backgroundId: 'harrow-chosen' }), '0');
    expect(ctls.some((x) => x.title === 'Card suit'), JSON.stringify(ctls.map((x) => x.title))).toBe(true);
    // The suit's fixed boost lands on the built character once answered.
    const ch = buildCharacter(host({ backgroundId: 'harrow-chosen', featChoices: { 'background:harrow-chosen': 'hammers' } }), c());
    expect(ch.abilities.str).toBeGreaterThanOrEqual(12);
  });
});
