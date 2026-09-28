import { defineConfig } from 'vite'

// Short commit id shown in the UI, so players can tell they have the latest build
const build = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev'

// Relative base so the build works on GitHub Pages under /<repo>/ (or any other path)
export default defineConfig({
  base: './',
  build: { target: 'es2020' },
  define: { __BUILD__: JSON.stringify(build) },
})
