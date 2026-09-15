// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { content, build } from './_content';
import { renderDom } from './_render';
import { MainTab } from '../src/sheet/MainTab';
import { StatDetailModal } from '../src/sheet/StatDetailModal';
import { SKILL_ACTIONS } from '../src/rules/skillActions';
import { explainStat, assuranceResult } from '../src/rules/explain';
import { isActionCost } from '../src/sheet/widgets';
import { deriveSkill, profBonus, pwl } from '../src/rules/derive';
import { CUSTOM_BACKGROUND_ID } from '../src/rules/build';
import type { ActionCost, Character, ContentDatabase, ProficiencyKey } from '../src/rules/types';

const c = content();
const noop = () => undefined;
/** The same kebab-casing StatDetailModal and MainTab slug an action name with. */
const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/** A record's `actionCost` written the way `SkillAction.costText` writes it. */
function costTextOf(cost: ActionCost): string | null {
  if (cost.type === 'actions') return `${cost.value} action${cost.value === 1 ? '' : 's'}`;
  if (cost.type === 'free') return 'free';
  if (cost.type === 'reaction') return 'reaction';
  if (cost.type === 'variable') return `${cost.min} to ${cost.max} actions`;
  return null;
}

/** Open a skill's stat popup the way the sheet does and hand back its host element. */
function openSkill(ch: Character, db: ContentDatabase, skill: ProficiencyKey) {
  return renderDom(
    <StatDetailModal breakdown={explainStat(ch, db, { kind: 'skill', skill })} character={ch} content={db} onClose={noop} />,
  );
}

/** The one row for `name` in the "Actions you can take" list. */
function actionRow(host: HTMLElement, name: string): HTMLElement {
  const row = [...host.querySelectorAll('.sd-action')].find((b) => b.querySelector('.sd-act-name')?.textContent === name);
  if (!row) throw new Error(`no skill-action row for ${name}`);
  return row as HTMLElement;
}

/**
 * Owner, 2026-09-15: *"why do the actions look messed up?"* — the Athletics list read
 * `High Jump   (1 action) *   ◆◆`.
 *
 * Neither half came from the skill-action table: `costText` is "2 actions" and always was. The
 * "(1 action)" is Quick Jump's RECORD MARKER value, printed as a parenthetical annotation beside an
 * unmodified glyph, so the row stated two different costs at once. The `*` is the marker's own
 * SituationalStar, whose tooltip names Quick Jump.
 */
