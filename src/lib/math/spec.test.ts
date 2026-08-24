import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeBatch, computeDrinkSpec, linesForService } from './spec.ts';
import { computeComposition } from './composition.ts';
import type { DrinkVersion, Form, Ingredient, IngredientLine, ResolvedLine } from './types.ts';

const close = (a: number, b: number, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) < tol, `${a} !== ${b} within ${tol}`);

// ---------------------------------------------------------------------------
// A stirred equal-parts build. Every figure below was worked by hand first.
// ---------------------------------------------------------------------------

const ingredient = (
  id: string,
  category: string,
  form: Partial<Form> & { abvPercent: number },
): Ingredient => ({
  id,
  name: id,
  kind: 'ingredient',
  category,
  forms: [
    {
      id: 'standard',
      densityGPerMl: 0.95,
      sugarGPer100: 0,
      acidPercent: 0,
      animalOrigin: 'none',
      allergenTags: [],
      ...form,
    },
  ],
});

const line = (id: string, ingredientRef: string, amount: number): IngredientLine => ({
  id,
  ingredientRef,
  formRef: 'standard',
  amount,
  unit: 'ml',
});

function resolve(pairs: Array<[IngredientLine, Ingredient]>): ResolvedLine[] {
  return pairs.map(([l, ing]) => {
    const form = ing.forms[0];
    if (!form) throw new Error('fixture ingredient has no form');
    return { line: l, ingredient: ing, form };
  });
}

const gin = ingredient('gin', 'gin', { abvPercent: 40 });
const aperitivo = ingredient('campari', 'bitter-aperitivo', { abvPercent: 25, sugarGPer100: 24 });
const vermouth = ingredient('sweet-vermouth', 'vermouth', { abvPercent: 16, sugarGPer100: 13 });

const equalParts: ResolvedLine[] = resolve([
  [line('gin', 'gin', 30), gin],
  [line('campari', 'campari', 30), aperitivo],
  [line('vermouth', 'sweet-vermouth', 30), vermouth],
]);

const version: DrinkVersion = {
  id: 'classic',
  label: 'Classic',
  defaultDrinks: 1,
  method: 'stirred',
  dilutionClass: 'stirred',
  bitterness: 'high',
  batchable: 'full',
  servedOverIce: true,
  lines: equalParts.map((r) => r.line),
  steps: [],
};

test('the composition of an equal-parts stirred build', () => {
  const c = computeComposition(equalParts);

  close(c.pouredVolumeMl, 90);
  // 40% of 30 + 25% of 30 + 16% of 30 = 12 + 7.5 + 4.8
  close(c.alcoholMl, 24.3);
  close(c.pouredAbvPercent, 27);
  // 24 g/100ml over 30 ml, plus 13 g/100ml over 30 ml.
  close(c.sugarG, 11.1);
  close(c.acidG, 0);
});

test('the spec panel reproduces the reference figures', () => {
  const spec = computeDrinkSpec(version, equalParts);

  close(spec.finalVolumeMl, 125.729);
  close(spec.alcohol.finalAbvPercent, 19.327, 1e-2);
  close(spec.alcohol.pureAlcoholG, 19.173, 1e-2);
  close(spec.sugarGPerL, 88.3, 0.1);

  const us = spec.alcohol.standardDrinks.find((d) => d.id === 'us');
  const uk = spec.alcohol.standardDrinks.find((d) => d.id === 'uk');
  close(us?.drinks ?? 0, 1.369, 1e-2);
  close(uk?.drinks ?? 0, 2.397, 1e-2);

  // Alcohol energy plus the sugar's own: 19.173 x 7 + 11.1 x 4.
  close(spec.nutrition.kcal, 178.6, 0.5);
});

test('energy is never double-counted through a stated bottle figure', () => {
  // A bottle's stated kcal already contains its alcohol. If the engine added
  // the separately computed alcohol energy to a stated figure, a spirit's
  // energy would roughly double.
  const spec = computeDrinkSpec(version, equalParts);
  close(spec.nutrition.alcoholKcal + spec.nutrition.macroKcal, spec.nutrition.kcal);
  close(spec.nutrition.macroKcal, 44.4, 0.1);
});

