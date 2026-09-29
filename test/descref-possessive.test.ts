import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { lookupRef } from '../src/sheet/descref';

/**
 * Batch P02 gap (data-rows-4): a description link on "Raise your Shield" resolved to nothing.
 * Impossible Magic prints "You can either Raise your Shield if you're wielding one or cast shield if you
 * have the spell" (spell-2882, Shielding Strike), and the action is Raise a Shield. lookupRef dropped the
 * possessive ("Raise Shield", no such record) but never SUBSTITUTED it with the article the way it does
 * for "Cast the Spell" -> Cast a Spell, so the link was dead on shielding-strike and, already, on the
 * feats everstand-strike, reflexive-shield and shielded-attrition. The fix is a possessive -> article
 * form in descref.ts forms().
 */
const db = content();

describe('shielding-strike: "Raise your Shield" links to the Raise a Shield action', () => {
  // batch P02: shielding-strike
  it('shielding-strike: the printed label resolves to Raise a Shield', () => {
    expect(lookupRef(db, { label: 'Raise your Shield', key: 'actions' })?.title).toBe('Raise a Shield');
    // the article form it replaces still resolves the same record
    expect(lookupRef(db, { label: 'Raise a Shield', key: 'actions' })?.title).toBe('Raise a Shield');
  });

  // batch P02: shielding-strike
  it('shielding-strike: the three feats printing the same words link it too', () => {
    for (const id of ['everstand-strike', 'reflexive-shield', 'shielded-attrition']) {
      const ref = (db.feats[id]?.descRefs ?? []).find((r) => r.label === 'Raise your Shield');
      expect(ref, `feats/${id} carries the ref`).toBeTruthy();
      expect(lookupRef(db, ref!)?.title, `feats/${id}`).toBe('Raise a Shield');
    }
  });

  // batch P02: shielding-strike
  it('shielding-strike: no other "your" label shipped today changes target (every one measured)', () => {
    // Every descRef label holding "your" across core-descriptions.json, and the record it opens. The
    // new form is tried LAST, so a label an earlier form already resolved keeps its record.
    const expected: [string, string, string | null][] = [
      ['actions', 'Averting Your Gaze', 'Avert Gaze'],
      ['spells', 'Wash Your Luck', 'Wash Your Luck'],
      ['actions', 'Manifest Your Eidolon', 'Manifest Eidolon'],
      ['actions', 'Treat your Wounds', 'Treat Wounds'],
      ['actions', 'Manifest your Eidolon', 'Manifest Eidolon'],
      ['actions', 'Drain your Bonded Item', 'Drain Bonded Item'],
      ['actions', 'Manifest your Realm', 'Manifest Realm'],
      ['feats', 'Channeling your Divine Spark', 'Channel Divine Spark'],
      ['actions', 'Direct your Follower', 'Direct Follower'],
      ['actions', 'Unleash your Psyche', 'Unleash Psyche'],
    ];
    const got = expected.map(([key, label]) => [key, label, lookupRef(db, { label, key })?.title ?? null]);
    expect(got).toEqual(expected);
  });
});
