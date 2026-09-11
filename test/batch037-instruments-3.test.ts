/*
 * BATCH 037 — INSTRUMENTS, CHUNK 3. Twelve owner rulings from the 2026-09-10 desk pass, every one of
 * them "the book wins, keep the app". Ten of the twelve needed no instrument at all — no comparer ever
 * reported them — and the two that did are pinned here:
 *
 *   sky-rider   wg-identity's `options` lane, settled MEMBER-SCOPED on the two labels of a pick print
 *               does not offer (SETTLED_IDENTITIES).
 *   bone-magic  gate 9's MISSING-CONTROL, cleared by teaching `CONTROL_TITLE_LANE` that a prompt which
 *               names the traditions instead of the word "tradition" is a tradition question.
 *
 * Both cases run against a STUNTED carrier and check the flag comes straight back — a teach that
 * survives its carrier being deleted is a teach that launders, and a settle that stops the record being
 * watched at all is a settle that hides a gap.
 */
import { describe, expect, it, vi } from 'vitest';
import { CHILD_TIMEOUT } from './_timeouts';
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lanesOfControl, laneOfControl, matchSelects } from '../scripts/lib/wg-experience-lanes.mjs';
import { FEAT_CANTRIP_GRANTS } from '../src/rules/featCantripGrants';
import { content } from './_content';

const CLI_ROOT = join(__dirname, '..');
type Core = Record<string, any>;

const identity = (ids: string, extra: string[] = []) =>
  execFileSync(process.execPath, [join(CLI_ROOT, 'scripts/wg-identity.mjs'), '--ids', ids, '--verbose', ...extra],
    { cwd: CLI_ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });

/** Run a comparer against a copy of public/core.json with one carrier removed. */
function stuntedCore<T>(tag: string, mutate: (core: Core) => void, run: (coreArg: string[]) => T): T {
  const rel = `work/.b037i3-stunt-${tag}.json`;
  const shipped = readFileSync(join(CLI_ROOT, 'public/core.json'), 'utf8');
  const copy: Core = JSON.parse(shipped);
  mutate(copy);
  const text = JSON.stringify(copy);
  expect(text).not.toBe(shipped);   // the stunt must actually bite
  writeFileSync(join(CLI_ROOT, rel), text);
  try {
    return run(['--core', rel]);
  } finally {
    rmSync(join(CLI_ROOT, rel), { force: true });
  }
}

/* ================================================================== *
 * SETTLE — sky-rider: WG splits an AND into a pick
 * ================================================================== */

describe('batch 037 instruments-3 — sky-rider trains both printed skills, so WG\'s two pick labels have nowhere to land', () => {
  // batch 037: sky-rider#both-skills
  it('sky-rider: the two option labels settle, and the record\'s own Cat Fall grant is still guarded', () => {
    /*
     * AoN background-381: *"You're trained in the Acrobatics skill, and the Plane of Air Lore skill. You
     * gain the Cat Fall skill feat."* An AND. WG writes it as two selects ("Trained in Acrobatics",
     * "Select Lore"), so `skillacrobatics` and `skillloreplaneofair` are the halves of a choice that does
     * not exist and have no counterpart on our side — ours trains both outright (`trainedSkill:
     * 'acrobatics'`, `trainedLore: 'plane-of-air'`). Owner ruled 2026-09-10, desk #88: keep the app.
     *
     * mutation-proof — the settle names the two labels and NOT the `options` bucket, so the record stays
     * under comparison. Stunt `grantedFeatId` (the Cat Fall grant this background really does hand over)
     * and wg-identity reports it straight back WITH the settle in place.
     */
    const c = content();
    expect(c.backgrounds['sky-rider'].trainedSkill).toBe('acrobatics');
    expect(c.backgrounds['sky-rider'].trainedLore).toBe('plane-of-air');

    // `--raw` bypasses the registries: this is the difference the settle answers, still there underneath.
    expect(identity('sky-rider', ['--raw'])).toMatch(/theirs-not-ours=\[skillloreplaneofair, skillacrobatics\]/);
    expect(identity('sky-rider')).not.toMatch(/theirs-not-ours/);

    const stunted = stuntedCore('sky-rider-catfall',
      (core) => { delete core.backgrounds['sky-rider'].grantedFeatId; },
      (coreArg) => identity('sky-rider', coreArg));
    expect(stunted).toMatch(/grants\s+theirs-not-ours=\[catfall\]/);
    // …and the settled labels stay settled while that real gap reports, so the scope is the two names.
    expect(stunted).not.toMatch(/theirs-not-ours=\[skillloreplaneofair, skillacrobatics\]/);
  });
});

