import { describe, it, expect } from 'vitest';
import { content } from './_content';

/*
 * BATCH 035, group red-close-out — the measurement behind a PARK, pinned.
 *
 * `node scripts/ast-content-check.mjs` is RED and was red before this batch started: six records
 * ship a display tree missing whole printed sections. The guard's own header says why it recurs —
 * "`npm run data` rebuilds public/ast/* from the AoN export, whose parse DROPPED whole printed
 * sections for these records — so a regen silently reverts the patches and the player loses the
 * content again (the AST is what DescBody renders; the repaired `.d` does not save them)" — and its
 * repair instruction is `node scripts/apply-ast-patches.mjs`, which no agent in this workflow may
 * run. The red is therefore parked as work/.b035-queue.json `ast-patches-reverted-by-regen`.
 *
 * What is testable here is the half that IS durable and that both repair options depend on: the
 * printed sections still live in public/core-descriptions.json, which is the source
 * scripts/apply-ast-patches.mjs transplants FROM. If that half ever drifts, option (a) stops being
 * runnable (the script throws "segment not found") and option (b) has nothing to make durable — and
 * nothing else in the suite would say so, because the AST guard only looks at public/ast.
 *
 * These assertions stay true under BOTH outcomes, so they do not have to be revisited when the
 * driver picks one: they assert the SOURCE, never the state of public/ast.
 */

/** The ast-content-check probe set, verbatim from scripts/ast-content-check.mjs. */
const PROBES: Array<[string, string, string[]]> = [
  ['classFeatures', 'ashes', ['Breathe Fire', 'Disintegrate', 'Revelation Spells']],
  ['classFeatures', 'bloodline-elemental', ['Thunderstrike', 'Chain Lightning']],
  ['classFeatures', 'bloodline-imperial', ['Translocate', 'Retrocognition']],
  ['classFeatures', 'way-of-the-vanguard', ['Living Fortification', 'Siegebreaker']],
  ['items', 'razmiri-mask-porcelain', ['Manifestation', 'Sunburst']],
  ['items', 'whispering-staff', ['Clairvoyance', 'Truesight']],
];

/** The segment anchors scripts/apply-ast-patches.mjs slices the transplant out of, verbatim. */
const ANCHORS: Array<[string, string, string[]]> = [
  ['classFeatures', 'ashes', ['**Granted Spells**', '**Related Domains']],
  ['classFeatures', 'bloodline-elemental', ['- **Air']],
  ['classFeatures', 'bloodline-imperial', ['**Sorcerous Gifts**', '\n\n**Bloodline Spells']],
  ['items', 'razmiri-mask-porcelain', ["**Activate—Call Upon Razmir's Mercy**"]],
  ['items', 'whispering-staff', ['- **Cantrip** Detect Magic']],
];

const descriptionOf = (bucket: string, id: string): string => {
  const db = content() as unknown as Record<string, Record<string, { description?: string }> | undefined>;
  return db[bucket]?.[id]?.description ?? '';
};

describe('batch 035 red close-out — ast-content-check parked: classFeatures/ashes, bloodline-elemental, bloodline-imperial, way-of-the-vanguard, items/razmiri-mask-porcelain, whispering-staff', () => {
  // The printed page carries the section our shipped AST lost; bloodline-27 prints the Imperial
  // ladder that classFeatures/bloodline-imperial's probes name, and the same holds for the other five.
  // batch 035 premise: bloodline-27 "4th Translocate - 5th Scouting Eye - 6th Disintegrate - 7th Retrocognition"
  it('core-descriptions still carries every dropped printed section for the six records', () => {
    const missing: string[] = [];
    for (const [bucket, id, probes] of PROBES) {
      const text = descriptionOf(bucket, id);
      const gone = probes.filter((p) => !text.includes(p));
      if (gone.length) missing.push(`${bucket}/${id} missing: ${gone.join(', ')}`);
    }
    expect(missing).toEqual([]);
  });

  // Option (a) of the queued question is "the driver runs scripts/apply-ast-patches.mjs": that script
  // slices its paragraphs out of these exact anchors and throws 'segment not found' if one drifts,
  // so the anchors are part of the repair, not incidental prose.
  // batch 035 premise: bloodline-27 "4th Translocate - 5th Scouting Eye - 6th Disintegrate - 7th Retrocognition"
  it('the transplant anchors apply-ast-patches.mjs slices on still resolve for the six records', () => {
    const broken: string[] = [];
    for (const [bucket, id, anchors] of ANCHORS) {
      const text = descriptionOf(bucket, id);
      for (const a of anchors) if (!text.includes(a)) broken.push(`${bucket}/${id}: ${JSON.stringify(a)}`);
    }
    expect(broken).toEqual([]);
  });
});
