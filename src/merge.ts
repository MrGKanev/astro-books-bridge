import type { Book, BookOverride, BookSourceName, GoodreadsBook } from './schema.js';

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
    return { ...remote, ...local, source: remote.source ?? 'goodreads-rss', sources: remote.sources ?? [remote.source ?? 'goodreads-rss'] };
  });
}

function identifierKey(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/**
 * Coalesces books returned by multiple providers. Provider order determines
 * metadata priority: later providers only fill fields that are still missing.
 */
export function combineSourceBooks(sourceBooks: GoodreadsBook[]): GoodreadsBook[] {
  const books: GoodreadsBook[] = [];
  const byGoodreadsId = new Map<string, GoodreadsBook>();
  const byIsbn13 = new Map<string, GoodreadsBook>();
  const byIsbn = new Map<string, GoodreadsBook>();

  for (const incoming of sourceBooks) {
    const match =
      (identifierKey(incoming.goodreadsId) ? byGoodreadsId.get(identifierKey(incoming.goodreadsId)!) : undefined) ??
      (key(incoming.isbn13) ? byIsbn13.get(key(incoming.isbn13)!) : undefined) ??
      (key(incoming.isbn) ? byIsbn.get(key(incoming.isbn)!) : undefined);

    const book = match ?? { ...incoming, sources: [incoming.source ?? 'goodreads-rss'] };
    if (match) {
      for (const [field, value] of Object.entries(incoming)) {
        if (value !== undefined && book[field as keyof GoodreadsBook] === undefined) {
          (book as unknown as Record<string, unknown>)[field] = value;
        }
      }
      const source = incoming.source;
      if (source && !book.sources?.includes(source)) book.sources = [...(book.sources ?? []), source];
    } else {
      books.push(book);
    }

    if (book.goodreadsId) byGoodreadsId.set(book.goodreadsId, book);
    if (key(book.isbn13)) byIsbn13.set(key(book.isbn13)!, book);
    if (key(book.isbn)) byIsbn.set(key(book.isbn)!, book);
  }

  return books;
}
