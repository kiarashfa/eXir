/**
 * The content schemas.
 *
 * One definition, two consumers: `src/content.config.ts` registers these with
 * Astro, and the integrity scripts import the same objects to validate content
 * off disk. A rule stated here cannot drift from the rule the build enforces,
 * because there is only one of it.
 *
 * A schema violation FAILS the build. It never warns.
 *
 * These are validation only. The engine's own types live in
 * `src/lib/math/types.ts` and import nothing, because everything under
 * `src/lib/math/` is reachable from a client island and anything that reaches
 * this file reaches Zod. The parity assertions at the bottom keep the two in
 * step at compile time without either importing the other at runtime.
 */

import { z } from 'astro/zod';

import type {
  Allergen,
  AnimalOrigin,
  Form,
  Ingredient,
  IngredientLine,
  Step,
} from '../lib/math/types.ts';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Lowercase, hyphenated, ASCII. A non-ASCII slug breaks a URL quietly. */
export const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase ASCII words joined by single hyphens');

/**
 * An authored id may not contain the transclusion separator, which marks a
 * synthesized one. Allowing it would let an author collide with a merge result.
 */
export const authoredId = z
  .string()
  .min(1)
  .refine((v) => !v.includes('__'), '"__" is reserved for ids the merge synthesizes');

export const allergen = z.enum([
  'nuts',
  'peanuts',
  'shellfish',
  'molluscs',
  'fish',
  'dairy',
  'gluten',
  'soy',
  'egg',
  'sesame',
  'celery',
  'mustard',
  'lupin',
  'sulphites',
]);

export const animalOrigin = z.enum([
  'none',
  'dairy',
  'egg',
  'honey',
  'fish',
  'shellfish',
  'insect',
  'other-animal',
]);

export const baseUnit = z.enum(['ml', 'g']);

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const alsoKnownAs = z.object({
  name: z.string().min(1),
  region: z.string().optional(),
  /** BCP-47. Feeds the structured data. */
  lang: z.string().optional(),
  note: z.string().optional(),
  formRef: z.string().optional(),
});

/**
 * A name that could bring a reader here but means something else.
 *
 * The note is REQUIRED and must actually state the difference. An entry without
 * one tells the reader they are in the wrong place and not where the right one
 * is, which is worse than saying nothing.
 */
const notToBeConfusedWith = z.object({
  name: z.string().min(1),
  note: z.string().min(1, 'a confusable without a note stating the difference is useless'),
  slugRef: slug.optional(),
});

export const names = z
  .object({
    alsoKnownAs: z.array(alsoKnownAs).optional(),
    notToBeConfusedWith: z.array(notToBeConfusedWith).optional(),
    /** Indexed, never displayed: transliterations and misspellings. */
    searchOnly: z.array(z.string().min(1)).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Forms and ingredients
// ---------------------------------------------------------------------------

const countUnit = z
  .object({
    singular: z.string().min(1),
    plural: z.string().min(1),
    ml: z.number().positive().optional(),
    g: z.number().positive().optional(),
    snap: z.enum(['half', 'whole']),
  })
  .refine(
    (v) => (v.ml === undefined) !== (v.g === undefined),
    'declare exactly one of ml or g — whichever matches the Form base unit',
  );

const nutritionPer100 = z
  .object({
    kcal: z.number().nonnegative().optional(),
    carbohydrateG: z.number().nonnegative().optional(),
    sugarsG: z.number().nonnegative().optional(),
    proteinG: z.number().nonnegative().optional(),
    fatG: z.number().nonnegative().optional(),
    saturatedFatG: z.number().nonnegative().optional(),
    fibreG: z.number().nonnegative().optional(),
    sodiumMg: z.number().nonnegative().optional(),
  })
  .strict();

export const form = z
  .object({
    id: authoredId,
    label: z.string().optional(),
    abvPercent: z.number().min(0).max(100),
    /** TRUE density, not bulk. See the note on the engine's Form type. */
    densityGPerMl: z.number().positive().optional(),
    densitySource: z.enum(['measured', 'estimated']).optional(),
    sugarGPer100: z.number().min(0).max(100).optional(),
    acidPercent: z.number().min(0).max(100).optional(),
    nutritionPer100g: nutritionPer100.optional(),
    countUnit: countUnit.optional(),
    allergenTags: z.array(allergen).optional(),
    animalOrigin: animalOrigin.optional(),
    animalOriginNote: z.string().optional(),
    containsCaffeine: z.boolean().optional(),
    containsGluten: z.boolean().optional(),
    containsDairy: z.boolean().optional(),
    proseName: z.string().optional(),
    sourceDataset: z.string().optional(),
    sourceId: z.string().optional(),
    sourceNote: z.string().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    // A density with no stated provenance cannot be marked honestly downstream,
    // and the estimate marker is the whole point of tracking it.
    if (v.densityGPerMl !== undefined && v.densitySource === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'a density needs a densitySource of "measured" or "estimated"',
        path: ['densitySource'],
      });
    }
    if (v.animalOriginNote !== undefined && v.animalOrigin === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'an animalOriginNote without an animalOrigin explains nothing',
        path: ['animalOrigin'],
      });
    }
  });

