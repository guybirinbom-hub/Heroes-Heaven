import { useState } from 'react';
import { usePartyStore } from '../../tracker/src/store/partyStore';
import { formatTurnTime } from '../../tracker/src/utils/turnTimer';
import { TurnTimeline } from '../../tracker/src/components/TurnTimeline';

/*
 * The per-player turn-time button shown on a campaign party card — same idea as the ⏱ chip on the
 * original app's own member cards. It opens the tracker's TurnTimeline graph (daily average line +
 * lifetime/fastest/slowest), reading the turn history the timer's "Save to Averages" recorded onto
 * this PC in the tracker's party store (the one `syncCampaignParty` keeps in step with the campaign).
 *
 * Always rendered so the feature is discoverable: with no data yet it's a bare clock that opens the
 * graph's "run combat with the timer, then Save to Averages" empty state; once data exists it shows
 * the lifetime average. Part of the removable seam.
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
  const hasData = !!player && (player.turnCount ?? 0) > 0;
  // A synthetic player when none exists yet, so the graph can still show its empty-state guidance.
  const target = player ?? { name, turnHistory: undefined, turnAvgSeconds: undefined, turnCount: undefined };

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
