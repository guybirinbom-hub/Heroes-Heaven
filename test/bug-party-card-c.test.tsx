// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PartyMember } from '../src/data/party';
import type { PartySummary } from '../src/sheet/partySummary';
import { PC_DETAIL_ALL, PC_DETAIL_PRESETS, type PcDetailConfig, type PcStats } from '../tracker/src/utils/pcDetail';
import { useCombatStore } from '../tracker/src/store/combatStore';

/**
 * THE GM PARTY CARD, design C ("two columns"), with the owner's own changes on top of it
 * (2026-09-16):
 *
 *   "make the perception less big; the line under the perception looks weird get rid of it; don't
 *    make the skills that they are untrained at gray, instead I want the same proficiency circles
 *    that the skills in the character sheet have; move the ability attributes to be below the
 *    skills; add a plus button next to the timer that lets you add that player to the initiative;
 *    the remove player button doesn't need a row of its own, put it in the bottom left and change
 *    the icon to a trash can."
 *
 * Every leg below is one of those sentences, plus the two structural promises the layout makes:
 * the header's controls never sit on the chevron, and the columns stack on a phone.
 *
 * The member here is synthetic — no character of the owner's, and no server.
 */

// PartyMembers reaches Supabase through src/data/party; the card itself never calls it, but the
// module graph loads it. Same three mocks CampaignTracker's own tests use.
vi.mock('../src/integration/enabled', () => ({
  TRACKER_IN_CAMPAIGN: true,
  TEST_CAMPAIGNS_WITHOUT_LOGIN: false,
}));

vi.mock('../src/data/useAuth', () => ({
  useAuth: () => ({ status: 'signed-in', session: null, email: 'gm@example.com' }),
  signOut: async () => undefined,
}));

vi.mock('../src/data/party', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/data/party')>()),
  currentUserId: async () => 'gm-1',
  fetchParty: async () => [],
  fetchMemberSheet: async () => null,
  subscribeMemberSheet: () => () => undefined,
  subscribeParty: () => () => undefined,
  publishCharacter: async () => undefined,
  unpublishCharacter: async () => undefined,
  fetchGmEdits: async () => [],
  deleteGmEdit: async () => 1,
  subscribeGmEdits: () => () => undefined,
  pushGmEdit: async () => ({ ok: true, value: null }),
}));

const { PartyCard } = await import('../src/sheet/PartyMembers');
const { PcStatsCardExtra, PcSavesCells, hasRightColumn } = await import('../src/integration/PcStatsCardExtra');
const { PartyAddToOrderButton, addPartyMemberToInitiative } = await import('../src/integration/CampaignTracker');

const SUMMARY: PartySummary = {
  name: 'Mirelle Duskcloak',
  ancestry: 'Catfolk',
  className: 'Bard',
  level: 7,
  hpCur: 64,
  hpMax: 71,
  ac: 22,
  perception: 14,
  perceptionRank: 'expert',
  conditions: [
    { name: 'Frightened', value: 1 },
    { name: 'Encumbered', derivedFrom: 'Bulk — carrying 9 of 8' },
  ],
  modes: ['Inspire Courage'],
};

const MEMBER: PartyMember = {
  ownerId: 'owner-c',
  charId: 'char-c',
  name: 'Mirelle Duskcloak',
  summary: SUMMARY,
};

const STATS: PcStats = {
  ac: 22,
  maxHP: 71,
  perceptionMod: 14,
  perceptionProf: 'E',
  fortMod: 11,
  fortProf: 'T',
  refMod: 15,
  refProf: 'E',
  willMod: 15,
  willProf: 'E',
  str: 0,
  dex: 4,
  con: 2,
  int: 1,
  wis: 2,
  cha: 5,
  speed: 25,
  classDC: 22,
  spellDC: 25,
  senses: 'low-light vision',
  languages: 'Common, Amurrun, Elven',
  // Diplomacy is a master skill; NATURE is deliberately absent — an untrained skill the card must
  // still print, with the untrained circle.
  skills: {
    Diplomacy: { mod: 16, prof: 'M' },
    Stealth: { mod: 13, prof: 'T' },
  },
};

