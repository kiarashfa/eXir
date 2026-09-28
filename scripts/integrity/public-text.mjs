/**
 * Two properties of the built site that nothing earlier in the build can see.
 *
 * 1. **No internal process in public text.** The design documents, the agent
 *    briefs and the working notes are gitignored, and their names still leak:
 *    a citation copied from a comment into an error string, a note that ends
 *    "per PLAYBOOK.md §3", a source note that names the rule it followed. Each
 *    of those rendered on a live page once. This fails the build on any
 *    built file that names one.
 * 2. **Every page carries exactly one canonical, pointing at itself.** A
 *    missing canonical is invisible in the browser; a wrong one quietly hands a
 *    page's ranking to another address. Redirect stubs and the 404 are exempt:
 *    the first canonicalise to their target by design, the second has no
 *    address of its own.
 *
 * The same file runs in all four sites; the base path is its one argument,
 * passed without a leading slash so no shell rewrites it into a file path.
 *
 *   node scripts/integrity/public-text.mjs Xefy
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const SITE = 'https://kiarashfa.github.io';
const BASE = (process.argv[2] ?? '').replace(/^\/+|\/+$/g, '');
const DIST = 'dist';

if (!BASE) {
  console.error('[public-text] usage: node scripts/integrity/public-text.mjs <base>');
  process.exit(2);
}

const INTERNAL = [
  /\bSPEC\.md\b/,
  /\bPLAYBOOK\.md\b/,
  /\bBRIEF(?:_SHAPES)?\.md\b/,
  /\bMEMORY\.md\b/,
  /\bDISPATCH\.md\b/,
  /\bINSTRUCTIONS?\.md\b/i,
  /\bFRICTION-LOG\b/,
  /\bBUILD-LOG\b/,
  /\bpilot batch\b/i,
  /\b(?:dish|drink|car|armag|image)-author\b/,
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (/\.(html|json|txt|xml)$/.test(entry.name)) out.push(path);
  }
  return out;
}

const failures = [];
const files = await walk(DIST);
let pages = 0;

for (const file of files) {
  const text = await readFile(file, 'utf8');
  const rel = relative(DIST, file).split(sep).join('/');

  for (const pattern of INTERNAL) {
    const hit = text.match(pattern);
    if (hit) failures.push(`${rel}: names "${hit[0]}", which is internal and never public`);
  }

  if (!rel.endsWith('.html')) continue;
  if (rel.startsWith('pagefind/')) continue;
  const isRedirect = /http-equiv="refresh"/i.test(text);
  const canonicals = [...text.matchAll(/<link[^>]+rel="canonical"[^>]*>/gi)].map(
    (m) => m[0].match(/href="([^"]+)"/)?.[1] ?? '',
  );
  if (isRedirect || rel === '404.html') continue;
  pages++;
  const expected = `${SITE}/${BASE}/${rel.replace(/(^|\/)index\.html$/, '$1')}`;
  if (canonicals.length !== 1) {
    failures.push(`${rel}: carries ${canonicals.length} canonical links, not one`);
  } else if (canonicals[0] !== expected) {
    failures.push(`${rel}: canonical is ${canonicals[0]}, expected ${expected}`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`  ${f}`);
  console.error(`\n[public-text] FAILED: ${failures.length} problem(s).`);
  process.exit(1);
}
console.log(`[public-text] passed: ${files.length} built files free of internal names; ${pages} pages each self-canonical.`);
