/**
 * The drink page's controls.
 *
 * Everything numeric flows through the shared display store, so the stepper and
 * the unit toggle do not update anything themselves — they set state, and the
 * one shared live-value updater rewrites every span on the page from it.
 *
 * The service control is the exception worth reading. Switching it changes the
 * checklist, the method, the vessel and the timing, and it visibly leaves every
 * per-drink figure in the spec panel exactly where it was. That equality is the
 * proof the batch arithmetic is right, which is why the page shows it rather
 * than asserting it.
 */

import { drinks, service, setDrinks, setScale } from '../stores/display.ts';
import { applyDisplayState } from './live-values.ts';
import { addItem, planStore } from '../plan/store.ts';
import { base } from './data.ts';
import type { ServiceMode } from '../math/types.ts';

const MIN_BATCH_DRINKS = 2;

const all = <T extends HTMLElement>(selector: string, root: ParentNode = document): T[] =>
  [...root.querySelectorAll<T>(selector)];

function pressOne(group: HTMLElement | null, value: string): void {
  if (!group) return;
  for (const button of all<HTMLButtonElement>('button', group)) {
    button.setAttribute('aria-pressed', String(button.dataset['value'] === value));
  }
}

/**
 * Which version is on screen.
 *
 * Batching, the batch note, whether there is any ice and a brew's dose and yield
 * are all properties of the VERSION, and the Serving card is one card for the
 * page — so the card reads them off whichever version block is currently
 * showing rather than carrying a copy of them.
 *
 * Three separate elements carry `data-version` for one version — the fact row,
 * the left column's block and the right column's — and only the middle one
 * carries the data. So this names what it is looking for INSIDE the block rather
 * than trusting document order: an earlier selector went looking for a
 * `[data-version]` inside a `.left-col`, which is the relationship the other way
 * round and matched nothing, so every read here silently fell back to the fact
 * row, which declares none of these, and then to the page root. A single-version
 * drink was unaffected because the root carries the same values; a two-version
 * drink that DIFFERED on any of them — the case this function exists for — got
 * the default version's answer on both tabs.
 */
function activeVersion(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('[data-version]')) {
    if (!el.hidden && el.querySelector('.left-col')) return el;
  }
  return document.querySelector<HTMLElement>('[data-version]:not([hidden])');
}

/** Batched service is unavailable below two drinks, and the control says so. */
function paintService(root: HTMLElement, mode: ServiceMode, count: number): void {
  const version = activeVersion();
  const batchable = version?.dataset['batchable'] ?? root.dataset['batchable'] ?? 'none';
  /**
   * Two different unavailabilities, and only one of them is permanent.
   *
   * A drink that takes no dilution from ice cannot be batched at all, and its
   * control is genuinely disabled. A drink below the two-drink minimum is only
   * temporarily below it — disabling the control there would leave a reader who
   * wants to batch for a party to work out for themselves that they must press
   * the plus button first. Clicking it raises the count instead, which is what
   * they were reaching for anyway.
   */
  const possible = batchable !== 'none';
  const allowed = possible && count >= MIN_BATCH_DRINKS;

  const row = document.querySelector<HTMLElement>('[data-service-row]');
  row?.classList.toggle('is-disabled', !possible);

  const reason = document.querySelector<HTMLElement>('[data-service-reason]');
  if (reason) {
    reason.textContent =
      batchable === 'none'
        ? (version?.dataset['batchNote'] ||
           root.dataset['batchNote'] ||
           'This drink takes no dilution from ice, so there is nothing to batch.')
        : count < MIN_BATCH_DRINKS
          ? `Batching starts at ${MIN_BATCH_DRINKS} drinks.`
          : '';
    reason.hidden = reason.textContent === '';
  }

  for (const button of all<HTMLButtonElement>('[data-service-control] button')) {
    button.disabled = !possible && button.dataset['value'] === 'batch';
  }

  const effective: ServiceMode = allowed ? mode : 'order';
  root.dataset['service'] = effective;
  pressOne(document.querySelector('[data-service-control]'), effective);

  // Ice is a made-to-order control. In a batch nothing meets ice at service, so
  // it is disabled with a visible reason rather than silently ignored.
  // Ice is a per-version fact: the same drink served up in one version and over
  // ice in another has a control in one and none in the other.
  const iceRow = document.querySelector<HTMLElement>('[data-ice-row]');
  if (iceRow && version) iceRow.hidden = version.dataset['hasIce'] === undefined;
  iceRow?.classList.toggle('is-disabled', effective === 'batch');
  const iceReason = document.querySelector<HTMLElement>('[data-ice-reason]');
  if (iceReason) {
    // A drink that never meets ice renders no ice row at all, and an explanation
    // of why a control is unavailable is nonsense where there is no control.
    iceReason.hidden = effective !== 'batch' || iceRow?.hidden === true;
  }
  for (const button of all<HTMLButtonElement>('[data-ice] button')) {
    button.disabled = effective === 'batch';
  }

  for (const el of all<HTMLElement>('[data-when-service]')) {
    el.hidden = el.dataset['whenService'] !== effective;
  }

  paintScaleControl(version, count);
}