const substitute = z.object({
  substitute: slug,
  note: z.string().min(1),
  ratio: z.string().optional(),
});

export const shelfLife = z
  .object({ days: z.number().positive(), storage: z.string().min(1) })
  .strict();

export const ingredient = z
  .object({
    id: slug,
    name: z.string().min(1),
    kind: z.enum(['ingredient', 'preparation']).default('ingredient'),
    category: z.string().optional(),
    proprietary: z.boolean().optional(),
    producer: z.string().optional(),
    countryOfOrigin: z.string().optional(),
    pantryStaple: z.boolean().optional(),
    proseName: z.string().optional(),
    names: names.optional(),
    generalSubstitutes: z.array(substitute).optional(),
    forms: z.array(form).min(1, 'an ingredient with no Form has no composition data'),
    image: z.object({ src: z.string(), alt: z.string().min(1) }).optional(),
  })
  .strict();

/**
 * A Preparation is an Ingredient that also has a recipe. The yield and the
 * shelf life are what make it one, and both are mandatory: a syrup with no
 * stated shelf life is a food-safety gap, and "you need 20 ml" is misleading
 * when the honest answer is "you are making 400 ml".
 */
export const preparation = ingredient.extend({
  kind: z.literal('preparation'),
  yieldMl: z.number().positive(),
  shelfLife,
  purchasable: z.boolean().optional(),
  purchaseNote: z.string().optional(),
  ingredients: z.array(z.lazy(() => ingredientLine)).optional(),
  steps: z.array(z.lazy(() => stepMeta)).optional(),
});

// ---------------------------------------------------------------------------
// Lines and steps
// ---------------------------------------------------------------------------

const portion = z
  .object({ id: authoredId, amount: z.number().positive(), note: z.string().optional() })
  .strict();

export const ingredientLine = z
  .object({
    id: authoredId,
    ingredientRef: slug,
    formRef: z.string().optional(),
    amount: z.number().positive(),
    unit: baseUnit,
    portions: z.array(portion).min(1).optional(),
    /** Strictly greater than zero: a line that contributes nothing is not a line. */
    consumedFraction: z.number().gt(0).lte(1).optional(),
    consumedFractionNote: z.string().optional(),
    garnish: z.boolean().optional(),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.portions) {
      const sum = v.portions.reduce((s, p) => s + p.amount, 0);
      // Floating point on authored decimals: 25 + 5 must equal 30, and 0.1 +
      // 0.2 must not fail for being 0.30000000000000004.
      if (Math.abs(sum - v.amount) > 1e-6) {
        ctx.addIssue({
          code: 'custom',
          message: `portions sum to ${sum} but the line is ${v.amount}`,
          path: ['portions'],
        });
      }
    }
    if (v.consumedFractionNote !== undefined && v.consumedFraction === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'a consumedFractionNote without a consumedFraction explains nothing',
        path: ['consumedFraction'],
      });
    }
  });

