// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { content } from './_content';
import { renderDom } from './_render';
import { Builder } from '../src/builder/Builder';
import { buildCharacter, buildChoiceOptions, emptyBuild, levelGrants, type BuildState } from '../src/rules/build';
import { eligibleFeatsForSlot } from '../src/rules/featSlots';
import { FEAT_PICK_GRANTS } from '../src/rules/featPickGrants';
import { classFeatureIdsOwned, creatureTraitsOf, critSpecSources } from '../src/rules/derive';
import { sheetLoreKeys, statMarkClass } from '../src/rules/explain';
import { addInventoryItem, applyPlayState, initialPlay, toggleItemMode, useConsumable } from '../src/rules/play';
import { ItemDetail } from '../src/sheet/ItemDetail';
import { snapshot, diff } from '../scripts/lib/sheet-snapshot.mjs';
import { SKILLS } from '../src/rules/types';
import { sourceCatalog } from '../src/rules/sources';
import type { Character, ContentDatabase, Feat, FeatCategory } from '../src/rules/types';

/**
 * THE PLAYER-EXPERIENCE HARNESS — what OUR builder actually renders for a record, observed.
 *
 * Not a test of the app; a measuring instrument driven by `scripts/wg-experience.mjs`, which sets
 * WG_EXPERIENCE_BATCH (a work/wg-batch-0NN.json) and WG_EXPERIENCE_OUT (where to write). Without
 * those it skips, so `npm test` is unaffected.
 *
 * Why it renders the REAL Builder in jsdom instead of predicting from fields: the project has four
 * measuring scripts on record that lied by reading representation instead of outcome, and
 * builder-evidence.mjs's hand mirror of Builder.tsx had already drifted past the Domain Initiate fix
 * (no `featSpellChoices` lane) within a day of it landing. The DOM cannot drift from the DOM.
 *
 * Per record it builds a host that OWNS the record and one that does not, renders every builder page
 * for both, and reports the controls (`[data-ctl]` nodes — PopupSelect, SearchSelect, text inputs, feat
 * slots, spell "+ add") the record ADDS. The same pair of builds feeds a derived-sheet diff.
 *
 * "Without" per bucket — chosen so id-keyed registries (FEAT_GRANTS etc.) really switch off, which a
 * stubbed record with the same id would NOT do:
 *   feats          the slot left empty
 *   classFeatures  a content copy whose class no longer lists the feature (owned-feature set excludes it)
 *   heritages      heritageId null · backgrounds backgroundId null · ancestries ancestryId+heritageId null
 *   classes        classId null, Setup page only (level pages are the class's own slots)
 *   items          UNSUPPORTED here — item choices live on the sheet (ItemDetail), not the builder
 */

type Ctl = {
  page: string;
  ctl: string;
  title: string;
  options: number | null;
  live: number | null;
  state: string | null;
  subcard: string | null;
  setupcard: string | null;
  /** How many of WG's same-lane selects this one control answers (a multi-pick's `max`). */
  capacity?: number;
  /** Set by ctlDiff when the control exists in both builds and only its capacity grew with the record. */
  grew?: boolean;
};

type Row = { bucket: string; id: string; name: string; level: number | null };

const BATCH = process.env.WG_EXPERIENCE_BATCH;
const OUT = process.env.WG_EXPERIENCE_OUT;
/** REAL-CHARACTER MODE: a .codex.json export. The rows are everything that character owns and every
 *  host is the character's own build — the same judge, on the sheet the owner actually plays. */
const CHARACTER = process.env.WG_EXPERIENCE_CHARACTER;
const noop = () => undefined;
const num = (s: string | undefined) => (s === undefined || s === '' ? null : Number(s));

const byName = (db: ContentDatabase, bucket: 'classes' | 'ancestries') => {
  const m = new Map<string, string>();
  for (const [id, r] of Object.entries(db[bucket] as Record<string, { name?: string }>)) if (r?.name) m.set(r.name.toLowerCase(), id);
  return m;
};

/** A MINIMAL host: nothing spent, so "become trained in X" is never masked by a host already trained.
 *  The class's extra choice groups ARE filled with their first options (two apparitions, one conscious
 *  mind, …): a class feature whose controls or effects hang off that pick would otherwise read as absent. */
function minimalHost(db: ContentDatabase, classId: string | null, ancestryId: string | null, level: number): BuildState {
  const cls = classId ? db.classes[classId] : undefined;
  const heritageId = ancestryId ? (Object.values(db.heritages).find((h) => h.ancestryId === ancestryId)?.id ?? null) : null;
  const extraChoices: Record<string, string[]> = {};
  for (const g of (cls as { extraChoices?: { id: string; max?: number; options?: { id: string }[] }[] } | undefined)?.extraChoices ?? []) {
    extraChoices[g.id] = (g.options ?? []).slice(0, g.id === 'apparition' ? 2 : 1).map((o) => o.id);
  }
  return {
    extraChoices,
    primaryApparition: extraChoices.apparition?.[0] ?? null,
    ...emptyBuild(),
    name: 'wg-experience',
    level,
    ancestryId,
    heritageId,
    backgroundId: Object.keys(db.backgrounds)[0] ?? null,
    classId,
    subclassId: (cls?.subclass?.options?.[0]?.id as string | undefined) ?? null,
    keyAbility: (cls?.keyAbility?.[0] ?? 'str') as BuildState['keyAbility'],
    deityId: Object.keys(db.deities ?? {})[0] ?? null,
    /* Every book on. The Builder filters its content by the enabled sources, and a host that owns a
     * record from a non-core book (the harness forces the record in) must also see the records that
     * record's controls are built from — Summoner Dedication's Eidolon card lists the summoner class's
     * own eidolon types, which the core-only default hid, and the card with them (2026-09-02). */
    enabledSources: sourceCatalog(db).allBooks,
  };
}

/** Every builder page as the strip labels them: Setup (campaign options), 0 (origins: ancestry /
 *  heritage / background / class chassis), then levels 1..level. */
const pagesFor = (level: number) => ['Setup', '0', ...Array.from({ length: level }, (_, i) => String(i + 1))];

