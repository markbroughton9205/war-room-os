import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { isContained } from '../runtime/safeFs'
import { Workspace } from '../runtime/workspaceFs'
import type { ChangeReceipt, MissionRecord } from './types'
import { resolveBin, runTool } from './toolchain'

export type GateSpec = { typecheck: boolean; validators: string[] }
export const DEFAULT_GATES: GateSpec = { typecheck: true, validators: [] }
import { SECRET_NAME, isSensitiveWrite } from './seed'

/** Which changed paths may be applied back: created/modified only, repository-relative, under a declared write prefix, nothing secret-shaped. Pure, so it is testable without a repository. */
export function planApply(changed: string[], deleted: string[], write: string[]): { allowed: string[]; refused: string[] } {
  const refused: string[] = []
  const allowed: string[] = []
  const prefixes = write.map((w) => w.replace(/\\/g, '/').replace(/\/+$/, ''))
  for (const p of deleted) refused.push(`${p}: deleting repository files is never applied by a mission`)
  for (const raw of changed) {
    const p = raw.replace(/\\/g, '/')
    if (path.isAbsolute(p) || p.split('/').includes('..') || p.includes('\0')) { refused.push(`${raw}: not a repository-relative path`); continue }
    if (SECRET_NAME.test(p)) { refused.push(`${raw}: secret-shaped file name`); continue }
    if (isSensitiveWrite(p)) { refused.push(`${raw}: a security, build or configuration surface (never written by a mission)`); continue }
    if (p.split('/').some((s) => s.toLowerCase() === '.git' || s.toLowerCase() === 'node_modules')) { refused.push(`${raw}: protected path`); continue }
    if (!prefixes.some((w) => p === w || p.startsWith(w + '/'))) { refused.push(`${raw}: outside the declared write scope (${prefixes.join(', ') || 'none'})`); continue }
    allowed.push(p)
  }
  return { allowed, refused }
}

export type IntegrationDeps = { integrationRoot: string; now?: () => Date }

/**
 * Integration: the verified workspace changes are applied to a git worktree branch (foundry/<mission>) cut from the exact commit the workspace was seeded from,
 * the repository's own gates run there (type check and any declared validators), and only if they pass is ONE commit made with an explicit file list.
 * Nothing touches the repository's checked-out branch; installing is a separate, later stage that needs the Commander's approval recorded on the mission.
 */
