/*
 * Kingmaker — in-app RULES REFERENCE page (Kingmaker Adventure Path player content: camping and the
 * kingdom subsystem). Same full-screen shell as MonsterPartsRules / MythicRules. Prose sections are
 * hand-written; the Camping / Kingdom-activity / Kingdom-feat lists are rendered FROM THE CONTENT DATA
 * (actions with the `camping` trait, the kingdom-turn downtime actions, and `kingdom`-trait feats).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { ContentDatabase, DescRef, Feat, Action } from '../rules/types';
import { useIsMobile } from './useIsMobile';
import { useBackHandler } from './useEscapeClose';
import { InfoTerm } from './InfoTerm';

type SectionId = 'overview' | 'camping' | 'kingdom' | 'activities' | 'feats';
const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'ti-book-2' },
  { id: 'camping', label: 'Camping', icon: 'ti-campfire' },
  { id: 'kingdom', label: 'The Kingdom', icon: 'ti-crown' },
  { id: 'activities', label: 'Kingdom activities', icon: 'ti-clipboard-list' },
  { id: 'feats', label: 'Kingdom feats', icon: 'ti-award' },
];

const SECTION_KEYWORDS: Record<SectionId, string> = {
  overview: 'overview kingmaker adventure path player content background feat spell item toggle camping kingdom',
  camping: 'camping daily preparations watch cook meal hunt gather relax organize watch campsite provisions travel rest',
  kingdom:
    'kingdom culture economy loyalty stability unrest ruin corruption crime decay strife control dc resource points rp fame infamy turn phase upkeep commerce leadership settlement hex charter government',
  activities:
    'kingdom activities downtime leadership region civic commerce claim hex build structure quell unrest establish settlement trade agreement new leadership',
  feats: 'kingdom feats civil service cooperative leadership crush dissent endure anarchy fortified fiefs kingdom assurance pull together practical magic',
};

const ARMY_TRAITS = ['army', 'cavalry', 'infantry', 'skirmisher', 'siege', 'maneuver', 'morale'];

/** The camping activities (camping-trait actions) — the daily-preparation options during travel. */
export function campingActivities(content: ContentDatabase): Action[] {
  return Object.values(content.actions)
    .filter((a) => (a.traits ?? []).includes('camping'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The kingdom-turn activities: Kingmaker downtime/leadership/region/civic/commerce/upkeep actions,
 *  excluding camping (its own section) and army/warfare actions (out of scope for this app). */
export function kingdomActivities(content: ContentDatabase): Action[] {
  const KINGDOM_TRAITS = ['downtime', 'leadership', 'region', 'civic', 'commerce', 'upkeep'];
  return Object.values(content.actions)
    .filter(
      (a) =>
        /kingmaker/i.test(a.source?.book ?? '') &&
        !(a.traits ?? []).includes('camping') &&
        !ARMY_TRAITS.some((t) => (a.traits ?? []).includes(t)) &&
        KINGDOM_TRAITS.some((t) => (a.traits ?? []).includes(t)),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The kingdom feats (kingdom-trait feats) — taken by the kingdom, chosen on the Kingdom sheet. */
export function kingdomFeats(content: ContentDatabase): Feat[] {
  return Object.values(content.feats).filter((f) => (f.traits ?? []).includes('kingdom'));
}

/** A described entry (action / feat) — tap the name to read its full description. */
function EntryTerm({ item, descKey, level }: { item: { id: string; name: string; description: string; descRefs?: DescRef[] }; descKey: string; level?: number }) {
  return (
    <div className="mpr-feat">
      <div className="mpr-feat-head">
        <span className="mpr-feat-name">
          <InfoTerm title={item.name} description={item.description} descRefs={item.descRefs} descKey={descKey}>
            {item.name}
          </InfoTerm>
        </span>
        {level != null && <span className="mpr-feat-type">Level {level}</span>}
      </div>
    </div>
  );
}

/** Group feats by level, ascending. */
function byLevel(items: Feat[]): [number, Feat[]][] {
  const m = new Map<number, Feat[]>();
  for (const it of items) (m.get(it.level ?? 0) ?? m.set(it.level ?? 0, []).get(it.level ?? 0)!).push(it);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

export function KingmakerRules({ content, onClose, embedded = false }: { content: ContentDatabase; onClose?: () => void; embedded?: boolean }) {
  const isMobile = useIsMobile();
  const [section, setSection] = useState<SectionId>('overview');
  const [mobileSection, setMobileSection] = useState<SectionId | null>(null);
  const [query, setQuery] = useState('');
  useBackHandler(!embedded, () => onClose?.());
  useBackHandler(isMobile && mobileSection !== null, () => setMobileSection(null));

  const q = query.trim().toLowerCase();
  const nameMatch = (name: string) => !q || name.toLowerCase().includes(q);

  const camping = useMemo(() => campingActivities(content), [content]);
  const activities = useMemo(() => kingdomActivities(content), [content]);
  const feats = useMemo(() => kingdomFeats(content), [content]);

  const Overview = (
    <div className="mpr-section">
      <h3 className="mpr-h">Kingmaker content</h3>
      <p>
        Turning <strong>Kingmaker</strong> on in a character's Setup → Campaign card unlocks the Adventure Path's
        player-facing content: its backgrounds, feats, spells, and items become selectable, and its two subsystems come
        into play — <strong>camping</strong> (below) and the <strong>kingdom</strong> your party rules.
      </p>
      <ul className="mpr-ul">
        <li>
          <strong>Camping</strong> activities appear in the Play tab's action list while Kingmaker is on — the things you
          do to make a wilderness camp safe and restful before your daily preparations.
        </li>
        <li>
          The <strong>Kingdom</strong> is tracked on a lightweight per-campaign Kingdom sheet (its four attributes,
          Unrest, and kingdom feats) — see the next tabs for the rules it summarizes.
        </li>
      </ul>
      <p className="mpr-note">
        Army/warfare rules (armies, tactics, siege) are intentionally out of scope here — this app covers the parts a
        player interacts with at the table, not the full mass-combat minigame.
      </p>
    </div>
  );

  const Camping = (
    <div className="mpr-section">
      <h3 className="mpr-h">Camping &amp; daily preparations</h3>
      <p>
        When you make camp in the wilderness, the party first <strong>sets up camp</strong> (a Survival check whose DC
        rises with the region's danger), then each character can attempt <strong>one camping activity</strong> during the
        night before daily preparations. Tap an activity to read it. ({camping.length} available.)
      </p>
      <div className="mpr-proplist">
        {camping.filter((a) => nameMatch(a.name)).map((a) => (
          <EntryTerm key={a.id} item={a} descKey="actions" />
        ))}
        {camping.filter((a) => nameMatch(a.name)).length === 0 && <p className="mpr-note">No camping activities match “{query.trim()}”.</p>}
      </div>
    </div>
  );

  const Kingdom = (
    <div className="mpr-section">
      <h3 className="mpr-h">The Kingdom</h3>
      <p>
        Your party collectively rules a kingdom — effectively a character in its own right, with a level, attributes, and
        activities taken on a <strong>Kingdom turn</strong> (roughly one per in-world month).
      </p>
      <ul className="mpr-ul">
        <li>
          <strong>Four attributes</strong> — <strong>Culture</strong>, <strong>Economy</strong>, <strong>Loyalty</strong>,
          and <strong>Stability</strong> — each give a modifier that (with the <strong>Control DC</strong>, set by kingdom
          level) drives every kingdom skill check.
        </li>
        <li>
          <strong>Unrest</strong> measures how close the kingdom is to collapse. It rises from events and failed checks;
          each point is a penalty to kingdom checks, and enough of it inflicts <strong>Ruin</strong> (Corruption, Crime,
          Decay, Strife).
        </li>
        <li>
          <strong>Resource Points (RP)</strong>, <strong>Fame/Infamy</strong>, and your <strong>settlements &amp; hexes</strong>{' '}
          are spent and grown through kingdom activities.
        </li>
        <li>
          A Kingdom turn runs four phases: <strong>Upkeep</strong> → <strong>Commerce</strong> → <strong>Activity</strong>{' '}
          (Region, Civic, and Leadership activities) → <strong>Event</strong>.
        </li>
      </ul>
      <p className="mpr-note">
        This app tracks the player-facing essentials — the four attributes, Unrest, and your chosen kingdom feats — on a
        per-campaign Kingdom sheet, rather than the full hex-by-hex kingdom-management ledger.
      </p>
    </div>
  );

  const Activities = (
    <div className="mpr-section">
      <h3 className="mpr-h">Kingdom activities</h3>
      <p>
        The activities your kingdom takes during a Kingdom turn — Leadership, Region, and Civic actions plus Upkeep and
        Commerce steps. Tap one to read it. ({activities.length} available.)
      </p>
      <div className="mpr-proplist">
        {activities.filter((a) => nameMatch(a.name)).map((a) => (
          <EntryTerm key={a.id} item={a} descKey="actions" />
        ))}
        {activities.filter((a) => nameMatch(a.name)).length === 0 && <p className="mpr-note">No kingdom activities match “{query.trim()}”.</p>}
      </div>
    </div>
  );

  const Feats = (
    <div className="mpr-section">
      <h3 className="mpr-h">Kingdom feats</h3>
      <p>
        Feats taken by the <em>kingdom</em> (not an individual character), chosen as the kingdom levels up. Tap a feat to
        read it. ({feats.length} available.)
      </p>
      {byLevel(feats.filter((f) => nameMatch(f.name))).map(([lvl, fs]) => (
        <div key={lvl} className="mpr-kind">
          <div className="mpr-kind-head">
            <span className="mpr-kind-name">Level {lvl}</span>
          </div>
          <div className="mpr-proplist">
            {fs.sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
              <EntryTerm key={f.id} item={f} descKey="feats" level={f.level} />
            ))}
          </div>
        </div>
      ))}
      {feats.filter((f) => nameMatch(f.name)).length === 0 && <p className="mpr-note">No kingdom feats match “{query.trim()}”.</p>}
    </div>
  );

  const render = (id: SectionId): ReactNode =>
    id === 'overview' ? Overview : id === 'camping' ? Camping : id === 'kingdom' ? Kingdom : id === 'activities' ? Activities : Feats;

  const searching = q.length > 0;
  const matched = new Set<SectionId>(
    SECTIONS.filter((s) => !searching || SECTION_KEYWORDS[s.id].includes(q) || s.label.toLowerCase().includes(q) ||
      (s.id === 'camping' && camping.some((a) => nameMatch(a.name))) ||
      (s.id === 'activities' && activities.some((a) => nameMatch(a.name))) ||
      (s.id === 'feats' && feats.some((f) => nameMatch(f.name)))).map((s) => s.id),
  );
  const orderedMatches = SECTIONS.filter((s) => matched.has(s.id)).map((s) => s.id);
  const activeSection: SectionId = searching ? (matched.has(section) ? section : orderedMatches[0] ?? 'overview') : section;
  const noMatches = searching && orderedMatches.length === 0;

  const search = (
    <div className="src-search mpr-page-search">
      <i className="ti ti-search" aria-hidden="true" />
      <input type="text" placeholder="Search Kingmaker…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search Kingmaker rules" />
      {query && (
        <button type="button" className="src-search-x" aria-label="Clear search" onClick={() => setQuery('')}>
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const headTitle = isMobile && mobileSection ? SECTIONS.find((s) => s.id === mobileSection)?.label ?? 'Kingmaker' : 'Kingmaker';

  return (
    <div className={'picker-overlay' + (embedded ? ' mpr-embedded' : '')} onClick={embedded ? undefined : onClose}>
      <div
        className={'picker settings-modal mpr-modal' + (isMobile && !embedded ? ' settings-page-m' : '') + (embedded ? ' mpr-embedded-modal' : '')}
        role="dialog"
        aria-label="Kingmaker rules"
        onClick={(e) => e.stopPropagation()}
      >
        {(!embedded || !isMobile || mobileSection) && (
          <div className="picker-head">
            {isMobile && mobileSection && !searching && (
              <button className="icon-btn settings-back" aria-label="Back" onClick={() => setMobileSection(null)}>
                <i className="ti ti-arrow-left" aria-hidden="true" />
              </button>
            )}
            {headTitle}
            {!embedded && (
              <button className="picker-close" onClick={onClose} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true" />
              </button>
            )}
          </div>
        )}
        {isMobile ? (
          <>
            <div className="mpr-search-wrap">{search}</div>
            {searching ? (
              noMatches ? (
                <div className="settings-pane">
                  <p className="mpr-note">Nothing matches “{query.trim()}”.</p>
                </div>
              ) : (
                <div className="settings-pane">
                  <nav className="mpr-jump" aria-label="Matching sections">
                    {orderedMatches.map((id) => {
                      const s = SECTIONS.find((x) => x.id === id)!;
                      return (
                        <button key={id} className={'mpr-jump-btn' + (activeSection === id ? ' active' : '')} onClick={() => setSection(id)}>
                          <i className={'ti ' + s.icon} aria-hidden="true" /> {s.label}
                        </button>
                      );
                    })}
                  </nav>
                  {render(activeSection)}
                </div>
              )
            ) : mobileSection === null ? (
              <div className="settings-cards">
                {SECTIONS.map((s) => (
                  <button key={s.id} className="settings-card" onClick={() => setMobileSection(s.id)}>
                    <i className={'ti ' + s.icon} aria-hidden="true" />
                    <span>{s.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="settings-pane">{render(mobileSection)}</div>
            )}
          </>
        ) : (
          <div className="settings-body">
            <nav className="settings-nav" aria-label="Kingmaker sections">
              {search}
              {SECTIONS.map((s) => {
                const dim = searching && !matched.has(s.id);
                return (
                  <button
                    key={s.id}
                    className={'settings-navitem' + (activeSection === s.id ? ' active' : '') + (dim ? ' mpr-nav-dim' : '')}
                    onClick={() => setSection(s.id)}
                    disabled={dim}
                  >
                    <i className={'ti ' + s.icon} aria-hidden="true" /> {s.label}
                  </button>
                );
              })}
            </nav>
            <div className="settings-pane">{noMatches ? <p className="mpr-note">Nothing matches “{query.trim()}”.</p> : render(activeSection)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