describe('a skill-action row states ONE cost', () => {
  const rows = Object.values(SKILL_ACTIONS)
    .flat()
    .map((a) => ({ a, rec: c.actions[slug(a.name)] }))
    .filter((r) => r.rec && isActionCost(r.rec.actionCost))
    // A feat-gated entry is the FEAT's cost, not the base action's (Quick Repair is 1 minute where
    // Repair's record is an exploration activity); only the plain actions share a record's badge.
    .filter((r) => !r.a.feat)
    .map((r) => [r.a.name, r.a.costText, costTextOf(r.rec.actionCost!)] as const);

  // bug 2026-09-15: skill actions
  it('has rows to check', () => {
    expect(rows.length).toBeGreaterThan(40);
  });

  // bug 2026-09-15: skill actions
  it.each(rows)('%s costs %s, and the record agrees', (_name, costText, recordText) => {
    expect(costText).toBe(recordText);
  });

  // bug 2026-09-15: skill actions
  it('Quick Jump replaces the glyph instead of annotating it', () => {
    const ch = build('fighter', 2, { featPicks: { '2:skill': 'quick-jump' } });
    expect(ch.feats.some((f) => f.featId === 'quick-jump')).toBe(true);
    const { host, stop } = openSkill(ch, c, 'athletics');
    try {
      for (const name of ['High Jump', 'Long Jump']) {
        const row = actionRow(host, name);
        // The parenthetical cost is gone…
        expect(row.querySelector('.action-mark-val'), name).toBeNull();
        expect(row.textContent, name).not.toContain('1 action');
        // …and the ONE cost the row shows is the single-action glyph Quick Jump grants.
        const glyphs = [...row.querySelectorAll('.sd-act-cost .pf2-action')];
        expect(glyphs.length, name).toBe(1);
        expect(glyphs[0].textContent, name).toBe('1');
        // The star survives — and says what it is for. Its own generic title used to shadow the
        // wrapper's, so hovering the `*` explained nothing.
        expect(row.querySelector('.action-mark')?.getAttribute('title'), name).toContain('Quick Jump');
        expect(row.querySelector('.sit-star')?.getAttribute('title'), name).toContain('Quick Jump');
      }
    } finally {
      stop();
    }
  });

  // bug 2026-09-15: skill actions
  it('leaves an unmodified row at the record cost', () => {
    const { host, stop } = openSkill(build('fighter', 2), c, 'athletics');
    try {
      const glyphs = [...actionRow(host, 'High Jump').querySelectorAll('.sd-act-cost .pf2-action')];
      expect(glyphs.map((g) => g.textContent)).toEqual(['2']);
    } finally {
      stop();
    }
  });

  // bug 2026-09-15: skill actions
  it('…and so does the ACTIONS list on the sheet, not only the skill popup', () => {
    // High Jump and Long Jump are rows of `ACTIVITIES` too (actions.ts), so MainTab renders the same
    // clash on the page the player opens first. It routes the marked cost through the same
    // `markedActionCost`; without that this row read `High Jump (1 action) * ◆◆` exactly as the popup
    // did, and nothing in this file looked at it.
    const glyphsIn = (el: Element | null | undefined) => [...(el?.querySelectorAll('.pf2-action') ?? [])].map((g) => g.textContent).join('');
    /** The Actions sub-tab's chip for `name`, and the popup that chip opens. */
    const chipAndPopup = (ch: Character, name: string) => {
      const r = renderDom(<MainTab character={ch} content={c} onPlay={noop} />);
      try {
        r.click([...r.host.querySelectorAll('.stab')].find((t) => t.textContent === 'Actions')!);
        const chip = [...r.host.querySelectorAll('.action-chip')].find((e) => e.querySelector('.action-chip-name')?.textContent === name);
        if (!chip) throw new Error(`no action chip for ${name}`);
        const out = {
          chip: glyphsIn(chip.querySelector('.action-cost')),
          paren: chip.querySelector('.action-mark-val')?.textContent ?? null,
          starTitle: chip.querySelector('.sit-star')?.getAttribute('title') ?? null,
          popup: '',
        };
        r.click(chip);
        out.popup = glyphsIn(document.querySelector('.picker.info-modal .action-detail-cost'));
        return out;
      } finally {
        r.stop();
      }
    };
    for (const name of ['High Jump', 'Long Jump']) {
      expect(chipAndPopup(build('fighter', 2), name), `${name} unmodified`).toEqual({ chip: '2', paren: null, starTitle: null, popup: '2' });
      const q = chipAndPopup(build('fighter', 2, { featPicks: { '2:skill': 'quick-jump' } }), name);
      expect(q.chip, `${name} chip with Quick Jump`).toBe('1');
      expect(q.paren, `${name} still states a second cost beside the glyph`).toBeNull();
      expect(q.starTitle, `${name} star`).toContain('Quick Jump');
      // …and the popup the chip OPENS, which read the table's own cost: ◆ chip, ◆◆ popup, one click apart.
      expect(q.popup, `${name}: the detail popup disagrees with the chip that opened it`).toBe('1');
    }
  });

  // bug 2026-09-15: skill actions
  it('still annotates a mark whose value is NOT a cost', () => {
    // Magic Hands makes Treat Wounds heal d10s — a value with no glyph, so it keeps its parenthesis.
    const ch = build('cleric', 4, { classSkills: ['medicine'], featPicks: { '2:skill': 'magic-hands' } });
    const { host, stop } = openSkill(ch, c, 'medicine');
    try {
      expect(actionRow(host, 'Treat Wounds').querySelector('.action-mark-val')?.textContent).toBe('(d10)');
    } finally {
      stop();
    }
  });
});

/**
 * Owner, 2026-09-15: *"I have Assurance that I got from Deep Backgrounds but I don't see that
 * Assurance on that skill in the character page in a `*`"*.
 *
 * Player Core p. 252: forgo the roll for 10 + your proficiency bonus, and NOTHING else — no
 * attribute, no item bonus, no status. The number was nowhere on the sheet.
 */
