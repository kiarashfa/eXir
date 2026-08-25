/**
 * The payload behind the substitution control.
 *
 * §6.2's whole point is that a substitution here is not a note. In food,
 * swapping basil for parsley changes nothing a page can compute. Here the
 * substitute has a different strength and a different sugar figure, so
 * selecting it moves the ABV, the sugar, the standard drinks and the balance
 * bars — and the reader watches it happen.
 *
 * That means the browser has to run the SAME `computeDrinkSpec` the build ran.
 * Recomputing with a second, simpler formula in the client would be a second
 * implementation free to disagree with the panel it is replacing, which is
 * exactly what the engine exists to prevent. So this ships the engine's inputs,
 * as small as they can honestly be made, and the client calls the real thing.
 *
 * Build-time only in the sense that it is what WRITES the payload; the shapes
 * are plain and the client reads them back.
 */

import type {
  DrinkVersion,
  Form,
  Ingredient,
  IngredientLine,
  ResolvedLine,
} from '../math/types.ts';
import type { ResolvedSubstitution, ResolvedVersion } from '../content/resolve.ts';

/**
 * An ingredient reduced to what the spec engine actually reads off it.
 *
 * The full record carries names, sources, notes and prose variants that the
 * arithmetic never touches, and shipping those would multiply the payload for
 * nothing.
 */
export interface SubIngredient {
  id: string;
  name: string;
  kind: 'ingredient' | 'preparation';
  category?: string;
  forms: Form[];
}

export interface SubOption {
  /** The ingredient the recipe names. */
  lineId: string;
  /** The substitute's id, or the empty string for "as written". */
  id: string;
  name: string;
  formRef?: string;
  ratio?: string;
  note: string;
  impact?: { flavour?: string; strength?: string; sweetness?: string };
}

export interface SubPayload {
  version: DrinkVersion;
  /** Parallel to `version.lines`, in the same order. */
  ingredients: SubIngredient[];
  forms: string[];
  /** Keyed by line id. */
  options: Record<string, SubOption[]>;
  /** Everything a substitute might need, keyed by ingredient id. */
  substitutes: Record<string, SubIngredient>;
}

const slim = (ingredient: Ingredient): SubIngredient => ({
  id: ingredient.id,
  name: ingredient.name,
  kind: ingredient.kind,
  ...(ingredient.category ? { category: ingredient.category } : {}),
  forms: ingredient.forms,
});

/**
 * Which substitutions can actually be offered.
 *
 * One that names an ingredient the site does not carry is dropped here rather
 * than rendered as a dead control: §6.2 requires a substitute to be a real
 * record precisely so the spec can be recomputed from it, and an option that
 * cannot recompute is the one thing this control must not have.
 */
export function buildSubPayload(
  version: ResolvedVersion,
  ingredients: Map<string, Ingredient>,
): SubPayload | null {
  const options: Record<string, SubOption[]> = {};
  const substitutes: Record<string, SubIngredient> = {};

  for (const substitution of version.substitutions as ResolvedSubstitution[]) {
    const line = version.lines.find((l) => l.line.id === substitution.lineRef);
    const ingredient = ingredients.get(substitution.substitute);
    if (!line || !ingredient) continue;

    const form =
      ingredient.forms.find((f) => f.id === substitution.formRef) ?? ingredient.forms[0];
    if (!form) continue;

    substitutes[ingredient.id] = slim(ingredient);
    options[line.line.id] = [
      ...(options[line.line.id] ?? []),
      {
        lineId: line.line.id,
        id: ingredient.id,
        name: ingredient.name,
        formRef: form.id,
        ...(substitution.ratio ? { ratio: substitution.ratio } : {}),
        note: substitution.note,
        ...(substitution.impact ? { impact: substitution.impact } : {}),
      },
    ];
  }

  if (!Object.keys(options).length) return null;

  return {
    version: version.version,
    ingredients: version.lines.map((l) => slim(l.ingredient)),
    forms: version.lines.map((l) => l.form.id),
    options,
    substitutes,
  };
}

/**
 * Rebuild the resolved line list with one line swapped.
 *
 * Substituting changes the ingredient and the Form and leaves the AMOUNT
 * alone. An authored `ratio` other than 1:1 would change it, and none of the
 * ratios in the content are anything else; where one appears it is stated in
 * the note and applied here rather than silently ignored.
 */
export function applySubstitutions(
  payload: SubPayload,
  chosen: Record<string, string>,
): ResolvedLine[] {
  return payload.version.lines.map((line, index): ResolvedLine => {
    const original = payload.ingredients[index]!;
    const originalForm =
      original.forms.find((f) => f.id === payload.forms[index]) ?? original.forms[0]!;

    const pickedId = chosen[line.id];
    if (!pickedId) {
      return { line, ingredient: original as Ingredient, form: originalForm };
    }

    const option = (payload.options[line.id] ?? []).find((o) => o.id === pickedId);
    const substitute = payload.substitutes[pickedId];
    if (!option || !substitute) {
      return { line, ingredient: original as Ingredient, form: originalForm };
    }

    const form = substitute.forms.find((f) => f.id === option.formRef) ?? substitute.forms[0]!;
    const scaled: IngredientLine = { ...line, amount: line.amount * ratioOf(option.ratio) };
    return { line: scaled, ingredient: substitute as Ingredient, form };
  });
}

/** `"1:1"` is one, `"2:1"` is two. Anything unparseable is one. */
export function ratioOf(ratio: string | undefined): number {
  if (!ratio) return 1;
  const parts = ratio.split(':').map(Number);
  if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n) && n > 0)) return 1;
  return parts[0]! / parts[1]!;
}
