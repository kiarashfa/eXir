import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBrew, scaleBrewByDose, scaleBrewByYield } from './brewing.ts';
import { deriveServingTemp } from './facets.ts';
import type { Brew } from './types.ts';

const close = (a: number, b: number, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) < tol, `${a} !== ${b} within ${tol}`);

const pourOver: Brew = {
  method: 'pour-over',
  doseRef: 'dose',
  waterRef: 'water',
  doseG: 22,
  waterMl: 360,
  waterTempC: 94,
  grind: 'medium-fine',
  contactSec: 180,
  yieldMl: 320,
};

test('the ratio is water per gram, rendered the way the field writes it', () => {
  const b = computeBrew(pourOver);

  close(b.ratio, 360 / 22);
  assert.equal(b.ratioDisplay, '1 : 16.4');
});

test('retention is what the bed holds back', () => {
  assert.equal(computeBrew(pourOver).retentionMl, 40);
});

test('a brew is compared against the published standard, not replaced by it', () => {
  const b = computeBrew(pourOver);

  assert.equal(b.standard?.label, 'SCA Golden Cup');
  assert.equal(b.standard?.ratioDisplay, '1 : 18.2');
  assert.equal(b.standard?.waterTempWithinTolerance, true);
  assert.ok(b.standard?.source.publisher);

  // 22 g into 360 ml is 61.1 g/L against a 49.5–60.5 band: marginally strong,
  // which is true of a great many published pour-over recipes.
  close(b.standard?.gPerLitre ?? 0, 61.111, 1e-3);
  assert.equal(b.standard?.withinTolerance, false);
  assert.equal(b.standard?.direction, 'strong');
});

test('the tolerance is applied in g/L, not on the ratio', () => {
  // A ratio is the reciprocal of a strength, so a symmetric band on one is an
  // asymmetric band on the other. 55 g/L ±10% is 49.5–60.5 g/L, which is
  // 16.5:1 to 20.2:1 — not 18.2 ±1.8. A brew at 16.4:1 is OUTSIDE the standard
  // even though 16.4 sits inside a naive ±10% band on the ratio.
  const edge = computeBrew({ ...pourOver, doseG: 22, waterMl: 360.8 });
  close(edge.ratio, 16.4, 0.01);
  assert.equal(edge.standard?.withinTolerance, false);
  assert.equal(edge.standard?.direction, 'strong');

  // Squarely inside: 55 g/L exactly.
  const golden = computeBrew({ ...pourOver, doseG: 22, waterMl: 400 });
  assert.equal(golden.standard?.withinTolerance, true);
  assert.equal(golden.standard?.direction, 'within');
});

test('a brew far off the standard says which way it misses', () => {
  const strong = computeBrew({ ...pourOver, doseG: 36 });
  assert.equal(strong.standard?.withinTolerance, false);
  assert.equal(strong.standard?.direction, 'strong');

  const weak = computeBrew({ ...pourOver, doseG: 12 });
  assert.equal(weak.standard?.withinTolerance, false);
  assert.equal(weak.standard?.direction, 'weak');
});

test('water off the standard temperature is reported separately from the strength', () => {
  const cool = computeBrew({ ...pourOver, waterTempC: 82 });

  assert.equal(cool.standard?.waterTempWithinTolerance, false);
  // The strength verdict is unchanged by the temperature.
  assert.equal(cool.standard?.withinTolerance, computeBrew(pourOver).standard?.withinTolerance);
});

test('extraction yield is withheld unless somebody measured it', () => {
  // Nothing on a bag of coffee supplies total dissolved solids, and estimating
  // it from the method would be inventing the one figure the calculation
  // exists to establish.
  assert.equal(computeBrew(pourOver).extractionYieldPercent, null);

  const measured = computeBrew({ ...pourOver, measuredTdsPercent: 1.35 });
  // 1.35% of 320 ml over 22 g.
  close(measured.extractionYieldPercent ?? 0, (1.35 * 320) / 22, 1e-6);
});

test('a brewed drink scales by ratio, and only dose and water follow', () => {
  const doubled = scaleBrewByDose(pourOver, 44);

  close(doubled.waterMl, 720);
  close(doubled.yieldMl, 640);
  // Water temperature, grind and contact time do not scale with yield.
  assert.equal(doubled.waterTempC, 94);
  assert.equal(doubled.grind, 'medium-fine');
  assert.equal(doubled.contactSec, 180);
  close(computeBrew(doubled).ratio, computeBrew(pourOver).ratio, 1e-9);
});

test('the same rescale works driven from the cup instead of the scale', () => {
  const fromCup = scaleBrewByYield(pourOver, 160);

  close(fromCup.doseG, 11);
  close(fromCup.waterMl, 180);
  close(computeBrew(fromCup).ratio, computeBrew(pourOver).ratio, 1e-9);
});

test('multiple infusions total their contact time', () => {
  const gongfu = computeBrew({
    method: 'gongfu',
    doseRef: 'dose',
    waterRef: 'water',
    doseG: 5,
    waterMl: 100,
    waterTempC: 95,
    yieldMl: 90,
    infusions: [
      { n: 1, contactSec: 20 },
      { n: 2, contactSec: 25 },
      { n: 3, contactSec: 35 },
    ],
  });

  assert.equal(gongfu.contactSec, 80);
  assert.equal(gongfu.infusions.length, 3);
  // Gongfu has no published ratio standard on file, and inventing one would be
  // worse than showing the drink's own figure alone.
  assert.equal(gongfu.standard, null);
});

test('a hot brew derives a hot serving temperature', () => {
  assert.equal(
    deriveServingTemp({ dilutionClass: 'none', brewWaterTempC: 94 }),
    'hot',
  );
});

test('the same leaf served over ice derives as iced', () => {
  assert.equal(
    deriveServingTemp({ dilutionClass: 'built-over-ice', brewWaterTempC: 94, servedOverIce: true }),
    'iced',
  );
});
