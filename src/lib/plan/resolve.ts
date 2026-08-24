/**
 * Resolving a saved plan against the catalogue as it is today.
 *
 * The plan stores references, so nothing in it is true until it is looked up.
 * A drink that has since been renamed, or a version that has been folded into
 * another, resolves to nothing — and the page says so in one quiet line rather
 * than dropping rows silently. A plan that quietly shrinks is worse than one
 * that explains itself.
 */

import type { CatalogEntry, DetailVersion, DrinkDetail } from '../catalog.ts';
import type { PlanItem, PlanState } from './store.ts';

export interface ResolvedItem {
  item: PlanItem;
  entry: CatalogEntry;
  detail: DrinkDetail;
  version: DetailVersion;
  /**
   * The mode actually used.
   *
   * A saved plan can name batched service for a drink whose recipe has since
   * been marked unbatchable, or one that has fallen below the two-drink floor.
   * Honouring the saved value would compute a batch that cannot be made.
   */
  service: 'order' | 'batch';
  serviceChanged: boolean;
}

export interface Dropped {
  item: PlanItem;
  reason: string;
}

export interface ResolvedPlan {
  items: ResolvedItem[];
  dropped: Dropped[];
}

export const MIN_BATCH_DRINKS = 2;

export function resolvePlan(
  plan: PlanState,
  entries: Map<string, CatalogEntry>,
  details: Map<string, DrinkDetail>,
): ResolvedPlan {
  const items: ResolvedItem[] = [];
  const dropped: Dropped[] = [];

  for (const item of plan.items) {
    const entry = entries.get(item.drink);
    const detail = details.get(item.drink);
    if (!entry || !detail) {
      dropped.push({ item, reason: 'that drink is no longer on the site' });
      continue;
    }

    const version = detail.versions.find((v) => v.id === item.version);
    if (!version) {
      dropped.push({ item, reason: `the "${item.version}" version no longer exists` });
      continue;
    }

    const canBatch = version.batchable !== 'none' && item.drinks >= MIN_BATCH_DRINKS;
    const service = item.service === 'batch' && canBatch ? 'batch' : 'order';

    items.push({
      item,
      entry,
      detail,
      version,
      service,
      serviceChanged: service !== item.service,
    });
  }

  return { items, dropped };
}

/** How many times the recipe is made. Scaling is pure multiplication from here. */
export const scaleOf = (item: ResolvedItem): number =>
  item.item.drinks / Math.max(1, item.version.defaultDrinks);
