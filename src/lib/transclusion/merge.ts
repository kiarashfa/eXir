/**
 * Grouping ingredient lines that name the same thing.
 *
 * Used twice: once at build time when a Component's lines are folded into a
 * drink, and once in the browser when the shopping list adds up a whole plan.
 * Writing it once means a merge cannot behave differently in the two places.
 *
 * DELIBERATELY SCHEMA-FREE. This module is imported by client code, and
 * anything that reaches the content schemas reaches Zod, which then ships to
 * the browser to do nothing at all. Keep it importing types only.
 */

import type { IngredientLine, Portion } from '../math/types.ts';

/** The separator that marks a synthesized id. Authored ids may not contain it. */
export const SOURCE_SEPARATOR = '__';

export interface LineContribution {
  line: IngredientLine;
  /**
   * Which source the line came from — `self` for the parent, the Component's id
   * otherwise, suffixed by occurrence where the same Component appears twice.
   */
  sourceKey: string;
  /** The Component's own multiplier, already applied to the amount. */
  sourceLabel?: string;
}

export interface MergeIssue {
  kind: 'conflicting-consumed-fraction' | 'authored-id-contains-separator';
  lineId: string;
  message: string;
}

export interface MergeResult {
  lines: IngredientLine[];
  /** Old ref (`sourceKey::lineId`) to new ref, for rewriting prose. */
  refMap: Map<string, string>;
  issues: MergeIssue[];
}

/**
 * Same ingredient AND same Form merges. Different Form does not: fresh lime
 * juice and bottled lime cordial are different things with different
 * composition data, and one checklist line covering both would be wrong.
 */
export const mergeKey = (line: IngredientLine): string =>
  `${line.ingredientRef}::${line.formRef ?? 'default'}::${line.unit}`;

export const refKey = (sourceKey: string, lineId: string): string => `${sourceKey}::${lineId}`;

/** Extract every `<Qty ref="…">` in authored order. */
export function extractQtyRefs(prose: string): string[] {
  const out: string[] = [];
  for (const m of prose.matchAll(/<Qty\b[^>]*?\bref\s*=\s*"([^"]*)"/g)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/**
 * Merge contributions into one line per ingredient-and-form.
 *
 * Two lines of "lime juice" in one checklist reads as a bug, so the merged line
 * is expressed as portions with one synthesized portion per contributing
 * source. That shape also means the portions-sum integrity check validates the
 * merge for free, rather than needing a second rule of its own.
 */
export function mergeContributions(contributions: LineContribution[]): MergeResult {
  const groups = new Map<string, LineContribution[]>();
  const issues: MergeIssue[] = [];

  for (const c of contributions) {
    if (c.line.id.includes(SOURCE_SEPARATOR)) {
      issues.push({
        kind: 'authored-id-contains-separator',
        lineId: c.line.id,
        message: `Authored ids may not contain "${SOURCE_SEPARATOR}" — it marks a synthesized one.`,
      });
    }
    const key = mergeKey(c.line);
    const list = groups.get(key) ?? [];
    list.push(c);
    groups.set(key, list);
  }

  const lines: IngredientLine[] = [];
  const refMap = new Map<string, string>();

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;

    // A group of one is left exactly as authored. Most drinks transclude
    // nothing, and rewriting their refs would churn every id on the page to
    // solve a collision that cannot happen.
    if (group.length === 1) {
      lines.push(first.line);
      refMap.set(refKey(first.sourceKey, first.line.id), first.line.id);
      for (const p of first.line.portions ?? []) {
        refMap.set(refKey(first.sourceKey, p.id), p.id);
      }
      continue;
    }

    const portions: Portion[] = [];
    let total = 0;

    for (const c of group) {
      // A contributor that already had portions keeps them, namespaced. Its own
      // sub-refs stay resolvable, and the sums still nest correctly.
      const own = c.line.portions ?? [{ id: c.line.id, amount: c.line.amount }];
      for (const p of own) {
        const id = `${p.id}${SOURCE_SEPARATOR}${c.sourceKey}`;
        portions.push({ id, amount: p.amount, ...(p.note !== undefined ? { note: p.note } : {}) });
        refMap.set(refKey(c.sourceKey, p.id), id);
        total += p.amount;
      }
      // The line's own ref resolves to its whole contribution.
      const lineRef = `${c.line.id}${SOURCE_SEPARATOR}${c.sourceKey}`;
      if (!refMap.has(refKey(c.sourceKey, c.line.id))) {
        refMap.set(refKey(c.sourceKey, c.line.id), c.line.portions ? lineRef : portions[portions.length - 1]!.id);
      }
    }

    // Partial-use and substitution data attach to the merged line, taken from
    // whichever source contributes the most. Where they disagree the parent
    // wins, because it is the page the reader is actually on.
    const parent = group.find((c) => c.sourceKey === 'self');
    const largest = [...group].sort((a, b) => b.line.amount - a.line.amount)[0]!;
    const donor = parent ?? largest;

    const distinct = new Set(group.map((c) => c.line.consumedFraction ?? 1));
    if (distinct.size > 1) {
      issues.push({
        kind: 'conflicting-consumed-fraction',
        lineId: donor.line.id,
        message:
          'Sources disagree on how much of this ingredient reaches the glass; the parent value is used.',
      });
    }

    lines.push({
      ...donor.line,
      id: donor.line.id,
      amount: total,
      portions,
    });
  }

  return { lines, refMap, issues };
}

/**
 * Order the checklist by first use in the step sequence.
 *
 * The list should read in the order the maker reaches for things, which for a
 * cocktail is the build order — and that is also the order a jigger gets used.
 * Anything never mentioned in prose (a garnish, a rinse) keeps its authored
 * position, after everything that is.
 */
export function orderLinesByFirstUse(
  lines: IngredientLine[],
  proseInStepOrder: string[],
): IngredientLine[] {
  const rank = new Map<string, number>();
  let next = 0;

  for (const prose of proseInStepOrder) {
    for (const ref of extractQtyRefs(prose)) {
      if (!rank.has(ref)) rank.set(ref, next++);
    }
  }

  const rankOf = (line: IngredientLine): number => {
    const candidates = [line.id, ...(line.portions ?? []).map((p) => p.id)]
      .map((id) => rank.get(id))
      .filter((r): r is number => r !== undefined);
    return candidates.length ? Math.min(...candidates) : Number.MAX_SAFE_INTEGER;
  };

  return lines
    .map((line, index) => ({ line, index, rank: rankOf(line) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.line);
}

/** `sum(portions) === amount`, which the merge guarantees and authoring must not break. */
export const portionsSum = (line: IngredientLine): number | null =>
  line.portions ? line.portions.reduce((sum, p) => sum + p.amount, 0) : null;
