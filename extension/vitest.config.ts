import { defineConfig } from 'vitest/config'

// Deliberately does NOT load the CRXJS plugin: the units under test (scoring,
// grading, streaks) are pure and must run without a browser or manifest.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
