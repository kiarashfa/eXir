import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_EXPANSION_DEPTH, buildShoppingList, type ShoppingLine } from './aggregate.ts';
import { buildOccasion, ICE } from './occasion.ts';
import { resolvePlan, type ResolvedItem } from './resolve.ts';
import { decodeItems, encodeItems, shoppingText } from './share.ts';
import { addItem, emptyPlan, removeItem, setOccasion, updateItem, type PlanState } from './store.ts';
import type { CatalogEntry, DetailVersion, DrinkDetail, IndexedIngredient } from '../catalog.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ingredient = (
  id: string,
  extra: Partial<IndexedIngredient> = {},
): IndexedIngredient => ({
  id,
  name: id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase()),
  kind: 'ingredient',
  category: 'other',
  group: 'Other',
  staple: false,
  proprietary: false,
  forms: [{ id: 'standard', abvPercent: 0 }],
  used: true,
  ...extra,
});

const INGREDIENTS = new Map<string, IndexedIngredient>(
  [
    ingredient('gin', { forms: [{ id: 'standard', abvPercent: 41.5 }] }),
    ingredient('campari', {
      forms: [{ id: 'standard', abvPercent: 25 }],
      countryOfOrigin: 'Italy',
    }),
    ingredient('white-rum', {
      forms: [{ id: 'standard', abvPercent: 40 }],
      countryOfOrigin: 'United States',
    }),
    ingredient('lime-juice'),
    ingredient('granulated-sugar', { staple: true }),
    ingredient('water', { staple: true }),
    ingredient('orange', {
      forms: [
        {
          id: 'standard',
          abvPercent: 0,
          countUnit: { singular: 'orange', plural: 'oranges', g: 140, snap: 'half' },
        },
      ],
    }),
    // A syrup you can buy, made of a staple and water.
    ingredient('simple-syrup', {
      kind: 'preparation',
      yieldMl: 400,
      shelfLife: { days: 30, storage: 'refrigerated and sealed' },
      purchasable: true,
      lines: [
        { ingredientRef: 'granulated-sugar', formRef: 'standard', amount: 300, unit: 'g', garnish: false },
        { ingredientRef: 'water', formRef: 'standard', amount: 300, unit: 'ml', garnish: false },
      ],
    }),
    // One nobody sells, made out of another preparation.
    ingredient('house-cordial', {
      kind: 'preparation',
      yieldMl: 200,
      shelfLife: { days: 7, storage: 'refrigerated and sealed' },
      purchasable: false,
      lines: [
        { ingredientRef: 'simple-syrup', formRef: 'standard', amount: 150, unit: 'ml', garnish: false },
        { ingredientRef: 'lime-juice', formRef: 'standard', amount: 60, unit: 'ml', garnish: false },
      ],
    }),
  ].map((i) => [i.id, i]),
);

interface DrinkSketch {
  slug: string;
  lines: Array<[string, number, 'ml' | 'g'] | [string, number, 'ml' | 'g', 'garnish']>;
  defaultDrinks?: number;
  dilutionMlPerDrink?: number;
  serviceIceMl?: number;
  batchable?: 'full' | 'partial' | 'none';
  glass?: { id: string; name: string; capacityMl: number } | null;
  activeSec?: number;
}

const version = (s: DrinkSketch): DetailVersion => ({
  id: 'classic',
  label: 'Classic',
  isDefault: true,
  defaultDrinks: s.defaultDrinks ?? 1,
  method: 'stirred',
  batchable: s.batchable ?? 'full',
  glass: s.glass === undefined ? { id: 'rocks', name: 'Rocks', capacityMl: 300 } : s.glass,
  serviceIceMl: s.serviceIceMl ?? 0,
  iceStyle: 'cubed',
  dilutionMlPerDrink: s.dilutionMlPerDrink ?? 0,
  lines: s.lines.map(([ref, amount, unit, garnish]) => ({
    id: ref,
    ingredientRef: ref,
    form: 'standard',
    name: ref,
    amount,
    unit,
    garnish: garnish === 'garnish',
    preparation: INGREDIENTS.get(ref)?.kind === 'preparation',
  })),
  spec: {
    finalVolumeMl: 100,
    abvPercent: 20,
    pureAlcoholG: 15,
    standardDrinks: [{ id: 'us', label: 'US', drinks: 1 }, { id: 'uk', label: 'UK', drinks: 1.9 }],
    sugarG: 10,
    sugarGPerL: 100,
    acidPercent: 0,
    kcal: 180,
    estimated: false,
  },
  timing: { prepSec: 0, makeSec: s.activeSec ?? 60, restSec: 0, totalSec: s.activeSec ?? 60 },
  makeAhead: null,
  substitutions: [],
});