/** Render the builder for `build` over `db`, visit `pages`, and list every control on each. */
function collectControls(db: ContentDatabase, build: BuildState, pages: string[]): Ctl[] {
  const r = renderDom(<Builder content={db} initial={build} onCancel={noop} onCreate={noop} />);
  const out: Ctl[] = [];
  try {
    for (const page of pages) {
      const tab = [...r.host.querySelectorAll<HTMLButtonElement>('.lstrip button')].find((b) => (b.textContent ?? '').trim() === page);
      if (!tab) continue;
      r.click(tab);
      for (const el of r.host.querySelectorAll<HTMLElement>('[data-ctl]')) {
        // A multi-pick group is titled by its card (the marker carries only the descriptions' key).
        const card = el.closest<HTMLElement>('[data-subcard]')?.dataset.subcard ?? el.closest<HTMLElement>('[data-setupcard]')?.dataset.setupcard ?? null;
        out.push({
          page,
          ctl: el.dataset.ctl ?? '',
          title: el.dataset.ctl === 'multi' ? card ?? el.dataset.ctlTitle ?? '' : el.dataset.ctlTitle ?? '',
          options: num(el.dataset.ctlOptions),
          live: num(el.dataset.ctlLive),
          state: el.dataset.ctlState ?? null,
          subcard: el.closest<HTMLElement>('[data-subcard]')?.dataset.subcard ?? null,
          setupcard: el.closest<HTMLElement>('[data-setupcard]')?.dataset.setupcard ?? null,
          ...(el.dataset.ctlCapacity ? { capacity: Number(el.dataset.ctlCapacity) } : {}),
        });
      }
      /*
       * FREE-TEXT ANSWERS — a background's or feat's "Lore subject" input, a Kingmaker role. Rendered
       * as bare <input>s at several sites (shared.tsx origin cards, Builder.tsx granted-Lore lanes), so
       * they are read off the DOM: any text input inside a labelled card that carries no marker of its
       * own is one 'text' control, titled by its card. WG models the same thing as "Select a Lore".
       */
      for (const el of r.host.querySelectorAll<HTMLInputElement>('input[type="text"], input.lvl-lore-input, input.txt')) {
        if (el.dataset.ctl || (el.type && el.type !== 'text')) continue;
        const card = el.closest<HTMLElement>('[data-subcard]')?.dataset.subcard ?? el.closest<HTMLElement>('[data-setupcard]')?.dataset.setupcard;
        if (!card) continue; // a header field (character name, search) is not an answer
        out.push({ page, ctl: 'text', title: card || el.placeholder || 'text', options: null, live: null, state: el.value ? 'picked' : 'empty', subcard: el.closest<HTMLElement>('[data-subcard]')?.dataset.subcard ?? null, setupcard: el.closest<HTMLElement>('[data-setupcard]')?.dataset.setupcard ?? null });
      }
      /*
       * CHIP GROUPS — a row of `inv-toggle` buttons where exactly one is "on" (divine font, a caster
       * archetype's tradition or key attribute). They are controls without a shared primitive, so they are
       * read off the DOM shape instead of a marker: one control per group, titled by the row's header
       * (`.spr-head span`) or the card it sits in. A spell row (chips + "+ add") is skipped — its "+ add"
       * already carries `data-ctl`.
       */
      for (const grp of r.host.querySelectorAll<HTMLElement>('.spr-chips')) {
        const chips = [...grp.querySelectorAll<HTMLButtonElement>('button.inv-toggle')];
        if (!chips.length || grp.querySelector('[data-ctl]')) continue;
        const head =
          grp.parentElement?.querySelector<HTMLElement>('.spr-head span')?.textContent?.trim() ||
          grp.closest<HTMLElement>('[data-subcard]')?.dataset.subcard ||
          grp.closest<HTMLElement>('[data-setupcard]')?.dataset.setupcard ||
          'chips';
        out.push({
          page,
          ctl: 'chips',
          title: head,
          options: chips.length,
          live: chips.filter((b) => !b.disabled).length,
          state: chips.some((b) => b.classList.contains('on')) ? 'picked' : 'empty',
          subcard: grp.closest<HTMLElement>('[data-subcard]')?.dataset.subcard ?? null,
          setupcard: grp.closest<HTMLElement>('[data-setupcard]')?.dataset.setupcard ?? null,
        });
      }
    }
  } finally {
    r.stop();
  }
  return out;
}

const ctlKey = (c: Ctl) => `${c.page}|${c.ctl}|${c.title}`;

/** Multiset difference of controls by (page, kind, title). */
function ctlDiff(withC: Ctl[], withoutC: Ctl[]): { added: Ctl[]; removed: Ctl[] } {
  const count = new Map<string, number>();
  for (const c of withoutC) count.set(ctlKey(c), (count.get(ctlKey(c)) ?? 0) + 1);
  const added: Ctl[] = [];
  for (const c of withC) {
    const k = ctlKey(c);
    const n = count.get(k) ?? 0;
    if (n > 0) count.set(k, n - 1);
    else added.push(c);
  }
  const removed: Ctl[] = [];
  const left = new Map(count);
  for (const c of withoutC) {
    const k = ctlKey(c);
    const n = left.get(k) ?? 0;
    if (n > 0) { removed.push(c); left.set(k, n - 1); }
  }
  /* A control present in BOTH builds that GROWS with the record — the commander's tactics folio gains
   * two openings from Tactical Excellence, the cantrip rail one from Psi Development — is the record's
   * control too: the player meets it as N more picks in the same card. Reported as an added control
   * whose capacity is the growth, so the judge can hand it that many same-lane selects and no more. */
  const cap = (c: Ctl) => (c.capacity != null ? c.capacity : c.ctl === 'spell' || c.ctl === 'multi' ? (c.options ?? 1) : 1);
  const sumBy = (list: Ctl[]) => {
    const m = new Map<string, { cap: number; first: Ctl }>();
    for (const c of list) {
      const k = ctlKey(c);
      const e = m.get(k);
      if (e) e.cap += cap(c);
      else m.set(k, { cap: cap(c), first: c });
    }
    return m;
  };
  const w = sumBy(withC);
  const wo = sumBy(withoutC);
  for (const [k, e] of w) {
    const before = wo.get(k);
    if (before && e.cap > before.cap && (e.first.ctl === 'spell' || e.first.ctl === 'multi')) added.push({ ...e.first, capacity: e.cap - before.cap, grew: true });
  }
  return { added, removed };
}