let host: HTMLDivElement;
let root: Root;

const preset = (id: string): PcDetailConfig => PC_DETAIL_PRESETS.find((p) => p.id === id)!.config;

function render(opts: { showKick?: boolean; onOpen?: () => void; detail?: PcDetailConfig } = {}): HTMLElement {
  const detail = opts.detail ?? PC_DETAIL_ALL;
  act(() => {
    root.render(
      <PartyCard
        member={MEMBER}
        isMine={false}
        showKick={opts.showKick}
        onOpen={opts.onOpen ?? (() => undefined)}
        onKick={() => undefined}
        extra={{
          header: <PartyAddToOrderButton member={MEMBER} />,
          saves: <PcSavesCells stats={STATS} detail={detail} />,
          // EXACTLY what the seam's slot builder does (CampaignTracker.cardExtra) — the emptiness
          // decision is made before the slot exists, not by the component inside it.
          right: hasRightColumn(STATS, detail) ? <PcStatsCardExtra stats={STATS} detail={detail} /> : null,
        }}
      />,
    );
  });
  const card = host.querySelector('.party-card');
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

/** The letter inside the sheet's proficiency pill (RankPill), or null when there is no pill. */
function pillOf(el: Element | null | undefined): string | null {
  return el?.querySelector('.rank-pill')?.textContent?.trim() ?? null;
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
  });
  useCombatStore.setState({ combatants: [] });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useCombatStore.setState({ combatants: [] });
});

