// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect, useRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { content } from './_content';
import type { SavedChar } from '../src/data/storage';
import type { BuildOverrides, BuildState } from '../src/rules/build';
import type { Character, ContentDatabase } from '../src/rules/types';

/**
 * ONE CONTENT PATH — docs/overrides-redesign.md, Building blocks item 7; plan checker fixes C1 and C9
 * (work/tweaks-part-a-notes/tweaks-part-a-plan.md).
 *
 * A player's Overrides `contentEdits` (a shallow patch of a feat's fields) reached the sheet, the Builder
 * and the GM edit sheet only — every other surface derived the character against RAW content. So a
 * contentEdit that changed a feat's `maxHpBonus` or `saveBonuses` showed one number on the player's
 * sheet and another on the party card, the tracker row, the read-only party viewer and the roster card,
 * and the GM's HP write (pcSheetTruth `sheetWithVitals`: damage = max − current HP) used the raw max —
 * a heal the player never had, written back over their HP.
 *
 * Now `contentFor(db, overrides)` (src/rules/blocks/content.ts) is the one path, called by the derive
 * boundary from the character's own overrides. This pins, for ONE synthetic character:
 *   (1) every surface equals the sheet: max HP, current HP, Reflex (an edit of a printed feat) and
 *       Fortitude (an edit of the player's own HOMEBREW feat, which on a GM's device exists only as a
 *       record the sheet CARRIES — the order: carried records first, then the edits); and the reverse:
 *       a TEAMMATE on the Party page inside this player's sheet never gets this player's edits (fixer
 *       2026-10-21: PartyPage was handed the sheet's edited content and drew 35 / 35 for a 29 / 29 mate);
 *   (2) the derive boundary itself: each entry point, handed RAW content, applies the character's edits
 *       (incl. a phantom-damage seed in initialPlay when an edit LOWERS max HP). Each entry point is
 *       measured on a number only IT routes: AC for computeSummary, Encumbered (a feat's Bulk limit) for
 *       applyPlayState — max HP alone could not tell, since deriveMaxHp applies the edits itself
 *       (fixer 2026-10-20: removing either call left all legs green before; a temp-copy plant of each
 *       removal now fails 2 and 1 tests);
 *   (3) loading is not an edit — no new authoredKey, nothing pushed, the sheet object untouched;
 *   (4) the cache (C9): the same database object for the same base and the same contentEdits object.
 * Before the change, (1)'s party card, tracker row, vitals, GM HP write, party viewer and roster card
 * legs failed (run 2026-10-20, recorded in the item-7 report). Every name and record here is synthetic.
 */

const server = vi.hoisted(() => ({
  chars: new Map<string, Record<string, unknown>>(),
  edits: new Map<string, Record<string, unknown>>(),
  editWrites: [] as Record<string, unknown>[],
  charWrites: 0,
}));

vi.mock('../src/data/supabase', () => {
  const rows = (table: string): Record<string, unknown>[] => [...(table === 'campaign_characters' ? server.chars : server.edits).values()];
  function from(table: string) {
    const where: Record<string, unknown> = {};
    const matched = () => rows(table).filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
    const answer = () => ({ data: matched(), error: null });
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => {
        where[col] = val;
        return q;
      },
      order: () => Promise.resolve(answer()),
      maybeSingle: () => Promise.resolve({ data: matched()[0] ?? null, error: null }),
      then: (ok: (v: { data: unknown; error: unknown }) => unknown) => Promise.resolve(answer()).then(ok),
      upsert: (row: Record<string, unknown>) => {
        const key = `${row.campaign_id as string}|${row.char_id as string}`;
        if (table === 'campaign_characters') {
          server.chars.set(key, row);
          server.charWrites++;
        } else {
          server.edits.set(key, row);
          server.editWrites.push(row);
        }
        return Promise.resolve({ error: null });
      },
      delete: () => q,
    };
    return q;
  }
  const channel = {
    on: () => channel,
    subscribe(cb?: (s: string) => void) {
      cb?.('SUBSCRIBED');
      return channel;
    },
  };
  return {
    supabase: {
      from,
      channel: () => channel,
      removeChannel: () => undefined,
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'gm-1' } } } }),
        getUser: async () => ({ data: { user: { id: 'gm-1' } } }),
        signOut: async () => ({ error: null }),
      },
    },
    isCloudSyncEnabled: true,
    isCloudConfigured: true,
  };
});

