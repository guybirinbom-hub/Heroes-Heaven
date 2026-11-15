// @vitest-environment jsdom
/*
 * WHY THIS EXISTS
 *
 * The "not yet verified" line used to ask only the records map (`trustOff`) — the FIELDS the gate
 * strips off a record. About 2,750 records hold their only dark rule somewhere else: a situational
 * star (Incredible Initiative's +2 initiative), a FEAT_GRANTS entry, a hard-coded engine lane, or the
 * mode or stance they carry. Their cards said nothing while the sheet applied nothing, which is the
 * "indistinguishable from a bug" case the line exists for (ruling Q27: what does nothing must say so).
 *
 * `trustHeldBack` is the one question every surface now asks. These tests run the REAL gate over the
 * REAL public/core.json and ledger — no mocks — and render the REAL TrustMarker, so a regression in
 * either the getter or the component's wiring turns them red. Fixtures are named records, each
 * asserted against the ledger first, so a regenerated ledger fails loudly instead of proving nothing.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderDom } from './_render';
import { applyTrustGate, clearTrustGate, TRUST_LEDGER, trustHeldBack, trustHeldCount, trustOff } from '../src/data/trustGate';
import { ModeDetailModal } from '../src/sheet/ModeDetailModal';
import { ModesPanel } from '../src/sheet/ModesPanel';
import { MainTab } from '../src/sheet/MainTab';
import { build, content } from './_content';
import type { Character, ContentDatabase, ModeDef } from '../src/rules/types';
import { getPrefs, setPref } from '../src/data/prefs';
import { FEAT_GRANTS, grantKindsHeldBack, grantsFor, setFeatGrantTrustOff } from '../src/rules/featGrants';
import { TrustMarker, trustWords } from '../src/sheet/TrustMarker';

const CORE = JSON.parse(readFileSync('public/core.json', 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;

function marker(bucket: string, id: string) {
  const r = renderDom(<TrustMarker bucket={bucket} id={id} />);
  const note = r.host.querySelector('[role="note"]');
  const out = { text: r.host.textContent ?? '', title: note?.getAttribute('title') ?? '' };
  r.stop();
  return out;
}

describe('trustHeldBack — every lane, not only the records map', () => {
  const was = getPrefs().trustGate;
  beforeAll(() => {
    setPref('trustGate', true);
    applyTrustGate(CORE);
  }, 60_000);
  afterAll(() => {
    setPref('trustGate', was);
    clearTrustGate();
  });

  it('Incredible Initiative: its only dark rule is a situational star, and its card says so', () => {
    expect(TRUST_LEDGER.records['feats/incredible-initiative']).toBeUndefined();
    expect(TRUST_LEDGER.lanes.situational).toContain('incredible-initiative');
    expect(trustOff('feats', 'incredible-initiative')).toBeUndefined();
    expect(trustHeldBack('feats', 'incredible-initiative')).toEqual(['situational']);
    const m = marker('feats', 'incredible-initiative');
    expect(m.text).toBe('Not yet verified — shown, not applied');
    expect(m.title).toBe('Not applied yet: its situational bonuses.');
  });

  /* The ledger's `records` holds no mode or stance: their stripped fields come from the gate's own
   * payload lists, so the "words for every path" test in trust-marker never saw them (a held-back form
   * said "some of its effects" instead of "the battle form"). */
  it('every field the gate strips off a mode or stance has words', () => {
    const vague: string[] = [];
    for (const [bucket, ids] of [['modes', TRUST_LEDGER.lanes.modes], ['stances', TRUST_LEDGER.lanes.stances]] as const) {
      for (const id of ids) {
        for (const p of trustOff(bucket, id) ?? []) if (trustWords([p]) === 'some of its effects') vague.push(`${bucket}/${id}: ${p}`);
      }
    }
    expect(vague).toEqual([]);
    expect(trustOff('modes', 'animal-rage')).toContain('battleForm');
    expect(marker('modes', 'animal-rage').title).toContain('the battle form');
  });

  it('a record whose only dark rule is a hard-coded engine lane gets the line', () => {
    expect(TRUST_LEDGER.lanes.engine).toContain('magical-adept');
    expect(TRUST_LEDGER.records['feats/magical-adept']).toBeUndefined();
    expect(trustHeldBack('feats', 'magical-adept')).toContain('engine');
    expect(marker('feats', 'magical-adept').text).toContain('Not yet verified');
  });

  it('a record whose only dark rule is a grant-registry entry gets the line, naming the kind', () => {
    const id = 'hidden-intentions';
    expect(TRUST_LEDGER.records[`feats/${id}`]).toBeUndefined();
    expect(TRUST_LEDGER.lanes.featGrants[id]?.length).toBeGreaterThan(0);
    const held = trustHeldBack('feats', id) ?? [];
    expect(held.some((p) => p.startsWith('featGrants.'))).toBe(true);
    expect(marker('feats', id).text).toContain('Not yet verified');
  });

  it('the feat that carries a dark stance gets the line', () => {
    expect(TRUST_LEDGER.lanes.stances).toContain('crane-stance');
    expect(TRUST_LEDGER.records['feats/crane-stance']).toBeUndefined();
    expect(trustHeldBack('feats', 'crane-stance')).toContain('stances');
    expect(marker('feats', 'crane-stance').title).toContain('its stance');
  });

  it('the feat a dark mode names gets the line', () => {
    expect(TRUST_LEDGER.lanes.modes).toContain('aura-shield-the-faithful');
    expect(CORE.modes['aura-shield-the-faithful'].feats).toContain('shield-the-faithful');
    expect(trustHeldBack('feats', 'shield-the-faithful')).toContain('modes');
  });

  it('a record outside the paired buckets that merely shares a lane slug stays silent', () => {
    // The situational lane speaks for the ITEM, not the itemBonus glossary row of the same slug.
    expect(TRUST_LEDGER.lanes.situational).toContain('aeon-stone-amplifying');
    expect(CORE.itemBonus?.['aeon-stone-amplifying']).toBeDefined();
    expect(trustHeldBack('items', 'aeon-stone-amplifying')).toContain('situational');
    expect(trustHeldBack('itemBonus', 'aeon-stone-amplifying')).toBeUndefined();
  });

  it('a fully trusted record stays silent', () => {
    expect(TRUST_LEDGER.lanes.situational).not.toContain('toughness');
    expect(TRUST_LEDGER.records['feats/toughness']).toBeUndefined();
    expect(trustHeldBack('feats', 'toughness')).toBeUndefined();
    expect(marker('feats', 'toughness').text).toBe('');
  });

  it('with the setting on "all rules", nothing new shows', () => {
    setPref('trustGate', false);
    try {
      expect(trustHeldBack('feats', 'incredible-initiative')).toBeUndefined();
      expect(marker('feats', 'incredible-initiative').text).toBe('');
      expect(marker('feats', 'crane-stance').text).toBe('');
    } finally {
      setPref('trustGate', true);
    }
  });

  /* The FEAT_GRANTS entry is keyed by the FEAT's id; the item that shares the slug only shares the
   * situational star (follow-up 2026-10-23, item 4). */
  it('Clan Pistol the item names only its star, not the feat\'s weapon training', () => {
    expect(TRUST_LEDGER.lanes.featGrants['clan-pistol']).toContain('weapon');
    expect(trustHeldBack('feats', 'clan-pistol')).toContain('featGrants.weaponProficiency');
    expect(trustHeldBack('items', 'clan-pistol')).toEqual(['situational']);
    const m = marker('items', 'clan-pistol');
    expect(m.text).toContain('Not yet verified');
    expect(m.title).not.toContain('weapon training');
  });

  /* A record that HANDS OVER a held-back action or feat shows the line, naming it (item 3). */
  it('a granter of held-back actions or feats says so, naming what it grants', () => {
    expect(TRUST_LEDGER.records['feats/clawdancer-dedication']).toBeUndefined();
    expect(CORE.feats['clawdancer-dedication'].grantsActions).toEqual(['claw-stance', 'talon-stance']);
    expect(trustHeldBack('feats', 'clawdancer-dedication')).toEqual(['grants:Claw Stance', 'grants:Talon Stance']);
    expect(marker('feats', 'clawdancer-dedication').title).toBe('Not applied yet: Claw Stance and Talon Stance, which it grants.');
    // …and through the feat-grants registry: Lastwall Sentry Dedication hands over Reactive Shield.
    expect(trustHeldBack('feats', 'lastwall-sentry-dedication')).toContain('grants:Reactive Shield');
    // …and through a record's own `grantsFeats`: Cloistered Cleric hands over Domain Initiate.
    expect(CORE.classFeatures['cloistered-cleric'].grantsFeats).toContain('domain-initiate');
    expect(trustHeldBack('classFeatures', 'cloistered-cleric')).toContain(`grants:${CORE.feats['domain-initiate'].name}`);
  });
});

