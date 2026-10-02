// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { act, useLayoutEffect, useRef, useState } from 'react';
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { normalizeCharacter } from '../src/rules/normalize';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { CustomizationContext, DEFAULT_CUSTOMIZATION } from '../src/data/customization';
import { ForceMobileContext } from '../src/sheet/useIsMobile';
import { VitalsRail } from '../src/sheet/VitalsRail';
import { CharacterSheet } from '../src/sheet/CharacterSheet';
import { CustomizationEditor } from '../src/sheet/CustomizationEditor';
import type { Character, Customization } from '../src/rules/types';
import type { PlayState, PlayUpdater } from '../src/rules/play';

/*
 * OWNER (2026-09-22), on the XP mockup: *"i want b1 and b2 as options b2 the deafoult, just making
 * sure when you press the xp you get somtihng similer to edining hp where you can both edit the
 * current numbner or write how much to add to it, also pressing b1 also needs to open that editing."*
 *
 * So XP moved into the rail's Hit points card with two looks — B2 a chip in the card's title row
 * (the default, and what an ABSENT `xpDisplay` means) and B1 a thin "XP 340 / 1000" line with a
 * progress bar — and PRESSING EITHER opens one editor with both moves: set the total, or add.
 *
 * OWNER'S LIST, ITEM 9 (after v0.1.41): XP top right on a PC as before; the rail chip only on the
 * phone layout. A PC had been showing XP twice — the header field beside the tabs AND the rail chip.
 * "The phone layout" is WIDTH: useIsMobile, the 720px matchMedia every phone-only control uses (and
 * ForceMobileContext), never the device flag. So the rail's chip, line and editor exist only on the
 * phone layout, the header field only off it. The sheet's one answer — CharacterSheet's own `isMobile`
 * (its useShowUndoButtons asks the hook as well, but only for the undo arrows) — gates the header field
 * AND is handed to VitalsRail as its `isMobile` prop, so one value decides both XP surfaces and the
 * sheet NEVER shows two. (Two hook instances could disagree: a rail mounting after the window crossed
 * 720px reads the new width while the sheet keeps its old answer until the change event lands — zero
 * XP or two. The "a rail that mounts late" legs pin that.)
 *
 * Never two is not always one. On a computer the header field is there on every tab. On the phone
 * layout XP lives in the rail's Hit points card, and the phone layout renders the rail on the Main tab
 * only — so there XP is on Main only, and a Hit points card hidden in Customize leaves the phone layout
 * no XP at all. Both were true in v0.1.41 and item 9 changed neither; "the sheet's XP count, tab by
 * tab" pins them, so no comment here can promise more than the sheet does. Nor does sheet.css hide the
 * header field any more: its 720px block hid `.identity .level-stack` too, and with the JS gate in place
 * that rule could only ever ZERO the XP, in a window where CSS and useIsMobile disagree (one such
 * disagreement is recorded in test/bug-phone-web.test.tsx, whose "the header XP field is the JS gate's
 * alone" pins the rule's removal). So the JS gate is the field's only WIDTH-based hide. One CSS rule
 * still names the field — campaign-tracker.css's `.ct-pc-pane.is-narrow .identity .level-stack` — and it
 * is keyed to the same `narrow` boolean as that pane's ForceMobileContext, which makes the sheet's
 * `isMobile` true: it can only match where the gate has already removed the field. The rail legs render
 * the PHONE by default; the computer legs say `mobile: false`.
 *
 * What would make this a lie, and so what these legs pin:
 *  - a character who never touched the setting gets the chip (a default that needs a saved value is
 *    not a default),
 *  - the line's bar is the real fraction of the 1,000 XP a PF2e level costs, not decoration,
 *  - BOTH surfaces open the editor — the owner asked for B1's press by name,
 *  - Add ADDS (340 + 120 = 460) and a minus sign takes XP away, which is the whole difference
 *    between the two fields,
 *  - the editor is reachable on a PHONE, where the HP damage/heal row is deliberately gone,
 *  - on a computer the rail shows NO XP in either look, read-only or not, and the sheet shows the
 *    header field on every tab; on a phone the sheet shows the chip (on Main) and never the header field,
 *  - a layout change mid-edit (a phone turned sideways past 720px) closes the editor and DISCARDS
 *    the typed-but-unapplied numbers: nothing was written, so it is not a player's change, and the
 *    drafts must not come back when the window narrows again,
 *  - the header field's typed-but-unapplied numbers are DISCARDED the same way when the window narrows
 *    — including with focus still in the total and a blur fired as the field is removed (that field
 *    applies on blur, so this is the case a player can actually reach).
 *
 * MUTATION PROOF (applied once, then restored):
 *  • Making the + button set instead of add — `onPlay((p) => setXp(p, n))` in `applyXpAdd` — fails
 *    "Add ADDS to the total": `AssertionError: 340 + 120: expected 120 to be 460 // Object.is
 *    equality`.
 *  • Dropping the `onKeyDown` this lane's refuter added to `xpPressable`'s button (VitalsRail.tsx)
 *    fails "Escape closes it even with focus still on the chip" below: clicking a button does not
 *    move focus into the editor it opens, so Escape pressed there used to reach no handler at all —
 *    `AssertionError: closed: expected <div class="hp-edit…"> to be null`.
 *  • (item 9 mutations: see the block above the "on a computer" describe.)
 */
const db = content();

