/**
 * Authenticates once as the Commander test account and saves the session so every real spec in
 * this suite reuses it (via playwright.config.ts's storageState) instead of logging in per test.
 *
 * Requires TEST_COMMANDER_EMAIL / TEST_COMMANDER_PASSWORD in the environment — a real Supabase
 * account on the target app, never hardcoded or committed here. If either is missing, this writes
 * an empty (unauthenticated) storage state instead of failing, and every dependent spec detects
 * that it landed on /login and self-skips with a clear message — see
 * tests/council-browser-acceptance.spec.ts. Never weakens production auth: this drives the same
 * login form/Server Action a human uses.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { test as setup } from '@playwright/test'

import { AUTH_STORAGE_STATE_PATH } from './testAuthConfig'

setup('authenticate as Commander test account', async ({ page }) => {
  const email = process.env.TEST_COMMANDER_EMAIL
  const password = process.env.TEST_COMMANDER_PASSWORD
  mkdirSync(dirname(AUTH_STORAGE_STATE_PATH), { recursive: true })

  if (!email || !password) {
    // Empty-but-valid storage state so the dependent 'chromium' project can still launch a
    // context; the spec itself detects the unauthenticated /login redirect and skips.
    writeFileSync(AUTH_STORAGE_STATE_PATH, JSON.stringify({ cookies: [], origins: [] }))
    setup.skip(true, 'Set TEST_COMMANDER_EMAIL and TEST_COMMANDER_PASSWORD to run authenticated browser acceptance tests.')
    return
  }

  await page.goto('/login')
  await page.locator('input[name="email"]').fill(email)
  await page.locator('input[name="password"]').fill(password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })

  await page.context().storageState({ path: AUTH_STORAGE_STATE_PATH })
})
