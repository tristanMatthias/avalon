import { defineConfig } from 'vite'

// Relative base so the build works on GitHub Pages under /<repo>/ (or any other path)
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
})
