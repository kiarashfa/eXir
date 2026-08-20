# Broken fixtures

Content that violates each integrity check on purpose, one violation per
fixture. `npm run check:self` asserts the checks still catch every one of them.

The reason this exists: a check that has quietly stopped matching produces the
same output as a clean content set. Without a fixture that must fail, nothing
would ever tell you the difference.
