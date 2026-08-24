/**
 * The live values — quantities, temperatures, dimensions, durations, strengths.
 *
 * These render server-side as ordinary spans carrying their own data in
 * attributes. A drink page has thirty to fifty of them and three pieces of state
 * behind them all, so making each one an interactive island would ship a great
 * deal of JavaScript to re-render a few words. One small shared script updates
 * every span instead.
 *
 * Both the server render and that script call the functions below, so the value
 * after a change comes from the same code as the value before it.
 */

import { formatCountUnit, formatQuantity, scaleAmount } from '../math/quantity.ts';
import type { BaseUnit, CountUnit, UnitSystem } from '../math/types.ts';
import { formatAbv } from '../math/quantity.ts';
import { formatDuration, formatLength, formatTemperature } from '../math/units.ts';

export interface QtyData {
  /** Base amount at the authored drink count, after any transclusion merge. */
  amount: number;
  unit: BaseUnit;
  defaultDrinks: number;
  /** Shown alongside the amount; the two read as one phrase. */
  name: string;
  /** Partial use of a line where a portion would be overkill. */
  fraction?: number | undefined;
  countUnit?: CountUnit | undefined;
  /** Descends from a modelled figure. */
  estimated?: boolean | undefined;
}

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/**
 * An estimate is marked the same way everywhere: a tilde and a dotted
 * underline. That pairing means "estimated" and means nothing else on the site.
 */
const amountSpan = (text: string, estimated: boolean): string =>
  `<span class="n${estimated ? ' is-estimated' : ''}">${estimated ? '~' : ''}${escapeHtml(text)}</span>`;

export function scaledAmount(data: QtyData, drinks: number): number {
  return scaleAmount(data.amount, drinks, data.defaultDrinks) * (data.fraction ?? 1);
}

export function qtyHtml(
  data: QtyData,
  drinks: number,
  system: UnitSystem,
  options: { showName?: boolean } = {},
): string {
  const showName = options.showName ?? true;
  const amount = scaledAmount(data, drinks);
  const estimated = data.estimated ?? false;

  const attrs = [
    'class="q"',
    'data-qty',
    `data-amount="${data.amount}"`,
    `data-unit="${data.unit}"`,
    `data-default-drinks="${data.defaultDrinks}"`,
  ];
  if (data.fraction != null) attrs.push(`data-fraction="${data.fraction}"`);
  if (estimated) attrs.push('data-estimated');

  const per = data.countUnit
    ? data.unit === 'ml'
      ? data.countUnit.ml
      : data.countUnit.g
    : undefined;

  if (data.countUnit && per != null && per > 0) {
    attrs.push(`data-count-per="${per}"`);
    attrs.push(`data-count-snap="${data.countUnit.snap}"`);
    attrs.push(`data-count-singular="${escapeHtml(data.countUnit.singular)}"`);
    attrs.push(`data-count-plural="${escapeHtml(data.countUnit.plural)}"`);

    const counted = formatCountUnit(amount, data.unit, data.countUnit);
    if (counted) {
      // The count is the instruction and the measure is the authority. Both are
      // shown, count first, and the measure stays in the base unit in either
      // system — a converted bracket beside a count leaves the reader two
      // approximations and no fact.
      return (
        `<span ${attrs.join(' ')}>` +
        `<span class="q-count">${escapeHtml(counted.count)}</span> ` +
        `<span class="q-name">${escapeHtml(counted.label)}</span> ` +
        `<span class="q-measure">(${amountSpan(counted.measure, estimated)})</span>` +
        `</span>`
      );
    }
  }

  const { text } = formatQuantity(amount, data.unit, system, { estimated });
  const name = showName ? ` <span class="q-name">${escapeHtml(data.name)}</span>` : '';
  return `<span ${attrs.join(' ')}>${amountSpan(text, estimated)}${name}</span>`;
}

export function tempHtml(
  celsius: number,
  system: UnitSystem,
  precision: 'coarse' | 'fine' = 'fine',
): string {
  return (
    `<span class="value value-temp" data-temp-c="${celsius}" data-temp-precision="${precision}">` +
    `${escapeHtml(formatTemperature(celsius, system, precision))}</span>`
  );
}

export function lenHtml(cm: number, system: UnitSystem): string {
  return (
    `<span class="value value-len" data-len-cm="${cm}">` +
    `${escapeHtml(formatLength(cm, system))}</span>`
  );
}

/**
 * A duration reads its own step's declared time, so the sentence and the timing
 * card cannot disagree.
 *
 * It never scales with the drink count, and that is not an oversight. "Stir for
 * 25 seconds" is a per-drink instruction: twelve drinks made to order is twelve
 * separate 25-second stirs, and stirring one drink for five minutes ruins it.
 * The timing card multiplies because it counts the stirs; the sentence does not
 * because it describes one of them. Nothing updates this after render.
 */
export function durHtml(durationSec: number, stepId: string): string {
  return (
    `<span class="value value-dur" data-dur-sec="${durationSec}" data-dur-step="${escapeHtml(stepId)}">` +
    `${escapeHtml(formatDuration(durationSec))}</span>`
  );
}

/**
 * A bottle strength, read from the Form rather than typed into the sentence.
 * Ref-only for the same reason a quantity is: the figure already exists in
 * structured data, and typing it again creates a second copy that can drift.
 */
export function abvHtml(abvPercent: number, ref: string): string {
  return (
    `<span class="value value-abv" data-abv="${abvPercent}" data-abv-ref="${escapeHtml(ref)}">` +
    `${escapeHtml(formatAbv(abvPercent))}</span>`
  );
}
