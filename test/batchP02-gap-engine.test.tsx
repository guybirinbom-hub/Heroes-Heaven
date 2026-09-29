// @vitest-environment jsdom
// jsdom for the one leg that asks whether the raised familiar budget reaches the companion card; the
// engine legs are pure and unaffected by the environment.
import { describe, it, expect } from 'vitest';
import { build, content } from './_content';
import { renderText } from './_render';
import { CompanionsTab } from '../src/sheet/CompanionsTab';
import { applyPlayState, initialPlay } from '../src/rules/play';
import { familiarAbilityBudget, familiarFeatRaise } from '../src/rules/companions';
import { FEAT_COMPANION_GRANTS } from '../src/rules/companionGrants';
import { canAttachTo, isAttachable, planAttach } from '../src/rules/attachments';
import type { BuildState } from '../src/rules/build';
import type { Character, CompanionConfig, InventoryItem } from '../src/rules/types';

/*
 * BATCH P02 (print-read lane) — the GAP lane of family "engine".
 *
 * The two CROSS-FILE GAPS the engine family could not close inside its own file list:
 *   - enhanced-familiar#ability-budget: the reader `familiarAbilityBudget` (src/rules/companions.ts),
 *     the per-grant `enhancedFamiliar` classification and the shaman ladder (src/rules/companionGrants.ts),
 *     and the card's grant note (src/sheet/CompanionsTab.tsx).
 *   - strikers-scroll#affix: the scroll permission in src/rules/attachments.ts and the two UI gates that
 *     must pass the character (src/sheet/InventoryTab.tsx, src/sheet/ItemEditorModal.tsx).
 *
 * Both are CODE, landed in this change, so every leg asserts on BUILT characters against the shipped
 * code and content — no overlay row is involved.
 */

const db = content();
const noop = () => undefined;
const fam = (grantSlug: string): CompanionConfig => ({ id: `f-${grantSlug}`, kind: 'familiar', name: '', grantSlug });
const owns = (ch: Character, id: string) => ch.feats.some((f) => f.featId === id);

const wizard = (level: number, feat?: string, thesis?: string) =>
  build('wizard', level, {
    keyAbility: 'int',
    featPicks: feat ? { '2:class': feat } : {},
    ...(thesis ? { extraChoices: { thesis: [thesis] } } : {}),
  } as Partial<BuildState>);
const witch = (level: number, feat?: string) => build('witch', level, { featPicks: feat ? { '2:class': feat } : {} } as Partial<BuildState>);

