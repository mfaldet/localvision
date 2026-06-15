import { defineConfig } from 'vite'
import path from 'path'

/**
 * Build config for the anywidget JS bundle. Produces a single ES module
 * that anywidget loads at widget-mount time. All dependencies (MapLibre,
 * Plot, d3) get bundled in so the widget works offline once installed.
 *
 * Output: python/localvision_py/static/widget.js
 *
 * Run with:
 *   cd python && npm install && npm run build
 *
 * Bundle is ~1.5MB minified — fine for a Jupyter widget that's installed
 * locally. If size matters more than offline reliability, switch to
 * importing dependencies from a CDN at runtime.
 */
export default defineConfig({
  build: {
    outDir: path.resolve(__dirname, 'localvision_py/static'),
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, 'widget-src/index.ts'),
      formats: ['es'],
      fileName: () => 'widget.js',
    },
    rollupOptions: {
      // Bundle everything — anywidget loads the result as a single ESM module
      external: [],
      output: {
        inlineDynamicImports: true,
      },
    },
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
  },
  resolve: {
    alias: {
      // Reference the main library by relative path from widget-src
      '@localvision': path.resolve(__dirname, '../src'),
    },
  },
})
