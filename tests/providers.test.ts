import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGoogleBooks, fetchOpenLibraryBooks } from '../src/providers.js';

afterEach(() => vi.unstubAllGlobals());

describe('metadata providers', () => {
  it('maps Open Library ISBN responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      'ISBN:9780123456789': {
        title: 'Open book',
        authors: [{ name: 'Open Author' }],
        identifiers: { isbn_13: ['9780123456789'] },
        cover: { large: 'https://covers.example/book.jpg' },
        number_of_pages: 320,
      },
    }))));

    await expect(fetchOpenLibraryBooks(['978-0-123-45678-9'], 1_000)).resolves.toEqual([
      expect.objectContaining({ source: 'open-library', title: 'Open book', author: 'Open Author', pageCount: 320 }),
    ]);
  });

  it('maps Google Books volume responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ volumeInfo: {
        title: 'Google book', authors: ['Google Author'],
        industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780123456789' }],
        imageLinks: { thumbnail: 'http://images.example/book.jpg' },
      } }],
    }))));

    await expect(fetchGoogleBooks(['9780123456789'], 1_000)).resolves.toEqual([
      expect.objectContaining({ source: 'google-books', title: 'Google book', imageUrl: 'https://images.example/book.jpg' }),
    ]);
  });
});
