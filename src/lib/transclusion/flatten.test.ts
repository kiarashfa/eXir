import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flatten, type Component, type StepSlot } from './flatten.ts';
import { extractQtyRefs, mergeContributions, portionsSum } from './merge.ts';
import type { IngredientLine, Step } from '../math/types.ts';

const line = (
  id: string,
  ingredientRef: string,
  amount: number,
  extra: Partial<IngredientLine> = {},
): IngredientLine => ({ id, ingredientRef, formRef: 'standard', amount, unit: 'ml', ...extra });

const step = (id: string, prose: string, durationSec = 20): Step => ({
  id,
  durationSec,
  type: 'active',
  phase: 'make',
  prose,
});

const inline = (s: Step): StepSlot => ({ kind: 'inline', step: s });

// ---------------------------------------------------------------------------

test('a drink with no components is left exactly as authored', () => {
  // Most drinks transclude nothing. Rewriting their refs to solve a collision
  // that cannot happen would churn every id on the page for no reason.
  const result = flatten(
    {
      lines: [line('gin', 'gin', 60), line('lime', 'lime-juice', 22.5)],
      slots: [inline(step('shake', 'Shake the <Qty ref="gin"/> and <Qty ref="lime"/>.'))],
    },
    new Map(),
  );

  assert.deepEqual(
    result.lines.map((l) => l.id),
    ['gin', 'lime'],
  );
  assert.equal(result.steps[0]?.id, 'shake');
  assert.match(result.steps[0]?.prose ?? '', /ref="gin"/);
  assert.equal(result.issues.length, 0);
});

test('the same ingredient from two sources becomes one line expressed as portions', () => {
  // Two "lime juice" lines in one checklist reads as a bug.
  const dryShake: Component = {
    id: 'dry-shake',
    name: 'Dry shake',
    lines: [line('lime', 'lime-juice', 15)],
    steps: [step('dry', 'Dry-shake with the <Qty ref="lime"/>.')],
  };

  const result = flatten(
    {
      lines: [line('gin', 'gin', 60), line('lime', 'lime-juice', 7.5)],
      slots: [
        { kind: 'component', componentRef: 'dry-shake' },
        inline(step('strain', 'Strain, adding the last <Qty ref="lime"/>.')),
      ],
    },
    new Map([['dry-shake', dryShake]]),
  );

  const lime = result.lines.find((l) => l.ingredientRef === 'lime-juice');
  assert.ok(lime);
  assert.equal(lime.amount, 22.5);
  assert.equal(lime.portions?.length, 2);
  // The merge shape means the portions-sum check validates it for free.
  assert.equal(portionsSum(lime), lime.amount);
});

test('refs inside a merged group are namespaced by their source', () => {
  const dryShake: Component = {
    id: 'dry-shake',
    name: 'Dry shake',
    lines: [line('lime', 'lime-juice', 15)],
    steps: [step('dry', 'Dry-shake with the <Qty ref="lime"/>.')],
  };

  const result = flatten(
    {
      lines: [line('lime', 'lime-juice', 7.5)],
      slots: [
        { kind: 'component', componentRef: 'dry-shake' },
        inline(step('strain', 'Add the last <Qty ref="lime"/>.')),
      ],
    },
    new Map([['dry-shake', dryShake]]),
  );

  const proseById = new Map(result.steps.map((s) => [s.id, s.prose]));
  assert.match(proseById.get('dry__dry-shake') ?? '', /ref="lime__dry-shake"/);
  assert.match(proseById.get('strain') ?? '', /ref="lime__self"/);

  // And every rewritten ref resolves to a real portion.
  const ids = new Set(result.lines.flatMap((l) => (l.portions ?? []).map((p) => p.id)));
  for (const prose of proseById.values()) {
    for (const ref of extractQtyRefs(prose)) assert.ok(ids.has(ref), `${ref} resolves`);
  }
});

test('the same ingredient in a different form does not merge', () => {
  // Fresh lime juice and bottled lime cordial are different things.
  const result = flatten(
    {
      lines: [
        line('fresh', 'lime-juice', 22.5),
        { ...line('cordial', 'lime-juice', 15), formRef: 'cordial' },
      ],
      slots: [],
    },
    new Map(),
  );

  assert.equal(result.lines.length, 2);
});

