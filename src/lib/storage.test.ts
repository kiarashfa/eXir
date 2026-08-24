import assert from 'node:assert/strict';
import test from 'node:test';

import { defineStore, type Store } from './storage.ts';

// ---------------------------------------------------------------------------
// A localStorage that behaves like the real one, including the ways it fails.
// ---------------------------------------------------------------------------

interface FakeOptions {
  throwOnAccess?: boolean;
  throwOnWrite?: boolean;
}

function install(seed: Record<string, string> = {}, options: FakeOptions = {}): Map<string, string> {
  const map = new Map(Object.entries(seed));
  const fake = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (options.throwOnWrite) throw new Error('QuotaExceededError');
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      if (options.throwOnAccess) throw new Error('SecurityError');
      return fake as unknown as Storage;
    },
  });

  return map;
}

interface Bag {
  have: string[];
}

const bagStore = (): Store<Bag> =>
  defineStore<Bag>({
    key: 'exir.test.v1',
    schema: 1,
    empty: () => ({ have: [] }),
    parse: (raw) => (Array.isArray(raw['have']) ? { have: (raw['have'] as string[]).filter((s) => typeof s === 'string') } : null),
  });

test('an absent key loads empty with no notice', () => {
  install();
  const result = bagStore().load();
  assert.deepEqual(result.value, { have: [] });
  assert.equal(result.notice, null);
  assert.equal(result.persistent, true);
});

test('a stored value round-trips through the schema envelope', () => {
  const map = install();
  const store = bagStore();
  store.save({ have: ['gin'] });
  assert.equal(map.get('exir.test.v1'), '{"have":["gin"],"schema":1}');
  assert.deepEqual(bagStore().load().value, { have: ['gin'] });
});

test('a HIGHER schema is discarded, noticed, and left alone in storage', () => {
  const written = '{"have":["gin","campari"],"schema":9}';
  const map = install({ 'exir.test.v1': written });

  const result = bagStore().load();
  assert.deepEqual(result.value, { have: [] });
  assert.equal(result.notice?.kind, 'newer');
  // The newer tab's data survives. Tidying up after ourselves would destroy it.
  assert.equal(map.get('exir.test.v1'), written);
});

test('the notice survives the SECOND read, because two things read every store', () => {
  install({ 'exir.test.v1': '{"schema":9}' });
  const store = bagStore();

  // The navigation count reads first; the page's own view reads second. A
  // notice delivered only to the first caller is a notice nobody sees.
  const nav = store.load();
  const page = store.load();

  assert.equal(nav.notice?.kind, 'newer');
  assert.equal(page.notice?.kind, 'newer');
  assert.equal(nav, page, 'the load is memoised, so both callers hold one result');
});

test('a successful write clears the notice — the discarded value is genuinely gone', () => {
  install({ 'exir.test.v1': '{"schema":9}' });
  const store = bagStore();
  assert.equal(store.load().notice?.kind, 'newer');

  store.save({ have: ['gin'] });
  assert.equal(store.load().notice, null);
});

test('malformed JSON and a wrong shape both degrade to empty rather than throwing', () => {
  install({ 'exir.test.v1': '{not json' });
  assert.equal(bagStore().load().notice?.kind, 'unreadable');

  install({ 'exir.test.v1': '{"schema":1,"have":"gin"}' });
  const shaped = bagStore().load();
  assert.deepEqual(shaped.value, { have: [] });
  assert.equal(shaped.notice?.kind, 'unreadable');
});

test('an array at the top level is not a record and is discarded', () => {
  install({ 'exir.test.v1': '[1,2,3]' });
  assert.equal(bagStore().load().notice?.kind, 'unreadable');
});

test('storage that throws on ACCESS degrades to working-but-not-remembering', () => {
  install({}, { throwOnAccess: true });
  const store = bagStore();
  const result = store.load();

  assert.equal(result.notice?.kind, 'unavailable');
  assert.equal(result.persistent, false);
  // The feature still works for this visit; only the write is lost.
  assert.equal(store.save({ have: ['gin'] }), false);
  assert.deepEqual(store.load().value, { have: ['gin'] });
});

test('a quota failure on write reports it without losing the change', () => {
  install({}, { throwOnWrite: true });
  const store = bagStore();
  store.load();

  assert.equal(store.save({ have: ['gin'] }), false);
  assert.equal(store.load().persistent, false);
  assert.deepEqual(store.load().value, { have: ['gin'] });
});

test('subscribers are notified on save', () => {
  install();
  const store = bagStore();
  const seen: string[][] = [];
  const off = store.subscribe((v) => seen.push(v.have));

  store.save({ have: ['gin'] });
  store.save({ have: ['gin', 'campari'] });
  off();
  store.save({ have: [] });

  assert.deepEqual(seen, [['gin'], ['gin', 'campari']]);
});
