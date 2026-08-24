/**
 * The shape of the two build-time exports the client tools read.
 *
 * Written once, here, and imported by both ends: the routes that emit the JSON
 * and the browser code that consumes it. A second copy of these interfaces
 * would be a second definition free to drift, and the failure would be a
 * silently absent field rather than a type error.
 *
 * DELIBERATELY SCHEMA-FREE and value-free — types and small pure helpers only.
 * Imported by client code, so anything reaching the content schemas from here
 * would ship Zod to the browser.
 */

import type { Allergen, BaseUnit, CountUnit, Diet, ServingTemp, Strength } from './math/types.ts';

// ---------------------------------------------------------------------------
// catalog-index.json — one light record per drink
// ---------------------------------------------------------------------------

/**
 * The catalogue row, and everything My Bar matches against.
 *
 * A row represents the drink's DEFAULT version. One drink is one entry; a
 * non-default version gets no row of its own.
 */
export interface CatalogEntry {
  slug: string;
  title: string;
  style: string;
  version: string;
  category: string[];
  origin: string[];
  method: string[];
  occasion: string[];
  baseSpirits: string[];
  strength: Strength;
  servingTemp: ServingTemp;
  diets: Diet[];
  allergens: Allergen[];
  abvPercent: number;
  kcal: number;
  sugarGPerL: number;
  totalSec: number;
  totalTime: string;
  difficulty: string;
  steps: number;
  glass: string | null;
  family: string | null;
  preparations: number;
  /** Every ingredient the default version names, deduplicated. */
  ingredients: string[];
  /**
   * Which of those are garnish lines.
   *
   * A garnish never blocks a match — nobody is stopped from making a Negroni by
   * having no orange — so it is excluded from the matching denominator and
   * listed separately as something you will also want.
   */
  garnishes: string[];
  /**
   * Per ingredient, the ingredients an authored substitution would put in its
   * place. Flattened onto the row so a match can use it without fetching a
   * detail file per drink.
   */
  substitutes: Record<string, string[]>;
  summary: string;
  image: { card: string; thumb: string; alt: string } | null;
}

export interface CatalogIndex {
  generated: number;
  drinks: CatalogEntry[];
}

// ---------------------------------------------------------------------------
// ingredient-index.json — one light record per ingredient AND preparation
// ---------------------------------------------------------------------------

/**
 * A Preparation's own recipe line, as the shopping list needs it.
 *
 * Nothing on the way to a drink resolves these — a Preparation is referenced as
 * an ingredient and its steps are never walked — so the shopping list is the
 * only consumer that reads them, and it reads them from here.
 */
export interface IndexedPrepLine {
  ingredientRef: string;
  formRef: string;
  amount: number;
  unit: BaseUnit;
  garnish: boolean;
}

export interface IndexedForm {
  id: string;
  /** Present where the ingredient is bought or counted as a thing, not a volume. */
  countUnit?: CountUnit;
  /** Drives the bottle estimate, which applies to bottled goods and nothing else. */
  abvPercent: number;
  /** How the Form reads mid-sentence, where the ingredient name will not do. */
  proseName?: string;
}

/**
 * What a counted line is called on a shopping list.
 *
 * On a drink page the count's own plural is enough — "3 whites" in a recipe for
 * a sour is unambiguous. A shopping list has no such context, so it uses the
 * Form's prose name where there is one, with the singular swapped for the
 * plural inside it: `white` + `whites` + "egg white" gives "egg whites", which
 * is both correct English and the thing a shop sells.
 */
export function countedName(
  countUnit: CountUnit,
  count: number,
  proseName?: string,
): string {
  const word = count === 1 ? countUnit.singular : countUnit.plural;
  if (!proseName) return word;
  const at = proseName.toLowerCase().lastIndexOf(countUnit.singular.toLowerCase());
  if (at < 0) return proseName;
  return proseName.slice(0, at) + word + proseName.slice(at + countUnit.singular.length);
}

export interface IndexedIngredient {
  id: string;
  name: string;
  kind: 'ingredient' | 'preparation';
  category: string;
  /** Grouping label for the My Bar picker; the category, humanised once. */
  group: string;
  /**
   * Always assumed and excluded from matching entirely, which is why a wrong
   * `true` costs more than a wrong `false`: it quietly inflates every match on
   * the site.
   */
  staple: boolean;
  proprietary: boolean;
  countryOfOrigin?: string;
  forms: IndexedForm[];
  /** Preparations only. */
  yieldMl?: number;
  shelfLife?: { days: number; storage: string };
  purchasable?: boolean;
  lines?: IndexedPrepLine[];
  /** True where a published drink names it. A bar picker should not offer the rest. */
  used: boolean;
}

export interface IngredientIndex {
  generated: number;
  ingredients: IndexedIngredient[];
}

// ---------------------------------------------------------------------------
// drink-detail/{slug}.json — fetched on demand, one drink at a time
// ---------------------------------------------------------------------------

export interface DetailLine {
  id: string;
  ingredientRef: string;
  form: string;
  name: string;
  amount: number;
  unit: BaseUnit;
  garnish: boolean;
  preparation: boolean;
}

export interface DetailSpec {
  finalVolumeMl: number;
  abvPercent: number;
  pureAlcoholG: number;
  /**
   * A list rather than a pair, because the denominators are data. Both the US
   * and UK figures are always shown and a third could be added with its own
   * citation without changing this shape.
   */
  standardDrinks: Array<{ id: string; label: string; drinks: number }>;
  sugarG: number;
  sugarGPerL: number;
  acidPercent: number;
  kcal: number;
  estimated: boolean;
}

export interface DetailVersion {
  id: string;
  label: string;
  isDefault: boolean;
  defaultDrinks: number;
  method: string;
  batchable: 'full' | 'partial' | 'none';
  glass: { id: string; name: string; capacityMl: number } | null;
  /**
   * What the ice takes up in that glass, for the style this version is served
   * with. The occasion view weighs ice from it; the fit check reads the same
   * figure at build time.
   */
  serviceIceMl: number;
  iceStyle: string;
  /**
   * The water the method adds, per drink. In batched service this is the line
   * the engine inserts; in made-to-order service it is what melts off the ice,
   * which is the same figure seen from the other side.
   */
  dilutionMlPerDrink: number;
  lines: DetailLine[];
  spec: DetailSpec;
  timing: { prepSec: number; makeSec: number; restSec: number; totalSec: number };
  makeAhead: unknown;
  substitutions: Array<{
    lineRef: string;
    substitute: string;
    formRef?: string;
    ratio?: string;
    note: string;
    impact?: { flavour?: string; strength?: string; sweetness?: string };
  }>;
}

export interface DrinkDetail {
  slug: string;
  name: string;
  summary: string;
  versions: DetailVersion[];
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** `bitter-aperitivo` → `Bitter aperitivo`. One rule, so two views never disagree. */
export const humanise = (id: string): string =>
  id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const byId = <T extends { id: string }>(items: T[]): Map<string, T> =>
  new Map(items.map((item) => [item.id, item]));
