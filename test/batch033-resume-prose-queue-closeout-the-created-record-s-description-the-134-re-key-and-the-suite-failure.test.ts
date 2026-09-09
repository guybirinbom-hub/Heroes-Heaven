import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { build, content } from './_content';
import { ownedFeatureIds } from '../src/rules/derive';

/**
 * Batch-033 resume, WG-comparison lane — the PROSE / QUEUE CLOSEOUT family.
 *
 * One authored item: the SECOND PHASE of a `create: true` overlay row. work/.b033-rows-gap-data-rows.json
 * created classFeatures/arcane-bond-school-of-unified-magical-theory so that a School of Unified Magical
 * Theory wizard's Drain Bonded Item limit could be retuned (src/rules/featUses.ts retunedBy), and a create
 * row carries no description by design — its own `why` says the prose "is owed to a created-prose spec".
 * That phase was skipped, which is both of the batch's new verify reds: readable-record-check ("28
 * record(s) ship with nothing a player can read") and render-check ("1 of 26,711 records would draw
 * nothing at all"). work/.b034-created-desc.json is that phase; the row is not applied yet, so every
 * assertion below runs over a copy built IN MEMORY rather than a patched-vs-shipped delta that would
 * flip direction the moment the driver applies it.
 */
const REC = 'arcane-bond-school-of-unified-magical-theory';
const MIRROR = 'C:/wonderers guide/aon-2e-archive/data/by-category/arcane-school/arcane-school-21.json';

type DescEntry = { d?: string; r?: unknown };
const descs = () =>
  JSON.parse(readFileSync('public/core-descriptions.json', 'utf8').replace(/^\uFEFF/, '')) as Record<
    string,
    Record<string, DescEntry>
  >;
const astIndex = () => JSON.parse(readFileSync('public/ast-index.json', 'utf8')) as Record<string, string>;

/**
 * The readable-text rule BOTH guards apply, in their own order: the record's own `description`, else the
 * split-out `.d`, else an ast display tree, else `note` (scripts/readable-record-check.mjs:70-78;
 * scripts/render-check.mjs `byProse` is the same rule minus `note`). Re-stated here rather than imported
 * because both guards are .mjs scripts with no exported predicate — if that ever changes, import it.
 */
const readable = (rec: Record<string, unknown>, entry: DescEntry | undefined, hasAst: boolean) =>
  Boolean(String(rec.description ?? '').trim() || String(entry?.d ?? '').trim() || hasAst || String(rec.note ?? '').trim());

/** The authored row, read from the spec so this test tracks what actually ships. */
function authoredRow() {
  const spec = JSON.parse(readFileSync('work/.b034-created-desc.json', 'utf8')) as {
    findings: { id: string; backfillRows: { category: string; id: string; field: string; value: string; why: string }[] }[];
  };
  const row = spec.findings.flatMap((f) => f.backfillRows).find((r) => r.id === REC && r.field === 'description');
  if (!row) throw new Error('work/.b034-created-desc.json carries no description row for ' + REC);
  return row;
}

