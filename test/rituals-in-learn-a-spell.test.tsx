// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { renderDom } from './_render';
import { SpellsTab } from '../src/sheet/SpellsTab';
import { initialPlay } from '../src/rules/play';
import type { PlayState } from '../src/rules/play';
import type { Character } from '../src/rules/types';

/*
 * Owner, 2026-09-02, two decisions about the Spells tab's Rituals section:
 *   1. "the ritual section doesn't need a Learn a ritual button because the user will use Learn a
 *      spell to learn a ritual"
 *   2. "if the character doesn't have any rituals then don't have a ritual section — if it's empty
 *      there isn't a point"
 *
 * Before this, the section rendered for every in-play character purely to host its own "Learn a
 * ritual" button and picker — an empty card on the page of every caster who has no ritual. Rituals
 * are tradition-less by rule, so the Learn a spell picker (which offers the entry's tradition) never
 * listed one, which is why the second button existed at all.
 */

const c = () => content();
const noop = () => undefined;

/** Section headers on the page, which is where a "Rituals" card announces itself. */
const sections = (host: HTMLElement) => [...host.querySelectorAll('.ct')].map((n) => (n.textContent ?? '').trim());
const byText = (host: HTMLElement, sel: string, text: string) =>
  [...host.querySelectorAll(sel)].find((n) => (n.textContent ?? '').trim() === text) ?? null;

describe('rituals are learned from Learn a spell', () => {
  it('a caster with no rituals has no Rituals section, learns one from Learn a spell, and then has one', () => {
    const con = c();
    const ch = build('wizard', 6); // spellbook caster → Learn a Spell means something (canLearnSpells)
    expect(ch.knownRituals ?? []).toEqual([]);

    let play: PlayState = initialPlay(ch, con);
    const onPlay = (fn: (p: PlayState) => PlayState) => {
      play = fn(play);
    };

    const { host, click, stop } = renderDom(<SpellsTab character={ch} content={con} onPlay={onPlay} />);
    // (2) nothing to show → no section, even though the sheet is in play (onPlay is set).
    expect(sections(host).some((s) => s.includes('Rituals'))).toBe(false);
    // (1) and no button of its own anywhere on the page.
    expect(host.textContent).not.toContain('Learn a ritual');

    // Open the activity, then its picker.
    click(byText(host, 'button.ms-btn', 'Learn a spell'));
    click(byText(host, 'button.ms-add', 'Learn a spell'));

    // (1) the picker carries a labelled Rituals group, with each ritual's rank and primary check.
    const groups = [...host.querySelectorAll('.ms-rank-hdr')].map((n) => (n.textContent ?? '').trim());
    expect(groups).toContain('Rituals');
    const row = [...host.querySelectorAll('.pick-row')].find(
      (r) => (r.querySelector('.picker-name')?.textContent ?? '').trim() === 'Commune',
    );
    expect(row).toBeTruthy();
    expect(row!.querySelector('.picker-traits')?.textContent).toContain('6th rank');
    expect(row!.querySelector('.picker-traits')?.textContent).toContain('Religion (master)');

    // Learning it goes through toggleKnownRitual — the same path the Rituals section reads from.
    click(row!.querySelector('.pick-add'));
    stop();
    expect(play.knownRituals ?? []).toContain('commune');

    // …and now the section exists, with the ritual in it.
    const after: Character = { ...ch, knownRituals: play.knownRituals };
    const second = renderDom(<SpellsTab character={after} content={con} onPlay={noop} />);
    const secs = sections(second.host);
    const text = second.host.textContent ?? '';
    second.stop();
    expect(secs.some((s) => s.includes('Rituals'))).toBe(true);
    expect(text).toContain('Commune');
    expect(text).not.toContain('Learn a ritual');
  });

  it('a cleric (prepares from the whole list, nothing to learn) still gets the button — and the picker offers rituals only', () => {
    const con = c();
    const ch = build('cleric', 6);
    const { host, click, stop } = renderDom(<SpellsTab character={ch} content={con} onPlay={noop} />);
    const btn = byText(host, 'button.ms-btn', 'Learn a spell');
    expect(btn, 'the Learn a spell button on a prepared-from-list caster').toBeTruthy();
    click(btn);
    click(byText(host, 'button.ms-add', 'Learn a spell'));
    const groups = [...host.querySelectorAll('.ms-rank-hdr')].map((n) => (n.textContent ?? '').trim());
    const names = [...host.querySelectorAll('.picker-name')].map((n) => (n.textContent ?? '').trim());
    stop();
    expect(groups).toContain('Rituals');
    // Every row is a ritual — no divine spell is offered to a caster who already prepares from the whole list.
    const ritualNames = new Set(Object.values(con.spells).filter((s) => s.ritual).map((s) => s.name));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !ritualNames.has(n))).toEqual([]);
  });

  it('a ritual already known is not offered again by the picker', () => {
    const con = c();
    const ch: Character = { ...build('wizard', 6), knownRituals: ['commune'] };
    const { host, click, stop } = renderDom(<SpellsTab character={ch} content={con} onPlay={noop} />);
    click(byText(host, 'button.ms-btn', 'Learn a spell'));
    click(byText(host, 'button.ms-add', 'Learn a spell'));
    const names = [...host.querySelectorAll('.picker-name')].map((n) => (n.textContent ?? '').trim());
    stop();
    expect(names).not.toContain('Commune');
    expect(names.length).toBeGreaterThan(0);
  });
});