/* ================================================================== *
 * TEACH — bone-magic: a tradition question that never says "tradition"
 * ================================================================== */

/**
 * The two controls the builder really renders for Bone Magic, read from the carriers that produce them
 * rather than transcribed: reword either prompt and this test changes with it.
 */
const traditionPrompt = () => String((content().feats['bone-magic'] as any).choice.prompt);
const cantripPrompt = () => String(FEAT_CANTRIP_GRANTS['bone-magic'].prompt);
const popup = (title: string) => ({ ctl: 'popup', title });
/* WG's row: one open `select from:CUSTOM "Select a Tradition"`; its two cantrip selects live inside that
 * select's options and are gated out of the match (`inOption`). */
const traditionSelect = { lane: 'tradition', title: 'Select a Tradition', optionType: 'CUSTOM', gate: 'open', inOption: false };

describe('batch 037 instruments-3 — bone-magic asks WG\'s tradition question by naming the traditions', () => {
  // batch 037: bone-magic#cantrip-list
  it('bone-magic: the tradition prompt lanes as a tradition, and the cantrip picker beside it does not', () => {
    /*
     * AoN feat-5632: *"Choose one cantrip from either the occult spell list or the primal spell list…
     * **Special** Choose when you gain this feat whether your innate spells are primal or occult."* Two
     * questions, and we ask both. Gate 9 read the first as a SPELL control because our prompt says
     * "spells", which took it out of the generic `option` pool their tradition select falls back to, and
     * the record came back MISSING-CONTROL — on a question we really do ask. Owner ruled 2026-09-10,
     * desk #107: keep the app, the cantrip may come from either list whatever the tradition.
     *
     * The teach is one entry at the END of CONTROL_TITLE_LANE, so it only ever ADDS the lane.
     */
    expect(traditionPrompt()).toBe('Bone Magic — are your innate spells primal or occult?');
    expect(lanesOfControl(popup(traditionPrompt()))).toEqual(['spell', 'tradition', 'option']);
    expect(laneOfControl(popup(traditionPrompt()))).toBe('spell');   // the primary lane is untouched

    /* THE GUARD. "Choose an occult or primal cantrip" names a picked noun after the alternation, so it
     * is a cantrip pick and not a tradition question — which is what stops the teach laundering. */
    expect(cantripPrompt()).toBe('Choose an occult or primal cantrip');
    expect(lanesOfControl(popup(cantripPrompt()))).not.toContain('tradition');
  });

  // batch 037: bone-magic#cantrip-list
  it('bone-magic: WG\'s "Select a Tradition" now finds our control, and finds nothing without it', () => {
    /*
     * mutation-proof — the taught carrier is the ALTERNATION IN THE PROMPT, so that is what is stunted:
     * the same two controls with the tradition names taken out of the first one. The select goes
     * unmatched again, which proves the match is made by this teach and not by something else in the
     * lane table — and that the teach cannot answer for a record that stops asking the question.
     *
     * ⚠ The stunt keeps BOTH controls deliberately. Deleting the tradition control outright leaves one
     * control against one select, which matchSelects pairs by COUNT under a rule that predates this
     * teach ("one question asked, one control added"); asserting against that shape would have measured
     * the old rule and called it this one. Recorded below so the next reader does not retry it.
     */
    const lane = (c: { ctl: string; title: string }) => ({ ...c, lane: laneOfControl(c) });
    const both = [popup(traditionPrompt()), popup(cantripPrompt())].map(lane);
    expect(matchSelects([traditionSelect], both).unmatched).toEqual([]);

    const deTraditioned = [popup('Bone Magic — which way do your innate spells lean?'), popup(cantripPrompt())].map(lane);
    expect(lanesOfControl(deTraditioned[0])).not.toContain('tradition');
    expect(matchSelects([traditionSelect], deTraditioned).unmatched).toHaveLength(1);

    // The one-control shape, pinned as the pre-existing by-count rule it is rather than as this teach.
    expect(matchSelects([traditionSelect], [popup(cantripPrompt())].map(lane)).matched[0]?.byCount).toBe(true);
  });
});
