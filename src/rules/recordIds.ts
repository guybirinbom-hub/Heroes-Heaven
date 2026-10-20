/*
 * IDS OF THE RECORDS A PLAYER ADDS — inventory rows, companions, notes pages, gallery pictures
 * (package H, 2026-10-20).
 *
 * Two tabs of one browser profile (and a GM's device giving a player an item) MERGE each other's roster
 * writes (src/data/rosterMerge.ts), and a list of records merges RECORD BY RECORD by its key — an
 * inventory row's `instanceId`, a companion's `id`. That only works if one key is one record.
 *
 * These ids used to be numbered in sequence, `inv-${max + 1}`. Two tabs that each added an item inside
 * one save window gave two DIFFERENT items the SAME id, and the merge took them for one item both tabs
 * had edited: tab A's rope and tab B's five worn torches came out as one worn rope, in both tabs. A
 * purchase made in both tabs (same item, same content, same id) merged into ONE — a purchase gone. And
 * deleting the highest row freed its number for the next add, so an edit of the deleted row in the other
 * tab landed on the new item. No merge rule can tell any of those from one item both tabs edited.
 *
 * So there are two kinds of id, and every mint site picks one:
 *
 *  · UNIQUE — `${prefix}-${token}-${n}` — for a record a PLAYER'S ACTION creates (Give, Buy, a kit,
 *    peeling one talisman off a stack, Add companion, a new notes page, a new picture). The token is
 *    random and fresh for every mint, so no other tab, device or later add can ever mint it again.
 *  · DERIVED — `${prefix}-${source}-${n}` — for a record the app derives from state BOTH tabs hold (the
 *    formula book a feat grants, a builder item the sheet merges in, an automatic companion made real).
 *    Each tab that derives it from the same list must mint the SAME id, or the merge keeps both copies
 *    and the item is duplicated. `source` names WHAT was derived (the item, the automatic companion), so
 *    two DIFFERENT derived records made at one moment never share a key either: tab A making the eidolon
 *    real and tab B the Pet feat's familiar used to get one `cmp-0` and merge into one creature
 *    (checker, 2026-10-20). Old saves' plain `prefix-N` ids are read the same way and never rewritten.
 *
 * `n` — the trailing number — is the ACQUISITION ORDER in both kinds: max(trailing number) + 1. The
 * sheet numbers duplicate copies by it (`copyNumbers`), and old saves, whose ids are all plain `inv-N`,
 * keep working unchanged: nothing here rewrites a stored id.
 *
 * The token comes from ONE seam (`setIdTokenSource`) so a test can make it predictable; everything else
 * in this file is pure.
 */

/** The random part of a unique id: lower-case letters and digits, never empty. */
export type IdTokenSource = () => string;

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Eight base-36 characters (~41 bits) from the platform's CSPRNG — Math.random where there is none. */
const randomToken: IdTokenSource = () => {
  const out: string[] = [];
  const buf = new Uint8Array(8);
  const c = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.getRandomValues) c.getRandomValues(buf);
  else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  for (const b of buf) out.push(ALPHABET[b % 36]);
  return out.join('');
};

let tokenSource: IdTokenSource = randomToken;

/** TEST SEAM: make the unique part predictable (pass null to restore the random source). */
export function setIdTokenSource(fn: IdTokenSource | null): void {
  tokenSource = fn ?? randomToken;
}

/** A fresh token from the current source — falling back to a random one when the source returns
 *  something that would break the id's shape (empty, or anything but [a-z0-9]). */
function token(): string {
  const t = tokenSource();
  return typeof t === 'string' && /^[a-z0-9]+$/.test(t) ? t : randomToken();
}

/** An id's trailing number — the acquisition counter — or -1 when it has none. */
export function idSequence(id: string): number {
  const m = /(\d+)$/.exec(id);
  return m ? Number(m[1]) : -1;
}

/** The next acquisition number for a list holding `ids`: max(trailing number) + 1 (0 for none). */
export function nextSequence(ids: Iterable<string>): number {
  let max = -1;
  for (const id of ids) max = Math.max(max, idSequence(id));
  return max + 1;
}

/** The id of a record a PLAYER'S ACTION creates: `${prefix}-${token}-${n}`, unique to this mint. */
export function mintUniqueId(prefix: string, ids: Iterable<string>): string {
  return `${prefix}-${token()}-${nextSequence(ids)}`;
}

/** A record's source (an item id, an automatic companion's id) as an id part: lower-case letters,
 *  digits and single dashes. */
export function idSlug(source: string): string {
  return source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The id of a record the app DERIVES from the list itself: `${prefix}-${source}-${n}` — the same in
 *  every tab that derives the same record from the same list, different for a different record. */
export function mintDerivedId(prefix: string, source: string, ids: Iterable<string>): string {
  const s = idSlug(source);
  return `${prefix}${s ? `-${s}` : ''}-${nextSequence(ids)}`;
}

/** Whether `id` is one `mintDerivedId(prefix, source, …)` could have minted, at any number. A plain old
 *  `prefix-N` never is; a unique id only if its random token happened to spell the slug (36^-8). */
export function isDerivedIdOf(id: string, prefix: string, source: string): boolean {
  const s = idSlug(source);
  return s !== '' && id.startsWith(`${prefix}-${s}-`) && /^\d+$/.test(id.slice(prefix.length + s.length + 2));
}

/**
 * " 1", " 2", … for each row whose item the list holds more than once, numbered in ACQUISITION order
 * (the id's trailing number), never list order: the list order is the player's (drag / reorder), and
 * numbering by it made two copies swap numbers when reordered. Two rows minted at one number in two
 * tabs (`inv-a…-6`, `inv-b…-6`) are ordered by id, the same way in every tab. A row whose id has no
 * number keeps list order, after the numbered ones.
 */
export function copyNumbers<R extends { instanceId: string; itemId: string }>(rows: readonly R[]): Map<string, string> {
  const byItem = new Map<string, R[]>();
  for (const r of rows) byItem.set(r.itemId, [...(byItem.get(r.itemId) ?? []), r]);
  const rank = (id: string) => {
    const n = idSequence(id);
    return n < 0 ? Number.MAX_SAFE_INTEGER : n;
  };
  const out = new Map<string, string>();
  for (const list of byItem.values()) {
    if (list.length < 2) continue;
    [...list]
      .sort((a, b) => {
        const d = rank(a.instanceId) - rank(b.instanceId);
        if (d || idSequence(a.instanceId) < 0) return d;
        return a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0;
      })
      .forEach((r, n) => out.set(r.instanceId, ` ${n + 1}`));
  }
  return out;
}
