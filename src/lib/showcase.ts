/**
 * The homepage's featured selection: a handful of entries, chosen at build
 * time and changing once a week.
 *
 * The homepage shows a fixed number however large the catalogue grows, so it
 * has to choose. Not "most recent", which would put whatever was written last
 * in the most prominent place on the site, and not random per build, which
 * would reshuffle it on every push. A shuffle seeded by the week number is
 * stable for seven days, different the next week, and needs nothing stored.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** A small, well-distributed seeded generator (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function weeklyPick<T>(items: readonly T[], count: number, now: number = Date.now()): T[] {
  const random = seeded(Math.floor(now / WEEK_MS));
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}
