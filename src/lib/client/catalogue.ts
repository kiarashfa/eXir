/**
 * The catalogue: the view switch, the filters and the sort.
 *
 * Both views are in the HTML and only one is shown, so a crawler reads every
 * drink link whichever is active and switching costs no request.
 *
 * Filtering HIDES rows; it never rebuilds them. Everything a filter needs sits
 * on the row itself as data attributes, written once by the same server loop
 * that wrote the row, so the facets a filter tests and the facets a reader sees
 * cannot drift. The alternative — rendering the grid from `catalog-index.json`
 * — would delete the real `<a>` per drink that the static page exists to
 * provide.
 */

const VIEW_KEY = 'exir.catalogue.v1';

type Row = HTMLElement;

interface Sort {
  key: string;
  descending: boolean;
}

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

function initView(): void {
  const group = document.querySelector<HTMLElement>('[data-catalogue-view]');
  if (!group) return;

  const show = (value: string): void => {
    for (const button of group.querySelectorAll<HTMLButtonElement>('button')) {
      button.setAttribute('aria-pressed', String(button.dataset['value'] === value));
    }
    for (const panel of document.querySelectorAll<HTMLElement>('[data-catalogue-panel]')) {
      panel.hidden = panel.dataset['cataloguePanel'] !== value;
    }
    write(VIEW_KEY, value);
  };

  group.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button?.dataset['value']) show(button.dataset['value']);
  });

  if (read(VIEW_KEY) === 'table') show('table');
}

function initFilters(): void {
  const form = document.querySelector<HTMLFormElement>('[data-catalogue-filters]');
  const lists = [...document.querySelectorAll<HTMLElement>('[data-filter-list]')];
  if (!form || !lists.length) return;

  const rowsOf = (list: HTMLElement): Row[] =>
    [...list.children].filter((el): el is Row => el instanceof HTMLElement);

  const search = form.querySelector<HTMLInputElement>('[data-filter-search]');
  const zeroProof = form.querySelector<HTMLInputElement>('[data-filter-zero-proof]');
  const sortSelect = form.querySelector<HTMLSelectElement>('[data-filter-sort]');
  const direction = form.querySelector<HTMLButtonElement>('[data-filter-direction]');
  const directionLabel = form.querySelector<HTMLElement>('[data-direction-label]');
  const count = document.querySelector<HTMLElement>('[data-filter-count]');
  const empty = document.querySelector<HTMLElement>('[data-filter-empty]');
  const clear = document.querySelector<HTMLButtonElement>('[data-filter-clear]');

  let sort: Sort = { key: 'title', descending: false };

  const checkedValues = (attribute: string): string[] =>
    [...form.querySelectorAll<HTMLInputElement>(`[${attribute}]`)]
      .filter((input) => input.checked)
      .map((input) => input.getAttribute(attribute) ?? '');

  const numberOf = (input: HTMLInputElement | null): number | null => {
    const value = Number(input?.value);
    return input?.value.trim() && Number.isFinite(value) ? value : null;
  };

  /**
   * Facets are grouped by prefix, and the two levels combine differently.
   *
   * Within one axis the tests are OR — a reader ticking gin and rum wants
   * either. Across axes they are AND — gin AND stirred is one query, not two.
   * Collapsing both to one rule makes every multi-select useless in one
   * direction or the other.
   */
  const matches = (row: Row): boolean => {
    const facets = (row.dataset['facets'] ?? '').split(' ');
    const title = (row.dataset['title'] ?? '').toLowerCase();

    const query = search?.value.trim().toLowerCase() ?? '';
    if (query && !title.includes(query)) return false;

    if (zeroProof?.checked && !facets.includes('strength:zero-proof')) return false;

    const byAxis = new Map<string, string[]>();
    for (const token of checkedValues('data-filter-facet')) {
      const axis = token.slice(0, token.indexOf(':'));
      byAxis.set(axis, [...(byAxis.get(axis) ?? []), token]);
    }
    for (const wanted of byAxis.values()) {
      if (!wanted.some((token) => facets.includes(token))) return false;
    }

    // Exclusion, not selection: ticking "nuts" means "never show me one",
    // which is the only way an allergen filter is any use.
    for (const token of checkedValues('data-filter-exclude')) {
      if (facets.includes(token)) return false;
    }

    for (const key of ['abv', 'time', 'kcal']) {
      const value = Number(row.dataset[key] ?? '0');
      const min = numberOf(form.querySelector<HTMLInputElement>(`[data-filter-min="${key}"]`));
      const max = numberOf(form.querySelector<HTMLInputElement>(`[data-filter-max="${key}"]`));
      if (min !== null && value < min) return false;
      if (max !== null && value > max) return false;
    }

    return true;
  };

  const compare = (a: Row, b: Row): number => {
    if (sort.key === 'title') {
      return (a.dataset['title'] ?? '').localeCompare(b.dataset['title'] ?? '');
    }
    const left = Number(a.dataset[sort.key] ?? '0');
    const right = Number(b.dataset[sort.key] ?? '0');
    // Ties fall back to the name so the order is stable and reproducible rather
    // than dependent on whatever the previous sort happened to leave behind.
    return left - right || (a.dataset['title'] ?? '').localeCompare(b.dataset['title'] ?? '');
  };

  const apply = (): void => {
    let visible = 0;

    for (const list of lists) {
      const rows = rowsOf(list);
      for (const row of rows) row.hidden = !matches(row);

      const ordered = [...rows].sort(compare);
      if (sort.descending) ordered.reverse();
      for (const row of ordered) list.append(row);

      visible = rows.filter((row) => !row.hidden).length;
    }

    if (count) count.textContent = `${visible} ${visible === 1 ? 'drink' : 'drinks'}`;
    if (empty) empty.hidden = visible > 0;

    const touched =
      (search?.value.trim() ?? '') !== '' ||
      zeroProof?.checked === true ||
      checkedValues('data-filter-facet').length > 0 ||
      checkedValues('data-filter-exclude').length > 0 ||
      ['abv', 'time', 'kcal'].some(
        (key) =>
          numberOf(form.querySelector<HTMLInputElement>(`[data-filter-min="${key}"]`)) !== null ||
          numberOf(form.querySelector<HTMLInputElement>(`[data-filter-max="${key}"]`)) !== null,
      );
    if (clear) clear.hidden = !touched;
  };

  const paintDirection = (): void => {
    if (!direction || !directionLabel) return;
    direction.setAttribute('aria-pressed', String(sort.descending));
    // The label names the ORDER, not the button's next state: a control that
    // says "Z–A" while showing A–Z is read both ways by different people.
    directionLabel.textContent =
      sort.key === 'title'
        ? sort.descending
          ? 'Z–A'
          : 'A–Z'
        : sort.descending
          ? 'High first'
          : 'Low first';
    direction.setAttribute(
      'aria-label',
      sort.descending ? 'Sorted highest first' : 'Sorted lowest first',
    );
  };

  form.addEventListener('input', apply);
  form.addEventListener('change', () => {
    sort = { key: sortSelect?.value ?? 'title', descending: sort.descending };
    paintDirection();
    apply();
  });
  // A form here is a grouping element, not a submission: there is nowhere to
  // send it and Enter in the search field would otherwise reload the page and
  // throw the filters away.
  form.addEventListener('submit', (event) => event.preventDefault());

  direction?.addEventListener('click', () => {
    sort = { ...sort, descending: !sort.descending };
    paintDirection();
    apply();
  });

  clear?.addEventListener('click', () => {
    form.reset();
    apply();
  });

  paintDirection();
  apply();
}

export function initCatalogue(): void {
  initView();
  initFilters();
}
