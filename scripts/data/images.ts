/**
 * Image curation: search, review by eye, adopt.
 *
 *   node scripts/data/images.ts search "negroni cocktail"
 *   node scripts/data/images.ts review "negroni cocktail" --slug negroni
 *   node scripts/data/images.ts adopt "File:Negroni.jpg" --slug negroni --kind drink \
 *        --alt "A Negroni in a rocks glass over a single large cube, orange twist on the rim"
 *
 * `review` writes before/after contact sheets into the gitignored
 * `image-review/` scratch. NEVER adopt an image unseen — the whole point of
 * curating rather than auto-selecting is that a person looks at it.
 *
 * ⚠️ Get the treatment right on a pilot of about twenty subjects before
 * touching the rest. Git keeps every version of every binary forever, so one
 * site-wide re-grade does not replace the old images, it adds a second copy of
 * all of them to the repository's history permanently.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { attribution, byTitle, search, type Candidate } from './commons.ts';
import { fetchBinary } from './http.ts';
import { RENDITIONS, contactSheet, render, treat } from './image-treatment.ts';

const REVIEW_DIR = 'image-review';
const PUBLIC_DIR = 'public/images';
const MANIFEST = 'src/data/image-attributions.json';

type Kind = keyof typeof RENDITIONS;

interface ManifestEntry {
  slug: string;
  kind: string;
  alt: string;
  renditions: Record<string, { file: string; width: number; height: number; bytes: number }>;
  attribution: Record<string, string>;
}

function describe(c: Candidate, index?: number): void {
  const flag = c.publicDomain ? 'PD ' : c.shareAlike ? 'SA!' : 'BY ';
  const prefix = index === undefined ? '  ' : `${String(index).padStart(2)}. `;
  console.log(
    `${prefix}${flag} ${String(c.width).padStart(5)}x${String(c.height).padEnd(5)} ` +
      `${(c.sizeBytes / 1024 / 1024).toFixed(1)}MB  ${c.title.replace(/^File:/, '').slice(0, 58)}`,
  );
  console.log(`      ${c.licenseShortName ?? 'licence unknown'} · ${c.artist ?? 'author unknown'}`);
}

async function doSearch(query: string, limit: number): Promise<Candidate[]> {
  const results = await search(query, limit);
  console.log(`${results.length} candidates for "${query}"  [PD public domain · BY attribution · SA! share-alike]\n`);
  results.forEach((c, i) => describe(c, i + 1));
  if (results.some((c) => c.shareAlike)) {
    console.log(
      '\nSA! marks share-alike. Cropping and grading makes a derivative, so adopting one obliges',
    );
    console.log('the result to carry the same licence. Prefer PD or BY where quality is comparable.');
  }
  return results;
}

/**
 * Download each candidate, treat it, and write a before/after sheet.
 *
 * The report beside each sheet says how far the white balance actually got:
 * on a colour-dominant photograph it should have backed most of the way off,
 * and the sheet is where you confirm it did.
 */
