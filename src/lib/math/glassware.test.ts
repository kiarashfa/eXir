import { test } from 'node:test';
import assert from 'node:assert/strict';

import { glassFit, ICE_TOPPED_MIN_SHARE } from './glassware.ts';
import type { DrinkVersion } from './types.ts';

const version = (extra: Partial<DrinkVersion>): DrinkVersion => ({
  id: 'classic',
  label: 'Classic',
  defaultDrinks: 1,
  method: 'shaken',
  dilutionClass: 'shaken',
  bitterness: 'none',
  batchable: 'none',
  lines: [],
  steps: [],
  iceStyle: 'crushed',
  servedOverIce: true,
  ...extra,
});

const spec = {
  finalVolumeMl: 330,
  dilution: { risesOverTime: false, dilutionMl: 110 },
  composition: { pouredVolumeMl: 220 },
} as Parameters<typeof glassFit>[1];

const mug = { capacityMl: 470, iceDisplacementMl: { crushed: 290, none: 0 } };

test('a glass packed with ice first is charged the full glass of it', () => {
  const fit = glassFit(version({}), spec, mug);
  assert.equal(fit.iceMl, 290);
  assert.equal(fit.fits, false);
  assert.equal(fit.iceTopped, false);
});

// "Strain into the glass and fill with crushed ice": the ice takes the room the
// liquid left, so the glass need only leave a minimum allowance for it.
test('ice topped in after the liquid is charged only the minimum allowance', () => {
  const fit = glassFit(version({ iceTopped: true }), spec, mug);
  assert.equal(fit.iceMl, Math.round(470 * ICE_TOPPED_MIN_SHARE));
  assert.equal(fit.fits, true);
  assert.equal(fit.iceTopped, true);
});

test('the allowance never exceeds what a full glass of that ice would take', () => {
  const fit = glassFit(version({ iceTopped: true }), spec, {
    capacityMl: 470,
    iceDisplacementMl: { crushed: 50, none: 0 },
  });
  assert.equal(fit.iceMl, 50);
});

test('a still drink flagged iceTopped is not handed any ice', () => {
  const fit = glassFit(version({ iceTopped: true, iceStyle: 'none', servedOverIce: false }), spec, mug);
  assert.equal(fit.iceMl, 0);
  assert.equal(fit.iceTopped, false);
});
