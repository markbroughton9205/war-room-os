/**
 * #18 Production Supervisor — deterministic structural / decision validation.
 * Does NOT touch live :3000, cloudflared, Ollama, or Scheduled Tasks.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export type SupervisorCase = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): SupervisorCase {
  return { name, pass, detail }
}

function readRepo(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8')
}

/** Mirror of Start-WarRoom / Watchdog War Room ownership gate (command-line evidence). */
export function isWarRoomNodeCommand(commandLine: string | null | undefined): boolean {
  if (!commandLine) return false
  return (
    /\bnext\s+dev\b/i.test(commandLine) ||
    /pnpm\.mjs run\s+dev/i.test(commandLine) ||
    /\bnext\s+start\b/i.test(commandLine) ||
    /start-server\.js/i.test(commandLine) ||
    /\\.next\\dev\\/i.test(commandLine) ||
    /war-room-os/i.test(commandLine) ||
    /war-room-production/i.test(commandLine)
  )
}

export function isDevCommand(commandLine: string | null | undefined): boolean {
  if (!commandLine) return false
  return (
    /\bnext\s+dev\b/i.test(commandLine) ||
    /pnpm\.mjs run\s+dev/i.test(commandLine) ||
    /\\.next\\dev\\/i.test(commandLine)
  )
}

export function isCanonicalProductionCommand(commandLine: string | null | undefined): boolean {
  if (!commandLine) return false
  if (isDevCommand(commandLine)) return false
  const hasStart = /\bnext\s+start\b/i.test(commandLine) || /start-server\.js/i.test(commandLine)
  if (!hasStart) return false
  // Prefer explicit production checkout path when present in the command line.
  if (/war-room-os/i.test(commandLine) && !/war-room-production/i.test(commandLine)) return false
  return /war-room-production/i.test(commandLine) || /\bnext\s+start\b/i.test(commandLine)
}

export function isWrongCheckoutProductionPort(commandLine: string | null | undefined): boolean {
  if (!commandLine) return false
  if (isDevCommand(commandLine)) return true
  return /war-room-os/i.test(commandLine) && !/war-room-production/i.test(commandLine)
}

export type KillDecision = 'kill_war_room' | 'refuse_unrelated' | 'refuse_protected'

export function decideKillTarget(input: {
  commandLine: string | null | undefined
  processName: string
}): KillDecision {
  const name = (input.processName || '').toLowerCase()
  if (name.includes('cloudflared') || name.includes('ollama')) return 'refuse_protected'
  if (name !== 'node.exe' && name !== 'node') return 'refuse_unrelated'
  if (!isWarRoomNodeCommand(input.commandLine)) return 'refuse_unrelated'
  return 'kill_war_room'
}

export function applyRestartCeiling(input: {
  restartCount: number
  maxRestarts: number
  windowMinutes: number
  windowAgeMinutes: number
}): { count: number; allowRestart: boolean; reason: string } {
  let count = input.restartCount
  if (input.windowAgeMinutes > input.windowMinutes) {
    count = 0
  }
  if (count >= input.maxRestarts) {
    return { count, allowRestart: false, reason: 'ceiling_reached' }
  }
  return { count: count + 1, allowRestart: true, reason: 'restart_allowed' }
}

export function classifyApplicationHealth(input: {
  httpResponding: boolean
  hungOrigin: boolean
  database: 'ok' | 'unreachable' | 'skipped'
  ollama: 'ok' | 'unreachable' | 'skipped'
}): 'APPLICATION_HEALTHY' | 'DEPENDENCY_DEGRADED' | 'APPLICATION_UNHEALTHY' {
  if (!input.httpResponding || input.hungOrigin) return 'APPLICATION_UNHEALTHY'
  const depBad =
    input.database === 'unreachable' || input.ollama === 'unreachable'
  return depBad ? 'DEPENDENCY_DEGRADED' : 'APPLICATION_HEALTHY'
}

