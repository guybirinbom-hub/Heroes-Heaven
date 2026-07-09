/*
 * Mythic — in-app RULES REFERENCE page (War of Immortals mythic rules).
 *
 * Same full-screen shell as MonsterPartsRules / SettingsPage. Prose sections (Overview, Mythic Points)
 * are hand-written; the Callings, Mythic Feats, and Destinies lists are rendered FROM THE CONTENT DATA
 * (classFeatures with the `calling` trait; feats with the `mythic` trait) so the reference can't drift.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { ContentDatabase, DescRef, Feat } from '../rules/types';
import { useIsMobile } from './useIsMobile';
import { useBackHandler } from './useEscapeClose';
import { InfoTerm } from './InfoTerm';

type SectionId = 'overview' | 'points' | 'callings' | 'feats' | 'destinies';
const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: 'ti-book-2' },
  { id: 'points', label: 'Mythic points', icon: 'ti-flame' },
  { id: 'callings', label: 'Callings', icon: 'ti-compass' },
  { id: 'feats', label: 'Mythic feats', icon: 'ti-award' },
  { id: 'destinies', label: 'Destinies', icon: 'ti-star' },
];

const SECTION_KEYWORDS: Record<SectionId, string> = {
  overview: 'overview become mythic calling destiny trait toggle gm grants archetype',
  points: 'mythic points pool refocus refresh daily preparations reroll spend recall the teachings d20 surge',
  callings: 'calling callings echoes acrobat artisan guardian hunter sage thief level 1 benefit',
  feats: 'mythic feats slot even levels 2 4 6 8 10 godspeed fiery rebirth strike counterspell',
  destinies:
    'destiny destinies dedication capstone level 12 14 16 18 20 apocalypse rider archfiend ascended celestial avenging runelord beast lord broken chain eternal legend godling heroic scion prophesied monarch timewracked warshard warrior wildspell mortal herald',
};

const cmp = (n: number): string => `${n}`; // (kept: parity with rules-page number formatting)

type Described = { id: string; name: string; description: string; descRefs?: DescRef[]; level?: number };

/** A described entry (calling / feat) — tap the name to read its full description. */
function EntryTerm({ item, descKey }: { item: Described; descKey: string }) {
  return (
    <div className="mpr-feat">
      <div className="mpr-feat-head">
        <span className="mpr-feat-name">
          <InfoTerm title={item.name} description={item.description} descRefs={item.descRefs} descKey={descKey}>
            {item.name}
          </InfoTerm>
        </span>
        {item.level != null && <span className="mpr-feat-type">Level {cmp(item.level)}</span>}
      </div>
    </div>
  );
}

