import { XMLParser } from 'fast-xml-parser';
import type { GoodreadsBook } from './schema.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: false,
});

type XmlValue = string | number | undefined | null;

function text(value: XmlValue): string | undefined {
  if (value === undefined || value === null) return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function number(value: XmlValue): number | undefined {
  const result = Number(text(value));
  return Number.isFinite(result) ? result : undefined;
}

function values(value: unknown): Record<string, XmlValue>[] {
  if (Array.isArray(value)) return value as Record<string, XmlValue>[];
  if (value && typeof value === 'object') return [value as Record<string, XmlValue>];
  return [];
}

function idFromLink(link?: string): string | undefined {
  return link?.match(/(?:book\/show|review\/show)\/(\d+)/)?.[1];
}

/** Parses the Goodreads shelf RSS XML into stable, source-only book fields. */
export function parseGoodreadsRss(xml: string): GoodreadsBook[] {
  const document = parser.parse(xml) as { rss?: { channel?: { item?: unknown } } };
  const items = values(document.rss?.channel?.item);

  if (!document.rss?.channel) {
    throw new Error('The response is not a valid RSS document (missing rss.channel).');
  }

  return items.flatMap((item) => {
    const title = text(item.title);
    if (!title) return [];

    const link = text(item.link);
    return [{
      source: 'goodreads-rss',
      title,
      goodreadsId: text(item.book_id) ?? idFromLink(text(item.guid)) ?? idFromLink(link),
      isbn: text(item.isbn),
      isbn13: text(item.isbn13),
      author: text(item.author_name) ?? text(item['dc:creator']),
      link,
      imageUrl: text(item.book_image_url) ?? text(item.image_url),
      coverSourceUrl: text(item.book_image_url) ?? text(item.image_url),
      coverProvider: text(item.book_image_url) ?? text(item.image_url) ? 'goodreads-rss' : undefined,
      description: text(item.book_description) ?? text(item.description),
      averageRating: number(item.average_rating),
      userRating: number(item.user_rating),
      readAt: text(item.user_read_at),
      addedAt: text(item.user_date_added) ?? text(item.pubDate),
    }];
  });
}
