/**
 * The one script that keeps every live value on the page current.
 *
 * Not one island per value. A drink page carries thirty to fifty quantities,
 * temperatures and dimensions driven by three pieces of state, so hydrating
 * each of them separately would ship a great deal of JavaScript to re-render
 * text a few lines can update in place.
 *
 * It calls the same formatting functions the server used, so the value after a
 * change comes from the same code as the value before it. Everything it imports
 * is schema-free by design — reaching the content schemas from here would ship
 * Zod to the browser to do nothing.
 */

import { formatCountUnit, formatQuantity } from '../math/quantity.ts';
import type { BaseUnit, CountUnit, UnitSystem } from '../math/types.ts';
import { formatLength, formatMeasure, formatTemperature } from '../math/units.ts';
import { drinks, service, unitSystem } from '../stores/display.ts';

const num = (el: HTMLElement, name: string): number | undefined => {
  const raw = el.dataset[name];
  return raw == null ? undefined : Number(raw);
};

function countUnitOf(el: HTMLElement): CountUnit | null {
  const per = num(el, 'countPer');
  if (per == null || per <= 0) return null;
  const unit = el.dataset.unit as BaseUnit | undefined;
  return {
    singular: el.dataset.countSingular ?? '',
    plural: el.dataset.countPlural ?? '',
    snap: el.dataset.countSnap === 'whole' ? 'whole' : 'half',
    ...(unit === 'g' ? { g: per } : { ml: per }),
  };
}

function updateQuantity(el: HTMLElement, count: number, system: UnitSystem): void {
  const amount = num(el, 'amount');
  const defaultDrinks = num(el, 'defaultDrinks');
  const unit = el.dataset.unit as BaseUnit | undefined;
  if (amount == null || !defaultDrinks || !unit) return;

  const scaled = amount * (count / defaultDrinks) * (num(el, 'fraction') ?? 1);
  const estimated = el.dataset.estimated !== undefined;
  const target = el.querySelector<HTMLElement>('.n');
  if (!target) return;

  const countUnit = countUnitOf(el);
  if (countUnit) {
    const counted = formatCountUnit(scaled, unit, countUnit);
    if (counted) {
      const countEl = el.querySelector<HTMLElement>('.q-count');
      const nameEl = el.querySelector<HTMLElement>('.q-name');
      if (countEl) countEl.textContent = counted.count;
      if (nameEl) nameEl.textContent = counted.label;
      target.textContent = estimated ? `~${counted.measure}` : counted.measure;
      return;
    }
  }

  const { text } = formatQuantity(scaled, unit, system, { estimated });
  target.textContent = estimated ? `~${text}` : text;
}

/**
 * A computed figure that converts with the unit system and does not scale.
 *
 * The spec panel is per drink and invariant under the stepper — that invariance
 * is what makes the two service modes comparable — but it still has to answer
 * the ml/oz toggle, so it needs its own attribute rather than sharing the one
 * that multiplies.
 */
function updateMeasure(el: HTMLElement, system: UnitSystem): void {
  const amount = num(el, 'measure');
  const unit = el.dataset.unit as BaseUnit | undefined;
  if (amount == null || !unit) return;

  const { value, label } = formatMeasure(amount, unit, system);
  const n = el.querySelector<HTMLElement>('.n');
  const u = el.querySelector<HTMLElement>('.u');
  if (n) n.textContent = el.dataset.estimated !== undefined ? `~${value}` : value;
  if (u) u.textContent = label;
}

/**
 * A figure stated per drink that multiplies up — a batch yield, a shopping
 * total — as against the spec panel's figures, which do not move at all.
 */
function updatePerDrink(el: HTMLElement, count: number, system: UnitSystem): void {
  const perDrink = num(el, 'perDrink');
  if (perDrink == null) return;
  const unit = el.dataset.unit as BaseUnit | undefined;
  if (!unit) {
    el.textContent = String(Math.round(perDrink * count));
    return;
  }
  el.textContent = formatQuantity(perDrink * count, unit, system).text;
}

/**
 * Apply the current state to the whole document.
 *
 * Durations and strengths are absent on purpose. A duration in prose is a
 * per-drink instruction — twelve drinks is twelve 25-second stirs, not one
 * five-minute one — and a bottle's strength is a fact about the bottle. Neither
 * moves with the count or the unit system, so what the server rendered stays
 * correct for the life of the page.
 */
/**
 * A subtree marked `data-live-static` keeps whatever the server rendered.
 *
 * There is one count for the whole page, so any two spans driven by the store
 * necessarily show the same one. That is right for a drink page — one count,
 * two service modes, one checklist — but a view that deliberately renders the
 * same quantity at two different counts side by side would otherwise be
 * flattened to one of them the moment the script runs, silently and after the
 * reader had already seen the correct figure.
 */
const isStatic = (el: HTMLElement): boolean => el.closest('[data-live-static]') !== null;

export function applyDisplayState(root: ParentNode = document): void {
  const count = drinks.get();
  const system = unitSystem.get();

  if (count > 0) {
    for (const el of root.querySelectorAll<HTMLElement>('[data-qty]')) {
      if (!isStatic(el)) updateQuantity(el, count, system);
    }
    for (const el of root.querySelectorAll<HTMLElement>('[data-per-drink]')) {
      if (!isStatic(el)) updatePerDrink(el, count, system);
    }
  }

  // Outside the count guard: a spec figure is correct before a count exists,
  // because it never depended on one.
  for (const el of root.querySelectorAll<HTMLElement>('[data-measure]')) {
    if (!isStatic(el)) updateMeasure(el, system);
  }

  for (const el of root.querySelectorAll<HTMLElement>('[data-temp-c]')) {
    const c = num(el, 'tempC');
    if (c != null && !isStatic(el)) {
      el.textContent = formatTemperature(
        c,
        system,
        el.dataset.tempPrecision === 'coarse' ? 'coarse' : 'fine',
      );
    }
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-len-cm]')) {
    const cm = num(el, 'lenCm');
    if (cm != null && !isStatic(el)) el.textContent = formatLength(cm, system);
  }
}

/** Reflect the service mode onto the document so CSS can show the right sequence. */
function applyService(root: HTMLElement | null): void {
  if (root) root.dataset.service = service.get();
}

/**
 * Wire the page up.
 *
 * The default drink count comes out of the rendered document, so this script
 * has no build-time knowledge of the drink it is on.
 */
export function initLiveValues(): void {
  const root = document.querySelector<HTMLElement>('[data-drink]');
  if (root) {
    drinks.set(Number(root.dataset.defaultDrinks ?? '1') || 1);
  } else {
    // A page with live values but no drink count — a Component's or a
    // Preparation's own page, where the amounts are a batch. The store's zero
    // guard would otherwise leave every quantity frozen.
    drinks.set(1);
  }

  applyDisplayState();
  applyService(root);
  drinks.subscribe(() => applyDisplayState());
  unitSystem.subscribe(() => applyDisplayState());
  service.subscribe(() => applyService(root));
}
