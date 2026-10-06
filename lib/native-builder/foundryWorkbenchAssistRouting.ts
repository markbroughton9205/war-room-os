/**
 * The one place a workbench assist question goes to the model router (shared by the W2 editor assist and the W4 source-control review).
 * A router answer is `routed.response`. Assist never writes project files; authenticated context selection persists binding metadata.
 */
import { FoundryModelRouter } from './foundryModelRouter'
import type { FoundryModelContext, FoundryModelRequest } from './foundryModelTypes'
import { classifyFoundrySensitivePath, redactSecretLikeText } from './foundrySensitivePathGuard'
import type { FoundryEditorContextEnvelope } from './foundryEditorContext'
import { loadMission } from './foundryMissionStore'
import { validateWorkspaceRoot } from './foundryWorkspaceBinding'
import { getWorkspace } from './workspaceRegistry'
import { FOUNDRY_MISSION_STATES } from './foundryMissionTypes'
import { getFoundrySession } from './foundrySessions'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { foundryWorkbenchStateDir } from './foundryWorkbenchW0.host'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

export function useDeterministicAssist(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.FOUNDRY_WORKBENCH_W2_DETERMINISTIC ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

export function emptyModelContext(instruction: string, envelope: FoundryEditorContextEnvelope, missionId: string): FoundryModelContext {
  return {
    missionId,
    missionKind: 'fixture',
    userRequest: redactSecretLikeText(instruction),
    goal: redactSecretLikeText(instruction),
    successCriteria: ['Return a bounded Foundry editor assist response.'],
    constraints: ['Do not write files. Propose JSON only.'],
    permissions: {
      filesystem: false,
      terminal: false,
      browser: false,
      computerUse: false,
      tests: false,
      lint: false,
      typecheck: false,
      build: false,
      package: false,
      installProduction: false,
      activateInstall: false,
      installedRuntimeControl: false,
      process: false,
      commit: false,
      push: false,
      liveDeploy: false,
      internetResearch: false,
    },
    phase: 'EXECUTING',
    plan: [],
    hypotheses: [],
    changedFiles: [],
    importantFindings: [],
    relevantExcerpts: [
      { source: envelope.activeFile || 'selection', text: redactSecretLikeText(envelope.selection.text).slice(0, 4000) },
      ...(envelope.nearbyLines ? [{ source: 'nearby', text: redactSecretLikeText(envelope.nearbyLines).slice(0, 4000) }] : []),
    ],
    visualEvidence: [],
    recentToolResults: [],
    recentErrors: [],
    unresolvedQuestions: [],
    completionGate: { complete: false, missing: [], detail: 'W2 editor assist' },
    tools: [],
  }
}

export class WorkbenchAssistPolicyError extends Error {
  readonly code = 'WORKBENCH_ASSIST_POLICY_REFUSED'
}

function refuse(reason: string): never {
  throw new WorkbenchAssistPolicyError(reason)
}

function checkAssistSourcePaths(envelope: FoundryEditorContextEnvelope): void {
  const paths = [envelope.activeFile, ...(envelope.git?.changedFiles ?? []),
    ...(envelope.git?.boundedDiffHunks ?? []).map(hunk => hunk.file),
    ...(envelope.gitDiffHunks ?? []).map(hunk => hunk.file)]
  for (const file of paths) {
    if (file && classifyFoundrySensitivePath(file).refuseRead) {
      refuse('Sensitive source paths cannot be sent to Workbench model assist.')
    }
  }
  if (envelope.sensitive?.blocked) refuse('Workbench source context is blocked.')
}

async function verifiedOwner(owningMissionId: string | undefined, envelope: Pick<FoundryEditorContextEnvelope, 'workspaceRoot'>) {
  if (!owningMissionId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(owningMissionId)) {
    return refuse('A verified owning mission is required for Workbench model assist.')
  }
  const mission = await loadMission(owningMissionId)
  if (!mission || mission.missionId !== owningMissionId) return refuse('The owning mission could not be resolved.')
  if (!FOUNDRY_MISSION_STATES.includes(mission.status) || ['COMPLETE', 'CANCELLED', 'FAILED'].includes(mission.status) || mission.archived) {
    return refuse('The owning mission is not active for Workbench assist.')
  }
  const policy: unknown = mission.modelPolicy
  // Older missing policies are ambiguous; do not silently infer AUTO authorization.
  if (policy !== 'AUTO' && policy !== 'LOCAL_ONLY') return refuse('The owning mission has no explicit resolvable model policy.')
  const binding = mission.workspaceBinding
  if (!binding?.workspaceId || !binding.workspaceRoot) return refuse('The owning mission has no verified workspace binding.')
  const registry = await getWorkspace(binding.workspaceId)
  if (!registry || registry.id !== binding.workspaceId) return refuse('The owning workspace no longer exists in the registry.')
  const bound = await validateWorkspaceRoot(binding.workspaceRoot)
  const active = await validateWorkspaceRoot(envelope.workspaceRoot)
  const registered = await validateWorkspaceRoot(registry.root)
  if (!bound.ok || !active.ok || !registered.ok || bound.root !== binding.workspaceRoot
      || bound.root !== active.root || bound.root !== registered.root) {
    return refuse('Workbench context does not match the owning mission workspace.')
  }
  if (mission.workspace && mission.workspace !== bound.root) return refuse('The owning mission carries inconsistent workspace paths.')
  const pin = mission.pinnedModel
  const providers = ['cursor-agent', 'openai', 'anthropic', 'gemini', 'xai', 'kimi', 'deepseek', 'openai-compatible', 'ollama', 'wrim'] as const
  const pinProvider = pin ? providers.find(provider => provider === pin.provider) : undefined
  const activeProvider = mission.modelState?.activeProvider
  const verifiedActiveProvider = activeProvider ? providers.find(provider => provider === activeProvider) : undefined
  if (policy === 'AUTO' && activeProvider && !verifiedActiveProvider) return refuse('The owning mission active provider is invalid.')
  if (pin && (!pinProvider || typeof pin.modelId !== 'string' || !pin.modelId.trim())) return refuse('The owning mission model pin is invalid.')
  if (policy === 'LOCAL_ONLY' && pinProvider && pinProvider !== 'ollama') return refuse('The owning mission model pin conflicts with Local Only.')
  return { missionId: mission.missionId, policy, root: bound.root, workspaceId: binding.workspaceId,
    pinProvider: pinProvider ?? (policy === 'AUTO' ? verifiedActiveProvider : undefined), pinModel: pin?.modelId, updatedAt: mission.updatedAt, status: mission.status }
}

type WorkbenchOwnerBinding = { bindingId: string; owningMissionId: string; sessionId: string; workspaceRoot: string }
function ownerBindingPath(): string {
  const root = process.env.FOUNDRY_WORKBENCH_STATE_DIR ? path.resolve(process.env.FOUNDRY_WORKBENCH_STATE_DIR) : foundryWorkbenchStateDir()
  return path.join(root, 'assist-owner.json')
}
export function readWorkbenchAssistBinding(): WorkbenchOwnerBinding | null {
  try { return JSON.parse(readFileSync(ownerBindingPath(), 'utf8')) as WorkbenchOwnerBinding } catch { return null }
}
async function verifiedSession(sessionId: string, owner: Awaited<ReturnType<typeof verifiedOwner>>) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId)) return refuse('A valid owning session is required.')
  const session = await runWithWorkspaceRoot(owner.root, () => getFoundrySession(sessionId), owner.workspaceId)
  if (!session || session.id !== sessionId || session.archived || session.workspaceId !== owner.workspaceId
      || session.activeMissionId !== owner.missionId || !session.missionIds.includes(owner.missionId)) {
    return refuse('The selected session does not own this active mission and workspace.')
  }
  return session
}
function storeOwnerBinding(binding: WorkbenchOwnerBinding): void {
  const file = ownerBindingPath()
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(binding), { mode: 0o600, flag: 'wx' })
  renameSync(temporary, file)
}
// Clear first: failed, missing and superseded context selections cannot reuse the old owner.
export function clearWorkbenchAssistBinding(): string {
  const bindingId = randomUUID()
  storeOwnerBinding({ bindingId, owningMissionId: '', sessionId: '', workspaceRoot: '' })
  return bindingId
}
// Called only by the authenticated editor API for an explicit Commander context selection.
export async function bindWorkbenchAssistOwner(owningMissionId: string, sessionId: string, workspaceRoot: string,
  selectionId: string, signal?: AbortSignal): Promise<WorkbenchOwnerBinding> {
  const owner = await verifiedOwner(owningMissionId, { workspaceRoot })
  await verifiedSession(sessionId, owner)
  if (signal?.aborted || readWorkbenchAssistBinding()?.bindingId !== selectionId) return refuse('Workbench selection was superseded.')
  const binding = { bindingId: selectionId, owningMissionId, sessionId, workspaceRoot: owner.root }
  storeOwnerBinding(binding)
  return binding
}
async function verifiedBoundOwner(owningMissionId: string | undefined, bindingId: string | undefined, envelope: FoundryEditorContextEnvelope) {
  const binding = readWorkbenchAssistBinding()
  if (!binding || !bindingId || binding.bindingId !== bindingId || binding.owningMissionId !== owningMissionId) {
    return refuse('Workbench context selection is missing or stale; select its owning mission again.')
  }
  const owner = await verifiedOwner(owningMissionId, envelope)
  const session = await verifiedSession(binding.sessionId, owner)
  if (binding.workspaceRoot !== owner.root) return refuse('Workbench context binding no longer matches the owning workspace.')
  if (JSON.stringify(readWorkbenchAssistBinding()) !== JSON.stringify(binding)) return refuse('Workbench selection changed during verification.')
  return { ...owner, bindingId: binding.bindingId, sessionId: session.id, sessionUpdatedAt: session.updatedAt }
}