/*
 * The mode popup and the stance bar — where the player PRESSES a mode or a stance (item 1). Before
 * this, a held-back mode's popup said "Nothing on the sheet changes — this is here so you can see it
 * is running", which reads as intent.
 */
describe('held-back modes and stances say so where they are pressed', () => {
  const was = getPrefs().trustGate;
  let gated: Record<string, Record<string, Record<string, unknown>>>;
  beforeAll(() => {
    setPref('trustGate', true);
    gated = applyTrustGate(CORE);
  }, 60_000);
  afterAll(() => {
    setPref('trustGate', was);
    clearTrustGate();
  });

  const popup = (mode: ModeDef) => {
    const r = renderDom(<ModeDetailModal mode={mode} onClose={() => undefined} />);
    const out = {
      text: r.host.textContent ?? '',
      notes: r.host.querySelectorAll('[role="note"]').length,
      // Under the name, first in the body, like every record popup — never in the head beside the X.
      inHead: r.host.querySelectorAll('.picker-head [role="note"]').length,
      firstInBody: r.host.querySelector('.confirm-body')?.firstElementChild?.getAttribute('role') === 'note',
    };
    r.stop();
    return out;
  };

  it('a held-back mode\'s popup shows the line, and does not claim it is meant to do nothing', () => {
    const id = 'item-antidote-lesser';
    expect(TRUST_LEDGER.lanes.modes).toContain(id);
    const mode = gated.modes[id] as unknown as ModeDef;
    expect(mode.note).toBeFalsy();
    const p = popup(mode);
    expect(p.notes).toBe(1);
    expect(p.text).toContain('Not yet verified — shown, not applied');
    expect(p.text).not.toContain('this is here so you can see it is running');
    expect(p.inHead).toBe(0);
    expect(p.firstInBody).toBe(true);
    // The body does not repeat the marker's words.
    expect(p.text.split('Not yet verified').length - 1).toBe(1);
    expect(p.text).toContain('Nothing on the sheet changes until its rules are verified.');
  });

  /* The Modes panel row is where most modes are switched on (checker finding, 2026-10-23). */
  it('a held-back mode\'s row in the Modes panel shows the line; a plain one does not', () => {
    // A feat's mode (the panel lists an item's modes elsewhere), offered to a character with the feat.
    expect(TRUST_LEDGER.lanes.modes).toContain('aura-shield-the-faithful');
    const held = gated.modes['aura-shield-the-faithful'] as unknown as ModeDef;
    const plain = { id: 'synthetic-plain-mode', name: 'Plain Mode', modifiers: [] } as unknown as ModeDef;
    const r = renderDom(<ModesPanel library={[held, plain]} predefined={[]} featIds={['shield-the-faithful']} catalog={[]} activeIds={[]} onToggle={() => undefined} onSave={() => undefined} onDelete={() => undefined} />);
    const rows = [...r.host.querySelectorAll('.mode-row')].map((row) => ({ text: row.textContent ?? '', note: !!row.querySelector('[role="note"]') }));
    r.stop();
    const heldRow = rows.find((x) => x.text.includes(held.name));
    const plainRow = rows.find((x) => x.text.includes('Plain Mode'));
    expect(heldRow?.note).toBe(true);
    expect(plainRow?.note).toBe(false);
  });

  it('a mode the gate does not hold back shows no line, and keeps its own sentence', () => {
    const mode = { id: 'synthetic-plain-mode', name: 'Plain Mode', modifiers: [] } as unknown as ModeDef;
    const p = popup(mode);
    expect(p.notes).toBe(0);
    expect(p.text).toContain('this is here so you can see it is running');
  });

  /** A monk who took the stance feat (or a magus, whose Arcane Cascade is a granted action), in it. */
  const stanceBar = (stanceId: string) => {
    const magus = stanceId === 'arcane-cascade';
    const ch = magus ? build('magus', 1) : build('monk', 2);
    const withStance = {
      ...ch,
      feats: magus ? ch.feats : [...ch.feats, { featId: stanceId, level: 1, category: 'class' as const }],
      activeStance: stanceId,
    } as Character;
    const con = { ...content(), stances: gated.stances, modes: gated.modes } as unknown as ContentDatabase;
    const r = renderDom(<MainTab character={withStance} content={con} onPlay={() => undefined} />);
    const bar = r.host.querySelector('.stance-bar');
    const label = (magus ? CORE.actions : CORE.feats)[stanceId].name;
    const chip = [...r.host.querySelectorAll('.stance-chip')].find((b) => b.textContent!.trim() === label);
    const out = { bar: bar?.textContent ?? '', chipTitle: chip?.getAttribute('title') ?? '', found: !!chip };
    r.stop();
    return out;
  };

  it('the stance bar says so for a held-back stance you are in', () => {
    expect(TRUST_LEDGER.lanes.stances).toContain('crane-stance');
    const s = stanceBar('crane-stance');
    expect(s.found).toBe(true);
    expect(s.bar).toContain('Not yet verified — shown, not applied');
    expect(s.chipTitle).toContain('Not yet verified');
  });

  /*
   * A held-back BATTLE FORM (checker finding on c5c4990): the gate strips `battleForm` off the mode, so
   * its feat falls back to the plain stance chip, whose stance record holds only `{form, note}` and is
   * not held back. The bar and the chip must still say so, by asking the mode the feat carries.
   */
  const formBar = (cls: string, level: number, featId: string) => {
    const ch = build(cls, level);
    const withForm = {
      ...ch,
      feats: [...ch.feats, { featId, level, category: 'class' as const }],
      activeStance: featId,
    } as Character;
    const con = { ...content(), stances: gated.stances, modes: gated.modes } as unknown as ContentDatabase;
    const r = renderDom(<MainTab character={withForm} content={con} onPlay={() => undefined} />);
    const bar = r.host.querySelector('.stance-bar');
    const chip = [...r.host.querySelectorAll('.stance-chip')].find((b) => b.textContent!.trim() === CORE.feats[featId].name);
    const out = {
      bar: bar?.textContent ?? '',
      notes: bar?.querySelectorAll('[role="note"]').length ?? 0,
      noteTitle: bar?.querySelector('[role="note"]')?.getAttribute('title') ?? '',
      chipTitle: chip?.getAttribute('title') ?? '',
      found: !!chip,
    };
    r.stop();
    return out;
  };

  it.each([
    ['barbarian', 8, 'animal-rage'],
    ['fighter', 10, 'bat-form'],
  ])('a held-back battle form (%s, level %i, %s) says so on the bar and in the chip tooltip', (cls, level, featId) => {
    // The premise: the mode is held back and lost its form; the stance it falls back to is not held back.
    expect(TRUST_LEDGER.lanes.modes).toContain(featId);
    expect(CORE.modes[featId].battleForm).toBeTruthy();
    expect(gated.modes[featId].battleForm).toBeUndefined();
    expect(trustHeldBack('modes', featId)?.length).toBeGreaterThan(0);
    expect(trustHeldBack('stances', featId)).toBeUndefined();
    const s = formBar(cls, level, featId);
    expect(s.found).toBe(true);
    expect(s.bar).toContain('Not yet verified — shown, not applied');
    expect(s.notes).toBe(1);
    expect(s.chipTitle).toContain('Not yet verified');
  });

  /* Worm Form's stance record is held back too (its senses): one line, naming the form (the mode wins). */
  it('a form whose stance AND mode are held back shows one line, and the tooltip names the form', () => {
    expect(trustHeldBack('stances', 'worm-form')?.length).toBeGreaterThan(0);
    expect(trustHeldBack('modes', 'worm-form-hybrid')?.length).toBeGreaterThan(0);
    const s = formBar('fighter', 18, 'worm-form');
    expect(s.found).toBe(true);
    expect(s.notes).toBe(1);
    expect(s.chipTitle).toContain('Not yet verified');
    // The stance record alone would say "senses": the mode's words prove the mode was asked.
    expect(s.noteTitle).toContain('the battle form');
  });

  /* The plain chip sets the stance, and the Modes panel can switch the same form's mode on too. */
  it('a held-back form on as both the stance and a mode shows one line, not two', () => {
    const ch = build('barbarian', 8);
    const both = {
      ...ch,
      feats: [...ch.feats, { featId: 'animal-rage', level: 8, category: 'class' as const }],
      activeStance: 'animal-rage',
      activeModes: [gated.modes['animal-rage']],
    } as unknown as Character;
    const con = { ...content(), stances: gated.stances, modes: gated.modes } as unknown as ContentDatabase;
    const r = renderDom(<MainTab character={both} content={con} onPlay={() => undefined} />);
    const notes = r.host.querySelector('.stance-bar')?.querySelectorAll('[role="note"]').length ?? 0;
    r.stop();
    expect(notes).toBe(1);
  });

  /* The same form switched on as a MODE (Modes panel, or an older save), with no stance active. */
  it('a held-back form that is on as a mode, with no stance, still says so on the bar', () => {
    const ch = build('barbarian', 8);
    const withMode = {
      ...ch,
      feats: [...ch.feats, { featId: 'animal-rage', level: 8, category: 'class' as const }],
      activeStance: undefined,
      activeModes: [gated.modes['animal-rage']],
    } as unknown as Character;
    const con = { ...content(), stances: gated.stances, modes: gated.modes } as unknown as ContentDatabase;
    const r = renderDom(<MainTab character={withMode} content={con} onPlay={() => undefined} />);
    const bar = r.host.querySelector('.stance-bar');
    const notes = bar?.querySelectorAll('[role="note"]').length ?? 0;
    r.stop();
    expect(notes).toBe(1);
  });

  // The bar is a wrapping flex row: without its own row the line sat beside the chips on wide screens.
  it('the line on the stance bar takes a row of its own', () => {
    const css = readFileSync('src/sheet.css', 'utf8');
    expect(css).toMatch(/\.stance-bar > \.sd-choice-note\s*\{[^}]*flex-basis:\s*100%/);
  });

  it('the stance bar stays quiet for a stance the gate does not hold back', () => {
    expect(TRUST_LEDGER.lanes.stances).not.toContain('arcane-cascade');
    expect(trustOff('stances', 'arcane-cascade')).toBeUndefined();
    const s = stanceBar('arcane-cascade');
    expect(s.found).toBe(true);
    expect(s.bar).not.toContain('Not yet verified');
    expect(s.chipTitle).not.toContain('Not yet verified');
  });
});

