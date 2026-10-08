/**
 * Live dependency-plan subsystem for blueprint execution.
 *  - Packages DECLARE dependency needs (exact name + version); they can never install, change a manifest/lockfile, or approve anything.
 *  - A Commander may approve the NEED (workspace + exact name@version). An approval never installs and never makes a dependency "provisioned":
 *    only host evidence (exact resolved version inside the workspace, lockfile, manifest) plus a sandboxed load probe makes it VERIFIED_USABLE.
 *  - Manifest/lockfile mutation is a SEPARATE governed host action that this slice does not perform (the existing `package_install` operation is NEVER used).
 *  - Verification never fetches from the network and never spawns a package manager.
 */
import fs from 'node:fs'
import path from 'node:path'
import { atomicWrite, canonical, createExclusive, hash, readJson } from './base.mjs'
import { buildDependencyPlan, classifyDependencySpec } from './depplan.mjs'
import { createWorkspaceDependencyVerifier } from './depverify.mjs'
import { resolveBlueprintWorkspaceSync } from './liveWorkspaces'

type Signer = { seal: (v: Record<string, unknown>) => Record<string, unknown>; open: (v: unknown, code?: string) => Record<string, unknown> }

export type DependencyApproval = {
  workspaceId: string
  name: string
  version: string
  approvedBy: { actorId: string; sessionId: string }
  approvedAt: number
  reason: string
  scope: 'USE_EXISTING'
}

const WS = /^[\w.:@/-]{1,200}$/

export function createDependencyApprovalStore({ root, signer, now = Date.now }: { root: string; signer: Signer; now?: () => number }) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const key = (workspaceId: string, name: string, version: string) => hash(canonical({ workspaceId, name, version })).slice(0, 40)
  const file = (k: string) => path.join(root, `${k}.json`)
  const revoked = (k: string) => path.join(root, `${k}.revoked`)
  const bad = (msg: string) => Object.assign(new Error(msg), { code: 'INVALID_PACKAGE' })
  return Object.freeze({
    approve(input: { workspaceId: string; name: string; version: string; actorId: string; sessionId: string; reason: string }): DependencyApproval {
      if (!WS.test(input.workspaceId)) throw bad('Invalid workspace id')
      const spec = classifyDependencySpec({ name: input.name, version: input.version })
      if (!spec.ok) throw bad(`Dependency spec refused (${spec.code}); only exact registry versions can be approved`)
      const reason = String(input.reason ?? '').trim().slice(0, 300)
      if (reason.length < 5) throw bad('An approval reason is required')
      const record: DependencyApproval = { workspaceId: input.workspaceId, name: input.name, version: input.version, approvedBy: { actorId: input.actorId, sessionId: input.sessionId }, approvedAt: now(), reason, scope: 'USE_EXISTING' }
      const k = key(input.workspaceId, input.name, input.version)
      if (fs.existsSync(revoked(k))) fs.rmSync(revoked(k)) // re-approval after revocation is an explicit Commander act
      if (!createExclusive(file(k), JSON.stringify(signer.seal({ ...record })))) {
        const cur = readJson(file(k)); if (cur) return signer.open(cur) as unknown as DependencyApproval
      }
      return record
    },
    revoke(workspaceId: string, name: string, version: string): boolean { const k = key(workspaceId, name, version); if (!fs.existsSync(file(k))) return false; atomicWrite(revoked(k), JSON.stringify({ revokedAt: now() }), 0o600); return true },
    isApproved(workspaceId: string, name: string, version: string): boolean {
      try { const k = key(workspaceId, name, version); if (fs.existsSync(revoked(k))) return false; const rec = readJson(file(k)); if (!rec) return false; const o = signer.open(rec) as unknown as DependencyApproval; return o.workspaceId === workspaceId && o.name === name && o.version === version } catch { return false }
    },
    list(workspaceId: string): DependencyApproval[] {
      const out: DependencyApproval[] = []
      for (const n of fs.existsSync(root) ? fs.readdirSync(root).filter(x => x.endsWith('.json')) : []) {
        try { const o = signer.open(readJson(path.join(root, n))) as unknown as DependencyApproval; if (o.workspaceId === workspaceId && !fs.existsSync(revoked(n.slice(0, -5)))) out.push(o) } catch { /* unreadable/forged: ignored (never counts as approval) */ }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name))
    },
  })
}
export type DependencyApprovalStore = ReturnType<typeof createDependencyApprovalStore>

export function createLiveDependencyVerifier(opts: { store: DependencyApprovalStore; probePath: string; probeDigest: string; nodeCmd: string; nodeEnv: Record<string, string> }) {
  return createWorkspaceDependencyVerifier({
    rootOf: (workspaceId: string) => ({ root: resolveBlueprintWorkspaceSync(workspaceId)?.root ?? null }),
    approved: (name: string, version: string, workspaceId: string) => opts.store.isApproved(workspaceId, name, version),
    nodeCmd: opts.nodeCmd, nodeEnv: opts.nodeEnv, probePath: opts.probePath, expectedProbeDigest: opts.probeDigest,
  })
}
export type LiveDependencyVerifier = ReturnType<typeof createLiveDependencyVerifier>

/** Everything the Commander needs to see about a package's dependencies: the host-evidence plan, Commander approvals and real usability verification. */
export async function describeDependencies(input: { workspaceId: string; declared: { name: string; version: string }[]; verifier: LiveDependencyVerifier; store: DependencyApprovalStore; mode?: 'run' | 'cache-only' }) {
  const plan = buildDependencyPlan({ declared: input.declared, workspaceId: input.workspaceId, evidence: input.verifier.evidence })
  const verification = await input.verifier.verify(input.workspaceId, input.declared, { mode: input.mode ?? 'cache-only' })
  const approvals = Object.fromEntries(input.declared.map(d => [`${d.name}@${d.version}`, input.store.isApproved(input.workspaceId, d.name, d.version)]))
  return {
    plan: { status: plan.status, digest: plan.digest, blockedCount: plan.blockedCount, manifestChange: plan.manifestChange, lockfileChange: plan.lockfileChange, executable: plan.executable, entries: plan.entries },
    verification: { digest: verification.digest, allUsable: verification.allUsable, counts: verification.counts, deps: verification.deps.map((d: { name: string; version: string; state: string; reasons: string[] }) => ({ name: d.name, version: d.version, state: d.state, reasons: d.reasons })) },
    approvals,
    governedActions: 'Installing dependencies or changing manifest/lockfile is a separate governed host action and is NOT performed by blueprint execution.',
  }
}
