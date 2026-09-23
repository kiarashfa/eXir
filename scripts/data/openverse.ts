/**
 * Openverse search — everything free that is NOT on Wikimedia Commons.
 *
 * Commons is the first place to look and `commons.ts` stays the way to look
 * there. Openverse is the second: one API over Flickr, museum open-access
 * collections, Nappy, and others, with a machine-readable licence on every
 * record. That last part is why it is preferred over searching those sites
 * individually — a licence read off an API is a licence nobody had to retype.
 *
 * The licence filter is applied at the QUERY, not afterwards: asking the API
 * for only free licences means an NC photograph is never in front of anyone to
 * be adopted by mistake. `licence.ts` still checks what comes back, because two
 * gates cost nothing and the failure is silent.
 */

import { fetchJson } from './http.ts';

const ENDPOINT = 'https://api.openverse.org/v1/images/';

/** CC0, Public Domain Mark, CC BY and CC BY-SA. Deliberately no NC, no ND. */
const FREE_LICENCES = 'cc0,pdm,by,by-sa';

export interface OpenverseCandidate {
  id: string;
  title: string;
  /** The direct image URL — what `adopt-url` downloads. */
  url: string;
  /** The page the image lives on — what the manifest records as sourceUrl. */
  pageUrl: string;
  creator: string;
  /** As the API states it, e.g. "CC BY-SA 2.0". */
  licence: string;
  licenceUrl: string;
  /** "flickr", "smithsonian", … — recorded as the manifest's `source`. */
  provider: string;
  width?: number;
  height?: number;
}

const TITLE_CASE: Record<string, string> = {
  cc0: 'CC0',
  pdm: 'Public domain',
  by: 'CC BY',
  'by-sa': 'CC BY-SA',
};

/** "by-sa" + "2.0" as the API returns them, into what a credit line says. */
export const licenceName = (code: string, version?: string): string => {
  const base = TITLE_CASE[code.toLowerCase()] ?? code.toUpperCase();
  if (base === 'Public domain' || base === 'CC0') return base === 'CC0' ? 'CC0 1.0' : base;
  return version ? `${base} ${version}` : base;
};

export async function searchOpenverse(
  query: string,
  limit = 10,
): Promise<OpenverseCandidate[]> {
  const url =
    `${ENDPOINT}?q=${encodeURIComponent(query)}` +
    `&license=${FREE_LICENCES}&page_size=${Math.min(limit, 20)}&mature=false`;

  const body = (await fetchJson(url)) as {
    results?: Array<Record<string, unknown>>;
  };

  return (body.results ?? []).map((r) => ({
    id: String(r['id'] ?? ''),
    title: String(r['title'] ?? 'untitled'),
    url: String(r['url'] ?? ''),
    pageUrl: String(r['foreign_landing_url'] ?? r['url'] ?? ''),
    creator: String(r['creator'] ?? 'unknown'),
    licence: licenceName(String(r['license'] ?? ''), r['license_version'] as string | undefined),
    licenceUrl: String(r['license_url'] ?? ''),
    provider: String(r['source'] ?? r['provider'] ?? 'Openverse'),
    ...(typeof r['width'] === 'number' ? { width: r['width'] } : {}),
    ...(typeof r['height'] === 'number' ? { height: r['height'] } : {}),
  }));
}
