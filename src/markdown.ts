import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { bookOverrideSchema, type BookOverride } from './schema.js';

async function markdownFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(path);
      return ['.md', '.mdx'].includes(extname(entry.name).toLowerCase()) ? [path] : [];
    }));
    return nested.flat();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function parseFrontmatter(contents: string, path: string): BookOverride {
  if (!contents.startsWith('---')) {
    throw new Error(`Markdown override (${path}) must start with YAML frontmatter.`);
  }
  const closeIndex = contents.indexOf('\n---', 3);
  if (closeIndex === -1) throw new Error(`Markdown override (${path}) has unclosed frontmatter.`);
  const frontmatter = contents.slice(3, closeIndex).trim();
  const body = contents.slice(closeIndex + 4).trim();
  const fields = parseYaml(frontmatter);
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error(`Markdown override (${path}) frontmatter must be a YAML object.`);
  }
  return bookOverrideSchema.parse({ ...fields, review: (fields as Record<string, unknown>).review ?? (body || undefined) });
}

/** Loads one book override per Markdown/MDX file from a directory. */
export async function loadMarkdownOverrides(directory: string): Promise<BookOverride[]> {
  return Promise.all((await markdownFiles(directory)).sort().map(async (path) => {
    try {
      return parseFrontmatter(await readFile(path, 'utf8'), path);
    } catch (error: unknown) {
      throw new Error(`[astro-book-bridge] Invalid Markdown override: ${error instanceof Error ? error.message : String(error)}`);
    }
  }));
}
