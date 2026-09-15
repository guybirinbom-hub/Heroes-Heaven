import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import '../builder/builder.css';
import type { ContentDatabase, ModeDef } from '../rules/types';
import { emptyBuild, type BuildState } from '../rules/build';
import { sourceCatalog } from '../rules/sources';
import { useBuilderActions, VariantRulesCard, CampaignOptionsCard, SourcesCard } from '../builder/shared';
// ── The ONLY reference to the initiative tracker in Heroes Heaven. Removed by deleting
// src/integration/ plus these imports and the TRACKER_IN_CAMPAIGN branches. See its README. ──
import { TRACKER_IN_CAMPAIGN, TEST_CAMPAIGNS_WITHOUT_LOGIN } from '../integration/enabled';
import { getRememberedCampaign, rememberCampaign } from '../integration/lastCampaignView';
import { loadLocalDefaults, saveLocalDefaults, deleteLocalDefaults } from '../integration/localCampaignDefaults';
import { trackerUi } from '../integration/trackerUiStore';
/*
 * LAZY, both of them. The tracker is ~747 KB — a fifth of the main bundle — and every player who
 * never opens a campaign was downloading it to look at their own character sheet. These are the only
 * two doors into it from HH, and both render only inside a campaign, so splitting here moves the
 * whole thing (and the bestiary data it pulls) behind the click that actually needs it.
 */
const TrackerTools = lazy(() => import('../integration/TrackerTools').then((mod) => ({ default: mod.TrackerTools })));
const CampaignTracker = lazy(() => import('../integration/CampaignTracker').then((mod) => ({ default: mod.CampaignTracker })));
import {
  createCampaign,
  updateCampaign,
  deleteCampaign,
  fetchCampaignByCode,
  type Campaign,
  type CampaignDefaults,
  type CampaignMembership,
} from '../data/campaigns';
import type { PartyMember } from '../data/party';
import { loadCampaigns, saveCampaigns } from '../data/storage';
import { PartyMembers, useMemberViewer } from './PartyMembers';
import { PageMenu } from './PageMenu';
import { WindowControls } from './WindowControls';
import { HeroesHeavenLogo } from './Logo';
import { confirmDialog } from './confirm';
import { useIsMobile } from './useIsMobile';
import { useBackHandler, useEscapeClose, triggerBack } from './useEscapeClose';

type View =
  | { kind: 'list' }
  | { kind: 'create' }
  | { kind: 'edit'; m: CampaignMembership }
  | { kind: 'created'; c: Campaign }
  | { kind: 'detail'; m: CampaignMembership };

/** Build a BuildState carrying just the campaign-default fields, so the Setup cards can edit them. */
function buildFromDefaults(d?: CampaignDefaults): BuildState {
  return {
    ...emptyBuild(),
    variantRules: d?.variantRules ?? {},
    enabledSources: d?.enabledSources,
    mythicEnabled: d?.mythicEnabled ?? false,
    kingmakerEnabled: d?.kingmakerEnabled ?? false,
  };
}
function defaultsFromBuild(b: BuildState): CampaignDefaults {
  return {
    variantRules: b.variantRules,
    enabledSources: b.enabledSources,
    mythicEnabled: b.mythicEnabled,
    kingmakerEnabled: b.kingmakerEnabled,
  };
}

/** The GM defaults editor — the exact Setup cards from the character builder, over a throwaway build. */
function DefaultsEditor({ content, build, setBuild }: { content: ContentDatabase; build: BuildState; setBuild: React.Dispatch<React.SetStateAction<BuildState>> }) {
  const actions = useBuilderActions(setBuild, content);
  const catalog = useMemo(() => sourceCatalog(content), [content]);
  return (
    <div className="cmp-defaults">
      <div className="setup-note" style={{ marginBottom: 10 }}>
        Default rules new characters in this campaign can start from — the same options as a character&rsquo;s Setup page.
      </div>
      <VariantRulesCard build={build} actions={actions} content={content} />
      <CampaignOptionsCard build={build} actions={actions} content={content} />
      <SourcesCard build={build} actions={actions} catalog={catalog} content={content} />
    </div>
  );
}