const detail = (s: DrinkSketch): DrinkDetail => ({
  slug: s.slug,
  name: s.slug,
  summary: '',
  versions: [version(s)],
});

const catalogEntry = (slug: string): CatalogEntry =>
  ({ slug, title: slug, family: null, ingredients: [], garnishes: [], substitutes: {} }) as unknown as CatalogEntry;

function resolved(sketches: DrinkSketch[], plan: PlanState): ResolvedItem[] {
  const entries = new Map(sketches.map((s) => [s.slug, catalogEntry(s.slug)]));
  const details = new Map(sketches.map((s) => [s.slug, detail(s)]));
  return resolvePlan(plan, entries, details).items;
}

const lineFor = (lines: ShoppingLine[], id: string): ShoppingLine | undefined =>
  lines.find((l) => l.ingredientRef === id);

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

test('the plan holds references and scalars only', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 12, service: 'batch' });
  const stored = JSON.parse(JSON.stringify(plan));
  const item = stored.items[0];
  assert.deepEqual(Object.keys(item).sort(), ['drink', 'drinks', 'service', 'uid', 'version']);
});

test('adding the same drink and version twice adds to the count rather than the list', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 6, service: 'order' });
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 6, service: 'batch' });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0]!.drinks, 12);
  assert.equal(plan.items[0]!.service, 'batch');

  plan = addItem(plan, { drink: 'negroni', version: 'sbagliato', drinks: 2, service: 'order' });
  assert.equal(plan.items.length, 2, 'a different version is a different entry');
});

test('counts and occasion figures are bounded rather than trusted', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'x', version: 'v', drinks: 9999, service: 'order' });
  assert.equal(plan.items[0]!.drinks, 500);
  plan = updateItem(plan, plan.items[0]!.uid, { drinks: 0 });
  assert.equal(plan.items[0]!.drinks, 1);
  assert.equal(setOccasion(plan, { guests: -4 }).occasion.guests, 0);
  assert.equal(removeItem(plan, plan.items[0]!.uid).items.length, 0);
});

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

test('an item whose drink or version has gone is dropped with a reason, never silently', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 2, service: 'order' });
  plan = addItem(plan, { drink: 'negroni', version: 'gone', drinks: 2, service: 'order' });
  plan = addItem(plan, { drink: 'deleted', version: 'classic', drinks: 2, service: 'order' });

  const sketch: DrinkSketch = { slug: 'negroni', lines: [['gin', 30, 'ml']] };
  const out = resolvePlan(
    plan,
    new Map([['negroni', catalogEntry('negroni')]]),
    new Map([['negroni', detail(sketch)]]),
  );

  assert.equal(out.items.length, 1);
  assert.equal(out.dropped.length, 2);
  assert.ok(out.dropped.every((d) => d.reason.length > 0));
});

test('batched service is downgraded where the recipe or the count no longer allows it', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'toddy', version: 'classic', drinks: 6, service: 'batch' });
  plan = addItem(plan, { drink: 'single', version: 'classic', drinks: 1, service: 'batch' });

  const sketches: DrinkSketch[] = [
    { slug: 'toddy', lines: [['water', 200, 'ml']], batchable: 'none' },
    { slug: 'single', lines: [['gin', 60, 'ml']] },
  ];
  const items = resolved(sketches, plan);

  assert.deepEqual(items.map((i) => i.service), ['order', 'order']);
  assert.ok(items.every((i) => i.serviceChanged));
});

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

