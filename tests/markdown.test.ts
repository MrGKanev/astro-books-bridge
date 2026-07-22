import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMarkdownOverrides } from '../src/markdown.js';

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('loadMarkdownOverrides', () => {
  it('uses frontmatter for matching and the document body for a review', async () => {
    const root = await mkdtemp(join(tmpdir(), 'book-bridge-markdown-'));
    roots.push(root);
    await writeFile(join(root, 'left-hand.md'), `---\nisbn13: "9780441478125"\ntags: [science-fiction, reread]\nfeatured: true\n---\n\n# A returning favorite\n\nThe full review lives in Markdown.`);

    await expect(loadMarkdownOverrides(root)).resolves.toEqual([expect.objectContaining({
      isbn13: '9780441478125',
      featured: true,
      review: '# A returning favorite\n\nThe full review lives in Markdown.',
    })]);
  });
});
