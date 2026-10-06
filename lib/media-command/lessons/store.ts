/**
 * HVS lesson files under {media-command}/knowledge/lessons/.
 * Sidecar JSON only. Does not write project truth or Foundry memory.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { mediaCommandDataHierarchy } from '../paths'
import { HVS_LESSON_SCHEMA, type HvsLesson, type HvsLessonStatus } from './types'

export function lessonDirectory(root?: string): string {
  return root ?? path.join(mediaCommandDataHierarchy().knowledge, 'lessons')
}

export async function saveLesson(lesson: HvsLesson, root?: string): Promise<HvsLesson> {
  const dir = lessonDirectory(root)
  await mkdir(dir, { recursive: true })
  const next = { ...lesson, schema: HVS_LESSON_SCHEMA, system: 'HVS' as const, updatedAt: new Date().toISOString() }
  await writeFile(path.join(dir, `${next.id}.json`), JSON.stringify(next, null, 2) + '\n')
  return next
}

export async function loadLesson(id: string, root?: string): Promise<HvsLesson | null> {
  const file = path.join(lessonDirectory(root), `${id}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as HvsLesson
  } catch {
    return null
  }
}

export async function listLessons(root?: string): Promise<HvsLesson[]> {
  const dir = lessonDirectory(root)
  if (!existsSync(dir)) return []
  const names = await readdir(dir)
  const out: HvsLesson[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const lesson = await loadLesson(name.replace(/\.json$/, ''), root)
    if (lesson?.schema === HVS_LESSON_SCHEMA && lesson.system === 'HVS') out.push(lesson)
  }
  return out
}

export async function setLessonStatus(id: string, status: HvsLessonStatus, root?: string, supersededBy?: string | null): Promise<HvsLesson | null> {
  const lesson = await loadLesson(id, root)
  if (!lesson) return null
  return saveLesson({ ...lesson, status, supersededBy: supersededBy ?? lesson.supersededBy ?? null }, root)
}
