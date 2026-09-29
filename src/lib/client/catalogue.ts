/**
 * The catalogue: the view switch, the filter menus, the sort and the paging.
 *
 * Both views are in the HTML and only one is shown, so a crawler reads every
 * drink link whichever is active and switching costs no request.
 *
 * Filtering HIDES rows; it never rebuilds them. Everything a filter needs sits
 * on the row itself as data attributes, written once by the same server loop
 * that wrote the row, so the facets a filter tests and the facets a reader sees
 * cannot drift.
 *
 * Every filter, the sort and the view are mirrored into the address bar, so any
 * view of the catalogue is a link.
 */

const VIEW_KEY = 'exir.catalogue.v1';
/** Results are shown a page at a time, so the end of the page stays reachable. */
const PAGE = 60;

interface Row {
  slug: string;
  title: string;
  facets: Set<string>;
  values: Record<string, number>;
  /** The text columns, compared as text. */
  texts: Record<string, string>;
  elements: HTMLElement[];
}

/** Sort keys compared as text; every other key but the title is a number. */
const TEXT_KEYS = ['cat', 'origin', 'method', 'served'];

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const write = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable. The switch still works for this visit.
  }
};

/* ── the view switch ───────────────────────────────────────────────────── */

let currentView = 'cards';
let onViewChange: () => void = () => {};

function initView(): void {
  const group = document.querySelector<HTMLElement>('[data-catalogue-view]');
  if (!group) return;

  const show = (value: string): void => {
    currentView = value;
    for (const button of group.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset['value'] === value));
    }
    for (const panel of document.querySelectorAll<HTMLElement>('[data-catalogue-panel]')) {
      panel.hidden = panel.dataset['cataloguePanel'] !== value;
    }
    write(VIEW_KEY, value);
    onViewChange();
  };

  group.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button?.dataset['value']) show(button.dataset['value']);
  });

  const fromUrl = new URLSearchParams(location.search).get('view');
  if (fromUrl === 'table' || (!fromUrl && read(VIEW_KEY) === 'table')) show('table');
}

/* ── the menus ─────────────────────────────────────────────────────────── */

/**
 * `<details>` gives each menu its open state and keyboard toggle for free; this
 * adds what a menu needs on top: one open at a time, a click outside or Escape
 * closing it, and a search field that narrows a long list.
 */
function initMenus(): void {
  const menus = [...document.querySelectorAll<HTMLDetailsElement>('[data-dd]')];

  for (const menu of menus) {
    menu.addEventListener('toggle', () => {
      if (!menu.open) return;
      for (const other of menus) if (other !== menu) other.open = false;
      menu.querySelector<HTMLInputElement>('[data-dd-search]')?.focus();
    });

    const search = menu.querySelector<HTMLInputElement>('[data-dd-search]');
    const none = menu.querySelector<HTMLElement>('[data-dd-none]');
    search?.addEventListener('input', (event) => {
      // Narrowing the list is not a filter; keep it out of the form's input.
      event.stopPropagation();
      const needle = search.value.trim().toLowerCase();
      let shown = 0;
      for (const li of menu.querySelectorAll<HTMLElement>('.dd-list li')) {
        const hit = !needle || (li.textContent ?? '').toLowerCase().includes(needle);
        li.hidden = !hit;
        if (hit) shown++;
      }
      if (none) none.hidden = shown > 0;
    });
  }

  document.addEventListener('mousedown', (event) => {
    for (const menu of menus) {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const menu of menus) {
      if (menu.open) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    }
  });
}

/* ── the filters ───────────────────────────────────────────────────────── */

