import { test } from 'node:test';
import assert from 'node:assert/strict';

import { colourDominance, whiteBalanceGains } from './image-treatment.ts';

test('a neutral scene reads as undominated', () => {
  assert.ok(colourDominance([128, 127, 129]) < 0.05);
});

test('a strongly coloured scene reads as dominated', () => {
  // A photograph that is mostly one drink.
  assert.ok(colourDominance([150, 70, 55]) > 0.5);
  assert.ok(colourDominance([40, 120, 55]) > 0.5);
});

test('white balance engages on a neutral scene', () => {
  const { applied } = whiteBalanceGains([128, 127, 129], 0.7);
  assert.ok(applied > 0.6, `expected most of the correction, got ${applied}`);
});

test('white balance corrects a mild cast in the right direction', () => {
  // Warm cast: too much red, too little blue. The fix pulls red down and blue up.
  const { gains } = whiteBalanceGains([140, 126, 112], 0.7);
  assert.ok(gains[0] < 1, 'red is pulled down');
  assert.ok(gains[2] > 1, 'blue is pushed up');
});

test('white balance backs almost all the way off on a colour-dominant image', () => {
  // This is the failure the damping exists to prevent: grey-world assumes the
  // average of a scene is neutral, which is false of a photograph that is
  // four-fifths Campari. Uncorrected, it reads the red as a cast, removes it,
  // and turns the background lilac.
  const red = whiteBalanceGains([150, 70, 55], 0.7);
  const green = whiteBalanceGains([40, 120, 55], 0.7);

  assert.ok(red.applied < 0.15, `expected the correction to back off, got ${red.applied}`);
  assert.ok(green.applied < 0.15, `expected the correction to back off, got ${green.applied}`);
});

test('the damping is monotonic in dominance', () => {
  // A slightly more colourful image is never corrected harder than a less
  // colourful one, or the treatment would be unpredictable across a set.
  const scenes: Array<[number, number, number]> = [
    [128, 127, 129],
    [140, 126, 112],
    [150, 100, 90],
    [150, 70, 55],
  ];
  const applied = scenes.map((s) => whiteBalanceGains(s, 0.7).applied);
  for (let i = 1; i < applied.length; i++) {
    assert.ok(applied[i]! <= applied[i - 1]!, `${applied[i]} should not exceed ${applied[i - 1]}`);
  }
});

test('gains are clamped, so no single image can be wrenched', () => {
  // An almost monochrome frame would otherwise ask for an enormous gain on the
  // missing channel and blow the other two out.
  const { gains } = whiteBalanceGains([200, 5, 5], 1);
  for (const g of gains) {
    assert.ok(g >= 0.75 && g <= 1.35, `${g} is outside the clamp`);
  }
});

test('a black frame does not divide by zero', () => {
  const { gains } = whiteBalanceGains([0, 0, 0], 0.7);
  assert.deepEqual(gains, [1, 1, 1]);
  assert.equal(colourDominance([0, 0, 0]), 0);
});
