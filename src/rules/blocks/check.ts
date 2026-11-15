/*
 * The blocks guard (docs/overrides-redesign.md, Building blocks items 1, 2, 3, 11, 12; decision 24),
 * as a PURE function so a test can plant each bad case in memory and watch it fail.
 * `scripts/blocks-check.mjs` feeds it the real files and runs in `npm run verify`.
 *
 * It fails when:
 *   - a catalog row has no status, a "ruled" row names no ruling, an id repeats, a family or place or
 *     phase is not one of the allowed values;
 *   - a feature of the design's Feature list (dropped ones included), or a lane key of
 *     docs/mechanic-lanes.md (every "lane" table), is in no catalog row and no notBlocks entry — or the
 *     catalog names a feature or lane the documents do not have;
 *   - a registry entry has no "built" catalog row, or a "built" row has no registry entry, or their
 *     family or Tweaks place differ;
 *   - a registry entry whose editor is not on the Tweaks screen is not on STILL_TO_ADD with a reason,
 *     or one whose editor is built is still listed there;
 *   - a built catalog row and its registry entry list different bookFields;
 *   - an entry uses an editor part, source kind or old Overrides key that does not exist;
 *   - an entry's `group` is not one of the Tweaks page's groups, or a menu that holds two kinds for the same
 *     target lacks a chooser label (`editor.option`) on one of them or gives both the same label (plan B, B19);
 *   - an entry accepts a target kind the target registry does not have for that aspect;
 *   - an entry's test file is missing or has no it()/describe() title naming the entry's id;
 *   - a file under src/rules/blocks/ imports from scripts/, work/ or the batch tools (item 12);
 *   - (checkBookFieldReaders, item 10) a file under src/ READS a moved book field (the registry's
 *     `bookFields`) anywhere but blocks/book.ts, with no BOOK_FIELD_ALLOW entry — or an entry is stale;
 *   - (checkFeatReaders, item 9 / case D) a place names the raw feat stores (`featPicks`, `addedFeats`)
 *     that blocks/feat-readers.json does not list with a reason, or more or fewer times than it lists;
 *   - (checkOverridesReaders, spec item 4 "one reader") a place outside the Tweaks home files names
 *     `overrides` that blocks/overrides-readers.json does not list with a reason, or more or fewer times;
 *   - (checkVisibleOverrideWords, spec item 1, plan B section 7.2) text a player could read says "override"
 *     outside VISIBLE_WORDS_SKIP and with no `// tweaks-ok: <reason>` marker, or a skip entry / marker is stale.
 *   - (checkChoiceKinds, Tweaks phase 2 WP1) a choice kind has no `rowText` case in blocks/wgExport.ts, a place
 *     it accepts or a rule it lists has no words (`placeWords` / `ruleWords`), or no test title names it;
 *   - (Tweaks phase 2 WP1, rev 3 finding 20) a `bookOnly: true` row is "built", or is a "to-add" row with no
 *     bookFields (outside BOOK_ONLY_NO_FIELDS, each with its reason; a stale entry fails too).
 * It prints (never fails on) the "not in Tweaks yet" list and the kinds that nothing applies yet; the to-add
 * rows marked bookOnly are printed apart from the per-phase count ("book-only, waits for the re-implementation").
 */
import { TWEAK_GROUPS, isChoiceKind, placeWords as registryPlaceWords, ruleWords as registryRuleWords, type BlockKindDef } from './registry';
import type { OwnerDef, TargetDef } from './targets';

export interface BlocksCheckInput {
  registry: BlockKindDef[];
  stillToAdd: { id: string; why: string }[];
  editorParts: readonly string[];
  sourceKinds: readonly string[];
  targets: TargetDef[];
  owners: OwnerDef[];
  /** catalog.json, parsed. */
  catalog: unknown;
  /** docs/overrides-redesign.md and docs/mechanic-lanes.md, as text. */
  designDoc: string;
  lanesDoc: string;
  /** Every file under src/rules/blocks/, as text. */
  blockFiles: { path: string; text: string }[];
  /** Read a repo file (for the test files); null when it does not exist. */
  readFile: (path: string) => string | null;
  /** The Tweaks page's list headings a kind's `group` may name (plan B, B19); registry TWEAK_GROUPS when absent. */
  tweakGroups?: readonly string[];
  /** The place / rule wording (registry `placeWords` / `ruleWords` when absent; a test plants a gap here). */
  placeWords?: (p: Record<string, unknown>) => string | undefined;
  ruleWords?: (rule: unknown) => string | undefined;
  /** The to-add bookOnly rows allowed no bookFields (BOOK_ONLY_NO_FIELDS when absent; a planted catalog passes its own). */
  bookOnlyNoFields?: { id: string; why: string }[];
}

/**
 * The to-add rows allowed `bookOnly: true` with no bookFields, each with the reason (rev 3, finding 20: a
 * book-only to-add row names the book fields it waits for; these rows' book data is not a record field).
 * An entry whose row is gone, not to-add, not bookOnly or has bookFields now fails the check (stale).
 */
export const BOOK_ONLY_NO_FIELDS: { id: string; why: string }[] = [
  { id: 'structure.advancement', why: 'its book data is the CLASS_ADVANCEMENT code table (src/rules/advancement.ts), not a record field' },
];

const WG_EXPORT_FILE = 'src/rules/blocks/wgExport.ts';

export interface BlocksCheckResult {
  errors: string[];
  info: string[];
}

const LEGACY_KEYS = ['allowedFeats', 'addedFeats', 'addedFeatures', 'removedFeatIds', 'attributes', 'proficiencies', 'addedLanguages', 'addedSpells', 'maxHp', 'contentEdits'];
const STATUSES = ['built', 'to-add', 'ruled'];
const PLACES = ['main', 'advanced'];
const APPLIES = ['blocks', 'legacy', 'not-yet'];

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const strArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((s) => typeof s === 'string');
const numArr = (x: unknown): x is number[] => Array.isArray(x) && x.every((n) => Number.isInteger(n));

/** The feature numbers of the design's "## Feature list" section (up to "## Dropped ideas"). */
export function featureNumbers(designDoc: string): number[] {
  const start = designDoc.indexOf('\n## Feature list');
  const end = designDoc.indexOf('\n## Dropped ideas', start);
  if (start < 0 || end < 0) return [];
  const out: number[] = [];
  // A dropped feature keeps its number, struck through ("37. ~~The GM sees marks~~: dropped").
  for (const m of designDoc.slice(start, end).matchAll(/^(\d+)\. (?:⭐ )?(?:\*\*|~~)/gm)) out.push(Number(m[1]));
  return out;
}

/**
 * The lane keys of docs/mechanic-lanes.md: the backticked names in the FIRST cell of every row of a
 * table whose header's first cell is "lane" — sections A–K, "Lanes this app does NOT have", and the
 * later sub-sections that add a lane (enhancement, dedicationGate). Rows after a blank line, before the
 * next heading or table header, still belong to the table above (section E has such rows). Read
 * independently of the catalog — never from it.
 */
export function laneKeys(lanesDoc: string): string[] {
  const lines = lanesDoc.split(/\r?\n/);
  const out = new Set<string>();
  let inLaneTable = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#')) inLaneTable = false;
    if (!line.startsWith('|')) continue;
    if (/^\|\s*-/.test(line)) continue;
    const firstCell = line.split('|')[1]?.trim() ?? '';
    if (/^\|\s*-/.test(lines[i + 1] ?? '')) {
      inLaneTable = firstCell === 'lane';
      continue;
    }
    if (!inLaneTable) continue;
    for (const m of firstCell.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)) out.add(m[1]);
  }
  return [...out];
}

