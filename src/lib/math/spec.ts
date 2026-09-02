/**
 * The Drink Spec — the flagship computed panel, and the service modes.
 *
 * Two invariants govern this file and both are load-bearing.
 *
 * 1. Every figure in the spec is PER DRINK and does not move with the stepper.
 *    Totals scale; the spec does not.
 * 2. Every per-drink figure is IDENTICAL in both service modes. The batch is
 *    computed to arrive at the same drink, and that equality is the proof the
 *    batch arithmetic is right — which is why the page shows it rather than
 *    claiming it.
 *
 * The second falls out of the first if the maths is written once and read
 * twice, which is what happens here: the spec is computed from the per-drink
 * ingredient list, and batching then replaces the ice with a water line that
 * carries exactly the dilution the ice would have contributed.
 */

import { computeAlcohol, type AlcoholResult } from './alcohol.ts';
import {
  acidPercentOfFinal,
  allBarsInOneQuartile,
  computeBalance,
  sugarPerLitre,
  type Bar,
} from './balance.ts';
import { computeComposition, perDrinkComposition, type Composition } from './composition.ts';
import { computeDilution, type DilutionResult } from './dilution.ts';
import {
  deriveBaseSpirits,
  deriveDiet,
  deriveServingTemp,
  deriveStrength,
  type DietResult,
  type SpiritContribution,
} from './facets.ts';
import { computeNutrition, type NutritionResult } from './nutrition.ts';
import type {
  DrinkVersion,
  IngredientLine,
  Ingredient,
  ResolvedLine,
  ServiceMode,
  ServingTemp,
  Strength,
} from './types.ts';

export interface DrinkSpec {
  /** Per drink, already divided down from the recipe's own yield. */
  composition: Composition;
  dilution: DilutionResult;
  alcohol: AlcoholResult;
  nutrition: NutritionResult;
  bars: Bar[];
  /** Per drink, after dilution. */
  finalVolumeMl: number;
  /**
   * Whether the final volume itself is modelled.
   *
   * Not the same question as whether the composition is. A brewed drink's yield
   * is authored - it is what the recipe says reaches the cup - so it carries no
   * estimate marker even where the dose is only partly extracted and the
   * composition therefore is a model. The marker means the true figure is not
   * on the page, and for a yield it is.
   */
  finalVolumeEstimated: boolean;
  sugarGPerL: number;
  acidPercentFinal: number;
  facets: {
    baseSpirits: SpiritContribution[];
    strength: Strength;
    servingTemp: ServingTemp;
    diet: DietResult;
  };
  /** Which panels the page shows. Derived from the data, never tagged. */
  panels: {
    alcohol: boolean;
    dilution: boolean;
    brew: boolean;
    ferment: boolean;
  };
  warnings: string[];
}

/**
 * Compute the spec for ONE drink.
 *
 * The drink count is deliberately not a parameter. Every figure here is
 * invariant under it, and taking it as an argument would invite a caller to
 * multiply something that must not be multiplied.
 */
