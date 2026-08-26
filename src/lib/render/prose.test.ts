import { test } from 'node:test';
import assert from 'node:assert/strict';

import { literalDigitsInProse, renderProse, type ProseSource } from './prose.ts';
import { qtyHtml } from './live-values.ts';
import type { Ingredient, IngredientLine, ResolvedLine, Step } from '../math/types.ts';

const ingredient = (id: string, name: string, abvPercent = 0): Ingredient => ({
  id,
  name,
  kind: 'ingredient',
  forms: [{ id: 'standard', abvPercent, animalOrigin: 'none' }],
});

function resolved(line: IngredientLine, ing: Ingredient): ResolvedLine {
  const form = ing.forms[0];
  if (!form) throw new Error('no form');
  return { line, ingredient: ing, form };
}

const gin = ingredient('gin', 'London dry gin', 40);
const bitters = ingredient('bitters', 'Angostura bitters', 44.7);

const lines: ResolvedLine[] = [
  resolved({ id: 'gin', ingredientRef: 'gin', amount: 60, unit: 'ml' }, gin),
  resolved(
    {
      id: 'bitters',
      ingredientRef: 'bitters',
      amount: 1.8,
      unit: 'ml',
    },
    {
      ...bitters,
      forms: [
        {
          id: 'standard',
          abvPercent: 44.7,
          animalOrigin: 'none',
          countUnit: { singular: 'dash', plural: 'dashes', ml: 0.9, snap: 'whole' },
        },
      ],
    },
  ),
];

const steps: Step[] = [
  { id: 'stir', durationSec: 25, type: 'active', phase: 'make', prose: '' },
];

const source: ProseSource = { lines, steps, defaultDrinks: 1 };
const ctx = { source, drinks: 1, system: 'metric' as const };

test('a quantity renders as amount plus name, in one span', () => {
  const html = renderProse('Combine the <Qty ref="gin"/> in a mixing glass.', ctx);

  assert.match(html, /class="q"/);
  assert.match(html, /<span class="n">60 ml<\/span>/);
  // A generic lowercases to sit inside a sentence.
  assert.match(html, /<span class="q-name">london dry gin<\/span>/);
});

test('a proprietary product keeps its capitals', () => {
  // A trademark is not a common noun, and lowercasing it is both wrong on the
  // page and careless nominative use. Derived from the record, not hand-set.
  const campari: Ingredient = {
    id: 'campari',
    name: 'Campari',
    kind: 'ingredient',
    proprietary: true,
    forms: [{ id: 'standard', abvPercent: 25, animalOrigin: 'none' }],
  };
  const html = renderProse('Add the <Qty ref="campari"/>.', {
    ...ctx,
    source: {
      ...source,
      lines: [resolved({ id: 'campari', ingredientRef: 'campari', amount: 30, unit: 'ml' }, campari)],
    },
  });

  assert.match(html, /<span class="q-name">Campari<\/span>/);
});

test('a quantity scales with the drink count', () => {
  const html = renderProse('Combine the <Qty ref="gin"/>.', { ...ctx, drinks: 12 });
  assert.match(html, />720 ml</);
});

test('a quantity respects the unit system', () => {
  const html = renderProse('Combine the <Qty ref="gin"/>.', { ...ctx, system: 'us' });
  assert.match(html, />2 fl oz</);
});

test('a counted ingredient leads with its count and keeps the base measure', () => {
  const html = renderProse('Add <Qty ref="bitters"/>.', ctx);

  assert.match(html, /<span class="q-count">2<\/span>/);
  assert.match(html, /<span class="q-noun">dashes<\/span>/);
  assert.match(html, /\(<span class="n">1\.8 ml<\/span>\)/);
});

/**
 * The count noun is a unit and the ingredient still has to be named. This only
 * ever looked right because the first countUnit written was the orange's, where
 * the noun and the name are the same word — so "2 dashes" rendered with no
 * mention of what was being dashed, and nobody could shop from it.
 */
test('a counted ingredient is still named', () => {
  const html = renderProse('Add <Qty ref="bitters"/>.', ctx);
  assert.match(html, /<span class="q-noun">dashes<\/span> <span class="q-name">angostura bitters<\/span>/);
});

