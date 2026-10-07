import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const server = 'http://localhost:5050';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/shots': server,
      '/ws': { target: server, ws: true },
    },
  },
});
