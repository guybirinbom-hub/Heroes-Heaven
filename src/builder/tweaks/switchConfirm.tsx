/*
 * "Turn off Tweaks?" — the question the Options switch asks before it pauses every tweak (decisions 8 and 28;
 * plan B section 5.3, WP6). The switch itself is written by blocks/write.ts `setTweaksSwitch` (the ONE writer:
 * `v` and `overridesEnabled` in the same result, so an old character switched off before its first Save never
 * reads ON again). Switching ON asks nothing. Nothing is deleted either way.
 *
 * The lists come from tweaks/model.ts `tweaksTurnOffList`: what stops counting (grouped by kind; an old given
 * feat or ritual says it "may have come from an import", spec 2), what stays on (the import-stamped ones), and
 * what a newer version made (it turns off too). No tweak to list: no dialog.
 */
import type { ReactNode } from 'react';
import type { BuildState } from '../../rules/build';
import type { Character, ContentDatabase } from '../../rules/types';
import { confirmDialog } from '../../sheet/confirm';
import { tweaksTurnOffList, type ChoiceRole, type TurnOffList } from './model';

const list = (lines: string[], className: string): ReactNode => (
  <ul className={className} style={{ margin: '4px 0 0', paddingLeft: 20 }}>
    {lines.map((l, i) => (
      <li key={i}>{l}</li>
    ))}
  </ul>
);

/** The Choices group's three lists (C33), in this order: what a tweak ADDED, what it only ALLOWED, what it REMOVED. */
const CHOICE_GROUPS: [ChoiceRole, string][] = [
  ['stops', 'Choices: stops counting'],
  ['stays', 'Choices: stays picked and still counts'],
  ['returns', 'Choices: comes back and counts again'],
];

/** The dialog for one list; resolves true to turn Tweaks off ("Turn off"), false to keep it on. */
export function confirmTweaksOff(l: TurnOffList): Promise<boolean> {
  const choices = l.choices.stops.length + l.choices.stays.length + l.choices.returns.length;
  if (!l.off.length && !l.stayOn.length && !l.newer.length && !choices) return Promise.resolve(true);
  return confirmDialog({
    title: 'Turn off Tweaks?',
    message: (
      // The lists scroll inside the dialog: a long one must never push the buttons out of reach on a phone.
      <div className="tw-off-lists" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
        <p>These stop counting until you turn Tweaks back on. Nothing is deleted.</p>
        {l.off.map((g) => (
          <div key={g.group} className="tw-off-group">
            <p style={{ marginTop: 8 }}>
              <strong>{g.group}</strong>
            </p>
            {list(g.lines, 'tw-off-list')}
          </div>
        ))}
        {/* Tweaks phase 2 (C33): the Choices group, in the three things switching off does to a pick. */}
        {CHOICE_GROUPS.map(([role, title]) =>
          l.choices[role].length ? (
            <div key={role} className="tw-off-group tw-off-choices" data-choice-role={role}>
              <p style={{ marginTop: 8 }}>
                <strong>{title}</strong>
              </p>
              {list(l.choices[role], 'tw-off-list')}
            </div>
          ) : null,
        )}
        {!!l.stayOn.length && (
          <>
            <p style={{ marginTop: 10 }}>
              <strong>These stay on (added by an import)</strong>
            </p>
            {list(l.stayOn, 'tw-off-stay')}
          </>
        )}
        {!!l.newer.length && (
          <>
            <p style={{ marginTop: 10 }}>
              <strong>Made in a newer version — these turn off too</strong>
            </p>
            {list(l.newer, 'tw-off-newer')}
          </>
        )}
      </div>
    ),
    confirmLabel: 'Turn off',
    cancelLabel: 'Keep on',
    danger: true,
  });
}

/** Ask before switching Tweaks off for this draft (`content`: the Builder's full view; `character`: the
 *  character the draft builds, for names and the read-time rank sort). */
export function askTweaksOff(build: Pick<BuildState, 'overrides' | 'options' | 'level'>, content: ContentDatabase, character?: Character | null): Promise<boolean> {
  return confirmTweaksOff(tweaksTurnOffList(build, content, character));
}
