# Drinks

One folder per drink, named for its slug.

```
drinks/{slug}/
  index.mdx        the default version — what the title, description,
                   structured data and catalogue row all derive from
  {versionId}.mdx  further versions, one file each
  about.mdx        sourced reference prose, per DRINK rather than per version
```

Structured data lives in frontmatter; step prose lives in the body inside
`<Step id="…">` blocks and is joined to the frontmatter by id, enforced in both
directions. Every quantity in that prose is a `<Qty ref="…"/>` pointing at a
line or portion in the same version — a literal digit fails the build.

A version is a tab only when it shares the drink's name and core identity and
differs in technique, ratio, or one adaptation. Anything else is its own drink,
bound by family rather than by a tab.
