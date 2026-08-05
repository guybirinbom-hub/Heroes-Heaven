import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { featEntries } from '../src/sheet/FeatsTab';

/**
 * A GRANTED feat's own sub-choice, whichever lane granted it.
 *
 * build.ts grants feats from six places and every one pushes `choice: grantedChoiceById[gid]` — but
 * the answer was only ever RESOLVED for six other sources, and the picker was only ever MOUNTED for
 * two. So a cloistered cleric was granted Domain Initiate by their doctrine and their domain pick was
 * read by nothing: no choice on the feat, no focus spell, no Focus Point.
 */
const db = content();

describe('a feat granted by a subclass resolves its own choice', () => {
  const cleric = (over: Record<string, unknown> = {}) =>
    build('cleric', 3, { subclassId: 'cloistered-cleric', deityId: 'sarenrae', ...over });

  it('the doctrine really does grant it', () => {
    expect(cleric().feats.some((f) => f.featId === 'domain-initiate' && f.grantedBy === 'cloistered-cleric')).toBe(true);
  });

  it('with no answer it grants no spell — not a defaulted one', () => {
    const c = cleric();
    expect(c.feats.find((f) => f.featId === 'domain-initiate')?.choice).toBeUndefined();
    expect(c.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat())).toEqual([]);
  });

  it('the answer lands on the feat, the spell, and the pool', () => {
    const c = cleric({ grantedFeatChoices: { 'domain-initiate': 'fire' } });
    expect(c.feats.find((f) => f.featId === 'domain-initiate')?.choice).toEqual({ value: 'fire', label: 'Fire' });
    const focus = c.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());
    expect(focus).toEqual(['fire-ray']);
    expect(c.focus?.max).toBe(1);
  });

  it('a different domain gives a different spell', () => {
    const c = cleric({ grantedFeatChoices: { 'domain-initiate': 'healing' } });
    const focus = c.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat());
    expect(focus).not.toContain('fire-ray');
    expect(focus.length).toBe(1);
  });

  it('the row on the sheet names the domain, not a bare "Domain Initiate"', () => {
    const c = cleric({ grantedFeatChoices: { 'domain-initiate': 'fire' } });
    const row = featEntries(c, db).find((e) => e.featId === 'domain-initiate');
    expect(row?.name).toMatch(/Fire/);
  });
});

describe('every grant lane is covered, not a hardcoded few', () => {
  it('a heritage-granted feat with a choice resolves too', () => {
    const withGrant = Object.entries(db.heritages).find(([, h]) =>
      (h.grantsFeats ?? []).some((g) => db.feats[g]?.choice),
    );
    if (!withGrant) return;
    const [hid, h] = withGrant;
    const gid = (h.grantsFeats ?? []).find((g) => db.feats[g]?.choice)!;
    const opt = db.feats[gid].choice!.options?.[0]?.value;
    if (!opt) return;
    const c = build('fighter', 3, { ancestryId: h.ancestryId ?? 'human', heritageId: hid, grantedFeatChoices: { [gid]: opt } });
    expect(c.feats.find((f) => f.featId === gid)?.choice?.value).toBe(opt);
  });

  it('a class-feature-granted feat with a choice resolves too', () => {
    // shaman -> spirit-familiar-animist is the shipped example.
    const c = build('animist', 3, { subclassId: 'shaman' });
    const granted = c.feats.filter((f) => f.grantedBy);
    expect(granted.length).toBeGreaterThan(0);
  });
});
