/**
 * What to write next, taken from the plan and from what already exists.
 *
 *   node scripts/authoring/next.ts            # the next 3 recipes
 *   node scripts/authoring/next.ts 6          # the next 6
 *   node scripts/authoring/next.ts 3 --family sour
 *   node scripts/authoring/next.ts --plan     # every remaining batch, in order
 *
 * **Recipes, not rows.** A drink with three tabs is three recipes: three
 * ingredient lists, three sets of steps, three sets of computed figures. Sizing
 * a batch by rows makes one batch three times the size of another and nobody
 * notices until the work is done.
 *
 * **Batches are family-coherent.** All the sours in one hand produces consistent
 * treatment of what is genuinely one subject seen from twenty directions, and it
 * reuses the ingredient records the previous drink in the family created rather
 * than re-deriving them. So the selection walks the plan tier by tier and, within
 * a tier, keeps to one family until it runs out.
 *
 * Reads `catalogue/`, which is editorial planning and is not part of the build —
 * this prints what to write and asserts nothing about what ships. It exits with a
 * message rather than a stack trace where the folder is absent.
 */

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const CATALOGUE = 'catalogue';
const CONTENT = 'src/content';

interface Row {
  slug: string;
  name: string;
  category: string;
  origin: string;
  region: string;
  method: string;
  tier: number;
  versions: number;
  family: string;
  keyIngredient: string;
  note: string;
}

/**
 * The catalogue's format invariant is that no field contains a comma, so a plain
 * split is correct and a CSV parser would be a dependency buying nothing. Its own
 * validator fails on a stray comma, which from here would look like a short row.
 */
async function rows(): Promise<Row[]> {
  const raw = await readFile(path.join(CATALOGUE, 'drinks.csv'), 'utf8');
  const lines = raw.trim().split(/\r?\n/).slice(1);
  return lines.map((line) => {
    const f = line.split(',');
    return {
      slug: f[0] ?? '',
      name: f[1] ?? '',
      category: f[2] ?? '',
      origin: f[4] ?? '',
      region: f[5] === '-' ? '' : (f[5] ?? ''),
      method: f[6] ?? '',
      tier: Number(f[7] ?? '9'),
      versions: Number(f[8] ?? '1'),
      family: f[9] === '-' ? '' : (f[9] ?? ''),
      keyIngredient: f[10] === '-' ? '' : (f[10] ?? ''),
      note: f[11] === '-' ? '' : (f[11] ?? ''),
    };
  });
}

const written = async (): Promise<Set<string>> => {
  const dirs = await readdir(path.join(CONTENT, 'drinks'), { withFileTypes: true }).catch(() => []);
  return new Set(dirs.filter((d) => d.isDirectory()).map((d) => d.name));
};

const familiesOnSite = async (): Promise<Set<string>> => {
  const files = await readdir(path.join(CONTENT, 'families')).catch(() => []);
  return new Set(files.filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, '')));
};

/**
 * Group the remaining plan into batches of about `size` recipes.
 *
 * A drink is never split across two batches: its tabs are variations on one
 * subject and separating them is how two tabs of one drink end up written to
 * two different conventions. A drink whose own tab count exceeds the size is
 * therefore a batch on its own.
 *
 * Within a family this packs rather than truncating — it takes the next drinks
 * that FIT and leaves the ones that do not for a later batch — so a batch comes
 * out at the requested size instead of two recipes under it or three over. The
 * order within a family is otherwise arbitrary, so nothing is lost by it.
 *
 * Families whose page already exists come first, because a batch that cannot be
 * dispatched until something else is written is not the next work.
 */
function batches(remaining: Row[], size: number, families: Set<string>): Row[][] {
  const order = [...remaining].sort(
    (a, b) =>
      a.tier - b.tier ||
      Number(!families.has(a.family)) - Number(!families.has(b.family)) ||
      (a.family || 'zzz').localeCompare(b.family || 'zzz') ||
      a.slug.localeCompare(b.slug),
  );

  const out: Row[][] = [];
  const pool = [...order];

  while (pool.length) {
    const first = pool.shift()!;
    const batch = [first];
    let count = Math.max(1, first.versions);

    // Only from the same tier and family, and only what still fits.
    for (let i = 0; i < pool.length && count < size; ) {
      const row = pool[i]!;
      if (row.tier !== first.tier || row.family !== first.family) break;
      if (count + Math.max(1, row.versions) > size) {
        i += 1;
        continue;
      }
      batch.push(row);
      count += Math.max(1, row.versions);
      pool.splice(i, 1);
    }
    out.push(batch);
  }
  return out;
}

const recipes = (batch: Row[]): number =>
  batch.reduce((n, r) => n + Math.max(1, r.versions), 0);

function describe(batch: Row[], families: Set<string>): string[] {
  const lines: string[] = [];
  const family = batch[0]!.family;
  lines.push(
    `  ${recipes(batch)} recipe${recipes(batch) === 1 ? '' : 's'}` +
      ` · ${batch.length} drink${batch.length === 1 ? '' : 's'}` +
      ` · tier ${batch[0]!.tier}` +
      (family ? ` · family ${family}` : ' · no family'),
  );
  for (const r of batch) {
    const tabs = r.versions > 1 ? ` (${r.versions} tabs)` : '';
    const where = [r.origin, r.region].filter(Boolean).join(' / ');
    lines.push(`    ${r.slug}${tabs} — ${r.name} · ${r.method} · ${where}`);
    if (r.note) lines.push(`      note: ${r.note}`);
  }
  // A drink cannot declare a family the site has no page for, and the family is
  // not the author's to invent, so the gap is named here rather than discovered
  // by a failing check after the work is done.
  if (family && !families.has(family)) {
    lines.push(`    ⚠ the "${family}" family has no page yet — write it before this batch.`);
  }
  return lines;
}

async function main(): Promise<void> {
  if (!existsSync(CATALOGUE)) {
    console.log(`\nNo ${CATALOGUE}/ here. It is editorial planning and is not part of a clone.\n`);
    return;
  }

  const args = process.argv.slice(2);
  const size = Number(args.find((a) => /^\d+$/.test(a)) ?? '3');
  const familyArg = args[args.indexOf('--family') + 1];
  const onlyFamily = args.includes('--family') ? familyArg : null;
  const wholePlan = args.includes('--plan');

  const [all, done, families] = await Promise.all([rows(), written(), familiesOnSite()]);
  let remaining = all.filter((r) => !done.has(r.slug));
  if (onlyFamily) remaining = remaining.filter((r) => r.family === onlyFamily);

  const grouped = batches(remaining, size, families);

  console.log(
    `\n${done.size} of ${all.length} planned drinks written.` +
      ` ${remaining.length} remaining${onlyFamily ? ` in "${onlyFamily}"` : ''},` +
      ` ~${recipes(remaining)} recipes.`,
  );

  const show = wholePlan ? grouped : grouped.slice(0, 1);
  for (const [i, batch] of show.entries()) {
    console.log(`\nBATCH ${i + 1}`);
    for (const line of describe(batch, families)) console.log(line);
  }

  if (!wholePlan && grouped.length > 1) {
    console.log(`\n${grouped.length - 1} further batches. Pass --plan to see them all.`);
  }
  console.log('');
}

await main();
