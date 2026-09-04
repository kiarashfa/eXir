/**
 * The content integrity checks.
 *
 * Each one is numbered against the specification's own list so a failure can be
 * traced back to the rule that motivated it. Errors fail the build; warnings
 * surface for review.
 *
 * The checks deliberately do very little arithmetic of their own. The engine
 * already returns an `issues[]` from every stage that can find a problem —
 * composition, timing, transclusion, loading — and a check that recomputed any
 * of it would be a second implementation able to disagree with the first.
 */

import { z } from 'astro/zod';

import { allBarsInOneQuartile } from '../../src/lib/math/balance.ts';
import { dilutionClass, dilutionClassIds } from '../../src/lib/math/dilution.ts';
import { glassFit } from '../../src/lib/math/glassware.ts';
import { aboutWordCount } from '../../src/lib/render/about.ts';
import { literalDigitsInProse } from '../../src/lib/render/prose.ts';
import { extractQtyRefs, portionsSum } from '../../src/lib/transclusion/merge.ts';
import type { ResolvedSite, ResolvedVersion } from '../../src/lib/content/resolve.ts';
import * as S from '../../src/schemas/content.ts';
import type { Report } from './report.ts';

export interface CheckContext {
  site: ResolvedSite;
  report: Report;
}

export interface Check {
  /** `c<n>` matches the numbered rule in the specification. */
  id: string;
  description: string;
  run(ctx: CheckContext): void;
}

const where = (v: ResolvedVersion): string => `${v.slug}/${v.version.id}`;

