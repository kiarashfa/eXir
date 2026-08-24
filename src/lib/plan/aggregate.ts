/**
 * The shopping list — a view of the Plan, not a store of its own.
 *
 * Summing is pure addition in ml and g with no density anywhere, which is the
 * direct payoff of authoring in base units. What takes the thought is what to
 * do with a Preparation, and three decisions govern it.
 *
 * **The list is one flat merge, and a Preparation being made contributes its
 * inputs into it like anything else.** Nesting the inputs under their
 * preparation would read tidily and would also put sugar on the list twice when
 * two syrups both want some. The reader is buying sugar once, so there is one
 * sugar line; where it came from is recorded as provenance on that line, and
 * the provenance names the preparation as well as the drink.
 *
 * **Making a Preparation buys a whole batch of it.** Nobody makes twenty
 * millilitres of orgeat — the yield is a property of the recipe, not something
 * to divide. So a plan needing 20 ml of a 400 ml syrup shops for one batch, and
 * one needing 450 ml shops for two. Scaling the inputs by `needed / yield`
 * instead would produce a shopping list for a fifth of an almond.
 *
 * **A Preparation is expanded ONCE, after every demand on it is known**, which
 * is why this walks the preparation graph in dependency order rather than
 * recursing as it meets each line. Expanding at the point of reference gets
 * both halves wrong at the same time: the batch count is computed from one
 * drink's demand and comes out short, and the batch's own inputs are then
 * emitted again for every drink that named it, so a syrup used by two drinks
 * buys twice the sugar for a single jar. Two drinks each wanting a quarter of a
 * jar is the ordinary case, not an exotic one.
 */

import { mergeKey } from '../transclusion/merge.ts';
import { scaleOf, type ResolvedItem } from './resolve.ts';
import type { IndexedIngredient } from '../catalog.ts';
import type { BaseUnit, CountUnit, IngredientLine } from '../math/types.ts';
import type { PlanState } from './store.ts';

/** Beyond this the model is almost certainly wrong, so the list says so. */
export const MAX_EXPANSION_DEPTH = 3;

export interface Provenance {
  slug: string;
  title: string;
  drinks: number;
  /** The chain of preparations it passed through, outermost first. */
  via: string[];
}

export interface ShoppingLine {
  key: string;
  ingredientRef: string;
  formRef: string;
  name: string;
  amount: number;
  unit: BaseUnit;
  countUnit?: CountUnit;
  /** The Form's own prose name, where the ingredient name will not do. */
  proseName?: string;
  staple: boolean;
  /** Every contributing line was a garnish. Bought, but never blocking. */
  garnish: boolean;
  have: boolean;
  /** True for a bottled good — the only thing a bottle estimate applies to. */
  bottled: boolean;
  countryOfOrigin?: string;
  from: Provenance[];
}

export interface PreparationDecision {
  id: string;
  name: string;
  neededMl: number;
  yieldMl: number;
  /** Whole batches, because a yield is not divisible. */
  batches: number;
  shelfLife?: { days: number; storage: string };
  purchasable: boolean;
  choice: 'make' | 'buy';
  /** How deep in the expansion it sits. Zero is named directly by a drink. */
  depth: number;
  /** What making it would add to the list — the "or add:" line. */
  inputs: Array<{ name: string; amount: number; unit: BaseUnit }>;
}

export interface ShoppingList {
  buy: ShoppingLine[];
  have: ShoppingLine[];
  staples: ShoppingLine[];
  preparations: PreparationDecision[];
  warnings: string[];
}

interface Contribution {
  line: IngredientLine;
  provenances: Provenance[];
}

/** Everything demanding one Preparation, pooled before it is expanded. */
interface Demand {
  ml: number;
  /** Longest path from a drink, so the deepest reference decides the warning. */
  depth: number;
  provenances: Provenance[];
  /** Set where a demand arrived by mass and the batch count cannot follow from it. */
  byMass: boolean;
}

/**
 * The default for a Preparation nobody has decided about.
 *
 * Purchasable ones default to buying, which is also what makes expansion one
 * level deep by default: a syrup inside a syrup is offered rather than
 * expanded. One that cannot be bought always expands, because nobody sells
 * oleo-saccharum and a list that told you to buy some would be useless.
 */
export const defaultChoice = (ingredient: IndexedIngredient): 'make' | 'buy' =>
  ingredient.purchasable === false ? 'make' : 'buy';

const isMakeable = (ingredient: IndexedIngredient | undefined): ingredient is IndexedIngredient =>
  ingredient?.kind === 'preparation' &&
  typeof ingredient.yieldMl === 'number' &&
  ingredient.yieldMl > 0 &&
  (ingredient.lines?.length ?? 0) > 0;

