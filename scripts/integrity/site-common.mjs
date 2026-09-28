#!/usr/bin/env node
/**
 * The post-build checks every page of the site must pass, whatever it is about.
 *
 *   node scripts/integrity/site-common.mjs
 *
 * Runs over `dist/` after `astro build` and Pagefind. It reads the base path
 * from the built homepage, so it takes no arguments. Site-specific assertions
 * (bundle fences, structured-data rules, the noindex list) live in the site's
 * own check next to this one.
 *
 *  1. **Links resolve.** Every internal `href`, `src` and `srcset` candidate
 *     lands on a file that was built, and every `#fragment` (same page or
 *     another) finds its `id`.
 *  2. **Every page holds together as a document.** Exactly one `h1`, a `lang`
 *     on `<html>`, no duplicate ids, every `<img>` has an `alt` attribute (empty
 *     is a decision; missing is an omission), and every link and button has a
 *     name a screen reader can announce.
 *  3. **Structured data parses.** Every `application/ld+json` block is JSON.
 *  4. **No secret is published.** No value from `.env` appears in any built
 *     file, except keys that are public by design (listed below). A leak is
 *     reported by variable name, never by value.
 *  5. **No page is an orphan, and the sitemap is honest.** Every indexable page
 *     is linked from at least one other page and listed in the sitemap, and
 *     the sitemap lists nothing that was not built.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const PUBLIC_ENV_KEYS = new Set(['GA_MEASUREMENT_ID']);
const home = readFileSync(join(DIST, 'index.html'), 'utf8');
const BASE = (home.match(/href="(\/[^/"]+\/)_astro\//) ?? home.match(/href="(\/[^/"]+\/)/))?.[1] ?? '/';
const SITE_URL = home.match(/<link[^>]+rel="canonical"[^>]+href="(https?:\/\/[^/"]+)/)?.[1] ?? '';

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(DIST);
const htmlFiles = files.filter((f) => f.endsWith('.html') && !relative(DIST, f).startsWith('pagefind'));
const rel = (f) => relative(DIST, f).replaceAll('\\', '/');
const failures = [];
const fail = (rule, where, what) => failures.push({ rule, where, what });

/** `/Base/drinks/negroni/#x` → the file it names, or null when outside the site. */
function fileFor(url) {
  const path = decodeURIComponent(url.split('#')[0].split('?')[0]);
  if (!path.startsWith(BASE)) return null;
  const inner = path.slice(BASE.length);
  const candidate = join(DIST, inner);
  if (inner === '' || inner.endsWith('/')) return join(candidate, 'index.html');
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (existsSync(join(candidate, 'index.html'))) return join(candidate, 'index.html');
  return candidate;
}

