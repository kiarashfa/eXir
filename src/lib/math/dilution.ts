/**
 * The dilution model.
 *
 * DENOMINATOR: every fraction here is a fraction of the PRE-DILUTION poured
 * volume, never of the finished drink. This is stated in the data file, restated
 * here, and repeated in the UI, because published figures disagree with each
 * other on precisely this point — the same drink is variously described as
 * taking 25% and 50% dilution depending on which volume is on the bottom of the
 * fraction. To read any figure here against a final-volume one, divide by
 * (1 + fraction).
 *
 *   dilutionMl    = pouredVolumeMl x fraction
 *   finalVolumeMl = pouredVolumeMl + dilutionMl + authoredWaterMl
 */

import classesData from '../../data/dilution-classes.json' with { type: 'json' };

export interface DilutionSource {
  title: string;
  author?: string;
  publisher?: string;
  year?: number;
  url?: string;
  note?: string;
}

export interface DilutionClass {
  label: string;
  model: 'formula-stirred' | 'fixed' | 'authored-ice' | 'none';
  fraction?: number;
  estimated: boolean;
  formula?: string;
  coefficients?: { a2: number; a1: number; a0: number };
  risesOverTime?: boolean;
  source: DilutionSource;
  note?: string;
}

const CLASSES = classesData.classes as unknown as Record<string, DilutionClass>;

export const DILUTION_DENOMINATOR_NOTE = classesData.denominatorNote;

export const dilutionClass = (id: string): DilutionClass | undefined => CLASSES[id];

export const dilutionClassIds = (): string[] => Object.keys(CLASSES);

/**
 * The published closed form for a stirred drink.
 *
 * `abvFraction` is the alcohol by volume of the combined pre-dilution liquid,
 * as a fraction from 0 to 1 — not a percentage.
 */
export function stirredDilutionFraction(abvFraction: number): number {
  const c = CLASSES['stirred']?.coefficients;
  if (!c) throw new Error('dilution-classes.json is missing the stirred coefficients');
  return c.a2 * abvFraction * abvFraction + c.a1 * abvFraction + c.a0;
}

export interface DilutionInput {
  /** Sum of the liquid actually going into the mixing vessel, after any partial-use fraction. */
  pouredVolumeMl: number;
  /** ABV of that combined liquid, as a percentage. */
  pouredAbvPercent: number;
  classId: string;
  /** Water the recipe states as an ingredient. Never modelled, never estimated. */
  authoredWaterMl?: number;
}

export interface DilutionResult {
  fraction: number;
  dilutionMl: number;
  finalVolumeMl: number;
  /** True where the figure came out of a model rather than off a bottle. */
  estimated: boolean;
  classId: string;
  label: string;
  source: DilutionSource;
  note?: string;
  risesOverTime: boolean;
  /** Present when the class does not resolve — the build fails on this. */
  unresolved?: boolean;
}

export function computeDilution(input: DilutionInput): DilutionResult {
  const { pouredVolumeMl, pouredAbvPercent, classId } = input;
  const authoredWaterMl = input.authoredWaterMl ?? 0;
  const cls = CLASSES[classId];

  if (!cls) {
    // An unresolvable class fails the build. Returning zero here rather than
    // throwing keeps the integrity report able to name every bad reference in
    // one pass instead of stopping at the first.
    return {
      fraction: 0,
      dilutionMl: 0,
      finalVolumeMl: pouredVolumeMl + authoredWaterMl,
      estimated: false,
      classId,
      label: classId,
      source: { title: 'unresolved' },
      risesOverTime: false,
      unresolved: true,
    };
  }

  let fraction: number;
  switch (cls.model) {
    case 'formula-stirred':
      fraction = stirredDilutionFraction(pouredAbvPercent / 100);
      break;
    case 'fixed':
      fraction = cls.fraction ?? 0;
      break;
    // Blended drinks carry their ice as an authored ingredient with a mass, so
    // the modelled fraction is zero and the water is already in the poured sum.
    case 'authored-ice':
    case 'none':
      fraction = 0;
      break;
  }

  const dilutionMl = pouredVolumeMl * fraction;

  return {
    fraction,
    dilutionMl,
    finalVolumeMl: pouredVolumeMl + dilutionMl + authoredWaterMl,
    estimated: cls.estimated,
    classId,
    label: cls.label,
    source: cls.source,
    ...(cls.note !== undefined ? { note: cls.note } : {}),
    risesOverTime: cls.risesOverTime ?? false,
  };
}

/**
 * The same fraction expressed against the finished drink.
 *
 * Provided so the page can show both and never leave a reader guessing which
 * one a figure elsewhere refers to.
 */
export const asFractionOfFinal = (fractionOfPoured: number): number =>
  fractionOfPoured / (1 + fractionOfPoured);