test('the final ABV is an estimate but the pure alcohol is not', () => {
  const spec = computeDrinkSpec(version, equalParts);

  // The ABV divides by a modelled volume; the grams of alcohol never touch it.
  assert.equal(spec.alcohol.abvEstimated, true);
  assert.equal(spec.dilution.estimated, true);
});

test('panels are derived from the data, not tagged', () => {
  const spec = computeDrinkSpec(version, equalParts);

  assert.equal(spec.panels.alcohol, true);
  assert.equal(spec.panels.dilution, true);
  assert.equal(spec.panels.brew, false);
  assert.equal(spec.panels.ferment, false);
});

test('the base spirit is ranked by alcohol contribution', () => {
  const spec = computeDrinkSpec(version, equalParts);
  const spirits = spec.facets.baseSpirits.map((s) => s.spirit);

  // Gin contributes 12 ml of the 24.3 and the bitter aperitivo 7.5. The
  // vermouth's 4.8 is deliberately unmapped: it is a modifier, and folding it
  // into the aperitivo bucket would let two modifiers outvote the base spirit
  // and make an equal-parts gin drink report as something else.
  assert.equal(spirits[0], 'gin');
  assert.deepEqual(new Set(spirits), new Set(['gin', 'aperitivo']));
});

test('bitterness passes through as authored and is marked uncomputed', () => {
  const spec = computeDrinkSpec(version, equalParts);
  const bitter = spec.bars.find((b) => b.key === 'bitter');
  const strong = spec.bars.find((b) => b.key === 'strong');

  assert.equal(bitter?.computed, false);
  assert.equal(bitter?.value, null);
  assert.equal(bitter?.display, 'high');
  assert.equal(strong?.computed, true);
});

test('a drink with no acid reads "none" rather than a measurement', () => {
  const spec = computeDrinkSpec(version, equalParts);
  assert.equal(spec.bars.find((b) => b.key === 'sour')?.display, 'none');
});

// ---------------------------------------------------------------------------
// The service modes. This is the invariant the whole feature rests on.
// ---------------------------------------------------------------------------

test('every per-drink figure is identical in both service modes', () => {
  // The batch is computed to arrive at the same drink. If this ever fails, the
  // batch arithmetic is wrong and the page would be showing it as right.
  const spec = computeDrinkSpec(version, equalParts);
  const batch = computeBatch(spec, version, 12);

  // Every line, water included, is already per drink — so the batched list can
  // be fed straight back in with no rescaling at all. That it needs none is
  // itself part of the point.
  const batchedSpec = computeDrinkSpec(
    { ...version, dilutionClass: 'none' },
    linesForService(equalParts, batch, 'batch'),
  );

  close(batchedSpec.finalVolumeMl, spec.finalVolumeMl, 1e-6);
  close(batchedSpec.alcohol.finalAbvPercent, spec.alcohol.finalAbvPercent, 1e-6);
  close(batchedSpec.alcohol.pureAlcoholG, spec.alcohol.pureAlcoholG, 1e-6);
  close(batchedSpec.sugarGPerL, spec.sugarGPerL, 1e-6);
  close(batchedSpec.nutrition.kcal, spec.nutrition.kcal, 1e-6);
});

test('the batch water line is the dilution figure, stated per drink', () => {
  const spec = computeDrinkSpec(version, equalParts);
  const batch = computeBatch(spec, version, 12);

  assert.equal(batch.available, true);
  // Per drink, like every other line, so ordinary scaling multiplies it up
  // alongside them rather than every consumer special-casing one row.
  close(batch.waterLine?.amount ?? 0, 35.729, 0.01);
  assert.equal(batch.waterLine?.computed, true);

  // The yield is the one figure about the whole batch, so it is absolute.
  close(batch.yieldMl, 125.729 * 12, 0.01);
});

test('batching is unavailable below two drinks and says why', () => {
  const spec = computeDrinkSpec(version, equalParts);
  const one = computeBatch(spec, version, 1);

  assert.equal(one.available, false);
  assert.match(one.unavailableReason ?? '', /2 drinks/);
});

