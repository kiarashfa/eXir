/**
 * Build-time transclusion.
 *
 * A Component's steps and ingredient lines merge into the parent so the reader
 * gets one seamless, self-contained page — step numbering, checklist and timing
 * all read as one drink, and nobody clicks away mid-build.
 *
 * A Preparation is never transcluded. It is an ingredient: referencing one
 * produces a checklist line and a cross-link, not inlined steps. Nobody wants
 * "dissolve sugar in water and cool completely" wedged into a three-step
 * cocktail.
 */

import type { IngredientLine, Step } from '../math/types.ts';
import {
  SOURCE_SEPARATOR,
  mergeContributions,
  orderLinesByFirstUse,
  refKey,
  type LineContribution,
  type MergeIssue,
} from './merge.ts';

/** A slot in the authored step sequence: either a step, or a Component to inline. */
export type StepSlot =
  | { kind: 'inline'; step: Step }
  | { kind: 'component'; componentRef: string; multiplier?: number };

export interface Component {
  id: string;
  name: string;
  lines: IngredientLine[];
  steps: Step[];
}

export interface FlattenInput {
  lines: IngredientLine[];
  slots: StepSlot[];
}

export interface FlattenIssue {
  kind: 'unresolved-component' | 'id-collision' | MergeIssue['kind'];
  ref: string;
  message: string;
}

export interface FlattenResult {
  lines: IngredientLine[];
  steps: Step[];
  /** Which Components were pulled in, for the optional cross-link. */
  components: Array<{ id: string; name: string; occurrences: number }>;
  issues: FlattenIssue[];
}

const PARENT_KEY = 'self';

/** Rewrite `<Qty ref="x">` and `<Dur step="y">` against a source's own map. */
function rewriteProse(
  prose: string,
  sourceKey: string,
  refMap: Map<string, string>,
  stepMap: Map<string, string>,
): string {
  return prose
    .replace(/(<Qty\b[^>]*?\bref\s*=\s*")([^"]*)(")/g, (whole, head: string, ref: string, tail: string) => {
      const next = refMap.get(refKey(sourceKey, ref));
      return next ? `${head}${next}${tail}` : whole;
    })
    .replace(/(<Dur\b[^>]*?\bstep\s*=\s*")([^"]*)(")/g, (whole, head: string, id: string, tail: string) => {
      const next = stepMap.get(refKey(sourceKey, id));
      return next ? `${head}${next}${tail}` : whole;
    });
}

export function flatten(
  parent: FlattenInput,
  components: ReadonlyMap<string, Component>,
): FlattenResult {
  const issues: FlattenIssue[] = [];
  const contributions: LineContribution[] = [];
  const used = new Map<string, number>();

  for (const line of parent.lines) {
    contributions.push({ line, sourceKey: PARENT_KEY });
  }

  // --- resolve the slots, assigning each occurrence its own source key -------
  interface ResolvedSlot {
    sourceKey: string;
    steps: Step[];
  }
  const resolved: ResolvedSlot[] = [];

  for (const slot of parent.slots) {
    if (slot.kind === 'inline') {
      resolved.push({ sourceKey: PARENT_KEY, steps: [slot.step] });
      continue;
    }

    const component = components.get(slot.componentRef);
    if (!component) {
      issues.push({
        kind: 'unresolved-component',
        ref: slot.componentRef,
        message: `No Component with id "${slot.componentRef}".`,
      });
      continue;
    }

    // The same Component referenced twice gets its occurrences kept apart, or
    // its two contributions would collide into one indistinguishable line.
    const count = (used.get(component.id) ?? 0) + 1;
    used.set(component.id, count);
    const sourceKey =
      count === 1 && !hasLaterOccurrence(parent.slots, component.id)
        ? component.id
        : `${component.id}#${count}`;

    // The Component's own multiplier applies to its amounts BEFORE the merge.
    // The reader's live drink count applies AFTER, at render. Applying them in
    // the other order would scale the multiplier by the drink count.
    const multiplier = slot.multiplier ?? 1;
    for (const line of component.lines) {
      contributions.push({
        sourceKey,
        sourceLabel: component.name,
        line: {
          ...line,
          amount: line.amount * multiplier,
          ...(line.portions
            ? { portions: line.portions.map((p) => ({ ...p, amount: p.amount * multiplier })) }
            : {}),
        },
      });
    }

    resolved.push({ sourceKey, steps: component.steps });
  }

  // --- merge the lines -------------------------------------------------------
  const merged = mergeContributions(contributions);
  for (const issue of merged.issues) {
    issues.push({ kind: issue.kind, ref: issue.lineId, message: issue.message });
  }

  // --- renumber the combined step sequence -----------------------------------
  // Not concatenation: a transcluded step's id has to stay unique and stay
  // stable, because `<Dur step>` resolves against it from inside prose that was
  // written in a different file.
  const stepMap = new Map<string, string>();
  const seen = new Set<string>();
  const flatSteps: Step[] = [];

  for (const { sourceKey, steps } of resolved) {
    for (const step of steps) {
      const id =
        sourceKey === PARENT_KEY ? step.id : `${step.id}${SOURCE_SEPARATOR}${sourceKey}`;
      if (seen.has(id)) {
        issues.push({
          kind: 'id-collision',
          ref: id,
          message: `Two steps resolve to the id "${id}" after transclusion.`,
        });
      }
      seen.add(id);
      stepMap.set(refKey(sourceKey, step.id), id);
      flatSteps.push({ ...step, id, sourceKey });
    }
  }

  // Prose is rewritten after both maps exist, so a step can refer to a line and
  // to another step's duration in the same sentence and get both right.
  const steps = flatSteps.map((step) => ({
    ...step,
    prose: rewriteProse(step.prose, step.sourceKey ?? PARENT_KEY, merged.refMap, stepMap),
  }));

  // A parallel-with anchor written inside a Component names that Component's
  // own step, so it needs the same rewrite the prose got.
  for (const step of steps) {
    if (!step.type.startsWith('parallel-with:')) continue;
    const anchor = step.type.slice('parallel-with:'.length);
    const next = stepMap.get(refKey(step.sourceKey ?? PARENT_KEY, anchor));
    if (next) step.type = `parallel-with:${next}`;
  }

  return {
    lines: orderLinesByFirstUse(merged.lines, steps.map((s) => s.prose)),
    steps,
    components: [...used].map(([id, occurrences]) => ({
      id,
      name: components.get(id)?.name ?? id,
      occurrences,
    })),
    issues,
  };
}

function hasLaterOccurrence(slots: StepSlot[], componentId: string): boolean {
  return slots.filter((s) => s.kind === 'component' && s.componentRef === componentId).length > 1;
}
