import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills'; // <-- Add this line

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true, // Forces 'Buffer' to be globally defined on the window object
        global: true,
        process: true,
      },
    }),
  ],
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