async function doReview(query: string, slug: string, limit: number): Promise<void> {
  const results = await doSearch(query, limit);
  const dir = path.join(REVIEW_DIR, slug);
  await mkdir(dir, { recursive: true });

  console.log(`\nWriting sheets to ${dir}/\n`);
  for (const [index, candidate] of results.entries()) {
    try {
      const original = await fetchBinary(candidate.url, {
        onRetry: (n, why) => console.error(`  retry ${n}: ${why}`),
      });
      const { image, report } = await treat(original);
      const after = await image.clone().webp({ quality: 80 }).toBuffer();
      const sheet = await contactSheet(original, after);

      const name = `${String(index + 1).padStart(2, '0')}-${candidate.title.replace(/^File:/, '').replace(/[^\w.-]+/g, '_').slice(0, 40)}.webp`;
      await writeFile(path.join(dir, name), sheet);

      console.log(
        `  ${name.padEnd(46)} dominance ${report.colourDominance.toFixed(2)} · ` +
          `white balance applied ${(report.appliedStrength * 100).toFixed(0)}%`,
      );
    } catch (error) {
      console.log(`  ${candidate.title}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log('\nLeft half is the original, right half is treated. Look before adopting.');
  console.log('A strongly coloured drink should show white balance well below full strength —');
  console.log('if it corrected hard, the background will have gone the opposite colour.');
}

async function loadManifest(): Promise<Record<string, ManifestEntry>> {
  if (!existsSync(MANIFEST)) return {};
  return JSON.parse(await readFile(MANIFEST, 'utf8')) as Record<string, ManifestEntry>;
}

/**
 * Adopt one image.
 *
 * Writes every rendition, then writes the manifest entry the site reads. A
 * script that can search and review but does not actually write the field the
 * page renders is a defect that looks exactly like success, so the manifest
 * write is not optional and the file paths it records are the real ones.
 */
async function doAdopt(title: string, argv: string[]): Promise<void> {
  const slug = arg('slug', argv);
  const kind = (arg('kind', argv) ?? 'drink') as Kind;
  const alt = arg('alt', argv);

  if (!slug || !alt) {
    console.error('adopt needs --slug and --alt. Alt text is not optional and is not the caption.');
    process.exit(1);
  }
  const specs = RENDITIONS[kind];
  if (!specs) {
    console.error(`Unknown kind "${kind}". One of: ${Object.keys(RENDITIONS).join(', ')}`);
    process.exit(1);
  }

  const candidate = await byTitle(title.startsWith('File:') ? title : `File:${title}`);
  if (!candidate) {
    console.error(`No Commons file called "${title}".`);
    process.exit(1);
  }
  describe(candidate);

  const original = await fetchBinary(candidate.url, {
    onRetry: (n, why) => console.error(`  retry ${n}: ${why}`),
  });
  const { image, report } = await treat(original);

  const outDir = path.join(PUBLIC_DIR, `${kind}s`);
  await mkdir(outDir, { recursive: true });

  const renditions: ManifestEntry['renditions'] = {};
  let total = 0;
  for (const spec of specs) {
    const { buffer, width, height } = await render(image, spec);
    const file = `${slug}-${spec.name}.webp`;
    await writeFile(path.join(outDir, file), buffer);
    renditions[spec.name] = {
      file: `/images/${kind}s/${file}`,
      width,
      height,
      bytes: buffer.length,
    };
    total += buffer.length;
    console.log(`  ${file.padEnd(34)} ${width}px  ${(buffer.length / 1024).toFixed(0)} kB`);
  }

  const manifest = await loadManifest();
  manifest[`${kind}:${slug}`] = {
    slug,
    kind,
    alt,
    renditions,
    attribution: attribution(candidate),
  };
  await mkdir(path.dirname(MANIFEST), { recursive: true });
  await writeFile(
    MANIFEST,
    `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}\n`,
    'utf8',
  );

  console.log(
    `\n  white balance applied ${(report.appliedStrength * 100).toFixed(0)}% ` +
      `(colour dominance ${report.colourDominance.toFixed(2)})`,
  );
  console.log(`  ${(total / 1024).toFixed(0)} kB total across ${specs.length} renditions`);
  console.log(`  manifest updated: ${MANIFEST}`);
  console.log('\nRun `npm run check:images` to see where the budget stands.');
}

function arg(name: string, argv: string[]): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const [command, target, ...rest] = process.argv.slice(2);
  const argv = [target ?? '', ...rest];
  const limit = Number(arg('limit', argv)) || 10;

  switch (command) {
    case 'search':
      if (!target) return usage();
      await doSearch(target, limit);
      return;
    case 'review': {
      const slug = arg('slug', argv);
      if (!target || !slug) return usage();
      await doReview(target, slug, limit);
      return;
    }
    case 'adopt':
      if (!target) return usage();
      await doAdopt(target, argv);
      return;
    default:
      return usage();
  }
}

function usage(): void {
  console.log(`Usage:
  node scripts/data/images.ts search "<query>" [--limit n]
  node scripts/data/images.ts review "<query>" --slug <slug> [--limit n]
  node scripts/data/images.ts adopt "File:Name.jpg" --slug <slug> --kind drink --alt "..."

Kinds: ${Object.keys(RENDITIONS).join(', ')}`);
  process.exit(1);
}

await main();
