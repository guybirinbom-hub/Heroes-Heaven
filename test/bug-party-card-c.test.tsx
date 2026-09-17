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
 * THE GM PARTY CARD, TWO ROWS — the layout the owner chose over the two-column one (2026-09-17):
 *
 *   ROW 1, one horizontal band: HP bar + condition/mode chips on the left, a divider, then
 *          Perception and AC/Fort/Ref/Will across as small label-over-value tiles.
 *   ROW 2, the full card width: Speed & DCs, Skills four-up, Abilities on one line, Senses &
 *          Languages — and the trash can at the bottom left.
 *
 * On top of that it still carries the owner's own changes from 2026-09-16:
 *
 *   "make the perception less big; the line under the perception looks weird get rid of it; don't
 *    make the skills that they are untrained at gray, instead I want the same proficiency circles
 *    that the skills in the character sheet have; move the ability attributes to be below the
 *    skills; add a plus button next to the timer that lets you add that player to the initiative;
 *    the remove player button doesn't need a row of its own, put it in the bottom left and change
 *    the icon to a trash can."
 *
 * Every leg below is one of those, plus the structural promises the layout makes: the header's
 * controls never sit on the chevron, row 2 disappears whole when there is nothing to put in it, and
 * the band's right-hand group wraps under the left one on a phone.
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

/** One CSS rule's body, by selector, from the party block of the stylesheet. */
function rule(css: string, selector: string): string {
  return new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*\\}').exec(css)?.[0] ?? '';
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