/** A level-5 fighter sitting on 340 XP — 34% of the 1,000 a PF2e level costs (Player Core). */
const hero = (over: Record<string, unknown> = {}): Character =>
  normalizeCharacter({
    id: 'x',
    name: 'X',
    level: 5,
    classId: 'fighter',
    keyAbility: 'str',
    abilities: { str: 18, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
    feats: [],
    currency: {},
    inventory: [],
    xp: 340,
    ...over,
  } as unknown as Character);

/** What the rail looked like at each COMMIT in which the layout changed, read in a layout effect —
 *  i.e. before any useEffect of that commit has run, which is the frame a browser can paint. */
type Frame = { mobile: boolean; editor: boolean; chip: boolean; line: boolean };

/** Render the rail with a given XP display setting, capturing what the play writes would do.
 *  The PHONE layout is the default: that is the only layout where the rail carries XP (item 9). */
function rail(opts: { xpDisplay?: Customization['xpDisplay']; mobile?: boolean; readOnly?: boolean } = {}) {
  // Only `xp` is read by setXp/addXp, so a stub state is the honest whole of what they touch.
  let play = { xp: 340 } as unknown as PlayState;
  const onPlay = ((fn) => {
    play = fn(play);
  }) as PlayUpdater;
  const opened: unknown[] = [];
  const frames: Frame[] = [];
  const custom: Customization = { ...DEFAULT_CUSTOMIZATION, xpDisplay: opts.xpDisplay };
  let setMobile: (m: boolean) => void = () => undefined;
  function Harness() {
    const [mobile, set] = useState(opts.mobile ?? true);
    setMobile = set;
    const box = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
      const has = (sel: string) => !!box.current?.querySelector(sel);
      frames.push({ mobile, editor: has('.xp-rail-edit'), chip: has('.xp-chip'), line: has('.xp-rail-line') });
    }, [mobile]);
    return (
      <div ref={box}>
        <ForceMobileContext.Provider value={mobile}>
          <CustomizationContext.Provider value={custom}>
            <VitalsRail
              character={hero()}
              content={db}
              onPlay={opts.readOnly ? undefined : onPlay}
              onOpenStat={(r) => opened.push(r)}
            />
          </CustomizationContext.Provider>
        </ForceMobileContext.Provider>
      </div>
    );
  }
  const r = renderDom(<Harness />);
  const q = <T extends Element>(sel: string) => r.host.querySelector(sel) as T | null;
  return {
    ...r,
    opened,
    frames,
    /** Change the layout the way a resize or a rotation does (the ForceMobileContext answer flips). */
    layout: (m: boolean) =>
      act(() => {
        setMobile(m);
      }),
    xp: () => play.xp,
    chip: () => q<HTMLElement>('.xp-chip'),
    line: () => q<HTMLElement>('.xp-rail-line'),
    fill: () => q<HTMLElement>('.xp-rail-fill'),
    editor: () => q<HTMLElement>('.xp-rail-edit'),
    total: () => q<HTMLInputElement>('input[aria-label^="Experience points total"]'),
    add: () => q<HTMLInputElement>('input[aria-label^="Experience points to add"]'),
    plus: () => q<HTMLButtonElement>('.xp-rail-add'),
  };
}

/** Type into a controlled input the way a browser does (React swallows a plain `.value =`). */
function type(input: HTMLInputElement | null, text: string): void {
  if (!input) throw new Error('no input to type into');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Press a key on an element, bubbling to React's root listener. */
function key(el: Element | null, k: string): void {
  if (!el) throw new Error('no element to press a key on');
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  });
}

describe('XP lives in the Hit points card (the phone layout)', () => {
  it('with nothing saved, it is the chip — in the card TITLE row, where it costs no height', () => {
    const r = rail();
    expect(r.chip(), 'the default is the chip').toBeTruthy();
    expect(r.chip()!.textContent).toBe('XP 340');
    expect(r.chip()!.closest('.ct'), 'and it rides in the title row, not on a row of its own').toBeTruthy();
    expect(r.line(), 'so there is no line').toBeNull();
    r.stop();
  });

  it("'line' swaps it for the row above the HP numbers, with the bar at the real fraction", () => {
    const r = rail({ xpDisplay: 'line' });
    expect(r.chip()).toBeNull();
    const line = r.line();
    expect(line, 'the line is there').toBeTruthy();
    expect(line!.textContent).toBe('XP340/ 1000');
    // 340 of the 1,000 XP a level costs.
    expect(r.fill()!.style.width, 'the bar is the real fraction').toBe('34%');
    // It sits ABOVE the title row, which is what "above the HP numbers" means in the card.
    expect(line!.nextElementSibling!.className).toContain('ct');
    r.stop();
  });

  it('pressing the chip opens the editor — and does NOT open the HP breakdown behind it', () => {
    const r = rail();
    expect(r.editor(), 'closed until pressed').toBeNull();
    r.click(r.chip());
    expect(r.editor(), 'the chip opens it').toBeTruthy();
    expect(r.total()!.value, 'prefilled with the current total').toBe('340');
    expect(r.opened, 'the card title behind the chip stays shut').toEqual([]);
    r.stop();
  });

  it('pressing the LINE opens the same editor (the owner asked for this one by name)', () => {
    const r = rail({ xpDisplay: 'line' });
    expect(r.editor()).toBeNull();
    r.click(r.line());
    expect(r.editor()).toBeTruthy();
    expect(r.total()!.value).toBe('340');
    r.stop();
  });

  it('Total SETS the number, and the editor closes', () => {
    const r = rail();
    r.click(r.chip());
    type(r.total(), '900');
    key(r.total(), 'Enter');
    expect(r.xp(), 'typed 900, so the total is 900').toBe(900);
    expect(r.editor(), 'and it closes after applying').toBeNull();
    r.stop();
  });

  it('Add ADDS to the total, and a minus sign takes XP away', () => {
    const r = rail();
    r.click(r.chip());
    type(r.add(), '120');
    r.click(r.plus());
    expect(r.xp(), '340 + 120').toBe(460);
    expect(r.editor(), 'and it closes after applying').toBeNull();

    r.click(r.chip());
    type(r.add(), '-60');
    key(r.add(), 'Enter');
    expect(r.xp(), 'and a negative takes it away: 460 - 60').toBe(400);
    r.stop();
  });

  it('Escape closes it and writes nothing', () => {
    const r = rail();
    r.click(r.chip());
    type(r.total(), '7');
    key(r.total(), 'Escape');
    expect(r.editor(), 'closed').toBeNull();
    expect(r.xp(), 'and the 7 was thrown away').toBe(340);
    r.stop();
  });

  /*
   * The chip's onClick opens the editor but does not focus anything inside it, so focus is left on
   * the chip/line BUTTON itself — the case above (Escape pressed inside the Total field) never
   * exercised that. Both surfaces that can open the editor get their own leg.
   */
  it('Escape closes it even with focus still on the chip that opened it', () => {
    const r = rail();
    r.click(r.chip());
    type(r.total(), '7'); // dirty the draft, so only an actual discard clears it
    key(r.chip(), 'Escape'); // focus never left the button
    expect(r.editor(), 'closed').toBeNull();
    expect(r.xp(), 'and the 7 was thrown away').toBe(340);
    r.stop();
  });

  it('…and the same is true pressing Escape on the LINE, the other button that opens it', () => {
    const r = rail({ xpDisplay: 'line' });
    r.click(r.line());
    type(r.add(), '99');
    key(r.line(), 'Escape');
    expect(r.editor(), 'closed').toBeNull();
    expect(r.xp(), 'and the draft add was thrown away').toBe(340);
    r.stop();
  });

  it('works on a PHONE, where the HP damage/heal row is gone', () => {
    const r = rail({ mobile: true });
    r.click(r.chip());
    expect(r.editor(), 'the XP editor is offered on the phone layout').toBeTruthy();
    const rows = [...r.host.querySelectorAll('.hp-edit')];
    expect(rows.length, 'and it is the only .hp-edit row on a phone').toBe(1);
    expect(rows[0].className).toContain('xp-rail-edit');
    r.stop();
  });

  it('a read-only sheet shows the number without offering an editor it could not commit', () => {
    const r = rail({ readOnly: true });
    expect(r.chip()!.tagName, 'a span, not a button').toBe('SPAN');
    expect(r.chip()!.textContent).toBe('XP 340');
    r.stop();
  });
});

