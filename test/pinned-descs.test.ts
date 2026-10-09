import { beforeAll, describe, it, expect } from 'vitest';
import { emptyPlay, togglePinnedDesc, descId, pinId, samePin, pinOf, pinForRead, initialPlay, applyPlayState } from '../src/rules/play';
import { buildCharacter, deriveBuildFromCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { importCharacter } from '../src/data/transfer';
import { normalizeCharacter, normalizePlay } from '../src/rules/normalize';
import { content } from './_content';
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

/*
 * Card step 19 (docs/card-design.md section 7 "Old pins", section 2 rule 2): a pin is its RECORD —
 * {bucket: key, id: slug} — plus the mode it was pinned from and the popup's choice / mark / note ours
 * lines. A pin saved before step 19 matches by its legacy key:title and is re-resolved at read time only.
 * The rendered half (FeatDetail → Pinned list → popup, the real App's persist) is test/card-pins.test.tsx.
 */
describe('card step 19: pin identity by {bucket, id}', () => {
  // The shipped content loads once (it is cached by test/_content), outside the 5 s per-test limit.
  beforeAll(() => { content(); }, 300_000);
  const mark ={ kind: 'mark', from: { bucket: 'feats', id: 'synth-source', name: 'Synth Source' }, text: 'a synthesized marker' };
  const node: PinnedDesc = {
    title: 'Caustic Nectar (Acid)', description: 'synthesized text', key: 'feats', slug: 'caustic-nectar', mode: 'mine',
    ours: [
      { kind: 'choice', text: 'Your choice: Acid — synthesized' },
      mark,
      { kind: 'note', text: 'Note: synthesized' },
      { kind: 'usesRetune', text: 'computed, never stored' },
      { kind: 'override', text: 'the Overrides edit, never stored' },
    ],
  };
  const legacy: PinnedDesc = { title: 'Caustic Nectar (Acid)', description: 'old snapshot', key: 'feats' };

  // batch card: #card-PIN — a pin stores its record, its mode and its ours lines, additively
  it('the store keeps slug, mode and the choice / mark / note lines — additive, every old field in place', () => {
    const stored = togglePinnedDesc(emptyPlay(), node).pinnedDescs![0];
    expect(stored).toEqual({
      title: 'Caustic Nectar (Acid)', description: 'synthesized text', descRefs: undefined, key: 'feats', slug: 'caustic-nectar', mode: 'mine',
      ours: [node.ours![0], mark, node.ours![2]],
    });
    // A copy, never the caller's objects (a later edit of the node cannot reach the stored pin).
    // batch card: #card-PIN — the stored pin is a copy; a pin with no new field keeps the old shape
    expect(stored.ours![1]).not.toBe(mark);
    expect(stored.ours![1].from).not.toBe(mark.from);
    // A node with none of them stores exactly the pre-step-19 shape.
    expect(Object.keys(pinOf({ title: 'Shield', description: 'd', key: 'actions' })).sort()).toEqual(['descRefs', 'description', 'key', 'title']);
  });

  // batch card: #card-IDENTITY — a pin's identity is bucket:id; the mode is never part of it
  it('identity is bucket:id when known; the mode is never part of it', () => {
    expect(pinId(node)).toBe('feats:caustic-nectar');
    expect(pinId(legacy)).toBe(descId(legacy));
    expect(samePin(node, { ...node, mode: 'browse', title: 'Caustic Nectar (Fire)' }), 'same record, other pick and mode').toBe(true);
    // One pin per record: pinning it again from another view (other mode, other pick) unpins it.
    let play = togglePinnedDesc(emptyPlay(), node);
    play = togglePinnedDesc(play, { ...node, mode: 'browse', title: 'Caustic Nectar (Fire)', ours: undefined });
    // batch card: #card-PIN — one pin per record: pinning it again from another view unpins it
    expect(play.pinnedDescs).toEqual([]);
  });

  // batch card: #card-IDENTITY — two records sharing a name and a bucket are two pins
  it('two records sharing a name and a bucket are two pins (four class features are "Weapon Expertise")', () => {
    const magus: PinnedDesc = { title: 'Weapon Expertise', description: 'm', key: 'classFeatures', slug: 'weapon-expertise-magus' };
    const necro: PinnedDesc = { title: 'Weapon Expertise', description: 'n', key: 'classFeatures', slug: 'weapon-expertise-necromancer' };
    expect(samePin(magus, necro)).toBe(false);
    const play = togglePinnedDesc(togglePinnedDesc(emptyPlay(), magus), necro);
    expect(play.pinnedDescs!.map((d) => d.slug)).toEqual(['weapon-expertise-magus', 'weapon-expertise-necromancer']);
    // batch card: #card-IDENTITY — distinct row keys on the Pinned list
    expect(new Set(play.pinnedDescs!.map(pinId)).size, 'distinct row keys on the Pinned list').toBe(2);
  });

  // batch card: #card-PIN — an old pin is matched by its record's new node, never doubled
  it('an OLD pin (no id) is matched by the new node of its record, and toggling that node removes the old pin — never a second one', () => {
    expect(samePin(legacy, node)).toBe(true);
    const play = togglePinnedDesc({ ...emptyPlay(), pinnedDescs: [legacy] }, node);
    expect(play.pinnedDescs).toEqual([]);
    // …and the same from the old side: a title-only node unpins a new pin of that title.
    const back = togglePinnedDesc(togglePinnedDesc(emptyPlay(), node), legacy);
    // batch card: #card-PIN — a title-only node unpins a new pin of that title
    expect(back.pinnedDescs).toEqual([]);
  });

  // batch card: #card-PIN — an old pin is re-resolved at read time only, never written back
  it('pinForRead: an old pin resolves by key + title only when that names exactly one record; a COPY, never the stored pin', () => {
    const db = content();
    const old = (key: string, title: string): PinnedDesc => Object.freeze({ title, description: 'stored snapshot', key }) as PinnedDesc;
    // One record of that name → its id.
    const one = old('feats', db.feats['caustic-nectar'].name);
    const r1 = pinForRead(one, db);
    // batch card: #card-PIN — one record of that name resolves to its id, on a copy
    expect(r1.slug).toBe('caustic-nectar');
    expect(r1).not.toBe(one);
    expect(one, 'the stored pin is untouched').toEqual({ title: 'Caustic Nectar', description: 'stored snapshot', key: 'feats' });
    // Several records of that name → '' (show the stored snapshot, guess no page).
    // batch card: #card-IDENTITY — several records of one name resolve to none, never a guess
    expect(Object.values(db.classFeatures).filter((r) => r.name === 'Weapon Expertise').length).toBeGreaterThan(1);
    expect(pinForRead(old('classFeatures', 'Weapon Expertise'), db).slug).toBe('');
    // A pick in the title names no record → ''; no key → ''; a bucket the content does not have → ''.
    // batch card: #card-PIN — no record, no key or no bucket resolves to none; a pin with an id is returned as stored
    expect(pinForRead(old('feats', 'Caustic Nectar (Acid)'), db).slug).toBe('');
    expect(pinForRead(Object.freeze({ title: 'Caustic Nectar', description: 's' }) as PinnedDesc, db).slug).toBe('');
    expect(pinForRead(old('origin', 'Acolyte'), db).slug).toBe('');
    // A pin that knows its id is returned as stored.
    expect(pinForRead(node, db)).toBe(node);
    // '' means "no id" to the matcher: the read copy still matches the stored pin.
    // batch card: #card-PIN — the read copy still matches the stored pin
    expect(samePin(pinForRead(old('classFeatures', 'Weapon Expertise'), db), old('classFeatures', 'Weapon Expertise'))).toBe(true);
  });

  // batch card: #card-IDENTITY — a canonical record beats its hidden aon- twin
  it('pinForRead: a canonical record beats its hidden aon- duplicate, so an old pin of a twinned name still opens its page', () => {
    // Fixer round 1: at 7cfb323 this rule decides 79 feat, 410 item, 15 spell and 100 action names. Without
    // it the two same-named records count as "several" and the old pin shows its snapshot instead of the page.
    const db = content();
    const named = Object.keys(db.actions).filter((id) => db.actions[id]?.name === 'Build Structure').sort();
    expect(named, 'Build Structure is a canonical action and its aon- twin').toEqual(['aon-build-structure', 'build-structure']);
    // batch card: #card-IDENTITY — the twin is hidden and the old pin opens the canonical record
    expect(db.duplicateIds?.has('aon-build-structure'), 'the twin is a hidden duplicate').toBe(true);
    expect(db.duplicateIds?.has('build-structure'), 'the canonical record is not').toBe(false);
    const old = Object.freeze({ title: 'Build Structure', description: 'stored snapshot', key: 'actions' }) as PinnedDesc;
    expect(pinForRead(old, db).slug).toBe('build-structure');
    // Every twinned name in these buckets resolves to its one canonical record.
    for (const bucket of ['feats', 'items', 'spells', 'actions'] as const) {
      const map = db[bucket] as unknown as Record<string, { name?: string } | undefined>;
      const byName = new Map<string, string[]>();
      for (const [id, r] of Object.entries(map)) if (r?.name) byName.set(r.name.toLowerCase(), [...(byName.get(r.name.toLowerCase()) ?? []), id]);
      const twinned = [...byName.values()].filter((ids) => ids.length > 1 && ids.filter((id) => !db.duplicateIds?.has(id)).length === 1);
      // batch card: #card-IDENTITY — every twinned name resolves to its one canonical record
      expect(twinned.length, `${bucket} has names held by one canonical record and its duplicates`).toBeGreaterThan(0);
      for (const ids of twinned) {
        const canon = ids.find((id) => !db.duplicateIds?.has(id))!;
        expect(pinForRead({ title: map[canon]!.name!, description: 's', key: bucket }, db).slug, `${bucket}: ${ids.join(' | ')}`).toBe(canon);
      }
    }
  });

  // batch card: #card-PIN — the pin keeps every field through build, play, sync and rebuild
  it('round trip: Builder → built Character → play ledger → normalize/JSON (sync) → derived build → rebuilt Character keeps every pin field', () => {
    const db = content();
    const stored = pinOf(node);
    const b: BuildState = { ...emptyBuild(), name: 't', level: 1, ancestryId: 'human', heritageId: 'versatile-human', backgroundId: 'acolyte', classId: 'fighter', keyAbility: 'str', pinnedDescs: [stored, legacy] } as BuildState;
    const ch = buildCharacter(b, db); // build.ts buildCharacter's pinnedDescs copy
    expect(ch.pinnedDescs).toEqual([stored, legacy]);
    const play = initialPlay(ch, db); // play.ts initialPlay's copy
    // batch card: #card-PIN — the play ledger, the synced copy and the live character keep the pin
    expect(play.pinnedDescs).toEqual([stored, legacy]);
    const synced = normalizePlay(JSON.parse(JSON.stringify(play)));
    expect(synced.pinnedDescs).toEqual([stored, legacy]);
    const live = normalizeCharacter(JSON.parse(JSON.stringify(applyPlayState(ch, synced, db)))); // play.ts applyPlayState
    expect(live.pinnedDescs).toEqual([stored, legacy]);
    const back = deriveBuildFromCharacter(live, db); // build.ts deriveBuildFromCharacter's copy
    // batch card: #card-PIN — the derived build and the rebuilt character keep the pin
    expect(back.pinnedDescs).toEqual([stored, legacy]);
    expect(buildCharacter(back, db).pinnedDescs).toEqual([stored, legacy]);
  });

  // batch card: #card-IDENTITY — an imported favorite is a pin of the record it resolved to
  it('a Wanderer\'s Guide favorite imports as a pin of the record it resolved to (transfer.ts)', () => {
    const db = content();
    const wg = JSON.stringify({
      version: 4,
      character: {
        name: 't', level: 1, experience: 0,
        details: { ancestry: { name: 'Human' }, background: { name: 'Acolyte' }, class: { name: 'Fighter' } },
        inventory: { coins: {}, items: [] },
        meta_data: { favorites: [{ type: 'feat', id: 1, name: 'Toughness' }, { type: 'spell', id: 2, name: 'Heal' }] },
      },
      content: {},
    });
    const pins = (importCharacter(wg, db).saved.character.pinnedDescs ?? []) as PinnedDesc[];
    const byKey = Object.fromEntries(pins.map((p) => [p.key, p]));
    // batch card: #card-IDENTITY — the imported pin carries the resolved record's bucket and id
    expect({ key: byKey.feats?.key, slug: byKey.feats?.slug }).toEqual({ key: 'feats', slug: 'toughness' });
    expect(db.feats[byKey.feats!.slug!].name).toBe(byKey.feats!.title);
    expect(byKey.spells?.slug && db.spells[byKey.spells.slug].name).toBe('Heal');
  });
});
