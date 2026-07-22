import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCatalog, resolveOptions } from '../src/catalog.js';

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('buildCatalog', () => {
  it('merges overrides and writes a reusable RSS cache', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goodreads-bridge-'));
    roots.push(root);
    await writeFile(join(root, 'overrides.json'), JSON.stringify({ books: [{ goodreadsId: '7', note: 'Local note' }] }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`
      <rss><channel><item><title>Book</title><book_id>7</book_id></item></channel></rss>
    `)));

    const catalog = await buildCatalog(resolveOptions({
      rssUrl: 'https://example.test/feed.xml',
      overrides: 'overrides.json',
      cache: '.cache/rss.json',
    }, root));

    expect(catalog.books[0]).toMatchObject({ title: 'Book', note: 'Local note' });
    expect(JSON.parse(await readFile(join(root, '.cache/rss.json'), 'utf8'))).toHaveProperty('data');
  });

  it('can build a catalog from Open Library without Goodreads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goodreads-bridge-'));
    roots.push(root);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      'ISBN:9780140328721': { title: 'Library only', identifiers: { isbn_13: ['9780140328721'] } },
    }))));

    const catalog = await buildCatalog(resolveOptions({
      openLibrary: { isbns: ['9780140328721'], enrich: false },
    }, root));

    expect(catalog).toMatchObject({
      books: [expect.objectContaining({ title: 'Library only', source: 'open-library' })],
      source: { providers: ['open-library'] },
    });
  });

  it('uses a provider cache when Open Library is temporarily unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goodreads-bridge-'));
    roots.push(root);
    const options = resolveOptions({
      openLibrary: { isbns: ['9780140328721'], enrich: false },
      cache: '.cache',
    }, root);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      'ISBN:9780140328721': { title: 'Cached book', identifiers: { isbn_13: ['9780140328721'] } },
    }))));
    await buildCatalog(options);

    const warn = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const catalog = await buildCatalog(options, { warn });
    expect(catalog).toMatchObject({ books: [expect.objectContaining({ title: 'Cached book' })], source: { usedCache: true } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Open Library fetch failed; using cached data'));
  });
});