export function buildShoppingList(
  items: ResolvedItem[],
  plan: PlanState,
  ingredients: Map<string, IndexedIngredient>,
): ShoppingList {
  const contributions: Contribution[] = [];
  const demands = new Map<string, Demand>();
  const warnings = new Set<string>();

  const chosen = (ingredient: IndexedIngredient): 'make' | 'buy' =>
    plan.makePreparations[ingredient.id] ?? defaultChoice(ingredient);

  const contribute = (
    ingredientRef: string,
    formRef: string,
    amount: number,
    unit: BaseUnit,
    garnish: boolean,
    provenances: Provenance[],
  ): void => {
    if (!(amount > 0)) return;
    contributions.push({
      line: {
        id: ingredientRef,
        ingredientRef,
        formRef,
        amount,
        unit,
        ...(garnish ? { garnish: true } : {}),
      },
      provenances,
    });
  };

  const demand = (
    id: string,
    amount: number,
    unit: BaseUnit,
    depth: number,
    provenances: Provenance[],
  ): void => {
    const existing = demands.get(id);
    demands.set(id, {
      // A Preparation states a volume yield, so a demand arriving by mass has
      // no yield to divide it by. It is recorded and flagged rather than
      // guessed at: one batch is the honest floor.
      ml: (existing?.ml ?? 0) + (unit === 'ml' ? amount : 0),
      depth: Math.max(existing?.depth ?? 0, depth),
      provenances: [...(existing?.provenances ?? []), ...provenances],
      byMass: (existing?.byMass ?? false) || unit !== 'ml',
    });
  };

  const route = (
    ingredientRef: string,
    formRef: string,
    amount: number,
    unit: BaseUnit,
    garnish: boolean,
    depth: number,
    provenances: Provenance[],
  ): void => {
    if (!(amount > 0)) return;
    const ingredient = ingredients.get(ingredientRef);
    if (isMakeable(ingredient)) demand(ingredientRef, amount, unit, depth, provenances);
    else contribute(ingredientRef, formRef, amount, unit, garnish, provenances);
  };

  // ---- seed from the plan's drinks ----------------------------------------
  for (const resolved of items) {
    const scale = scaleOf(resolved);
    const provenance: Provenance = {
      slug: resolved.entry.slug,
      title: resolved.entry.title,
      drinks: resolved.item.drinks,
      via: [],
    };

    for (const line of resolved.version.lines) {
      route(line.ingredientRef, line.form, line.amount * scale, line.unit, line.garnish, 0, [provenance]);
    }

    // The water a batch needs is a shopping line in the same sense the rest
    // are: it goes in the bottle, and leaving it out is why a home batch tastes
    // harsh next to the same drink made one at a time. Stated per drink like
    // every other line, so it scales with the count rather than the yield.
    if (resolved.service === 'batch' && resolved.version.dilutionMlPerDrink > 0) {
      route('water', 'standard', resolved.version.dilutionMlPerDrink * resolved.item.drinks, 'ml', false, 0, [
        provenance,
      ]);
    }
  }

  // ---- expand the preparations in dependency order ------------------------
  const { order, cyclic } = expansionOrder(demands, ingredients, chosen);
  for (const id of cyclic) {
    warnings.add(
      `${ingredients.get(id)?.name ?? id} is part of a loop of preparations that reference each other, so its recipe was not expanded.`,
    );
  }

  const decisions = new Map<string, PreparationDecision>();

  for (const id of order) {
    const ingredient = ingredients.get(id);
    const pooled = demands.get(id);
    if (!isMakeable(ingredient) || !pooled) continue;

    if (pooled.byMass) {
      warnings.add(
        `${ingredient.name} is used by weight here and its recipe states a volume yield, so the batch count could not be worked out. One batch is assumed.`,
      );
    }

    const batches = Math.max(1, Math.ceil(pooled.ml / ingredient.yieldMl!));
    const choice = chosen(ingredient);
    const tooDeep = pooled.depth + 1 > MAX_EXPANSION_DEPTH;
    const looping = cyclic.has(id);

    if (tooDeep) {
      warnings.add(
        `${ingredient.name} sits ${pooled.depth + 1} preparations deep and was not expanded further. That much nesting is almost always a modelling error.`,
      );
    }

    decisions.set(id, {
      id,
      name: ingredient.name,
      neededMl: pooled.ml,
      yieldMl: ingredient.yieldMl!,
      batches,
      ...(ingredient.shelfLife ? { shelfLife: ingredient.shelfLife } : {}),
      purchasable: ingredient.purchasable !== false,
      choice,
      depth: pooled.depth,
      inputs: ingredient.lines!.map((l) => ({
        name: ingredients.get(l.ingredientRef)?.name ?? l.ingredientRef,
        amount: l.amount * batches,
        unit: l.unit,
      })),
    });

    if (choice !== 'make' || tooDeep || looping) {
      contribute(id, 'standard', pooled.ml, 'ml', false, pooled.provenances);
      continue;
    }

    // Expanded exactly once, at the pooled batch count, for every demander at
    // the same time. Doing it per reference is what buys the sugar twice.
    const via = pooled.provenances.map((p) => ({ ...p, via: [...p.via, ingredient.name] }));
    for (const sub of ingredient.lines!) {
      route(sub.ingredientRef, sub.formRef, sub.amount * batches, sub.unit, sub.garnish, pooled.depth + 1, via);
    }
  }

  // ---- merge ---------------------------------------------------------------
  // Grouping uses the SAME key the build-time merge uses, so the two can never
  // disagree about what counts as one thing. Fresh lime juice and bottled lime
  // cordial stay apart here for the same reason they stay apart in a checklist.
  const groups = new Map<string, Contribution[]>();
  for (const contribution of contributions) {
    const key = mergeKey(contribution.line);
    const list = groups.get(key) ?? [];
    list.push(contribution);
    groups.set(key, list);
  }

  const have = new Set(plan.have);
  const lines: ShoppingLine[] = [];

  for (const [key, group] of groups) {
    const first = group[0]!.line;
    const ingredient = ingredients.get(first.ingredientRef);
    const form = ingredient?.forms.find((f) => f.id === first.formRef) ?? ingredient?.forms[0];

    lines.push({
      key,
      ingredientRef: first.ingredientRef,
      formRef: first.formRef ?? 'standard',
      name: ingredient?.name ?? first.ingredientRef,
      amount: group.reduce((sum, c) => sum + c.line.amount, 0),
      unit: first.unit,
      ...(form?.countUnit ? { countUnit: form.countUnit } : {}),
      ...(form?.proseName ? { proseName: form.proseName } : {}),
      staple: ingredient?.staple === true,
      garnish: group.every((c) => c.line.garnish === true),
      have: have.has(first.ingredientRef),
      bottled: (form?.abvPercent ?? 0) > 0,
      ...(ingredient?.countryOfOrigin ? { countryOfOrigin: ingredient.countryOfOrigin } : {}),
      from: dedupeProvenance(group),
    });
  }

  lines.sort((a, b) => a.name.localeCompare(b.name));

  return {
    // Three groups, in order. A staple stays out of "to buy" whether or not it
    // was ticked: the list's job is what to shop for, and a kitchen already has
    // sugar.
    buy: lines.filter((l) => !l.staple && !l.have),
    have: lines.filter((l) => !l.staple && l.have),
    staples: lines.filter((l) => l.staple),
    preparations: [...decisions.values()].sort(
      (a, b) => a.depth - b.depth || a.name.localeCompare(b.name),
    ),
    warnings: [...warnings],
  };
}

