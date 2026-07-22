import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCoverPolicy } from '../src/covers.js';
import type { Book } from '../src/schema.js';

const roots: string[] = [];
const book: Book = { title: 'Cover test', source: 'open-library', sources: ['open-library'], imageUrl: 'https://covers.example/book.png' };

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('cover policy', () => {
  it('keeps attribution for remote covers', async () => {
    const [result] = await applyCoverPolicy([book], '/tmp', { mode: 'remote', directory: 'public/book-covers' }, 1_000, () => {});
    expect(result.coverAttribution).toEqual({ provider: 'open-library', url: book.imageUrl });
  });

  it('downloads local public covers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'book-bridge-covers-'));
    roots.push(root);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } })));
    const [result] = await applyCoverPolicy([book], root, { mode: 'local', directory: 'public/book-covers' }, 1_000, () => {});
    expect(result.imageUrl).toMatch(/^\/book-covers\/[a-f0-9]+\.png$/);
    await expect(readFile(join(root, 'public', result.imageUrl!.slice(1)))).resolves.toBeInstanceOf(Buffer);
  });
});
