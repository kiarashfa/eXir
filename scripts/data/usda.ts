/**
 * USDA FoodData Central.
 *
 *   node scripts/data/usda.ts search "london dry gin" [--limit 10] [--type SR Legacy]
 *   node scripts/data/usda.ts fetch 171920
 *   node scripts/data/usda.ts form 171920 --id standard --label "Standard" [--no-density]
 *
 * The cache in `src/data/composition-sources/` is the READ PATH, not a
 * fallback. A build never needs the API and CI never gets a key; this script is
 * run by hand when a new ingredient is authored, and what it writes is what
 * ships.
 *
 * Public domain data, cited per Form via `sourceDataset` / `sourceId`.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { fetchJson, normaliseUnit } from './http.ts';

const API = 'https://api.nal.usda.gov/fdc/v1';
const CACHE_DIR = 'src/data/composition-sources';

const ETHANOL_G_PER_ML = 0.789;

// ---------------------------------------------------------------------------
// Shapes (only the parts this script reads)
// ---------------------------------------------------------------------------

interface SearchHit {
  fdcId: number;
  dataType: string;
  description: string;
  brandOwner?: string;
}

interface Nutrient {
  nutrient?: { id: number; number: string; name: string; unitName: string };
  nutrientId?: number;
  nutrientNumber?: string;
  nutrientName?: string;
  unitName?: string;
  amount?: number;
  value?: number;
}

interface Portion {
  gramWeight: number;
  amount?: number;
  modifier?: string;
  measureUnit?: { name: string; abbreviation?: string };
}

interface FoodRecord {
  fdcId: number;
  dataType: string;
  description: string;
  foodNutrients?: Nutrient[];
  foodPortions?: Portion[];
  labelNutrients?: Record<string, { value: number }>;
  servingSize?: number;
  servingSizeUnit?: string;
}

// ---------------------------------------------------------------------------
// Nutrient access
// ---------------------------------------------------------------------------

/** Both response shapes appear across dataTypes; flatten them once. */
function flat(n: Nutrient): { number: string; name: string; unit: string; amount: number } | null {
  const num = n.nutrient?.number ?? n.nutrientNumber;
  const amount = n.amount ?? n.value;
  if (num === undefined || amount === undefined) return null;
  return {
    number: String(num),
    name: n.nutrient?.name ?? n.nutrientName ?? '',
    unit: normaliseUnit(n.nutrient?.unitName ?? n.unitName ?? ''),
    amount,
  };
}

const NUTRIENTS = {
  water: '255',
  energyKcal: '208',
  /**
   * Foundation records frequently omit 208 and report energy under the Atwater
   * factors instead. Checking only 208 makes a complete record look empty.
   */
  energyAtwaterGeneral: '957',
  energyAtwaterSpecific: '958',
  protein: '203',
  fat: '204',
  carbohydrate: '205',
  fibre: '291',
  sugars: '269',
  sodium: '307',
  saturatedFat: '606',
  alcohol: '221',
} as const;

function amountOf(record: FoodRecord, number: string): number | undefined {
  for (const raw of record.foodNutrients ?? []) {
    const n = flat(raw);
    if (n?.number === number) return n.amount;
  }
  return undefined;
}