interface CampaignsPageProps {
  content: ContentDatabase;
  onClose: () => void;
  onOpenRoster: () => void;
  onOpenHomebrew: () => void;
  onOpenSettings?: () => void;
  characters: { id: string; name: string }[];
  modes: Record<string, ModeDef>;
  onSaveMode: (m: ModeDef) => void;
  onDeleteMode: (id: string) => void;
}

/** Campaigns page — GM-only management. Lists the campaigns you RUN; open one to edit its settings and
 *  see the players in it (and view their sheets / kick). Players don't manage campaigns here — they
 *  JOIN by entering a code in a character's Setup, and reach the party from that character. */
export function CampaignsPage({ content, onClose, onOpenRoster, onOpenHomebrew, onOpenSettings, characters, modes, onSaveMode, onDeleteMode }: CampaignsPageProps) {
  const [memberships, setMemberships] = useState<CampaignMembership[]>(() => loadCampaigns());
  // Re-open on the campaign the user was last in, rather than always on the list — a GM running a
  // campaign lives inside it. (Removable integration; see src/integration/README.md.)
  //
  // Gated on TRACKER_IN_CAMPAIGN, like every other integration branch in this file: it only makes
  // sense BECAUSE a campaign is now a live combat tracker you're working inside. Opening a campaign
  // is a plain detail panel again, and jumping straight back into one isn't what HH did before.
  const [view, setView] = useState<View>(() => {
    if (!TRACKER_IN_CAMPAIGN) return { kind: 'list' };
    const id = getRememberedCampaign();
    const m = id ? loadCampaigns().find((x) => x.id === id) : undefined;
    return m ? { kind: 'detail', m } : { kind: 'list' };
  });
  /*
   * PHONES DON'T RUN A TABLE.
   *
   * "I don't want the GM side of campaign management and initiative tracking in the phone version;
   * players on phones must still be able to join a campaign." So at ≤720px this page keeps the list,
   * joining by code and the player's view of a campaign (the party, their teammates' sheets), and
   * every GM tool — create/edit defaults, the tracker, the GM screen, encounters, custom creatures —
   * is replaced by one line saying where to find them. The desktop/web path below is untouched.
   */
  const isPhone = useIsMobile();
  // GM detail: the GM edits a player's sheet (fully, silently pushed on Update) — not a read-only view.
  // On a phone that editor IS the GM side, so a teammate's sheet opens read-only there instead.
  const { sheetEl, open } = useMemberViewer(content, { gmEdit: !isPhone });
  // Back navigation, one step at a time. Campaign settings (edit) was opened FROM a campaign, so back
  // returns to that campaign's tracker — not all the way out to the list, which would lose the GM's
  // place. Every other sub-view steps back to the list.
  const goBack = () => {
    if (view.kind === 'edit') setView({ kind: 'detail', m: view.m });
    else setView({ kind: 'list' });
  };
  // The hamburger is the navigation — no top-level back arrow. Escape / Android-back close the page
  // (list view) or step back one level (sub-views), via the shared dismiss stack.
  useEscapeClose(onClose);
  /*
   * …except while the campaign IS the tracker: leaving is THAT view's decision, because it's the only
   * one that knows whether a GM edit is still unpushed, and it registers its own handler (calling
   * `goBack` through onLeave once it's safe). Registering a second handler for the same gesture would
   * race on mount order — with the lazy chunk already loaded the tracker mounts in the SAME commit,
   * where a child's effect runs before its parent's, and the handler that asks first would lose.
   */
  const trackerView = TRACKER_IN_CAMPAIGN && !isPhone && view.kind === 'detail';
  useBackHandler(view.kind !== 'list' && !trackerView, goBack);

  // Track where the user is, so the hamburger re-opens here. Stepping back to the list is an
  // explicit "I'm done with that campaign", so it clears the memory.
  useEffect(() => {
    if (!TRACKER_IN_CAMPAIGN) return;
    if (view.kind === 'detail') rememberCampaign(view.m.id);
    else if (view.kind === 'list') rememberCampaign(null);
  }, [view]);

  // Reset the tracker's transient UI (open panels, which view) only when returning to the LIST —
  // i.e. actually leaving the campaign. Going into campaign settings and back is NOT leaving, so the
  // exact view the GM was on (a combat pane, the GM screen) survives the round-trip.
  useEffect(() => {
    if (TRACKER_IN_CAMPAIGN && view.kind === 'list') trackerUi.reset();
  }, [view.kind]);

  if (sheetEl) return sheetEl; // the GM's editable sheet for a player takes over the screen

  const gmCampaigns = memberships.filter((m) => m.role === 'gm');

  const persist = (next: CampaignMembership[]) => {
    setMemberships(next);
    saveCampaigns(next);
  };
  const upsertMembership = (m: CampaignMembership) => persist([...memberships.filter((x) => x.id !== m.id), m]);

  const deleteFrom = async (m: CampaignMembership, after: () => void) => {
    const ok = await confirmDialog({
      title: `Delete “${m.name}”?`,
      message: 'This permanently deletes the campaign for everyone — the party disappears and players can no longer open it. This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const res = await deleteCampaign(m.id);
    if (!res.ok) {
      await confirmDialog({ title: "Couldn't delete", message: res.error, confirmLabel: 'OK' });
      return;
    }
    // Removable integration: don't leave this device's copy of the rules behind for a campaign that
    // no longer exists — a new campaign could otherwise inherit them via a recycled id.
    deleteLocalDefaults(m.id);
    persist(memberships.filter((x) => x.id !== m.id));
    after();
  };

  const title =
    view.kind === 'list'
      ? 'Campaigns'
      : view.kind === 'created'
        ? 'Campaign created'
        : view.kind === 'edit'
          ? 'Edit campaign'
          : view.kind === 'detail'
            ? view.m.name || 'Campaign'
            : 'New campaign';

  return (
    <div className="hb-page cmp-page">
      <header className="chrome" data-tauri-drag-region>
        <div className="chrome-brand" data-tauri-drag-region>
          {/* Back only inside a sub-view. Routes through the shared dismiss stack (like Escape), so it
              peels ONE layer at a time: a full-screen character sheet the GM opened closes first, and
              only then does the next press leave the campaign. goBack is the base of that stack. */}
          {view.kind !== 'list' && (
            <button
              className="icon-btn hb-back"
              onClick={() => { if (!triggerBack()) goBack(); }}
              title="Back"
              aria-label={view.kind === 'edit' ? 'Back to campaign' : 'Back to campaigns'}
            >
              <i className="ti ti-arrow-left" aria-hidden="true" />
            </button>
          )}
          <HeroesHeavenLogo className="chrome-logo" /> {title}
        </div>
        {/* Row 1 of the campaign-as-tracker view: the tracker's tools live in HH's own chrome.
            Part of the removable integration — see src/integration/README.md. */}
        {TRACKER_IN_CAMPAIGN && !isPhone && view.kind === 'detail' && (
          <Suspense fallback={null}>
            <TrackerTools />
          </Suspense>
        )}
        {/* Customize the GM's tracker look (theme/style only, tracker-scoped) — mirrors the character
            sheet's Customize icon, sitting next to the hamburger. Removable integration. */}
        {TRACKER_IN_CAMPAIGN && !isPhone && view.kind === 'detail' && (
          <button
            className="icon-btn"
            title="Customize tracker appearance"
            aria-label="Customize tracker appearance"
            onClick={() => trackerUi.setAppearance(true)}
          >
            <i className="ti ti-palette" aria-hidden="true" />
          </button>
        )}
        <PageMenu
          items={[
            { label: 'Characters', icon: 'ti-users', onClick: onOpenRoster },
            { label: 'Homebrew', icon: 'ti-flask', onClick: onOpenHomebrew },
          ]}
          onOpenSettings={onOpenSettings}
          modes={modes}
          characters={characters}
          onSaveMode={onSaveMode}
          onDeleteMode={onDeleteMode}
        />
        <WindowControls />
      </header>

      {/* The tracker needs the WHOLE screen; .cmp-body is otherwise capped at 640px and centred
          (right for a list of campaign cards, wrong for a combat tracker). The modifier is defined
          in src/integration/campaign-tracker.css and goes away with the integration. */}
      <div className={'cmp-body' + (TRACKER_IN_CAMPAIGN && !isPhone && view.kind === 'detail' ? ' cmp-body-tracker' : '')}>
        {view.kind === 'list' && (
          <>
            {/* On a phone the list is every campaign you're IN, GM or player — the page is a player's
                page there, and a GM with only their own campaigns still sees exactly what they ran. */}
            <GmList
              campaigns={isPhone ? memberships : gmCampaigns}
              phone={isPhone}
              onCreate={isPhone ? undefined : () => setView({ kind: 'create' })}
              onOpen={(m) => setView({ kind: 'detail', m })}
            />
            {isPhone && (
              <JoinRow
                // Joining must never DOWNGRADE a membership you already have: `upsertMembership`
                // REPLACES the row, so a GM pasting their own share code here turned their local
                // role into 'player' (and dropped `useDefaults`). The desktop join in
                // builder/shared.tsx has always kept the existing row; this does the same and says so.
                onJoined={(next) => {
                  if (memberships.some((x) => x.id === next.id)) return false;
                  upsertMembership(next);
                  return true;
                }}
              />
            )}
          </>
        )}

        {/* Opening a campaign IS the full-screen initiative tracker. Flip TRACKER_IN_CAMPAIGN to
            false for the original detail panel back. See src/integration/README.md. */}
        {view.kind === 'detail' &&
          (TRACKER_IN_CAMPAIGN && !isPhone ? (
            <Suspense fallback={null}>
              <CampaignTracker
                m={view.m}
                content={content}
                onOpenSettings={() => setView({ kind: 'edit', m: view.m })}
                // Leaving the campaign is the TRACKER's call, not this page's: it's the only one that
                // knows whether a GM edit is still unpushed. It registers the base handler on the
                // dismiss stack (Escape + the Back arrow) and calls this once it's safe to unmount.
                onLeave={goBack}
                onViewMember={(mem) => void open(view.m.id, mem.charId, mem.ownerId)}
              />
            </Suspense>
          ) : (
            <CampaignDetail
              m={view.m}
              gmTools={!isPhone}
              onEdit={() => setView({ kind: 'edit', m: view.m })}
              onDelete={() => void deleteFrom(view.m, () => setView({ kind: 'list' }))}
              onViewMember={(mem) => void open(view.m.id, mem.charId, mem.ownerId)}
            />
          ))}

        {(view.kind === 'create' || view.kind === 'edit') && (
          <CampaignForm
            content={content}
            editing={view.kind === 'edit' ? view.m : undefined}
            // Deleting is only a thing for a campaign that exists. `undefined` while creating is what
            // hides the control, so this must stay tied to `editing`.
            onDelete={
              view.kind === 'edit'
                ? () => void deleteFrom(view.m, () => setView({ kind: 'list' }))
                : undefined
            }
            onCancel={() => setView(view.kind === 'edit' ? { kind: 'detail', m: view.m } : { kind: 'list' })}
            onCreated={(c) => {
              upsertMembership({ id: c.id, code: c.code, role: 'gm', name: c.name, description: c.description });
              setView({ kind: 'created', c });
            }}
            onSaved={(c) => {
              const m: CampaignMembership = { id: c.id, code: c.code, role: 'gm', name: c.name, description: c.description };
              upsertMembership(m);
              setView({ kind: 'detail', m });
            }}
          />
        )}

        {view.kind === 'created' && (
          <CreatedView
            c={view.c}
            onDone={() => setView({ kind: 'detail', m: { id: view.c.id, code: view.c.code, role: 'gm', name: view.c.name, description: view.c.description } })}
          />
        )}
      </div>
    </div>
  );
}

function GmList({ campaigns, phone, onCreate, onOpen }: {
  campaigns: CampaignMembership[];
  /** Phone: the GM half of this page is hidden, so the copy and the Create button go with it. */
  phone?: boolean;
  /** Absent = no way to create one from here (phones). */
  onCreate?: () => void;
  onOpen: (m: CampaignMembership) => void;
}) {
  return (
    <div className="cmp-list">
      <p className="cmp-intro">
        {phone ? (
          <>Campaigns you&rsquo;re in. Open one to see the party. <strong>GM tools are available on the desktop and web app.</strong></>
        ) : (
          <>
            Campaigns you <strong>run</strong>. Create one, set its default rules, and share the code — players join by
            entering it in a character&rsquo;s <strong>Setup → Campaigns</strong>. Open a campaign to manage it and see the party.
          </>
        )}
      </p>
      {campaigns.length === 0 ? (
        <div className="cmp-empty">{phone ? 'You haven’t joined a campaign yet.' : 'You don’t run any campaigns yet.'}</div>
      ) : (
        campaigns.map((m) => (
          <div
            className="cmp-card cmp-card-btn"
            key={m.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen(m)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen(m);
              }
            }}
          >
            <div className="cmp-card-main">
              <div className="cmp-card-name">{m.name}<span className={'cmp-role ' + m.role}>{m.role === 'gm' ? 'GM' : 'Player'}</span></div>
              {m.description && <div className="cmp-card-desc">{m.description}</div>}
              <CodeChip code={m.code} />
            </div>
            <i className="ti ti-chevron-right party-chev" aria-hidden="true" />
          </div>
        ))
      )}
      {onCreate && (
        <div className="cmp-add-row">
          <button className="btn-primary" onClick={onCreate}><i className="ti ti-plus" aria-hidden="true" /> Create a campaign</button>
        </div>
      )}
    </div>
  );
}