test('quantities sum in base units and scale by drinks over defaultDrinks', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 12, service: 'order' });
  plan = addItem(plan, { drink: 'martinez', version: 'classic', drinks: 4, service: 'order' });

  const sketches: DrinkSketch[] = [
    { slug: 'negroni', lines: [['gin', 30, 'ml'], ['campari', 30, 'ml']] },
    // Authored at six drinks, so twelve of its own units per four drinks.
    { slug: 'martinez', lines: [['gin', 180, 'ml']], defaultDrinks: 6 },
  ];

  const list = buildShoppingList(resolved(sketches, plan), plan, INGREDIENTS);
  assert.equal(lineFor(list.buy, 'gin')!.amount, 12 * 30 + 180 * (4 / 6));
  assert.equal(lineFor(list.buy, 'campari')!.amount, 360);
  assert.equal(lineFor(list.buy, 'gin')!.from.length, 2, 'both drinks are named on the line');
});

test('batched service puts the engine\'s water on the shopping list', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 12, service: 'batch' });

  const sketches: DrinkSketch[] = [
    { slug: 'negroni', lines: [['gin', 30, 'ml']], dilutionMlPerDrink: 35.75 },
  ];
  const list = buildShoppingList(resolved(sketches, plan), plan, INGREDIENTS);

  // Water is a staple, so it lands in the staples group rather than "to buy" —
  // but it is present, because leaving it out is why a home batch tastes harsh.
  assert.equal(lineFor(list.staples, 'water')!.amount, 35.75 * 12);
});

test('made-to-order service adds no water line at all', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 12, service: 'order' });
  const sketches: DrinkSketch[] = [
    { slug: 'negroni', lines: [['gin', 30, 'ml']], dilutionMlPerDrink: 35.75 },
  ];
  const list = buildShoppingList(resolved(sketches, plan), plan, INGREDIENTS);
  assert.equal(lineFor(list.staples, 'water'), undefined);
});

// ---------------------------------------------------------------------------
// The preparation expansion — the fiddly part
// ---------------------------------------------------------------------------

test('a purchasable preparation defaults to buy, and appears as its own line', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'daiquiri', version: 'classic', drinks: 6, service: 'order' });
  const sketches: DrinkSketch[] = [
    { slug: 'daiquiri', lines: [['white-rum', 60, 'ml'], ['simple-syrup', 20, 'ml']] },
  ];

  const list = buildShoppingList(resolved(sketches, plan), plan, INGREDIENTS);
  assert.equal(lineFor(list.buy, 'simple-syrup')!.amount, 120);
  assert.equal(lineFor(list.staples, 'granulated-sugar'), undefined, 'buying it expands nothing');

  const decision = list.preparations.find((p) => p.id === 'simple-syrup')!;
  assert.equal(decision.choice, 'buy');
  assert.equal(decision.neededMl, 120);
  assert.equal(decision.yieldMl, 400);
});

test('making a preparation buys WHOLE batches, because a yield is not divisible', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'daiquiri', version: 'classic', drinks: 6, service: 'order' });
  plan.makePreparations['simple-syrup'] = 'make';

  const sketches: DrinkSketch[] = [
    { slug: 'daiquiri', lines: [['white-rum', 60, 'ml'], ['simple-syrup', 20, 'ml']] },
  ];
  const list = buildShoppingList(resolved(sketches, plan), plan, INGREDIENTS);

  // 120 ml needed of a 400 ml yield is one batch, and one batch is 300 g of
  // sugar — not the 90 g that scaling by need-over-yield would have produced.
  assert.equal(list.preparations[0]!.batches, 1);
  assert.equal(lineFor(list.staples, 'granulated-sugar')!.amount, 300);
  assert.equal(lineFor(list.buy, 'simple-syrup'), undefined, 'making it is not buying it');
});

