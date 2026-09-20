import { defineConfig } from 'vite'

const host = process.env['TAURI_DEV_HOST']

export default defineConfig({
  clearScreen: false,
  build: {
    target: 'safari18',
    rollupOptions: {
      input: { index: 'index.html', notas: 'notas.html' },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host ?? false,
    ...(host === undefined ? {} : { hmr: { protocol: 'ws', host, port: 1421 } }),
    watch: { ignored: ['**/src-tauri/**'] },
  },
})
