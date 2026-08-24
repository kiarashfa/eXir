/**
 * Schema.org structured data for a drink.
 *
 * `Recipe` rather than anything beverage-specific, because Recipe is what
 * search engines actually support for drinks. Generated from the DEFAULT
 * version, at its default drink count, in metric.
 *
 * The instructions are the same prose the page renders, with the live-value
 * components resolved to literal strings — so the snapshot and the live page
 * cannot disagree by construction, because they come out of the same renderer.
 */

import { proseName, renderProse } from './prose.ts';
import type { ResolvedDrink, ResolvedVersion } from '../content/resolve.ts';

const stripTags = (html: string): string =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

export interface JsonLdInput {
  drink: ResolvedDrink;
  version: ResolvedVersion;
  url: string;
  imageUrl?: string;
}

export function recipeJsonLd({ drink, version, url, imageUrl }: JsonLdInput): string {
  const source = {
    lines: version.lines,
    steps: version.version.steps,
    defaultDrinks: version.version.defaultDrinks,
  };
  const render = (prose: string): string =>
    stripTags(renderProse(prose, { source, drinks: version.version.defaultDrinks, system: 'metric' }));

  const names = version.frontmatter['names'] as
    | {
        alsoKnownAs?: Array<{ name: string }>;
        notToBeConfusedWith?: Array<{ name: string; note: string }>;
        searchOnly?: string[];
      }
    | undefined;

  /**
   * `alsoKnownAs` and transliterations only.
   *
   * A `notToBeConfusedWith` name must NEVER appear here: this field asserts
   * that the page is also known by the name, which is the exact opposite of
   * what that field means. It goes in the disambiguating description instead.
   */
  const alternateName = (names?.alsoKnownAs ?? []).map((n) => n.name);
  const keywords = [...alternateName, ...(names?.searchOnly ?? [])];

  const spec = version.spec;
  const tags = version.frontmatter['tags'] as Record<string, string[]> | undefined;

  const data: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: drink.name,
    url,
    ...(imageUrl ? { image: [imageUrl] } : {}),
    ...(drink.about?.frontmatter['summary']
      ? { description: String(drink.about.frontmatter['summary']) }
      : {}),
    ...(alternateName.length ? { alternateName } : {}),
    ...(keywords.length ? { keywords: keywords.join(', ') } : {}),
    ...(names?.notToBeConfusedWith?.length
      ? {
          disambiguatingDescription: names.notToBeConfusedWith
            .map((n) => `Not to be confused with ${n.name}: ${n.note}`)
            .join(' '),
        }
      : {}),
    recipeCategory: tags?.['category']?.[0] ?? 'Drink',
    ...(tags?.['origin']?.length ? { recipeCuisine: tags['origin'][0] } : {}),
    recipeYield: `${version.version.defaultDrinks} drink${version.version.defaultDrinks === 1 ? '' : 's'}`,
    ...(version.timing.prepSec ? { prepTime: iso(version.timing.prepSec) } : {}),
    ...(version.timing.makeSec ? { cookTime: iso(version.timing.makeSec) } : {}),
    ...(version.timing.totalSec ? { totalTime: iso(version.timing.totalSec) } : {}),
    // The same name the page uses mid-sentence, so a brand keeps its capital
    // and a generic does not.
    recipeIngredient: version.lines.map(
      (r) => `${r.line.amount} ${r.line.unit} ${proseName(r)}`,
    ),
    recipeInstructions: version.version.steps.map((step, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      text: render(step.prose),
    })),
    // No invented property for ABV or standard drinks. Both are on the page in
    // plain text, and schema.org has nothing that means either.
    nutrition: {
      '@type': 'NutritionInformation',
      servingSize: `${Math.round(spec.finalVolumeMl)} ml`,
      calories: `${Math.round(spec.nutrition.kcal)} kcal`,
      ...(spec.composition.sugarG > 0
        ? { sugarContent: `${spec.composition.sugarG.toFixed(1)} g` }
        : {}),
      ...(spec.composition.carbohydrateG > 0
        ? { carbohydrateContent: `${spec.composition.carbohydrateG.toFixed(1)} g` }
        : {}),
    },
  };

  return JSON.stringify(data);
}

/** ISO 8601 duration, which is the only format the property accepts. */
function iso(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.round(totalSec % 60);
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s || (!h && !m) ? `${s}S` : ''}`;
}
