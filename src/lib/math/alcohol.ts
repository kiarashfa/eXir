/**
 * Strength, pure alcohol, and the two standard-drink denominators.
 *
 * All of it is arithmetic over the stated strength of the bottles a recipe
 * names, adjusted for the water the method adds. Pure alcohol and the standard
 * drinks are exact given those bottle figures; the final ABV is not, because it
 * divides by a final volume that came out of the dilution model.
 */

import standards from '../../data/standard-drinks.json' with { type: 'json' };

export const ETHANOL_G_PER_ML = standards.ethanolDensityGPerMl;
export const ETHANOL_KCAL_PER_G = standards.ethanolKcalPerG;

export interface StandardDrinkDenominator {
  id: string;
  label: string;
  gramsPerDrink: number;
  source: { title: string; publisher?: string; url?: string };
}

export const denominators = standards.denominators as StandardDrinkDenominator[];

export interface AlcoholInput {
  /** Millilitres of pure ethanol in the drink. */
  alcoholMl: number;
  /** Volume after dilution and any authored water. */
  finalVolumeMl: number;
  /** True where the final volume came out of the dilution model. */
  volumeEstimated: boolean;
}

export interface StandardDrinks {
  id: string;
  label: string;
  drinks: number;
}

export interface AlcoholResult {
  /** Percent ABV of the finished drink. */
  finalAbvPercent: number;
  pureAlcoholG: number;
  alcoholKcal: number;
  standardDrinks: StandardDrinks[];
  /**
   * The final ABV divides by a modelled volume, so it carries the marker.
   * Pure alcohol and the standard drinks do not: they are arithmetic over
   * stated bottle strengths and never touch the dilution figure.
   */
  abvEstimated: boolean;
}

export function computeAlcohol(input: AlcoholInput): AlcoholResult {
  const { alcoholMl, finalVolumeMl, volumeEstimated } = input;
  const pureAlcoholG = alcoholMl * ETHANOL_G_PER_ML;

  return {
    finalAbvPercent: finalVolumeMl > 0 ? (alcoholMl / finalVolumeMl) * 100 : 0,
    pureAlcoholG,
    alcoholKcal: pureAlcoholG * ETHANOL_KCAL_PER_G,
    standardDrinks: denominators.map((d) => ({
      id: d.id,
      label: d.label,
      drinks: pureAlcoholG / d.gramsPerDrink,
    })),
    abvEstimated: volumeEstimated,
  };
}

/** One decimal is the honest precision for a figure of this kind. */
export const formatAbvValue = (percent: number): string => percent.toFixed(1);

export const formatStandardDrinks = (drinks: number): string => drinks.toFixed(1);

/**
 * A drink is zero-proof below the threshold every authority uses for "alcohol
 * free", not at exactly zero — a dash of bitters in a 200 ml highball is real
 * alcohol and a rounding to zero would hide it.
 */
export const ZERO_PROOF_MAX_ABV = 0.5;
