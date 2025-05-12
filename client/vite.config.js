import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 8080 // Or any port you prefer
  },
  build: {
    outDir: 'dist'
  },
  base: '/survive_with_friends', // Ensure assets are loaded correctly
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
}); 