import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Report, parseArgs } from './report.ts';

test('a report separates errors from warnings', () => {
  const r = new Report();
  r.error('portions-sum', 'negroni', 'portions do not sum to the parent amount');
  r.warn('unused-ref', 'negroni', 'the orange twist is never referenced in prose');

  assert.equal(r.errors.length, 1);
  assert.equal(r.warnings.length, 1);
  assert.equal(r.findings.length, 2);
});

test('a check that ran and found nothing still counts as run', () => {
  const r = new Report();
  r.ran('glassware-fit');

  assert.equal(r.checkCount, 1);
  assert.equal(r.findings.length, 0);
});

test('the same check reported twice counts once', () => {
  const r = new Report();
  r.error('portions-sum', 'a', 'x');
  r.error('portions-sum', 'b', 'y');

  assert.equal(r.checkCount, 1);
  assert.equal(r.errors.length, 2);
});

test('parseArgs reads valued flags and bare flags', () => {
  const args = parseArgs(['--content', 'test-fixtures/broken-content', '--expect-failure', '--strict']);

  assert.equal(args.get('content'), 'test-fixtures/broken-content');
  assert.equal(args.get('expect-failure'), true);
  assert.equal(args.get('strict'), true);
});

test('a bare flag immediately before another flag is not given the flag as a value', () => {
  const args = parseArgs(['--expect-failure', '--content', 'dist']);

  assert.equal(args.get('expect-failure'), true);
  assert.equal(args.get('content'), 'dist');
});