describe('classFeatures/arcane-bond-school-of-unified-magical-theory — the created record a School of Unified Magical Theory wizard reads', () => {
  // batch 033: school-of-unified-magical-theory#drain-bonded-item-uses
  it('reaches a BUILT unified-magical-theory wizard, and with no prose of its own it draws nothing at all', () => {
    const db = content();
    const ch = build('wizard', 19, { subclassId: 'school-of-unified-magical-theory' });
    // The `<featureId>-<subclassId>` variant lane (derive.ts ownedFeatureIds) is what puts this record
    // on the sheet — FeatsTab.tsx:189 draws it — so its emptiness is a player-visible hole, not a
    // dormant row. A wizard of any OTHER school never sees it.
    expect(ownedFeatureIds(ch, db)).toContain(REC);
    expect(ownedFeatureIds(build('wizard', 19, { subclassId: 'school-of-battle-magic' }), db)).not.toContain(REC);

    const rec = (db.classFeatures as unknown as Record<string, Record<string, unknown>>)[REC];
    expect(rec).toBeTruthy();
    // The ast fallback is the load-bearing half of "draws nothing": a record with an ast display tree
    // reads perfectly well on an empty description. This one has no ast entry, and a backfill row never
    // makes one, so prose is the ONLY surface it can ever have.
    expect(astIndex()[REC]).toBeUndefined();

    // A STRIPPED copy — the shape the create row alone produces. True before and after the row lands.
    const stripped = { ...rec, description: undefined, note: undefined };
    expect(readable(stripped, undefined, false)).toBe(false);
  });

  // batch 033: school-of-unified-magical-theory#drain-bonded-item-uses
  it('becomes readable once the created-prose row for school-of-unified-magical-theory is applied', () => {
    const row = authoredRow();
    const rec = (content().classFeatures as unknown as Record<string, Record<string, unknown>>)[REC];
    const patched = { ...rec, description: undefined, note: undefined };
    expect(readable(patched, { d: row.value }, false)).toBe(true);

    // The rule it restores, from print. AoN arcane-school-21: "instead of using Drain Bonded Item only
    // once per day, you can use it once per day for each rank of spell you can cast, recalling a spell
    // of that rank each time."
    expect(row.value).toContain('Drain Bonded Item');
    expect(row.value).toContain('for each rank of spell you can cast');
    expect(row.why).toContain('arcane-school-21');
  });

  // batch 033: school-of-unified-magical-theory#drain-bonded-item-uses
  it('keeps every word of the school-of-unified-magical-theory prose inside arcane-school-21', () => {
    // precheck (5) in scripts/wg-batch-run.mjs refuses a description row that introduces a token present
    // in neither our current text nor the cited mirror document — and this record HAS no current text, so
    // the mirror is the whole vocabulary. The check runs here too, because a reword that reads better and
    // fails the driver costs a whole apply stage to discover.
    const doc = JSON.parse(readFileSync(MIRROR, 'utf8')) as { text?: string; markdown?: string };
    const mirrorWords = new Set(String(doc.text ?? doc.markdown ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? []);
    expect(mirrorWords.size).toBeGreaterThan(50);
    const outside = [...new Set(authoredRow().value.toLowerCase().match(/[a-z0-9]+/g) ?? [])].filter((w) => !mirrorWords.has(w));
    expect(outside).toEqual([]);
  });
});

describe('the other bare records are not this batch\'s — arcane-bond-school-of-unified-magical-theory is the only one batch 033 touches', () => {
  // batch 033: school-of-unified-magical-theory#drain-bonded-item-uses
  it('leaves every remaining unreadable record on a record no batch-033 row ever targets', () => {
    const core = JSON.parse(readFileSync('public/core.json', 'utf8').replace(/^\uFEFF/, '')) as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const d = descs();
    const ast = astIndex();
    // readable-record-check's own exemptions, restated: a synthetic mode's text lives on its parent item,
    // and a treasure is a priced valuable with no printed rules text.
    const exempt = (bucket: string, rec: Record<string, unknown>) => bucket === 'modes' || (bucket === 'items' && rec.itemType === 'treasure');
    const bare: string[] = [];
    for (const [bucket, records] of Object.entries(core)) {
      if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
      for (const [id, rec] of Object.entries(records)) {
        if (!rec || typeof rec !== 'object') continue;
        if (readable(rec, d[bucket]?.[id], Boolean(ast[id])) || exempt(bucket, rec)) continue;
        bare.push(`${bucket}/${id}`);
      }
    }

    // FIXED-BY-ME (close-verifier): the original assertion compared BUCKETS, and a sibling resume family
    // appending an `items` spec while this group worked turned it red on items/splendid-pyschopomp-mask —
    // a record bare at HEAD that no batch-033 row targets. Bucket is the wrong granularity: it couples
    // this test to which buckets OTHER families happen to write. Compare RECORDS instead, which is what
    // "not this batch's" actually means, and it no longer moves when a sibling family lands a spec.
    const manifest = JSON.parse(readFileSync('work/.b033-specs.json', 'utf8')) as { file: string; kind: string }[];
    const targeted = new Set<string>();
    const proseSupplied = new Set<string>();
    for (const m of manifest) {
      const raw = JSON.parse(readFileSync(m.file, 'utf8')) as unknown;
      const findings = (Array.isArray(raw) ? raw : ((raw as { findings?: unknown[] }).findings ?? [])) as {
        backfillRows?: { category?: string; id?: string; field?: string; value?: unknown }[];
      }[];
      for (const f of findings)
        for (const r of f.backfillRows ?? []) {
          if (!r.category || !r.id) continue;
          targeted.add(`${r.category}/${r.id}`);
          // A created record's prose arrives as a `description` row in a created-prose spec (or folded
          // into the create row's own value); either way that record is not shipping bare.
          if (String(r.value ?? '').trim() && (r.field === 'description' || (r.field === undefined && String((r.value as { description?: string })?.description ?? '').trim())))
            proseSupplied.add(`${r.category}/${r.id}`);
        }
    }
    expect(targeted.has(`classFeatures/${REC}`)).toBe(true);

    // THE INVARIANT: every record batch 033 writes that would otherwise ship unreadable has prose owed to
    // it in the SAME manifest. Today that is exactly this record (and the sibling family's created light
    // mortar). Everything else in `bare` is a record no row here touches — bare at HEAD, another effort's
    // to fix. Stays true after the rows land: the entries simply leave `bare`.
    expect(bare.filter((k) => targeted.has(k) && !proseSupplied.has(k))).toEqual([]);
    expect(bare.filter((k) => k.startsWith('modes/') || k.startsWith('classes/'))).toEqual([]);
  });
});
