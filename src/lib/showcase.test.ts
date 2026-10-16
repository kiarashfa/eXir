import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';

import {
  FEATURED_DAYS,
  FEATURED_SCRIPT,
  featured,
  featuredOrder,
  featuredSlice,
  featuredStart,
} from './showcase.ts';

/**
 * The selection is computed twice, once by the build and once by the reader's
 * browser, and the two must agree. So besides the arithmetic, the inline
 * script itself is run here, against a stand-in for the few DOM calls it makes.
 */

interface Entry {
  id: string;
  group: string;
}

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 16, 12);
const id = (e: Entry) => e.id;
const group = (e: Entry) => e.group;

const entries = (n: number, groups: number): Entry[] =>
  Array.from({ length: n }, (_, i) => ({ id: `e${String(i).padStart(4, '0')}`, group: `g${i % groups}` }));

test('the order holds every entry once and ignores the input order', () => {
  const items = entries(120, 7);
  const order = featuredOrder(items, id, group);
  assert.equal(order.length, items.length);
  assert.equal(new Set(order).size, items.length);
  assert.deepEqual(featuredOrder([...items].reverse(), id, group), order);
});

test('equal groups never meet within a day', () => {
  const order = featuredOrder(entries(100, 10), id, group);
  for (let i = 0; i < order.length; i++) {
    const day = Array.from({ length: 8 }, (_, k) => order[(i + k) % order.length]!.group);
    assert.equal(new Set(day).size, 8, `window at ${i}: ${day.join(' ')}`);
  }
});

test('a dominant group is spread evenly rather than bunched', () => {
  const items = [...entries(60, 12), ...Array.from({ length: 20 }, (_, i) => ({ id: `big${i}`, group: 'big' }))];
  const order = featuredOrder(items, id, group);
  for (let i = 0; i < order.length; i++) {
    const big = Array.from({ length: 8 }, (_, k) => order[(i + k) % order.length]!).filter((e) => e.group === 'big');
    assert.ok(big.length <= 3, `window at ${i} holds ${big.length} of the large group`);
  }
});

test('consecutive days share nothing, and every entry comes round once per cycle', () => {
  const f = featured(entries(96, 9), { count: 8, id, group, now: NOW });
  const seen = new Set<string>();
  for (let day = 0; day < 12; day++) {
    const pick = featuredSlice(f.pool, f.count, featuredStart(day, f.count, f.pool.length));
    for (const e of pick) {
      assert.ok(!seen.has(e.id), `${e.id} repeats on day ${day}`);
      seen.add(e.id);
    }
  }
  assert.equal(seen.size, 96);
});

test('two builds of the same catalogue show the same entries on the same day', () => {
  const items = entries(150, 11);
  const early = featured(items, { count: 8, id, group, now: NOW });
  const late = featured(items, { count: 8, id, group, now: NOW + 9 * DAY });
  const visit = early.day + 20;
  const pick = (f: typeof early) =>
    featuredSlice(f.pool, f.count, featuredStart(visit - f.day, f.count, f.pool.length)).map(id);
  assert.deepEqual(pick(early), pick(late));
});

test('the build renders its own day, one day into the pool', () => {
  const f = featured(entries(50, 5), { count: 6, id, group, now: NOW });
  assert.equal(f.day, Math.floor(NOW / DAY) - 1);
  assert.equal(f.start, 6);
});

test('the pool is capped, and a small catalogue shows all of itself every day', () => {
  const big = featured(entries(FEATURED_DAYS * 8 + 50, 13), { count: 8, id, group, now: NOW });
  assert.equal(big.pool.length, FEATURED_DAYS * 8);

  const small = featured(entries(5, 2), { count: 8, id, group, now: NOW });
  assert.equal(small.count, 5);
  assert.equal(small.start, 0);
  assert.equal(featuredStart(37, small.count, small.pool.length), 0);

  const none = featured([], { count: 8, id, group, now: NOW });
  assert.deepEqual([none.pool.length, none.count], [0, 0]);
});

/* A stand-in for the section: a list of card nodes, an optional template of
   candidates, and the dataset the script reads and writes. */
function run(f: ReturnType<typeof featured<Entry>>, local: [number, number, number], template = true) {
  const node = (entry: Entry, list?: { children: unknown[] }) => {
    const n = {
      entry,
      cloneNode: () => node(entry),
      replaceWith(other: unknown) {
        const at = list!.children.indexOf(n);
        list!.children[at] = other;
      },
    };
    return n;
  };
  const list = { children: [] as ReturnType<typeof node>[] };
  for (const e of featuredSlice(f.pool, f.count, f.start)) list.children.push(node(e, list));
  const attributes: Record<string, string> = {};
  const section = {
    dataset: {
      featuredDay: String(f.day),
      featuredSize: String(f.pool.length),
      featuredCount: String(f.count),
      featuredStart: String(f.start),
    } as Record<string, string>,
    setAttribute: (name: string, value: string) => (attributes[name] = value),
    querySelector: (selector: string) =>
      selector.startsWith('template')
        ? template
          ? { content: { children: f.pool.map((e) => node(e)) } }
          : null
        : list,
  };
  const [year, month, date] = local;
  function FakeDate() {
    return { getFullYear: () => year, getMonth: () => month, getDate: () => date };
  }
  FakeDate.UTC = Date.UTC;
  vm.runInNewContext(FEATURED_SCRIPT, {
    document: { currentScript: { closest: () => section } },
    Date: FakeDate,
    String,
    Math,
  });
  return { shown: list.children.map((n) => n.entry.id), section, attributes };
}

test('the inline script shows the reader’s own day, whatever the build day', () => {
  const f = featured(entries(70, 6), { count: 8, id, group, now: NOW });
  // The build's own day: nothing to change.
  const same = run(f, [2026, 9, 16]);
  assert.deepEqual(same.shown, featuredSlice(f.pool, 8, f.start).map(id));
  // A reader a day behind, and one 40 days on, without a rebuild.
  for (const [local, days] of [
    [[2026, 9, 15], 0],
    [[2026, 10, 25], 41],
  ] as const) {
    const visit = run(f, [...local]);
    const start = featuredStart(days, 8, f.pool.length);
    assert.deepEqual(visit.shown, featuredSlice(f.pool, 8, start).map(id));
    assert.equal(visit.section.dataset.featuredStart, String(start));
  }
});

test('without a template the script only records the day for the component that owns the list', () => {
  const f = featured(entries(70, 6), { count: 5, id, group, now: NOW });
  const visit = run(f, [2026, 9, 20], false);
  assert.deepEqual(visit.shown, featuredSlice(f.pool, 5, f.start).map(id));
  assert.equal(visit.section.dataset.featuredStart, String(featuredStart(5, 5, f.pool.length)));
  assert.equal(visit.attributes['data-featured-pending'], '');
  assert.equal(run(f, [2026, 9, 16], false).attributes['data-featured-pending'], undefined);
});