/**
 * The order to expand preparations in.
 *
 * A preparation may only be expanded once nothing further can add to its
 * demand, which means after every preparation that references it. That is a
 * topological order over "uses" edges, computed here from the reachable
 * preparation graph rather than discovered while walking amounts — the amounts
 * depend on the batch counts, and the batch counts depend on this order.
 *
 * Anything left with an unsatisfied predecessor is in a cycle and is reported
 * rather than expanded. A syrup made of itself has no batch count.
 */
function expansionOrder(
  seeds: Map<string, Demand>,
  ingredients: Map<string, IndexedIngredient>,
  chosen: (ingredient: IndexedIngredient) => 'make' | 'buy',
): { order: string[]; cyclic: Set<string> } {
  const nodes = new Set<string>();
  const uses = new Map<string, string[]>();
  const queue = [...seeds.keys()];

  while (queue.length) {
    const id = queue.shift()!;
    if (nodes.has(id)) continue;
    const ingredient = ingredients.get(id);
    if (!isMakeable(ingredient)) continue;
    nodes.add(id);

    // A preparation the reader has chosen to buy is a leaf: its own recipe is
    // never walked, so it depends on nothing.
    const children =
      chosen(ingredient) === 'make'
        ? ingredient
            .lines!.map((l) => l.ingredientRef)
            .filter((ref) => isMakeable(ingredients.get(ref)))
        : [];
    uses.set(id, [...new Set(children)]);
    queue.push(...children);
  }

  const indegree = new Map<string, number>([...nodes].map((id) => [id, 0]));
  for (const children of uses.values()) {
    for (const child of children) indegree.set(child, (indegree.get(child) ?? 0) + 1);
  }

  const ready = [...nodes].filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const child of uses.get(id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) ready.push(child);
    }
  }

  const cyclic = new Set([...nodes].filter((id) => !order.includes(id)));
  return { order: [...order, ...cyclic], cyclic };
}

/** One entry per drink-and-chain, so a line's provenance reads as a short list. */
function dedupeProvenance(group: Contribution[]): Provenance[] {
  const out = new Map<string, Provenance>();
  for (const contribution of group) {
    for (const provenance of contribution.provenances) {
      const key = `${provenance.slug}::${provenance.via.join('>')}`;
      if (!out.has(key)) out.set(key, provenance);
    }
  }
  return [...out.values()];
}
