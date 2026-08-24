/**
 * The Prep / Make / Rest / Total card. Computed, never authored, no override.
 *
 * Durations are in seconds because a shake is twelve of them and a stir is
 * twenty-five, and rounding those to minutes destroys exactly the information
 * the figure exists to carry.
 */

import type { ServiceMode, Step, StepPhase } from './types.ts';

export interface TimingIssue {
  kind: 'unresolved-parallel' | 'chained-parallel' | 'self-parallel';
  stepId: string;
  message: string;
}

export interface Timing {
  prepSec: number;
  makeSec: number;
  restSec: number;
  totalSec: number;
  issues: TimingIssue[];
}

const parallelAnchor = (type: string): string | null =>
  type.startsWith('parallel-with:') ? type.slice('parallel-with:'.length) : null;

/**
 * Aggregate a step sequence into the four figures on the card.
 *
 * Active time lands in the phase its step declares. Passive time — chilling,
 * steeping, fermenting, freezing — always lands in Rest regardless of what the
 * step says, because that is what Rest means.
 *
 * A parallel step contributes only what it overruns its anchor by. Rinsing a
 * glass while the drink stirs costs nothing; steeping something for twice as
 * long as the stir costs the difference. Summing the buckets then gives
 * max(anchor, parallel) for a pair, which is the rule stated as arithmetic.
 */
export function computeTiming(steps: Step[]): Timing {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const buckets: Record<StepPhase, number> = { prep: 0, make: 0, rest: 0 };
  const issues: TimingIssue[] = [];

  for (const step of steps) {
    const anchorId = parallelAnchor(step.type);
    const bucket: StepPhase = step.type === 'passive' ? 'rest' : step.phase;

    if (anchorId === null) {
      buckets[bucket] += step.durationSec;
      continue;
    }

    if (anchorId === step.id) {
      issues.push({
        kind: 'self-parallel',
        stepId: step.id,
        message: 'A step cannot run in parallel with itself.',
      });
      buckets[bucket] += step.durationSec;
      continue;
    }

    const anchor = byId.get(anchorId);
    if (!anchor) {
      issues.push({
        kind: 'unresolved-parallel',
        stepId: step.id,
        message: `Runs in parallel with "${anchorId}", which is not a step in this sequence.`,
      });
      // Count it in full rather than dropping it. An unresolved reference fails
      // the build; silently shortening the total in the meantime would hide it.
      buckets[bucket] += step.durationSec;
      continue;
    }

    if (parallelAnchor(anchor.type) !== null) {
      issues.push({
        kind: 'chained-parallel',
        stepId: step.id,
        message: `Runs in parallel with "${anchorId}", which is itself parallel. Anchor to a step that occupies real time.`,
      });
    }

    buckets[bucket] += Math.max(0, step.durationSec - anchor.durationSec);
  }

  return {
    prepSec: buckets.prep,
    makeSec: buckets.make,
    restSec: buckets.rest,
    totalSec: buckets.prep + buckets.make + buckets.rest,
    issues,
  };
}

/**
 * How the sequence changes with the drink count.
 *
 * Made to order: active steps scale linearly. Making twelve Negronis is twelve
 * stirs. Passive time does not scale — twelve drinks chill in one fridge in the
 * same four hours one does.
 *
 * Batched: nothing scales at all. One combine, one dilution, one chill.
 *
 * This is the single most useful thing the site can tell a host, and it is the
 * one place the two service modes produce genuinely different timing.
 */
export function scaleSteps(
  steps: Step[],
  drinks: number,
  service: ServiceMode,
  defaultDrinks = 1,
): Step[] {
  if (service === 'batch') return steps;
  // Against the recipe's OWN yield, not against one drink. A recipe that
  // already makes six has been written with six in mind — its grating and its
  // stirring cover all six once — so at the authored count the card must show
  // exactly the authored timing, and only a change from it scales anything.
  const factor = Math.max(1, drinks) / Math.max(1, defaultDrinks);
  if (factor === 1) return steps;
  return steps.map((step) =>
    step.type === 'active' ? { ...step, durationSec: step.durationSec * factor } : step,
  );
}

export const computeScaledTiming = (
  steps: Step[],
  drinks: number,
  service: ServiceMode,
  defaultDrinks = 1,
): Timing => computeTiming(scaleSteps(steps, drinks, service, defaultDrinks));

/**
 * Zero phases are omitted rather than printed as "0s".
 *
 * A drink whose prep all happens inside another step genuinely has no prep, and
 * printing a zero invites the reader to wonder what is missing.
 */
export function timingPhases(timing: Timing): Array<{ key: StepPhase | 'total'; sec: number }> {
  const out: Array<{ key: StepPhase | 'total'; sec: number }> = [];
  if (timing.prepSec > 0) out.push({ key: 'prep', sec: timing.prepSec });
  if (timing.makeSec > 0) out.push({ key: 'make', sec: timing.makeSec });
  if (timing.restSec > 0) out.push({ key: 'rest', sec: timing.restSec });
  out.push({ key: 'total', sec: timing.totalSec });
  return out;
}
