/**
 * Renders one step's authored prose to HTML.
 *
 * Step prose is a deliberately small language: sentences, five components, and
 * light emphasis. Nothing else belongs in it, because every number has to come
 * out of structured data — so rendering it here rather than through the general
 * MDX pipeline is not a limitation, it is the same constraint the content rules
 * already impose.
 *
 * It also has to be done this way. Transclusion interleaves a Component's steps
 * into the parent's sequence, and the two service modes present different step
 * sequences over the same ingredient list, so a page's method is assembled from
 * several files' prose in an order none of them declares. There is no single
 * document to hand to a Markdown renderer.
 */

import type { ResolvedLine, UnitSystem } from '../math/types.ts';
import type { Step } from '../math/types.ts';
import {
  abvHtml,
  durHtml,
  escapeHtml,
  lenHtml,
  qtyHtml,
  tempHtml,
  type QtyData,
} from './live-values.ts';

const COMPONENT = /<(Qty|Temp|Len|Dur|Abv)\b([^>]*?)\/?>/g;

const stringAttr = (source: string, name: string): string | undefined =>
  source.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1];

/** Numeric props are authored JSX-style: `c={65}`. Plain `c="65"` also works. */
const numberAttr = (source: string, name: string): number | undefined => {
  const braced = source.match(new RegExp(`\\b${name}\\s*=\\s*\\{\\s*([-\\d.]+)\\s*\\}`));
  if (braced) return Number(braced[1]);
  const quoted = source.match(new RegExp(`\\b${name}\\s*=\\s*"([-\\d.]+)"`));
  return quoted ? Number(quoted[1]) : undefined;
};

/** Emphasis and links only. Everything else in the source is literal text. */
function inlineMarkdown(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
}

export interface ProseSource {
  lines: ResolvedLine[];
  steps: Step[];
  defaultDrinks: number;
}

export interface ProseContext {
  source: ProseSource;
  drinks: number;
  system: UnitSystem;
}

/**
 * How an ingredient reads mid-sentence.
 *
 * A generic lowercases: "combine the london dry gin" is what the sentence
 * wants. A proprietary product does not, because its name is a trademark and
 * lowercasing it is both wrong on the page and careless nominative use. That
 * distinction is already recorded on the ingredient, so it is derived here
 * rather than left to an author to remember on every brand record.
 */
export function proseName(resolved: ResolvedLine): string {
  if (resolved.form.proseName) return resolved.form.proseName;
  if (resolved.ingredient.proseName) return resolved.ingredient.proseName;
  if (resolved.ingredient.proprietary) return resolved.ingredient.name;
  return resolved.ingredient.name.toLowerCase();
}

/** Find the line or portion a ref points at, and the amount it means. */
function qtyDataFor(source: ProseSource, ref: string): QtyData | null {
  for (const resolved of source.lines) {
    const { line, form } = resolved;
    const portion = line.portions?.find((p) => p.id === ref);
    if (line.id !== ref && !portion) continue;

    return {
      amount: portion ? portion.amount : line.amount,
      unit: line.unit,
      defaultDrinks: source.defaultDrinks,
      name: proseName(resolved),
      countUnit: form.countUnit,
      // An authored amount is never an estimate, whatever the Form's density is
      // sourced from. Amounts are authored in ml or g and displayed in ml, g,
      // fl oz or oz, and not one of those conversions goes through a density —
      // so an estimated density cannot reach this figure. The marker means the
      // true value is not on the page, and here it is. Only an amount the
      // engine computed, such as the batch water line, carries it.
      estimated: line.computed === true,
    };
  }
  return null;
}

function abvFor(source: ProseSource, ref: string): number | null {
  for (const resolved of source.lines) {
    if (resolved.line.id === ref || resolved.line.ingredientRef === ref) {
      return resolved.form.abvPercent;
    }
  }
  return null;
}

export function renderProse(prose: string, context: ProseContext): string {
  const { source, drinks, system } = context;
  let out = '';
  let cursor = 0;

  for (const match of prose.matchAll(COMPONENT)) {
    const start = match.index ?? 0;
    out += inlineMarkdown(escapeHtml(prose.slice(cursor, start)));
    cursor = start + match[0].length;

    const [, tag, rawAttrs = ''] = match;
    switch (tag) {
      case 'Qty': {
        const ref = stringAttr(rawAttrs, 'ref') ?? '';
        const data = qtyDataFor(source, ref);
        // An unresolvable ref fails the build, so reaching this branch means
        // the checks were bypassed. Show the ref rather than swallowing it.
        out += data
          ? qtyHtml({ ...data, fraction: numberAttr(rawAttrs, 'fraction') }, drinks, system)
          : `<span class="q is-unresolved">[${escapeHtml(ref)}]</span>`;
        break;
      }
      case 'Temp': {
        const c = numberAttr(rawAttrs, 'c');
        const precision = stringAttr(rawAttrs, 'precision') === 'coarse' ? 'coarse' : 'fine';
        out += c == null ? '' : tempHtml(c, system, precision);
        break;
      }
      case 'Len': {
        const cm = numberAttr(rawAttrs, 'cm');
        out += cm == null ? '' : lenHtml(cm, system);
        break;
      }
      case 'Dur': {
        const stepId = stringAttr(rawAttrs, 'step') ?? '';
        const step = source.steps.find((s) => s.id === stepId);
        out += step
          ? durHtml(step.durationSec, step.id)
          : `<span class="value is-unresolved">[${escapeHtml(stepId)}]</span>`;
        break;
      }
      case 'Abv': {
        const ref = stringAttr(rawAttrs, 'ref') ?? '';
        const abv = abvFor(source, ref);
        out += abv == null
          ? `<span class="value is-unresolved">[${escapeHtml(ref)}]</span>`
          : abvHtml(abv, ref);
        break;
      }
    }
  }

  out += inlineMarkdown(escapeHtml(prose.slice(cursor)));
  // Authored prose is indented inside its source block; collapse that away.
  return out.replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * Every digit in rendered step text that is not inside a live-value span.
 *
 * A literal number in prose is a number that can drift from the data beside it,
 * so the build fails on one. Checking the RENDERED text rather than the source
 * is what makes the rule enforceable: it sees exactly what a reader would.
 */
export function literalDigitsInProse(renderedHtml: string): string[] {
  const stripped = renderedHtml.replace(/<span class="(?:q|value)[^"]*"[\s\S]*?<\/span>/g, '');
  const withoutTags = stripped.replace(/<[^>]+>/g, '');
  return [...withoutTags.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => m[0]);
}
