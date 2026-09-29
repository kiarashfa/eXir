/**
 * Search in the header: the search button grows into a field, leftwards, while
 * the section links slide out of the way, and the results drop below it.
 * Closing runs the same motion backwards.
 *
 * The markup is the header's own, so this works on any page without a
 * framework. It needs, inside one element marked `data-hs` that is the
 * positioning box around the search button:
 *
 *   [data-hs-button]  the search button (aria-expanded is kept in step)
 *   [data-hs-field]   the field, holding an input and a [data-hs-close]
 *   [data-hs-panel]   the results panel, holding [data-hs-results]
 *
 * and, anywhere in the header, [data-hs-fade] on what makes way and
 * [data-hs-logo] on the wordmark the field may not cover on a wide screen.
 * `data-hs` carries the Pagefind bundle, the site's base path, an optional
 * link to a full search page, and the kind of page each first path segment
 * holds.
 *
 * Pagefind is imported on the first open, not on page load: the index is the
 * largest thing on the site and most visits never search.
 */

interface PagefindResult {
  id: string;
  data: () => Promise<{ url: string; excerpt: string; meta?: Record<string, string> }>;
}
interface Pagefind {
  init?: () => Promise<void>;
  search: (query: string) => Promise<{ results: PagefindResult[] }>;
}

