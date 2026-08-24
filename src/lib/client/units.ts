/**
 * The reader's unit system, remembered across pages.
 *
 * The choice was previously per-page state, so a reader who set ounces on one
 * drink got millilitres again on the next — a preference that has to be
 * restated on every navigation is not a preference. It goes through the same
 * storage discipline as everything else, and it degrades to
 * working-but-not-remembering rather than throwing.
 *
 * Deliberately NOT read before first paint the way the theme is. The theme is a
 * data attribute and costs nothing to stamp early; units are the text of every
 * quantity on the page, and the server has to render one of them. Metric is
 * what it renders, and a stored preference for ounces repaints on hydration —
 * the same repaint that already happens when the toggle is clicked.
 */

import { defineStore } from '../storage.ts';
import { unitSystem } from '../stores/display.ts';
import type { UnitSystem } from '../math/types.ts';

interface UnitPreference {
  system: UnitSystem;
}

const store = defineStore<UnitPreference>({
  key: 'exir.units.v1',
  schema: 1,
  empty: () => ({ system: 'metric' }),
  parse: (raw) => (raw['system'] === 'us' || raw['system'] === 'metric' ? { system: raw['system'] } : null),
});

/** Apply the stored preference and keep it in step with the shared atom. */
export function initUnits(): void {
  const { value } = store.load();
  unitSystem.set(value.system);
  unitSystem.subscribe((system) => {
    if (store.load().value.system !== system) store.save({ system });
  });
}
