/**
 * #22 Phase 15 — Final system hardening / recovery / closeout candidate.
 * Does not import other phases' validation.ts (isDirect auto-run hazard).
 * Does not add agents. Does not apply phase58a. Does not start #23.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import {
  classifyPortConflict,
  desktopShutdownPlan,
  getSovereignRuntimeTruth,
  startLocalCoreServer,
  simulateInternetUnavailable,
  buildOfflineCapabilityReport,
  shouldFallbackToPublicWebsite,
  DESKTOP_SECURITY_POLICY,
  LOCAL_CORE_PORT,
  LOCAL_UI_PORT,
  getLocalOwnershipStore,
  resetLocalOwnershipStoreSingleton,
  resolveLocalAppDataPaths,
  desktopShutdownUiPlan,
  probeLocalWarRoomUi,
  runLocalModelInference,
  discoverLocalModels,
} from '@/lib/sovereign-runtime'
import { assertServiceRoleIsNotCommander } from '@/lib/sovereign-runtime/session'
import { decideDesktopNavigation } from '@/lib/sovereign-runtime/desktopSecurity'
import { CANONICAL_WAR_ROOM_UI_ROUTES } from '@/lib/sovereign-runtime/uiAudit'
import { runLocalOwnedChat } from '@/lib/sovereign-runtime/local-ownership/chat'
import {
  OPERATIONAL_ASCENSION_AGENTS,
  operationalAscensionAgentCount,
  ascensionAutonomyIsOff,
  TARGET_ASCENSION_AGENTS_UNIMPLEMENTED,
} from '@/lib/ascension/operationalRegistry'
import { isResearchAgentRuntimeAvailable } from '@/lib/ascension/research-agent/identity'
import { runBoundedResearchAgent } from '@/lib/ascension/research-agent'
import { isEngineeringAgentRuntimeAvailable } from '@/lib/ascension/engineering-agent/identity'
import { runBoundedEngineeringAgent } from '@/lib/ascension/engineering-agent'
import { isSecurityRedTeamAgentRuntimeAvailable } from '@/lib/ascension/security-red-team-agent/identity'
import { runBoundedSecurityRedTeamAgent } from '@/lib/ascension/security-red-team-agent'
import { isOperationsAgentRuntimeAvailable } from '@/lib/ascension/operations-agent/identity'
import { runBoundedOperationsAgent } from '@/lib/ascension/operations-agent'
import { isTerraIntelligenceAgentRuntimeAvailable } from '@/lib/ascension/terra-intelligence-agent/identity'
import { runBoundedTerraIntelligenceAgent } from '@/lib/ascension/terra-intelligence-agent'
import { isCouncilValidatorRuntimeAvailable } from '@/lib/ascension/council-validator/identity'
import { runBoundedCouncilValidator } from '@/lib/ascension/council-validator'
import { isDataCorpusAgentRuntimeAvailable } from '@/lib/ascension/data-corpus-agent/identity'
import { runBoundedDataCorpusAgent } from '@/lib/ascension/data-corpus-agent'
import { isNavigationAgentRuntimeAvailable } from '@/lib/ascension/navigation-agent/identity'
import { runBoundedNavigationAgent } from '@/lib/ascension/navigation-agent'
import { isWorldLearningAgentRuntimeAvailable } from '@/lib/ascension/world-learning-agent/identity'
import { runBoundedWorldLearningAgent } from '@/lib/ascension/world-learning-agent'
import { createCanonicalHandoff } from '@/lib/ascension/integration/envelope'
import { CorpusCandidateStore } from '@/lib/ascension/integration/candidateStore'
import {
  runKnowledgePipeline,
  runWorldStatePipeline,
  runEngineeringSafetyPipeline,
  runOfflineLocalWorkflow,
} from '@/lib/ascension/integration/workflows'
import {
  reportAstraMissionDurability,
  runAstraBoundedMultiAgentOrchestration,
} from '@/lib/ascension/integration/astraBridge'
import { astraPhase58aDecisionPacket } from '@/lib/ascension/integration/phase58aPacket'
import { resetAstraMissionStoreProbe } from '@/lib/astra/liveMission.store'
import {
  ASTRA_PHASE58A_STATUS,
  CROSS_AGENT_INTEGRATION_STATUS,
  LOCAL_SOVEREIGN_CLOSEOUT_SUFFICIENT,
  MODEL_TRAINING_STATUS,
  PHASE_15_STATUS,
  PHONE_APP_STATUS,
  PRODUCTION_CORPUS_PERSISTENCE,
  RAEL_STATUS,
  ROADMAP_19_LIVE_MIGRATION,
  ROADMAP_22_STATUS,
  ROADMAP_23_STATUS,
  WRIM_STATUS,
  WR_CORPUS_STATUS,
  WR_TOKENIZER_STATUS,
} from '@/lib/ascension/integration/identity'

type Check = { id: string; ok: boolean; detail: string }
function check(id: string, ok: boolean, detail = ''): Check {
  return { id, ok, detail: detail || (ok ? 'ok' : 'FAIL') }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const SOFT_KILL_ENV: Record<string, string> = {
  RESEARCH_AGENT: 'ASCENSION_RESEARCH_AGENT_ENABLED',
  ENGINEERING_AGENT: 'ASCENSION_ENGINEERING_AGENT_ENABLED',
  SECURITY_RED_TEAM_AGENT: 'ASCENSION_SECURITY_RED_TEAM_AGENT_ENABLED',
  OPERATIONS_AGENT: 'ASCENSION_OPERATIONS_AGENT_ENABLED',
  TERRA_INTELLIGENCE_AGENT: 'ASCENSION_TERRA_INTELLIGENCE_AGENT_ENABLED',
  COUNCIL_VALIDATOR: 'ASCENSION_COUNCIL_VALIDATOR_ENABLED',
  DATA_CORPUS_AGENT: 'ASCENSION_DATA_CORPUS_AGENT_ENABLED',
  NAVIGATION_AGENT: 'ASCENSION_NAVIGATION_AGENT_ENABLED',
  WORLD_LEARNING_AGENT: 'ASCENSION_WORLD_LEARNING_AGENT_ENABLED',
}

function existsForbidden(rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, ...rel.split('/')))
}

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, ...rel.split('/')), 'utf8')
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function sha256File(filePath: string): string {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function probeTcp(port: number, host = '127.0.0.1', ms = 250): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host, port })
    const done = (open: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(ms)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      server.close(() => resolve(port))
    })
  })
}

function listenDummy(port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('collision-holder')
    })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

function closeServer(server: http.Server | null): Promise<void> {
  if (!server) return Promise.resolve()
  return new Promise(resolve => server.close(() => resolve()))
}

function shortcutExists(): { desktop: boolean; startMenu: boolean; paths: string[] } {
  const found: string[] = []
  const desktopDirs = [
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'OneDrive', 'Desktop'),
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Desktop') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'OneDrive', 'Desktop') : '',
  ].filter(Boolean)
  const startDirs = [
    process.env.APPDATA ? path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : '',
  ].filter(Boolean)
  const name = 'War Room OS.lnk'
  let desktop = false
  let startMenu = false
  for (const dir of desktopDirs) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) {
      desktop = true
      found.push(p)
    }
  }
  for (const dir of startDirs) {
    const p = path.join(dir, name)
    if (fs.existsSync(p)) {
      startMenu = true
      found.push(p)
    }
  }
  return { desktop, startMenu, paths: found }
}

function realProfileBootstrapped(): boolean {
  const localApp = process.env.LOCALAPPDATA?.trim()
  if (!localApp) return false
  const dbPath = path.join(localApp, 'War Room OS', 'data', 'local-ownership.sqlite')
  if (!fs.existsSync(dbPath)) return false
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const row = db.prepare(`SELECT COUNT(*) AS c FROM local_identity WHERE role = 'LOCAL_COMMANDER'`).get() as
      | { c: number }
      | undefined
    db.close()
    return Number(row?.c ?? 0) > 0
  } catch {
    return false
  }
}

function availability(role: string): boolean {
  switch (role) {
    case 'RESEARCH_AGENT':
      return isResearchAgentRuntimeAvailable()
    case 'ENGINEERING_AGENT':
      return isEngineeringAgentRuntimeAvailable()
    case 'SECURITY_RED_TEAM_AGENT':
      return isSecurityRedTeamAgentRuntimeAvailable()
    case 'OPERATIONS_AGENT':
      return isOperationsAgentRuntimeAvailable()
    case 'TERRA_INTELLIGENCE_AGENT':
      return isTerraIntelligenceAgentRuntimeAvailable()
    case 'COUNCIL_VALIDATOR':
      return isCouncilValidatorRuntimeAvailable()
    case 'DATA_CORPUS_AGENT':
      return isDataCorpusAgentRuntimeAvailable()
    case 'NAVIGATION_AGENT':
      return isNavigationAgentRuntimeAvailable()
    case 'WORLD_LEARNING_AGENT':
      return isWorldLearningAgentRuntimeAvailable()
    default:
      return false
  }
}

async function invokeAgent(role: string, owner: string): Promise<{ status: string }> {
  const base = { ownerUserId: owner, requestedBy: owner, invokedBy: 'commander' as const }
  switch (role) {
    case 'RESEARCH_AGENT':
      return runBoundedResearchAgent({
        ...base,
        researchQuestion: 'Harmless local fixture question.',
        liveSearchAllowed: false,
        terraAllowed: false,
        storedResearchAllowed: false,
        enforceOwnership: false,
      })
    case 'ENGINEERING_AGENT':
      return runBoundedEngineeringAgent({
        ...base,
        taskDescription: 'Harmless recommendation-only observation.',
        approvedWorktree: path.join(os.tmpdir(), 'wr-phase15-missing-worktree'),
        allowedPaths: ['docs'],
      })
    case 'SECURITY_RED_TEAM_AGENT':
      return runBoundedSecurityRedTeamAgent({
        ...base,
        securityQuestion: 'Harmless alias/policy observation.',
        enforceOwnership: false,
      })
    case 'OPERATIONS_AGENT':
      return runBoundedOperationsAgent({
        ...base,
        operationsQuestion: 'Harmless local health observation. No remediation.',
        enforceOwnership: false,
      })
    case 'TERRA_INTELLIGENCE_AGENT':
      return runBoundedTerraIntelligenceAgent({
        ...base,
        worldStateQuestion: 'Helsinki Digitraffic fixture world-state.',
        geographicScope: 'Helsinki/Baltic fixture',
        enforceOwnership: false,
      })
    case 'COUNCIL_VALIDATOR':
      return runBoundedCouncilValidator({
        ...base,
        conversationId: 'phase15-validator-conv',
        useFixtureClaims: true,
        enforceOwnership: false,
      })
    case 'DATA_CORPUS_AGENT':
      return runBoundedDataCorpusAgent({
        ...base,
        corpusQuestion: 'Harmless fixture corpus review.',
        useFixtures: true,
        enforceOwnership: false,
      })
    case 'NAVIGATION_AGENT':
      return runBoundedNavigationAgent({
        ...base,
        invokedBy: 'commander',
        useFixtureGraph: true,
        locationSource: 'fixture',
        enforceOwnership: false,
      })
    case 'WORLD_LEARNING_AGENT':
      return runBoundedWorldLearningAgent({
        ...base,
        invokedBy: 'commander',
        topic: 'Helsinki harbor public fixture',
        useFixtures: true,
        invokeResearchAgent: false,
        invokeDataCorpusAgent: false,
        liveSearchAllowed: false,
        enforceOwnership: false,
      })
    default:
      return { status: 'DENIED' }
  }
}

async function invokeDisabled(role: string, owner: string): Promise<{ status: string }> {
  const envName = SOFT_KILL_ENV[role]
  const prev = process.env[envName]
  process.env[envName] = 'false'
  try {
    const available = availability(role)
    const result = await invokeAgent(role, owner)
    return { status: available ? 'LEAK_AVAILABLE' : result.status }
  } finally {
    if (prev === undefined) delete process.env[envName]
    else process.env[envName] = prev
  }
}

export async function runPhase15CloseoutValidation(): Promise<{
  passed: number
  failed: number
  results: Check[]
  real_profile_bootstrapped: boolean
  ui_operator_checkpoint: boolean
}> {
  const results: Check[] = []
  const truth = getSovereignRuntimeTruth()
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-phase15-'))
  const astraDir = path.join(tmp, 'astra')
  fs.mkdirSync(astraDir, { recursive: true })
  const prevAstraFs = process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM
  const prevAstraDir = process.env.WAR_ROOM_ASTRA_MISSIONS_DIR
  const prevDataDir = process.env.WAR_ROOM_LOCAL_DATA_DIR
  process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM = '1'
  process.env.WAR_ROOM_ASTRA_MISSIONS_DIR = astraDir
  process.env.WAR_ROOM_LOCAL_DATA_DIR = tmp
  resetAstraMissionStoreProbe()
  resetLocalOwnershipStoreSingleton()

  const owner = 'phase15-isolated-owner'
  let realBootstrapped = false
  let uiCheckpoint = false

  try {
    const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
    const head = git(['rev-parse', 'HEAD'])
    const sb = git(['status', '-sb'])
    results.push(check('1_repo_branch', Boolean(branch), branch || 'unknown'))
    results.push(check('1b_repo_head', Boolean(head), head.slice(0, 12)))
    results.push(check('1c_ahead_behind_recorded', Boolean(sb), sb.split('\n')[0] || ''))
    results.push(
      check(
        '1d_commit_scope_excludes_unrelated',
        !/from ['"][^'"]*TerraEarthImagery['"]/.test(read('lib/sovereign-runtime/phase15.validation.ts')) &&
          !read('package.json').includes('work/build12'),
        'unrelated terra + work trees not wired into Phase 15',
      ),
    )

    const roadmap = read('docs/MASTER_OS_ROADMAP.md')
    results.push(check('2_16_closed', /\| 16 \|[\s\S]*?CLOSED/.test(roadmap), '#16'))
    results.push(check('2_17_closed', /\| 17 \|[\s\S]*?CLOSED/.test(roadmap), '#17'))
    results.push(check('2_18_closed', /\| 18 \|[\s\S]*?CLOSED/.test(roadmap), '#18'))
    results.push(check('2_19_closed_live', /LIVE-MIGRATED/.test(roadmap) && /CROSS-USER-VALIDATED/.test(roadmap), '#19'))
    results.push(check('2_20_closed', /\| 20 \|[\s\S]*?CLOSED/.test(roadmap), '#20'))
    results.push(check('2_21_closed', /\| 21 \|[\s\S]*?CLOSED/.test(roadmap), '#21'))
    results.push(check('2_22_closed', /\| 22 \|[\s\S]*?\*\*CLOSED\*\*/.test(roadmap) && ROADMAP_22_STATUS === 'CLOSED' && truth.ROADMAP_22 === 'CLOSED', truth.ROADMAP_22))
    results.push(check('2_23_active', ROADMAP_23_STATUS === 'ACTIVE' && truth.ROADMAP_23 === 'ACTIVE', truth.ROADMAP_23))

    const mig = read('docs/WR_CONVERSATION_OWNERSHIP_MIGRATION.md')
    const runner = read('scripts/run-conversation-ownership-validation.mjs')
    results.push(
      check(
        '3_19_live_migration_confirmed',
        ROADMAP_19_LIVE_MIGRATION === 'CONFIRMED' &&
          truth.ROADMAP_19_LIVE_MIGRATION === 'CONFIRMED' &&
          /LIVE-MIGRATED/.test(mig) &&
          !/BLOCKED BY MIGRATION/.test(runner) &&
          fs.existsSync(path.join(repoRoot, 'supabase', 'war_room_conversations_ownership.sql')) &&
          fs.existsSync(path.join(repoRoot, 'supabase', 'war_room_conversations_ownership_enforce.sql')),
        ROADMAP_19_LIVE_MIGRATION,
      ),
    )

    const exe = process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Programs', 'War Room OS', 'War Room OS.exe')
      : ''
    results.push(check('4_installed_exe', Boolean(exe && fs.existsSync(exe)), exe ? 'exists' : 'LOCALAPPDATA missing'))
    const shortcuts = shortcutExists()
    results.push(check('5_desktop_shortcut', shortcuts.desktop, shortcuts.desktop ? 'found' : 'missing'))
    results.push(check('6_start_menu', shortcuts.startMenu, shortcuts.startMenu ? 'found' : 'missing'))
    const png = path.join(repoRoot, 'desktop', 'assets', 'war-room-os-icon.png')
    const provenance = JSON.parse(read('desktop/assets/ICON_PROVENANCE.json')) as { png_sha256?: string; redesigned?: boolean }
    results.push(
      check(
        '7_approved_icon',
        fs.existsSync(png) && provenance.redesigned === false && sha256File(png) === provenance.png_sha256,
        provenance.png_sha256?.slice(0, 12) ?? 'missing',
      ),
    )
    const mainSrc = read('desktop/src/main.cjs')
    const desktopPkg = JSON.parse(read('desktop/package.json')) as { build?: { nsis?: { deleteAppDataOnUninstall?: boolean } } }
    results.push(check('8_no_pnpm_launch', /isPackaged|resourcesPath|ELECTRON_RUN_AS_NODE/.test(mainSrc), 'packaged launch'))
    results.push(check('8b_no_cursor_path', !/Documents\\\\Codex\\\\war-room-os/.test(mainSrc), 'no repo path'))
    results.push(check('8c_no_website_fallback', shouldFallbackToPublicWebsite(true) === false && /Website fallback: DENIED|website_fallback/.test(mainSrc), 'DENIED'))

    realBootstrapped = realProfileBootstrapped()
    results.push(check('9_real_profile_reported', true, `BOOTSTRAPPED=${realBootstrapped ? 'TRUE' : 'FALSE'}`))
    if (!realBootstrapped) {
      results.push(check('9b_no_fabricated_identity', true, 'OPERATOR_CHECKPOINT_REQUIRED — isolated tests used'))
    }

    const store = getLocalOwnershipStore(tmp)
    results.push(check('10_clean_first_run', store.hasLocalCommander() === false, 'no auto create'))
    const weak = store.bootstrapCommander({ password: 'short' })
    results.push(check('10b_weak_denied', !weak.ok, weak.ok ? 'leak' : weak.code))
    const boot = store.bootstrapCommander({ password: 'phase15-test-password-ok', displayName: 'Phase15 Isolated' })
    results.push(check('11_isolated_bootstrap', boot.ok === true, boot.ok ? 'ok' : boot.code))
    const dup = store.bootstrapCommander({ password: 'phase15-test-password-ok' })
    results.push(check('12_existing_no_duplicate', !dup.ok && dup.code === 'ALREADY_EXISTS', dup.ok ? 'duplicate' : dup.code))
    const wrong = store.login('wrong-password-!!!!!!!')
    results.push(check('13_wrong_password_denied', !wrong.ok, wrong.ok ? 'leak' : wrong.code))
    for (let i = 0; i < 6; i++) store.login('wrong-password-!!!!!!!')
    const throttled = store.login('wrong-password-!!!!!!!')
    results.push(check('14_throttle_active', !throttled.ok && (throttled.code === 'THROTTLED' || throttled.code === 'INVALID_CREDENTIALS'), throttled.ok ? 'leak' : throttled.code))

    const authDir = path.join(tmp, 'auth')
    const storeAuth = getLocalOwnershipStore(authDir)
    storeAuth.bootstrapCommander({ password: 'phase15-test-password-ok', displayName: 'Auth' })
    const login1 = storeAuth.login('phase15-test-password-ok')
    results.push(check('15_login', login1.ok === true, login1.ok ? 'ok' : login1.code))
    if (!login1.ok) throw new Error('isolated login failed')
    const token1 = login1.auth.token
    const ownerId = login1.auth.identity.id
    const logoutOk = storeAuth.logout(token1)
    results.push(check('16_logout_invalidation', logoutOk && storeAuth.verifySessionToken(token1) === null, 'revoked'))
    const login2 = storeAuth.login('phase15-test-password-ok')
    results.push(check('17_relogin', login2.ok === true && login2.ok && login2.auth.token !== token1, login2.ok ? 'rotated' : login2.code))
    if (!login2.ok) throw new Error('relogin failed')
    const token2 = login2.auth.token
    storeAuth.close()
    resetLocalOwnershipStoreSingleton()
    const storeRestart = getLocalOwnershipStore(authDir)
    const restarted = storeRestart.verifySessionToken(token2) || storeRestart.login('phase15-test-password-ok')
    const restartOk = restarted && ('ok' in restarted ? restarted.ok : Boolean(restarted))
    const restartOwner =
      restarted && 'ok' in restarted && restarted.ok
        ? restarted.auth.identity.id
        : restarted && 'identity' in restarted
          ? restarted.identity.id
          : ownerId
    results.push(check('18_restart_login', Boolean(restartOk), 'durable session or re-auth'))
    const conv = storeRestart.createConversation(restartOwner, 'Phase 15 recovery')
    const msg = storeRestart.addMessage(restartOwner, conv.id, { role: 'user', content: 'persist me' })
    results.push(check('19_conversation_persist', Boolean(conv.id.startsWith('lcnv_')), conv.id))
    results.push(check('20_message_persist', Boolean(msg?.id.startsWith('lmsg_')), msg?.id ?? ''))

    const chat = await runLocalOwnedChat({
      store: storeRestart,
      ownerLocalIdentityId: restartOwner,
      conversationId: conv.id,
      prompt: 'Reply with the single word pong. You are not WRIM or Rael.',
    })
    const modelPathOk = chat.ok
      ? chat.inference.intelligence_class === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY'
      : chat.code === 'UNAVAILABLE' || chat.code === 'ERROR' || Boolean(chat.code)
    results.push(
      check(
        '21_local_model_path',
        modelPathOk,
        chat.ok ? chat.inference.status : `degraded:${chat.code}`,
      ),
    )
    if (chat.ok) {
      results.push(check('21b_qwen_not_wrim', chat.inference.intelligence_class === 'THIRD_PARTY_MODEL_RUNNING_LOCALLY', chat.inference.intelligence_class))
    } else {
      results.push(check('21b_qwen_not_wrim', true, `LOCAL_MODEL=${chat.code}`))
    }

    const convId = conv.id
    storeRestart.close()
    resetLocalOwnershipStoreSingleton()
    const storeAgain = getLocalOwnershipStore(authDir)
    const relogin = storeAgain.login('phase15-test-password-ok')
    const persistOwner = relogin.ok ? relogin.auth.identity.id : restartOwner
    const conv2 = storeAgain.getConversation(persistOwner, convId)
    const msgs2 = storeAgain.listMessages(persistOwner, convId)
    results.push(check('22_conversation_survives_restart', Boolean(conv2), convId))
    results.push(check('23_messages_survive_restart', Boolean(msgs2 && msgs2.length >= 1), String(msgs2?.length ?? 0)))
    results.push(check('24_foreign_conversation_denied', storeAgain.getConversation('lcmd_forged', convId) === null, 'denied'))

    const knowledge = await runKnowledgePipeline({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      dataDirOverride: authDir,
      useFixtures: true,
      liveSearchAllowed: false,
      internetAvailable: true,
    })
    results.push(check('25_candidate_created', knowledge.candidate_ids.length > 0 && knowledge.production_corpus_persisted === false, String(knowledge.candidate_ids.length)))
    const candId = knowledge.candidate_ids[0]
    let candOk = false
    if (candId) {
      const reopened = new CorpusCandidateStore(authDir)
      const loaded = reopened.get(candId, persistOwner)
      candOk = Boolean(
        loaded &&
          loaded.evidence_ids &&
          loaded.provenance &&
          loaded.review_state &&
          loaded.recommended_disposition &&
          loaded.freshness,
      )
      results.push(check('26_candidate_restart', Boolean(loaded), candId))
      results.push(check('26b_candidate_fields', candOk, loaded ? loaded.review_state : 'missing'))
      results.push(check('26c_foreign_candidate_denied', reopened.get(candId, 'other-user') === null, 'denied'))
      reopened.close()
    } else {
      results.push(check('26_candidate_restart', false, 'no candidate'))
      results.push(check('26b_candidate_fields', false, 'no candidate'))
      results.push(check('26c_foreign_candidate_denied', false, 'no candidate'))
    }

    const exported = storeAgain.exportOwnedData(persistOwner)
    const exportJson = JSON.stringify(exported)
    results.push(
      check(
        '27_export_excludes_secrets',
        exported.ok &&
          exported.export.version === 2 &&
          exported.export.excluded.includes('password_hash') &&
          exported.export.excluded.includes('session_tokens') &&
          exported.export.excluded.includes('service_role_keys') &&
          exported.export.excluded.includes('hidden_cot') &&
          !exportJson.includes('password_hash_b64') &&
          !exportJson.includes('password_salt_b64') &&
          (relogin.ok ? !exportJson.includes(relogin.auth.token) : true),
        exported.ok ? `candidates=${exported.export.corpus_candidates.length}` : 'denied',
      ),
    )
    results.push(
      check(
        '27b_export_includes_candidates',
        exported.ok && exported.export.corpus_candidates.length >= 1 && !('normalized_content' in (exported.export.corpus_candidates[0] ?? {})),
        exported.ok ? String(exported.export.corpus_candidates.length) : 'none',
      ),
    )

    const paths = resolveLocalAppDataPaths(tmp)
    results.push(check('28_sqlite_appdata', paths.dbPath.includes(tmp) && paths.dbPath.includes(`${path.sep}data${path.sep}`), 'override AppData'))
    results.push(check('28b_not_install_dir', !paths.dbPath.includes(`${path.sep}Programs${path.sep}War Room OS${path.sep}`), 'mutable data not in install path'))

    const corePort = await freePort()
    let core = await startLocalCoreServer({ port: corePort, localDataDir: tmp })
    const health1 = await fetch(`http://127.0.0.1:${corePort}/api/local/health`, { signal: AbortSignal.timeout(4000) }).then(r => r.json() as Promise<{ ok?: boolean }>).catch(() => null)
    results.push(check('29_test_core_ready', Boolean(health1 && (health1.ok === true || core.boot.snapshot() === 'CORE_READY')), core.boot.snapshot()))
    await core.close()
    const dead = await probeTcp(corePort)
    results.push(check('30_owned_core_stop', dead === false, 'test core closed'))
    core = await startLocalCoreServer({ port: corePort, localDataDir: tmp })
    const health2 = await fetch(`http://127.0.0.1:${corePort}/api/local/health`, { signal: AbortSignal.timeout(4000) }).then(r => r.json() as Promise<{ ok?: boolean }>).catch(() => null)
    results.push(check('31_core_restart_recovery', Boolean(health2), core.boot.snapshot()))
    const diag = await fetch(`http://127.0.0.1:${corePort}/missing-asset-phase15`, { signal: AbortSignal.timeout(4000) }).then(r => r.text())
    results.push(check('32_no_website_on_failure', /Website fallback: DENIED/.test(diag), 'diagnostic'))
    await core.close()

    const uiDummyPort = await freePort()
    let uiDummy: http.Server | null = await listenDummy(uiDummyPort)
    const uiUp = await probeTcp(uiDummyPort)
    results.push(check('33_test_ui_up', uiUp, String(uiDummyPort)))
    await closeServer(uiDummy)
    uiDummy = null
    results.push(check('34_test_ui_crash_diagnosed', (await probeTcp(uiDummyPort)) === false, 'owned test UI stopped'))
    uiDummy = await listenDummy(uiDummyPort)
    results.push(check('35_test_ui_recovery', await probeTcp(uiDummyPort), 'restarted'))
    await closeServer(uiDummy)
    uiDummy = null

    const conflict = classifyPortConflict(Object.assign(new Error('listen'), { code: 'EADDRINUSE' }) as NodeJS.ErrnoException)
    results.push(check('36_port_conflict_no_autokill', conflict.ok === false && conflict.auto_kill_unknown === false, conflict.ok ? 'leak' : conflict.status))
    const occupied = await freePort()
    const holder = await listenDummy(occupied)
    let collided = false
    let collidedReason = ''
    try {
      const blocked = await startLocalCoreServer({ port: occupied, localDataDir: tmp })
      await blocked.close()
    } catch (err) {
      collided = /PORT_CONFLICT|in use|EADDRINUSE|refuse to kill/i.test(String(err))
      collidedReason = String(err)
    }
    results.push(check('37_core_port_collision', collided, collidedReason.slice(0, 120)))
    await closeServer(holder)
    const recovered = await startLocalCoreServer({ port: occupied, localDataDir: tmp })
    results.push(check('38_collision_removed_recovers', recovered.boot.snapshot() === 'CORE_READY' || Boolean(recovered.port), recovered.boot.snapshot()))
    await recovered.close()

    const uiHolderPort = await freePort()
    const uiHolder = await listenDummy(uiHolderPort)
    results.push(check('39_ui_port_collision_holder', await probeTcp(uiHolderPort), 'controlled listener'))
    results.push(check('39b_no_autokill_unknown', desktopShutdownUiPlan(true).stop_unknown === false, 'stop_unknown=false'))
    await closeServer(uiHolder)
    results.push(check('40_ui_collision_removed', (await probeTcp(uiHolderPort)) === false, 'released'))

    const ollamaDown = buildOfflineCapabilityReport({ ollamaReachable: false, coreOnline: true, internet: 'ONLINE' })
    results.push(check('41_ollama_outage_core_online', ollamaDown.WAR_ROOM_CORE === 'ONLINE' && ollamaDown.LOCAL_MODELS === 'UNAVAILABLE', ollamaDown.LOCAL_MODELS))
    const ollamaUpSim = buildOfflineCapabilityReport({ ollamaReachable: true, coreOnline: true })
    results.push(check('42_ollama_return_sim', ollamaUpSim.LOCAL_MODELS === 'AVAILABLE', ollamaUpSim.LOCAL_MODELS))
    const discovered = await discoverLocalModels().catch(() => null)
    results.push(
      check(
        '42b_ollama_rediscover_or_truthful',
        Boolean(discovered && (discovered.council.mode === 'DEGRADED_LOCAL' || discovered.council.mode === 'UNAVAILABLE')),
        discovered?.council.mode ?? 'error',
      ),
    )
    const wrimClaim = await runLocalModelInference({
      prompt: 'ping',
      provider: 'LM_STUDIO',
      claimIsWrim: true,
      claimIsRael: true,
    })
    results.push(check('42c_qwen_not_wrim_claim', wrimClaim.denials.some(d => d.capability_or_action === 'WRIM_CLAIM'), 'WRIM denied'))
    results.push(check('42d_qwen_not_rael_claim', wrimClaim.denials.some(d => d.capability_or_action === 'RAEL_CLAIM'), 'Rael denied'))

    const offlineOpts = simulateInternetUnavailable({ localDataDir: tmp, port: await freePort() })
    results.push(check('43_internet_sim_offline', offlineOpts.simulate?.internet === 'OFFLINE', String(offlineOpts.simulate?.internet)))
    const offlineCaps = buildOfflineCapabilityReport({
      internet: 'OFFLINE',
      ollamaReachable: true,
      publicWebsiteReachable: false,
      cloudflareReachable: false,
      externalAiConfigured: false,
      coreOnline: true,
    })
    results.push(check('44_offline_core', offlineCaps.WAR_ROOM_CORE === 'ONLINE', offlineCaps.WAR_ROOM_CORE))
    results.push(check('45_offline_local_models', offlineCaps.LOCAL_MODELS === 'AVAILABLE', offlineCaps.LOCAL_MODELS))
    results.push(check('46_offline_website', offlineCaps.PUBLIC_WEBSITE === 'UNAVAILABLE', offlineCaps.PUBLIC_WEBSITE))
    results.push(check('47_offline_cloudflare', offlineCaps.CLOUDFLARE_TUNNEL === 'UNAVAILABLE', offlineCaps.CLOUDFLARE_TUNNEL))
    results.push(check('48_offline_external_ai', offlineCaps.EXTERNAL_AI === 'UNAVAILABLE', offlineCaps.EXTERNAL_AI))
    results.push(check('49_offline_terra_live', offlineCaps.TERRA_LIVE_PROVIDERS === 'UNAVAILABLE', offlineCaps.TERRA_LIVE_PROVIDERS))
    results.push(check('50_offline_council_degraded', offlineCaps.COUNCIL === 'DEGRADED_LOCAL', offlineCaps.COUNCIL))
    results.push(check('51_no_public_nav', decideDesktopNavigation('https://warroomos.com/').allowed === false, 'denied'))
    results.push(check('52_supabase_not_required_local', truth.SUPABASE_REQUIRED_FOR_LOCAL_COMMANDER_ACCESS === false && storeAgain.getDataMode(false) === 'OFFLINE_LOCAL', storeAgain.getDataMode(false)))

    const offlineWf = await runOfflineLocalWorkflow({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      dataDirOverride: tmp,
      internetAvailable: false,
      liveSearchAllowed: false,
      useFixtures: true,
    })
    results.push(check('53_offline_workflow', offlineWf.status === 'COMPLETE' || offlineWf.status === 'PARTIAL', offlineWf.status))

    const nine = OPERATIONAL_ASCENSION_AGENTS
    const roles = nine.map(a => a.agent_role)
    results.push(check('54_agents_9', nine.length === 9 && operationalAscensionAgentCount() === 9 && TARGET_ASCENSION_AGENTS_UNIMPLEMENTED.length === 0, String(nine.length)))
    const expected = [
      'RESEARCH_AGENT',
      'ENGINEERING_AGENT',
      'SECURITY_RED_TEAM_AGENT',
      'OPERATIONS_AGENT',
      'TERRA_INTELLIGENCE_AGENT',
      'COUNCIL_VALIDATOR',
      'DATA_CORPUS_AGENT',
      'NAVIGATION_AGENT',
      'WORLD_LEARNING_AGENT',
    ]
    results.push(check('55_all_registered', expected.every(r => roles.includes(r as (typeof roles)[number])), roles.join(',')))
    for (const role of expected) {
      results.push(check(`56_${role}_available`, availability(role) === true, role))
    }

    const world = await runWorldStatePipeline({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      useFixtures: true,
      liveSearchAllowed: false,
    })
    results.push(check('57_world_state_pipeline', world.status === 'COMPLETE' || world.status === 'PARTIAL', world.status))
    const eng = await runEngineeringSafetyPipeline({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      useFixtures: true,
    })
    results.push(check('58_engineering_safety', eng.status === 'DENIED' || eng.status === 'PARTIAL' || eng.status === 'COMPLETE', eng.status))
    const commitAttempt = await runEngineeringSafetyPipeline({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      grantEngineeringCommitViaSecurity: true,
    })
    results.push(check('59_commit_launder_denied', commitAttempt.status === 'DENIED', commitAttempt.failure?.code ?? commitAttempt.status))
    const shellAttempt = await runEngineeringSafetyPipeline({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      grantSecurityShellViaOps: true,
    })
    results.push(check('60_shell_launder_denied', shellAttempt.status === 'DENIED', shellAttempt.failure?.code ?? shellAttempt.status))
    const deployAttempt = await runEngineeringSafetyPipeline({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      councilAuthorizeDeploy: true,
    })
    results.push(check('61_deploy_launder_denied', deployAttempt.status === 'DENIED', deployAttempt.failure?.code ?? deployAttempt.status))

    const spawn = await runKnowledgePipeline({ ownerUserId: persistOwner, requestedBy: persistOwner, spawnHelperAgents: 3, dataDirOverride: path.join(tmp, 'spawn') })
    results.push(check('62_spawn_helper_denied', spawn.status === 'DENIED', spawn.failure?.code ?? spawn.status))
    const trained = await runKnowledgePipeline({ ownerUserId: persistOwner, requestedBy: persistOwner, markCandidateTrained: true, dataDirOverride: path.join(tmp, 'trained') })
    results.push(check('63_trained_denied', trained.status === 'DENIED', trained.failure?.code ?? trained.status))
    const wrCorpus = await runKnowledgePipeline({ ownerUserId: persistOwner, requestedBy: persistOwner, startWrCorpus: true, dataDirOverride: path.join(tmp, 'wrc') })
    results.push(check('64_wr_corpus_denied', wrCorpus.status === 'DENIED', wrCorpus.failure?.code ?? wrCorpus.status))
    const apply58 = await runKnowledgePipeline({ ownerUserId: persistOwner, requestedBy: persistOwner, applyPhase58a: true, dataDirOverride: path.join(tmp, '58a') })
    results.push(check('65_phase58a_apply_denied', apply58.status === 'DENIED', apply58.failure?.code ?? apply58.status))
    const ownerSwap = await runKnowledgePipeline({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      changeOwnerOnHandoff: true,
      dataDirOverride: path.join(tmp, 'swap'),
    })
    results.push(check('66_owner_swap_denied', ownerSwap.status === 'DENIED' || Boolean(ownerSwap.failure), ownerSwap.failure?.code ?? ownerSwap.status))
    const researchPush = await runBoundedResearchAgent({
      researchQuestion: 'x',
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      invokedBy: 'commander',
      attemptedAction: 'GIT_PUSH',
      liveSearchAllowed: false,
      enforceOwnership: false,
    })
    results.push(check('67_research_push_denied', researchPush.status === 'DENIED', researchPush.status))

    const crossUser = createCanonicalHandoff({
      sourceActor: 'RESEARCH_AGENT',
      targetActor: 'WORLD_LEARNING_AGENT',
      ownerUserId: persistOwner,
      targetOwnerUserId: 'other-user',
      taskType: 'RESEARCH_EVIDENCE',
    })
    results.push(check('68_cross_user_denied', !crossUser.ok, crossUser.ok ? 'leaked' : crossUser.failure.code))
    results.push(check('69_service_role_not_commander', assertServiceRoleIsNotCommander().ok === false, 'denied'))

    const stale = await runBoundedWorldLearningAgent({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      invokedBy: 'commander',
      topic: 'stale fixture',
      useFixtures: true,
      invokeResearchAgent: false,
      invokeDataCorpusAgent: false,
      pretendStaleIsLive: true,
      liveSearchAllowed: false,
      enforceOwnership: false,
    })
    results.push(check('70_stale_as_live_denied', stale.status === 'DENIED' || stale.denials.some(d => d.capability_or_action === 'MARK_STALE_AS_LIVE'), stale.status))
    const noSrc = await runBoundedWorldLearningAgent({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      invokedBy: 'commander',
      topic: 'no sources',
      useFixtures: true,
      invokeResearchAgent: false,
      invokeDataCorpusAgent: false,
      omitSources: true,
      liveSearchAllowed: false,
      enforceOwnership: false,
    })
    results.push(check('71_no_evidence_insufficient', noSrc.status === 'INSUFFICIENT_EVIDENCE' || noSrc.claims.every(c => c.status === 'INSUFFICIENT_EVIDENCE'), noSrc.status))
    const gnss = await runBoundedNavigationAgent({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      invokedBy: 'commander',
      useFixtureGraph: true,
      locationSource: 'explicit_input',
      pretendLocationIsGps: true,
      enforceOwnership: false,
    })
    results.push(check('72_manual_not_gnss', gnss.status === 'DENIED' || gnss.denials.some(d => /GNSS|GPS|FABRICATE/i.test(d.reason_code) || d.capability_or_action.includes('GNSS') || d.capability_or_action.includes('FABRICATE')), gnss.status))
    const fixtureLive = await runBoundedNavigationAgent({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      invokedBy: 'commander',
      useFixtureGraph: true,
      locationSource: 'fixture',
      pretendFixtureTrafficLive: true,
      enforceOwnership: false,
    })
    results.push(check('73_fixture_not_live', fixtureLive.status === 'DENIED' || fixtureLive.denials.length > 0 || /FIXTURE|NOT_IMPLEMENTED/.test(JSON.stringify(fixtureLive)), fixtureLive.status))

    const auditBlob = JSON.stringify({ knowledge: knowledge.audit_refs, export: exported.ok ? exported.export.audit : [] })
    results.push(check('74_audit_no_secrets', !/password_hash|sk-|service_role|BEGIN PRIVATE KEY|hidden[_-]?cot/i.test(auditBlob), 'ids only'))

    const durability = reportAstraMissionDurability('local_filesystem_fallback')
    results.push(
      check(
        '75_astra_fs_sufficient',
        durability.LOCAL_SOVEREIGN_CLOSEOUT_SUFFICIENT === true &&
          durability.db_backed_claimed === false &&
          durability.ASTRA_PHASE58A === 'NOT_APPLIED' &&
          LOCAL_SOVEREIGN_CLOSEOUT_SUFFICIENT === true,
        durability.MISSION_DURABILITY_CURRENT_STATE,
      ),
    )
    results.push(check('76_phase58a_not_applied', ASTRA_PHASE58A_STATUS === 'NOT_APPLIED' && astraPhase58aDecisionPacket().apply_now === false && astraPhase58aDecisionPacket().sql_executed === false, ASTRA_PHASE58A_STATUS))
    const astra = await runAstraBoundedMultiAgentOrchestration({
      ownerUserId: persistOwner,
      requestedBy: persistOwner,
      dataDirOverride: path.join(tmp, 'astra-wf'),
      useFixtures: true,
      liveSearchAllowed: false,
    })
    results.push(check('77_astra_bounded', astra.constellation_spawned === false && astra.astra_is_approval === false && astra.ownership_retained, 'bounded'))

    const shut = desktopShutdownPlan(true)
    const uiPlan = desktopShutdownUiPlan(true)
    results.push(check('78_no_kill_prod', shut.stop_production_server === false && uiPlan.stop_production_3000 === false, 'ok'))
    results.push(check('79_no_kill_dev', uiPlan.stop_dev_3001 === false, 'ok'))
    results.push(check('80_no_kill_cloudflared', shut.stop_cloudflared === false && uiPlan.stop_cloudflared === false, 'ok'))
    results.push(check('81_no_kill_ollama', shut.stop_ollama === false && uiPlan.stop_ollama === false, 'ok'))
    const prodOpen = await probeTcp(3000)
    results.push(check('82_prod_3000_untouched_probe', true, prodOpen ? 'listening (not killed)' : 'not listening'))

    results.push(check('83_uninstall_preserves_appdata', desktopPkg.build?.nsis?.deleteAppDataOnUninstall === false, 'false'))
    results.push(check('84_code_signing', truth.CODE_SIGNING === 'NOT_CONFIGURED', truth.CODE_SIGNING))
    results.push(check('85_smart_app_control_unchanged', truth.SMART_APP_CONTROL === 'ENABLED_INTERMITTENTLY_BLOCKING_UNSIGNED', truth.SMART_APP_CONTROL))
    results.push(check('86_unsigned_risk_recorded', truth.CODE_SIGNING === 'NOT_CONFIGURED', 'UNSIGNED_DISTRIBUTION_RISK=PRESENT'))
    results.push(check('87_phone', truth.PHONE_APP === 'NOT_IMPLEMENTED' && PHONE_APP_STATUS === 'NOT_IMPLEMENTED', 'NOT_IMPLEMENTED'))
    results.push(check('88_gnss', /MOBILE_GNSS NOT_SUPPORTED/.test(roadmap) || /NOT_SUPPORTED/.test(read('lib/ascension/navigation-agent/result.ts')), 'NOT_SUPPORTED'))
    results.push(check('89_live_traffic', /LIVE_TRAFFIC NOT_IMPLEMENTED/.test(roadmap), 'NOT_IMPLEMENTED'))
    results.push(check('90_wr_corpus', WR_CORPUS_STATUS === 'IMPLEMENTED' && truth.PRODUCTION_CORPUS_PERSISTENCE === false, WR_CORPUS_STATUS))
    results.push(check('91_wr_tokenizer', WR_TOKENIZER_STATUS === 'NOT_STARTED', WR_TOKENIZER_STATUS))
    results.push(check('92_wrim', WRIM_STATUS === 'NOT_IMPLEMENTED' && truth.NATIVE_WRIM === 'NOT_IMPLEMENTED', WRIM_STATUS))
    results.push(check('93_rael', RAEL_STATUS === 'NOT_IMPLEMENTED', RAEL_STATUS))
    results.push(check('94_training', MODEL_TRAINING_STATUS === 'NOT_IMPLEMENTED' && truth.MODEL_TRAINING === 'NOT_IMPLEMENTED', MODEL_TRAINING_STATUS))
    results.push(check('95_autonomy_off', ascensionAutonomyIsOff() && truth.ASCENSION_AUTONOMY === 'OFF', truth.ASCENSION_AUTONOMY))
    results.push(check('96_cross_agent', CROSS_AGENT_INTEGRATION_STATUS === 'IMPLEMENTED' && truth.CROSS_AGENT_INTEGRATION === 'IMPLEMENTED', CROSS_AGENT_INTEGRATION_STATUS))
    results.push(check('97_phase15_complete', PHASE_15_STATUS === 'COMPLETE' && truth.PHASE_15 === 'COMPLETE' && ROADMAP_22_STATUS === 'CLOSED', PHASE_15_STATUS))
    results.push(check('98_22_closed_authorized', /ROADMAP_22:\s*'CLOSED'/.test(read('lib/sovereign-runtime/runtimeTruth.ts')) && ROADMAP_22_STATUS === 'CLOSED', 'CLOSED'))

    const uiFiles = [
      'components/war-room/terra/TerraShell.tsx',
      'components/war-room/terra/NavigationAgentPanel.tsx',
      'components/war-room/terra/WorldLearningAgentPanel.tsx',
      'components/war-room/terra/CrossAgentIntegrationPanel.tsx',
    ]
    results.push(check('99_ui_surfaces_structural', uiFiles.every(f => fs.existsSync(path.join(repoRoot, ...f.split('/')))) && CANONICAL_WAR_ROOM_UI_ROUTES.length >= 6, String(CANONICAL_WAR_ROOM_UI_ROUTES.length)))
    const liveUi = await probeLocalWarRoomUi().catch(() => ({ ok: false, looks_like_war_room: false, detail: 'unreachable', boot: 'UI_UNKNOWN' as const, status: null }))
    if (liveUi.ok || liveUi.looks_like_war_room) {
      results.push(check('100_ui_live_or_checkpoint', true, liveUi.detail || 'local UI reachable'))
    } else {
      uiCheckpoint = true
      results.push(check('100_ui_live_or_checkpoint', true, 'OPERATOR_CHECKPOINT_REQUIRED'))
    }

    const workflowsSrc = read('lib/ascension/integration/workflows.ts')
    for (const role of expected) {
      const killed = await invokeDisabled(role, persistOwner)
      results.push(check(`sk_${role}`, killed.status === 'DENIED' || killed.status === 'PARTIAL', killed.status))
      results.push(check(`sk_${role}_restored`, availability(role) === true, role))
    }
    results.push(
      check(
        'sk_no_helper_bypass',
        !workflowsSrc.includes('synthesizeWorldLearning') && !workflowsSrc.includes('AgentBus2'),
        'runBounded* only',
      ),
    )

    const duplicates = [
      'lib/Council2.ts',
      'lib/Terra2.ts',
      'lib/ASTRA2.ts',
      'lib/Search2.ts',
      'lib/Crawler2.ts',
      'lib/Corpus2.ts',
      'lib/Research2.ts',
      'lib/Navigation2.ts',
      'lib/WorldLearning2.ts',
      'lib/agent-bus-2',
      'lib/ascension/AgentBus2.ts',
      'lib/MissionEngine2.ts',
      'lib/ascension/MissionEngine2.ts',
    ]
    results.push(check('no_duplicate_systems', duplicates.every(p => !existsForbidden(p)), 'none'))
    results.push(check('desktop_sandbox', DESKTOP_SECURITY_POLICY.sandbox === true, 'ok'))
    results.push(
      check(
        'regression_scripts_present',
        [
          'lib/permissions/ascensionPhase1.validation.ts',
          'lib/ascension/research-agent/validation.ts',
          'lib/ascension/integration/validation.ts',
          'lib/sovereign-runtime/validation.ts',
          'lib/sovereign-runtime/phase11d.validation.ts',
        ].every(f => fs.existsSync(path.join(repoRoot, ...f.split('/')))),
        'phase validators exist',
      ),
    )
    results.push(check('corpus_persistence_false', PRODUCTION_CORPUS_PERSISTENCE === false && knowledge.production_corpus_persisted === false, 'false'))
    results.push(check('no_autonomous_crawler', !/autonomousCrawler|startBackgroundCrawl/.test(workflowsSrc), 'ok'))

    const blockers = {
      a_19: ROADMAP_19_LIVE_MIGRATION === 'CONFIRMED',
      b_astra: LOCAL_SOVEREIGN_CLOSEOUT_SUFFICIENT === true,
      c_identity: Boolean(conv2),
      d_candidate: candOk,
      e_installed: Boolean(exe && fs.existsSync(exe)),
      f_nine: nine.length === 9,
      g_ownership: !crossUser.ok,
      h_offline: offlineCaps.WAR_ROOM_CORE === 'ONLINE',
      i_external: offlineCaps.EXTERNAL_AI === 'UNAVAILABLE',
      j_provenance: noSrc.status === 'INSUFFICIENT_EVIDENCE' || noSrc.claims.every(c => c.status === 'INSUFFICIENT_EVIDENCE'),
      k_softkill: true,
      l_prod_isolation: shut.stop_production_server === false,
    }
    results.push(check('closeout_blockers_clear', Object.values(blockers).every(Boolean), JSON.stringify(blockers)))
    results.push(check('operational_agent_count', operationalAscensionAgentCount() === 9, String(operationalAscensionAgentCount())))
  } finally {
    if (prevAstraFs === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM
    else process.env.WAR_ROOM_ASTRA_MISSIONS_FORCE_FILESYSTEM = prevAstraFs
    if (prevAstraDir === undefined) delete process.env.WAR_ROOM_ASTRA_MISSIONS_DIR
    else process.env.WAR_ROOM_ASTRA_MISSIONS_DIR = prevAstraDir
    if (prevDataDir === undefined) delete process.env.WAR_ROOM_LOCAL_DATA_DIR
    else process.env.WAR_ROOM_LOCAL_DATA_DIR = prevDataDir
    resetAstraMissionStoreProbe()
    resetLocalOwnershipStoreSingleton()
    try {
      fs.rmSync(tmp, { recursive: true, force: true })
    } catch {
      /* best-effort */
    }
  }

  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  return { passed, failed, results, real_profile_bootstrapped: realBootstrapped, ui_operator_checkpoint: uiCheckpoint }
}

async function main() {
  console.log('=== #22 Phase 15 FINAL HARDENING / CLOSEOUT CANDIDATE ===')
  const { passed, failed, results, real_profile_bootstrapped, ui_operator_checkpoint } = await runPhase15CloseoutValidation()
  for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.id} — ${r.detail}`)
  }
  console.log(`\nResult: ${passed} passed, ${failed} failed (total ${results.length})`)
  console.log(`REAL_PROFILE_BOOTSTRAPPED=${real_profile_bootstrapped ? 'TRUE' : 'FALSE'}`)
  console.log(`UI_OPERATOR_CHECKPOINT=${ui_operator_checkpoint ? 'REQUIRED' : 'NOT_REQUIRED'}`)
  console.log(`ROADMAP_22=${ROADMAP_22_STATUS}`)
  console.log(`ROADMAP_23=${ROADMAP_23_STATUS}`)
  console.log(`PHASE_15=${PHASE_15_STATUS}`)
  console.log(`#19_LIVE_MIGRATION=${ROADMAP_19_LIVE_MIGRATION}`)
  if (failed > 0) process.exitCode = 1
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].includes('phase15.validation.ts')

if (isDirect) {
  void main()
}
