<script lang="ts">
  /**
   * The Plan — the occasion, the drinks in it, the shopping list that follows,
   * and what a host actually needs.
   *
   * `client:only`, because none of it exists at build time. Everything shown is
   * recomputed from today's catalogue on every load: the plan itself holds only
   * references and scalars, so a month-old plan silently benefits from every
   * correction made since.
   *
   * A plan arriving in a share link is rendered READ-ONLY beside the reader's
   * own. Opening someone else's list must never overwrite yours.
   */
  import { onMount } from 'svelte';

  import { buildShoppingList, type ShoppingLine, type ShoppingList } from '../../lib/plan/aggregate.ts';
  import { buildOccasion, BOTTLE, ICE, type OccasionView } from '../../lib/plan/occasion.ts';
  import { resolvePlan, type ResolvedPlan } from '../../lib/plan/resolve.ts';
  import { decodeItems, shareText, shareUrl, shoppingText } from '../../lib/plan/share.ts';
  import {
    addItem,
    emptyPlan,
    planStore,
    removeItem,
    setIncludeStaples,
    setOccasion,
    setPreparationChoice,
    toggleHave,
    updateItem,
    type PlanState,
  } from '../../lib/plan/store.ts';
  import { base, loadCatalog, loadDetails, loadIngredients } from '../../lib/client/data.ts';
  import { countedName, type CatalogEntry, type DrinkDetail, type IndexedIngredient } from '../../lib/catalog.ts';
  import { formatCountUnit, formatQuantity } from '../../lib/math/quantity.ts';
  import type { UnitSystem } from '../../lib/math/types.ts';
  import { formatBulkWeight, formatDuration, formatMetric } from '../../lib/math/units.ts';
  import type { StorageNotice } from '../../lib/storage.ts';

  let plan = $state<PlanState>(emptyPlan());
  /** A plan from a share link. Never merged, never saved, until asked. */
  let shared = $state<PlanState | null>(null);
  let notice = $state<StorageNotice | null>(null);
  let persistent = $state(true);
  let status = $state<'loading' | 'ready' | 'failed'>('loading');
  let system = $state<UnitSystem>('metric');
  let entries = $state(new Map<string, CatalogEntry>());
  let details = $state(new Map<string, DrinkDetail>());
  let ingredients = $state(new Map<string, IndexedIngredient>());
  let shareState = $state<string | null>(null);

  const active = $derived(shared ?? plan);
  const readOnly = $derived(shared !== null);

  async function ensureDetails(state: PlanState): Promise<void> {
    const missing = state.items.map((i) => i.drink).filter((slug) => !details.has(slug));
    if (!missing.length) return;
    const loaded = await loadDetails(missing);
    details = new Map([...details, ...loaded]);
  }

  onMount(async () => {
    const loaded = planStore.load();
    plan = loaded.value;
    notice = loaded.notice;
    persistent = loaded.persistent;
    planStore.subscribe((value) => {
      plan = value;
      void ensureDetails(value);
    });

    const fragment = decodeItems(globalThis.location.hash);
    if (fragment.length) {
      let incoming = emptyPlan();
      for (const item of fragment) incoming = addItem(incoming, item);
      shared = incoming;
    }

    try {
      const [catalog, index] = await Promise.all([loadCatalog(), loadIngredients()]);
      entries = new Map(catalog.drinks.map((d) => [d.slug, d]));
      ingredients = new Map(index.ingredients.map((i) => [i.id, i]));
      await ensureDetails(plan);
      if (shared) await ensureDetails(shared);
      status = 'ready';
    } catch {
      status = 'failed';
    }
  });

  function commit(next: PlanState): void {
    plan = next;
    persistent = planStore.save(next) && persistent;
    void ensureDetails(next);
  }

  /**
   * A shared plan resolves against a version id the sender's link may not have
   * carried. `default` means "whatever the catalogue calls the default today".
   */
  const normalised = $derived.by(() => {
    if (!shared) return active;
    return {
      ...shared,
      items: shared.items.map((item) =>
        item.version === 'default'
          ? { ...item, version: entries.get(item.drink)?.version ?? item.version }
          : item,
      ),
    };
  });

  const resolvedPlan = $derived<ResolvedPlan>(
    status === 'ready'
      ? resolvePlan(normalised, entries, details)
      : { items: [], dropped: [] },
  );

  const list = $derived<ShoppingList>(
    buildShoppingList(resolvedPlan.items, normalised, ingredients),
  );

  const occasion = $derived<OccasionView>(
    buildOccasion(
      resolvedPlan.items,
      normalised,
      [...list.buy, ...list.have, ...list.staples],
      ingredients,
    ),
  );

  // ---- formatting -----------------------------------------------------------

  /**
   * A shopping line reads "12  Oranges", not "12 oranges (1 680 g) Orange".
   *
   * Where a Form carries a count unit, the count's own plural IS the name of
   * the thing on a shelf, so it takes the name slot and the base measure moves
   * to the meta line beside the provenance. Naming both puts the ingredient in
   * the row twice under two spellings.
   */
  function quantity(line: ShoppingLine): string {
    const counted = line.countUnit && formatCountUnit(line.amount, line.unit, line.countUnit);
    if (counted) return counted.count;
    return formatQuantity(line.amount, line.unit, system).text;
  }

  function label(line: ShoppingLine): string {
    if (!line.countUnit) return line.name;
    const counted = formatCountUnit(line.amount, line.unit, line.countUnit);
    if (!counted) return line.name;
    return countedName(line.countUnit, Number(counted.count) || 2, line.proseName).replace(
      /^./,
      (c) => c.toUpperCase(),
    );
  }

  const measureNote = (line: ShoppingLine): string => {
    const counted = line.countUnit && formatCountUnit(line.amount, line.unit, line.countUnit);
    return counted ? `${counted.measure} · ` : '';
  };

  const provenance = (line: ShoppingLine): string =>
    line.from
      .map((p) => `${p.title} ×${p.drinks}${p.via.length ? ` · via ${p.via.join(' → ')}` : ''}`)
      .join(', ');

  // ---- sharing --------------------------------------------------------------

  const url = $derived(
    typeof globalThis.location === 'undefined'
      ? ''
      : shareUrl(globalThis.location.origin, base(), normalised.items),
  );

  async function copyList(): Promise<void> {
    const text = shoppingText([...list.buy, ...(normalised.includeStaples ? list.staples : [])], {
      system,
      items: resolvedPlan.items.map((i) => ({
        title: i.entry.title,
        drinks: i.item.drinks,
        service: i.service,
      })),
      url,
      includeStaples: normalised.includeStaples,
    });
    const outcome = await shareText(text);
    shareState =
      outcome === 'shared'
        ? 'Shared.'
        : outcome === 'copied'
          ? 'Copied to the clipboard.'
          : 'Could not copy — select the list and copy it by hand.';
    setTimeout(() => (shareState = null), 3200);
  }

  async function copyLink(): Promise<void> {
    const outcome = await shareText(url, 'Plan — eXir');
    shareState = outcome === 'failed' ? 'Could not copy the link.' : 'Link copied.';
    setTimeout(() => (shareState = null), 3200);
  }

  function adoptShared(): void {
    let next = plan;
    for (const item of normalised.items) next = addItem(next, item);
    commit(next);
    shared = null;
    globalThis.history.replaceState(null, '', globalThis.location.pathname);
  }
