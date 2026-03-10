import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Project Pages requires a repository base path.
export default defineConfig({
  base: '/paper-moonlight-h5-pages/',
  plugins: [react()],
})
