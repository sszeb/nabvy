import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // tsconfig.json sets jsx: "preserve" for Next's own compiler; Vite (oxc) otherwise inherits
  // that and leaves JSX untransformed, so the runtime is set explicitly here instead of changing
  // that shared setting.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
  },
})
