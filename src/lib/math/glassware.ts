/**
 * Does the drink fit the glass.
 *
 * One implementation, called by the integrity check and by anything that wants
 * to show the reader the arithmetic. Written down once because the interesting
 * part is not the comparison, it is deciding what the ice displaces — and two
 * copies of that decision would eventually disagree about whether a drink fits.
 */

import type { DrinkVersion, Glassware } from './types.ts';

export interface GlassFit {
  /** Liquid in the glass, per drink. */
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

export function glassFit(
  version: DrinkVersion,
  finalVolumeMl: number,
  glass: Pick<Glassware, 'capacityMl' | 'iceDisplacementMl'>,
): GlassFit {
  const iceStyle = iceStyleOf(version);
  const declared = glass.iceDisplacementMl?.[iceStyle];
  const servedOverIce = version.servedOverIce === true || iceStyle !== 'none';

  return {
    liquidMl: finalVolumeMl,
    iceMl: declared ?? 0,
    iceStyle,
    neededMl: finalVolumeMl + (declared ?? 0),
    capacityMl: glass.capacityMl,
    fits: finalVolumeMl + (declared ?? 0) <= glass.capacityMl,
    unmodelledIce: servedOverIce && declared === undefined,
  };
}
