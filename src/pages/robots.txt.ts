/**
 * The user-state pages are deliberately NOT disallowed. They carry a noindex
 * tag, and a path blocked here is never fetched — so the tag would never be
 * read, which is the classic way to end up with a thin page indexed anyway.
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL('sitemap-index.xml', site ?? 'https://kiarashfa.github.io/eXir/');
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${sitemap.href}\n`, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
