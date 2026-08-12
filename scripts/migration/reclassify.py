"""
Stage 2c — RE-CLASSIFY the records whose section could not be extracted.

Why this exists: `locate.py` (FTS full-text search) ran BEFORE the book-scoped matcher, so its weak
guesses claimed 652 records before the strong rules ever saw them. Extraction is the test that catches
it — a genuine section extracts, a page that merely mentions the word does not. 530 failed, and the
failures show what went wrong:

    Vindicator's Judgment  -> "Vindicator's Judgement"        a spelling difference, not a section
    Norns                  -> "Norn"                          singular/plural
    Tiny                   -> "Tiny Creatures and Flanking"   a page that happens to say "Tiny"
    Warship                -> "Movement and Heading"          nonsense

So: take everything that failed extraction and run it through the STRONG rules that should have gone
first — exact / no-paren / paren-only / typo, each guarded by category compatibility and by the
same-words-only test, and now with the short-word guard MIGRATION.md calls for (a 4-letter word may
differ by at most 1, or `Unfettered Mark` matches `Unfettered Pack`).

Read-only. Writes scripts/migration/out/reclassified.json.

    "C:/Users/r2g2/AppData/Local/Programs/Python/Python310/python.exe" scripts/migration/reclassify.py
"""
import io, json, os, re, sqlite3
from collections import defaultdict

DB = r'C:/trying ai 2/Archives of GuyB/app/src-tauri/resources/aon.db'
CORE = 'public/core.json'
MISSING = 'scripts/migration/out/sections-missing.json'
OUT = 'scripts/migration/out/reclassified.json'

CAT_BUCKET = {
    'spell': 'spells', 'ritual': 'spells',
    'equipment': 'items', 'weapon': 'items', 'armor': 'items', 'shield': 'items', 'relic': 'items',
    'set-relic': 'items', 'class-kit': 'items', 'item-bonus': 'items',
    'class': 'classes', 'class-feature': 'classFeatures', 'feat': 'feats',
    'ancestry': 'ancestries', 'heritage': 'heritages', 'background': 'backgrounds',
    'deity': 'deities', 'language': 'languages', 'action': 'actions', 'condition': 'conditions',
    'animal-companion': 'animalCompanions', 'animal-companion-advanced': 'animalCompanions',
    'animal-companion-unique': 'animalCompanions',
    'animal-companion-specialization': 'companionSpecializations',
    'familiar-ability': 'familiarAbilities', 'familiar-specific': 'familiarAbilities',
    'vehicle': 'vehicles', 'siege-weapon': 'siegeWeapons', 'trait': 'trait',
    # the sibling categories HH folds into classFeatures
    'instinct': 'classFeatures', 'lesson': 'classFeatures', 'bloodline': 'classFeatures',
    'curse': 'classFeatures', 'mystery': 'classFeatures', 'doctrine': 'classFeatures',
    'implement': 'classFeatures', 'tactic': 'classFeatures', 'ikon': 'classFeatures',
    'mythic-calling': 'classFeatures', 'patron': 'classFeatures', 'apparition': 'classFeatures',
    'druidic-order': 'classFeatures', 'eidolon': 'classFeatures', 'methodology': 'classFeatures',
    'arcane-school': 'classFeatures', 'arcane-thesis': 'classFeatures', 'research-field': 'classFeatures',
    'innovation': 'classFeatures',
}

"""
Suffixes Heroes Heaven appends that the Archives does not, each verified by SQL:

    Amulet Implement  -> implement-1     "Amulet"       (also Bell, Chalice, Lantern)
    Flame Order       -> druidic-order-5 "Flame"        (also Stone, Leaf, Spore)

Only applied when the stripped name resolves inside the matching archive category, so "Lantern
Implement" cannot land on the equipment "Lantern".
"""
SUFFIX_RULES = [
    (' implement', 'implement'), (' order', 'druidic-order'), (' innovation', 'innovation'),
    (' eidolon', 'eidolon'), (' methodology', 'methodology'), (' instinct', 'instinct'),
    (' school', 'arcane-school'), (' thesis', 'arcane-thesis'), (' research field', 'research-field'),
]

