import { defineConfig } from 'vite'
import { resolve } from 'path'

// Builds the live demo (the front page of the GitHub Pages site).
//   npm run demo:dev     local preview
//   npm run demo:build   → demo/dist
export default defineConfig({
  root: resolve(__dirname),
  base: process.env.DEMO_BASE ?? '/localvision/',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
})
