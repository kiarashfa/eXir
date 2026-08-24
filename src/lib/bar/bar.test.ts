import assert from 'node:assert/strict';
import test from 'node:test';

import { add, remove, starterSet, toggle } from './inventory.ts';
import { MATCH_THRESHOLD, matchAll, matchOne, withinReach } from './match.ts';
import { unlockRanking } from './set-cover.ts';
import type { CatalogEntry } from '../catalog.ts';

// ---------------------------------------------------------------------------
// A minimal catalogue. Only the fields matching reads are filled in.
// ---------------------------------------------------------------------------

const STAPLES = new Set(['granulated-sugar', 'water', 'salt', 'lemon']);
const isStaple = (id: string): boolean => STAPLES.has(id);

interface Sketch {
  slug: string;
  ingredients: string[];
  garnishes?: string[];
  substitutes?: Record<string, string[]>;
  family?: string | null;
}

const entry = (s: Sketch): CatalogEntry => ({
  slug: s.slug,
  title: s.slug.replace(/-/g, ' '),
  style: 'Classic',
  version: 'classic',
  category: [],
  origin: [],
  method: [],
  occasion: [],
  baseSpirits: [],
  strength: 'medium',
  servingTemp: 'chilled',
  diets: [],
  allergens: [],
  abvPercent: 20,
  kcal: 200,
  sugarGPerL: 90,
  totalSec: 120,
  totalTime: '2m',
  difficulty: 'Easy',
  steps: 3,
  glass: 'coupe',
  family: s.family ?? null,
  preparations: 0,
  ingredients: s.ingredients,
  garnishes: s.garnishes ?? [],
  substitutes: s.substitutes ?? {},
  summary: '',
  image: null,
});

const owned = (...ids: string[]): Set<string> => new Set(ids);

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

test('the inventory deduplicates and sorts, so storage diffs cleanly', () => {
  let state = { have: [] as string[] };
  state = add(state, 'gin');
  state = add(state, 'campari');
  state = add(state, 'gin');
  assert.deepEqual(state.have, ['campari', 'gin']);

  state = toggle(state, 'gin');
  assert.deepEqual(state.have, ['campari']);
  assert.deepEqual(remove(state, 'nothing').have, ['campari']);
});

