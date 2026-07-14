import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../bin/Debug/net10.0-windows/wwwroot',
    emptyOutDir: true,
  },
})
