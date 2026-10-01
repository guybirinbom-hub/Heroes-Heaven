import { useState } from 'react';
import { usePartyStore } from '../../tracker/src/store/partyStore';
import { useSettingsStore } from '../../tracker/src/store/settingsStore';
import { formatTurnTime } from '../../tracker/src/utils/turnTimer';
import { TurnTimeline } from '../../tracker/src/components/TurnTimeline';
import { useBackHandler } from '../sheet/useEscapeClose';

/*
 * The per-player turn-time button shown on a campaign party card — same idea as the ⏱ chip on the
 * original app's own member cards. It opens the tracker's TurnTimeline graph (daily average line +
 * lifetime/fastest/slowest), reading the turn history the timer's "Save to Averages" recorded onto
 * this PC in the tracker's party store (the one `syncCampaignParty` keeps in step with the campaign).
 *
 * It follows the tracker's "Enable turn timer" setting (the owner's rule: no timer icon on player
 * cards when the initiative turn timer is off). With the timer OFF nothing renders at all — not
 * even a stale average — and the setting defaults to off. With the timer ON it is drawn on every
 * card, so the feature can still be found: with no data yet it's a bare clock that opens the graph's
 * "run combat with the timer, then Save to Averages" empty state; once data exists it shows the
 * lifetime average.
 * Hiding it is display-only: the saved turn history is never touched here, and it comes back the
 * moment the timer is turned on again. Part of the removable seam.
 */
export function MemberTurnButton({ campaignId, charId, name }: { campaignId: string; charId: string; name: string }) {
  const player = usePartyStore((s) => {
    const p = s.parties.find((pp) => pp.campaignId === campaignId);
    if (!p) return null;
    // Match on the stable character id (kept in sync by syncCampaignParty) so a renamed PC or two
    // same-named PCs resolve to the right turn history; fall back to name for any pre-charId player.
    const lower = name.trim().toLowerCase();
    return (
      p.players.find((pl) => pl.charId === charId) ??
      p.players.find((pl) => pl.memberType !== 'npc' && pl.name.trim().toLowerCase() === lower) ??
      null
    );
  });
  const [open, setOpen] = useState(false);
  const timerOn = useSettingsStore((s) => s.turnTimerEnabled);
  // This graph is a layer over the campaign, so Escape has to close IT — unregistered, the topmost
  // handler was the campaign's own and one press left the campaign entirely. Only while the chip is
  // actually shown: a chip hidden by the setting must not keep a handler that eats one Escape press.
  useBackHandler(open && timerOn, () => setOpen(false));
  const hasData = !!player && (player.turnCount ?? 0) > 0;
  // A synthetic player when none exists yet, so the graph can still show its empty-state guidance.
  const target = player ?? { name, turnHistory: undefined, turnAvgSeconds: undefined, turnCount: undefined };

  // AFTER every hook: an early return above them would change the hook order when the setting flips.
  if (!timerOn) return null;

  return (
    <>
      <button
        type="button"
        className={'mt-turn-chip' + (hasData ? '' : ' empty')}
        onClick={() => setOpen(true)}
        title="Turn-time history — daily average and overall average"
        aria-label={`Turn-time history for ${name}`}
      >
        <i className="ti ti-clock" aria-hidden="true" />
        {hasData && <span>{formatTurnTime(player!.turnAvgSeconds ?? 0)}</span>}
      </button>
      {open && <TurnTimeline player={target} onClose={() => setOpen(false)} />}
    </>
  );
}
