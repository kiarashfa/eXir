/**
 * The single walk over a drink's ingredient lines.
 *
 * Everything downstream — alcohol, sugar, acid, energy, the balance bars —
 * reads its inputs from here rather than iterating the lines again, so a rule
 * about which lines count, and for how much, exists in exactly one place.
 */

import type { NutritionPer100, ResolvedLine } from './types.ts';

/** Why a figure on this drink is a modelled one rather than a stated one. */
export interface CompositionIssue {
  kind:
    | 'abv-without-density'
    | 'mass-without-density'
    | 'estimated-density'
    | 'partial-consumption';
  lineId: string;
  message: string;
}

export interface Composition {
  /** Liquid actually entering the mixing vessel, after any partial-use fraction. */
  pouredVolumeMl: number;
  /** Millilitres of pure ethanol. */
  alcoholMl: number;
  /** ABV of the combined pre-dilution liquid, as a percentage. */
  pouredAbvPercent: number;
  sugarG: number;
  acidG: number;
  /** Energy from the non-alcohol macros only. Alcohol is added separately. */
  macroKcal: number;
  carbohydrateG: number;
  proteinG: number;
  fatG: number;
  saturatedFatG: number;
  fibreG: number;
  sodiumMg: number;
  /** Water the recipe states outright. Never modelled, so never an estimate. */
  authoredWaterMl: number;
  /** True where a figure above descends from an estimate rather than a bottle. */
  estimated: boolean;
  issues: CompositionIssue[];
}

/** Atwater factors. The alcohol factor lives in standard-drinks.json. */
const KCAL_PER_G = { carbohydrate: 4, protein: 4, fat: 9 } as const;

/**
 * How much of an authored amount actually ends up in the glass.
 *
 * Applies to the composition calculation only. The shopping quantity and the
 * checklist always show the full authored amount — the reader still has to buy
 * the whole 5 ml of absinthe they are about to pour away.
 */
export const effectiveAmount = (amount: number, consumedFraction?: number): number =>
  amount * (consumedFraction ?? 1);

/**
 * Energy from macros, deliberately not from a stated `kcal` figure.
 *
 * A bottle's stated energy already contains its alcohol. Adding the separately
 * computed alcohol energy to it would count the same ethanol twice, and on a
 * spirit that is most of the number. The stated figure is kept on the Form for
 * citation and for a cross-check, and never summed.
 */
export function macroKcalPer100(nutrition: NutritionPer100 | undefined, sugarGPer100?: number): number {
  if (!nutrition) {
    // A Form with a sugar figure and no nutrition block still has known energy:
    // sugar is a carbohydrate and carbohydrate is 4 kcal a gram.
    return (sugarGPer100 ?? 0) * KCAL_PER_G.carbohydrate;
  }
  const carbs = nutrition.carbohydrateG ?? nutrition.sugarsG ?? sugarGPer100 ?? 0;
  return (
    carbs * KCAL_PER_G.carbohydrate +
    (nutrition.proteinG ?? 0) * KCAL_PER_G.protein +
    (nutrition.fatG ?? 0) * KCAL_PER_G.fat
  );
}

/**
 * Divide a recipe's totals down to one drink.
 *
 * An ingredient list yields whatever `defaultDrinks` says it does, so the
 * extensive figures — volume, alcohol, sugar, acid, energy — have to be divided
 * before anything calls them per-drink.
 *
 * `pouredAbvPercent` is deliberately untouched. It is a ratio of two extensive
 * quantities that both divide by the same number, so it is the same for one
 * drink as for the batch, and dividing it would be wrong rather than redundant.
 */
export function perDrinkComposition(composition: Composition, defaultDrinks: number): Composition {
  const n = Math.max(1, defaultDrinks);
  if (n === 1) return composition;
  return {
    ...composition,
    pouredVolumeMl: composition.pouredVolumeMl / n,
    alcoholMl: composition.alcoholMl / n,
    sugarG: composition.sugarG / n,
    acidG: composition.acidG / n,
    macroKcal: composition.macroKcal / n,
    carbohydrateG: composition.carbohydrateG / n,
    proteinG: composition.proteinG / n,
    fatG: composition.fatG / n,
    saturatedFatG: composition.saturatedFatG / n,
    fibreG: composition.fibreG / n,
    sodiumMg: composition.sodiumMg / n,
    authoredWaterMl: composition.authoredWaterMl / n,
  };
}

