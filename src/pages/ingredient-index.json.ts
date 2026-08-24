/**
 * One light record per ingredient and preparation.
 *
 * The catalogue index answers "which drinks use what". This answers "what is
 * that thing" — the name to show, whether it is a staple, which shelf of the My
 * Bar picker it belongs on, and, for a Preparation, the recipe the shopping
 * list expands.
 *
 * It is a separate file from the catalogue rather than a field on every drink
 * because these are properties of the INGREDIENT: a staple is a staple in every
 * drink that names it, and repeating that across sixteen hundred rows would be
 * sixteen hundred copies of one fact.
 */
import type { APIRoute } from 'astro';

import { humanise, type IndexedIngredient, type IndexedPrepLine } from '../lib/catalog.ts';
import { published, site } from '../lib/content/site.ts';
import type { BaseUnit } from '../lib/math/types.ts';

export const GET: APIRoute = async () => {
  const resolved = await site();

  // Which ingredients a published drink actually names, so the bar picker can
  // offer a shelf somebody can do something with rather than the whole store.
  const used = new Set<string>();
  for (const drink of published(resolved)) {
    for (const version of drink.versions) {
      for (const { line } of version.lines) used.add(line.ingredientRef);
      // A preparation a drink uses puts its own inputs in reach too.
      for (const { ingredient } of version.lines) {
        for (const sub of ingredient.ingredients ?? []) used.add(sub.ingredientRef);
      }
      // And so does an authored substitute. My Bar credits a reader who owns
      // one, so a substitute the picker cannot offer is a match nobody can
      // reach — the feature would be live in the arithmetic and invisible on
      // the page.
      for (const substitution of version.substitutions) used.add(substitution.substitute);
    }
  }

  const ingredients: IndexedIngredient[] = [...resolved.ingredients.values()]
    .map((ingredient): IndexedIngredient => {
      const category = ingredient.category ?? 'other';
      const lines: IndexedPrepLine[] | undefined = ingredient.ingredients?.map((line) => ({
        ingredientRef: line.ingredientRef,
        formRef: line.formRef ?? 'standard',
        amount: line.amount,
        unit: line.unit as BaseUnit,
        garnish: line.garnish === true,
      }));

      return {
        id: ingredient.id,
        name: ingredient.name,
        kind: ingredient.kind,
        category,
        group: humanise(category),
        staple: ingredient.pantryStaple === true,
        proprietary: ingredient.proprietary === true,
        ...(ingredient.countryOfOrigin ? { countryOfOrigin: ingredient.countryOfOrigin } : {}),
        forms: ingredient.forms.map((form) => ({
          id: form.id,
          abvPercent: form.abvPercent,
          ...(form.countUnit ? { countUnit: form.countUnit } : {}),
          ...(form.proseName ? { proseName: form.proseName } : {}),
        })),
        ...(ingredient.yieldMl !== undefined ? { yieldMl: ingredient.yieldMl } : {}),
        ...(ingredient.shelfLife ? { shelfLife: ingredient.shelfLife } : {}),
        ...(ingredient.purchasable !== undefined ? { purchasable: ingredient.purchasable } : {}),
        ...(lines?.length ? { lines } : {}),
        used: used.has(ingredient.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return new Response(JSON.stringify({ generated: ingredients.length, ingredients }), {
    headers: { 'content-type': 'application/json' },
  });
};