/*
 * ITEM 9 MUTATION PROOF (each applied once to the working tree, the named legs seen red, then restored):
 *  • VitalsRail.tsx, the chip render `{railXp && xpDisplay !== 'line' && xpChip}` → drop `railXp &&`:
 *    6 legs red, first "on a computer the rail shows no XP (chip)" — `AssertionError: no chip:
 *    expected <button type="button" …(3)></button> to be null`, and the sheet-level "on a computer
 *    the sheet shows the header field and no rail XP".
 *  • VitalsRail.tsx, the line render `{railXp && xpDisplay === 'line' && xpLine}` → drop `railXp &&`:
 *    "on a computer the rail shows no XP (line)" — `AssertionError: no line: expected <button …> to be
 *    null`, and the read-only computer leg.
 *  • VitalsRail.tsx, `const xpEditor = onPlay && railXp && xpOpen && (` → drop `railXp &&`: "closes the
 *    editor and discards the drafts…" — `AssertionError: the first frame off the phone already has no
 *    editor: expected true to be false` (the closing useEffect runs only after that frame).
 *  • VitalsRail.tsx, `useEffect(() => { if (!railXp && xpOpen) cancelXp(); }, [railXp, xpOpen])` →
 *    delete it: the same leg — `AssertionError: the editor stays closed: expected <div class="hp-edit
 *    xp-rail-edit">…(3)</div> to be null`. Replace `cancelXp()` with `applyXpTotal()` (apply instead
 *    of discard): `nothing was written: expected 900 to be 340`, and the removal-blur leg reads 900.
 *  • CharacterSheet.tsx, `{!isMobile && (<div className="level-stack">…)}` → drop `!isMobile &&`:
 *    "on a phone the sheet shows the chip and NO header field" — `AssertionError: no header XP field:
 *    expected <input class="xp-input" …(5)></input> to be null`, plus the read-only leg, both header-draft
 *    legs (the FOCUSED one: `the emulated removal blur fired: expected +0 to be 1`), both "a rail that
 *    mounts late" legs, and the two phone legs of "the sheet's XP count, tab by tab" — `Main: never two:
 *    expected 2 to be less than 2`.
 *  • CharacterSheet.tsx, the rail's `(!isMobile || tab === 'Main')` → `(!isMobile || true)` (the rail on every
 *    phone tab): "on the phone layout: the chip on Main, no XP on any other tab" — `Actions: no rail on
 *    the phone layout, so no XP (as in v0.1.41): expected 1 to be +0`, and the first mounts-late leg.
 *    Changing that is the owner's call; this leg makes the change deliberate, comments and all.
 *  • VitalsRail.tsx, the card filter `!hidden.has(id)` → `!hidden.has(id) || id === 'hp'` (the Hit points
 *    card unhideable): "with the Hit points card hidden…" — `without its Hit points card: expected <div
 *    class="hp-line">…(3)</div> to be null`.
 *  • sheet.css, `.identity .level-stack` put back beside `.identity .tabs` in the 720px block: jsdom
 *    applies no CSS, so no rendering leg here sees it; test/bug-phone-web.test.tsx "no phone rule hides the
 *    header XP field…" fails — `play: hidden on a phone, so a JS/CSS disagreement shows no XP: expected
 *    [ 'level-stack' ] to deeply equal []` — and (third settle) so does "the app's stylesheets name
 *    .level-stack in two rules only…" here — `AssertionError: a new rule naming the header XP field:
 *    re-check the "only WIDTH-based hide" comments: expected [ …(3) ] to deeply equal [ …(2) ]`.
 *  • CampaignTracker.tsx, PcPaneShell keying `.is-narrow` to another value than its ForceMobileContext:
 *    NOT applied (that file is outside the third settle's allowlist). "the instruments see what they guard
 *    against" shows the reader reports such a pane as decoupled ('tiny' vs 'narrow'), which is what fails
 *    "PcPaneShell sets .is-narrow and ForceMobileContext from one boolean".
 *  • CharacterSheet.tsx, `useEffect(() => { if (!isMobile) return; setXpDraft(…); setXpAdd(''); }, [isMobile])`
 *    → delete it: "a number typed in the header field is discarded…" — `AssertionError: and the stale
 *    900 does not come back: expected '900' to be '340'`. Its parts, one at a time (third settle):
 *    deleting `setXpDraft(String(character.xp));` alone fails that leg and the FOCUSED one — `after
 *    widening, the header shows the old value, not the stale 900: expected '900' to be '500'`; deleting
 *    `setXpAdd('');` alone fails only the FOCUSED leg — `and the + XP draft was discarded too: expected
 *    '50' to be ''`; replacing `setXpDraft(…)` with `commitXp();` (apply instead of discard) fails both —
 *    `nothing was written: expected 900 to be 340` and `the typed 900 was not written; the 500 applied
 *    before stands: expected 900 to be 500`.
 *  • CharacterSheet.tsx, the header total's `onBlur={commitXp}` → delete it: the FOCUSED leg's control —
 *    `control: a focusout outside a commit applies the header total: expected 340 to be 500`.
 *  • The FOCUSED leg's "nothing was written" under the removal blur has NO mutation in our code: it holds
 *    because react-dom suppresses its event dispatch during the commit that removes the field. It goes
 *    red only if a React upgrade lets that blur through; its control shows the same event does apply.
 *  • CharacterSheet.tsx, the rail call `<VitalsRail … isMobile={isMobile} />` → drop `isMobile={isMobile}`:
 *    both "a rail that mounts late" legs, with the refuter's two failures exactly — `AssertionError: the
 *    sheet still says phone: exactly one XP: expected +0 to be 1` and `…the sheet still says computer:
 *    exactly one XP: expected 2 to be 1`.
 *  • VitalsRail.tsx, `const isMobile = isMobileFromSheet ?? ownIsMobile;` → `const isMobile = ownIsMobile;`
 *    (the prop accepted and ignored): the same two legs, the same two messages.
 *  • CustomizationEditor.tsx, gating the "XP display" label `isMobile &&` (the Slot-badges shape): both
 *    "the setting" legs — `AssertionError: the control exists: expected undefined to be truthy`.
 */
