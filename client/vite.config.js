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
           assetFileNames: (assetInfo) => {
             // Keep the original path structure for assets
             const info = assetInfo.name.split('.');
             const ext = info.pop();
             const name = info.join('.');
             return `${name}.${ext}`;
           }
         }
       }
     },
     // Set base URL to root for production
     base: isDev ? '/' : '/',
     resolve: {
       alias: {
         '@': path.resolve(__dirname, './src')
       }
     },
     publicDir: 'public'
   });