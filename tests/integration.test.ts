import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import goodreadsBridge, { virtualModuleId } from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Astro integration', () => {
  it('provides a typed virtual catalog module', async () => {
    const root = await mkdtemp(join(tmpdir(), 'goodreads-bridge-integration-'));
    roots.push(root);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`
      <rss><channel><item><title>From virtual module</title><book_id>1</book_id></item></channel></rss>
    `)));

    const integration = goodreadsBridge({ rssUrl: 'https://example.test/books.xml' });
    let viteConfig: any;
    const setup = integration.hooks['astro:config:setup']!;
    await setup({
      config: { root: pathToFileURL(`${root}/`) },
      logger: { warn: vi.fn() },
      updateConfig: (config: any) => { viteConfig = config; return config; },
    } as any);

    const plugin = viteConfig.vite.plugins[0];
    const id = plugin.resolveId(virtualModuleId);
    const code = await plugin.load(id);
    expect(code).toContain('From virtual module');

    const injected: { filename: string; content: string }[] = [];
    const done = integration.hooks['astro:config:done']!;
    await done({ injectTypes: (type: { filename: string; content: string }) => { injected.push(type); return pathToFileURL(`${root}/types.d.ts`); } } as any);
    expect(injected[0]).toMatchObject({
      filename: 'astro-book-bridge.d.ts',
      content: expect.stringContaining(`declare module '${virtualModuleId}'`),
    });
  });
});
