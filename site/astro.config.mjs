import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://oandre.github.io',
  base: '/notion-2-obsidian',
  integrations: [tailwind()],
});
