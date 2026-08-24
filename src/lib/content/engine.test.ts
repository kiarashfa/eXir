/**
 * The engine over the published fixtures.
 *
 * Everything above this file is tested against hand-built objects. This one
 * loads real content off disk and runs the whole pipeline on it — parse, join,
 * flatten, merge, compute, render — which is the only way to find the seams
 * between the pieces.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadContent } from './disk.ts';
import { resolveSite } from './resolve.ts';
import { computeBatch, computeDrinkSpec, linesForService } from '../math/spec.ts';
import { computeScaledTiming, computeTiming } from '../math/timing.ts';
import { computeBrew } from '../math/brewing.ts';
import { glassFit } from '../math/glassware.ts';
import { literalDigitsInProse, renderProse } from '../render/prose.ts';
import type { DrinkVersion, ResolvedLine } from '../math/types.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(here, '../../../test-fixtures/engine-content');

const content = await loadContent(FIXTURES);

const close = (a: number, b: number, tol = 1e-3) =>
  assert.ok(Math.abs(a - b) < tol, `${a} !== ${b} within ${tol}`);

/**
 * The resolved fixture site, built once.
 *
 * This file used to carry its own frontmatter-to-DrinkVersion mapper beside the
 * one in `resolve.ts`, and the two drifted the moment the brew block started
 * reading its dose off the ingredient lines: the tests kept passing a raw
 * authored block through and got a ratio of zero out. Two mappers is the same
 * mistake the checks avoid by not recomputing what the engine already computed.
 */
const site = resolveSite(content);
assert.deepEqual(site.issues, [], 'the fixtures resolve cleanly');

/** One resolved fixture version, with its lines already joined to their Forms. */
function build(slug: string): {
  version: DrinkVersion;
  lines: ResolvedLine[];
  steps: DrinkVersion['steps'];
} {
  const found = site.versions.find((v) => v.slug === slug);
  assert.ok(found, `fixture ${slug} resolves`);
  return { version: found.version, lines: found.lines, steps: found.version.steps };
}

// ---------------------------------------------------------------------------

test('every fixture loads with no join issues', () => {
  // Step metadata without prose renders an empty instruction; prose without
  // metadata contributes no time to a card that claims to be complete.
  assert.deepEqual(content.issues, []);
  assert.equal(content.drinks.length, 7);
  assert.ok(content.ingredients.has('simple-syrup'), 'a preparation loads as an ingredient');
});

test('no step prose anywhere contains a literal number', () => {
  // The rule the whole project rests on, checked against rendered output over
  // every fixture at once.
  for (const file of content.drinks) {
    const { version, lines } = build(file.slug);
    const source = { lines, steps: version.steps, defaultDrinks: version.defaultDrinks };

    for (const step of version.steps) {
      const html = renderProse(step.prose, { source, drinks: 1, system: 'metric' });
      assert.deepEqual(
        literalDigitsInProse(html),
        [],
        `${file.slug} / ${step.id} has a literal number in its prose`,
      );
      assert.doesNotMatch(html, /is-unresolved/, `${file.slug} / ${step.id} has an unresolved ref`);
    }
  }
});

test('the stirred reference computes the figures it is named for', () => {
  const { version, lines } = build('stirred-reference');
  const spec = computeDrinkSpec(version, lines);

  close(spec.composition.pouredVolumeMl, 90);
  close(spec.finalVolumeMl, 125.729);
  close(spec.alcohol.finalAbvPercent, 19.327, 1e-2);
  close(spec.alcohol.pureAlcoholG, 19.173, 1e-2);
  close(spec.sugarGPerL, 88.3, 0.1);
  assert.equal(spec.facets.servingTemp, 'iced');
  assert.equal(spec.facets.baseSpirits[0]?.spirit, 'gin');

  // 19.3% is genuinely below a Manhattan or a Martini, both of which finish
  // above 24%. Strength is a measurement band, not a style label, and style
  // lives on the authored category axis.
  assert.equal(spec.facets.strength, 'medium');
});

test('an estimated density on one ingredient marks the drink an estimate', () => {
  // The vermouth fixture carries densitySource: estimated, and nothing in the
  // drink is authored in grams — so the estimate must NOT propagate from a
  // conversion that never happened.
  const { version, lines } = build('stirred-reference');
  const spec = computeDrinkSpec(version, lines);

  assert.equal(
    spec.composition.issues.some((i) => i.kind === 'estimated-density'),
    false,
  );
  // The ABV is still an estimate, because the dilution model is.
  assert.equal(spec.alcohol.abvEstimated, true);
});

test('portions sum to their parent line', () => {
  const { lines } = build('shaken-sour');
  const lime = lines.find((l) => l.line.ingredientRef === 'lime-juice');

  assert.ok(lime);
  const sum = (lime.line.portions ?? []).reduce((s, p) => s + p.amount, 0);
  close(sum, lime.line.amount);
});