test('the starter set is the non-staple ingredients the most drinks name', () => {
  const entries = [
    { ingredients: ['gin', 'campari', 'sweet-vermouth', 'granulated-sugar'], garnishes: ['orange'] },
    { ingredients: ['gin', 'campari', 'prosecco'], garnishes: [] },
    { ingredients: ['gin', 'lemon-juice'], garnishes: [] },
  ];
  const set = starterSet(entries, isStaple, 3);
  assert.deepEqual(set, ['gin', 'campari', 'lemon-juice']);
  assert.ok(!set.includes('granulated-sugar'), 'a staple is never a suggestion');
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

test('staples and garnishes are excluded from the denominator, not counted as owned', () => {
  const negroni = entry({
    slug: 'negroni',
    ingredients: ['gin', 'campari', 'sweet-vermouth', 'orange'],
    garnishes: ['orange'],
  });

  const match = matchOne(negroni, { owned: owned('gin', 'campari', 'sweet-vermouth'), isStaple });

  assert.deepEqual(match.required, ['gin', 'campari', 'sweet-vermouth']);
  assert.deepEqual(match.alsoWant, ['orange']);
  assert.equal(match.percent, 1);
  assert.equal(match.complete, true);
});

test('a drink of nothing but staples is complete rather than undefined', () => {
  const match = matchOne(
    entry({ slug: 'sugar-water', ingredients: ['granulated-sugar', 'water'] }),
    { owned: owned(), isStaple },
  );
  assert.equal(match.required.length, 0);
  assert.equal(match.percent, 1);
  assert.equal(match.complete, true);
});

test('an owned substitute completes the line and names what it stands in for', () => {
  const sour = entry({
    slug: 'whiskey-sour',
    ingredients: ['bourbon', 'lemon-juice', 'simple-syrup'],
    substitutes: { bourbon: ['rye'] },
  });

  const match = matchOne(sour, { owned: owned('rye', 'lemon-juice', 'simple-syrup'), isStaple });

  assert.equal(match.complete, true);
  assert.deepEqual(match.substituted, [{ wanted: 'bourbon', using: 'rye' }]);
  assert.deepEqual(match.missing, []);
});

test('a substitute that is a staple counts, because staples are assumed present', () => {
  const match = matchOne(
    entry({
      slug: 'daiquiri',
      ingredients: ['white-rum', 'lime-juice', 'simple-syrup'],
      substitutes: { 'simple-syrup': ['granulated-sugar'] },
    }),
    { owned: owned('white-rum', 'lime-juice'), isStaple },
  );

  assert.equal(match.complete, true);
  assert.deepEqual(match.substituted, [{ wanted: 'simple-syrup', using: 'granulated-sugar' }]);
});

test('an unowned substitute does not rescue the line', () => {
  const match = matchOne(
    entry({ slug: 'x', ingredients: ['gin', 'campari'], substitutes: { campari: ['aperol'] } }),
    { owned: owned('gin'), isStaple },
  );
  assert.deepEqual(match.missing, ['campari']);
  assert.equal(match.percent, 0.5);
});

test('matchAll returns everything and the threshold is a display filter over it', () => {
  const entries = [
    entry({ slug: 'have-all', ingredients: ['gin', 'campari'] }),
    entry({ slug: 'close', ingredients: ['gin', 'campari', 'cynar', 'soda'] }),
    entry({ slug: 'hopeless', ingredients: ['a', 'b', 'c', 'd'] }),
  ];

  const all = matchAll(entries, { owned: owned('gin', 'campari', 'cynar'), isStaple });
  assert.equal(all.length, 3, 'the set-cover needs the far-off drinks too');
  assert.deepEqual(all.map((m) => m.entry.slug), ['have-all', 'close', 'hopeless']);

  const shown = withinReach(all);
  assert.deepEqual(shown.map((m) => m.entry.slug), ['have-all', 'close']);
  assert.ok(shown[1]!.percent >= MATCH_THRESHOLD);
});

test('an outright match outranks a substituted one at the same percentage', () => {
  const entries = [
    entry({ slug: 'substituted', ingredients: ['rye', 'x'], substitutes: { rye: ['bourbon'] } }),
    entry({ slug: 'outright', ingredients: ['bourbon', 'x'] }),
  ];
  const ranked = matchAll(entries, { owned: owned('bourbon', 'x'), isStaple });
  assert.deepEqual(ranked.map((m) => m.entry.slug), ['outright', 'substituted']);
});

// ---------------------------------------------------------------------------
// The set-cover
// ---------------------------------------------------------------------------

const shelf = [
  entry({ slug: 'negroni', ingredients: ['gin', 'campari', 'sweet-vermouth'], family: 'old-fashioned' }),
  entry({ slug: 'americano', ingredients: ['campari', 'sweet-vermouth', 'soda'], family: 'highball' }),
  entry({ slug: 'boulevardier', ingredients: ['bourbon', 'campari', 'sweet-vermouth'], family: 'old-fashioned' }),
  entry({ slug: 'martini', ingredients: ['gin', 'dry-vermouth'], family: 'martini' }),
];

test('only a drink brought to 100% counts as unlocked', () => {
  // Two ingredients short of the Boulevardier: adding Campari alone leaves it
  // incomplete, so Campari must not be credited with it.
  const matches = matchAll(shelf, { owned: owned('gin', 'sweet-vermouth'), isStaple });
  const ranked = unlockRanking(matches);

  const campari = ranked.find((u) => u.id === 'campari');
  assert.deepEqual(campari?.drinks, ['negroni']);
  assert.ok(!ranked.some((u) => u.drinks.includes('boulevardier')));
});

test('ties break on distinct families, because breadth beats repetition', () => {
  // `campari` completes two drinks in ONE family; `wide` completes two across
  // two. Same count, so the families decide.
  const entries = [
    entry({ slug: 'a1', ingredients: ['campari', 'have'], family: 'old-fashioned' }),
    entry({ slug: 'a2', ingredients: ['campari', 'have'], family: 'old-fashioned' }),
    entry({ slug: 'b1', ingredients: ['wide', 'have'], family: 'sour' }),
    entry({ slug: 'b2', ingredients: ['wide', 'have'], family: 'highball' }),
  ];

  const matches = matchAll(entries, { owned: owned('have'), isStaple });
  const ranked = unlockRanking(matches);

  assert.equal(ranked[0]!.id, 'wide');
  assert.equal(ranked[0]!.families.length, 2);
  assert.equal(ranked[1]!.id, 'campari');
});

test('a staple is never a candidate, because it is already assumed', () => {
  const entries = [entry({ slug: 'x', ingredients: ['gin', 'granulated-sugar'] })];
  // Sugar is a staple, so the drink is already complete and nothing is missing.
  const matches = matchAll(entries, { owned: owned('gin'), isStaple });
  assert.deepEqual(unlockRanking(matches), []);
});

test('a drink too incomplete to be displayed is still found by the set-cover', () => {
  // Two of three missing, so 33% — well under the display threshold, and never
  // one bottle away. Add one of the two and it becomes exactly that.
  const entries = [entry({ slug: 'far', ingredients: ['gin', 'campari', 'sweet-vermouth'] })];
  const options = { owned: owned('gin'), isStaple };

  assert.deepEqual(withinReach(matchAll(entries, options)), []);

  const withOne = matchAll(entries, { ...options, owned: owned('gin', 'campari') });
  assert.deepEqual(unlockRanking(withOne)[0]?.id, 'sweet-vermouth');
});
