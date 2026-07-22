/** Removes presentation punctuation from an ISBN while retaining a possible X check digit. */
export function normalizeIsbn(value: string): string {
  return value.replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn10(value: string): boolean {
  const isbn = normalizeIsbn(value);
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  const sum = [...isbn].reduce((total, digit, index) => total + (digit === 'X' ? 10 : Number(digit)) * (10 - index), 0);
  return sum % 11 === 0;
}

export function isValidIsbn13(value: string): boolean {
  const isbn = normalizeIsbn(value);
  if (!/^\d{13}$/.test(isbn)) return false;
  const sum = [...isbn].slice(0, 12).reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

export function isValidIsbn(value: string): boolean {
  return isValidIsbn10(value) || isValidIsbn13(value);
}

export function assertValidIsbn(value: string, field = 'ISBN'): string {
  const normalized = normalizeIsbn(value);
  if (!isValidIsbn(normalized)) throw new Error(`${field} must be a valid ISBN-10 or ISBN-13: ${value}.`);
  return normalized;
}
