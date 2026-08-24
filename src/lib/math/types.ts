/**
 * The shapes the maths engine operates on.
 *
 * Deliberately plain TypeScript with no imports at all. Everything under
 * `src/lib/math/` is reachable from a client island, and anything that reaches
 * the content schemas reaches Zod, which then ships to the browser. Validation
 * lives in `src/schemas/` and produces values that satisfy these types; the
 * engine never imports it.
 */

export type BaseUnit = 'ml' | 'g';
export type UnitSystem = 'metric' | 'us';

/** One drink count, two ways of getting there. See the service-mode rules. */
export type ServiceMode = 'order' | 'batch';

export type Batchable = 'full' | 'partial' | 'none';

// ---------------------------------------------------------------------------
// Ingredients
// ---------------------------------------------------------------------------

/**
 * A bartender writes "2 dashes", not "1.8 ml". This changes the display, not
 * the model: the stored figure stays ml or g, so the count scales because the
 * measure behind it does.
 */
export interface CountUnit {
  singular: string;
  plural: string;
  /** Exactly one of these; whichever matches the Form's base unit. */
  ml?: number;
  g?: number;
  /** Half where a half is meaningful (a lime), whole where it is not (a dash). */
  snap: 'half' | 'whole';
}

export interface NutritionPer100 {
  /**
   * The producer's or dataset's stated figure. Carried for citation and for a
   * cross-check, and deliberately NOT what the engine adds up — see
   * `nutrition.ts` for why adding it to the alcohol energy double-counts.
   */
  kcal?: number;
  carbohydrateG?: number;
  sugarsG?: number;
  proteinG?: number;
  fatG?: number;
  saturatedFatG?: number;
  fibreG?: number;
  sodiumMg?: number;
}

/**
 * `varies` is the checked-and-genuinely-unknowable case, and it is not the same
 * as leaving the field out.
 *
 * Wine, beer and cider may be fined with isinglass or gelatine, and neither is a
 * declarable allergen anywhere, so no label states it and no producer has to.
 * Whether a given bottle is vegan therefore depends on the bottle. Declaring
 * `none` would state as a fact the one thing nobody can check; leaving the field
 * out says only that nobody filled it in. `varies` says it was looked at, and
 * carries the reason in `animalOriginNote`.
 *
 * Both withhold the vegan and vegetarian labels. Only the missing field is a
 * defect.
 */
export type AnimalOrigin =
  | 'none'
  | 'varies'
  | 'dairy'
  | 'egg'
  | 'honey'
  | 'fish'
  | 'shellfish'
  | 'insect'
  | 'other-animal';

/** The union of the US and EU declarable lists, fixed before content authoring. */
export type Allergen =
  | 'nuts'
  | 'peanuts'
  | 'shellfish'
  | 'molluscs'
  | 'fish'
  | 'dairy'
  | 'gluten'
  | 'soy'
  | 'egg'
  | 'sesame'
  | 'celery'
  | 'mustard'
  | 'lupin'
  | 'sulphites';

export type Diet =
  | 'vegan'
  | 'vegetarian'
  | 'dairy-free'
  | 'gluten-free'
  | 'nut-free'
  | 'caffeine-free';

export type BaseSpirit =
  | 'gin'
  | 'whisky'
  | 'rum'
  | 'agave'
  | 'brandy'
  | 'vodka'
  | 'aperitivo'
  | 'liqueur'
  | 'wine'
  | 'beer'
  | 'sake'
  | 'none';

/**
 * A strength band, not a style. The top band is named for what it measures:
 * the balance bar reading the identical figure is already labelled "Strong",
 * and one fact should not carry two names. "Spirit-forward" would also be a
 * claim the number cannot support — an equal-parts aperitivo build finishes
 * genuinely weaker than a Manhattan or a Martini. Style is the authored
 * category axis, which is where a reader browsing by it should be looking.
 */
export type Strength = 'zero-proof' | 'low' | 'medium' | 'strong';

export type ServingTemp = 'hot' | 'warm' | 'room' | 'chilled' | 'iced' | 'frozen';

/** A Form is where every composition figure lives. Never the Ingredient itself. */
export interface Form {
  id: string;
  label?: string;
  /** Percent alcohol by volume of the bottle, 0 where none. */
  abvPercent: number;
  /**
   * TRUE density, not bulk density.
   *
   * This figure is used for exactly two things: the volume an ingredient adds
   * to the drink, and reaching a volume for the alcohol calculation when a Form
   * is authored in grams. Both want the density of the substance itself.
   *
   * Granulated sugar pours at about 0.85 g/ml because most of that volume is
   * air between the grains, and 250 g of it dissolved adds 158 ml to a drink,
   * not 294. A site that also rendered cups would need the bulk figure as well;
   * this one never does, so there is one field and it means one thing.
   */
  densityGPerMl?: number;
  densitySource?: 'measured' | 'estimated';
  /** Per 100 ml for liquids, per 100 g for solids. */
  sugarGPer100?: number;
  /** Titratable acidity as % w/v. Citrus sits near 6; most things are 0. */
  acidPercent?: number;
  nutritionPer100g?: NutritionPer100;
  countUnit?: CountUnit;
  allergenTags?: Allergen[];
  animalOrigin?: AnimalOrigin;
  animalOriginNote?: string;
  containsCaffeine?: boolean;
  containsGluten?: boolean;
  containsDairy?: boolean;
  /** How the Form reads mid-sentence, where the ingredient name will not do. */
  proseName?: string;
  sourceDataset?: string;
  sourceId?: string;
  sourceNote?: string;
}

