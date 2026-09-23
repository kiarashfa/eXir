/**
 * Does the drink fit the glass.
 *
 * One implementation, called by the integrity check and by anything that wants
 * to show the reader the arithmetic. Written down once because the interesting
 * part is not the comparison, it is deciding what the ice displaces — and two
 * copies of that decision would eventually disagree about whether a drink fits.
 */

import type { DrinkVersion, Glassware } from './types.ts';
import type { DrinkSpec } from './spec.ts';

export interface GlassFit {
  /** Liquid in the glass, per drink, at the moment the fit is tightest. */
  liquidMl: number;
  /** What the ice takes up, and which style that figure is for. */
  iceMl: number;
  iceStyle: string;
  neededMl: number;
  capacityMl: number;
  fits: boolean;
  /** Set when the drink is served over ice the glass has no figure for. */
  unmodelledIce: boolean;
  /** The ice was topped into the room left, so `iceMl` is a minimum allowance. */
  iceTopped: boolean;
}

/**
 * The ice style a version is served with.
 *
 * A drink served over ice with nothing declared is treated as cubed, because
 * that is what "over ice" means without further instruction — and defaulting to
 * "no ice" would silently pass every fit check on a drink that is full of it.
 */
export const iceStyleOf = (version: DrinkVersion): string =>
  version.iceStyle ?? (version.servedOverIce ? 'cubed' : 'none');

/**
 * Which liquid volume the glass actually has to hold.
 *
 * Not always the final volume, and the difference is the whole of this
 * function. Where the dilution RISES OVER TIME — built over ice, churned over
 * crushed — the water in the final volume came out of the very ice the glass is
 * also being asked to hold, and counting both charges the glass twice for the
 * same millilitres. Every one that melts leaves the ice as it joins the drink,
 * so `poured + full ice` is invariant from the moment of building and is the
 * real occupancy.
 *
 * Where the dilution does NOT rise over time it arrived from a shaker or a
 * mixing glass and is already in the liquid before it is poured, so the glass
 * holds the whole final volume plus whatever ice is added under it.
 *
 * Getting this wrong is not academic: it charged a Spanish gin and tonic for
 * 65 ml of melt AND for the ice that melt came from, and the whole highball
 * family was authored a third short to get under the ceiling that produced.
 */
//
// "Poured" here is the final volume less its melt rather than the composition's
// poured volume, because the two differ on a brewed drink: its dose and brew
// water are in the composition, and only the yield reaches the glass.
const liquidToHold = (spec: Pick<DrinkSpec, 'finalVolumeMl' | 'dilution' | 'composition'>): number =>
  spec.dilution.risesOverTime ? spec.finalVolumeMl - spec.dilution.dilutionMl : spec.finalVolumeMl;

/**
 * The least ice a glass must still have room for when the ice goes in after
 * the liquid. A stated editorial allowance, on the same footing as the ice
 * allowance elsewhere: a tiki drink strained into its mug and then "filled
 * with crushed ice" gets whatever the pour left, and a fifth of the vessel is
 * the least that still reads as a drink served over ice rather than a drink
 * with an ice cube in it. Never more than a full glass of that ice would take.
 */
export const ICE_TOPPED_MIN_SHARE = 0.2;

export function glassFit(
  version: DrinkVersion,
  spec: Pick<DrinkSpec, 'finalVolumeMl' | 'dilution' | 'composition'>,
  glass: Pick<Glassware, 'capacityMl' | 'iceDisplacementMl'>,
): GlassFit {
  const iceStyle = iceStyleOf(version);
  const declared = glass.iceDisplacementMl?.[iceStyle];
  const servedOverIce = version.servedOverIce === true || iceStyle !== 'none';
  const liquidMl = liquidToHold(spec);
  const iceTopped = version.iceTopped === true && declared !== undefined && declared > 0;
  const iceMl = iceTopped
    ? Math.min(declared, Math.round(glass.capacityMl * ICE_TOPPED_MIN_SHARE))
    : (declared ?? 0);

  return {
    liquidMl,
    iceMl,
    iceStyle,
    neededMl: liquidMl + iceMl,
    capacityMl: glass.capacityMl,
    fits: liquidMl + iceMl <= glass.capacityMl,
    unmodelledIce: servedOverIce && declared === undefined,
    iceTopped,
  };
}
