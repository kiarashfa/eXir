/**
 * Fetching the build-time exports from the browser.
 *
 * Two things live here rather than at each call site. The base path, because
 * the site is served under a prefix and a root-relative fetch 404s silently —
 * the same trap the search core fell into. And the caching, because My Bar and
 * the Plan both want the same two index files and a reader moving between them
 * should pay once.
 */

import type { CatalogIndex, DrinkDetail, IngredientIndex } from '../catalog.ts';

/**
 * The prefix, taken from the document rather than from the bundle.
 *
 * Stamped on the root element by the layout, so one place decides it and a
 * client module never has to be built with a base path compiled into it.
 */
export const base = (): string => document.documentElement.dataset['base'] ?? '';

const cache = new Map<string, Promise<unknown>>();

async function json<T>(path: string): Promise<T> {
  const url = `${base()}${path}`;
  const existing = cache.get(url) as Promise<T> | undefined;
  if (existing) return existing;

  const request = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.json() as Promise<T>;
  });
  cache.set(url, request);
  // A failed request must not poison the cache: a reader who reconnects and
  // retries would otherwise get the same rejection for the life of the page.
  request.catch(() => cache.delete(url));
  return request;
}

export const loadCatalog = (): Promise<CatalogIndex> =>
  json<CatalogIndex>('/catalog-index.json');

export const loadIngredients = (): Promise<IngredientIndex> =>
  json<IngredientIndex>('/ingredient-index.json');

export const loadDetail = (slug: string): Promise<DrinkDetail> =>
  json<DrinkDetail>(`/drink-detail/${slug}.json`);

/**
 * Every detail a plan needs, in parallel, tolerating the ones that have gone.
 *
 * A drink removed since the plan was saved answers 404, and that is a normal
 * outcome rather than an error: resolution reports it as a dropped item with a
 * reason, which is the behaviour a reader can act on.
 */
export async function loadDetails(slugs: string[]): Promise<Map<string, DrinkDetail>> {
  const out = new Map<string, DrinkDetail>();
  await Promise.all(
    [...new Set(slugs)].map(async (slug) => {
      try {
        out.set(slug, await loadDetail(slug));
      } catch {
        // Left absent. `resolvePlan` names it in the dropped list.
      }
    }),
  );
  return out;
}
