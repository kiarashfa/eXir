/**
 * Content integrity runner.
 *
 * Walks a content directory and applies every registered check to it. The checks
 * import the site's own schemas, so a rule exists in exactly one place and both
 * the build and this runner read it from there.
 *
 *   node scripts/integrity/run.ts [--content <dir>] [--expect-failure] [--strict]
 *
 * --expect-failure inverts the exit code. It is how the self-test asserts that
 * the checks still catch deliberately-broken fixtures: a check that has quietly
 * stopped matching looks exactly like a clean content set.
 * --strict promotes warnings to errors.
 */

import { Report, parseArgs } from './report.ts';

export interface CheckContext {
  contentDir: string;
  report: Report;
}

export interface Check {
  /** Stable id, quoted in output and in SPEC's numbered list. */
  id: string;
  description: string;
  run(ctx: CheckContext): Promise<void> | void;
}

/**
 * The registry. Empty until the checks are written; the runner reports that
 * fact rather than exiting green on nothing.
 */
const checks: Check[] = [];

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const contentDir = typeof args.get('content') === 'string' ? (args.get('content') as string) : 'src/content';
  const expectFailure = args.get('expect-failure') === true;
  const strict = args.get('strict') === true;

  const report = new Report();

  for (const check of checks) {
    report.ran(check.id);
    await check.run({ contentDir, report });
  }

  report.print(`Content integrity (${contentDir})`);

  // ---------------------------------------------------------------------
  // No checks are registered yet. Reporting that plainly is the only honest
  // option: exiting 0 on an empty registry under --expect-failure would be a
  // self-test that asserts nothing while looking like it passed. This branch
  // is removed the moment the first check lands.
  // ---------------------------------------------------------------------
  if (checks.length === 0) {
    console.log(
      '\n  PENDING — no content checks are registered yet, so this run proves\n' +
        '  nothing about the content. The self-test is vacuous until they exist.',
    );
    process.exit(0);
  }

  const failed = report.errors.length > 0 || (strict && report.warnings.length > 0);

  if (expectFailure) {
    if (!failed) {
      console.error('\nSELF-TEST FAILED: the broken fixtures produced no errors.');
      process.exit(1);
    }
    console.log('\nSelf-test passed: the broken fixtures were caught.');
    process.exit(0);
  }

  process.exit(failed ? 1 : 0);
}

await main();