/*
 * The Settings count (item 2) is the number of records whose card shows the line — on a small
 * synthetic gate, so every record can be rendered and counted by hand.
 */
describe('trustHeldCount — the cards that show the line', () => {
  const was = getPrefs().trustGate;
  afterAll(() => {
    setPref('trustGate', was);
    applyTrustGate(CORE); // put the real lanes back for any file that runs after
    clearTrustGate();
  }, 60_000);

  it('equals the records whose card shows "not yet verified", granters included', () => {
    setPref('trustGate', true);
    const core = {
      feats: {
        stripped: { id: 'stripped', name: 'Stripped', senses: [{ type: 'darkvision' }] },
        starred: { id: 'starred', name: 'Starred' },
        dancer: { id: 'dancer', name: 'Dancer', grantsActions: ['dark-stance'] },
        chooser: { id: 'chooser', name: 'Chooser', choice: { options: [{ id: 'a', grant: { grantsActions: ['dark-stance'] } }] } },
        plain: { id: 'plain', name: 'Plain', grantsActions: ['lit-stance'] },
      },
      actions: {
        'dark-stance': { id: 'dark-stance', name: 'Dark Stance' },
        'lit-stance': { id: 'lit-stance', name: 'Lit Stance' },
      },
      spells: { starred: { id: 'starred', name: 'Starred (a spell sharing the slug)' } },
    };
    const ledger = {
      coreSha: '', wgSha: '', generator: 'test',
      records: { 'feats/stripped': ['senses'] },
      lanes: { situational: ['starred', 'dark-stance'], featGrants: {}, modes: [], stances: [], engine: [] },
    };
    applyTrustGate(core, ledger);
    let shown = 0;
    for (const [bucket, map] of Object.entries(core)) {
      for (const id of Object.keys(map)) if (marker(bucket, id).text.includes('Not yet verified')) shown++;
    }
    // stripped, starred (feat only — not the spell), dancer, chooser, dark-stance; never plain or lit-stance.
    expect(shown).toBe(5);
    expect(trustHeldCount().now).toBe(shown);
    expect(marker('feats', 'dancer').title).toBe('Not applied yet: Dark Stance, which it grants.');
    expect(marker('feats', 'plain').text).toBe('');
    // Switching off goes through mergeWithSeed -> clearTrustGate; the "if on" number must survive it.
    setPref('trustGate', false);
    clearTrustGate();
    expect(trustHeldCount()).toEqual({ now: 0, ifOn: 5 });
  });
});

