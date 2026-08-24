/**
 * Energy and macronutrients.
 *
 * Nutrition is secondary here. It matters for smoothies, shakes, lattes and
 * juices and is close to meaningless for a Martini beyond its energy, but it is
 * computed the same way regardless.
 *
 * It is a total-input calculation — what went in, divided by how many drinks
 * came out — and must be labelled "as made with these ingredients" rather than
 * "per 100 ml as served". Nutrient degradation, oxidation and extraction
 * efficiency are deliberately not modelled: that needs data nobody publishes
 * reliably, and modelling it would compound uncertainty into a figure that
 * looks more precise for it.
 */

import type { Composition } from './composition.ts';

export interface NutritionResult {
  kcal: number;
  /** Split out so the page can say how much of the energy is the alcohol. */
  alcoholKcal: number;
  macroKcal: number;
  carbohydrateG: number;
  proteinG: number;
  fatG: number;
  saturatedFatG: number;
  fibreG: number;
  sodiumMg: number;
  estimated: boolean;
}

export function computeNutrition(composition: Composition, alcoholKcal: number): NutritionResult {
  return {
    kcal: alcoholKcal + composition.macroKcal,
    alcoholKcal,
    macroKcal: composition.macroKcal,
    carbohydrateG: composition.carbohydrateG,
    proteinG: composition.proteinG,
    fatG: composition.fatG,
    saturatedFatG: composition.saturatedFatG,
    fibreG: composition.fibreG,
    sodiumMg: composition.sodiumMg,
    estimated: composition.estimated,
  };
}

/**
 * Compare a Form's stated energy against what its own macros and strength come
 * to.
 *
 * A stated figure that disagrees badly with the macros beside it means one of
 * the two was transcribed wrong, and catching that at the ingredient is far
 * cheaper than noticing a drink's energy looks odd two hundred pages later.
 * Reported as a tolerance rather than an equality: rounding on a label, sugar
 * alcohols and the odd unlisted component all move it a few percent honestly.
 */
export function statedEnergyDisagreement(
  statedKcalPer100: number | undefined,
  macroKcalPer100: number,
  abvPercent: number,
  densityGPerMl: number | undefined,
  ethanolGPerMl: number,
  ethanolKcalPerG: number,
  tolerance = 0.15,
): { computed: number; stated: number; ratio: number } | null {
  if (statedKcalPer100 == null || statedKcalPer100 <= 0) return null;

  // Per 100 of the Form's own base unit. For a liquid that is 100 ml; for a
  // solid, the alcohol term needs a density to reach a volume at all.
  const mlPer100 = densityGPerMl != null && densityGPerMl > 0 ? 100 / densityGPerMl : 100;
  const alcoholKcal = ((mlPer100 * abvPercent) / 100) * ethanolGPerMl * ethanolKcalPerG;
  const computed = macroKcalPer100 + alcoholKcal;
  if (computed <= 0) return null;

  const ratio = computed / statedKcalPer100;
  if (Math.abs(ratio - 1) <= tolerance) return null;
  return { computed, stated: statedKcalPer100, ratio };
}