type Host = {
  supported: boolean;
  reason?: string;
  /** 'builder' (default) renders the Builder for two builds; 'item' puts the item in a built
   *  character's inventory (worn, equipped, invested) and renders the sheet's ItemDetail card. */
  kind?: 'builder' | 'item';
  itemId?: string;
  withBuild: BuildState;
  /** The "with" build for the SHEET diff — the record's own picks answered (see answerOwnPicks); the
   *  controls are diffed on `withBuild`, before answering. Defaults to `withBuild`. */
  sheetBuild?: BuildState;
  withoutBuild: BuildState;
  withDb: ContentDatabase;
  withoutDb: ContentDatabase;
  pages: string[];
  meta: Record<string, unknown>;
};

/**
 * ITEM CONTROLS live on the SHEET, not the builder: ItemDetail renders an item's `effectChoices` as
 * native <select>s (label.sd-choice-row > .sd-choice-prompt) and its own `choice` as a <select> or
 * <input> under an .sd-uses-title. They are read off that card, one control per select/input.
 */
/** The designation kinds InventoryTab offers everyone (InventoryTab.tsx:685-707): the class-gated ones
 *  need a matching class, and the harness host is a fighter, so only the universal two apply — the
 *  wayfinder slot is what turns an aeon stone's RESONANT power on (ItemDetail gates it on `item.resonant`). */
const ITEM_DESIGNATIONS = [
  { kind: 'rune-source', label: 'Rune source' },
  { kind: 'wayfinder-slotted', label: 'Slotted in a wayfinder' },
] as never;

function collectItemControls(db: ContentDatabase, character: Character, itemId: string): Ctl[] {
  const inv = character.inventory.find((i) => i.itemId === itemId);
  const item = db.items[itemId];
  if (!inv || !item) return [];
  const r = renderDom(
    <ItemDetail inv={inv} item={item} content={db} onClose={noop} onPlay={noop as never} inventory={character.inventory} charLevel={character.level} character={character} designationKinds={ITEM_DESIGNATIONS} />,
  );
  const out: Ctl[] = [];
  try {
    for (const el of r.host.querySelectorAll<HTMLSelectElement | HTMLInputElement>('select, input[type="text"], input:not([type])')) {
      const row = el.closest<HTMLElement>('.sd-choice-row');
      const group = el.closest<HTMLElement>('.sd-uses');
      const title = row?.querySelector('.sd-choice-prompt')?.textContent?.trim() || group?.querySelector('.sd-uses-title')?.textContent?.trim() || (el as HTMLInputElement).placeholder || 'item choice';
      const isSelect = el.tagName === 'SELECT';
      const options = isSelect ? Math.max(0, (el as HTMLSelectElement).options.length - 1) : null;
      out.push({ page: 'item', ctl: isSelect ? 'select' : 'text', title, options, live: options, state: el.value ? 'picked' : 'empty', subcard: title, setupcard: null });
    }
    // The "This is my …" designation buttons — a Yes/No the player answers on the card (the wayfinder
    // slot is WG's "Is this granting the resonant power?" select). One control per button, titled by it.
    for (const group of r.host.querySelectorAll<HTMLElement>('.sd-uses')) {
      const head = group.querySelector('.sd-uses-title')?.textContent?.trim() ?? '';
      if (!/this is my/i.test(head)) continue;
      for (const b of group.querySelectorAll<HTMLButtonElement>('button')) {
        const label = (b.textContent ?? '').trim();
        if (!label) continue;
        out.push({ page: 'item', ctl: 'toggle', title: label, options: 2, live: 2, state: b.classList.contains('on') ? 'picked' : 'empty', subcard: head, setupcard: null });
      }
    }
  } finally {
    r.stop();
  }
  return out;
}

const eligibleCache = new Map<string, Set<string>>();

/** The earliest EMPTY rendered slot at or above `minLevel` that offers `featId`, or null. */
function renderedSlotFor(db: ContentDatabase, base: BuildState, classId: string, ancestryId: string, featId: string, minLevel: number): string | null {
  for (let lvl = Math.max(1, minLevel); lvl <= 20; lvl++) {
    const g = levelGrants(lvl, classId, db, base.subclassId, undefined, null, null, false, []);
    for (let idx = 0; idx < g.featSlots.length; idx++) {
      const cat = g.featSlots[idx] as FeatCategory;
      const key = `${lvl}:${cat}:${idx}`;
      if (base.featPicks[key]) continue; // a prerequisite already sits here
      const ck = `${classId}|${ancestryId}|${lvl}|${cat}|${idx}`;
      let set = eligibleCache.get(ck);
      if (!set) {
        set = new Set(eligibleFeatsForSlot(base, db, { level: lvl, category: cat, idx }).map((f) => f.id));
        eligibleCache.set(ck, set);
      }
      if (set.has(featId)) return key;
    }
  }
  return null;
}

/** Force a placement when no rendered slot offers the feat; null when nothing accepts it. */
function forcedSlotFor(db: ContentDatabase, base: BuildState, feat: Feat): string | null {
  const minLevel = feat.level ?? 1;
  const tries: [number, string, number][] = [
    [minLevel, feat.category, 0], [minLevel, 'class', 0], [minLevel, 'ancestry', 0], [minLevel, 'general', 0],
    [minLevel, 'skill', 0], [Math.max(2, minLevel), 'archetype', 0], [minLevel, 'bonus', 0],
  ];
  for (const [lvl, cat, idx] of tries) {
    const key = `${lvl}:${cat}:${idx}`;
    if (base.featPicks[key]) continue;
    try {
      const c = buildCharacter({ ...base, featPicks: { ...base.featPicks, [key]: feat.id } }, db);
      if (c.feats.some((f) => f.featId === feat.id)) return key;
    } catch { /* try the next slot shape */ }
  }
  return null;
}

/**
 * A feat's PREREQUISITE feats go on the host too — on BOTH builds, so the differential still isolates
 * the feat under test. "Basic Druid Spellcasting" on a host without Druid Dedication grants nothing
 * (the caster-archetype engine keys on the dedication), and reading that as "no sheet effect" blamed
 * the feat for the host. Names are matched against the printed prerequisite lines; anything that is
 * not a feat name (an attribute, a skill rank) is left to the host's level-20 chassis.
 */
