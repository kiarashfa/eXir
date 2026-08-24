/**
 * Everything about one drink, fetched on demand rather than shipped with the
 * catalogue: full ingredient lines, per-drink composition, keeping, and each
 * version separately.
 */
import type { APIRoute } from 'astro';

import { published, site } from '../../lib/content/site.ts';

export async function getStaticPaths() {
  const resolved = await site();
  return published(resolved).map((drink) => ({ params: { slug: drink.slug }, props: { drink } }));
}

export const GET: APIRoute = ({ props }) => {
  const { drink } = props as { drink: Awaited<ReturnType<typeof site>>['drinks'][number] };

  const body = {
    slug: drink.slug,
    name: drink.name,
    summary: String(drink.about?.frontmatter['summary'] ?? ''),
    versions: drink.versions.map((v) => ({
      id: v.version.id,
      label: v.version.label,
      isDefault: v.isDefault,
      defaultDrinks: v.version.defaultDrinks,
      method: v.version.method,
      batchable: v.version.batchable,
      glass: v.glass ? { id: v.glass.id, name: v.glass.name, capacityMl: v.glass.capacityMl } : null,
      lines: v.lines.map((r) => ({
        id: r.line.id,
        ingredientRef: r.line.ingredientRef,
        form: r.form.id,
        name: r.ingredient.name,
        amount: r.line.amount,
        unit: r.line.unit,
        garnish: r.line.garnish === true,
        preparation: r.ingredient.kind === 'preparation',
      })),
      spec: {
        finalVolumeMl: Number(v.spec.finalVolumeMl.toFixed(1)),
        abvPercent: Number(v.spec.alcohol.finalAbvPercent.toFixed(2)),
        pureAlcoholG: Number(v.spec.alcohol.pureAlcoholG.toFixed(2)),
        standardDrinks: v.spec.alcohol.standardDrinks,
        sugarG: Number(v.spec.composition.sugarG.toFixed(2)),
        sugarGPerL: Number(v.spec.sugarGPerL.toFixed(1)),
        acidPercent: Number(v.spec.acidPercentFinal.toFixed(3)),
        kcal: Math.round(v.spec.nutrition.kcal),
        estimated: v.spec.alcohol.abvEstimated,
      },
      timing: v.timing,
      makeAhead: v.frontmatter['makeAhead'] ?? null,
      substitutions: v.substitutions,
    })),
  };

  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
};
