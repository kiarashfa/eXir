import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  asFractionOfFinal,
  computeDilution,
  dilutionClass,
  dilutionClassIds,
  stirredDilutionFraction,
} from './dilution.ts';

const close = (a: number, b: number, tol = 1e-9) =>
  assert.ok(Math.abs(a - b) < tol, `${a} !== ${b} within ${tol}`);

test('the stirred formula against hand-worked values', () => {
  // d = -1.21a² + 1.26a + 0.145
  // a = 0.27:  -1.21(0.0729) + 1.26(0.27) + 0.145
  //          = -0.088209 + 0.3402 + 0.145 = 0.396991
  close(stirredDilutionFraction(0.27), 0.396991, 1e-6);

  // a = 0: the constant term alone.
  close(stirredDilutionFraction(0), 0.145);

  // a = 0.4: -1.21(0.16) + 1.26(0.4) + 0.145 = -0.1936 + 0.504 + 0.145 = 0.4554
  close(stirredDilutionFraction(0.4), 0.4554, 1e-9);
});

test('an equal-parts stirred build reproduces the reference figures', () => {
  // 30 ml each of a 40%, a 25% and a 16% bottle.
  // alcohol = 12 + 7.5 + 4.8 = 24.3 ml over 90 ml poured = 27.0% ABV.
  const result = computeDilution({
    pouredVolumeMl: 90,
    pouredAbvPercent: 27,
    classId: 'stirred',
  });

  close(result.fraction, 0.396991, 1e-6);
  close(result.dilutionMl, 35.729, 1e-3);
  close(result.finalVolumeMl, 125.729, 1e-3);
  assert.equal(result.estimated, true);
});

test('authored water is added on top of the modelled dilution', () => {
  const withWater = computeDilution({
    pouredVolumeMl: 90,
    pouredAbvPercent: 27,
    classId: 'stirred',
    authoredWaterMl: 20,
  });
  const without = computeDilution({
    pouredVolumeMl: 90,
    pouredAbvPercent: 27,
    classId: 'stirred',
  });

  close(withWater.finalVolumeMl - without.finalVolumeMl, 20, 1e-9);
  // Authored water does not change the modelled fraction — it is not ice.
  close(withWater.fraction, without.fraction, 1e-12);
});

test('a fixed class ignores the starting strength', () => {
  const weak = computeDilution({ pouredVolumeMl: 100, pouredAbvPercent: 5, classId: 'shaken' });
  const strong = computeDilution({ pouredVolumeMl: 100, pouredAbvPercent: 40, classId: 'shaken' });

  close(weak.fraction, strong.fraction);
  close(weak.dilutionMl, 50);
});

test('shaking takes on more water than stirring at the same strength', () => {
  const stirred = computeDilution({ pouredVolumeMl: 100, pouredAbvPercent: 27, classId: 'stirred' });
  const shaken = computeDilution({ pouredVolumeMl: 100, pouredAbvPercent: 27, classId: 'shaken' });
  const shakenLong = computeDilution({
    pouredVolumeMl: 100,
    pouredAbvPercent: 27,
    classId: 'shaken-long',
  });

  assert.ok(shaken.fraction > stirred.fraction);
  assert.ok(shakenLong.fraction > shaken.fraction);
});

test('a drink that never meets ice gains no water and is not an estimate', () => {
  const none = computeDilution({ pouredVolumeMl: 200, pouredAbvPercent: 0, classId: 'none' });

  close(none.fraction, 0);
  close(none.finalVolumeMl, 200);
  assert.equal(none.estimated, false);
});

test('blended drinks carry their ice as an ingredient, not as a fraction', () => {
  const blended = computeDilution({
    pouredVolumeMl: 300,
    pouredAbvPercent: 12,
    classId: 'blended-with-ice',
  });

  close(blended.fraction, 0);
  // Measured rather than modelled, so no estimate marker.
  assert.equal(blended.estimated, false);
});

test('a built drink is flagged as still diluting in the hand', () => {
  const built = computeDilution({
    pouredVolumeMl: 150,
    pouredAbvPercent: 12,
    classId: 'built-over-ice',
  });
  assert.equal(built.risesOverTime, true);
});

test('an unresolvable class reports itself rather than throwing', () => {
  // The build fails on this, but the report should be able to name every bad
  // reference in one pass rather than stopping at the first.
  const bad = computeDilution({ pouredVolumeMl: 90, pouredAbvPercent: 27, classId: 'swizzled' });

  assert.equal(bad.unresolved, true);
  assert.equal(bad.finalVolumeMl, 90);
});

test('every class carries a source', () => {
  // The integrity checks enforce this; asserting it here catches it at the
  // moment the data file is edited rather than at the end of a build.
  for (const id of dilutionClassIds()) {
    const cls = dilutionClass(id);
    assert.ok(cls, `${id} resolves`);
    assert.ok(cls.source?.title, `${id} has a source title`);
  }
});

test('the two denominators convert into one another', () => {
  // 0.397 of the pour is 0.284 of the glass — which is the figure other sources
  // report as "about a quarter" for a stirred drink.
  close(asFractionOfFinal(0.396991), 0.284169, 1e-5);
});