const { contentFor } = await import('../src/rules/blocks/content');
const { computeSummary, memberSummary } = await import('../src/sheet/partySummary');
const { applyPlayState, initialPlay } = await import('../src/rules/play');
const { buildCharacter, emptyBuild } = await import('../src/rules/build');
const { deriveAc, deriveMaxHp, deriveSave } = await import('../src/rules/derive');
const { computePcStats, sheetPcStats } = await import('../src/integration/computePcStats');
const { sheetWithVitals, vitalsFromSheet } = await import('../src/integration/pcSheetTruth');
const { memberCardSummary } = await import('../src/sheet/memberSheets');
const { collectCarried, foreignContent, ownContent } = await import('../src/data/carried');
const { rebuildRoster } = await import('../src/data/rebuild');
const { authoredKey } = await import('../src/data/authored');
const { exportWg } = await import('../src/data/transfer');
const { forgetMissingColumns } = await import('../src/data/party');
const { clearGmPendingEdits } = await import('../src/sheet/gmSync');
const { saveRoster } = await import('../src/data/storage');
const { GmEditSheet } = await import('../src/sheet/GmEditSheet');
const { useMemberViewer } = await import('../src/sheet/PartyMembers');
const { RosterScreen } = await import('../src/sheet/RosterScreen');
const { useLocalCampaignMembers } = await import('../src/integration/useLocalCampaignMembers');
const { playerFacingContent } = await import('../src/rules/cursedItems');
const { CharacterSheet } = await import('../src/sheet/CharacterSheet');
const { ContentContext } = await import('../src/sheet/ContentContext');

/** The GM's (and a teammate's) database: the shipped content, none of the player's homebrew. */
const db = content();
const CAMPAIGN = 'camp-content-path';
const PLAYER = 'player-cp';
const CHAR = 'pc-content-path';
const AT = '2026-10-20T10:00:00.000Z';

/** The PLAYER's own homebrew ancestry feat — on the GM's device it exists only as a CARRIED record. */
const FEAT = {
  id: 'hb-feat-cinderwise',
  name: 'Cinderwise',
  level: 1,
  category: 'ancestry',
  traits: ['human'],
  rarity: 'common',
  description: 'You read a fire like a page.',
  source: { license: 'homebrew', book: 'Ashfall Notes' },
};
const ownerDb = { ...db, feats: { ...db.feats, [FEAT.id]: FEAT } } as unknown as ContentDatabase;

/**
 * The player's edits: Toughness grants 6 more Hit Points (a printed feat, max HP) and +1 natural-armour
 * AC while unarmored (a number only `deriveAc` reads — so the card's AC pins computeSummary's OWN
 * contentFor call: deriveMaxHp applies the edits itself and would hide its loss), Fleet a +2 status
 * bonus to Reflex (a printed feat, a save) and +20 Bulk limit (read by applyPlayState's Encumbered check
 * — pins applyPlayState's own call the same way), and their own Cinderwise a +2 status bonus to
 * Fortitude (the carried homebrew feat — the order pin).
 */
const EDITS = {
  feats: {
    toughness: { maxHpBonus: { perLevel: 1, flat: 6 }, unarmoredAc: { acBonus: 1 } },
    fleet: { saveBonuses: [{ save: 'reflex', value: 2, type: 'status' }], bulkLimitBonus: 20 },
    [FEAT.id]: { saveBonuses: [{ save: 'fortitude', value: 2, type: 'status' }] },
  },
} as unknown as NonNullable<BuildOverrides['contentEdits']>;

function buildOf(edits: boolean): BuildState {
  const cls = db.classes.sorcerer;
  return {
    ...emptyBuild(),
    name: 'Brannoc Weld',
    level: 3,
    classId: 'sorcerer',
    subclassId: cls.subclass?.options[0]?.id ?? null,
    ancestryId: 'human',
    heritageId: 'versatile-human',
    backgroundId: 'acolyte',
    keyAbility: 'cha',
    featPicks: { '1:ancestry:0': FEAT.id },
    overrides: {
      addedFeats: [
        { featId: 'toughness', level: 1, category: 'general' },
        { featId: 'fleet', level: 1, category: 'general' },
      ],
      ...(edits ? { contentEdits: EDITS } : {}),
    },
  } as BuildState;
}