/**
 * Join a campaign with the GM's code, from this page.
 *
 * Joining otherwise lives in a character's Setup → Campaigns, and still does — but on a phone this
 * page is the player's campaigns page, and "players on phones must still be able to join a campaign"
 * has to be true without going hunting. It records the MEMBERSHIP only; attaching a character to the
 * party is still the Setup card's job, which is where the campaign's default rules are offered.
 */
function JoinRow({ onJoined }: { onJoined: (m: CampaignMembership) => boolean }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState('');
  /** The code was for a campaign this device is already in — nothing was changed. */
  const [already, setAlready] = useState(false);

  const join = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    setError('');
    setJoined('');
    const res = await fetchCampaignByCode(code.trim());
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const c = res.value;
    setAlready(!onJoined({ id: c.id, code: c.code, role: 'player', name: c.name, description: c.description }));
    setCode('');
    setJoined(c.name);
  };

  return (
    <div className="cmp-join-row">
      <label className="cmp-field">
        <span className="cmp-label">Join with a code</span>
        <input
          className="hb-input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="Your GM’s share code"
          aria-label="Campaign share code"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void join();
          }}
        />
      </label>
      <button className="btn-primary" disabled={busy || !code.trim()} onClick={() => void join()}>
        {busy ? 'Joining…' : 'Join'}
      </button>
      {error && <p className="login-error" role="alert">{error}</p>}
      {joined && (
        <p className="setup-note" role="status">
          {already ? 'Already joined' : 'Joined'} “{joined}”. Attach a character in its{' '}
          <strong>Setup → Campaigns</strong> to appear in the party.
        </p>
      )}
    </div>
  );
}

