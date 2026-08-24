/**
 * Unit conversion and display formatting.
 *
 * ml and g are the source of truth everywhere. Everything here is a derived
 * display layer over them, which is why nothing in this file is ever authored
 * into content.
 */

import type { UnitSystem } from './types.ts';

export const ML_PER_FL_OZ = 29.5735295625;
export const G_PER_OZ = 28.349523125;
export const CM_PER_INCH = 2.54;

/** Density of ethanol at 20 °C, g/ml. */
export const ETHANOL_G_PER_ML = 0.789;

export const mlToFlOz = (ml: number): number => ml / ML_PER_FL_OZ;
export const flOzToMl = (flOz: number): number => flOz * ML_PER_FL_OZ;
export const gToOz = (g: number): number => g / G_PER_OZ;
export const ozToG = (oz: number): number => oz * G_PER_OZ;
export const celsiusToFahrenheit = (c: number): number => (c * 9) / 5 + 32;
export const fahrenheitToCelsius = (f: number): number => ((f - 32) * 5) / 9;
export const cmToInches = (cm: number): number => cm / CM_PER_INCH;
export const inchesToCm = (inches: number): number => inches * CM_PER_INCH;

// ---------------------------------------------------------------------------
// Bar-standard fractions
// ---------------------------------------------------------------------------

const EIGHTH_GLYPHS: Record<number, string> = {
  1: '⅛', // ⅛
  2: '¼', // ¼
  3: '⅜', // ⅜
  4: '½', // ½
  5: '⅝', // ⅝
  6: '¾', // ¾
  7: '⅞', // ⅞
};

/**
 * The smallest amount the eighth-ounce scale can express without rounding to
 * nothing. Below half an eighth there is no honest US fraction to print, so the
 * formatter falls back to the base unit rather than showing "0 oz".
 */
export const MIN_SNAPPABLE_FL_OZ = 1 / 16;

/** Round to the nearest eighth and return the count of eighths. */
export const snapToEighths = (value: number): number => Math.round(value * 8);

/**
 * Render a count of eighths as a bar measure: 12 → "1½", 6 → "¾", 16 → "2".
 *
 * A jigger has no decimals on it, so neither does this.
 */
export function formatEighths(eighths: number): string {
  const negative = eighths < 0;
  const abs = Math.abs(eighths);
  const whole = Math.floor(abs / 8);
  const remainder = abs % 8;
  const glyph = EIGHTH_GLYPHS[remainder] ?? '';

  let text: string;
  if (remainder === 0) text = String(whole);
  else if (whole === 0) text = glyph;
  else text = `${whole}${glyph}`;

  return negative ? `-${text}` : text;
}

/**
 * Counts snap to the nearest half where a half is meaningful and to the nearest
 * whole where it is not. Rendered with the same fraction glyphs, because "1.5
 * limes" is not how anyone writes it down.
 */
export function formatCount(value: number, snap: 'half' | 'whole' = 'half'): string {
  if (snap === 'whole') return String(Math.max(1, Math.round(value)));
  const halves = Math.round(value * 2);
  if (halves === 0) return formatEighths(4); // never claim zero of something used
  return formatEighths(halves * 4);
}

// ---------------------------------------------------------------------------
// Metric formatting
// ---------------------------------------------------------------------------

/**
 * Below 10 a decimal is real information — a bar spoon, a dash, a few grams of
 * sugar. Above it a decimal is false precision on a figure that gets poured by
 * eye, so it is dropped.
 */
export function roundBase(value: number): number {
  return value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
}

/**
 * Thousands separated by an ordinary space, so a batch volume reads at a glance.
 *
 * A thin or narrow-no-break space would set better, but these figures are also
 * copied verbatim into the plain-text shopping list, which gets pasted into
 * message clients and read back by tools. One separator that survives that trip
 * is worth more than one that sets marginally better.
 */
export function groupThousands(value: number): string {
  const [whole = '', fraction] = String(value).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

export const formatMetric = (value: number, unit: 'ml' | 'g'): string =>
  `${groupThousands(roundBase(value))} ${unit}`;

// ---------------------------------------------------------------------------
// Temperature, length, duration
// ---------------------------------------------------------------------------

/**
 * `coarse` for a kettle or an oven, where 5 °F either way is nothing.
 * `fine` for brewing, where 2 °C is the difference between two cups of tea.
 * Brewing is the common case here, so fine is the default.
 */
export function formatTemperature(
  celsius: number,
  system: UnitSystem,
  precision: 'coarse' | 'fine' = 'fine',
): string {
  if (system === 'metric') return `${Math.round(celsius)} °C`;
  const f = celsiusToFahrenheit(celsius);
  const rounded = precision === 'coarse' ? Math.round(f / 5) * 5 : Math.round(f);
  return `${rounded} °F`;
}

/** Inches as readable fractions, never decimals. */
export function formatLength(cm: number, system: UnitSystem): string {
  if (system === 'metric') return `${roundBase(cm)} cm`;
  const eighths = snapToEighths(cmToInches(cm));
  if (eighths === 0) return `${roundBase(cm)} cm`;
  return `${formatEighths(eighths)} in`;
}

/**
 * Seconds up, never down. A shake is 12 seconds and a stir is 25, and rounding
 * those to minutes destroys the information the figure exists to carry.
 */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  if (sec < 60) return `${sec}s`;

  if (sec < 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    // Seconds stay visible only while they are still a meaningful share of it.
    return s > 0 && sec < 300 ? `${m}m ${s}s` : `${m}m`;
  }

  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Ratios are unitless and never converted. `1 : 16.4`, the field's convention. */
export function formatRatio(parts: number): string {
  const rounded = parts >= 100 ? Math.round(parts) : Math.round(parts * 10) / 10;
  return `1 : ${rounded}`;
}

export type { UnitSystem };
