import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { parseGoodreadsRss } from './rss.js';
import { mergeBooks } from './merge.js';
import { bookOverridesSchema, type BookCatalog } from './schema.js';

export interface GoodreadsBridgeOptions {
  /** Goodreads shelf RSS URL, for example https://www.goodreads.com/review/list_rss/USER_ID?shelf=read */
  rssUrl: string;
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

export interface ResolvedGoodreadsBridgeOptions extends Required<Omit<GoodreadsBridgeOptions, 'cache' | 'output'>> {
  cache: string | false;
  output?: string;
  root: string;
}

export interface CatalogLogger {
  warn(message: string): void;
}

interface RssCache {
  xml: string;
  fetchedAt: string;
}

export function resolveOptions(options: GoodreadsBridgeOptions, root: string): ResolvedGoodreadsBridgeOptions {
  if (!options.rssUrl?.trim()) {
    throw new Error('[astro-goodreads-bridge] rssUrl is required.');
  }
  return {
    rssUrl: options.rssUrl,
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
    if (!response.ok) throw new Error(`Goodreads RSS returned HTTP ${response.status}.`);
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
    throw new Error(`[astro-goodreads-bridge] Invalid overrides file (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Fetches, enriches and optionally persists a catalog for the virtual module. */
export async function buildCatalog(options: ResolvedGoodreadsBridgeOptions, logger?: CatalogLogger): Promise<BookCatalog> {
  const cachePath = options.cache ? atRoot(options.root, options.cache) : undefined;
  let xml: string;
  let usedCache = false;

  try {
    xml = await fetchRss(options.rssUrl, options.timeoutMs);
    if (cachePath) await writeJson(cachePath, { xml, fetchedAt: new Date().toISOString() });
  } catch (error: unknown) {
    const cached = cachePath ? await readCache(cachePath) : undefined;
    if (!options.staleIfError || !cached) {
      throw new Error(`[astro-goodreads-bridge] Could not fetch RSS: ${error instanceof Error ? error.message : String(error)}`);
    }
    xml = cached.xml;
    usedCache = true;
    logger?.warn(`[astro-goodreads-bridge] RSS fetch failed; using cached feed from ${cached.fetchedAt}.`);
  }

  const overrides = await loadOverrides(atRoot(options.root, options.overrides));
  const catalog: BookCatalog = {
    books: mergeBooks(parseGoodreadsRss(xml), overrides.books),
    generatedAt: new Date().toISOString(),
    source: { rssUrl: options.rssUrl, usedCache },
  };

  if (options.output) await writeJson(atRoot(options.root, options.output), catalog);
  return catalog;
}