describe('grantKindsHeldBack — only kinds the gate really removes', () => {
  afterAll(() => setFeatGrantTrustOff(TRUST_LEDGER.lanes.featGrants));

  /* Over the whole shipped lane: the line names a FEAT_GRANTS kind exactly when the apply-side read
   * (`grantsFor`) hands the sheet something different from the raw entry. */
  it('agrees with grantsFor on every id of the shipped featGrants lane', () => {
    setFeatGrantTrustOff(TRUST_LEDGER.lanes.featGrants);
    const ids = Object.keys(TRUST_LEDGER.lanes.featGrants);
    expect(ids.length).toBeGreaterThan(100);
    const wrong = ids.filter((id) => {
      const kinds = grantKindsHeldBack(id);
      const raw = FEAT_GRANTS[id];
      const changed = !!raw && JSON.stringify(grantsFor(id) ?? {}) !== JSON.stringify(raw);
      // Something dropped must be named; a non-record kind named must have dropped something.
      // (`grantsRecord` alone can come from the featFeatGrants tables, which grantsFor never reads.)
      return (changed && kinds.length === 0) || (!changed && kinds.some((k) => k !== 'grantsRecord'));
    });
    expect(wrong).toEqual([]);
  });

  /* A key answering two kinds stays while either is trusted (withoutOffKinds), so a lane naming only
   * one of them removes nothing — and the line must not claim otherwise. */
  it('names nothing when every key the off kind answers also answers a trusted kind', () => {
    const id = Object.keys(FEAT_GRANTS).find((k) => {
      const keys = Object.keys(FEAT_GRANTS[k]);
      return keys.length > 0 && keys.every((key) => key === 'skillChoices' || key === 'rankUpgrade');
    });
    expect(id).toBeTruthy();
    setFeatGrantTrustOff({ [id!]: ['choice'] });
    expect(grantKindsHeldBack(id)).toEqual([]);
    setFeatGrantTrustOff({ [id!]: ['choice', 'skill'] });
    expect(grantKindsHeldBack(id)).toEqual(['choice', 'skill']);
  });
});
