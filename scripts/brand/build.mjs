/**
 * Brand assets: the link-preview card, the GitHub social preview and the app
 * icons, all drawn from this site's own mark, palette and typefaces.
 *
 *   npm run brand             write every asset
 *   npm run brand -- --check  exit 1 if a committed asset differs from what
 *                             the current config would produce
 *
 * This file is the LAYOUT and is identical across the sibling sites (Xefy,
 * eXir, Markey, ARMAG), so their cards read as one family. Everything that
 * belongs to one site (name, tagline, colours, fonts, the mark) lives in
 * `brand.config.mjs` beside it. Change a site by editing its config; change the
 * family by editing this file and copying it to the other three.
 *
 * The pipeline is satori (layout, and text converted to outlines, so the output
 * never depends on what fonts the machine happens to have) followed by resvg
 * (rasterisation). Both are deterministic, which is what makes `--check`
 * meaningful: the same config always produces byte-identical PNGs.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import config from './brand.config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const at = (p) => resolve(root, p);
const check = process.argv.includes('--check');

// The four sites, in the order every card lists them. The current one is
// drawn in its accent; the others are there so a preview says whose it is.
const FAMILY = ['Xefy', 'eXir', 'Markey', 'ARMAG'];

/* ── fonts ───────────────────────────────────────────────────────────────── */

const fonts = [];
for (const role of ['display', 'body']) {
  const { family, files } = config.fonts[role];
  for (const f of files) {
    fonts.push({ name: family, data: readFileSync(at(f.path)), weight: f.weight, style: f.style ?? 'normal' });
  }
}

/* ── the mark, rasterised once per theme ────────────────────────────────── */

function markPng(theme, size) {
  const svg = config.mark(readFileSync(at('public/favicon.svg'), 'utf8'), theme);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } })
    .render()
    .asPng();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/* ── a tiny element helper, so the layout reads as a tree ────────────────── */

const h = (type, style, ...children) => ({
  type,
  props: { style: { display: 'flex', ...style }, children: children.flat().filter((c) => c !== null) },
});
const img = (src, size, style = {}) => ({
  type: 'img',
  props: { src, width: size, height: size, style: { width: size, height: size, ...style } },
});

/* ── the card ────────────────────────────────────────────────────────────── */

/**
 * One composition, laid out for a given canvas. The GitHub preview is not a
 * rescale of the link card: it is the same layout recomposed at 2:1 with a
 * wider padding, because GitHub crops unpredictably and wants everything
 * inside a 40pt safe margin.
 */
function card({ width, height, pad, scale }) {
  const c = config.colors;
  const s = (n) => Math.round(n * scale);
  const d = config.fonts.display;
  const markSize = s(config.card?.markSize ?? 104);

  const wordmark = h(
    'div',
    { alignItems: 'baseline', fontFamily: d.family, fontSize: s(config.card?.wordmarkSize ?? 112), lineHeight: 1, letterSpacing: s(d.tracking ?? -2), color: c.ink },
    config.wordmark.map((seg) =>
      h('span', {
        fontWeight: seg.weight ?? d.weight,
        fontStyle: seg.italic ? 'italic' : 'normal',
        color: seg.color ?? c.ink,
      }, seg.text),
    ),
  );

  const family = h(
    'div',
    { alignItems: 'center', gap: s(14), fontFamily: config.fonts.body.family, fontSize: s(24), color: c.muted },
    FAMILY.map((name, i) => [
      i > 0 ? h('span', { opacity: 0.6 }, '·') : null,
      h('span', name === config.name ? { color: c.accent, fontWeight: 600 } : {}, name),
    ]),
  );

  return h(
    'div',
    { width, height, flexDirection: 'column', backgroundColor: c.background, position: 'relative' },
    // A band of the accent along the top edge. It is the one element allowed to
    // bleed, which is how a crop still reads as this site's card.
    h('div', { position: 'absolute', top: 0, left: 0, width, height: s(12), backgroundColor: c.accent }),
    h(
      'div',
      { flexDirection: 'column', justifyContent: 'space-between', width, height, padding: pad },
      h(
        'div',
        { flexDirection: 'column', gap: s(40) },
        h('div', { alignItems: 'center', gap: s(32) }, img(markPng(config.cardTheme, markSize * 2), markSize), wordmark),
        h(
          'div',
          { fontFamily: config.fonts.body.family, fontSize: s(44), lineHeight: 1.3, color: c.inkSoft, maxWidth: s(960) },
          config.tagline,
        ),
      ),
      h(
        'div',
        { alignItems: 'center', justifyContent: 'space-between', paddingTop: s(24), borderTop: `${s(2)}px solid ${c.line}` },
        h('div', { fontFamily: config.fonts.body.family, fontSize: s(24), color: c.muted }, config.url),
        family,
      ),
    ),
  );
}

