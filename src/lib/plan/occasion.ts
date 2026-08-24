/**
 * What a host actually needs — the Plan's occasion view.
 *
 * Every figure here is either computed from the same engine output the drink
 * pages show, or derived from a denominator stated in `service-standards.json`
 * and printed beside the answer. That distinction is the whole discipline: a
 * bottle count with no stated bottle size, or an ice figure with no stated
 * allowance, is an invented number wearing a computed one's clothes.
 *
 * The single most useful thing this can tell someone is that **timing does not
 * scale the way they assume**. Twelve drinks made to order is twelve stirs;
 * twelve batched is one. The ice arithmetic says the same thing from the other
 * side — batched service buys no mixing ice at all, because the dilution goes
 * in as water.
 */

import standards from '../../data/service-standards.json' with { type: 'json' };
import { scaleOf, type ResolvedItem } from './resolve.ts';
import type { ShoppingLine } from './aggregate.ts';
import type { IndexedIngredient } from '../catalog.ts';
import type { PlanState } from './store.ts';

export const ICE = standards.ice;
export const BOTTLE = standards.bottle;

export interface BottleEstimate {
  ingredientRef: string;
  name: string;
  totalMl: number;
  bottleMl: number;
  bottles: number;
  /** Which standard the size came from, shown beside the figure. */
  basis: string;
}

export interface IceEstimate {
  /** Meltwater the dilution model says the drinks take on. Computed. */
  chillingG: number;
  /** Ice charged into a shaker or mixing glass and discarded. A stated allowance. */
  mixingG: number;
  /** Ice in the glass at service, weighed from the glassware's own displacement. */
  servingG: number;
  /** A stated share of everything above, for what melts before it reaches a drink. */
  meltG: number;
  totalG: number;
  /** How much less a fully batched plan would need. The argument for batching. */
  savedByBatchingG: number;
}

export interface GlassCount {
  id: string;
  name: string;
  drinks: number;
}

export interface GarnishCount {
  ingredientRef: string;
  name: string;
  count: number;
  label: string;
}

export interface LeadTime {
  id: string;
  name: string;
  days: number;
  storage: string;
}

export interface OccasionView {
  /** guests × drinksPerGuest — the target. */
  targetDrinks: number;
  /** What the plan's items actually add up to. */
  plannedDrinks: number;
  bottles: BottleEstimate[];
  ice: IceEstimate;
  glasses: GlassCount[];
  garnishes: GarnishCount[];
  /** The earliest safe make-ahead day, set by the shortest shelf life. */
  leadTimeDays: number | null;
  preparations: LeadTime[];
  timing: {
    /** Active seconds at the planned counts, in the modes the plan names. */
    activeSec: number;
    /** The same plan if every item were made one at a time. */
    activeIfAllToOrderSec: number;
    /** And if every batchable item were batched. */
    activeIfAllBatchedSec: number;
  };
}

const round = (value: number): number => Math.round(value);

