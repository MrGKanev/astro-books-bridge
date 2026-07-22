# astro-book-bridge

Astro integration for a local, source-agnostic book catalog. It can import a
Goodreads RSS shelf, fetch edition metadata from Open Library and Google Books,
and merge all of it with notes, reviews and curation stored in the Astro
project.

## Installation

```bash
pnpm add astro-book-bridge
```

Register the integration in `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import bookBridge from 'astro-book-bridge';

export default defineConfig({
  integrations: [
    bookBridge({
      rssUrl: 'https://www.goodreads.com/review/list_rss/USER_ID?shelf=read',
      openLibrary: true,
      googleBooks: { apiKey: process.env.GOOGLE_BOOKS_API_KEY },
      overrides: 'src/content/book-overrides.json',
      markdownOverrides: 'src/content/book-overrides',
      cache: '.astro/book-bridge',
      covers: { mode: 'local', directory: 'public/book-covers' },
      output: 'src/generated/books.json', // optional
    }),
  ],
});
```

## Use in an Astro page

```astro
---
import { books, catalog } from 'astro-book-bridge:catalog';
---

<h1>Books ({books.length})</h1>
{catalog.source.usedCache && <p>Showing the last cached RSS feed.</p>}
<ul>
  {books.map((book) => <li><a href={book.link}>{book.title}</a> — {book.author}</li>)}
</ul>
```

The integration injects the TypeScript declaration for the virtual module into
Astro automatically. Each book exposes its primary `source` and all merged
`sources`, e.g. `['goodreads-rss', 'open-library']`.

## Sources

`rssUrl` is optional. With it, Goodreads continues to provide reading state
(rating, date read and shelf), while the other providers fill richer edition
metadata where ISBNs match.

```js
bookBridge({
  rssUrl: 'https://www.goodreads.com/review/list_rss/USER_ID?shelf=read',
  openLibrary: true,
  googleBooks: true,
});
```

For a catalog with no Goodreads dependency, supply ISBNs directly to either
provider. `enrich: false` prevents the provider from also looking up ISBNs
already returned by another source.

```js
bookBridge({
  openLibrary: {
    isbns: ['9780140328721', '9780441478125'],
    enrich: false,
  },
  googleBooks: {
    isbns: ['9780140328721'],
    enrich: false,
    apiKey: process.env.GOOGLE_BOOKS_API_KEY,
  },
});
```

Open Library is queried through its ISBN Books API. Google Books is queried by
ISBN; an API key is optional in the integration configuration and lets a site
use its own Google quota/credentials. Provider order is Goodreads → Open
Library → Google Books, so later sources only fill missing remote fields.

## Local overrides

Create `src/content/book-overrides.json`. A book matches Goodreads ID first,
then ISBN13, then ISBN. This rule works no matter which provider supplied the
book. Local fields only replace remote fields when they are present.

```json
{
  "books": [
    {
      "goodreadsId": "18423",
      "slug": "the-left-hand-of-darkness",
      "note": "A reread that gets better every time.",
      "review": "My full review in Markdown or plain text.",
      "recommended": true,
      "featured": true,
      "tags": ["science-fiction", "classics"]
    },
    {
      "isbn13": "9780441478125",
      "note": "This also matches when Goodreads ID is absent."
    }
  ]
}
```

Duplicate Goodreads IDs, ISBNs or ISBN13 values are rejected with a build
error. ISBN punctuation is ignored when matching, and supplied ISBNs must pass
their ISBN-10/ISBN-13 checksum.

### Markdown and MDX reviews

For a longer review, add one `.md` or `.mdx` file per book under
`src/content/book-overrides/`. The YAML frontmatter identifies the book and the
body becomes `review` automatically.

```md
---
isbn13: "9780441478125"
featured: true
tags: [science-fiction, classics]
---

# A returning favorite

My long-form review goes here in Markdown.
```

JSON and Markdown overrides are merged together. Duplicated identity keys are
still reported as a build error, which prevents two reviews from silently
targeting the same book.

## Operational behaviour

- Configured providers are fetched when the virtual module is built or loaded.
- The last successful RSS, Open Library and Google Books responses are cached
  independently under `.astro/book-bridge/` by default. A changed ISBN list
  gets a fresh provider cache entry.
- When a provider is temporarily unavailable, its matching cache is used by
  default with a warning. Set `staleIfError: false` to fail instead.
- A failed metadata enrichment never discards data already returned by another
  configured source.
- Set `conflicts: 'error'` to stop the build when two providers return
  different titles for the same Goodreads ID/ISBN. The default is a warning
  that keeps the first configured source.
- Editing the JSON overrides file triggers a full reload in development.
- Set `cache: false` to disable all provider caches; `timeoutMs` defaults to
  `10000`. A legacy `cache: '.astro/feed.json'` path continues to work.

### Cover policy and attribution

Remote cover URLs are retained by default. Set `covers.mode` to `local` to
download provider covers into a directory below `public/`, which makes the
catalog more reliable and avoids depending on a remote image at page load.
Every book retains `coverSourceUrl` and `coverAttribution` for a visible credit
or link in your template.

```js
bookBridge({
  openLibrary: { isbns: ['9780140328721'] },
  covers: {
    mode: 'local',
    directory: 'public/book-covers',
    fallbackUrl: '/book-cover-fallback.svg',
  },
});
```

See [PLAN.md](./PLAN.md) for the delivery plan and next milestones.

## Copy-ready design demo

`examples/demo` is a small Astro app in this repository, built as a collection
of sections rather than a full site. It deliberately includes no navigation,
header or site layout, so users can drop the components into their own design
system.

```bash
pnpm install
pnpm dev:demo
```

The three copy-ready directions are all driven by the same `books` array from
the virtual module:

- `BookSections.astro` / `/` — bright, annotation-led **Margin Notes**.
- `EditorialSections.astro` / `/editorial` — calm, long-form reading journal.
- `DarkShelfSections.astro` / `/dark-shelf` — dark visual shelf with selected
  book detail.

All three use semantic headings, lists and cover alt text, provide compact
mobile layouts, and avoid site-level chrome.

Use `pnpm check:demo` for Astro diagnostics and `pnpm build:demo` to build all
three pages as a static Astro site.

## Quality and releases

The repository uses pnpm and includes CI for type checks, unit tests, package
build, Astro diagnostics, demo build and `pnpm pack --dry-run`. Add a release
note with `pnpm changeset`; the release workflow then creates a version PR and,
after it merges, publishes with the repository's `NPM_TOKEN` secret.
