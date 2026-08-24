/**
 * Load and resolve the whole site once.
 *
 * Every route and every integrity check reads from the result, so no two
 * consumers can disagree about what a drink is. Resolution is: flatten the
 * transclusion, join each line to its Ingredient and Form, compute the spec and
 * the timing, and render the prose at the default count.
 *
 * Everything unresolvable is COLLECTED rather than thrown. The integrity report
 * should be able to name every broken reference on the site in one pass, not
 * stop at the first.
 */

import { computeBrew, type BrewResult } from '../math/brewing.ts';
import { computeDrinkSpec, type DrinkSpec } from '../math/spec.ts';
import { computeTiming, type Timing } from '../math/timing.ts';
import type {
  Bitterness,
  Brew,
  DrinkVersion,
  Ingredient,
  IngredientLine,
  ResolvedLine,
  Step,
} from '../math/types.ts';
import { renderProse } from '../render/prose.ts';
import { flatten, type FlattenIssue } from '../transclusion/flatten.ts';
import type { AboutFile, FamilyFile, LoadedContent } from './disk.ts';

export interface ResolveIssue {
  kind:
    | 'unresolved-ingredient'
    | 'unresolved-form'
    | 'unresolved-glassware'
    | FlattenIssue['kind'];
  where: string;
  ref: string;
  message: string;
}

export interface Glass {
  id: string;
  name: string;
  capacityMl: number;
  iceDisplacementMl?: Record<string, number>;
}

export interface ResolvedVersion {
  slug: string;
  file: string;
  version: DrinkVersion;
  lines: ResolvedLine[];
  spec: DrinkSpec;
  timing: Timing;
  brew: BrewResult | null;
  glass: Glass | null;
  /** Step prose rendered at the default count, in metric. */
  renderedSteps: Array<{ step: Step; html: string }>;
  /** Which Components were pulled in, for the optional cross-link. */
  components: Array<{ id: string; name: string; occurrences: number }>;
  isDefault: boolean;
  draft: boolean;
  issues: ResolveIssue[];
}

export interface ResolvedDrink {
  slug: string;
  name: string;
  versions: ResolvedVersion[];
  about: AboutFile | null;
}

export interface ResolvedSite {
  drinks: ResolvedDrink[];
  versions: ResolvedVersion[];
  ingredients: Map<string, Ingredient>;
  glassware: Map<string, Glass>;
  families: Map<string, FamilyFile>;
  content: LoadedContent;
  issues: ResolveIssue[];
}

const asGlass = (record: Record<string, unknown>): Glass => ({
  id: String(record['id']),
  name: String(record['name']),
  capacityMl: Number(record['capacityMl']),
  ...(record['iceDisplacementMl']
    ? { iceDisplacementMl: record['iceDisplacementMl'] as Record<string, number> }
    : {}),
});

/** Frontmatter to the engine's own DrinkVersion, with the flattened result. */
function toVersion(
  fm: Record<string, unknown>,
  lines: IngredientLine[],
  steps: Step[],
): DrinkVersion {
  return {
    id: String(fm['id'] ?? 'default'),
    label: String(fm['label'] ?? ''),
    defaultDrinks: Number(fm['defaultDrinks'] ?? 1),
    method: String(fm['method'] ?? ''),
    dilutionClass: String(fm['dilutionClass'] ?? 'none'),
    bitterness: (fm['bitterness'] as Bitterness) ?? 'none',
    batchable: (fm['batchable'] as DrinkVersion['batchable']) ?? 'none',
    lines,
    steps,
    ...(fm['glasswareRef'] ? { glasswareRef: String(fm['glasswareRef']) } : {}),
    ...(fm['iceStyle'] ? { iceStyle: String(fm['iceStyle']) } : {}),
    ...(fm['servedOverIce'] !== undefined ? { servedOverIce: Boolean(fm['servedOverIce']) } : {}),
    ...(fm['serveTempC'] !== undefined ? { serveTempC: Number(fm['serveTempC']) } : {}),
    ...(fm['batchNote'] ? { batchNote: String(fm['batchNote']) } : {}),
    ...(fm['zeroProof'] !== undefined ? { zeroProof: Boolean(fm['zeroProof']) } : {}),
    ...(fm['highProof'] !== undefined ? { highProof: Boolean(fm['highProof']) } : {}),
    ...(fm['brew'] ? { brew: fm['brew'] as Brew } : {}),
    ...(fm['ferment'] ? { ferment: fm['ferment'] as DrinkVersion['ferment'] } : {}),
  };
}

