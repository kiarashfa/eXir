/**
 * The whole site, loaded and resolved once.
 *
 * Every route imports from here rather than calling `loadContent` itself, so a
 * build reads the content directory a single time and — more to the point — no
 * two pages can disagree about what a drink is. A drink's ABV on its own page
 * and in the catalogue row that links to it come from the same object.
 *
 * Build-time only. Nothing a client island imports may reach this file: it
 * pulls in the loader, which pulls in the schemas, which pull in Zod.
 */

import path from 'node:path';

import { loadContent } from './disk.ts';
import { resolveSite, type ResolvedDrink, type ResolvedSite, type ResolvedVersion } from './resolve.ts';
import { formatDuration } from '../math/units.ts';
import type { Ingredient } from '../math/types.ts';

let cached: ResolvedSite | null = null;

export async function site(): Promise<ResolvedSite> {
  cached ??= resolveSite(await loadContent(path.resolve('src/content')));
  return cached;
}

/** Published drinks. A draft is work in progress and gets no route. */
export const published = (resolved: ResolvedSite): ResolvedDrink[] =>
  resolved.drinks.filter((d) => !d.versions.every((v) => v.draft));

export const defaultVersion = (drink: ResolvedDrink): ResolvedVersion =>
  drink.versions.find((v) => v.isDefault) ?? drink.versions[0]!;

// ---------------------------------------------------------------------------
// The catalogue row
// ---------------------------------------------------------------------------

/**
 * One light record per drink, derived from the DEFAULT version.
 *
 * A catalogue row represents the drink, and one drink is one entry — a
 * non-default version gets no row of its own. Everything here is either
 * authored once or computed by the engine; nothing is restated.
 */
export interface CatalogEntry {
  slug: string;
  title: string;
  style: string;
  version: string;
  category: string[];
  origin: string[];
  method: string[];
  occasion: string[];
  baseSpirits: string[];
  strength: string;
  servingTemp: string;
  diets: string[];
  allergens: string[];
  abvPercent: number;
  kcal: number;
  sugarGPerL: number;
  totalSec: number;
  totalTime: string;
  difficulty: string;
  steps: number;
  glass: string | null;
  family: string | null;
  preparations: number;
  ingredients: string[];
  summary: string;
  image: { card: string; thumb: string; alt: string } | null;
}

type Manifest = Record<
  string,
  { alt: string; renditions: Record<string, { file: string }> }
>;

const tagList = (v: ResolvedVersion, key: string): string[] => {
  const tags = v.frontmatter['tags'] as Record<string, string[]> | undefined;
  return tags?.[key] ?? [];
};

export function catalogEntry(
  drink: ResolvedDrink,
  ingredients: Map<string, Ingredient>,
  manifest: Manifest,
): CatalogEntry {
  const v = defaultVersion(drink);
  const media = manifest[`drink:${drink.slug}`];

  return {
    slug: drink.slug,
    title: drink.name,
    style: v.version.label,
    version: v.version.id,
    category: tagList(v, 'category'),
    origin: tagList(v, 'origin'),
    method: tagList(v, 'method'),
    occasion: tagList(v, 'occasion'),
    baseSpirits: v.spec.facets.baseSpirits.map((s) => s.spirit).filter((s) => s !== 'none'),
    strength: v.spec.facets.strength,
    servingTemp: v.spec.facets.servingTemp,
    diets: v.spec.facets.diet.diets,
    allergens: v.spec.facets.diet.allergens,
    abvPercent: Number(v.spec.alcohol.finalAbvPercent.toFixed(1)),
    kcal: Math.round(v.spec.nutrition.kcal),
    sugarGPerL: Math.round(v.spec.sugarGPerL),
    totalSec: v.timing.totalSec,
    totalTime: formatDuration(v.timing.totalSec),
    difficulty: String(v.frontmatter['difficulty'] ?? ''),
    steps: v.version.steps.length,
    glass: v.glass?.id ?? null,
    family: (v.frontmatter['family'] as string | undefined) ?? null,
    // A drink needing three house syrups is hard whatever its step count says,
    // so the count is a catalogue signal in its own right.
    preparations: v.lines.filter(
      (l) => ingredients.get(l.line.ingredientRef)?.kind === 'preparation',
    ).length,
    ingredients: v.lines.map((l) => l.line.ingredientRef),
    summary: String(drink.about?.frontmatter['summary'] ?? v.frontmatter['subtitle'] ?? ''),
    image: media?.renditions['card']
      ? {
          card: media.renditions['card'].file,
          thumb: media.renditions['thumb']?.file ?? media.renditions['card'].file,
          alt: media.alt,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Backlinks
// ---------------------------------------------------------------------------

export interface Usage {
  slug: string;
  name: string;
  /** Per default drink, so two recipes are comparable. */
  amount: number;
  unit: 'ml' | 'g';
  formRef: string;
}

/**
 * Which drinks use an ingredient, heaviest first.
 *
 * Sorted by how much of it each drink uses rather than alphabetically:
 * somebody arriving with half a bottle of an amaro wants the drink that will
 * use it, not the one that starts with A.
 */
export function usedIn(resolved: ResolvedSite, ingredientId: string): Usage[] {
  const out: Usage[] = [];
  for (const drink of published(resolved)) {
    for (const v of drink.versions) {
      for (const { line, form } of v.lines) {
        if (line.ingredientRef !== ingredientId) continue;
        out.push({
          slug: drink.slug,
          name: drink.name + (v.isDefault ? '' : ` · ${v.version.label}`),
          amount: line.amount / Math.max(1, v.version.defaultDrinks),
          unit: line.unit,
          formRef: form.id,
        });
      }
    }
  }
  return out.sort((a, b) => b.amount - a.amount);
}