describe('party card — two rows', () => {
  it('shows Perception at a readable size with its proficiency circle, and no accent line under it', () => {
    const card = render();
    const perc = card.querySelector('.party-perc');
    expect(perc).toBeTruthy();
    expect(perc!.textContent).toContain('Perception');
    expect(perc!.querySelector('.party-perc-v')!.textContent).toContain('+14');
    // The circle the character sheet's own skill rows use — fed by PartySummary.perceptionRank.
    expect(pillOf(perc!.querySelector('.party-perc-v'))).toBe('E');

    const css = readFileSync('src/sheet.css', 'utf8');
    const percRule = rule(css, '.party-perc-v');
    expect(percRule).toBeTruthy();
    // "make the perception less big" — moderately above body text, nowhere near the mockup's 26px.
    const size = Number(/font-size:\s*([\d.]+)px/.exec(percRule)?.[1]);
    expect(size).toBeGreaterThanOrEqual(16);
    expect(size).toBeLessThanOrEqual(20);
    // "the line under the perception looks weird get rid of it" — the mockup's accent bar is gone,
    // markup and stylesheet both.
    expect(card.querySelector('.party-perc .c-accent, .party-perc-accent')).toBeNull();
    expect(css).not.toMatch(/\.party-perc-accent/);
  });

  it('prints every skill with the sheet’s proficiency circle — untrained included, not greyed', () => {
    const card = render();
    const ref = card.querySelector('.party-row-ref')!;
    const skills = [...ref.querySelectorAll('.party-sk')];
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

  it('runs row 2 wide: DCs three-up, skills four-up, the six abilities on one line', () => {
    const card = render();
    const labels = [...card.querySelectorAll('.party-row-ref .party-sec > .party-lab')].map((l) => l.textContent);
    // The owner's order — abilities BELOW the skills — is unchanged by the new layout.
    expect(labels).toEqual(['Speed & DCs', 'Skills', 'Abilities']);
    // Senses/languages close the band, after all three sections (the kick is outside it).
    expect(card.querySelector('.party-row-ref')!.lastElementChild!.className).toBe('party-sl');
    // Six abilities and the whole skill list are in ONE band, so the grids get the card's width:
    // this is the reason the owner took two rows over two columns.
    const css = readFileSync('src/sheet.css', 'utf8');
    expect(rule(css, '.party-skills')).toMatch(/grid-template-columns:\s*repeat\(4, 1fr\)/);
    expect(rule(css, '.party-kv')).toMatch(/grid-template-columns:\s*repeat\(6, 1fr\)/);
    expect(rule(css, '.party-kv.two')).toMatch(/grid-template-columns:\s*repeat\(3, 1fr\)/);
    expect(card.querySelectorAll('.party-row-ref .party-kv.two > span')).toHaveLength(3);
    const abilities = [...card.querySelectorAll('.party-row-ref .party-sec')][2];
    expect(abilities.querySelectorAll('.party-kv > span')).toHaveLength(6);
  });

  it('puts HP and the chips (derived ones locked) left in row 1, the numbers right past the divider', () => {
    const card = render();
    const band = card.querySelector('.party-card-body > .party-row-turn')!;
    const left = band.querySelector('.party-turn-l')!;
    const right = band.querySelector('.party-turn-r')!;
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
    // HP and chips never cross the divider, and Perception/AC/saves never sit on the left of it.
    expect(left.querySelector('.party-perc, .party-defs')).toBeNull();
    expect(right.querySelector('.party-hp, .party-chips')).toBeNull();
    // Perception first, then AC and the three saves with their own circles, across the band.
    expect(right.firstElementChild!.className).toBe('party-perc');
    const defs = [...right.querySelectorAll('.party-defs .party-def')];
    expect(defs.map((d) => d.querySelector('.party-lab')!.textContent)).toEqual(['AC', 'Fort', 'Ref', 'Will']);
    expect(defs[0].querySelector('b')!.textContent).toBe('22');
    expect(pillOf(defs[1])).toBe('T');

    // The band is a row and the tiles run across it — the divider is the right group's left border.
    const css = readFileSync('src/sheet.css', 'utf8');
    expect(rule(css, '.party-row-turn')).toMatch(/display:\s*flex/);
    expect(rule(css, '.party-turn-r')).toMatch(/border-left:\s*var\(--app-bw\)/);
    expect(rule(css, '.party-defs')).toMatch(/display:\s*flex/);
    expect(rule(css, '.party-defs')).not.toMatch(/flex-direction:\s*column/);
    expect(rule(css, '.party-def')).toMatch(/flex-direction:\s*column/);
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
    // bottom left"*. So: the last block in the body, under row 2 — no footer row at all.
    const body = card.querySelector('.party-card-body')!;
    const kick = body.lastElementChild as HTMLElement;
    expect(kick.classList.contains('party-kick')).toBe(true);
    expect(card.querySelector('.party-foot')).toBeNull();
    expect(kick.previousElementSibling!.className).toBe('party-row-ref');
    expect(kick.getAttribute('aria-label')).toBe('Remove from party');
    // A trash can, not the old user-minus.
    expect(kick.querySelector('.ti-trash')).toBeTruthy();
    expect(kick.querySelector('.ti-user-minus')).toBeNull();

    // A card with NO row 2 still keeps its kick, bottom-left under the band — the kick is a GM
    // control, not part of the reference band that "Stats shown" can switch off.
    const minimal = render({ showKick: true, detail: preset('minimal') });
    const minBody = minimal.querySelector('.party-card-body')!;
    expect((minBody.lastElementChild as HTMLElement).classList.contains('party-kick')).toBe(true);
    expect(minBody.querySelector('.party-row-ref')).toBeNull();

    // NO OVERLAP: the kick is out of the header entirely, and the chevron is still the header's
    // last child with the host's controls before it. (getBoundingClientRect is 0×0 in jsdom, so
    // structure is the only honest assertion here.)
    const head = card.querySelector('.party-card-h')!;
    expect(head.querySelector('.party-kick')).toBeNull();
    expect(head.lastElementChild!.classList.contains('party-chev')).toBe(true);
    expect(head.lastElementChild!.previousElementSibling!.classList.contains('party-card-tools')).toBe(true);

    const css = readFileSync('src/sheet.css', 'utf8');
    // The old overlap came from an absolutely-positioned kick in the card's top-right corner.
    const kickRule = rule(css, '.party-kick');
    expect(kickRule).not.toMatch(/position:\s*absolute/);
    // It sits below whatever precedes it in the body flow, with its own clearance — `margin-top:auto`
    // was the two-column card's trick and does nothing in a block flow.
    expect(kickRule).toMatch(/margin-top:\s*10px/);
    expect(css).not.toMatch(/\.party-foot/);

    // The pane card (a PC's row in the initiative order) is the same layout minus the kick.
    const pane = render();
    expect(pane.querySelector('.party-foot')).toBeNull();
    expect(pane.querySelector('.party-kick')).toBeNull();
    expect(pane.querySelector('.party-row-ref')).toBeTruthy();
  });

  it('keeps the HP bar out of the chips under it', () => {
    // `.party-hpbar` is a <span>. Left at display:inline it ignores its own 4px height and its
    // `height:100%` child paints a full-height slab over the next line.
    // (jsdom has no layout, so the stylesheet is the only place this is checkable here.)
    const css = readFileSync('src/sheet.css', 'utf8');
    const hp = rule(css, '.party-hp');
    const bar = rule(css, '.party-hpbar');
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

  it('draws NO second row — and no divider — on a preset that turns every section off', () => {
    // "Stats shown" → Minimal is defenses only; Name only is nothing at all. Neither has a single
    // reference section, so the card is the band alone: it used to keep the band's bottom padding
    // and a bordered empty block underneath, because the slot held a component that renders null
    // (a truthy element).
    for (const id of ['minimal', 'nameOnly']) {
      const detail = preset(id);
      expect([id, hasRightColumn(STATS, detail)]).toEqual([id, false]);
      const card = render({ detail });
      const body = card.querySelector('.party-card-body')!;
      expect([id, body.classList.contains('has-right')]).toEqual([id, false]);
      expect([id, card.querySelectorAll('.party-row-ref').length]).toEqual([id, 0]);
      // Row 1 is untouched — the GM still gets HP/AC on a Minimal card.
      expect(card.querySelector('.party-turn-l .party-hp')).toBeTruthy();
      expect(card.querySelector('.party-turn-r .party-defs')).toBeTruthy();
    }
    // …and the band drops its own bottom padding when there is nothing under it, so a Minimal card
    // ends where its numbers end.
    const css = readFileSync('src/sheet.css', 'utf8');
    expect(rule(css, '.party-card-body:not(.has-right) .party-row-turn')).toMatch(/padding-bottom:\s*0/);
    expect(rule(css, '.party-row-ref')).toMatch(/border-top:\s*var\(--app-bw\)/);

    // Combat turns Speed & DCs on, so that one DOES get a second row.
    const combat = render({ detail: preset('combat') });
    expect(combat.querySelector('.party-card-body')!.classList.contains('has-right')).toBe(true);
    expect([...combat.querySelectorAll('.party-row-ref .party-sec > .party-lab')].map((l) => l.textContent))
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
    expect(rule(css, '.ct-pane-card > .party-card')).toMatch(/max-width:\s*700px/);
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

  it('collapses the grid track instead of overflowing a pane narrower than 420px', () => {
    // The tracker's party pane can be dragged narrower than the 420px card — minmax(420px, 1fr)
    // alone forces that width and overflows the container. min(420px, 100%) caps the track at
    // whatever room is actually there.
    const css = readFileSync('src/sheet.css', 'utf8');
    expect(rule(css, '.party-grid')).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(420px,\s*100%\),\s*1fr\)\)/);
  });

  it('leaves the dedicated Party page room for two of its own 420px columns, not one', () => {
    // The card's minimum grew 320 -> 420 for the two-row layout above, but .party-body's max-width
    // didn't grow with it — the old 720px cap fit two 320px cards (648px) and nothing wider, so every
    // desktop window silently dropped to a single column. Read the numbers rather than pin 880: this
    // fails again if either rule's width, padding or gap drifts without the other.
    const css = readFileSync('src/sheet.css', 'utf8');
    const body = rule(css, '.party-body');
    const grid = rule(css, '.party-grid');
    const maxWidth = Number(/max-width:\s*(\d+)px/.exec(body)?.[1]);
    const padding = Number(/padding:\s*(\d+)px/.exec(body)?.[1]);
    const cardMin = Number(/minmax\(min\((\d+)px/.exec(grid)?.[1]);
    const gap = Number(/gap:\s*(\d+)px/.exec(grid)?.[1]);
    expect(maxWidth - 2 * padding).toBeGreaterThanOrEqual(2 * cardMin + gap);
  });

  it('wraps row 1’s right-hand group under the left one on a phone, and halves the skill grid', () => {
    const css = readFileSync('src/sheet.css', 'utf8');
    // The phone rules for the band, not the base ones: everything after a `max-width: 720px` opener
    // (slice(1) drops the stylesheet before the first one) and before that block's own closing brace.
    const phone = css
      .split('@media (max-width: 720px) {')
      .slice(1)
      .find((b) => b.includes('.party-turn-r'))
      ?.split(/\r?\n\}/)[0] ?? '';
    expect(phone).toBeTruthy();
    // The band wraps, and the group that wraps takes the whole width…
    expect(rule(phone, '.party-row-turn')).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(phone, '.party-turn-r')).toMatch(/flex-basis:\s*100%/);
    // …with its divider turned into the rule above it.
    expect(rule(phone, '.party-turn-r')).toMatch(/border-left:\s*0/);
    expect(rule(phone, '.party-turn-r')).toMatch(/border-top:\s*var\(--app-bw\)/);
    // Sixteen skills four-up don't fit a phone: two-up, and the six-cell ability line halves too.
    expect(rule(phone, '.party-skills')).toMatch(/grid-template-columns:\s*repeat\(2, 1fr\)/);
    expect(rule(phone, '.party-kv')).toMatch(/grid-template-columns:\s*repeat\(3, 1fr\)/);
    // The grid itself is one card per row — its 420px minimum track would scroll a phone sideways.
    expect(rule(phone, '.party-grid')).toMatch(/grid-template-columns:\s*1fr/);
  });
});