function withPrerequisiteFeats(db: ContentDatabase, base: BuildState, classId: string, ancestryId: string, feat: Feat): { build: BuildState; placed: string[] } {
  const byName = new Map<string, Feat>();
  for (const f of Object.values(db.feats)) if (f?.name && !f.id.startsWith('aon-')) byName.set(f.name.toLowerCase(), f);
  let build = base;
  const placed: string[] = [];
  const queue = [...(feat.prerequisites ?? [])];
  const seen = new Set<string>([feat.id]);
  // An archetype feat needs its DEDICATION even when its printed prerequisites do not repeat it (the
  // archetype rule is general): Snowcaster's registry entries key on Gelid Shard Dedication being held.
  const archetype = (feat as { archetype?: string }).archetype;
  if (archetype && !/dedication/i.test(feat.name)) {
    const ded = Object.values(db.feats).find((f) => (f as { archetype?: string }).archetype === archetype && /dedication$/i.test(f.name ?? '') && !f.id.startsWith('aon-'));
    if (ded) queue.unshift(ded.name);
  }
  while (queue.length) {
    const line = String(queue.shift() ?? '');
    // "Druid Dedication", "Basic Druid Spellcasting; expert in Nature" — take each ';'/',' part, strip a
    // trailing parenthetical, and accept only exact feat names.
    for (const part of line.split(/[;,]/)) {
      const name = part.replace(/\(.*?\)/g, '').trim().toLowerCase();
      const pre = byName.get(name);
      if (!pre || seen.has(pre.id)) continue;
      seen.add(pre.id);
      const key = renderedSlotFor(db, build, classId, ancestryId, pre.id, pre.level ?? 1) ?? forcedSlotFor(db, build, pre);
      if (!key) continue;
      build = { ...build, featPicks: { ...build.featPicks, [key]: pre.id } };
      placed.push(pre.id);
      queue.push(...(pre.prerequisites ?? []));
    }
  }
  return { build, placed };
}

/**
 * ANSWER THE RECORD'S OWN PICKS with their first legal option, on the "with" build only.
 *
 * A focus-only spellcasting grant produces no entry until a focus spell exists, and the spell comes
 * from the record's own picker; a "choose two skills" grant trains nothing until answered. An empty
 * picker on the reference host therefore read as "the record does nothing" (triage: listeners-boon,
 * devout-magic, expanded-domain-initiate). The controls are still diffed BEFORE answering — this only
 * feeds the derived-sheet half. Open/spell-filter pickers whose lists need a resolver we cannot call
 * here are left empty and the record stays honest about it (`answered` in meta).
 */
function answerOwnPicks(db: ContentDatabase, build: BuildState, rec: { id: string; choice?: unknown; effectChoices?: unknown[] }, choiceKey: string): { build: BuildState; answered: string[] } {
  const answered: string[] = [];
  let out = build;
  const def = rec.choice as { kind?: string; options?: { value: string }[] } | undefined;
  if (def && def.kind !== 'text') {
    try {
      const char = buildCharacter(out, db);
      const opts = buildChoiceOptions(rec.id, def as never, out, db, char, choiceKey).filter((o) => !o.disabled);
      const v = opts[0]?.value ?? def.options?.[0]?.value;
      if (v) { out = { ...out, featChoices: { ...out.featChoices, [choiceKey]: v } }; answered.push(`choice=${v}`); }
    } catch { /* an unresolvable menu is not evidence */ }
  }
  for (const ch of (rec.effectChoices as { id: string; options?: { value: string }[] }[] | undefined) ?? []) {
    const v = ch.options?.[0]?.value;
    if (!v) continue;
    out = { ...out, effectChoices: { ...(out.effectChoices ?? {}), [`${rec.id}:${ch.id}`]: v } };
    answered.push(`${ch.id}=${v}`);
  }
  return { build: out, answered };
}

function featHost(db: ContentDatabase, feat: Feat): Host {
  const classes = byName(db, 'classes');
  const ancestries = byName(db, 'ancestries');
  let classId = db.classes.fighter ? 'fighter' : Object.keys(db.classes)[0];
  let ancestryId = db.ancestries.human ? 'human' : Object.keys(db.ancestries)[0];
  for (const t of (feat.traits ?? []).map((x) => String(x).toLowerCase())) {
    if (classes.has(t)) classId = classes.get(t)!;
    if (ancestries.has(t)) ancestryId = ancestries.get(t)!;
  }
  const { build: base, placed: prerequisites } = withPrerequisiteFeats(db, minimalHost(db, classId, ancestryId, 20), classId, ancestryId, feat);
  const minLevel = feat.level ?? 1;
  let slotKey = renderedSlotFor(db, base, classId, ancestryId, feat.id, minLevel);
  const slotRendered = !!slotKey;
  /* No slot offers it, but a GRANTER's pick does — the way the player actually reaches Devil Allies is
   * Order Training's "Choose a Hellknight order feat". Host the granter in a rendered slot with the pick
   * answered; "without" is the same granter with the pick unanswered, so the granter's own popup is in
   * both builds and only what the granted feat adds is counted. Explicit menus (`ids`) only — an open
   * category pick would have to be re-derived here to know it offers this feat. */
  if (!slotKey) {
    for (const [gid, spec] of Object.entries(FEAT_PICK_GRANTS)) {
      if (!spec.ids?.includes(feat.id) || !db.feats[gid]) continue;
      const granter = db.feats[gid];
      const { build: gBase, placed: gPre } = withPrerequisiteFeats(db, base, classId, ancestryId, granter);
      const gSlot = renderedSlotFor(db, gBase, classId, ancestryId, gid, granter.level ?? 1);
      if (!gSlot) continue;
      const without = { ...gBase, featPicks: { ...gBase.featPicks, [gSlot]: gid } };
      const withBuild = { ...without, pickFeatChoices: { ...(without.pickFeatChoices ?? {}), [gSlot]: feat.id } };
      const { build: answeredBuild, answered } = answerOwnPicks(db, withBuild, feat as never, gSlot);
      return {
        supported: true,
        withBuild,
        withoutBuild: without,
        withDb: db,
        withoutDb: db,
        sheetBuild: answeredBuild,
        pages: pagesFor(20),
        meta: { classId, ancestryId, level: 20, slotKey: gSlot, slotRendered: true, via: gid, prerequisites: [...prerequisites, ...gPre], answered, without: 'pick-unanswered' },
      };
    }
  }
  // Force a placement so the pickers can still be observed; `slotRendered: false` records that the
  // OFFER is not evidenced (builder-evidence's `forced-placement` limit, same meaning).
  if (!slotKey) slotKey = forcedSlotFor(db, base, feat);
  if (!slotKey) {
    return { supported: false, reason: 'no slot accepts this feat on any reference host', withBuild: base, withoutBuild: base, withDb: db, withoutDb: db, pages: [], meta: { classId, ancestryId, prerequisites } };
  }
  const withBuild = { ...base, featPicks: { ...base.featPicks, [slotKey]: feat.id } };
  const { build: answeredBuild, answered } = answerOwnPicks(db, withBuild, feat as never, slotKey);
  return {
    supported: true,
    withBuild,
    withoutBuild: base,
    withDb: db,
    withoutDb: db,
    sheetBuild: answeredBuild,
    pages: pagesFor(20),
    meta: { classId, ancestryId, level: 20, slotKey, slotRendered, prerequisites, answered, without: 'slot-empty' },
  };
}

