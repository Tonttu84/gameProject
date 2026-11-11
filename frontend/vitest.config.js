import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.js'],
    // Node ≥25 enables a global WebStorage `localStorage` whose getter throws
    // here (no backing file), which jsdom's environment hits during setup and
    // every test dies with `window.localStorage.clear is not a function`.
    // Disable it in the test workers so jsdom's own localStorage stands — this
    // bakes in what used to require NODE_OPTIONS=--no-experimental-webstorage,
    // so a bare `npm test` / `npx vitest` works. (execArgv applies at worker
    // start, before jsdom runs, which a setupFiles polyfill can't.) Vitest 4
    // made the old `poolOptions.forks.execArgv` a top-level option and drops
    // `poolOptions` with only a deprecation warning, so it lives here now (D12).
    pool: 'forks',
    execArgv: ['--no-experimental-webstorage'],
  },
})