function initFilters(): void {
  const form = document.querySelector<HTMLFormElement>('[data-catalogue-filters]');
  const lists = [...document.querySelectorAll<HTMLElement>('[data-filter-list]')];
  if (!form || !lists.length) return;

  // One record per drink, holding every element that shows it (the card and
  // the table row), parsed once.
  const bySlug = new Map<string, Row>();
  for (const list of lists) {
    for (const el of [...list.children] as HTMLElement[]) {
      const slug = el.dataset['slug'] ?? '';
      const existing = bySlug.get(slug);
      if (existing) {
        existing.elements.push(el);
        continue;
      }
      bySlug.set(slug, {
        slug,
        title: el.dataset['title'] ?? '',
        facets: new Set((el.dataset['facets'] ?? '').split(' ').filter(Boolean)),
        values: {
          abv: Number(el.dataset['abv'] ?? '0'),
          time: Number(el.dataset['time'] ?? '0'),
          kcal: Number(el.dataset['kcal'] ?? '0'),
          diff: Number(el.dataset['diff'] ?? '0'),
          strength: Number(el.dataset['strength'] ?? '0'),
        },
        texts: Object.fromEntries(TEXT_KEYS.map((key) => [key, el.dataset[key] ?? ''])),
        elements: [el],
      });
    }
  }
  const rows = [...bySlug.values()];

  const search = form.querySelector<HTMLInputElement>('[data-filter-search]');
  const zeroProof = form.querySelector<HTMLInputElement>('[data-filter-zero-proof]');
  const sortSelect = form.querySelector<HTMLSelectElement>('[data-filter-sort]');
  const direction = form.querySelector<HTMLButtonElement>('[data-filter-direction]');
  const directionLabel = form.querySelector<HTMLElement>('[data-direction-label]');
  const facetInputs = [...form.querySelectorAll<HTMLInputElement>('[data-filter-facet]')];
  const excludeInputs = [...form.querySelectorAll<HTMLInputElement>('[data-filter-exclude]')];
  const rangeInputs = [...form.querySelectorAll<HTMLInputElement>('[data-filter-min],[data-filter-max]')];
  const count = document.querySelector<HTMLElement>('[data-filter-count]');
  const empty = document.querySelector<HTMLElement>('[data-filter-empty]');
  const clear = document.querySelector<HTMLButtonElement>('[data-filter-clear]');
  const active = document.querySelector<HTMLElement>('[data-active-filters]');
  const more = document.querySelector<HTMLElement>('[data-filter-more]');
  const moreButton = document.querySelector<HTMLButtonElement>('[data-filter-more-button]');
  const moreNote = document.querySelector<HTMLElement>('[data-filter-more-note]');

  let sort = { key: 'title', descending: false };
  let limit = PAGE;

  const axisOf = (token: string): string => token.slice(0, token.indexOf(':'));
  const labelOf = (input: HTMLInputElement): string =>
    input.closest('label')?.querySelector('.dd-label')?.textContent ?? '';

  const numberOf = (input: HTMLInputElement | null): number | null => {
    const value = Number(input?.value);
    return input?.value.trim() && Number.isFinite(value) ? value : null;
  };

  /**
   * Facets are grouped by prefix, and the two levels combine differently.
   * Within one axis the tests are OR — gin and rum means either. Across axes
   * they are AND — gin AND stirred is one query, not two.
   *
   * `skip` leaves one axis out, which is how each menu counts what its own
   * options would leave given every other filter.
   */
  const matches = (row: Row, skip?: string): boolean => {
    const query = search?.value.trim().toLowerCase() ?? '';
    if (query && !row.title.toLowerCase().includes(query)) return false;
    if (zeroProof?.checked && !row.facets.has('strength:zero-proof')) return false;

    const byAxis = new Map<string, string[]>();
    for (const input of facetInputs) {
      if (!input.checked) continue;
      const token = input.dataset['filterFacet'] ?? '';
      const axis = axisOf(token);
      if (axis === skip) continue;
      byAxis.set(axis, [...(byAxis.get(axis) ?? []), token]);
    }
    for (const wanted of byAxis.values()) {
      if (!wanted.some((token) => row.facets.has(token))) return false;
    }

    // Exclusion, not selection: ticking "nuts" means "never show me one".
    if (skip !== 'allergen') {
      for (const input of excludeInputs) {
        if (input.checked && row.facets.has(input.dataset['filterExclude'] ?? '')) return false;
      }
    }

    for (const key of ['abv', 'time', 'kcal']) {
      const value = row.values[key] ?? 0;
      const min = numberOf(form.querySelector<HTMLInputElement>(`[data-filter-min="${key}"]`));
      const max = numberOf(form.querySelector<HTMLInputElement>(`[data-filter-max="${key}"]`));
      if (min !== null && value < min) return false;
      if (max !== null && value > max) return false;
    }
    return true;
  };

  const compare = (a: Row, b: Row): number => {
    if (sort.key === 'title') return a.title.localeCompare(b.title);
    // Ties fall back to the name so the order is stable and reproducible.
    if (TEXT_KEYS.includes(sort.key))
      return (a.texts[sort.key] ?? '').localeCompare(b.texts[sort.key] ?? '') || a.title.localeCompare(b.title);
    return (a.values[sort.key] ?? 0) - (b.values[sort.key] ?? 0) || a.title.localeCompare(b.title);
  };

  const rangeCount = (): number =>
    ['abv', 'time', 'kcal'].filter(
      (key) =>
        numberOf(form.querySelector<HTMLInputElement>(`[data-filter-min="${key}"]`)) !== null ||
        numberOf(form.querySelector<HTMLInputElement>(`[data-filter-max="${key}"]`)) !== null,
    ).length;

  /** Each menu's badge, and each option's "would leave" count. */
  const paintMenus = (): void => {
    for (const menu of form.querySelectorAll<HTMLDetailsElement>('[data-dd]')) {
      const badge = menu.querySelector<HTMLElement>('[data-dd-count]');
      const ranged = menu.querySelector('[data-filter-min]');
      const n = ranged
        ? rangeCount()
        : [...menu.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].filter((i) => i.checked).length;
      if (badge) {
        badge.hidden = n === 0;
        badge.textContent = String(n);
      }
      menu.classList.toggle('is-on', n > 0);
    }

    const axes = new Set([...facetInputs.map((i) => axisOf(i.dataset['filterFacet'] ?? '')), 'allergen']);
    for (const axis of axes) {
      const tally = new Map<string, number>();
      for (const row of rows) {
        if (!matches(row, axis)) continue;
        for (const token of row.facets) if (token.startsWith(`${axis}:`)) tally.set(token, (tally.get(token) ?? 0) + 1);
      }
      for (const cell of form.querySelectorAll<HTMLElement>(`[data-dd-n^="${axis}:"]`)) {
        const n = tally.get(cell.dataset['ddN'] ?? '') ?? 0;
        cell.textContent = String(n);
        cell.closest('label')?.classList.toggle('is-empty', n === 0);
      }
    }
  };

  /** What is filtering the list, as chips that each remove their own filter. */
  const paintActive = (): number => {
    if (!active) return 0;
    const chips: { label: string; clear: () => void; exclude?: boolean }[] = [];
    const query = search?.value.trim() ?? '';
    if (query) chips.push({ label: `“${query}”`, clear: () => search && (search.value = '') });
    if (zeroProof?.checked) chips.push({ label: 'Zero-proof', clear: () => zeroProof && (zeroProof.checked = false) });
    for (const input of facetInputs) if (input.checked) chips.push({ label: labelOf(input), clear: () => (input.checked = false) });
    for (const input of excludeInputs)
      if (input.checked) chips.push({ label: `No ${labelOf(input).toLowerCase()}`, clear: () => (input.checked = false), exclude: true });
    if (rangeCount() > 0) chips.push({ label: 'Ranges', clear: () => rangeInputs.forEach((i) => (i.value = '')) });

    active.replaceChildren(
      ...chips.map((chip) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = chip.exclude ? 'filter-chip is-exclude' : 'filter-chip';
        button.innerHTML = `<span></span><span aria-hidden="true">×</span>`;
        button.firstElementChild!.textContent = chip.label;
        button.setAttribute('aria-label', `Remove ${chip.label}`);
        button.addEventListener('click', () => {
          chip.clear();
          reset();
        });
        return button;
      }),
    );
    active.hidden = chips.length === 0;
    return chips.length;
  };

  const writeUrl = (): void => {
    const p = new URLSearchParams();
    const query = search?.value.trim() ?? '';
    if (query) p.set('q', query);
    if (zeroProof?.checked) p.set('zero', '1');
    const facets = facetInputs.filter((i) => i.checked).map((i) => i.dataset['filterFacet']);
    if (facets.length) p.set('f', facets.join(','));
    const excludes = excludeInputs.filter((i) => i.checked).map((i) => (i.dataset['filterExclude'] ?? '').slice(9));
    if (excludes.length) p.set('exclude', excludes.join(','));
    for (const input of rangeInputs) {
      const n = numberOf(input);
      if (n !== null) p.set(input.dataset['filterMin'] ? `${input.dataset['filterMin']}_min` : `${input.dataset['filterMax']}_max`, String(n));
    }
    if (sort.key !== 'title') p.set('sort', sort.key);
    if (sort.descending) p.set('dir', 'desc');
    if (currentView === 'table') p.set('view', 'table');
    const qs = p.toString();
    const next = `${location.pathname}${qs ? `?${qs}` : ''}${location.hash}`;
    if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(null, '', next);
  };

  const readUrl = (): void => {
    const p = new URLSearchParams(location.search);
    if (search) search.value = p.get('q') ?? '';
    if (zeroProof) zeroProof.checked = p.get('zero') === '1';
    const facets = new Set((p.get('f') ?? '').split(',').filter(Boolean));
    for (const input of facetInputs) input.checked = facets.has(input.dataset['filterFacet'] ?? '');
    const excludes = new Set((p.get('exclude') ?? '').split(',').filter(Boolean).map((a) => `allergen:${a}`));
    for (const input of excludeInputs) input.checked = excludes.has(input.dataset['filterExclude'] ?? '');
    for (const input of rangeInputs) {
      const key = input.dataset['filterMin'] ? `${input.dataset['filterMin']}_min` : `${input.dataset['filterMax']}_max`;
      input.value = p.get(key) ?? '';
    }
    const key = p.get('sort');
    sort = { key: key && sortSelect?.querySelector(`option[value="${key}"]`) ? key : 'title', descending: p.get('dir') === 'desc' };
    if (sortSelect) sortSelect.value = sort.key;
  };

  const apply = (): void => {
    const matching = rows.filter((row) => matches(row)).sort(compare);
    if (sort.descending) matching.reverse();
    const visible = new Set(matching.slice(0, limit).map((row) => row.slug));

    for (const row of rows) for (const el of row.elements) el.hidden = !visible.has(row.slug);
    // Order the markup to match, in both views, so tabbing follows the sort.
    const matched = new Set(matching);
    const order = [...matching, ...rows.filter((row) => !matched.has(row))];
    for (const list of lists) {
      for (const row of order) {
        const el = row.elements.find((e) => e.parentElement === list);
        if (el) list.append(el);
      }
    }

    const total = rows.length;
    if (count) {
      count.textContent =
        matching.length === total ? `${total} drinks` : `${matching.length} of ${total} ${total === 1 ? 'drink' : 'drinks'}`;
    }
    if (empty) empty.hidden = matching.length > 0;
    if (more) more.hidden = matching.length <= limit;
    if (moreButton) moreButton.textContent = `Show ${Math.min(PAGE, matching.length - limit)} more`;
    if (moreNote) moreNote.textContent = `${Math.min(limit, matching.length)} of ${matching.length} shown`;

    const chips = paintActive();
    if (clear) clear.hidden = chips === 0;
    paintMenus();
    writeUrl();
  };

  /** A changed question starts again at the top of its answer. */
  const reset = (): void => {
    limit = PAGE;
    apply();
  };

  const paintDirection = (): void => {
    if (!direction || !directionLabel) return;
    direction.setAttribute('aria-pressed', String(sort.descending));
    // The label names the ORDER, not the button's next state.
    directionLabel.textContent =
      sort.key === 'title' || TEXT_KEYS.includes(sort.key) ? (sort.descending ? 'Z–A' : 'A–Z') : sort.descending ? 'High first' : 'Low first';
    direction.setAttribute('aria-label', sort.descending ? 'Sorted highest first' : 'Sorted lowest first');
    // The table's own headers show the same sort.
    for (const th of document.querySelectorAll<HTMLElement>('[data-sort-column]')) {
      const on = th.dataset['sortColumn'] === sort.key;
      th.setAttribute('aria-sort', on ? (sort.descending ? 'descending' : 'ascending') : 'none');
    }
  };

  // A column header sorts by that column; a second click on it reverses.
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-sort-key]')) {
    button.addEventListener('click', () => {
      const key = button.dataset['sortKey'] ?? 'title';
      sort = { key, descending: sort.key === key ? !sort.descending : false };
      if (sortSelect) sortSelect.value = key;
      paintDirection();
      reset();
    });
  }

  form.addEventListener('input', reset);
  form.addEventListener('change', (event) => {
    if (event.target === sortSelect) sort = { key: sortSelect?.value ?? 'title', descending: sort.descending };
    paintDirection();
    reset();
  });
  // A form here groups controls; Enter in a field must not reload the page.
  form.addEventListener('submit', (event) => event.preventDefault());

  direction?.addEventListener('click', () => {
    sort = { ...sort, descending: !sort.descending };
    paintDirection();
    reset();
  });

  for (const button of form.querySelectorAll<HTMLButtonElement>('[data-dd-clear]')) {
    button.addEventListener('click', () => {
      const menu = button.closest('[data-dd]');
      for (const input of menu?.querySelectorAll<HTMLInputElement>('input') ?? []) {
        if (input.type === 'checkbox') input.checked = false;
        else if (input.type === 'number') input.value = '';
      }
      reset();
    });
  }

  clear?.addEventListener('click', () => {
    form.reset();
    sort = { key: sortSelect?.value ?? 'title', descending: false };
    paintDirection();
    reset();
  });

  moreButton?.addEventListener('click', () => {
    limit += PAGE;
    apply();
  });

  onViewChange = writeUrl;

  readUrl();
  paintDirection();
  apply();
}

export function initCatalogue(): void {
  initView();
  initMenus();
  initFilters();
}