const ownedCache = new Map<string, Set<string>>();
const ownedAt20 = (db: ContentDatabase, classId: string, subclassId: string | null) => {
  const k = `${classId}|${subclassId ?? ''}`;
  let s = ownedCache.get(k);
  if (!s) { s = classFeatureIdsOwned({ classId, subclassId, level: 20 }, db); ownedCache.set(k, s); }
  return s;
};

function classFeatureHost(db: ContentDatabase, id: string, fixed?: { build: BuildState; owner: { classId: string; subclassId: string | null } }): Host {
  let owner: { classId: string; subclassId: string | null } | null = fixed?.owner ?? null;
  if (!fixed) {
    for (const classId of Object.keys(db.classes)) {
      if (ownedAt20(db, classId, null).has(id)) { owner = { classId, subclassId: null }; break; }
      for (const opt of db.classes[classId].subclass?.options ?? []) {
        if (ownedAt20(db, classId, opt.id as string).has(id)) { owner = { classId, subclassId: opt.id as string }; break; }
      }
      if (owner) break;
    }
  }
  // Real-character mode hands in the owner's own build; the reference host is a level-20 minimal one.
  const base = fixed?.build ?? minimalHost(db, owner?.classId ?? null, 'human', 20);
  if (!owner) {
    return { supported: false, reason: 'no class or subclass grants this feature at level 20', withBuild: base, withoutBuild: base, withDb: db, withoutDb: db, pages: [], meta: {} };
  }
  const withBuild = fixed ? base : { ...base, subclassId: owner.subclassId ?? base.subclassId };
  const cls = db.classes[owner.classId];
  // A `<feature>-<class>` / `<feature>-<subclass>` variant is owned through its BASE feature; removing
  // the base removes both, so the base's controls are attributed to the variant too — recorded in meta.
  const baseIds = new Set([id, id.replace(new RegExp(`-${owner.classId}$`), ''), owner.subclassId ? id.replace(new RegExp(`-${owner.subclassId}$`), '') : id]);
  const features = cls.features.filter((f) => !baseIds.has(f.featureId));
  /* The control a class-feature record stands for can live on the CLASS rather than on the record: the
   * sorcerer's "Bloodline" is the subclass picker (`cls.subclass`), the psychic's "Subconscious Mind" is
   * an `extraChoices` group of the same id. Removing the feature from `features` leaves both in place,
   * so the picker rendered in both builds and the differential saw nothing added. The WITHOUT class
   * loses the matching group, and the subclass block when the record IS the subclass. */
  const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const recName = norm((db.classFeatures[id] as { name?: string } | undefined)?.name);
  const isSubclassAnchor = !!cls.subclass && !!recName && norm(cls.subclass.name) === recName;
  const subclass = isSubclassAnchor
    ? undefined
    : cls.subclass
      ? {
          ...cls.subclass,
          options: cls.subclass.options.map((o) => {
            const fi = (o as { featureIds?: unknown }).featureIds;
            if (!Array.isArray(fi)) return o;
            return { ...o, featureIds: fi.filter((x) => !baseIds.has(typeof x === 'string' ? x : (x as { id?: string })?.id ?? '')) };
          }),
        }
      : cls.subclass;
  const groups = (cls as { extraChoices?: { id: string; name?: string; featureId?: string }[] }).extraChoices;
  // By id, by the feature the group says it belongs to (wizard `thesis` @ arcane-thesis), or by name.
  const extraChoices = groups?.filter((g) => !baseIds.has(g.id) && norm(g.id) !== recName && !(g.featureId && baseIds.has(g.featureId)) && norm(g.name) !== recName);
  const withoutCls = { ...cls, features, subclass, ...(groups ? { extraChoices } : {}) };
  const withoutDb = { ...db, classes: { ...db.classes, [owner.classId]: withoutCls } } as ContentDatabase;
  const withoutBuild = isSubclassAnchor ? { ...withBuild, subclassId: null } : withBuild;
  const grantLevel = cls.features.find((f) => baseIds.has(f.featureId))?.level ?? null;
  const { build: answeredBuild, answered } = answerOwnPicks(db, withBuild, db.classFeatures[id] as never, `feature:${id}`);
  return {
    supported: true,
    withBuild,
    sheetBuild: answeredBuild,
    withoutBuild,
    withDb: db,
    withoutDb,
    pages: pagesFor(base.level),
    meta: {
      ...owner,
      level: base.level,
      grantLevel,
      answered,
      removedFromClass: [...baseIds].filter((b) => b !== id).length ? [...baseIds] : [id],
      without: isSubclassAnchor ? 'class-features+subclass' : (groups?.length ?? 0) !== (extraChoices?.length ?? 0) ? 'class-features+extraChoices' : 'class-features',
    },
  };
}

