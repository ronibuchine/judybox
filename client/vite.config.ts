import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_ORIGIN = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    // `host: true` binds all interfaces so a phone can hit the dev server too.
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/ws': { target: SERVER_ORIGIN, ws: true },
      '/api': { target: SERVER_ORIGIN },
      // Round images live with the content pack, not the client bundle.
      '/assets': { target: SERVER_ORIGIN },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
