import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseGoodreadsRss } from './rss.js';
import { combineSourceBooks, mergeBooks } from './merge.js';
import { fetchGoogleBooks, fetchOpenLibraryBooks } from './providers.js';
import { bookOverridesSchema, type BookCatalog, type GoodreadsBook } from './schema.js';

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

export interface BookBridgeOptions {
  /** Optional Goodreads shelf RSS URL, for example https://www.goodreads.com/review/list_rss/USER_ID?shelf=read */
  rssUrl?: string;
  /** Open Library metadata. `true` enriches ISBNs from the configured feed. */
  openLibrary?: boolean | MetadataSourceOptions;
  /** Google Books metadata. `true` enriches ISBNs from the configured feed. */
  googleBooks?: boolean | GoogleBooksSourceOptions;
  /** JSON overrides relative to the Astro project root. Missing file means no overrides. */
  overrides?: string;
  /** Cache file relative to the Astro project root. Set false to disable cache. */
  cache?: string | false;
  /** Optional JSON catalog written after a successful build, relative to project root. */
  output?: string;
  /** Request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Use the last successful RSS response after a fetch failure. Defaults to true. */
  staleIfError?: boolean;
}

/** @deprecated Use BookBridgeOptions. */
export type GoodreadsBridgeOptions = BookBridgeOptions;

export interface ResolvedBookBridgeOptions {
  rssUrl?: string;
  openLibrary?: Required<MetadataSourceOptions>;
  googleBooks?: Required<MetadataSourceOptions> & { apiKey?: string };
  overrides: string;
  cache: string | false;
  output?: string;
  timeoutMs: number;
  staleIfError: boolean;
  root: string;
}

/** @deprecated Use ResolvedBookBridgeOptions. */
export type ResolvedGoodreadsBridgeOptions = ResolvedBookBridgeOptions;

export interface CatalogLogger {
  warn(message: string): void;
}

interface RssCache {
  xml: string;
  fetchedAt: string;
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
  if (!options.rssUrl?.trim() && !hasDirectIsbns) {
    throw new Error('[astro-book-bridge] Configure rssUrl or provide ISBNs to openLibrary/googleBooks.');
  }
  return {
    rssUrl: options.rssUrl?.trim() || undefined,
    openLibrary,
    googleBooks,
    root,
    overrides: options.overrides ?? 'src/content/book-overrides.json',
    cache: options.cache === false ? false : options.cache ?? '.astro/goodreads-bridge/rss.json',
    output: options.output,
    timeoutMs: options.timeoutMs ?? 10_000,
    staleIfError: options.staleIfError ?? true,
  };
}

function atRoot(root: string, target: string): string {
  return isAbsolute(target) ? target : resolve(root, target);
}

async function readCache(path: string): Promise<RssCache | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<RssCache>;
    return typeof value.xml === 'string' && typeof value.fetchedAt === 'string' ? value as RssCache : undefined;
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
  const cachePath = options.cache ? atRoot(options.root, options.cache) : undefined;
  const remoteBooks: GoodreadsBook[] = [];
  let usedCache = false;

  if (options.rssUrl) {
    try {
      const xml = await fetchRss(options.rssUrl, options.timeoutMs);
      if (cachePath) await writeJson(cachePath, { xml, fetchedAt: new Date().toISOString() });
      remoteBooks.push(...parseGoodreadsRss(xml));
    } catch (error: unknown) {
      const cached = cachePath ? await readCache(cachePath) : undefined;
      if (options.staleIfError && cached) {
        remoteBooks.push(...parseGoodreadsRss(cached.xml));
        usedCache = true;
        logger?.warn(`[astro-book-bridge] RSS fetch failed; using cached feed from ${cached.fetchedAt}.`);
      } else if (!options.openLibrary && !options.googleBooks) {
        throw new Error(`[astro-book-bridge] Could not fetch RSS: ${error instanceof Error ? error.message : String(error)}`);
      } else {
        logger?.warn(`[astro-book-bridge] RSS fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const sourceIsbns = remoteBooks.flatMap((book) => [book.isbn13, book.isbn]).filter((value): value is string => Boolean(value));
  const sourceIsbnsFor = (source: Required<MetadataSourceOptions>) => [...new Set([...source.isbns, ...(source.enrich ? sourceIsbns : [])])];
  if (options.openLibrary) {
    try {
      remoteBooks.push(...await fetchOpenLibraryBooks(sourceIsbnsFor(options.openLibrary), options.timeoutMs));
    } catch (error: unknown) {
      logger?.warn(`[astro-book-bridge] Open Library fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (options.googleBooks) {
    try {
      remoteBooks.push(...await fetchGoogleBooks(sourceIsbnsFor(options.googleBooks), options.timeoutMs, options.googleBooks.apiKey));
    } catch (error: unknown) {
      logger?.warn(`[astro-book-bridge] Google Books fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (remoteBooks.length === 0) {
    throw new Error('[astro-book-bridge] No books could be fetched from the configured sources.');
  }

  const overrides = await loadOverrides(atRoot(options.root, options.overrides));
  const combinedBooks = combineSourceBooks(remoteBooks);
  const catalog: BookCatalog = {
    books: mergeBooks(combinedBooks, overrides.books),
    generatedAt: new Date().toISOString(),
    source: { rssUrl: options.rssUrl, usedCache, providers: [...new Set(combinedBooks.map((book) => book.source ?? 'goodreads-rss'))] },
  };

  if (options.output) await writeJson(atRoot(options.root, options.output), catalog);
  return catalog;
}