function originHost(db: ContentDatabase, bucket: string, id: string): Host {
  const fighter = db.classes.fighter ? 'fighter' : Object.keys(db.classes)[0];
  if (bucket === 'heritages') {
    const h = db.heritages[id];
    const ancestryId = h?.ancestryId ?? (db.ancestries.human ? 'human' : Object.keys(db.ancestries)[0]);
    const base = minimalHost(db, fighter, ancestryId, 20);
    return { supported: true, withBuild: { ...base, heritageId: id }, withoutBuild: { ...base, heritageId: null }, withDb: db, withoutDb: db, pages: pagesFor(20), meta: { classId: fighter, ancestryId, level: 20, without: 'heritage-null' } };
  }
  if (bucket === 'backgrounds') {
    const base = minimalHost(db, fighter, db.ancestries.human ? 'human' : Object.keys(db.ancestries)[0], 20);
    return { supported: true, withBuild: { ...base, backgroundId: id }, withoutBuild: { ...base, backgroundId: null }, withDb: db, withoutDb: db, pages: pagesFor(20), meta: { classId: fighter, level: 20, without: 'background-null' } };
  }
  if (bucket === 'ancestries') {
    const base = minimalHost(db, fighter, id, 20);
    return { supported: true, withBuild: base, withoutBuild: { ...base, ancestryId: null, heritageId: null }, withDb: db, withoutDb: db, pages: pagesFor(20), meta: { classId: fighter, ancestryId: id, level: 20, without: 'ancestry-null' } };
  }
  if (bucket === 'classes') {
    const base = minimalHost(db, id, db.ancestries.human ? 'human' : Object.keys(db.ancestries)[0], 20);
    return { supported: true, withBuild: base, withoutBuild: { ...base, classId: null, subclassId: null, keyAbility: null }, withDb: db, withoutDb: db, pages: ['0'], meta: { classId: id, level: 20, without: 'class-null', note: 'origin page only — the level pages are the class chassis itself' } };
  }
  const base = minimalHost(db, fighter, 'human', 20);
  if (bucket === 'items') {
    if (!db.items[id]) return { supported: false, reason: 'not in core.items', withBuild: base, withoutBuild: base, withDb: db, withoutDb: db, pages: [], meta: {} };
    return { supported: true, kind: 'item', itemId: id, withBuild: base, withoutBuild: base, withDb: db, withoutDb: db, pages: ['item'], meta: { classId: fighter, level: 20, without: 'not-in-inventory', note: 'worn + equipped + invested on a level-20 fighter; controls read off the sheet ItemDetail card' } };
  }
  return { supported: false, reason: `no host strategy for bucket ${bucket}`, withBuild: base, withoutBuild: base, withDb: db, withoutDb: db, pages: [], meta: {} };
}

function hostFor(db: ContentDatabase, row: Row): Host {
  if (row.bucket === 'feats') {
    const feat = db.feats[row.id];
    if (!feat) {
      const base = minimalHost(db, 'fighter', 'human', 20);
      return { supported: false, reason: 'not in core.feats', withBuild: base, withoutBuild: base, withDb: db, withoutDb: db, pages: [], meta: {} };
    }
    return featHost(db, feat);
  }
  if (row.bucket === 'classFeatures') return classFeatureHost(db, row.id);
  return originHost(db, row.bucket, row.id);
}

/**
 * What the built character SHOWS, for the chassis fallback in scripts/lib/wg-experience-lanes.mjs:
 * when the with/without differential moves nothing (a class feature implemented on the ClassDef
 * tables), the comparer asks this summary whether their value-bearing ops are visible anyway.
 */
function surfaceOf(c: Record<string, unknown>, db: ContentDatabase, snap: Record<string, unknown>) {
  const spells = db.spells as Record<string, { name?: string } | undefined>;
  const spellIds = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') { if (spells[v]) spellIds.add(v); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(c.spellcasting ?? []);
  for (const g of (snap.grantedSpells as string[] | undefined) ?? []) {
    const id = String(g).split(':')[1];
    if (id && spells[id]) spellIds.add(id);
  }
  // Spells an ITEM in the inventory carries (an activation, innate grants, held spells) reach the
  // Spells page through the item-spells lane, not a spellcasting entry — read them off the item records.
  for (const inv of (c.inventory as { itemId: string }[] | undefined) ?? []) walk((db.items as Record<string, unknown>)[inv.itemId] ?? null);
  type Entry = { id?: string; type?: string; tradition?: string; proficiency?: string; cantripCap?: number; cantripsPrepared?: boolean; prepared?: object; repertoire?: object; slots?: object };
  // Every stat row that carries a `*` (a situational note) — the sheet's rendering of a conditional
  // bonus, which is how WG's numeric `addBonusToValue` reaches a player here.
  const stars: Record<string, boolean> = {};
  const ch = c as unknown as Character;
  // The rows the sheet shows (trained Lores + an untrained row a star needs), not the proficiency map alone.
  const loreKeys: string[] = sheetLoreKeys(ch, db);
  const strikes = (snap.strikes as { instanceId?: string }[] | undefined) ?? [];
  const refs: { key: string; ref: Parameters<typeof statMarkClass>[1] }[] = [
    { key: 'ac', ref: { kind: 'ac' } }, { key: 'perception', ref: { kind: 'perception' } }, { key: 'classDc', ref: { kind: 'classDc' } },
    { key: 'speed', ref: { kind: 'speed' } },
    // Strike rows: a star on ANY strike's attack or damage counts (WG's ATTACK_DAMAGE_BONUS is unscoped).
    ...strikes.filter((s) => s.instanceId).flatMap((s) => [
      { key: 'strikeAttack', ref: { kind: 'strikeAttack' as const, instanceId: s.instanceId! } },
      { key: 'strikeDamage', ref: { kind: 'strikeDamage' as const, instanceId: s.instanceId! } },
    ]),
    ...(['fortitude', 'reflex', 'will'] as const).map((save) => ({ key: save, ref: { kind: 'save' as const, save } })),
    ...SKILLS.map((skill) => ({ key: skill, ref: { kind: 'skill' as const, skill } })),
    ...loreKeys.map((skill) => ({ key: skill, ref: { kind: 'skill' as const, skill: skill as never } })),
  ];
  for (const { key, ref } of refs) {
    try { if (statMarkClass(ch, ref, db).includes('has-mode')) stars[key] = true; } catch { /* a ref this build cannot answer is not evidence */ }
  }
  let critSpec = 0;
  try { critSpec = critSpecSources(ch, db).length; } catch { /* not evidence */ }
  return {
    stars,
    speeds: snap.speeds ?? null,
    defenses: snap.defenses ?? null,
    critSpec,
    proficiencies: c.proficiencies ?? null,
    spellcasting: ((c.spellcasting as Entry[] | undefined) ?? []).map((e) => ({
      id: e.id, type: e.type, tradition: e.tradition, proficiency: e.proficiency,
      cantripCap: e.cantripCap ?? null, cantripsPrepared: !!e.cantripsPrepared,
      slotRanks: Object.keys(e.prepared ?? e.slots ?? e.repertoire ?? {}).length,
    })),
    featNames: ((c.feats as { featId: string }[] | undefined) ?? []).map((f) => db.feats[f.featId]?.name).filter(Boolean),
    featureNames: ((snap.ownedFeatures as string[] | undefined) ?? []).map((id) => db.classFeatures[id]?.name).filter(Boolean),
    spellNames: [...spellIds].map((id) => spells[id]?.name).filter(Boolean),
    languages: c.languages ?? [],
    // The single reader every consumer goes through (ancestry + heritage/feat grants + chosen), not the
    // answer-driven array alone — a heritage's `grantsCreatureTraits` never reached the latter.
    traits: creatureTraitsOf(c as unknown as Character, db).map((t) => t.trait).filter(Boolean),
  };
}

