import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  output: 'static',
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()]
  },
  site: 'https://generativeenginesolutions.com',
  integrations: [sitemap()],
});
