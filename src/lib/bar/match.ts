/**
 * Matching a shelf against the catalogue.
 *
 * "What can I make from my fridge" is a weak question, because you improvise
 * with food. "What can I make from the eight bottles on my shelf" has a hard
 * answer, and this computes it.
 *
 * Three exclusions do most of the work, and each one is a decision rather than
 * a convenience:
 *
 * - **Staples are excluded from matching entirely.** Sugar, water, salt and a
 *   lemon are things a kitchen keeps rather than shops for. Counting them would
 *   mean every reader starts at a few percent on every drink for owning nothing
 *   in particular. This is also why a wrong `pantryStaple: true` is expensive:
 *   it silently inflates every match on the site.
 * - **Garnishes are excluded too.** Nobody is stopped from making a Negroni by
 *   having no orange. They are surfaced as "you'll also want" instead.
 * - **A substitution the reader can actually perform counts as a match**, and
 *   says so, because the authored substitution already names a real ingredient
 *   whose composition is known.
 */

import type { CatalogEntry } from '../catalog.ts';

/**
 * Results below this are not shown.
 *
 * A DISPLAY threshold and nothing more. The matching itself returns everything,
 * because the set-cover needs the drinks that are far from complete — a drink
 * two of three ingredients short is 33% and would never be listed, and is also
 * exactly the kind one bottle finishes. Filtering inside the match would have
 * hidden those from the very feature that exists to find them.
 */
export const MATCH_THRESHOLD = 0.7;

export interface Substituted {
  /** The ingredient the recipe names. */
  wanted: string;
  /** The one the reader owns and would use instead. */
  using: string;
}

export interface DrinkMatch {
  entry: CatalogEntry;
  /** Non-staple, non-garnish ingredients — the ones that decide the answer. */
  required: string[];
  owned: string[];
  substituted: Substituted[];
  missing: string[];
  /** Garnishes and staples, named but never counted. */
  alsoWant: string[];
  /** 0–1 over `required`. A drink needing nothing beyond staples is 1. */
  percent: number;
  complete: boolean;
}

export interface MatchOptions {
  owned: Set<string>;
  isStaple: (id: string) => boolean;
}

/**
 * A staple counts as owned for the purpose of standing in for something else.
 *
 * If a recipe's substitution for demerara syrup is granulated sugar, and sugar
 * is a staple, then the reader does have the substitute — the whole point of
 * the staples list is that they are assumed present.
 */
const available = (options: MatchOptions, id: string): boolean =>
  options.owned.has(id) || options.isStaple(id);

export function matchOne(entry: CatalogEntry, options: MatchOptions): DrinkMatch {
  const garnishes = new Set(entry.garnishes);

  const required: string[] = [];
  const alsoWant: string[] = [];
  for (const id of entry.ingredients) {
    if (options.isStaple(id) || garnishes.has(id)) alsoWant.push(id);
    else required.push(id);
  }

  const owned: string[] = [];
  const substituted: Substituted[] = [];
  const missing: string[] = [];

  for (const id of required) {
    if (options.owned.has(id)) {
      owned.push(id);
      continue;
    }
    const using = (entry.substitutes[id] ?? []).find((sub) => available(options, sub));
    if (using) substituted.push({ wanted: id, using });
    else missing.push(id);
  }

  // A drink whose every line is a staple or a garnish needs nothing bought,
  // so it is complete rather than undefined.
  const percent = required.length === 0 ? 1 : (owned.length + substituted.length) / required.length;

  return {
    entry,
    required,
    owned,
    substituted,
    missing,
    alsoWant,
    percent,
    complete: missing.length === 0,
  };
}

/**
 * Every drink, closest first. One computation, read by both halves of the page.
 *
 * Ranked by completeness rather than reduced to a yes/no list: "you are one
 * bottle away" is the most useful thing this page can say, and a binary filter
 * throws it away.
 */
export function matchAll(entries: CatalogEntry[], options: MatchOptions): DrinkMatch[] {
  return entries
    .map((entry) => matchOne(entry, options))
    .sort(
      (a, b) =>
        b.percent - a.percent ||
        a.missing.length - b.missing.length ||
        // A drink you can make outright beats one you can only substitute into.
        a.substituted.length - b.substituted.length ||
        a.entry.title.localeCompare(b.entry.title),
    );
}

/** The display slice: close enough to be worth showing. */
export const withinReach = (
  matches: DrinkMatch[],
  threshold = MATCH_THRESHOLD,
): DrinkMatch[] => matches.filter((m) => m.percent >= threshold);
