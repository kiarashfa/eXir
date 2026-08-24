/**
 * The balance bars: Strong, Sweet, Sour, Bitter.
 *
 * Three of the four are computed. Bitterness is not, because there is no
 * bitterness figure on any bottle and no measurable unit for it in the data, so
 * it is an authored editorial value. Every bar carries a `computed` flag and the
 * rendering must make that difference visible — a value that looks computed and
 * is not is the one thing this site cannot ship.
 *
 * Scales are fixed site-wide so two drinks can be compared. A bar is never
 * scaled to its own drink: a scale that moves per page makes everything look
 * balanced and tells the reader nothing.
 */

import scalesData from '../../data/balance-scales.json' with { type: 'json' };
import type { Bitterness } from './types.ts';

const SCALES = scalesData.scales;
const EMPTY_FILL = scalesData.emptyFillPercent;

export type BarKey = 'strong' | 'sweet' | 'sour' | 'bitter';

export interface Bar {
  key: BarKey;
  label: string;
  /** The underlying figure. Null for bitterness, which has no number. */
  value: number | null;
  /** What the reader sees beside the bar. */
  display: string;
  /** 0–100, clamped. */
  fillPercent: number;
  computed: boolean;
  /** True where the figure descends from the dilution model. */
  estimated: boolean;
}

export interface BalanceInput {
  finalAbvPercent: number;
  sugarGPerL: number;
  acidPercentFinal: number;
  bitterness: Bitterness;
  /** Set where the final volume — and so everything divided by it — is modelled. */
  volumeEstimated: boolean;
}

const clampFill = (ratio: number): number =>
  Math.max(EMPTY_FILL, Math.min(100, ratio * 100));

/** `sugarG / (finalVolumeMl / 1000)` — the comparable figure the bar reads. */
export const sugarPerLitre = (sugarG: number, finalVolumeMl: number): number =>
  finalVolumeMl > 0 ? sugarG / (finalVolumeMl / 1000) : 0;

/** `acidG / finalVolumeMl x 100` — titratable acidity of the finished drink. */
export const acidPercentOfFinal = (acidG: number, finalVolumeMl: number): number =>
  finalVolumeMl > 0 ? (acidG / finalVolumeMl) * 100 : 0;

export function computeBalance(input: BalanceInput): Bar[] {
  const { finalAbvPercent, sugarGPerL, acidPercentFinal, bitterness, volumeEstimated } = input;

  const bitterLevel = SCALES.bitter.levels[bitterness] ?? 0;

  return [
    {
      key: 'strong',
      label: SCALES.strong.label,
      value: finalAbvPercent,
      display: `${finalAbvPercent.toFixed(1)}${SCALES.strong.unit}`,
      fillPercent: clampFill(finalAbvPercent / SCALES.strong.max),
      computed: true,
      estimated: volumeEstimated,
    },
    {
      key: 'sweet',
      label: SCALES.sweet.label,
      value: sugarGPerL,
      display: `${Math.round(sugarGPerL)} ${SCALES.sweet.unit}`,
      fillPercent: clampFill(sugarGPerL / SCALES.sweet.max),
      computed: true,
      estimated: volumeEstimated,
    },
    {
      key: 'sour',
      label: SCALES.sour.label,
      value: acidPercentFinal,
      // Below a twentieth of a percent there is nothing sour in the glass, and
      // "0.0%" reads as a measurement where "none" reads as the fact it is.
      display: acidPercentFinal < 0.05 ? 'none' : `${acidPercentFinal.toFixed(2)}%`,
      fillPercent: clampFill(acidPercentFinal / SCALES.sour.max),
      computed: true,
      estimated: volumeEstimated,
    },
    {
      key: 'bitter',
      label: SCALES.bitter.label,
      value: null,
      display: bitterness,
      fillPercent: clampFill(bitterLevel),
      computed: false,
      estimated: false,
    },
  ];
}

/**
 * All four bars in the bottom or all four in the top quartile.
 *
 * Usually a missing sugar or acid figure on an ingredient rather than a
 * genuinely unbalanced drink, which is why it warns rather than fails.
 */
export function allBarsInOneQuartile(bars: Bar[]): 'bottom' | 'top' | null {
  if (bars.every((b) => b.fillPercent <= 25)) return 'bottom';
  if (bars.every((b) => b.fillPercent >= 75)) return 'top';
  return null;
}
