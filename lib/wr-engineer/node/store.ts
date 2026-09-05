/**
 * WR-Engineer node store — Phase 2 dev backend.
 *
 * JSON-file-backed, same pattern as lib/native-builder/storage.ts and
 * lib/native-builder/workspaceRegistry.ts (no new persistence system introduced) — three files
 * under .war-room/wr-engineer/node/ (nodes.json, repositories.json, pairing-tokens.json), reusing
 * lib/repo/paths.ts's resolveRepoRoot() exactly as lib/wr-engineer/memory/store.ts already does.
 *
 * This is explicitly a DEVELOPMENT backend. A production deployment with multiple real remote
 * machines would move this to Supabase (see supabase/war_room_phase57a_wr_engineer_nodes.sql, not
 * applied in this phase) — the NodeStore interface below is written so that swap changes only this
 * file's implementation, never a caller.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { resolveRepoRoot } from '@/lib/repo/paths'
import type { NodeRepository, PairingToken, WrEngineerNode } from './types'

export interface NodeStore {
  saveNode(node: WrEngineerNode): Promise<void>
  getNode(nodeId: string): Promise<WrEngineerNode | null>
  listNodes(): Promise<WrEngineerNode[]>

  savePairingToken(token: PairingToken): Promise<void>
  getPairingToken(tokenId: string): Promise<PairingToken | null>
  findPairingTokenByHash(codeHash: string): Promise<PairingToken | null>
  listPairingTokens(): Promise<PairingToken[]>

  saveRepository(repository: NodeRepository): Promise<void>
  getRepository(repositoryId: string): Promise<NodeRepository | null>
  listRepositoriesForNode(nodeId: string): Promise<NodeRepository[]>
}

function nodeDir(): string {
  return path.join(resolveRepoRoot(), '.war-room', 'wr-engineer', 'node')
}

async function readJsonArray<T>(filePath: string): Promise<T[]> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return []
    throw error
  }
}

async function writeJsonArray<T>(filePath: string, records: T[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(records, null, 2), 'utf8')
}

export class JsonFileNodeStore implements NodeStore {
  private readonly nodesPath: string
  private readonly tokensPath: string
  private readonly reposPath: string

  constructor(baseDir: string = nodeDir()) {
    this.nodesPath = path.join(baseDir, 'nodes.json')
    this.tokensPath = path.join(baseDir, 'pairing-tokens.json')
    this.reposPath = path.join(baseDir, 'repositories.json')
  }

  async saveNode(node: WrEngineerNode): Promise<void> {
    const nodes = await readJsonArray<WrEngineerNode>(this.nodesPath)
    const idx = nodes.findIndex(n => n.nodeId === node.nodeId)
    if (idx >= 0) nodes[idx] = node
    else nodes.push(node)
    await writeJsonArray(this.nodesPath, nodes)
  }

  async getNode(nodeId: string): Promise<WrEngineerNode | null> {
    const nodes = await readJsonArray<WrEngineerNode>(this.nodesPath)
    return nodes.find(n => n.nodeId === nodeId) ?? null
  }

  async listNodes(): Promise<WrEngineerNode[]> {
    return readJsonArray<WrEngineerNode>(this.nodesPath)
  }

  async savePairingToken(token: PairingToken): Promise<void> {
    const tokens = await readJsonArray<PairingToken>(this.tokensPath)
    const idx = tokens.findIndex(t => t.tokenId === token.tokenId)
    if (idx >= 0) tokens[idx] = token
    else tokens.push(token)
    await writeJsonArray(this.tokensPath, tokens)
  }

  async getPairingToken(tokenId: string): Promise<PairingToken | null> {
    const tokens = await readJsonArray<PairingToken>(this.tokensPath)
    return tokens.find(t => t.tokenId === tokenId) ?? null
  }

  async findPairingTokenByHash(codeHash: string): Promise<PairingToken | null> {
    const tokens = await readJsonArray<PairingToken>(this.tokensPath)
    return tokens.find(t => t.codeHash === codeHash) ?? null
  }

  async listPairingTokens(): Promise<PairingToken[]> {
    return readJsonArray<PairingToken>(this.tokensPath)
  }

  async saveRepository(repository: NodeRepository): Promise<void> {
    const repos = await readJsonArray<NodeRepository>(this.reposPath)
    const idx = repos.findIndex(r => r.repositoryId === repository.repositoryId)
    if (idx >= 0) repos[idx] = repository
    else repos.push(repository)
    await writeJsonArray(this.reposPath, repos)
  }

  async getRepository(repositoryId: string): Promise<NodeRepository | null> {
    const repos = await readJsonArray<NodeRepository>(this.reposPath)
    return repos.find(r => r.repositoryId === repositoryId) ?? null
  }

  async listRepositoriesForNode(nodeId: string): Promise<NodeRepository[]> {
    const repos = await readJsonArray<NodeRepository>(this.reposPath)
    return repos.filter(r => r.nodeId === nodeId)
  }
}

/** Default, process-wide store instance — an eval suite or isolated caller should construct its
 * own JsonFileNodeStore(customDir) instead of using this singleton, same discipline as
 * lib/wr-engineer/memory/store.ts's `engineeringMemory` export. */
export const wrEngineerNodeStore: NodeStore = new JsonFileNodeStore()
