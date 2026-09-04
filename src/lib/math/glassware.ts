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
const liquidToHold = (spec: Pick<DrinkSpec, 'finalVolumeMl' | 'dilution' | 'composition'>): number =>
  spec.dilution.risesOverTime ? spec.composition.pouredVolumeMl : spec.finalVolumeMl;

export function glassFit(
  version: DrinkVersion,
  spec: Pick<DrinkSpec, 'finalVolumeMl' | 'dilution' | 'composition'>,
  glass: Pick<Glassware, 'capacityMl' | 'iceDisplacementMl'>,
): GlassFit {
  const iceStyle = iceStyleOf(version);
  const declared = glass.iceDisplacementMl?.[iceStyle];
  const servedOverIce = version.servedOverIce === true || iceStyle !== 'none';
  const liquidMl = liquidToHold(spec);

  return {
    liquidMl,
    iceMl: declared ?? 0,
    iceStyle,
    neededMl: liquidMl + (declared ?? 0),
    capacityMl: glass.capacityMl,
    fits: liquidMl + (declared ?? 0) <= glass.capacityMl,
    unmodelledIce: servedOverIce && declared === undefined,
  };
}