/** Group described entries by level, ascending. */
function byLevel<T extends { level?: number }>(items: T[]): [number, T[]][] {
  const m = new Map<number, T[]>();
  for (const it of items) (m.get(it.level ?? 0) ?? m.set(it.level ?? 0, []).get(it.level ?? 0)!).push(it);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

export interface DestinyGroup {
  slug: string;
  /** The L12 dedication feat (heading); may be undefined if the data omits it. */
  dedication: Feat | undefined;
  /** The destiny's mythic feats (excluding the dedication), sorted by level then name. */
  feats: Feat[];
  /** Display name — the dedication name with a trailing " Dedication" stripped. */
  name: string;
}

/** The 18 mythic callings (calling-trait class features), alphabetical. Entry point to the mythic. */
export function mythicCallings(content: ContentDatabase) {
  return Object.values(content.classFeatures)
    .filter((f) => (f.traits ?? []).includes('calling'))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The GENERAL mythic feats — mythic-trait feats belonging to no archetype (fill even-level slots). */
export function generalMythicFeats(content: ContentDatabase) {
  return Object.values(content.feats).filter((f) => (f.traits ?? []).includes('mythic') && !f.archetype);
}

/** The mythic DESTINIES: every archetype slug that owns a mythic feat, resolved to {dedication, feats}.
 *  Covers the 13 destiny-trait dedications plus Mortal Herald (a plain archetype with mythic feats). */
export function mythicDestinies(content: ContentDatabase): DestinyGroup[] {
  const allFeats = Object.values(content.feats);
  const mythicFeats = allFeats.filter((f) => (f.traits ?? []).includes('mythic'));
  const slugs = [...new Set(mythicFeats.map((f) => f.archetype).filter((s): s is string => !!s))];
  return slugs
    .map((slug) => {
      const groupFeats = allFeats.filter((f) => f.archetype === slug);
      // The dedication is the feat whose name ends in "Dedication" (unambiguous); some destiny feats
      // also carry category 'class', so keying off the name is what keeps the group heading correct.
      const dedication = groupFeats.find((f) => /\bdedication$/i.test(f.name)) ?? groupFeats.find((f) => f.category === 'class');
      const feats = groupFeats
        .filter((f) => f !== dedication && (f.traits ?? []).includes('mythic'))
        .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
      return { slug, dedication, feats, name: dedication ? dedication.name.replace(/ Dedication$/i, '') : slug };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function MythicRules({ content, onClose, embedded = false }: { content: ContentDatabase; onClose?: () => void; embedded?: boolean }) {
  const isMobile = useIsMobile();
  const [section, setSection] = useState<SectionId>('overview');
  const [mobileSection, setMobileSection] = useState<SectionId | null>(null);
  const [query, setQuery] = useState('');
  useBackHandler(!embedded, () => onClose?.());
  useBackHandler(isMobile && mobileSection !== null, () => setMobileSection(null));

  const q = query.trim().toLowerCase();
  const nameMatch = (name: string) => !q || name.toLowerCase().includes(q);

  const callings = useMemo(() => mythicCallings(content), [content]);
  const generalFeats = useMemo(() => generalMythicFeats(content), [content]);
  const destinyGroups = useMemo(() => mythicDestinies(content), [content]);

  const Overview = (
    <div className="mpr-section">
      <h3 className="mpr-h">Becoming mythic</h3>
      <p>
        A character becomes <strong>mythic</strong> when the GM grants them a <strong>mythic calling</strong> — a themed,
        archetype-like package with a level-1 benefit, access to that calling's mythic feats, and the{' '}
        <strong>mythic trait</strong>. Turn Mythic <em>on</em> in a character's Setup → Campaign card to unlock all
        mythic-trait content; turning it off hides callings, mythic feats, destinies, and any mythic action or item.
      </p>
      <ul className="mpr-ul">
        <li>
          <strong>A mythic feat slot</strong> opens at every even level (2–20); low-level mythic feats fill it.
        </li>
        <li>
          At mid-levels you choose a <strong>mythic destiny</strong> — a capstone path (Apocalypse Rider, Archfiend,
          Ascended Celestial, …) taken through your mythic feat slots, with destiny feats at 14/16/18/20.
        </li>
        <li>
          You have a small pool of <strong>mythic points</strong> (see the next tab) that power rerolls and mythic
          abilities, refilled at your daily preparations.
        </li>
      </ul>
      <p className="mpr-note">
        Content with the <strong>mythic</strong> trait is only available to mythic characters and usually interacts with
        mythic points. In this app, the whole mythic subsystem is gated behind the single Mythic setup toggle.
      </p>
    </div>
  );

  const Points = (
    <div className="mpr-section">
      <h3 className="mpr-h">Mythic points</h3>
      <p>
        A mythic character has a pool of <strong>mythic points</strong> (up to 3 in this app), refreshed to full at your{' '}
        <strong>daily preparations</strong> (a full night's rest). Spend them for larger-than-life feats.
      </p>
      <ul className="mpr-ul">
        <li>
          <strong>Recall the Teachings (mythic reroll):</strong> spend 1 mythic point to reroll a d20 you just rolled
          (attack, save, skill, Perception, or flat check) and take the new result — a defining mythic safety net.
        </li>
        <li>
          <strong>Power mythic abilities:</strong> many mythic feats, calling actions, and mythic activities cost 1
          mythic point to use. Spend from the same shared pool.
        </li>
      </ul>
      <p className="mpr-note">
        On the sheet, track your points with the mythic pips beside Hero Points and use the mythic panel to spend them;
        Daily preparations (the bed icon) refills the pool.
      </p>
    </div>
  );

  const Callings = (
    <div className="mpr-section">
      <h3 className="mpr-h">Mythic callings</h3>
      <p>
        A calling is your entry into the mythic — chosen when you become mythic. It grants a level-1 benefit and unlocks
        that calling's mythic feats. Tap a calling to read it. ({callings.length} in your enabled sources.)
      </p>
      <div className="mpr-proplist">
        {callings.filter((c) => nameMatch(c.name)).map((c) => (
          <EntryTerm key={c.id} item={c} descKey="classFeatures" />
        ))}
        {callings.filter((c) => nameMatch(c.name)).length === 0 && <p className="mpr-note">No callings match “{query.trim()}”.</p>}
      </div>
    </div>
  );

  const Feats = (
    <div className="mpr-section">
      <h3 className="mpr-h">Mythic feats</h3>
      <p>
        The <strong>general</strong> mythic feats — available to any mythic hero and chosen with your even-level (2–20)
        mythic feat slots, regardless of calling or destiny. Destiny-specific feats live under <strong>Destinies</strong>.
        Tap a feat to read it. ({generalFeats.length} available.)
      </p>
      {byLevel(generalFeats.filter((f) => nameMatch(f.name))).map(([lvl, feats]) => (
        <div key={lvl} className="mpr-kind">
          <div className="mpr-kind-head">
            <span className="mpr-kind-name">Level {cmp(lvl)}</span>
          </div>
          <div className="mpr-proplist">
            {feats.sort((a, b) => a.name.localeCompare(b.name)).map((f) => (
              <EntryTerm key={f.id} item={f} descKey="feats" />
            ))}
          </div>
        </div>
      ))}
      {generalFeats.filter((f) => nameMatch(f.name)).length === 0 && <p className="mpr-note">No mythic feats match “{query.trim()}”.</p>}
    </div>
  );

  const matchedDestinies = destinyGroups.filter((g) => nameMatch(g.name) || g.feats.some((f) => nameMatch(f.name)));
  const Destinies = (
    <div className="mpr-section">
      <h3 className="mpr-h">Mythic destinies</h3>
      <p>
        A destiny is a mythic archetype that redefines a hero — a <strong>Level 12 dedication</strong> taken with your
        mythic feat slot, followed by its own destiny feats at higher levels. Tap the dedication (the heading) or any
        feat to read it. ({destinyGroups.length} destinies.)
      </p>
      {matchedDestinies.map((g) => {
        const feats = nameMatch(g.name) ? g.feats : g.feats.filter((f) => nameMatch(f.name));
        return (
          <div key={g.slug} className="mpr-kind">
            <div className="mpr-kind-head">
              <span className="mpr-kind-name">
                {g.dedication ? (
                  <InfoTerm
                    title={g.dedication.name}
                    description={g.dedication.description}
                    descRefs={g.dedication.descRefs}
                    descKey="feats"
                  >
                    {g.name}
                  </InfoTerm>
                ) : (
                  g.name
                )}
              </span>
              <span className="mpr-feat-type">Level {cmp(g.dedication?.level ?? 12)}</span>
            </div>
            <div className="mpr-proplist">
              {feats.map((f) => (
                <EntryTerm key={f.id} item={f} descKey="feats" />
              ))}
            </div>
          </div>
        );
      })}
      {matchedDestinies.length === 0 && <p className="mpr-note">No destinies match “{query.trim()}”.</p>}
    </div>
  );

  const render = (id: SectionId): ReactNode =>
    id === 'overview' ? Overview : id === 'points' ? Points : id === 'callings' ? Callings : id === 'feats' ? Feats : Destinies;

  const searching = q.length > 0;
  const matched = new Set<SectionId>(
    SECTIONS.filter((s) => !searching || SECTION_KEYWORDS[s.id].includes(q) || s.label.toLowerCase().includes(q) ||
      (s.id === 'callings' && callings.some((c) => nameMatch(c.name))) ||
      (s.id === 'feats' && generalFeats.some((f) => nameMatch(f.name))) ||
      (s.id === 'destinies' && matchedDestinies.length > 0)).map((s) => s.id),
  );
  const orderedMatches = SECTIONS.filter((s) => matched.has(s.id)).map((s) => s.id);
  const activeSection: SectionId = searching ? (matched.has(section) ? section : orderedMatches[0] ?? 'overview') : section;
  const noMatches = searching && orderedMatches.length === 0;

  const search = (
    <div className="src-search mpr-page-search">
      <i className="ti ti-search" aria-hidden="true" />
      <input type="text" placeholder="Search Mythic…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search Mythic rules" />
      {query && (
        <button type="button" className="src-search-x" aria-label="Clear search" onClick={() => setQuery('')}>
          <i className="ti ti-x" aria-hidden="true" />
        </button>
      )}
    </div>
  );

  const headTitle = isMobile && mobileSection ? SECTIONS.find((s) => s.id === mobileSection)?.label ?? 'Mythic' : 'Mythic';

  return (
    <div className={'picker-overlay' + (embedded ? ' mpr-embedded' : '')} onClick={embedded ? undefined : onClose}>
      <div
        className={'picker settings-modal mpr-modal' + (isMobile && !embedded ? ' settings-page-m' : '') + (embedded ? ' mpr-embedded-modal' : '')}
        role="dialog"
        aria-label="Mythic rules"
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
            <nav className="settings-nav" aria-label="Mythic sections">
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
