import path from 'node:path'

/** Gitignored — written by tests/auth.setup.ts, read by playwright.config.ts's storageState. */
export const AUTH_STORAGE_STATE_PATH = path.join(process.cwd(), '.playwright-auth', 'commander.json')
