import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { parseGoodreadsRss } from './rss.js';
import { combineSourceBooks, mergeBooks } from './merge.js';
import { fetchGoogleBooks, fetchOpenLibraryBooks } from './providers.js';
import { bookOverridesSchema, type BookCatalog, type GoodreadsBook } from './schema.js';
import { assertValidIsbn } from './identifiers.js';
import { loadMarkdownOverrides } from './markdown.js';
import { applyCoverPolicy, type ResolvedCoverOptions } from './covers.js';

export interface MetadataSourceOptions {
  /** ISBNs to import even when no Goodreads feed is configured. */
  isbns?: string[];
  /** Enrich books already fetched from other sources. Defaults to true. */
  enrich?: boolean;
}

export interface GoogleBooksSourceOptions extends MetadataSourceOptions {
  /** Optional Google Books API key; useful for quota management. */
  apiKey?: string;
}

export interface CoverOptions {
  /** Keep provider URLs (default) or download reusable copies into public/. */
  mode?: 'remote' | 'local';
  /** Directory for local covers, relative to project root. Defaults to public/book-covers. */
  directory?: string;
  /** Image URL used when a provider has no cover or a download fails. */
  fallbackUrl?: string;
}

export interface BookBridgeOptions {
  /** Optional Goodreads shelf RSS URL, for example https://www.goodreads.com/review/list_rss/USER_ID?shelf=read */
  rssUrl?: string;
  /** Open Library metadata. `true` enriches ISBNs from the configured feed. */
  openLibrary?: boolean | MetadataSourceOptions;
  /** Google Books metadata. `true` enriches ISBNs from the configured feed. */
  googleBooks?: boolean | GoogleBooksSourceOptions;
  /** JSON overrides relative to the Astro project root. Missing file means no overrides. */
  overrides?: string;
  /** Optional directory of Markdown or MDX review overrides. */
  markdownOverrides?: string;
  /** Cache directory relative to the Astro project root. Set false to disable cache. */
  cache?: string | false;
  /** Remote or local cover behaviour. */
  covers?: CoverOptions;
  /** Optional JSON catalog written after a successful build, relative to project root. */
  output?: string;
  /** Request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Use the last successful RSS response after a fetch failure. Defaults to true. */
  staleIfError?: boolean;
  /** Warn (default) or stop the build when sources disagree on a title for the same ID. */
  conflicts?: 'warn' | 'error';
}

/** @deprecated Use BookBridgeOptions. */
export type GoodreadsBridgeOptions = BookBridgeOptions;

export interface ResolvedBookBridgeOptions {
  rssUrl?: string;
  openLibrary?: Required<MetadataSourceOptions>;
  googleBooks?: Required<MetadataSourceOptions> & { apiKey?: string };
  overrides: string;
  markdownOverrides: string;
  cache: string | false;
  covers: ResolvedCoverOptions;
  output?: string;
  timeoutMs: number;
  staleIfError: boolean;
  conflicts: 'warn' | 'error';
  root: string;
}

/** @deprecated Use ResolvedBookBridgeOptions. */
export type ResolvedGoodreadsBridgeOptions = ResolvedBookBridgeOptions;

export interface CatalogLogger {
  warn(message: string): void;
}

interface CacheEntry<T> {
  data: T;
  fetchedAt: string;
  key: string;
}

export function resolveOptions(options: BookBridgeOptions, root: string): ResolvedBookBridgeOptions {
  const sourceOptions = (source: boolean | MetadataSourceOptions | undefined): Required<MetadataSourceOptions> | undefined => {
    if (!source) return undefined;
    return { isbns: source === true ? [] : source.isbns ?? [], enrich: source === true ? true : source.enrich ?? true };
  };
  const openLibrary = sourceOptions(options.openLibrary);
  const googleBooks = options.googleBooks
    ? { ...sourceOptions(options.googleBooks)!, apiKey: options.googleBooks === true ? undefined : options.googleBooks.apiKey }
    : undefined;
  const hasDirectIsbns = Boolean(openLibrary?.isbns.length || googleBooks?.isbns.length);
  for (const value of [...(openLibrary?.isbns ?? []), ...(googleBooks?.isbns ?? [])]) assertValidIsbn(value, 'Configured ISBN');
  if (!options.rssUrl?.trim() && !hasDirectIsbns) {
    throw new Error('[astro-book-bridge] Configure rssUrl or provide ISBNs to openLibrary/googleBooks.');
  }
  return {
    rssUrl: options.rssUrl?.trim() || undefined,
    openLibrary,
    googleBooks,
    root,
    overrides: options.overrides ?? 'src/content/book-overrides.json',
    markdownOverrides: options.markdownOverrides ?? 'src/content/book-overrides',
    cache: options.cache === false ? false : options.cache ?? '.astro/book-bridge',
    covers: {
      mode: options.covers?.mode ?? 'remote',
      directory: options.covers?.directory ?? 'public/book-covers',
      fallbackUrl: options.covers?.fallbackUrl,
    },
    output: options.output,
    timeoutMs: options.timeoutMs ?? 10_000,
    staleIfError: options.staleIfError ?? true,
    conflicts: options.conflicts ?? 'warn',
  };
}

function atRoot(root: string, target: string): string {
  return isAbsolute(target) ? target : resolve(root, target);
}

