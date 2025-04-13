import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8080 // Or any port you prefer
  },
  build: {
    outDir: 'dist'
  },
  base: './' // Ensure assets are loaded correctly
}); 