test('demand across the whole plan decides the batch count, not the first drink met', () => {
  // This is what the fixed point is for. Expanding as you walk would compute
  // the batches from the first drink alone and come up short for the second.
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'a', version: 'classic', drinks: 10, service: 'order' });
  plan = addItem(plan, { drink: 'b', version: 'classic', drinks: 10, service: 'order' });
  plan.makePreparations['simple-syrup'] = 'make';

  const sketches: DrinkSketch[] = [
    { slug: 'a', lines: [['simple-syrup', 25, 'ml']] },
    { slug: 'b', lines: [['simple-syrup', 25, 'ml']] },
  ];
  const list = buildShoppingList(resolved(sketches, plan), plan, INGREDIENTS);

  const decision = list.preparations.find((p) => p.id === 'simple-syrup')!;
  assert.equal(decision.neededMl, 500);
  assert.equal(decision.batches, 2, '500 ml of a 400 ml yield is two batches');
  assert.equal(lineFor(list.staples, 'granulated-sugar')!.amount, 600);
});

test('a preparation inside a preparation is offered rather than expanded, and expands on request', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'x', version: 'classic', drinks: 4, service: 'order' });
  const sketches: DrinkSketch[] = [{ slug: 'x', lines: [['house-cordial', 25, 'ml']] }];

  // house-cordial is not purchasable, so it always expands; the simple syrup
  // inside it is, so it stops there and is offered as a line.
  const first = buildShoppingList(resolved(sketches, plan), plan, INGREDIENTS);
  assert.equal(lineFor(first.buy, 'simple-syrup')!.amount, 150);
  assert.equal(lineFor(first.staples, 'granulated-sugar'), undefined);
  assert.deepEqual(first.preparations.map((p) => [p.id, p.depth]), [
    ['house-cordial', 0],
    ['simple-syrup', 1],
  ]);

  // Ask for the second level and it appears.
  plan.makePreparations['simple-syrup'] = 'make';
  const second = buildShoppingList(resolved(sketches, plan), plan, INGREDIENTS);
  assert.equal(lineFor(second.staples, 'granulated-sugar')!.amount, 300);
  assert.equal(lineFor(second.buy, 'simple-syrup'), undefined);
});

test('provenance names the preparation an ingredient passed through', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'x', version: 'classic', drinks: 4, service: 'order' });
  plan.makePreparations['simple-syrup'] = 'make';
  const sketches: DrinkSketch[] = [{ slug: 'x', lines: [['house-cordial', 25, 'ml']] }];

  const list = buildShoppingList(resolved(sketches, plan), plan, INGREDIENTS);
  const sugar = lineFor(list.staples, 'granulated-sugar')!;
  assert.deepEqual(sugar.from[0]!.via, ['House cordial', 'Simple syrup']);
});

test('a preparation referencing itself warns and is bought instead of looping', () => {
  const looping = new Map(INGREDIENTS);
  looping.set('loop', {
    ...ingredient('loop', {
      kind: 'preparation',
      yieldMl: 100,
      purchasable: false,
      lines: [{ ingredientRef: 'loop', formRef: 'standard', amount: 50, unit: 'ml', garnish: false }],
    }),
  });

  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'x', version: 'classic', drinks: 1, service: 'order' });
  const entries = new Map([['x', catalogEntry('x')]]);
  const details = new Map([['x', detail({ slug: 'x', lines: [['loop', 50, 'ml']] })]]);
  const list = buildShoppingList(resolvePlan(plan, entries, details).items, plan, looping);

  assert.ok(list.warnings.some((w) => w.includes('loop of preparations')));
  // It still appears, as something to buy, rather than vanishing off the list.
  assert.equal(lineFor(list.buy, 'loop')!.amount, 50);
  assert.ok(MAX_EXPANSION_DEPTH >= 3);
});

// ---------------------------------------------------------------------------
// The occasion view
// ---------------------------------------------------------------------------

test('a bottle count applies to bottled goods only, at a stated size', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'daiquiri', version: 'classic', drinks: 20, service: 'order' });
  const sketches: DrinkSketch[] = [
    { slug: 'daiquiri', lines: [['white-rum', 60, 'ml'], ['lime-juice', 25, 'ml']] },
  ];
  const items = resolved(sketches, plan);
  const list = buildShoppingList(items, plan, INGREDIENTS);
  const view = buildOccasion(items, plan, [...list.buy, ...list.staples], INGREDIENTS);

  assert.deepEqual(view.bottles.map((b) => b.ingredientRef), ['white-rum']);
  assert.equal(view.bottles[0]!.bottleMl, 750, 'a US product uses the US standard of fill');
  assert.equal(view.bottles[0]!.bottles, 2, '1 200 ml over a 750 ml bottle is two');
  assert.ok(!view.bottles.some((b) => b.ingredientRef === 'lime-juice'), 'juice has no bottle standard');
});