test('a preparation is used as an ingredient, never transcluded', () => {
  // Nobody wants "dissolve sugar in water and cool completely" wedged into a
  // three-step cocktail.
  const { version, lines } = build('shaken-sour');

  assert.ok(lines.some((l) => l.line.ingredientRef === 'simple-syrup'));
  assert.deepEqual(
    version.steps.map((s) => s.id),
    ['rim', 'build', 'shake'],
  );
});

test('a preparation carries the yield and shelf life that make it one', () => {
  const syrup = content.ingredients.get('simple-syrup');
  assert.ok(syrup);
  assert.equal(syrup.kind, 'preparation');
  assert.equal(syrup.yieldMl, 400);
  assert.ok(syrup.shelfLife?.days);
});

test('the same component twice merges its lines and keeps its steps apart', () => {
  const { version, lines } = build('double-shake');

  assert.deepEqual(
    version.steps.map((s) => s.id),
    ['build', 'slap__mint-slap#1', 'shake', 'slap__mint-slap#2', 'pour'],
  );

  // 4 g at the first occurrence's multiplier of 1, plus 2 g at the second's 0.5.
  const mint = lines.find((l) => l.line.ingredientRef === 'mint');
  assert.ok(mint);
  close(mint.line.amount, 6);
  assert.equal(mint.line.portions?.length, 2);
});

test('ice is never an ingredient line where a dilution model is in play', () => {
  // The model already accounts for what the ice contributes. Authoring the ice
  // as well would add its melt to the drink twice, and the second copy would
  // be the one nobody was looking at.
  for (const file of content.drinks) {
    const { version, lines } = build(file.slug);
    if (version.dilutionClass === 'blended-with-ice' || version.dilutionClass === 'none') continue;
    assert.equal(
      lines.some((l) => l.line.ingredientRef === 'ice'),
      false,
      `${file.slug} authors ice alongside the "${version.dilutionClass}" model`,
    );
  }
});

test('a rinse contributes almost nothing but is still bought in full', () => {
  const { version, lines } = build('rinsed-old-fashioned');
  const spec = computeDrinkSpec(version, lines);
  const rinse = lines.find((l) => l.line.ingredientRef === 'absinthe');

  // 5 ml of a 68% spirit is 3.4 ml of alcohol; 4% of it is 0.136.
  const rye = 60 * 0.45;
  close(spec.composition.alcoholMl, rye + 0.136, 1e-3);
  // The checklist still shows the whole 5 ml.
  assert.equal(rinse?.line.amount, 5);
  assert.equal(spec.composition.estimated, true);
});

test('a zero-proof drink derives as zero-proof and keeps its alcohol panel off', () => {
  const { version, lines } = build('zero-proof-highball');
  const spec = computeDrinkSpec(version, lines);

  close(spec.alcohol.finalAbvPercent, 0);
  assert.equal(spec.facets.strength, 'zero-proof');
  assert.equal(spec.panels.alcohol, false);
  assert.equal(spec.warnings.length, 0);
});

test('a brewed drink reports ratio and retention and withholds extraction', () => {
  const { version } = build('brewed-pour-over');
  assert.ok(version.brew);
  const brew = computeBrew(version.brew);

  assert.equal(brew.ratioDisplay, '1 : 16.4');
  assert.equal(brew.retentionMl, 40);
  assert.equal(brew.extractionYieldPercent, null);
});

test('a brewed drink shows the brew panel instead of a dilution', () => {
  const { version, lines } = build('brewed-pour-over');
  const spec = computeDrinkSpec(version, lines);

  assert.equal(spec.panels.brew, true);
  assert.equal(spec.panels.dilution, false);
  assert.equal(spec.facets.servingTemp, 'hot');
  assert.equal(spec.facets.diet.diets.includes('caffeine-free'), false);
});

test('a fermented drink carries staged temperature ranges and a safety note', () => {
  const { version, lines } = build('fermented-ginger-beer');
  const spec = computeDrinkSpec(version, lines);

  assert.equal(spec.panels.ferment, true);
  assert.equal(version.ferment?.stages.length, 2);
  // A range, never a point. Fermentation is not a precise process.
  assert.equal(version.ferment?.stages[0]?.tempC.length, 2);
  assert.ok(version.ferment?.safetyNote, 'a ferment that builds pressure states so');
  // The estimated range never becomes a single standard-drink figure.
  assert.deepEqual(version.ferment?.estimatedAbvRange, [0.5, 2.0]);
});