function CampaignDetail({ m, gmTools, onEdit, onDelete, onViewMember }: {
  m: CampaignMembership;
  /** False on a phone: the campaign's settings and deletion are GM tools and live on desktop/web. */
  gmTools: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onViewMember: (m: PartyMember) => void;
}) {
  return (
    <div className="cmp-detail">
      <div className="cmp-detail-head">
        {m.description && <p className="cmp-card-desc">{m.description}</p>}
        <div className="cmp-detail-share">
          <span className="cmp-label">Share code</span>
          <CodeChip code={m.code} />
        </div>
        {gmTools ? (
          <div className="cmp-detail-actions">
            <button className="chip" onClick={onEdit}><i className="ti ti-settings" aria-hidden="true" /> Settings &amp; defaults</button>
            <button className="chip danger" onClick={onDelete}><i className="ti ti-trash" aria-hidden="true" /> Delete campaign</button>
          </div>
        ) : (
          <div className="setup-note">GM tools are available on the desktop and web app.</div>
        )}
      </div>
      <div className="cmp-detail-players">
        <div className="cmp-section-h"><i className="ti ti-users" aria-hidden="true" /> Party</div>
        {/* Kick is a GM tool; without it this is the player's view of their own party. */}
        <PartyMembers campaignId={m.id} isGm={gmTools && m.role === 'gm'} onView={onViewMember} />
      </div>
    </div>
  );
}