test('the ice figure separates what is computed from what is a stated allowance', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 10, service: 'order' });
  const sketches: DrinkSketch[] = [
    { slug: 'negroni', lines: [['gin', 30, 'ml']], dilutionMlPerDrink: 36, serviceIceMl: 130 },
  ];
  const items = resolved(sketches, plan);
  const view = buildOccasion(items, plan, [], INGREDIENTS);

  assert.equal(view.ice.chillingG, 360);
  assert.equal(view.ice.mixingG, ICE.mixingGPerDrink * 10);
  assert.equal(view.ice.servingG, Math.round(130 * ICE.densityGPerMl * 10));
  assert.equal(
    view.ice.totalG,
    Math.round((view.ice.chillingG + view.ice.mixingG + view.ice.servingG) * (1 + ICE.meltAllowance)),
  );
});

test('a batch meets NO ice — neither in the shaker nor as meltwater', () => {
  // The dilution a batch needs is bought as water and is already on the
  // shopping list under that name. Weighing it here as ice too would put the
  // same litre on the page twice, and would cancel out the saving the page is
  // about to claim for batching.
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 12, service: 'batch' });
  const sketches: DrinkSketch[] = [
    { slug: 'negroni', lines: [['gin', 30, 'ml']], dilutionMlPerDrink: 36, serviceIceMl: 130 },
  ];
  const view = buildOccasion(resolved(sketches, plan), plan, [], INGREDIENTS);

  assert.equal(view.ice.mixingG, 0);
  assert.equal(view.ice.chillingG, 0);
  // Serving ice still counts: the drink is poured over ice whatever made it.
  assert.equal(view.ice.servingG, Math.round(130 * ICE.densityGPerMl * 12));
  assert.ok(view.ice.savedByBatchingG > 0);

  // And the saving is exactly the mixing and chilling ice, plus its melt share.
  const saved = (ICE.mixingGPerDrink * 12 + 36 * 12) * (1 + ICE.meltAllowance);
  assert.ok(Math.abs(view.ice.savedByBatchingG - saved) <= 1);
});

test('active time scales with the count made to order and does not when batched', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 12, service: 'order' });
  const sketches: DrinkSketch[] = [
    { slug: 'negroni', lines: [['gin', 30, 'ml']], activeSec: 90, dilutionMlPerDrink: 36 },
  ];

  const order = buildOccasion(resolved(sketches, plan), plan, [], INGREDIENTS);
  assert.equal(order.timing.activeSec, 90 * 12);
  assert.equal(order.timing.activeIfAllBatchedSec, 90, 'twelve batched is one combine');

  const batched = { ...plan, items: plan.items.map((i) => ({ ...i, service: 'batch' as const })) };
  assert.equal(buildOccasion(resolved(sketches, batched), batched, [], INGREDIENTS).timing.activeSec, 90);
});

test('glasses, garnishes and lead time come off the plan rather than being asked for', () => {
  let plan = emptyPlan();
  plan = addItem(plan, { drink: 'negroni', version: 'classic', drinks: 12, service: 'order' });
  plan.makePreparations['simple-syrup'] = 'make';

  const sketches: DrinkSketch[] = [
    {
      slug: 'negroni',
      lines: [['gin', 30, 'ml'], ['simple-syrup', 20, 'ml'], ['orange', 140, 'g', 'garnish']],
      glass: { id: 'rocks', name: 'Rocks', capacityMl: 300 },
    },
  ];
  const items = resolved(sketches, plan);
  const list = buildShoppingList(items, plan, INGREDIENTS);
  const view = buildOccasion(items, plan, [...list.buy, ...list.have, ...list.staples], INGREDIENTS);

  assert.deepEqual(view.glasses, [{ id: 'rocks', name: 'Rocks', drinks: 12 }]);
  assert.deepEqual(view.garnishes, [
    { ingredientRef: 'orange', name: 'Orange', count: 12, label: 'oranges' },
  ]);
  assert.equal(view.leadTimeDays, 30, 'the shortest shelf life sets the window');
  assert.equal(view.targetDrinks, 12);
  assert.equal(view.plannedDrinks, 12);
});

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