export function resolveSite(content: LoadedContent): ResolvedSite {
  const issues: ResolveIssue[] = [];

  const glassware = new Map<string, Glass>();
  for (const [id, record] of content.glassware) glassware.set(id, asGlass(record));

  const versions: ResolvedVersion[] = [];

  for (const file of content.drinks) {
    const fm = file.frontmatter;
    const where = file.file;

    const flat = flatten(
      { lines: (fm['ingredients'] as IngredientLine[]) ?? [], slots: file.slots },
      content.components,
    );
    for (const issue of flat.issues) {
      issues.push({ kind: issue.kind, where, ref: issue.ref, message: issue.message });
    }

    const lines: ResolvedLine[] = [];
    for (const line of flat.lines) {
      const ingredient = content.ingredients.get(line.ingredientRef);
      if (!ingredient) {
        issues.push({
          kind: 'unresolved-ingredient',
          where,
          ref: line.ingredientRef,
          message: `Line "${line.id}" names an ingredient that does not exist.`,
        });
        continue;
      }
      const wanted = line.formRef ?? 'standard';
      const form = ingredient.forms.find((f) => f.id === wanted);
      if (!form) {
        issues.push({
          kind: 'unresolved-form',
          where,
          ref: `${line.ingredientRef}.${wanted}`,
          message: `Ingredient "${ingredient.id}" has no Form "${wanted}".`,
        });
        continue;
      }
      lines.push({ line, ingredient, form });
    }

    const version = toVersion(fm, flat.lines, flat.steps);

    let glass: Glass | null = null;
    if (version.glasswareRef) {
      glass = glassware.get(version.glasswareRef) ?? null;
      if (!glass) {
        issues.push({
          kind: 'unresolved-glassware',
          where,
          ref: version.glasswareRef,
          message: `No glassware with id "${version.glasswareRef}".`,
        });
      }
    }

    const spec = computeDrinkSpec(version, lines);
    const source = { lines, steps: version.steps, defaultDrinks: version.defaultDrinks };

    versions.push({
      slug: file.slug,
      file: where,
      version,
      lines,
      spec,
      timing: computeTiming(version.steps),
      brew: version.brew ? computeBrew(version.brew) : null,
      glass,
      renderedSteps: version.steps.map((step) => ({
        step,
        html: renderProse(step.prose, { source, drinks: version.defaultDrinks, system: 'metric' }),
      })),
      components: flat.components,
      isDefault: /(?:^|[\\/])index\.mdx$/.test(where),
      draft: fm['draft'] === true,
      issues: [],
    });
  }

  const bySlug = new Map<string, ResolvedVersion[]>();
  for (const v of versions) {
    const list = bySlug.get(v.slug) ?? [];
    list.push(v);
    bySlug.set(v.slug, list);
  }

  const drinks: ResolvedDrink[] = [...bySlug].map(([slug, list]) => ({
    slug,
    name: String(
      content.drinks.find((d) => d.slug === slug && /index\.mdx$/.test(d.file))?.frontmatter[
        'name'
      ] ??
        list[0]?.version.label ??
        slug,
    ),
    // The default version leads: it is what the title, the description, the
    // structured data and the catalogue row all derive from.
    versions: [...list].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)),
    about: content.abouts.get(slug) ?? null,
  }));

  return {
    drinks,
    versions,
    ingredients: content.ingredients,
    glassware,
    families: content.families,
    content,
    issues,
  };
}