describe('Assurance marks the skill it applies to', () => {
  /** A fighter assured in Athletics, with enough skill increases to reach `rank` by `level`. */
  const assured = (level: number, increases: Record<number, ProficiencyKey> = {}) =>
    build('fighter', level, {
      classSkills: ['athletics'],
      skillIncreases: increases,
      featPicks: { '2:skill': 'assurance' },
      featChoices: { '2:skill': 'athletics' },
    });

  /** The Athletics row's Assurance badge text, or null. */
  function badge(ch: Character): string | null {
    const { host, stop } = renderDom(<MainTab character={ch} content={c} onPlay={noop} section="main" />);
    try {
      const row = [...host.querySelectorAll('.skill')].find((e) => e.querySelector('.skill-name')?.textContent?.startsWith('Athletics'));
      return row?.querySelector('.assurance-badge')?.textContent ?? null;
    } finally {
      stop();
    }
  }

  // bug 2026-09-15: assurance marker
  // The three proficiency steps, with the arithmetic written out: 10 + rank + level, and nothing of
  // the modifier beside it — the level-15 master is Assurance 31 on an Athletics that rolls far more.
  it.each([
    [2, {}, 'trained', 14],
    [5, { 3: 'athletics' }, 'expert', 19],
    [15, { 3: 'athletics', 7: 'athletics' }, 'master', 31],
  ] as const)('level %i: the row shows 10 + the proficiency bonus and nothing else', (level, increases, rank, want) => {
    const ch = assured(level, increases as Record<number, ProficiencyKey>);
    expect(ch.feats.find((f) => f.featId === 'assurance')?.choice?.value).toBe('athletics');
    expect(ch.proficiencies.skills.athletics).toBe(rank);
    expect(10 + profBonus(rank, ch.level, pwl(ch))).toBe(want);
    expect(assuranceResult(ch, 'athletics', rank)).toBe(want);
    expect(badge(ch)).toBe(`Assurance ${want}`);
  });

  // bug 2026-09-15: assurance marker
  it('excludes the attribute — raising Strength moves the roll and not the fixed result', () => {
    const base = assured(5, { 3: 'athletics' });
    const strong = { ...base, abilities: { ...base.abilities, str: 18 } };
    expect(deriveSkill(strong, 'athletics', c).modifier).toBeGreaterThan(deriveSkill(base, 'athletics', c).modifier);
    expect(badge(strong)).toBe(badge(base));
  });

  // bug 2026-09-15: assurance marker
  it('drops the level term under Proficiency Without Level', () => {
    // The whole of Assurance is "10 + your proficiency bonus", and under that variant the proficiency
    // bonus is the rank alone. A fixed result that kept the level would be 7 too high at 7th and would
    // beat rolls the variant makes impossible — and it is the ONE term of the formula the row cannot
    // be checked against by eye.
    const base = assured(7, { 3: 'athletics' });
    const variant = { ...base, variantRules: { ...(base.variantRules ?? {}), proficiencyWithoutLevel: true } } as Character;
    const rank = base.proficiencies.skills.athletics!;
    expect(pwl(variant), 'the fixture must actually have the variant on').toBe(true);
    expect(assuranceResult(base, 'athletics', rank)).toBe(10 + profBonus(rank, base.level, false));
    expect(assuranceResult(variant, 'athletics', rank)).toBe(10 + profBonus(rank, variant.level, true));
    // …and the two really differ, so this is a live assertion rather than a tautology.
    expect(assuranceResult(variant, 'athletics', rank)).not.toBe(assuranceResult(base, 'athletics', rank));
    expect(badge(variant)).toBe(`Assurance ${10 + profBonus(rank, variant.level, true)}`);
  });

  // bug 2026-09-15: assurance marker
  it('a DEEP (custom) background that grants Assurance marks its skill too', () => {
    const ch = build('fighter', 3, {
      backgroundId: CUSTOM_BACKGROUND_ID,
      customBackground: {
        name: 'Deep Background',
        description: '',
        boosts: ['str', 'con'],
        trainedSkill: 'athletics',
        loreSubject: 'Digging',
        skillFeatId: 'assurance',
      },
      grantedFeatChoices: { assurance: 'athletics' },
    });
    const f = ch.feats.find((x) => x.featId === 'assurance');
    expect(f, 'the custom background granted Assurance').toBeTruthy();
    expect(f!.choice?.value).toBe('athletics');
    const rank = ch.proficiencies.skills.athletics!;
    expect(badge(ch)).toBe(`Assurance ${10 + profBonus(rank, ch.level, pwl(ch))}`);
  });

  // bug 2026-09-15: assurance marker
  it('a skill without Assurance carries no badge', () => {
    const ch = assured(5);
    expect(assuranceResult(ch, 'stealth', ch.proficiencies.skills.stealth ?? 'untrained')).toBeNull();
    const { host, stop } = renderDom(<MainTab character={ch} content={c} onPlay={noop} section="main" />);
    try {
      const rows = [...host.querySelectorAll('.skill')].filter((e) => e.querySelector('.assurance-badge'));
      expect(rows.length).toBe(1);
      expect(rows[0].querySelector('.skill-name')?.textContent).toContain('Athletics');
    } finally {
      stop();
    }
  });

  // bug 2026-09-15: assurance marker
  it('the skill popup shows the fixed result beside the modifier, and says why', () => {
    const ch = assured(5, { 3: 'athletics' });
    const { host, stop } = openSkill(ch, c, 'athletics');
    try {
      const el = host.querySelector('.sd-assurance');
      const want = 10 + profBonus(ch.proficiencies.skills.athletics!, ch.level, pwl(ch));
      expect(el?.textContent).toBe(`Assurance ${want}`);
      expect(el?.getAttribute('title')).toMatch(/forgo/i);
    } finally {
      stop();
    }
  });

  // bug 2026-09-15: assurance marker
  it('repeats: two takings mark two skills', () => {
    const ch = build('rogue', 4, {
      featPicks: { '2:skill': 'assurance', '4:skill': 'assurance' },
      featChoices: { '2:skill': 'athletics', '4:skill': 'stealth' },
    });
    expect(assuranceResult(ch, 'athletics', ch.proficiencies.skills.athletics!)).not.toBeNull();
    expect(assuranceResult(ch, 'stealth', ch.proficiencies.skills.stealth!)).not.toBeNull();
    expect(assuranceResult(ch, 'medicine', ch.proficiencies.skills.medicine ?? 'untrained')).toBeNull();
  });
});
