/**
 * WR-Engineer Phase 5 — persist Commander engine selection under
 * `.war-room/wr-engineer/engine/`, same JSON-file convention as session/node stores.
 *
 * Default is LOCAL. Invalid payloads are rejected, never coerced into a silent fallback.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import {
  ALL_PROVIDER_FAMILIES,
  type DirectProviderFamily,
} from '@/lib/council/providerDirectCall'
import {
  DEFAULT_ENGINE_MODE,
  DEFAULT_EXTERNAL_FAMILY,
  DEFAULT_LOCAL_MODEL,
  isEngineMode,
  type EngineMode,
  type EngineSelection,
} from './engineTypes'

export type EngineSelectionParseResult =
  | { ok: true; selection: EngineSelection }
  | { ok: false; error: string }

function defaultSelection(now: Date = new Date()): EngineSelection {
  return {
    mode: DEFAULT_ENGINE_MODE,
    externalFamily: DEFAULT_EXTERNAL_FAMILY,
    localModel: DEFAULT_LOCAL_MODEL,
    updatedAt: now.toISOString(),
  }
}

function isDirectProviderFamily(value: string): value is DirectProviderFamily {
  return (ALL_PROVIDER_FAMILIES as readonly string[]).includes(value)
}

export function parseEngineSelection(raw: unknown, now: Date = new Date()): EngineSelectionParseResult {
  if (raw === null || raw === undefined) {
    return { ok: true, selection: defaultSelection(now) }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Engine selection must be an object.' }
  }
  const obj = raw as Record<string, unknown>
  if (obj.mode !== undefined) {
    if (typeof obj.mode !== 'string' || !isEngineMode(obj.mode)) {
      return { ok: false, error: `Invalid engine mode: ${String(obj.mode)}. Expected LOCAL, AUTO, or EXTERNAL.` }
    }
  }
  if (obj.externalFamily !== undefined) {
    if (typeof obj.externalFamily !== 'string' || !isDirectProviderFamily(obj.externalFamily)) {
      return { ok: false, error: `Invalid external family: ${String(obj.externalFamily)}.` }
    }
  }
  if (obj.localModel !== undefined) {
    if (typeof obj.localModel !== 'string' || !obj.localModel.trim()) {
      return { ok: false, error: 'localModel must be a non-empty string.' }
    }
    if (obj.localModel.includes('..') || /[\\/]/.test(obj.localModel) || /^[a-zA-Z]:/.test(obj.localModel)) {
      return { ok: false, error: 'localModel must be a runtime model tag, not a filesystem path.' }
    }
  }
  return {
    ok: true,
    selection: {
      mode: (obj.mode as EngineMode | undefined) ?? DEFAULT_ENGINE_MODE,
      externalFamily: (obj.externalFamily as DirectProviderFamily | undefined) ?? DEFAULT_EXTERNAL_FAMILY,
      localModel: typeof obj.localModel === 'string' ? obj.localModel.trim() : DEFAULT_LOCAL_MODEL,
      updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : now.toISOString(),
    },
  }
}

export class JsonFileEngineSelectionStore {
  constructor(private readonly filePath: string) {}

  async load(now: Date = new Date()): Promise<EngineSelection> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = parseEngineSelection(JSON.parse(raw), now)
      if (!parsed.ok) return defaultSelection(now)
      return parsed.selection
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'ENOENT') return defaultSelection(now)
      return defaultSelection(now)
    }
  }

  async save(input: unknown, now: Date = new Date()): Promise<EngineSelectionParseResult> {
    const parsed = parseEngineSelection(input, now)
    if (!parsed.ok) return parsed
    const selection: EngineSelection = { ...parsed.selection, updatedAt: now.toISOString() }
    await mkdir(path.dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(selection, null, 2), 'utf8')
    return { ok: true, selection }
  }
}

export function defaultEngineSelectionPath(): string {
  return path.join(resolveRepoRoot(), '.war-room', 'wr-engineer', 'engine', 'selection.json')
}

export const wrEngineerEngineSelectionStore = new JsonFileEngineSelectionStore(defaultEngineSelectionPath())
