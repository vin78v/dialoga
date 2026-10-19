import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: { '/api': { target: process.env.DIALOGA_API_PROXY ?? 'http://localhost:8080', changeOrigin: true } },
  },
});
