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
    expect(JSON.parse(await readFile(join(root, '.cache/rss.json'), 'utf8'))).toHaveProperty('xml');
  });
});
