# astro-book-bridge

## 0.3.0

### Minor Changes

- 25e57d9: Add resilient multi-provider caching, validated ISBN identifiers, Markdown/MDX
  review overrides, local cover caching and copy-ready book catalog themes.
- Prune cached cover files that no longer belong to any book when `covers.mode`
  is `local`, so removing a book from the shelf (or a changed cover URL) no
  longer leaves a stale image behind in `public/`. Set `covers.prune` to
  `false` to keep the old behaviour.
