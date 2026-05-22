import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    // This is the critical part
    allowedHosts: [
      'seagull-xlm.xyz',
      'www.seagull-xlm.xyz',
      '.seagull-xlm.xyz' // The dot allows all subdomains too
    ],
    // Helps with the "Synchronizing" loop by making sure the web-socket/HMR connects
    hmr: {
      clientPort: 443,
      host: 'seagull-xlm.xyz',
      protocol: 'wss'
    }
  }
});

