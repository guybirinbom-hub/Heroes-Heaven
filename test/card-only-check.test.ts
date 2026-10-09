import { spawnSync, execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CARD_FILES, NO_PAGE_LANES, callSites, codeOf, scan } from '../scripts/card-only-check.mjs';

/**
 * Card step 22 (docs/card-design.md section 9 row 22; section 2 rule 7; check 3 of section 8): the
 * per-surface switches and the legacy paths they guarded are gone, and scripts/card-only-check.mjs is
 * STRICT — it exits 1 when it lists anything. This file pins what it lists, on synthesized source strings
 * (each one a legacy path put back) and on the tree itself (nothing listed).
 *
 * THE PER-SURFACE SWITCH IS GUARDED BY THE COMPILER, not by this file: src/sheet/cardSurfaces.ts (cardOn /
 * CARD_ON) is DELETED, so a switch put back fails `npx tsc --noEmit` on the missing module. Measured
 * 2026-10-09 on a scratch copy of the merged tree's src: clean copy exit 0 (0 errors); a19f00d's
 * src/builder/shared.tsx put back → exit 2, 1 error, TS2307 "Cannot find module '../sheet/cardSurfaces'"
 * (shared.tsx:94); a19f00d's src/sheet/DetailsTab.tsx put back → exit 2, TS2307 './cardSurfaces'
 * (DetailsTab.tsx:16); restored copy exit 0. card-only-check itself passes both files (exit 0): a switch
 * is not a page drawn outside the card, so the compiler is the guard for it.
 *
 * MUTATION LINES (card step 22, each measured red, then the script restored byte-exact from a scratch copy):
 *  - card-only-check.mjs callSites: the `DescBody astKey` branch dropped (astKey falls through to the text
 *    lane test) → the "DescBody with a tree key" case red.
 *  - card-only-check.mjs callSites: the DescBody.tsx structural block dropped → the "page branch back in
 *    DescBody" case red.
 *  - card-only-check.mjs codeOf: returns its input (comments count as code) → the "prose naming a removed
 *    prop" case red (the tree case stays green: the structural checks also require a code shape, and
 *    AstRenderer.tsx's comments never name hideMeta in one).
 *  - (step 22 finish) card-only-check.mjs back in report mode (`if (found.length) process.exitCode = 1`
 *    removed, so it exits 0 always) → the two SPAWNED red cases red (exit 0 where 1 is expected); the
 *    stale-lane loop in scan() dropped → the stale NO_PAGE_LANES case red.
 *
 * STRICT IS THE EXIT CODE: the spawned cases run `node scripts/card-only-check.mjs` itself (the exit code is
 * set only when the script is run, never by scan()), on the tree (exit 0) and with `--root` on a scratch
 * tree under os.tmpdir() (never in the repo) holding the two named no-page lanes copied from src/sheet,
 * plus one legacy call site: a19f00d's src/sheet/FeatDetail.tsx, the last FeatDetail before step 22, whose
 * DescBody still takes astKey / astId (exit 1, that one site listed).
 */
type Site = { kind: string; line: number; snippet: string };
const kinds = (rel: string, src: string) => (callSites(rel, src) as Site[]).map((s) => s.kind);

