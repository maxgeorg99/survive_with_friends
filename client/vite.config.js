import { defineConfig } from 'vite';
import path from 'path';

// Check if we're in development mode
const isDev = process.env.NODE_ENV === 'development';

export default defineConfig({
  server: {
    port: 8080
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    }
  },
  // Set base URL conditionally
  base: isDev ? '/' : '/survive_with_friends/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  // Ensure public directory is properly handled
  publicDir: 'public'
});