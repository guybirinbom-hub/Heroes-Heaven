import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { content } from './_content';
import { backgroundGrantedFeats } from '../src/rules/build';

const c = content();
type Patch = { category: string; id: string; field: string; value: unknown; path?: string[] };
const overlay = JSON.parse(readFileSync('scripts/data/effect-backfill.json', 'utf8')) as Patch[];

/**
 * A patch may address a NESTED object, so one option inside a choice group can be patched without
 * restating the whole group. Array steps address by id (`id=apparition`), never by index — a
 * regeneration reorders options freely and an index would land on a different record. This walk
 * mirrors the one `scripts/import-core-v2.mjs` performs; if they diverge the overlay stops
 * describing what ships.
 */
function resolvePath(root: unknown, path: readonly string[]): Record<string, unknown> | null {
  let node: unknown = root;
  for (const step of path) {
    if (node == null) return null;
    if (Array.isArray(node)) {
      const [k, v] = String(step).split('=');
      node = k === 'id' ? node.find((x) => (x as { id?: string })?.id === v) : null;
    } else node = (node as Record<string, unknown>)[step];
  }
  return node && typeof node === 'object' ? (node as Record<string, unknown>) : null;
}

/**
 * THE OVERLAY IS THE ONLY THING THAT SURVIVES A REGENERATION.
 *
 * `scripts/import-core-v2.mjs` rebuilds public/core.json from the AoN export plus a pristine
 * reference, and applies scripts/data/effect-backfill.json LAST. Anything written straight into
 * core.json and nowhere else lasts exactly until the next `npm run data`.
 *
 * That is not hypothetical: the champion's Blessing of the Devoted group was first written only to
 * core.json. v2 does not regenerate `classes` at all — it carries them from the reference, which has
 * no blessing group — so the picker would have vanished on the next import with nothing to show why.
 *
 * These tests make the overlay's coverage checkable rather than remembered.
 */
describe('mechanical data survives a re-import', () => {
  const has = (category: string, id: string, field: string) =>
    overlay.some((p) => p.category === category && p.id === id && p.field === field);

  it('every overlay patch points at a record that exists', () => {
    const db = c as unknown as Record<string, Record<string, unknown>>;
    const dead = overlay.filter((p) => !db[p.category]?.[p.id]).map((p) => `${p.category}/${p.id}`);
    expect(dead).toEqual([]);
  });

  it('every overlay patch actually matches what core.json holds', () => {
    // A patch that has drifted from the shipped value means core.json was hand-edited after the fact,
    // and the next regeneration would silently revert that edit. That is how the two backgrounds
    // whose overlay said `performance` while core.json said `society` were found.
    const db = c as unknown as Record<string, Record<string, Record<string, unknown>>>;
    const drift = overlay
      .filter((p) => {
        const target = p.path?.length ? resolvePath(db[p.category][p.id], p.path) : db[p.category][p.id];
        if (!target) return true; // an unresolved path is drift of the worst kind: it patches nothing
        const live = target[p.field];
        // The overlay applier can only ASSIGN, so "remove this field" has to be written as null.
        // null and absent are equivalent to every reader (`rec.speeds?.land`, `...(rec.speeds ?? {})`),
        // so treat them as agreeing rather than forcing a literal null into core.json.
        if (p.value === null && live === undefined) return false;
        return JSON.stringify(live) !== JSON.stringify(p.value);
      })
      .map((p) => `${p.category}/${p.id}${p.path?.length ? '/' + p.path.join('/') : ''}.${p.field}`);
    expect(drift, 'overlay entries that no longer match core.json').toEqual([]);
  });

  it('every nested patch resolves to a real object', () => {
    // A `path` typo produces a record that LOOKS backfilled and isn't — the exact failure mode this
    // whole file exists to catch, one level deeper.
    const db = c as unknown as Record<string, Record<string, unknown>>;
    const dead = overlay
      .filter((p) => p.path?.length && !resolvePath(db[p.category]?.[p.id], p.path))
      .map((p) => `${p.category}/${p.id}/${p.path!.join('/')}`);
    expect(dead).toEqual([]);
  });

  it("the champion's blessing group is in the overlay, not only in core.json", () => {
    expect(has('classes', 'champion', 'extraChoices')).toBe(true);
    expect(c.classes.champion.extraChoices?.some((g) => g.id === 'blessing')).toBe(true);
  });

  it('this session’s data lands in the overlay too', () => {
    // One representative from each apply script, so a future edit that skips the overlay is caught.
    expect(has('feats', 'fleet', 'landSpeedBonus'), 'speed increases').toBe(true);
    expect(has('feats', 'reliable-luck', 'usesUpgrade'), 'uses upgrades').toBe(true);
    expect(has('feats', 'ghost-strike', 'limitedUses'), 'self use limits').toBe(true);
    expect(has('feats', 'more-real-than-real', 'innateSpells'), 'innate grants').toBe(true);
    expect(has('feats', 'speakers-defense', 'effectChoices'), 'branch grants').toBe(true);
    expect(has('feats', 'demon-hunter', 'choice'), 'daily choices').toBe(true);
    expect(has('feats', 'beast-trainer', 'choice'), 'rewritten option values').toBe(true);
  });
});

