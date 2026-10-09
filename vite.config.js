import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.e2b.app', '.localhost'],
    proxy: {
      '/api/laliga': {
        target: 'https://fantasy-api.llt-services.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/laliga/, '/api'),
      },
      '/auth/provider/token': {
        target: 'https://login.laliga.es',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(
          /^\/auth\/provider\/token/,
          '/laligadspprob2c.onmicrosoft.com/oauth2/v2.0/token',
        ),
      },
    },
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app', '.localhost'],
  },
});
