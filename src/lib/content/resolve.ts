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
    | 'unresolved-brew-ref'
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

/**
 * A note goes through the same prose renderer as a step, so a note may name a
 * quantity the same way a step does — and so the literal-number rule reaches it.
 * A note is the obvious place for a stray "about 30 ml" to survive otherwise.
 */
export interface ResolvedNote {
  kind: 'technique' | 'pitfall';
  stepRef?: string;
  html: string;
}

export interface ResolvedSubstitution {
  lineRef: string;
  substitute: string;
  formRef?: string;
  ratio?: string;
  note: string;
  impact?: { flavour?: string; strength?: string; sweetness?: string };
}

export interface ResolvedVersion {
  slug: string;
  file: string;
  /**
   * The authored frontmatter, kept alongside the engine's view of it.
   *
   * The engine's DrinkVersion is deliberately only what the maths needs, so
   * everything editorial — names, tags, image, subtitle, difficulty — has no
   * home there and would otherwise be re-found by filename at every call site.
   */
  frontmatter: Record<string, unknown>;
  version: DrinkVersion;
  notes: ResolvedNote[];
  substitutions: ResolvedSubstitution[];
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
  techniques: Map<string, FamilyFile>;
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

/** The authored brew block, before its dose and water are read off the lines. */
interface AuthoredBrew extends Omit<Brew, 'doseG' | 'waterMl'> {
  doseRef: string;
  waterRef: string;
}

/**
 * Fill in the brew figures from the lines the block names.
 *
 * A brewed drink's ratio is its headline number, and it used to be computable
 * from two places at once — the brew block and the ingredient list — with
 * nothing comparing them. Now the list is the only place either figure is
 * written down.
 *
 * A dose has to be a mass and brew water a volume, because that is what a ratio
 * of g to ml means. Anything else is reported rather than converted: converting
 * would silently accept a line that says something different from what the
 * author meant.
 */
function resolveBrew(
  authored: AuthoredBrew,
  lines: IngredientLine[],
  where: string,
  issues: ResolveIssue[],
): Brew | null {
  const read = (ref: string, unit: 'g' | 'ml', role: string): number | null => {
    const line = lines.find((l) => l.id === ref);
    if (!line) {
      issues.push({
        kind: 'unresolved-brew-ref',
        where,
        ref,
        message: `The brew block's ${role} names line "${ref}", which is not a line in this version.`,
      });
      return null;
    }
    if (line.unit !== unit) {
      issues.push({
        kind: 'unresolved-brew-ref',
        where,
        ref,
        message: `The brew block's ${role} names line "${ref}", which is authored in ${line.unit}. A ${role} is measured in ${unit}.`,
      });
      return null;
    }
    return line.amount;
  };

  const doseG = read(authored.doseRef, 'g', 'dose');
  const waterMl = read(authored.waterRef, 'ml', 'water');
  if (doseG === null || waterMl === null) return null;

  // The refs stay on the resolved block: the engine needs them to tell a brew
  // input apart from a line added to the cup afterwards.
  return { ...authored, doseG, waterMl };
}

/** Frontmatter to the engine's own DrinkVersion, with the flattened result. */
function toVersion(
  fm: Record<string, unknown>,
  lines: IngredientLine[],
  steps: Step[],
  brew: Brew | null,
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
    ...(fm['ferment'] ? { ferment: fm['ferment'] as DrinkVersion['ferment'] } : {}),
    ...(brew ? { brew } : {}),
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

    const brew = fm['brew']
      ? resolveBrew(fm['brew'] as AuthoredBrew, flat.lines, where, issues)
      : null;

    const version = toVersion(fm, flat.lines, flat.steps, brew);

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

    const rawNotes = (fm['notes'] as Array<Record<string, unknown>> | undefined) ?? [];

    versions.push({
      slug: file.slug,
      file: where,
      frontmatter: fm,
      version,
      notes: rawNotes.map((n) => ({
        kind: n['kind'] as ResolvedNote['kind'],
        ...(n['stepRef'] ? { stepRef: String(n['stepRef']) } : {}),
        html: renderProse(String(n['text'] ?? ''), {
          source,
          drinks: version.defaultDrinks,
          system: 'metric',
        }),
      })),
      substitutions: (fm['substitutions'] as ResolvedSubstitution[] | undefined) ?? [],
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
    techniques: content.techniques,
    content,
    issues,
  };
}
