import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { cacheDir } from '../cache'
import { safeFsId } from '../jobs'
import { sha256Buffer, sha256Json } from './hash'
import type { HvsDestructionCacheManifest } from './types'

export function destructionRunDir(manifestId: string): string {
  const dir = path.join(cacheDir('effect'), 'destruction', safeFsId(manifestId, 'manifest'))
  mkdirSync(dir, { recursive: true })
  return dir
}

export function writeJsonArtifact(file: string, value: unknown): { path: string; bytes: number; sha256: string } {
  const body = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, body)
  renameSync(tmp, file)
  return { path: file, bytes: body.length, sha256: sha256Buffer(body) }
}

export function readJsonFile<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

export function fileBytes(file: string): number {
  return statSync(file).size
}

export function cacheIdentityHash(manifest: Pick<HvsDestructionCacheManifest, 'planHash' | 'structuralGraphHash' | 'sourceAssetHashes' | 'materialHash' | 'simConfigHash' | 'backendVersion' | 'fractureBackendVersion'>): string {
  return sha256Json(manifest)
}
