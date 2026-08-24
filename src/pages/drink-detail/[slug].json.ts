/**
 * Everything about one drink, fetched on demand rather than shipped with the
 * catalogue: full ingredient lines, per-drink composition, keeping, and each
 * version separately.
 *
 * A plan holds a handful of drinks, so a handful of these is a handful of
 * requests. Folding the same fields into the catalogue index would put them on
 * every page that shows a card grid, for readers who will never open a plan.
 */
import type { APIRoute } from 'astro';

import type { DetailVersion, DrinkDetail } from '../../lib/catalog.ts';
import { published, site } from '../../lib/content/site.ts';
import { iceStyleOf } from '../../lib/math/glassware.ts';
import type { BaseUnit } from '../../lib/math/types.ts';

export async function getStaticPaths() {
  const resolved = await site();
  return published(resolved).map((drink) => ({ params: { slug: drink.slug }, props: { drink } }));
}

export const GET: APIRoute = ({ props }) => {
  const { drink } = props as { drink: Awaited<ReturnType<typeof site>>['drinks'][number] };

  const body: DrinkDetail = {
    slug: drink.slug,
    name: drink.name,
    summary: String(drink.about?.frontmatter['summary'] ?? ''),
    versions: drink.versions.map((v): DetailVersion => {
      const iceStyle = iceStyleOf(v.version);
      return {
        id: v.version.id,
        label: v.version.label,
        isDefault: v.isDefault,
        defaultDrinks: v.version.defaultDrinks,
        method: v.version.method,
        batchable: v.version.batchable,
        glass: v.glass
          ? { id: v.glass.id, name: v.glass.name, capacityMl: v.glass.capacityMl }
          : null,
        // The same displacement figure the build-time fit check reads. The
        // occasion view weighs it; the check compares it against a capacity.
        // Two consumers, one number, so a host's ice and a drink's fit can
        // never describe different glasses.
        serviceIceMl: v.glass?.iceDisplacementMl?.[iceStyle] ?? 0,
        iceStyle,
        // Per drink, like every other line. In batched service this is the
        // water the engine inserts; made to order it is what melts off the ice.
        // One figure, two readings.
        dilutionMlPerDrink: Number(v.spec.dilution.dilutionMl.toFixed(2)),
        lines: v.lines.map((r) => ({
          id: r.line.id,
          ingredientRef: r.line.ingredientRef,
          form: r.form.id,
          name: r.ingredient.name,
          amount: r.line.amount,
          unit: r.line.unit as BaseUnit,
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
        timing: {
          prepSec: v.timing.prepSec,
          makeSec: v.timing.makeSec,
          restSec: v.timing.restSec,
          totalSec: v.timing.totalSec,
        },
        makeAhead: v.frontmatter['makeAhead'] ?? null,
        substitutions: v.substitutions,
      };
    }),
  };

  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
};
