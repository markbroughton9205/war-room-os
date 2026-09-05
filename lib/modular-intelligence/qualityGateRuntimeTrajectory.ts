import { createHash } from 'node:crypto'
import type { CapturedRuntimeTrajectory } from './runtimeTrajectoryCapture'

export const QUALITY_LABELS = ['VERIFIED', 'SUPPORTED', 'PARTIAL', 'UNKNOWN', 'REJECT'] as const
export type QualityLabel = (typeof QUALITY_LABELS)[number]

export type QualityGateResult = {
  trajectory_id: string
  quality_label: QualityLabel
  review_state_unchanged: 'RAW'
  auto_verified: false
  auto_curriculum: false
  usable_supervised_gold: boolean
  reasons: string[]
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function digestFromResult(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const rec = result as Record<string, unknown>
  const inner = rec.result
  if (inner && typeof inner === 'object' && 'digest' in inner) {
    return String((inner as { digest: unknown }).digest)
  }
  if (typeof rec.digest === 'string') return rec.digest
  return null
}

export function qualityGateCapturedTrajectory(raw: CapturedRuntimeTrajectory): QualityGateResult {
  const reasons: string[] = []
  if (raw.review_state !== 'RAW') reasons.push('review_state_not_raw')
  if (raw.secrets_redacted.length > 0 && JSON.stringify(raw).includes('Bearer ')) {
    return {
      trajectory_id: raw.trajectory_id,
      quality_label: 'REJECT',
      review_state_unchanged: 'RAW',
      auto_verified: false,
      auto_curriculum: false,
      usable_supervised_gold: false,
      reasons: ['unsanitized_secret'],
    }
  }

  const requestOk = Boolean(raw.request?.trim())
  const toolOk = raw.decision === 'NO_TOOL' || Boolean(raw.selected_tool)
  const argsOk =
    raw.decision === 'NO_TOOL'
      ? true
      : Object.keys(raw.arguments).length > 0 || raw.router_validation_status === 'MISSING_ARGUMENT'
  const validationOk = raw.router_validation_status != null
  const resultOk = raw.tool_result_status != null

  if (!requestOk) {
    return {
      trajectory_id: raw.trajectory_id,
      quality_label: 'UNKNOWN',
      review_state_unchanged: 'RAW',
      auto_verified: false,
      auto_curriculum: false,
      usable_supervised_gold: false,
      reasons: ['missing_request'],
    }
  }

  if (raw.source_type !== 'REAL_RUNTIME') {
    reasons.push(`source_${raw.source_type}`)
  }

  if (raw.selected_tool === 'sha256' && raw.tool_result_status === 'ok') {
    const digest = digestFromResult(raw.tool_result)
    const text = raw.arguments.text
    if (digest && text && digest === sha256Hex(text)) {
      reasons.push('sha256_digest_matches')
      const usable = raw.source_type === 'REAL_RUNTIME' || raw.source_type === 'REAL_TEST'
      return {
        trajectory_id: raw.trajectory_id,
        quality_label: 'VERIFIED',
        review_state_unchanged: 'RAW',
        auto_verified: false,
        auto_curriculum: false,
        usable_supervised_gold: usable,
        reasons,
      }
    }
  }

  if (raw.decision === 'NO_TOOL' && validationOk && requestOk) {
    reasons.push('no_tool_router_or_chat')
    const usable = raw.source_type === 'REAL_RUNTIME' || raw.source_type === 'REAL_TEST'
    return {
      trajectory_id: raw.trajectory_id,
      quality_label: 'SUPPORTED',
      review_state_unchanged: 'RAW',
      auto_verified: false,
      auto_curriculum: false,
      usable_supervised_gold: usable,
      reasons,
    }
  }

  if (
    raw.decision === 'TOOL' &&
    toolOk &&
    argsOk &&
    validationOk &&
    resultOk &&
    (raw.tool_result_status === 'ok' || raw.tool_result_status === 'error' || raw.tool_result_status === 'dry_run')
  ) {
    const complete =
      raw.tool_result_status === 'ok' && Object.keys(raw.arguments).length > 0
    const gold =
      complete && (raw.source_type === 'REAL_RUNTIME' || raw.source_type === 'REAL_TEST')
    const supportedComplete =
      complete &&
      (raw.source_type === 'REAL_RUNTIME' ||
        raw.source_type === 'REAL_TEST' ||
        raw.source_type === 'TEST_FIXTURE')
    reasons.push(
      gold
        ? 'runtime_tool_complete'
        : supportedComplete
          ? 'fixture_or_test_tool_complete'
          : 'runtime_tool_partial_or_failure',
    )
    return {
      trajectory_id: raw.trajectory_id,
      quality_label: supportedComplete ? 'SUPPORTED' : 'PARTIAL',
      review_state_unchanged: 'RAW',
      auto_verified: false,
      auto_curriculum: false,
      usable_supervised_gold: gold,
      reasons,
    }
  }

  if (raw.router_validation_status && raw.router_validation_status !== 'VALID') {
    reasons.push('validation_failure_honest')
    return {
      trajectory_id: raw.trajectory_id,
      quality_label: 'SUPPORTED',
      review_state_unchanged: 'RAW',
      auto_verified: false,
      auto_curriculum: false,
      usable_supervised_gold: false,
      reasons,
    }
  }

  return {
    trajectory_id: raw.trajectory_id,
    quality_label: 'PARTIAL',
    review_state_unchanged: 'RAW',
    auto_verified: false,
    auto_curriculum: false,
    usable_supervised_gold: false,
    reasons: reasons.length ? reasons : ['incomplete_fields'],
  }
}
