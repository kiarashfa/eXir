# Broken fixtures

Content that violates each integrity check on purpose. `npm run check:self`
runs the checks against this directory and asserts they still catch every one.

The reason this exists: a check that has quietly stopped matching produces the
same output as a clean content set. Without content that must fail, nothing
would ever tell you the difference.

`EXPECTED.json` lists every check that must fire. The self-test asserts that
exact set rather than merely asserting that the run failed — a run that fails
proves only that *one* check still works, and would hide the rest going silent.

Adding a check means adding content here that breaks it, and adding its id to
`EXPECTED.json`.

## What breaks what

| Fixture | What it violates |
| --- | --- |
| `ingredients/bad-shape.json` | schema: a non-slug id, an empty name, no Forms |
| `ingredients/lime-juice.json` | a confusable pointing at no drink; an alias naming no Form |
| `ingredients/mystery-liqueur.json` | alcoholic with no density, used in a gram-authored line |
| `ingredients/undeclared-wine.json` | a Form that never declares an animal origin |
| `preparations/no-yield-syrup.mdx` | a Preparation with no yield and no shelf life |
| `drinks/bad-refs/` | a `<Qty>` and a `<Dur>` resolving to nothing; a number typed into prose |
| `drinks/bad-structure/` | portions that do not sum; a fraction out of range; an id containing the reserved separator |
| `drinks/bad-links/` | unresolved component, ingredient, Form, glass and dilution model |
| `drinks/bad-fit/` | a drink too large for its glass, and no About while not a draft |
| `drinks/bad-naming/` | a family that does not exist, and descent leaving its family |
| `drinks/bad-sources/` | a citation naming nothing, a source nobody cites, an uncited date, an About far too short |
| `drinks/bad-composition/` | an alcoholic Form authored in grams with no density |
| `drinks/bad-steps/` | step metadata with no prose, and prose with no metadata |
| `drinks/bad-warnings/` | a partial-use ingredient with no fraction, a dangling parallel anchor, two versions sharing a label, an implausible strength |