/** The player's roster entry as their app holds it: built on their device (the app's onCreate — the edits
 *  laid over explicitly, as onCreate did before this change and buildCharacter does itself after it, so
 *  the fixture is the same sheet on both sides of the change), play seeded by the first play edit
 *  (initialPlay), and the custom records it uses carried (App's publish). */
function playerSheet(edits = true): SavedChar {
  const build = buildOf(edits);
  const character = buildCharacter(build, contentFor(ownerDb, build.overrides));
  const play = initialPlay(character, ownerDb);
  const sc = { id: CHAR, character, build, play } as SavedChar;
  const carried = collectCarried(sc, ownContent(ownerDb, sc));
  return { ...sc, ...(carried ? { carried } : {}) };
}

/** THE SHEET's numbers, exactly as src/App.tsx draws the player's own sheet: `activeContent` (own view),
 *  `character` = applyPlayState against it, `sheetContent` = contentFor(activeContent, overrides). */
function sheetNumbers(sc: SavedChar) {
  const activeContent = ownContent(ownerDb, sc);
  const character = applyPlayState(sc.character, sc.play, activeContent);
  const sheetContent = contentFor(activeContent, sc.character.overrides);
  return {
    max: deriveMaxHp(character, sheetContent),
    cur: character.hitPoints.current,
    ac: deriveAc(character, sheetContent).value,
    reflex: deriveSave(character, 'reflex', sheetContent).modifier,
    fortitude: deriveSave(character, 'fortitude', sheetContent).modifier,
  };
}

/** The sheet carrying 10,000 gp in play — 10 Bulk of coins, Encumbered at the printed limit and not once
 *  Fleet's edited +20 Bulk limit applies. Read through applyPlayState's own Encumbered derivation. */
function heavyPurse(sc: SavedChar): SavedChar {
  return { ...sc, play: { ...sc.play!, currency: { gp: 10_000 } } } as SavedChar;
}
const encumbered = (c: Character) => (c.conditions ?? []).some((x) => x.id === 'encumbered');

/** What the player's app publishes (src/App.tsx publish effect): summary + sheet, one row. */
function publish(sc: SavedChar): void {
  const view = ownContent(ownerDb, sc);
  const live = applyPlayState(sc.character, sc.play, view);
  server.chars.set(`${CAMPAIGN}|${sc.id}`, {
    campaign_id: CAMPAIGN,
    owner_id: PLAYER,
    char_id: sc.id,
    name: live.name,
    summary: computeSummary(live, view),
    sheet: sc,
    updated_at: AT,
  });
}

const member = (sc: SavedChar) => ({ ownerId: PLAYER, charId: sc.id, name: sc.character.name, summary: undefined }) as never;

let root: Root | null = null;
function render(el: ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
/** The sheet's vitals rail as drawn: "/ max", and a save row's modifier. */
function railNumbers(host: HTMLElement) {
  const max = Number((host.querySelector('.hp-max')?.textContent ?? '').replace(/[^0-9-]/g, ''));
  const save = (label: string) => {
    const row = [...host.querySelectorAll('.saves-strip .stat-row')].find((r) => (r.querySelector('.stat-name')?.textContent ?? '').startsWith(label));
    return Number((row?.querySelector('.stat-mod')?.textContent ?? 'NaN').replace('−', '-').replace('+', ''));
  };
  return { max, reflex: save('Reflex'), fortitude: save('Fortitude') };
}

function Viewer(): ReactElement {
  const { sheetEl, open } = useMemberViewer(db);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void open(CAMPAIGN, CHAR, PLAYER);
  });
  return <div>{sheetEl}</div>;
}

let localMembers: ReturnType<typeof useLocalCampaignMembers> = [];
function LocalMembers(): ReactElement {
  localMembers = useLocalCampaignMembers(CAMPAIGN, ownerDb);
  return <div />;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
  if (!window.matchMedia)
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  server.chars.clear();
  server.edits.clear();
  server.editWrites.length = 0;
  server.charWrites = 0;
  forgetMissingColumns();
  clearGmPendingEdits();
  localStorage.clear();
});

