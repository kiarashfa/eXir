/**
 * Wikimedia Commons — the primary source for every photograph on the site.
 *
 * Search and metadata only; the CLI lives in `images.ts`.
 *
 * The licence is per file and must travel with the image, because the pipeline
 * crops and grades it and that produces a derivative work. ShareAlike then
 * requires the result be offered under the same terms and that the modification
 * be indicated, so `license` and a `modified` note are carried on every record.
 * Where quality is comparable, prefer CC-BY or public domain over CC-BY-SA.
 */

import { fetchJson } from './http.ts';

const API = 'https://commons.wikimedia.org/w/api.php';

const INIT: RequestInit = {
  headers: { 'User-Agent': 'eXir/0.1 (drinks encyclopedia; https://github.com/kiarashfa/eXir)' },
};

export interface Candidate {
  title: string;
  pageId: number;
  url: string;
  descriptionUrl: string;
  width: number;
  height: number;
  mime: string;
  sizeBytes: number;
  artist: string | null;
  credit: string | null;
  licenseShortName: string | null;
  licenseUrl: string | null;
  /** True where the licence obliges us to license the derivative alike. */
  shareAlike: boolean;
  /** True where no attribution is legally required (still credited anyway). */
  publicDomain: boolean;
}

interface ApiImageInfo {
  url: string;
  descriptionurl: string;
  width: number;
  height: number;
  mime: string;
  size: number;
  extmetadata?: Record<string, { value?: string }>;
}

interface ApiPage {
  pageid: number;
  title: string;
  imageinfo?: ApiImageInfo[];
}

const stripHtml = (value: string | undefined): string | null =>
  value === undefined ? null : value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() || null;

function toCandidate(page: ApiPage): Candidate | null {
  const info = page.imageinfo?.[0];
  if (!info) return null;
  const meta = info.extmetadata ?? {};
  const license = stripHtml(meta['LicenseShortName']?.value);

  return {
    title: page.title,
    pageId: page.pageid,
    url: info.url,
    descriptionUrl: info.descriptionurl,
    width: info.width,
    height: info.height,
    mime: info.mime,
    sizeBytes: info.size,
    artist: stripHtml(meta['Artist']?.value),
    credit: stripHtml(meta['Credit']?.value),
    licenseShortName: license,
    licenseUrl: stripHtml(meta['LicenseUrl']?.value),
    shareAlike: /sa/i.test(license ?? '') && !/^cc0/i.test(license ?? ''),
    publicDomain: /public domain|^cc0/i.test(license ?? ''),
  };
}

export async function search(query: string, limit = 12): Promise<Candidate[]> {
  const url =
    `${API}?action=query&format=json&origin=*` +
    `&generator=search&gsrsearch=${encodeURIComponent(`filetype:bitmap ${query}`)}` +
    `&gsrnamespace=6&gsrlimit=${limit}` +
    '&prop=imageinfo&iiprop=url|size|mime|extmetadata' +
    '&iiurlwidth=1600';

  const result = await fetchJson<{ query?: { pages?: Record<string, ApiPage> } }>(url, {
    init: INIT,
    onRetry: (n, why) => console.error(`  retry ${n}: ${why}`),
  });

  return Object.values(result.query?.pages ?? {})
    .map(toCandidate)
    .filter((c): c is Candidate => c !== null)
    // A thumbnail of a thumbnail is not worth grading. The hero rendition is
    // 1600px wide, so anything below it is being enlarged to fill the frame.
    .filter((c) => c.width >= 1000)
    .sort((a, b) => b.width * b.height - a.width * a.height);
}

export async function byTitle(title: string): Promise<Candidate | null> {
  const url =
    `${API}?action=query&format=json&origin=*&titles=${encodeURIComponent(title)}` +
    '&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=1600';

  const result = await fetchJson<{ query?: { pages?: Record<string, ApiPage> } }>(url, {
    init: INIT,
    onRetry: (n, why) => console.error(`  retry ${n}: ${why}`),
  });

  for (const page of Object.values(result.query?.pages ?? {})) {
    const candidate = toCandidate(page);
    if (candidate) return candidate;
  }
  return null;
}

/**
 * The attribution a page and the central manifest both render.
 *
 * Only the fields actually present are included. A placeholder like
 * "credit: unknown" is worse than an absent line: it claims the question was
 * asked and answered.
 */
export function attribution(candidate: Candidate): Record<string, string> {
  const record: Record<string, string> = {
    source: 'Wikimedia Commons',
    file: candidate.title,
    sourceUrl: candidate.descriptionUrl,
  };
  if (candidate.artist) record['author'] = candidate.artist;
  if (candidate.credit && candidate.credit !== candidate.artist) record['credit'] = candidate.credit;
  if (candidate.licenseShortName) record['license'] = candidate.licenseShortName;
  if (candidate.licenseUrl) record['licenseUrl'] = candidate.licenseUrl;
  // Required by ShareAlike, and honest under every other licence too.
  record['modified'] = 'Cropped, white-balanced, graded and re-encoded to WebP by eXir.';
  return record;
}
