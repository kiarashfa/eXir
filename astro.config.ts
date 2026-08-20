// @ts-check
import { defineConfig } from 'astro/config';

import svelte from '@astrojs/svelte';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// Deployed as a project site on GitHub Pages, so the build needs both the
// origin (for canonical URLs and the sitemap) and the repo path prefix.
export default defineConfig({
  site: 'https://kiarashfa.github.io',
  base: '/eXir',
  trailingSlash: 'always',
  integrations: [
    svelte(),
    mdx(),
    // The user-state pages hold nothing crawlable: everything on them comes out
    // of the reader's own browser storage. They carry a noindex tag instead, and
    // are deliberately *not* disallowed in robots.txt — a blocked path is never
    // fetched, so the tag would never be read.
    sitemap({ filter: (page) => !/\/(my-bar|plan)\/?$/.test(page) }),
  ],

  vite: {
    plugins: [tailwindcss()],
  },
});
