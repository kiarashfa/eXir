/**
 * What the site actually computes, printed without a build.
 *
 *   node scripts/authoring/figures.ts               # every drink
 *   node scripts/authoring/figures.ts negroni       # one, in full
 *   node scripts/authoring/figures.ts negroni daiquiri
 *
 * The acceptance checklist asks an author to read the computed ABV and sugar
 * back and ask whether they describe the drink they know — a Daiquiri at 8%
 * means a wrong dilution class or a wrong bottle strength, every time, and so
 * does a julep at 30%.
 *
 * That instruction was unactionable until this existed. The integrity runner
 * reports issues rather than figures, and the only place the figures appeared
 * was `catalog-index.json`, which is written by a full build an author is asked
 * not to run. So authors hand-estimated the arithmetic instead and reported the
 * estimate — which checks the author's mental model against itself and the
 * engine against nothing, and is exactly the check that was supposed to happen.
 *
 * Same loader and same engine as the build, so a figure here is the figure the
 * page will render.
 */

import { loadContent } from '../../src/lib/content/disk.ts';
import { resolveSite } from '../../src/lib/content/resolve.ts';

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const num = (v: number, places = 1): string => v.toFixed(places);

/** The band a figure is expected to sit in, and a mark where it does not. */
function flag(label: string, value: number, low: number, high: number): string {
  if (value < low) return `  ← ${label} is low; check the dilution class and the bottle strengths`;
  if (value > high) return `  ← ${label} is high; check the dilution class and the bottle strengths`;
  return '';
}

async function main(): Promise<void> {
  const wanted = new Set(process.argv.slice(2).filter((a) => !a.startsWith('--')));
  // `resolveSite` is synchronous; only the disk load is not.
  const resolved = resolveSite(await loadContent('src/content'));

  const drinks = [...resolved.drinks].filter((d) => !wanted.size || wanted.has(d.slug));
  if (!drinks.length) {
    console.log('\nNo drink by that slug. Run with no arguments to see them all.\n');
    return;
  }

  const detailed = wanted.size > 0;

  if (!detailed) {
    console.log(
      `\n${pad('drink', 22)}${pad('version', 12)}${pad('ABV', 8)}${pad('sugar g/L', 11)}` +
        `${pad('kcal', 7)}${pad('vol ml', 8)}strength`,
    );
    console.log('-'.repeat(78));
  }

  for (const drink of drinks) {
    for (const v of drink.versions) {
      const s = v.spec;
      const abv = s.alcohol.finalAbvPercent;
      const sugar = s.sugarGPerL;

      if (!detailed) {
        console.log(
          pad(drink.slug, 22) +
            pad(v.version.id, 12) +
            pad(num(abv) + '%', 8) +
            pad(Math.round(sugar), 11) +
            pad(Math.round(s.nutrition.kcal), 7) +
            pad(Math.round(s.finalVolumeMl), 8) +
            s.facets.strength +
            // Bands wide enough that a correct drink never trips them and a
            // wrong dilution class always does. A spirit-forward stirred drink
            // sits near 30% and a long one near 10; outside 5–40 something in
            // the data is wrong rather than unusual.
            //
            // A zero-proof drink is exempt rather than clamped: it is meant to
            // read 0%, and a warning that fires on every coffee and every
            // mocktail is one an author learns to scroll past, which costs more
            // than the warning is worth.
            (s.facets.strength === 'zero-proof' ? '' : flag('ABV', abv, 5, 40)),
        );
        continue;
      }

      console.log(`\n${drink.name} — ${v.version.label} (${v.version.id})`);
      console.log(`  method            ${v.version.method} · ${v.version.dilutionClass}`);
      console.log(`  poured            ${num(s.composition.pouredVolumeMl, 0)} ml`);
      console.log(
        `  dilution          ${num(s.dilution.fraction * 100, 0)}% of the poured volume` +
          ` = ${num(s.dilution.dilutionMl, 0)} ml`,
      );
      console.log(
        `  final volume      ${num(s.finalVolumeMl, 0)} ml` +
          (s.facets.strength === 'zero-proof' ? '' : flag('ABV', abv, 5, 40)),
      );
      console.log(`  ABV               ${num(abv)}%  (${s.facets.strength})`);
      console.log(`  pure alcohol      ${num(s.alcohol.pureAlcoholG)} g`);
      console.log(
        `  standard drinks   ${s.alcohol.standardDrinks
          .map((d) => `${num(d.drinks)} ${d.label}`)
          .join(' · ')}`,
      );
      console.log(`  sugar             ${num(s.composition.sugarG)} g · ${Math.round(sugar)} g/L`);
      console.log(`  acid              ${num(s.acidPercentFinal, 2)}% of final volume`);
      console.log(`  energy            ${Math.round(s.nutrition.kcal)} kcal`);
      console.log(`  base spirit       ${s.facets.baseSpirits.map((b) => b.spirit).join(' · ') || '—'}`);
      console.log(`  diet              ${s.facets.diet.diets.join(' · ') || '—'}`);
      console.log(`  allergens         ${s.facets.diet.allergens.join(' · ') || '—'}`);
      console.log(
        '  bars              ' + s.bars.map((b) => `${b.label} ${b.display}`).join(' · '),
      );
    }
  }

  console.log(
    '\nRead these back against the drink you know. A figure that looks wrong and is\n' +
      'right is worth knowing; one that looks right and is wrong is what this exists\n' +
      'to catch. Report either way.\n',
  );
}

await main();
