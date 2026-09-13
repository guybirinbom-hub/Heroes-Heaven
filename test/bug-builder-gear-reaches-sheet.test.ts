// bug 2026-09-12 #3c: builder-gear
import { describe, expect, it } from 'vitest';
import { content } from './_content';
import { applyOverrides, buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import {
  addInventoryItem,
  applyPlayState,
  initialPlay,
  playForRebuild,
  toggleItemFlag,
  updateInventoryItem,
  type PlayState,
} from '../src/rules/play';
import type { InventoryItem } from '../src/rules/types';

/**
 * "i come back to edit and things are different." — owner, 2026-09-12.
 *
 * `play.inventory` OVERRIDES the build's gear on the sheet (applyPlayState), and a rebuild kept it
 * verbatim — so for every character that had ever touched inventory in play, an item added in the
 * BUILDER never arrived: builder and sheet disagreed from then on, permanently.
 *
 * The merge rule (src/rules/play.ts mergeRebuiltInventory): the sheet's rows are kept exactly as the
 * player left them, build items with no counterpart are ADDED, and a row is REMOVED only when the
 * new build no longer asks for it AND it is still byte-identical to what the previous build handed
 * over. Anything we cannot prove untouched stays.
 */
const db = () => content();

/** The exact chain App.tsx runs: build the character, then rebuild it with the play state carried. */
const build1 = (b: BuildState) => buildCharacter(b, applyOverrides(db(), b.overrides));
const rebuild = (play: PlayState, prev: { inventory: InventoryItem[] }, next: { inventory: InventoryItem[] }) =>
  playForRebuild(play, next.inventory, prev.inventory);

const base = (items: BuildState['inventory']): BuildState => ({
  ...emptyBuild(),
  name: 'Gear',
  level: 1,
  ancestryId: 'human',
  heritageId: 'versatile-human',
  backgroundId: 'acolyte',
  classId: 'fighter',
  keyAbility: 'str',
  inventory: items,
});

const STARTING = [
  { itemId: 'longsword', quantity: 1 },
  { itemId: 'rations', quantity: 2 },
  { itemId: 'torch', quantity: 1 },
];

const idOf = (inv: InventoryItem[], itemId: string) => inv.find((i) => i.itemId === itemId)!.instanceId;
const rows = (inv: InventoryItem[] | undefined, itemId: string) => (inv ?? []).filter((i) => i.itemId === itemId);

/** A character mid-play: the longsword drawn, the rations half eaten, a potion picked up on the road
 *  — and a torch still exactly as the build handed it over. */
function played(): { built: ReturnType<typeof build1>; play: PlayState } {
  const built = build1(base(STARTING));
  let play = initialPlay(built, db());
  play = toggleItemFlag(play, idOf(play.inventory!, 'longsword'), 'equipped');
  play = updateInventoryItem(play, idOf(play.inventory!, 'rations'), { quantity: 1 });
  play = addInventoryItem(play, 'healing-potion-minor');
  return { built, play };
}

describe('gear added in the builder reaches the sheet', () => {
  it('adds the new build item and leaves every in-play change intact', () => {
    const { built, play } = played();
    const next = build1(base([...STARTING, { itemId: 'shortbow', quantity: 1 }]));
    const out = rebuild(play, built, next);
    const inv = out.inventory!;
    expect(rows(inv, 'shortbow'), 'the builder’s new item never reached the sheet').toHaveLength(1);
    // …without disturbing anything the player had been carrying.
    expect(rows(inv, 'longsword')[0].equipped).toBe(true);
    expect(rows(inv, 'rations')[0].quantity).toBe(1);
    expect(rows(inv, 'healing-potion-minor'), 'a looted item is not the build’s to remove').toHaveLength(1);
    expect(rows(inv, 'torch')).toHaveLength(1);
    // The sheet reads play.inventory, so this is what the player actually sees.
    const sheet = applyPlayState(next, out, db());
    expect(sheet.inventory.map((i) => i.itemId)).toContain('shortbow');
    // Every instance id is still unique — an added row must not land on top of a live one.
    expect(new Set(inv.map((i) => i.instanceId)).size).toBe(inv.length);
  });

  it('rebuilding twice does not duplicate it', () => {
    const { built, play } = played();
    const next = build1(base([...STARTING, { itemId: 'shortbow', quantity: 1 }]));
    const once = rebuild(play, built, next);
    const twice = rebuild(once, next, next);
    expect(rows(twice.inventory, 'shortbow')).toHaveLength(1);
    expect(twice.inventory!.map((i) => i.itemId).sort()).toEqual(once.inventory!.map((i) => i.itemId).sort());
  });

  it('removing a build item removes only the instance the player never touched', () => {
    const { built, play } = played();
    // The builder drops all three starting items. Only the torch was left as the build handed it over.
    const next = build1(base([]));
    const out = rebuild(play, built, next);
    const inv = out.inventory!;
    expect(rows(inv, 'torch'), 'an untouched seeded item survives the builder dropping it').toHaveLength(0);
    expect(rows(inv, 'longsword'), 'the player wielded it — not ours to take').toHaveLength(1);
    expect(rows(inv, 'rations'), 'the player ate one — not ours to take').toHaveLength(1);
    expect(rows(inv, 'healing-potion-minor')).toHaveLength(1);
  });

  it('keeps everything when there is no previous inventory to compare against', () => {
    // Legacy/GM paths with no `prevBuilt`: nothing can be shown untouched, so nothing is dropped.
    const { built, play } = played();
    const next = build1(base([]));
    const out = playForRebuild(play, next.inventory);
    expect(out.inventory!.map((i) => i.itemId).sort()).toEqual(play.inventory!.map((i) => i.itemId).sort());
    expect(built.inventory.length).toBeGreaterThan(0); // fixture check: there WAS build gear
  });

  it('a character that never managed inventory in play still seeds from the build', () => {
    const { built } = played();
    const next = build1(base([...STARTING, { itemId: 'shortbow', quantity: 1 }]));
    const out = playForRebuild({ ...initialPlay(built, db()), inventory: undefined }, next.inventory, built.inventory);
    expect(out.inventory, 'undefined must stay undefined so the sheet falls back to the build').toBeUndefined();
    expect(applyPlayState(next, out, db()).inventory.map((i) => i.itemId)).toContain('shortbow');
  });
});
