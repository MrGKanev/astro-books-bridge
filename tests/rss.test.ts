import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGoodreadsRss } from '../src/rss.js';

describe('parseGoodreadsRss', () => {
  it('normalizes Goodreads shelf fields', async () => {
    const xml = await readFile(fileURLToPath(new URL('./fixtures/goodreads.xml', import.meta.url)), 'utf8');
    expect(parseGoodreadsRss(xml)).toEqual([expect.objectContaining({
      title: 'The Left Hand of Darkness',
      goodreadsId: '18423',
      isbn13: '9780441478125',
      author: 'Ursula K. Le Guin',
      averageRating: 4.11,
      userRating: 5,
    })]);
  });

  it('rejects a non-RSS response', () => {
    expect(() => parseGoodreadsRss('<html />')).toThrow('missing rss.channel');
  });
});
