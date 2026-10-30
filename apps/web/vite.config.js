import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import {browserProtectionPlugin} from '../../automation/security-browser/csp.mjs';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: '/',
  plugins: [vue(),browserProtectionPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
