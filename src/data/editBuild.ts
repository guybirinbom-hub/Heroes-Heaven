/*
 * THE BUILD THE BUILDER EDITS — one function for both edit paths (plan B WP4, open point 3; App `onEdit`
 * and the GM's edit sheet `openBuilder`).
 *
 * The stored build is the player's own: every pick, every Tweaks entry exactly as stored. The reverse build
 * (`deriveBuildFromCharacter`) reconstructs one from the built character and cannot tell a pick from a rank
 * a tweak made (blocks-rank-seams' KNOWN LIMIT test: "a real pick under a live floor or hold comes back as
 * granted"), so it runs ONLY for a character that has no stored build (an import, a very old save).
 *
 * If the reverse build THROWS, there is no build to edit, and the answer is `null`: the host refuses to open
 * the Builder and shows UNREADABLE_BUILD_NOTICE (2026-10-23, data safety). Until then the Builder opened on
 * a blank build that kept only `overrides` and `options`, and a Save from it REPLACED the character whole —
 * its feats, items and spells were gone. The sheet keeps working on the stored character; nothing is written.
 */
import { deriveBuildFromCharacter, type BuildState } from '../rules/build';
import type { Character, ContentDatabase } from '../rules/types';

export interface EditableBuild {
  build: BuildState;
  /** true when the Builder opens on a reconstructed build, not the stored one. */
  derived: boolean;
}

/** What the host shows (in the app's own message box, never a native alert) when `editableBuildOf` is null. */
export const UNREADABLE_BUILD_NOTICE = {
  title: 'This character can’t be edited here',
  message: 'This character was saved in a way the builder can’t read back, so it can’t be edited here. Its sheet stays exactly as it is.',
} as const;

/** The build to open the Builder on (see the header), or `null` when there is none to open: no stored build
 *  and the reverse build throws. Never calls `deriveBuildFromCharacter` when a build is stored. `db` is the
 *  view the character is built with (the host's build db). Reads only; writes nothing. */
export function editableBuildOf(saved: { character: Character; build?: BuildState }, db: ContentDatabase): EditableBuild | null {
  if (saved.build) return { build: saved.build, derived: false };
  try {
    return { build: deriveBuildFromCharacter(saved.character, db), derived: true };
  } catch (err) {
    console.error('Could not reconstruct a build from the character; the Builder stays closed:', err);
    return null;
  }
}
