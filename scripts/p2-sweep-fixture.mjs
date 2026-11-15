/*
 * THE ZERO-MARKS SWEEP'S CHARACTERS, FROM THE PARITY SNAPSHOT'S OWN SPECS (Tweaks phase 2, WP4; the WP2 check
 * finding: the sweep used generated heroes, not the parity specs, and had no positive control).
 *
 * The parity script resolves its folder from `import.meta.url`, which is no file: URL under jsdom, so the DOM test
 * cannot load it. This node step writes the builds the sweep needs to test/fixtures/p2-sweep-specs.json:
 *   - `zero`: the `#none` twin of every phase-2 case's main variant (the same character with no tweak), and the old
 *     `overrides:` characters that name no pick (all of them up to 30, an even sample of 30 past that; 20 today) —
 *     each must show ZERO Tweak marks;
 *   - `marked`: the live main variant of the cases whose pick a mark must name (a positive control: each shows at
 *     least one mark), with its `-off` variant (Tweaks switched off: zero marks again).
 *     Not `subclass-anyway`: its spec stores the champion's sanctification as an effect choice, which the cause rule
 *     never reads (choiceFlagAnswer reads `feature:deity-champion`), so no rule breaks and no mark is due. The
 *     subclass mark is tested on a character that breaks the rule (test/tweaks-p2-take-anyway.test.tsx).
 * The picking itself is scripts/p2-sweep-fixture-lib.mjs, which test/p2-sweep-fixture-fresh.test.ts also runs: that
 * test fails when the specs changed and this was not re-run (WP4 finish, C9). Synthetic characters only (the parity
 * specs are). Re-run after the specs change:
 *   npx jiti scripts/p2-sweep-fixture.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTwinId, loadEngine } from './blocks-parity-snapshot.mjs';
import { sweepFixtureOf } from './p2-sweep-fixture-lib.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = 'test/fixtures/p2-sweep-specs.json';

// This file is the jiti entry, so ITS import() goes through jiti (an imported .mjs is loaded natively and its own
// import() could not load .ts): the engine modules are loaded from here (as scripts/tweaks-browser-fixture.mjs does).
const E = await loadEngine((p) => import(join(ROOT, p)));
const fx = sweepFixtureOf(E, isTwinId);
writeFileSync(join(ROOT, OUT), JSON.stringify(fx) + '\n');
console.log(`p2-sweep-fixture: ${fx.zero.length} zero-mark characters, ${fx.marked.length} marked (+ off variants) → ${OUT}`);
