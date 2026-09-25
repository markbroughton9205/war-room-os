/**
 * FHVS tool-kernel contracts. HVS owns .hvsproj + EditOps.
 * Foundry may call these tools; it must not store a second project database.
 */
import type { AssetRole } from '../types'

export const HVS_TOOL_NAMES = [
  'hvs.project.create',
  'hvs.project.open',
  'hvs.project.save',
  'hvs.timeline.insert',
  'hvs.timeline.remove',
  'hvs.timeline.undo',
  'hvs.ffmpeg.probe',
  'hvs.ffmpeg.proxy',
  'hvs.ffmpeg.master',
  'hvs.qc.run',
] as const

export type HvsToolName = (typeof HVS_TOOL_NAMES)[number]

export function isHvsToolName(value: string): value is HvsToolName {
  return (HVS_TOOL_NAMES as readonly string[]).includes(value)
}

export const HVS_MASTER_BASELINE_V1 = {
  id: 'hvs-master-baseline-v1',
  container: 'mp4',
  videoCodec: 'libx264',
  videoPreset: 'medium',
  crf: 18,
  pixelFormat: 'yuv420p',
  audioCodec: 'aac',
  audioBitrate: '192k',
  audioRate: 48000,
  policyClass: 'SOFTWARE_FALLBACK_MASTER',
} as const

export const HVS_PROXY_BASELINE_V1 = {
  id: 'hvs-proxy-v1',
  maxWidth: 1280,
  videoCodec: 'libx264',
  audioCodec: 'aac',
  fps: 24,
  preset: 'veryfast',
  crf: 23,
  policyClass: 'SOFTWARE_PREVIEW_PROXY',
  role: 'PROXY' as const,
}

export type HvsEditOpType = 'insert' | 'remove' | 'undo'

export type HvsEditOpV1 = {
  schema: 'hvs.edit.v1'
  operationId: string
  projectId: string
  actorId: string
  missionId: string | null
  operationType: HvsEditOpType
  target: { trackId?: string; clipId?: string; assetId?: string }
  args: Record<string, unknown>
  timestamp: string
  mode: 'preview' | 'commit'
  previousStateRef: string | null
  resultingStateRef: string | null
}

export type HvsReceiptStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'REFUSED'

export type HvsQcState = 'PASS' | 'FAIL' | 'NEEDS_HUMAN' | 'NOT_RUN'

export type HvsAuthorityClass = 'LOCAL_MEDIA' | 'REFUSED'

export type HvsOutputAssetRef = {
  id: string
  role: AssetRole | string
  path: string
  hash: string | null
}

export type HvsToolReceipt = {
  schema: 'hvs.receipt.v1'
  jobId: string
  missionId: string | null
  projectId: string | null
  toolName: HvsToolName | string
  argumentsHash: string
  startedAt: string
  completedAt: string | null
  status: HvsReceiptStatus
  outputAssetRefs: HvsOutputAssetRef[]
  hashes: Record<string, string>
  qcState: HvsQcState
  errors: string[]
  authorityClass: HvsAuthorityClass
  editOp?: HvsEditOpV1 | null
  result?: unknown
}

export type HvsToolContext = {
  missionId?: string | null
  actorId?: string
}

export type HvsToolResult = {
  ok: boolean
  tool: string
  receipt: HvsToolReceipt
  error?: string
}

export type HvsProbeStreamVideo = {
  codec: string | null
  width: number | null
  height: number | null
  frameRate: string | null
  pixelFormat: string | null
  rotation: number | null
}

export type HvsProbeStreamAudio = {
  codec: string | null
  sampleRate: number | null
  channels: number | null
}

export type HvsProbeResult = {
  path: string
  durationSec: number
  videoStreams: HvsProbeStreamVideo[]
  audioStreams: HvsProbeStreamAudio[]
  codec: string | null
  width: number | null
  height: number | null
  frameRate: string | null
  sampleRate: number | null
  channelCount: number | null
  pixelFormat: string | null
  rotation: number | null
  contentHash: string | null
  sourceHash: string | null
  probedAt: string
}

export type HvsQcCheck = {
  id: string
  status: HvsQcState
  detail: string
}

export type HvsQcReport = {
  schema: 'hvs.qc.v1'
  path: string
  outcome: Exclude<HvsQcState, 'NOT_RUN'>
  hash: string | null
  durationSec: number | null
  checks: HvsQcCheck[]
  ranAt: string
}
