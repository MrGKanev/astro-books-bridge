import { z } from 'zod';

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
  });

export const bookOverridesSchema = z.object({
  books: z.array(bookOverrideSchema).default([]),
});

export type BookOverride = z.infer<typeof bookOverrideSchema>;
export type BookOverrides = z.infer<typeof bookOverridesSchema>;

export interface GoodreadsBook {
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
}

export type Book = GoodreadsBook &
  Omit<BookOverride, 'goodreadsId' | 'isbn' | 'isbn13'> & {
    source: 'goodreads-rss';
  };

export interface BookCatalog {
  books: Book[];
  generatedAt: string;
  source: {
    rssUrl: string;
    usedCache: boolean;
  };
}
