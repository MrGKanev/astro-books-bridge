import { defineConfig } from 'astro/config';
import bookBridge from 'astro-book-bridge';

export default defineConfig({
  integrations: [
    bookBridge({
      openLibrary: {
        isbns: ['9780140328721', '9780441478125', '9780061120084', '9780141182803', '9780307277671', '9780385490818'],
        enrich: false,
      },
    }),
  ],
});
