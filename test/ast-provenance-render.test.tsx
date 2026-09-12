// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { renderDom } from './_render';
import { AstRenderer } from '../src/sheet/AstRenderer';
import type { AstNode } from '../src/sheet/astStore';

/**
 * GUARD for this release's headline fix: a description popup is the RECORD'S OWN archive page.
 *
 * The AST writer used to pick a page per SLUG by edition rank, so when two archive documents shared a
 * name the wrong page shipped under the right name. items/dragon-pearl is equipment-4011 (Draconic
 * Codex, 9,000 gp, level 16) and opened equipment-3482 — the Tian Xia Character Guide's 180 gp pearl,
 * in full, with the wrong price a player would have bought against.
 *
 * scripts/ast-provenance-check.mjs compares the stamp against core.json across all 24,957 pages; this
 * asserts the other half, which no script can: what the RENDERER puts on the screen for that record.
 * It also pins the stamp as inert — `aon` sits on the tree root, the renderer switches on `node.t`
 * and never reads it, so the id must not appear in the rendered text.
 *
 * Reads the TRACKED public/ast/items.json.gz (the gitignored raw .json beside it is local regen
 * output), so it measures what actually ships.
 */
/* vitest runs with the repo root as cwd (see scripts/vt.mjs), the way the other file-reading tests
 * resolve their paths. */
const readGz = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString('utf8'));

describe('description pages are the record\'s own archive document', () => {
  it('items/dragon-pearl renders the Draconic Codex page, not the Tian Xia twin', () => {
    const core = JSON.parse(readFileSync('public/core.json', 'utf8')) as {
      items: Record<string, { aonId?: string }>;
    };
    const tree = (readGz('public/ast/items.json.gz') as Record<string, AstNode & { aon?: string }>)['dragon-pearl'];
    expect(tree, 'a shipped page for items/dragon-pearl').toBeTruthy();

    // provenance: the page says which document it was copied from, and it is the record's own.
    expect(core.items['dragon-pearl'].aonId).toBe('equipment-4011');
    expect(tree.aon).toBe(core.items['dragon-pearl'].aonId);

    const { host, stop } = renderDom(<AstRenderer node={tree} onOpenRef={() => undefined} />);
    const text = host.textContent ?? '';
    expect(text).toContain('9,000 gp');
    expect(text).toContain('Draconic Codex');
    expect(text).not.toContain('Tian Xia');
    // the stamp is metadata on the root node — it must never reach the screen.
    expect(text).not.toContain('equipment-4011');
    stop();
  });
});
