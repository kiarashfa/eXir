/**
 * The image treatment pipeline.
 *
 * Photographs come from many photographers under many lights, and a set that
 * does not cohere reads as a scrapbook however good the individual pictures
 * are. So every adopted image goes through the same two stages, in this order:
 *
 *   1. NORMALISE — per image, pull it toward a neutral baseline.
 *   2. GRADE     — identical for every image, the house look.
 *
 * The order matters and is not interchangeable. A fixed shift applied to a
 * varied set cannot make it cohere: it moves everything and changes nothing
 * about the differences between them. Normalising first is what gives the grade
 * a common starting point to work from.
 *
 * ⚠️ White balance must back off on colour-dominant images. Grey-world
 * balancing assumes the average of a scene is neutral, which is true of a
 * kitchen and false of a photograph that is four-fifths Campari. Applied at
 * full strength there, it reads the red as a cast, corrects it out, and turns
 * the background lilac. Drinks are the worst case for this of any subject.
 */

import sharp from 'sharp';
import type { Sharp } from 'sharp';

export interface TreatmentOptions {
  /** How hard the house grade is applied, 0–1. */
  gradeStrength?: number;
  /** Ceiling on white-balance correction, before colour-dominance damping. */
  whiteBalanceStrength?: number;
}

export interface TreatmentReport {
  /** Per-channel gains actually applied, after damping. */
  gains: [number, number, number];
  /** 0 = neutral scene, 1 = one colour owns the frame. */
  colourDominance: number;
  /** How much of the requested white balance survived the damping. */
  appliedStrength: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * How far this image is from a neutral average.
 *
 * The spread of the channel means against their own average. A grey scene sits
 * near 0; a photograph dominated by one strong colour approaches 1.
 */
export function colourDominance(means: [number, number, number]): number {
  const average = (means[0] + means[1] + means[2]) / 3;
  if (average <= 0) return 0;
  const spread = Math.max(...means.map((m) => Math.abs(m - average)));
  // Normalised against the average rather than against 255, so a dark image and
  // a bright one with the same cast are treated alike.
  return clamp(spread / average, 0, 1);
}

/**
 * Grey-world gains, damped by how colour-dominant the image is.
 *
 * At full dominance the correction goes to zero: the colour IS the subject, and
 * "correcting" it would be removing the photograph's content.
 */
export function whiteBalanceGains(
  means: [number, number, number],
  strength: number,
): { gains: [number, number, number]; dominance: number; applied: number } {
  const dominance = colourDominance(means);
  // Falls away quadratically, so mild casts still get corrected and strong ones
  // are left alone rather than being half-corrected into something worse.
  const applied = strength * (1 - dominance) ** 2;

  const average = (means[0] + means[1] + means[2]) / 3;
  const raw: [number, number, number] = [
    means[0] > 0 ? average / means[0] : 1,
    means[1] > 0 ? average / means[1] : 1,
    means[2] > 0 ? average / means[2] : 1,
  ];

  return {
    gains: raw.map((g) => clamp(1 + (g - 1) * applied, 0.75, 1.35)) as [number, number, number],
    dominance,
    applied,
  };
}

/**
 * Normalise, then grade.
 *
 * The grade is deliberately gentle. A heavy look dates quickly and fights the
 * page's own palette, and the point is a set that sits together rather than a
 * set that announces a filter.
 */
export async function treat(
  input: Buffer,
  options: TreatmentOptions = {},
): Promise<{ image: Sharp; report: TreatmentReport }> {
  const wbStrength = options.whiteBalanceStrength ?? 0.7;
  const gradeStrength = options.gradeStrength ?? 1;

  const stats = await sharp(input).stats();
  const means: [number, number, number] = [
    stats.channels[0]?.mean ?? 1,
    stats.channels[1]?.mean ?? 1,
    stats.channels[2]?.mean ?? 1,
  ];

  const { gains, dominance, applied } = whiteBalanceGains(means, wbStrength);

  const image = sharp(input)
    // --- normalise -------------------------------------------------------
    .linear(gains, [0, 0, 0])
    // --- grade -----------------------------------------------------------
    // A touch of contrast and a little saturation, identical for every image.
    .linear(1 + 0.06 * gradeStrength, -6 * gradeStrength)
    .modulate({ saturation: 1 + 0.05 * gradeStrength })
    .gamma(1 + 0.02 * gradeStrength);

  return { image, report: { gains, colourDominance: dominance, appliedStrength: applied } };
}

export interface RenditionSpec {
  name: string;
  width: number;
  /** Omit to keep the source proportions. */
  aspect?: number;
  quality: number;
}

/**
 * The three renditions per drink, and two per ingredient.
 *
 * Sizes are the ones the budget was calculated against. Changing them means
 * recalculating the budget, not just re-running the pipeline.
 */
export const RENDITIONS: Record<string, RenditionSpec[]> = {
  drink: [
    { name: 'hero', width: 1600, aspect: 4 / 5, quality: 72 },
    { name: 'card', width: 800, aspect: 4 / 5, quality: 70 },
    { name: 'thumb', width: 96, aspect: 1, quality: 68 },
  ],
  ingredient: [
    { name: 'card', width: 800, aspect: 1, quality: 70 },
    { name: 'thumb', width: 96, aspect: 1, quality: 68 },
  ],
  preparation: [
    { name: 'card', width: 800, aspect: 1, quality: 70 },
    { name: 'thumb', width: 96, aspect: 1, quality: 68 },
  ],
  glassware: [{ name: 'card', width: 800, aspect: 1, quality: 70 }],
};

export async function render(
  image: Sharp,
  spec: RenditionSpec,
): Promise<{ buffer: Buffer; width: number; height: number }> {
  const height = spec.aspect ? Math.round(spec.width / spec.aspect) : undefined;
  const buffer = await image
    .clone()
    .resize({
      width: spec.width,
      ...(height ? { height } : {}),
      fit: height ? 'cover' : 'inside',
      // Drinks are photographed centred in the frame far more often than not,
      // and attention-based cropping on a glass tends to find the garnish.
      position: 'centre',
      withoutEnlargement: false,
    })
    .webp({ quality: spec.quality, effort: 5 })
    .toBuffer();

  return { buffer, width: spec.width, height: height ?? 0 };
}

/**
 * A side-by-side sheet of before and after, for reviewing a batch by eye.
 *
 * Never adopt an image unseen, and never judge a treatment by its parameters.
 * The only way to know whether the white balance backed off far enough is to
 * look at the two versions next to each other.
 */
export async function contactSheet(
  before: Buffer,
  after: Buffer,
  width = 640,
): Promise<Buffer> {
  const half = Math.round(width / 2);
  const height = Math.round(half * 1.25);
  const resize = (b: Buffer): Promise<Buffer> =>
    sharp(b).resize({ width: half, height, fit: 'cover', position: 'centre' }).toBuffer();

  const [left, right] = await Promise.all([resize(before), resize(after)]);

  return sharp({
    create: { width, height, channels: 3, background: { r: 16, g: 20, b: 27 } },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: half, top: 0 },
    ])
    .webp({ quality: 78 })
    .toBuffer();
}