/**
 * Drop the diff paths that only say "the record is now owned" — the mechanics must show beyond them.
 *
 * `ownedFeatures` is a plain string array, so removing one feature shifts every later index and the
 * generic diff reports 20 "changes" that are the same ids at new positions. Those are replaced by the
 * SET difference: one synthetic change per feature the record newly grants (other than itself).
 */
function attributable(
  changes: { path: string; before?: unknown; after?: unknown }[],
  row: Row,
  owned: { before: string[]; after: string[] },
): { path: string; before?: unknown; after?: unknown }[] {
  const idTag = `[${row.id}]`;
  const own = new Set(['stored.heritageId', 'stored.backgroundId', 'stored.ancestryId', 'stored.classId', 'stored.subclassId']);
  const kept = changes.filter(
    (c) =>
      !c.path.includes(idTag) && !own.has(c.path) && !c.path.startsWith(`stored.feats[${row.id}]`) && !c.path.startsWith('ownedFeatures[') &&
      // An item's own inventory row is not an effect of the item.
      !(row.bucket === 'items' && c.path.startsWith('stored.inventory')),
  );
  const before = new Set(owned.before);
  for (const id of owned.after) if (!before.has(id) && id !== row.id) kept.push({ path: `ownedFeatures+${id}`, before: null, after: id });
  return kept;
}

/* ---- REAL-CHARACTER MODE ------------------------------------------------------------------------- */

type CharacterExport = { build: BuildState; play?: { inventory?: { itemId: string }[] } };

/** Every record the exported character owns, as rows for the judge. */
function characterRows(db: ContentDatabase, exp: CharacterExport): Row[] {
  const b = exp.build;
  const ch = buildCharacter(b, db);
  const rows: Row[] = [];
  const add = (bucket: string, id: string | null | undefined) => {
    if (!id) return;
    const rec = (db as unknown as Record<string, Record<string, { name?: string; level?: number | null }>>)[bucket]?.[id];
    if (!rec || rows.some((r) => r.bucket === bucket && r.id === id)) return;
    rows.push({ bucket, id, name: rec.name ?? id, level: rec.level ?? null });
  };
  add('ancestries', b.ancestryId);
  add('heritages', b.heritageId);
  if (b.backgroundId && b.backgroundId !== '__custom__') add('backgrounds', b.backgroundId);
  for (const f of ch.feats) add('feats', f.featId);
  if (b.classId) for (const id of classFeatureIdsOwned({ classId: b.classId, subclassId: b.subclassId ?? null, level: b.level }, db)) add('classFeatures', id);
  for (const it of exp.play?.inventory ?? []) add('items', it.itemId);
  return rows;
}

/** The character's own build is the WITH host; WITHOUT takes exactly that one record away. */
function characterHost(db: ContentDatabase, exp: CharacterExport, row: Row): Host {
  const cb = exp.build;
  const pages = pagesFor(cb.level);
  const meta0 = { classId: cb.classId, ancestryId: cb.ancestryId, level: cb.level, character: cb.name };
  const host = (withoutBuild: BuildState, without: string, extra: Record<string, unknown> = {}): Host => ({
    supported: true, withBuild: cb, withoutBuild, withDb: db, withoutDb: db, sheetBuild: cb, pages, meta: { ...meta0, without, ...extra },
  });
  if (row.bucket === 'feats') {
    const slot = Object.entries(cb.featPicks ?? {}).find(([, v]) => v === row.id)?.[0];
    if (slot) return host({ ...cb, featPicks: { ...cb.featPicks, [slot]: null } }, 'slot-empty', { slotKey: slot, slotRendered: true });
    const pick = Object.entries(cb.pickFeatChoices ?? {}).find(([, v]) => v === row.id)?.[0];
    if (pick) {
      const p = { ...(cb.pickFeatChoices ?? {}) };
      delete p[pick];
      return host({ ...cb, pickFeatChoices: p }, 'pick-unanswered', { slotKey: pick, slotRendered: true, via: 'pick' });
    }
    if (cb.customBackground?.skillFeatId === row.id) return host({ ...cb, customBackground: { ...cb.customBackground, skillFeatId: null } }, 'background-feat-null');
    const granter = buildCharacter(cb, db).feats.find((f) => f.featId === row.id)?.grantedBy ?? null;
    return { supported: false, reason: `granted by ${granter ?? 'a record the build does not name'} — judged with that record`, withBuild: cb, withoutBuild: cb, withDb: db, withoutDb: db, pages: [], meta: { ...meta0, grantedBy: granter } };
  }
  if (row.bucket === 'classFeatures' && cb.classId) return classFeatureHost(db, row.id, { build: cb, owner: { classId: cb.classId, subclassId: cb.subclassId ?? null } });
  if (row.bucket === 'heritages') return host({ ...cb, heritageId: null }, 'heritage-null');
  if (row.bucket === 'ancestries') return host({ ...cb, ancestryId: null, heritageId: null }, 'ancestry-null');
  if (row.bucket === 'backgrounds') return host({ ...cb, backgroundId: null }, 'background-null');
  if (row.bucket === 'items') return { supported: true, kind: 'item', itemId: row.id, withBuild: cb, withoutBuild: cb, withDb: db, withoutDb: db, pages: ['item'], meta: { ...meta0, without: 'not-in-inventory', note: 'worn + equipped + invested on the character; controls read off the sheet ItemDetail card' } };
  return { supported: false, reason: `no host strategy for bucket ${row.bucket}`, withBuild: cb, withoutBuild: cb, withDb: db, withoutDb: db, pages: [], meta: meta0 };
}

