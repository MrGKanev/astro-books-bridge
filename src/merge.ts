import type { Book, BookOverride, GoodreadsBook } from './schema.js';

function normalized(value: string | undefined): string | undefined {
  return value?.replace(/[^0-9Xx]/g, '').toUpperCase() || undefined;
}

function key(value: string | undefined): string | undefined {
  return normalized(value);
}

function uniqueIndex(overrides: BookOverride[], field: 'goodreadsId' | 'isbn' | 'isbn13') {
  const index = new Map<string, BookOverride>();
  for (const override of overrides) {
    const value = field === 'goodreadsId' ? override[field] : key(override[field]);
    if (!value) continue;
    if (index.has(value)) {
      throw new Error(`Duplicate ${field} override key: ${value}.`);
    }
    index.set(value, override);
  }
  return index;
}

/** Goodreads ID always wins; ISBN13 and ISBN are used only as fallbacks. */
export function mergeBooks(remoteBooks: GoodreadsBook[], overrides: BookOverride[]): Book[] {
  const byGoodreadsId = uniqueIndex(overrides, 'goodreadsId');
  const byIsbn13 = uniqueIndex(overrides, 'isbn13');
  const byIsbn = uniqueIndex(overrides, 'isbn');

  return remoteBooks.map((remote) => {
    const override =
      (remote.goodreadsId ? byGoodreadsId.get(remote.goodreadsId) : undefined) ??
      (key(remote.isbn13) ? byIsbn13.get(key(remote.isbn13)!) : undefined) ??
      (key(remote.isbn) ? byIsbn.get(key(remote.isbn)!) : undefined);

    const { goodreadsId: _goodreadsId, isbn: _isbn, isbn13: _isbn13, ...local } = override ?? {};
    return { ...remote, ...local, source: 'goodreads-rss' };
  });
}