describe('fixture', () => {
  it("the edits move the player's own sheet: +6 max HP, +2 Reflex, +2 Fortitude; the GM lacks the homebrew feat", () => {
    const on = sheetNumbers(playerSheet(true));
    const off = sheetNumbers(playerSheet(false));
    expect(on.max - off.max, 'Toughness edit').toBe(6);
    expect(on.ac - off.ac, 'Toughness AC edit (the fixture is unarmored)').toBe(1);
    expect(on.reflex - off.reflex, 'Fleet edit').toBe(2);
    // Fleet's Bulk-limit edit: 10,000 gp is Encumbered at the printed limit, not with the edit.
    const heavyOff = heavyPurse(playerSheet(false));
    expect(encumbered(applyPlayState(heavyOff.character, heavyOff.play, ownContent(ownerDb, heavyOff))), 'no edit: Encumbered').toBe(true);
    const heavyOn = heavyPurse(playerSheet(true));
    expect(encumbered(applyPlayState(heavyOn.character, heavyOn.play, contentFor(ownContent(ownerDb, heavyOn), heavyOn.character.overrides))), 'with the edit').toBe(false);
    expect(on.fortitude - off.fortitude, 'the carried homebrew feat edit').toBe(2);
    expect(db.feats[FEAT.id], 'the GM database lacks the player feat').toBeUndefined();
    expect(Object.keys(playerSheet().carried?.feats ?? {}), 'the feat rides along').toEqual([FEAT.id]);
  });
});

