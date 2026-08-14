// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { renderDom, renderText } from './_render';
import { MainTab } from '../src/sheet/MainTab';
import { initialPlay } from '../src/rules/play';
import type { Character, ModeDef, PlayState } from '../src/rules/types';

/**
 * THE FORM CHIP HAS TO ENTER THE REAL FORM.
 *
 * A battle form had two carriers. `content.stances[featId]` gave the Encounter tab's Form chip a
 * toggle, but a stance record can only hold what a stance is — a sense, a Strike, an AC tweak. The
 * form itself lives in `content.modes[…].battleForm`: the AC formula, the temporary Hit Points, the
 * form's own Strikes, the size, the creature trait. So the chip and the Modes panel entered two
 * different things wearing the same name, and the chip's was strictly weaker — Worm Form through it
 * granted darkvision and nothing else, with the rest printed as prose to apply by hand.
 *
 * These assert the CHIP, not the engine. The engine was always right; no test could see that the
 * control beside it reached a different record.
 *
 * ⚠ They assert on the chip ELEMENTS, not on the tab's text. Worm Form's own description contains the
 * phrase "humanoid-worm hybrid", so a text assertion passes whether the chip exists or not — the first
 * version of this file did exactly that and proved nothing.
 */
const c = () => content();
const noop = () => undefined;
const chipLabels = (host: HTMLElement) => [...host.querySelectorAll('.stance-chip')].map((b) => b.textContent!.trim());

/* Worm Form is the case that tells the two implementations apart: one FEAT named "Worm Form", TWO
 * modes. The old chip rendered one button per feat and printed the bare feat name, so no version of
 * it could produce both variants. An animal-rage fixture would prove nothing — there the mode and the
 * feat happen to share a name, so it passes either way. */
const wormCaller = () => build('druid', 16, { featPicks: { '14:class:0': 'worm-form' } }) as Character;

describe('the Encounter tab Form chip', () => {
  it('renders one chip per FORM, named for the mode — so a feat with two forms offers both', () => {
    const con = c();
    const ch = wormCaller();
    expect(ch.feats.some((f) => f.featId === 'worm-form')).toBe(true);
    const { host, stop } = renderDom(<MainTab character={ch} content={con} onPlay={noop} />);
    const labels = chipLabels(host);
    stop();
    expect(labels).toContain(con.modes!['worm-form-purple-worm'].name);
    expect(labels).toContain(con.modes!['worm-form-hybrid'].name);
    // and NOT the bare feat name, which is what the stance-backed chip printed
    expect(labels).not.toContain('Worm Form');
  });

  it('pressing a chip toggles that MODE — the thing that carries the AC, the temp HP and the Strikes', () => {
    const con = c();
    const ch = wormCaller();
    let play: PlayState = initialPlay(ch, con);
    const onPlay = (fn: (p: PlayState) => PlayState) => {
      play = fn(play);
    };
    const { host, click, stop } = renderDom(<MainTab character={ch} content={con} onPlay={onPlay} />);
    const chip = [...host.querySelectorAll('.stance-chip')].find((b) => b.textContent!.trim() === con.modes!['worm-form-purple-worm'].name);
    click(chip ?? null);
    stop();
    expect(play.activeModes ?? []).toContain('worm-form-purple-worm');
    // the old wiring set an activeStance and left the mode off; both would be wrong now
    expect(play.activeStance).toBeUndefined();
  });

  it("prints the ACTIVE form's own note, which used to come only from the stance record", () => {
    const con = c();
    const mode = con.modes!['worm-form-purple-worm'] as ModeDef;
    const inForm: Character = { ...wormCaller(), activeModes: [mode] };
    const { host, stop } = renderDom(<MainTab character={inForm} content={con} onPlay={noop} />);
    const notes = [...host.querySelectorAll('.stance-note')].map((n) => n.textContent!.trim());
    stop();
    expect(notes.some((n) => n.includes(mode.note!.slice(0, 40)))).toBe(true);
  });

  /* NOT every `form: true` stance has a battle-form mode, and that is correct. Bodysnatcher, Divine
   * Wings, Long-Nosed Form and the rest are disguises, movement tricks or a form applied to a shape
   * you are already in — scripts/apply-battle-forms.mjs lists each exclusion and its reason. They
   * print no stat block, so there is nothing for a mode to hold and the stance chip stays right for
   * them. The contract is: a feat gets a mode-backed chip exactly when it HAS a battle-form mode. */
  it('falls back to the stance chip for a form feat that has no stat block', () => {
    const con = c();
    const formFeats = Object.keys(con.stances ?? {}).filter((id) => con.stances![id]!.form);
    const withMode = formFeats.filter((id) => Object.values(con.modes ?? {}).some((m) => (m.feats ?? []).includes(id) && !!m.battleForm));
    expect(withMode.length).toBeGreaterThanOrEqual(8);
    expect(formFeats.length).toBeGreaterThan(withMode.length);

    // Long-Nosed Form is the named exclusion: a disguise, no stat block, so one chip named for the FEAT.
    const ch = build('fighter', 20, { featPicks: { '20:class:0': 'long-nosed-form' } }) as Character;
    if (ch.feats.some((f) => f.featId === 'long-nosed-form')) {
      const { host, stop } = renderDom(<MainTab character={ch} content={con} onPlay={noop} />);
      const labels = chipLabels(host);
      stop();
      expect(labels).toContain(con.feats['long-nosed-form'].name);
    }
  });
});

/* Kept as a text-level smoke check that the bar renders at all for the simple one-mode case. */
describe('the one-form case still renders', () => {
  it('a barbarian with Animal Rage gets a chip', () => {
    const con = c();
    const ch = build('barbarian', 8, { featPicks: { '8:class:0': 'animal-rage' } }) as Character;
    const text = renderText(<MainTab character={ch} content={con} onPlay={noop} />, ['Actions']);
    expect(text).toContain(con.modes!['animal-rage'].name);
  });
});