describe('card step 22: card-only-check is strict and lists every legacy path put back', () => {
  // batch card: #card-R1 — the tree draws every record page through the card
  it('the tree lists nothing: every record page is drawn by the card', () => {
    expect(scan()).toEqual([]);
  });

  // batch card: #card-LEGACY-GONE — only the card's own files and the two named no-page lanes are left
  it('the card is RecordCard, AstRenderer and DescBody (its no-page lane); the named no-page lanes are SpellsTab and MainTab', () => {
    expect([...CARD_FILES].sort()).toEqual(['src/sheet/AstRenderer.tsx', 'src/sheet/DescBody.tsx', 'src/sheet/RecordCard.tsx']);
    expect(Object.keys(NO_PAGE_LANES).sort()).toEqual(['src/sheet/MainTab.tsx', 'src/sheet/SpellsTab.tsx']);
    for (const why of Object.values(NO_PAGE_LANES) as string[]) expect(why.length, 'each lane says why it holds no page').toBeGreaterThan(40);
  });

  // batch card: #card-LEGACY-GONE — DescBody's page branch is gone, so a tree key on DescBody is a legacy path
  it('a DescBody with a tree key (the page branch\'s caller) is listed, in any file — a card file or a named lane too', () => {
    const el = '<DescBody description={entry.description} onExit={onClose} astKey={astKey} astId={astId} />';
    expect(kinds('src/sheet/FeatDetail.tsx', el)).toEqual(['DescBody astKey']);
    expect(kinds('src/sheet/MainTab.tsx', el)).toEqual(['DescBody astKey']);
    expect(kinds('src/sheet/RecordCard.tsx', el)).toEqual(['DescBody astKey']);
    expect(kinds('src/sheet/ItemDetail.tsx', '<DescBody description={d} astId={pageId} />')).toEqual(['DescBody astKey']);
  });

  // batch card: #card-LEGACY-GONE — hideMeta is gone; AstRenderer without the card walk is outside the card
  it('AstRenderer with hideMeta is listed anywhere; without the card walk it is listed outside the card', () => {
    expect(kinds('src/integration/CampaignTracker.tsx', '<AstRenderer node={node} bodyOnly selfRef={s} onOpenRef={onOpen} />')).toEqual(['AstRenderer outside the card']);
    expect(kinds('src/sheet/SpellsTab.tsx', '<AstRenderer node={treeBody!} bodyOnly card={cardWalk} onOpenRef={open} />')).toEqual([]);
    expect(kinds('src/sheet/SpellsTab.tsx', '<AstRenderer node={n} bodyOnly hideMeta card={cardWalk} onOpenRef={open} />')).toEqual(['AstRenderer hideMeta']);
    expect(kinds('src/sheet/RecordCard.tsx', '<AstRenderer node={n} bodyOnly hideMeta onOpenRef={open} />')).toEqual(['AstRenderer hideMeta']);
  });

  // batch card: #card-R1 — a record's text drawn outside the card is listed
  it('RichText outside the card, and a DescBody text lane in a file that is neither the card nor a named lane, are listed', () => {
    expect(kinds('src/sheet/StrikeDetailModal.tsx', '<RichText text={t} refs={r} onOpen={o} />')).toEqual(['RichText outside the card']);
    expect(kinds('src/sheet/StrikeDetailModal.tsx', '<DescBody description={description} descRefs={descRefs} onExit={onClose} />')).toEqual(['DescBody text lane outside the card']);
    expect(kinds('src/sheet/SpellsTab.tsx', '<DescBody description={n.note} className="sd-desc" onExit={onClose} />')).toEqual([]);
    expect(kinds('src/sheet/DescBody.tsx', '<RichText text={description} refs={descRefs} onOpen={o} />')).toEqual([]);
    expect(kinds('src/sheet/NotesTab.tsx', '<AstRenderer node={n} hideMeta onOpenRef={o} />'), 'the allowlist never shows a page').toEqual([]);
  });

  // batch card: #card-LEGACY-GONE — DescBody as it ships has no page branch
  it('the page branch back in DescBody, or hideMeta back in AstRenderer, is listed at its source', () => {
    const descBody = readFileSync('src/sheet/DescBody.tsx', 'utf8');
    expect(kinds('src/sheet/DescBody.tsx', descBody), 'DescBody as it ships').toEqual([]);
    const withBranch = descBody
      .replace('  dirAuto,\n  remasteredAs,', '  astKey,\n  astId,\n  dirAuto,\n  remasteredAs,')
      .replace('  const content = useContent();', '  const content = useContent();\n  const { node: ast } = useAstNode(astKey, astId);\n  if (ast && astId) return <AstRenderer node={ast} bodyOnly selfRef={astId} onOpenRef={() => undefined} />;');
    // batch card: #card-MUTATION — the page branch put back in DescBody is listed
    expect(withBranch).not.toBe(descBody);
    const listed = kinds('src/sheet/DescBody.tsx', withBranch);
    // The props, the hook call and the renderer: each is listed (DescBody is the card's own file, so the
    // renderer counts as its page branch, not as "outside the card").
    expect(listed.length).toBeGreaterThanOrEqual(4);
    expect(new Set(listed)).toEqual(new Set(['DescBody page branch']));
    // batch card: #card-MUTATION — hideMeta put back in AstRenderer is listed
    const astRenderer = readFileSync('src/sheet/AstRenderer.tsx', 'utf8');
    expect(kinds('src/sheet/AstRenderer.tsx', astRenderer), 'AstRenderer as it ships').toEqual([]);
    const withHideMeta = astRenderer.replace('  bodyOnly?: boolean;\n', '  bodyOnly?: boolean;\n  hideMeta?: boolean;\n');
    expect(withHideMeta).not.toBe(astRenderer);
    expect(kinds('src/sheet/AstRenderer.tsx', withHideMeta)).toEqual(['AstRenderer hideMeta']);
  });

  // batch card: #card-LEGACY-GONE — a comment naming a removed prop is not the removed path
  it('prose naming a removed prop is not code: comments are blanked, strings are kept', () => {
    const src = '/* the old `hideMeta` drop, hideMeta={true} */\n// astKey={x} in a comment\nconst u = "https://2e.aonprd.com"; // a URL is not a comment\n';
    expect(kinds('src/sheet/AstRenderer.tsx', src)).toEqual([]);
    expect(kinds('src/sheet/DescBody.tsx', src)).toEqual([]);
    // batch card: #card-LEGACY-GONE — comments are blanked, strings and line numbers kept
    const code = codeOf(src) as string;
    expect(code).toContain('"https://2e.aonprd.com"');
    expect(code).not.toContain('hideMeta');
    expect(code.split('\n').length, 'line numbers kept').toBe(src.split('\n').length);
  });
});

