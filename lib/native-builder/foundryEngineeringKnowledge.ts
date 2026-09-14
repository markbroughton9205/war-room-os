/**
 * Local Foundry engineering knowledge. Not a second search engine — durable notes with
 * provenance and freshness so repeated coding facts are not always re-fetched.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveBaseRepoRoot } from '@/lib/repo/paths'

export type FoundryKnowledgeEntry = {
  id: string
  topic: string
  summary: string
  sources: string[]
  version?: string
  fetchedAt: string
  staleAfterDays: number
}

export type FoundryKnowledgeStore = {
  updatedAt: string
  entries: FoundryKnowledgeEntry[]
}

const REL = path.join('.war-room', 'foundry', 'engineering-knowledge.json')
const MAX_ENTRIES = 80

function storePath(): string {
  return path.join(resolveBaseRepoRoot(), REL)
}

function emptyStore(): FoundryKnowledgeStore {
  return { updatedAt: new Date().toISOString(), entries: [] }
}

export async function readFoundryEngineeringKnowledge(): Promise<FoundryKnowledgeStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), 'utf8')) as FoundryKnowledgeStore
    if (!parsed || !Array.isArray(parsed.entries)) return emptyStore()
    return parsed
  } catch {
    return emptyStore()
  }
}

export function knowledgeIsFresh(entry: FoundryKnowledgeEntry, now = Date.now()): boolean {
  const ageDays = (now - Date.parse(entry.fetchedAt)) / 86_400_000
  return Number.isFinite(ageDays) && ageDays <= entry.staleAfterDays
}

export function lookupFoundryKnowledge(store: FoundryKnowledgeStore, topic: string): FoundryKnowledgeEntry | null {
  const needle = topic.toLowerCase()
  const hit = store.entries.find(e => e.topic.toLowerCase() === needle || needle.includes(e.topic.toLowerCase()) || e.topic.toLowerCase().includes(needle))
  if (!hit) return null
  return knowledgeIsFresh(hit) ? hit : null
}

export async function rememberFoundryKnowledge(entry: Omit<FoundryKnowledgeEntry, 'id'>): Promise<FoundryKnowledgeEntry> {
  const store = await readFoundryEngineeringKnowledge()
  const id = `${entry.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48)}-${Date.now().toString(36)}`
  const next: FoundryKnowledgeEntry = { ...entry, id }
  const entries = [next, ...store.entries.filter(e => e.topic.toLowerCase() !== entry.topic.toLowerCase())].slice(0, MAX_ENTRIES)
  const dest = storePath()
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, 2), 'utf8')
  return next
}