const SHOWN = 8;
const WIDEST = 480;
/** Below this much room beside the wordmark, the field covers the wordmark too. */
const NARROWEST = 260;

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export function initHeaderSearch(): void {
  const root = document.querySelector<HTMLElement>('[data-hs]');
  const header = root?.closest<HTMLElement>('header');
  const button = root?.querySelector<HTMLButtonElement>('[data-hs-button]');
  const field = root?.querySelector<HTMLElement>('[data-hs-field]');
  const input = field?.querySelector<HTMLInputElement>('input');
  const panel = root?.querySelector<HTMLElement>('[data-hs-panel]');
  const output = panel?.querySelector<HTMLElement>('[data-hs-results]');
  if (!root || !header || !button || !field || !input || !panel || !output) return;

  const base = (root.dataset['hsBase'] ?? '').replace(/\/$/, '');
  const bundle = root.dataset['hsBundle'] ?? `${base}/pagefind/pagefind.js`;
  const allResults = root.dataset['hsAll'] ?? '';
  const hint = output.innerHTML;
  let kinds: Record<string, string> = {};
  try {
    kinds = JSON.parse(root.dataset['hsKinds'] ?? '{}') as Record<string, string>;
  } catch {
    kinds = {};
  }

  let engine: Promise<Pagefind> | null = null;
  const load = (): Promise<Pagefind> => {
    engine ??= (import(/* @vite-ignore */ bundle) as Promise<Pagefind>).then(async (pf) => {
      await pf.init?.();
      return pf;
    });
    return engine;
  };

  /** Pagefind may or may not put the base path back; make sure it is there once. */
  const href = (url: string): string => {
    const path = url.replace(/index\.html$/, '').replace(/\.html$/, '/');
    return base && !path.startsWith(`${base}/`) ? base + path : path;
  };
  const kindOf = (url: string): string => {
    const segment = url.slice(base.length).split('/').filter(Boolean)[0] ?? '';
    return kinds[segment] ?? '';
  };

  /* ── Open and close ─────────────────────────────────────────────────── */

  const isOpen = (): boolean => header.hasAttribute('data-hs-open');

  /** The field runs from the search button's right edge back towards the
      wordmark, and on a narrow screen over it, where the results then take the
      whole width of the row rather than the field's. */
  const measure = (): void => {
    const right = root.getBoundingClientRect().right;
    const logo = header.querySelector<HTMLElement>('[data-hs-logo]');
    const row = logo?.parentElement ?? header;
    const box = row.getBoundingClientRect();
    const style = getComputedStyle(row);
    const left = box.left + parseFloat(style.paddingLeft);
    const end = box.right - parseFloat(style.paddingRight);
    let room = right - (logo ? logo.getBoundingClientRect().right + 16 : left);
    const narrow = room < NARROWEST;
    if (narrow) room = right - left;
    const width = Math.round(Math.min(WIDEST, room));
    root.style.setProperty('--hs-w', `${width}px`);
    root.style.setProperty('--hs-pw', `${Math.round(narrow ? end - left : width)}px`);
    root.style.setProperty('--hs-pr', `${Math.round(narrow ? right - end : 0)}px`);
  };

  const setOpen = (open: boolean, focusBack = true): void => {
    if (open === isOpen()) return;
    if (open) {
      measure();
      header.setAttribute('data-hs-open', '');
      button.setAttribute('aria-expanded', 'true');
      void load().catch(() => undefined);
      input.focus({ preventScroll: true });
    } else {
      header.removeAttribute('data-hs-open');
      button.setAttribute('aria-expanded', 'false');
      active = -1;
      if (focusBack) button.focus({ preventScroll: true });
    }
  };

  button.addEventListener('click', () => setOpen(!isOpen()));
  field.querySelector('[data-hs-close]')?.addEventListener('click', () => setOpen(false));
  window.addEventListener('resize', () => {
    if (isOpen()) measure();
  });
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as Node;
      if (isOpen() && !root.contains(target)) setOpen(false, false);
    },
    true,
  );
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    const target = event.target as HTMLElement | null;
    const typing = target?.matches('input, textarea, select, [contenteditable]') ?? false;
    const shortcut =
      (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) ||
      (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey));
    if (shortcut) {
      event.preventDefault();
      setOpen(true);
    }
  });

  /* ── Results ────────────────────────────────────────────────────────── */

  let active = -1;
  const hits = (): HTMLAnchorElement[] => [...output.querySelectorAll<HTMLAnchorElement>('.hs-hit')];
  const paint = (): void => {
    hits().forEach((a, i) => a.toggleAttribute('data-active', i === active));
    hits()[active]?.scrollIntoView({ block: 'nearest' });
  };

  const say = (text: string): void => {
    output.innerHTML = `<p class="hs-status">${text}</p>`;
  };
  const allLink = (query: string, count: number): string => {
    const label = count > SHOWN ? `All ${count} results` : 'All results';
    return allResults
      ? `<a class="hs-all" href="${allResults}?q=${encodeURIComponent(query)}">${label} <span aria-hidden="true">→</span></a>`
      : `<span>${count} ${count === 1 ? 'result' : 'results'}</span>`;
  };

  let run = 0;
  const search = async (raw: string): Promise<void> => {
    const ticket = ++run;
    const query = raw.trim();
    active = -1;
    if (query.length === 0) {
      output.innerHTML = hint;
      return;
    }
    if (query.length < 2) {
      say('Two characters or more.');
      return;
    }
    say('Searching…');
    try {
      const pagefind = await load();
      const { results } = await pagefind.search(query);
      // A slower earlier query must never overwrite a faster later one.
      if (ticket !== run) return;
      if (results.length === 0) {
        say(`Nothing matches “${escapeHtml(query)}”.`);
        return;
      }
      const top = await Promise.all(results.slice(0, SHOWN).map((r) => r.data()));
      if (ticket !== run) return;
      output.innerHTML =
        `<ul class="hs-hits">${top
          .map((d) => {
            const url = href(d.url);
            const kind = kindOf(url);
            return (
              `<li><a class="hs-hit" href="${url}">` +
              `<span class="hs-hit-title">${escapeHtml(d.meta?.['title'] ?? url)}` +
              (kind ? `<span class="hs-kind">${kind}</span>` : '') +
              `</span><span class="hs-hit-excerpt">${d.excerpt}</span></a></li>`
            );
          })
          .join('')}</ul>` +
        `<div class="hs-foot"><span>↑↓ to move, Enter to open</span>${allLink(query, results.length)}</div>`;
    } catch {
      if (ticket !== run) return;
      // The index only exists in a real build; say so rather than spin.
      say('The search index is built with the site, so it is not available here.');
    }
  };

  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void search(input.value), 150);
  });
  input.addEventListener('keydown', (event) => {
    const list = hits();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (list.length === 0) return;
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + list.length + 1) % (list.length + 1);
      if (active === list.length) active = -1;
      paint();
    } else if (event.key === 'Enter') {
      const chosen = list[active] ?? list[0];
      if (chosen) {
        event.preventDefault();
        window.location.href = chosen.href;
      } else if (allResults && input.value.trim()) {
        event.preventDefault();
        window.location.href = `${allResults}?q=${encodeURIComponent(input.value.trim())}`;
      }
    }
  });
  output.addEventListener('pointermove', (event) => {
    const hit = (event.target as HTMLElement).closest<HTMLAnchorElement>('.hs-hit');
    const index = hit ? hits().indexOf(hit) : -1;
    if (index !== -1 && index !== active) {
      active = index;
      paint();
    }
  });
}
