/**
 * Image curation: search, review by eye, adopt.
 *
 *   node scripts/data/images.ts search "negroni cocktail"
 *   node scripts/data/images.ts review "negroni cocktail" --slug negroni
 *   node scripts/data/images.ts review "…" --slug <s> --sheet   # one tiled sheet
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

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { attribution, byTitle, search, type Candidate } from './commons.ts';
import { readLicence } from './licence.ts';
import { searchOpenverse } from './openverse.ts';
import { fetchBinary } from './http.ts';
import { RENDITIONS, contactSheet, render, treat, triageSheet } from './image-treatment.ts';

const REVIEW_DIR = 'image-review';
const PUBLIC_DIR = 'public/images';

/**
 * Where each kind's files live.
 *
 * A map rather than `${kind}s`, because "glassware" is already a mass noun and
 * appending an s to it produced a `glasswares/` folder that matched neither the
 * repository structure nor English. Four entries is cheaper than the class of
 * bug where a path is assembled by guessing at grammar.
 */
const FOLDER: Record<string, string> = {
  drink: 'drinks',
  ingredient: 'ingredients',
  preparation: 'preparations',
  glassware: 'glassware',
};
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
async function doReview(
  query: string,
  slug: string,
  limit: number,
  sheet: boolean,
): Promise<void> {
  const results = await doSearch(query, limit);
  const dir = path.join(REVIEW_DIR, slug);
  await mkdir(dir, { recursive: true });

  console.log(`\nWriting sheets to ${dir}/\n`);
  const tiles: Buffer[] = [];
  const index: string[] = [];
  for (const [i, candidate] of results.entries()) {
    try {
      const original = await fetchBinary(candidate.url, {
        onRetry: (n, why) => console.error(`  retry ${n}: ${why}`),
      });
      const { image, report } = await treat(original);
      const after = await image.clone().webp({ quality: 80 }).toBuffer();
      const pair = await contactSheet(original, after);

      const n = String(i + 1).padStart(2, '0');
      const name = `${n}-${candidate.title.replace(/^File:/, '').replace(/[^\w.-]+/g, '_').slice(0, 40)}.webp`;
      await writeFile(path.join(dir, name), pair);
      if (sheet) tiles.push(after);
      index.push(`${n}  ${candidate.title}`);

      console.log(
        `  ${name.padEnd(46)} dominance ${report.colourDominance.toFixed(2)} · ` +
          `white balance applied ${(report.appliedStrength * 100).toFixed(0)}%`,
      );
    } catch (error) {
      console.log(`  ${candidate.title}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (sheet && tiles.length > 0) {
    await writeFile(path.join(dir, 'candidates.txt'), `${index.join('\n')}\n`, 'utf8');
    const file = path.join(dir, 'sheet.webp');
    await writeFile(file, await triageSheet(tiles));
    console.log(
      `\n${tiles.length} candidate(s). Contact sheet: ${file}\n` +
        `Read the sheet, pick the one that could be right, then open its own ` +
        `NN-*.webp at full size before adopting — the sheet is triage only and ` +
        `is too small to show a watermark, a date stamp or the wrong garnish.`,
    );
    return;
  }

  console.log('\nLeft half is the original, right half is treated. Look before adopting.');
  console.log('A strongly coloured drink should show white balance well below full strength —');
  console.log('if it corrected hard, the background will have gone the opposite colour.');
}

/**
 * Search everything free that is not on Commons.
 *
 * Prints the exact `adopt-url` line for each candidate, because the failure
 * this pass is prone to is a mistyped licence or a missing page URL, and a
 * command you can copy cannot be mistyped.
 */
async function doOpen(query: string, limit: number, slug?: string, kind?: string): Promise<void> {
  const results = await searchOpenverse(query, limit);
  console.log(`${results.length} free candidate(s) for "${query}" outside Commons\n`);
  for (const [i, c] of results.entries()) {
    const size = c.width && c.height ? `${c.width}x${c.height}` : 'size unknown';
    console.log(`${String(i + 1).padStart(2)}. ${c.title.slice(0, 64)}`);
    console.log(`    ${c.provider} · ${c.licence} · ${c.creator} · ${size}`);
    console.log(`    ${c.pageUrl}`);
    console.log(
      `    node scripts/data/images.ts adopt-url "${c.url}" --slug ${slug ?? '<slug>'} ` +
        `--kind ${kind ?? '<kind>'} --alt "..." --source "${c.provider}" ` +
        `--page "${c.pageUrl}" --author "${c.creator}" --license "${c.licence}"` +
        (c.licenceUrl ? ` --license-url "${c.licenceUrl}"` : ''),
    );
  }
  if (results.length === 0) {
    console.log('Nothing free found. That is a result: report it rather than widening to NC.');
  }
}

/**
 * Adopt an image from ANYWHERE — a national Wikipedia's local upload, Flickr,
 * Openverse, a museum's open-access API, a stock platform.
 *
 * Everything Commons answers for itself has to be supplied and checked here
 * instead: the licence is validated against a whitelist rather than believed,
 * and the page the image came from is recorded so the claim can be re-checked
 * by anyone. The image URL alone is not enough for that — it is where the
 * pixels are, not where the permission is.
 */
async function doAdoptUrl(url: string, argv: string[]): Promise<void> {
  const slug = arg('slug', argv);
  const kind = (arg('kind', argv) ?? 'drink') as Kind;
  const alt = arg('alt', argv);
  const source = arg('source', argv);
  const page = arg('page', argv);
  const author = arg('author', argv);
  const stated = arg('license', argv) ?? arg('licence', argv);
  const licenceUrl = arg('license-url', argv) ?? arg('licence-url', argv);
  const credit = arg('credit', argv);

  // Written as one condition rather than a list of falsy checks: the list form
  // does not narrow, so every one of these stayed `string | undefined` all the
  // way down to the manifest write, and `astro check` failed in CI on it.
  if (!slug || !alt || !source || !page || !author || !stated) {
    const missing = [
      !slug && '--slug',
      !alt && '--alt',
      !source && '--source',
      !page && '--page',
      !author && '--author',
      !stated && '--license',
    ].filter(Boolean);
    console.error(`adopt-url needs ${missing.join(', ')}.`);
    console.error('--page is the PAGE the image sits on, not the image file URL: it is what');
    console.error('makes the licence claim checkable by someone who was not here.');
    process.exit(1);
  }

  const verdict = readLicence(stated);
  if (!verdict.ok || !verdict.licence) {
    console.error(`Refused: ${verdict.reason}.`);
    console.error('Free licences only: CC0, public domain, CC BY, CC BY-SA, or the named');
    console.error('Unsplash / Pexels / Pixabay terms. NC and ND are never adopted — every');
    console.error('image here is cropped and graded, which ND forbids outright.');
    process.exit(1);
  }
  const licence = verdict.licence;
  if (!/^https?:\/\//.test(page)) {
    console.error('--page must be a URL.');
    process.exit(1);
  }

  const specs = RENDITIONS[kind];
  if (!specs) {
    console.error(`Unknown kind "${kind}". One of: ${Object.keys(RENDITIONS).join(', ')}`);
    process.exit(1);
  }

  console.log(`  ${licence.name}${licence.shareAlike ? ' (share-alike: the derivative inherits it)' : ''}`);
  if (licence.platform) {
    console.log('  Platform terms rather than a public licence — weaker, and creditable anyway.');
  }

  const original = await fetchBinary(url, {
    onRetry: (n, why) => console.error(`  retry ${n}: ${why}`),
  });
  const { image, report } = await treat(original);

  const outDir = path.join(PUBLIC_DIR, FOLDER[kind] ?? kind);
  await mkdir(outDir, { recursive: true });

  const renditions: ManifestEntry['renditions'] = {};
  let total = 0;
  for (const spec of specs) {
    const { buffer, width, height } = await render(image, spec);
    const file = `${slug}-${spec.name}.webp`;
    await writeFile(path.join(outDir, file), buffer);
    renditions[spec.name] = {
      file: `/images/${FOLDER[kind] ?? kind}/${file}`,
      width,
      height,
      bytes: buffer.length,
    };
    total += buffer.length;
    console.log(`  ${file.padEnd(34)} ${width}px  ${(buffer.length / 1024).toFixed(0)} kB`);
  }

  const record: Record<string, string> = {
    source,
    file: url,
    sourceUrl: page,
    author,
    license: licence.name,
    modified: 'Cropped, white-balanced, graded and re-encoded to WebP by eXir.',
  };
  if (credit) record['credit'] = credit;
  if (licenceUrl) record['licenseUrl'] = licenceUrl;

  const manifest = await loadManifest();
  manifest[`${kind}:${slug}`] = { slug, kind, alt, renditions, attribution: record };
  await mkdir(path.dirname(MANIFEST), { recursive: true });
  await writeFile(
    MANIFEST,
    `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}
`,
    'utf8',
  );

  console.log(
    `
  white balance applied ${(report.appliedStrength * 100).toFixed(0)}% ` +
      `(colour dominance ${report.colourDominance.toFixed(2)})`,
  );
  console.log(`  ${(total / 1024).toFixed(0)} kB total · manifest updated`);
}

/**
 * Tile already-adopted images into one sheet, so a reviewer can LOOK at a whole
 * batch at once. An agent adopts from metadata it cannot see; this is how the
 * pictures themselves get checked before they ship.
 */
async function doSheet(argv: string[]): Promise<void> {
  const keys = (arg('keys', argv) ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const out = arg('out', argv) ?? path.join(REVIEW_DIR, '_verify', 'sheet.webp');
  if (keys.length === 0) {
    console.error('sheet needs --keys kind:slug,kind:slug,…  (as they appear in the manifest)');
    process.exit(1);
  }
  const manifest = await loadManifest();
  const tiles: Buffer[] = [];
  const index: string[] = [];
  for (const key of keys) {
    const entry = manifest[key];
    if (!entry) {
      console.error(`  ${key}: not in the manifest`);
      continue;
    }
    const rendition = entry.renditions['card'] ?? Object.values(entry.renditions)[0];
    if (!rendition) continue;
    tiles.push(await readFile(path.join('public', rendition.file.replace(/^\//, ''))));
    index.push(`${String(tiles.length).padStart(2, '0')}  ${key}`);
  }
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, await triageSheet(tiles, 260));
  console.log(index.join('\n'));
  console.log(`\n${tiles.length} tile(s) → ${out}`);
}

/**
 * Un-adopt. Removes the manifest entry AND its rendition files together.
 *
 * Review rejects images — four in one round, on sight — and doing that by hand
 * leaves rendition files on disk with no manifest entry, which is precisely the
 * "lost adopt" shape a parallel round is supposed to avoid. One command so the
 * two halves cannot drift apart.
 */
async function doDrop(argv: string[]): Promise<void> {
  const keys = (arg('keys', argv) ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const why = arg('why', argv);
  if (keys.length === 0 || !why) {
    console.error('drop needs --keys kind:slug,… and --why "the reason this image was rejected"');
    process.exit(1);
  }
  const manifest = await loadManifest();
  for (const key of keys) {
    const entry = manifest[key];
    if (!entry) {
      console.error(`  ${key}: not in the manifest`);
      continue;
    }
    for (const rendition of Object.values(entry.renditions)) {
      const file = path.join('public', rendition.file.replace(/^\//, ''));
      if (existsSync(file)) await rm(file);
    }
    delete manifest[key];
    console.log(`  dropped ${key} — ${why}`);
  }
  await writeFile(
    MANIFEST,
    `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 2)}
`,
    'utf8',
  );
  console.log(`
  manifest updated. The subject is bare again and inventory.ts will list it.`);
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

  const outDir = path.join(PUBLIC_DIR, FOLDER[kind] ?? kind);
  await mkdir(outDir, { recursive: true });

  const renditions: ManifestEntry['renditions'] = {};
  let total = 0;
  for (const spec of specs) {
    const { buffer, width, height } = await render(image, spec);
    const file = `${slug}-${spec.name}.webp`;
    await writeFile(path.join(outDir, file), buffer);
    renditions[spec.name] = {
      file: `/images/${FOLDER[kind] ?? kind}/${file}`,
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
      await doReview(target, slug, limit, process.argv.includes('--sheet'));
      return;
    }
    case 'adopt':
      if (!target) return usage();
      await doAdopt(target, argv);
      return;
    case 'open':
      if (!target) return usage();
      await doOpen(target, limit, arg('slug', argv), arg('kind', argv));
      return;
    case 'adopt-url':
      if (!target) return usage();
      await doAdoptUrl(target, argv);
      return;
    case 'drop':
      await doDrop(argv);
      return;
    case 'sheet':
      await doSheet(argv);
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
  node scripts/data/images.ts open "<query>" [--limit n] [--slug s] [--kind k]
  node scripts/data/images.ts adopt-url "<image url>" --slug <slug> --kind ingredient
       --alt "..." --source "Flickr" --page "<page url>" --author "..."
       --license "CC BY 2.0" [--license-url "..."] [--credit "..."]
  node scripts/data/images.ts drop --keys drink:x,ingredient:y --why "reason"
  node scripts/data/images.ts sheet --keys drink:negroni,ingredient:gin [--out file.webp]

Kinds: ${Object.keys(RENDITIONS).join(', ')}
Licences: CC0 · public domain · CC BY · CC BY-SA · Unsplash/Pexels/Pixabay terms.
NC and ND are refused: every image here is cropped and graded.`);
  process.exit(1);
}

await main();
