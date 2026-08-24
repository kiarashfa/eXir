/**
 * Open Food Facts — the branded and proprietary gap USDA does not cover.
 *
 *   node scripts/data/off.ts review "campari bitter"
 *   node scripts/data/off.ts fetch 8000040000802
 *   node scripts/data/off.ts form 8000040000802 --id standard --label "Standard"
 *
 * USDA has nothing on Campari, Chartreuse, Angostura or any other proprietary
 * product, and those are load-bearing here — you cannot write a Negroni without
 * one. This is where they come from.
 *
 * ⚠️ The data is crowd-sourced and the records genuinely disagree. Campari is
 * filed at both 20% and 25% ABV; Angostura at 48% where the producer states
 * 44.7%. Some of that spread is real (products are reformulated and vary by
 * market, which is a fact worth recording and dating) and some of it is simply
 * wrong. So `review` shows every candidate side by side and highlights where
 * they disagree, and nothing is adopted without a person choosing.
 *
 * The producer's own published figures outrank this. Open Food Facts is the
 * fallback, cited as such.
 *
 * ODbL. Attribution is required and is emitted into the Form's source fields.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { fetchJson } from './http.ts';
import { statedEnergyDisagreement } from '../../src/lib/math/nutrition.ts';
import { ETHANOL_G_PER_ML, ETHANOL_KCAL_PER_G } from '../../src/lib/math/alcohol.ts';

const SEARCH = 'https://world.openfoodfacts.org/cgi/search.pl';
const PRODUCT = 'https://world.openfoodfacts.org/api/v2/product';
const CACHE_DIR = 'src/data/composition-sources';

/**
 * Open Food Facts asks that clients identify themselves, and rate-limits
 * anonymous traffic harder. This is a courtesy their terms actually request.
 */
const INIT: RequestInit = {
  headers: { 'User-Agent': 'eXir/0.1 (drinks encyclopedia; https://github.com/kiarashfa/eXir)' },
};

const FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'quantity',
  'countries',
  'categories',
  'ingredients_text',
  'nutriments',
  'image_front_url',
  'last_modified_t',
].join(',');

interface Nutriments {
  alcohol_100g?: number;
  sugars_100g?: number;
  carbohydrates_100g?: number;
  proteins_100g?: number;
  fat_100g?: number;
  'saturated-fat_100g'?: number;
  fiber_100g?: number;
  sodium_100g?: number;
  'energy-kcal_100g'?: number;
}

interface Product {
  code: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  quantity?: string;
  countries?: string;
  categories?: string;
  ingredients_text?: string;
  nutriments?: Nutriments;
  image_front_url?: string;
  last_modified_t?: number;
}

const cachePath = (code: string): string => path.join(CACHE_DIR, `off-${code}.json`);

async function fetchProduct(code: string): Promise<Product> {
  const file = cachePath(code);
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8')) as Product;

  const result = await fetchJson<{ product?: Product; status?: number }>(
    `${PRODUCT}/${code}.json?fields=${FIELDS}`,
    { init: INIT, onRetry: (n, why) => console.error(`  retry ${n}: ${why}`) },
  );
  if (!result.product) throw new Error(`No Open Food Facts product with barcode ${code}.`);

  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(cachePath(code), `${JSON.stringify(result.product, null, 2)}\n`, 'utf8');
  return result.product;
}

const show = (value: number | undefined): string => (value === undefined ? '—' : String(value));

/**
 * Show every candidate together, because the disagreements between them are the
 * information. A single top hit hides exactly what a person needs to see.
 */
async function review(query: string, limit: number): Promise<void> {
  const url =
    `${SEARCH}?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process` +
    `&json=1&page_size=${limit}&fields=${FIELDS}`;

  const result = await fetchJson<{ count: number; products?: Product[] }>(url, {
    init: INIT,
    onRetry: (n, why) => console.error(`  retry ${n}: ${why}`),
  });

  const products = result.products ?? [];
  console.log(`${result.count} matches for "${query}", showing ${products.length}\n`);
  console.log(
    `${'barcode'.padEnd(15)}${'name'.padEnd(34)}${'ABV'.padStart(6)}${'sugar'.padStart(8)}${'kcal'.padStart(7)}  brand`,
  );

  const abvs = new Set<number>();
  const inconsistent: string[] = [];

  for (const p of products) {
    const n = p.nutriments ?? {};
    if (n.alcohol_100g !== undefined) abvs.add(n.alcohol_100g);

    // A record's own numbers have to agree with each other. Energy is the sum
    // of its macros and its alcohol, so a stated figure that does not match is
    // a transcription error somewhere in the entry — and it says which of two
    // disagreeing candidates to distrust without leaving the search results.
    const macroKcal =
      (n.carbohydrates_100g ?? n.sugars_100g ?? 0) * 4 +
      (n.proteins_100g ?? 0) * 4 +
      (n.fat_100g ?? 0) * 9;
    const gap = statedEnergyDisagreement(
      n['energy-kcal_100g'],
      macroKcal,
      n.alcohol_100g ?? 0,
      undefined,
      ETHANOL_G_PER_ML,
      ETHANOL_KCAL_PER_G,
    );
    if (gap && n.alcohol_100g !== undefined) {
      inconsistent.push(
        `${p.code}: states ${gap.stated} kcal but its own macros and ${n.alcohol_100g}% ABV come to ${gap.computed.toFixed(0)}`,
      );
    }

    console.log(
      p.code.padEnd(15) +
        (p.product_name ?? '?').slice(0, 32).padEnd(34) +
        show(n.alcohol_100g).padStart(6) +
        show(n.sugars_100g).padStart(8) +
        show(n['energy-kcal_100g']).padStart(7) +
        (gap ? ' !' : '  ') +
        (p.brands ?? '—').slice(0, 22),
    );
  }

  if (inconsistent.length) {
    console.log('\n! These records disagree with themselves:');
    for (const line of inconsistent) console.log(`    ${line}`);
  }

  if (abvs.size > 1) {
    console.log(
      `\n⚠ The candidates disagree on strength: ${[...abvs].sort((a, b) => a - b).join('%, ')}%.`,
    );
    console.log(
      '  Some of that spread is real — products are reformulated and vary by market — and some',
    );
    console.log(
      '  of it is simply a wrong entry. Check the producer before believing any of it, and if the',
    );
    console.log('  variation is genuine, record it as a fact with a date rather than picking one.');
  }
  console.log('\nThe producer\'s own published figures outrank all of this.');
}