describe('item 7 / C1 pin: every surface shows the sheet’s numbers', () => {
  it("the player's own sheet: at full health its current HP is its max (App's `character` gets the edits too)", () => {
    // Before the change App derived `character` (applyPlayState) against the plain view and only the
    // sheet's numbers against `sheetContent`: an edit that raised max HP drew "29 / 35" at full health.
    const sheet = sheetNumbers(playerSheet());
    expect(sheet.cur).toBe(sheet.max);
  });

  it('the party card (memberCardSummary — PartyMembers and the tracker), the pending card (memberSummary) and the publish summary', () => {
    const sc = playerSheet();
    const sheet = sheetNumbers(sc);
    expect(memberCardSummary(member(sc), sc, db).hpMax, 'party card on the GM device').toBe(sheet.max);
    expect(memberCardSummary(member(sc), sc, db).hpCur, 'party card current HP').toBe(sheet.cur);
    // AC is read by deriveAc alone (not self-covering like deriveMaxHp): it pins computeSummary's own
    // contentFor call — without it every card draws the raw AC while the sheet draws the edited one.
    expect(memberCardSummary(member(sc), sc, db).ac, 'party card AC').toBe(sheet.ac);
    // PartyMembers' pending-edit card: applyPlayState + memberSummary against the sheet's foreign view.
    const view = foreignContent(db, sc);
    expect(memberSummary(applyPlayState(sc.character, sc.play, view), view).hpMax, 'pending card').toBe(sheet.max);
    expect(memberSummary(applyPlayState(sc.character, sc.play, view), view).ac, 'pending card AC').toBe(sheet.ac);
    // App's publish effect on the player's own device.
    const own = ownContent(ownerDb, sc);
    expect(computeSummary(applyPlayState(sc.character, sc.play, own), own).hpMax, 'published summary').toBe(sheet.max);
    expect(computeSummary(applyPlayState(sc.character, sc.play, own), own).ac, 'published summary AC').toBe(sheet.ac);
  });

  it('the tracker row (sheetPcStats — CampaignTracker): max HP, current HP, Reflex and Fortitude', () => {
    const sc = playerSheet();
    const sheet = sheetNumbers(sc);
    const row = sheetPcStats(sc, db);
    expect(row.maxHP).toBe(sheet.max);
    expect(row.hpCurrent).toBe(sheet.cur);
    expect(row.ac, 'AC (deriveAc only)').toBe(sheet.ac);
    expect(row.refMod, 'a printed feat edited').toBe(sheet.reflex);
    expect(row.fortMod, 'the carried homebrew feat edited (carried first, then the edits)').toBe(sheet.fortitude);
  });

  it("pcSheetTruth: vitalsFromSheet().maxHP equals the sheet, and the GM's HP write keeps the player's real damage", () => {
    const sc = playerSheet();
    const sheet = sheetNumbers(sc);
    const v = vitalsFromSheet(sc, db);
    expect(v.maxHP).toBe(sheet.max);
    expect(v.currentHP).toBe(sheet.cur);
    // GM_EDITS_PC_HP: the GM sets the row to 3 below max — the sheet must read exactly that afterwards.
    const written = sheetWithVitals(sc, { currentHP: sheet.max - 3, maxHP: sheet.max, conditions: [] }, db);
    expect(written.play?.damage, 'damage = the real max − the HP the GM set').toBe(3);
    expect(sheetNumbers(written).cur, 'what the player sees after the write').toBe(sheet.max - 3);
  });

  it('the read-only party viewer (useMemberViewer) draws the sheet’s max HP and saves', async () => {
    const sc = playerSheet();
    const sheet = sheetNumbers(sc);
    publish(sc);
    const host = render(<Viewer />);
    await settle();
    await settle();
    expect(railNumbers(host)).toEqual({ max: sheet.max, reflex: sheet.reflex, fortitude: sheet.fortitude });
  }, 120_000);

  it('the GM edit sheet draws the sheet’s max HP and saves', async () => {
    const sc = playerSheet();
    const sheet = sheetNumbers(sc);
    const host = render(<GmEditSheet initial={sc} live={sc} content={db} campaignId={CAMPAIGN} playerOwnerId={PLAYER} onExit={() => undefined} />);
    await settle();
    expect(railNumbers(host)).toEqual({ max: sheet.max, reflex: sheet.reflex, fortitude: sheet.fortitude });
  }, 120_000);

  it('the roster card (RosterScreen) shows "current / max" as the sheet does', () => {
    const sc = playerSheet();
    const sheet = sheetNumbers(sc);
    const noop = () => undefined;
    const host = render(
      <RosterScreen roster={[sc]} activeId={sc.id} content={ownerDb} onOpen={noop} onNew={noop} onImport={noop} onDuplicate={noop} onArchive={noop} onDelete={noop} />,
    );
    expect(host.textContent ?? '').toContain(`${sheet.cur} / ${sheet.max}`);
  });

  it('the no-login test campaign (useLocalCampaignMembers) summarises the played character, as a publish would', () => {
    const sc = playerSheet();
    const sheet = sheetNumbers(sc);
    const hurt = { ...sc, character: { ...sc.character, campaignIds: [CAMPAIGN] }, play: { ...sc.play!, damage: 4 } } as SavedChar;
    saveRoster([hurt]);
    render(<LocalMembers />);
    expect(localMembers.map((m) => [m.summary?.hpMax, m.summary?.hpCur])).toEqual([[sheet.max, sheet.max - 4]]);
  });

  it("the Wanderer's Guide export's readable snapshot carries the sheet's numbers (the WG character itself has no overrides)", () => {
    const sc = playerSheet();
    const sheet = sheetNumbers(sc);
    const out = JSON.parse(exportWg(sc, ownContent(ownerDb, sc)));
    expect(out.content.max_hp).toBe(sheet.max);
    expect(out.content.proficiencies.SAVE_REFLEX.total).toBe(sheet.reflex);
    expect(out.content.proficiencies.SAVE_FORTITUDE.total).toBe(sheet.fortitude);
    expect(JSON.stringify(out.character), 'the WG file carries no overrides').not.toContain('contentEdits');
  });

  // Fixer 2026-10-21 (finding: PartyPage got the sheet's EDITED content). The Party page inside a
  // player's own sheet draws OTHER characters; contentFor only ever adds, so handed this sheet's
  // content a teammate who shares the edited feat drew this player's edit on top of their own.
  // The teammate here takes Toughness with NO edit; the player edits Toughness to +6 HP.
  it.each([
    ['partyContent (App passes readyContent)', true],
    ['no partyContent: the ambient ContentContext (App: the un-edited own view)', false],
  ])('the Party page inside a player’s own sheet draws a teammate with the teammate’s numbers — %s', async (_label, withProp) => {
    const mine = playerSheet(true);
    const me = { ...mine, character: { ...mine.character, campaignIds: [CAMPAIGN] } } as SavedChar;
    const plain = playerSheet(false);
    const mate = { ...plain, id: 'pc-teammate', character: { ...plain.character, name: 'Odile Varrow' } } as SavedChar;
    const mateSheet = sheetNumbers(mate);
    expect(sheetNumbers(me).max - mateSheet.max, 'fixture: the player’s edit is +6 HP on the shared feat').toBe(6);
    const view = ownContent(ownerDb, mate);
    server.chars.set(`${CAMPAIGN}|${mate.id}`, {
      campaign_id: CAMPAIGN,
      owner_id: 'player-mate',
      char_id: mate.id,
      name: mate.character.name,
      summary: computeSummary(applyPlayState(mate.character, mate.play, view), view),
      sheet: mate,
      updated_at: AT,
    });
    // As src/App.tsx draws the player's own sheet: the context is the own view, `content` the edited one.
    const ownDb = ownContent(ownerDb, me);
    const host = render(
      <ContentContext.Provider value={ownDb}>
        <CharacterSheet
          character={applyPlayState(me.character, me.play, ownDb)}
          content={contentFor(ownDb, me.character.overrides)}
          build={me.build}
          charKey={me.id}
          partyEnabled
          {...(withProp ? { partyContent: ownerDb } : {})}
        />
      </ContentContext.Provider>,
    );
    const partyBtn = host.querySelector<HTMLButtonElement>('.party-tab, button[aria-label="Party"]');
    expect(partyBtn, 'the Party button shows').not.toBeNull();
    act(() => partyBtn!.click());
    await settle();
    await settle();
    const card = [...host.querySelectorAll('.party-card')].find((c) => (c.textContent ?? '').includes('Odile Varrow'));
    expect(card, 'the teammate’s card is drawn').toBeDefined();
    expect(card!.textContent ?? '', 'the teammate’s own max HP, not the player’s edit on top').toContain(`${mateSheet.cur} / ${mateSheet.max}`);
  }, 120_000);
});

