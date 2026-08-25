/**
 * The substitution control — the one place a reader changes the recipe and
 * watches the spec move.
 *
 * Loaded on demand. Recomputing means running the real engine, which pulls in
 * composition, dilution, alcohol, balance, nutrition and the facets, so it
 * arrives as its own chunk on the first click rather than on every drink page
 * for every reader. Most readers never open one.
 *
 * The recompute calls `computeDrinkSpec`, the same function the build called.
 * A simpler client-side approximation would be a second implementation free to
 * disagree with the panel it is replacing, which is the failure the engine
 * exists to prevent.
 */

import { formatMeasure } from '../math/units.ts';
import type { UnitSystem } from '../math/types.ts';
import { unitSystem } from '../stores/display.ts';
import type { SubPayload } from '../render/substitutions.ts';

type Engine = {
  computeDrinkSpec: typeof import('../math/spec.ts').computeDrinkSpec;
  applySubstitutions: typeof import('../render/substitutions.ts').applySubstitutions;
};

let engine: Engine | null = null;

async function load(): Promise<Engine> {
  if (engine) return engine;
  const [spec, subs] = await Promise.all([
    import('../math/spec.ts'),
    import('../render/substitutions.ts'),
  ]);
  engine = { computeDrinkSpec: spec.computeDrinkSpec, applySubstitutions: subs.applySubstitutions };
  return engine;
}

const payloadFor = (version: HTMLElement): SubPayload | null => {
  const script = version.querySelector<HTMLScriptElement>('[data-sub-payload]');
  if (!script?.textContent) return null;
  try {
    return JSON.parse(script.textContent) as SubPayload;
  } catch {
    return null;
  }
};

/** Rewrite one `data-measure` span in place, leaving the live-value wiring intact. */
function paintMeasure(host: HTMLElement, amount: number, estimated: boolean): void {
  const target = host.querySelector<HTMLElement>('[data-measure]');
  if (!target) return;
  target.dataset['measure'] = String(amount);
  if (estimated) target.dataset['estimated'] = '';
  else delete target.dataset['estimated'];
  target.classList.toggle('est', estimated);

  const system = unitSystem.get() as UnitSystem;
  const unit = (target.dataset['unit'] ?? 'ml') as 'ml' | 'g';
  const { value, label } = formatMeasure(amount, unit, system);
  const n = target.querySelector<HTMLElement>('.n');
  const u = target.querySelector<HTMLElement>('.u');
  if (n) n.textContent = estimated ? `~${value}` : value;
  if (u) u.textContent = label;
}

export function initSubstitutions(): void {
  const toggles = [...document.querySelectorAll<HTMLButtonElement>('[data-sub-toggle]')];
  if (!toggles.length) return;

  for (const toggle of toggles) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      const body = toggle.nextElementSibling as HTMLElement | null;
      if (body) body.hidden = open;
      void load();
    });
  }

  for (const version of document.querySelectorAll<HTMLElement>('[data-version]')) {
    wireVersion(version);
  }
}

function wireVersion(version: HTMLElement): void {
  const radios = [...version.querySelectorAll<HTMLInputElement>('[data-sub-choice]')];
  if (!radios.length) return;

  const reset = version.querySelector<HTMLButtonElement>('[data-sub-reset]');
  const banner = version.querySelector<HTMLElement>('[data-sub-banner]');

  const recompute = async (): Promise<void> => {
    const payload = payloadFor(version);
    if (!payload) return;
    const { computeDrinkSpec, applySubstitutions } = await load();

    const chosen: Record<string, string> = {};
    const names: string[] = [];
    for (const radio of radios) {
      if (!radio.checked || !radio.value) continue;
      chosen[radio.dataset['line'] ?? ''] = radio.value;
      names.push(radio.dataset['name'] ?? radio.value);
    }

    const spec = computeDrinkSpec(payload.version, applySubstitutions(payload, chosen));
    const substituted = names.length > 0;

    // The card says so, and the original is one click away. A recomputed spec
    // that looks identical to an authored one would be the single most
    // misleading thing this page could show.
    const card = version.querySelector<HTMLElement>('[data-spec-card]');
    card?.classList.toggle('is-substituted', substituted);
    if (banner) {
      banner.hidden = !substituted;
      banner.querySelector<HTMLElement>('[data-sub-names]')!.textContent = names.join(', ');
    }
    if (reset) reset.hidden = !substituted;

    const cell = (key: string): HTMLElement | null =>
      version.querySelector<HTMLElement>(`[data-spec="${key}"]`);

    const volume = cell('final-volume');
    if (volume) paintMeasure(volume, spec.finalVolumeMl, spec.finalVolumeEstimated);

    const abv = cell('abv');
    if (abv) {
      const figure = abv.querySelector<HTMLElement>('[data-abv-figure]');
      if (figure) {
        figure.textContent =
          (spec.alcohol.abvEstimated ? '~' : '') + spec.alcohol.finalAbvPercent.toFixed(1);
        figure.classList.toggle('est', spec.alcohol.abvEstimated);
      }
    }

    const alcohol = cell('pure-alcohol');
    if (alcohol) paintMeasure(alcohol, spec.alcohol.pureAlcoholG, false);

    const standard = cell('standard-drinks');
    if (standard) {
      const us = spec.alcohol.standardDrinks[0]?.drinks.toFixed(1) ?? '0.0';
      const uk = spec.alcohol.standardDrinks[1]?.drinks.toFixed(1) ?? '0.0';
      standard.querySelector<HTMLElement>('[data-std-us]')!.textContent = us;
      standard.querySelector<HTMLElement>('[data-std-uk]')!.textContent = uk;
    }

    const sugar = cell('sugar');
    if (sugar) {
      paintMeasure(sugar, spec.composition.sugarG, false);
      const perLitre = sugar.querySelector<HTMLElement>('[data-sugar-per-litre]');
      if (perLitre) perLitre.textContent = `· ${Math.round(spec.sugarGPerL)} g/L`;
    }

    const energy = cell('energy');
    const energyFigure = energy?.querySelector<HTMLElement>('[data-energy-figure]');
    if (energyFigure) energyFigure.textContent = String(Math.round(spec.nutrition.kcal));

    for (const bar of spec.bars) {
      const row = version.querySelector<HTMLElement>(`[data-bar="${bar.key}"]`);
      if (!row) continue;
      const fill = row.querySelector<HTMLElement>('.bar-fill');
      if (fill) fill.style.width = `${bar.fillPercent.toFixed(0)}%`;
      const num = row.querySelector<HTMLElement>('.bar-num');
      if (num) num.textContent = bar.display;
    }
  };

  for (const radio of radios) radio.addEventListener('change', () => void recompute());

  reset?.addEventListener('click', () => {
    for (const radio of radios) radio.checked = !radio.value;
    void recompute();
  });

  // A unit change repaints the spec through the shared updater, which reads the
  // `data-measure` attributes this has already rewritten — so the substituted
  // figures survive the toggle without this having to hear about it.
}
