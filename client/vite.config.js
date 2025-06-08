import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8080 // Or any port you prefer
  },
  preview: {
    host: true, // Allow external connections
    allowedHosts: 'all' // Allow all hosts (including Render's domain)
  },
  build: {
    outDir: 'dist'
  },
  base: './' // Ensure assets are loaded correctly
}); 