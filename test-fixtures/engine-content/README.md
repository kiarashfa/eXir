# Engine fixtures

Deliberately constructed content that exercises the maths engine end to end:
portions that must sum, a transcluded Component, the same Component referenced
twice at different multipliers, a Preparation used as an ingredient, a rinse
with a partial consumption fraction, a zero-proof drink, a brewed drink, a
fermented drink, and both service modes.

These are tracked, not scratch. They are what proves the engine still behaves
after a change: `npm run check:fixtures` asserts they stay clean, and
`src/lib/content/engine.test.ts` runs the whole pipeline over them.

Every drink here carries `draft: true`, and that is deliberate rather than
incidental. They are invented drinks, so writing a sourced history for one would
mean inventing sources — the exact failure the About rules exist to prevent. The
About checks are proved instead in `scripts/integrity/checks.test.ts`, against a
synthetic site, in both directions.