/** The titles of every it( / describe( / test( call in a test file. */
export function testTitles(text: string): string[] {
  return [...text.matchAll(/\b(?:it|describe|test)(?:\.\w+)?\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
}

export function checkBlocks(input: BlocksCheckInput): BlocksCheckResult {
  const errors: string[] = [];
  const info: string[] = [];
  const err = (m: string) => errors.push(m);

  /* ── the catalog ── */
  const cat = input.catalog;
  if (!isObj(cat) || !strArr(cat.families) || !Array.isArray(cat.rows) || !Array.isArray(cat.notBlocks)) {
    err('catalog.json: needs "families" (strings), "rows" and "notBlocks" (arrays)');
    return { errors, info };
  }
  const families = cat.families;
  const rows = cat.rows as Record<string, unknown>[];
  const ids = new Set<string>();
  const featuresSeen = new Set<number>();
  const lanesSeen = new Set<string>();
  const allLanes = new Set(laneKeys(input.lanesDoc));
  const allFeatures = featureNumbers(input.designDoc);
  if (!allFeatures.length) err('docs/overrides-redesign.md: no "## Feature list" items found — the coverage check cannot run');
  if (!allLanes.size) err('docs/mechanic-lanes.md: no lane tables found — the coverage check cannot run');
  const catalogLanes = (where: string, lanes: string[]) => {
    for (const l of lanes) {
      lanesSeen.add(l);
      if (allLanes.size && !allLanes.has(l)) err(`${where}: names lane "${l}", which docs/mechanic-lanes.md does not have`);
    }
  };
  const builtRows = new Map<string, Record<string, unknown>>();
  const noFieldsOk = input.bookOnlyNoFields ?? BOOK_ONLY_NO_FIELDS;
  rows.forEach((r, i) => {
    const where = `catalog row ${isObj(r) && typeof r.id === 'string' ? r.id : `#${i}`}`;
    if (!isObj(r)) return err(`${where}: not an object`);
    if (typeof r.id !== 'string' || !/^[a-z]+\.[A-Za-z0-9]+$/.test(r.id)) err(`${where}: id must be "<family>.<name>"`);
    else if (ids.has(r.id)) err(`${where}: id appears twice`);
    else ids.add(r.id);
    if (typeof r.family !== 'string' || !families.includes(r.family)) err(`${where}: family "${String(r.family)}" is not in "families"`);
    else if (typeof r.id === 'string' && !r.id.startsWith(`${r.family}.`)) err(`${where}: id does not start with its family "${r.family}."`);
    if (typeof r.title !== 'string' || !r.title.trim()) err(`${where}: no title`);
    if (!Number.isInteger(r.phase) || (r.phase as number) < 1 || (r.phase as number) > 6) err(`${where}: phase must be 1–6`);
    if (!PLACES.includes(r.place as string)) err(`${where}: place must be "main" or "advanced"`);
    if (!STATUSES.includes(r.status as string)) err(`${where}: no status (built, to-add or ruled)`);
    if (r.status === 'ruled' && (typeof r.ruling !== 'string' || !r.ruling.trim())) err(`${where}: status "ruled" names no ruling`);
    if (r.status !== 'ruled' && r.ruling != null) err(`${where}: a ruling on a row that is not "ruled"`);
    if (r.status === 'built' && r.registry !== true) err(`${where}: a built row needs "registry": true`);
    if (r.status !== 'built' && r.registry != null) err(`${where}: "registry" on a row that is not built`);
    if (!numArr(r.features)) err(`${where}: features must be a list of numbers`);
    else for (const n of r.features) featuresSeen.add(n);
    if (!strArr(r.lanes)) err(`${where}: lanes must be a list of lane keys`);
    else catalogLanes(where, r.lanes);
    if (!strArr(r.bookFields)) err(`${where}: bookFields must be a list`);
    if (typeof r.bookOnly !== 'boolean') err(`${where}: bookOnly must be true or false`);
    // Rev 3 (finding 20): bookOnly marks a kind no tweak writes. A built row is a registered tweak kind, so it
    // never carries the mark; a to-add row carries it only with the book fields it waits for.
    if (r.bookOnly === true && r.status === 'built') err(`${where}: bookOnly on a "built" row — a registered kind is not book-only`);
    if (r.bookOnly === true && r.status === 'to-add' && strArr(r.bookFields) && !r.bookFields.length && !noFieldsOk.some((x) => x.id === r.id)) {
      err(`${where}: bookOnly on a "to-add" row with no bookFields — name the book fields it waits for (or list it in BOOK_ONLY_NO_FIELDS with the reason)`);
    }
    if (typeof r.note !== 'string') err(`${where}: no note`);
    if (r.status === 'built' && typeof r.id === 'string') builtRows.set(r.id, r);
  });
  (cat.notBlocks as unknown[]).forEach((n, i) => {
    const where = `catalog notBlocks #${i}`;
    if (!isObj(n)) return err(`${where}: not an object`);
    if (typeof n.why !== 'string' || !n.why.trim()) err(`${where}: no "why"`);
    if (n.features != null && !numArr(n.features)) err(`${where}: features must be a list of numbers`);
    else for (const f of (n.features as number[] | undefined) ?? []) featuresSeen.add(f);
    if (n.lanes != null && !strArr(n.lanes)) err(`${where}: lanes must be a list of lane keys`);
    else catalogLanes(where, (n.lanes as string[] | undefined) ?? []);
  });
  for (const f of allFeatures) if (!featuresSeen.has(f)) err(`feature ${f} of the design's Feature list is in no catalog row and no notBlocks entry`);
  for (const n of featuresSeen) if (allFeatures.length && !allFeatures.includes(n)) err(`the catalog names feature ${n}, which the Feature list does not have`);
  for (const l of allLanes) if (!lanesSeen.has(l)) err(`lane "${l}" of docs/mechanic-lanes.md is in no catalog row and no notBlocks entry`);
  for (const x of noFieldsOk) {
    const r = rows.find((row) => isObj(row) && row.id === x.id);
    if (!x.why.trim()) err(`BOOK_ONLY_NO_FIELDS ${x.id}: no reason`);
    if (!r || r.status !== 'to-add' || r.bookOnly !== true || !strArr(r.bookFields) || r.bookFields.length) {
      err(`BOOK_ONLY_NO_FIELDS ${x.id}: stale — no to-add bookOnly row with empty bookFields has this id; remove the entry`);
    }
  }

  /* ── the target registry ── */
  const ownerKinds = new Set(input.owners.map((o) => o.kind as string));
  const builtOwners = new Set(input.owners.filter((o) => o.built).map((o) => o.kind as string));
  const targetKeys = new Set<string>();
  for (const t of input.targets) {
    const k = `${t.kind}/${t.aspect}/${t.owner}`;
    if (targetKeys.has(k)) err(`target ${k} appears twice`);
    targetKeys.add(k);
    if (!ownerKinds.has(t.owner)) err(`target ${k}: owner "${t.owner}" is not in OWNERS`);
    if (t.built && !builtOwners.has(t.owner)) err(`target ${k}: built, but its owner "${t.owner}" is not`);
    if (!Number.isInteger(t.phase) || t.phase < 1 || t.phase > 6) err(`target ${k}: phase must be 1–6`);
  }

  /* ── the block registry, against the catalog and the targets ── */
  const regIds = new Set<string>();
  const notInTweaks: string[] = [];
  for (const k of input.registry) {
    const where = `registry ${k.id}`;
    if (regIds.has(k.id)) err(`${where}: id appears twice`);
    regIds.add(k.id);
    const row = builtRows.get(k.id);
    if (!row) err(`${where}: no catalog row with status "built" and this id`);
    else {
      if (row.family !== k.family) err(`${where}: family "${k.family}" but the catalog says "${String(row.family)}"`);
      if (k.editor && row.place !== k.editor.place) err(`${where}: editor place "${k.editor.place}" but the catalog says "${String(row.place)}"`);
      const sorted = (x: unknown) => (strArr(x) ? [...x].sort().join(', ') : '');
      if (sorted(row.bookFields) !== sorted(k.bookFields ?? [])) err(`${where}: bookFields [${sorted(k.bookFields ?? [])}] but the catalog says [${sorted(row.bookFields)}]`);
    }
    if (!Number.isInteger(k.version) || k.version < 1) err(`${where}: version must be a whole number from 1`);
    if (k.storage.in === 'legacy' && !LEGACY_KEYS.includes(k.storage.key)) err(`${where}: "${k.storage.key}" is not one of today's Overrides keys`);
    if (!k.sources.length || k.sources.some((s) => !input.sourceKinds.includes(s))) err(`${where}: sources must be book, tweak or homebrew`);
    if (k.missing !== 'show-broken') err(`${where}: missing must be "show-broken" (decision 13)`);
    if (!APPLIES.includes(k.applies)) err(`${where}: applies must be blocks, legacy or not-yet`);
    // Decision 24: a kind whose editor is not on the Tweaks screen is on STILL_TO_ADD, with a reason —
    // and a kind whose editor IS on the screen is not (a stale line hides nothing, but lies).
    const later = input.stillToAdd.find((s) => s.id === k.id);
    const inTweaks = !!k.editor?.built;
    if (!inTweaks && (!later || !later.why.trim())) err(`${where}: not in Tweaks yet and not on STILL_TO_ADD with a reason (decision 24)`);
    if (inTweaks && later) err(`${where}: its editor is built, but STILL_TO_ADD still lists it`);
    if (!inTweaks) notInTweaks.push(k.id);
    // B19: every kind names the Tweaks page heading its rows are listed under, one of the known ones.
    const groups = input.tweakGroups ?? TWEAK_GROUPS;
    if (typeof k.group !== 'string' || !groups.includes(k.group)) err(`${where}: group "${String(k.group)}" is not one of the Tweaks page's groups (${groups.join(', ')})`);
    if (k.editor) {
      if (!PLACES.includes(k.editor.place)) err(`${where}: editor place must be "main" or "advanced"`);
      if (!k.editor.menus.length) err(`${where}: editor has no menu entry`);
      for (const p of [...k.editor.parts, ...(k.editor.advancedParts ?? [])]) if (!input.editorParts.includes(p)) err(`${where}: editor part "${p}" is not in EDITOR_PARTS`);
    }
    if ('aspect' in k.accepts) {
      const { aspect, kinds } = k.accepts;
      if (!kinds.length) err(`${where}: accepts no target`);
      for (const tk of kinds) if (!input.targets.some((t) => t.kind === tk && t.aspect === aspect)) err(`${where}: accepts target "${tk}" (${aspect}), which the target registry does not have`);
      if (!input.targets.some((t) => t.built && t.aspect === aspect && kinds.includes(t.kind))) err(`${where}: none of its targets is built`);
    } else {
      // records / pickers / places / questions (phase 2): one non-empty list of names, each named once.
      const list = Object.values(k.accepts)[0] as unknown;
      const member = Object.keys(k.accepts)[0];
      if (Object.keys(k.accepts).length !== 1 || !strArr(list) || !list.length) err(`${where}: accepts.${member} must be one non-empty list of names`);
      else if (new Set(list).size !== list.length) err(`${where}: accepts.${member} names a value twice`);
    }
    if (k.rules != null && (!strArr(k.rules) || !k.rules.length)) err(`${where}: rules must be a non-empty list of names`);
    // "Every entry has a test": the id must be in the TITLE of an it() / describe() / test() there — a
    // name in a list of ids somewhere in the file is not a test of the kind.
    const text = input.readFile(k.test);
    if (text == null) err(`${where}: its test file ${k.test} does not exist`);
    else {
      // Whole names only: a title naming 'number.setMaxHp' is not a test of 'number.set'.
      const named = new RegExp(`(^|[^A-Za-z0-9.])${k.id.replace(/\./g, '\\.')}(?![A-Za-z0-9])`);
      if (!testTitles(text).some((t) => named.test(t))) err(`${where}: no it()/describe() title in ${k.test} names '${k.id}'`);
    }
  }
  // B19, the shared-menu rule: when one "Add a tweak" menu holds two kinds that accept the same target (same
  // aspect and target kind, or the same record collection), the editor needs a chooser — so each of them
  // names its `editor.option`, and no two of them name the same label.
  const shareTarget = (a: BlockKindDef, b: BlockKindDef): boolean => {
    if ('aspect' in a.accepts && 'aspect' in b.accepts) {
      const bk = b.accepts.kinds;
      return a.accepts.aspect === b.accepts.aspect && a.accepts.kinds.some((x) => bk.includes(x));
    }
    // records, and the phase-2 pickers / places / questions: the same member, and a value both name.
    for (const m of ['records', 'pickers', 'places', 'questions'] as const) {
      if (m in a.accepts && m in b.accepts) {
        const al = (a.accepts as Record<string, readonly string[]>)[m];
        const bl = (b.accepts as Record<string, readonly string[]>)[m];
        return al.some((x) => bl.includes(x));
      }
    }
    return false;
  };
  const byMenu = new Map<string, BlockKindDef[]>();
  for (const k of input.registry) for (const m of k.editor?.menus ?? []) byMenu.set(m, [...(byMenu.get(m) ?? []), k]);
  for (const [menu, kinds] of byMenu) {
    for (let i = 0; i < kinds.length; i++) {
      for (let j = i + 1; j < kinds.length; j++) {
        const [a, b] = [kinds[i], kinds[j]];
        if (!shareTarget(a, b)) continue;
        for (const k of [a, b]) if (!k.editor?.option?.trim()) err(`registry ${k.id}: menu "${menu}" holds ${a.id} and ${b.id} for the same target, so ${k.id} needs editor.option (the chooser label, B19)`);
        if (a.editor?.option?.trim() && a.editor.option.trim() === b.editor?.option?.trim()) err(`registry ${a.id} / ${b.id}: menu "${menu}" offers both as "${a.editor.option}" — the chooser labels must differ (B19)`);
      }
    }
  }
  for (const id of builtRows.keys()) if (!regIds.has(id)) err(`catalog row ${id}: status "built" but the registry has no entry with this id`);
  for (const s of input.stillToAdd) if (!regIds.has(s.id)) err(`STILL_TO_ADD names "${s.id}", which the registry does not have`);

  /* ── item 12: blocks never depend on the batch tools ── */
  for (const f of input.blockFiles) {
    for (const m of f.text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (/(^|\/)(scripts|work)\//.test(spec) || /wg-batch|apply-parity|trust-ledger/.test(spec)) err(`${f.path}: imports "${spec}" — blocks must not depend on scripts/, work/ or the batch tools`);
    }
  }

  /* ── Tweaks phase 2: every choice kind prints and is tested ── */
  const choice = checkChoiceKinds({
    registry: input.registry,
    wgExport: input.blockFiles.find((f) => f.path === WG_EXPORT_FILE)?.text ?? null,
    readFile: input.readFile,
    placeWords: input.placeWords,
    ruleWords: input.ruleWords,
  });
  errors.push(...choice.errors);

  /* ── what the check prints ── */
  // Rev 3 (finding 20): a to-add row marked bookOnly waits for the re-implementation (decision 25), so it is
  // printed apart, out of the per-phase count of what a phase still owes.
  const bookOnlyWaiting = rows.filter((r) => isObj(r) && r.status === 'to-add' && r.bookOnly === true);
  const toAdd = rows.filter((r) => isObj(r) && r.status !== 'built' && !(r.status === 'to-add' && r.bookOnly === true));
  const byPhase = new Map<number, number>();
  for (const r of toAdd) byPhase.set(r.phase as number, (byPhase.get(r.phase as number) ?? 0) + 1);
  info.push(`catalog: ${rows.length} kinds — ${builtRows.size} built, ${toAdd.length} still to add or shaped by a ruling (${[...byPhase].sort((a, b) => a[0] - b[0]).map(([p, n]) => `phase ${p}: ${n}`).join(', ')}); book-only, waits for the re-implementation: ${bookOnlyWaiting.length}`);
  info.push(`not in Tweaks yet (no editor on the screen): ${notInTweaks.length ? notInTweaks.join(', ') : 'none'}`);
  const notYet = input.registry.filter((k) => k.applies === 'not-yet').map((k) => k.id);
  info.push(`registered but nothing applies them yet: ${notYet.length ? notYet.join(', ') : 'none'}`);
  return { errors, info };
}

/* ───────────── Tweaks phase 2 (WP1): the choice kinds, lite ───────────── */

export interface ChoiceKindsInput {
  registry: BlockKindDef[];
  /** src/rules/blocks/wgExport.ts, as text (null when missing). */
  wgExport: string | null;
  readFile: (path: string) => string | null;
  placeWords?: (p: Record<string, unknown>) => string | undefined;
  ruleWords?: (rule: unknown) => string | undefined;
}

/** A sample of every field a place may name, so `placeWords` has what it needs for each place kind. */
const PLACE_SAMPLE = { level: 4, category: 'class', set: 'level', lane: 'main', ordinal: 0, index: 0 };

/**
 * Every choice kind (registry `isChoiceKind`: stored in `overrides.blocks`, pointing at records, pickers,
 * places or questions rather than a stat) has:
 *   - its own `case '<id>'` in wgExport.ts's `rowText`, so the Wanderer's Guide list names it (C34) rather than
 *     falling back to the bare title — WP13: only a kind this version applies. A kind nothing applies yet
 *     (`applies: 'not-yet'`) reads as a newer app's block and is listed as one, so a case for it is an error
 *     (the C34 list holds the built kinds only);
 *   - words for every place it accepts (`placeWords`) and every rule it lists (`ruleWords`), so no row,
 *     breakdown line or export line prints "undefined";
 *   - a test title naming its id (the generic registry check asks the same; this one reads the file again so
 *     the rule stands on its own).
 */
export function checkChoiceKinds(input: ChoiceKindsInput): BlocksCheckResult {
  const errors: string[] = [];
  const err = (m: string) => errors.push(m);
  const pw = input.placeWords ?? registryPlaceWords;
  const rw = input.ruleWords ?? registryRuleWords;
  const kinds = input.registry.filter((k) => isChoiceKind(k));
  const ids = new Set(kinds.map((k) => k.id));
  const exportCode = input.wgExport == null ? null : codeOnly(input.wgExport, ids);
  for (const k of kinds) {
    const where = `choice kind ${k.id}`;
    const hasCase = exportCode != null && new RegExp(`\\bcase\\s+'${k.id.replace(/\./g, '\\.')}'\\s*:`).test(exportCode);
    if (k.applies === 'not-yet') {
      if (hasCase) err(`${where}: nothing applies it yet, so its stored block reads as a newer app's — "case '${k.id}':" in ${WG_EXPORT_FILE} can never run (C34 lists the built kinds only)`);
    } else if (exportCode == null) err(`${where}: ${WG_EXPORT_FILE} is missing, so no rowText case can name it`);
    else if (!hasCase) err(`${where}: no "case '${k.id}':" in ${WG_EXPORT_FILE}'s rowText — the Wanderer's Guide list would print only its title (C34)`);
    if ('places' in k.accepts) {
      for (const place of k.accepts.places) {
        const words = pw({ ...PLACE_SAMPLE, place });
        if (typeof words !== 'string' || !words.trim()) err(`${where}: placeWords has no words for the place "${place}"`);
      }
    }
    for (const rule of k.rules ?? []) {
      const words = rw(rule);
      if (typeof words !== 'string' || !words.trim()) err(`${where}: ruleWords has no words for the rule "${rule}"`);
    }
    const text = input.readFile(k.test);
    const named = new RegExp(`(^|[^A-Za-z0-9.])${k.id.replace(/\./g, '\\.')}(?![A-Za-z0-9])`);
    if (text == null || !testTitles(text).some((t) => named.test(t))) err(`${where}: no it()/describe() title in ${k.test} names it`);
  }
  return { errors, info: [] };
}

/* ───────────── item 10: no book field has two code paths ───────────── */

/** The one file allowed to read the book fields (Building blocks item 10). */
export const BOOK_FIELDS_HOME = 'src/rules/blocks/book.ts';

/** A read of a book field outside book.ts that is NOT a second code path, with the reason. Matched by
 *  file + field + a snippet of the line; an entry that matches nothing fails the check (stale). */
export interface BookReaderAllow {
  file: string;
  field: string;
  snippet: string;
  why: string;
}

/**
 * The allowlist. Writers (an assignment), types, comments and the data pipeline are not reads and need
 * no entry; editors, and fields that only SHARE a name with a book field, do.
 */
export const BOOK_FIELD_ALLOW: BookReaderAllow[] = [
  {
    file: 'src/rules/build.ts',
    field: 'trainedSkill',
    snippet: 'trainedSkill: cb.trainedSkill',
    why: "resolveBackground reads the player's CustomBackground form (a different type) to WRITE the Background record whose book blocks the build then reads",
  },
  {
    file: 'src/builder/shared.tsx',
    field: 'trainedSkill',
    snippet: 'value={cb.trainedSkill',
    why: "the custom-background editor shows the player's own CustomBackground form value — an editor, not a book record",
  },
  {
    file: 'src/sheet/DetailsTab.tsx',
    field: 'trainedSkill',
    snippet: 'customBackground.trainedSkill',
    why: "the Details tab prints the player's own CustomBackground form value — not a book record",
  },
  {
    file: 'src/sheet/homebrewSchemas.ts',
    field: 'trainedSkill',
    snippet: 'trainedSkill: (e.trainedSkill',
    why: 'the homebrew background editor loads the stored field into its form (an editor; item 10 moves readers that make numbers)',
  },
  {
    file: 'src/sheet/homebrewSchemas.ts',
    field: 'trainedLore',
    snippet: 'trainedLore: (e.trainedLore',
    why: 'the homebrew background editor loads the stored field into its form (an editor)',
  },
  {
    file: 'src/sheet/ItemEditorModal.tsx',
    field: 'passiveEffects.skills',
    snippet: 'pe?.skills',
    why: "the item editor loads the item's passive skill bonuses into its form (an editor)",
  },
  {
    file: 'src/rules/companions.ts',
    field: 'maxHpBonus',
    snippet: 'mod.maxHpBonus',
    why: "a companion specialization's flat HP from the COMPANION_MODS code table (companionGrants.ts) — same name, not a book record's field",
  },
];

export interface BookReadersInput {
  /** Every code file under src/, as text, with a repo-relative path spelled with '/'. */
  files: { path: string; text: string }[];
  /** The moved fields: the union of the registry's `bookFields` ("passiveEffects.skills" = a path). */
  bookFields: string[];
  allow: BookReaderAllow[];
}

/**
 * The code of a TS/TSX file with comments and string/template/regex CONTENTS blanked to spaces (newlines
 * kept, so offsets and line numbers still match the original). A string whose whole content is one of
 * `keep` stays as it is, so a bracket read (`rec['maxHpBonus']`) is still seen.
 */
export function codeOnly(text: string, keep: ReadonlySet<string> = new Set()): string {
  const out = text.split('');
  const blank = (from: number, to: number) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
  };
  const n = text.length;
  let i = 0;
  // Template nesting: each entry is the brace depth at which a `${` opened.
  const tpl: number[] = [];
  let depth = 0;
  const prevSignificant = (at: number): string => {
    let j = at - 1;
    while (j >= 0 && /\s/.test(out[j])) j--;
    if (j < 0) return '';
    if (/[A-Za-z0-9_$]/.test(out[j])) {
      let k = j;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(out[k])) k--;
      return out.slice(k + 1, j + 1).join('');
    }
    return out[j];
  };
  const scanTemplate = (start: number): number => {
    // From just after a backtick (or a closing `}` of `${`): blank to the closing backtick or a `${`.
    let j = start;
    while (j < n) {
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text[j] === '`') {
        blank(start, j);
        return j + 1;
      }
      if (text[j] === '$' && text[j + 1] === '{') {
        blank(start, j);
        tpl.push(depth);
        depth++;
        return j + 2;
      }
      j++;
    }
    blank(start, n);
    return n;
  };
  while (i < n) {
    const ch = text[i];
    const nx = text[i + 1];
    if (ch === '/' && nx === '/') {
      const end = text.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      blank(i, stop);
      i = stop;
    } else if (ch === '/' && nx === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n && text[j] !== ch && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      if (!keep.has(text.slice(i + 1, j))) blank(i + 1, j);
      i = j + 1;
    } else if (ch === '`') {
      i = scanTemplate(i + 1);
    } else if (ch === '{') {
      depth++;
      i++;
    } else if (ch === '}') {
      depth--;
      if (tpl.length && tpl[tpl.length - 1] === depth) {
        tpl.pop();
        i = scanTemplate(i + 1);
      } else i++;
    } else if (ch === '/') {
      // A regex literal where an expression starts (after an operator, an opening bracket or a keyword).
      // Not after `<` and not before `>`: in TSX those are a closing tag (`</span>`, `<i … />`).
      const prev = prevSignificant(i);
      if (nx !== '>' && (prev === '' || /^[(,=:[!&|?{};+\-*%>~^]$/.test(prev) || /^(return|typeof|case|in|of|void|delete|throw|new|yield|await)$/.test(prev))) {
        let j = i + 1;
        let cls = false;
        while (j < n && text[j] !== '\n') {
          if (text[j] === '\\') {
            j += 2;
            continue;
          }
          if (text[j] === '[') cls = true;
          else if (text[j] === ']') cls = false;
          else if (text[j] === '/' && !cls) break;
          j++;
        }
        blank(i + 1, j);
        i = j + 1;
      } else i++;
    } else i++;
  }
  return out.join('');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** `.name`, `?.name` or `!.name` — a property access (not a spread, `...name`). */
const access = (name: string) => `(?:\\?\\.|!\\.|(?<!\\.)\\.)\\s*${escapeRe(name)}(?![A-Za-z0-9_$])`;

interface ReadPattern {
  field: string;
  re: RegExp;
}

/**
 * The patterns that find a READ of each moved field:
 *   - a one-word field (`landSpeedBonus`): `x.landSpeedBonus` / `x?.landSpeedBonus`, a bracket read
 *     `x['landSpeedBonus']` (not a type's indexed access, `Background['trainedSkill']`), and a
 *     destructuring (`const { landSpeedBonus } = rec`, `for (const { maxHpBonus } of …)`, a function's
 *     parameters `({ landSpeedBonus }: T) =>`), and a presence test (`'maxHpBonus' in rec`). NOT seen: a
 *     computed key (`rec[name]`) and the passive bag under another variable name (`const p = …; p.skills`);
 *   - a path whose last word is itself a moved field (`whileActive.landSpeedBonus`): covered above;
 *   - any other path (`passiveEffects.skills`, `effectChoices.grant.passive.skills`): the last two words
 *     (`passiveEffects.skills`, `passive.skills`) — the last word alone ("skills") is every proficiency
 *     table in the app. Plus the two names the passive bag goes by in derive.ts: `pe.skills` and a
 *     `resolvedItemPassives[…].skills` read.
 */
export function bookReadPatterns(bookFields: string[]): ReadPattern[] {
  const words = new Set(bookFields.filter((f) => !f.includes('.')));
  const out: ReadPattern[] = [];
  for (const w of words) {
    out.push({ field: w, re: new RegExp(access(w), 'g') });
    // A bracket read: right after a name, `)` or `]` (an array literal `['maxHpBonus']` is not one),
    // unless the name is a type's (PascalCase): `Item['maxHpBonus']` is an indexed access TYPE.
    out.push({ field: w, re: new RegExp(`(?<=[A-Za-z0-9_$)\\]])(?<!(?<![A-Za-z0-9_$])[A-Z][A-Za-z0-9_$]*)(?:\\?\\.)?\\[\\s*(['"\`])${escapeRe(w)}\\1\\s*\\]`, 'g') });
    // Destructuring: `{ …, landSpeedBonus, … } =` (not `==`/`=>`), or `{ … } of` in a for loop.
    out.push({ field: w, re: new RegExp(`\\{[^{}()]*(?<![A-Za-z0-9_$])${escapeRe(w)}(?![A-Za-z0-9_$])\\s*(?:[,:}][^{}()]*)?\\}\\s*(?:=(?![=>])|of\\b)`, 'g') });
    // Destructuring in a function's PARAMETERS: `({ landSpeedBonus }: any) =>`, `function f({ maxHpBonus = 0 }) {`
    // — the closing `}`, an optional `: Type` (a name, or one inline `{ … }` object type), `)`, an
    // optional return type, then `=>` or a body `{`. A call argument (`f({ landSpeedBonus })`) is not
    // followed by `=>`/`{`, so it is not matched.
    const type = `(?::(?:\\{[^{}]*\\}|[^(){};=])*)?`;
    out.push({ field: w, re: new RegExp(`\\{[^{}()]*(?<![A-Za-z0-9_$])${escapeRe(w)}(?![A-Za-z0-9_$])\\s*(?:[,:}=][^{}()]*)?\\}\\s*${type}\\)\\s*${type}(?:=>|\\{)`, 'g') });
    // A presence test: `'maxHpBonus' in rec` (codeOnly keeps a string that IS a watched name).
    out.push({ field: w, re: new RegExp(`(['"])${escapeRe(w)}\\1\\s+in(?![A-Za-z0-9_$])`, 'g') });
  }
  for (const f of bookFields) {
    if (!f.includes('.')) continue;
    const parts = f.split('.');
    const leaf = parts[parts.length - 1];
    if (words.has(leaf)) continue;
    const parent = parts[parts.length - 2];
    out.push({ field: f, re: new RegExp(`(?<![A-Za-z0-9_$])${escapeRe(parent)}\\s*${access(leaf)}`, 'g') });
    // `pe` is what derive.ts and the editors call an item's passiveEffects; the answered-choice copy
    // lives in `Character.resolvedItemPassives`.
    if (f === 'passiveEffects.skills') out.push({ field: f, re: new RegExp(`(?<![A-Za-z0-9_$])pe\\s*${access('skills')}`, 'g') });
    if (parent === 'passive' && leaf === 'skills') out.push({ field: f, re: new RegExp(`resolvedItemPassives\\b[^;\\n]*?${access('skills')}`, 'g') });
  }
  return out;
}

/** Is the access that ends at `end` the target of a plain assignment (a WRITER), `x.f = …`? */
const isAssignment = (code: string, end: number) => /^\s*=(?![=>])/.test(code.slice(end, end + 40));

/**
 * Item 10's guard: a moved book field is read only in blocks/book.ts. Fails on a read anywhere else in
 * src/ that no allowlist entry covers, and on an allowlist entry that covers nothing (stale).
 */
export function checkBookFieldReaders(input: BookReadersInput): BlocksCheckResult {
  const errors: string[] = [];
  const info: string[] = [];
  const keep = new Set(input.bookFields.filter((f) => !f.includes('.')));
  const patterns = bookReadPatterns(input.bookFields);
  const used = new Set<BookReaderAllow>();
  let allowed = 0;
  for (const f of input.files) {
    const path = f.path.replace(/\\/g, '/');
    if (path === BOOK_FIELDS_HOME) continue;
    const code = codeOnly(f.text, keep);
    const lines = f.text.split('\n');
    const seen = new Set<string>();
    for (const p of patterns) {
      for (const m of code.matchAll(p.re)) {
        const at = m.index ?? 0;
        const end = at + m[0].length;
        if (isAssignment(code, end)) continue;
        const line = code.slice(0, at).split('\n').length;
        const text = (lines[line - 1] ?? '').trim();
        const id = `${line}:${p.field}`;
        if (seen.has(id)) continue;
        seen.add(id);
        const ok = input.allow.find((a) => a.file === path && a.field === p.field && text.includes(a.snippet));
        if (ok) {
          used.add(ok);
          allowed++;
          continue;
        }
        errors.push(`${path}:${line}: reads book field "${p.field}" outside ${BOOK_FIELDS_HOME} — read it through bookBlocksOf (or allowlist it in check.ts BOOK_FIELD_ALLOW with a reason): ${text.slice(0, 160)}`);
      }
    }
  }
  for (const a of input.allow) {
    if (!a.why.trim()) errors.push(`BOOK_FIELD_ALLOW ${a.file} (${a.field}): no reason`);
    if (!used.has(a)) errors.push(`BOOK_FIELD_ALLOW ${a.file} (${a.field}, "${a.snippet}"): matches no read any more — remove the entry`);
  }
  info.push(`book fields (${input.bookFields.length}) are read only in ${BOOK_FIELDS_HOME}, ${allowed} allowlisted read(s) elsewhere, ${input.files.length} files scanned`);
  return { errors, info };
}

/* ───────────── item 9 / case D: the feats a build holds are read through heldFeats.ts ───────────── */

/**
 * One place that names a raw feat store, as scripts/lib/feat-readers.mjs reports it: the store
 * (`field`), `<file>#<enclosing symbol chain>` (`key`), how many times it is named there, and the lines.
 */
export interface FeatReaderHit {
  field: string;
  key: string;
  count: number;
  lines?: number[];
}

/** src/rules/blocks/feat-readers.json: per store, per key, the count allowed there and the TRUE reason it
 *  is not a held-feats walker (slot geometry, slot UI, storage, or D2). A top-level `$comment` is prose. */
export interface FeatReaderAllowEntry {
  count: number;
  why: string;
}

/**
 * Case D's guard (docs/overrides-redesign.md spec item 2, Building blocks item 9; plan
 * work/tweaks-part-a-notes/tweaks-part-a-caseD-plan.md section 5). A feat given through Tweaks works like
 * the same feat picked only while every reader of the feats a build holds asks src/rules/heldFeats.ts; a
 * NEW walker of the raw slot map would quietly read picked feats alone again. Fails on:
 *   - a place the allowlist does not list (route it through heldFeatSlots / heldFeatIds / featIdAtSlot, or
 *     list it with a true reason);
 *   - a count above the listed one (a new read hidden in an allowlisted place), or below it (the list is
 *     stale — lower it, so it can never cover a new read later);
 *   - an entry with an empty reason, a count that is not a whole number from 1, or a place that no longer
 *     names the store at all (stale);
 *   - an allowlist that is not `{ <store>: { <key>: { count, why } } }`.
 * Pure: the script feeds it the scan of the real files, the test plants bad cases in memory.
 */
export function checkFeatReaders(hits: FeatReaderHit[], allow: unknown): BlocksCheckResult {
  const where = 'src/rules/blocks/feat-readers.json';
  return checkReaderAllow(hits, allow, {
    where,
    missing: `${where}: missing or not an object — it lists, per raw feat store, the places allowed to name it`,
    unlisted: (h, at) =>
      `${h.key}${at}: names "${h.field}" ${h.count}× — a reader of the feats a build holds must ask src/rules/heldFeats.ts (heldFeatSlots / heldFeatIds / featIdAtSlot) so a feat given through Tweaks works like a picked one (case D); if this is slot geometry, slot UI or storage, list it in ${where} under "${h.field}" with its true reason`,
    above: (h, at, allowed) => `${h.key}${at}: names "${h.field}" ${h.count}×, but ${where} allows ${allowed} — a new read here must go through src/rules/heldFeats.ts (or be listed with its reason)`,
    total: (field, t) => `feat readers: "${field}" named ${t.reads}× in ${t.places} place(s) outside src/rules/heldFeats.ts (each checked against ${where})`,
  });
}

/**
 * Tweaks phase 2, WP7 (C10): every read of a slot key's CATEGORY text outside `slotCategoryOf` / `slotRefOf` is
 * listed in src/rules/blocks/slot-category-readers.json with its count and reason (scripts/lib/feat-readers.mjs
 * `scanSlotCategoryReaders` finds them). An extra place's key reads `extraclass` raw; only the slot geometry and the
 * `Character.feats` row keep that on purpose. Pure.
 */
export function checkSlotCategoryReaders(hits: FeatReaderHit[], allow: unknown): BlocksCheckResult {
  const where = 'src/rules/blocks/slot-category-readers.json';
  return checkReaderAllow(hits, allow, {
    where,
    missing: `${where}: missing or not an object — it lists the places allowed to read a slot key's category raw`,
    unlisted: (h, at) =>
      `${h.key}${at}: reads a slot key's category ${h.count}× — an extra feat place's key is \`<level>:extra<category>:<n>\`, so read the category through slotCategoryOf (src/rules/heldFeats.ts) or slotRefOf (src/rules/featSlots.ts); if this is slot geometry kept raw on purpose, or a split of something that is not a slot key, list it in ${where} with its true reason`,
    above: (h, at, allowed) => `${h.key}${at}: reads a slot key's category ${h.count}×, but ${where} allows ${allowed} — a new read goes through slotCategoryOf / slotRefOf (or is listed with its reason)`,
    total: (_field, t) => `slot-category readers: ${t.reads} raw read(s) in ${t.places} place(s) outside slotCategoryOf / slotRefOf (each checked against ${where})`,
  });
}

/** What one reader guard says (the feat stores' or the overrides'): the rule is the same, the advice is not. */
interface ReaderGuardText {
  /** The allowlist file, repo-relative. */
  where: string;
  missing: string;
  unlisted: (h: FeatReaderHit, at: string) => string;
  above: (h: FeatReaderHit, at: string, allowed: number) => string;
  total: (field: string, t: { reads: number; places: number }) => string;
}

/**
 * THE rule both reader guards share (`checkFeatReaders`, `checkOverridesReaders`): every hit's place listed in
 * the allowlist with exactly its count and a reason; no stale, empty or malformed entry. Pure.
 */
function checkReaderAllow(hits: FeatReaderHit[], allow: unknown, text: ReaderGuardText): BlocksCheckResult {
  const errors: string[] = [];
  const info: string[] = [];
  const where = text.where;
  if (!isObj(allow)) {
    errors.push(text.missing);
    return { errors, info };
  }
  const sections = new Map<string, Record<string, unknown>>();
  for (const [field, section] of Object.entries(allow)) {
    if (field === '$comment') continue;
    if (!isObj(section)) errors.push(`${where}: "${field}" must be an object of { "<file>#<symbol>": { "count", "why" } }`);
    else sections.set(field, section);
  }
  const seen = new Set<string>();
  const totals = new Map<string, { reads: number; places: number }>();
  for (const h of hits) {
    const t = totals.get(h.field) ?? { reads: 0, places: 0 };
    t.reads += h.count;
    t.places++;
    totals.set(h.field, t);
    const at = h.lines?.length ? ` (line${h.lines.length > 1 ? 's' : ''} ${h.lines.join(', ')})` : '';
    const entry = sections.get(h.field)?.[h.key];
    seen.add(`${h.field}\u0000${h.key}`);
    if (entry === undefined) {
      errors.push(text.unlisted(h, at));
      continue;
    }
    if (!isObj(entry)) continue; // reported below
    if (typeof entry.count === 'number' && Number.isInteger(entry.count) && entry.count >= 1) {
      if (h.count > entry.count) errors.push(text.above(h, at, entry.count));
      else if (h.count < entry.count) errors.push(`${where} "${h.field}" ${h.key}: lists ${entry.count}, the scan finds ${h.count} — lower the count, so the entry cannot cover a new read later`);
    }
  }
  for (const [field, section] of sections) {
    for (const [key, entry] of Object.entries(section)) {
      const name = `${where} "${field}" ${key}`;
      if (!isObj(entry)) {
        errors.push(`${name}: must be { "count": <n>, "why": "<reason>" }`);
        continue;
      }
      if (typeof entry.why !== 'string' || !entry.why.trim()) errors.push(`${name}: no reason ("why")`);
      if (typeof entry.count !== 'number' || !Number.isInteger(entry.count) || entry.count < 1) errors.push(`${name}: "count" must be a whole number from 1`);
      if (!seen.has(`${field}\u0000${key}`)) errors.push(`${name}: names "${field}" nowhere any more (stale) — remove the entry`);
    }
  }
  for (const [field, t] of [...totals].sort((a, b) => a[0].localeCompare(b[0]))) info.push(text.total(field, t));
  return { errors, info };
}

/* ───────────── spec item 4: one reader of a character's tweaks (plan B WP2, section 7.1) ───────────── */

/** The files exempt from the "one reader" scan — kept in step with scripts/lib/feat-readers.mjs
 *  OVERRIDES_READERS_HOMES (the scanner skips them; this names them in the messages). */
export const OVERRIDES_READERS_HOME_NAMES = 'src/rules/blocks/{stored,active,content,write,save,migrate}.ts, src/rules/heldFeats.ts';

/**
 * Spec item 4's guard: "every read of tweaks goes through one accessor that applies on/off, the start level
 * and the master switch". A place outside the home files that reads `.overrides` (`?.overrides`,
 * `['overrides']`, `{ overrides }`, the string `'overrides'`) could apply a paused or switched-off tweak, so
 * each one is listed in src/rules/blocks/overrides-readers.json with its count and its TRUE reason (a writer
 * through blocks/write.ts, storage carried as it is, a memo key, another concept named `overrides`). Fails on
 * an unlisted place, a count above or below the listed one, an empty reason, a stale entry, a malformed list —
 * the same rule as `checkFeatReaders`. Pure: scripts/blocks-check.mjs feeds it the scan of src/, the test
 * plants bad cases in memory.
 */
export function checkOverridesReaders(hits: FeatReaderHit[], allow: unknown): BlocksCheckResult {
  const where = 'src/rules/blocks/overrides-readers.json';
  return checkReaderAllow(hits, allow, {
    where,
    missing: `${where}: missing or not an object — it lists the places outside the Tweaks reader allowed to name "overrides"`,
    unlisted: (h, at) =>
      `${h.key}${at}: names "${h.field}" ${h.count}× — read a character's tweaks only through src/rules/blocks/active.ts (liveAttributeSets, liveRemovedFeatIds, isAllowedAnyway, liveGivenFeatures, liveGivenSpells, liveGivenLanguages, liveMaxHpSet, liveContentEdits, rankTweaks, activeNumberBlocks; contentFor(db, host) for the content edits), so the master switch, each tweak's on/off and its start level apply (spec item 4); if this is a writer through blocks/write.ts, storage carried as it is, a memo key or another concept named "overrides", list it in ${where} with its true reason`,
    above: (h, at, allowed) => `${h.key}${at}: names "${h.field}" ${h.count}×, but ${where} allows ${allowed} — a new read here must go through src/rules/blocks/active.ts (or be listed with its reason)`,
    total: (field, t) => `tweak readers: "${field}" named ${t.reads}× in ${t.places} place(s) outside ${OVERRIDES_READERS_HOME_NAMES} (each checked against ${where})`,
  });
}

/* ───────────── spec item 1: the player never reads "override" (plan B WP9b, section 7.2) ───────────── */

/** One piece of text that names the word, from scripts/lib/visible-words.mjs: a string literal, a template chunk
 *  or JSX text that reads as prose. `marker` is the reason of a `// tweaks-ok:` comment covering it ('' = none
 *  given); absent when no marker covers it. */
export interface VisibleWordHit {
  path: string;
  line: number;
  text: string;
  kind?: string;
  marker?: string;
}
/** A `// tweaks-ok: <reason>` comment; `used` when it covers a hit. */
export interface VisibleWordMarker {
  path: string;
  line: number;
  reason: string;
  used: boolean;
}
/** A file whose "override" text is not about tweaks, or never reaches a player. */
export interface VisibleWordSkip {
  path: string;
  why: string;
}

/**
 * The files the "no visible override" check skips, each with its reason. An entry for a file with no hit fails
 * (stale): it could hide a real one later. The plan's other candidates (the customization files, the tracker's
 * own overrides, astStubs.ts `override-title-right`) need no entry: none of their literals reads as prose.
 */
export const VISIBLE_WORDS_SKIP: VisibleWordSkip[] = [
  {
    path: 'src/rules/blocks/check.ts',
    why: "this guard's own messages (printed by npm run verify, never in the app) name the stored `overrides` keys and the overrides-readers allowlist",
  },
];

/**
 * Spec item 1's guard: "Overrides" is now Tweaks, and no text a player can read says "override" (the stored
 * names stay: plan B section 8). Fails on:
 *   - a hit outside the skip list with no `// tweaks-ok: <reason>` marker on the line above (say "tweak", or
 *     reword);
 *   - a marker with no reason, or one that covers no hit (stale);
 *   - a skip entry with no reason, a repeated path, or a path with no hit (stale);
 *   - a skip list that is not `{ path, why }[]`.
 * Pure: scripts/blocks-check.mjs feeds it the scan of src/ (scripts/lib/visible-words.mjs); the test plants
 * bad cases in memory.
 */
export function checkVisibleOverrideWords(hits: VisibleWordHit[], allow: unknown, markers: VisibleWordMarker[] = []): BlocksCheckResult {
  const errors: string[] = [];
  const info: string[] = [];
  const where = 'VISIBLE_WORDS_SKIP (src/rules/blocks/check.ts)';
  const skip = new Map<string, number>();
  if (!Array.isArray(allow)) errors.push(`${where}: must be a list of { path, why }`);
  else {
    for (const e of allow as unknown[]) {
      if (!isObj(e) || typeof e.path !== 'string' || !e.path.trim()) {
        errors.push(`${where}: an entry is not { path, why } — ${JSON.stringify(e)}`);
        continue;
      }
      if (typeof e.why !== 'string' || !e.why.trim()) errors.push(`${where} ${e.path}: no reason ("why")`);
      if (skip.has(e.path)) errors.push(`${where} ${e.path}: listed twice`);
      skip.set(e.path, 0);
    }
  }
  let marked = 0;
  for (const h of hits) {
    const path = h.path.replace(/\\/g, '/');
    if (skip.has(path)) {
      skip.set(path, (skip.get(path) ?? 0) + 1);
      continue;
    }
    if (h.marker !== undefined) {
      if (h.marker.trim()) marked++;
      else errors.push(`${path}:${h.line}: a "// tweaks-ok:" marker gives no reason — say why the player may read "override" here`);
      continue;
    }
    errors.push(
      `${path}:${h.line}: a player can read "override" here — Overrides is now Tweaks (spec item 1): say "tweak" or reword; only the stored names stay (overrides, overridesEnabled, override:<id>). If this text is truly not shown, or names the old card on purpose, put "// tweaks-ok: <reason>" on the line above: ${h.text}`,
    );
  }
  for (const m of markers) {
    if (!m.used) errors.push(`${m.path.replace(/\\/g, '/')}:${m.line}: a "// tweaks-ok:" marker covers no text that says "override" (stale) — remove it`);
  }
  for (const [path, n] of skip) {
    if (n === 0) errors.push(`${where} ${path}: no text there says "override" any more (stale) — remove the entry, so it cannot hide a real one later`);
  }
  info.push(`visible words: ${hits.length} text(s) say "override" — ${[...skip.values()].reduce((a, b) => a + b, 0)} in ${skip.size} skipped file(s), ${marked} marked "tweaks-ok"`);
  return { errors, info };
}

/* ───────────── item 7: one content path ───────────── */

/** The one file that lays a character's `overrides.contentEdits` over a database (Building blocks item 7). */
export const CONTENT_PATH_HOME = 'src/rules/blocks/content.ts';
/** The raw overlay's name: module-private in CONTENT_PATH_HOME, reached only through `contentFor`. */
export const RAW_CONTENT_OVERLAY = 'applyOverrides';
/** The one value CONTENT_PATH_HOME exports. */
export const CONTENT_PATH_DOOR = 'contentFor';
/** This guard's own file, which names RAW_CONTENT_OVERLAY as a string (a bracket read is not looked for here). */
const CONTENT_PATH_GUARD = 'src/rules/blocks/check.ts';

/**
 * Item 7's guard. Every surface used to lay `contentEdits` over its own database with its own
 * `applyOverrides(db, overrides)` call, so the party card, the tracker and the GM's HP write each drew a
 * different max HP from the same character (pin: test/content-path-pin.test.tsx). Now the overlay is
 * module-private in content.ts and every surface asks `contentFor` (or a derive boundary that does).
 * Fails on:
 *   - `applyOverrides` named in CODE anywhere but content.ts (a call, a member call `m.applyOverrides(…)`,
 *     an import, an alias, a re-export, a bracket read `m['applyOverrides']`); comments and longer strings
 *     are not code (codeOnly);
 *   - content.ts exporting anything but `contentFor` (types are fine): a second export is a second door;
 *   - content.ts no longer defining `function applyOverrides` (the guard would watch a name nothing uses —
 *     rename RAW_CONTENT_OVERLAY with it), or no longer exporting `contentFor`;
 *   - content.ts missing from `files` (the scan was fed the wrong tree).
 * Not seen: a hand-written copy of the overlay under another name in another file.
 * Pure: scripts/blocks-check.mjs feeds every code file of src/, test/, scripts/ and tracker/; the test
 * plants bad cases in memory.
 */
export function checkContentPath(files: { path: string; text: string }[]): BlocksCheckResult {
  const errors: string[] = [];
  const info: string[] = [];
  const keep = new Set([RAW_CONTENT_OVERLAY]);
  const named = new RegExp(`(?<![A-Za-z0-9_$])${escapeRe(RAW_CONTENT_OVERLAY)}(?![A-Za-z0-9_$])`, 'g');
  let home: string | null = null;
  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    if (path === CONTENT_PATH_HOME) {
      home = codeOnly(f.text);
      continue;
    }
    if (!f.text.includes(RAW_CONTENT_OVERLAY)) continue; // no mention at all: nothing to blank
    // This file spells the name as a string to look for it: here only real code counts, not a bare string.
    const code = codeOnly(f.text, path === CONTENT_PATH_GUARD ? new Set() : keep);
    const lines = f.text.split('\n');
    for (const m of code.matchAll(named)) {
      const line = code.slice(0, m.index ?? 0).split('\n').length;
      const text = (lines[line - 1] ?? '').trim();
      errors.push(
        `${path}:${line}: names ${RAW_CONTENT_OVERLAY} outside ${CONTENT_PATH_HOME} — lay a character's content-edits over a database only through ${CONTENT_PATH_DOOR}(db, host) (Building blocks item 7: one content path, so the sheet, party card, tracker and GM HP write agree): ${text.slice(0, 160)}`,
      );
    }
  }
  if (home === null) {
    errors.push(`${CONTENT_PATH_HOME}: not among the scanned files — ${CONTENT_PATH_DOOR}, the one content path, is missing (or the scan was fed the wrong tree)`);
  } else {
    if (!new RegExp(`(?<![A-Za-z0-9_$])function\\s+${RAW_CONTENT_OVERLAY}\\s*\\(`).test(home)) {
      errors.push(`${CONTENT_PATH_HOME}: no longer defines function ${RAW_CONTENT_OVERLAY} — this guard watches a name nothing uses (stale); rename RAW_CONTENT_OVERLAY in check.ts with it`);
    }
    const exported = new Set<string>();
    for (const m of home.matchAll(/(?<![A-Za-z0-9_$])export\s+(default\b|\*|(?:declare\s+)?(?:async\s+)?(?:function\s*\*?|const|let|var|class|enum|namespace)\s+([A-Za-z0-9_$]+))/g)) {
      exported.add(m[2] ?? (m[1] === '*' ? '* (export *)' : 'default'));
    }
    for (const m of home.matchAll(/(?<![A-Za-z0-9_$])export\s+(type\s+)?\{([^}]*)\}/g)) {
      if (m[1]) continue; // `export type { … }`
      for (const part of m[2].split(',')) {
        const spec = part.trim();
        if (!spec || /^type\s/.test(spec)) continue;
        const alias = /\bas\s+([A-Za-z0-9_$]+)\s*$/.exec(spec);
        exported.add(alias ? alias[1] : spec);
        if (alias && spec.split(/\s+/)[0] !== CONTENT_PATH_DOOR) exported.add(spec.split(/\s+/)[0]);
      }
    }
    for (const name of exported) {
      if (name === CONTENT_PATH_DOOR) continue;
      errors.push(`${CONTENT_PATH_HOME}: exports ${name} — its one export is ${CONTENT_PATH_DOOR}; a second export is a second content path (keep ${RAW_CONTENT_OVERLAY} module-private)`);
    }
    if (!exported.has(CONTENT_PATH_DOOR)) errors.push(`${CONTENT_PATH_HOME}: no longer exports ${CONTENT_PATH_DOOR} — every surface's content-edits path goes through it`);
  }
  info.push(`one content path: ${RAW_CONTENT_OVERLAY} is named only in ${CONTENT_PATH_HOME}, which exports ${CONTENT_PATH_DOOR} alone (${files.length} code files scanned)`);
  return { errors, info };
}
