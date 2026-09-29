/**
 * The ingredients index: search, a category filter and four orders over a list
 * that is already in the page, so the list works without script and the script
 * only reorders and hides rows. Search, category and order are mirrored into
 * the address bar, so a filtered list is a link that can be shared.
 */
export function initIngredientIndex(): void {
  const root = document.querySelector<HTMLElement>('[data-ing-index]');
  const list = root?.querySelector<HTMLElement>('[data-ing-list]');
  if (!root || !list) return;
  const query = root.querySelector<HTMLInputElement>('[data-ing-q]');
  const category = root.querySelector<HTMLSelectElement>('[data-ing-cat]');
  const order = root.querySelector<HTMLSelectElement>('[data-ing-sort]');
  const count = root.querySelector<HTMLElement>('[data-ing-count]');
  const empty = root.querySelector<HTMLElement>('[data-ing-empty]');
  const rows = [...list.children] as HTMLElement[];
  const total = rows.length;

  const params = new URLSearchParams(location.search);
  if (query) query.value = params.get('q') ?? '';
  if (category && params.get('cat') && category.querySelector(`option[value="${CSS.escape(params.get('cat') ?? '')}"]`))
    category.value = params.get('cat') ?? '';
  if (order && params.get('sort') && order.querySelector(`option[value="${params.get('sort')}"]`)) order.value = params.get('sort') ?? 'az';

  const name = (el: HTMLElement) => el.dataset['name'] ?? '';
  const uses = (el: HTMLElement) => Number(el.dataset['uses'] ?? '0');
  const compare: Record<string, (a: HTMLElement, b: HTMLElement) => number> = {
    az: (a, b) => name(a).localeCompare(name(b)),
    za: (a, b) => name(b).localeCompare(name(a)),
    most: (a, b) => uses(b) - uses(a) || name(a).localeCompare(name(b)),
    least: (a, b) => uses(a) - uses(b) || name(a).localeCompare(name(b)),
  };

  function apply(): void {
    const q = (query?.value ?? '').trim().toLowerCase();
    const cat = category?.value ?? '';
    const sorted = [...rows].sort(compare[order?.value ?? 'az'] ?? compare['az']);
    let shown = 0;
    for (const row of sorted) {
      const hit = (!q || name(row).toLowerCase().includes(q)) && (!cat || row.dataset['cat'] === cat);
      row.hidden = !hit;
      if (hit) shown++;
      list?.append(row);
    }
    if (count) count.textContent = shown === total ? `${total} ingredients` : `${shown} of ${total} ingredients`;
    if (empty) empty.hidden = shown > 0;

    const next = new URLSearchParams();
    if (q) next.set('q', q);
    if (cat) next.set('cat', cat);
    if (order && order.value !== 'az') next.set('sort', order.value);
    const qs = next.toString();
    history.replaceState(null, '', `${location.pathname}${qs ? `?${qs}` : ''}`);
  }

  query?.addEventListener('input', apply);
  category?.addEventListener('change', apply);
  order?.addEventListener('change', apply);
  root.querySelector('form')?.addEventListener('submit', (e) => e.preventDefault());
  apply();
}
