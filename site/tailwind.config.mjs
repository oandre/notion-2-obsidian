import typography from '@tailwindcss/typography';

export default {
  content: ['./src/**/*.{astro,html,md,mdx,tsx,ts}'],
  theme: { extend: {} },
  plugins: [typography],
};