const idsCache = new Map();
const idsOf = (file) => {
  if (!idsCache.has(file)) {
    const text = readFileSync(file, 'utf8');
    idsCache.set(file, new Set([...text.matchAll(/\s(?:id|name)="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsCache.get(file);
};

const strip = (html) => html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
const inbound = new Map();
const pageInfo = new Map();

for (const file of htmlFiles) {
  const page = rel(file);
  const raw = readFileSync(file, 'utf8');
  const html = strip(raw);
  const redirect = /http-equiv="refresh"/i.test(raw);
  const noindex = /<meta[^>]+name="robots"[^>]+noindex/i.test(raw);
  pageInfo.set(file, { page, redirect, noindex });
  if (redirect) continue;

  // 1. links, images, srcsets, anchors
  const refs = [];
  for (const m of html.matchAll(/\s(href|src)="([^"]+)"/g)) refs.push(m[2]);
  for (const m of html.matchAll(/\ssrcset="([^"]+)"/g)) for (const part of m[1].split(',')) refs.push(part.trim().split(/\s+/)[0]);
  for (const ref of refs) {
    if (/^(https?:|mailto:|tel:|data:|javascript:)/.test(ref) || ref.startsWith('//')) continue;
    if (ref.startsWith('#')) {
      if (ref.length > 1 && !idsOf(file).has(decodeURIComponent(ref.slice(1)))) fail('anchor', page, `#${ref.slice(1)} has no target on the page`);
      continue;
    }
    if (!ref.startsWith('/')) continue;
    const target = fileFor(ref);
    if (!target) continue;
    if (!existsSync(target)) { fail('link', page, `${ref} was not built`); continue; }
    if (target.endsWith('.html') && target !== file) inbound.set(target, (inbound.get(target) ?? 0) + 1);
    const hash = ref.split('#')[1];
    if (hash && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(hash))) fail('anchor', page, `${ref} has no target`);
  }

  // 2. the document
  const h1s = (html.match(/<h1[\s>]/g) ?? []).length;
  if (page !== '404.html' && h1s !== 1) fail('h1', page, `${h1s} h1 elements`);
  if (!/<html[^>]*\slang="[^"]+"/.test(raw)) fail('lang', page, '<html> has no lang');
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dupes = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
  if (dupes.length) fail('id', page, `duplicate id ${dupes.slice(0, 3).join(', ')}`);
  for (const m of html.matchAll(/<img\b([^>]*)>/g)) if (!/\salt=/.test(m[1])) fail('alt', page, `<img${m[1].slice(0, 60)}> has no alt attribute`);
  for (const m of html.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const [, tag, attrs, inner] = m;
    if (/\saria-hidden="true"/.test(attrs) || (tag === 'a' && !/\shref=/.test(attrs))) continue;
    const text = inner.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, 'x').trim();
    const named = text || /\saria-label(?:ledby)?="[^"]+"/.test(attrs) || /\stitle="[^"]+"/.test(attrs) || /<img[^>]+alt="[^"]+"/.test(inner) || /<svg[^>]*aria-label="[^"]+"/.test(inner) || /<title>[^<]+<\/title>/.test(inner);
    if (!named) fail('name', page, `<${tag}${attrs.slice(0, 70)}> has no accessible name`);
  }

  // 3. structured data
  for (const m of raw.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (error) { fail('json-ld', page, `does not parse: ${error.message}`); }
  }
}

// 4. secrets
if (existsSync('.env')) {
  const secrets = readFileSync('.env', 'utf8').split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"#\r\n]+?)"?\s*$/))
    .filter(Boolean)
    .filter(([, key, value]) => !PUBLIC_ENV_KEYS.has(key) && value.length >= 8);
  if (secrets.length) {
    for (const file of files) {
      if (!/\.(html|js|json|txt|xml|css|mjs)$/.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const [, key, value] of secrets) if (text.includes(value)) fail('secret', rel(file), `contains the value of ${key}`);
    }
  }
}

// 5. orphans and the sitemap
const sitemapFiles = files.filter((f) => /sitemap-\d+\.xml$/.test(f));
const listed = new Set(sitemapFiles.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])));
for (const [file, info] of pageInfo) {
  if (info.redirect || info.noindex || info.page === '404.html' || info.page === 'index.html') continue;
  if (!inbound.get(file)) fail('orphan', info.page, 'no other page links to it');
  const url = `${SITE_URL}${BASE}${info.page.replace(/index\.html$/, '')}`;
  if (sitemapFiles.length && !listed.has(url)) fail('sitemap', info.page, 'indexable but not in the sitemap');
}
for (const url of listed) {
  const target = fileFor(url.replace(SITE_URL, ''));
  if (!target || !existsSync(target)) fail('sitemap', url, 'listed but not built');
}

const byRule = new Map();
for (const f of failures) byRule.set(f.rule, [...(byRule.get(f.rule) ?? []), f]);
if (failures.length) {
  for (const [rule, list] of byRule) {
    console.error(`  ${rule}: ${list.length}`);
    for (const f of list.slice(0, 8)) console.error(`    ${f.where}: ${f.what}`);
    if (list.length > 8) console.error(`    … and ${list.length - 8} more`);
  }
  console.error(`\n[site-common] FAILED: ${failures.length} problem(s) over ${htmlFiles.length} pages.`);
  process.exit(1);
}
console.log(`[site-common] passed: ${htmlFiles.length} pages; links, anchors, documents, structured data, secrets, orphans and the sitemap.`);
