/**
 * #22 Phase 5 — Safe read-only operational diagnostic adapters.
 * No free-form shell. No mutation. Reuses deploy/status + health routes.
 */
import { createConnection } from 'node:net'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { readLocalBuildMeta, resolveProductionCandidateUrl } from '@/lib/deploy/status'
import { resolveRepoRoot } from '@/lib/repo/paths'
import { redactSecretsFromOutput } from '@/lib/native-builder/outputRedaction'
import { makeOpsFinding, type OperationsCheckRun, type OperationsFinding, type OperationsTruthState } from './result'
import type { OperationsAgentScope } from './scope'

const execFileAsync = promisify(execFile)

export type DiagnosticBundle = {
  checks: OperationsCheckRun[]
  findings: OperationsFinding[]
  unavailable: string[]
  health_summary: Record<string, unknown>
  process_summary: Record<string, unknown>
  port_summary: Record<string, unknown>
  watchdog_summary: Record<string, unknown>
  public_route_summary: Record<string, unknown>
  dependency_summary: Record<string, unknown>
}

function check(
  checkId: string,
  diagnostic: string,
  ok: boolean,
  summary: string,
  state: OperationsTruthState,
  denied = false,
): OperationsCheckRun {
  return { check_id: checkId, diagnostic, ok, denied, summary, state }
}

async function probeTcp(port: number, host = '127.0.0.1', ms = 400): Promise<boolean> {
  return new Promise(resolve => {
    const socket = createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolve(false)
    }, ms)
    socket.on('connect', () => {
      clearTimeout(timer)
      socket.end()
      resolve(true)
    })
    socket.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

async function fetchJson(url: string, ms = 2500): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(url, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(ms) })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    return { ok: res.ok, status: res.status, body }
  } catch {
    return { ok: false, status: 0, body: null }
  }
}

/** Fixed Windows tasklist probe — image name only, no user args. */
async function processImagePresent(imageName: string): Promise<'RUNNING' | 'STOPPED' | 'UNKNOWN'> {
  if (process.platform !== 'win32') return 'UNKNOWN'
  try {
    const { stdout } = await execFileAsync(
      'tasklist',
      ['/FI', `IMAGENAME eq ${imageName}`, '/NH'],
      { windowsHide: true, timeout: 5_000, encoding: 'utf8' },
    )
    const text = String(stdout)
    if (/INFO: No tasks are running/i.test(text) || !text.toLowerCase().includes(imageName.toLowerCase())) {
      return 'STOPPED'
    }
    return 'RUNNING'
  } catch {
    return 'UNKNOWN'
  }
}

const APPROVED_LOG_ROOTS = [
  path.join('.war-room', 'logs'),
  path.join('ops', 'production-supervisor'),
] as const

export function resolveApprovedLogPath(
  repoRoot: string,
  relativePath: string,
): { ok: true; abs: string } | { ok: false; reason: string } {
  const rel = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/')
  if (rel.includes('..') || path.isAbsolute(relativePath)) {
    return { ok: false, reason: 'Path escape denied.' }
  }
  const allowed = APPROVED_LOG_ROOTS.some(root => rel === root.replace(/\\/g, '/') || rel.startsWith(root.replace(/\\/g, '/') + '/'))
  if (!allowed) return { ok: false, reason: 'Log path not in approved operational roots.' }
  const abs = path.resolve(repoRoot, rel)
  if (!abs.startsWith(path.resolve(repoRoot))) return { ok: false, reason: 'Resolved outside repository.' }
  return { ok: true, abs }
}

export function envPresenceOnly(names: readonly string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const n of names) {
    const v = process.env[n]
    out[n] = typeof v === 'string' && v.trim().length > 0
  }
  return out
}

