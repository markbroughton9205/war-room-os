import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { isNativeRouterV1ShadowEnabled } from './nativeRouterV1Gate'
import type { ToolRouterResult } from './types'

export const NATIVE_ROUTER_V1_ARTIFACT = 'WR-NATIVE-ROUTER-V1-CANDIDATE'

export type NativeRouterV1ShadowScore = {
  artifact: string
  predicted_class: string
  gate: string
  information_state: string
  deterministic: string | null
  lexical: string | null
  wrim: string | null
  confidence: number
  margin: number
  abstain_state: string
  disagreement: boolean
  current_route: string
  matches_observed: boolean
  alters_routing: false
  skipped_reason?: string
}

export type NativeRouterV1Infer = (text: string) => NativeRouterV1ShadowScore | null

let inferHook: NativeRouterV1Infer | null = null

export function configureNativeRouterV1ShadowForTests(infer: NativeRouterV1Infer | null): void {
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

function spawnInfer(text: string): NativeRouterV1ShadowScore | null {
  const repo = process.cwd()
  const python = join(repo, '.venv-wrim', 'bin', 'python')
  const script = join(repo, 'scripts', 'wrim-modular', 'native_router_v1_infer.py')
  const result = spawnSync(python, [script, '--text', text, '--skip-wrim'], {
    encoding: 'utf8',
    timeout: 60_000,
    cwd: repo,
  })
  if (result.status !== 0 || !result.stdout) return null
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>
    return {
      artifact: String(parsed.artifact ?? NATIVE_ROUTER_V1_ARTIFACT),
      predicted_class: String(parsed.predicted_class),
      gate: String(parsed.gate ?? ''),
      information_state: String(parsed.information_state ?? ''),
      deterministic: parsed.deterministic == null ? null : String(parsed.deterministic),
      lexical: parsed.lexical == null ? null : String(parsed.lexical),
      wrim: parsed.wrim == null ? null : String(parsed.wrim),
      confidence: Number(parsed.confidence ?? 0),
      margin: Number(parsed.margin ?? 0),
      abstain_state: String(parsed.abstain_state ?? ''),
      disagreement: Boolean(parsed.disagreement),
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
 * --skip-wrim keeps per-request observer latency practical; offline eval still scores WRIM in batch.
 */
export function scoreNativeRouterV1Shadow(
  raw: string,
  routed: ToolRouterResult,
  env: NodeJS.ProcessEnv = process.env,
): NativeRouterV1ShadowScore | null {
  if (!isNativeRouterV1ShadowEnabled(env)) return null
  try {
    const scored = inferHook ? inferHook(raw) : spawnInfer(raw)
    if (!scored) {
      return {
        artifact: NATIVE_ROUTER_V1_ARTIFACT,
        predicted_class: 'SKIPPED',
        gate: 'SKIPPED',
        information_state: 'SKIPPED',
        deterministic: null,
        lexical: null,
        wrim: null,
        confidence: 0,
        margin: 0,
        abstain_state: 'INSUFFICIENT_CONTEXT',
        disagreement: false,
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

export function nativeRouterV1FieldsForProvenance(score: NativeRouterV1ShadowScore | null): Record<string, string> {
  if (!score) return {}
  return {
    native_router_v1_shadow: '1',
    native_router_v1_predicted: score.predicted_class,
    native_router_v1_current: score.current_route,
    native_router_v1_gate: score.gate,
    native_router_v1_state: score.information_state,
    native_router_v1_det: score.deterministic ?? '',
    native_router_v1_lex: score.lexical ?? '',
    native_router_v1_wrim: score.wrim ?? '',
    native_router_v1_abstain: score.abstain_state,
    native_router_v1_disagree: score.disagreement ? '1' : '0',
    native_router_v1_match: score.matches_observed ? '1' : '0',
    native_router_v1_alters_routing: '0',
  }
}
