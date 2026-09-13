import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'
import {
  parseCouncilRoutingPreference,
  type CouncilRoutingPreference,
} from '@/lib/council/live-orchestration/councilContinuity'

/**
 * Commander-owned packaged routing file. No secrets. Never copied from checkout .env.local.
 * Path: %LOCALAPPDATA%\War Room OS\data\council-runtime.json
 * Override for tests: WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH (empty string disables the file).
 */
export function packagedCouncilRuntimeConfigPath(): string | null {
  if (typeof process.env.WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH === 'string') {
    const override = process.env.WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH.trim()
    if (!override) return null
    return path.resolve(override)
  }
  return path.join(resolveLocalAppDataPaths().data, 'council-runtime.json')
}

export function readPackagedCouncilRoutingPreference(): CouncilRoutingPreference | null {
  const filePath = packagedCouncilRuntimeConfigPath()
  if (!filePath) return null
  try {
    if (!existsSync(filePath)) return null
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as {
      routingMode?: unknown
      COUNCIL_ROUTING_MODE?: unknown
    }
    const raw = parsed?.routingMode ?? parsed?.COUNCIL_ROUTING_MODE
    if (typeof raw !== 'string') return null
    return parseCouncilRoutingPreference(raw)
  } catch {
    return null
  }
}