function CodeChip({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="cmp-code"
      title="Copy code"
      onClick={(e) => {
        e.stopPropagation();
        try {
          void navigator.clipboard?.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      <i className="ti ti-hash" aria-hidden="true" />
      <span className="cmp-code-val">{code}</span>
      <i className={'ti ' + (copied ? 'ti-check' : 'ti-copy')} aria-hidden="true" />
    </button>
  );
}

function CampaignForm({ content, editing, onDelete, onCancel, onCreated, onSaved }: {
  content: ContentDatabase;
  editing?: CampaignMembership;
  /** Absent when creating — there's nothing to delete yet. */
  onDelete?: () => void;
  onCancel: () => void;
  onCreated: (c: Campaign) => void;
  onSaved: (c: Campaign) => void;
}) {
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [build, setBuild] = useState<BuildState>(() => buildFromDefaults());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadedDefaults, setLoadedDefaults] = useState(!editing);
  const [loadError, setLoadError] = useState('');
  /** Removable integration: this campaign isn't on the server, so its rules live on this device. */
  const [localOnly, setLocalOnly] = useState(false);
  // Prefetch the campaign's current defaults into the editor. Runs in an effect (not the render body,
  // which fired on every render and raced). Crucially, only mark defaults "loaded" on SUCCESS — a failed
  // fetch must NOT let a subsequent save overwrite the real defaults with the empty starting build.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    void fetchCampaignByCode(editing.code).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setBuild(buildFromDefaults(res.value.defaults));
        setLoadedDefaults(true);
        return;
      }
      // ── Removable integration ── A campaign made while testing without login exists only on this
      // device, so this fetch can only ever fail for it — which left the whole rules section hidden
      // and the page showing nothing but Name and Description. Fall back to this device's copy.
      // Deliberately a SEPARATE flag from loadedDefaults: that one means "the server told us its
      // rules", and must stay false here so the save path below can't push local rules to a real
      // campaign. See src/integration/README.md.
      if (TEST_CAMPAIGNS_WITHOUT_LOGIN) {
        setBuild(buildFromDefaults(loadLocalDefaults(editing.id) ?? {}));
        setLocalOnly(true);
        return;
      }
      setLoadError(res.error);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.code]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    // ── Removable integration ── A device-only campaign: there's no row to update, so persist the
    // rules here. Every campaigns.ts call would just answer "Sign in to use campaigns."
    if (localOnly && editing) {
      const defaults = defaultsFromBuild(build);
      saveLocalDefaults(editing.id, defaults);
      setBusy(false);
      onSaved({ id: editing.id, code: editing.code, ownerId: '', name, description, defaults });
      return;
    }
    // Only send defaults when we actually loaded them (create, or a successful edit-prefetch). After a
    // failed prefetch we save just name/description and leave the campaign's real defaults untouched.
    const patch = editing && !loadedDefaults ? { name, description } : { name, description, defaults: defaultsFromBuild(build) };
    const res = editing ? await updateCampaign(editing.id, patch) : await createCampaign(name, description, defaultsFromBuild(build));
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if (editing) onSaved(res.value);
    else onCreated(res.value);
  };

  return (
    <div className="cmp-form">
      {/* The share code — the one thing on this page you READ rather than set, so it leads. Only when
          editing: a campaign that doesn't exist yet has no code to share. */}
      {editing?.code && (
        <div className="cmp-field">
          <span className="cmp-label">Share code</span>
          <div className="cmp-share-row">
            <CodeChip code={editing.code} />
            <span className="cmp-share-hint">
              Players enter this in a character&rsquo;s <strong>Setup → Campaigns</strong> to join.
            </span>
          </div>
        </div>
      )}
      <label className="cmp-field">
        <span className="cmp-label">Name</span>
        <input className="hb-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fall of Plaguestone" autoFocus />
      </label>
      <label className="cmp-field">
        <span className="cmp-label">Description</span>
        <textarea className="hb-input cmp-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What&rsquo;s this campaign about? (optional)" rows={3} />
      </label>
      {editing && !loadedDefaults && !localOnly ? (
        loadError ? (
          <div className="setup-note" style={{ color: 'var(--app-danger, #ef4444)' }}>
            Couldn’t load this campaign’s current default rules ({loadError}). You can still save the name and
            description — the defaults won’t be changed. Reopen this editor to try again.
          </div>
        ) : (
          <div className="setup-note">Loading current defaults…</div>
        )
      ) : (
        <>
          {localOnly && (
            <div className="setup-note">
              This campaign only exists on this device, so its rules are saved here rather than shared with
              players.
            </div>
          )}
          <DefaultsEditor content={content} build={build} setBuild={setBuild} />
        </>
      )}
      {error && <p className="login-error" role="alert">{error}</p>}
      <div className="cmp-form-actions">
        <button className="btn-primary" disabled={busy || !name.trim()} onClick={() => void submit()}>
          {busy ? (editing ? 'Saving…' : 'Creating…') : editing ? 'Save changes' : 'Create campaign'}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
        {/* Pushed to the far end, away from Save: it's irreversible and takes every player's link to
            this campaign with it, so it must not sit under a mis-aimed click at the primary action.
            (It confirms first — deleteFrom() prompts.) */}
        {onDelete && (
          <button className="btn cmp-form-delete" onClick={onDelete} disabled={busy}>
            <i className="ti ti-trash" aria-hidden="true" /> Delete campaign
          </button>
        )}
      </div>
    </div>
  );
}

function CreatedView({ c, onDone }: { c: Campaign; onDone: () => void }) {
  return (
    <div className="cmp-created">
      <i className="ti ti-circle-check cmp-created-icon" aria-hidden="true" />
      <h2 className="cmp-created-title">“{c.name}” is ready</h2>
      <p className="cmp-created-sub">Share this code with your players so they can join:</p>
      <CodeChip code={c.code} />
      <p className="cmp-created-hint">Players enter it in a character&rsquo;s <strong>Setup → Campaigns</strong>.</p>
      <button className="btn-primary" onClick={onDone}>Manage campaign</button>
    </div>
  );
}
