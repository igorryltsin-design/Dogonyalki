import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Игра целиком браузерная: ни сервера, ни прокси. base='./' — чтобы собранный
// dist/index.html открывался двойным кликом с флешки без интернета.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
  },
})
