import { describe, it, expect, vi } from 'vitest';
import { CHILD_TIMEOUT, INSTRUMENT_TIMEOUT } from './_timeouts';
/* The sweep's own cases read the whole deity catalogue in-process and its last case runs the
 * field-check instrument as a node child; both outgrew the 5 s default under the full suite. The
 * instrument keeps its own, longer clock below. See test/_timeouts.ts. */
vi.setConfig({ testTimeout: CHILD_TIMEOUT, hookTimeout: CHILD_TIMEOUT });
import { execFileSync } from 'node:child_process';
import { content, build } from './_content';

/*
 * THE DEITY SWEEP (2026-09-05). Wanderer's Guide has no deity table, so the deity lane is a print read
 * done by an instrument: scripts/deity-fields-check.mjs compares every structured field a deity record
 * carries with the Archives page its own aonId names (domain_primary / domain_alternate / favored_weapon
 * / divine_font / skill / cleric_spell / sanctification_raw / rarity / edict / anathema) and emits the
 * rows that align them. 210 rows on 188 deities landed: 162 sanctification shapes (the Archives' own
 * phrase decides — "must choose holy" is ONE option, "can choose holy or unholy" is three), 33 cleric
 * spell lists that were the LEGACY list translated to remaster names (Lamashtu had Magic Fang's remaster
 * twin where print says Spider Sting), 4 domains and 9 alternate-domain lists still spelled with
 * legacy domain names (void → nothingness, wyrmkin → dragon, delirium → disorientation), Chinostes split
 * into the two printed aspects, two page links, two missing stat-block lines.
 */
const db = content();

describe('deity sweep — the Archives\' sanctification phrase is the shape of the deity\'s choice', () => {
  const options = (id: string) => (db.deities[id]?.effectChoices ?? []).find((e) => e.id === 'sanctification')?.options.map((o) => o.value) ?? [];

  it('"must choose holy" is a one-option choice (Iomedae), "must choose unholy" too (Asmodeus)', () => {
    expect(options('iomedae')).toEqual(['holy']);
    expect(options('asmodeus')).toEqual(['unholy']);
  });

  it('"can choose holy or unholy" offers both and none (Abadar); "can choose holy" offers holy and none (Sarenrae)', () => {
    expect(options('abadar').slice().sort()).toEqual(['holy', 'none', 'unholy']);
    expect(options('sarenrae').slice().sort()).toEqual(['holy', 'none']);
  });

  it('a cleric of a "must choose holy" deity is holy without clicking the only answer there is', () => {
    // build.ts reads the deity answer raw for the cleric's trait; resolvePick already treats a single
    // option as taken, and so must that read — or Iomedae's cleric stays unsanctified until a click.
    const ch = build('cleric', 1, { deityId: 'iomedae', subclassId: 'cloistered-cleric' } as never);
    expect((ch.chosenCreatureTraits ?? []).some((t) => t.trait === 'holy')).toBe(true);
    // …and a "can choose" deity still waits for the player (no default sanctification).
    const open = build('cleric', 1, { deityId: 'abadar', subclassId: 'cloistered-cleric' } as never);
    expect((open.chosenCreatureTraits ?? []).some((t) => t.trait === 'holy' || t.trait === 'unholy')).toBe(false);
  });
});

describe('deity sweep — records aligned with their own page', () => {
  it('Chinostes is two printed aspects: the Redeemer (heal, can choose holy) and the Nightwarden (harm, can choose unholy)', () => {
    const redeemer = db.deities['chinostes']!;
    const nightwarden = db.deities['chinostes-nightwarden']!;
    expect(redeemer.name).toBe('Chinostes (Redeemer)');
    expect(redeemer.divineFont).toEqual(['heal']);
    expect(nightwarden).toBeTruthy();
    expect(nightwarden.divineFont).toEqual(['harm']);
    expect(nightwarden.aonId).toBe('deity-701');
    expect(nightwarden.spells).toEqual(['jump', 'gecko-grip', 'true-target']);
    expect(nightwarden.description).toMatch(/\*\*Anathema\*\*/);
  });

  it('legacy domain names are gone from deity records (void → nothingness, wyrmkin → dragon, delirium → disorientation)', () => {
    const used = new Set<string>();
    for (const d of Object.values(db.deities)) for (const x of [...(d.domains ?? []), ...(d.alternateDomains ?? [])]) used.add(x);
    expect(['void', 'wyrmkin', 'delirium'].filter((x) => used.has(x))).toEqual([]);
    expect(db.deities['kerkamoth']?.domains).toContain('nothingness');
  });

  it('Lamashtu\'s cleric spells are the remaster page\'s, not the legacy list in remaster clothes', () => {
    expect(db.deities['lamashtu']?.spells).toEqual(['spider-sting', 'animal-form', 'nightmare']);
  });

  it('every deity but the Curtain Call pantheon links a page, and the page-less records got theirs', () => {
    expect(db.deities['alocer']?.aonId).toBe('deity-732');
    expect(db.deities['atheists-and-free-agents']?.aonId).toBe('deity-297');
    const pageless = Object.values(db.deities).filter((d) => !d.aonId).map((d) => d.id);
    expect(pageless).toEqual(['the-curtain-call']);
  });

  it('the instrument itself passes: no structured deity field differs from its Archives page', () => {
    const out = execFileSync(process.execPath, ['scripts/deity-fields-check.mjs'], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 1 << 26 });
    expect(out).toMatch(/current mirror deities we do not ship: 0/);
    for (const f of ['domains', 'alternateDomains', 'divineFont', 'favoredWeapons', 'skill', 'spells', 'rarity', 'sanctification']) {
      expect(out, f).toMatch(new RegExp(`${f}\\s+differs on\\s+0 record`));
    }
    // The instrument re-reads every deity page in the Archives mirror; 120 s was enough alone and was
    // exceeded under the full suite. See test/_timeouts.ts.
  }, INSTRUMENT_TIMEOUT);
});
