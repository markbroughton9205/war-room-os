import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import type { HvsCameraPlanPatch, HvsCinemaIntent, HvsCinemaPlan } from './types'

export type HvsCinemaDirectorSession = {
  projectId: string
  intent: HvsCinemaIntent | null
  plan: HvsCinemaPlan | null
  patch: HvsCameraPlanPatch | null
  updatedAt: string
}

function sessionPath(projectId: string): string {
  const dir = path.join(mediaCommandDataHierarchy().projects, projectId)
  return path.join(dir, 'cinema-director-session.json')
}

export async function loadCinemaDirectorSession(projectId: string): Promise<HvsCinemaDirectorSession | null> {
  const file = sessionPath(projectId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as HvsCinemaDirectorSession
  } catch {
    return null
  }
}

export async function saveCinemaDirectorSession(session: HvsCinemaDirectorSession): Promise<void> {
  const file = sessionPath(session.projectId)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify({ ...session, updatedAt: new Date().toISOString() }, null, 2)}\n`)
}
