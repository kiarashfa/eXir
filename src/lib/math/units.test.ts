import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ML_PER_FL_OZ,
  celsiusToFahrenheit,
  formatBulkWeight,
  formatCount,
  formatDuration,
  formatEighths,
  formatLength,
  formatMetric,
  formatRatio,
  formatTemperature,
  groupThousands,
  mlToFlOz,
  roundBase,
  snapToEighths,
} from './units.ts';

test('the bar-standard table from the spec', () => {
  // 30 ml is 1.0144 fl oz. A jigger has no decimals on it.
  const table: Array<[number, string]> = [
    [30, '1'],
    [22.5, '¾'],
    [45, '1½'],
    [60, '2'],
    [15, '½'],
    [7.5, '¼'],
    [3.75, '⅛'],
    [90, '3'],
  ];

  for (const [ml, expected] of table) {
    assert.equal(formatEighths(snapToEighths(mlToFlOz(ml))), expected, `${ml} ml`);
  }
});

test('eighths that are not simple halves still render as glyphs', () => {
  assert.equal(formatEighths(3), '⅜');
  assert.equal(formatEighths(5), '⅝');
  assert.equal(formatEighths(7), '⅞');
  assert.equal(formatEighths(11), '1⅜');
  assert.equal(formatEighths(0), '0');
});

test('one fluid ounce is the US customary 29.5735 ml, not 30', () => {
  assert.equal(ML_PER_FL_OZ, 29.5735295625);
  assert.ok(Math.abs(mlToFlOz(29.5735295625) - 1) < 1e-12);
});

test('metric drops decimals at ten and keeps them below it', () => {
  // Above ten, a decimal is false precision on a figure poured by eye.
  assert.equal(roundBase(29.6), 30);
  assert.equal(roundBase(125.7), 126);
  // Below it, the decimal is the information: a dash, a bar spoon.
  assert.equal(roundBase(1.8), 1.8);
  assert.equal(roundBase(0.94), 0.9);
  assert.equal(roundBase(9.96), 10);
});

test('thousands are grouped so a batch volume reads at a glance', () => {
  assert.equal(groupThousands(1508), '1 508');
  assert.equal(groupThousands(429), '429');
  assert.equal(groupThousands(12345), '12 345');
  assert.equal(groupThousands(1.8), '1.8');
});

test('metric formatting carries its unit', () => {
  assert.equal(formatMetric(125.7, 'ml'), '126 ml');
  assert.equal(formatMetric(1508, 'ml'), '1 508 ml');
  assert.equal(formatMetric(1.8, 'ml'), '1.8 ml');
  assert.equal(formatMetric(250, 'g'), '250 g');
});

test('duration display steps up through the three bands', () => {
  assert.equal(formatDuration(12), '12s');
  assert.equal(formatDuration(25), '25s');
  assert.equal(formatDuration(59), '59s');
  assert.equal(formatDuration(60), '1m');
  // Under five minutes the seconds are still a meaningful share of the total.
  assert.equal(formatDuration(90), '1m 30s');
  assert.equal(formatDuration(299), '4m 59s');
  assert.equal(formatDuration(300), '5m');
  assert.equal(formatDuration(330), '5m');
  assert.equal(formatDuration(3600), '1h');
  assert.equal(formatDuration(3660), '1h 1m');
  assert.equal(formatDuration(14400), '4h');
});

test('long rests cross into days, but only past two of them', () => {
  // A single-day process is still naturally counted in hours: "30h" beats
  // "1d 6h" for an overnight infusion.
  assert.equal(formatDuration(30 * 3600), '30h');
  assert.equal(formatDuration(47 * 3600), '47h');

  // Past that, days are the unit anyone plans a ferment around.
  assert.equal(formatDuration(48 * 3600), '2d');
  assert.equal(formatDuration(240 * 3600), '10d');
  assert.equal(formatDuration(241.9 * 3600), '10d 2h');
});

test('an hour rounding up to a full day rolls into the day', () => {
  // Otherwise a ten-day ferment plus 23.8 hours prints "10d 24h".
  assert.equal(formatDuration((10 * 24 + 23.8) * 3600), '11d');
});

test('an unround computed total is not tidied', () => {
  // A rounded total is a hand-typed number wearing a computed one's clothes.
  assert.equal(formatDuration(77), '1m 17s');
});

test('fahrenheit rounds coarse for a kettle and fine for a brew', () => {
  assert.equal(celsiusToFahrenheit(100), 212);
  assert.equal(formatTemperature(94, 'metric'), '94 °C');
  assert.equal(formatTemperature(94, 'us'), '201 °F');
  assert.equal(formatTemperature(94, 'us', 'coarse'), '200 °F');
  assert.equal(formatTemperature(-4, 'metric'), '-4 °C');
});

test('lengths render as inch fractions, never decimals', () => {
  assert.equal(formatLength(5, 'metric'), '5 cm');
  assert.equal(formatLength(5, 'us'), '2 in');
  assert.equal(formatLength(1.3, 'us'), '½ in');
  // Too small for an honest inch fraction: fall back rather than print "0 in".
  assert.equal(formatLength(0.1, 'us'), '0.1 cm');
});

test('counts snap by their declared rule', () => {
  // A half lime is a real thing; half a dash is not.
  assert.equal(formatCount(1.5, 'half'), '1½');
  assert.equal(formatCount(0.5, 'half'), '½');
  assert.equal(formatCount(1.2, 'half'), '1');
  assert.equal(formatCount(1.3, 'half'), '1½');
  assert.equal(formatCount(2, 'whole'), '2');
  assert.equal(formatCount(2.4, 'whole'), '2');
  assert.equal(formatCount(2.6, 'whole'), '3');
});

test('a count never rounds down to nothing', () => {
  // The line exists, so the ingredient is used. Zero would be a lie.
  assert.equal(formatCount(0.2, 'half'), '½');
  assert.equal(formatCount(0.2, 'whole'), '1');
});

test('ratios are unitless and use the field convention', () => {
  assert.equal(formatRatio(360 / 22), '1 : 16.4');
  assert.equal(formatRatio(16), '1 : 16');
});

test('a bulk weight uses the unit the shop sells it in', () => {
  // Not the eighths of an ounce a jigger has, and not four thousand grams.
  assert.equal(formatBulkWeight(4200, 'metric'), '4.2 kg');
  assert.equal(formatBulkWeight(840, 'metric'), '840 g');
  assert.equal(formatBulkWeight(12000, 'metric'), '12 kg');
  assert.equal(formatBulkWeight(4200, 'us'), '9.3 lb');
  assert.equal(formatBulkWeight(200, 'us'), '7.1 oz');
});
