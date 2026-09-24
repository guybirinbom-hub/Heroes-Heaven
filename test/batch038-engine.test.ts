import { afterEach, describe, expect, it } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveMaxHp } from '../src/rules/derive';
import { EXTRA_FEAT_TAKINGS } from '../src/rules/featFeatGrants';
import type { Character, ContentDatabase } from '../src/rules/types';

/*
 * Batch 038, WG-comparison lane — the ENGINE family.
 *
 * All four findings ride lanes that already exist and already have readers (feat.focusSpells,
 * background.grantsLanguages, heritage.grantsFeats, EXTRA_FEAT_TAKINGS). No reader needed widening;
 * what was missing is the record's entry. So every assertion is read off a BUILT character, and the
 * entry is PATCHED INTO A CONTENT COPY (or the table) IN MEMORY — both the "with" and the "without"
 * side are in-memory copies, so no test here flips when the driver lands the row.
 */
const db = () => content();

function buildWith(dbase: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = dbase.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: 'human',
      backgroundId: Object.keys(dbase.backgrounds)[0],
      keyAbility: (cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (cls.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    dbase,
  );
}

/** A content copy with one top-level field set (value undefined = the field stripped) on one record. */
function withField(bucket: 'feats' | 'backgrounds' | 'heritages', id: string, field: string, value: unknown): ContentDatabase {
  const base = db();
  const rec: Record<string, unknown> = { ...(base[bucket] as Record<string, object>)[id] };
  if (value === undefined) delete rec[field];
  else rec[field] = value;
  return { ...base, [bucket]: { ...base[bucket], [id]: rec } } as ContentDatabase;
}

const focusSpells = (ch: Character) =>
  new Set(ch.spellcasting.filter((e) => e.type === 'focus').flatMap((e) => Object.values(e.repertoire ?? {}).flat()));

/* ============================================================================================ */

describe('feats/zombie-horde-impossible-magic: the feat teaches the zombie horde grave spell', () => {
  const necro = (dbase: ContentDatabase) =>
    buildWith(dbase, 'necromancer', 6, { featPicks: { '6:class': 'zombie-horde-impossible-magic' } } as Partial<BuildState>);

  // batch 038: zombie-horde-impossible-magic
  it('zombie-horde-impossible-magic with focusSpells puts zombie-horde in the necromancer\'s focus spells', () => {
    /* feat-9122: "You raise what seems like an endless torrent of walking corpses. You learn the
     * zombie horde grave spell." Reader: build.ts `feat.focusSpells` — the lane bony-barrage,
     * bloody-tendrils and deathly-scream already ride. */
    const without = necro(withField('feats', 'zombie-horde-impossible-magic', 'focusSpells', undefined));
    const withRow = necro(withField('feats', 'zombie-horde-impossible-magic', 'focusSpells', ['zombie-horde']));
    expect(withRow.feats.map((f) => f.featId)).toContain('zombie-horde-impossible-magic');
    expect(focusSpells(without).has('zombie-horde')).toBe(false);
    expect(focusSpells(withRow).has('zombie-horde')).toBe(true);
  });
});

/* ============================================================================================ */

describe('backgrounds/azlanti-researcher: the background adds Azlanti to your languages', () => {
  const researcher = (dbase: ContentDatabase) => buildWith(dbase, 'fighter', 1, { backgroundId: 'azlanti-researcher' });

  // batch 038: azlanti-researcher#language
  it('azlanti-researcher with grantsLanguages knows Azlanti', () => {
    /* background-654: "Add Azlanti to your list of known languages." Reader: build.ts `bgLangs`
     * (content.backgrounds[id].grantsLanguages), the student-of-the-ancients shape. */
    expect(db().languages.azlanti).toBeDefined();
    const without = researcher(withField('backgrounds', 'azlanti-researcher', 'grantsLanguages', undefined));
    const withRow = researcher(withField('backgrounds', 'azlanti-researcher', 'grantsLanguages', ['azlanti']));
    expect(without.languages).not.toContain('azlanti');
    expect(withRow.languages).toContain('azlanti');
  });
});

/* ============================================================================================ */

describe('heritages/defensive-automaton: the heritage grants the Toughness feat', () => {
  const automaton = (dbase: ContentDatabase) =>
    buildWith(dbase, 'fighter', 5, { ancestryId: 'automaton', heritageId: 'defensive-automaton' } as Partial<BuildState>);

  // batch 038: defensive-automaton#toughness
  it('defensive-automaton with grantsFeats holds Toughness and its +1 HP per level', () => {
    /* heritage-438: "You also gain the Toughness feat." Reader: build.ts heritage `grantSources`
     * (the tailed-goblin lane); Toughness's own maxHpBonus { perLevel: 1 } then applies. */
    const dNo = withField('heritages', 'defensive-automaton', 'grantsFeats', undefined);
    const dYes = withField('heritages', 'defensive-automaton', 'grantsFeats', ['toughness']);
    const without = automaton(dNo);
    const withRow = automaton(dYes);
    expect(without.feats.some((f) => f.featId === 'toughness')).toBe(false);
    const row = withRow.feats.find((f) => f.featId === 'toughness');
    expect(row?.grantedBy).toBe('defensive-automaton');
    expect(deriveMaxHp(withRow, dYes) - deriveMaxHp(without, dNo)).toBe(5);
  });
});

/* ============================================================================================ */

describe('heritages/newly-minted-automaton: the heritage grants Additional Lore for a lore of your choice', () => {
  const KEY = 'newly-minted-automaton';
  const prior = EXTRA_FEAT_TAKINGS[KEY];
  afterEach(() => {
    if (prior) EXTRA_FEAT_TAKINGS[KEY] = prior;
    else delete EXTRA_FEAT_TAKINGS[KEY];
  });
  /* The row lives in src/rules/featFeatGrants.ts EXTRA_FEAT_TAKINGS (added by the engine verifier).
   * The "without" side deletes it on the table in memory and afterEach restores it. */
  const patch = () => {
    EXTRA_FEAT_TAKINGS[KEY] = [{ feat: 'additional-lore', variant: 'heritage' }];
  };
  const automaton = (over: Partial<BuildState> = {}) =>
    buildWith(db(), 'fighter', 1, { ancestryId: 'automaton', heritageId: KEY, ...over } as Partial<BuildState>);
  const lores = (c: Character) => Object.keys(c.proficiencies.skills).filter((k) => k.startsWith('lore:'));

  // batch 038: newly-minted-automaton#lore
  it('newly-minted-automaton ships its Additional Lore taking in EXTRA_FEAT_TAKINGS (no in-memory patch)', () => {
    /* heritage-439: "You gain the Additional Lore skill feat in one lore of your choice." — the
     * shipped table, read on a built automaton with nothing patched. */
    const c = automaton({ featLoreChoices: { 'newly-minted-automaton#heritage:additional-lore:0': 'Engineering' } } as Partial<BuildState>);
    expect(c.feats.filter((f) => f.featId === 'additional-lore').map((t) => `${t.grantedBy}#${t.grantVariant}`)).toEqual(['newly-minted-automaton#heritage']);
    expect(lores(c)).toContain('lore:engineering');
  });

  // batch 038: newly-minted-automaton#lore
  it('newly-minted-automaton grants Additional Lore and trains the subject typed under its own key', () => {
    /* heritage-439: "You gain the Additional Lore skill feat in one lore of your choice." */
    delete EXTRA_FEAT_TAKINGS[KEY];
    expect(automaton().feats.some((f) => f.featId === 'additional-lore')).toBe(false);
    patch();
    const c = automaton({ featLoreChoices: { 'newly-minted-automaton#heritage:additional-lore:0': 'Engineering' } } as Partial<BuildState>);
    const takes = c.feats.filter((f) => f.featId === 'additional-lore');
    expect(takes.map((t) => `${t.grantedBy}#${t.grantVariant}`)).toEqual(['newly-minted-automaton#heritage']);
    expect(lores(c)).toContain('lore:engineering');
  });

  // batch 038: newly-minted-automaton#lore
  it('newly-minted-automaton\'s taking survives Automaton Lore\'s bound one and a slot-taken Additional Lore', () => {
    /* Why EXTRA_FEAT_TAKINGS and not heritage grantsFeats / FEAT_FEAT_GRANTS: Additional Lore has no
     * `choice`, so both of those lanes drop it when the character already holds one — from Automaton
     * Lore ("…the Additional Lore general feat for Automaton Lore") or from a skill-feat slot. */
    patch();
    const c = automaton({
      level: 2,
      featPicks: { '1:ancestry:0': 'automaton-lore', '2:skill': 'additional-lore' },
      featLoreChoices: { 'newly-minted-automaton#heritage:additional-lore:0': 'Engineering' },
    } as Partial<BuildState>);
    const granted = c.feats.filter((f) => f.featId === 'additional-lore' && f.grantedBy).map((t) => `${t.grantedBy}${t.grantVariant ? `#${t.grantVariant}` : ''}`);
    expect(granted.sort()).toEqual(['automaton-lore', 'newly-minted-automaton#heritage']);
    expect(c.feats.filter((f) => f.featId === 'additional-lore' && !f.grantedBy)).toHaveLength(1);
    for (const k of ['lore:automaton', 'lore:engineering']) expect(lores(c)).toContain(k);
  });
});
