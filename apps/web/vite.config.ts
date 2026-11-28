import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  envDir: '../..',
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          const normalizedId = id.replace(/\\/g, '/');
          if (
            normalizedId.includes('node_modules/react/') ||
            normalizedId.includes('node_modules/react-dom/') ||
            normalizedId.includes('node_modules/scheduler/')
          ) {
            return 'vendor-react';
          }
          if (
            normalizedId.includes('node_modules/recharts') ||
            normalizedId.includes('node_modules/d3-') ||
            normalizedId.includes('node_modules/victory-vendor')
          ) {
            return 'vendor-recharts';
          }
          if (normalizedId.includes('node_modules/@supabase')) {
            return 'vendor-supabase';
          }
          if (normalizedId.includes('node_modules/lucide-react')) {
            return 'vendor-icons';
          }
          if (normalizedId.includes('node_modules/zod')) {
            return 'vendor-zod';
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