describe('wg experience harness', () => {
  const run = (BATCH || CHARACTER) && OUT ? it : it.skip;
  run(
    'records the controls and sheet effects every record in the batch adds',
    () => {
      const db = content();
      const character = CHARACTER ? (JSON.parse(readFileSync(CHARACTER, 'utf8').replace(/^﻿/, '')) as CharacterExport) : null;
      const batch: Row[] = character ? characterRows(db, character) : (JSON.parse(readFileSync(BATCH!, 'utf8').replace(/^﻿/, '')) as Row[]);
      const records: Record<string, unknown>[] = [];
      const started = Date.now();
      for (const row of batch) {
        const t0 = Date.now();
        const rec: Record<string, unknown> = { id: row.id, bucket: row.bucket, name: row.name, level: row.level };
        try {
          const host = character ? characterHost(db, character, row) : hostFor(db, row);
          rec.supported = host.supported;
          rec.host = host.meta;
          if (!host.supported) {
            rec.reason = host.reason;
          } else if (host.kind === 'item') {
            // The sheet's live character with and without the item (worn, equipped, invested).
            const base = buildCharacter(host.withBuild, db);
            const play0 = initialPlay(base, db);
            let play1 = addInventoryItem(play0, host.itemId!, { worn: true, equipped: true, invested: true });
            const controls = collectItemControls(db, applyPlayState(base, play1, db), host.itemId!);
            // PLAY the item: a consumable is drunk (its mode switches on), an item that owns a mode has it
            // toggled — otherwise a potion of resistance reads as doing nothing (its whole effect is the mode).
            const itemRec = db.items[host.itemId!] as { itemType?: string } | undefined;
            const ownsMode = Object.values((db as unknown as { modes?: Record<string, { fromItemId?: string }> }).modes ?? {}).some((m) => m.fromItemId === host.itemId);
            const instance = (play1.inventory ?? []).find((i) => i.itemId === host.itemId)?.instanceId;
            if (ownsMode && instance) {
              play1 = itemRec?.itemType === 'consumable'
                ? useConsumable(play1, instance, (db as unknown as { modes?: never }).modes)
                : toggleItemMode(play1, instance, (db as unknown as { modes?: never }).modes);
              (rec.host as Record<string, unknown>).played = itemRec?.itemType === 'consumable' ? 'consumed (mode on)' : 'mode toggled on';
            }
            const withoutC = applyPlayState(base, play0, db);
            const withC = applyPlayState(base, play1, db);
            rec.pages = 1;
            rec.controlsWith = controls.length;
            rec.controlsAdded = controls;
            rec.controlsRemoved = [];
            let sheet: { path: string; before: unknown; after: unknown }[] = [];
            let sheetError: string | null = null;
            let owned = { before: [] as string[], after: [] as string[] };
            try {
              const a = snapshot(withoutC, db) as { ownedFeatures?: string[] };
              const b = snapshot(withC, db) as { ownedFeatures?: string[] };
              owned = { before: a.ownedFeatures ?? [], after: b.ownedFeatures ?? [] };
              sheet = diff(a, b) as typeof sheet;
              rec.surface = surfaceOf(withC as unknown as Record<string, unknown>, db, b as Record<string, unknown>);
            } catch (e) {
              sheetError = String((e as Error)?.message ?? e);
            }
            const own = attributable(sheet, row, owned);
            rec.sheetDiffAll = sheet.length;
            rec.sheetDiffCount = own.length;
            rec.sheetDiff = own.slice(0, 40);
            if (sheetError) rec.sheetError = sheetError;
          } else {
            const withC = collectControls(host.withDb, host.withBuild, host.pages);
            const withoutC = collectControls(host.withoutDb, host.withoutBuild, host.pages);
            const { added, removed } = ctlDiff(withC, withoutC);
            rec.pages = host.pages.length;
            rec.controlsWith = withC.length;
            rec.controlsAdded = added;
            rec.controlsRemoved = removed;
            /* Pickers present in BOTH builds. A class-feature's question can be answered by a control the
             * CLASS owns (the commander's tactics folio, the runesmith's runes, the thaumaturge's
             * implements) that the record's removal cannot switch off; the judge may attribute one of
             * these to an otherwise unanswered select, and says so when it does. Titles only. */
            const inBoth = new Set(withoutC.map(ctlKey));
            rec.controlsBoth = withC
              .filter((c) => inBoth.has(ctlKey(c)) && ['multi', 'popup', 'search', 'slot', 'spell'].includes(c.ctl))
              .map((c) => ({ page: c.page, ctl: c.ctl, title: c.title, options: c.options, capacity: c.capacity ?? null }));
            let sheet: { path: string; before: unknown; after: unknown }[] = [];
            let sheetError: string | null = null;
            let owned = { before: [] as string[], after: [] as string[] };
            try {
              const a = snapshot(buildCharacter(host.withoutBuild, host.withoutDb), host.withoutDb) as { ownedFeatures?: string[] };
              const withChar = buildCharacter(host.sheetBuild ?? host.withBuild, host.withDb);
              const b = snapshot(withChar, host.withDb) as { ownedFeatures?: string[] };
              owned = { before: a.ownedFeatures ?? [], after: b.ownedFeatures ?? [] };
              sheet = diff(a, b) as typeof sheet;
              rec.surface = surfaceOf(withChar as unknown as Record<string, unknown>, host.withDb, b as Record<string, unknown>);
            } catch (e) {
              sheetError = String((e as Error)?.message ?? e);
            }
            const own = attributable(sheet, row, owned);
            rec.sheetDiffAll = sheet.length;
            rec.sheetDiffCount = own.length;
            rec.sheetDiff = own.slice(0, 40);
            if (sheetError) rec.sheetError = sheetError;
          }
        } catch (e) {
          rec.supported = rec.supported ?? true;
          rec.error = String((e as Error)?.stack ?? e).slice(0, 600);
        }
        rec.ms = Date.now() - t0;
        records.push(rec);
      }
      const out = { batch: BATCH, generated: new Date().toISOString(), records, ms: Date.now() - started };
      writeFileSync(OUT!, JSON.stringify(out, null, 1));
      expect(records.length).toBe(batch.length);
    },
    60 * 60 * 1000,
  );
});
