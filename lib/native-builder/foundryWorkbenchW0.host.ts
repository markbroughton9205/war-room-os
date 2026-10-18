/**
 * Foundry Workbench W0 Node host bridge. Server-only.
 * The renderer never imports this module. Connection token never enters the client bundle.
 */
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

type WorkbenchHostModule = {
  startOwned: (options?: Record<string, unknown>) => Promise<Record<string, unknown>>
  stopOwned: () => Promise<Record<string, unknown>>
  health: () => Promise<Record<string, unknown>>
  ensureFixture: () => string
  fixtureRoot: () => string
  runtimeReady: () => boolean
  publicHealth: (extra?: Record<string, unknown>) => Record<string, unknown>
  stateDir: () => string
}

function hostModule(): WorkbenchHostModule {
  return require('../../desktop/workbench-host/index.cjs') as WorkbenchHostModule
}

export function foundryWorkbenchHealth() {
  return hostModule().health()
}

export function startFoundryWorkbench(options?: Record<string, unknown>) {
  return hostModule().startOwned(options)
}

export function stopFoundryWorkbench() {
  return hostModule().stopOwned()
}

export function foundryWorkbenchFixtureRoot() {
  return hostModule().fixtureRoot()
}

export function ensureFoundryWorkbenchFixture() {
  return hostModule().ensureFixture()
}

export function foundryWorkbenchRuntimeReady() {
  return hostModule().runtimeReady()
}

export function foundryWorkbenchStateDir() {
  return hostModule().stateDir()
}
