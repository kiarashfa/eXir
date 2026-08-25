/**
 * Post-build checks over dist/.
 *
 * Everything here needs the rendered HTML, so it runs after `astro build` rather
 * than against the source. It resolves what the browser will actually request:
 * internal links, images and same-page anchors, all under the deployed base path.
 *
 *   node scripts/integrity/site.ts [--dist dist] [--base /eXir]
 *
 * Note this cannot tell you a page has no inbound links at all — every link it
 * checks resolves by definition. Orphan pages are found by walking the route
 * list against the nav and footer by hand.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { Report, parseArgs } from './report.ts';

const args = parseArgs(process.argv.slice(2));
const distDir = typeof args.get('dist') === 'string' ? (args.get('dist') as string) : 'dist';
const base = typeof args.get('base') === 'string' ? (args.get('base') as string) : '/eXir';

const report = new Report();

// Declared up front so a clean run still reports what it looked at. A check
// that ran and found nothing and a check that never ran read identically
// otherwise, and only one of those is good news.
report.ran('links');
report.ran('images');
report.ran('anchors');
report.ran('orphans');
report.ran('noindex');

if (!existsSync(distDir)) {
  console.error(`No build output at ${distDir}. Run \`astro build\` first.`);
  process.exit(1);
}

const pages = await glob('**/*.html', { cwd: distDir, absolute: false });

if (pages.length === 0) {
  console.error(`No HTML found under ${distDir}.`);
  process.exit(1);
}

/** Collect every id and name a fragment could legitimately target. */
function anchorTargets(html: string): Set<string> {
  const ids = new Set<string>();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]!);
  for (const m of html.matchAll(/<a[^>]+name="([^"]+)"/g)) ids.add(m[1]!);
  return ids;
}

/**
 * Map a site-absolute URL onto a file in dist.
 * `/eXir/drinks/negroni/` is emitted as `drinks/negroni/index.html`.
 */
function resolveInternal(url: string): string | null {
  let p = url.split('#')[0]!.split('?')[0]!;
  if (!p.startsWith(base + '/') && p !== base) return null;
  p = p.slice(base.length);
  if (p === '' || p.endsWith('/')) p = `${p}/index.html`.replace(/\/+/g, '/');
  return path.posix.join(distDir, p.replace(/^\//, ''));
}

const existsCache = new Map<string, boolean>();
function fileExists(p: string): boolean {
  const hit = existsCache.get(p);
  if (hit !== undefined) return hit;
  const found = existsSync(p);
  existsCache.set(p, found);
  return found;
}

/**
 * Every page something links to. An orphan is the failure the link check cannot
 * see: every link IT looks at resolves by definition, so a page nothing points
 * at passes silently and is reachable only by typing its address.
 */
const linkedTo = new Set<string>();

for (const page of pages) {
  const html = await readFile(path.join(distDir, page), 'utf8');
  const ids = anchorTargets(html);

  /**
   * A page kept out of the crawl index has to be kept out of the SEARCH index
   * too, and the two are set in different places — a meta tag in the head and
   * an attribute on the body.
   *
   * The failure this catches is quiet and specific: the user-state pages carry
   * prose that names real drinks, so without the attribute they are indexed and
   * turn up under a drink's own name, above nothing useful. Pagefind reports
   * only how many pages it indexed, never which, so nothing else would say so.
   */
  // Matched on `<main>` specifically, not anywhere in the document: the
  // masthead and every listing already carry the attribute, so a document-wide
  // search finds it on every page and the check asserts nothing. Sabotage
  // proved exactly that before this was narrowed.
  if (
    /<meta[^>]+name="robots"[^>]+noindex/i.test(html) &&
    !/<main[^>]*\sdata-pagefind-ignore/i.test(html)
  ) {
    report.error(
      'noindex',
      page,
      'Carries a noindex tag but nothing on it is marked data-pagefind-ignore, so it will be in the search index.',
    );
  }

  const refs = [
    ...[...html.matchAll(/<a[^>]+href="([^"]+)"/g)].map((m) => ({ kind: 'link', url: m[1]! })),
    ...[...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => ({ kind: 'image', url: m[1]! })),
  ];

  for (const { kind, url } of refs) {
    // Off-site, protocol-relative and non-http schemes are out of scope.
    if (/^([a-z]+:)?\/\//i.test(url) || /^(mailto|tel|data):/i.test(url)) continue;

    if (url.startsWith('#')) {
      const target = decodeURIComponent(url.slice(1));
      if (target && !ids.has(target)) {
        report.error('anchors', page, `Fragment "${url}" has no matching id on the page.`);
      }
      continue;
    }

    // A relative href on a trailing-slash site is a maintenance hazard: it
    // resolves against the directory, not the route, and quietly breaks when the
    // page moves. Everything internal should be base-prefixed.
    if (!url.startsWith('/')) {
      report.warn('links', page, `Relative reference "${url}" — prefer a base-prefixed path.`);
      continue;
    }

    if (kind === 'link') {
      const withinBase = url.startsWith(base) ? url.slice(base.length) || '/' : null;
      if (withinBase) linkedTo.add(withinBase.split(/[?#]/)[0] ?? withinBase);
    }

    const file = resolveInternal(url);
    if (file === null) {
      report.error(
        kind === 'image' ? 'images' : 'links',
        page,
        `"${url}" is site-absolute but outside the base path "${base}".`,
      );
      continue;
    }
    if (!fileExists(file)) {
      report.error(kind === 'image' ? 'images' : 'links', page, `"${url}" resolves to nothing (${file}).`);
    }
  }
}

// The home page is reachable without a link to it, and a 404 is reached by
// failing to reach anything else.
// The 404 is emitted as a file rather than a directory, because that is what a
// static host looks for when it cannot resolve a path.
const ROOTS = new Set(['/', '/404/', '/404.html/']);
for (const page of pages) {
  const route = '/' + page.split(path.sep).join('/').replace(/index\.html$/, '');
  const normalised = route.endsWith('/') ? route : route + '/';
  if (ROOTS.has(normalised) || linkedTo.has(normalised)) continue;
  report.error(
    'orphans',
    page,
    'Nothing on the site links to this page. It exists and is reachable only by typing its address.',
  );
}

report.print(`Site integrity (${pages.length} pages)`);
process.exit(report.errors.length > 0 ? 1 : 0);
