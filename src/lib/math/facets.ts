/**
 * The derived facets: base spirit, strength, serving temperature, diet,
 * allergens.
 *
 * Every one of them is computed from the flattened ingredient list. None of
 * them is ever tagged on a drink. The base spirit in particular is the
 * most-used browsing axis for cocktails, and as a tag it would be both
 * forgettable and able to go stale the moment an ingredient was swapped.
 */

import baseSpiritsData from '../../data/taxonomy/base-spirits.json' with { type: 'json' };
import { ZERO_PROOF_MAX_ABV } from './alcohol.ts';
import type {
  Allergen,
  AnimalOrigin,
  BaseSpirit,
  Diet,
  ResolvedLine,
  ServingTemp,
  Strength,
} from './types.ts';

const CATEGORY_TO_SPIRIT = baseSpiritsData.map as Record<string, BaseSpirit>;

// ---------------------------------------------------------------------------
// Base spirit
// ---------------------------------------------------------------------------

export interface SpiritContribution {
  spirit: BaseSpirit;
  /** Millilitres of pure ethanol this category contributes. */
  alcoholMl: number;
  shareOfAlcohol: number;
}

/**
 * Ranked by alcohol contribution, so a drink built out of gin reads as a gin
 * drink even when it also carries a dash of something else. A drink may
 * genuinely have more than one.
 */
export function deriveBaseSpirits(lines: ResolvedLine[]): SpiritContribution[] {
  const totals = new Map<BaseSpirit, number>();
  let total = 0;

  for (const { line, ingredient, form } of lines) {
    if (form.abvPercent <= 0) continue;
    const category = ingredient.category;
    const spirit = category ? CATEGORY_TO_SPIRIT[category] : undefined;
    if (!spirit) continue;

    const volumeMl =
      line.unit === 'ml'
        ? line.amount
        : form.densityGPerMl && form.densityGPerMl > 0
          ? line.amount / form.densityGPerMl
          : 0;
    const alcoholMl = (volumeMl * form.abvPercent) / 100 * (line.consumedFraction ?? 1);
    if (alcoholMl <= 0) continue;

    totals.set(spirit, (totals.get(spirit) ?? 0) + alcoholMl);
    total += alcoholMl;
  }

  if (total <= 0) return [{ spirit: 'none', alcoholMl: 0, shareOfAlcohol: 1 }];

  return [...totals]
    .map(([spirit, alcoholMl]) => ({ spirit, alcoholMl, shareOfAlcohol: alcoholMl / total }))
    .sort((a, b) => b.alcoholMl - a.alcoholMl);
}

// ---------------------------------------------------------------------------
// Strength and serving temperature
// ---------------------------------------------------------------------------

export function deriveStrength(finalAbvPercent: number): Strength {
  if (finalAbvPercent < ZERO_PROOF_MAX_ABV) return 'zero-proof';
  if (finalAbvPercent < 10) return 'low';
  if (finalAbvPercent < 20) return 'medium';
  return 'strong';
}

export interface ServingTempInput {
  /**
   * The drink's own temperature as served, where it is a stated fact about the
   * drink rather than something the method implies. A toddy is hot; nothing in
   * its ingredient list says so.
   */
  serveTempC?: number;
  dilutionClass: string;
  servedOverIce?: boolean;
  brewWaterTempC?: number;
}

export function deriveServingTemp(input: ServingTempInput): ServingTemp {
  const { serveTempC, dilutionClass, servedOverIce, brewWaterTempC } = input;

  // A stated temperature outranks everything the method could imply.
  if (serveTempC != null) {
    if (serveTempC <= -1) return 'frozen';
    if (serveTempC < 10) return servedOverIce ? 'iced' : 'chilled';
    if (serveTempC < 25) return 'room';
    if (serveTempC < 55) return 'warm';
    return 'hot';
  }

  if (dilutionClass === 'blended-with-ice') return 'frozen';
  // A brew served without ice arrives at roughly the temperature it was made at.
  if (brewWaterTempC != null && !servedOverIce) {
    if (brewWaterTempC >= 60) return 'hot';
    if (brewWaterTempC >= 40) return 'warm';
    return 'room';
  }
  if (servedOverIce || dilutionClass === 'built-over-ice') return 'iced';
  if (dilutionClass === 'stirred' || dilutionClass.startsWith('shaken')) return 'chilled';
  return 'room';
}

