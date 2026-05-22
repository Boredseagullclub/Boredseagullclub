import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: [
      'seagull-xlm.xyz',
      'www.seagull-xlm.xyz',
      '.seagull-xlm.xyz'
    ],
    // ✅ The Proxy must live inside the 'server' block
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      }
    },
    hmr: {
      clientPort: 443,
      host: 'seagull-xlm.xyz',
      protocol: 'wss'
    }
  }
});

