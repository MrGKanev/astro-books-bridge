import { describe, expect, it } from 'vitest';
import { mergeBooks } from '../src/merge.js';

const source = [{
  title: 'Example',
  goodreadsId: '42',
  isbn: '978-0-123-45678-9',
  isbn13: '9780123456789',
}];

describe('mergeBooks', () => {
  it('prefers Goodreads ID over ISBN matches', () => {
    const books = mergeBooks(source, [
      { goodreadsId: '42', note: 'Matched by Goodreads.' },
      { isbn13: '9780123456789', note: 'Matched by ISBN.' },
    ]);
    expect(books[0]).toMatchObject({ note: 'Matched by Goodreads.', source: 'goodreads-rss' });
  });

  it('normalizes ISBN before matching', () => {
    const books = mergeBooks(source, [{ isbn: '9780123456789', featured: true }]);
    expect(books[0]).toMatchObject({ featured: true });
  });

  it('rejects duplicate identity keys', () => {
    expect(() => mergeBooks(source, [
      { goodreadsId: '42', note: 'A' },
      { goodreadsId: '42', note: 'B' },
    ])).toThrow('Duplicate goodreadsId');
  });
});