/** Every ref a version's prose can resolve against: line ids and portion ids. */
function refTargets(v: ResolvedVersion): Set<string> {
  const ids = new Set<string>();
  for (const { line } of v.lines) {
    ids.add(line.id);
    for (const p of line.portions ?? []) ids.add(p.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Schema validation — the gate everything else assumes has passed
// ---------------------------------------------------------------------------

const schemaCheck: Check = {
  id: 'c0-schema',
  description: 'Every record validates against its schema.',
  run({ site, report }) {
    const pairs: Array<[string, z.ZodType, { file: string; data: unknown }[]]> = [
      ['ingredient', S.ingredient, site.content.raw.ingredients],
      ['preparation', S.preparation, site.content.raw.preparations],
      ['glassware', S.glassware, site.content.raw.glassware],
      ['component', S.component, site.content.raw.components],
      ['drink version', S.drinkVersion, site.content.raw.drinks],
      ['about', S.about, site.content.raw.abouts],
      ['family', S.family, site.content.raw.families],
    ];

    for (const [label, schema, records] of pairs) {
      for (const { file, data } of records) {
        const result = schema.safeParse(data);
        if (result.success) continue;
        for (const issue of result.error.issues) {
          const at = issue.path.length ? ` at ${issue.path.join('.')}` : '';
          report.error('c0-schema', file, `${label}${at}: ${issue.message}`);
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// 1–13: structure and references
// ---------------------------------------------------------------------------

const portionsSumCheck: Check = {
  id: 'c1-portions-sum',
  description: 'A line with portions has portions that sum to it.',
  run({ site, report }) {
    for (const v of site.versions) {
      for (const { line } of v.lines) {
        const sum = portionsSum(line);
        if (sum === null) continue;
        if (Math.abs(sum - line.amount) > 1e-6) {
          report.error(
            'c1-portions-sum',
            `${where(v)} · ${line.id}`,
            `Portions sum to ${sum} but the line is ${line.amount}.`,
          );
        }
      }
    }
  },
};

const qtyRefsResolve: Check = {
  id: 'c2-qty-refs',
  description: 'Every <Qty ref> resolves to a line or portion in its own version.',
  run({ site, report }) {
    for (const v of site.versions) {
      const targets = refTargets(v);
      for (const step of v.version.steps) {
        for (const ref of extractQtyRefs(step.prose)) {
          if (!targets.has(ref)) {
            report.error(
              'c2-qty-refs',
              `${where(v)} · ${step.id}`,
              `<Qty ref="${ref}"> resolves to nothing in this version.`,
            );
          }
        }
      }
    }
  },
};

const transclusionRefs: Check = {
  id: 'c3-transclusion-refs',
  description: 'Every componentRef resolves, and a Preparation is never transcluded.',
  run({ site, report }) {
    for (const issue of site.issues) {
      if (issue.kind !== 'unresolved-component') continue;
      report.error('c3-transclusion-refs', issue.where, issue.message);
    }
    // A Preparation is an ingredient with a recipe, never inlined steps.
    for (const [id, ingredient] of site.ingredients) {
      if (ingredient.kind === 'preparation' && site.content.components.has(id)) {
        report.error(
          'c3-transclusion-refs',
          id,
          'Exists as both a Preparation and a Component. A Preparation is referenced as an ingredient and never transcluded.',
        );
      }
    }
  },
};

const ingredientAndFormRefs: Check = {
  id: 'c4-ingredient-form-refs',
  description: 'Every ingredientRef and formRef resolves.',
  run({ site, report }) {
    for (const issue of site.issues) {
      if (issue.kind !== 'unresolved-ingredient' && issue.kind !== 'unresolved-form') continue;
      report.error('c4-ingredient-form-refs', issue.where, issue.message);
    }

    // A Preparation's own lines never pass through a drink's resolution, because
    // a Preparation is referenced as an ingredient and its steps are never
    // walked. Everything in its recipe is therefore unchecked unless it is
    // checked here, and a syrup pointing at an ingredient that does not exist
    // looks from every other angle like a syrup that works.
    for (const [id, ingredient] of site.ingredients) {
      if (ingredient.kind !== 'preparation') continue;
      for (const line of ingredient.ingredients ?? []) {
        const target = site.ingredients.get(line.ingredientRef);
        if (!target) {
          report.error(
            'c4-ingredient-form-refs',
            `preparations/${id}.mdx`,
            `Line "${line.id}" names an ingredient that does not exist: "${line.ingredientRef}".`,
          );
          continue;
        }
        const wanted = line.formRef ?? 'standard';
        if (!target.forms.some((f) => f.id === wanted)) {
          report.error(
            'c4-ingredient-form-refs',
            `preparations/${id}.mdx`,
            `Line "${line.id}" wants Form "${wanted}" of "${line.ingredientRef}", which has no such Form.`,
          );
        }
      }
    }
  },
};

const durRefsAndStepIds: Check = {
  id: 'c5-dur-refs',
  description: 'Every <Dur step> resolves, and every step carries an id.',
  run({ site, report }) {
    for (const v of site.versions) {
      const stepIds = new Set(v.version.steps.map((s) => s.id));
      for (const step of v.version.steps) {
        if (!step.id) {
          report.error('c5-dur-refs', where(v), 'A step has no id.');
        }
        for (const m of step.prose.matchAll(/<Dur\b[^>]*?\bstep\s*=\s*"([^"]*)"/g)) {
          if (!stepIds.has(m[1] ?? '')) {
            report.error(
              'c5-dur-refs',
              `${where(v)} · ${step.id}`,
              `<Dur step="${m[1]}"> resolves to no step in this version.`,
            );
          }
        }
      }
    }
  },
};

/**
 * The rule the whole project rests on.
 *
 * Checked against RENDERED prose rather than the source, because that is what a
 * reader sees: a digit inside a live-value span is the engine's own output and
 * a digit outside one is a number somebody typed, which can drift from the data
 * beside it. An allowlist is per-occurrence on purpose — weakening the pattern
 * would quietly exempt everything that happens to look similar.
 */
const ALLOWED_LITERALS = new Set<string>([]);

const literalNumbers: Check = {
  id: 'c6-literal-numbers',
  description: 'No literal number in step prose outside a live-value component.',
  run({ site, report }) {
    for (const v of site.versions) {
      // Notes render through the same prose path as steps and sit on the same
      // page, so the rule reaches them too. A note is otherwise the easiest
      // place on a drink page for a typed "about 30 ml" to survive.
      const surfaces: Array<{ id: string; html: string }> = [
        ...v.renderedSteps.map(({ step, html }) => ({ id: step.id, html })),
        ...v.notes.map((n, i) => ({ id: `note ${i + 1} (${n.kind})`, html: n.html })),
      ];
      for (const { id, html } of surfaces) {
        for (const digits of literalDigitsInProse(html)) {
          if (ALLOWED_LITERALS.has(`${where(v)}·${id}·${digits}`)) continue;
          report.error(
            'c6-literal-numbers',
            `${where(v)} · ${id}`,
            `"${digits}" is typed into the prose. Wrap it in <Qty>, <Temp>, <Len>, <Dur> or <Abv>.`,
          );
        }
      }
    }
  },
};

const namingRefs: Check = {
  id: 'c7-naming',
  description: 'Confusables carry a note, and every slugRef and formRef resolves.',
  run({ site, report }) {
    const drinkSlugs = new Set(site.drinks.map((d) => d.slug));

    const checkNames = (
      names: unknown,
      at: string,
      formIds: Set<string> | null,
    ): void => {
      const parsed = S.names.safeParse(names);
      if (!parsed.success) {
        // Shape problems, including a missing note, are the schema's to report.
        return;
      }
      for (const entry of parsed.data.notToBeConfusedWith ?? []) {
        if (entry.slugRef && !drinkSlugs.has(entry.slugRef)) {
          report.error(
            'c7-naming',
            at,
            `notToBeConfusedWith "${entry.name}" points at "${entry.slugRef}", which is not a drink.`,
          );
        }
      }
      for (const entry of parsed.data.alsoKnownAs ?? []) {
        if (entry.formRef && formIds && !formIds.has(entry.formRef)) {
          report.error(
            'c7-naming',
            at,
            `alsoKnownAs "${entry.name}" names Form "${entry.formRef}", which does not exist here.`,
          );
        }
      }
    };

    for (const v of site.versions) {
      const fm = site.content.drinks.find((d) => d.file === v.file)?.frontmatter;
      if (fm?.['names']) checkNames(fm['names'], where(v), null);
    }
    for (const [id, ingredient] of site.ingredients) {
      const withNames = ingredient as unknown as { names?: unknown };
      if (withNames.names) {
        checkNames(withNames.names, id, new Set(ingredient.forms.map((f) => f.id)));
      }
    }
  },
};

const idCollisions: Check = {
  id: 'c8-id-collisions',
  description: 'Transclusion produces no colliding ids.',
  run({ site, report }) {
    for (const issue of site.issues) {
      if (issue.kind !== 'id-collision' && issue.kind !== 'authored-id-contains-separator') continue;
      report.error('c8-id-collisions', issue.where, issue.message);
    }
    for (const v of site.versions) {
      const seen = new Set<string>();
      for (const id of refTargets(v)) {
        if (seen.has(id)) {
          report.error('c8-id-collisions', where(v), `Two lines or portions share the id "${id}".`);
        }
        seen.add(id);
      }
    }
  },
};

const consumedFractionRange: Check = {
  id: 'c9-consumed-fraction',
  description: 'Every consumedFraction sits in 0 <= x <= 1, and a zero says why.',
  run({ site, report }) {
    for (const v of site.versions) {
      for (const { line } of v.lines) {
        const f = line.consumedFraction;
        if (f === undefined) continue;
        if (!(f >= 0 && f <= 1)) {
          report.error(
            'c9-consumed-fraction',
            `${where(v)} · ${line.id}`,
            `consumedFraction is ${f}; it must be between 0 and 1.`,
          );
        }
        // Zero claims the line is a purchase rather than an input. Unstated,
        // that reads to a check as a line quietly deleted from the composition.
        if (f === 0 && !line.consumedFractionNote) {
          report.error(
            'c9-consumed-fraction',
            `${where(v)} · ${line.id}`,
            'consumedFraction is 0 with no note. A line that reaches the glass not at all has to say so.',
          );
        }
      }
    }
  },
};

const abvNeedsDensity: Check = {
  id: 'c10-abv-density',
  description: 'An alcoholic Form authored in grams carries a density.',
  run({ site, report }) {
    for (const v of site.versions) {
      for (const issue of v.spec.composition.issues) {
        if (issue.kind !== 'abv-without-density') continue;
        report.error('c10-abv-density', `${where(v)} · ${issue.lineId}`, issue.message);
      }
    }
  },
};

const glasswareFit: Check = {
  id: 'c11-glassware-fit',
  description: 'The drink fits the glass it names, ice included.',
  run({ site, report }) {
    for (const v of site.versions) {
      const glass = v.glass;
      if (!glass) continue;

      const fit = glassFit(v.version, v.spec, glass);

      if (fit.unmodelledIce) {
        report.error(
          'c11-glassware-fit',
          where(v),
          `Served over "${fit.iceStyle}" ice but ${glass.name} declares no displacement for it, so the fit cannot be checked.`,
        );
        continue;
      }

      if (!fit.fits) {
        report.error(
          'c11-glassware-fit',
          where(v),
          `Needs ${fit.neededMl.toFixed(0)} ml (${fit.liquidMl.toFixed(0)} ml of liquid plus ${fit.iceMl} ml of ${fit.iceStyle} ice) but ${glass.name} holds ${glass.capacityMl} ml.`,
        );
      }
    }
  },
};

const glasswareResolves: Check = {
  id: 'c12-glassware-ref',
  description: 'Every glasswareRef resolves.',
  run({ site, report }) {
    for (const issue of site.issues) {
      if (issue.kind !== 'unresolved-glassware') continue;
      report.error('c12-glassware-ref', issue.where, issue.message);
    }
  },
};

const preparationCompleteness: Check = {
  id: 'c13-preparation',
  description: 'A Preparation used as an ingredient has a yield and a shelf life.',
  run({ site, report }) {
    const used = new Set<string>();
    for (const v of site.versions) for (const l of v.lines) used.add(l.line.ingredientRef);

    for (const id of used) {
      const ingredient = site.ingredients.get(id);
      if (!ingredient || ingredient.kind !== 'preparation') continue;
      if (ingredient.yieldMl === undefined) {
        report.error(
          'c13-preparation',
          id,
          'Used as an ingredient with no yield. "You need 20 ml" is misleading when the honest answer is "you are making 400 ml".',
        );
      }
      if (!ingredient.shelfLife) {
        report.error(
          'c13-preparation',
          id,
          'Used as an ingredient with no shelf life. A syrup with no stated shelf life is a food-safety gap.',
        );
      }
    }
  },
};

// ---------------------------------------------------------------------------
// 14–18: sourcing, dilution, images, families
// ---------------------------------------------------------------------------

const CITE = /<Cite\b[^>]*?\bref\s*=\s*"([^"]*)"/g;

const aboutRequired: Check = {
  id: 'c14-about',
  description: 'Every non-draft drink has an About section with at least one source.',
  run({ site, report }) {
    for (const drink of site.drinks) {
      // A draft is work in progress and is not published; requiring sourced
      // history before the recipe is finished would only produce placeholder
      // sources, which is the exact failure this rule exists to prevent.
      if (drink.versions.every((v) => v.draft)) continue;

      if (!drink.about) {
        report.error('c14-about', drink.slug, 'No about.mdx.');
        continue;
      }
      const parsed = S.about.safeParse(drink.about.frontmatter);
      if (!parsed.success) {
        report.error('c14-about', drink.about.file, 'About frontmatter does not validate.');
      }
    }
  },
};

const citeRefs: Check = {
  id: 'c15-cite-refs',
  description: 'Every <Cite ref> resolves to a declared source.',
  run({ site, report }) {
    for (const drink of site.drinks) {
      if (!drink.about) continue;
      const parsed = S.about.safeParse(drink.about.frontmatter);
      if (!parsed.success) continue;

      const declared = new Set(parsed.data.sources.map((s) => s.id));
      for (const m of drink.about.body.matchAll(CITE)) {
        if (!declared.has(m[1] ?? '')) {
          report.error(
            'c15-cite-refs',
            drink.about.file,
            `<Cite ref="${m[1]}"> names no declared source.`,
          );
        }
      }
    }
  },
};

const dilutionModelRefs: Check = {
  id: 'c16-dilution-model',
  description: 'Every dilution reference resolves, and every model entry has a source.',
  run({ site, report }) {
    for (const id of dilutionClassIds()) {
      const cls = dilutionClass(id);
      if (!cls?.source?.title) {
        report.error(
          'c16-dilution-model',
          `dilution-classes.json · ${id}`,
          'The model entry declares no source.',
        );
      }
    }
    for (const v of site.versions) {
      if (v.spec.dilution.unresolved) {
        report.error(
          'c16-dilution-model',
          where(v),
          `dilutionClass "${v.version.dilutionClass}" is not in dilution-classes.json.`,
        );
      }
    }
  },
};

const familyRefs: Check = {
  id: 'c18-families',
  description: 'Every family reference resolves and descent stays inside its family.',
  run({ site, report }) {
    const familyOf = new Map<string, string>();
    for (const v of site.versions) {
      const fam = v.frontmatter['family'];
      if (typeof fam === 'string') familyOf.set(v.slug, fam);
    }

    for (const v of site.versions) {
      const fam = v.frontmatter['family'];
      const from = v.frontmatter['derivedFrom'];

      if (typeof fam === 'string' && !site.families.has(fam)) {
        report.error('c18-families', where(v), `family "${fam}" is not a family page.`);
      }
      if (typeof from === 'string') {
        if (!familyOf.has(from)) {
          report.error('c18-families', where(v), `derivedFrom "${from}" is not a drink on the site.`);
        } else if (familyOf.get(from) !== fam) {
          // Descent is recorded within a family. A chain that leaves one is a
          // resemblance, and resemblance is an ordinary cross-link.
          report.error(
            'c18-families',
            where(v),
            `derivedFrom "${from}" is in family "${familyOf.get(from)}", not "${String(fam)}".`,
          );
        }
      }
    }
  },
};

// ---------------------------------------------------------------------------
// 19–27: warnings
// ---------------------------------------------------------------------------

const unusedLines: Check = {
  id: 'c19-unused-lines',
  description: 'Every line or portion is named somewhere in the prose.',
  run({ site, report }) {
    for (const v of site.versions) {
      const referenced = new Set(v.version.steps.flatMap((s) => extractQtyRefs(s.prose)));
      for (const { line } of v.lines) {
        // Garnishes and rinses commonly qualify, and are exempted by saying so
        // in the data rather than by weakening the check.
        if (line.garnish || line.computed) continue;
        const own = [line.id, ...(line.portions ?? []).map((p) => p.id)];
        if (!own.some((id) => referenced.has(id))) {
          report.warn(
            'c19-unused-lines',
            `${where(v)} · ${line.id}`,
            'Never referenced by a <Qty> in the method.',
          );
        }
      }
    }
  },
};

/** Categories where part of the ingredient is routinely thrown away. */
const PARTIAL_USE_CATEGORIES = new Set(['absinthe', 'brine', 'water-ice']);

const partialUseUndeclared: Check = {
  id: 'c20-partial-use',
  description: 'A likely partial-use ingredient declares how much is consumed.',
  run({ site, report }) {
    for (const v of site.versions) {
      for (const { line, ingredient } of v.lines) {
        if (line.consumedFraction !== undefined) continue;
        if (!ingredient.category || !PARTIAL_USE_CATEGORIES.has(ingredient.category)) continue;
        report.warn(
          'c20-partial-use',
          `${where(v)} · ${line.id}`,
          `"${ingredient.name}" is usually only partly consumed but declares no consumedFraction.`,
        );
      }
    }
  },
};

const timingConsistency: Check = {
  id: 'c21-timing',
  description: 'The timing card equals the sum of its steps.',
  run({ site, report }) {
    for (const v of site.versions) {
      for (const issue of v.timing.issues) {
        report.warn('c21-timing', `${where(v)} · ${issue.stepId}`, issue.message);
      }
      const declared = v.timing.prepSec + v.timing.makeSec + v.timing.restSec;
      if (Math.abs(declared - v.timing.totalSec) > 1e-6) {
        report.warn(
          'c21-timing',
          where(v),
          `Phases sum to ${declared}s but the total reads ${v.timing.totalSec}s.`,
        );
      }
    }
  },
};

const versionTabRule: Check = {
  id: 'c22-tab-rule',
  description: 'Multiple versions plausibly satisfy the tab rule.',
  run({ site, report }) {
    for (const drink of site.drinks) {
      if (drink.versions.length < 2) continue;

      const labels = drink.versions.map((v) => v.version.label);
      if (new Set(labels).size !== labels.length) {
        report.warn(
          'c22-tab-rule',
          drink.slug,
          'Two versions share a label, so the tab strip cannot distinguish them.',
        );
      }
      if (!drink.versions.some((v) => v.isDefault)) {
        report.warn(
          'c22-tab-rule',
          drink.slug,
          'No index.mdx, so nothing declares which version is the default.',
        );
      }

      // The mechanical half of the rule: versions must share a core identity.
      // Judgement is editorial, so this surfaces rather than fails.
      const core = drink.versions.map(
        (v) => new Set(v.lines.filter((l) => !l.line.garnish).map((l) => l.line.ingredientRef)),
      );
      const first = core[0];
      if (!first) continue;
      for (let i = 1; i < core.length; i++) {
        const other = core[i]!;
        const shared = [...first].filter((id) => other.has(id)).length;
        const union = new Set([...first, ...other]).size;
        if (union > 0 && shared / union < 0.5) {
          report.warn(
            'c22-tab-rule',
            `${drink.slug} · ${drink.versions[i]?.version.id}`,
            'Shares less than half its ingredients with the default version; this may be a separate drink rather than a tab.',
          );
        }
      }
    }
  },
};

const uncitedSources: Check = {
  id: 'c23-uncited-sources',
  description: 'Every declared source is cited somewhere.',
  run({ site, report }) {
    for (const drink of site.drinks) {
      if (!drink.about) continue;
      const parsed = S.about.safeParse(drink.about.frontmatter);
      if (!parsed.success) continue;

      const cited = new Set([...drink.about.body.matchAll(CITE)].map((m) => m[1]));
      for (const source of parsed.data.sources) {
        if (!cited.has(source.id)) {
          report.warn(
            'c23-uncited-sources',
            drink.about.file,
            `Source "${source.id}" is declared but never cited.`,
          );
        }
      }
    }
  },
};

const aboutLength: Check = {
  id: 'c24-about-length',
  description: 'An About section runs between 150 and 500 words.',
  run({ site, report }) {
    for (const drink of site.drinks) {
      if (!drink.about) continue;
      const words = aboutWordCount(drink.about.body);
      if (words < 150 || words > 500) {
        report.warn(
          'c24-about-length',
          drink.about.file,
          `About runs to ${words} words; the range is 150 to 500. The cap stops an agent padding to look thorough.`,
        );
      }
    }
  },
};

const uncitedClaims: Check = {
  id: 'c25-uncited-claims',
  description: 'A paragraph with a date, a century or a percentage carries a citation.',
  run({ site, report }) {
    for (const drink of site.drinks) {
      if (!drink.about) continue;
      for (const para of drink.about.body.split(/\n\s*\n/)) {
        const text = para.trim();
        if (!text) continue;
        const checkable = /\b(1[5-9]\d{2}|20\d{2})\b|\b\d{1,2}(?:st|nd|rd|th) century\b|\d+(?:\.\d+)?%/.exec(
          text,
        );
        if (!checkable) continue;
        if (!/<Cite\b/.test(para)) {
          report.warn(
            'c25-uncited-claims',
            drink.about.file,
            `A paragraph states "${checkable[0]}" with no <Cite>. Cocktail history is the most mythologised body of food writing there is.`,
          );
        }
      }
    }
  },
};

const compositionSanity: Check = {
  id: 'c26-composition-sanity',
  description: 'Computed strength sits inside plausible bounds.',
  run({ site, report }) {
    for (const v of site.versions) {
      for (const warning of v.spec.warnings) {
        if (!/bound/.test(warning)) continue;
        report.warn('c26-composition-sanity', where(v), warning);
      }
    }
  },
};

const balanceSanity: Check = {
  id: 'c27-balance-sanity',
  description: 'The four balance bars are not all in one quartile.',
  run({ site, report }) {
    for (const v of site.versions) {
      const quartile = allBarsInOneQuartile(v.spec.bars);
      if (!quartile) continue;
      report.warn(
        'c27-balance-sanity',
        where(v),
        `All four balance bars sit in the ${quartile} quartile, which usually means a missing sugar or acid figure on an ingredient rather than a genuinely unbalanced drink.`,
      );
    }
  },
};

/**
 * A drink computed vegan or vegetarian whose Forms never said so.
 *
 * Not in the numbered list, but the acceptance checklist names it and the
 * failure mode is invisible: isinglass, gelatine, carmine, honey and egg white
 * are all absent from an ingredient's name.
 */
const undeclaredAnimalOrigin: Check = {
  id: 'c28-animal-origin',
  description: 'Every Form states an animal origin, so a diet label can be earned.',
  run({ site, report }) {
    for (const v of site.versions) {
      for (const lineId of v.spec.facets.diet.undeclaredAnimalOrigin) {
        report.warn(
          'c28-animal-origin',
          `${where(v)} · ${lineId}`,
          'The Form declares no animalOrigin, so no vegan or vegetarian label can be computed for this drink.',
        );
      }
    }
  },
};

/**
 * Notes and substitutions point at things, and a pointer that misses is silent.
 *
 * A note attached to a step that no longer exists renders detached from what it
 * explains. A substitution is worse: it names an Ingredient because the site
 * swaps in that ingredient's real strength and sugar and recomputes the spec in
 * front of the reader, so a substitute that resolves to nothing is a recompute
 * that cannot happen — and the failure appears only when someone clicks it.
 */
const noteAndSubstitutionRefs: Check = {
  id: 'c29-note-sub-refs',
  description: 'Every note, substitution and brew reference resolves.',
  run({ site, report }) {
    // An ingredient-level substitute is a browsing aid rather than something the
    // engine recomputes, so naming one the site does not carry yet is allowed —
    // the page names it instead of linking it. It still warns, because the gap
    // is worth seeing and because it is how a typo hides.
    for (const [id, ingredient] of site.ingredients) {
      const subs = (ingredient as { generalSubstitutes?: Array<{ substitute: string }> })
        .generalSubstitutes;
      for (const sub of subs ?? []) {
        if (site.ingredients.has(sub.substitute)) continue;
        report.warn(
          'c29-note-sub-refs',
          id,
          `generalSubstitutes names "${sub.substitute}", which has no record. It will be named on the page rather than linked.`,
        );
      }
    }

    for (const issue of site.issues) {
      if (issue.kind !== 'unresolved-brew-ref') continue;
      report.error('c29-note-sub-refs', issue.where, issue.message);
    }

    for (const v of site.versions) {
      const stepIds = new Set(v.version.steps.map((s) => s.id));
      const lineIds = new Set(v.lines.map((l) => l.line.id));

      for (const note of v.notes) {
        if (note.stepRef && !stepIds.has(note.stepRef)) {
          report.error(
            'c29-note-sub-refs',
            where(v),
            `A ${note.kind} note names step "${note.stepRef}", which is not a step in this version.`,
          );
        }
      }

      for (const sub of v.substitutions) {
        if (!lineIds.has(sub.lineRef)) {
          report.error(
            'c29-note-sub-refs',
            where(v),
            `A substitution names line "${sub.lineRef}", which is not a line in this version.`,
          );
        }
        const ingredient = site.ingredients.get(sub.substitute);
        if (!ingredient) {
          report.error(
            'c29-note-sub-refs',
            where(v),
            `Substitute "${sub.substitute}" is not an ingredient on the site, so its composition is unknown and the spec cannot be recomputed.`,
          );
          continue;
        }
        const wanted = sub.formRef ?? 'standard';
        if (!ingredient.forms.some((f) => f.id === wanted)) {
          report.error(
            'c29-note-sub-refs',
            where(v),
            `Substitute "${sub.substitute}" has no Form "${wanted}".`,
          );
        }
      }
    }
  },
};

/**
 * A Preparation referencing another is normal — an orgeat wants a syrup. Three
 * levels is almost always a modelling error, and the shopping list is where it
 * shows: expansion stops one level deep by default, so a reader chasing a third
 * level has to open two controls before the list is complete, and the yields
 * multiply against each other on the way down.
 *
 * A LOOP is an error rather than a warning. A preparation made out of itself
 * has no batch count, so the shopping list has nothing to compute.
 */
const preparationNesting: Check = {
  id: 'c30-preparation-nesting',
  description: 'Preparations do not nest three deep and never reference themselves.',
  run({ site, report }) {
    const preparations = [...site.ingredients.values()].filter((i) => i.kind === 'preparation');
    // One loop, one report. Every preparation upstream of a cycle walks into it,
    // so without this the same loop is named once per path that reaches it.
    const reported = new Set<string>();

    /** Depth measured in preparations, so a syrup inside a syrup is two. */
    const depthOf = (id: string, seen: string[]): number => {
      const ingredient = site.ingredients.get(id);
      if (!ingredient || ingredient.kind !== 'preparation') return 0;

      if (seen.includes(id)) {
        const cycle = seen.slice(seen.indexOf(id));
        const key = [...cycle].sort().join('|');
        if (!reported.has(key)) {
          reported.add(key);
          report.error(
            'c30-preparation-nesting',
            id,
            `Preparations reference each other in a loop: ${[...cycle, id].join(' -> ')}. A preparation made out of itself has no batch count, so a shopping list cannot expand it.`,
          );
        }
        return 0;
      }

      let deepest = 0;
      for (const line of ingredient.ingredients ?? []) {
        deepest = Math.max(deepest, depthOf(line.ingredientRef, [...seen, id]));
      }
      return deepest + 1;
    };

    for (const preparation of preparations) {
      const depth = depthOf(preparation.id, []);
      if (depth >= 3) {
        report.warn(
          'c30-preparation-nesting',
          preparation.id,
          `Its own recipe nests preparations ${depth} deep. The shopping list expands one level by default, so anything past two is a modelling error far more often than it is a real recipe.`,
        );
      }
    }
  },
};

export const checks: Check[] = [
  schemaCheck,
  portionsSumCheck,
  qtyRefsResolve,
  transclusionRefs,
  ingredientAndFormRefs,
  durRefsAndStepIds,
  literalNumbers,
  namingRefs,
  idCollisions,
  consumedFractionRange,
  abvNeedsDensity,
  glasswareFit,
  glasswareResolves,
  preparationCompleteness,
  aboutRequired,
  citeRefs,
  dilutionModelRefs,
  familyRefs,
  unusedLines,
  partialUseUndeclared,
  timingConsistency,
  versionTabRule,
  uncitedSources,
  aboutLength,
  uncitedClaims,
  compositionSanity,
  balanceSanity,
  undeclaredAnimalOrigin,
  noteAndSubstitutionRefs,
  preparationNesting,
];
