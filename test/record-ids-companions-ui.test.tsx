// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, useState } from 'react';
import { build, content } from './_content';
import { renderDom } from './_render';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { emptyPlay, type PlayState, type PlayUpdater } from '../src/rules/play';
import type { Character, CompanionConfig } from '../src/rules/types';

/**
 * AN AUTOMATIC COMPANION MADE REAL OPENS ON ITSELF (package H, 2026-10-20).
 *
 * The summoner's eidolon (and a feat's companion) shows as an automatic card; the first Edit makes it a
 * real companion under a DERIVED id (`cmp-eidolon-auto-N`, src/rules/recordIds.ts) and selects it. The
 * tab mints that id ONCE and hands it to `addPlayCompanion`. If the add minted its own (the unique id a
 * player's Add gets), the selection would miss, the card would fall back to the FIRST companion, and the
 * player's edits would land on the wrong creature — no test rendered this path (checker, 2026-10-20).
 * MUTATION (run 2026-10-20 on a scratch copy): drop the id argument from CompanionsTab's
 * `addPlayCompanion(p, {...}, id)` — this fails on `made real once, under its derived id: expected
 * [ 'cmp-72oqfapa-1' ] to deeply equal [ 'cmp-eidolon-auto-1' ]`, and with that check taken out, on
 * `the rename lands on the eidolon: expected '' to be 'Spirit'` (the rename went to Rex).
 * Synthetic character.
 */
const REX = { id: 'cmp-0', kind: 'animal', name: 'Rex' } as CompanionConfig;
let latest: PlayState;

function Harness() {
  const [play, setPlay] = useState<PlayState>({ ...emptyPlay(), companions: [REX] });
  latest = play;
  const onPlay: PlayUpdater = (fn) => setPlay((cur) => fn(cur));
  const character = { ...build('summoner', 1), companions: play.companions ?? [] } as Character;
  return <CompanionsTab character={character} content={content()} onPlay={onPlay} charKey="t" />;
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('making the automatic eidolon real', () => {
  it('Edit on the automatic eidolon: the companion made is the one edited — never the first companion', () => {
    const r = renderDom(<Harness />);
    const pills = [...r.host.querySelectorAll('.cmp-pill')];
    expect(pills.length, 'fixture: Rex and the automatic eidolon').toBe(2);
    r.click(pills.find((p) => !(p.textContent ?? '').includes('Rex')) ?? null);
    r.click(r.host.querySelector('button[title="Edit choices"]'));
    const made = (latest.companions ?? []).filter((c) => c.kind === 'eidolon');
    expect(made.map((c) => c.id), 'made real once, under its derived id').toEqual(['cmp-eidolon-auto-1']);
    const name = r.host.querySelector<HTMLInputElement>('input.comp-name:not(.eid-form)');
    expect(name, 'the edit card is open').toBeTruthy();
    type(name!, 'Spirit');
    const byId = new Map((latest.companions ?? []).map((c) => [c.id, c]));
    expect(byId.get('cmp-eidolon-auto-1')?.name, 'the rename lands on the eidolon').toBe('Spirit');
    expect(byId.get('cmp-0')?.name, 'Rex keeps his name').toBe('Rex');
    r.stop();
  });
});