test('a component multiplier applies before the merge, not after', () => {
  // The reader's live drink count applies at render. Applying them the other
  // way round would scale the multiplier by the drink count.
  const syrupShake: Component = {
    id: 'shake',
    name: 'Shake',
    lines: [line('syrup', 'simple-syrup', 10)],
    steps: [step('s', 'Shake with the <Qty ref="syrup"/>.')],
  };

  const result = flatten(
    { lines: [], slots: [{ kind: 'component', componentRef: 'shake', multiplier: 2.5 }] },
    new Map([['shake', syrupShake]]),
  );

  assert.equal(result.lines[0]?.amount, 25);
});

test('the same component referenced twice keeps its occurrences apart', () => {
  const shake: Component = {
    id: 'shake',
    name: 'Shake',
    lines: [line('ice', 'ice', 100)],
    steps: [step('s', 'Shake hard with the <Qty ref="ice"/>.')],
  };

  const result = flatten(
    {
      lines: [],
      slots: [
        { kind: 'component', componentRef: 'shake' },
        { kind: 'component', componentRef: 'shake' },
      ],
    },
    new Map([['shake', shake]]),
  );

  assert.deepEqual(
    result.steps.map((s) => s.id),
    ['s__shake#1', 's__shake#2'],
  );
  assert.equal(result.lines[0]?.amount, 200);
  assert.equal(result.lines[0]?.portions?.length, 2);
  assert.equal(result.components[0]?.occurrences, 2);
  assert.equal(result.issues.length, 0);
});

test('the checklist reads in the order the maker reaches for things', () => {
  // Which for a cocktail is the build order, and that is also the order a
  // jigger gets used.
  const result = flatten(
    {
      lines: [
        line('garnish', 'mint', 1),
        line('syrup', 'simple-syrup', 15),
        line('rum', 'white-rum', 60),
      ],
      slots: [
        inline(step('a', 'Start with the <Qty ref="rum"/>.')),
        inline(step('b', 'Then the <Qty ref="syrup"/>.')),
      ],
    },
    new Map(),
  );

  // Anything never named in prose keeps its authored position, after the rest.
  assert.deepEqual(
    result.lines.map((l) => l.id),
    ['rum', 'syrup', 'garnish'],
  );
});

test('a duration reference written inside a component still resolves', () => {
  const shake: Component = {
    id: 'shake',
    name: 'Shake',
    lines: [],
    steps: [step('hard', 'Shake for <Dur step="hard"/>.', 12)],
  };

  const result = flatten(
    { lines: [], slots: [{ kind: 'component', componentRef: 'shake' }] },
    new Map([['shake', shake]]),
  );

  assert.equal(result.steps[0]?.id, 'hard__shake');
  assert.match(result.steps[0]?.prose ?? '', /step="hard__shake"/);
});

test('a parallel anchor written inside a component is rewritten with it', () => {
  const bundle: Component = {
    id: 'bundle',
    name: 'Bundle',
    lines: [],
    steps: [
      { ...step('long', '', 60) },
      { ...step('short', '', 20), type: 'parallel-with:long' },
    ],
  };

  const result = flatten(
    { lines: [], slots: [{ kind: 'component', componentRef: 'bundle' }] },
    new Map([['bundle', bundle]]),
  );

  assert.equal(result.steps[1]?.type, 'parallel-with:long__bundle');
});

test('an unresolved component is reported rather than silently dropped', () => {
  const result = flatten(
    { lines: [], slots: [{ kind: 'component', componentRef: 'nope' }] },
    new Map(),
  );

  assert.equal(result.issues[0]?.kind, 'unresolved-component');
});

test('an authored id containing the synthesized separator is caught', () => {
  const result = mergeContributions([
    { line: line('lime__self', 'lime-juice', 15), sourceKey: 'self' },
  ]);

  assert.equal(result.issues[0]?.kind, 'authored-id-contains-separator');
});

test('sources disagreeing on partial use warn, and the parent wins', () => {
  const rinse: Component = {
    id: 'rinse',
    name: 'Rinse',
    lines: [line('absinthe', 'absinthe', 5, { consumedFraction: 0.5 })],
    steps: [],
  };

  const result = flatten(
    {
      lines: [line('absinthe', 'absinthe', 5, { consumedFraction: 0.04 })],
      slots: [{ kind: 'component', componentRef: 'rinse' }],
    },
    new Map([['rinse', rinse]]),
  );

  assert.ok(result.issues.some((i) => i.kind === 'conflicting-consumed-fraction'));
  assert.equal(result.lines[0]?.consumedFraction, 0.04);
});

test('extractQtyRefs finds refs and ignores everything else', () => {
  assert.deepEqual(
    extractQtyRefs('Combine <Qty ref="gin"/> and <Qty ref="lime" fraction={0.5}/>, then <Temp c={4}/>.'),
    ['gin', 'lime'],
  );
});
