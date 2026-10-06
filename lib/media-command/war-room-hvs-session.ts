/**
 * Conversation → HVS project binding. Not a second project truth.
 * Canonical remains .hvsproj + production-session sidecar.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from './paths'

export type HvsWarRoomBinding = {
  conversationId: string
  projectId: string
  updatedAt: string
}

function bindingPath(conversationId: string): string {
  return path.join(mediaCommandDataHierarchy().projects, '_war-room-bindings', `${conversationId}.json`)
}

export function warRoomBindPath(conversationId: string): string {
  return bindingPath(conversationId)
}

export async function loadWarRoomBinding(conversationId: string | null | undefined): Promise<HvsWarRoomBinding | null> {
  if (!conversationId) return null
  const file = bindingPath(conversationId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as HvsWarRoomBinding
  } catch {
    return null
  }
}

export async function saveWarRoomBinding(conversationId: string, projectId: string): Promise<HvsWarRoomBinding> {
  const next: HvsWarRoomBinding = {
    conversationId,
    projectId,
    updatedAt: new Date().toISOString(),
  }
  const file = bindingPath(conversationId)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return next
}
