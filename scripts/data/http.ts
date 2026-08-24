/**
 * The one fetch every data script goes through.
 *
 * ⚠️ The USDA FoodData Central API intermittently answers a perfectly valid
 * request with the FDC web application's HTML shell and a 404, then serves the
 * same URL correctly on a retry. Measured at roughly three failures in four
 * during one session. It is not the key, not the endpoint and not the query.
 *
 * Two consequences, and both are why this module exists:
 *
 * 1. A non-JSON body is a TRANSPORT failure, not a data failure, and must be
 *    retried rather than parsed. Handing that HTML to JSON.parse produces
 *    "Unexpected token '<'", which reads exactly like a moved or deprecated
 *    endpoint and sends you looking in the wrong place entirely.
 * 2. A 404 from this API cannot be trusted to mean "no such record" unless the
 *    body is JSON. A record that exists will otherwise look permanently missing.
 */

/**
 * Fields are declared and assigned explicitly rather than as constructor
 * parameter properties: Node runs these scripts by stripping types, which
 * cannot emit the assignment a parameter property implies, and fails outright.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.retryable = retryable;
  }
}

export interface FetchOptions {
  attempts?: number;
  /** First backoff in ms; doubles each attempt. */
  backoffMs?: number;
  init?: RequestInit;
  /** Called before each retry, so a long batch can show it is still alive. */
  onRetry?: (attempt: number, reason: string) => void;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Wikimedia requires a descriptive User-Agent and answers 429 without one.
 *
 * Found the expensive way: every image request in a batch failed with 429 four
 * times over and looked exactly like ordinary rate limiting, because a default
 * agent string is what their policy rejects rather than the request rate. It
 * costs nothing to send on every request, and identifying a script honestly to
 * the service it is reading is right anyway.
 */
const USER_AGENT = 'eXir/0.1 (https://kiarashfa.github.io/eXir/; a non-commercial drinks reference)';

const withAgent = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { 'user-agent': USER_AGENT, ...(init.headers ?? {}) },
});

/** Anything that is plainly a web page rather than an API response. */
const looksLikeHtml = (body: string): boolean =>
  /^\s*<(?:!doctype|html|\?xml)/i.test(body) || /<html[\s>]/i.test(body.slice(0, 400));

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const attempts = options.attempts ?? 6;
  let backoff = options.backoffMs ?? 400;
  let last = '';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let status = 0;
    let body = '';
    try {
      const response = await fetch(url, withAgent(options.init));
      status = response.status;
      body = await response.text();

      if (looksLikeHtml(body)) {
        // The gateway answered instead of the API. Says nothing about the record.
        last = `HTTP ${status} with an HTML body`;
      } else if (status === 429 || status >= 500) {
        last = `HTTP ${status}`;
      } else if (!response.ok) {
        // JSON and not ok: the API genuinely answered, so believe it.
        throw new HttpError(`HTTP ${status}: ${body.slice(0, 200)}`, status, false);
      } else {
        return JSON.parse(body) as T;
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof SyntaxError) {
        last = `unparseable body: ${body.slice(0, 120)}`;
      } else {
        last = error instanceof Error ? error.message : String(error);
      }
    }

    if (attempt < attempts) {
      options.onRetry?.(attempt, last);
      await sleep(backoff);
      backoff *= 2;
    }
  }

  throw new HttpError(`Gave up after ${attempts} attempts — ${last}`, status0(last), true);
}

/** Best-effort status for the error message; the reason string carries the detail. */
function status0(reason: string): number {
  const m = /HTTP (\d{3})/.exec(reason);
  return m ? Number(m[1]) : 0;
}

/** Binary fetch with the same retry discipline, for images. */
export async function fetchBinary(url: string, options: FetchOptions = {}): Promise<Buffer> {
  const attempts = options.attempts ?? 4;
  let backoff = options.backoffMs ?? 500;
  let last = '';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, withAgent(options.init));
      if (!response.ok) {
        last = `HTTP ${response.status}`;
      } else {
        const buffer = Buffer.from(await response.arrayBuffer());
        // An error page served with a 200 is still an error page.
        if (looksLikeHtml(buffer.subarray(0, 400).toString('utf8'))) {
          last = 'HTML body where an image was expected';
        } else {
          return buffer;
        }
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) {
      options.onRetry?.(attempt, last);
      await sleep(backoff);
      backoff *= 2;
    }
  }

  throw new HttpError(`Gave up after ${attempts} attempts — ${last}`, 0, true);
}

/**
 * USDA reports micrograms as "µg" in two different codepoints — U+00B5 MICRO
 * SIGN and U+03BC GREEK SMALL LETTER MU — sometimes within one response.
 * Comparing against one of them silently drops every micronutrient reported
 * with the other.
 */
export const normaliseUnit = (unit: string): string =>
  unit.replace(/µ|μ/g, 'u').trim().toLowerCase();
