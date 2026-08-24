/**
 * Scaling and display of a single quantity.
 *
 * Two rules do most of the work here. Scaling is pure multiplication, because
 * the base unit is always ml or g and never a cup or a jigger. And US display
 * snaps to the fractions a bartender actually pours, which is a deliberate,
 * disclosed rounding — the one place the site rounds a figure it could state
 * exactly, because an unroundable measure is not pourable.
 */

import type { BaseUnit, CountUnit, UnitSystem } from './types.ts';
import {
  MIN_SNAPPABLE_FL_OZ,
  formatCount,
  formatEighths,
  formatMetric,
  gToOz,
  mlToFlOz,
  roundBase,
  snapToEighths,
} from './units.ts';

export interface FormattedQuantity {
  text: string;
  /** Descends from a modelled figure, so it carries the dotted underline. */
  estimated: boolean;
  /**
   * True when a US display was too small for an honest eighth and fell back to
   * the base unit. "0 oz" would be a lie; the base figure is the truth.
   */
  fellBackToBase: boolean;
}

export interface FormatOptions {
  estimated?: boolean;
  /**
   * Set when the amount sits in a bracket beside a count. There the bracket is
   * the exact base measure and never a converted one: a reader given "2 dashes
   * (0.06 fl oz)" has two approximations and no fact, where "2 dashes (1.8 ml)"
   * has the count to act on and the figure the site computed from.
   */
  counted?: boolean;
}

/** `displayed = base × (userDrinks / defaultDrinks)`. Nothing else scales it. */
export function scaleAmount(amount: number, drinks: number, defaultDrinks: number): number {
  if (!defaultDrinks) return amount;
  return amount * (drinks / defaultDrinks);
}

export function formatQuantity(
  amount: number,
  unit: BaseUnit,
  system: UnitSystem,
  options: FormatOptions = {},
): FormattedQuantity {
  const estimated = options.estimated ?? false;

  if (system === 'metric' || options.counted) {
    return { text: formatMetric(amount, unit), estimated, fellBackToBase: false };
  }

  const imperial = unit === 'ml' ? mlToFlOz(amount) : gToOz(amount);
  const label = unit === 'ml' ? 'fl oz' : 'oz';

  // Below half an eighth there is no fraction to snap to that is not zero.
  if (amount > 0 && imperial < MIN_SNAPPABLE_FL_OZ) {
    return { text: formatMetric(amount, unit), estimated, fellBackToBase: true };
  }

  return {
    text: `${formatEighths(snapToEighths(imperial))} ${label}`,
    estimated,
    fellBackToBase: false,
  };
}

export interface FormattedCount {
  count: string;
  /** Plural agrees with the rendered text, not the raw number. */
  label: string;
  /** The base measure, always, in ml or g. */
  measure: string;
}

/**
 * "2 dashes (1.8 ml)".
 *
 * The count is what the reader acts on; the measure is what the site computed
 * from. Both are shown, count first. The estimated marker is deliberately not
 * applied here: that marker means the true figure is not on this page, and here
 * it is, printed right beside the count.
 */
export function formatCountUnit(
  amount: number,
  unit: BaseUnit,
  countUnit: CountUnit,
): FormattedCount | null {
  const per = unit === 'ml' ? countUnit.ml : countUnit.g;
  if (per == null || per <= 0) return null;

  const rendered = formatCount(amount / per, countUnit.snap);
  // A bare fraction reads as singular — "½ lime", not "½ limes".
  const singular = rendered === '1' || !/^\d/.test(rendered);

  return {
    count: rendered,
    label: singular ? countUnit.singular : countUnit.plural,
    measure: formatMetric(amount, unit),
  };
}

/** A percentage as it appears beside an ingredient: "40% ABV". */
export const formatAbv = (abvPercent: number): string =>
  `${roundBase(abvPercent)}% ABV`;