describe('on a computer the rail shows no XP — XP is the header field, top right (item 9)', () => {
  for (const xpDisplay of [undefined, 'chip', 'line'] as const) {
    it(`on a computer the rail shows no XP (${xpDisplay ?? 'absent setting'})`, () => {
      const r = rail({ mobile: false, xpDisplay });
      // The card itself is there — the absence below is the gate, not a missing card.
      expect(r.host.querySelector('.hp-line'), 'the Hit points card rendered').toBeTruthy();
      expect(r.chip(), 'no chip').toBeNull();
      expect(r.line(), 'no line').toBeNull();
      expect(r.fill(), 'no bar').toBeNull();
      expect(r.editor(), 'no editor').toBeNull();
      r.stop();
    });
  }

  it('a read-only sheet on a computer shows no rail XP either, in either look', () => {
    for (const xpDisplay of ['chip', 'line'] as const) {
      const r = rail({ mobile: false, readOnly: true, xpDisplay });
      expect(r.host.querySelector('.hp-line'), 'the Hit points card rendered').toBeTruthy();
      expect(r.chip(), `${xpDisplay}: no chip span`).toBeNull();
      expect(r.line(), `${xpDisplay}: no line span`).toBeNull();
      r.stop();
    }
  });
});

/** The whole sheet, wired the way App.tsx does it (onPlay updates the ledger), with a switchable
 *  layout. A synthetic level-5 fighter on 340 XP. `mobile: null` forces nothing: every useIsMobile
 *  below asks the window (matchMedia), exactly as in App.tsx where no ForceMobileContext is set.
 *  `custom` is laid over the defaults the way a saved Customize choice is. */
function sheet(opts: { mobile: boolean | null; readOnly?: boolean; custom?: Partial<Customization> }) {
  try {
    localStorage.removeItem('wanderers-codex:tab:v1'); // open on Main, where the phone shows the rail
  } catch {
    // no storage: the sheet opens on Main anyway
  }
  const base = { ...build('fighter', 5), xp: 340 } as Character;
  const seen = { xp: -1 };
  const custom: Customization = { ...DEFAULT_CUSTOMIZATION, ...opts.custom };
  let setMobile: (m: boolean | null) => void = () => undefined;
  function Harness() {
    const [mobile, set] = useState<boolean | null>(opts.mobile);
    const [play, setPlay] = useState(() => initialPlay(base, db));
    setMobile = set;
    seen.xp = play.xp;
    return (
      <ForceMobileContext.Provider value={mobile}>
        <CustomizationContext.Provider value={custom}>
          <CharacterSheet
            character={applyPlayState(base, play, db)}
            content={db}
            charKey="xp-test"
            readOnly={opts.readOnly}
            onPlay={opts.readOnly ? undefined : (fn) => setPlay((p) => fn(p))}
          />
        </CustomizationContext.Provider>
      </ForceMobileContext.Provider>
    );
  }
  const r = renderDom(<Harness />);
  const q = <T extends Element>(sel: string) => r.host.querySelector(sel) as T | null;
  return {
    ...r,
    seen,
    layout: (m: boolean | null) =>
      act(() => {
        setMobile(m);
      }),
    header: () => q<HTMLInputElement>('.identity input[aria-label="Experience points"]'),
    headerAdd: () => q<HTMLInputElement>('.identity input[aria-label="Experience points to add"]'),
    levelStack: () => q<HTMLElement>('.identity .level-stack'),
    chip: () => q<HTMLElement>('.xp-chip'),
    line: () => q<HTMLElement>('.xp-rail-line'),
    rail: () => q<HTMLElement>('.hp-line'),
    /** Every XP surface the sheet has on screen: the header field (or its read-only number), the
     *  rail chip, the rail line. Item 9's promise is that this is never 2 — and 1 on a computer, and on
     *  the phone layout wherever the rail's Hit points card is on screen (see the header). */
    xpSurfaces: () => r.host.querySelectorAll('.identity .level-stack, .xp-chip, .xp-rail-line').length,
    /** Press a tab the way a player does: the phone's bottom bar, or the computer's tab strip. */
    phoneTab: (label: string) =>
      r.click([...r.host.querySelectorAll('.mtabs .mtab')].find((b) => b.textContent === label) ?? null),
    computerTab: (label: string) =>
      r.click([...r.host.querySelectorAll('.identity .tabs .tab')].find((b) => b.textContent === label) ?? null),
    /** The labels of every tab the layout offers right now (the computer strip's Party action is not a tab). */
    phoneTabs: () => [...r.host.querySelectorAll('.mtabs .mtab')].map((b) => b.textContent ?? ''),
    computerTabs: () =>
      [...r.host.querySelectorAll('.identity .tabs .tab:not(.party-tab)')].map((b) => b.textContent ?? ''),
  };
}

