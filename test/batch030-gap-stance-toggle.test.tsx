// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { content, build } from './_content';
import { renderDom } from './_render';
import { MainTab } from '../src/sheet/MainTab';
import { initialPlay } from '../src/rules/play';
import type { Character, PlayState } from '../src/rules/types';

/**
 * A STANCE THAT IS NOT A FEAT STILL HAS TO BE ENTERABLE.
 *
 * Five of the 129 stances carry no feat record — arcane-cascade, bullet-dancer-stance, claw-stance,
 * talon-stance, tenacious-stance. They live in `content.actions` and reach the character through
 * `grantsActions` on their granter. The Encounter tab's stance bar was sourced from
 * `character.feats` alone, so nothing could ever put those ids into `Character.activeStance`, and
 * every effect keyed on one of them was dead code.
 *
 * The case that shows it: Unshaken in Iron prints *"While in Tenacious Stance, you increase the
 * value of your armor specialization effects by an amount equal to the value of your armor check
 * penalty (adding +3 to the resistance while wearing plate armors, for example)."* The data
 * (`feats/unshaken-in-iron.armorSpec.bonusWhileStance`) and its reader (derive.ts, the
 * `c.activeStance === a.bonusWhileStance.stanceId` guard) were both already correct — the guard was
 * simply unreachable, because the control that sets `activeStance` could not name the stance.
 *
 * These assert the CHIP ELEMENTS, not the tab's text: "Tenacious Stance" appears in the granted
 * action's own description, so a text assertion passes whether the toggle exists or not.
 */
const c = () => content();
const noop = () => undefined;
const chipLabels = (host: HTMLElement) => [...host.querySelectorAll('.stance-chip')].map((b) => b.textContent!.trim());

/** Stalwart Defender Dedication is the only route to Tenacious Stance: it grants the action. */
const defender = () => build('fighter', 8, { featPicks: { '2:class:0': 'stalwart-defender-dedication' } }) as Character;

describe('unshaken-in-iron: entering a stance that has no feat record', () => {
  // batch 030: unshaken-in-iron#stance
  it('unshaken-in-iron names a stance that exists only in the actions bucket', () => {
    const con = c();
    expect(con.feats['unshaken-in-iron'].armorSpec?.bonusWhileStance?.stanceId).toBe('tenacious-stance');
    expect(con.feats['tenacious-stance']).toBeUndefined();
    expect(con.stances!['tenacious-stance']).toBeTruthy();
    expect(con.feats['stalwart-defender-dedication'].grantsActions).toContain('tenacious-stance');
  });

  // batch 030: unshaken-in-iron#stance
  it('unshaken-in-iron: a Stalwart Defender gets a Tenacious Stance chip', () => {
    const con = c();
    const ch = defender();
    expect(ch.feats.some((f) => f.featId === 'stalwart-defender-dedication')).toBe(true);
    const { host, stop } = renderDom(<MainTab character={ch} content={con} onPlay={noop} />);
    const labels = chipLabels(host);
    stop();
    expect(labels).toContain(con.actions['tenacious-stance'].name);
  });

  // batch 030: unshaken-in-iron#stance
  it('unshaken-in-iron: pressing the chip sets activeStance, which is what the armorSpec guard reads', () => {
    const con = c();
    const ch = defender();
    let play: PlayState = initialPlay(ch, con);
    const onPlay = (fn: (p: PlayState) => PlayState) => {
      play = fn(play);
    };
    const { host, click, stop } = renderDom(<MainTab character={ch} content={con} onPlay={onPlay} />);
    const chip = [...host.querySelectorAll('.stance-chip')].find((b) => b.textContent!.trim() === con.actions['tenacious-stance'].name);
    click(chip ?? null);
    stop();
    expect(play.activeStance).toBe('tenacious-stance');
  });

  /* The other four are the same defect, so they are pinned as a class rather than one fixture each:
   * every stance with a `stance` trait and no feat record must be reachable through some record's
   * `grantsActions`, or the toggle can never be built for it. */
  // batch 030: unshaken-in-iron#stance
  it('unshaken-in-iron: every featless stance is reached through grantsActions', () => {
    const con = c();
    const featless = Object.keys(con.stances ?? {}).filter((id) => !con.feats[id] && con.actions[id]);
    expect(featless.sort()).toEqual(['arcane-cascade', 'bullet-dancer-stance', 'claw-stance', 'talon-stance', 'tenacious-stance']);
    const granted = new Set<string>();
    for (const bucket of [con.feats, con.classFeatures] as Record<string, { grantsActions?: string[] }>[])
      for (const r of Object.values(bucket)) for (const id of r.grantsActions ?? []) granted.add(id);
    expect(featless.filter((id) => !granted.has(id))).toEqual([]);
  });
});
