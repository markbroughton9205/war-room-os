/**
 * Foundry agent-loop helpers used by Mission Controller.
 * Bounded turns, incomplete-intent retry, consecutive tool-failure halt,
 * abort checks, and display/llm result split adapted from kkkhs/ClawdCode Agent.ts
 * (MIT, commit 217a01369f9cb7d1ccc89c1fd9f50d6db2965b81, Copyright (c) 2026).
 * See docs/third-party/clawdcode.md.
 *
 * This is not a second Mission Controller. Foundry remains authoritative.
 */
import { appendFoundryAgentEvent } from './foundryAgentEvents'
import { isFoundryAgentAborted, thrownIfFoundryAgentAborted } from './foundryAgentCancellation'
import { redactSecretLikeText } from './foundrySensitivePathGuard'
import type { FoundryMissionRecord } from './foundryMissionTypes'

export const FOUNDRY_AGENT_TURN_LIMIT = 100
export const FOUNDRY_MAX_CONSECUTIVE_TOOL_FAILURES = 3

const INCOMPLETE_INTENT_PATTERNS = [
  /:\s*$/,
  /\.\.\.\s*$/,
  /Let me (first|start|check|look|fix)/i,
]

export type FoundryNormalizedToolResult = {
  success: boolean
  displayContent: string
  llmContent: string
  error?: string
}

export function detectIncompleteIntent(content: string | undefined): boolean {
  if (!content) return false
  return INCOMPLETE_INTENT_PATTERNS.some(pattern => pattern.test(content.trim()))
}

export function boundFoundryTurns(requested?: number): number {
  if (!requested || requested < 0) return FOUNDRY_AGENT_TURN_LIMIT
  if (requested === 0) return 0
  return Math.min(requested, FOUNDRY_AGENT_TURN_LIMIT)
}

export function normalizeFoundryToolResult(input: {
  ok: boolean
  tool: string
  result?: unknown
  error?: string
}): FoundryNormalizedToolResult {
  const raw = input.ok
    ? (typeof input.result === 'string' ? input.result : safeJson(input.result))
    : (input.error ?? 'tool failed')
  const text = redactSecretLikeText(String(raw ?? '')).slice(0, 4_000)
  return {
    success: input.ok,
    displayContent: `${input.ok ? 'ok' : 'FAIL'} ${input.tool}: ${text.slice(0, 800)}`,
    llmContent: text,
    error: input.ok ? undefined : text,
  }
}

export function noteConsecutiveToolFailure(mission: FoundryMissionRecord, failed: boolean): { halt: boolean; count: number } {
  const current = Number(mission.modelState?.consecutiveFailures ?? 0)
  const next = failed ? current + 1 : 0
  if (mission.modelState) mission.modelState.consecutiveFailures = next
  return { halt: next >= FOUNDRY_MAX_CONSECUTIVE_TOOL_FAILURES, count: next }
}

export function assertFoundryLoopMayContinue(mission: FoundryMissionRecord): void {
  if (mission.cancelRequested || isFoundryAgentAborted(mission.missionId)) {
    thrownIfFoundryAgentAborted(mission.missionId, 'agent loop')
  }
}

export function emitLoopProgress(
  mission: FoundryMissionRecord,
  type: Parameters<typeof appendFoundryAgentEvent>[1],
  text: string,
  extra?: Parameters<typeof appendFoundryAgentEvent>[3],
): void {
  appendFoundryAgentEvent(mission, type, text, extra)
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    return String(value)
  }
}
