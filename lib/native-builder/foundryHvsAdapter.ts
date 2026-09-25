/**
 * Foundry → HVS adapter. Foundry owns MissionContract / tool selection / CompletionTruth.
 * HVS owns .hvsproj, EditOps, media, QC. This file must not become a second project store.
 */
import {
  executeHvsTool,
  HVS_TOOL_NAMES,
  isHvsToolName,
  listReceipts,
  type HvsToolName,
  type HvsToolReceipt,
} from '@/lib/media-command/tool-kernel'

export const HVS_FOUNDRY_TOOL_NAMES = HVS_TOOL_NAMES
export type HvsFoundryToolName = HvsToolName

export function isHvsFoundryToolName(value: string): value is HvsFoundryToolName {
  return isHvsToolName(value)
}

export type FoundryHvsToolResult = {
  ok: boolean
  tool: HvsFoundryToolName
  result?: unknown
  error?: string
}

export type FoundryHvsCompletionEvidence = {
  surface: 'hvs_kernel'
  canComplete: boolean
  projectId: string | null
  requiredTools: HvsToolName[]
  presentTools: string[]
  missingTools: string[]
  receipts: Array<{
    jobId: string
    toolName: string
    status: string
    argumentsHash: string
    hashes: Record<string, string>
    qcState: string
    outputAssetRefs: HvsToolReceipt['outputAssetRefs']
    errors: string[]
  }>
  qcState: string | null
  masterHash: string | null
  proxyHash: string | null
  headline: string
  detail: string
}

const ACCEPTANCE_TOOLS: HvsToolName[] = [
  'hvs.project.create',
  'hvs.project.save',
  'hvs.project.open',
  'hvs.timeline.insert',
  'hvs.ffmpeg.probe',
  'hvs.ffmpeg.proxy',
  'hvs.ffmpeg.master',
  'hvs.qc.run',
]

export async function executeFoundryHvsTool(
  tool: HvsFoundryToolName,
  input: Record<string, unknown>,
  ctx: { repairId: string; mission?: { missionId?: string } | null },
): Promise<FoundryHvsToolResult> {
  const executed = await executeHvsTool(tool, input, {
    missionId: ctx.mission?.missionId ?? ctx.repairId,
    actorId: ctx.mission?.missionId ?? ctx.repairId,
  })
  return {
    ok: executed.ok,
    tool,
    result: {
      receipt: executed.receipt,
      evidence: executed.receipt.result ?? null,
    },
    error: executed.error,
  }
}

export function buildFoundryHvsCompletionEvidence(
  projectId: string | null,
  receipts: HvsToolReceipt[] = projectId ? listReceipts(projectId) : [],
): FoundryHvsCompletionEvidence {
  const completed = receipts.filter(row => row.status === 'COMPLETED')
  const present = new Set(completed.map(row => row.toolName))
  const missing = ACCEPTANCE_TOOLS.filter(name => !present.has(name))
  const qc = [...completed].reverse().find(row => row.toolName === 'hvs.qc.run')
  const master = [...completed].reverse().find(row => row.toolName === 'hvs.ffmpeg.master')
  const proxy = [...completed].reverse().find(row => row.toolName === 'hvs.ffmpeg.proxy')
  const canComplete = missing.length === 0
    && Boolean(master?.hashes.master)
    && Boolean(qc)
    && qc?.qcState !== 'FAIL'
  return {
    surface: 'hvs_kernel',
    canComplete,
    projectId,
    requiredTools: ACCEPTANCE_TOOLS,
    presentTools: [...present],
    missingTools: missing,
    receipts: receipts.map(row => ({
      jobId: row.jobId,
      toolName: row.toolName,
      status: row.status,
      argumentsHash: row.argumentsHash,
      hashes: row.hashes,
      qcState: row.qcState,
      outputAssetRefs: row.outputAssetRefs,
      errors: row.errors,
    })),
    qcState: qc?.qcState ?? null,
    masterHash: master?.hashes.master ?? null,
    proxyHash: proxy?.hashes.proxy ?? null,
    headline: canComplete
      ? 'HVS kernel completion is proven by receipts and hashes, not prose.'
      : 'HVS kernel completion is blocked until required receipts exist.',
    detail: canComplete
      ? `QC=${qc?.qcState ?? 'NOT_RUN'} master=${master?.hashes.master ?? 'none'} proxy=${proxy?.hashes.proxy ?? 'none'}`
      : `Missing: ${missing.join(', ') || 'none'}.`,
  }
}
