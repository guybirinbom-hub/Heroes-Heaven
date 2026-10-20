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
 *   - an entry accepts a target kind the target registry does not have for that aspect;
 *   - an entry's test file is missing or has no it()/describe() title naming the entry's id;
 *   - a file under src/rules/blocks/ imports from scripts/, work/ or the batch tools (item 12).
 * It prints (never fails on) the "not in Tweaks yet" list and the kinds that nothing applies yet.
 */
import type { BlockKindDef } from './registry';
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
}

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
    }
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
  for (const id of builtRows.keys()) if (!regIds.has(id)) err(`catalog row ${id}: status "built" but the registry has no entry with this id`);
  for (const s of input.stillToAdd) if (!regIds.has(s.id)) err(`STILL_TO_ADD names "${s.id}", which the registry does not have`);

  /* ── item 12: blocks never depend on the batch tools ── */
  for (const f of input.blockFiles) {
    for (const m of f.text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (/(^|\/)(scripts|work)\//.test(spec) || /wg-batch|apply-parity|trust-ledger/.test(spec)) err(`${f.path}: imports "${spec}" — blocks must not depend on scripts/, work/ or the batch tools`);
    }
  }

  /* ── what the check prints ── */
  const toAdd = rows.filter((r) => isObj(r) && r.status !== 'built');
  const byPhase = new Map<number, number>();
  for (const r of toAdd) byPhase.set(r.phase as number, (byPhase.get(r.phase as number) ?? 0) + 1);
  info.push(`catalog: ${rows.length} kinds — ${builtRows.size} built, ${toAdd.length} still to add or shaped by a ruling (${[...byPhase].sort((a, b) => a[0] - b[0]).map(([p, n]) => `phase ${p}: ${n}`).join(', ')})`);
  info.push(`not in Tweaks yet (no editor on the screen): ${notInTweaks.length ? notInTweaks.join(', ') : 'none'}`);
  const notYet = input.registry.filter((k) => k.applies === 'not-yet').map((k) => k.id);
  info.push(`registered but nothing applies them yet: ${notYet.length ? notYet.join(', ') : 'none'}`);
  return { errors, info };
}