/**
 * Show the count stepper or the brew inputs, whichever asks this version's
 * question, and keep the one on screen current.
 *
 * They are two faces of one multiplier rather than two counts — §19.5's rule
 * that a fact gets exactly one display slot is why only ever one of them is
 * visible.
 */
function paintScaleControl(version: HTMLElement | null, count: number): void {
  const { dose, yieldMl, factor } = brewScale(version, count);
  const brewed = dose > 0 && yieldMl > 0;

  const drinksRow = document.querySelector<HTMLElement>('[data-drinks-row]');
  const brewRow = document.querySelector<HTMLElement>('[data-brew-row]');
  const brewReason = document.querySelector<HTMLElement>('[data-brew-reason]');
  if (drinksRow) drinksRow.hidden = brewed;
  if (brewRow) brewRow.hidden = !brewed;
  if (brewReason) brewReason.hidden = !brewed;
  if (!brewed || !brewRow) return;

  // Never while it is being typed into: rewriting the field under the cursor
  // eats the second digit of every two-digit number.
  //
  // Rounded the way `roundBase` rounds a displayed measure, so the figure in the
  // field and the same figure in the checklist below it agree. They are the one
  // quantity seen twice, and a reader who saw 17.2 here and 17 g there would be
  // right to wonder which the recipe meant.
  const write = (selector: string, value: number): void => {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input || input === document.activeElement) return;
    input.value = String(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10);
  };
  write('[data-brew-dose-input]', dose * factor);
  write('[data-brew-yield-input]', yieldMl * factor);
}

/**
 * The brew block's authored figures, which are for the whole recipe rather than
 * for one cup, and the multiple of it currently on screen.
 */
function brewScale(
  version: HTMLElement | null,
  count: number,
): { dose: number; yieldMl: number; factor: number; defaultDrinks: number } {
  const defaultDrinks = Number(version?.dataset['defaultDrinks'] ?? '1') || 1;
  return {
    dose: Number(version?.dataset['brewDose'] ?? '') || 0,
    yieldMl: Number(version?.dataset['brewYield'] ?? '') || 0,
    factor: count / defaultDrinks,
    defaultDrinks,
  };
}

