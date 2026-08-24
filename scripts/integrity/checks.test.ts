/**
 * Unit coverage for the checks whose PASSING path the fixtures cannot exercise.
 *
 * The engine fixtures are drafts, deliberately: they are invented drinks, and
 * writing a sourced history for one would mean inventing sources, which is the
 * exact failure the About rules exist to prevent. So the About family is proved
 * here instead, against a synthetic site — both directions, because a check
 * that fires on everything is as broken as one that fires on nothing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checks } from './checks.ts';
import { Report } from './report.ts';
import type { ResolvedSite } from '../../src/lib/content/resolve.ts';

const GOOD_ABOUT_BODY = `
The drink is first recorded in a bar guide of the period <Cite ref="guide"/>, in a
form close to the one served today. What changed since is the proportion rather
than the ingredients, and the shift tracks the arrival of a drier style of the
base spirit rather than any deliberate reformulation of the drink itself.

The origin story usually attached to it is disputed <Cite ref="history"/>. The
standard account names a single bartender and a single evening, and the earliest
printed source for that account postdates the drink by several decades. A rival
claim exists and rests on equally thin documentation. What can be said is that
the drink was in circulation before either account places its invention, which
is the more interesting fact in any case and the one that is actually supported.

Its neighbours are close enough that the names are used loosely in practice. The
distinction that matters is structural rather than historical: the family shares
a shape, and this member fixes one slot of that shape in a way the others leave
open. Readers arriving from a similar name are usually looking for that
difference rather than for the lineage, and it is worth stating plainly before
any of the history is.

Later variations mostly move a single component. None of them displaced the
original, which stayed on menus continuously through the period when most drinks
of its generation did not, and that continuity is why it reads as canonical now
rather than as a revival.
`.trim();

function siteWith(about: {
  frontmatter: Record<string, unknown>;
  body: string;
} | null): ResolvedSite {
  return {
    drinks: [
      {
        slug: 'example',
        name: 'Example',
        versions: [
          {
            slug: 'example',
            file: 'drinks/example/index.mdx',
            version: { id: 'classic', label: 'Classic', defaultDrinks: 1 },
            lines: [],
            draft: false,
            isDefault: true,
          },
        ],
        about: about ? { slug: 'example', file: 'drinks/example/about.mdx', ...about } : null,
      },
    ],
    versions: [],
    ingredients: new Map(),
    glassware: new Map(),
    families: new Map(),
    content: {
      raw: {
        ingredients: [],
        preparations: [],
        glassware: [],
        components: [],
        drinks: [],
        abouts: about ? [{ file: 'drinks/example/about.mdx', data: about.frontmatter }] : [],
        families: [],
      },
      drinks: [],
      components: new Map(),
    },
    issues: [],
  } as unknown as ResolvedSite;
}

function runAboutChecks(site: ResolvedSite): Report {
  const report = new Report();
  const ids = new Set([
    'c14-about',
    'c15-cite-refs',
    'c23-uncited-sources',
    'c24-about-length',
    'c25-uncited-claims',
  ]);
  for (const check of checks) {
    if (!ids.has(check.id)) continue;
    report.ran(check.id);
    check.run({ site, report });
  }
  return report;
}

const goodFrontmatter = {
  summary: 'A short teaser, used as the meta description.',
  sources: [
    { id: 'guide', title: 'A Bar Guide', publisher: 'A Publisher', year: 1930 },
    { id: 'history', title: 'A Drinks History', publisher: 'Another Publisher', year: 2005 },
  ],
};

test('a well-sourced About produces nothing at all', () => {
  const report = runAboutChecks(siteWith({ frontmatter: goodFrontmatter, body: GOOD_ABOUT_BODY }));

  assert.deepEqual(report.findings, []);
  // And the checks genuinely ran, rather than skipping quietly.
  assert.equal(report.checkCount, 5);
});

test('a non-draft drink with no About is an error', () => {
  const report = runAboutChecks(siteWith(null));

  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0]?.check, 'c14-about');
});

test('a citation naming no declared source is an error', () => {
  const report = runAboutChecks(
    siteWith({
      frontmatter: goodFrontmatter,
      body: GOOD_ABOUT_BODY.replace('<Cite ref="guide"/>', '<Cite ref="ghost"/>'),
    }),
  );

  assert.equal(report.errors.some((f) => f.check === 'c15-cite-refs'), true);
});

test('a declared source nobody cites warns', () => {
  const report = runAboutChecks(
    siteWith({
      frontmatter: {
        ...goodFrontmatter,
        sources: [...goodFrontmatter.sources, { id: 'spare', title: 'T', publisher: 'P' }],
      },
      body: GOOD_ABOUT_BODY,
    }),
  );

  const warning = report.warnings.find((f) => f.check === 'c23-uncited-sources');
  assert.match(warning?.message ?? '', /spare/);
});

test('an About outside the word range warns in both directions', () => {
  const short = runAboutChecks(
    siteWith({ frontmatter: goodFrontmatter, body: 'Too short <Cite ref="guide"/> <Cite ref="history"/>.' }),
  );
  assert.match(
    short.warnings.find((f) => f.check === 'c24-about-length')?.message ?? '',
    /150 to 500/,
  );

  const long = runAboutChecks(
    siteWith({
      frontmatter: goodFrontmatter,
      body: `${GOOD_ABOUT_BODY} ${'padding '.repeat(400)}`,
    }),
  );
  assert.equal(
    long.warnings.some((f) => f.check === 'c24-about-length'),
    true,
  );
});

test('a checkable claim with no citation in its paragraph warns', () => {
  // Cocktail history is the most mythologised body of food writing there is,
  // and a date is exactly the kind of claim a model supplies most fluently.
  const report = runAboutChecks(
    siteWith({
      frontmatter: goodFrontmatter,
      body: `${GOOD_ABOUT_BODY}\n\nThe drink was invented in 1919 by a count.`,
    }),
  );

  const warning = report.warnings.find((f) => f.check === 'c25-uncited-claims');
  assert.match(warning?.message ?? '', /1919/);
});

test('a century and a percentage are treated as checkable too', () => {
  const century = runAboutChecks(
    siteWith({
      frontmatter: goodFrontmatter,
      body: `${GOOD_ABOUT_BODY}\n\nIt spread widely in the 19th century.`,
    }),
  );
  assert.equal(century.warnings.some((f) => f.check === 'c25-uncited-claims'), true);

  const percent = runAboutChecks(
    siteWith({
      frontmatter: goodFrontmatter,
      body: `${GOOD_ABOUT_BODY}\n\nRoughly 40% of bars carried it.`,
    }),
  );
  assert.equal(percent.warnings.some((f) => f.check === 'c25-uncited-claims'), true);
});

test('a cited claim in the same paragraph does not warn', () => {
  const report = runAboutChecks(
    siteWith({
      frontmatter: goodFrontmatter,
      body: `${GOOD_ABOUT_BODY}\n\nIt was printed in 1862 <Cite ref="guide"/>.`,
    }),
  );

  assert.equal(report.warnings.some((f) => f.check === 'c25-uncited-claims'), false);
});

test('every registered check has a distinct id and a description', () => {
  const ids = checks.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'check ids are unique');
  for (const check of checks) {
    assert.ok(check.description.length > 10, `${check.id} describes itself`);
  }
});
