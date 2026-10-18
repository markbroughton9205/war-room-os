/**
 * BOUNDED_RETRY action lock and a narrow tool-name coercion.
 * Does not guess intent. Does not reinterpret arbitrary model output.
 */
import type { FoundryMissionRecord } from './foundryMissionTypes'
import { ensureEngineeringState } from './foundryEngineeringDepth'

const BOUNDED_EDIT_TOOL = 'file.replace_unique' as const

export type BoundedRetryLock = {
  currentState: 'BOUNDED_RETRY'
  requiredTool: typeof BOUNDED_EDIT_TOOL
  currentAnchorId: string
  currentPath: string
}

export function boundedRetryLockFromMission(mission: FoundryMissionRecord): BoundedRetryLock | null {
  const recovery = ensureEngineeringState(mission).editMatchRecovery
  if (!recovery || recovery.nextRequiredAction !== 'BOUNDED_RETRY') return null
  return {
    currentState: 'BOUNDED_RETRY',
    requiredTool: BOUNDED_EDIT_TOOL,
    currentAnchorId: recovery.lastAnchorId ?? '',
    currentPath: recovery.path,
  }
}

export function focusedReadRequired(mission: FoundryMissionRecord): boolean {
  const recovery = ensureEngineeringState(mission).editMatchRecovery
  return recovery?.nextRequiredAction === 'FOCUSED_READ'
}

function looksLikeReplaceUniquePayload(args: Record<string, unknown>, currentAnchorId: string): boolean {
  if (!currentAnchorId) return false
  if (typeof args.path !== 'string' || !args.path.trim()) return false
  if (typeof args.replacementText !== 'string' || !args.replacementText.length) return false
  if (args.anchorId !== currentAnchorId) return false
  const readShaped = args.startLine != null
    || args.endLine != null
    || typeof args.aroundMatch === 'string'
    || typeof args.query === 'string'
    || typeof args.symbol === 'string'
  return !readShaped
}

export function normalizeBoundedRetryToolName(input: {
  state?: string
  requestedName: string
  args: Record<string, unknown>
  currentAnchorId?: string
  onlyOneLegalTool?: boolean
}): { name: string; normalized: boolean } {
  if (input.state !== 'BOUNDED_RETRY') return { name: input.requestedName, normalized: false }
  if (input.onlyOneLegalTool !== true) return { name: input.requestedName, normalized: false }
  if (input.requestedName === BOUNDED_EDIT_TOOL) return { name: input.requestedName, normalized: false }
  const knownWrong = input.requestedName === 'file.read'
    || input.requestedName === 'file.write'
    || input.requestedName === 'file.patch'
  if (!knownWrong) return { name: input.requestedName, normalized: false }
  if (!looksLikeReplaceUniquePayload(input.args, input.currentAnchorId ?? '')) {
    return { name: input.requestedName, normalized: false }
  }
  return { name: BOUNDED_EDIT_TOOL, normalized: true }
}

export function actionNotAllowedInBoundedRetry(mission: FoundryMissionRecord, tool: string): string | null {
  const lock = boundedRetryLockFromMission(mission)
  if (!lock) return null
  if (tool === BOUNDED_EDIT_TOOL) return null
  return [
    'ACTION_NOT_ALLOWED_IN_STATE',
    'CURRENT_STATE = BOUNDED_RETRY',
    `REQUIRED_TOOL = ${BOUNDED_EDIT_TOOL}`,
    `ANCHOR_ID = ${lock.currentAnchorId || 'none'}`,
  ].join('\n')
}

function parseBindingList(error: string, label: string): string[] {
  const match = new RegExp(`${label} = \\[([^\\]]*)\\]`).exec(error)
  if (!match) return []
  return match[1].split(',').map(item => item.trim()).filter(Boolean)
}

export function compactBoundedRetryGuidance(mission: FoundryMissionRecord): string {
  const lock = boundedRetryLockFromMission(mission)
  if (!lock) return ''
  const engineering = ensureEngineeringState(mission)
  const anchor = (engineering.editAnchors ?? []).find(item => item.anchorId === lock.currentAnchorId)
  const bindings = anchor?.protectedBindings ?? []
  const lastFail = [...mission.toolCalls].reverse().find(call => call.tool === BOUNDED_EDIT_TOOL && !call.ok)
  const failure = lastFail?.error ?? engineering.editMatchRecovery?.code ?? ''
  const missing = parseBindingList(failure, 'MISSING_BINDINGS')
  const required = parseBindingList(failure, 'CURRENT_REQUIRED_BINDINGS')
  return [
    'CURRENT_STATE=BOUNDED_RETRY',
    'NEXT_REQUIRED_ACTION=file.replace_unique',
    `ANCHOR_ID=${lock.currentAnchorId || 'none'}`,
    `ANCHOR_TEXT=${(anchor?.anchorText ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)}`,
    `PROTECTED_BINDINGS=${JSON.stringify(bindings)}`,
    `CURRENT_REQUIRED_BINDINGS=${JSON.stringify(required.length ? required : bindings)}`,
    `MISSING_BINDINGS=${JSON.stringify(missing)}`,
    `EDITABLE_REGION=lines ${anchor?.startLine ?? '?'}-${anchor?.endLine ?? '?'}`,
    `EXPECTED_FILE_SHA256=${anchor?.sha256 ?? ''}`,
    `CHANGE_GOAL=${mission.userRequest.slice(0, 200)}`,
    'EDIT_INTENT=MINIMAL PRESERVING EDIT',
    `LATEST_FAILURE=${failure.slice(0, 700)}`,
    'Keep ANCHOR_TEXT structure. Keep every PRESENT / PROTECTED binding. If MISSING_BINDINGS is not empty, append JSX that reads each missing identifier exactly, like {the.missing.binding}. Do not invent copy. Do not drop required status bindings. Do not reconstruct matchText. Do not file.read. Call file.replace_unique with ANCHOR_ID, path, replacementText, and reason.',
  ].join('\n')
}