async function renderCard(canvas) {
  const svg = await satori(card(canvas), { width: canvas.width, height: canvas.height, fonts });
  return new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render();
}

/* ── icons: the mark on the site's ground, with a padding per platform ───── */

async function icon(size, padding) {
  const inner = Math.round(size * (1 - 2 * padding));
  const tree = h(
    'div',
    { width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: config.colors.iconBackground ?? config.colors.background },
    img(markPng(config.iconTheme ?? config.cardTheme, inner * 2), inner),
  );
  const svg = await satori(tree, { width: size, height: size, fonts });
  return new Resvg(svg, { fitTo: { mode: 'original' }, font: { loadSystemFonts: false } }).render().asPng();
}

/* ── the safe-margin measurement ─────────────────────────────────────────── */

/**
 * The ink bounds of a rendered card, ignoring the full-bleed accent band:
 * the smallest distance from any non-background pixel to each edge. Measured
 * on the pixels rather than trusted from the layout, because a glyph's ink can
 * overhang its box.
 */
function inkMargins(rendered, bandHeight) {
  const { width, height, pixels } = rendered;
  const bg = [pixels[(height - 1) * width * 4], pixels[(height - 1) * width * 4 + 1], pixels[(height - 1) * width * 4 + 2]];
  let top = height, left = width, right = -1, bottom = -1;
  for (let y = bandHeight + 1; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (Math.abs(pixels[i] - bg[0]) + Math.abs(pixels[i + 1] - bg[1]) + Math.abs(pixels[i + 2] - bg[2]) > 24) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  return { top, left, right: width - 1 - right, bottom: height - 1 - bottom };
}

/* ── run ─────────────────────────────────────────────────────────────────── */

const og = await renderCard({ width: 1200, height: 630, pad: 72, scale: 1 });
const github = await renderCard({ width: 1280, height: 640, pad: 88, scale: 0.94 });

const outputs = {
  'public/og.png': og.asPng(),
  '.github/og-github.png': github.asPng(),
  'public/apple-touch-icon.png': await icon(180, 0.1),
  'public/icon-192.png': await icon(192, 0.06),
  'public/icon-512.png': await icon(512, 0.06),
};

const margins = inkMargins(github, Math.round(12 * 0.94));
const SAFE = 54; // 40pt at 96 dpi
const safe = Object.values(margins).every((m) => m >= SAFE);

let stale = 0;
for (const [path, png] of Object.entries(outputs)) {
  if (check) {
    let current = null;
    try {
      current = readFileSync(at(path));
    } catch {}
    if (!current || !current.equals(png)) {
      stale++;
      console.log(`stale   ${path}`);
    } else console.log(`ok      ${path}`);
  } else {
    mkdirSync(dirname(at(path)), { recursive: true });
    writeFileSync(at(path), png);
    console.log(`wrote   ${path}  (${(png.length / 1024).toFixed(0)} kB)`);
  }
}

console.log(
  `github preview ink margins: top ${margins.top} · right ${margins.right} · bottom ${margins.bottom} · left ${margins.left} px, ${safe ? 'inside' : 'OUTSIDE'} the ${SAFE}px safe margin`,
);
if (!safe || stale) process.exit(1);
