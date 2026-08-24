/**
 * Brewing and extraction.
 *
 * The scaling primitive is different here and that is the point. A cocktail
 * scales by drink count; a brewed drink scales by RATIO — the reader sets the
 * dose or the yield and the other follows at the locked ratio. Water
 * temperature, grind and contact time do not scale with either.
 */

import standardsData from '../../data/brewing-standards.json' with { type: 'json' };
import type { Brew } from './types.ts';
import { formatRatio } from './units.ts';

export interface BrewStandard {
  label: string;
  appliesTo: string[];
  gPerLitre: number;
  tolerancePercent: number;
  ratio: number;
  waterTempC: number;
  waterTempToleranceC: number;
  targetTdsPercent: [number, number];
  targetExtractionYieldPercent: [number, number];
  source: { title: string; publisher?: string; url?: string };
  note?: string;
}

const STANDARDS = standardsData.standards as unknown as Record<string, BrewStandard>;

export interface BrewResult {
  doseG: number;
  waterMl: number;
  yieldMl: number;
  waterTempC: number;
  /** Water per gram of coffee or leaf, the field's own convention. */
  ratio: number;
  ratioDisplay: string;
  /** What the bed holds back and never reaches the cup. */
  retentionMl: number;
  /** Total contact across every infusion. */
  contactSec: number;
  infusions: Array<{ n: number; contactSec: number }>;
  /**
   * Null unless a measured total dissolved solids figure was authored. Nothing
   * on a bag of coffee supplies it, and estimating it from the method would be
   * inventing the one number the calculation exists to establish.
   */
  extractionYieldPercent: number | null;
  standard: BrewStandardComparison | null;
}

export interface BrewStandardComparison {
  id: string;
  label: string;
  ratio: number;
  ratioDisplay: string;
  /** This brew's strength in the units the standard is actually stated in. */
  gPerLitre: number;
  /** The standard's own band, in g/L. */
  gPerLitreRange: [number, number];
  /** Whether this brew falls inside the published tolerance. */
  withinTolerance: boolean;
  /** Which way it misses, for a page that wants to say more than yes or no. */
  direction: 'within' | 'strong' | 'weak';
  waterTempWithinTolerance: boolean;
  source: BrewStandard['source'];
  note?: string;
}

export const standardFor = (method: string): [string, BrewStandard] | null => {
  for (const [id, standard] of Object.entries(STANDARDS)) {
    if (standard.appliesTo.includes(method)) return [id, standard];
  }
  return null;
};

export function computeBrew(brew: Brew): BrewResult {
  const ratio = brew.doseG > 0 ? brew.waterMl / brew.doseG : 0;
  const infusions = brew.infusions ?? [];
  const contactSec = infusions.length
    ? infusions.reduce((sum, i) => sum + i.contactSec, 0)
    : (brew.contactSec ?? 0);

  let extractionYieldPercent: number | null = null;
  if (brew.measuredTdsPercent != null && brew.doseG > 0) {
    // Beverage mass approximated by its volume; brewed coffee sits close enough
    // to water that the difference never reaches a displayed figure.
    extractionYieldPercent = (brew.measuredTdsPercent * brew.yieldMl) / brew.doseG;
  }

  const found = standardFor(brew.method);
  let standard: BrewStandardComparison | null = null;
  if (found) {
    const [id, s] = found;

    // The tolerance is compared in grams per litre, which is the unit the
    // standard is published in, and NOT on the ratio. A ratio is the reciprocal
    // of a strength, so a symmetric band on one is an asymmetric band on the
    // other: 55 g/L ±10% is 49.5–60.5 g/L, which is 16.5:1 to 20.2:1 — not
    // 18.2 ±1.8. Testing the ratio instead would misjudge every brew near the
    // edge, and always in the same direction.
    const gPerLitre = brew.waterMl > 0 ? brew.doseG / (brew.waterMl / 1000) : 0;
    const tol = s.gPerLitre * (s.tolerancePercent / 100);
    const range: [number, number] = [s.gPerLitre - tol, s.gPerLitre + tol];
    const withinTolerance = gPerLitre >= range[0] && gPerLitre <= range[1];

    standard = {
      id,
      label: s.label,
      ratio: s.ratio,
      ratioDisplay: formatRatio(s.ratio),
      gPerLitre,
      gPerLitreRange: range,
      withinTolerance,
      direction: withinTolerance ? 'within' : gPerLitre > range[1] ? 'strong' : 'weak',
      waterTempWithinTolerance:
        Math.abs(brew.waterTempC - s.waterTempC) <= s.waterTempToleranceC,
      source: s.source,
      ...(s.note !== undefined ? { note: s.note } : {}),
    };
  }

  return {
    doseG: brew.doseG,
    waterMl: brew.waterMl,
    yieldMl: brew.yieldMl,
    waterTempC: brew.waterTempC,
    ratio,
    ratioDisplay: formatRatio(ratio),
    retentionMl: brew.waterMl - brew.yieldMl,
    contactSec,
    infusions: infusions.map((i) => ({ n: i.n, contactSec: i.contactSec })),
    extractionYieldPercent,
    standard,
  };
}

/**
 * Rescale a brew from a new dose, holding the ratio.
 *
 * Temperature, grind and contact time are returned untouched: a bigger brew is
 * not a hotter one and not a longer one.
 */
export function scaleBrewByDose(brew: Brew, doseG: number): Brew {
  if (brew.doseG <= 0) return brew;
  const factor = doseG / brew.doseG;
  return { ...brew, doseG, waterMl: brew.waterMl * factor, yieldMl: brew.yieldMl * factor };
}

/** The same rescale driven from the cup instead of the scale. */
export function scaleBrewByYield(brew: Brew, yieldMl: number): Brew {
  if (brew.yieldMl <= 0) return brew;
  const factor = yieldMl / brew.yieldMl;
  return { ...brew, yieldMl, doseG: brew.doseG * factor, waterMl: brew.waterMl * factor };
}
