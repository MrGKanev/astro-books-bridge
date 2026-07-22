import { access, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative, resolve } from 'node:path';
import type { Book } from './schema.js';

export interface ResolvedCoverOptions {
  mode: 'remote' | 'local';
  directory: string;
  fallbackUrl?: string;
}

const extensionsByType: Record<string, string> = {
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function localUrl(root: string, directory: string, file: string): string {
  const publicDirectory = resolve(root, 'public');
  const path = resolve(root, directory, file);
  const pathFromPublic = relative(publicDirectory, path);
  if (pathFromPublic.startsWith('..')) {
    throw new Error('[astro-book-bridge] covers.directory must be inside the project public directory.');
  }
  return `/${pathFromPublic.split('\\').join('/')}`;
}

async function existingCover(directory: string, hash: string): Promise<string | undefined> {
  for (const extension of Object.values(extensionsByType)) {
    const path = resolve(directory, `${hash}.${extension}`);
    try {
      await access(path);
      return path;
    } catch {
      // Try the next common image extension.
    }
  }
  return undefined;
}

async function cacheOneCover(book: Book, root: string, options: ResolvedCoverOptions, timeoutMs: number): Promise<Book> {
  const originalUrl = book.coverSourceUrl ?? book.imageUrl;
  if (!originalUrl) return options.fallbackUrl ? { ...book, imageUrl: options.fallbackUrl } : book;
  const hash = createHash('sha256').update(originalUrl).digest('hex').slice(0, 24);
  const directory = resolve(root, options.directory);
  const existing = await existingCover(directory, hash);
  if (existing) {
    const extension = existing.split('.').pop()!;
    return { ...book, imageUrl: localUrl(root, options.directory, `${hash}.${extension}`), coverSourceUrl: originalUrl, coverAttribution: { provider: book.coverProvider ?? book.source, url: originalUrl } };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(originalUrl, { signal: controller.signal, headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8' } });
    if (!response.ok) throw new Error(`returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() ?? '';
    if (!contentType.startsWith('image/')) throw new Error(`returned unexpected content type ${contentType || 'unknown'}`);
    const extension = extensionsByType[contentType] ?? 'jpg';
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, `${hash}.${extension}`), Buffer.from(await response.arrayBuffer()));
    return { ...book, imageUrl: localUrl(root, options.directory, `${hash}.${extension}`), coverSourceUrl: originalUrl, coverAttribution: { provider: book.coverProvider ?? book.source, url: originalUrl } };
  } finally {
    clearTimeout(timer);
  }
}

/** Stores remote covers in public/ while retaining source attribution for templates. */
export async function applyCoverPolicy(books: Book[], root: string, options: ResolvedCoverOptions, timeoutMs: number, warn: (message: string) => void): Promise<Book[]> {
  if (options.mode === 'remote') {
    return books.map((book) => book.imageUrl ? { ...book, coverSourceUrl: book.coverSourceUrl ?? book.imageUrl, coverAttribution: { provider: book.coverProvider ?? book.source, url: book.coverSourceUrl ?? book.imageUrl } } : options.fallbackUrl ? { ...book, imageUrl: options.fallbackUrl } : book);
  }

  const result = [...books];
  for (let start = 0; start < books.length; start += 4) {
    await Promise.all(books.slice(start, start + 4).map(async (book, index) => {
      try {
        result[start + index] = await cacheOneCover(book, root, options, timeoutMs);
      } catch (error: unknown) {
        warn(`[astro-book-bridge] Could not cache cover for "${book.title}": ${error instanceof Error ? error.message : String(error)}.`);
        result[start + index] = options.fallbackUrl ? { ...book, imageUrl: options.fallbackUrl } : book;
      }
    }));
  }
  return result;
}
