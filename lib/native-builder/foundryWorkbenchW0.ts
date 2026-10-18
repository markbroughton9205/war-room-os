/**
 * Foundry Workbench W0 — flag and constants.
 * Default OFF. Host process lives in foundryWorkbenchW0.host.ts (server-only).
 * Renderer never receives the connection token.
 */

export const FOUNDRY_WORKBENCH_W0_FLAG = 'FOUNDRY_WORKBENCH_W0'
export const FOUNDRY_WORKBENCH_HOST = '127.0.0.1'
export const FOUNDRY_WORKBENCH_PORT = 3849
export const FOUNDRY_WORKBENCH_PARTITION = 'persist:foundry-workbench'

export function isFoundryWorkbenchW0Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env[FOUNDRY_WORKBENCH_W0_FLAG] ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}
