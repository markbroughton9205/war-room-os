/**
 * Prompt-first production session sidecar.
 * Not project truth. .hvsproj remains the timeline / version / asset source of truth.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'
import { idleProgress } from './production-language'
import type { HvsProductionIntent, HvsProductionSession } from './production-ai-types'
import { HVS_PRODUCTION_SESSION_SCHEMA } from './production-ai-types'

export function projectProductionSessionPath(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().projects, projectId)
  return path.join(dir, 'production-session.json')
}

export function emptyProductionSession(intent: HvsProductionIntent): HvsProductionSession {
  const now = new Date().toISOString()
  return {
    schemaVersion: HVS_PRODUCTION_SESSION_SCHEMA,
    projectId: intent.projectId,
    intent,
    plan: null,
    progress: idleProgress(),
    result: null,
    pendingRevision: null,
    pendingPatch: null,
    approvedAt: null,
    executedAt: null,
    updatedAt: now,
    currentStep: null,
    completedSteps: [],
    failedStep: null,
    lastSafeVersion: null,
    jobIds: [],
    selector: null,
    previewShots: [],
    variants: [],
    warRoomConversationId: null,
    captionStyle: null,
    asrStatus: null,
    transcriptAssetIds: [],
    asrWordLevel: false,
    workflow: undefined,
    lessonConstraintIds: undefined,
    lessonConstraintCount: undefined,
    creativeIntelligence: undefined,
  }
}

function withSessionDefaults(parsed: HvsProductionSession): HvsProductionSession {
  return {
    ...parsed,
    currentStep: parsed.currentStep ?? null,
    completedSteps: parsed.completedSteps ?? [],
    failedStep: parsed.failedStep ?? null,
    lastSafeVersion: parsed.lastSafeVersion ?? null,
    jobIds: parsed.jobIds ?? [],
    selector: parsed.selector ?? null,
    previewShots: parsed.previewShots ?? [],
    variants: parsed.variants ?? [],
    warRoomConversationId: parsed.warRoomConversationId ?? null,
    captionStyle: parsed.captionStyle ?? null,
    asrStatus: parsed.asrStatus ?? null,
    transcriptAssetIds: parsed.transcriptAssetIds ?? [],
    asrWordLevel: parsed.asrWordLevel ?? false,
    workflow: parsed.workflow,
    lessonConstraintIds: parsed.lessonConstraintIds,
    lessonConstraintCount: parsed.lessonConstraintCount,
    creativeIntelligence: parsed.creativeIntelligence,
  }
}

export async function loadProductionSession(projectId: string): Promise<HvsProductionSession | null> {
  const file = projectProductionSessionPath(projectId)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as HvsProductionSession
    if (!parsed || parsed.schemaVersion !== HVS_PRODUCTION_SESSION_SCHEMA) return null
    return withSessionDefaults(parsed)
  } catch {
    return null
  }
}

export async function saveProductionSession(session: HvsProductionSession): Promise<HvsProductionSession> {
  const next = { ...session, updatedAt: new Date().toISOString() }
  const file = projectProductionSessionPath(session.projectId)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}
