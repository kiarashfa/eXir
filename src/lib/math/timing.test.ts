import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeScaledTiming, computeTiming, scaleSteps, timingPhases } from './timing.ts';
import type { Step } from './types.ts';

const step = (
  id: string,
  durationSec: number,
  type: Step['type'],
  phase: Step['phase'],
): Step => ({ id, durationSec, type, phase, prose: '' });

const stirred: Step[] = [
  step('chill-glass', 30, 'active', 'prep'),
  step('combine', 20, 'active', 'make'),
  step('stir', 25, 'active', 'make'),
];

test('active time lands in the phase its step declares', () => {
  const t = computeTiming(stirred);

  assert.equal(t.prepSec, 30);
  assert.equal(t.makeSec, 45);
  assert.equal(t.restSec, 0);
  assert.equal(t.totalSec, 75);
});

test('passive time lands in rest regardless of the declared phase', () => {
  // Chilling is rest by definition, whatever the step says about itself.
  const t = computeTiming([...stirred, step('chill-batch', 14400, 'passive', 'make')]);

  assert.equal(t.makeSec, 45);
  assert.equal(t.restSec, 14400);
  assert.equal(t.totalSec, 14475);
});

test('a parallel step contributes only what it overruns its anchor by', () => {
  // Rinsing a glass while the drink stirs costs nothing.
  const free = computeTiming([...stirred, step('rinse', 15, 'parallel-with:stir', 'make')]);
  assert.equal(free.totalSec, 75);

  // Steeping for longer than the stir costs the difference, and only that.
  const overrun = computeTiming([...stirred, step('steep', 40, 'parallel-with:stir', 'make')]);
  assert.equal(overrun.totalSec, 90);
  assert.equal(overrun.makeSec, 60);
});

test('a parallel pair totals the longer of the two, stated as arithmetic', () => {
  const pair: Step[] = [
    step('a', 60, 'active', 'make'),
    step('b', 90, 'parallel-with:a', 'make'),
  ];
  assert.equal(computeTiming(pair).totalSec, 90);

  const other: Step[] = [
    step('a', 90, 'active', 'make'),
    step('b', 60, 'parallel-with:a', 'make'),
  ];
  assert.equal(computeTiming(other).totalSec, 90);
});

test('a parallel step spanning phases still totals to the longer of the pair', () => {
  const spanning: Step[] = [
    step('stir', 25, 'active', 'make'),
    step('cut-peel', 40, 'parallel-with:stir', 'prep'),
  ];
  const t = computeTiming(spanning);

  assert.equal(t.makeSec, 25);
  assert.equal(t.prepSec, 15);
  assert.equal(t.totalSec, 40);
});

test('an unresolved parallel anchor is reported and counted in full', () => {
  // Silently shortening the total would hide the broken reference behind a
  // plausible-looking number.
  const t = computeTiming([step('a', 30, 'parallel-with:nope', 'make')]);

  assert.equal(t.totalSec, 30);
  assert.equal(t.issues[0]?.kind, 'unresolved-parallel');
});

test('a step parallel with itself is caught', () => {
  const t = computeTiming([step('a', 30, 'parallel-with:a', 'make')]);
  assert.equal(t.issues[0]?.kind, 'self-parallel');
});

test('a parallel chain is flagged as a modelling error', () => {
  const t = computeTiming([
    step('a', 60, 'active', 'make'),
    step('b', 30, 'parallel-with:a', 'make'),
    step('c', 20, 'parallel-with:b', 'make'),
  ]);
  assert.ok(t.issues.some((i) => i.kind === 'chained-parallel'));
});

test('made to order: twelve drinks is twelve stirs', () => {
  const t = computeScaledTiming(stirred, 12, 'order');

  assert.equal(t.prepSec, 360);
  assert.equal(t.makeSec, 540);
  assert.equal(t.totalSec, 900);
});

test('batched: nothing scales at all', () => {
  // One combine, one dilution, one chill. This is the single most useful thing
  // the site can tell a host, and it is the one place the two modes differ.
  const t = computeScaledTiming(stirred, 12, 'batch');
  assert.equal(t.totalSec, 75);
});

test('passive time never scales in either mode', () => {
  const withChill = [...stirred, step('chill', 14400, 'passive', 'rest')];

  assert.equal(computeScaledTiming(withChill, 12, 'order').restSec, 14400);
  assert.equal(computeScaledTiming(withChill, 12, 'batch').restSec, 14400);
});

test('scaling leaves the step objects it does not touch identical', () => {
  const scaled = scaleSteps([...stirred, step('rest', 60, 'passive', 'rest')], 4, 'order');

  assert.equal(scaled.find((s) => s.id === 'rest')?.durationSec, 60);
  assert.equal(scaled.find((s) => s.id === 'stir')?.durationSec, 100);
});

test('a zero phase is omitted rather than printed as nothing', () => {
  // A drink whose prep happens inside another step genuinely has no prep, and
  // printing "0s" invites the reader to wonder what is missing.
  const phases = timingPhases(computeTiming([step('combine', 20, 'active', 'make')]));

  assert.deepEqual(
    phases.map((p) => p.key),
    ['make', 'total'],
  );
});