export function computeDrinkSpec(version: DrinkVersion, lines: ResolvedLine[]): DrinkSpec {
  // An ingredient list yields whatever `defaultDrinks` says. The dilution model
  // runs on the totals — its fraction depends on the combined strength, which
  // is the same either way — and everything after it works per drink.
  const drinksPerRecipe = Math.max(1, version.defaultDrinks);
  const totals = computeComposition(lines);

  // The fraction acts on the dilution basis — everything poured EXCEPT a line
  // marked `addedAfterDilution` (a shaken drink's sparkling-wine top, say),
  // which was never in the tin for whatever step drives the model. Equal to
  // the full poured volume unless such a line exists, so this changes nothing
  // for every drink that doesn't have one.
  const dilutionTotal = computeDilution({
    pouredVolumeMl: totals.dilutionBasisVolumeMl,
    pouredAbvPercent: totals.dilutionBasisAbvPercent,
    classId: version.dilutionClass,
    // Authored water already sits inside the poured volume, so passing it again
    // here would count it twice.
    authoredWaterMl: 0,
  });

  const composition = perDrinkComposition(totals, drinksPerRecipe);
  const dilution: DilutionResult = {
    ...dilutionTotal,
    dilutionMl: dilutionTotal.dilutionMl / drinksPerRecipe,
    // The FULL poured volume reaches the glass — an added-after line still
    // has to be in the final volume, it just never took the fraction.
    finalVolumeMl: (totals.pouredVolumeMl + dilutionTotal.dilutionMl) / drinksPerRecipe,
  };

  const volumeEstimated = dilution.estimated || composition.estimated;

  // A brewed drink's final volume is what reaches the cup, and that is measured
  // rather than summed. Most of the dose never leaves the filter, and the bed
  // holds back a further part of the water — so adding the inputs up would
  // describe a vessel nobody drinks out of, and would fail the glassware fit
  // check for a mug that holds the drink perfectly well.
  const finalVolumeMl = version.brew
    ? version.brew.yieldMl / drinksPerRecipe
    : dilution.finalVolumeMl;

  const alcohol = computeAlcohol({
    alcoholMl: composition.alcoholMl,
    finalVolumeMl,
    volumeEstimated,
  });

  const nutrition = computeNutrition(composition, alcohol.alcoholKcal);

  const sugarGPerL = sugarPerLitre(composition.sugarG, finalVolumeMl);
  const acidPercentFinal = acidPercentOfFinal(composition.acidG, finalVolumeMl);

  const bars = computeBalance({
    finalAbvPercent: alcohol.finalAbvPercent,
    sugarGPerL,
    acidPercentFinal,
    bitterness: version.bitterness,
    volumeEstimated,
  });

  const warnings: string[] = [];
  // Both bounds are usually an authoring error — a misplaced decimal on a
  // bottle strength, or a dilution model that was never applied.
  if (alcohol.finalAbvPercent > 45 && !version.highProof) {
    warnings.push(
      `Computes at ${alcohol.finalAbvPercent.toFixed(1)}% ABV, above the 45% bound, and is not flagged highProof.`,
    );
  }
  if (
    alcohol.finalAbvPercent < 0.5 &&
    alcohol.finalAbvPercent > 0 &&
    !version.zeroProof
  ) {
    warnings.push(
      `Computes at ${alcohol.finalAbvPercent.toFixed(2)}% ABV, below the 0.5% bound, and is not flagged zeroProof.`,
    );
  }
  const quartile = allBarsInOneQuartile(bars);
  if (quartile) {
    warnings.push(
      `All four balance bars sit in the ${quartile} quartile, which usually means a missing sugar or acid figure on an ingredient.`,
    );
  }

  return {
    composition,
    dilution,
    alcohol,
    nutrition,
    bars,
    finalVolumeMl,
    finalVolumeEstimated: version.brew ? false : volumeEstimated,
    sugarGPerL,
    acidPercentFinal,
    facets: {
      baseSpirits: deriveBaseSpirits(lines),
      // A ferment that develops alcohol has none in its ingredient list, so the
      // computed ABV is zero and the facet would read "zero-proof" for a drink
      // the page itself documents as reaching two percent. The strength facet
      // is the one a reader avoiding alcohol actually filters on, so it takes
      // the top of the declared range. The standard-drinks figure is untouched:
      // a range cannot honestly produce one, and it does not try to.
      strength: deriveStrength(
        version.ferment?.developsAlcohol && version.ferment.estimatedAbvRange
          ? Math.max(alcohol.finalAbvPercent, version.ferment.estimatedAbvRange[1])
          : alcohol.finalAbvPercent,
      ),
      servingTemp: deriveServingTemp({
        ...(version.serveTempC !== undefined ? { serveTempC: version.serveTempC } : {}),
        dilutionClass: version.dilutionClass,
        ...(version.servedOverIce !== undefined ? { servedOverIce: version.servedOverIce } : {}),
        ...(version.brew !== undefined ? { brewWaterTempC: version.brew.waterTempC } : {}),
      }),
      diet: deriveDiet(lines),
    },
    panels: {
      // Which cells appear is read off the data. `drinkClass` survives only as a
      // hint for panel ORDER, never for whether a panel exists.
      alcohol: lines.some((l) => l.form.abvPercent > 0),
      dilution: dilution.fraction > 0,
      brew: version.brew !== undefined,
      ferment: version.ferment !== undefined,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Service modes
// ---------------------------------------------------------------------------

export const MIN_BATCH_DRINKS = 2;

export interface BatchResult {
  drinks: number;
  /** The line the engine inserts. Marked computed, and never editable. */
  waterLine: IngredientLine | null;
  waterIngredient: Ingredient | null;
  /** Everything that goes in the bottle, including the water. */
  yieldMl: number;
  available: boolean;
  unavailableReason?: string;
}

const WATER_INGREDIENT: Ingredient = {
  id: 'water',
  name: 'Water',
  kind: 'ingredient',
  category: 'water',
  pantryStaple: true,
  forms: [
    {
      id: 'standard',
      abvPercent: 0,
      densityGPerMl: 1,
      sugarGPer100: 0,
      acidPercent: 0,
      animalOrigin: 'none',
      allergenTags: [],
    },
  ],
};

/**
 * Turn a per-drink spec into a batch.
 *
 * The water that shaking or stirring would have contributed has to be added
 * deliberately, because nothing will meet ice at service. This is the step home
 * batches skip, and skipping it is why a batched cocktail tastes harsh next to
 * the same drink made one at a time — the quantity is not a rule of thumb, it
 * is the dilution figure from the spec panel in millilitres.
 */
export function computeBatch(
  spec: DrinkSpec,
  version: DrinkVersion,
  drinks: number,
): BatchResult {
  if (version.batchable === 'none') {
    return {
      drinks,
      waterLine: null,
      waterIngredient: null,
      yieldMl: 0,
      available: false,
      unavailableReason:
        version.batchNote ?? 'This drink takes no dilution from ice, so there is nothing to batch.',
    };
  }

  if (drinks < MIN_BATCH_DRINKS) {
    return {
      drinks,
      waterLine: null,
      waterIngredient: null,
      yieldMl: 0,
      available: false,
      unavailableReason: `Batching starts at ${MIN_BATCH_DRINKS} drinks.`,
    };
  }

  // Stated PER DRINK, like every other line in the checklist, so the ordinary
  // scaling multiplies it up alongside them. An absolute batch figure here
  // would need every consumer to special-case one line, and the first one to
  // forget would show a batch of water beside single measures of everything
  // else.
  const perDrinkMl = spec.dilution.dilutionMl;

  return {
    drinks,
    waterLine:
      perDrinkMl > 0
        ? {
            id: '__batch-water',
            ingredientRef: 'water',
            formRef: 'standard',
            amount: perDrinkMl,
            unit: 'ml',
            computed: true,
            note: 'Replaces the dilution that mixing over ice would have added.',
          }
        : null,
    waterIngredient: perDrinkMl > 0 ? WATER_INGREDIENT : null,
    // The one figure on the page that is about the whole batch rather than
    // about one drink, and therefore the one that is stated absolutely.
    yieldMl: (spec.composition.pouredVolumeMl + spec.dilution.dilutionMl) * drinks,
    available: true,
  };
}

/**
 * What the checklist shows for a given count and mode.
 *
 * Displayed amounts are always the full authored amount — a partial-use
 * fraction changes the composition, never the shopping quantity.
 */
export function linesForService(
  lines: ResolvedLine[],
  batch: BatchResult,
  service: ServiceMode,
): ResolvedLine[] {
  if (service !== 'batch' || !batch.available || !batch.waterLine || !batch.waterIngredient) {
    return lines;
  }
  const form = batch.waterIngredient.forms[0];
  if (!form) return lines;
  return [...lines, { line: batch.waterLine, ingredient: batch.waterIngredient, form }];
}