/** Water identified by ingredient id, so batch mode can tell its own line apart. */
const WATER_IDS = new Set(['water', 'still-water', 'filtered-water']);

export function computeComposition(lines: ResolvedLine[]): Composition {
  let pouredVolumeMl = 0;
  let alcoholMl = 0;
  let sugarG = 0;
  let acidG = 0;
  let macroKcal = 0;
  let carbohydrateG = 0;
  let proteinG = 0;
  let fatG = 0;
  let saturatedFatG = 0;
  let fibreG = 0;
  let sodiumMg = 0;
  let authoredWaterMl = 0;
  let estimated = false;
  const issues: CompositionIssue[] = [];

  for (const { line, form } of lines) {
    const amount = effectiveAmount(line.amount, line.consumedFraction);

    if (line.consumedFraction != null && line.consumedFraction < 1) {
      issues.push({
        kind: 'partial-consumption',
        lineId: line.id,
        message:
          line.consumedFractionNote ??
          'Only part of this line reaches the glass, so the composition is a model of what does.',
      });
      // A drink with any partial-use line has a computed composition that is an
      // estimate, and the reason has to be visible.
      estimated = true;
    }

    // --- volume -----------------------------------------------------------
    let volumeMl = 0;
    if (line.unit === 'ml') {
      volumeMl = amount;
    } else if (form.densityGPerMl != null && form.densityGPerMl > 0) {
      volumeMl = amount / form.densityGPerMl;
      if (form.densitySource === 'estimated') {
        estimated = true;
        issues.push({
          kind: 'estimated-density',
          lineId: line.id,
          message: 'Volume derived through an estimated density.',
        });
      }
    } else {
      // A solid with no density contributes no volume rather than a guessed one.
      issues.push({
        kind: 'mass-without-density',
        lineId: line.id,
        message: 'Authored in grams with no density, so it adds no volume to the drink.',
      });
    }
    pouredVolumeMl += volumeMl;

    if (WATER_IDS.has(line.ingredientRef)) authoredWaterMl += volumeMl;

    // --- alcohol ----------------------------------------------------------
    if (form.abvPercent > 0) {
      if (line.unit === 'g' && (form.densityGPerMl == null || form.densityGPerMl <= 0)) {
        // The calculation cannot proceed and must not guess. This fails the build.
        issues.push({
          kind: 'abv-without-density',
          lineId: line.id,
          message:
            'Alcoholic and authored in grams with no density. The ABV cannot be computed from this.',
        });
      } else {
        alcoholMl += (volumeMl * form.abvPercent) / 100;
      }
    }

    // --- sugar and acid ---------------------------------------------------
    // Both figures are stated per 100 of the Form's own base unit, so they
    // multiply the amount directly and need no density on the way.
    sugarG += (amount * (form.sugarGPer100 ?? 0)) / 100;
    acidG += (amount * (form.acidPercent ?? 0)) / 100;

    // --- nutrition --------------------------------------------------------
    const n = form.nutritionPer100g;
    const per100 = amount / 100;
    macroKcal += macroKcalPer100(n, form.sugarGPer100) * per100;
    carbohydrateG += (n?.carbohydrateG ?? n?.sugarsG ?? form.sugarGPer100 ?? 0) * per100;
    proteinG += (n?.proteinG ?? 0) * per100;
    fatG += (n?.fatG ?? 0) * per100;
    saturatedFatG += (n?.saturatedFatG ?? 0) * per100;
    fibreG += (n?.fibreG ?? 0) * per100;
    sodiumMg += (n?.sodiumMg ?? 0) * per100;
  }

  return {
    pouredVolumeMl,
    alcoholMl,
    pouredAbvPercent: pouredVolumeMl > 0 ? (alcoholMl / pouredVolumeMl) * 100 : 0,
    sugarG,
    acidG,
    macroKcal,
    carbohydrateG,
    proteinG,
    fatG,
    saturatedFatG,
    fibreG,
    sodiumMg,
    authoredWaterMl,
    estimated,
    issues,
  };
}