describe('the order: carried records first, then the edits (never collected into carried)', () => {
  it('the documented order reaches the carried feat; the reverse order loses the edit; carried copies stay un-edited', () => {
    const sc = playerSheet();
    const ov = sc.character.overrides;
    const right = contentFor(foreignContent(db, sc), ov);
    expect(right.feats[FEAT.id]?.saveBonuses, 'carried first, then the edits').toEqual(EDITS.feats![FEAT.id].saveBonuses);
    const reversed = foreignContent(contentFor(db, ov), sc);
    expect(reversed.feats[FEAT.id]?.saveBonuses, 'the planted bad order loses the edit').toBeUndefined();
    // The derive boundary applies the edits LAST, so a surface handing it the plain view still gets it right.
    expect(computePcStats(applyPlayState(sc.character, sc.play, foreignContent(db, sc)), foreignContent(db, sc)).fortMod).toBe(sheetNumbers(sc).fortitude);
    // collectCarried reads the view before the edits: the record rides along as authored.
    expect((sc.carried?.feats as Record<string, { saveBonuses?: unknown }>)[FEAT.id].saveBonuses, 'the player publish').toBeUndefined();
  });
});

describe('the derive boundary: each entry point applies the character’s own edits on RAW content', () => {
  it('buildCharacter, applyPlayState, deriveMaxHp, computeSummary, computePcStats', () => {
    const sc = playerSheet();
    const sheet = sheetNumbers(sc);
    const own = ownContent(ownerDb, sc); // the view only — no edits laid over it
    expect(buildCharacter(sc.build!, own).hitPoints, 'buildCharacter from the plain view').toEqual(sc.character.hitPoints);
    const live = applyPlayState(sc.character, sc.play, own);
    expect(live.hitPoints.current).toBe(sheet.cur);
    expect(deriveMaxHp(live, own)).toBe(sheet.max);
    expect(computeSummary(live, own).hpMax).toBe(sheet.max);
    expect(computeSummary(live, own).ac, 'computeSummary applies the edits itself (AC: deriveAc only)').toBe(sheet.ac);
    expect(computePcStats(live, own).maxHP).toBe(sheet.max);
    expect(computePcStats(live, own).refMod).toBe(sheet.reflex);
    // applyPlayState's own call, measured on a read that is NOT HP (deriveMaxHp covers itself): the
    // Encumbered check reads the feats' Bulk limits. Handed the plain view, the edited +20 must count.
    const heavy = heavyPurse(sc);
    expect(encumbered(applyPlayState(heavy.character, heavy.play, ownContent(ownerDb, heavy))), 'applyPlayState applies the edits itself (Encumbered)').toBe(false);
    expect(encumbered(applyPlayState(heavy.character, heavy.play, foreignContent(db, heavy))), 'and on a GM device (livePlay)').toBe(false);
  });

  it('initialPlay seeds no phantom damage when an edit LOWERS max HP (the first play edit writes it)', () => {
    const lower = { feats: { toughness: { maxHpBonus: { perLevel: 0 } } } } as unknown as BuildOverrides['contentEdits'];
    const build = { ...buildOf(false), overrides: { ...buildOf(false).overrides, contentEdits: lower } } as BuildState;
    // Built as the app's onCreate built it (the edits laid over), then seeded the way App's / the GM
    // sheet's updatePlay seeds a first play edit: initialPlay against the plain view.
    const character = buildCharacter(build, contentFor(ownerDb, build.overrides));
    const plain = buildCharacter(buildOf(false), ownerDb);
    expect(character.hitPoints.current, 'fixture: the edit lowers max HP by 3').toBe(plain.hitPoints.current - 3);
    expect(initialPlay(character, ownerDb).damage, 'a full-health character starts with no damage').toBe(0);
  });
});