/**
 * NEAR-MISS DUPLICATES.
 *
 * The `aon-` dedupe matched names EXACTLY, so a scrape that spelled the name differently — "Historical
 * Reeanactor", "Flash of Omipotence", "Festering Wound" vs "Wounds" — listed both copies in the picker.
 * 46 such pairs shipped. Hidden, never deleted: a saved character may already reference one.
 */
describe('near-miss aon duplicates are hidden', () => {
  it('the four typo-named backgrounds are marked duplicate', () => {
    for (const id of ['aon-historical-reeanactor', 'aon-post-guard-of-all-trade', 'aon-reclaimed-investigator', 'aon-wishes-for-riches']) {
      expect(c.duplicateIds?.has(id), `${id} should be hidden`).toBe(true);
      expect(c.backgrounds[id], `${id} must still resolve`).toBeTruthy();
    }
  });

  it('their canonical twins stay visible', () => {
    for (const id of ['historical-reenactor', 'post-guard-of-all-trades', 'reclaimer-investigator', 'wish-for-riches']) {
      expect(c.backgrounds[id], `${id} missing`).toBeTruthy();
      expect(c.duplicateIds?.has(id), `${id} must NOT be hidden`).toBe(false);
    }
  });

  it('every hidden id still resolves, so an old character keeps its pick', () => {
    const db = c as unknown as Record<string, Record<string, unknown>>;
    for (const id of c.duplicateIds ?? []) {
      const found = ['items', 'feats', 'spells', 'actions', 'vehicles', 'backgrounds', 'heritages', 'deities'].some((m) => db[m]?.[id]);
      expect(found, `${id} is hidden but no longer exists`).toBe(true);
    }
  });
});

/**
 * "Trained in either X or Y" backgrounds must ASK, not pick for you.
 */
describe('background skill choices', () => {
  it('an either/or background carries the choice, not one of the two', () => {
    expect(c.backgrounds['spell-seeker'].trainedSkill).toBeUndefined();
    expect(c.backgrounds['spell-seeker'].trainedSkillChoice).toEqual(['arcana', 'occultism']);
  });

  it('no background prints an either/or skill while storing a fixed one', () => {
    const bad: string[] = [];
    for (const [id, b] of Object.entries(c.backgrounds)) {
      const text = (b.description ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      if (!/trained in (?:either )?(?:the )?[A-Z][a-z]+(?: skill)?,? or (?:the )?[A-Z][a-z]+/.test(text)) continue;
      if (b.trainedSkill && !b.trainedSkillChoice) bad.push(`${id} (fixed ${b.trainedSkill})`);
    }
    expect(bad).toEqual([]);
  });
});

/**
 * The granted feat must MATCH the skill you picked.
 *
 * Five backgrounds print "If you selected X you gain feat A; if you chose Y, feat B". With a flat
 * `grantedFeatId` they all handed out the first branch's feat whatever the player chose.
 */
describe('backgrounds whose feat depends on the skill choice', () => {
  it('each branch grants its own feat', () => {
    expect(backgroundGrantedFeats(c.backgrounds['historical-reenactor'], 'performance')).toEqual(['impressive-performance']);
    expect(backgroundGrantedFeats(c.backgrounds['historical-reenactor'], 'society')).toEqual(['dubious-knowledge']);
    expect(backgroundGrantedFeats(c.backgrounds['conservator'], 'thievery')).toEqual(['assurance']);
  });

  it('an unpicked choice falls back to the first offered skill, not to a stale flat value', () => {
    const bg = c.backgrounds['historical-reenactor'];
    expect(bg.trainedSkillChoice?.[0]).toBe('performance');
    expect(backgroundGrantedFeats(bg, null)).toEqual(['impressive-performance']);
  });

  it('a background without branches is unaffected', () => {
    const bg = c.backgrounds['spell-seeker'];
    expect(bg.grantedFeatByChoice).toBeUndefined();
    expect(backgroundGrantedFeats(bg, 'occultism')).toEqual(['recognize-spell']);
  });

  it('every branch names a real feat, and covers every offered skill', () => {
    const bad: string[] = [];
    for (const [id, bg] of Object.entries(c.backgrounds)) {
      const map = bg.grantedFeatByChoice;
      if (!map) continue;
      for (const s of bg.trainedSkillChoice ?? []) if (!map[s]) bad.push(`${id}: no feat for '${s}'`);
      for (const [s, f] of Object.entries(map)) {
        for (const one of ([] as string[]).concat(f)) if (!c.feats[one]) bad.push(`${id}/${s} -> ${one} missing`);
      }
    }
    expect(bad).toEqual([]);
  });
});
