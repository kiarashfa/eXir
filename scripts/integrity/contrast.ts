/**
 * Contrast measurement over the token layer.
 *
 *   node scripts/integrity/contrast.ts [--css src/styles/global.css]
 *
 * Colours that fail routinely look completely fine. Measuring them is not a
 * formality and it is not something to do once — a token nudged half a step for
 * aesthetic reasons is exactly how a palette drifts below the floor, and the
 * only way to know is to compute it.
 *
 * This parses the CSS that actually ships rather than a separate table of
 * values, because a table beside the stylesheet is a second source of truth and
 * would eventually disagree with it.
 */

import { readFile } from 'node:fs/promises';

import { Report, parseArgs } from './report.ts';

/** Text has to clear this against every surface it can sit on. */
const TEXT_MIN = 4.5;
/**
 * A control boundary is not text, but it is what tells a reader where the
 * control is, so it carries the non-text floor.
 */
const CONTROL_MIN = 3;

/** Tokens that carry running text or a figure a reader has to read. */
const FOREGROUNDS = ['ink', 'ink-soft', 'muted', 'accent', 'accent-ink', 'bitter', 'botanical'];

/**
 * The edge of something a reader operates — a stepper button, a segmented
 * control, a checkbox. Held to 3:1 because the boundary IS the affordance.
 */
const CONTROL_EDGES = ['control-edge'];

/**
 * Hairlines that separate rather than enclose. Measured and printed, but not
 * held to a floor: a divider carries no information a reader has to perceive
 * to use the page, and forcing it to 3:1 would make every card on the site
 * look like a table. Anything a reader ACTS on uses --control-edge instead,
 * and that distinction is the whole reason these are two tokens.
 */
const DECORATIVE = ['line', 'line-strong'];
/** Everything a foreground can be laid on. */
const SURFACES = ['surface', 'surface-2', 'surface-3'];

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(hex)) return null;
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pull `--name: value;` pairs out of one rule body. */
function tokensIn(css: string, selector: RegExp): Map<string, string> {
  const out = new Map<string, string>();
  const match = selector.exec(css);
  if (!match) return out;

  // Walk braces from the selector so a nested block cannot end the scan early.
  const start = css.indexOf('{', match.index);
  let depth = 0;
  let end = start;
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  for (const decl of css.slice(start + 1, end).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(decl[1]!, decl[2]!.trim());
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const file = typeof args.get('css') === 'string' ? (args.get('css') as string) : 'src/styles/global.css';
  const css = await readFile(file, 'utf8');

  // Dark is the base palette on :root; light redefines the same names.
  const dark = tokensIn(css, /:root\s*\{/);
  const lightOverrides = tokensIn(css, /:root\[data-theme=["']light["']\]\s*\{/);
  const light = new Map([...dark, ...lightOverrides]);

  if (dark.size === 0) {
    console.error(`No tokens found in ${file}.`);
    process.exit(1);
  }
  if (lightOverrides.size === 0) {
    console.error('No light theme block found — both themes are equally designed peers.');
    process.exit(1);
  }

  const report = new Report();
  report.ran('contrast');

  const measured: string[] = [];

  for (const [themeName, tokens] of [
    ['dark', dark],
    ['light', light],
  ] as const) {
    measured.push(`\n  ${themeName}`);

    for (const [group, min] of [
      [FOREGROUNDS, TEXT_MIN],
      [CONTROL_EDGES, CONTROL_MIN],
      [DECORATIVE, 0],
    ] as const) {
      for (const fg of group) {
        const fgColour = parseHex(tokens.get(fg) ?? '');
        if (!fgColour) {
          report.error('contrast', `${themeName} --${fg}`, 'is not an opaque colour, so it cannot be measured');
          continue;
        }

        const ratios: string[] = [];
        for (const bg of SURFACES) {
          const bgColour = parseHex(tokens.get(bg) ?? '');
          if (!bgColour) {
            report.error('contrast', `${themeName} --${bg}`, 'is not an opaque colour');
            continue;
          }
          const ratio = contrastRatio(fgColour, bgColour);
          ratios.push(`${bg.padEnd(9)} ${ratio.toFixed(2)}`);
          if (min > 0 && ratio < min) {
            report.error(
              'contrast',
              `${themeName} --${fg} on --${bg}`,
              `${ratio.toFixed(2)}:1 is below the ${min}:1 floor.`,
            );
          }
        }
        const label = min === 0 ? ' (decorative)' : '';
        measured.push(`    --${fg.padEnd(13)} ${ratios.join('   ')}${label}`);
      }
    }
  }

  console.log('Measured contrast ratios');
  console.log(measured.join('\n'));
  console.log(
    '\n  Text needs 4.5:1 against every surface it can sit on; a border or bar needs 3:1.',
  );

  report.print('Contrast');
  process.exit(report.errors.length > 0 ? 1 : 0);
}

await main();
