import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: {
      '/api/realtime': { target: `ws://localhost:${process.env.PORT ?? 3000}`, ws: true },
      '/api': `http://localhost:${process.env.PORT ?? 3000}`,
      '/health': `http://localhost:${process.env.PORT ?? 3000}`,
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
})