function providerCachePath(cache: string | undefined, provider: 'goodreads-rss' | 'open-library' | 'google-books'): string | undefined {
  if (!cache) return undefined;
  if (extname(cache) === '.json') {
    return provider === 'goodreads-rss' ? cache : `${cache.slice(0, -5)}.${provider}.json`;
  }
  return join(cache, `${provider}.json`);
}

async function readCache<T>(path: string, key: string): Promise<CacheEntry<T> | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<CacheEntry<T>>;
    return value.key === key && value.data !== undefined && typeof value.fetchedAt === 'string' ? value as CacheEntry<T> : undefined;
  } catch {
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

async function fetchWithCache<T>(label: string, path: string | undefined, key: string, load: () => Promise<T>, options: ResolvedBookBridgeOptions, logger?: CatalogLogger): Promise<{ data: T; usedCache: boolean }> {
  try {
    const data = await load();
    if (path) await writeJson(path, { data, key, fetchedAt: new Date().toISOString() });
    return { data, usedCache: false };
  } catch (error: unknown) {
    const cached = path ? await readCache<T>(path, key) : undefined;
    if (options.staleIfError && cached) {
      logger?.warn(`[astro-book-bridge] ${label} fetch failed; using cached data from ${cached.fetchedAt}.`);
      return { data: cached.data, usedCache: true };
    }
    throw error;
  }
}

async function fetchRss(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!response.ok) throw new Error(`RSS returned HTTP ${response.status}.`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadOverrides(path: string) {
  try {
    return bookOverridesSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { books: [] };
    throw new Error(`[astro-book-bridge] Invalid overrides file (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Fetches, enriches and optionally persists a catalog for the virtual module. */
export async function buildCatalog(options: ResolvedBookBridgeOptions, logger?: CatalogLogger): Promise<BookCatalog> {
  const cacheDirectory = options.cache ? atRoot(options.root, options.cache) : undefined;
  const remoteBooks: GoodreadsBook[] = [];
  let usedCache = false;

  if (options.rssUrl) {
    try {
      const result = await fetchWithCache('RSS', providerCachePath(cacheDirectory, 'goodreads-rss'), options.rssUrl, () => fetchRss(options.rssUrl!, options.timeoutMs), options, logger);
      remoteBooks.push(...parseGoodreadsRss(result.data));
      usedCache ||= result.usedCache;
    } catch (error: unknown) {
      if (!options.openLibrary && !options.googleBooks) {
        throw new Error(`[astro-book-bridge] Could not fetch RSS: ${error instanceof Error ? error.message : String(error)}`);
      } else {
        logger?.warn(`[astro-book-bridge] RSS fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const sourceIsbns = remoteBooks.flatMap((book) => [book.isbn13, book.isbn].flatMap((value) => {
    if (!value) return [];
    try {
      return [assertValidIsbn(value, `RSS ISBN for "${book.title}"`)];
    } catch (error: unknown) {
      logger?.warn(`[astro-book-bridge] ${error instanceof Error ? error.message : String(error)} Skipping metadata enrichment for this identifier.`);
      return [];
    }
  }));
  const sourceIsbnsFor = (source: Required<MetadataSourceOptions>) => [...new Set([...source.isbns, ...(source.enrich ? sourceIsbns : [])])];
  if (options.openLibrary) {
    try {
      const identifiers = sourceIsbnsFor(options.openLibrary).sort();
      const result = await fetchWithCache('Open Library', providerCachePath(cacheDirectory, 'open-library'), identifiers.join(','), () => fetchOpenLibraryBooks(identifiers, options.timeoutMs), options, logger);
      remoteBooks.push(...result.data);
      usedCache ||= result.usedCache;
    } catch (error: unknown) {
      logger?.warn(`[astro-book-bridge] Open Library fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const googleBooks = options.googleBooks;
  if (googleBooks) {
    try {
      const identifiers = sourceIsbnsFor(googleBooks).sort();
      const result = await fetchWithCache('Google Books', providerCachePath(cacheDirectory, 'google-books'), identifiers.join(','), () => fetchGoogleBooks(identifiers, options.timeoutMs, googleBooks.apiKey), options, logger);
      remoteBooks.push(...result.data);
      usedCache ||= result.usedCache;
    } catch (error: unknown) {
      logger?.warn(`[astro-book-bridge] Google Books fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (remoteBooks.length === 0) {
    throw new Error('[astro-book-bridge] No books could be fetched from the configured sources.');
  }

  const overrides = await loadOverrides(atRoot(options.root, options.overrides));
  const markdownOverrides = await loadMarkdownOverrides(atRoot(options.root, options.markdownOverrides));
  const combinedBooks = combineSourceBooks(remoteBooks, (message) => {
    if (options.conflicts === 'error') throw new Error(`[astro-book-bridge] ${message}`);
    logger?.warn(`[astro-book-bridge] ${message}`);
  });
  const books = await applyCoverPolicy(mergeBooks(combinedBooks, [...overrides.books, ...markdownOverrides]), options.root, options.covers, options.timeoutMs, (message) => logger?.warn(message));
  const catalog: BookCatalog = {
    books,
    generatedAt: new Date().toISOString(),
    source: { rssUrl: options.rssUrl, usedCache, providers: [...new Set(combinedBooks.map((book) => book.source ?? 'goodreads-rss'))] },
  };

  if (options.output) await writeJson(atRoot(options.root, options.output), catalog);
  return catalog;
}
