/**
 * The three pieces of state behind every live value on a drink page.
 *
 * Kept to atoms with no persistence of their own. Storage is a separate concern
 * with its own versioning and its own failure modes, and wiring it in here would
 * make every page that reads a quantity depend on it.
 */

import { atom } from 'nanostores';
import type { ServiceMode, UnitSystem } from '../math/types.ts';

/**
 * Zero means "not yet initialised".
 *
 * The store must not start at 1, because a page would then render every
 * quantity against a placeholder count for one frame before its real one
 * arrives. Anything reading this checks for zero and does nothing.
 */
export const drinks = atom<number>(0);

export const unitSystem = atom<UnitSystem>('metric');

export const service = atom<ServiceMode>('order');

export const setDrinks = (value: number): void => drinks.set(Math.max(1, Math.round(value)));

/**
 * The same multiplier, set from a brewed drink's dose or yield rather than from
 * a whole number of servings.
 *
 * A cocktail scales by drink count; a brew scales by ratio — the reader sets the
 * dose or the yield and the other follows, because the ratio is the fixed thing.
 * Both are the one page multiplier, so nothing downstream needs to know which
 * control set it, and the only difference is that this one does not round: a
 * reader asking for 500 ml out of a recipe that yields 320 is asking for a
 * fraction of a second brew, and rounding it away would answer a question they
 * did not ask.
 */
export const setScale = (value: number): void => {
  if (Number.isFinite(value) && value > 0) drinks.set(value);
};

export const toggleUnitSystem = (): void =>
  unitSystem.set(unitSystem.get() === 'metric' ? 'us' : 'metric');
