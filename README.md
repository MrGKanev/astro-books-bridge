# astro-goodreads-bridge

Astro integration for building a local book catalog from a Goodreads RSS feed.
Goodreads remains a read-only source; notes, reviews and curation belong in the
Astro project.

## Installation

```bash
npm install astro-goodreads-bridge
```

Register the integration in `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import goodreadsBridge from 'astro-goodreads-bridge';

export default defineConfig({
  integrations: [
    goodreadsBridge({
      rssUrl: 'https://www.goodreads.com/review/list_rss/USER_ID?shelf=read',
      overrides: 'src/content/book-overrides.json',
      output: 'src/generated/books.json', // optional
    }),
  ],
});
```

## Use in an Astro page

```astro
---
import { books, catalog } from 'astro-goodreads-bridge:catalog';
---

<h1>Books ({books.length})</h1>
{catalog.source.usedCache && <p>Showing the last cached Goodreads feed.</p>}
<ul>
  {books.map((book) => <li><a href={book.link}>{book.title}</a> — {book.author}</li>)}
</ul>
```

The integration injects the TypeScript declaration for the virtual module into
Astro automatically.

## Local overrides

Create `src/content/book-overrides.json`. A book matches Goodreads ID first,
then ISBN13, then ISBN. Local fields only replace RSS fields when they are
present.

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

- The RSS feed is fetched when the virtual module is built or loaded.
- The last successful response is cached under `.astro/goodreads-bridge/`.
- If Goodreads is temporarily unavailable, that cache is used by default with a
  warning. Set `staleIfError: false` to fail instead.
- Editing the overrides JSON triggers a full reload in development.
- Set `cache: false` to disable local RSS caching; `timeoutMs` defaults to
  `10000`.

See [PLAN.md](./PLAN.md) for the delivery plan and next milestones.