</script>

{#if notice}
  <div class="wrap"><p class="callout callout--pitfall"><b>Note</b>{notice.message}</p></div>
{/if}

{#if readOnly}
  <div class="wrap">
    <p class="callout">
      <b>Someone shared this plan with you.</b>
      It is shown as they sent it and nothing here has touched your own plan. What they already had
      at home is deliberately not part of the link.
      <button class="chip" type="button" onclick={adoptShared}>Copy to my plan</button>
    </p>
  </div>
{/if}

{#if status === 'loading'}
  <div class="wrap"><p class="aside">Reading the catalogue…</p></div>
{:else if status === 'failed'}
  <div class="wrap">
    <p class="callout">
      The catalogue could not be loaded, so nothing can be worked out from your plan. Reloading the
      page is usually enough.
    </p>
  </div>
{:else}
  <div class="wrap tool-grid">
    <!-- ---------------------------------------------------------------- -->
    <!-- The occasion and the drinks in it                                 -->
    <!-- ---------------------------------------------------------------- -->
    <div class="col-stack">
      <section class="card" aria-labelledby="occ-head">
        <h2 class="card-title" id="occ-head">The occasion</h2>

        <div class="control-row">
          <span class="control-label" id="guests-label">Guests</span>
          <div class="stepper" role="group" aria-labelledby="guests-label">
            <button
              class="step-btn"
              type="button"
              disabled={readOnly || active.occasion.guests <= 0}
              onclick={() => commit(setOccasion(plan, { guests: plan.occasion.guests - 1 }))}
              aria-label="One guest fewer">−</button>
            <span class="step-count">{active.occasion.guests}</span>
            <button
              class="step-btn"
              type="button"
              disabled={readOnly}
              onclick={() => commit(setOccasion(plan, { guests: plan.occasion.guests + 1 }))}
              aria-label="One guest more">+</button>
          </div>
        </div>

        <div class="control-row">
          <span class="control-label" id="pg-label">Drinks each</span>
          <div class="stepper" role="group" aria-labelledby="pg-label">
            <button
              class="step-btn"
              type="button"
              disabled={readOnly || active.occasion.drinksPerGuest <= 0}
              onclick={() =>
                commit(setOccasion(plan, { drinksPerGuest: plan.occasion.drinksPerGuest - 1 }))}
              aria-label="One drink each fewer">−</button>
            <span class="step-count">{active.occasion.drinksPerGuest}</span>
            <button
              class="step-btn"
              type="button"
              disabled={readOnly}
              onclick={() =>
                commit(setOccasion(plan, { drinksPerGuest: plan.occasion.drinksPerGuest + 1 }))}
              aria-label="One drink each more">+</button>
          </div>
        </div>

        <div class="spec-grid">
          <div class="spec-cell">
            <span class="spec-key">Drinks wanted</span>
            <span class="spec-val">{occasion.targetDrinks}</span>
          </div>
          <div class="spec-cell">
            <span class="spec-key">Drinks planned</span>
            <span class="spec-val">{occasion.plannedDrinks}</span>
          </div>
        </div>

        {#if occasion.plannedDrinks < occasion.targetDrinks}
          <p class="control-reason">
            {occasion.targetDrinks - occasion.plannedDrinks} short of what
            {active.occasion.guests} guests at {active.occasion.drinksPerGuest} each would drink.
          </p>
        {/if}

        <div class="control-row">
          <span class="control-label" id="units-label">Units</span>
          <div class="segmented" role="group" aria-labelledby="units-label">
            <button
              type="button"
              aria-pressed={system === 'metric'}
              onclick={() => (system = 'metric')}>ml</button>
            <button
              type="button"
              aria-pressed={system === 'us'}
              onclick={() => (system = 'us')}>oz</button>
          </div>
        </div>
      </section>

      <section class="card" aria-labelledby="items-head">
        <h2 class="card-title" id="items-head">Drinks</h2>

        {#if resolvedPlan.items.length === 0}
          <p class="empty-lede">
            Nothing planned yet. Add a drink from its own page, or from
            <a href={`${base()}/my-bar/`}>My Bar</a>, and everything below fills in.
          </p>
          <a class="btn-wide" href={`${base()}/`}>Browse the catalogue</a>
        {:else}
          <ul class="plan-items">
            {#each resolvedPlan.items as resolved (resolved.item.uid)}
              <li class="plan-item">
                <div class="plan-item-head">
                  <a class="plan-item-title" href={`${base()}/drinks/${resolved.entry.slug}/`}>
                    {resolved.entry.title}
                  </a>
                  <span class="aside">{resolved.version.label}</span>
                  {#if !readOnly}
                    <button
                      class="link-button"
                      type="button"
                      onclick={() => commit(removeItem(plan, resolved.item.uid))}>
                      Remove<span class="visually-hidden"> {resolved.entry.title}</span>
                    </button>
                  {/if}
                </div>

                <div class="plan-item-controls">
                  <div class="stepper" role="group" aria-label={`How many ${resolved.entry.title}`}>
                    <button
                      class="step-btn"
                      type="button"
                      disabled={readOnly || resolved.item.drinks <= 1}
                      onclick={() =>
                        commit(updateItem(plan, resolved.item.uid, { drinks: resolved.item.drinks - 1 }))}
                      aria-label="One fewer">−</button>
                    <span class="step-count">{resolved.item.drinks}</span>
                    <button
                      class="step-btn"
                      type="button"
                      disabled={readOnly}
                      onclick={() =>
                        commit(updateItem(plan, resolved.item.uid, { drinks: resolved.item.drinks + 1 }))}
                      aria-label="One more">+</button>
                  </div>

                  <div class="segmented" role="group" aria-label="Service">
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={resolved.service === 'order'}
                      onclick={() => commit(updateItem(plan, resolved.item.uid, { service: 'order' }))}
                      >Made to order</button>
                    <button
                      type="button"
                      disabled={readOnly || resolved.version.batchable === 'none'}
                      aria-pressed={resolved.service === 'batch'}
                      onclick={() => commit(updateItem(plan, resolved.item.uid, { service: 'batch' }))}
                      >Batched</button>
                  </div>
                </div>

                {#if resolved.serviceChanged}
                  <p class="control-reason">
                    Saved as batched, and shown made to order: this version
                    {resolved.version.batchable === 'none'
                      ? 'takes no dilution from ice, so there is nothing to batch.'
                      : 'needs at least two drinks to batch.'}
                  </p>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}

        {#if resolvedPlan.dropped.length}
          <p class="control-reason">
            {resolvedPlan.dropped.length}
            {resolvedPlan.dropped.length === 1 ? 'item was' : 'items were'} dropped:
            {resolvedPlan.dropped.map((d) => `${d.item.drink} — ${d.reason}`).join('; ')}.
          </p>
        {/if}

        {#if !persistent}
          <p class="disclaimer">
            <strong>Not saved.</strong> This browser is not letting the site store anything, so this
            plan will be gone when you close the tab. Everything on the page still works, and the
            share link still carries it.
          </p>
        {/if}
      </section>
    </div>

    <!-- ---------------------------------------------------------------- -->
    <!-- The shopping list                                                 -->
    <!-- ---------------------------------------------------------------- -->
    <div class="col-stack">
      <section class="card" aria-labelledby="shop-head">
        <h2 class="card-title" id="shop-head">Shopping list</h2>

        {#if list.buy.length === 0 && list.staples.length === 0}
          <p class="empty-lede">Add a drink and the list works itself out.</p>
        {:else}
          {#each list.warnings as warning (warning)}
            <p class="callout callout--pitfall"><b>Check this</b>{warning}</p>
          {/each}

          {#if list.preparations.length}
            <h3 class="list-head">Made or bought</h3>
            <ul class="prep-list">
              {#each list.preparations as prep (prep.id)}
                <li class="prep">
                  <div class="prep-head">
                    <a class="prep-name" href={`${base()}/preparations/${prep.id}/`}>{prep.name}</a>
                    <span class="aside">{formatMetric(prep.neededMl, 'ml')} needed</span>
                  </div>
                  <p class="aside">
                    The recipe yields {formatMetric(prep.yieldMl, 'ml')}{prep.batches > 1
                      ? ` — ${prep.batches} batches`
                      : ''}{prep.shelfLife
                      ? `, and keeps ${prep.shelfLife.days} days ${prep.shelfLife.storage}`
                      : ''}.
                  </p>
                  <div class="segmented" role="group" aria-label={`${prep.name}: make or buy`}>
                    <button
                      type="button"
                      disabled={readOnly || !prep.purchasable}
                      aria-pressed={prep.choice === 'buy'}
                      onclick={() => commit(setPreparationChoice(plan, prep.id, 'buy'))}>Buy</button>
                    <button
                      type="button"
                      disabled={readOnly}
                      aria-pressed={prep.choice === 'make'}
                      onclick={() => commit(setPreparationChoice(plan, prep.id, 'make'))}>Make</button>
                  </div>
                  {#if !prep.purchasable}
                    <p class="control-reason">Nobody sells this one, so it is always made.</p>
                  {/if}
                  {#if prep.choice === 'buy'}
                    <p class="prep-inputs">
                      Making it instead adds: {prep.inputs
                        .map((i) => `${formatMetric(i.amount, i.unit)} ${i.name.toLowerCase()}`)
                        .join(', ')}.
                    </p>
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}

          <h3 class="list-head">To buy</h3>
          {#if list.buy.length === 0}
            <p class="aside">Nothing — everything is a staple or already ticked off.</p>
          {:else}
            <ul class="shop-list">
              {#each list.buy as line (line.key)}
                <li class="ing-item shop-line">
                  <input
                    class="tick"
                    type="checkbox"
                    id={`have-${line.key}`}
                    checked={line.have}
                    disabled={readOnly}
                    onchange={() => commit(toggleHave(plan, line.ingredientRef))}
                  />
                  <label class="ing-body" for={`have-${line.key}`}>
                    <span class="shop-qty">{quantity(line)}</span>
                    <a href={`${base()}/ingredients/${line.ingredientRef}/`}>{label(line)}</a>
                    <span class="ing-meta">{measureNote(line)}{provenance(line)}</span>
                  </label>
                </li>
              {/each}
            </ul>
          {/if}

          {#if list.have.length}
            <h3 class="list-head">Already have</h3>
            <ul class="shop-list">
              {#each list.have as line (line.key)}
                <li class="ing-item shop-line is-checked">
                  <input
                    class="tick"
                    type="checkbox"
                    id={`have-${line.key}`}
                    checked
                    disabled={readOnly}
                    onchange={() => commit(toggleHave(plan, line.ingredientRef))}
                  />
                  <label class="ing-body" for={`have-${line.key}`}>
                    <span class="shop-qty">{quantity(line)}</span>
                    {label(line)}
                  </label>
                </li>
              {/each}
            </ul>
          {/if}

          {#if list.staples.length}
            <details class="keeping staples">
              <summary>
                Pantry staples ({list.staples.length}) — assumed, and not on the list
              </summary>
              <div class="keeping-body">
                <ul class="shop-list">
                  {#each list.staples as line (line.key)}
                    <li class="shop-line shop-line--plain">
                      <span class="shop-qty">{quantity(line)}</span>
                      {label(line)}
                    </li>
                  {/each}
                </ul>
                <label class="staple-toggle">
                  <input
                    type="checkbox"
                    checked={active.includeStaples}
                    disabled={readOnly}
                    onchange={(e) =>
                      commit(setIncludeStaples(plan, (e.currentTarget as HTMLInputElement).checked))}
                  />
                  Include them when I copy the list
                </label>
              </div>
            </details>
          {/if}

          <p class="aside">
            Totals as computed, not rounded to bottle or packet sizes — eXir has no product data and
            will not invent any. The one exception is the bottle estimate below, which states the
            size it divides by.
          </p>

          <div class="button-row">
            <button class="chip" type="button" onclick={copyList}>Copy the list</button>
            <button class="chip" type="button" onclick={copyLink}>Copy a link to this plan</button>
          </div>
          {#if shareState}<p class="aside" role="status">{shareState}</p>{/if}
        {/if}
      </section>

      <!-- -------------------------------------------------------------- -->
      <!-- What a host actually needs                                      -->
      <!-- -------------------------------------------------------------- -->
      {#if resolvedPlan.items.length}
        <section class="card" aria-labelledby="host-head">
          <h2 class="card-title" id="host-head">What you'll need on the day</h2>

          <h3 class="list-head">Time</h3>
          <div class="spec-grid">
            <div class="spec-cell">
              <span class="spec-key">Active, as planned</span>
              <span class="spec-val">{formatDuration(occasion.timing.activeSec)}</span>
            </div>
            <div class="spec-cell">
              <span class="spec-key">All made to order</span>
              <span class="spec-val">{formatDuration(occasion.timing.activeIfAllToOrderSec)}</span>
            </div>
            <div class="spec-cell">
              <span class="spec-key">All batched ahead</span>
              <span class="spec-val">{formatDuration(occasion.timing.activeIfAllBatchedSec)}</span>
            </div>
          </div>
          <p class="aside">
            Time does not scale the way it looks like it should. Twelve drinks made to order is
            twelve stirs; twelve batched is one combine, and the drink that comes out is the same
            drink.
          </p>

          <h3 class="list-head">Ice</h3>
          <div class="spec-grid">
            <div class="spec-cell">
              <span class="spec-key">Chilling</span>
              <span class="spec-val">{formatBulkWeight(occasion.ice.chillingG, system)}</span>
            </div>
            <div class="spec-cell">
              <span class="spec-key">In the shaker</span>
              <span class="spec-val est">{formatBulkWeight(occasion.ice.mixingG, system)}</span>
            </div>
            <div class="spec-cell">
              <span class="spec-key">In the glass</span>
              <span class="spec-val">{formatBulkWeight(occasion.ice.servingG, system)}</span>
            </div>
            <div class="spec-cell">
              <span class="spec-key">Melt allowance</span>
              <span class="spec-val est">{formatBulkWeight(occasion.ice.meltG, system)}</span>
            </div>
            <div class="spec-cell spec-cell--alcohol">
              <span class="spec-key">Buy</span>
              <span class="spec-val est">{formatBulkWeight(occasion.ice.totalG, system)}</span>
            </div>
          </div>
          <p class="aside">
            Chilling ice is computed from the dilution model — a millilitre of dilution is a gram of
            ice gone. The shaker charge is a stated allowance of
            {formatMetric(ICE.mixingGPerDrink, 'g')} per drink, and the melt allowance is
            {Math.round(ICE.meltAllowance * 100)}% of everything above it. Both are marked as
            estimates because that is what they are.
          </p>
          {#if occasion.ice.savedByBatchingG > 0}
            <p class="callout">
              Batching what you have batched saves
              {formatBulkWeight(occasion.ice.savedByBatchingG, system)} of ice, because a batch
              meets no ice at all — the dilution goes in as water.
            </p>
          {/if}

          {#if occasion.bottles.length}
            <h3 class="list-head">Bottles</h3>
            <ul class="host-list">
              {#each occasion.bottles as bottle (bottle.ingredientRef)}
                <li>
                  <b class="est">{bottle.bottles}</b>
                  {bottle.bottles === 1 ? 'bottle' : 'bottles'} of {bottle.name}
                  <span class="aside">
                    {formatMetric(bottle.totalMl, 'ml')} at a {bottle.bottleMl} ml {bottle.basis}
                  </span>
                </li>
              {/each}
            </ul>
            <p class="aside">
              An estimate, and the one place the site divides by a package size. The denominator is
              stated rather than guessed: {BOTTLE.defaultMl} ml is the EU standard for a spirit
              bottle and {BOTTLE.byCountry['United States']} ml the US one.
            </p>
          {/if}

          {#if occasion.glasses.length}
            <h3 class="list-head">Glasses</h3>
            <ul class="host-list">
              {#each occasion.glasses as glass (glass.id)}
                <li>
                  <b>{glass.drinks}</b> ×
                  <a href={`${base()}/glassware/${glass.id}/`}>{glass.name}</a>
                </li>
              {/each}
            </ul>
          {/if}

          {#if occasion.garnishes.length}
            <h3 class="list-head">Garnishes</h3>
            <ul class="host-list">
              {#each occasion.garnishes as garnish (garnish.ingredientRef)}
                <li><b>{garnish.count}</b> {garnish.label}</li>
              {/each}
            </ul>
          {/if}

          {#if occasion.preparations.length}
            <h3 class="list-head">Make ahead</h3>
            <p class="aside">
              Everything can be made up to
              <b>{occasion.leadTimeDays} days</b> ahead — set by the shortest keeping time, because
              the first thing to turn decides it.
            </p>
            <ul class="host-list">
              {#each occasion.preparations as prep (prep.id)}
                <li>
                  <a href={`${base()}/preparations/${prep.id}/`}>{prep.name}</a>
                  <span class="aside">{prep.days} days, {prep.storage}</span>
                </li>
              {/each}
            </ul>
            <p class="disclaimer">
              <strong>Keeping times are conservative bar practice</strong>, not a food-safety
              authority. Use your judgement, and the usual signs.
            </p>
          {/if}
        </section>
      {/if}
    </div>
  </div>
{/if}
