/**
 * Is a licence free enough to publish, and is it stated precisely enough to be
 * checked later?
 *
 * Commons answers both questions itself: every file carries a machine-readable
 * licence, and `commons.ts` reads it. The moment images can come from anywhere
 * — Flickr, Openverse, a museum's open-access API, a national Wikipedia — the
 * licence arrives as a human-typed string, and a human-typed string is exactly
 * where "CC BY-NC" gets adopted as "CC BY".
 *
 * So this module is deliberately a WHITELIST with no fuzzy matching. A name it
 * does not recognise is refused rather than guessed at, because the failure it
 * exists to prevent is silent: a non-free photograph on a free site looks
 * identical to a free one until somebody's lawyer notices.
 *
 * What is NOT free, however it is worded:
 *   NC / NonCommercial — this site is non-commercial today and may not be, and
 *                        NC also forbids the mirrors and forks the licence page
 *                        invites.
 *   ND / NoDerivatives — every adopted image is cropped, graded and re-encoded.
 *                        The treatment pipeline makes a derivative by design.
 *   "free to use", "royalty free", "fair use", "educational use", no licence —
 *                        none of these is a licence grant.
 */

export interface Licence {
  /** The canonical name to record in the manifest. */
  name: string;
  /** Whether the licence obliges the derivative to carry the same terms. */
  shareAlike: boolean;
  /** Whether attribution is legally required (it is recorded either way). */
  attributionRequired: boolean;
  /** Set where the platform's blanket terms, not a public licence, allow use. */
  platform?: boolean;
}

/**
 * Public-domain and Creative Commons free-culture licences, plus the three
 * stock-photo platform terms that permit commercial use and modification.
 *
 * The platform ones are marked, because they are a weaker promise than a CC
 * grant: they are the platform's terms of service rather than an irrevocable
 * licence from the photographer, and they can change. eXir credits those
 * photographs anyway — the credit is the site's own norm, not just compliance.
 */
const FREE: Array<{ match: RegExp; licence: Licence }> = [
  // Public domain, in the several ways sources word it.
  { match: /^(cc0|cc[- ]?0 1\.0|creative commons zero)/i, licence: { name: 'CC0 1.0', shareAlike: false, attributionRequired: false } },
  { match: /^(public domain|pd|pd-old|pd-us|no known copyright restrictions|public domain mark)/i, licence: { name: 'Public domain', shareAlike: false, attributionRequired: false } },
  // Attribution, any version.
  { match: /^cc[- ]?by(?![- ]?(nc|nd|sa))[- ]?\d?(\.\d)?$/i, licence: { name: 'CC BY', shareAlike: false, attributionRequired: true } },
  // Attribution-ShareAlike, any version.
  { match: /^cc[- ]?by[- ]?sa[- ]?\d?(\.\d)?$/i, licence: { name: 'CC BY-SA', shareAlike: true, attributionRequired: true } },
  // Platform terms. Named exactly; nothing looser matches.
  { match: /^unsplash( licen[cs]e)?$/i, licence: { name: 'Unsplash License', shareAlike: false, attributionRequired: false, platform: true } },
  { match: /^pexels( licen[cs]e)?$/i, licence: { name: 'Pexels License', shareAlike: false, attributionRequired: false, platform: true } },
  { match: /^pixabay( content)?( licen[cs]e)?$/i, licence: { name: 'Pixabay Content License', shareAlike: false, attributionRequired: false, platform: true } },
];

/** Wordings that are refused before anything else is considered. */
const NEVER = /\b(nc|noncommercial|non-commercial|nd|noderiv|no derivatives|fair use|educational use only|all rights reserved|rights[- ]managed|royalty[- ]free|free to use|unknown|unclear|editorial use)\b/i;

export interface LicenceVerdict {
  ok: boolean;
  licence?: Licence;
  reason?: string;
}

/**
 * Read a stated licence, keeping the version the source printed.
 *
 * The whitelist matches the FAMILY ("CC BY-SA"); the version is carried
 * through from what was typed, because "CC BY-SA 4.0" and "CC BY-SA 2.0" are
 * different documents and the credit has to name the right one.
 */
export function readLicence(stated: string | undefined): LicenceVerdict {
  const raw = (stated ?? '').trim();
  if (!raw) return { ok: false, reason: 'no licence stated' };
  if (NEVER.test(raw)) {
    return { ok: false, reason: `"${raw}" is not a free licence (NC, ND, or no grant at all)` };
  }

  // Strip a trailing "DEED", a trailing country code and any surrounding
  // punctuation the way sources actually print these: "CC BY-SA 4.0 DEED",
  // "CC BY 2.0 FR", "(CC BY 3.0)".
  const cleaned = raw
    .replace(/[()]/g, '')
    .replace(/\bdeed\b/i, '')
    .replace(/\b(int(ernational)?|generic|unported|[a-z]{2})\b$/i, '')
    .trim();
  const version = cleaned.match(/\d(\.\d)?/)?.[0];
  const family = cleaned.replace(/\d(\.\d)?/, '').replace(/\s+/g, ' ').trim();

  for (const { match, licence } of FREE) {
    if (match.test(cleaned) || match.test(family)) {
      // Only the two versioned families take the stated version. CC0 and the
      // platform terms carry their version (or none) in the canonical name
      // already, and appending one produced "CC0 1.0 0".
      const versioned = licence.name === 'CC BY' || licence.name === 'CC BY-SA';
      const name = versioned && version ? `${licence.name} ${version}` : licence.name;
      return { ok: true, licence: { ...licence, name } };
    }
  }
  return { ok: false, reason: `"${raw}" is not on the free-licence whitelist` };
}

/** Sources whose own terms are known, so a mistyped licence can be caught. */
export const KNOWN_SOURCES: Record<string, string> = {
  'wikimedia commons': 'per-file licence',
  wikipedia: 'per-file licence — a LOCAL upload is often non-free, unlike a Commons one',
  openverse: 'per-file licence',
  flickr: 'per-file licence',
  wikidata: 'per-file licence',
  unsplash: 'Unsplash License',
  pexels: 'Pexels License',
  pixabay: 'Pixabay Content License',
  'met museum': 'CC0 1.0',
  smithsonian: 'CC0 1.0',
  europeana: 'per-item licence',
  rijksmuseum: 'Public domain',
  usda: 'Public domain',
  nih: 'Public domain',
};