const stepType = z
  .string()
  .refine(
    (v) => v === 'active' || v === 'passive' || v.startsWith('parallel-with:'),
    'must be "active", "passive", or "parallel-with:<stepId>"',
  );

export const stepMeta = z
  .object({
    /** Required on every step: `<Dur step>` resolves against it. */
    id: authoredId.optional(),
    durationSec: z.number().nonnegative().optional(),
    type: stepType.optional(),
    phase: z.enum(['prep', 'make', 'rest']).optional(),
    /** A Component to inline here instead of an authored step. */
    componentRef: slug.optional(),
    multiplier: z.number().positive().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.componentRef) {
      if (v.id ?? v.durationSec ?? v.type ?? v.phase) {
        ctx.addIssue({
          code: 'custom',
          message: 'a componentRef slot carries no step data of its own',
        });
      }
      return;
    }
    // Not a component slot, so it is a step and needs all four.
    for (const key of ['id', 'durationSec', 'type', 'phase'] as const) {
      if (v[key] === undefined) {
        ctx.addIssue({ code: 'custom', message: `a step needs ${key}`, path: [key] });
      }
    }
  });

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

/**
 * Sourcing is mandatory here and the requirement is deliberate.
 *
 * A wrong technique is caught by the first person who makes the drink. An
 * invented origin story is caught by nobody: it is fluent, plausible, and
 * indistinguishable to the reader from a real one.
 */
export const source = z
  .object({
    id: authoredId,
    title: z.string().min(1),
    publisher: z.string().min(1),
    url: z.url().optional(),
    year: z.number().int().optional(),
  })
  .strict();

export const about = z
  .object({
    summary: z.string().min(1),
    sources: z.array(source).min(1, 'an About section with no sources is the failure to prevent'),
  })
  .strict();

// ---------------------------------------------------------------------------
// Glassware, families, drinks
// ---------------------------------------------------------------------------

export const glassware = z
  .object({
    id: slug,
    name: z.string().min(1),
    capacityMl: z.number().positive(),
    shapeFamily: z.string().optional(),
    /** Modelled displacement per ice style, so the fit check has a figure. */
    iceDisplacementMl: z.record(z.string(), z.number().nonnegative()).optional(),
    image: z.object({ src: z.string(), alt: z.string().min(1) }).optional(),
  })
  .strict();

export const familyRole = z.enum(['origin', 'canonical', 'descendant', 'riff']);

export const family = z
  .object({
    id: slug,
    name: z.string().min(1),
    summary: z.string().min(1),
    about: about.optional(),
  })
  .strict();

