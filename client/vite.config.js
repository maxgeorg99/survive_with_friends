import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 8080 // Or any port you prefer
  },
  preview: {
    host: '0.0.0.0', // Allow external connections
    allowedHosts: ['vibesurvivors.onrender.com', '.onrender.com', 'localhost']
  },
  build: {
    outDir: 'dist'
  },
  base: './' // Ensure assets are loaded correctly
}); 