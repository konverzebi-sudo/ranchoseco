import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Publicado en https://jefeshub.com/ranchoseco/ (GitHub Pages)
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/ranchoseco/',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
} as any)