/**
 * A matchMedia whose 720px answer the test moves by hand and whose change event it delivers when it
 * chooses — so a leg can stand in the moment between the window crossing 720px and React hearing of it.
 * Any other query answers false (the _render.tsx default). Caller must `restore()`.
 */
function widthStub(narrow: boolean) {
  const PHONE = '(max-width: 720px)';
  const saved = window.matchMedia;
  let now = narrow;
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === PHONE && now;
    },
    media: query,
    onchange: null,
    addListener: (fn: (e: MediaQueryListEvent) => void) => {
      if (query === PHONE) listeners.add(fn);
    },
    removeListener: (fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    addEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => {
      if (query === PHONE) listeners.add(fn);
    },
    removeEventListener: (_type: string, fn: (e: MediaQueryListEvent) => void) => listeners.delete(fn),
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return {
    /** The window crosses 720px. Nothing has heard it yet: only a FRESH matchMedia read sees it. */
    resize: (n: boolean) => {
      now = n;
    },
    /** …and now the change event reaches every listener (every mounted useIsMobile). */
    deliver: () =>
      act(() => {
        for (const fn of [...listeners]) fn({ matches: now, media: PHONE } as MediaQueryListEvent);
      }),
    restore: () => {
      window.matchMedia = saved;
    },
  };
}

