import type { GoodreadsBook } from './schema.js';
import { normalizeIsbn } from './identifiers.js';

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : undefined;
}

function objectList(value: unknown): Record<string, unknown>[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : undefined;
}

export async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`returned HTTP ${response.status}.`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchOpenLibraryBooks(isbns: string[], timeoutMs: number): Promise<GoodreadsBook[]> {
  const identifiers = [...new Set(isbns.map(normalizeIsbn).filter(Boolean))];
  if (identifiers.length === 0) return [];
  const url = new URL('https://openlibrary.org/api/books');
  url.searchParams.set('bibkeys', identifiers.map((value) => `ISBN:${value}`).join(','));
  url.searchParams.set('format', 'json');
  url.searchParams.set('jscmd', 'data');
  const response = await fetchJson(url.toString(), timeoutMs) as Record<string, unknown>;

  return Object.values(response).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const data = entry as Record<string, unknown>;
    const title = text(data.title);
    if (!title) return [];
    const identifiers = data.identifiers as Record<string, unknown> | undefined;
    const cover = data.cover as Record<string, unknown> | undefined;
    return [{
      source: 'open-library' as const,
      title,
      author: objectList(data.authors)?.map((author) => text(author.name)).filter(Boolean).join(', ') || undefined,
      isbn: stringList(identifiers?.isbn_10)?.[0],
      isbn13: stringList(identifiers?.isbn_13)?.[0],
      link: text(data.url),
      imageUrl: text(cover?.large) ?? text(cover?.medium) ?? text(cover?.small),
      coverSourceUrl: text(cover?.large) ?? text(cover?.medium) ?? text(cover?.small),
      coverProvider: text(cover?.large) ?? text(cover?.medium) ?? text(cover?.small) ? 'open-library' : undefined,
      description: text(data.description),
      publisher: objectList(data.publishers)?.map((publisher) => text(publisher.name)).filter(Boolean).join(', ') || undefined,
      publishedDate: text(data.publish_date),
      pageCount: typeof data.number_of_pages === 'number' ? data.number_of_pages : undefined,
      subjects: objectList(data.subjects)?.map((subject) => text(subject.name)).filter((subject): subject is string => Boolean(subject)),
      previewLink: objectList(data.ebooks)?.map((ebook) => text(ebook.preview_url)).find(Boolean),
    }];
  });
}

export async function fetchGoogleBooks(isbns: string[], timeoutMs: number, apiKey?: string): Promise<GoodreadsBook[]> {
  const books = await Promise.all([...new Set(isbns.map(normalizeIsbn).filter(Boolean))].map(async (value) => {
    const url = new URL('https://www.googleapis.com/books/v1/volumes');
    url.searchParams.set('q', `isbn:${value}`);
    if (apiKey) url.searchParams.set('key', apiKey);
    const response = await fetchJson(url.toString(), timeoutMs) as { items?: unknown[] };
    const volume = response.items?.[0] as { id?: unknown; volumeInfo?: Record<string, unknown>; accessInfo?: Record<string, unknown> } | undefined;
    const info = volume?.volumeInfo;
    const title = text(info?.title);
    if (!title) return undefined;
    const industryIdentifiers = Array.isArray(info?.industryIdentifiers) ? info?.industryIdentifiers as Array<Record<string, unknown>> : [];
    const cover = info?.imageLinks as Record<string, unknown> | undefined;
    return {
      source: 'google-books' as const,
      title,
      author: stringList(info?.authors)?.join(', '),
      isbn: text(industryIdentifiers.find((id) => id.type === 'ISBN_10')?.identifier),
      isbn13: text(industryIdentifiers.find((id) => id.type === 'ISBN_13')?.identifier),
      link: text(info?.infoLink),
      previewLink: text(info?.previewLink),
      imageUrl: text(cover?.thumbnail)?.replace(/^http:/, 'https:'),
      coverSourceUrl: text(cover?.thumbnail)?.replace(/^http:/, 'https:'),
      coverProvider: text(cover?.thumbnail) ? 'google-books' : undefined,
      description: text(info?.description),
      averageRating: typeof info?.averageRating === 'number' ? info.averageRating : undefined,
      publisher: text(info?.publisher),
      publishedDate: text(info?.publishedDate),
      pageCount: typeof info?.pageCount === 'number' ? info.pageCount : undefined,
      subjects: stringList(info?.categories),
      language: text(info?.language),
    } satisfies GoodreadsBook;
  }));
  return books.filter((book): book is NonNullable<typeof book> => Boolean(book));
}