export async function integrate(m: MissionRecord, ws: Workspace, created: string[], modified: string[], deleted: string[], deps: IntegrationDeps, gates: GateSpec = DEFAULT_GATES): Promise<ChangeReceipt['integration']> {
  const src = m.scope.source
  if (!src) return { state: 'NOT_RUN', gates: [], refused: [] }
  const plan = planApply([...created, ...modified], deleted, m.scope.write)
  if (plan.refused.length) return { state: 'REFUSED', gates: [], refused: plan.refused }
  if (plan.allowed.length === 0) return { state: 'REFUSED', gates: [], refused: ['the mission changed no file inside its write scope'] }
  const base = m.workspace.baseCommit
  if (!base) return { state: 'REFUSED', gates: [], refused: ['the workspace has no recorded base commit'] }
  const git = resolveBin('git'), node = resolveBin('node')
  const branch = `foundry/${m.id}`
  const wt = path.join(deps.integrationRoot, m.id)
  const out: ChangeReceipt['integration'] = { state: 'GATES_FAILED', branch, gates: [], refused: [] }
  const has = await runTool([git, '-C', src.repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], src.repo, { timeoutMs: 20_000 })
  if (has.exitCode === 0) {
    const c = (await runTool([git, '-C', src.repo, 'rev-parse', `refs/heads/${branch}`], src.repo, { timeoutMs: 20_000 })).stdout.trim()
    // the branch exists from the first (uncommitted) attempt at its base commit; only a tip beyond the base means this mission's commit already exists
    if (c && c !== base) {
      // the existing commit must hold exactly what the workspace holds now (a resumed run that changed files after the commit must not inherit it)
      for (const f of plan.allowed) {
        const inBranch = (await runTool([git, '--literal-pathspecs', '-C', src.repo, 'rev-parse', `${c}:${f}`], src.repo, { timeoutMs: 20_000 })).stdout.trim()
        const inWs = (await runTool([git, '-C', src.repo, 'hash-object', '--no-filters', path.join(ws.root, f)], src.repo, { timeoutMs: 20_000 })).stdout.trim()
        if (inBranch !== inWs) return { state: 'REFUSED', gates: [], refused: [`${f}: the integration branch already holds a different version than the workspace`] }
      }
      const t = await runTool([git, '-C', src.repo, 'rev-parse', `refs/heads/${branch}^{tree}`], src.repo, { timeoutMs: 20_000 })
      return { ...out, state: 'APPLIED', commit: c, tree: t.stdout.trim(), gates: [{ name: 'already-applied', exitCode: 0, summary: 'the branch already holds this mission\'s commit (a resumed attempt does not apply twice)' }] }
    }
  }
  mkdirSync(deps.integrationRoot, { recursive: true })
  if (!existsSync(wt)) {
    const add = await runTool([git, '-C', src.repo, 'worktree', 'add', '-b', branch, wt, base], src.repo, { timeoutMs: 120_000 })
    if (add.exitCode !== 0) return { state: 'REFUSED', gates: [], refused: [`could not create the integration worktree: ${(add.stderr || add.stdout).trim().slice(-300)}`] }
  }
  for (const p of plan.allowed) {
    const dst = path.join(wt, p)
    if (!isContained(wt, dst)) return { state: 'REFUSED', gates: [], refused: [`${p}: resolves outside the integration worktree`] }
    mkdirSync(path.dirname(dst), { recursive: true })
    if (existsSync(dst) && lstatSync(dst).isSymbolicLink()) return { state: 'REFUSED', gates: [], refused: [`${p}: target is a symlink`] }
    copyFileSync(path.join(ws.root, p), dst)
  }
  const nm = path.join(wt, 'node_modules')
  if (existsSync(path.join(src.repo, 'node_modules')) && !existsSync(nm)) symlinkSync(path.join(src.repo, 'node_modules'), nm)
  let ok = true
  const record = (name: string, r: { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }) => {
    const tail = (r.stdout + '\n' + r.stderr).trim().split('\n').slice(-6).join(' | ').slice(0, 500)
    out.gates.push({ name, exitCode: r.exitCode ?? -1, summary: r.timedOut ? 'TIMED OUT' : tail || 'no output', ...(r.exitCode !== 0 ? { detail: (r.stdout + '\n' + r.stderr).trim().slice(-6000) } : {}) })
    if (r.exitCode !== 0) ok = false
  }
  if (gates.typecheck) record('typecheck (tsc --noEmit)', await runTool([node, path.join(wt, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', '.'], wt, { timeoutMs: 900_000 }))
  for (const v of gates.validators) {
    if (!/^[\w./-]+\.ts$/.test(v) || v.includes('..') || !existsSync(path.join(wt, v))) { out.gates.push({ name: `validator ${v}`, exitCode: -1, summary: 'not a repository validator file' }); ok = false; continue }
    record(`validator ${v}`, await runTool([node, '--loader', './scripts/ts-extension-loader.mjs', '--experimental-transform-types', v], wt, { timeoutMs: 900_000 }))
  }
  rmSync(nm, { force: true })
  if (!ok) return out
  const add = await runTool([git, '--literal-pathspecs', '-C', wt, 'add', '--', ...plan.allowed], wt, { timeoutMs: 60_000 })
  if (add.exitCode !== 0) { out.gates.push({ name: 'git add', exitCode: add.exitCode ?? -1, summary: add.stderr.slice(-300) }); return out }
  const msg = `foundry(${m.id}): ${m.title}\n\nEngineering mission ${m.id}. Workspace seed ${m.workspace.seedTreeSha256.slice(0, 12)}; base ${base.slice(0, 12)}.\nFiles: ${plan.allowed.join(', ')}\n\nCo-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
  const cm = await runTool([git, '-C', wt, '-c', 'user.name=Foundry Engineering', '-c', 'user.email=foundry@war-room.local', 'commit', '-m', msg], wt, { timeoutMs: 60_000 })
  if (cm.exitCode !== 0) { out.gates.push({ name: 'git commit', exitCode: cm.exitCode ?? -1, summary: (cm.stderr || cm.stdout).slice(-300) }); return out }
  const c = await runTool([git, '-C', wt, 'rev-parse', 'HEAD'], wt, { timeoutMs: 20_000 })
  const t = await runTool([git, '-C', wt, 'rev-parse', 'HEAD^{tree}'], wt, { timeoutMs: 20_000 })
  return { ...out, state: 'APPLIED', commit: c.stdout.trim(), tree: t.stdout.trim() }
}
