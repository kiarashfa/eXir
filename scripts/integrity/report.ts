/**
 * Shared reporting surface for every integrity script.
 *
 * One collector, one output format, one exit convention, so a failure reads the
 * same whether it came from a content check, a link check or the image budget.
 */

export type Severity = 'error' | 'warning';

export interface Finding {
  /** Stable identifier, e.g. "portions-sum" or "glassware-fit". */
  check: string;
  severity: Severity;
  /** Path or id the finding is about. */
  where: string;
  message: string;
}

export class Report {
  readonly findings: Finding[] = [];
  private readonly checksRun = new Set<string>();

  /** Record that a check executed, whether or not it found anything. */
  ran(check: string): void {
    this.checksRun.add(check);
  }

  error(check: string, where: string, message: string): void {
    this.ran(check);
    this.findings.push({ check, severity: 'error', where, message });
  }

  warn(check: string, where: string, message: string): void {
    this.ran(check);
    this.findings.push({ check, severity: 'warning', where, message });
  }

  get errors(): Finding[] {
    return this.findings.filter((f) => f.severity === 'error');
  }

  get warnings(): Finding[] {
    return this.findings.filter((f) => f.severity === 'warning');
  }

  get checkCount(): number {
    return this.checksRun.size;
  }

  /**
   * Print the findings grouped by check, then a summary line.
   *
   * The error count prints last and on its own line: a count buried above a
   * wall of warnings is a count nobody reads.
   */
  print(label: string): void {
    const byCheck = new Map<string, Finding[]>();
    for (const f of this.findings) {
      const list = byCheck.get(f.check) ?? [];
      list.push(f);
      byCheck.set(f.check, list);
    }

    for (const [check, findings] of [...byCheck].sort()) {
      console.log(`\n  ${check}`);
      for (const f of findings) {
        const mark = f.severity === 'error' ? 'ERROR  ' : 'warning';
        console.log(`    ${mark}  ${f.where}\n             ${f.message}`);
      }
    }

    const e = this.errors.length;
    const w = this.warnings.length;
    console.log(
      `\n${label}: ${this.checkCount} check${this.checkCount === 1 ? '' : 's'} run, ` +
        `${w} warning${w === 1 ? '' : 's'}, ${e} error${e === 1 ? '' : 's'}.`,
    );
  }
}

/** Parse `--flag value` and `--flag` out of argv. */
export function parseArgs(argv: string[]): Map<string, string | true> {
  const out = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out.set(key, next);
      i++;
    } else {
      out.set(key, true);
    }
  }
  return out;
}