test('the share fragment round-trips, and tolerates the short form and rubbish', () => {
  const items = [
    { uid: 'a', drink: 'negroni', version: 'classic', drinks: 12, service: 'batch' as const },
    { uid: 'b', drink: 'daiquiri', version: 'classic', drinks: 6, service: 'order' as const },
  ];
  const encoded = encodeItems(items);
  assert.equal(encoded, 'negroni:classic:12:batch,daiquiri:classic:6:order');
  assert.deepEqual(
    decodeItems(`#p=${encoded}`).map((i) => [i.drink, i.version, i.drinks, i.service]),
    [['negroni', 'classic', 12, 'batch'], ['daiquiri', 'classic', 6, 'order']],
  );

  // The version-less form named in the specification still parses.
  assert.deepEqual(decodeItems('#p=negroni:12:batch'), [
    { drink: 'negroni', version: 'default', drinks: 12, service: 'batch' },
  ]);

  assert.deepEqual(decodeItems('#p=broken,negroni:classic:2:order').length, 1);
  assert.deepEqual(decodeItems('#nothing'), []);
  assert.deepEqual(decodeItems(''), []);
});

test('the shared text is quantity first, one item per line, no markdown', () => {
  const lines: ShoppingLine[] = [
    {
      key: 'gin', ingredientRef: 'gin', formRef: 'standard', name: 'London dry gin',
      amount: 360, unit: 'ml', staple: false, garnish: false, have: false, bottled: true, from: [],
    },
    {
      key: 'water', ingredientRef: 'water', formRef: 'standard', name: 'Water',
      amount: 429, unit: 'ml', staple: true, garnish: false, have: false, bottled: false, from: [],
    },
    {
      key: 'orange', ingredientRef: 'orange', formRef: 'standard', name: 'Oranges',
      amount: 1680, unit: 'g', staple: false, garnish: true, have: false, bottled: false,
      countUnit: { singular: 'orange', plural: 'oranges', g: 140, snap: 'half' }, from: [],
    },
  ];

  const text = shoppingText(lines, {
    system: 'metric',
    items: [{ title: 'Negroni', drinks: 12, service: 'batch' }],
    url: 'https://example.test/eXir/plan/#p=negroni:classic:12:batch',
  });

  assert.equal(
    text,
    [
      'Shopping list — eXir',
      '',
      '- 360 ml  London dry gin',
      '-  12     Oranges',
      '',
      'For: Negroni ×12 (batched)',
      'https://example.test/eXir/plan/#p=negroni:classic:12:batch',
    ].join('\n'),
  );
  assert.ok(!text.includes('Water'), 'staples stay out unless asked for');
  assert.ok(shoppingText(lines, { system: 'metric', items: [], includeStaples: true }).includes('Water'));
});

test('a counted line is named by its count noun, using the Form prose name', () => {
  const lines: ShoppingLine[] = [
    {
      key: 'egg', ingredientRef: 'egg', formRef: 'white', name: 'Egg',
      amount: 96.3, unit: 'ml', staple: false, garnish: false, have: false, bottled: false,
      countUnit: { singular: 'white', plural: 'whites', ml: 32.1, snap: 'half' },
      proseName: 'egg white', from: [],
    },
    {
      key: 'orange', ingredientRef: 'orange', formRef: 'standard', name: 'Orange',
      amount: 140, unit: 'g', staple: false, garnish: true, have: false, bottled: false,
      countUnit: { singular: 'orange', plural: 'oranges', g: 140, snap: 'half' }, from: [],
    },
  ];

  const text = shoppingText(lines, { system: 'metric', items: [] });
  // The singular inside the prose name is swapped for the plural, so the line
  // reads as the thing a shop sells rather than as a recipe fragment.
  assert.ok(text.includes('Egg whites'), text);
  // With no prose name the count's own plural is the name, and one is singular.
  assert.ok(text.includes('Orange'), text);
  assert.ok(!text.includes('Oranges'), text);
});