STOP = {'the', 'of', 'a', 'an', 'and', 'with'}

def words(s):
    return [w for w in re.findall(r'[a-z0-9]+', str(s).lower()) if w not in STOP]

def lev(a, b, cap=3):
    if abs(len(a) - len(b)) > cap:
        return cap + 1
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]; best = i
        for k, cb in enumerate(b, 1):
            cur.append(min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (ca != cb)))
            best = min(best, cur[k])
        if best > cap:
            return cap + 1
        prev = cur
    return prev[-1]

def token_compatible(a, b):
    """Same words, differing only by spelling — with a PROPORTIONAL limit on short words.

    Without the short-word rule `Unfettered Mark` matches `Unfettered Pack`: two edits on a four-letter
    word is a different word, not a typo. Allow 1 edit up to 5 characters, 2 above.
    """
    wa, wb = words(a), words(b)
    if len(wa) != len(wb) or not wa:
        return False
    for x, y in zip(wa, wb):
        if x == y:
            continue
        cap = 1 if min(len(x), len(y)) <= 5 else 2
        if lev(x, y, cap) > cap:
            return False
    return True

def norm(s):
    return re.sub(r'[^a-z0-9]+', '', str(s).lower())

con = sqlite3.connect('file:%s?mode=ro' % DB, uri=True)
core = json.load(io.open(CORE, encoding='utf8'))
missing = json.load(io.open(MISSING, encoding='utf8'))

docs = list(con.execute('select id, category, name from docs'))
by_norm = defaultdict(list)
for did, cat, nm in docs:
    by_norm[norm(nm)].append((did, cat, nm))

# CUMULATIVE. build-map.mjs consumes this file, so a record matched here stops being a `subblock`,
# stops being attempted by extract.mjs, and therefore disappears from sections-missing.json on the
# next pass. Overwriting would silently drop every match from earlier runs, so previous results are
# loaded and merged. To retract a bad match, delete its entry from out/reclassified.json by hand.
out, still = {}, []
try:
    out = json.load(io.open(OUT, encoding='utf8')).get('reclassified') or {}
except Exception:
    out = {}
carried = sum(len(v) for v in out.values())
counts = defaultdict(int)