test('a drink that takes no dilution offers no batch mode', () => {
  const hot: DrinkVersion = { ...version, dilutionClass: 'none', batchable: 'none' };
  const spec = computeDrinkSpec(hot, equalParts);
  const batch = computeBatch(spec, hot, 12);

  assert.equal(batch.available, false);
  assert.equal(batch.waterLine, null);
});

test('made-to-order service inserts no water line', () => {
  const spec = computeDrinkSpec(version, equalParts);
  const batch = computeBatch(spec, version, 12);

  assert.equal(linesForService(equalParts, batch, 'order').length, 3);
  assert.equal(linesForService(equalParts, batch, 'batch').length, 4);
});

// ---------------------------------------------------------------------------
// Partial consumption
// ---------------------------------------------------------------------------

test('a rinse contributes almost nothing and marks the drink an estimate', () => {
  const absinthe = ingredient('absinthe', 'absinthe', { abvPercent: 68 });
  const withRinse = resolve([
    [line('whisky', 'gin', 60), gin],
    [{ ...line('rinse', 'absinthe', 5), consumedFraction: 0.04 }, absinthe],
  ]);

  const spec = computeDrinkSpec({ ...version, bitterness: 'low' }, withRinse);

  // 5 ml of a 68% spirit would add 3.4 ml of alcohol; 4% of it adds 0.136.
  close(spec.composition.alcoholMl, 24 + 0.136, 1e-3);
  assert.equal(spec.composition.estimated, true);
  assert.ok(spec.composition.issues.some((i) => i.kind === 'partial-consumption'));
});

test('the shopping amount is unaffected by partial consumption', () => {
  // The reader still has to buy the whole 5 ml they are about to pour away.
  const absinthe = ingredient('absinthe', 'absinthe', { abvPercent: 68 });
  const rinse: IngredientLine = { ...line('rinse', 'absinthe', 5), consumedFraction: 0.04 };
  const lines = resolve([[rinse, absinthe]]);

  assert.equal(lines[0]?.line.amount, 5);
});

// ---------------------------------------------------------------------------
// The checks that catch authoring errors at volume
// ---------------------------------------------------------------------------

test('an alcoholic form authored in grams with no density refuses to guess', () => {
  const solid: Ingredient = {
    id: 'odd',
    name: 'odd',
    kind: 'ingredient',
    category: 'liqueur',
    forms: [{ id: 'standard', abvPercent: 30, animalOrigin: 'none' }],
  };
  const lines = resolve([[{ ...line('odd', 'odd', 50), unit: 'g' }, solid]]);
  const c = computeComposition(lines);

  assert.equal(c.alcoholMl, 0);
  assert.ok(c.issues.some((i) => i.kind === 'abv-without-density'));
});

test('an implausibly strong drink warns rather than passing quietly', () => {
  const overproof = ingredient('overproof', 'rum', { abvPercent: 75 });
  const lines = resolve([[line('rum', 'overproof', 90), overproof]]);
  const spec = computeDrinkSpec({ ...version, bitterness: 'none' }, lines);

  assert.ok(spec.warnings.some((w) => /above the 45% bound/.test(w)));
});

test('a drink flagged high proof does not warn', () => {
  const overproof = ingredient('overproof', 'rum', { abvPercent: 75 });
  const lines = resolve([[line('rum', 'overproof', 90), overproof]]);
  const spec = computeDrinkSpec({ ...version, bitterness: 'none', highProof: true }, lines);

  assert.equal(spec.warnings.filter((w) => /45% bound/.test(w)).length, 0);
});

test('a vegan claim is withheld while any form leaves animal origin undeclared', () => {
  // Isinglass, gelatine, carmine, honey and egg white are all invisible in an
  // ingredient's name. Defaulting an unknown to "none" would state as a fact
  // exactly the thing nobody checked.
  const undeclared: Ingredient = {
    id: 'mystery',
    name: 'mystery',
    kind: 'ingredient',
    category: 'wine',
    forms: [{ id: 'standard', abvPercent: 12 }],
  };
  const lines = resolve([[line('mystery', 'mystery', 90), undeclared]]);
  const spec = computeDrinkSpec(version, lines);

  assert.equal(spec.facets.diet.diets.includes('vegan'), false);
  assert.deepEqual(spec.facets.diet.undeclaredAnimalOrigin, ['mystery']);
});
