import { defineConfig, devices } from '@playwright/test'

import { AUTH_STORAGE_STATE_PATH } from './tests/testAuthConfig'

/**
 * REAL browser acceptance harness (validate:council-browser-live / test:council-browser-live) —
 * distinct from the FIXTURE suite at lib/council/nebula/browserAcceptance.validation.ts
 * (validate:council-browser-acceptance), which asserts against hand-built input and never opens a
 * browser. See audit finding P0-3: that naming collision let a fixture pass for live proof.
 *
 * Requires a running War Room instance at PLAYWRIGHT_BASE_URL (default http://localhost:3000) and
 * TEST_COMMANDER_EMAIL/TEST_COMMANDER_PASSWORD in the environment for the auth.setup.ts project —
 * every authenticated spec self-skips (not fails) when those are absent.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 180_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STORAGE_STATE_PATH,
      },
      dependencies: ['setup'],
      testMatch: /council-browser-acceptance\.spec\.ts/,
    },
  ],
})
