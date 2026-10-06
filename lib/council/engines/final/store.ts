import { mkdir, readFile, rename, writeFile, readdir, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { resolveLocalAppDataPaths } from '@/lib/sovereign-runtime/local-ownership/paths'

export function engineFinalStoreRoot(): string {
  const override = process.env.WAR_ROOM_ENGINE_FINAL_STORE
  return override || path.join(resolveLocalAppDataPaths().data, 'council', 'engine-final')
}

async function atomicWrite(file: string, body: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, body)
  await rename(tmp, file)
  try { await unlink(`${file}.partial`) } catch { /* none */ }
}

export async function saveFinalJson(kind: string, id: string, value: unknown): Promise<string> {
  const file = path.join(engineFinalStoreRoot(), kind, `${id}.json`)
  await atomicWrite(file, JSON.stringify(value, null, 2) + '\n')
  return file
}

export async function loadFinalJson<T>(kind: string, id: string): Promise<T | null> {
  const file = path.join(engineFinalStoreRoot(), kind, `${id}.json`)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export async function listFinalJson<T>(kind: string): Promise<T[]> {
  const folder = path.join(engineFinalStoreRoot(), kind)
  if (!existsSync(folder)) return []
  const out: T[] = []
  for (const name of (await readdir(folder)).filter(n => n.endsWith('.json'))) {
    try {
      out.push(JSON.parse(await readFile(path.join(folder, name), 'utf8')) as T)
    } catch { /* skip */ }
  }
  return out
}
