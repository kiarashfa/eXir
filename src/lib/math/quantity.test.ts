import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatAbv, formatCountUnit, formatQuantity, scaleAmount } from './quantity.ts';

test('scaling is pure multiplication against the authored default', () => {
  assert.equal(scaleAmount(30, 12, 1), 360);
  assert.equal(scaleAmount(30, 1, 1), 30);
  assert.equal(scaleAmount(200, 2, 4), 100);
});

test('metric display is exact; US display snaps to the jigger', () => {
  assert.equal(formatQuantity(30, 'ml', 'metric').text, '30 ml');
  assert.equal(formatQuantity(30, 'ml', 'us').text, '1 fl oz');
  assert.equal(formatQuantity(22.5, 'ml', 'us').text, '¾ fl oz');
  assert.equal(formatQuantity(45, 'ml', 'us').text, '1½ fl oz');
  assert.equal(formatQuantity(360, 'ml', 'us').text, '12⅛ fl oz');
});

test('a solid renders in ounces on the same fraction scale', () => {
  assert.equal(formatQuantity(250, 'g', 'metric').text, '250 g');
  assert.equal(formatQuantity(250, 'g', 'us').text, '8⅞ oz');
});

test('an amount too small for an honest eighth falls back to the base unit', () => {
  // 1.8 ml is 0.06 fl oz. Snapping would print "0 fl oz", which is a lie.
  const dash = formatQuantity(1.8, 'ml', 'us');
  assert.equal(dash.text, '1.8 ml');
  assert.equal(dash.fellBackToBase, true);

  // Just above the floor it snaps normally again.
  const spoon = formatQuantity(5, 'ml', 'us');
  assert.equal(spoon.text, '⅛ fl oz');
  assert.equal(spoon.fellBackToBase, false);
});

test('zero stays zero rather than falling back', () => {
  assert.equal(formatQuantity(0, 'ml', 'us').text, '0 fl oz');
  assert.equal(formatQuantity(0, 'ml', 'us').fellBackToBase, false);
});

test('the estimate flag rides through the formatter untouched', () => {
  assert.equal(formatQuantity(126, 'ml', 'metric', { estimated: true }).estimated, true);
  assert.equal(formatQuantity(126, 'ml', 'metric').estimated, false);
});

test('a bracket beside a count is the base measure in either unit system', () => {
  // Converting it would leave the reader two approximations and no fact.
  const metric = formatQuantity(1.8, 'ml', 'metric', { counted: true });
  const us = formatQuantity(1.8, 'ml', 'us', { counted: true });
  assert.equal(metric.text, '1.8 ml');
  assert.equal(us.text, '1.8 ml');
});

test('a count leads and the measure follows', () => {
  const dashes = formatCountUnit(1.8, 'ml', {
    singular: 'dash',
    plural: 'dashes',
    ml: 0.9,
    snap: 'whole',
  });
  assert.deepEqual(dashes, { count: '2', label: 'dashes', measure: '1.8 ml' });
});

test('a count scales because the measure behind it does', () => {
  const unit = { singular: 'dash', plural: 'dashes', ml: 0.9, snap: 'whole' as const };
  assert.equal(formatCountUnit(1.8 * 6, 'ml', unit)?.count, '12');
});

test('plural agrees with the rendered text, not the raw number', () => {
  const lime = { singular: 'lime', plural: 'limes', g: 67, snap: 'half' as const };

  // A bare fraction reads singular.
  assert.equal(formatCountUnit(33.5, 'g', lime)?.label, 'lime');
  assert.equal(formatCountUnit(33.5, 'g', lime)?.count, '½');

  assert.equal(formatCountUnit(67, 'g', lime)?.label, 'lime');
  assert.equal(formatCountUnit(100, 'g', lime)?.label, 'limes');
  assert.equal(formatCountUnit(100, 'g', lime)?.count, '1½');

  // 1.05 limes renders as "1", and "1 limes" would be wrong.
  assert.equal(formatCountUnit(70, 'g', lime)?.count, '1');
  assert.equal(formatCountUnit(70, 'g', lime)?.label, 'lime');
});

test('a countUnit whose base unit does not match the line is refused', () => {
  // A gram-based count on an ml line has no measure to scale from.
  const result = formatCountUnit(30, 'ml', {
    singular: 'lime',
    plural: 'limes',
    g: 67,
    snap: 'half',
  });
  assert.equal(result, null);
});

test('abv renders as a bottle states it', () => {
  assert.equal(formatAbv(40), '40% ABV');
  assert.equal(formatAbv(16.5), '17% ABV');
});
