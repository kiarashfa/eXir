/**
 * Image budget check.
 *
 * The projection is roughly 510 MB at full catalogue volume against a ~1 GB
 * soft limit on the host, and git keeps every version of every file forever.
 * An intention nobody measures is how a budget silently becomes a problem, so
 * the ceiling is enforced by the build rather than remembered.
 *
 *   node scripts/integrity/images.ts [--dir public/images] [--ceiling 700]
 */

import { stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { glob } from 'tinyglobby';
import { parseArgs } from './report.ts';

const CEILING_MB_DEFAULT = 700;

const args = parseArgs(process.argv.slice(2));
const dir = typeof args.get('dir') === 'string' ? (args.get('dir') as string) : 'public/images';
const ceilingMb = typeof args.get('ceiling') === 'string' ? Number(args.get('ceiling')) : CEILING_MB_DEFAULT;

if (!existsSync(dir)) {
  console.log(`Image budget: nothing at ${dir} yet.`);
  process.exit(0);
}

const files = await glob('**/*.{webp,avif,jpg,jpeg,png,gif,svg}', { cwd: dir, absolute: false });

const perGroup = new Map<string, { count: number; bytes: number }>();
let totalBytes = 0;

for (const file of files) {
  const { size } = await stat(path.join(dir, file));
  totalBytes += size;
  const group = file.split(/[\\/]/)[0] ?? '(root)';
  const g = perGroup.get(group) ?? { count: 0, bytes: 0 };
  g.count++;
  g.bytes += size;
  perGroup.set(group, g);
}

const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1);

for (const [group, g] of [...perGroup].sort()) {
  const avgKb = g.count > 0 ? Math.round(g.bytes / g.count / 1024) : 0;
  console.log(`  ${group.padEnd(16)} ${String(g.count).padStart(5)} files  ${mb(g.bytes).padStart(8)} MB  (~${avgKb} KB each)`);
}

const totalMb = totalBytes / 1024 / 1024;
console.log(
  `\nImage budget: ${files.length} files, ${mb(totalBytes)} MB of a ${ceilingMb} MB ceiling ` +
    `(${((totalMb / ceilingMb) * 100).toFixed(1)}%).`,
);

if (totalMb > ceilingMb) {
  console.error(`\nERROR: image weight exceeds the ${ceilingMb} MB ceiling.`);
  process.exit(1);
}
process.exit(0);
