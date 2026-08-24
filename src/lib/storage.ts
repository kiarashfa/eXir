/**
 * The one localStorage discipline.
 *
 * Every persisted feature goes through here: namespaced and versioned keys, a
 * `schema` integer on every stored object, wrapped reads, and a visible notice
 * when something had to be discarded. None of that is optional — storage can be
 * unavailable in private mode, disabled by policy, or full, and a reference
 * work that throws on the way in because a reader turned cookies off is worse
 * than one that simply does not remember.
 *
 * DELIBERATELY SCHEMA-FREE. This is imported by client code. Anything reaching
 * the content schemas reaches Zod, which then ships to the browser to do
 * nothing.
 *
 * Two properties are load-bearing and easy to lose:
 *
 * 1. **The load is memoised per key.** Two things read every store on every
 *    page — the navigation count and the page's own view — and a notice
 *    delivered to whichever called first and not to the second would be a
 *    notice nobody sees. One read, one result, handed to both.
 *
 * 2. **A discarded value is not overwritten on load.** A `schema` higher than
 *    ours was written by a newer build of the site, most likely in another tab.
 *    Clearing it on sight would destroy the newer data to tidy up after
 *    ourselves. It is left alone until the reader changes something, at which
 *    point their action is the instruction to replace it.
 */

/** Why a stored value was not used. Null means it was, or there was none. */
export type StorageNotice =
  | { kind: 'unavailable'; message: string }
  | { kind: 'newer'; message: string }
  | { kind: 'unreadable'; message: string };

export interface LoadResult<T> {
  value: T;
  /** Shown as one quiet line. Never a dialog, never a crash. */
  notice: StorageNotice | null;
  /** False when a write would be lost. The feature works; it does not remember. */
  persistent: boolean;
}

export interface StoreDefinition<T> {
  /** `exir.<feature>.v<n>`. The version in the key and the schema integer move together. */
  key: string;
  schema: number;
  /** A fresh, valid value. Called rather than shared so no two stores alias one object. */
  empty: () => T;
  /**
   * Validate and normalise a stored payload, or return null to discard it.
   *
   * The payload has already been JSON-parsed and had its `schema` checked, so
   * this only has to care about shape. Returning a NEW object rather than the
   * parsed one keeps a hand-edited localStorage entry from smuggling extra keys
   * into the running feature.
   */
  parse: (raw: Record<string, unknown>) => T | null;
}

export interface Store<T> {
  readonly key: string;
  /** Idempotent: the same result object every time, notice included. */
  load(): LoadResult<T>;
  /** Persist and notify. Returns false when the write could not be made. */
  save(value: T): boolean;
  /** Called on every change from this tab and on a change in another one. */
  subscribe(listener: (value: T) => void): () => void;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * A read and a write that cannot throw.
 *
 * `localStorage` itself throws on ACCESS in some configurations, not merely on
 * use, so even naming it has to be guarded.
 */
function backing(): Storage | null {
  try {
    const store = globalThis.localStorage;
    // Safari's private mode used to expose the object and reject every write.
    // A round trip is the only honest test.
    const probe = '__exir_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

export function defineStore<T>(definition: StoreDefinition<T>): Store<T> {
  const { key, schema, empty, parse } = definition;

  let cached: LoadResult<T> | null = null;
  const listeners = new Set<(value: T) => void>();
  let wired = false;

  const read = (): LoadResult<T> => {
    const store = backing();
    if (!store) {
      return {
        value: empty(),
        notice: {
          kind: 'unavailable',
          message:
            'This browser is not letting the site store anything, so nothing here will be remembered after you close the tab.',
        },
        persistent: false,
      };
    }

    const raw = store.getItem(key);
    if (raw === null) return { value: empty(), notice: null, persistent: true };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        value: empty(),
        notice: {
          kind: 'unreadable',
          message: 'Saved data here could not be read and has been left alone. Starting empty.',
        },
        persistent: true,
      };
    }

    const record = asRecord(parsed);
    const found = record ? record['schema'] : undefined;

    if (typeof found !== 'number' || found !== schema) {
      // A HIGHER number means a newer build wrote it, very likely in another
      // tab. Anything else means it was written by something we do not know.
      // Neither is safe to interpret and neither is ours to delete. A migration
      // from a known older schema would branch here.
      return {
        value: empty(),
        notice:
          typeof found === 'number' && found > schema
            ? {
                kind: 'newer',
                message:
                  'Saved data here was written by a newer version of the site and has been left alone. This page is starting empty.',
              }
            : {
                kind: 'unreadable',
                message: 'Saved data here was in a format the site no longer recognises. Starting empty.',
              },
        persistent: true,
      };
    }

    const value = record ? parse(record) : null;
    if (value === null) {
      return {
        value: empty(),
        notice: {
          kind: 'unreadable',
          message: 'Saved data here did not have the expected shape and has been left alone. Starting empty.',
        },
        persistent: true,
      };
    }

    return { value, notice: null, persistent: true };
  };

  /**
   * Another tab changing the same key.
   *
   * Two tabs on a drinks site is ordinary — a drink page open while My Bar is
   * edited next to it — and the navigation count going stale in one of them is
   * the visible symptom. `storage` fires only in the OTHER tabs, so this never
   * echoes a local write back.
   */
  const wire = (): void => {
    if (wired || typeof globalThis.addEventListener !== 'function') return;
    wired = true;
    globalThis.addEventListener('storage', (event) => {
      const e = event as StorageEvent;
      if (e.key !== null && e.key !== key) return;
      cached = read();
      for (const listener of listeners) listener(cached.value);
    });
  };

  return {
    key,

    load(): LoadResult<T> {
      if (cached) return cached;
      cached = read();
      wire();
      return cached;
    },

    save(value: T): boolean {
      // The notice is cleared by a successful write: whatever was discarded has
      // now been genuinely replaced, and repeating the warning would describe a
      // state that no longer exists.
      const store = backing();
      if (!store) {
        cached = { value, notice: cached?.notice ?? null, persistent: false };
        for (const listener of listeners) listener(value);
        return false;
      }
      try {
        store.setItem(key, JSON.stringify({ ...(value as object), schema }));
        cached = { value, notice: null, persistent: true };
      } catch {
        // Quota, most likely. The change stands for this visit.
        cached = { value, notice: null, persistent: false };
        for (const listener of listeners) listener(value);
        return false;
      }
      for (const listener of listeners) listener(value);
      return true;
    },

    subscribe(listener: (value: T) => void): () => void {
      listeners.add(listener);
      wire();
      return () => listeners.delete(listener);
    },
  };
}
