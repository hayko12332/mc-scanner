import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev`: API calls go to the Nest backend on :3000.
    proxy: { '/api': 'http://localhost:3000' },
  },
})
