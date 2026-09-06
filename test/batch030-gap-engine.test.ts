import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { content } from './_content';
import { buildCharacter, emptyBuild, type BuildState } from '../src/rules/build';
import { deriveAc, resilientSaveBonus } from '../src/rules/derive';
import { planAttach } from '../src/rules/attachments';
import type { Character, ContentDatabase, Item, InventoryItem } from '../src/rules/types';

/**
 * Wanderer's-Guide parity batch 030 — the GAP lane of the engine family: the lines the engine
 * builder could not close inside its own files (two cross-file fixes) plus the specific-magic-armour
 * `builtInRunes` lane it filed as DATA STILL NEEDED.
 *
 * Same discipline as test/batch030-engine.test.ts: every assertion runs through the reader the sheet
 * or the builder actually calls, and a fix whose data row has yet to be applied is tested against a
 * content copy with that row PATCHED IN MEMORY, stating the outcome the row produces — never a
 * patched-vs-shipped delta that would flip the day the row lands.
 */
const db = content();

function patched(bucket: 'feats' | 'items', id: string, fields: Record<string, unknown>): ContentDatabase {
  const b = db[bucket] as Record<string, Record<string, unknown>>;
  return { ...db, [bucket]: { ...b, [id]: { ...b[id], ...fields } } } as ContentDatabase;
}

function buildOn(cdb: ContentDatabase, classId: string, level: number, over: Partial<BuildState> = {}): Character {
  const cls = cdb.classes[classId];
  return buildCharacter(
    {
      ...emptyBuild(),
      name: 't',
      level,
      classId,
      ancestryId: Object.keys(cdb.ancestries)[0],
      backgroundId: Object.keys(cdb.backgrounds)[0],
      keyAbility: (cls && cls.keyAbility.length === 1 ? cls.keyAbility[0] : null) as BuildState['keyAbility'],
      subclassId: (cls?.subclass?.options[0]?.id as string) ?? null,
      ...over,
    },
    cdb,
  );
}

/* ------------------------------------------------ viking-vindicator#weapon-familiarity */

describe('viking-vindicator adds the bastard sword and rapier to the Viking familiarity list (feats/viking-vindicator)', () => {
  /* AoN feat-3619: "If you have Viking Weapon Familiarity or Viking Weapon Specialist, add the
   * bastard sword and rapier to the list of weapons in those feats." The clause is a RIDER on a
   * sibling feat's list — nothing in FeatGrant could express that, so `requiresAnyFeat` is the new
   * gate (src/rules/featGrants.ts) and build.ts's clause loop honours it.
   *
   * A WIZARD, deliberately: trained in simple weapons and untrained in martial, so a demotion to the
   * simple rank is visible. On a fighter every martial weapon is already trained and the grant would
   * prove nothing. */
  const viking = (featIds: string[]): Character =>
    buildOn(db, 'wizard', 8, {
      overrides: { addedFeats: featIds.map((featId) => ({ featId, level: 8, category: 'class' as const })) },
    } as Partial<BuildState>);
  const ov = (c: Character) => c.proficiencies.weaponOverrides ?? {};

  // batch 030: viking-vindicator#weapon-familiarity
  it('with Viking Weapon Familiarity held, both weapons reach the wizard at their simple rank', () => {
    const c = viking(['viking-weapon-familiarity', 'viking-vindicator']);
    expect(c.feats.some((f) => f.featId === 'viking-vindicator'), 'the feat must actually be taken').toBe(true);
    expect(ov(c)['bastard-sword']).toBe(c.proficiencies.attacks.simple);
    expect(ov(c).rapier).toBe(c.proficiencies.attacks.simple);
  });

  // batch 030: viking-vindicator#weapon-familiarity
  it('viking-vindicator ALONE grants neither weapon — the printed "if you have" is the mechanic', () => {
    const c = viking(['viking-vindicator']);
    expect(ov(c)['bastard-sword'] ?? 'untrained').toBe('untrained');
    expect(ov(c).rapier ?? 'untrained').toBe('untrained');
  });

  // batch 030: viking-vindicator#weapon-familiarity
  it("the Familiarity feat's own six-weapon list is unchanged, and a viking-less wizard gets nothing", () => {
    const both = viking(['viking-weapon-familiarity', 'viking-vindicator']);
    for (const w of ['battle-axe', 'hatchet', 'longsword', 'shortsword']) expect(ov(both)[w], w).toBe(both.proficiencies.attacks.simple);
    const plain = viking([]);
    for (const w of ['bastard-sword', 'rapier', 'battle-axe']) expect(ov(plain)[w] ?? 'untrained', w).toBe('untrained');
  });
});

/* ------------------------------------------------------------- bands-of-force#talismans */

describe('bands-of-force hosts talismans as light armor (items/bands-of-force)', () => {
  /* AoN equipment-3058: "You can affix talismans to the bands as though they were light armor." The
   * bands ship as itemType "equipment", so isHost() rejected them and planAffix refused every
   * talisman. `affixHostAs` is the flag; affixHostType() is the one predicate planAffix and both UI
   * host gates now share. Patched in memory — the row is in work/.b030-rows-gap-engine.json. */
  const cdb = patched('items', 'bands-of-force', { affixHostAs: 'armor' });
  const inv = (instanceId: string, itemId: string): InventoryItem => ({ instanceId, itemId, quantity: 1 }) as InventoryItem;
  const plan = (cdb2: ContentDatabase, attId: string, hostId: string) => {
    const a = inv('a', attId);
    const h = inv('h', hostId);
    return planAttach(cdb2.items[attId] as Item, a, cdb2.items[hostId] as Item, h, [a, h], cdb2);
  };

  // batch 030: bands-of-force#talismans
  it('an armor talisman may be affixed to items/bands-of-force', () => {
    expect(plan(cdb, 'guardian-rose', 'bands-of-force').ok).toBe(true);
  });

  // batch 030: bands-of-force#talismans
  it('a WEAPON-only talisman is still refused — the bands count as armor, not as any host', () => {
    expect(plan(cdb, 'grinning-pugwampi', 'bands-of-force').ok).toBe(false);
  });

  // batch 030: bands-of-force#talismans
  it('a RUNE is still refused: print permits talismans, and etching is a different permission', () => {
    const p = plan(cdb, 'armor-potency-1', 'bands-of-force');
    expect(p.ok).toBe(false);
    expect(p.ok === false && p.reason).toMatch(/weapon, armor, or shield/);
  });

  // batch 030: bands-of-force#talismans
  it('ordinary equipment without the flag still refuses a talisman, so the flag is the whole gate', () => {
    expect(plan(cdb, 'guardian-rose', 'alchemist-kit').ok).toBe(false);
  });
});