export function initDrink(): void {
  const root = document.querySelector<HTMLElement>('[data-drink]');
  if (!root) return;

  const defaultDrinks = Number(root.dataset['defaultDrinks'] ?? '1') || 1;
  drinks.set(defaultDrinks);

  // --- the stepper -----------------------------------------------------------
  const count = document.querySelector<HTMLElement>('[data-drink-count]');
  drinks.subscribe((n) => {
    // The brew scale can put a fraction in the store. The stepper is hidden on a
    // brewed version, but a drink with one brewed version and one that is not
    // shows this again on the way back, and "1.5625" is not a number of drinks.
    if (count) count.textContent = String(Number(n.toFixed(2)));
    const minus = document.querySelector<HTMLButtonElement>('[data-drinks-minus]');
    if (minus) minus.disabled = n <= 1;
    paintService(root, service.get(), n);
  });

  document
    .querySelector('[data-drinks-minus]')
    ?.addEventListener('click', () => setDrinks(drinks.get() - 1));
  document
    .querySelector('[data-drinks-plus]')
    ?.addEventListener('click', () => setDrinks(drinks.get() + 1));

  // --- the brew scale --------------------------------------------------------
  // Each input answers the same question in its own terms, so each converts its
  // own figure back to the page multiplier and lets the shared updater rewrite
  // everything, the other input included.
  const wireBrewInput = (selector: string, key: 'dose' | 'yieldMl'): void => {
    document.querySelector<HTMLInputElement>(selector)?.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement;
      const wanted = Number(target.value);
      if (!Number.isFinite(wanted) || wanted <= 0) return;
      const { defaultDrinks, ...authored } = brewScale(activeVersion(), drinks.get());
      const base = authored[key];
      if (base > 0) setScale((wanted / base) * defaultDrinks);
    });
  };
  wireBrewInput('[data-brew-dose-input]', 'dose');
  wireBrewInput('[data-brew-yield-input]', 'yieldMl');

  // --- service ---------------------------------------------------------------
  document.querySelector('[data-service-control]')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const mode = (button.dataset['value'] ?? 'order') as ServiceMode;
    // Batching one drink is not a thing anyone does; jump to a party rather
    // than refusing the click.
    if (mode === 'batch' && drinks.get() < MIN_BATCH_DRINKS) setDrinks(12);
    service.set(mode);
  });
  service.subscribe((mode) => paintService(root, mode, drinks.get()));

  // Units are wired in `chrome.ts`, because a family's formula carries the same
  // control and this page is not the only one that converts.

  // --- ice -------------------------------------------------------------------
  document.querySelector('[data-ice]')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    pressOne(document.querySelector('[data-ice]'), button.dataset['value'] ?? '');
  });

  // --- into the plan ---------------------------------------------------------
  // Carries the count and the mode that are already set on this page. Sending a
  // reader to the planner to restate two things they have just chosen is how a
  // feature ends up unused.
  document.querySelector('[data-add-to-plan]')?.addEventListener('click', () => {
    const version = activeVersion()?.dataset['version'] ?? root.dataset['drink'] ?? '';
    const slug = location.pathname.replace(/\/$/, '').split('/').pop() ?? '';
    if (!slug || !version) return;

    // A brew scale can leave the multiplier on a fraction — a reader asking for
    // 500 ml out of a recipe that yields 320 is asking for a part of a second
    // brew. The plan counts servings, and a fifth of a cup is not one, so it
    // rounds up and says it did rather than quietly buying too little.
    const exact = drinks.get();
    const planned = Math.max(1, Math.ceil(exact));
    const rounded = planned !== exact;

    const saved = planStore.save(
      addItem(planStore.load().value, {
        drink: slug,
        version,
        drinks: planned,
        service: service.get(),
      }),
    );

    const note = document.querySelector<HTMLElement>('[data-plan-added]');
    if (!note) return;
    const roundedNote = rounded ? ` Rounded up to ${planned} — the plan counts servings.` : '';
    note.innerHTML = saved
      ? `Added.${roundedNote} <a href="${base()}/plan/">Open the plan</a>.`
      : 'Added for this visit — this browser is not letting the site store anything.';
    note.hidden = false;
  });

  // --- step completion -------------------------------------------------------
  // Toggles a class only. The step text stays in the DOM in every state.
  for (const mark of all<HTMLButtonElement>('[data-step-mark]')) {
    mark.addEventListener('click', () => {
      const step = mark.closest('.step');
      const done = step?.classList.toggle('is-done') ?? false;
      mark.setAttribute('aria-pressed', String(done));
    });
  }

  // --- ingredient ticks ------------------------------------------------------
  for (const tick of all<HTMLInputElement>('.tick')) {
    tick.addEventListener('change', () => {
      tick.closest('.ing-item')?.classList.toggle('is-checked', tick.checked);
    });
  }

  // --- the Recipe / About switch and the version strip -----------------------
  wireTabs('[data-panel-switch]', '[data-panel]');
  wireTabs('[data-version-strip]', '[data-version]', () => {
    // A version can differ in whether it batches and whether it meets ice, and
    // the one Serving card describes whichever is on screen.
    paintService(root, service.get(), drinks.get());
  });

  paintService(root, service.get(), defaultDrinks);
  applyDisplayState();
}

/**
 * Wire a strip of mutually exclusive controls to the panels it shows.
 *
 * The two strips on this page are deliberately different KINDS of control and
 * carry different semantics. The Recipe / About switch is a real tab list: two
 * controls, one panel each, panels adjacent to the strip — so it gets
 * `aria-selected`, a roving tabindex and arrow-key movement, which is the
 * pattern a screen reader announces as tabs.
 *
 * The version strip is a group of toggle buttons. It changes the fact row, the
 * left column and the right column at once, in three different grid cells, so
 * there is no single panel for a tab to point at. It gets `aria-pressed`, and
 * Tab moves between its buttons like any other group. Arrow keys still work,
 * because a row of related controls should answer them either way.
 */
function wireTabs(stripSelector: string, panelSelector: string, after?: () => void): void {
  const strip = document.querySelector<HTMLElement>(stripSelector);
  if (!strip) return;
  const tabs = all<HTMLButtonElement>('button', strip);
  const key = panelSelector.includes('version') ? 'version' : 'panel';
  const isTabList = strip.getAttribute('role') === 'tablist';
  const state = isTabList ? 'aria-selected' : 'aria-pressed';

  const select = (value: string): void => {
    for (const tab of tabs) {
      const on = tab.dataset['value'] === value;
      tab.setAttribute(state, String(on));
      // A tab list is one Tab stop; the arrows move within it. A group of
      // toggles is not, so every button stays reachable by Tab.
      if (isTabList) tab.tabIndex = on ? 0 : -1;
    }
    for (const panel of all<HTMLElement>(panelSelector)) {
      panel.hidden = panel.dataset[key] !== value;
    }
    after?.();
  };

  strip.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button?.dataset['value']) select(button.dataset['value']);
  });

  strip.addEventListener('keydown', (event) => {
    const index = tabs.findIndex((t) => t === document.activeElement);
    if (index < 0) return;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length];
    next?.focus();
    if (next?.dataset['value']) select(next.dataset['value']);
  });
}
