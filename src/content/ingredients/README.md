# Ingredients

One JSON file per ingredient, named for its slug. Never split by form: a form
is a record inside the file, and it is where every composition figure lives —
strength, density, sugar, acid, nutrition, allergens, animal origin.

An optional `{slug}.mdx` beside it adds narrative. Not required for the page to
exist, and sourced on the same terms as a drink's About where it does.

`node scripts/data/usda.ts form <fdcId>` emits a Form block ready to paste.
For proprietary products USDA has nothing — use `scripts/data/off.ts`, and
prefer the producer's own published figures over both.
