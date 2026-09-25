import { randomUUID } from 'node:crypto'
import type { CommanderAttentionRequired, ExternalRiskClass } from './types'

export function createAttentionEvent(input: {
  reason: string
  missionId: string
  taskId: string
  application: string
  requestedAction: string
  risk?: ExternalRiskClass
  currentState: string
  whatFoundryNeeds: string
}): CommanderAttentionRequired {
  return {
    kind: 'COMMANDER_ATTENTION_REQUIRED',
    reason: input.reason,
    missionId: input.missionId,
    taskId: input.taskId,
    application: input.application,
    requestedAction: input.requestedAction,
    risk: input.risk ?? 'HIGH',
    currentState: input.currentState,
    whatFoundryNeeds: input.whatFoundryNeeds,
    resumeToken: randomUUID(),
  }
}

const CREDENTIAL = /password|secret|token|api[_-]?key|credential|login|sudo/i
const SPEND = /payment|invoice|checkout|purchase|billing|spend|quota/i
const DEPLOY = /live deploy|production deploy|git push|force push/i
const COMMIT = /\bgit commit\b|\bcommit and push\b/i
const DESTRUCTIVE = /rm -rf|delete all|format disk|drop database/i

export function classifyExternalSafety(action: string, text = ''): 'SAFE_AUTONOMOUS' | 'COMMANDER_APPROVAL_REQUIRED' | 'BLOCKED' {
  const blob = `${action}\n${text}`
  if (DESTRUCTIVE.test(blob)) return 'BLOCKED'
  if (CREDENTIAL.test(blob) || SPEND.test(blob) || DEPLOY.test(blob) || COMMIT.test(blob)) return 'COMMANDER_APPROVAL_REQUIRED'
  if (/security prompt|authenticator|passkey/i.test(blob)) return 'COMMANDER_APPROVAL_REQUIRED'
  return 'SAFE_AUTONOMOUS'
}
