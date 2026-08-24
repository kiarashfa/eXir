/**
 * The light per-drink record behind the catalogue and, later, the reverse
 * search. Split from the detail export on purpose: one combined file would work
 * at fifty drinks and be a real problem at sixteen hundred.
 */
import type { APIRoute } from 'astro';

import { catalogEntry, published, site } from '../lib/content/site.ts';
import attributions from '../data/image-attributions.json' with { type: 'json' };

export const GET: APIRoute = async () => {
  const resolved = await site();
  const entries = published(resolved)
    .map((d) => catalogEntry(d, resolved.ingredients, attributions as never))
    .sort((a, b) => a.title.localeCompare(b.title));

  return new Response(JSON.stringify({ generated: entries.length, drinks: entries }), {
    headers: { 'content-type': 'application/json' },
  });
};