export const drinkVersion = z
  .object({
    id: authoredId,
    /** The tab's name and the Style fact. Every version has one. */
    label: z.string().min(1),
    name: z.string().min(1),
    subtitle: z.string().optional(),
    draft: z.boolean().optional(),
    defaultDrinks: z.number().int().positive().default(1),
    method: z.string().min(1),
    dilutionClass: z.string().min(1),
    glasswareRef: slug.optional(),
    iceStyle: z.string().optional(),
    servedOverIce: z.boolean().optional(),
    serveTempC: z.number().optional(),
    bitterness: z.enum(['none', 'low', 'medium', 'high']),
    batchable: z.enum(['full', 'partial', 'none']),
    batchNote: z.string().optional(),
    zeroProof: z.boolean().optional(),
    highProof: z.boolean().optional(),
    names: names.optional(),
    family: slug.optional(),
    familyRole: familyRole.optional(),
    derivedFrom: slug.optional(),
    tags: z
      .object({
        category: z.array(slug).optional(),
        origin: z.array(slug).optional(),
        method: z.array(slug).optional(),
        occasion: z.array(slug).optional(),
      })
      .strict()
      .optional(),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']).optional(),
    image: z.object({ src: z.string(), alt: z.string().min(1) }).optional(),
    ingredients: z.array(ingredientLine).min(1),
    steps: z.array(stepMeta).min(1),
    about: about.optional(),
    makeAhead: z
      .object({
        aheadInstructions: z.string().optional(),
        batchKeepDays: z.number().positive().optional(),
        batchStorage: z.string().optional(),
        freezable: z.boolean().optional(),
        reheatInstructions: z.string().optional(),
      })
      .strict()
      .optional(),
    brew: z
      .object({
        method: z.enum(['pour-over', 'immersion', 'espresso', 'moka', 'cold-brew', 'steep', 'gongfu']),
        doseG: z.number().positive(),
        waterMl: z.number().positive(),
        waterTempC: z.number(),
        grind: z.string().optional(),
        contactSec: z.number().nonnegative().optional(),
        yieldMl: z.number().positive(),
        infusions: z
          .array(z.object({ n: z.number().int().positive(), contactSec: z.number().positive() }))
          .optional(),
        measuredTdsPercent: z.number().positive().optional(),
      })
      .strict()
      .optional(),
    ferment: z
      .object({
        stages: z
          .array(
            z
              .object({
                id: authoredId,
                label: z.string().min(1),
                days: z.number().positive(),
                // A range, never a point. Fermentation is not a precise process
                // and a single figure would be a false claim.
                tempC: z.tuple([z.number(), z.number()]),
                sealed: z.boolean(),
              })
              .strict(),
          )
          .min(1),
        developsAlcohol: z.boolean(),
        estimatedAbvRange: z.tuple([z.number(), z.number()]).optional(),
        safetyNote: z.string().optional(),
      })
      .strict()
      .superRefine((v, ctx) => {
        // The one content category where an omission has a physical
        // consequence: sealed secondary fermentation builds real pressure.
        if (v.stages.some((s) => s.sealed) && !v.safetyNote) {
          ctx.addIssue({
            code: 'custom',
            message: 'a sealed fermentation stage requires a safetyNote',
            path: ['safetyNote'],
          });
        }
        if (v.developsAlcohol && !v.estimatedAbvRange) {
          ctx.addIssue({
            code: 'custom',
            message: 'a ferment that develops alcohol must state its estimated range',
            path: ['estimatedAbvRange'],
          });
        }
      })
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.batchable === 'partial' && !v.batchNote) {
      ctx.addIssue({
        code: 'custom',
        message: 'partial batching has to say which part batches',
        path: ['batchNote'],
      });
    }
    if (v.derivedFrom && !v.family) {
      ctx.addIssue({
        code: 'custom',
        message: 'descent is recorded within a family, so derivedFrom needs one',
        path: ['family'],
      });
    }
  });

/**
 * A standalone explainer. May overlap with a Component, which is the inlined
 * technique bundle; this is the page a reader arrives at on its own.
 */
export const technique = z
  .object({
    id: slug,
    name: z.string().min(1),
    summary: z.string().min(1),
    names: names.optional(),
    about: about.optional(),
  })
  .strict();

export const component = z
  .object({
    id: slug,
    name: z.string().min(1),
    summary: z.string().optional(),
    ingredients: z.array(ingredientLine).optional(),
    steps: z.array(stepMeta).min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Parity with the engine's own types
// ---------------------------------------------------------------------------

/**
 * Compile-time only. These assert that what the schemas produce is assignable
 * to what the engine consumes, so the two definitions cannot drift apart
 * without `astro check` saying so — and without the engine importing Zod.
 */
type Assignable<A extends B, B> = A;

export type FormParity = Assignable<z.infer<typeof form>, Form>;
export type IngredientParity = Assignable<z.infer<typeof ingredient>, Ingredient>;
export type LineParity = Assignable<z.infer<typeof ingredientLine>, IngredientLine>;
export type AllergenParity = Assignable<z.infer<typeof allergen>, Allergen>;
export type AnimalOriginParity = Assignable<z.infer<typeof animalOrigin>, AnimalOrigin>;
export type StepPhaseParity = Assignable<z.infer<typeof stepMeta>['phase'], Step['phase'] | undefined>;
