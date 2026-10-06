import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import type { Hvs3DIntent, Hvs3DPlanPatch, HvsProductionBlueprint3D, HvsScenePlan } from './types'
import type { HvsDirectorPlan, HvsDirectorPlanPatch, HvsDirectorPrevis, HvsDirectorQcReport, HvsProductionBlueprint } from '../director/types'

export type Hvs3DDirectorSession = {
  projectId: string
  intent: Hvs3DIntent | null
  plan: HvsScenePlan | null
  patch: Hvs3DPlanPatch | null
  blueprint: HvsProductionBlueprint3D | null
  directorPlan?: HvsDirectorPlan | null
  directorPatch?: HvsDirectorPlanPatch | null
  directorPrevis?: HvsDirectorPrevis | null
  directorBlueprint?: HvsProductionBlueprint | null
  qc?: HvsDirectorQcReport | null
  updatedAt: string
}

function sessionPath(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().projects, projectId)
  return path.join(dir, 'director3d-session.json')
}

export async function loadDirector3DSession(projectId: string): Promise<Hvs3DDirectorSession | null> {
  const file = sessionPath(projectId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Hvs3DDirectorSession
  } catch {
    return null
  }
}

export async function saveDirector3DSession(session: Hvs3DDirectorSession): Promise<void> {
  const file = sessionPath(session.projectId)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ ...session, updatedAt: new Date().toISOString() }, null, 2)}\n`)
}
