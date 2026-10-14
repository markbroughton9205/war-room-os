import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import path from 'node:path'
import { Workspace, treeHash } from '../runtime/workspaceFs'
import type { WorkflowResult } from '../workflow'
import { fileProvenance, recoveryWorkers, roleSummary, type LedgerDelivery, type LedgerWrite } from './provenance'
import type { ChangeReceipt, FileReceiptEntry, MissionRecord } from './types'

const TEST_PATH = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[cm]?[jt]sx?$/
const sha = (t: string | Buffer) => createHash('sha256').update(t).digest('hex')
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as object).sort(([a], [b]) => a.localeCompare(b))) : x))

export type ReceiptInputs = {
  mission: MissionRecord
  ws: Workspace
  seed: Record<string, string>
  writes: LedgerWrite[]
  deliveries: LedgerDelivery[]
  result: WorkflowResult | null
  verifier: ChangeReceipt['verifier']
  integration: ChangeReceipt['integration']
  install: ChangeReceipt['install']
  now?: Date
}

/** The change receipt is computed from the filesystem (seed snapshot vs final snapshot) and the provenance ledger, never from what the model or the UI claims. */
export function buildReceipt(i: ReceiptInputs): ChangeReceipt {
  const final = i.ws.snapshot()
  const prov = fileProvenance(i.writes, final)
  const by = new Map(prov.map((p) => [p.path, p]))
  const entry = (p: string): FileReceiptEntry => {
    const pr = by.get(p)
    return { path: p, sha256: final[p], bytes: statSync(path.join(i.ws.root, p)).size, author: pr?.author ?? 'UNATTRIBUTED (no ledger write)', role: pr?.role ?? 'unknown' }
  }
  const created = Object.keys(final).filter((p) => !(p in i.seed)).sort()
  const modified = Object.keys(final).filter((p) => p in i.seed && i.seed[p] !== final[p]).sort()
  const deleted = Object.keys(i.seed).filter((p) => !(p in final)).sort()
  const detRepairs: ChangeReceipt['deterministicRepairs'] = []
  for (const w of i.writes) {
    if (w.autofixed) detRepairs.push({ kind: 'structural-autofix(on write)', file: w.path, note: `applied to a ${w.role} write` })
    if (w.deterministic && w.author.startsWith('foundry:') && w.author !== 'foundry:contract-test-generator') detRepairs.push({ kind: w.author.slice('foundry:'.length), file: w.path, note: w.tag || 'write' })
  }
  for (const r of i.result?.routeEdits ?? []) detRepairs.push({ kind: `route-edit:${r.mode}`, file: r.file, note: r.ops.map((o) => o.op).join('+') })
  for (const c of i.result?.contractCorrections ?? []) detRepairs.push({ kind: 'contract-correction', file: (c as { file?: string }).file ?? 'tests', note: 'status assertion corrected to the acceptance contract' })
  const present = new Set([...created, ...modified])
  const modelEdits = prov.filter((p) => present.has(p.path) && !p.deterministic && p.role !== 'unknown').map((p) => ({ path: p.path, author: p.author, role: p.role }))
  const body: Omit<ChangeReceipt, 'receiptSha256'> = {
    missionId: i.mission.id, generatedAt: (i.now ?? new Date()).toISOString(), attempts: i.mission.attempts.length,
    filesCreated: created.map(entry),
    filesModified: modified.map((p) => ({ ...entry(p), beforeSha256: i.seed[p] })),
    filesDeleted: deleted.map((p) => ({ path: p, beforeSha256: i.seed[p] })),
    testsAdded: created.filter((p) => TEST_PATH.test(p)), testsChanged: modified.filter((p) => TEST_PATH.test(p)),
    deterministicRepairs: detRepairs, modelGeneratedEdits: modelEdits,
    verifier: i.verifier, integration: i.integration, install: i.install,
    provenance: { roles: roleSummary(i.deliveries), files: prov.filter((p) => present.has(p.path)), recoveryWorkers: recoveryWorkers(i.mission.attempts) },
    treeSha256: treeHash(final),
  }
  return { ...body, receiptSha256: sha(stable(body)) }
}

/** Re-derives what a receipt claims from the files on disk. ok only when every created/modified hash matches, deleted files are gone, and the tree hash is the same. */
export function verifyReceipt(r: ChangeReceipt, ws: Workspace): { ok: boolean; mismatches: string[] } {
  const mismatches: string[] = []
  for (const f of [...r.filesCreated, ...r.filesModified]) { const h = ws.hash(f.path); if (h !== f.sha256) mismatches.push(`${f.path}: receipt ${f.sha256.slice(0, 12)} disk ${h?.slice(0, 12) ?? 'MISSING'}`) }
  for (const f of r.filesDeleted) if (ws.hash(f.path) !== null) mismatches.push(`${f.path}: receipt says deleted but the file exists`)
  if (treeHash(ws.snapshot()) !== r.treeSha256) mismatches.push('workspace tree hash differs from the receipt')
  const { receiptSha256, ...body } = r
  if (sha(stable(body)) !== receiptSha256) mismatches.push('receipt content hash does not match its body')
  return { ok: mismatches.length === 0, mismatches }
}
