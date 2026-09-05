/**
 * WR-Engineer engineering memory store — Phase 1 backend.
 *
 * Local, JSON-file-backed implementation of EngineeringMemoryStore, persisted under
 * .war-room/wr-engineer/memory/records.json — reusing lib/repo/paths.ts's resolveRepoRoot() (the
 * same repo-root resolution lib/native-builder already uses) rather than inventing a second path
 * convention, and living under .war-room/ which this repo's .gitignore already excludes wholesale.
 * See types.ts's header for why this is a Phase 1 scoping choice, not a final architecture.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type {
  CreateMemoryRecordInput,
  EngineeringMemoryRecord,
  EngineeringMemoryStore,
  MemoryQuery,
} from './types'

function memoryFilePath(): string {
  return path.join(resolveRepoRoot(), '.war-room', 'wr-engineer', 'memory', 'records.json')
}

async function readAllRecords(filePath: string): Promise<EngineeringMemoryRecord[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as EngineeringMemoryRecord[]) : []
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return []
    throw error
  }
}

async function writeAllRecords(filePath: string, records: EngineeringMemoryRecord[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(records, null, 2), 'utf8')
}

export class JsonFileEngineeringMemoryStore implements EngineeringMemoryStore {
  constructor(private readonly filePath: string = memoryFilePath()) {}

  async record(input: CreateMemoryRecordInput): Promise<EngineeringMemoryRecord> {
    const now = new Date().toISOString()
    const record: EngineeringMemoryRecord = {
      id: randomUUID(),
      category: input.category,
      summary: input.summary,
      detail: input.detail,
      epistemicStatus: input.epistemicStatus,
      relatedRefs: input.relatedRefs ?? [],
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
    }
    const records = await readAllRecords(this.filePath)
    records.push(record)
    await writeAllRecords(this.filePath, records)
    return record
  }

  async get(id: string): Promise<EngineeringMemoryRecord | null> {
    const records = await readAllRecords(this.filePath)
    return records.find(r => r.id === id) ?? null
  }

  async query(query?: MemoryQuery): Promise<EngineeringMemoryRecord[]> {
    const records = await readAllRecords(this.filePath)
    if (!query) return records
    return records.filter(r => {
      if (query.category && r.category !== query.category) return false
      if (query.tag && !r.tags.includes(query.tag)) return false
      if (query.textContains) {
        const needle = query.textContains.toLowerCase()
        const haystack = `${r.summary}\n${r.detail}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }

  async all(): Promise<EngineeringMemoryRecord[]> {
    return readAllRecords(this.filePath)
  }
}

/** Default, process-wide store instance — a caller that needs isolation (e.g. an eval suite) should
 * construct its own JsonFileEngineeringMemoryStore(customPath) instead of using this singleton. */
export const engineeringMemory: EngineeringMemoryStore = new JsonFileEngineeringMemoryStore()
