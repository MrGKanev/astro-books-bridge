import type { AstroIntegration } from 'astro';
import type { Plugin, ViteDevServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildCatalog, resolveOptions, type BookBridgeOptions, type ResolvedBookBridgeOptions } from './catalog.js';

export type { Book, BookCatalog, BookOverride, BookSourceName, GoodreadsBook } from './schema.js';
export type { BookBridgeOptions, GoogleBooksSourceOptions, GoodreadsBridgeOptions, MetadataSourceOptions } from './catalog.js';
export { buildCatalog } from './catalog.js';
export { parseGoodreadsRss } from './rss.js';

export const virtualModuleId = 'astro-book-bridge:catalog';
const resolvedVirtualModuleId = `\0${virtualModuleId}`;

function virtualModule(options: ResolvedBookBridgeOptions, logger: { warn(message: string): void }): Plugin {
  let server: ViteDevServer | undefined;
  let catalog: Promise<unknown> | undefined;

  const invalidate = () => {
    catalog = undefined;
    const module = server?.moduleGraph.getModuleById(resolvedVirtualModuleId);
    if (module) server?.moduleGraph.invalidateModule(module);
    server?.ws.send({ type: 'full-reload' });
  };

  return {
    name: 'astro-book-bridge',
    resolveId(id) {
      return id === virtualModuleId ? resolvedVirtualModuleId : undefined;
    },
    async load(id) {
      if (id !== resolvedVirtualModuleId) return undefined;
      catalog ??= buildCatalog(options, logger);
      const result = await catalog;
      return `export const catalog = ${JSON.stringify(result)};\nexport const books = catalog.books;\nexport default books;`;
    },
    configureServer(devServer) {
      server = devServer;
      devServer.watcher.add(resolve(options.root, options.overrides));
      devServer.watcher.on('change', (path) => {
        if (path === resolve(options.root, options.overrides)) invalidate();
      });
    },
  };
}

/**
 * Astro integration exposing a multi-source book catalog through
 * `astro-book-bridge:catalog`.
 */
export default function bookBridge(options: BookBridgeOptions): AstroIntegration {
  return {
    name: 'astro-book-bridge',
    hooks: {
      'astro:config:setup': ({ config, logger, updateConfig }) => {
        const root = fileURLToPath(config.root);
        const resolvedOptions = resolveOptions(options, root);
        updateConfig({
          vite: {
            plugins: [virtualModule(resolvedOptions, logger)],
          },
        });
      },
      'astro:config:done': ({ injectTypes }) => {
        injectTypes({
          filename: 'astro-book-bridge.d.ts',
          content: `declare module '${virtualModuleId}' {
  import type { Book, BookCatalog } from 'astro-book-bridge';
  export const catalog: BookCatalog;
  export const books: Book[];
  export default books;
}`,
        });
      },
    },
  };
}
