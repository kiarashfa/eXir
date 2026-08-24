/**
 * Renders an About section: paragraphs, light emphasis, and citations.
 *
 * Deliberately a different renderer from `prose.ts`, because it is a different
 * language. Step prose may contain no literal number at all and every quantity
 * in it comes out of structured data. About prose is the one place on the site
 * where a number IS the content — a date, a year, a strength quoted from a
 * source — and the discipline that replaces the no-numbers rule is that any
 * such claim carries a citation the reader can follow.
 *
 * So this renderer knows about `<Cite>` and nothing about `<Qty>`, and the two
 * do not share a code path where one could quietly inherit the other's rules.
 */

import { escapeHtml } from './live-values.ts';

export interface AboutSource {
  id: string;
  title: string;
  publisher: string;
  url?: string;
  year?: number;
}

export interface RenderedAbout {
  html: string;
  /** The sources actually cited, in the order they are first cited. */
  cited: Array<{ n: number; source: AboutSource }>;
  /** Declared but never cited. The build warns; the page simply lists them. */
  uncited: AboutSource[];
}

const CITE = /<Cite\b[^>]*?\bref\s*=\s*"([^"]*)"[^>]*\/?>/g;

const inline = (escaped: string): string =>
  escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');

export function renderAbout(body: string, sources: AboutSource[]): RenderedAbout {
  const byId = new Map(sources.map((s) => [s.id, s]));
  // Numbered in the order a reader meets them, not in the order they were
  // declared: the number is a position in the text, so it has to be earned there.
  const order: string[] = [];

  const paragraphs = body
    .trim()
    .split(/\n\s*\n/)
    .map((para) => {
      let out = '';
      let cursor = 0;
      for (const match of para.matchAll(CITE)) {
        const start = match.index ?? 0;
        out += inline(escapeHtml(para.slice(cursor, start)));
        cursor = start + match[0].length;

        const ref = match[1] ?? '';
        const source = byId.get(ref);
        if (!source) {
          // The build fails on this, so reaching it means the checks were
          // bypassed. Showing the ref beats swallowing the citation.
          out += `<sup class="cite is-unresolved">[${escapeHtml(ref)}]</sup>`;
          continue;
        }
        if (!order.includes(ref)) order.push(ref);
        const n = order.indexOf(ref) + 1;
        out += `<sup class="cite"><a href="#source-${escapeHtml(ref)}" title="${escapeHtml(
          source.title,
        )}">${n}</a></sup>`;
      }
      out += inline(escapeHtml(para.slice(cursor)));
      return `<p>${out.replace(/\s*\n\s*/g, ' ').trim()}</p>`;
    });

  return {
    html: paragraphs.join('\n'),
    cited: order.map((id, i) => ({ n: i + 1, source: byId.get(id)! })),
    uncited: sources.filter((s) => !order.includes(s.id)),
  };
}

/** Words in an About body, with the citation markup removed first. */
export const aboutWordCount = (body: string): number =>
  body
    .replace(CITE, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
