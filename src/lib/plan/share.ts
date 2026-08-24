/**
 * Sharing a plan, and sharing the list it produces.
 *
 * Two different things travel by two different routes, on purpose.
 *
 * **The share URL carries the PLAN, not the list**, as a fragment. A fragment
 * because fragments are never sent to a server and so never appear in a log or
 * a referrer — and because the plan is references and scalars, the recipient
 * recomputes everything from today's catalogue rather than inheriting a
 * snapshot of the sender's. `have` is deliberately not encoded: what the sender
 * already owns is not the recipient's business.
 *
 * **The shopping list travels as plain text.** Quantity first, one item per
 * line, unit separated from name, no markdown tables and no nesting. That
 * format reads correctly in any message client and parses reliably when pasted
 * into an assistant, which is why no separate machine-readable export ships.
 */

import { countedName } from '../catalog.ts';
import { formatQuantity } from '../math/quantity.ts';
import type { ShoppingLine } from './aggregate.ts';
import type { PlanItem } from './store.ts';
import type { UnitSystem } from '../math/types.ts';

export const SHARE_PREFIX = 'p=';

/**
 * `negroni:classic:12:batch,daiquiri:classic:6:order`
 *
 * The version is carried. A plan item names one, and a link that dropped it
 * would resolve to whichever version happens to be the default today —
 * silently handing the recipient a different drink from the one that was
 * shared. A three-field form without it is still accepted on the way in.
 */
export function encodeItems(items: PlanItem[]): string {
  return items.map((i) => `${i.drink}:${i.version}:${i.drinks}:${i.service}`).join(',');
}

export type SharedItem = Pick<PlanItem, 'drink' | 'version' | 'drinks' | 'service'>;

/**
 * Tolerant on the way in.
 *
 * A share link is pasted, forwarded and truncated by message clients, so a
 * malformed segment drops that one drink rather than failing the whole plan.
 * Whether the drinks still exist is settled later, by resolution against the
 * catalogue, which reports what it dropped.
 */
export function decodeItems(fragment: string): SharedItem[] {
  const raw = fragment.replace(/^#/, '');
  const payload = raw.startsWith(SHARE_PREFIX) ? raw.slice(SHARE_PREFIX.length) : '';
  if (!payload) return [];

  const out: SharedItem[] = [];
  for (const segment of decodeURIComponent(payload).split(',')) {
    const parts = segment.split(':');
    if (parts.length < 3) continue;
    // A three-field segment omits the version: `drink:count:service`. The count
    // is the only numeric field, so the two shapes cannot be confused.
    const short = parts.length === 3 && Number.isFinite(Number(parts[1]));
    const [drink, version, count, service] = short
      ? [parts[0], 'default', parts[1], parts[2]]
      : parts;
    const drinks = Number(count);
    if (!drink || !version || !Number.isFinite(drinks) || drinks < 1) continue;
    out.push({
      drink,
      version,
      drinks: Math.min(500, Math.round(drinks)),
      service: service === 'batch' ? 'batch' : 'order',
    });
  }
  return out;
}

export const shareUrl = (origin: string, base: string, items: PlanItem[]): string =>
  `${origin}${base}/plan/#${SHARE_PREFIX}${encodeItems(items)}`;

// ---------------------------------------------------------------------------
// The text format, fixed by specification
// ---------------------------------------------------------------------------

export interface TextOptions {
  system: UnitSystem;
  items: Array<{ title: string; drinks: number; service: 'order' | 'batch' }>;
  url?: string;
  /** Staples are collapsed and deselected in the UI; they stay out of the text. */
  includeStaples?: boolean;
}

/**
 * One line's quantity as the list states it.
 *
 * A countable line goes out as its count — "12 Oranges" — because that is what
 * a market sells. Everything else goes out in the reader's own unit system, as
 * the site displays it everywhere else.
 */
function quantityOf(
  line: ShoppingLine,
  system: UnitSystem,
): { amount: string; unit: string; name: string } {
  if (line.countUnit) {
    const per = line.unit === 'ml' ? line.countUnit.ml : line.countUnit.g;
    if (per) {
      const count = Math.ceil(line.amount / per);
      return {
        amount: String(count),
        unit: '',
        // The count's own noun, because that is what a shop sells: "3 egg
        // whites", not "96 ml of egg".
        name: countedName(line.countUnit, count, line.proseName).replace(/^./, (c) =>
          c.toUpperCase(),
        ),
      };
    }
  }
  const text = formatQuantity(line.amount, line.unit, system).text;
  const split = text.indexOf(' ');
  return split < 0
    ? { amount: text, unit: '', name: line.name }
    : { amount: text.slice(0, split), unit: text.slice(split + 1), name: line.name };
}

export function shoppingText(list: ShoppingLine[], options: TextOptions): string {
  const rows = list
    .filter((l) => options.includeStaples || !l.staple)
    .map((line) => quantityOf(line, options.system));

  const amountWidth = Math.max(0, ...rows.map((r) => r.amount.length));
  const unitWidth = Math.max(0, ...rows.map((r) => r.unit.length));

  const body = rows.map(
    (r) => `- ${r.amount.padStart(amountWidth)} ${r.unit.padEnd(unitWidth)}  ${r.name}`.trimEnd(),
  );

  const forLine = options.items
    .map((i) => `${i.title} ×${i.drinks}${i.service === 'batch' ? ' (batched)' : ''}`)
    .join(', ');

  const out = ['Shopping list — eXir', '', ...body];
  if (forLine) out.push('', `For: ${forLine}`);
  if (options.url) out.push(options.url);
  return out.join('\n');
}

/**
 * Hand the text to whatever the browser has.
 *
 * `navigator.share` where it exists, clipboard always — and the clipboard is
 * the fallback rather than the other way round, because a share sheet that is
 * dismissed leaves the reader with nothing while a copy always lands somewhere.
 */
export async function shareText(text: string, title = 'Shopping list — eXir'): Promise<'shared' | 'copied' | 'failed'> {
  const nav = globalThis.navigator as Navigator | undefined;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch {
      // Dismissed or unsupported for this payload; fall through to the copy.
    }
  }
  try {
    await nav?.clipboard?.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
