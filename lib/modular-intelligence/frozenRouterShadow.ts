import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { isFrozenRouterShadowEnabled } from './frozenRouterShadowGate'
import type { ToolRouterResult } from './types'

export const FROZEN_ROUTER_SHADOW_ARTIFACT = 'WR-TOOL-FROZEN-ROUTER-L10-MEAN-V1'

export type FrozenRouterShadowScore = {
  artifact: string
  predicted_class: string
  probability: number
  top2_class: string
  margin: number
  current_route: string
  matches_observed: boolean
  alters_routing: false
  skipped_reason?: string
}

export type FrozenRouterShadowInfer = (text: string) => FrozenRouterShadowScore | null

let inferHook: FrozenRouterShadowInfer | null = null

export function configureFrozenRouterShadowForTests(infer: FrozenRouterShadowInfer | null): void {
  inferHook = infer
}

function classFromRouter(routed: ToolRouterResult): string {
  if (routed.intent.decision === 'NO_TOOL' || !routed.intent.tool_id) return 'NO_TOOL'
  const map: Record<string, string> = {
    web: 'WEB',
    memory: 'MEMORY',
    files: 'FILES',
    research: 'RESEARCH',
    sha256: 'SHA256',
  }
  return map[routed.intent.tool_id] ?? 'NO_TOOL'
}

function spawnInfer(text: string): FrozenRouterShadowScore | null {
  const repo = process.cwd()
  const python = join(repo, '.venv-wrim', 'bin', 'python')
  const script = join(repo, 'scripts', 'wrim-modular', 'shadow_frozen_router_infer.py')
  const result = spawnSync(python, [script, '--text', text], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: repo,
  })
  if (result.status !== 0 || !result.stdout) return null
  try {
    const parsed = JSON.parse(result.stdout) as Array<Record<string, unknown>>
    const row = parsed[0]
    if (!row) return null
    return {
      artifact: String(row.artifact ?? FROZEN_ROUTER_SHADOW_ARTIFACT),
      predicted_class: String(row.predicted_class),
      probability: Number(row.probability),
      top2_class: String(row.top2_class),
      margin: Number(row.margin),
      current_route: 'UNKNOWN',
      matches_observed: false,
      alters_routing: false,
    }
  } catch {
    return null
  }
}

/**
 * Advisory-only. Must not change routed intent, validation, or execution.
 * Failures skip silently. Production never calls this (gate false).
 */
export function scoreFrozenRouterShadow(
  raw: string,
  routed: ToolRouterResult,
  env: NodeJS.ProcessEnv = process.env,
): FrozenRouterShadowScore | null {
  if (!isFrozenRouterShadowEnabled(env)) return null
  try {
    const scored = inferHook ? inferHook(raw) : spawnInfer(raw)
    if (!scored) {
      return {
        artifact: FROZEN_ROUTER_SHADOW_ARTIFACT,
        predicted_class: 'SKIPPED',
        probability: 0,
        top2_class: 'SKIPPED',
        margin: 0,
        current_route: classFromRouter(routed),
        matches_observed: false,
        alters_routing: false,
        skipped_reason: 'infer_unavailable',
      }
    }
    const current = classFromRouter(routed)
    return {
      ...scored,
      current_route: current,
      matches_observed: scored.predicted_class === current,
      alters_routing: false,
    }
  } catch {
    return null
  }
}

export function shadowFieldsForProvenance(score: FrozenRouterShadowScore | null): Record<string, string> {
  if (!score) return {}
  return {
    frozen_router_shadow: '1',
    frozen_router_predicted: score.predicted_class,
    frozen_router_current: score.current_route,
    frozen_router_match: score.matches_observed ? '1' : '0',
    frozen_router_alters_routing: '0',
  }
}