function describe(p: Product): void {
  const n = p.nutriments ?? {};
  console.log(`\n${p.code}  ${p.product_name ?? '?'}`);
  if (p.brands) console.log(`  brand       ${p.brands}`);
  if (p.quantity) console.log(`  quantity    ${p.quantity}`);
  if (p.countries) console.log(`  countries   ${p.countries}`);
  console.log(`  ABV         ${show(n.alcohol_100g)}%`);
  console.log(`  sugar       ${show(n.sugars_100g)} g/100`);
  console.log(`  energy      ${show(n['energy-kcal_100g'])} kcal/100`);
  if (p.ingredients_text) console.log(`  ingredients ${p.ingredients_text.slice(0, 120)}`);
  console.log(`  image       ${p.image_front_url ?? '—'}`);

  if (n.sugars_100g === undefined) {
    console.log(
      '\n  NO SUGAR FIGURE. Omit sugarGPer100 rather than estimating it from a class:',
    );
    console.log('  a wrong sugar figure propagates straight into the balance bars.');
  }
}

/**
 * Emit a Form block.
 *
 * Every field written here is one the site actually reads. A script that can
 * search but cannot write the field the page renders is a defect that looks
 * exactly like success, so the output is the real shape, ready to paste.
 */
async function emitForm(code: string, argv: string[]): Promise<void> {
  const product = await fetchProduct(code);
  describe(product);

  const n = product.nutriments ?? {};
  const nutrition: Record<string, number> = {};
  const map: Array<[string, number | undefined]> = [
    ['kcal', n['energy-kcal_100g']],
    ['carbohydrateG', n.carbohydrates_100g],
    ['sugarsG', n.sugars_100g],
    ['proteinG', n.proteins_100g],
    ['fatG', n.fat_100g],
    ['saturatedFatG', n['saturated-fat_100g']],
    ['fibreG', n.fiber_100g],
    // Open Food Facts reports sodium in grams; the site stores milligrams.
    ['sodiumMg', n.sodium_100g === undefined ? undefined : n.sodium_100g * 1000],
  ];
  for (const [field, value] of map) if (value !== undefined) nutrition[field] = value;

  const explicitAbv = argv[argv.indexOf('--abv') + 1];
  const form: Record<string, unknown> = {
    id: argv[argv.indexOf('--id') + 1] ?? 'standard',
    ...(argv.includes('--label') ? { label: argv[argv.indexOf('--label') + 1] } : {}),
    abvPercent: argv.includes('--abv') ? Number(explicitAbv) : (n.alcohol_100g ?? 0),
    ...(n.sugars_100g !== undefined ? { sugarGPer100: n.sugars_100g } : {}),
    acidPercent: 0,
    ...(Object.keys(nutrition).length ? { nutritionPer100g: nutrition } : {}),
    animalOrigin: 'none',
    allergenTags: [],
    sourceDataset: 'Open Food Facts',
    sourceId: product.code,
    sourceNote:
      `${product.product_name ?? code}${product.brands ? ` (${product.brands})` : ''}. ` +
      'Open Food Facts, ODbL. Crowd-sourced; cross-checked against the producer.',
  };

  console.log('\n--- Form block ---');
  console.log(JSON.stringify(form, null, 2));
  console.log('\nBefore pasting:');
  console.log('  · animalOrigin is a placeholder. Carmine, isinglass and gelatine are invisible in');
  console.log('    an ingredient list and this is where they get missed. Check the product.');
  console.log('  · No density here. Use a class from density-classes.json, marked estimated.');
  console.log('  · sourceNote must say the producer was checked, because it should have been.');
}

async function main(): Promise<void> {
  const [command, target, ...rest] = process.argv.slice(2);
  const argv = [target ?? '', ...rest];

  switch (command) {
    case 'review':
      if (!target) return usage();
      await review(target, Number(argv[argv.indexOf('--limit') + 1]) || 10);
      return;
    case 'fetch':
      if (!target) return usage();
      describe(await fetchProduct(target));
      console.log(`\nCached at ${cachePath(target)}`);
      return;
    case 'form':
      if (!target) return usage();
      await emitForm(target, argv);
      return;
    default:
      return usage();
  }
}

function usage(): void {
  console.log(`Usage:
  node scripts/data/off.ts review "<query>" [--limit n]
  node scripts/data/off.ts fetch <barcode>
  node scripts/data/off.ts form <barcode> [--id standard] [--label "Standard"] [--abv 25]`);
  process.exit(1);
}

await main();
