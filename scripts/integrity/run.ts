/**
 * Content integrity runner.
 *
 * Loads and resolves the content once, then applies every registered check to
 * the result. The checks import the site's own schemas and the site's own
 * engine, so a rule exists in exactly one place and both the build and this
 * runner read it from there.
 *
 *   node scripts/integrity/run.ts [--content <dir>] [--expect-failure] [--strict]
 *
 * --expect-failure inverts the exit code. It is how the self-test asserts the
 * checks still catch deliberately-broken fixtures: a check that has quietly
 * stopped matching looks exactly like a clean content set.
 * --strict promotes warnings to errors.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { loadContent } from '../../src/lib/content/disk.ts';
import { resolveSite } from '../../src/lib/content/resolve.ts';
import { checks } from './checks.ts';
import { Report, parseArgs } from './report.ts';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const contentDir =
    typeof args.get('content') === 'string' ? (args.get('content') as string) : 'src/content';
  const expectFailure = args.get('expect-failure') === true;
  const strict = args.get('strict') === true;

  const report = new Report();

  if (!existsSync(contentDir)) {
    // The directory tree is part of the repository, not something a build
    // creates, so its absence means it was deleted or never checked out — not
    // that there is no content yet. Each content folder carries a README for
    // exactly this reason: git does not track an empty directory, and one that
    // silently vanishes from a clone takes the checks with it.
    console.error(
      `No content directory at ${contentDir}.\n` +
        'Every src/content subfolder should carry a README so the tree survives a clone.',
    );
    process.exit(1);
  }

  const content = await loadContent(contentDir);

  // Loading problems are reported as errors of their own rather than left to
  // surface as puzzling absences later: a step with prose and no metadata
  // contributes no time to a card that claims to be complete.
  for (const issue of content.issues) {
    report.error('c0-load', issue.file, issue.message);
  }

  const site = resolveSite(content);

  for (const check of checks) {
    // Declared before it runs, so a clean pass still reports what it looked at.
    // A check that ran and found nothing and a check that never ran read
    // identically otherwise, and only one of those is good news.
    report.ran(check.id);
    check.run({ site, report });
  }

  // What the run actually looked at. Twenty-eight checks reporting no errors
  // over nothing at all is vacuously true, and reads identically to a clean
  // pass over the whole site — so the census prints alongside the count rather
  // than leaving the two indistinguishable.
  const census = [
    `${site.drinks.length} drinks`,
    `${site.versions.length} versions`,
    `${content.ingredients.size} ingredients`,
    `${content.components.size} components`,
    `${content.families.size} families`,
    `${content.glassware.size} glasses`,
  ].join(' · ');
  console.log(`\nContent: ${census}`);
  if (site.versions.length === 0) {
    console.log('  Nothing authored yet, so the checks below assert nothing about content.');
  }

  report.print(`Content integrity (${contentDir})`);

  const failed = report.errors.length > 0 || (strict && report.warnings.length > 0);

  if (expectFailure) {
    if (!failed) {
      console.error(
        '\nSELF-TEST FAILED: the broken fixtures produced no errors, which means a check ' +
          'has stopped matching. That looks exactly like a clean content set.',
      );
      process.exit(1);
    }

    // Failing is not enough. The fixtures exist to exercise specific rules, and
    // a self-test that passed because ONE check caught everything would hide
    // every other check going quiet. So the exact set is asserted.
    const expectedPath = path.join(contentDir, 'EXPECTED.json');
    const fired = new Set(report.findings.map((f) => f.check));

    if (existsSync(expectedPath)) {
      const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as { mustFire: string[] };
      const silent = expected.mustFire.filter((id) => !fired.has(id));
      if (silent.length > 0) {
        console.error(
          `\nSELF-TEST FAILED: ${silent.length} check(s) that should have fired did not:\n` +
            silent.map((id) => `  ${id}`).join('\n') +
            '\n\nEither the check stopped matching, or the fixture that broke it was repaired.',
        );
        process.exit(1);
      }
      console.log(`\nSelf-test passed: all ${expected.mustFire.length} expected checks fired.`);
    } else {
      console.log(`\nSelf-test passed. Checks that fired: ${[...fired].sort().join(', ')}`);
    }
    process.exit(0);
  }

  process.exit(failed ? 1 : 0);
}

await main();