// ---------------------------------------------------------------------------
// Diet and allergens
// ---------------------------------------------------------------------------

const VEGETARIAN_ORIGINS: ReadonlySet<AnimalOrigin> = new Set<AnimalOrigin>([
  'none',
  'dairy',
  'egg',
  'honey',
]);

export interface DietResult {
  diets: Diet[];
  allergens: Allergen[];
  /**
   * Lines whose Form never declared an animal origin. A vegan claim is withheld
   * while any of these exist: defaulting an unknown to "none" would state as a
   * fact the one thing nobody checked, and isinglass, gelatine, carmine, honey
   * and egg white are all invisible in an ingredient's name.
   */
  undeclaredAnimalOrigin: string[];
  animalOriginNotes: Array<{ lineId: string; note: string }>;
}

export function deriveDiet(lines: ResolvedLine[]): DietResult {
  const allergens = new Set<Allergen>();
  const undeclared: string[] = [];
  const notes: Array<{ lineId: string; note: string }> = [];

  let vegan = true;
  let vegetarian = true;
  let dairyFree = true;
  let glutenFree = true;
  let nutFree = true;
  let caffeineFree = true;

  for (const { line, form } of lines) {
    for (const tag of form.allergenTags ?? []) allergens.add(tag);

    const origin = form.animalOrigin;
    if (origin === undefined) {
      undeclared.push(line.id);
      vegan = false;
      vegetarian = false;
    } else if (origin === 'varies') {
      // Checked, and the answer genuinely depends on the bottle. Same effect on
      // the labels as an undeclared origin, and deliberately not reported as one:
      // the note explains the condition and there is nothing left to fill in.
      vegan = false;
      vegetarian = false;
    } else {
      if (origin !== 'none') vegan = false;
      if (!VEGETARIAN_ORIGINS.has(origin)) vegetarian = false;
      if (origin === 'dairy') dairyFree = false;
    }

    if (form.animalOriginNote) notes.push({ lineId: line.id, note: form.animalOriginNote });

    const tags = form.allergenTags ?? [];
    if (form.containsDairy || tags.includes('dairy')) dairyFree = false;
    if (form.containsGluten || tags.includes('gluten')) glutenFree = false;
    if (tags.includes('nuts') || tags.includes('peanuts')) nutFree = false;
    if (form.containsCaffeine) caffeineFree = false;
  }

  const diets: Diet[] = [];
  if (vegan) diets.push('vegan');
  // Vegan implies vegetarian, and showing both is noise.
  else if (vegetarian) diets.push('vegetarian');
  if (dairyFree) diets.push('dairy-free');
  if (glutenFree) diets.push('gluten-free');
  if (nutFree) diets.push('nut-free');
  if (caffeineFree) diets.push('caffeine-free');

  return {
    diets,
    allergens: [...allergens].sort(),
    undeclaredAnimalOrigin: undeclared,
    animalOriginNotes: notes,
  };
}

/**
 * Shown wherever a computed diet or allergen label appears. Never a bare list.
 *
 * Both labels come out of the same derivation over the listed ingredients, so
 * both carry the same caveat: neither can account for cross-contamination or for
 * the specific product a reader buys.
 */
export const ALLERGEN_DISCLAIMER =
  'Diet and allergen labels are computed from the ingredients listed on this page and ' +
  'nothing else. They cannot account for cross-contamination or for the particular product ' +
  'you buy, and they are not medical or safety guidance.';
