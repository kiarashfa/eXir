/**
 * What one more bottle unlocks.
 *
 * A greedy set-cover step over the catalogue, run entirely in the browser: for
 * every candidate ingredient, how many drinks would go from unmakeable to
 * makeable, and which few win. It is the reason My Bar is a persistent
 * inventory rather than a one-shot checklist — the question only has an answer
 * once the site knows what is already there.
 *
 * Three ranking rules, all of them deliberate:
 *
 * 1. **Only a drink brought to 100% counts as unlocked.** Moving a drink from
 *    60% to 80% is not an unlock, and counting it would let a bottle that
 *    nearly-helps everywhere beat one that actually completes something.
 * 2. **Staples are never candidates.** They are assumed present, so suggesting
 *    one is suggesting nothing. This falls out of the matching rather than
 *    needing a rule here: a staple is never in a `missing` list to begin with.
 * 3. **Ties break on distinct FAMILIES, not raw count.** Five variations on one
 *    drink is worth less than three drinks that are genuinely different, and
 *    breadth is what somebody buying one bottle is actually buying.
 *
 * Deliberately ONE step and not a multi-bottle plan. A greedy sequence cannot
 * start from a shelf where nothing is yet one ingredient short — every
 * candidate scores zero and the ranking has nothing to choose between — and the
 * only way to make it start is to credit bottles for moving drinks *closer*,
 * which is exactly what rule 1 exists to forbid. The empty shelf is answered by
 * the starter set instead, and the ranking recomputes as the reader adds
 * bottles, which is the iteration without the dishonest first move.
 */

import type { DrinkMatch } from './match.ts';

export interface Unlock {
  /** The ingredient to add. */
  id: string;
  /** Slugs of the drinks it completes. */
  drinks: string[];
  titles: string[];
  /** Distinct families among them. Breadth, which is the tie-break. */
  families: string[];
  count: number;
}

/**
 * Rank single additions.
 *
 * Only drinks that are exactly one ingredient short can be completed by one
 * bottle, so the candidate set falls out of the matching rather than needing a
 * separate pass over every ingredient in the catalogue.
 *
 * Takes the FULL match list, not the displayed one. A drink two ingredients
 * into three is 33% complete and would be filtered out of the display, and it
 * is also exactly the kind of drink one bottle completes.
 */
export function unlockRanking(matches: DrinkMatch[], limit = 5): Unlock[] {
  const byIngredient = new Map<string, DrinkMatch[]>();

  for (const match of matches) {
    if (match.missing.length !== 1) continue;
    const id = match.missing[0]!;
    const list = byIngredient.get(id) ?? [];
    list.push(match);
    byIngredient.set(id, list);
  }

  return [...byIngredient.entries()]
    .map(([id, unlocked]): Unlock => {
      const families = [
        ...new Set(unlocked.map((m) => m.entry.family).filter((f): f is string => f !== null)),
      ].sort();
      return {
        id,
        drinks: unlocked.map((m) => m.entry.slug),
        titles: unlocked.map((m) => m.entry.title),
        families,
        count: unlocked.length,
      };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.families.length - a.families.length ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
}
