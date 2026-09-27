/**
 * eXir's brand assets: what `build.mjs` draws. Everything site-specific lives
 * here; the layout it is poured into is shared with the sibling sites.
 *
 * Colours are the dark theme's tokens from `src/styles/global.css` (the site's
 * default), copied as hex because the card is rendered outside the browser.
 * Re-run `npm run brand` after changing any of them.
 */
const fontsource = (pkg, file) => `node_modules/@fontsource/${pkg}/files/${file}`;

export default {
  name: 'eXir',
  url: 'kiarashfa.github.io/eXir',
  tagline: 'A drinks encyclopedia where every measure, strength and dilution is computed, never typed.',

  // The header lockup: a didone italic with the X standing upright in brass.
  wordmark: [
    { text: 'e', italic: true, weight: 400 },
    { text: 'X', weight: 600, color: '#e9a63f' },
    { text: 'ir', italic: true, weight: 400 },
  ],

  cardTheme: 'dark',
  colors: {
    background: '#10141b',
    ink: '#eef1f6',
    inkSoft: '#b6c0ce',
    muted: '#8895a6',
    line: '#2a3342',
    accent: '#e9a63f',
  },

  fonts: {
    display: {
      family: 'Bodoni Moda',
      weight: 400,
      tracking: -1,
      files: [
        { path: fontsource('bodoni-moda', 'bodoni-moda-latin-400-italic.woff'), weight: 400, style: 'italic' },
        { path: fontsource('bodoni-moda', 'bodoni-moda-latin-600-normal.woff'), weight: 600 },
      ],
    },
    body: {
      family: 'Archivo',
      files: [
        { path: fontsource('archivo', 'archivo-latin-400-normal.woff'), weight: 400 },
        { path: fontsource('archivo', 'archivo-latin-600-normal.woff'), weight: 600 },
      ],
    },
  },

  // Plain colours and a mask; the cut-outs take the card's ground, as they
  // take the browser chrome's in a tab.
  mark: (svg) => svg,
};