describe('loading is not an edit (spec item 3, C4)', () => {
  it('a launch rebuild of a character with contentEdits changes nothing, and no surface writes or pushes', async () => {
    const sc = playerSheet();
    const before = JSON.stringify(sc);
    const key = authoredKey(sc);
    const [rebuilt] = rebuildRoster([sc], ownerDb);
    expect(JSON.stringify(rebuilt), 'the launch rebuild re-derives the very same sheet').toBe(before);
    expect(authoredKey(rebuilt)).toBe(key);
    publish(sc);
    const writesAfterPublish = server.charWrites;
    // Every routed read path, on the GM's device.
    memberCardSummary(member(sc), sc, db);
    sheetPcStats(sc, db);
    vitalsFromSheet(sc, db);
    const host = render(<Viewer />);
    await settle();
    await settle();
    expect(railNumbers(host).max, 'fixture: the viewer drew').toBe(sheetNumbers(sc).max);
    expect(JSON.stringify(sc), 'no read wrote into the sheet').toBe(before);
    expect(authoredKey(sc)).toBe(key);
    expect(server.charWrites, 'nothing published').toBe(writesAfterPublish);
    expect(server.editWrites, 'nothing pushed').toEqual([]);
  }, 120_000);
});

describe('C9: contentFor is cached by base database, then by the contentEdits object', () => {
  it('same base + same edits object → the same database; a view of a view adds nothing', () => {
    const sc = playerSheet();
    const ov = sc.character.overrides!;
    const a = contentFor(db, ov);
    expect(a).not.toBe(db);
    expect(contentFor(db, ov), 'the same object on every call').toBe(a);
    expect(contentFor(db, { ...ov, addedFeats: [] }), 'another overrides object, the same contentEdits object').toBe(a);
    expect(contentFor(a, ov), 'idempotent on its own output').toBe(a);
    const copy = { ...a } as ContentDatabase;
    expect(contentFor(copy, ov), 'a copy of a prepared database (playerFacingContent, a source filter) is kept as is').toBe(copy);
    const pf = playerFacingContent(a, sc.character.inventory);
    expect(contentFor(pf, ov)).toBe(pf);
    expect(contentFor(db, undefined)).toBe(db);
    expect(contentFor(db, { contentEdits: { feats: {}, classFeatures: {} } })).toBe(db);
    const clone = JSON.parse(JSON.stringify(ov)) as BuildOverrides;
    const b = contentFor(db, clone);
    expect(b, 'a different contentEdits object is a different entry').not.toBe(a);
    expect(b.feats.toughness).toEqual(a.feats.toughness);
    expect(db.feats.toughness.maxHpBonus, 'the shared database is never mutated').toEqual({ perLevel: 1 });
    // The App's character (applyPlayState) and its sheet database meet on one object: the boundary's
    // own call returns what the host made.
    const own = ownContent(ownerDb, sc);
    expect(contentFor(own, sc.character.overrides)).toBe(contentFor(own, (applyPlayState(sc.character, sc.play, own) as Character).overrides));
  });
});
