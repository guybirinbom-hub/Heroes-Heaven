/*
 * A NIGHT'S REST HEALS BY THE CONSTITUTION THE SHEET SHOWS — bug found 2026-11-09 (vials PC check #1),
 * fixed 2026-11-11 (Step 1 review finding 3).
 *
 * "You regain Hit Points equal to your Constitution modifier (minimum 1) multiplied by your level."
 * An invested apex item (Belt of Long Life: Con) raises Con only in the play overlay (applyPlayState),
 * so the sheet shows the raised Con. App.tsx's onRest handed rest() the STORED character's Con, so a
 * level 17 character with Con 14 (+2) and the belt (18, +4) healed 34 instead of 68. The vials refill
 * had the same cause (470a3c8, test/bug-vials-rest-refill.test.ts (e)).
 *
 * The wiring part reads the `conMod:` expression out of App.tsx's onRest and RUNS it, over the stored
 * character (`active.character`) and the drawn one (`character`), so the test fails the moment the
 * handler reads Con from anything but the character the sheet draws. Synthetic characters only.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { abilityMod } from '../src/rules/derive';
import { applyPlayState, initialPlay, rest, type PlayState } from '../src/rules/play';
import type { Character, InventoryItem } from '../src/rules/types';

const db = content();
const BELT = 'belt-of-long-life';

/** A synthetic level 17 fighter with Con 14 stored (+2), so the belt lifts it to 18 (+4). */
function con14(): Character {
  const ch = build('fighter', 17, {});
  return { ...ch, abilities: { ...ch.abilities, con: 14 } };
}

/** The same character with the belt worn and invested in play, and 100 damage taken. */
function beltedPlay(ch: Character): PlayState {
  const belt: InventoryItem = { instanceId: 'belt', itemId: BELT, quantity: 1, worn: true, invested: true };
  const seed = initialPlay(ch, db);
  return { ...seed, damage: 100, inventory: [...(seed.inventory ?? []), belt] };
}

/** The `conMod:` expression of App.tsx's onRest handler, as written. */
function appConModExpr(): string {
  const app = readFileSync('src/App.tsx', 'utf8');
  const at = app.indexOf('onRest={(o) => {');
  expect(at, 'the onRest handler in App.tsx').toBeGreaterThan(-1);
  const handler = app.slice(at, app.indexOf('onOpenRoster=', at));
  const m = handler.match(/conMod:\s*(.+?),[ \t]*(?:\/\/[^\r\n]*)?\r?\n/);
  expect(m, 'a conMod: line in onRest').not.toBeNull();
  return m![1];
}

/** Run App's expression with App's names bound: `character` (drawn, may be null) and `active.character` (stored). */
function appConMod(drawn: Character | null, stored: Character): number {
  const f = new Function('abilityMod', 'character', 'active', `return (${appConModExpr()});`);
  return f(abilityMod, drawn, { character: stored }) as number;
}

describe('rest heals by the Con the sheet draws (an invested Con apex item counts)', () => {
  it('premise: the belt raises Con only in the play overlay (14 stored, 18 drawn)', () => {
    const ch = con14();
    expect(db.items[BELT]?.apexAttribute).toBe('con');
    const drawn = applyPlayState(ch, beltedPlay(ch), db);
    expect(ch.abilities.con).toBe(14);
    expect(drawn.abilities.con).toBe(18);
  });

  it('rest() heals level × the drawn Con mod: 17 × 4 = 68, not 17 × 2 = 34', () => {
    const ch = con14();
    const play = beltedPlay(ch);
    const drawn = applyPlayState(ch, play, db);
    const rested = rest(play, { level: ch.level, conMod: abilityMod(drawn.abilities.con) });
    expect(play.damage - rested.damage).toBe(68);
  });

  it('wiring: App.tsx onRest reads Con from the drawn character (and falls back to the stored one)', () => {
    const ch = con14();
    const play = beltedPlay(ch);
    const drawn = applyPlayState(ch, play, db);
    // The handler's own expression, run over the drawn character: +4 (the belt), so the night heals 68.
    expect(appConMod(drawn, ch)).toBe(4);
    const rested = rest(play, { level: ch.level, conMod: appConMod(drawn, ch) });
    expect(play.damage - rested.damage).toBe(68);
    // Before the sheet has a drawn character (App's `character` is null) it uses the stored Con.
    expect(appConMod(null, ch)).toBe(2);
  });

  it('control: without the belt the drawn and stored Con agree and the night heals 34', () => {
    const ch = con14();
    const play: PlayState = { ...initialPlay(ch, db), damage: 100 };
    const drawn = applyPlayState(ch, play, db);
    expect(drawn.abilities.con).toBe(14);
    expect(appConMod(drawn, ch)).toBe(2);
    expect(play.damage - rest(play, { level: ch.level, conMod: appConMod(drawn, ch) }).damage).toBe(34);
  });
});
