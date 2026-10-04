import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Bundles the runtime part of the API (constants, validators, errors) into one
// ESM file; tsc writes the matching declarations next to it.
export default defineConfig({
  // The example provider imports the API by package name, as a real provider does.
  resolve: { alias: [{ find: /^puros-provider-sdk$/, replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)) }] },
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    outDir: 'dist',
    emptyOutDir: false,
    minify: false,
    target: 'node22',
  },
})