export function runProductionSupervisorValidation(): SupervisorCase[] {
  const cases: SupervisorCase[] = []

  const start = readRepo('ops/production-supervisor/Start-WarRoom.ps1')
  const healthPs = readRepo('ops/production-supervisor/Test-WarRoomHealth.ps1')
  const watchdog = readRepo('ops/production-supervisor/Watchdog-WarRoom.ps1')
  const install = readRepo('ops/production-supervisor/Install-WarRoomWatchdogTask.ps1')
  const readme = readRepo('ops/production-supervisor/README.md')
  const pkg = JSON.parse(readRepo('package.json')) as { scripts?: Record<string, string> }
  const healthRoute = readRepo('app/api/health/route.ts')
  const middleware = readRepo('middleware.ts')
  const supabaseMw = readRepo('lib/supabase/middleware.ts')
  const roadmap = readRepo('docs/MASTER_OS_ROADMAP.md')

  cases.push(check(
    '18_01_single_canonical_source_dir',
    existsSync(join(process.cwd(), 'ops/production-supervisor')) &&
      !existsSync(join(process.cwd(), 'ops/production-supervisor-2')) &&
      !existsSync(join(process.cwd(), 'ops/Supervisor2')),
    'ops/production-supervisor only',
  ))

  cases.push(check(
    '18_02_dev_port_3001_in_package_json',
    typeof pkg.scripts?.dev === 'string' && /next\s+dev\s+--port\s+3001/.test(pkg.scripts.dev),
    String(pkg.scripts?.dev),
  ))

  cases.push(check(
    '18_03_prod_port_contract_in_start',
    /\$productionPort\s*=\s*3000/.test(start) &&
      /nextPath start --hostname 127\.0\.0\.1 --port \$productionPort/.test(start),
    'next start 127.0.0.1:3000',
  ))

  cases.push(check(
    '18_04_health_route_public_fast',
    /CHEAP_PROBE_MS\s*=\s*400/.test(healthRoute) &&
      /AbortSignal\.timeout/.test(healthRoute) &&
      !/executeCouncilChatRequest|familyDeliberation|from '@\/lib\/research-engine'|overpassClient|runAstra/i.test(healthRoute),
    'bounded cheap probes; no Council/Terra/research invocations',
  ))

  cases.push(check(
    '18_05_middleware_health_bypass',
    /api\/health/.test(middleware) && /\/api\/health/.test(supabaseMw),
    'middleware + supabase bypass',
  ))

  cases.push(check(
    '18_06_health_semantics_status_field',
    /status:\s*'ok'\s*\|\s*'degraded'/.test(healthRoute) ||
      /status:\s*\(depsDegraded\s*\?\s*'degraded'\s*:\s*'ok'\)/.test(healthRoute) ||
      /'degraded'/.test(healthRoute),
    'ok|degraded present',
  ))

  cases.push(check(
    '18_07_start_refuses_unrelated_listener',
    /REFUSING to stop non-War-Room listener/.test(start) &&
      /Test-IsWarRoomNodeCommand/.test(start) &&
      /exit 3/.test(start),
    'refuse + exit 3',
  ))

  cases.push(check(
    '18_08_watchdog_ownership_gate_before_kill',
    /Test-IsWarRoomNodeCommand|isWarRoomNodeCommand|REFUSING to stop non-War-Room/.test(watchdog) &&
      /Never touches Cloudflared|never touches cloudflared/i.test(watchdog),
    'ownership gate present',
  ))

  cases.push(check(
    '18_09_watchdog_restart_ceiling',
    /\$maxRestartsPerWindow\s*=\s*5/.test(watchdog) &&
      /\$windowMinutes\s*=\s*30/.test(watchdog) &&
      /BACKOFF:/.test(watchdog),
    '5 / 30 min',
  ))

  cases.push(check(
    '18_10_install_task_contract',
    /WarRoomProductionWatchdog/.test(install) &&
      /AtStartup/.test(install) &&
      /Minutes 2/.test(install) &&
      /Administrator/.test(install) &&
      /\.war-room\\Watchdog-WarRoom\.ps1/.test(install),
    'task name + triggers + admin + runtime path',
  ))

  cases.push(check(
    '18_11_health_ps_http_preferred',
    /\/api\/health/.test(healthPs) && /hungOrigin/.test(healthPs) && /devOccupyingPort/.test(healthPs),
    'HTTP + hung + dev flags',
  ))

  cases.push(check(
    '18_12_wrong_checkout_detection',
    /wrongCheckout|war-room-os/.test(healthPs) && /war-room-production/.test(healthPs),
    'checkout evidence fields',
  ))

  cases.push(check(
    '18_13_no_cloudflared_ollama_kill',
    !/Stop-Process.*cloudflared/i.test(start + watchdog) &&
      !/Stop-Process.*[Oo]llama/.test(start + watchdog) &&
      /never (touch|stop|restart).*cloudflared/i.test(readme),
    'no protected kills',
  ))

  cases.push(check(
    '18_14_source_runtime_sync_one_way',
    /source of truth/i.test(readme) &&
      /war-room-production\\.war-room/i.test(readme) &&
      (/no bidirectional automatic sync/i.test(readme) || /intentionally copied/i.test(readme) || /intentionally synced/i.test(readme)),
    'one-way sync documented',
  ))

  const roadmap18 = roadmap.split('\n').find((l) => /\|\s*18\s*\|/.test(l)) ?? ''
  cases.push(check(
    '18_15_roadmap_18_status_row',
    /Production Supervisor Activation/.test(roadmap18) &&
      (/READY FOR ACTIVATION|IN PROGRESS|IMPLEMENTED/.test(roadmap18)) &&
      /NOT CLOSED/.test(roadmap18) &&
      !/\bCLOSED\b/.test(roadmap18.replace(/NOT CLOSED/g, '')),
    'roadmap row READY FOR ACTIVATION and NOT CLOSED until live activation',
  ))

  // Decision-function dry runs (no live processes)
  cases.push(check(
    '18_16_healthy_prod_command_recognized',
    isCanonicalProductionCommand(
      'node.exe C:\\Users\\markb\\Documents\\Codex\\war-room-production\\node_modules\\next\\dist\\bin\\next start --hostname 127.0.0.1 --port 3000',
    ),
    'canonical next start',
  ))

  cases.push(check(
    '18_17_dev_on_3000_identified',
    isDevCommand('node.exe ... next dev --port 3000') &&
      isWrongCheckoutProductionPort('node.exe ...\\war-room-os\\... next start --port 3000'),
    'dev + wrong checkout',
  ))

  cases.push(check(
    '18_18_unrelated_node_not_killed',
    decideKillTarget({
      processName: 'node.exe',
      commandLine: 'node.exe C:\\tools\\unrelated-app\\server.js --port 3000',
    }) === 'refuse_unrelated',
    'refuse unrelated',
  ))

  cases.push(check(
    '18_19_cloudflared_ollama_protected',
    decideKillTarget({ processName: 'cloudflared.exe', commandLine: 'cloudflared tunnel run' }) === 'refuse_protected' &&
      decideKillTarget({ processName: 'ollama.exe', commandLine: 'ollama serve' }) === 'refuse_protected',
    'protected services',
  ))

  cases.push(check(
    '18_20_war_room_dev_kill_allowed',
    decideKillTarget({
      processName: 'node.exe',
      commandLine: 'node.exe ...\\war-room-os\\node_modules\\next\\dist\\bin\\next dev --port 3000',
    }) === 'kill_war_room',
    'kill wrong War Room occupant',
  ))

  const ceilingOk = applyRestartCeiling({
    restartCount: 4,
    maxRestarts: 5,
    windowMinutes: 30,
    windowAgeMinutes: 10,
  })
  const ceilingBlock = applyRestartCeiling({
    restartCount: 5,
    maxRestarts: 5,
    windowMinutes: 30,
    windowAgeMinutes: 10,
  })
  const ceilingReset = applyRestartCeiling({
    restartCount: 5,
    maxRestarts: 5,
    windowMinutes: 30,
    windowAgeMinutes: 31,
  })
  cases.push(check(
    '18_21_restart_ceiling',
    ceilingOk.allowRestart && !ceilingBlock.allowRestart && ceilingReset.allowRestart,
    `ok=${ceilingOk.reason} block=${ceilingBlock.reason} reset=${ceilingReset.reason}`,
  ))

  cases.push(check(
    '18_22_health_classification',
    classifyApplicationHealth({
      httpResponding: true,
      hungOrigin: false,
      database: 'ok',
      ollama: 'ok',
    }) === 'APPLICATION_HEALTHY' &&
      classifyApplicationHealth({
        httpResponding: true,
        hungOrigin: false,
        database: 'unreachable',
        ollama: 'ok',
      }) === 'DEPENDENCY_DEGRADED' &&
      classifyApplicationHealth({
        httpResponding: false,
        hungOrigin: true,
        database: 'ok',
        ollama: 'ok',
      }) === 'APPLICATION_UNHEALTHY',
    'three-state semantics',
  ))

  cases.push(check(
    '18_23_start_logs_required_fields',
    /Write-StartLog/.test(start) &&
      /Starting War Room/.test(start) &&
      /STOPPING incorrect War Room occupant/.test(start) &&
      /war-room-production\.log/.test(start),
    'start log coverage',
  ))

  cases.push(check(
    '18_24_watchdog_logs_required_fields',
    /RESTARTING:/.test(watchdog) &&
      /BACKOFF:/.test(watchdog) &&
      /watchdog\.log/.test(watchdog) &&
      /watchdog-state\.json/.test(watchdog),
    'watchdog log coverage',
  ))

  cases.push(check(
    '18_25_no_secret_logging_patterns',
    !/SUPABASE_SERVICE_ROLE|API_KEY|PASSWORD|Bearer\s/i.test(start + watchdog + healthPs),
    'no secret literals in supervisor scripts',
  ))

  cases.push(check(
    '18_26_council_boundary_documented',
    /councilReady/.test(healthPs) && /UNKNOWN_REQUIRES_AUTHENTICATED_SESSION/.test(healthPs),
    'Council not part of origin health',
  ))

  cases.push(check(
    '18_27_http_preferred_over_tcp_only',
    /Test-HttpResponding|Test-ApplicationResponding/.test(start + healthPs) &&
      /port open is \*\*not\*\* healthy|TCP port open ≠ healthy|PORT_LISTENING/i.test(readme + healthPs),
    'HTTP preferred',
  ))

  cases.push(check(
    '18_28_startup_idempotent_documented',
    /startup skipped|Idempotent/i.test(start + watchdog + readme),
    'idempotent start',
  ))

  return cases
}