function energyKcal(record: FoodRecord): { value: number; via: string } | undefined {
  const direct = amountOf(record, NUTRIENTS.energyKcal);
  if (direct !== undefined) return { value: direct, via: '208' };
  for (const key of [NUTRIENTS.energyAtwaterGeneral, NUTRIENTS.energyAtwaterSpecific] as const) {
    const value = amountOf(record, key);
    if (value !== undefined) return { value, via: `Atwater ${key}` };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Density
// ---------------------------------------------------------------------------

const ML_PER = new Map<string, number>([
  ['fl oz', 29.5735295625],
  ['floz', 29.5735295625],
  ['cup', 236.5882365],
  ['tbsp', 14.78676478125],
  ['tablespoon', 14.78676478125],
  ['tsp', 4.92892159375],
  ['teaspoon', 4.92892159375],
  ['ml', 1],
  ['milliliter', 1],
  ['liter', 1000],
  ['litre', 1000],
  ['quart', 946.352946],
  ['pint', 473.176473],
]);

/** Units that only ever measure a poured liquid. */
const LIQUID_UNITS = new Set(['fl oz', 'floz', 'ml', 'milliliter', 'liter', 'litre', 'quart', 'pint']);

/**
 * Nothing that goes in a drink is genuinely lighter than this. A figure below
 * it is air between pieces, not the substance.
 */
const MIN_TRUE_DENSITY = 0.85;
const MAX_TRUE_DENSITY = 1.8;

export interface Density {
  gPerMl: number;
  from: string;
  /** `bulk` means the figure includes the space between pieces. */
  kind: 'liquid' | 'bulk' | 'suspect';
  usable: boolean;
  note?: string;
}

/**
 * A measured density, where the record carries a volume portion.
 *
 * ⚠️ Two traps here, and the second is the expensive one.
 *
 * `measureUnit.name` is very often the literal string "undetermined", with the
 * real unit sitting in `modifier` instead. Reading only `measureUnit` finds a
 * density on almost nothing.
 *
 * And USDA's portion densities are TRUE densities for liquids but BULK
 * densities for solids, because a cup of a solid is mostly the air between the
 * pieces. Measured against real records: fresh mint comes out at 0.108 g/ml,
 * raw ginger at 0.406, granulated sugar at 0.795. The site's `densityGPerMl`
 * means true density — it exists to say what volume something adds to a drink
 * and to reach a volume for the alcohol maths — so adopting a cup-derived
 * figure would put mint's volume out by a factor of ten.
 *
 * A measured liquid density always beats a density class; each one is a dotted
 * underline avoided. But food match beats density: the record carrying the
 * portion data can be the wrong product.
 */
export function densityFrom(record: FoodRecord): Density | null {
  for (const portion of record.foodPortions ?? []) {
    const unitText = normaliseUnit(portion.measureUnit?.name ?? '');
    const modifier = normaliseUnit(portion.modifier ?? '');
    const candidate =
      unitText !== 'undetermined' && ML_PER.has(unitText) ? unitText : modifier;

    const mlPerUnit = ML_PER.get(candidate);
    if (!mlPerUnit) continue;

    const volumeMl = (portion.amount ?? 1) * mlPerUnit;
    if (volumeMl <= 0 || !portion.gramWeight) continue;

    const gPerMl = portion.gramWeight / volumeMl;
    const from = `${portion.amount ?? 1} ${candidate} = ${portion.gramWeight} g`;

    if (gPerMl < MIN_TRUE_DENSITY) {
      return {
        gPerMl,
        from,
        kind: 'bulk',
        usable: false,
        note:
          `${gPerMl.toFixed(3)} g/ml is a packing density — the volume of a ${candidate} of it, ` +
          'air between the pieces included. It is not what this ingredient displaces in a drink.',
      };
    }
    if (gPerMl > MAX_TRUE_DENSITY) {
      return {
        gPerMl,
        from,
        kind: 'suspect',
        usable: false,
        note: `${gPerMl.toFixed(3)} g/ml is denser than any drinks ingredient. Check the portion.`,
      };
    }
    if (!LIQUID_UNITS.has(candidate)) {
      return {
        gPerMl,
        from,
        kind: 'suspect',
        usable: true,
        note:
          `Derived from a ${candidate}, which measures solids as well as liquids. Plausible as a ` +
          'true density, but confirm the food is poured rather than packed before adopting it.',
      };
    }
    return { gPerMl, from, kind: 'liquid', usable: true };
  }
  return null;
}

/**
 * ABV from the measured ethanol content and the measured density.
 *
 * `alcoholG` is grams of ethanol per 100 g of product, so 100 g occupies
 * `100 / density` ml and the ethanol in it occupies `alcoholG / 0.789` ml.
 * This is a cross-check on a bottle's stated strength, not a replacement for
 * it — for a generic spirit the record's own proof is the better figure.
 */
export function abvFrom(alcoholGPer100g: number, gPerMl: number): number {
  return (alcoholGPer100g * gPerMl) / ETHANOL_G_PER_ML;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const cachePath = (fdcId: number): string => path.join(CACHE_DIR, `usda-${fdcId}.json`);

async function loadCached(fdcId: number): Promise<FoodRecord | null> {
  const file = cachePath(fdcId);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8')) as FoodRecord;
}

async function fetchRecord(fdcId: number, key: string): Promise<FoodRecord> {
  const cached = await loadCached(fdcId);
  if (cached) return cached;

  const record = await fetchJson<FoodRecord>(`${API}/food/${fdcId}?api_key=${key}`, {
    onRetry: (attempt, reason) => console.error(`  retry ${attempt}: ${reason}`),
  });

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(fdcId), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * What "complete" means here is macros PLUS the things a drink page shows.
 * A record can be present, parse cleanly, and still be unusable — so the gaps
 * are printed rather than left for the author to notice on the page.
 */
function completeness(record: FoodRecord): string[] {
  const missing: string[] = [];
  if (!energyKcal(record)) missing.push('energy');
  for (const [label, num] of [
    ['carbohydrate', NUTRIENTS.carbohydrate],
    ['sugars', NUTRIENTS.sugars],
    ['protein', NUTRIENTS.protein],
    ['fat', NUTRIENTS.fat],
  ] as const) {
    if (amountOf(record, num) === undefined) missing.push(label);
  }
  return missing;
}

function describe(record: FoodRecord): void {
  const energy = energyKcal(record);
  const density = densityFrom(record);
  const alcohol = amountOf(record, NUTRIENTS.alcohol);

  console.log(`\n${record.fdcId}  ${record.dataType}`);
  console.log(`  ${record.description}`);
  console.log(
    `  energy      ${energy ? `${energy.value} kcal/100 g (via ${energy.via})` : '— MISSING'}`,
  );
  if (!density) {
    console.log('  density     — none; a density class will be needed, marked estimated');
  } else {
    console.log(`  density     ${density.gPerMl.toFixed(4)} g/ml  [${density.kind}]  (${density.from})`);
    if (density.note) console.log(`              ${density.usable ? 'CHECK' : 'REJECTED'}: ${density.note}`);
  }
  if (alcohol !== undefined) {
    const line =
      density?.usable
        ? `${alcohol} g/100 g  ->  ${abvFrom(alcohol, density.gPerMl).toFixed(1)}% ABV`
        : `${alcohol} g/100 g  (no usable density, so no ABV)`;
    console.log(`  alcohol     ${line}`);
  }
  for (const [label, num] of [
    ['carbohydrate', NUTRIENTS.carbohydrate],
    ['sugars', NUTRIENTS.sugars],
    ['protein', NUTRIENTS.protein],
    ['fat', NUTRIENTS.fat],
    ['sat. fat', NUTRIENTS.saturatedFat],
    ['fibre', NUTRIENTS.fibre],
    ['sodium', NUTRIENTS.sodium],
  ] as const) {
    const value = amountOf(record, num);
    if (value !== undefined) console.log(`  ${label.padEnd(11)} ${value}`);
  }

  const missing = completeness(record);
  if (missing.length) {
    console.log(`\n  INCOMPLETE — no ${missing.join(', ')}.`);
    console.log('  Read this before adopting it. A record can parse cleanly and still be unusable.');
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const flagSet = (name: string, argv: string[]): boolean => argv.includes(`--${name}`);

async function search(query: string, argv: string[], key: string): Promise<void> {
  const limit = Number(arg('limit', argv) ?? 12);
  const type = arg('type', argv);
  const url =
    `${API}/foods/search?query=${encodeURIComponent(query)}&pageSize=${limit}&api_key=${key}` +
    (type ? `&dataType=${encodeURIComponent(type)}` : '');

  const result = await fetchJson<{ totalHits: number; foods?: SearchHit[] }>(url, {
    onRetry: (attempt, reason) => console.error(`  retry ${attempt}: ${reason}`),
  });

  console.log(`${result.totalHits} hits for "${query}"\n`);
  for (const hit of result.foods ?? []) {
    const brand = hit.brandOwner ? `  [${hit.brandOwner}]` : '';
    console.log(`  ${String(hit.fdcId).padEnd(9)} ${hit.dataType.padEnd(11)} ${hit.description}${brand}`);
  }
  console.log('\nFood match beats density. Pick the right food first, then worry about portions.');
}

/**
 * Emit a Form block ready to paste into an ingredient record.
 *
 * The density is attached by default and sometimes has to be removed: a Form
 * whose amounts are only ever authored in ml gains nothing from one, and a
 * density that is wrong is worse than a density that is absent.
 */
async function emitForm(fdcId: number, argv: string[], key: string): Promise<void> {
  const record = await fetchRecord(fdcId, key);
  describe(record);

  const found = flagSet('no-density', argv) ? null : densityFrom(record);
  // A rejected density is not attached. A wrong density is worse than none:
  // none is honestly estimated from a class, wrong is silently believed.
  const density = found?.usable ? found : null;
  const alcohol = amountOf(record, NUTRIENTS.alcohol);
  const explicitAbv = arg('abv', argv);

  const abvPercent =
    explicitAbv !== undefined
      ? Number(explicitAbv)
      : alcohol !== undefined && density
        ? Number(abvFrom(alcohol, density.gPerMl).toFixed(1))
        : 0;

  const energy = energyKcal(record);
  const nutrition: Record<string, number> = {};
  if (energy) nutrition['kcal'] = energy.value;
  const map: Array<[string, string]> = [
    ['carbohydrateG', NUTRIENTS.carbohydrate],
    ['sugarsG', NUTRIENTS.sugars],
    ['proteinG', NUTRIENTS.protein],
    ['fatG', NUTRIENTS.fat],
    ['saturatedFatG', NUTRIENTS.saturatedFat],
    ['fibreG', NUTRIENTS.fibre],
    ['sodiumMg', NUTRIENTS.sodium],
  ];
  for (const [field, num] of map) {
    const value = amountOf(record, num);
    if (value !== undefined) nutrition[field] = value;
  }

  const form: Record<string, unknown> = {
    id: arg('id', argv) ?? 'standard',
    ...(arg('label', argv) ? { label: arg('label', argv) } : {}),
    abvPercent,
    ...(density
      ? { densityGPerMl: Number(density.gPerMl.toFixed(4)), densitySource: 'measured' }
      : {}),
    sugarGPer100: amountOf(record, NUTRIENTS.sugars) ?? 0,
    acidPercent: 0,
    nutritionPer100g: nutrition,
    sourceDataset: `USDA FoodData Central (${record.dataType})`,
    sourceId: String(record.fdcId),
    sourceNote: `${record.description}. Public domain.`,
  };

  console.log('\n--- Form block ---');
  console.log(JSON.stringify(form, null, 2));
  console.log('\nCheck before pasting:');
  console.log('  · acidPercent is 0 here because USDA does not report titratable acidity.');
  console.log('    Citrus and vinegar need it filled in from a cited source.');
  if (!density) {
    console.log('  · No usable measured density. Use a class from density-classes.json and mark it estimated.');
    if (found && !found.usable) console.log(`  · The record's own figure was rejected: ${found.note}`);
  }
  if (density?.kind === 'suspect') {
    console.log(`  · ${density.note}`);
  }
  if (abvPercent === 0 && alcohol !== undefined) {
    console.log('  · Alcohol is present but no ABV could be derived. Pass --abv with the bottle strength.');
  }
  console.log('  · densityGPerMl must be TRUE density. A bulk/pouring figure is the wrong number here.');
}

async function main(): Promise<void> {
  process.loadEnvFile('.env');
  const key = process.env['USDA_FDC_API_KEY'];
  if (!key) {
    console.error('No USDA_FDC_API_KEY in .env. The file must be UTF-8, not UTF-16.');
    process.exit(1);
  }

  const [command, target, ...rest] = process.argv.slice(2);
  const argv = [target ?? '', ...rest];

  switch (command) {
    case 'search':
      if (!target) return usage();
      await search(target, argv, key);
      return;
    case 'fetch': {
      if (!target) return usage();
      describe(await fetchRecord(Number(target), key));
      console.log(`\nCached at ${cachePath(Number(target))}`);
      return;
    }
    case 'form':
      if (!target) return usage();
      await emitForm(Number(target), argv, key);
      return;
    default:
      return usage();
  }
}

function usage(): void {
  console.log(`Usage:
  node scripts/data/usda.ts search "<query>" [--limit n] [--type "SR Legacy"]
  node scripts/data/usda.ts fetch <fdcId>
  node scripts/data/usda.ts form <fdcId> [--id standard] [--label "Standard"] [--abv 40] [--no-density]`);
  process.exit(1);
}

await main();
