/**
 * Site search: a drawer under the header, over Pagefind's own JS API.
 *
 * The API rather than Pagefind's packaged UI, for two reasons. The UI loads its
 * search core from a ROOT-relative path, which 404s on a site served under a
 * prefix — silently, with the panel saying "Searching…" for ever — and it brings
 * its own markup and stylesheet, which would be a second design system next to
 * this one. Importing the module ourselves means the path is ours to get right.
 *
 * The module is loaded on the first keystroke, not on page load: nobody pays
 * for the index until they use it.
 */

interface PagefindResult {
  id: string;
  data: () => Promise<{ url: string; excerpt: string; meta: Record<string, string> }>;
}

interface Pagefind {
  search: (query: string) => Promise<{ results: PagefindResult[] }>;
  options?: (opts: Record<string, unknown>) => Promise<void>;
}

const BASE = (document.documentElement.dataset['base'] ?? '').replace(/\/$/, '');

let engine: Promise<Pagefind> | null = null;

const load = (): Promise<Pagefind> => {
  // @vite-ignore keeps the bundler from trying to resolve a file that only
  // exists after the search index is built.
  engine ??= import(/* @vite-ignore */ `${BASE}/pagefind/pagefind.js`) as Promise<Pagefind>;
  return engine;
};

/**
 * Pagefind indexes the built directory, which knows nothing about the path the
 * site is served under, so every URL it returns needs the prefix putting back.
 */
const href = (url: string): string => (url.startsWith(BASE) ? url : BASE + url);

export function initSearch(): void {
  const drawer = document.querySelector<HTMLElement>('[data-search-drawer]');
  const input = document.querySelector<HTMLInputElement>('[data-search-input]');
  const output = document.querySelector<HTMLElement>('[data-search-results]');
  const openers = document.querySelectorAll<HTMLButtonElement>('[data-search-open]');
  if (!drawer || !input || !output) return;

  const setOpen = (open: boolean): void => {
    drawer.hidden = !open;
    for (const o of openers) o.setAttribute('aria-expanded', String(open));
    if (open) input.focus();
  };

  for (const opener of openers) {
    opener.addEventListener('click', () => setOpen(drawer.hidden === true));
  }

  document.querySelector('[data-search-close]')?.addEventListener('click', () => setOpen(false));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !drawer.hidden) {
      setOpen(false);
      (openers[0] as HTMLElement | undefined)?.focus();
    }
    // Slash opens search from anywhere that is not already a text field.
    const target = event.target as HTMLElement | null;
    const typing = target?.matches('input, textarea, [contenteditable]');
    if (event.key === '/' && !typing && drawer.hidden) {
      event.preventDefault();
      setOpen(true);
    }
  });

  let run = 0;
  const search = async (query: string): Promise<void> => {
    const ticket = ++run;
    if (query.trim().length < 2) {
      output.innerHTML = '';
      return;
    }

    output.innerHTML = '<p class="search-status">Searching…</p>';
    try {
      const pagefind = await load();
      const { results } = await pagefind.search(query);
      // A slower earlier query must never overwrite a faster later one.
      if (ticket !== run) return;

      if (results.length === 0) {
        output.innerHTML = '<p class="search-status">Nothing matched.</p>';
        return;
      }

      const top = await Promise.all(results.slice(0, 8).map((r) => r.data()));
      if (ticket !== run) return;

      output.innerHTML = top
        .map(
          (d) =>
            `<a class="search-hit" href="${href(d.url)}">` +
            `<span class="search-hit-title">${d.meta['title'] ?? d.url}</span>` +
            `<span class="search-hit-excerpt">${d.excerpt}</span></a>`,
        )
        .join('');
    } catch {
      // The index only exists in a real build. In the dev server it does not,
      // and saying so beats a spinner that never resolves.
      if (ticket !== run) return;
      output.innerHTML =
        '<p class="search-status">The search index is built with the site, so it is not available here.</p>';
    }
  };

  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void search(input.value), 140);
  });
}
