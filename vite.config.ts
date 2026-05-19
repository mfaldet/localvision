import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    dts({ include: ['src'], rollupTypes: true }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'LocalVision',
      fileName: 'localvision',
    },
    rollupOptions: {
      external: ['maplibre-gl', '@observablehq/plot'],
      output: {
        globals: {
          'maplibre-gl': 'maplibregl',
          '@observablehq/plot': 'Plot',
        },
      },
    },
    cssCodeSplit: false,
  },
})