export interface Ingredient {
  id: string;
  name: string;
  kind: 'ingredient' | 'preparation';
  /** Feeds the base-spirit derivation and the My Bar grouping. */
  category?: string;
  proprietary?: boolean;
  /**
   * Where the product is made. Read by the occasion view's bottle estimate,
   * because the standard retail bottle is 700 ml under the EU nominal
   * quantities and 750 ml under the US standards of fill.
   */
  countryOfOrigin?: string;
  pantryStaple?: boolean;
  proseName?: string;
  forms: Form[];
  /** Preparations only, and mandatory there. */
  yieldMl?: number;
  shelfLife?: { days: number; storage: string };
  purchasable?: boolean;
  /**
   * A Preparation's own recipe lines.
   *
   * Nothing resolves these on the way to a drink — a Preparation is referenced
   * as an ingredient, so its steps are never walked — which is exactly why they
   * have to be checked in their own right.
   */
  ingredients?: IngredientLine[];
}

export interface Portion {
  id: string;
  amount: number;
  note?: string;
}

export interface IngredientLine {
  /** Unique within the version, and what a `<Qty ref>` points at. */
  id: string;
  ingredientRef: string;
  formRef?: string;
  amount: number;
  unit: BaseUnit;
  portions?: Portion[];
  /**
   * How much of the authored amount actually ends up in the glass. A rinse is
   * the common case: 5 ml of absinthe swirled and discarded would otherwise add
   * a spirit's worth of alcohol to a 90 ml drink.
   */
  consumedFraction?: number;
  consumedFractionNote?: string;
  /** Display grouping only. A garnish still has composition if it is consumed. */
  garnish?: boolean;
  /** True on the water line the engine inserts for batched service. */
  computed?: boolean;
  note?: string;
}

/** An ingredient line joined to the Ingredient and Form it names. */
export interface ResolvedLine {
  line: IngredientLine;
  ingredient: Ingredient;
  form: Form;
}

// ---------------------------------------------------------------------------
// Steps and timing
// ---------------------------------------------------------------------------

export type StepPhase = 'prep' | 'make' | 'rest';

/**
 * `active` and `passive` are the two that add time. `parallel-with:<stepId>`
 * runs alongside another step and contributes only what it overruns by.
 */
export type StepType = 'active' | 'passive' | `parallel-with:${string}`;

export interface Step {
  /** Required, and stable across transclusion — `<Dur step>` resolves to it. */
  id: string;
  durationSec: number;
  type: StepType;
  phase: StepPhase;
  /** Authored prose, rendered by the prose renderer rather than by MDX. */
  prose: string;
  /** Set during transclusion; identifies which source contributed the step. */
  sourceKey?: string;
}

// ---------------------------------------------------------------------------
// Brewing and fermentation
// ---------------------------------------------------------------------------

export type BrewMethod =
  | 'pour-over'
  | 'immersion'
  | 'espresso'
  | 'moka'
  | 'cold-brew'
  | 'steep'
  | 'gongfu';

export interface Infusion {
  n: number;
  contactSec: number;
}

export interface Brew {
  method: BrewMethod;
  /**
   * Both are resolved from the ingredient lines the authored block names, never
   * authored here. The engine still works in figures; what it must not do is
   * work from a second copy of them.
   */
  doseG: number;
  waterMl: number;
  waterTempC: number;
  grind?: string;
  contactSec?: number;
  /** What reaches the cup after the bed holds some back. */
  yieldMl: number;
  infusions?: Infusion[];
  /** Only where someone actually measured it. Without it, no yield estimate. */
  measuredTdsPercent?: number;
}

export interface FermentStage {
  id: string;
  label: string;
  days: number;
  /** A range, never a point. Fermentation is not a precise process. */
  tempC: [number, number];
  sealed: boolean;
}

export interface Ferment {
  stages: FermentStage[];
  developsAlcohol: boolean;
  estimatedAbvRange?: [number, number];
  safetyNote?: string;
}

// ---------------------------------------------------------------------------
// The drink
// ---------------------------------------------------------------------------

export type Bitterness = 'none' | 'low' | 'medium' | 'high';

export interface Glassware {
  id: string;
  name: string;
  capacityMl: number;
  shapeFamily?: string;
  /** Modelled displacement per ice style, so the fit check has a figure. */
  iceDisplacementMl?: Record<string, number>;
}

export interface DrinkVersion {
  id: string;
  /** The tab's name and the Style fact. Distinguishes it from its siblings. */
  label: string;
  defaultDrinks: number;
  method: string;
  /** Which entry in dilution-classes.json models this drink's water gain. */
  dilutionClass: string;
  glasswareRef?: string;
  iceStyle?: string;
  servedOverIce?: boolean;
  /**
   * The drink's temperature as served, where the method does not already imply
   * it. A toddy is hot and nothing in its ingredient list says so. This is a
   * measured property of the drink, not a facet: the serving-temperature facet
   * is derived from it rather than authored alongside it.
   */
  serveTempC?: number;
  /** Authored, never computed. There is no bitterness figure on any bottle. */
  bitterness: Bitterness;
  batchable: Batchable;
  batchNote?: string;
  zeroProof?: boolean;
  highProof?: boolean;
  lines: IngredientLine[];
  steps: Step[];
  brew?: Brew;
  ferment?: Ferment;
}