export async function routeWorkbenchAssist(instruction: string, envelope: FoundryEditorContextEnvelope,
  owningMissionId?: string, bindingId?: string): Promise<{ text: string; provider: string; model: string | null } | null> {
  checkAssistSourcePaths(envelope)
  const owner = await verifiedBoundOwner(owningMissionId, bindingId, envelope)
  const request: FoundryModelRequest = {
    kind: 'summarizeProgress',
    context: emptyModelContext(instruction, envelope, owner.missionId),
    requireLoopback: owner.policy === 'LOCAL_ONLY',
  }
  const router = new FoundryModelRouter()
  const latest = await verifiedBoundOwner(owningMissionId, bindingId, envelope)
  if (JSON.stringify(latest) !== JSON.stringify(owner)) return refuse('Owning mission policy or binding changed; retry after re-verification.')
  const currentBinding = readWorkbenchAssistBinding()
  if (!currentBinding || currentBinding.bindingId !== owner.bindingId || currentBinding.owningMissionId !== owner.missionId
      || currentBinding.sessionId !== owner.sessionId || currentBinding.workspaceRoot !== owner.root) return refuse('Workbench selection changed before invocation.')
  if (useDeterministicAssist()) return null
  // Policy is read from the persisted owner, never from caller providerClass or envelope flags.
  const routed = await router.route('summarizeProgress', request, owner.policy === 'LOCAL_ONLY'
    ? { missionId: owner.missionId, requireLoopback: true, pinProvider: 'ollama', pinModel: owner.pinModel }
    : { missionId: owner.missionId, pinProvider: owner.pinProvider, pinModel: owner.pinModel })
  if (!routed.response.ok) return refuse('The owning mission model policy could not produce an assist response.')
  if ((owner.policy === 'LOCAL_ONLY' && routed.response.provider !== 'ollama')
      || (owner.pinProvider && routed.response.provider !== owner.pinProvider)
      || (owner.pinModel && routed.response.model !== owner.pinModel)) return refuse('The model response did not match the verified owning mission policy.')
  const text = routed.response.rawText || routed.response.decision.reasoningSummary || ''
  return { text, provider: routed.response.provider, model: routed.response.model }
}
