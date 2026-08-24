/**
 * The Plan — one persisted primitive behind planning, shopping and the occasion
 * view. The shopping list is a view of this, not a third page with a store of
 * its own.
 *
 * HARD RULE: the Plan stores REFERENCES AND SCALARS. Never a snapshot of a
 * computed value — no amounts, no ABV, no totals. Everything is recomputed from
 * the catalogue on load, which is §3.1's rule applied to persistence, and it
 * means a month-old plan silently benefits from every correction made since.
 *
 * `drinks` is absolute rather than a multiplier, so a later change to a drink's
 * `defaultDrinks` cannot retroactively alter a saved plan.
 */

import { defineStore, type Store } from '../storage.ts';
import type { ServiceMode } from '../math/types.ts';

export interface PlanItem {
  /** Stable across edits, so two entries for the same drink stay distinguishable. */
  uid: string;
  drink: string;
  version: string;
  /** Absolute, never a multiplier. */
  drinks: number;
  service: ServiceMode;
}

export interface Occasion {
  guests: number;
  drinksPerGuest: number;
  name: string | null;
}

export interface PlanState {
  occasion: Occasion;
  items: PlanItem[];
  /** Ingredient ids already on hand. Struck through rather than removed. */
  have: string[];
  /** Per Preparation: make it, or buy it. */
  makePreparations: Record<string, 'make' | 'buy'>;
  includeStaples: boolean;
}

export const emptyPlan = (): PlanState => ({
  occasion: { guests: 6, drinksPerGuest: 2, name: null },
  items: [],
  have: [],
  makePreparations: {},
  includeStaples: false,
});

const int = (value: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, n));
};

/** Guests and drinks per guest are bounded because a host is not planning for ten thousand. */
export const MAX_GUESTS = 500;
export const MAX_PER_GUEST = 20;
export const MAX_DRINKS = 500;

const parseItem = (raw: unknown): PlanItem | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['drink'] !== 'string' || typeof r['version'] !== 'string') return null;
  return {
    uid: typeof r['uid'] === 'string' && r['uid'] ? r['uid'] : uid(),
    drink: r['drink'],
    version: r['version'],
    drinks: int(r['drinks'], 1, 1, MAX_DRINKS),
    service: r['service'] === 'batch' ? 'batch' : 'order',
  };
};

export const planStore: Store<PlanState> = defineStore<PlanState>({
  key: 'exir.plan.v1',
  schema: 1,
  empty: emptyPlan,
  parse: (raw) => {
    if (!Array.isArray(raw['items'])) return null;
    const occasion = (raw['occasion'] ?? {}) as Record<string, unknown>;
    const prep = (raw['makePreparations'] ?? {}) as Record<string, unknown>;

    return {
      occasion: {
        guests: int(occasion['guests'], 6, 0, MAX_GUESTS),
        drinksPerGuest: int(occasion['drinksPerGuest'], 2, 0, MAX_PER_GUEST),
        name: typeof occasion['name'] === 'string' ? occasion['name'] : null,
      },
      items: raw['items'].map(parseItem).filter((i): i is PlanItem => i !== null),
      have: Array.isArray(raw['have'])
        ? raw['have'].filter((v): v is string => typeof v === 'string')
        : [],
      makePreparations: Object.fromEntries(
        Object.entries(prep).filter((pair): pair is [string, 'make' | 'buy'] =>
          pair[1] === 'make' || pair[1] === 'buy',
        ),
      ),
      includeStaples: raw['includeStaples'] === true,
    };
  },
});

/**
 * A short opaque id.
 *
 * `crypto.randomUUID` is not universally available on http origins, and nothing
 * here needs to be unguessable — only distinct within one plan.
 */
export function uid(): string {
  return Math.random().toString(36).slice(2, 8);
}

// ---------------------------------------------------------------------------
// Mutations. All pure, all returning a new state.
// ---------------------------------------------------------------------------

export function addItem(
  state: PlanState,
  item: Omit<PlanItem, 'uid'> & { uid?: string },
): PlanState {
  // The same drink and version twice is a duplicate rather than two entries:
  // there is one shopping list, and two rows for one drink would split its
  // total across them for no gain.
  const existing = state.items.find((i) => i.drink === item.drink && i.version === item.version);
  if (existing) {
    return updateItem(state, existing.uid, {
      drinks: Math.min(MAX_DRINKS, existing.drinks + item.drinks),
      service: item.service,
    });
  }
  return {
    ...state,
    items: [
      ...state.items,
      { ...item, uid: item.uid ?? uid(), drinks: int(item.drinks, 1, 1, MAX_DRINKS) },
    ],
  };
}

export const removeItem = (state: PlanState, uidToDrop: string): PlanState => ({
  ...state,
  items: state.items.filter((i) => i.uid !== uidToDrop),
});

export const updateItem = (
  state: PlanState,
  uidToChange: string,
  patch: Partial<Omit<PlanItem, 'uid'>>,
): PlanState => ({
  ...state,
  items: state.items.map((i) =>
    i.uid === uidToChange
      ? { ...i, ...patch, drinks: int(patch.drinks ?? i.drinks, i.drinks, 1, MAX_DRINKS) }
      : i,
  ),
});

export const setOccasion = (state: PlanState, patch: Partial<Occasion>): PlanState => ({
  ...state,
  occasion: {
    guests: int(patch.guests ?? state.occasion.guests, state.occasion.guests, 0, MAX_GUESTS),
    drinksPerGuest: int(
      patch.drinksPerGuest ?? state.occasion.drinksPerGuest,
      state.occasion.drinksPerGuest,
      0,
      MAX_PER_GUEST,
    ),
    name: patch.name === undefined ? state.occasion.name : patch.name,
  },
});

export const toggleHave = (state: PlanState, id: string): PlanState => ({
  ...state,
  have: state.have.includes(id) ? state.have.filter((v) => v !== id) : [...state.have, id].sort(),
});

export const setPreparationChoice = (
  state: PlanState,
  id: string,
  choice: 'make' | 'buy',
): PlanState => ({
  ...state,
  makePreparations: { ...state.makePreparations, [id]: choice },
});

export const setIncludeStaples = (state: PlanState, include: boolean): PlanState => ({
  ...state,
  includeStaples: include,
});
