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
  type Row = {
    name?: string; level?: number; rank?: number; archetype?: string; kind?: string; parentPage?: string; printedPage?: number;
    edition?: string; traits?: string[]; legacyNames?: string[]; source?: { book?: string };
  };
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
        // A `reference` record's Archives category ("creature-family" -> "Creature family"): the bucket
        // chip says only "Reference", and a class sample shares its name with a research field.
        bucket === 'reference' && typeof r.kind === 'string' && r.kind ? r.kind.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '',
        // The page it is filed under on the Archives: one "Key Terms" sidebar per class, one "Example"
        // per step (scripts/lib/archive-coverage.mjs parentPageOf).
        typeof r.parentPage === 'string' ? r.parentPage : '',
        typeof r.archetype === 'string' && r.archetype ? archetypeName(r.archetype) : '',
        // The book's real title, never shortened: "Pathfinder Society Clockwork Mystery Player's Guide"
        // minus "Pathfinder " is no book at all. A phone too narrow for it gets GlobalSearch's ellipsis.
        r.source?.book ?? '',
      ].filter(Boolean).join(' · ');
      recs.push({ bucket, id, name, ...(r.legacyNames?.length ? { aliases: r.legacyNames } : {}), ...(detail ? { detail } : {}) });
    }
  }
  /* Rows still alike after all that get what differs between them, tried in this order and added only to
   * a group it actually splits:
   *   - the printing: the inventor's level-15 "Enhanced Damage" ships as printed and Remastered, and both
   *     file under "Pathfinder Guns & Gears";
   *   - the traits the group does not share: Impossible Magic prints a Weapon Expertise for the magus and
   *     one for the runesmith, and Change Shape once per shapechanging ancestry;
   *   - the printed page: the Advanced Player's Guide has two "Backgrounds" rules pages in one chapter. */
  const row = (x: HostSearchRecord) => db[x.bucket]?.[x.id];
  const cap = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const telling: ((x: HostSearchRecord, group: HostSearchRecord[]) => string)[] = [
    (x) => { const e = String(row(x)?.edition ?? ''); return /remaster/.test(e) ? 'Remastered' : /legacy/.test(e) ? 'Legacy' : ''; },
    (x, group) => (row(x)?.traits ?? []).filter((t) => !group.every((y) => row(y)?.traits?.includes(t))).map(cap).join(', '),
    (x) => (typeof row(x)?.printedPage === 'number' ? `pg. ${row(x)!.printedPage}` : ''),
  ];
  for (const tell of telling) {
    const alike = new Map<string, HostSearchRecord[]>();
    for (const x of recs) {
      const k = `${x.bucket}\u0000${x.name}\u0000${x.detail ?? ''}`;
      (alike.get(k) ?? alike.set(k, []).get(k)!).push(x);
    }
    for (const group of alike.values()) {
      if (group.length < 2) continue;
      const told = group.map((x) => tell(x, group));
      if (new Set(told).size < 2) continue;
      group.forEach((x, i) => { if (told[i]) x.detail = x.detail ? `${x.detail} · ${told[i]}` : told[i]; });
    }
  }
  return recs;
}
