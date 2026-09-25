/**
 * Startup recovery for persisted engineering campaigns.
 * Discovers non-terminal repair records and calls the existing runCodingMission.
 * Does not create a mission, edit phase, or write pauseAfter.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { parseJsonRecovering } from './foundryAtomicJson'
import { isCodingMissionRunning, runCodingMission } from './engineerLoop'
import { listWorkspaces } from './workspaceRegistry'

const TERMINAL_REPAIR_STATES = new Set(['resolved', 'cancelled', 'rolled_back'])
const TERMINAL_STEPS = new Set(['DONE', 'CANCELLED'])

const recoveryStarted = new Set<string>()
let recoveryPassStarted = false

export type CampaignRecoveryRecord = {
  id?: string
  state?: string
  codingMission?: {
    mode?: string
    currentStep?: string
    sessionId?: string
    engineeringRuntime?: {
      completion?: { canComplete?: boolean }
      blockedDetail?: unknown
      campaign?: { phase?: string; checkpoints?: string[]; missionId?: string; reasoningSessionId?: string | null }
    }
  }
}

export function isRecoverableEngineeringCampaign(record: CampaignRecoveryRecord | null | undefined): boolean {
  if (!record?.id || !record.codingMission) return false
  if (record.codingMission.mode !== 'bounded_coding') return false
  if (record.state && TERMINAL_REPAIR_STATES.has(record.state)) return false
  if (record.codingMission.currentStep && TERMINAL_STEPS.has(record.codingMission.currentStep)) return false
  if (record.codingMission.engineeringRuntime?.completion?.canComplete) return false
  if (record.codingMission.engineeringRuntime?.blockedDetail) return false
  const phase = record.codingMission.engineeringRuntime?.campaign?.phase
  return Boolean(phase && phase !== 'COMPLETE')
}

export async function recoverActiveEngineeringCampaigns(): Promise<{
  started: string[]
  duplicateRecoveryStartCount: number
}> {
  if (recoveryPassStarted) return { started: [], duplicateRecoveryStartCount: 1 }
  recoveryPassStarted = true
  const started: string[] = []
  let duplicateRecoveryStartCount = 0
  const workspaces = await listWorkspaces('engine')
  for (const workspace of workspaces) {
    const dir = path.join(workspace.root, '.war-room', 'native-builder', 'repairs')
    let names: string[] = []
    try {
      names = (await readdir(dir)).filter(name => name.endsWith('.json'))
    } catch {
      continue
    }
    for (const name of names) {
      let record: CampaignRecoveryRecord
      try {
        const parsed = parseJsonRecovering<CampaignRecoveryRecord>(await readFile(path.join(dir, name), 'utf8'))
        if (!parsed.ok) continue
        record = parsed.value
      } catch {
        continue
      }
      if (!isRecoverableEngineeringCampaign(record) || !record.id) continue
      if (recoveryStarted.has(record.id) || isCodingMissionRunning(record.id)) {
        duplicateRecoveryStartCount += 1
        continue
      }
      recoveryStarted.add(record.id)
      started.push(record.id)
      const repairId = record.id
      const root = workspace.root
      void runWithWorkspaceRoot(root, () => runCodingMission(repairId)).catch(() => undefined)
    }
  }
  return { started, duplicateRecoveryStartCount }
}