describe('card step 22 finish: the script itself is strict — its exit code, spawned', () => {
  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, ['scripts/card-only-check.mjs', ...args], { encoding: 'utf8' });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  const roots: string[] = [];
  /** A scratch tree under os.tmpdir(): the two named no-page lanes copied from src/sheet, plus `extra`. */
  const scratch = (extra: Record<string, string>, lanes = Object.keys(NO_PAGE_LANES) as string[]) => {
    const root = mkdtempSync(join(tmpdir(), 'card-only-check-'));
    roots.push(root);
    mkdirSync(join(root, 'src', 'sheet'), { recursive: true });
    for (const rel of lanes) copyFileSync(rel, join(root, rel));
    for (const [rel, text] of Object.entries(extra)) writeFileSync(join(root, rel), text);
    return root;
  };
  afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

  // batch card: #card-R1 — the strict check passes the tree: every record page is drawn by the card
  it('on the tree it exits 0 and says so', () => {
    const r = run();
    expect(r.code, r.out + r.err).toBe(0);
    expect(r.out).toMatch(/^card only: every record page is drawn by the card \(2 named no-page text lanes/);
  });

  // batch card: #card-NOT-VACUOUS — the control for the red case: the named lanes alone pass
  it('a scratch tree holding only the named lanes exits 0 (the control for the red case)', () => {
    const r = run('--root', scratch({}));
    expect(r.code, r.out + r.err).toBe(0);
  });

  // batch card: #card-MUTATION — one planted legacy call site turns the check red
  it('ONE legacy call site planted (a19f00d\'s FeatDetail.tsx, DescBody with astKey) exits 1 and lists that site alone', () => {
    const legacy = execFileSync('git', ['show', 'a19f00d:src/sheet/FeatDetail.tsx'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const root = scratch({ 'src/sheet/FeatDetail.tsx': legacy });
    const r = run('--root', root);
    expect(r.code, r.out + r.err).toBe(1);
    expect(r.out).toMatch(/^card only: 1 call sites outside the card in 1 files \(DescBody astKey 1\) — each one fails the check\./);
    // batch card: #card-MUTATION — the planted site is listed alone, and --json keeps the exit code
    const json = run('--root', root, '--json');
    expect(json.code, '--json keeps the exit code').toBe(1);
    const listed = JSON.parse(json.out) as (Site & { file: string })[];
    expect(listed.map((s) => `${s.file} ${s.kind}`)).toEqual(['src/sheet/FeatDetail.tsx DescBody astKey']);
    expect(listed[0].snippet).toContain('astKey={astKey} astId={astId}');
  });

  // batch card: #card-NOT-VACUOUS — a named no-page lane must exist; a gone one is a stale entry
  it('a named no-page lane whose file is gone is a stale entry: exit 1, that lane listed', () => {
    const root = scratch({}, ['src/sheet/SpellsTab.tsx']);
    const r = run('--root', root, '--json');
    expect(r.code, r.out + r.err).toBe(1);
    expect(JSON.parse(r.out)).toEqual([{ file: 'src/sheet/MainTab.tsx', kind: 'stale NO_PAGE_LANES entry', line: 0, snippet: '' }]);
  });

  // batch card: #card-NOT-VACUOUS — a root with no src/ is refused, never read as a passing tree
  it('--root that holds no src/ is refused (exit 2), never read as an empty, passing tree', () => {
    const root = mkdtempSync(join(tmpdir(), 'card-only-check-'));
    roots.push(root);
    const r = run('--root', root);
    expect(r.code).toBe(2);
    expect(r.err).toContain('--root needs a directory holding src/');
  });
});