describe('one useIsMobile answer decides both halves — never two XP, one wherever the Hit points card is shown (item 9)', () => {
  it('on a computer the sheet shows the header field and no rail XP', () => {
    const r = sheet({ mobile: false });
    expect(r.header(), 'the header XP field, top right').toBeTruthy();
    expect(r.header()!.value).toBe('340');
    expect(r.rail(), 'the vitals rail is on screen').toBeTruthy();
    expect(r.chip(), 'and carries no chip').toBeNull();
    expect(r.line(), 'and no line').toBeNull();
    r.stop();
  });

  it('on a phone the sheet shows the chip and NO header field', () => {
    const r = sheet({ mobile: true });
    expect(r.chip(), 'the rail chip').toBeTruthy();
    expect(r.chip()!.textContent).toBe('XP 340');
    expect(r.header(), 'no header XP field').toBeNull();
    expect(r.levelStack(), 'the header XP block is not rendered at all').toBeNull();
    r.stop();
  });

  it('read-only: the computer shows the header number, the phone the chip — never both', () => {
    const pc = sheet({ mobile: false, readOnly: true });
    expect(pc.levelStack()!.textContent).toBe('340 xp');
    expect(pc.chip()).toBeNull();
    pc.stop();
    const phone = sheet({ mobile: true, readOnly: true });
    expect(phone.levelStack()).toBeNull();
    expect(phone.chip()!.tagName, 'a span, not a button').toBe('SPAN');
    phone.stop();
  });

  it('a number typed in the header field is discarded when the window narrows to the phone layout', () => {
    const r = sheet({ mobile: false });
    type(r.header(), '900'); // typed, never applied (no Enter, no blur)
    r.layout(true);
    expect(r.header(), 'the header field is gone on the phone layout').toBeNull();
    expect(r.seen.xp, 'nothing was written').toBe(340);
    r.layout(false);
    expect(r.header()!.value, 'and the stale 900 does not come back').toBe('340');
    expect(r.seen.xp).toBe(340);
    r.stop();
  });

  /*
   * The leg above types into a field that never had focus, which a player cannot do: in a browser a
   * number typed into the header total stays unapplied only while focus is in it, because leaving the
   * field applies it (CharacterSheet's onBlur={commitXp}). So the case a player reaches is the field
   * FOCUSED as the window narrows — and some browsers fire blur on a focused field as it is removed,
   * a blur that would turn the discard into a write. It cannot today: react-dom turns its own event
   * dispatch off for the length of a commit (prepareForCommit → setEnabled(false)), and the `!isMobile`
   * gate removes the field inside the commit where the layout changes. This leg emulates that removal
   * blur (the second settle's refuter, probe P1) and pins it.
   *
   * NO LINE OF OURS is the mutation for "nothing was written": React suppresses the blur during the
   * commit, and this leg fails only if a React upgrade lets it through. So it carries its own control —
   * the very same event fired OUTSIDE a commit does apply the total. Lines of ours it DOES catch (each
   * tried, see the MUTATION PROOF block above "on a computer the rail shows no XP"): the `!isMobile` gate
   * (the field is never removed, so no blur fires), the narrowing effect's `setXpDraft(…)` (the stale
   * 900 comes back) and its `setXpAdd('')` (the + XP draft comes back), and `onBlur={commitXp}` (the
   * control applies nothing).
   */
  it('a blur fired while the FOCUSED header field is removed writes nothing, and the drafts do not come back', () => {
    const r = sheet({ mobile: false });
    const field = r.header()!;
    act(() => {
      field.focus();
    });
    expect(document.activeElement, 'the header total has focus').toBe(field);
    // Control: this event shape does reach the header's apply-on-blur.
    type(field, '500');
    act(() => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(r.seen.xp, 'control: a focusout outside a commit applies the header total').toBe(500);

    type(r.headerAdd(), '50'); // typed, never applied (+ XP applies on Enter or Add only)
    type(field, '900'); // typed, never applied: focus is still in the total
    expect(document.activeElement, 'focus is still in the header total').toBe(field);
    const realRemove = Node.prototype.removeChild;
    let fired = 0;
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
      const active = document.activeElement;
      if (active && child.contains(active) && active.isConnected) {
        fired++;
        active.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      }
      return realRemove.call(this, child) as T;
    };
    try {
      r.layout(true); // 720px or narrower: the phone layout
    } finally {
      Node.prototype.removeChild = realRemove;
    }
    expect(fired, 'the emulated removal blur fired').toBe(1);
    expect(r.header(), 'the header field is gone on the phone layout').toBeNull();
    expect(r.seen.xp, 'the typed 900 was not written; the 500 applied before stands').toBe(500);

    r.layout(false);
    expect(r.header()!.value, 'after widening, the header shows the old value, not the stale 900').toBe('500');
    expect(r.headerAdd()!.value, 'and the + XP draft was discarded too').toBe('');
    expect(r.seen.xp).toBe(500);
    r.stop();
  });

  /*
   * The two legs below force nothing (no ForceMobileContext): every useIsMobile asks the window, as on a
   * real device. The rail mounts again AFTER the window crossed 720px but BEFORE the change event
   * reached the sheet — the moment a second hook instance would read the new width fresh while the
   * sheet still held the old one. The rail must take the sheet's answer, so the count is 1 throughout.
   */
  it('a rail that mounts late takes the sheet\'s answer — the sheet on a phone, the window already wider', () => {
    const w = widthStub(true);
    try {
      const r = sheet({ mobile: null });
      expect(r.xpSurfaces(), 'phone, Main: one XP').toBe(1);
      expect(r.chip(), 'the chip').toBeTruthy();

      w.resize(false); // a phone turned sideways past 720px; the sheet has not heard yet
      expect(r.xpSurfaces(), 'nothing re-rendered: still one XP').toBe(1);
      // The phone layout carries the rail on Main only (as in v0.1.41), so leaving Main and coming back
      // is how the rail mounts again. This step is the unmount, not an XP state to count.
      r.phoneTab('Details');
      expect(r.rail(), 'off Main the phone layout has no rail, so it unmounted').toBeNull();
      r.phoneTab('Main');
      expect(r.rail(), 'the rail mounted again, after the width moved').toBeTruthy();
      expect(r.xpSurfaces(), 'the sheet still says phone: exactly one XP').toBe(1);
      expect(r.chip(), 'and it is the chip').toBeTruthy();
      expect(r.levelStack(), 'not the header field').toBeNull();

      w.deliver(); // the change event lands
      expect(r.xpSurfaces(), 'the computer layout: exactly one XP').toBe(1);
      expect(r.levelStack(), 'now the header field').toBeTruthy();
      expect(r.chip(), 'and no chip').toBeNull();
      r.stop();
    } finally {
      w.restore();
    }
  });

  it('…and the other way — the sheet on a computer, the window already 720px or narrower', () => {
    const w = widthStub(false);
    try {
      const r = sheet({ mobile: null });
      expect(r.xpSurfaces(), 'computer, Main: one XP').toBe(1);
      expect(r.levelStack(), 'the header field').toBeTruthy();

      w.resize(true); // the window narrowed to 720px or less; the sheet has not heard yet
      expect(r.xpSurfaces(), 'nothing re-rendered: still one XP').toBe(1);
      // On a computer the rail leaves only for Notes; going there and back mounts it again.
      r.computerTab('Notes');
      expect(r.rail(), 'Notes has no rail, so it unmounted').toBeNull();
      expect(r.xpSurfaces(), 'Notes: the header field alone, one XP').toBe(1);
      r.computerTab('Main');
      expect(r.rail(), 'the rail mounted again, after the width moved').toBeTruthy();
      expect(r.xpSurfaces(), 'the sheet still says computer: exactly one XP').toBe(1);
      expect(r.chip(), 'no chip beside the header field').toBeNull();

      w.deliver(); // the change event lands
      expect(r.xpSurfaces(), 'the phone layout: exactly one XP').toBe(1);
      expect(r.chip(), 'now the chip').toBeTruthy();
      expect(r.levelStack(), 'and no header field').toBeNull();
      r.stop();
    } finally {
      w.restore();
    }
  });
});

/*
 * What the comments may promise, and no more (item 9, second settle). "The sheet renders exactly one XP"
 * was written in the sheet, the rail and this file, and it was false on the phone layout off the Main
 * tab and with the Hit points card hidden — v0.1.41 behaviour that item 9 did not change. These legs walk
 * every tab each layout offers and COUNT, so the sentence in the header above is read off the sheet.
 * Mutations (each applied once, the leg seen red, then restored): see the block above
 * "on a computer the rail shows no XP".
 */