export async function runOperationsDiagnostics(input: {
  scope: OperationsAgentScope
  /** Simulated prior health failure that later recovered (validation). */
  simulateTransientRecovery?: boolean
  /** Inject wrong-process signal for finding-only validation. */
  simulateWrongProcessOn3000?: boolean
  /** Inject restart-storm signal for finding-only validation. */
  simulateRestartStorm?: boolean
}): Promise<DiagnosticBundle> {
  const scope = input.scope
  const repoRoot = resolveRepoRoot()
  const checks: OperationsCheckRun[] = []
  const findings: OperationsFinding[] = []
  const unavailable: string[] = []
  const allowed = new Set(scope.allowed_diagnostics)

  const health_summary: Record<string, unknown> = {}
  const process_summary: Record<string, unknown> = { observer_pid: process.pid }
  const port_summary: Record<string, unknown> = {}
  const watchdog_summary: Record<string, unknown> = {}
  const public_route_summary: Record<string, unknown> = {}
  const dependency_summary: Record<string, unknown> = {}

  // —— LOCAL HEALTH (:3000) ——
  if (allowed.has('LOCAL_HEALTH')) {
    const listening = await probeTcp(3000)
    port_summary.port_3000_listening = listening
    if (!listening) {
      checks.push(check('local_health_tcp', 'LOCAL_HEALTH', true, 'Production port :3000 not listening', 'STOPPED'))
      health_summary.local = { state: 'UNAVAILABLE', reason: 'port_3000_not_listening' }
      findings.push(
        makeOpsFinding({
          title: 'Local production port :3000 not listening',
          severity: 'HIGH',
          category: 'LOCAL_HEALTH',
          target: ':3000',
          status: 'UNAVAILABLE',
          evidence: ['tcp_connect_failed'],
          expected_state: 'RUNNING',
          actual_state: 'STOPPED',
          confidence: 'HIGH',
          recommended_action: 'Commander may investigate/restart production via governed supervisor — agent will not restart.',
          action_kind_if_needed: 'PRODUCTION_RESTART',
          approval_required: true,
          requires_commander: true,
          runtime_truth: 'LOCAL_HEALTH=UNAVAILABLE; auto_restart=false',
        }),
      )
    } else {
      const health = await fetchJson('http://127.0.0.1:3000/api/health')
      const body = (health.body && typeof health.body === 'object' ? health.body : {}) as Record<string, unknown>
      const statusField = typeof body.status === 'string' ? body.status : null
      const state: OperationsTruthState =
        health.ok && statusField === 'ok' ? 'HEALTHY' : health.ok && statusField === 'degraded' ? 'DEGRADED' : health.ok ? 'UNKNOWN' : 'UNHEALTHY'
      health_summary.local = {
        httpStatus: health.status,
        status: statusField,
        version: body.version ?? null,
        checks: body.checks ?? null,
        state,
      }
      checks.push(check('local_health_http', 'LOCAL_HEALTH', health.ok, `local /api/health ${health.status} ${statusField}`, state))
      if (state === 'DEGRADED') {
        findings.push(
          makeOpsFinding({
            title: 'Local health reports dependency degradation',
            severity: 'MEDIUM',
            category: 'LOCAL_HEALTH',
            target: 'local:/api/health',
            status: 'DEGRADED',
            evidence: [JSON.stringify(body.checks ?? {})],
            expected_state: 'HEALTHY',
            actual_state: 'DEGRADED',
            confidence: 'HIGH',
            recommended_action: 'Inspect dependency reachability; do not restart web shell solely for dependency degradation.',
            action_kind_if_needed: null,
            approval_required: false,
            requires_commander: false,
            runtime_truth: 'LOCAL_HEALTH=DEGRADED; application may still be healthy',
          }),
        )
      }
    }
  }

  // —— PUBLIC HEALTH ——
  if (allowed.has('PUBLIC_HEALTH')) {
    const { url, sources } = resolveProductionCandidateUrl()
    if (!url) {
      public_route_summary.state = 'NOT_CONFIGURED'
      public_route_summary.sources = sources
      checks.push(check('public_health', 'PUBLIC_HEALTH', true, 'No public URL configured', 'NOT_CONFIGURED'))
    } else {
      const health = await fetchJson(`${url.replace(/\/$/, '')}/api/health`, 5000)
      const body = (health.body && typeof health.body === 'object' ? health.body : {}) as Record<string, unknown>
      const statusField = typeof body.status === 'string' ? body.status : null
      const state: OperationsTruthState =
        health.ok && (statusField === 'ok' || statusField === 'degraded')
          ? statusField === 'degraded'
            ? 'DEGRADED'
            : 'HEALTHY'
          : health.ok
            ? 'UNKNOWN'
            : 'UNAVAILABLE'
      public_route_summary.url_source = sources[0] ?? null
      public_route_summary.httpStatus = health.status
      public_route_summary.status = statusField
      public_route_summary.state = state
      // Never log full URL if it could embed secrets — sources only
      checks.push(check('public_health', 'PUBLIC_HEALTH', true, `public health ${health.status} ${state}`, state))
    }
  }

  // Cloudflare metadata UNKNOWN must not override public PASS
  if (allowed.has('CLOUDFLARED_STATUS')) {
    const cf = await processImagePresent('cloudflared.exe')
    const metaState: OperationsTruthState =
      cf === 'RUNNING' ? 'RUNNING' : cf === 'STOPPED' ? 'STOPPED' : 'INCONCLUSIVE'
    dependency_summary.cloudflared = { process: cf, state: metaState }
    checks.push(check('cloudflared_process', 'CLOUDFLARED_STATUS', true, `cloudflared=${cf}`, metaState))
    if (metaState === 'INCONCLUSIVE' || metaState === 'STOPPED') {
      findings.push(
        makeOpsFinding({
          title: 'Cloudflared process metadata inconclusive or stopped',
          severity: 'INFO',
          category: 'CLOUDFLARE',
          target: 'cloudflared',
          status: metaState === 'STOPPED' ? 'STOPPED' : 'INCONCLUSIVE',
          evidence: [`process=${cf}`],
          expected_state: 'RUNNING_or_UNKNOWN_ok_if_public_pass',
          actual_state: metaState,
          confidence: 'MEDIUM',
          recommended_action:
            public_route_summary.state === 'HEALTHY' || public_route_summary.state === 'DEGRADED'
              ? 'Public route already proves reach — do not treat missing cloudflared CLI metadata as production failure.'
              : 'If public route also fails, Commander may inspect tunnel — agent will not modify Cloudflare.',
          action_kind_if_needed: 'CLOUDFLARE_CHANGE',
          approval_required: true,
          requires_commander: true,
          runtime_truth: `CLOUDFLARED_METADATA=${metaState}; public=${String(public_route_summary.state)}`,
        }),
      )
    }
  }

  // —— BUILD METADATA ——
  if (allowed.has('BUILD_METADATA')) {
    const meta = await readLocalBuildMeta()
    health_summary.build = meta
      ? { gitSha: meta.gitSha, gitShort: meta.gitShort, gitDirty: meta.gitDirty, builtAt: meta.builtAt, gitRef: meta.gitRef }
      : null
    checks.push(
      check(
        'build_metadata',
        'BUILD_METADATA',
        true,
        meta ? `sha=${meta.gitShort} dirty=${meta.gitDirty}` : 'build-meta absent',
        meta ? 'RUNNING' : 'NOT_CONFIGURED',
      ),
    )
    if (meta?.gitDirty === true) {
      findings.push(
        makeOpsFinding({
          title: 'Build metadata reports gitDirty=true',
          severity: 'LOW',
          category: 'BUILD_IDENTITY',
          target: '.next/build-meta.json',
          status: 'MISMATCH',
          evidence: [`gitSha=${meta.gitSha}`, 'gitDirty=true'],
          expected_state: 'gitDirty=false for production release',
          actual_state: 'gitDirty=true',
          confidence: 'HIGH',
          recommended_action: 'Report only — agent cannot redeploy. Commander may reconcile release.',
          action_kind_if_needed: 'PRODUCTION_DEPLOY',
          approval_required: true,
          requires_commander: true,
          runtime_truth: 'BUILD_DIRTY_OBSERVED; auto_deploy=false',
        }),
      )
    }
  }

  // —— PORTS :3000 / :3001 ——
  if (allowed.has('PORT_STATE')) {
    const p3000 = typeof port_summary.port_3000_listening === 'boolean' ? port_summary.port_3000_listening : await probeTcp(3000)
    const p3001 = await probeTcp(3001)
    port_summary.port_3000_listening = p3000
    port_summary.port_3001_listening = p3001
    port_summary.port_3001_state = p3001 ? 'RUNNING' : 'INTENTIONALLY_DOWN'
    checks.push(check('port_3000', 'PORT_STATE', true, `:3000 listening=${p3000}`, p3000 ? 'RUNNING' : 'STOPPED'))
    checks.push(
      check(
        'port_3001',
        'PORT_STATE',
        true,
        `:3001 ${p3001 ? 'running' : 'intentionally_down_or_stopped'}`,
        p3001 ? 'RUNNING' : 'INTENTIONALLY_DOWN',
      ),
    )
    if (!p3001) {
      findings.push(
        makeOpsFinding({
          title: 'DEV :3001 not running',
          severity: 'INFO',
          category: 'DEV_TOPOLOGY',
          target: ':3001',
          status: 'INTENTIONALLY_DOWN',
          evidence: ['tcp_connect_failed_3001'],
          expected_state: 'INTENTIONALLY_DOWN_when_by_choice',
          actual_state: 'NOT_RUNNING',
          confidence: 'HIGH',
          recommended_action: 'Do not classify as production failure. Do not restart DEV.',
          action_kind_if_needed: 'DEV_RESTART',
          approval_required: true,
          requires_commander: true,
          runtime_truth: 'DEV=:3001 INTENTIONALLY_DOWN; production_unaffected',
        }),
      )
    }
  }

  // —— PROCESS METADATA ——
  if (allowed.has('PROCESS_METADATA')) {
    process_summary.node = process.version
    process_summary.platform = process.platform
    process_summary.pid = process.pid
    checks.push(check('process_observer', 'PROCESS_METADATA', true, `observer pid=${process.pid}`, 'RUNNING'))
    if (input.simulateWrongProcessOn3000) {
      findings.push(
        makeOpsFinding({
          title: 'Wrong process suspected on :3000 (simulated finding)',
          severity: 'HIGH',
          category: 'WRONG_PROCESS',
          target: ':3000',
          status: 'MISMATCH',
          evidence: ['simulated_wrong_process_signal'],
          expected_state: 'war-room production next start',
          actual_state: 'unexpected_process_signature',
          confidence: 'MEDIUM',
          recommended_action: 'Finding only — Commander approval required to kill/replace. Agent will not terminate.',
          action_kind_if_needed: 'PROCESS_TERMINATE',
          approval_required: true,
          requires_commander: true,
          runtime_truth: 'WRONG_PROCESS_DETECTED; auto_kill=false',
        }),
      )
      checks.push(check('wrong_process_finding', 'PROCESS_METADATA', true, 'wrong-process finding emitted (no kill)', 'MISMATCH'))
    }
  }

  // —— WATCHDOG ——
  if (allowed.has('WATCHDOG_STATUS')) {
    const candidates = [
      path.join(repoRoot, '.war-room', 'logs', 'watchdog-state.json'),
      // Production checkout path often used by supervisor — read-only if present
      'C:\\Users\\markb\\Documents\\Codex\\war-room-production\\.war-room\\logs\\watchdog-state.json',
    ]
    let found: string | null = null
    let stateJson: Record<string, unknown> | null = null
    for (const c of candidates) {
      if (existsSync(c)) {
        found = c
        try {
          stateJson = JSON.parse(readFileSync(c, 'utf8')) as Record<string, unknown>
        } catch {
          stateJson = null
        }
        break
      }
    }
    const installScript = path.join(repoRoot, 'ops', 'production-supervisor', 'Install-WarRoomWatchdogTask.ps1')
    watchdog_summary.state_file = found ? 'PRESENT' : 'ABSENT'
    watchdog_summary.installer_in_repo = existsSync(installScript)
    watchdog_summary.restart_count =
      stateJson && typeof stateJson.restartCount === 'number'
        ? stateJson.restartCount
        : stateJson && typeof stateJson.restarts === 'number'
          ? stateJson.restarts
          : null
    checks.push(
      check(
        'watchdog_status',
        'WATCHDOG_STATUS',
        true,
        found ? 'watchdog-state present (read-only)' : 'watchdog-state absent — UNKNOWN',
        found ? 'RUNNING' : 'UNKNOWN',
      ),
    )
    const restartCount = typeof watchdog_summary.restart_count === 'number' ? watchdog_summary.restart_count : 0
    if (input.simulateRestartStorm || restartCount >= 5) {
      findings.push(
        makeOpsFinding({
          title: 'Restart-storm risk observed',
          severity: 'HIGH',
          category: 'RESTART_STORM',
          target: 'watchdog',
          status: 'RESTARTING',
          evidence: [`restart_count=${restartCount}`, input.simulateRestartStorm ? 'simulated' : 'from_state'],
          expected_state: 'restart_count_within_ceiling',
          actual_state: 'RESTART_STORM_RISK',
          confidence: 'MEDIUM',
          recommended_action: 'Finding only — do not disable watchdog or restart. Commander review required.',
          action_kind_if_needed: 'WATCHDOG_CHANGE',
          approval_required: true,
          requires_commander: true,
          runtime_truth: 'RESTART_STORM_RISK; auto_repair=false',
        }),
      )
    }
  }

  // —— OLLAMA ——
  if (allowed.has('OLLAMA_STATUS')) {
    const base = (process.env.OLLAMA_BASE_URL?.trim() || 'http://127.0.0.1:11434').replace(/\/$/, '')
    const tags = await fetchJson(`${base}/api/tags`, 800)
    const proc = await processImagePresent('ollama.exe')
    dependency_summary.ollama = {
      endpoint: tags.ok ? 'REACHABLE' : 'UNREACHABLE',
      process: proc,
      state: tags.ok ? 'RUNNING' : proc === 'RUNNING' ? 'DEGRADED' : 'UNAVAILABLE',
    }
    checks.push(
      check(
        'ollama_status',
        'OLLAMA_STATUS',
        true,
        `ollama endpoint=${tags.ok} process=${proc}`,
        tags.ok ? 'RUNNING' : 'UNAVAILABLE',
      ),
    )
    if (!tags.ok) {
      findings.push(
        makeOpsFinding({
          title: 'Ollama endpoint unavailable',
          severity: 'LOW',
          category: 'DEPENDENCY',
          target: 'ollama',
          status: 'UNAVAILABLE',
          evidence: [`process=${proc}`, 'api/tags_unreachable'],
          expected_state: 'RUNNING_optional',
          actual_state: 'UNAVAILABLE',
          confidence: 'HIGH',
          recommended_action: 'Optional local model dependency. Agent will not restart or reconfigure Ollama.',
          action_kind_if_needed: 'OLLAMA_CONFIG_CHANGE',
          approval_required: true,
          requires_commander: true,
          runtime_truth: 'OLLAMA=UNAVAILABLE; auto_restart=false',
        }),
      )
    }
  }

  // —— ENV PRESENCE (no values) ——
  if (allowed.has('ENV_PRESENCE')) {
    const presence = envPresenceOnly([
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'NEXT_PUBLIC_SITE_URL',
    ])
    health_summary.env_presence = presence
    checks.push(check('env_presence', 'ENV_PRESENCE', true, 'env presence map (no values)', 'RUNNING'))
  }

  // —— APPROVED LOGS ——
  if (allowed.has('APPROVED_LOG_READ')) {
    const logRel = path.join('.war-room', 'logs')
    const resolved = resolveApprovedLogPath(repoRoot, logRel)
    if (!resolved.ok || !existsSync(resolved.abs)) {
      // Also try reading a small ops script as approved operational text
      const opsReadme = resolveApprovedLogPath(repoRoot, path.join('ops', 'production-supervisor', 'README.md'))
      if (opsReadme.ok && existsSync(opsReadme.abs)) {
        const raw = readFileSync(opsReadme.abs, 'utf8').slice(0, scope.max_log_bytes)
        const redacted = redactSecretsFromOutput(raw)
        checks.push(check('approved_log_readme', 'APPROVED_LOG_READ', true, `read ${redacted.length} bytes redacted`, 'RUNNING'))
      } else {
        unavailable.push('APPROVED_LOG_READ')
        checks.push(check('approved_log', 'APPROVED_LOG_READ', true, 'approved logs absent', 'UNKNOWN'))
      }
    } else {
      const files = readdirSync(resolved.abs).slice(0, scope.max_log_reads)
      let bytes = 0
      for (const f of files) {
        const abs = path.join(resolved.abs, f)
        if (!statSync(abs).isFile()) continue
        const chunk = redactSecretsFromOutput(readFileSync(abs, 'utf8').slice(0, scope.max_log_bytes - bytes))
        bytes += chunk.length
        if (bytes >= scope.max_log_bytes) break
      }
      checks.push(check('approved_log', 'APPROVED_LOG_READ', true, `read ${bytes} redacted bytes from ${files.length} files`, 'RUNNING'))
    }
  }

  // Transient recovery model
  if (input.simulateTransientRecovery) {
    findings.push(
      makeOpsFinding({
        title: 'Transient health failure recovered',
        severity: 'INFO',
        category: 'RECOVERY',
        target: 'local:/api/health',
        status: 'RECOVERED',
        evidence: ['prior=UNHEALTHY', 'current=HEALTHY', 'TRANSIENT_FAILURE→RECOVERED'],
        expected_state: 'HEALTHY',
        actual_state: 'RECOVERED',
        confidence: 'MEDIUM',
        recommended_action: 'Monitor only — do not auto-restart after a single transient failure.',
        action_kind_if_needed: null,
        approval_required: false,
        requires_commander: false,
        runtime_truth: 'TRANSIENT_FAILURE→RECOVERED; auto_restart=false',
      }),
    )
    checks.push(check('transient_recovery', 'LOCAL_HEALTH', true, 'RECOVERED after transient failure', 'RECOVERED'))
  }

  // Public PASS + cloudflared UNKNOWN invariant as finding/info already handled

  return {
    checks,
    findings,
    unavailable,
    health_summary,
    process_summary,
    port_summary,
    watchdog_summary,
    public_route_summary,
    dependency_summary,
  }
}
