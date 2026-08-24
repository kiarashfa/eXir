/**
 * Content collections.
 *
 * The schemas live in `src/schemas/content.ts` and are imported here and by the
 * integrity scripts, so every rule is defined once and read by both consumers.
 * A schema violation fails the build; it never warns.
 */

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import * as S from './schemas/content.ts';

const drinks = defineCollection({
  // Every .mdx under a drink folder except its About, which is a collection of
  // its own: where a drink comes from does not change because its ratio does.
  loader: glob({
    base: 'src/content/drinks',
    pattern: ['**/*.mdx', '!**/about.mdx'],
  }),
  schema: S.drinkVersion,
});

const drinkAbouts = defineCollection({
  loader: glob({ base: 'src/content/drinks', pattern: '**/about.mdx' }),
  schema: S.about,
});

const ingredients = defineCollection({
  loader: glob({ base: 'src/content/ingredients', pattern: '**/*.json' }),
  schema: S.ingredient,
});

const preparations = defineCollection({
  loader: glob({ base: 'src/content/preparations', pattern: '**/*.mdx' }),
  schema: S.preparation,
});

const components = defineCollection({
  loader: glob({ base: 'src/content/components', pattern: '**/*.mdx' }),
  schema: S.component,
});

const techniques = defineCollection({
  loader: glob({ base: 'src/content/techniques', pattern: '**/*.mdx' }),
  schema: S.technique,
});

const families = defineCollection({
  loader: glob({ base: 'src/content/families', pattern: '**/*.mdx' }),
  schema: S.family,
});

const glassware = defineCollection({
  loader: glob({ base: 'src/content/glassware', pattern: '**/*.json' }),
  schema: S.glassware,
});

export const collections = {
  drinks,
  drinkAbouts,
  ingredients,
  preparations,
  components,
  techniques,
  families,
  glassware,
};
