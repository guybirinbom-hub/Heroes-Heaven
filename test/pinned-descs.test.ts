import { describe, it, expect } from 'vitest';
import { emptyPlay, togglePinnedDesc, descId } from '../src/rules/play';
import type { PinnedDesc } from '../src/rules/types';

// core.json has ~326 cross-map name collisions (e.g. "See the Unseen" is both a feat and a spell).
// Pin identity is therefore source-map + title, not title alone — these guard that.
describe('pinned-description identity (cross-map name collisions)', () => {
  const feat: PinnedDesc = { title: 'See the Unseen', description: 'the feat', key: 'feats' };
  const spell: PinnedDesc = { title: 'See the Unseen', description: 'the spell', key: 'spells' };

  it('pinning a feat and a same-named spell yields two distinct entries', () => {
    let play = emptyPlay();
    play = togglePinnedDesc(play, feat);
    play = togglePinnedDesc(play, spell);
    expect(play.pinnedDescs).toHaveLength(2);
    // Both survive, distinguished by their source map; each keeps its own key + body.
    expect(play.pinnedDescs?.map((d) => d.key).sort()).toEqual(['feats', 'spells']);
    expect(play.pinnedDescs?.find((d) => d.key === 'spells')?.description).toBe('the spell');
  });

  it('unpinning one does not remove the other same-named entry', () => {
    let play = emptyPlay();
    play = togglePinnedDesc(play, feat);
    play = togglePinnedDesc(play, spell);
    play = togglePinnedDesc(play, feat); // toggle the feat back off
    expect(play.pinnedDescs).toHaveLength(1);
    expect(play.pinnedDescs?.[0].key).toBe('spells');
  });

  it('descId separates same-title entries across maps; legacy keyless entries fall back to title', () => {
    expect(descId(feat)).not.toBe(descId(spell));
    // Entries pinned before the discriminator existed have no key → title-only identity.
    expect(descId({ title: 'See the Unseen' })).toBe(':see the unseen');
  });
});
