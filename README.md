# astro-book-bridge

Astro integration for a local, source-agnostic book catalog. It can import a
Goodreads RSS shelf, fetch edition metadata from Open Library and Google Books,
and merge all of it with notes, reviews and curation stored in the Astro
project.

## Installation

```bash
npm install astro-book-bridge
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
error. ISBN punctuation is ignored when matching.

## Operational behaviour

- Configured providers are fetched when the virtual module is built or loaded.
- The last successful RSS response is cached under `.astro/goodreads-bridge/`.
- If the RSS source is temporarily unavailable, that cache is used by default
  with a warning. Set `staleIfError: false` to fail instead.
- A failed metadata enrichment emits a warning but does not discard results
  from the other configured sources.
- Editing the overrides JSON triggers a full reload in development.
- Set `cache: false` to disable local RSS caching; `timeoutMs` defaults to
  `10000`.

See [PLAN.md](./PLAN.md) for the delivery plan and next milestones.