for m in missing:
    bucket, key, name = m['bucket'], m['key'], m['name']
    rec = (core.get(bucket) or {}).get(key) or {}
    n = norm(name)
    bare = norm(re.sub(r'\s*\([^)]*\)\s*$', '', name))
    hit = how = None

    for cand_key, label in ((n, 'exact'), (bare, 'no-paren')):
        if hit or not cand_key:
            continue
        for did, cat, nm in by_norm.get(cand_key, []):
            if CAT_BUCKET.get(cat) == bucket:
                hit, how = (did, cat, nm), label
                break
    # singular/plural, including -es and -ies (HH "Ashes" is the archive's "Ash")
    if not hit:
        alts = [n + 's', n + 'es']
        if n.endswith('ies'):
            alts.append(n[:-3] + 'y')
        if n.endswith('es'):
            alts.append(n[:-2])
        if n.endswith('s'):
            alts.append(n[:-1])
        for alt in alts:
            if hit or not alt:
                continue
            for did, cat, nm in by_norm.get(alt, []):
                if CAT_BUCKET.get(cat) == bucket:
                    hit, how = (did, cat, nm), 'plural'
                    break
    # HH-only PREFIX naming the archive category: "Bloodline: Aberrant" -> bloodline-1 "Aberrant".
    if not hit and ':' in name:
        pre, _, rest = name.partition(':')
        cat_want = pre.strip().lower().replace(' ', '-')
        for did, cat, nm in by_norm.get(norm(rest), []):
            if cat == cat_want:
                hit, how = (did, cat, nm), 'prefix:' + cat_want
                break

    # HH-only suffix, resolved inside the one archive category that suffix implies
    if not hit:
        low = ' ' + re.sub(r'\s+', ' ', name.strip().lower())
        for suf, cat_want in SUFFIX_RULES:
            if hit or not low.endswith(suf):
                continue
            stem = norm(low[: -len(suf)])
            for did, cat, nm in by_norm.get(stem, []):
                if cat == cat_want:
                    hit, how = (did, cat, nm), 'suffix' + suf.replace(' ', ':')
                    break

    # The located "parent" already names this record parenthetically, e.g.
    # "Awakened Metal Shot (Awakened Adamantine Shot)" — that IS the record's own variant doc.
    #
    # Two words minimum, for the same reason typo matching needs two: a one-word record name is often
    # just a MATERIAL or colour qualifier on an unrelated item. The gem `Peridot` matched
    # "Crystal Ball (Peridot)" and inherited its price — 2.5 gp became 12,500 gp.
    if not hit and len(words(name)) >= 2:
        pn = m.get('parentName') or ''
        mm = re.match(r'^.*\(([^)]*)\)\s*$', pn)
        if mm and norm(mm.group(1)) == n:
            hit, how = (m['parentDocId'], '', pn), 'paren-variant'

    """
    A named variant of a base item: HH "Bloodhound Olfactory Stimulators" is a model of the archive's
    "Olfactory Stimulators". Guarded hard, because an unguarded suffix match would pull half the item
    list onto short base names: the base must be at least two words, and the prefix at most two.
    """
    if not hit and '(' not in name:
        # A parenthetical is a qualifier, not a variant prefix: "Rounds (Flintlock Pistol)" is
        # ammunition FOR the gun, and stripping "Rounds" mapped it onto the gun's own doc.
        wn = words(name)
        for take in (1, 2):
            if hit or len(wn) - take < 2:
                continue
            base = norm(' '.join(wn[take:]))
            for did, cat, nm in by_norm.get(base, []):
                if CAT_BUCKET.get(cat) == bucket:
                    hit, how = (did, cat, nm), 'variant-prefix'
                    break

    # Guarded typo, across all books this time (the book scope already had its turn).
    # Two words minimum: a one-word name carries no context to disambiguate, and at one edit
    # "Warship" becomes the archive's "Airship" — a different vehicle entirely.
    if not hit and len(words(name)) >= 2:
        for did, cat, nm in docs:
            if CAT_BUCKET.get(cat) != bucket:
                continue
            if token_compatible(name, nm):
                hit, how = (did, cat, nm), 'typo'
                break

    if hit:
        counts[how] += 1
        # A variant-prefix record is NOT its own document — four Hag Eye variants all resolve to
        # equipment-935. Giving them a `docId` each would make four records share one document, the
        # duplication this migration exists to remove, so they point at the base as a parent instead.
        entry = {'name': name, 'archiveName': hit[2], 'how': 'reclass:' + how}
        if how == 'variant-prefix':
            entry.update(status='table', parentDocId=hit[0])
        else:
            entry.update(status='doc', docId=hit[0])
        out.setdefault(bucket, {})[key] = entry
    else:
        counts['none'] += 1
        still.append(m)

os.makedirs('scripts/migration/out', exist_ok=True)
io.open(OUT, 'w', encoding='utf8').write(json.dumps({'reclassified': out, 'stillUnknown': still}, indent=1))

print('carried from previous runs:', carried)
print('failed extraction :', len(missing))
for k in sorted(counts, key=lambda x: (x == 'none', x)):
    print('  %-16s %4d' % (k, counts[k]))
print('\nstill unknown by bucket:')
agg = defaultdict(int)
for s in still:
    agg[s['bucket']] += 1
for b, c in sorted(agg.items(), key=lambda x: -x[1]):
    print('  %-20s %4d' % (b, c))
print('\nwrote', OUT)
