import { z } from 'zod';
import { isValidIsbn, isValidIsbn13 } from './identifiers.js';

const identifier = z.string().trim().min(1);

export const bookOverrideSchema = z
  .object({
    goodreadsId: identifier.optional(),
    isbn: identifier.optional(),
    isbn13: identifier.optional(),
    slug: z.string().trim().min(1).optional(),
    note: z.string().optional(),
    review: z.string().optional(),
    recommended: z.boolean().optional(),
    featured: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
  })
  .refine((book) => book.goodreadsId || book.isbn || book.isbn13, {
    message: 'Each override needs goodreadsId, isbn, or isbn13.',
  })
  .refine((book) => !book.isbn || isValidIsbn(book.isbn), {
    message: 'isbn must be a valid ISBN-10 or ISBN-13.',
    path: ['isbn'],
  })
  .refine((book) => !book.isbn13 || isValidIsbn13(book.isbn13), {
    message: 'isbn13 must be a valid ISBN-13.',
    path: ['isbn13'],
  });

export const bookOverridesSchema = z.object({
  books: z.array(bookOverrideSchema).default([]),
});

export type BookOverride = z.infer<typeof bookOverrideSchema>;
export type BookOverrides = z.infer<typeof bookOverridesSchema>;

export type BookSourceName = 'goodreads-rss' | 'open-library' | 'google-books';

export interface GoodreadsBook {
  source?: BookSourceName;
  sources?: BookSourceName[];
  goodreadsId?: string;
  isbn?: string;
  isbn13?: string;
  title: string;
  author?: string;
  link?: string;
  imageUrl?: string;
  description?: string;
  averageRating?: number;
  userRating?: number;
  readAt?: string;
  addedAt?: string;
  publisher?: string;
  publishedDate?: string;
  pageCount?: number;
  subjects?: string[];
  language?: string;
  previewLink?: string;
  /** Original provider URL for a remote cover, retained when a local cover cache is used. */
  coverSourceUrl?: string;
  /** Provider that supplied the active cover; may differ from the book's primary metadata source. */
  coverProvider?: BookSourceName;
  coverAttribution?: {
    provider: BookSourceName;
    url: string;
  };
}

export type Book = GoodreadsBook &
  Omit<BookOverride, 'goodreadsId' | 'isbn' | 'isbn13'> & {
    /** First configured source that supplied this book. */
    source: BookSourceName;
    /** Every configured source successfully merged into this book. */
    sources: BookSourceName[];
  };

export interface BookCatalog {
  books: Book[];
  generatedAt: string;
  source: {
    rssUrl?: string;
    usedCache: boolean;
    providers: BookSourceName[];
  };
}
