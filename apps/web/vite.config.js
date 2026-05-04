import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site at /<repo-name>/
  base: '/vozciudadana/',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
