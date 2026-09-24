import type { ContentDatabase } from '../rules/types';
import type { HostSearchRecord } from '../../tracker/src/data/hostSearchContext';

/**
 * The GM's Search index (Campaigns → a table → Search): every content record Heroes Heaven has, as the
 * tracker's GlobalSearch reads it (CampaignTracker hands it over through HostSearchProvider).
 *
 * Each row also carries the names its page was printed under before (`legacyNames` — a GM typing
 * "Flame Tongue" finds Searing Blade, as the pickers do) and a muted detail line, because two
 * different feats can share a name (the two Zombie Horde feats, two Keep Pace) and a bare
 * "Zombie Horde · FEATS" twice gave the GM nothing to choose by. The duplicate scrapes the pickers
 * hide (`duplicateIds` — the second Kingmaker Practical Magic) are hidden here for the same reason.
 * The few purely-mechanical buckets with no description are skipped.
 */
export function hostSearchRecords(content: ContentDatabase): HostSearchRecord[] {
  const skip = new Set(['modes', 'runes', 'stances']);
  type Row = { name?: string; level?: number; rank?: number; archetype?: string; legacyNames?: string[]; source?: { book?: string } };
  const db = content as unknown as Record<string, Record<string, Row> | undefined>;
  const archetypeName = (a: string) => db.archetype?.[a]?.name ?? a.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const recs: HostSearchRecord[] = [];
  for (const bucket of Object.keys(db)) {
    if (skip.has(bucket)) continue;
    const rows = db[bucket];
    if (!rows || typeof rows !== 'object') continue;
    for (const id of Object.keys(rows)) {
      const r = rows[id];
      const name = r?.name;
      if (typeof name !== 'string' || !name || content.duplicateIds?.has(id)) continue;
      const detail = [
        typeof r.rank === 'number' ? `Rank ${r.rank}` : typeof r.level === 'number' ? `Level ${r.level}` : '',
        typeof r.archetype === 'string' && r.archetype ? archetypeName(r.archetype) : '',
        // The book's real title, never shortened: "Pathfinder Society Clockwork Mystery Player's Guide"
        // minus "Pathfinder " is no book at all. A phone too narrow for it gets GlobalSearch's ellipsis.
        r.source?.book ?? '',
      ].filter(Boolean).join(' · ');
      recs.push({ bucket, id, name, ...(r.legacyNames?.length ? { aliases: r.legacyNames } : {}), ...(detail ? { detail } : {}) });
    }
  }
  return recs;
}