describe('batch P02 gap — enhanced-familiar raises the familiar ability budget (feat-4717)', () => {
  // batch P02: enhanced-familiar#ability-budget
  // AoN feat-4717: "You can select four familiar or master abilities each day, instead of two."
  it('enhanced-familiar: a wizard familiar reads 4 with the feat and 2 without it', () => {
    const withFeat = wizard(2, 'enhanced-familiar');
    expect(owns(withFeat, 'enhanced-familiar')).toBe(true);
    expect(familiarAbilityBudget(fam('familiar'), withFeat)).toBe(4);
    expect(familiarAbilityBudget(fam('familiar'), wizard(2))).toBe(2);
    // The Familiar Master Dedication familiar is the same base two.
    expect(familiarAbilityBudget(fam('familiar-master-dedication'), withFeat)).toBe(4);
  });

  // batch P02: enhanced-familiar#ability-budget
  // Witch Special: "Add the bonus familiar abilities you gain for being a witch to this amount." Wizard
  // Special: with improved familiar attunement "your familiar's base number of familiar abilities, before
  // adding any extra abilities from the arcane thesis, is four." So +2 on the base, extras on top.
  it('enhanced-familiar: the witch familiar 3→5 and improved familiar attunement 3→5, the 6/12/18 ladder still on top', () => {
    expect(familiarAbilityBudget(fam('familiar-witch'), witch(2, 'enhanced-familiar'))).toBe(5);
    expect(familiarAbilityBudget(fam('familiar-witch'), witch(2))).toBe(3);
    expect(familiarAbilityBudget(fam('familiar-witch'), witch(6, 'enhanced-familiar'))).toBe(6);
    expect(familiarAbilityBudget(fam('improved-familiar-attunement'), wizard(2, 'enhanced-familiar', 'improved-familiar-attunement'))).toBe(5);
    expect(familiarAbilityBudget(fam('improved-familiar-attunement'), wizard(2, undefined, 'improved-familiar-attunement'))).toBe(3);
  });

  // batch P02: enhanced-familiar#ability-budget
  // Draconic Familiar (feat-8093), Enhanced Psychopomp Familiar (feat-3471) and Adaptive Mask Familiar
  // (feat-1104) print "four ... instead of two" themselves, and Incredible Familiar (feat-8005) "six ...
  // instead of four": the feat's raise is already in their number. A pet is not a familiar. The
  // fixed-number grants are an open owner question, so they keep the number that shipped.
  it('enhanced-familiar: baked, pet and unsettled grants keep their own number with the feat', () => {
    const ch = wizard(2, 'enhanced-familiar');
    const marked = Object.entries(FEAT_COMPANION_GRANTS).filter(([, g]) => g.enhancedFamiliar);
    expect(Object.fromEntries(marked.map(([s, g]) => [s, g.enhancedFamiliar]))).toEqual({
      'enhanced-psychopomp-familiar': 'baked',
      'draconic-familiar': 'baked',
      'adaptive-mask-familiar': 'baked',
      'incredible-familiar-familiar-master': 'baked',
      pet: 'not-a-familiar',
      'friend-of-the-sea': 'not-a-familiar',
      'pirates-pet': 'not-a-familiar',
      'psychopomp-familiar': 'unsettled',
      'basic-witchcraft': 'unsettled',
      'undead-familiar': 'unsettled',
      'enhanced-undead-familiar': 'unsettled',
      'glyph-familiar': 'unsettled',
    });
    for (const [slug, g] of marked) {
      expect(familiarAbilityBudget(fam(slug), ch), slug).toBe(g.abilityBudget);
    }
    // And every UNMARKED familiar grant with a budget takes the +2 — the default is the printed rule.
    const plain = Object.entries(FEAT_COMPANION_GRANTS).filter(([, g]) => g.kind === 'familiar' && g.abilityBudget != null && !g.enhancedFamiliar && !g.growthLevels);
    expect(plain.length).toBeGreaterThan(15);
    for (const [slug, g] of plain) expect(familiarAbilityBudget(fam(slug), ch), slug).toBe(g.abilityBudget! + 2);
  });

  // batch P02: enhanced-familiar#ability-budget
  // batch P02 premise: feat-5004 "You can select a base of six familiar or master abilities each day, instead of four."
  // AoN practice-4 (Shaman): "You gain the Spirit Familiar feat. At 2nd level, you gain the Enhanced Familiar
  // feat." and at 9th "You gain the Incredible Familiar feat." The grant shipped a flat 4 for all levels.
  it('enhanced-familiar: the shaman familiar reads 2 at 1st, 4 from 2nd and 6 from 9th', () => {
    const shaman = (level: number) => build('animist', level, { subclassId: 'shaman' });
    expect(familiarAbilityBudget(fam('shaman'), shaman(1))).toBe(2);
    expect(owns(shaman(2), 'enhanced-familiar')).toBe(true);
    expect(familiarAbilityBudget(fam('shaman'), shaman(2))).toBe(4);
    expect(familiarAbilityBudget(fam('shaman'), shaman(8))).toBe(4);
    expect(owns(shaman(9), 'incredible-familiar')).toBe(true);
    expect(familiarAbilityBudget(fam('shaman'), shaman(9))).toBe(6);
    expect(familiarFeatRaise(fam('shaman'), shaman(9)).by).toBe('Incredible Familiar');
  });

  // batch P02: enhanced-familiar#ability-budget
  // The grant's note is static ("Choose 3 familiar abilities ..."), so the card must say the feat raised it.
  it('enhanced-familiar: the familiar card names the feat and the raised number', () => {
    const card = (ch: Character) => {
      const withFam = { ...ch, companions: [fam('familiar-witch')] } as Character;
      const played = applyPlayState(withFam, initialPlay(withFam, db), db);
      return renderText(<CompanionsTab character={played} content={db} onPlay={noop} charKey="t" />);
    };
    expect(card(witch(2, 'enhanced-familiar'))).toContain('Your Enhanced Familiar feat raises the number you choose to 5.');
    expect(card(witch(2))).not.toContain('raises the number you choose');
  });
});

/*
 * strikers-scroll#affix — AoN feat-9059: "You can attach a scroll to your weapon or handwraps of mighty
 * blows ... Attaching a scroll requires using the Affix a Talisman action. You can have only one scroll
 * affixed to a weapon at a time, and you can't have both a talisman and scroll attached."
 */