describe("the sheet's XP count, tab by tab (item 9)", () => {
  it('on a computer: the header field on every tab, and never a second XP', () => {
    const r = sheet({ mobile: false });
    const tabs = r.computerTabs();
    expect(tabs, 'fixture: the strip offers Notes, the one tab the rail leaves').toContain('Notes');
    for (const t of tabs) {
      r.computerTab(t);
      expect(r.xpSurfaces(), `${t}: exactly one XP`).toBe(1);
      expect(r.levelStack(), `${t}: and it is the header field`).toBeTruthy();
    }
    r.stop();
  });

  it('on the phone layout: the chip on Main, no XP on any other tab — never two', () => {
    const r = sheet({ mobile: true });
    const tabs = r.phoneTabs();
    expect(tabs, 'fixture: the bottom bar offers Main').toContain('Main');
    expect(tabs.length, 'fixture: and other tabs besides').toBeGreaterThan(1);
    for (const t of tabs) {
      r.phoneTab(t);
      const n = r.xpSurfaces();
      expect(n, `${t}: never two`).toBeLessThan(2);
      expect(n, t === 'Main' ? 'Main: the chip' : `${t}: no rail on the phone layout, so no XP (as in v0.1.41)`).toBe(
        t === 'Main' ? 1 : 0,
      );
      expect(!!r.rail(), `${t}: the Hit points card is on screen exactly where XP is`).toBe(n === 1);
      expect(r.levelStack(), `${t}: never the header field`).toBeNull();
    }
    r.stop();
  });

  it('with the Hit points card hidden: the computer keeps its header field, the phone layout has no XP', () => {
    const pc = sheet({ mobile: false, custom: { railHidden: ['hp'] } });
    expect(pc.host.querySelector('aside.rail'), 'the rail is there').toBeTruthy();
    expect(pc.rail(), 'without its Hit points card').toBeNull();
    expect(pc.xpSurfaces(), 'computer: one XP').toBe(1);
    expect(pc.levelStack(), 'the header field').toBeTruthy();
    pc.stop();

    const phone = sheet({ mobile: true, custom: { railHidden: ['hp'] } });
    expect(phone.host.querySelector('aside.rail'), 'the rail is there, on Main').toBeTruthy();
    expect(phone.rail(), 'without its Hit points card').toBeNull();
    expect(phone.xpSurfaces(), 'phone layout: the card that carries XP is hidden, so no XP (as in v0.1.41)').toBe(0);
    phone.stop();
  });
});

describe('turning the phone sideways mid-edit (item 9)', () => {
  it('closes the editor and discards the drafts — nothing was written, and they do not come back', () => {
    const r = rail();
    r.click(r.chip());
    type(r.total(), '900');
    type(r.add(), '50');
    r.layout(false); // wider than 720px: the computer layout
    const off = r.frames[r.frames.length - 1];
    expect(off.mobile).toBe(false);
    expect(off.editor, 'the first frame off the phone already has no editor').toBe(false);
    expect(off.chip, 'nor a chip').toBe(false);
    expect(r.editor()).toBeNull();
    expect(r.xp(), 'nothing was written').toBe(340);

    r.layout(true); // back to the phone
    expect(r.editor(), 'the editor stays closed').toBeNull();
    expect(r.chip(), 'the chip is back').toBeTruthy();
    r.click(r.chip());
    expect(r.total()!.value, 'the typed 900 was discarded').toBe('340');
    expect(r.add()!.value, 'and so was the add').toBe('');
    expect(r.xp()).toBe(340);
    r.stop();
  });

  /*
   * Whether a browser fires blur on a focused field that is REMOVED is not the same everywhere
   * (Chromium, the Android WebView and WebView2 included, has done so). The Total field applies on
   * blur by design, so such a blur reaching it would turn the discard above into a write. It cannot:
   * react-dom turns its own event dispatch off for the length of a commit (prepareForCommit →
   * setEnabled(false)), and the railXp gate removes the editor inside the commit where the layout
   * changes. This leg emulates the removal blur and pins that. No line of ours is its mutation — it
   * fails if a React upgrade lets that blur through — so it carries its own control: the very same
   * event fired OUTSIDE a commit does apply.
   */
  it('a blur fired while the focused Total field is removed writes nothing', () => {
    const r = rail();
    r.click(r.chip());
    // Control: this event shape does reach apply-on-blur.
    type(r.total(), '500');
    act(() => {
      r.total()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(r.xp(), 'control: a focusout outside a commit applies the Total').toBe(500);
    expect(r.editor(), 'and blur leaves the editor open').toBeTruthy();

    type(r.total(), '900');
    act(() => {
      r.total()!.focus();
    });
    expect(document.activeElement, 'the Total field has focus').toBe(r.total());
    const realRemove = Node.prototype.removeChild;
    let fired = 0;
    Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
      const active = document.activeElement;
      if (active && child.contains(active) && active.isConnected) {
        fired++;
        active.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      }
      return realRemove.call(this, child) as T;
    };
    try {
      r.layout(false);
    } finally {
      Node.prototype.removeChild = realRemove;
    }
    expect(fired, 'the emulated removal blur fired').toBe(1);
    expect(r.editor()).toBeNull();
    expect(r.xp(), 'the typed 900 was not written; the 500 applied before stands').toBe(500);
    r.stop();
  });
});

/*
 * What the comments say about the one CSS rule left that names the header XP field (item 9, third
 * settle). CharacterSheet's `!isMobile` gate is the field's only WIDTH-based hide; sheet.css's 720px
 * block no longer names it (test/bug-phone-web.test.tsx pins that by resolving the cascade). The
 * tracker's campaign-tracker.css still has `.ct-pc-pane.is-narrow .identity .level-stack { display:
 * none }`, and the sheet's, sheet.css's and this file's comments call it harmless because PcPaneShell
 * (CampaignTracker.tsx) sets `.is-narrow` and ForceMobileContext from the SAME `narrow` boolean — so the
 * rule can only match a pane where ForceMobileContext has already made the sheet's isMobile true and the
 * gate has removed the field ("on a phone the sheet shows the chip and NO header field" is that half).
 * PcPaneShell is not exported and mounts only inside the whole tracker, so these legs read the two
 * sources as text, as test/bug-phone-web.test.tsx does for the tracker's GlobalSearch. They go red —
 * sending whoever changed it back to those comments — when a new rule in any of the app's stylesheets
 * names .level-stack, or when PcPaneShell keys `.is-narrow` and ForceMobileContext to different values.
 * Each instrument also gets a leg showing it sees the change it guards against.
 */
describe('the one CSS rule left that names the header XP field cannot disagree with the JS gate (item 9)', () => {
  const root = path.join(__dirname, '..');
  const read = (rel: string) => readFileSync(path.join(root, ...rel.split('/')), 'utf8');
  /** Every selector in a stylesheet, comments stripped (an @media prelude comes along; it names no class). */
  const selectors = (css: string) =>
    [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{};]+)\{/g)].flatMap((m) =>
      m[1].split(',').map((s) => s.trim()),
    );
  const namingLevelStack = (css: string) => selectors(css).filter((s) => /(^|[^\w-])level-stack($|[^\w-])/.test(s));
  /** The values PcPaneShell keys ForceMobileContext and `.is-narrow` to, or null where it no longer
   *  reads `value={X ? true : null}` / `'ct-pc-pane' + (Y ? ' is-narrow' : '')`. */
  const paneKeys = (src: string) => {
    const at = src.indexOf('function PcPaneShell(');
    if (at < 0) return null;
    const rest = src.slice(at);
    const end = rest.search(/\r?\n\}\r?\n/);
    const body = end < 0 ? rest : rest.slice(0, end);
    const forced = /<ForceMobileContext\.Provider\s+value=\{\s*(\w+)\s*\?\s*true\s*:\s*null\s*\}\s*>/.exec(body);
    const narrow = /'ct-pc-pane'\s*\+\s*\(\s*(\w+)\s*\?\s*' is-narrow'\s*:\s*''\s*\)/.exec(body);
    return { forced: forced?.[1] ?? null, narrow: narrow?.[1] ?? null };
  };

  it("the app's stylesheets name .level-stack in two rules only: its own style, and the narrow-pane twin", () => {
    const files = [
      ...readdirSync(path.join(root, 'src'), { recursive: true })
        .map(String)
        .filter((f) => f.endsWith('.css'))
        .map((f) => 'src/' + f.split(path.sep).join('/')),
      // The tracker's styles inside the app are this pre-built file.
      'tracker/dist-css/tracker.scoped.css',
    ];
    expect(files, 'fixture: the sheet and the seam stylesheets are read').toEqual(
      expect.arrayContaining(['src/sheet.css', 'src/integration/campaign-tracker.css']),
    );
    const naming = files.flatMap((f) => namingLevelStack(read(f)).map((s) => `${f}: ${s}`)).sort();
    expect(naming, 'a new rule naming the header XP field: re-check the "only WIDTH-based hide" comments').toEqual(
      ['src/integration/campaign-tracker.css: .ct-pc-pane.is-narrow .identity .level-stack', 'src/sheet.css: .level-stack'],
    );
  });

  it('PcPaneShell sets .is-narrow and ForceMobileContext from one boolean', () => {
    const keys = paneKeys(read('src/integration/CampaignTracker.tsx'));
    expect(keys, 'fixture: PcPaneShell is where a narrow PC pane is built').toBeTruthy();
    expect(keys!.forced, 'it forces the phone layout from a boolean, and defers to the window otherwise').toBeTruthy();
    expect(keys!.narrow, 'it sets .is-narrow from a boolean').toBeTruthy();
    expect(keys!.narrow, '.is-narrow and ForceMobileContext answer the same question').toBe(keys!.forced);
  });

  it('the instruments see what they guard against', () => {
    // A hide added beside the tab strip in a phone block, the shape item 9 took out of sheet.css.
    const phoneHide = '@media (max-width: 720px) { .identity .tabs, .identity .level-stack { display: none; } }';
    expect(namingLevelStack(phoneHide), 'a phone-block hide is seen').toEqual(['.identity .level-stack']);
    const lookalikes = '.level-stacked, .my-level-stack-x { color: red; }';
    expect(namingLevelStack(lookalikes), 'a longer class name is not the field').toEqual([]);
    // A pane whose class and context answer different questions.
    const decoupled = [
      'function PcPaneShell() {',
      '  return (',
      "    <ForceMobileContext.Provider value={narrow ? true : null}>",
      "      <div ref={ref} className={'ct-pc-pane' + (tiny ? ' is-narrow' : '')}>",
      '  );',
      '}',
      '',
    ].join('\n');
    const keys = paneKeys(decoupled)!;
    expect(keys.forced).toBe('narrow');
    expect(keys.narrow, 'the decoupled pane reads as decoupled').toBe('tiny');
  });
});

