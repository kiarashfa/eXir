#!/usr/bin/env node
/**
 * `npm run check:layout`: renders every built page in a real browser at three
 * widths and fails on layout that a screenshot pass keeps missing.
 *
 *   node scripts/integrity/layout.mjs [--widths 1440,1024,390] [--only drinks/] [--limit 50]
 *
 * It reads the base path from the built homepage (the first segment every
 * built link starts with) and serves `dist/` itself, so it needs a build but no preview server. It drives the Chrome that
 * is already installed (via `playwright-core`), and is a local gate rather than
 * a CI one.
 *
 * The four rules are about geometry, not pixels:
 *
 *  - **container**  every layout container as wide as the header's must share
 *                   the header's content box. A `padding` shorthand on an
 *                   element that also wears the page-width class wipes the
 *                   gutter, and the section sits off-centre against the header.
 *  - **spill**      an in-flow element's box extends past its parent's, and
 *                   nothing on the way up clips or scrolls it. A grid track
 *                   that cannot shrink below its content (`1fr` rather than
 *                   `minmax(0, 1fr)`), a `fieldset`, or an unbreakable string
 *                   pushes a column into its neighbour.
 *  - **overlap**    two in-flow children of one grid or flex container overlap.
 *  - **hscroll**    the page scrolls sideways.
 *  - **starved**    a paragraph of two or more lines stops more than a fifth of
 *                   the frame short of its right edge, with nothing but page
 *                   background beside it: text wrapping at half width. Checked
 *                   at 1024px and wider.
 *  - **contrast**   text against the background actually behind it, composited
 *                   through any translucent layers, is under WCAG AA (4.5:1,
 *                   or 3:1 for large text). Checked in the light and the dark
 *                   theme, at the widest width only. Text over a photograph or
 *                   a gradient is skipped: its background is not one colour.
 *
 * A finding names the element by tag and class path, the width, how many pages
 * share it and two example URLs: the same component breaking on forty pages is
 * one finding, and fixing its class fixes all of them.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { extname, join, normalize, relative } from 'node:path';

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error('check:layout needs playwright-core (npm install) and a local Chrome.');
  process.exit(2);
}

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const widths = opt('widths', '1440,1024,390').split(',').map(Number);
const only = opt('only', null);
const limit = Number(opt('limit', Infinity));
const DIST = 'dist';

// The base path is whatever the built homepage links its own stylesheet under.
const home = readFileSync(join(DIST, 'index.html'), 'utf8');
const base = (home.match(/href="(\/[^/"]+\/)_astro\//) ?? home.match(/href="(\/[^/"]+\/)/))?.[1] ?? '/';

const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
let pages = walk(DIST)
  .filter((f) => f.endsWith('index.html') || f.endsWith('404.html'))
  .map((f) => relative(DIST, f).replaceAll('\\', '/').replace(/index\.html$/, ''))
  .filter((p) => !p.startsWith('dev/') && !p.startsWith('pagefind/'))
  // Redirect stubs navigate away before they can be measured, and have no layout of their own.
  .filter((p) => !/http-equiv="refresh"/i.test(readFileSync(join(DIST, p.endsWith('.html') ? p : `${p}index.html`), 'utf8')));
if (only) pages = pages.filter((p) => p.includes(only));
pages = pages.slice(0, limit);

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!url.startsWith(base)) { res.writeHead(404); return res.end(); }
  let file = normalize(join(DIST, url.slice(base.length)));
  const s = await stat(file).catch(() => null);
  if (s?.isDirectory()) file = join(file, 'index.html');
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/html' });
    res.end(await readFile(join(DIST, '404.html')).catch(() => ''));
  }
});
await new Promise((r) => server.listen(0, r));
const origin = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const findings = new Map();
const add = (rule, sig, url, detail) => {
  const key = `${rule}|${sig}`;
  const f = findings.get(key) ?? { rule, sig, count: 0, urls: [], detail };
  f.count++;
  if (f.urls.length < 2) f.urls.push(url);
  findings.set(key, f);
};

function contrast() {
  // Colour strings as Chrome computes them: rgb(), color(srgb …), oklab(), oklch().
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const fromOklab = (L, a, b) => {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    const enc = (x) => { x = Math.min(1, Math.max(0, x)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };
    return [enc(r), enc(g), enc(bb)];
  };
  const parse = (str) => {
    const n = (str.match(/-?[\d.]+%?/g) ?? []).map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v)));
    const alpha = /\//.test(str) ? n[n.length - 1] : (str.startsWith('rgba') ? n[3] : 1);
    if (str.startsWith('rgb')) return [n[0] / 255, n[1] / 255, n[2] / 255, alpha ?? 1];
    if (str.startsWith('color(srgb')) return [n[0], n[1], n[2], alpha ?? 1];
    if (str.startsWith('oklab')) { const L = n[0] > 1 ? n[0] / 100 : n[0]; return [...fromOklab(L, n[1], n[2]), alpha ?? 1]; }
    if (str.startsWith('oklch')) { const L = n[0] > 1 ? n[0] / 100 : n[0]; const h = (n[2] * Math.PI) / 180; return [...fromOklab(L, n[1] * Math.cos(h), n[1] * Math.sin(h)), alpha ?? 1]; }
    return null;
  };
  const over = (top, bottom) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1); };
  const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const sig = (el) => `${el.tagName.toLowerCase()}${[...el.classList].filter((c) => !/^(astro-|svelte-|s-)/.test(c) && c.length < 32).slice(0, 3).map((c) => `.${c}`).join('')}`;
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest('script, style, noscript, [aria-hidden="true"], [hidden], [inert], svg')) continue;
    // A logotype is exempt from contrast (WCAG 1.4.3): the wordmark's coloured letter is branding.
    if (el.closest('.logo, .foot-brand, [class*="wordmark"], [class*="logo-"]')) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    const key = sig(el) + (el.parentElement ? ' < ' + sig(el.parentElement) : '');
    if (seen.has(key)) continue;
    seen.add(key);
    // The background: composite every translucent layer up to the first opaque one.
    const layers = [];
    let photo = false;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage !== 'none' && !/^(linear|radial)-gradient\(\s*(rgba?\(0, 0, 0, 0\)|transparent)/.test(s.backgroundImage)) { photo = true; break; }
      if (e.tagName === 'IMG' || e.tagName === 'VIDEO') { photo = true; break; }
      const c = parse(s.backgroundColor);
      if (c && c[3] > 0) { layers.push(c); if (c[3] >= 0.999) break; }
    }
    if (photo) continue;
    let bg = [1, 1, 1, 1];
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    let fg = parse(cs.color);
    if (!fg) continue;
    fg = over(fg, bg);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const got = ratio(fg, bg);
    if (got < need) out.push(['contrast', key, `${got.toFixed(2)}:1, needs ${need}:1 ("${node.textContent.trim().slice(0, 30)}")`]);
  }
  return out;
}

function inspect() {
  const out = [];
  const vw = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > vw + 1) out.push(['hscroll', 'document', `scrollWidth ${document.documentElement.scrollWidth} > ${vw}`]);
  const sig = (el) => {
    const cls = [...el.classList].filter((c) => !/^(astro-|svelte-|s-)/.test(c) && c.length < 32).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
  };
  const path = (el) => { const parts = []; for (let e = el, i = 0; e && i < 3 && e !== document.body; i++, e = e.parentElement) parts.unshift(sig(e)); return parts.join(' > '); };
  const cs = (el) => getComputedStyle(el);
  const inFlow = (el) => ['static', 'relative', 'sticky'].includes(cs(el).position);
  const clips = (el) => { const s = cs(el); return s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.contain.includes('paint'); };
  const shown = (el, r) => r.width > 0 && r.height > 0 && cs(el).visibility !== 'hidden';
  // Parked content (an inactive carousel slide, a closed disclosure) is not laid out for reading.
  const parked = (el) => !!el.closest('[inert], [aria-hidden="true"], [hidden]');

  const header = document.querySelector('body header, .masthead, .site-header');
  const box = header && [...header.querySelectorAll('*')].find((e) => cs(e).maxWidth !== 'none' && e.getBoundingClientRect().width > 200);
  if (box) {
    const r = box.getBoundingClientRect(), s = cs(box);
    const frameL = r.left + parseFloat(s.paddingLeft), frameR = r.right - parseFloat(s.paddingRight);
    for (const el of document.querySelectorAll('main *')) {
      const e = cs(el);
      if (e.maxWidth !== s.maxWidth || e.display === 'none' || parked(el)) continue;
      const er = el.getBoundingClientRect();
      if (!er.width) continue;
      const cl = er.left + parseFloat(e.paddingLeft), cr = er.right - parseFloat(e.paddingRight);
      if (Math.abs(cl - frameL) > 2 || Math.abs(cr - frameR) > 2) out.push(['container', path(el), `content box ${Math.round(cl)}..${Math.round(cr)}, header ${Math.round(frameL)}..${Math.round(frameR)}`]);
    }
  }

  // starved: prose wrapping short beside empty page
  if (box && innerWidth >= 1000) {
    const hr = box.getBoundingClientRect(), hs = cs(box);
    const L = hr.left + parseFloat(hs.paddingLeft), R = hr.right - parseFloat(hs.paddingRight), F = R - L;
    for (const el of document.querySelectorAll('main p, main li, main dd, main blockquote')) {
      if (parked(el)) continue;
      const r = el.getBoundingClientRect();
      const lh = parseFloat(cs(el).lineHeight) || 24;
      if (r.width < 120 || r.height < lh * 1.8 || (el.textContent ?? '').trim().length < 100) continue;
      if (cs(el).textAlign === 'center') continue;
      // Not prose in a sidebar that outlasts its neighbour, nor text inside a
      // menu or popover: only a column that could have been wider.
      if (el.closest('details:not([open]), [popover], [role="dialog"], [role="group"]')) continue;
      let inRail = false;
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const parent = a.parentElement;
        if (!parent) break;
        const pcs = cs(parent);
        const tracks = pcs.display.includes('grid') ? pcs.gridTemplateColumns.split(' ').filter(Boolean).length : 0;
        if (tracks >= 2 && a.getBoundingClientRect().width < F * 0.45) { inRail = true; break; }
        // Prose beside a designed rail (a side nav, an aside, a photograph) in the same grid.
        if (tracks >= 2 && [...parent.children].some((c) => c !== a && c.matches('aside, nav, figure, :has(> figure, > img)'))) { inRail = true; break; }
        if (pcs.position === 'absolute' || pcs.position === 'fixed') { inRail = true; break; }
      }
      if (inRail) continue;
      const gap = R - r.right;
      if (gap < F * 0.2) continue;
      el.scrollIntoView({ block: 'center' });
      const r2 = el.getBoundingClientRect();
      const y = r2.top + Math.min(r2.height / 2, 300);
      const empty = [0.25, 0.5, 0.8].every((f) => { const hit = document.elementFromPoint(r2.right + gap * f, y); return !hit || hit.contains(el); });
      if (empty) out.push(['starved', path(el), `${Math.round(r.width)}px of a ${Math.round(F)}px frame, ${Math.round(gap)}px empty beside it`]);
    }
    scrollTo(0, 0);
  }

  const main = document.querySelector('main') ?? document.body;
  const all = [...main.querySelectorAll('*')].filter((el) => !(el instanceof SVGElement) || el.tagName === 'svg');
  for (const el of all) {
    if (!inFlow(el) || parked(el)) continue;
    const r = el.getBoundingClientRect();
    if (!shown(el, r)) continue;
    let parent = el.parentElement;
    while (parent && cs(parent).display === 'contents') parent = parent.parentElement;
    if (!parent || parent === document.body) continue;
    let skip = false;
    for (let a = parent; a && a !== main.parentElement; a = a.parentElement) if (clips(a) || !inFlow(a)) { skip = true; break; }
    if (skip) continue;
    const pr = parent.getBoundingClientRect();
    if (r.right > pr.right + 2 && r.width < vw) out.push(['spill', path(el), `${Math.round(r.right - pr.right)}px past its parent (${Math.round(r.width)} in ${Math.round(pr.width)})`]);
  }
  for (const c of all) {
    if (!/grid|flex/.test(cs(c).display) || parked(c)) continue;
    const kids = [...c.children].filter((k) => inFlow(k) && cs(k).position !== 'sticky').map((k) => [k, k.getBoundingClientRect()]).filter(([k, r]) => shown(k, r));
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) {
      const [a, ra] = kids[i], [b, rb] = kids[j];
      const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (ox > 3 && oy > 3) out.push(['overlap', `${path(c)} :: ${sig(a)} x ${sig(b)}`, `${Math.round(ox)}x${Math.round(oy)}px`]);
    }
  }
  return out;
}

const runs = [
  ...widths.map((width) => ({ width, scheme: 'light', contrast: width === Math.max(...widths) })),
  { width: Math.max(...widths), scheme: 'dark', contrast: true, layout: false },
];
for (const { width, scheme, contrast: checkContrast, layout = true } of runs) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 600, hasTouch: width < 600, reducedMotion: 'reduce', colorScheme: scheme });
  const queue = [...pages];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const page = await context.newPage();
      const url = `${origin}${base}${p}`;
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(150);
        const results = [
          ...(layout ? await page.evaluate(inspect) : []),
          ...(checkContrast ? await page.evaluate(contrast) : []),
        ];
        const seen = new Set();
        for (const [rule, s, d] of results) {
          if (seen.has(rule + s)) continue;
          seen.add(rule + s);
          add(rule, `${s} @${width}${rule === 'contrast' ? ` ${scheme}` : ''}`, `${base}${p}`, d);
        }
      } catch (error) {
        add('error', error.message.slice(0, 80), `${base}${p}`, '');
      }
      await page.close();
    }
  }));
  await context.close();
}
await browser.close();
server.close();

const list = [...findings.values()].sort((a, b) => a.rule.localeCompare(b.rule) || b.count - a.count);
console.log(`[check:layout] ${pages.length} pages at ${widths.join(', ')}px: ${list.length} finding(s).`);
for (const f of list) console.log(`  [${f.rule}] ${f.sig}  on ${f.count} page(s): ${f.detail}\n      ${f.urls.join('  ')}`);
process.exit(list.length ? 1 : 0);