/* ------------------------------------------- rusting-carapace#potency — the rest of the lane */

describe('the specific magic armour builtInRunes lane, the rest of rusting-carapace#potency', () => {
  /* The engine builder shipped the readers and ONE row and filed the remaining armours as DATA STILL
   * NEEDED. work/.b030-rows-gap-engine.json is that lane, measured against the AoN mirror's
   * "Specific Magic Armor" subcategory. These two tests are the lane's guard: the first proves the
   * rows are what each record's own printed sentence says, the second that a row of this shape is
   * worth both halves of the reader on a built character. */
  const spec = JSON.parse(fs.readFileSync('work/.b030-rows-gap-engine.json', 'utf8')) as {
    findings: { id: string; backfillRows: { category: string; id: string; field: string; value: unknown }[] }[];
  };
  const armourRows = spec.findings
    .flatMap((f) => f.backfillRows)
    .filter((r) => r.field === 'builtInRunes') as { id: string; value: { potency: number; resilient?: string } }[];
  const descs = JSON.parse(fs.readFileSync('public/core-descriptions.json', 'utf8')).items as Record<string, { d?: string }>;

  // batch 030: rusting-carapace#potency
  it("every row's potency and resilient tier are the ones the record's own description prints", () => {
    expect(armourRows.length).toBeGreaterThan(100);
    for (const r of armourRows) {
      /* Read INDEPENDENTLY of the measuring script — the first fundamental rune the description
       * prints, and the 45 characters after it, which is the whole name-phrase. Re-running the
       * script's own base_item anchor here would only prove the script agrees with itself. */
      const text = String(descs[r.id]?.d ?? '');
      const first = text.match(/\+([1-4])/);
      expect(first, `${r.id} must print a fundamental rune`).toBeTruthy();
      expect(Number(first![1]), `${r.id} potency`).toBe(r.value.potency);
      const tier = text
        .slice(text.indexOf(`+${r.value.potency}`), text.indexOf(`+${r.value.potency}`) + 45)
        .toLowerCase()
        .match(/(?:\b(greater|major|mythic)\s+)?\bresilient\b/);
      expect(r.value.resilient ?? null, `${r.id} resilient`).toBe(tier ? (tier[1] ?? 'resilient') : null);
      // …and the SHIPPED record must carry exactly this row and nothing else, so a later regeneration
      // that drops the lane is caught here ("anything not in effect-backfill.json dies at the next
      // npm run data"). This was written as `toBeUndefined()` — a pre-application state that flipped
      // the moment the 109 rows landed, which is the one test shape this batch's contract forbids.
      // The anti-double-count half it was reaching for is proved on a BUILT character in the it(
      // below: with the field stripped, blade-byrnie-major's AC equals a plain chain shirt's, so no
      // lane member bakes its potency into its own AC block.
      // batch 030: rusting-carapace#potency
      expect((db.items[r.id] as { builtInRunes?: unknown }).builtInRunes, `${r.id} lane row`).toEqual(r.value);
    }
  });

  // batch 030: rusting-carapace#potency
  it('a lane row delivers both halves on a built character: +3 AC and a greater resilient save', () => {
    // blade-byrnie-major: "Instead of chain links, this *+3 greater resilient chain shirt* is
    // assembled from metal 'leaves'…" — the highest-tier row the lane authors, so one built
    // character exercises both halves of the reader.
    const row = armourRows.find((r) => r.id === 'blade-byrnie-major')!;
    expect(row.value).toEqual({ potency: 3, resilient: 'greater' });
    const cdb = patched('items', 'blade-byrnie-major', { builtInRunes: row.value });
    // The "without" side is a copy with the field STRIPPED, never the shipped database — a
    // patched-vs-shipped delta would flip the day the row is applied.
    const bare = patched('items', 'blade-byrnie-major', { builtInRunes: undefined });
    const wearing = (cdb2: ContentDatabase, itemId: string): Character =>
      ({
        ...buildOn(cdb2, 'fighter', 12, {}),
        inventory: [{ instanceId: 'a', itemId, quantity: 1, worn: true, invested: true }],
      }) as Character;
    expect(deriveAc(wearing(cdb, 'blade-byrnie-major'), cdb).value).toBe(deriveAc(wearing(cdb, 'chain-shirt'), cdb).value + 3);
    expect(resilientSaveBonus(wearing(cdb, 'blade-byrnie-major'), cdb)).toBe(2);
    expect(resilientSaveBonus(wearing(bare, 'blade-byrnie-major'), bare), 'and nothing at all without the row').toBe(0);
    expect(deriveAc(wearing(bare, 'blade-byrnie-major'), bare).value, 'the whole +3 comes from the row').toBe(
      deriveAc(wearing(bare, 'chain-shirt'), bare).value,
    );
  });
});