export function buildOccasion(
  items: ResolvedItem[],
  plan: PlanState,
  lines: ShoppingLine[],
  ingredients: Map<string, IndexedIngredient>,
): OccasionView {
  // ---- bottles ------------------------------------------------------------
  // Only bottled goods. Juice, syrup, sugar and a lemon have no standard
  // package, and inferring one would be exactly the guess the shopping list
  // refuses to make.
  const bottles = lines
    .filter((l) => l.bottled && l.unit === 'ml')
    .map((l): BottleEstimate => {
      const country = l.countryOfOrigin ?? '';
      const override = (BOTTLE.byCountry as Record<string, number>)[country];
      const bottleMl = override ?? BOTTLE.defaultMl;
      return {
        ingredientRef: l.ingredientRef,
        name: l.name,
        totalMl: l.amount,
        bottleMl,
        bottles: Math.ceil(l.amount / bottleMl),
        basis: override ? `${country} standard bottle` : 'standard bottle',
      };
    })
    .sort((a, b) => b.totalMl - a.totalMl);

  // ---- ice ----------------------------------------------------------------
  let chillingG = 0;
  let mixingG = 0;
  let servingG = 0;
  /** The same plan with nothing batched, for the comparison the page shows. */
  let toOrderChillingG = 0;
  let toOrderMixingG = 0;

  for (const resolved of items) {
    const { version } = resolved;
    const count = resolved.item.drinks;
    const takesIce = version.dilutionMlPerDrink > 0;
    // A BATCH MEETS NO ICE. The dilution it needs is bought as water and shows
    // on the shopping list as water, so counting it here as well would put the
    // same litre on the list twice under two names — and would quietly cancel
    // the saving the page is about to claim for batching.
    const meetsIce = takesIce && resolved.service !== 'batch';

    // Meltwater is water: one millilitre of dilution is one gram of ice gone.
    if (meetsIce) chillingG += version.dilutionMlPerDrink * count;
    if (meetsIce) mixingG += ICE.mixingGPerDrink * count;

    if (takesIce) {
      toOrderChillingG += version.dilutionMlPerDrink * count;
      toOrderMixingG += ICE.mixingGPerDrink * count;
    }

    servingG += version.serviceIceMl * ICE.densityGPerMl * count;
  }

  const subtotal = chillingG + mixingG + servingG;
  const meltG = subtotal * ICE.meltAllowance;
  const totalG = subtotal + meltG;
  const allToOrder =
    (toOrderChillingG + toOrderMixingG + servingG) * (1 + ICE.meltAllowance);

  // ---- glasses ------------------------------------------------------------
  const glassMap = new Map<string, GlassCount>();
  for (const resolved of items) {
    const glass = resolved.version.glass;
    if (!glass) continue;
    const existing = glassMap.get(glass.id);
    if (existing) existing.drinks += resolved.item.drinks;
    else glassMap.set(glass.id, { id: glass.id, name: glass.name, drinks: resolved.item.drinks });
  }

  // ---- garnishes ----------------------------------------------------------
  // Only the countable ones. "Twelve oranges" is a shopping instruction; "1 680
  // g of orange" is the same fact in a form nobody can act on at a market.
  const garnishes: GarnishCount[] = [];
  for (const line of lines) {
    if (!line.garnish || !line.countUnit) continue;
    const per = line.unit === 'ml' ? line.countUnit.ml : line.countUnit.g;
    if (!per) continue;
    const count = Math.ceil(line.amount / per);
    garnishes.push({
      ingredientRef: line.ingredientRef,
      name: line.name,
      count,
      label: count === 1 ? line.countUnit.singular : line.countUnit.plural,
    });
  }

  // ---- lead time ----------------------------------------------------------
  // The shortest shelf life sets the window: everything can be made that many
  // days ahead, and no further, because the first thing to turn decides it.
  const preparations: LeadTime[] = [];
  for (const line of lines) {
    const ingredient = ingredients.get(line.ingredientRef);
    if (ingredient?.kind !== 'preparation' || !ingredient.shelfLife) continue;
    preparations.push({
      id: ingredient.id,
      name: ingredient.name,
      days: ingredient.shelfLife.days,
      storage: ingredient.shelfLife.storage,
    });
  }
  for (const id of Object.keys(plan.makePreparations)) {
    const ingredient = ingredients.get(id);
    if (
      plan.makePreparations[id] !== 'make' ||
      ingredient?.kind !== 'preparation' ||
      !ingredient.shelfLife ||
      preparations.some((p) => p.id === id)
    ) {
      continue;
    }
    preparations.push({
      id,
      name: ingredient.name,
      days: ingredient.shelfLife.days,
      storage: ingredient.shelfLife.storage,
    });
  }
  preparations.sort((a, b) => a.days - b.days || a.name.localeCompare(b.name));

  // ---- timing -------------------------------------------------------------
  let activeSec = 0;
  let toOrderSec = 0;
  let batchedSec = 0;
  for (const resolved of items) {
    const active = resolved.version.timing.prepSec + resolved.version.timing.makeSec;
    const scale = scaleOf(resolved);
    // Made to order, active time scales with the count: twelve drinks is twelve
    // stirs. Batched, it does not: one combine, one dilution, one chill.
    const perOrder = active * scale;
    const perBatch = active;
    activeSec += resolved.service === 'batch' ? perBatch : perOrder;
    toOrderSec += perOrder;
    batchedSec += resolved.version.batchable === 'none' ? perOrder : perBatch;
  }

  return {
    targetDrinks: plan.occasion.guests * plan.occasion.drinksPerGuest,
    plannedDrinks: items.reduce((sum, i) => sum + i.item.drinks, 0),
    bottles,
    ice: {
      chillingG: round(chillingG),
      mixingG: round(mixingG),
      servingG: round(servingG),
      meltG: round(meltG),
      totalG: round(totalG),
      savedByBatchingG: round(Math.max(0, allToOrder - totalG)),
    },
    glasses: [...glassMap.values()].sort((a, b) => b.drinks - a.drinks),
    garnishes: garnishes.sort((a, b) => b.count - a.count),
    leadTimeDays: preparations.length ? preparations[0]!.days : null,
    preparations,
    timing: {
      activeSec: round(activeSec),
      activeIfAllToOrderSec: round(toOrderSec),
      activeIfAllBatchedSec: round(batchedSec),
    },
  };
}
