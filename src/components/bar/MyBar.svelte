<script lang="ts">
  /**
   * My Bar — the inventory, the reverse search and the set-cover.
   *
   * `client:only`, because nothing on this page is true at build time. Rendering
   * an empty shelf on the server and then replacing it a moment later would be a
   * layout shift for markup nobody reads.
   *
   * One computation feeds both halves: the matching runs once over every drink,
   * the top half shows the slice within reach, and the set-cover reads the whole
   * thing — including the drinks that are far from complete, which are exactly
   * the ones a single bottle finishes.
   */
  import { onMount } from 'svelte';

  import { add, barStore, remove, starterSet, toggle, type BarState } from '../../lib/bar/inventory.ts';
  import { matchAll, withinReach, type DrinkMatch } from '../../lib/bar/match.ts';
  import { unlockRanking } from '../../lib/bar/set-cover.ts';
  import { loadCatalog, loadIngredients, base } from '../../lib/client/data.ts';
  import type { CatalogEntry, IndexedIngredient } from '../../lib/catalog.ts';
  import { addItem, planStore } from '../../lib/plan/store.ts';
  import type { StorageNotice } from '../../lib/storage.ts';

  let entries = $state<CatalogEntry[]>([]);
  let ingredients = $state<IndexedIngredient[]>([]);
  let bar = $state<BarState>({ have: [] });
  let notice = $state<StorageNotice | null>(null);
  let persistent = $state(true);
  let status = $state<'loading' | 'ready' | 'failed'>('loading');
  let query = $state('');
  let showAll = $state(false);
  let added = $state<string | null>(null);

  const byId = $derived(new Map(ingredients.map((i) => [i.id, i])));
  const isStaple = (id: string): boolean => byId.get(id)?.staple === true;
  const nameOf = (id: string): string => byId.get(id)?.name ?? id;

  onMount(async () => {
    const loaded = barStore.load();
    bar = loaded.value;
    notice = loaded.notice;
    persistent = loaded.persistent;
    barStore.subscribe((value) => (bar = value));

    try {
      const [catalog, index] = await Promise.all([loadCatalog(), loadIngredients()]);
      entries = catalog.drinks;
      ingredients = index.ingredients;
      status = 'ready';
    } catch {
      status = 'failed';
    }
  });

  function commit(next: BarState): void {
    bar = next;
    persistent = barStore.save(next) && persistent;
  }

  const owned = $derived(new Set(bar.have));
  const matches = $derived(
    status === 'ready' ? matchAll(entries, { owned, isStaple }) : ([] as DrinkMatch[]),
  );
  const reachable = $derived(withinReach(matches));
  const shown = $derived(showAll ? reachable : reachable.slice(0, 12));
  const unlocks = $derived(unlockRanking(matches));

  /**
   * What the picker offers.
   *
   * Only ingredients a published drink names, and never a staple: a staple is
   * assumed present everywhere, so offering one is offering a switch that does
   * nothing.
   *
   * Preparations ARE offered. A jar of simple syrup in the fridge is a thing
   * somebody has, and it is the single most common one — leaving it out would
   * mean a sour could never reach a hundred per cent for a reader who made a
   * batch last week. It is also what the starter set suggests, and a suggestion
   * that cannot then be unticked is a trap.
   */
  const pickable = $derived(ingredients.filter((i) => i.used && !i.staple));

  const filtered = $derived(
    query.trim()
      ? pickable.filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()))
      : pickable,
  );

  const grouped = $derived.by(() => {
    const groups = new Map<string, IndexedIngredient[]>();
    for (const ingredient of filtered) {
      const list = groups.get(ingredient.group) ?? [];
      list.push(ingredient);
      groups.set(ingredient.group, list);
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  });

  const basics = $derived(starterSet(entries, isStaple));

  function addBasics(): void {
    commit({ have: [...new Set([...bar.have, ...basics])].sort() });
  }

  /** Put a drink you can make straight into the plan. The obvious next thing. */
  function toPlan(entry: CatalogEntry): void {
    const plan = planStore.load().value;
    planStore.save(
      addItem(plan, { drink: entry.slug, version: entry.version, drinks: 1, service: 'order' }),
    );
    added = entry.slug;
    setTimeout(() => (added = null), 2400);
  }

  const pct = (value: number): string => `${Math.round(value * 100)}%`;
</script>

{#if notice}
  <div class="wrap"><p class="callout callout--pitfall"><b>Note</b>{notice.message}</p></div>
{/if}

{#if status === 'loading'}
  <div class="wrap"><p class="aside">Reading the catalogue…</p></div>
{:else if status === 'failed'}
  <div class="wrap">
    <p class="callout">
      The catalogue could not be loaded, so nothing can be matched against your shelf. Reloading
      the page is usually enough.
    </p>
  </div>
{:else}
  <div class="wrap tool-grid">
    <!-- ---------------------------------------------------------------- -->
    <!-- The shelf                                                         -->
    <!-- ---------------------------------------------------------------- -->
    <section class="card shelf" aria-labelledby="shelf-head">
      <h2 class="card-title" id="shelf-head">Your shelf</h2>

      {#if bar.have.length === 0}
        <p class="empty-lede">
          Nothing here yet. Tell eXir what you have and it will work out what you can make, and
          which single bottle would unlock the most.
        </p>
        {#if basics.length}
          <button class="btn-wide" type="button" onclick={addBasics}>
            I have the basics — add {basics.length} bottles
          </button>
          <p class="aside">{basics.map(nameOf).join(' · ')}</p>
        {/if}
      {:else}
        <ul class="chip-list">
          {#each bar.have as id (id)}
            <li>
              <button class="chip chip--held" type="button" onclick={() => commit(remove(bar, id))}>
                {nameOf(id)}<span aria-hidden="true">×</span>
                <span class="visually-hidden">Remove from your shelf</span>
              </button>
            </li>
          {/each}
        </ul>
        <p class="aside">
          {bar.have.length}
          {bar.have.length === 1 ? 'bottle' : 'bottles'} ·
          <button class="link-button" type="button" onclick={() => commit({ have: [] })}>
            Clear the shelf
          </button>
        </p>
      {/if}

      <div class="picker">
        <label class="visually-hidden" for="bar-search">Find an ingredient</label>
        <input
          class="search-input"
          id="bar-search"
          type="search"
          placeholder="Find an ingredient"
          autocomplete="off"
          bind:value={query}
        />

        <div class="picker-body">
          {#each grouped as [group, list] (group)}
            <h3 class="picker-group">{group}</h3>
            <ul class="picker-list">
              {#each list as ingredient (ingredient.id)}
                <li class="ing-item" class:is-checked={owned.has(ingredient.id)}>
                  <input
                    class="tick"
                    type="checkbox"
                    id={`have-${ingredient.id}`}
                    checked={owned.has(ingredient.id)}
                    onchange={() => commit(toggle(bar, ingredient.id))}
                  />
                  <label class="ing-body" for={`have-${ingredient.id}`}>{ingredient.name}</label>
                </li>
              {/each}
            </ul>
          {:else}
            <p class="aside">Nothing matches “{query}”.</p>
          {/each}
        </div>
      </div>

      {#if !persistent}
        <p class="disclaimer">
          <strong>Not saved.</strong> This browser is not letting the site store anything, so your
          shelf will be gone when you close the tab. Everything on this page still works.
        </p>
      {/if}
    </section>

    <!-- ---------------------------------------------------------------- -->
    <!-- What you can make, and what one more bottle unlocks               -->
    <!-- ---------------------------------------------------------------- -->
    <div class="col-stack">
      <section class="card" aria-labelledby="make-head">
        <h2 class="card-title" id="make-head">What you can make now</h2>

        {#if reachable.length === 0}
          <p class="empty-lede">
            {bar.have.length === 0
              ? 'Add something to your shelf and this fills in.'
              : 'Nothing on the site is close enough yet. The suggestion below is the shortest way to change that.'}
          </p>
        {:else}
          <ul class="match-list">
            {#each shown as match (match.entry.slug)}
              <li class="match" class:is-complete={match.complete}>
                <div class="match-head">
                  <a class="match-title" href={`${base()}/drinks/${match.entry.slug}/`}>
                    {match.entry.title}
                  </a>
                  <span class="match-pct" class:is-complete={match.complete}>{pct(match.percent)}</span>
                </div>
                <p class="match-meta">
                  {match.entry.style}
                  {#if match.entry.abvPercent > 0}
                    · <span class="alc">{match.entry.abvPercent.toFixed(1)}% ABV</span>
                  {:else}
                    · Zero-proof
                  {/if}
                </p>

                {#if match.missing.length}
                  <p class="match-missing">
                    Missing: {match.missing.map(nameOf).join(', ')}
                  </p>
                {/if}
                {#each match.substituted as sub (sub.wanted)}
                  <p class="match-sub">
                    Substituting {nameOf(sub.using)} for {nameOf(sub.wanted)}
                  </p>
                {/each}
                {#if match.alsoWant.length}
                  <p class="match-also">You'll also want: {match.alsoWant.map(nameOf).join(', ')}</p>
                {/if}

                {#if match.complete}
                  <button class="chip" type="button" onclick={() => toPlan(match.entry)}>
                    {added === match.entry.slug ? 'Added to the plan' : 'Add to the plan'}
                  </button>
                {/if}
              </li>
            {/each}
          </ul>

          {#if reachable.length > shown.length}
            <button class="btn-wide" type="button" onclick={() => (showAll = true)}>
              Show all {reachable.length}
            </button>
          {/if}
        {/if}
      </section>

      <section class="card" aria-labelledby="unlock-head">
        <h2 class="card-title" id="unlock-head">What one more bottle unlocks</h2>

        {#if unlocks.length === 0}
          <p class="empty-lede">
            Nothing on the site is one bottle away from your shelf yet.
          </p>
        {:else}
          <ul class="unlock-list">
            {#each unlocks as unlock (unlock.id)}
              <li class="unlock">
                <div class="unlock-head">
                  <a class="unlock-name" href={`${base()}/ingredients/${unlock.id}/`}>
                    {nameOf(unlock.id)}
                  </a>
                  <span class="unlock-count">
                    unlocks <b>{unlock.count}</b>
                    {unlock.count === 1 ? 'drink' : 'drinks'}
                  </span>
                </div>
                <p class="unlock-drinks">{unlock.titles.join(' · ')}</p>
                <button class="chip" type="button" onclick={() => commit(add(bar, unlock.id))}>
                  Add to my shelf
                </button>
              </li>
            {/each}
          </ul>
          <p class="aside">
            Counted only where the bottle finishes a drink outright. Ties go to the one that spans
            the most families, because breadth is worth more than five versions of one drink.
          </p>
        {/if}
      </section>
    </div>
  </div>
{/if}