describe('batch P02 gap — strikers-scroll lets a scroll be affixed to a weapon (feat-9059)', () => {
  const scrollId = 'scroll-of-1st-rank-spell';
  const talismanId = Object.values(db.items).find(
    (i) => i.itemType === 'consumable' && i.consumableType === 'talisman' && (i.usage ?? '').includes('weapon'),
  )!.id;
  const inv = (itemId: string, instanceId: string, attachedTo?: string): InventoryItem => ({
    instanceId,
    itemId,
    quantity: 1,
    ...(attachedTo ? { attachedTo } : {}),
    equipped: !attachedTo,
  });
  const magus = (feat: boolean) => build('magus', 4, { featPicks: feat ? { '4:class': 'strikers-scroll' } : {} } as Partial<BuildState>);
  const plan = (ch: Character, inventory: InventoryItem[], attId: string, hostId: string) => {
    const att = inventory.find((i) => i.instanceId === attId)!;
    const host = inventory.find((i) => i.instanceId === hostId)!;
    return planAttach(db.items[att.itemId]!, att, db.items[host.itemId]!, host, inventory, db, { ...ch, inventory });
  };

  // batch P02: strikers-scroll#affix
  it('strikers-scroll: a scroll affixes to a longsword and to handwraps of mighty blows only with the feat', () => {
    const inventory = [inv('longsword', 'w1'), inv('handwraps-of-mighty-blows', 'h1'), inv(scrollId, 's1')];
    expect(owns(magus(true), 'strikers-scroll')).toBe(true);
    expect(plan(magus(true), inventory, 's1', 'w1').ok).toBe(true);
    expect(plan(magus(true), inventory, 's1', 'h1').ok).toBe(true);
    expect(plan(magus(false), inventory, 's1', 'w1').ok, 'no feat, no permission').toBe(false);
    // The UI gates ask the same question with the character, and without one a scroll stays unoffered.
    expect(isAttachable(db.items[scrollId]!, magus(true))).toBe(true);
    expect(isAttachable(db.items[scrollId]!, magus(false))).toBe(false);
    expect(isAttachable(db.items[scrollId]!)).toBe(false);
    expect(canAttachTo(db.items[scrollId]!, 'weapon', magus(true))).toBe(true);
  });

  // batch P02: strikers-scroll#affix
  it('strikers-scroll: "your weapon" — never armor or a shield', () => {
    const inventory = [inv('leather-armor', 'a1'), inv('steel-shield', 'sh1'), inv(scrollId, 's1')];
    expect(plan(magus(true), inventory, 's1', 'a1').ok).toBe(false);
    expect(plan(magus(true), inventory, 's1', 'sh1').ok).toBe(false);
    expect(canAttachTo(db.items[scrollId]!, 'armor', magus(true))).toBe(false);
  });

  // batch P02: strikers-scroll#affix
  it('strikers-scroll: one scroll per weapon, and never a scroll and a talisman together', () => {
    const ch = magus(true);
    const second = [inv('longsword', 'w1'), inv(scrollId, 's1', 'w1'), inv(scrollId, 's2')];
    const p1 = plan(ch, second, 's2', 'w1');
    expect(p1.ok).toBe(false);
    if (!p1.ok) expect(p1.reason).toMatch(/only one scroll/);

    const talismanFirst = [inv('longsword', 'w1'), inv(talismanId, 't1', 'w1'), inv(scrollId, 's1')];
    const p2 = plan(ch, talismanFirst, 's1', 'w1');
    expect(p2.ok).toBe(false);
    if (!p2.ok) expect(p2.reason).toMatch(/talisman or a scroll, never both/);

    const scrollFirst = [inv('longsword', 'w1'), inv(scrollId, 's1', 'w1'), inv(talismanId, 't1')];
    const p3 = plan(ch, scrollFirst, 't1', 'w1');
    expect(p3.ok).toBe(false);
    if (!p3.ok) expect(p3.reason).toMatch(/talisman or a scroll, never both/);
  });

  // batch P02: strikers-scroll#affix
  // Talismanic Sage's cap of two counts TALISMANS; the scroll exclusion is checked first, so the sage's
  // specially treated host still refuses a scroll.
  it('strikers-scroll: a Talismanic Sage host with a talisman still refuses a scroll', () => {
    const base = magus(true);
    const ch = { ...base, feats: [...base.feats, { ...base.feats.find((f) => f.featId === 'strikers-scroll')!, featId: 'talismanic-sage' }] } as Character;
    const inventory = [inv('longsword', 'w1'), inv(talismanId, 't1', 'w1'), inv(scrollId, 's1'), inv(talismanId, 't2')];
    expect(plan(ch, inventory, 't2', 'w1').ok, 'the sage may still add a second talisman').toBe(true);
    expect(plan(ch, inventory, 's1', 'w1').ok).toBe(false);
  });
});