test('a count noun that IS the ingredient name is not printed twice', () => {
  const counted = qtyHtml(
    {
      amount: 140,
      unit: 'g',
      defaultDrinks: 1,
      name: 'orange',
      countUnit: { singular: 'orange', plural: 'oranges', g: 140, snap: 'half' },
    },
    1,
    'metric',
  );
  assert.match(counted, /<span class="q-noun">orange<\/span>/);
  assert.doesNotMatch(counted, /q-name/);
});

test('a fraction prop takes part of a line without needing a portion', () => {
  const html = renderProse('Add half the <Qty ref="gin" fraction={0.5}/>.', ctx);
  assert.match(html, />30 ml</);
});

test('a portion ref resolves against its parent line', () => {
  const withPortions: ProseSource = {
    ...source,
    lines: [
      resolved(
        {
          id: 'lime',
          ingredientRef: 'lime-juice',
          amount: 30,
          unit: 'ml',
          portions: [
            { id: 'lime-shake', amount: 25 },
            { id: 'lime-rim', amount: 5, note: 'for the rim' },
          ],
        },
        ingredient('lime-juice', 'lime juice'),
      ),
    ],
  };

  const html = renderProse('Shake with the <Qty ref="lime-shake"/>.', {
    ...ctx,
    source: withPortions,
  });
  assert.match(html, />25 ml</);
});

test('temperature, length and duration each render from their own source', () => {
  const html = renderProse(
    'Heat to <Temp c={65}/>, cut a <Len cm={5}/> swathe, stir for <Dur step="stir"/>.',
    ctx,
  );

  assert.match(html, /data-temp-c="65"[^>]*>65 °C</);
  assert.match(html, /data-len-cm="5"[^>]*>5 cm</);
  assert.match(html, /data-dur-sec="25"[^>]*>25s</);
});

test('a strength is read off the form rather than typed into the sentence', () => {
  const html = renderProse('Use a <Abv ref="gin"/> gin.', ctx);
  assert.match(html, /data-abv="40"[^>]*>40% ABV</);
});

test('an unresolved ref shows itself rather than being swallowed', () => {
  // The build fails on this, so reaching it means the checks were bypassed.
  const html = renderProse('Combine the <Qty ref="whisky"/>.', ctx);
  assert.match(html, /is-unresolved/);
  assert.match(html, /\[whisky\]/);
});

test('prose is escaped before any markdown is applied', () => {
  const html = renderProse('Not a <script>alert(1)</script> tag.', ctx);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('emphasis and links survive; nothing else does', () => {
  const html = renderProse('Stir **well**, not *hard*. See [gin](/eXir/ingredients/gin/).', ctx);

  assert.match(html, /<strong>well<\/strong>/);
  assert.match(html, /<em>hard<\/em>/);
  assert.match(html, /<a href="\/eXir\/ingredients\/gin\/">gin<\/a>/);
});

test('authored indentation is collapsed away', () => {
  const html = renderProse('Combine the\n    <Qty ref="gin"/>\n    and stir.', ctx);
  assert.doesNotMatch(html, /\n/);
  assert.match(html, /and stir\./);
});

// ---------------------------------------------------------------------------
// The literal-digit rule
// ---------------------------------------------------------------------------

test('digits inside a live value are not literals', () => {
  const html = renderProse('Combine the <Qty ref="gin"/> and stir for <Dur step="stir"/>.', ctx);
  assert.deepEqual(literalDigitsInProse(html), []);
});

test('a digit typed into prose is caught', () => {
  // A literal number in prose can drift from the data beside it, which is the
  // whole reason the rule exists. Checking the RENDERED text is what makes it
  // enforceable: it sees exactly what a reader would.
  const html = renderProse('Combine the <Qty ref="gin"/> and 30 ml of vermouth.', ctx);
  assert.deepEqual(literalDigitsInProse(html), ['30']);
});

test('a decimal typed into prose is caught whole', () => {
  const html = renderProse('Chill to 4.5 degrees.', ctx);
  assert.deepEqual(literalDigitsInProse(html), ['4.5']);
});

test('a counted quantity does not leak its digits into the literal check', () => {
  const html = renderProse('Add <Qty ref="bitters"/> to the glass.', ctx);
  assert.deepEqual(literalDigitsInProse(html), []);
});
