import { defineConfig } from 'vite';
import path from 'path';

// Check if we're building for GitHub Pages
const isGitHubPages = process.env.GITHUB_PAGES === 'true';

export default defineConfig({
  server: {
    port: 8080
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // Ensure assets are properly hashed for caching
        assetFileNames: 'assets/[name].[hash].[ext]'
      }
    }
  },
  // Set base URL for GitHub Pages deployment
  base: '/survive_with_friends/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});