test('an egg drink computes its allergen and stops short of vegan', () => {
  const { version, lines } = build('shaken-sour');
  const spec = computeDrinkSpec(version, lines);

  assert.ok(spec.facets.diet.allergens.includes('egg'));
  assert.equal(spec.facets.diet.diets.includes('vegan'), false);
  assert.equal(spec.facets.diet.diets.includes('vegetarian'), true);
});

test('a rye drink carries gluten through to the computed allergens', () => {
  const { version, lines } = build('rinsed-old-fashioned');
  const spec = computeDrinkSpec(version, lines);

  assert.ok(spec.facets.diet.allergens.includes('gluten'));
  assert.equal(spec.facets.diet.diets.includes('gluten-free'), false);
});

// ---------------------------------------------------------------------------
// Service modes, over real content
// ---------------------------------------------------------------------------

test('the batch arrives at the same drink, over loaded content', () => {
  const { version, lines } = build('stirred-reference');
  const spec = computeDrinkSpec(version, lines);
  const batch = computeBatch(spec, version, 12);

  // Every line is per drink, water included, so this needs no rescaling.
  const check = computeDrinkSpec(
    { ...version, dilutionClass: 'none' },
    linesForService(lines, batch, 'batch'),
  );

  close(check.finalVolumeMl, spec.finalVolumeMl, 1e-6);
  close(check.alcohol.finalAbvPercent, spec.alcohol.finalAbvPercent, 1e-6);
  close(check.sugarGPerL, spec.sugarGPerL, 1e-6);
});

test('timing scales one way and not the other', () => {
  const { version } = build('stirred-reference');

  const one = computeTiming(version.steps);
  assert.equal(one.totalSec, 75);

  // Twelve drinks made to order is twelve stirs.
  assert.equal(computeScaledTiming(version.steps, 12, 'order').totalSec, 900);
  // Batched is one combine and one dilution.
  assert.equal(computeScaledTiming(version.steps, 12, 'batch').totalSec, 75);
});

test('a fermented drink rests for as long as it rests, whatever the count', () => {
  const { version } = build('fermented-ginger-beer');
  const t = computeTiming(version.steps);

  // Seven days plus three, in seconds, all of it passive.
  assert.equal(t.restSec, 604800 + 259200);
  assert.equal(computeScaledTiming(version.steps, 24, 'order', 6).restSec, t.restSec);
});

test('a recipe that already makes six shows its authored timing at six', () => {
  // Scaling against one drink rather than against the recipe's own yield would
  // claim the grating takes six times as long as it was written to take.
  const { version } = build('fermented-ginger-beer');
  const authored = computeTiming(version.steps);
  const atDefault = computeScaledTiming(version.steps, 6, 'order', 6);

  assert.equal(atDefault.prepSec, authored.prepSec);
  assert.equal(atDefault.makeSec, authored.makeSec);

  // Doubling the batch does double the active work.
  assert.equal(computeScaledTiming(version.steps, 12, 'order', 6).makeSec, authored.makeSec * 2);
});

test('a ferment that develops alcohol is never labelled zero-proof', () => {
  // The computed ABV is zero because no ingredient carries any, but the page
  // documents the drink reaching two percent. Strength is the facet a reader
  // avoiding alcohol filters on, so it must not say zero.
  const { version, lines } = build('fermented-ginger-beer');
  const spec = computeDrinkSpec(version, lines);

  assert.equal(spec.alcohol.finalAbvPercent, 0);
  assert.equal(spec.facets.strength, 'low');
  // The standard-drinks figure stays out of it: a range cannot produce one.
  assert.equal(spec.alcohol.standardDrinks.every((d) => d.drinks === 0), true);
});

// ---------------------------------------------------------------------------
// Glassware fit
// ---------------------------------------------------------------------------

test('every fixture fits the glass it names', () => {
  for (const file of content.drinks) {
    const { version, lines } = build(file.slug);
    if (!version.glasswareRef) continue;

    const glass = content.glassware.get(version.glasswareRef);
    assert.ok(glass, `${file.slug}: glassware "${version.glasswareRef}" resolves`);

    const spec = computeDrinkSpec(version, lines);
    // The same helper the integrity check calls. Two copies of "what does the
    // ice displace" would eventually disagree about whether a drink fits.
    const fit = glassFit(version, spec.finalVolumeMl, {
      capacityMl: Number(glass['capacityMl']),
      ...(glass['iceDisplacementMl']
        ? { iceDisplacementMl: glass['iceDisplacementMl'] as Record<string, number> }
        : {}),
    });

    assert.equal(fit.unmodelledIce, false, `${file.slug}: ice style "${fit.iceStyle}" has no figure`);
    assert.ok(
      fit.fits,
      `${file.slug}: needs ${fit.neededMl.toFixed(0)} ml but ${String(glass['name'])} holds ${fit.capacityMl} ml`,
    );
  }
});
