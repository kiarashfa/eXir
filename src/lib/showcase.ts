/**
 * The homepage's featured selection: a handful of entries that changes every
 * day, the same for every visitor on the same calendar day.
 *
 * The homepage shows a fixed number however large the catalogue grows, so it
 * has to choose. Not "most recent", which would put whatever was written last
 * in the most prominent place on the site, and not random per visit, which
 * would reshuffle on every refresh. Instead every candidate is placed once in
 * a fixed order, and each day takes the next slice of it: no entry comes back
 * until every other one has had its day, and two days in a row share nothing.
 *
 * The page is built once and may be served unchanged for months, so the day
 * is the reader's, not the build's. The build renders its own day, so the
 * section is whole without JavaScript, and ships the candidates with it; the
 * inline script below moves the section to the reader's day before it is
 * painted. Nothing is stored and nothing is fetched.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many days of picks the page carries. Past that the cycle repeats, so
    the payload stays the same size however large the catalogue grows. */
export const FEATURED_DAYS = 90;

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

/**
 * Every candidate once, in the order the days walk through them.
 *
 * A plain shuffle puts neighbours of the same kind side by side often enough
 * that a row of eight regularly shows three of one thing. So the shuffle only
 * decides the order within each group, and the groups are then interleaved:
 * every member of a group gets an evenly spaced place across the whole cycle
 * (a group of a tenth of the entries lands every tenth place), shifted by a
 * random offset per group so the groups do not move in step. A group too
 * large to keep apart is still spread as evenly as its size allows.
 *
 * The seed is fixed and the input is sorted first, so the order depends only
 * on the set of entries, never on the order they were read in.
 */
export function featuredOrder<T>(
  items: readonly T[],
  id: (item: T) => string,
  group: (item: T) => string,
): T[] {
  const random = seeded(0x5eed);
  const pool = [...items].sort((a, b) => (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const groups = new Map<string, T[]>();
  for (const item of pool) {
    const key = group(item);
    const members = groups.get(key);
    if (members) members.push(item);
    else groups.set(key, [item]);
  }
  const placed: { item: T; at: number }[] = [];
  for (const members of groups.values()) {
    const offset = random();
    members.forEach((item, k) => placed.push({ item, at: (k + offset) / members.length }));
  }
  return placed.sort((a, b) => a.at - b.at).map((p) => p.item);
}

/** Where a day's slice starts in a pool of `size`, `days` after its first day. */
export function featuredStart(days: number, count: number, size: number): number {
  if (size <= 0) return 0;
  return (((days * count) % size) + size) % size;
}

/** `count` entries of the pool from `start`, wrapping at the end. */
export function featuredSlice<T>(pool: readonly T[], count: number, start: number): T[] {
  return Array.from({ length: Math.min(count, pool.length) }, (_, i) => pool[(start + i) % pool.length]!);
}

export interface Featured<T> {
  /** The candidates the page carries, from its first day on. */
  pool: T[];
  /** How many a day shows: the requested number, or the whole pool if smaller. */
  count: number;
  /** The pool's first day, in whole days since 1970-01-01. */
  day: number;
  /** Where the build's own day starts in the pool. */
  start: number;
}

/**
 * The candidates a page carries, and the build's own pick among them.
 *
 * The pool starts on the day before the build's (UTC) day, so a reader whose
 * calendar is still on the previous date finds their day in it too. Positions
 * are counted from 1970, not from the build, so two builds of the same
 * catalogue show the same entries on the same day.
 */
export function featured<T>(
  items: readonly T[],
  options: { count: number; id: (item: T) => string; group: (item: T) => string; now?: number },
): Featured<T> {
  const order = featuredOrder(items, options.id, options.group);
  const day = Math.floor((options.now ?? Date.now()) / DAY_MS) - 1;
  const size = Math.min(order.length, FEATURED_DAYS * options.count);
  const count = Math.min(options.count, size);
  const first = featuredStart(day, count, order.length);
  const pool = Array.from({ length: size }, (_, i) => order[(first + i) % order.length]!);
  return { pool, count, day, start: featuredStart(1, count, size) };
}

/**
 * The browser's half, inlined right after the featured list so it runs before
 * the list is painted.
 *
 * It reads the pool's first day, size and day count from the element marked
 * `data-featured`, works out the reader's own calendar day, and records the
 * resulting start there as `data-featured-start`. Where the section carries
 * its candidates as a `<template data-featured-pool>`, it replaces the cards
 * of `[data-featured-list]` with clones of the day's, so the markup is the
 * card component's own and exists in one place. Where it does not, the list
 * belongs to a component that renders it itself: the section is marked
 * `data-featured-pending` for that component to pick the start up.
 */
export const FEATURED_SCRIPT = `(function(){
var s=document.currentScript,f=s&&s.closest('[data-featured]');if(!f)return;
var size=+f.dataset.featuredSize,count=+f.dataset.featuredCount;if(!(size>0&&count>0))return;
var d=new Date(),today=Math.floor(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5);
var start=(((today-f.dataset.featuredDay)*count)%size+size)%size;
if(String(start)===f.dataset.featuredStart)return;
f.dataset.featuredStart=String(start);
var t=f.querySelector('template[data-featured-pool]'),l=f.querySelector('[data-featured-list]');
if(!t||!l){f.setAttribute('data-featured-pending','');return;}
var p=t.content.children,c=l.children;
for(var i=0;i<count&&i<c.length;i++)c[i].replaceWith(p[(start+i)%size].cloneNode(true));
})();`;

/** The data attributes the script reads, for the element marked `data-featured`. */
export function featuredAttributes(f: Featured<unknown>): Record<string, string | number | boolean> {
  return {
    'data-featured': true,
    'data-featured-day': f.day,
    'data-featured-size': f.pool.length,
    'data-featured-count': f.count,
    'data-featured-start': f.start,
  };
}
