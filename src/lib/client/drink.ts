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

import { drinks, service, setDrinks, unitSystem } from '../stores/display.ts';
import { applyDisplayState } from './live-values.ts';
import { addItem, planStore } from '../plan/store.ts';
import { base } from './data.ts';
import type { ServiceMode, UnitSystem } from '../math/types.ts';

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
 * Batching, the batch note and whether there is any ice are properties of the
 * VERSION, and the Serving card is one card for the page — so the card reads
 * them off whichever version block is currently showing rather than carrying a
 * copy of them.
 */
function activeVersion(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.left-col [data-version]:not([hidden])')
    ?? document.querySelector<HTMLElement>('[data-version]:not([hidden])');
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
}

export function initDrink(): void {
  const root = document.querySelector<HTMLElement>('[data-drink]');
  if (!root) return;

  const defaultDrinks = Number(root.dataset['defaultDrinks'] ?? '1') || 1;
  drinks.set(defaultDrinks);

  // --- the stepper -----------------------------------------------------------
  const count = document.querySelector<HTMLElement>('[data-drink-count]');
  drinks.subscribe((n) => {
    if (count) count.textContent = String(n);
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

  // --- units -----------------------------------------------------------------
  document.querySelector('[data-units]')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    unitSystem.set((button.dataset['value'] ?? 'metric') as UnitSystem);
  });
  unitSystem.subscribe((system) => {
    pressOne(document.querySelector('[data-units]'), system);
    const note = document.querySelector<HTMLElement>('[data-units-note]');
    // The one place the site rounds a figure it could state exactly, disclosed
    // where the choice is made rather than in a footnote nobody reaches.
    if (note) note.hidden = system !== 'us';
  });

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

    const saved = planStore.save(
      addItem(planStore.load().value, {
        drink: slug,
        version,
        drinks: drinks.get(),
        service: service.get(),
      }),
    );

    const note = document.querySelector<HTMLElement>('[data-plan-added]');
    if (!note) return;
    note.innerHTML = saved
      ? `Added. <a href="${base()}/plan/">Open the plan</a>.`
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

  // --- image credit ----------------------------------------------------------
  // Click, not hover: on a touch screen there is no hover, and a credit that
  // only appears to a mouse is not an attribution.
  for (const toggle of all<HTMLButtonElement>('[data-attribution-toggle]')) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
    });
  }
  document.addEventListener('click', (event) => {
    for (const toggle of all<HTMLButtonElement>('[data-attribution-toggle]')) {
      if (toggle.parentElement?.contains(event.target as Node)) continue;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const toggle of all<HTMLButtonElement>('[data-attribution-toggle]')) {
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

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
 * Both strips are real tab lists, so they carry the keyboard behaviour a tab
 * list is supposed to have. Every panel ships in the HTML and hiding is
 * presentational, so nothing here affects what a crawler reads.
 */
function wireTabs(stripSelector: string, panelSelector: string, after?: () => void): void {
  const strip = document.querySelector<HTMLElement>(stripSelector);
  if (!strip) return;
  const tabs = all<HTMLButtonElement>('button', strip);
  const key = panelSelector.includes('version') ? 'version' : 'panel';

  const select = (value: string): void => {
    for (const tab of tabs) tab.setAttribute('aria-selected', String(tab.dataset['value'] === value));
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