describe('party card — design C', () => {
  it('shows Perception at a readable size with its proficiency circle, and no accent line under it', () => {
    const card = render();
    const perc = card.querySelector('.party-perc');
    expect(perc).toBeTruthy();
    expect(perc!.textContent).toContain('Perception');
    expect(perc!.querySelector('.party-perc-v')!.textContent).toContain('+14');
    // The circle the character sheet's own skill rows use — fed by PartySummary.perceptionRank.
    expect(pillOf(perc!.querySelector('.party-perc-v'))).toBe('E');

    const css = readFileSync('src/sheet.css', 'utf8');
    const rule = /\.party-perc-v\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toBeTruthy();
    // "make the perception less big" — moderately above body text, nowhere near the mockup's 26px.
    const size = Number(/font-size:\s*([\d.]+)px/.exec(rule)?.[1]);
    expect(size).toBeGreaterThanOrEqual(16);
    expect(size).toBeLessThanOrEqual(20);
    // "the line under the perception looks weird get rid of it" — the mockup's accent bar is gone,
    // markup and stylesheet both.
    expect(card.querySelector('.party-perc .c-accent, .party-perc-accent')).toBeNull();
    expect(css).not.toMatch(/\.party-perc-accent/);
  });

  it('prints every skill with the sheet’s proficiency circle — untrained included, not greyed', () => {
    const card = render();
    const right = card.querySelector('.party-col-r')!;
    const skills = [...right.querySelectorAll('.party-sk')];
    // All sixteen, not just the two this PC has entries for.
    expect(skills).toHaveLength(16);

    const nature = skills.find((s) => s.getAttribute('title') === 'Nature');
    expect(nature).toBeTruthy();
    // The untrained CIRCLE, where the old card showed nothing at all…
    expect(pillOf(nature)).toBe('U');
    // …and no modifier class: normal text colour, never the faint/greyed row the owner rejected.
    expect(nature!.className).toBe('party-sk');

    const dipl = skills.find((s) => s.getAttribute('title') === 'Diplomacy');
    expect(pillOf(dipl)).toBe('M');
    expect(dipl!.textContent).toContain('+16');

    // Nothing in the party block dims a skill.
    const css = readFileSync('src/sheet.css', 'utf8');
    expect(css).not.toMatch(/\.party-sk[^{]*\{[^}]*text-faint/);
  });

  it('puts the abilities BELOW the skills in the right column', () => {
    const card = render();
    const labels = [...card.querySelectorAll('.party-col-r .party-sec > .party-lab')].map((l) => l.textContent);
    expect(labels).toEqual(['Speed & DCs', 'Skills', 'Abilities']);
    // Senses/languages close the column, after all three sections.
    expect(card.querySelector('.party-col-r')!.lastElementChild!.className).toBe('party-sl');
  });

  it('keeps HP, chips (derived ones locked), Perception and the AC/save block in the left column', () => {
    const card = render();
    const left = card.querySelector('.party-col-l')!;
    expect(left.querySelector('.party-hp')!.textContent).toContain('64 / 71');
    expect(left.querySelector('.party-hpbar')).toBeTruthy();
    // A condition the sheet derived carries its cause and a lock; a player-applied one does not.
    const chips = [...left.querySelectorAll('.party-cond')];
    const enc = chips.find((c) => (c.textContent ?? '').includes('Encumbered'))!;
    expect(enc.classList.contains('is-auto')).toBe(true);
    expect(enc.getAttribute('title')).toContain('Bulk');
    expect(enc.querySelector('.ti-lock')).toBeTruthy();
    const frightened = chips.find((c) => (c.textContent ?? '').includes('Frightened'))!;
    expect(frightened.classList.contains('is-auto')).toBe(false);
    expect(frightened.querySelector('.ti-lock')).toBeNull();
    // AC first, then the three saves with their own circles — one bold stat block.
    const defs = [...left.querySelectorAll('.party-defs .party-def')];
    expect(defs.map((d) => d.querySelector('.party-lab')!.textContent)).toEqual(['AC', 'Fort', 'Ref', 'Will']);
    expect(defs[0].querySelector('b')!.textContent).toBe('22');
    expect(pillOf(defs[1])).toBe('T');
  });

  it('adds exactly one PC — with their charId — from the "+" beside the timer, then disables it', () => {
    const card = render();
    const tools = card.querySelector('.party-card-h .party-card-tools')!;
    // The "+" sits WITH the turn chip, in the header.
    const add = tools.querySelector('.party-add-init') as HTMLButtonElement;
    expect(add).toBeTruthy();
    expect(add.disabled).toBe(false);

    act(() => add.click());

    const pcs = useCombatStore.getState().combatants.filter((c) => c.isPC);
    expect(pcs).toHaveLength(1);
    expect(pcs[0].name).toBe('Mirelle Duskcloak');
    expect(pcs[0].charId).toBe('char-c');
    // No initiative value — the GM never rolled one.
    expect(pcs[0].initiative == null).toBe(true);
    expect(pcs[0].maxHP).toBe(71);

    // Now they're in the order: the button says so and refuses.
    const after = card.querySelector('.party-add-init') as HTMLButtonElement;
    expect(after.disabled).toBe(true);
    expect(after.getAttribute('title')).toContain('already in the initiative order');
    act(() => after.click());
    expect(useCombatStore.getState().combatants.filter((c) => c.isPC)).toHaveLength(1);
  });

  it('routes the drag drop and the "+" through ONE add function', () => {
    // The seam's rail drop calls exactly this — a second add of the same PC is refused, which is
    // what the drop turns into its "already in the order" notice.
    expect(addPartyMemberToInitiative({ charId: 'char-c', name: 'Mirelle Duskcloak', maxHP: 71 })).toBe(true);
    expect(addPartyMemberToInitiative({ charId: 'char-c', name: 'Mirelle Duskcloak', maxHP: 71 })).toBe(false);
    expect(useCombatStore.getState().combatants).toHaveLength(1);
    expect(useCombatStore.getState().combatants[0].charId).toBe('char-c');
    expect(addPartyMemberToInitiative({ charId: 'x', name: '   ' })).toBe(false);
  });

  it('puts the kick button bottom-left as a trash can, off the header, and never on a pane card', () => {
    const card = render({ showKick: true });
    // owner 2026-09-16: *"the remove player button doesn't need a row of its own, put it in the
    // bottom left"*. So: inside the LEFT column, as its last child (under the AC/saves block), and
    // there is no footer row at all any more.
    const left = card.querySelector('.party-col-l')!;
    const kick = left.lastElementChild as HTMLElement;
    expect(kick.classList.contains('party-kick')).toBe(true);
    expect(card.querySelector('.party-foot')).toBeNull();
    expect(kick.previousElementSibling!.className).toBe('party-defs');
    expect(kick.getAttribute('aria-label')).toBe('Remove from party');
    // A trash can, not the old user-minus.
    expect(kick.querySelector('.ti-trash')).toBeTruthy();
    expect(kick.querySelector('.ti-user-minus')).toBeNull();

    // NO OVERLAP: the kick is out of the header entirely, and the chevron is still the header's
    // last child with the host's controls before it. (getBoundingClientRect is 0×0 in jsdom, so
    // structure is the only honest assertion here.)
    const head = card.querySelector('.party-card-h')!;
    expect(head.querySelector('.party-kick')).toBeNull();
    expect(head.lastElementChild!.classList.contains('party-chev')).toBe(true);
    expect(head.lastElementChild!.previousElementSibling!.classList.contains('party-card-tools')).toBe(true);

    const css = readFileSync('src/sheet.css', 'utf8');
    // The old overlap came from an absolutely-positioned kick in the card's top-right corner.
    const rule = /\.party-kick\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).not.toMatch(/position:\s*absolute/);
    // Bottom of the column, not just last in the DOM: the left column is flex, so the slack has to
    // go ABOVE the kick or it floats up under the saves on a card whose right column is taller.
    expect(rule).toMatch(/margin-top:\s*auto/);
    expect(css).not.toMatch(/\.party-foot/);

    // The pane card (a PC's row in the initiative order) is the same layout minus the kick.
    const pane = render();
    expect(pane.querySelector('.party-foot')).toBeNull();
    expect(pane.querySelector('.party-kick')).toBeNull();
    expect(pane.querySelector('.party-col-r')).toBeTruthy();
  });

  it('keeps the HP bar out of the Perception label', () => {
    // `.party-hpbar` is a <span>. Left at display:inline it ignores its own 4px height and its
    // `height:100%` child paints a full-height slab over the next line — which is PERCEPTION.
    // (jsdom has no layout, so the stylesheet is the only place this is checkable here.)
    const css = readFileSync('src/sheet.css', 'utf8');
    const hp = /\.party-hp\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    const bar = /\.party-hpbar\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(/display:\s*(flex|grid|block)/.test(hp) || /display:\s*block/.test(bar)).toBe(true);
  });

  it('leaves the header "+" and the kick their own keyboard press', () => {
    const onOpen = vi.fn();
    const card = render({ showKick: true, onOpen });

    // The card is role="button" tabIndex=0 and handles Enter/Space itself. Its handler also sees the
    // keydowns bubbling out of the buttons INSIDE it: if it preventDefault()s one, the browser never
    // fires that button's click-from-Enter, so the control ends up mouse-only and the sheet opens
    // instead. (jsdom fires no default activation either way — defaultPrevented is the honest signal.)
    for (const sel of ['.party-add-init', '.party-kick']) {
      const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      act(() => {
        card.querySelector(sel)!.dispatchEvent(ev);
      });
      expect([sel, ev.defaultPrevented]).toEqual([sel, false]);
      expect(onOpen).not.toHaveBeenCalled();
    }

    // The card's OWN Enter still opens the sheet.
    const own = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      card.dispatchEvent(own);
    });
    expect(own.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('draws NO right column — and no divider — on a preset that turns every section off', () => {
    // "Stats shown" → Minimal is defenses only; Name only is nothing at all. Neither has a single
    // right-column section, so the card must stay ONE column: it used to split in two and paint an
    // empty bordered gutter, because the slot held a component that renders null (truthy element).
    for (const id of ['minimal', 'nameOnly']) {
      const detail = preset(id);
      expect([id, hasRightColumn(STATS, detail)]).toEqual([id, false]);
      const card = render({ detail });
      const body = card.querySelector('.party-card-body')!;
      expect([id, body.classList.contains('has-right')]).toEqual([id, false]);
      expect([id, card.querySelectorAll('.party-col').length]).toEqual([id, 1]);
      expect(card.querySelector('.party-col-r')).toBeNull();
      // The left column is untouched — the GM still gets HP/AC on a Minimal card.
      expect(card.querySelector('.party-col-l .party-hp')).toBeTruthy();
    }

    // Combat turns Speed & DCs on, so that one IS a two-column card.
    const combat = render({ detail: preset('combat') });
    expect(combat.querySelector('.party-card-body')!.classList.contains('has-right')).toBe(true);
    expect([...combat.querySelectorAll('.party-col-r .party-sec > .party-lab')].map((l) => l.textContent))
      .toEqual(['Speed & DCs']);

    // Senses & languages alone counts only when this PC HAS one — an empty section is still empty.
    expect(hasRightColumn(STATS, { ...preset('nameOnly'), sensesLangs: true })).toBe(true);
    expect(hasRightColumn({ ...STATS, senses: undefined, languages: undefined }, { ...preset('nameOnly'), sensesLangs: true })).toBe(false);

    // ONE predicate: the seam's slot builder asks it rather than keeping its own copy of the rule.
    const seam = readFileSync('src/integration/CampaignTracker.tsx', 'utf8');
    expect(/right:\s*st && hasRightColumn\(st, pcDetail\)/.test(seam)).toBe(true);
  });

  it('caps the pane card so it doesn’t stretch across a 1095px pane', () => {
    // A pane is 620–1095px wide and the card took all of it, putting the skill grid most of a screen
    // from the HP bar. (jsdom has no layout; the stylesheet is the honest assertion.)
    const css = readFileSync('src/integration/campaign-tracker.css', 'utf8');
    const rule = /\.ct-pane-card > \.party-card\s*\{[^}]*\}/.exec(css)?.[0] ?? '';
    expect(rule).toMatch(/max-width:\s*700px/);
  });

  it('knows a PC is in the order by charId, not just by name', () => {
    // The same character under a different name (renamed at the table, or a saved encounter reloaded
    // before a rename) is already in the order — the "+" must not offer to add them twice.
    useCombatStore.setState({ combatants: [] });
    act(() => {
      useCombatStore.getState().addCombatant(null, { name: 'Mirelle the Grey', isPC: true, charId: 'char-c' });
    });
    const card = render();
    expect((card.querySelector('.party-add-init') as HTMLButtonElement).disabled).toBe(true);
    expect(addPartyMemberToInitiative({ charId: 'char-c', name: 'Mirelle Duskcloak', maxHP: 71 })).toBe(false);

    // A DIFFERENT character who happens to share this one's name is a second player, and goes in.
    expect(addPartyMemberToInitiative({ charId: 'char-z', name: 'Mirelle the Grey', maxHP: 40 })).toBe(true);
    expect(useCombatStore.getState().combatants.map((c) => c.charId)).toEqual(['char-c', 'char-z']);
  });

  it('stacks the two columns on a phone', () => {
    const css = readFileSync('src/sheet.css', 'utf8');
    const phone = /@media \(max-width: 720px\) \{\s*\.party-card-body \{[^}]*\}[^]*?\n\}/.exec(css)?.[0] ?? '';
    expect(phone).toBeTruthy();
    expect(phone).toMatch(/grid-template-columns:\s*1fr/);
    // …and the divider between them becomes a rule above the second column.
    expect(phone).toMatch(/\.party-col-r \{[^}]*border-left:\s*0/);
  });
});
