/**
 * What is on the reader's shelf.
 *
 * A list of ingredient ids and nothing else. No quantities, no purchase dates,
 * no bottle levels — an inventory with quantities is an inventory system, which
 * is a different product with a different maintenance burden, and one nobody
 * keeps up to date. The question this answers is "do you have any of this",
 * which is the question the matching needs.
 */

import { defineStore, type Store } from '../storage.ts';

export interface BarState {
  /** Ingredient ids, deduplicated and stable-sorted for a clean diff in storage. */
  have: string[];
}

export const barStore: Store<BarState> = defineStore<BarState>({
  key: 'exir.bar.v1',
  schema: 1,
  empty: () => ({ have: [] }),
  parse: (raw) => {
    const have = raw['have'];
    if (!Array.isArray(have)) return null;
    return { have: normalise(have.filter((v): v is string => typeof v === 'string')) };
  },
});

const normalise = (ids: string[]): string[] => [...new Set(ids)].sort();

export const has = (state: BarState, id: string): boolean => state.have.includes(id);

export const add = (state: BarState, id: string): BarState => ({
  have: normalise([...state.have, id]),
});

export const remove = (state: BarState, id: string): BarState => ({
  have: state.have.filter((v) => v !== id),
});

export const toggle = (state: BarState, id: string): BarState =>
  has(state, id) ? remove(state, id) : add(state, id);

export const clear = (): BarState => ({ have: [] });

/**
 * The one-tap starter set for an empty shelf.
 *
 * An empty inventory produces an empty page, which is the most common thing
 * this page is, so the empty state has to offer a route out rather than an
 * instruction. The set is derived rather than listed: the non-staple
 * ingredients the most published drinks name, which is the honest answer to
 * "what would a basic bar be" for THIS catalogue rather than a remembered one.
 */
export function starterSet(
  entries: Array<{ ingredients: string[]; garnishes: string[] }>,
  isStaple: (id: string) => boolean,
  size = 8,
): string[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const garnishes = new Set(entry.garnishes);
    for (const id of new Set(entry.ingredients)) {
      if (isStaple(id) || garnishes.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, size)
    .map(([id]) => id);
}