describe('the setting', () => {
  it('offers both options, with the chip lit when nothing is saved', () => {
    const changes: [string, unknown][] = [];
    const r = renderDom(
      <CustomizationEditor
        value={{}}
        base={DEFAULT_CUSTOMIZATION}
        scope="character"
        onChange={(k, v) => changes.push([k as string, v])}
      />,
    );
    const label = [...r.host.querySelectorAll('.menu-label')].find((l) => l.textContent === 'XP display');
    expect(label, 'the control exists').toBeTruthy();
    const chips = [...label!.nextElementSibling!.querySelectorAll('button')];
    expect(chips.map((c) => c.textContent)).toEqual(['Chip in the title', 'Line with a bar']);
    expect(chips[0].className, 'the chip option is the default').toContain('active');
    r.click(chips[1]);
    expect(changes).toEqual([['xpDisplay', 'line']]);
    r.stop();
  });

  it('is offered on a computer too, and says it is the phone look (XP stays top right there)', () => {
    // This leg renders the editor with the desktop matchMedia stub — the control must not be gated
    // `isMobile &&`: the value is per character and synced, so a player at a PC sets his phone look.
    const r = renderDom(
      <CustomizationEditor value={{}} base={DEFAULT_CUSTOMIZATION} scope="character" onChange={() => undefined} />,
    );
    const label = [...r.host.querySelectorAll('.menu-label')].find((l) => l.textContent === 'XP display');
    expect(label, 'the control exists on a computer').toBeTruthy();
    const desc = label!.nextElementSibling!.nextElementSibling!;
    expect(desc.className).toContain('settings-desc');
    expect(desc.textContent).toContain('phone');
    expect(desc.textContent).toContain('On a computer XP stays in the top bar beside the tabs');
    expect(desc.textContent, 'the old promise is gone').not.toContain('on the phone too');
    r.stop();
  });
});
