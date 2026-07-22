import { describe, expect, it } from 'vitest';
import { assertValidIsbn, isValidIsbn10, isValidIsbn13, normalizeIsbn } from '../src/identifiers.js';

describe('ISBN identifiers', () => {
  it('normalizes and validates ISBN-10 and ISBN-13 check digits', () => {
    expect(normalizeIsbn('978-0-14-032872-1')).toBe('9780140328721');
    expect(isValidIsbn10('0-441-47812-3')).toBe(true);
    expect(isValidIsbn13('978-0-14-032872-1')).toBe(true);
  });

  it('rejects invalid checksums', () => {
    expect(() => assertValidIsbn('9780123456789')).toThrow('valid ISBN');
  });
});
