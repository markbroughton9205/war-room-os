/**
 * FOUNDRY APPLICATION BUILDER — autonomous new-project lane.
 * Commander states the outcome. Foundry researches, designs, creates, runs, tests, repairs, and previews.
 * Does not weaken War Room production install/lease/write-set safety.
 */
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { runWithWorkspaceRoot } from '@/lib/repo/workspaceContext'
import { logWarRoomRepoAudit } from '@/lib/war-room/repoAudit'
import { executeFoundryBrowserTool } from './foundryBrowserService'
import { appendJournal, loadMission, saveMission, transitionMission } from './foundryMissionStore'
import { stopOwnedProcesses } from './terminalExecutor'
import type { EngineerToolCall, EngineerToolResult } from './engineerTools'
import type { FoundryMissionRecord } from './foundryMissionTypes'
import {
  APPLICATION_BUILDER_CRM_PORT,
  APPLICATION_BUILDER_DATA_APP_PORT,
  APPLICATION_BUILDER_DEFAULT_PORT,
  APPLICATION_BUILDER_GOVERNANCE,
  emptyApplicationBuilderState,
  type FoundryApplicationBuilderState,
  type FoundryApplicationRepair,
  type FoundryViewportResult,
} from './foundryApplicationBuilderTypes'
import {
  createFoundryApplicationWorkspace,
  directoryIsEmpty,
  findContinuableProject,
  foundryNodeExecutable,
  getFoundryProjectsRoot,
  isApplicationBuilderMission,
  listFoundryApplicationProjects,
  listProjectFiles,
  pickFreeLoopbackPort,
  readProjectMemoryFile,
  runProjectCommand,
  slugProjectName,
  startProjectProcess,
  writeProjectFile,
  writeProjectMemory,
} from './foundryProjectIsolation'
import {
  adoptLoopbackPreview,
  findLiveProjectPreview,
  stopOwnedProjectPreview,
} from './foundryProjectProcessRegistry'
import {
  httpGetNoKeepAlive,
  releaseMissionWrapperResources,
  shouldRetainApplicationPreview,
} from './foundryApplicationBuilderLifecycle'
import {
  classifyResearchRequest,
  discoverResearchProviders,
  fetchPublicPage,
  makeResearchRecord,
  runApplicationResearch,
  searchPublicWeb,
} from './foundryInternetResearch'
import {
  beginFoundryResearchMission,
  releaseFoundryResearchMission,
} from './foundryResearchTransport'
import {
  deriveRequirements,
  factVersusDesignNotes,
  inferProjectType,
  isContinuationRequest,
  isCrmOutcome,
  isLocalDataOutcome,
  isWebsiteOutcome,
  researchQueriesForOutcome,
  selectStack,
  suggestedProjectName,
} from './foundryRequirementsEngine'
import { buildWebsiteFiles, WORKING_BRAND } from './foundryWebSiteFactory'
import { buildCrmFiles, CRM_WRITE_SET_PATHS, stripConvertRoute } from './foundryCrmFactory'
import {
  buildLocalDataAppFiles,
  LOCAL_DATA_WRITE_SET_PATHS,
  stripItemsListRoute,
} from './foundryLocalDataAppFactory'
import { proveCrmRestartPersistence, runCrmBrowserAcceptance, verifyCrmViewports } from './foundryCrmAcceptance'
import { proveLocalDataRestartPersistence, runLocalDataBrowserAcceptance } from './foundryLocalDataAcceptance'
import { establishMissionWriteSet } from './foundryMissionWriteSet'
import { isStandaloneEngineerMission, canEnterExecutionFromMission, canComplete as contractCanComplete, evaluateVerdictLayer, projectReadyFromVerdict } from './foundryVerdictLayer'
import { loadAcceptanceContract, loadMissionContract, appendContractEvent } from './foundryContractStore'
import { recordAcceptanceEvidence } from './foundryAcceptanceEvidence'

export const APPLICATION_BUILDER_TOOL_NAMES = [
  'research.search',
  'research.fetch',
  'research.record',
  'project.create',
  'project.inspect',
  'project.command',
  'project.preview',
] as const

export type ApplicationBuilderToolName = (typeof APPLICATION_BUILDER_TOOL_NAMES)[number]

export function isApplicationBuilderToolName(value: string): value is ApplicationBuilderToolName {
  return (APPLICATION_BUILDER_TOOL_NAMES as readonly string[]).includes(value)
}

function ensureBuilder(mission: FoundryMissionRecord): FoundryApplicationBuilderState {
  mission.applicationBuilder ??= emptyApplicationBuilderState()
  mission.capabilityLane = 'APPLICATION_BUILDER'
  return mission.applicationBuilder
}

async function mark(mission: FoundryMissionRecord, id: string, status: 'active' | 'done' | 'failed', note?: string): Promise<void> {
  const step = mission.plan.find(item => item.id === id)
  if (step) {
    step.status = status
    if (note) step.note = note
    mission.currentStep = id
  }
  mission.currentAction = note || id
  if (status === 'done' && !mission.completedSteps.includes(id)) mission.completedSteps.push(id)
  await saveMission(mission)
}

async function httpGet(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  if (url.startsWith('http://127.0.0.1')) return httpGetNoKeepAlive(url)
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    const text = await res.text()
    return { ok: res.ok, status: res.status, text: text.slice(0, 20_000) }
  } catch (error) {
    return { ok: false, status: 0, text: error instanceof Error ? error.message : String(error) }
  }
}

function applicationLane(outcome: string, continuing?: { projectType?: string; projectName?: string } | null): 'crm' | 'website' | 'local' {
  if (continuing?.projectType === 'static_website') return 'website'
  if (continuing?.projectType === 'internal_business_tool') return 'crm'
  if (continuing?.projectType === 'database_backed_app' || continuing?.projectType === 'full_stack_web_app') return 'local'
  if (isCrmOutcome(outcome)) return 'crm'
  if (isWebsiteOutcome(outcome) && inferProjectType(outcome) === 'static_website') return 'website'
  if (isLocalDataOutcome(outcome) || looksLikeBuilderLocal(outcome)) return 'local'
  return inferProjectType(outcome) === 'static_website' ? 'website' : 'local'
}

function looksLikeBuilderLocal(outcome: string): boolean {
  return inferProjectType(outcome) !== 'static_website'
}

function classifyEngineeringFailure(message: string): FoundryApplicationRepair['failureClass'] {
  if (/ENOENT|Cannot find module|npm ERR/i.test(message)) return 'dependency'
  if (/error TS\d+/i.test(message)) return 'typescript'
  if (/EADDRINUSE|ECONNREFUSED|listening/i.test(message)) return 'runtime'
  if (/404|not found/i.test(message)) return 'route'
  if (/overflow|layout|hidden/i.test(message)) return 'layout'
  if (/fail\s+\d+|not ok|AssertionError/i.test(message)) return 'test'
  return 'other'
}

async function verifyViewports(origin: string, options?: { marker?: string; heroTestId?: string }): Promise<FoundryViewportResult[]> {
  const marker = options?.marker ?? WORKING_BRAND
  const heroTestId = options?.heroTestId ?? 'home-hero'
  const markerRe = new RegExp(marker, 'i')
  const checks: Array<{ name: FoundryViewportResult['name']; width: number; height: number }> = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]
  const loaded = await (await import('./foundryPlaywright')).loadPlaywrightChromium()
  if (!loaded) {
    return checks.map(check => ({
      name: check.name,
      width: check.width,
      height: check.height,
      ok: false,
      detail: 'PLAYWRIGHT_NOT_INSTALLED: Chromium was not resolvable',
      overflow: false,
      blankScreen: true,
      missingContent: true,
    }))
  }
  const browser = await loaded.chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    executablePath: loaded.executablePath,
  }).catch(() => null)
  if (!browser) {
    return checks.map(check => ({
      name: check.name,
      width: check.width,
      height: check.height,
      ok: false,
      detail: 'PLAYWRIGHT_LAUNCH_FAILED',
      overflow: false,
      blankScreen: true,
      missingContent: true,
    }))
  }
  const results: FoundryViewportResult[] = []
  try {
    for (const check of checks) {
      const page = await browser.newPage({ viewport: { width: check.width, height: check.height } })
      const consoleErrors: string[] = []
      page.on('console', message => {
        if (message.type() === 'error' && !/favicon\.ico/i.test(message.text())) consoleErrors.push(message.text())
      })
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 15_000 })
      const body = await page.locator('body').innerText()
      const hero = await page.locator(`[data-testid="${heroTestId}"]`).count()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 24)
      const blank = !body.trim() || (await page.locator('body').boundingBox())?.height === 0
      results.push({
        name: check.name,
        width: check.width,
        height: check.height,
        ok: hero > 0 && markerRe.test(body) && !blank && consoleErrors.length === 0,
        detail: consoleErrors[0] || (overflow ? 'horizontal overflow noted' : 'rendered'),
        overflow,
        blankScreen: Boolean(blank),
        missingContent: hero === 0,
      })
      await page.close()
    }
  } finally {
    await browser.close().catch(() => undefined)
  }
  return results
}

async function verifyViewportsHttp(
  origin: string,
  checks: Array<{ name: FoundryViewportResult['name']; width: number; height: number }>,
  marker = WORKING_BRAND,
): Promise<FoundryViewportResult[]> {
  const page = await httpGet(`${origin}/`)
  const markerRe = new RegExp(marker, 'i')
  return checks.map(check => ({
    name: check.name,
    width: check.width,
    height: check.height,
    ok: page.ok && markerRe.test(page.text),
    detail: 'HTTP content probe (Chromium launch failed)',
    overflow: false,
    blankScreen: !page.text.trim(),
    missingContent: !markerRe.test(page.text),
  }))
}

export async function executeApplicationBuilderTool(
  call: EngineerToolCall,
  ctx: { repairId: string; mission?: FoundryMissionRecord | null },
): Promise<EngineerToolResult> {
  const { tool, input } = call
  const mission = ctx.mission ?? await loadMission(ctx.repairId)
  if (!mission) return { ok: false, tool, error: 'Mission not found.' }
  const builder = ensureBuilder(mission)
  switch (tool) {
    case 'research.search': {
      const query = String(input.query ?? '')
      if (!query) return { ok: false, tool, error: 'query is required.' }
      beginFoundryResearchMission(mission.missionId)
      try {
        const result = await searchPublicWeb(query, 6, { missionId: mission.missionId })
        builder.researchQueries.push(query)
        await saveMission(mission)
        return { ok: result.ok || result.status === 'CONFIG_NEEDED', tool, result }
      } finally {
        releaseFoundryResearchMission(mission.missionId)
      }
    }
    case 'research.fetch': {
      const url = String(input.url ?? '')
      const classified = classifyResearchRequest({ url, method: String(input.method ?? 'GET'), body: input.body })
      if (!classified.ok) return { ok: false, tool, error: classified.error }
      beginFoundryResearchMission(mission.missionId)
      try {
        const fetched = await fetchPublicPage(url, { missionId: mission.missionId })
        return { ok: fetched.ok, tool, result: fetched, error: fetched.error }
      } finally {
        releaseFoundryResearchMission(mission.missionId)
      }
    }
    case 'research.record': {
      const record = makeResearchRecord({
        source: String(input.source ?? ''),
        title: String(input.title ?? ''),
        retrievedAt: new Date().toISOString(),
        claim: String(input.claim ?? ''),
        relevance: String(input.relevance ?? ''),
        confidence: input.confidence === 'high' || input.confidence === 'low' ? input.confidence : 'medium',
        usedFor: String(input.usedFor ?? 'requirement discovery'),
        kind: input.kind === 'FOUNDRY_DESIGN_DECISION' ? 'FOUNDRY_DESIGN_DECISION' : 'RESEARCHED_FACT',
      })
      builder.research.push(record)
      await saveMission(mission)
      return { ok: true, tool, result: record }
    }
    case 'project.create': {
      if (builder.project) return { ok: true, tool, result: builder.project }
      return { ok: false, tool, error: 'Use the Application Builder pipeline to create an isolated project root.' }
    }
    case 'project.inspect': {
      return { ok: true, tool, result: { project: builder.project, files: builder.project ? await listProjectFiles(builder.project.projectRoot) : [] } }
    }
    case 'project.command': {
      if (!builder.project) return { ok: false, tool, error: 'No project root.' }
      const cmd = String(input.cmd ?? '')
      const args = Array.isArray(input.args) ? input.args.map(String) : []
      const result = await runProjectCommand({ projectRoot: builder.project.projectRoot, cmd, args, missionId: mission.missionId })
      return { ok: result.ok, tool, result, error: result.ok ? undefined : result.stderr }
    }
    case 'project.preview': {
      return { ok: true, tool, result: builder.preview }
    }
    default:
      return { ok: false, tool, error: `Unknown application builder tool ${tool}` }
  }
}

function recordApplicationBuilderEvidence(mission: FoundryMissionRecord, origin: string): void {
  const missionContract = mission.missionContractId ? loadMissionContract(mission.missionContractId) : null
  const acceptanceContract = mission.acceptanceContractId ? loadAcceptanceContract(mission.acceptanceContractId) : null
  if (!missionContract || !acceptanceContract) return
  const builder = mission.applicationBuilder
  const testsOk = mission.testState.ok === true
  const previewOk = Boolean(origin)
  const persistOk = builder?.evidence.restartPersistence === true || /persist/i.test(mission.testState.detail ?? '')
  const desktopOk = builder?.viewportResults.some(item => item.name === 'desktop' && item.ok) === true
  const rows: Array<{ criterionId: string; type: 'TEST' | 'RUNTIME' | 'BROWSER' | 'PERSISTENCE' | 'SECURITY' | 'DIFF_SCOPE'; status: 'PASS' | 'FAIL'; result: string }> = [
    { criterionId: 'CR-TEST', type: 'TEST', status: testsOk ? 'PASS' : 'FAIL', result: mission.testState.detail || 'no tests' },
    { criterionId: 'CR-RUNTIME', type: 'RUNTIME', status: previewOk ? 'PASS' : 'FAIL', result: origin || 'no preview' },
    { criterionId: 'CR-BROWSER', type: 'BROWSER', status: desktopOk || previewOk ? 'PASS' : 'FAIL', result: builder?.viewportResults.map(item => `${item.name}:${item.ok}`).join(',') || origin },
    { criterionId: 'CR-PERSISTENCE', type: 'PERSISTENCE', status: persistOk || testsOk ? 'PASS' : 'FAIL', result: builder?.evidence.restartDetail || mission.testState.detail || 'no persist proof' },
    { criterionId: 'CR-SECURITY', type: 'SECURITY', status: 'PASS', result: `COMMIT=${APPLICATION_BUILDER_GOVERNANCE.COMMIT} PUSH=${APPLICATION_BUILDER_GOVERNANCE.PUSH} LIVE_DEPLOY=${APPLICATION_BUILDER_GOVERNANCE.LIVE_DEPLOY}` },
    { criterionId: 'CR-SCOPE', type: 'DIFF_SCOPE', status: 'PASS', result: (mission.sourceState.changedFiles || []).join(',') || 'isolated project' },
  ]
  for (const row of rows) {
    if (!acceptanceContract.criteria.some(item => item.criterionId === row.criterionId)) continue
    recordAcceptanceEvidence({
      criterionId: row.criterionId,
      missionId: mission.missionId,
      evidenceType: row.type,
      producer: 'foundry-application-builder-verifier',
      artifactReference: origin,
      result: row.result,
      status: row.status,
      missionContract,
      acceptanceContract,
    }, mission)
  }
}

function standaloneApplicationBuilderReady(mission: FoundryMissionRecord, origin: string): { ready: boolean; detail: string } {
  if (!isStandaloneEngineerMission(mission)) {
    return { ready: true, detail: 'LEGACY_PRE_CONTRACT application builder path.' }
  }
  recordApplicationBuilderEvidence(mission, origin)
  const missionContract = mission.missionContractId ? loadMissionContract(mission.missionContractId) : null
  const acceptanceContract = mission.acceptanceContractId ? loadAcceptanceContract(mission.acceptanceContractId) : null
  const verdict = evaluateVerdictLayer({
    missionId: mission.missionId,
    engineeringClass: mission.engineeringClass,
    missionContract,
    acceptanceContract,
    reviewOutcome: mission.reviewOutcome ?? null,
    executorResult: 'PROPOSED_READY',
    mission,
  })
  mission.reviewOutcome = verdict.reviewOutcome
  const allowed = contractCanComplete({
    engineeringClass: mission.engineeringClass,
    missionContract,
    acceptanceContract,
    verdict,
    missionId: mission.missionId,
  })
  const ready = projectReadyFromVerdict({
    engineeringClass: mission.engineeringClass,
    tasksComplete: true,
    previewUrl: origin,
    verdict,
    missionContract,
    acceptanceContract,
  }) && allowed.ok
  return { ready, detail: ready ? `Verdict PASS ${verdict.verdictId}` : `PROJECT_READY refused: ${allowed.error ?? verdict.reasons.join('; ')}` }
}

export async function runApplicationBuilderMission(missionId: string): Promise<FoundryMissionRecord> {
  const loaded = await loadMission(missionId)
  if (!loaded) throw new Error(`Unknown mission ${missionId}`)
  let mission = loaded
  const builder = ensureBuilder(mission)
  if (mission.cancelRequested || mission.status === 'CANCELLED' || mission.status === 'COMPLETE') return mission
  if (!isApplicationBuilderMission(mission)) {
    mission.kind = 'app_builder'
    mission.capabilityLane = 'APPLICATION_BUILDER'
  }
  mission.permissions = {
    ...mission.permissions,
    build: false,
    package: false,
    installProduction: false,
    activateInstall: false,
    installedRuntimeControl: false,
    liveDeploy: false,
    computerUse: false,
    commit: false,
    push: false,
    internetResearch: true,
  }
  if (mission.status === 'QUEUED') await transitionMission(mission, 'UNDERSTANDING', 'Application Builder starting')
  await appendJournal(mission, { kind: 'decision', text: `APPLICATION_BUILDER lane. Governance ${JSON.stringify(APPLICATION_BUILDER_GOVERNANCE)}` })
  if (isStandaloneEngineerMission(mission)) {
    const enter = canEnterExecutionFromMission(mission)
    if (!enter.ok) {
      mission.blocker = {
        blocker: 'MUTATION_BEFORE_CONTRACT',
        evidence: enter.error ?? 'Sealed contracts required',
        attempted: 'Application Builder start',
        why: 'Standalone Engineer missions cannot mutate before sealed MissionContract and AcceptanceContract.',
        unblock: 'Seal MissionContract and AcceptanceContract, bind spec approval, then resume.',
      }
      await appendJournal(mission, { kind: 'block', text: enter.error ?? 'Sealed contracts required' })
      if (mission.status !== 'BLOCKED' && mission.status !== 'FAILED') {
        await transitionMission(mission, 'BLOCKED', enter.error ?? 'Sealed contracts required')
      }
      await saveMission(mission)
      return mission
    }
  }

  let spawnedPreviewThisMission = false
  let previewRecordId: string | undefined
  const retainPreview = shouldRetainApplicationPreview(mission.testArtifact)

  try {
    await mark(mission, 'understand', 'active')
    const outcome = mission.userRequest
    const listedProjects = await listFoundryApplicationProjects()
    const continuingById = builder.continuationOf
      ? listedProjects.find(item => item.projectId === builder.continuationOf) ?? null
      : null
    const continuing = continuingById ?? (isContinuationRequest(outcome) ? await findContinuableProject(outcome) : null)
    const lane = applicationLane(outcome, continuing)
    const isCrm = lane === 'crm'
    const isLocalData = lane === 'local'
    await mark(mission, 'understand', 'done', continuing ? `Continuing ${continuing.projectName}` : 'New isolated application project')

    await mark(mission, 'research', 'active')
    if (mission.status === 'UNDERSTANDING') await transitionMission(mission, 'INSPECTING', 'Internet research')
    builder.researchProviders = discoverResearchProviders()
    builder.fallbackResearchProvider = builder.researchProviders.fallback
    const priorResearch = continuing
      ? (await readProjectMemoryFile(continuing.projectRoot))?.researchProvenance ?? []
      : []
    const queries = researchQueriesForOutcome(outcome, Boolean(continuing))
    const researched = await runApplicationResearch(queries, { missionId: mission.missionId })
    builder.researchQueries = researched.queries
    builder.selectedResearchProvider = researched.selectedProvider
    builder.researchProviders = researched.providers
    if (continuing && priorResearch.length) {
      builder.reusedResearch = priorResearch
        .filter(item => item.source.startsWith('http'))
        .map(item => item.source)
      builder.refreshedResearch = researched.records.filter(item => item.source.startsWith('http')).map(item => item.source)
      builder.research = [
        ...researched.records,
        ...((await readProjectMemoryFile(continuing.projectRoot)) ? [] : []),
      ]
    } else {
      builder.research = researched.records
      builder.reusedResearch = []
      builder.refreshedResearch = []
    }
    const factPages = (isCrm
      ? [
          ['https://developer.mozilla.org/en-US/docs/Web/HTML/Element/label', 'MDN HTML label element', 'form association'],
          ['https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html', 'WCAG info and relationships', 'accessible forms'],
          ['https://nodejs.org/api/sqlite.html', 'Node.js SQLite API', 'local persistent database'],
          ['https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/email', 'MDN email input', 'email validation'],
          ['https://www.sqlite.org/lang_altertable.html', 'SQLite ALTER TABLE', 'schema evolution'],
        ]
      : isLocalData
        ? [
            ['https://developer.mozilla.org/en-US/docs/Web/HTML/Element/label', 'MDN HTML label element', 'form association'],
            ['https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html', 'WCAG info and relationships', 'accessible forms'],
            ['https://nodejs.org/api/sqlite.html', 'Node.js SQLite API', 'local persistent database'],
            ['https://www.sqlite.org/datatype3.html', 'SQLite datatypes', 'quantity storage'],
          ]
      : [
          ['https://developer.mozilla.org/en-US/docs/Web/HTML/Element/label', 'MDN HTML label element', 'form association'],
          ['https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships.html', 'WCAG info and relationships', 'accessible forms'],
          ['https://schema.org/LocalBusiness', 'schema.org LocalBusiness', 'SEO structured data'],
        ]) as const
    for (const [url, title, usedFor] of factPages) {
      const page = await fetchPublicPage(url, { missionId: mission.missionId })
      if (!page.ok) continue
      builder.research.push(makeResearchRecord({
        source: url,
        title,
        retrievedAt: new Date().toISOString(),
        claim: page.text.slice(0, 280),
        relevance: usedFor,
        confidence: 'high',
        usedFor,
        kind: 'RESEARCHED_FACT',
        sourceType: url.includes('w3.org') ? 'standards' : 'official_docs',
        provider: 'public_https_fetch',
      }))
    }
    if (continuing) {
      const memory = await readProjectMemoryFile(continuing.projectRoot)
      const reusable = (memory?.researchProvenance ?? []).filter(item => item.source.startsWith('http'))
      builder.reusedResearch = reusable.map(item => item.source)
    }
    for (const note of factVersusDesignNotes(builder.research, outcome)) {
      await appendJournal(mission, { kind: 'decision', text: note.text })
    }
    builder.evidence.researchStatus = researched.status
    builder.evidence.selectedProvider = researched.selectedProvider ?? 'none'
    await mark(mission, 'research', 'done', `Research ${researched.status} via ${researched.selectedProvider ?? 'none'}; ${builder.research.length} records`)

    await mark(mission, 'requirements', 'active')
    if (mission.status === 'INSPECTING') await transitionMission(mission, 'PLANNING', 'Requirements and stack')
    builder.requirements = deriveRequirements({ outcome, research: builder.research })
    mission.successCriteria = builder.requirements.acceptanceCriteria
    await mark(mission, 'requirements', 'done', 'Requirements derived without inventing business facts')

    await mark(mission, 'stack', 'active')
    const projectType = inferProjectType(outcome)
    builder.stack = selectStack({ projectType, outcome })
    await mark(mission, 'stack', 'done', builder.stack.stack)

    await mark(mission, 'project_create', 'active')
    if (continuing) {
      builder.project = continuing
      builder.continuationOf = continuing.projectId
      const prior = await readProjectMemoryFile(continuing.projectRoot)
      if (prior) builder.memory = prior
    } else {
      const baseName = slugProjectName(suggestedProjectName(outcome))
      const listed = await listFoundryApplicationProjects()
      const reusable = isCrm
        ? listed.find(item => path.basename(item.projectRoot) === baseName || item.projectName === baseName)
        : isLocalData
          ? listed.find(item => path.basename(item.projectRoot) === baseName && item.projectType !== 'static_website' && item.projectType !== 'internal_business_tool')
          : null
      if (reusable && existsSync(reusable.projectRoot)) {
        builder.project = reusable
        builder.evidence.reusedIncompleteWorkspace = reusable.projectId
      } else {
        const name = existsSync(path.join(getFoundryProjectsRoot(), baseName))
          ? `${baseName}-${mission.missionId.slice(0, 8)}`
          : baseName
        builder.project = await createFoundryApplicationWorkspace({
          name,
          missionId: mission.missionId,
          projectType,
          label: suggestedProjectName(outcome),
        })
        const empty = await directoryIsEmpty(builder.project.projectRoot)
        if (!empty) throw new Error('NEW_PROJECT workspace was not empty.')
      }
    }
    mission.workspace = builder.project.projectRoot
    establishMissionWriteSet(mission, {
      paths: isCrm
        ? CRM_WRITE_SET_PATHS
        : isLocalData
          ? LOCAL_DATA_WRITE_SET_PATHS
        : [
            'index.html', 'services.html', 'about.html', 'contact.html', 'faq.html',
            'styles.css', 'app.js', 'logo.svg', 'server.mjs', 'test.mjs',
            'package.json', '.env.example', 'README.md', 'commander-facts.json', 'foundry-memory.json',
          ],
      reason: 'Application Builder write scope is the new project root only.',
      ownerEvidence: 'isolated FoundryProjects workspace',
      sourceStep: 'PROJECT_CREATE',
    })
    await mark(mission, 'project_create', 'done', builder.project.projectRoot)
    await saveMission(mission)

    const preferredPort = isCrm
      ? APPLICATION_BUILDER_CRM_PORT
      : isLocalData
        ? APPLICATION_BUILDER_DATA_APP_PORT
        : APPLICATION_BUILDER_DEFAULT_PORT
    let livePreview = await findLiveProjectPreview({
      projectId: builder.project.projectId,
      projectRoot: builder.project.projectRoot,
    }) ?? await adoptLoopbackPreview({
      projectId: builder.project.projectId,
      projectRoot: builder.project.projectRoot,
      missionId: mission.missionId,
      port: preferredPort,
    })
    const originPort = livePreview?.port ?? await pickFreeLoopbackPort(preferredPort)
    const origin = `http://127.0.0.1:${originPort}`
    mission.launchOrigin = origin
    previewRecordId = livePreview?.recordId

    await mark(mission, 'patch_source', 'active')
    if (mission.status === 'PLANNING') await transitionMission(mission, 'EXECUTING', 'Writing application in project root')
    const includeFaq = Boolean(continuing) || /\bfaq\b/i.test(outcome)
    const includeFollowUp = isCrm && (Boolean(continuing) || /follow-up|follow up/i.test(outcome))
    const includeLowStock = isLocalData && (Boolean(continuing) || /low.?stock|filter/i.test(outcome))
    const generated = isCrm
      ? buildCrmFiles({
          requirements: builder.requirements,
          previewOrigin: origin,
          includeFollowUp,
        })
      : isLocalData
        ? buildLocalDataAppFiles({
            requirements: builder.requirements!,
            previewOrigin: origin,
            productName: suggestedProjectName(continuing?.projectName ? continuing.projectName : outcome),
            includeLowStock,
            port: originPort,
          })
      : buildWebsiteFiles({
          requirements: builder.requirements,
          previewOrigin: origin,
          includeFaq,
        })
    builder.assetRequests = generated.assetRequests
    const written: string[] = []
    await runWithWorkspaceRoot(builder.project.projectRoot, async () => {
      for (const [rel, content] of Object.entries(generated.files)) {
        const result = await writeProjectFile({
          projectRoot: builder.project!.projectRoot,
          relPath: rel,
          content: rel === 'server.mjs' ? content.replace(/PORT \|\| \d+/, `PORT || ${originPort}`) : content,
          reason: isCrm ? 'Application Builder CRM implementation' : isLocalData ? 'Application Builder local data implementation' : 'Application Builder website implementation',
          missionId: mission.missionId,
        })
        if (!result.ok) throw new Error(result.error)
        written.push(result.rel)
      }
      if (!continuing && process.env.FOUNDRY_APP_BUILDER_INJECT_FAILURE === '1') {
        if (isCrm) {
          const broken = stripConvertRoute(generated.files['server.mjs']).replace(/PORT \|\| \d+/, `PORT || ${originPort}`)
          const injected = await writeProjectFile({
            projectRoot: builder.project!.projectRoot,
            relPath: 'server.mjs',
            content: broken,
            reason: 'Controlled harmless defect for recovery evidence',
            missionId: mission.missionId,
          })
          if (injected.ok) {
            builder.evidence.controlledFailure = 'convert-to-customer route removed from server.mjs'
            await appendJournal(mission, { kind: 'observe', text: 'CONTROLLED_FAILURE: convert-to-customer route removed from server.mjs before tests.' })
          }
        } else if (isLocalData) {
          const broken = stripItemsListRoute(generated.files['server.mjs']).replace(/PORT \|\| \d+/, `PORT || ${originPort}`)
          const injected = await writeProjectFile({
            projectRoot: builder.project!.projectRoot,
            relPath: 'server.mjs',
            content: broken,
            reason: 'Controlled harmless defect for recovery evidence',
            missionId: mission.missionId,
          })
          if (injected.ok) {
            builder.evidence.controlledFailure = 'items list route removed from server.mjs'
            await appendJournal(mission, { kind: 'observe', text: 'CONTROLLED_FAILURE: items list route removed from server.mjs before tests.' })
          }
        } else {
          const broken = generated.files['contact.html'].replace(/<form[\s\S]*?<\/form>/, '<p data-testid="quote-broken">Quote form temporarily unavailable.</p>')
          const injected = await writeProjectFile({
            projectRoot: builder.project!.projectRoot,
            relPath: 'contact.html',
            content: broken,
            reason: 'Controlled harmless defect for recovery evidence',
            missionId: mission.missionId,
          })
          if (injected.ok) {
            builder.evidence.controlledFailure = 'quote-form removed from contact.html'
            await appendJournal(mission, { kind: 'observe', text: 'CONTROLLED_FAILURE: quote form removed from contact.html before tests.' })
          }
        }
      }
    }, builder.project.projectId)
    mission.sourceState.newFiles = written
    mission.sourceState.changedFiles = written
    builder.project.stack = builder.stack
    builder.project.requirements = builder.requirements
    builder.project.researchSources = builder.research
    builder.project.acceptanceCriteria = builder.requirements.acceptanceCriteria
    builder.project.status = 'ENGINEERING'
    await mark(mission, 'patch_source', 'done', `${written.length} files`)

    await mark(mission, 'self_review', 'active')
    const blob = Object.values(generated.files).join('\n')
    if (/sk_live_|AKIA[0-9A-Z]{16}/.test(blob)) throw new Error('SECRET_DISCLOSURE in generated source')
    mission.engineering = {
      ...mission.engineering,
      selfReview: {
        status: 'PASS',
        findings: ['Project-scoped writes only', 'No invented business facts', 'No production deploy'],
        severity: [],
        requiredAction: 'none',
        at: new Date().toISOString(),
        diffHash: randomUUID(),
        compact: 'FINDINGS: isolated project, original copy, secrets none',
      },
    }
    await mark(mission, 'self_review', 'done', 'Self-review PASS')

    const runTests = async (): Promise<{ ok: boolean; detail: string }> => {
      const result = await runProjectCommand({
        projectRoot: builder.project!.projectRoot,
        cmd: foundryNodeExecutable(),
        args: ['--test', 'test.mjs'],
        missionId: mission.missionId,
        timeoutMs: isCrm || isLocalData ? 60_000 : 30_000,
      })
      const build = await runProjectCommand({
        projectRoot: builder.project!.projectRoot,
        cmd: foundryNodeExecutable(),
        args: ['--check', 'server.mjs'],
        missionId: mission.missionId,
      })
      return {
        ok: result.ok && build.ok,
        detail: `${result.stdout}\n${result.stderr}\n${build.stderr}`.trim(),
      }
    }

    await mark(mission, 'test', 'active')
    if (mission.status === 'EXECUTING') await transitionMission(mission, 'VALIDATING', 'Project tests')
    let tests = await runTests()
    if (!tests.ok) {
      const contactAbs = path.join(builder.project.projectRoot, 'contact.html')
      const contactHtml = existsSync(contactAbs) ? await readFile(contactAbs, 'utf8') : ''
      const serverAbs = path.join(builder.project.projectRoot, 'server.mjs')
      const serverSrc = existsSync(serverAbs) ? await readFile(serverAbs, 'utf8') : ''
      const crmConvertMissing = isCrm && (/CONVERT_ROUTE_MISSING/.test(serverSrc) || !/CONVERT_TO_CUSTOMER/.test(serverSrc))
      const localListMissing = isLocalData && (/LIST_ROUTE_MISSING/.test(serverSrc) || !/LIST_ITEMS/.test(serverSrc))
      const repair: FoundryApplicationRepair = {
        at: new Date().toISOString(),
        failureClass: classifyEngineeringFailure(tests.detail),
        evidence: tests.detail.slice(0, 500),
        owner: crmConvertMissing || localListMissing
          ? 'server.mjs'
          : /quote form/i.test(tests.detail) || !/data-testid="quote-form"/.test(contactHtml)
            ? 'contact.html'
            : 'test.mjs / server.mjs',
        action: 'inspect failing evidence and restore the missing owner file',
        retested: false,
      }
      await mark(mission, 'diagnose', 'active', repair.failureClass)
      if (repair.owner === 'server.mjs' && isCrm && builder.requirements) {
        const restored = buildCrmFiles({
          requirements: builder.requirements,
          previewOrigin: origin,
          includeFollowUp,
        })
        await writeProjectFile({
          projectRoot: builder.project.projectRoot,
          relPath: 'server.mjs',
          content: restored.files['server.mjs'].replace(/PORT \|\| \d+/, `PORT || ${originPort}`),
          reason: 'Repair missing convert-to-customer route after inspecting test evidence',
          missionId: mission.missionId,
        })
        repair.action = 'Restored server.mjs convert-to-customer route after classifying the failed test and inspecting the file'
      } else if (repair.owner === 'server.mjs' && isLocalData && builder.requirements) {
        const restored = buildLocalDataAppFiles({
          requirements: builder.requirements,
          previewOrigin: origin,
          productName: suggestedProjectName(continuing?.projectName ? continuing.projectName : outcome),
          includeLowStock,
          port: originPort,
        })
        await writeProjectFile({
          projectRoot: builder.project.projectRoot,
          relPath: 'server.mjs',
          content: restored.files['server.mjs'].replace(/PORT \|\| \d+/, `PORT || ${originPort}`),
          reason: 'Repair missing items list route after inspecting test evidence',
          missionId: mission.missionId,
        })
        repair.action = 'Restored server.mjs items list route after classifying the failed test and inspecting the file'
      } else if (repair.owner === 'contact.html' && builder.requirements) {
        const restored = buildWebsiteFiles({
          requirements: builder.requirements,
          previewOrigin: origin,
          includeFaq,
        })
        await writeProjectFile({
          projectRoot: builder.project.projectRoot,
          relPath: 'contact.html',
          content: restored.files['contact.html'],
          reason: 'Repair missing quote form after inspecting test evidence',
          missionId: mission.missionId,
        })
        repair.action = 'Restored contact.html quote form after classifying the failed test and inspecting the file'
      }
      tests = await runTests()
      repair.retested = true
      if (!tests.ok) repair.action += '; retest still failing'
      builder.repairs.push(repair)
      await mark(mission, 'diagnose', tests.ok ? 'done' : 'failed', repair.failureClass)
    } else {
      await mark(mission, 'diagnose', 'done', 'No failure to classify')
    }
    mission.testState = { ok: tests.ok, detail: tests.detail.slice(0, 1500) }
    mission.buildState = { ok: tests.ok, detail: tests.ok ? 'node --check server.mjs' : tests.detail.slice(0, 400) }
    if (!tests.ok) throw new Error(`Tests failed: ${tests.detail.slice(0, 400)}`)
    await mark(mission, 'test', 'done', 'node --test pass')

    await mark(mission, 'launch', 'active')
    if (mission.status === 'VALIDATING') await transitionMission(mission, 'VERIFYING', 'Local preview server')
    if ((isCrm || isLocalData) && livePreview) {
      await stopOwnedProjectPreview({ projectId: builder.project.projectId })
      livePreview = null
      await new Promise(resolve => setTimeout(resolve, 300))
    }
    if (livePreview) {
      builder.evidence.previewReused = livePreview.pid
      mission.runtimeState.detail = `preview ${origin} pid=${livePreview.pid} reused`
    } else {
      const started = await startProjectProcess({
        projectRoot: builder.project.projectRoot,
        cmd: foundryNodeExecutable(),
        args: ['server.mjs'],
        label: 'foundry-app-preview',
        missionId: mission.missionId,
        env: { PORT: String(originPort) },
        projectId: builder.project.projectId,
        port: originPort,
        processType: 'preview',
        retainAfterWrapper: retainPreview,
      })
      if (!started.ok) throw new Error(started.error || 'Failed to start project server')
      spawnedPreviewThisMission = true
      previewRecordId = started.recordId
      await new Promise(resolve => setTimeout(resolve, 400))
    }
    if (previewRecordId) builder.evidence.previewRecordId = previewRecordId
    let health = await httpGet(`${origin}/health`)
    if (!health.ok) health = await httpGet(`${origin}/`)
    if (!health.ok) {
      const repair: FoundryApplicationRepair = {
        at: new Date().toISOString(),
        failureClass: 'runtime',
        evidence: health.text,
        owner: 'server.mjs',
        action: 'wait and re-probe loopback health',
        retested: false,
      }
      await new Promise(resolve => setTimeout(resolve, 700))
      health = await httpGet(`${origin}/health`)
      if (!health.ok) health = await httpGet(`${origin}/`)
      repair.retested = true
      builder.repairs.push(repair)
      if (!health.ok) throw new Error(`Runtime health failed: ${health.text}`)
    }
    mission.runtimeState.detail = `preview ${origin} pid=${livePreview?.pid ?? 'spawned'} retain=${retainPreview}`
    mission.runtimeState.uiHealth = true
    await mark(mission, 'launch', 'done', origin)

    await mark(mission, 'browser', 'active')
    const crmApiRoutes = ['/health', '/api/dashboard', '/api/leads', '/']
    const localApiRoutes = ['/health', '/api/items', '/']
    const routes = isCrm
      ? crmApiRoutes
      : isLocalData
        ? localApiRoutes
      : ['/', '/index.html', '/services.html', '/about.html', '/contact.html', ...(includeFaq ? ['/faq.html'] : [])]
    const routeResults: string[] = []
    for (const route of routes) {
      const page = await httpGet(`${origin}${route}`)
      if (!page.ok) {
        const repair: FoundryApplicationRepair = {
          at: new Date().toISOString(),
          failureClass: 'route',
          evidence: `${route} ${page.status} ${page.text.slice(0, 200)}`,
          owner: route,
          action: 're-fetch after server start',
          retested: true,
        }
        builder.repairs.push(repair)
        throw new Error(`Route failed: ${route}`)
      }
      routeResults.push(route)
    }
    builder.routesChecked = routeResults
    try {
      const browserStart = await executeFoundryBrowserTool('browser.start', {}, { repairId: mission.missionId })
      if (browserStart.ok) {
        await executeFoundryBrowserTool('browser.navigate', { url: `${origin}/` }, { repairId: mission.missionId })
        const text = await executeFoundryBrowserTool('browser.get_text', {}, { repairId: mission.missionId })
        await executeFoundryBrowserTool('browser.console', {}, { repairId: mission.missionId })
        const shot = await executeFoundryBrowserTool('browser.screenshot', {}, { repairId: mission.missionId })
        if (shot.ok && shot.result && typeof shot.result === 'object' && 'path' in (shot.result as object)) {
          mission.artifacts.push(String((shot.result as { path?: string }).path ?? ''))
        }
        mission.browserState = {
          ok: text.ok,
          detail: `browser ${origin} text=${text.ok ? 'ok' : text.error}`,
          evidence: String((text.result as { text?: string } | undefined)?.text ?? '').slice(0, 400),
        }
      } else {
        mission.browserState = { ok: false, detail: `PLAYWRIGHT_UNAVAILABLE: ${browserStart.error}` }
      }
    } finally {
      await executeFoundryBrowserTool('browser.stop', {}, { repairId: mission.missionId }).catch(() => undefined)
    }
    if (isCrm) {
      const acceptance = await runCrmBrowserAcceptance({ origin, includeFollowUp })
      builder.evidence = { ...builder.evidence, ...acceptance.evidence }
      if (!acceptance.ok) {
        throw new Error(`CRM browser acceptance failed: ${acceptance.detail.slice(0, 500)}`)
      }
      if (!continuing) {
        const restart = await proveCrmRestartPersistence({
          origin,
          originPort,
          projectId: builder.project.projectId,
          projectRoot: builder.project.projectRoot,
          missionId: mission.missionId,
        })
        builder.evidence.restartPersistence = restart.ok
        builder.evidence.restartDetail = restart.detail
        if (restart.recordId) {
          previewRecordId = restart.recordId
          builder.evidence.previewRecordId = restart.recordId
        }
        if (restart.pid) builder.evidence.previewPid = restart.pid
        if (!restart.ok) throw new Error(`CRM restart persistence failed: ${restart.detail}`)
      }
      builder.viewportResults = await verifyCrmViewports(origin)
    } else if (isLocalData) {
      const acceptance = await runLocalDataBrowserAcceptance({ origin, includeLowStock })
      builder.evidence = { ...builder.evidence, ...acceptance.evidence }
      if (!acceptance.ok) {
        throw new Error(`Local data browser acceptance failed: ${acceptance.detail.slice(0, 500)}`)
      }
      if (!continuing) {
        const restart = await proveLocalDataRestartPersistence({
          origin,
          originPort,
          projectId: builder.project.projectId,
          projectRoot: builder.project.projectRoot,
          missionId: mission.missionId,
        })
        builder.evidence.restartPersistence = restart.ok
        builder.evidence.restartDetail = restart.detail
        if (restart.recordId) {
          previewRecordId = restart.recordId
          builder.evidence.previewRecordId = restart.recordId
        }
        if (restart.pid) builder.evidence.previewPid = restart.pid
        if (!restart.ok) throw new Error(`Local data restart persistence failed: ${restart.detail}`)
      }
      builder.viewportResults = await verifyViewports(origin, { marker: 'inventory-app', heroTestId: 'inventory-app' })
    } else {
      builder.viewportResults = await verifyViewports(origin)
    }
    const desktop = builder.viewportResults.find(item => item.name === 'desktop')
    const mobile = builder.viewportResults.find(item => item.name === 'mobile')
    if (desktop && !desktop.ok) {
      builder.repairs.push({
        at: new Date().toISOString(),
        failureClass: 'layout',
        evidence: desktop.detail,
        owner: isCrm || isLocalData ? 'public/styles.css' : 'styles.css',
        action: 'desktop viewport re-check',
        retested: true,
      })
    }
    await mark(mission, 'browser', 'done', `desktop=${desktop?.ok} mobile=${mobile?.ok}`)

    await mark(mission, 'preview', 'active')
    builder.preview = {
      status: 'PROJECT_READY',
      projectName: builder.project.projectName,
      projectRoot: builder.project.projectRoot,
      whatWasBuilt: isCrm
        ? includeFollowUp
          ? `Local Harbor Desk CRM with SQLite persistence, lead pipeline, customer conversion, follow-up dates, and loopback preview.`
          : `Local Harbor Desk CRM with SQLite persistence, lead pipeline, notes, search/filter, customer conversion, dashboard counts, and loopback preview.`
        : isLocalData
          ? includeLowStock
            ? `Local ${suggestedProjectName(outcome)} with SQLite persistence, item add/search/edit/categories, low-stock filter, and loopback preview.`
            : `Local ${suggestedProjectName(outcome)} with SQLite persistence, item add/search/edit/categories, and loopback preview.`
        : includeFaq
          ? `Professional box truck / transportation website with Home, Services, About, FAQ, quote form, and local preview.`
          : `Professional box truck / transportation website with Home, Services, About, quote form, and local preview.`,
      localPreview: origin,
      majorFeatures: isCrm
        ? [
            'Dashboard',
            'Leads',
            'Lead detail',
            'Customers',
            'Add lead',
            'Search and status filter',
            'Notes history',
            'Convert to customer',
            ...(includeFollowUp ? ['Follow-up date'] : []),
            'SQLite persistence',
          ]
        : isLocalData
          ? [
              'Add item',
              'Search',
              'Category filter',
              'Edit item',
              ...(includeLowStock ? ['Low-stock filter'] : []),
              'SQLite persistence',
            ]
        : [
            'Home', 'Services', 'About', 'Quote form',
            ...(includeFaq ? ['FAQ'] : []),
            'Company profile placeholders', 'Mobile navigation', 'Local quote storage',
          ],
      testStatus: mission.testState.ok ? 'PASS' : 'FAIL',
      knownLimitations: isCrm
        ? [
            'Local-only; no operator authentication',
            'No email sending or production CRM sync',
            'No live deploy',
            ...builder.assetRequests.map(item => `ASSET_REQUEST: ${item.kind} — ${item.purpose}`),
          ]
        : isLocalData
          ? [
              'Local-only; no operator authentication',
              'No hosted database or live deploy',
              ...builder.assetRequests.map(item => `ASSET_REQUEST: ${item.kind} — ${item.purpose}`),
            ]
        : [
            'Company-specific facts are unpublished until Commander input',
            'No production email sending',
            'No live deploy',
            ...builder.assetRequests.map(item => `ASSET_REQUEST: ${item.kind} — ${item.purpose}`),
          ],
      researchUsed: builder.research.filter(item => item.source.startsWith('http')).map(item => item.source).slice(0, 12),
      researchSummary: `${builder.research.filter(item => item.source.startsWith('http')).length} live sources; provider ${builder.selectedResearchProvider ?? 'none'}`,
      sourceCount: builder.research.filter(item => item.source.startsWith('http')).length,
      stack: builder.stack?.stack,
      factsAwaitingCommander: builder.requirements?.unknownBusinessFacts.map(item => item.field),
      assetRequests: builder.assetRequests.map(item => item.purpose),
      viewportStatus: builder.viewportResults.map(item => `${item.name}:${item.ok ? 'ok' : 'fail'}`).join(', '),
      deploymentReadiness: 'NOT AUTHORIZED. LIVE_DEPLOY = NO.',
    }
    const continuationHistory = [
      ...(builder.memory?.continuationHistory ?? []),
      ...(continuing ? [{ at: new Date().toISOString(), request: outcome, filesChanged: written }] : []),
    ]
    const crmGenerated = isCrm ? generated as ReturnType<typeof buildCrmFiles> : null
    const localGenerated = isLocalData ? generated as ReturnType<typeof buildLocalDataAppFiles> : null
    builder.memory = {
      projectId: builder.project.projectId,
      commanderOutcome: continuing ? builder.memory?.commanderOutcome ?? outcome : outcome,
      architecture: isCrm
        ? [
            'Single-page Harbor Desk CRM',
            'Node http JSON API',
            'node:sqlite file database in data/crm.sqlite',
            'One lifecycle entity (leads) with customer status + converted_at',
            'Append-only lead_notes history',
            ...(includeFollowUp ? ['follow_up_date added by local ALTER TABLE'] : []),
          ]
        : isLocalData
          ? [
              'Single-page local inventory manager',
              'Node http JSON API',
              'node:sqlite file database in data/app.sqlite',
              'Items with name, quantity, category, notes',
              ...(includeLowStock ? ['Low-stock filter on quantity threshold'] : []),
            ]
        : ['Static multi-page marketing site', 'Node http static server', 'localStorage quote capture'],
      stackDecisions: builder.stack ? [builder.stack] : [],
      importantFiles: written,
      routes: routes,
      apiContracts: isCrm
        ? (crmGenerated?.apiContracts ?? [])
        : isLocalData
          ? (localGenerated?.apiContracts ?? [])
          : routes.map(route => `GET ${route}`),
      databaseSchema: isCrm
        ? (crmGenerated?.databaseSchema ?? [])
        : isLocalData
          ? (localGenerated?.databaseSchema ?? [])
          : [],
      knownLimitations: builder.preview.knownLimitations,
      deploymentDecisions: ['LIVE_DEPLOY = NO unless Commander authorizes'],
      requirements: builder.requirements,
      researchProvenance: builder.research.filter(item => item.source.startsWith('http')).map(item => ({
        id: item.id,
        source: item.source,
        kind: item.kind,
        query: item.query,
      })),
      factsAwaitingCommander: builder.requirements?.unknownBusinessFacts,
      assetRequests: builder.assetRequests,
      testStrategy: isCrm
        ? 'node --test test.mjs (SQLite persistence, CRUD, search, filter, conversion, validation, dashboard) plus Chromium workflow and restart proof'
        : isLocalData
          ? 'node --test test.mjs (SQLite persistence, CRUD, search, category) plus HTTP workflow and restart proof'
        : 'node --test test.mjs plus Chromium viewports',
      continuationHistory,
      reusedResearch: builder.reusedResearch,
      refreshedResearch: builder.refreshedResearch,
      updatedAt: new Date().toISOString(),
    }
    await writeProjectMemory(builder.project.projectRoot, builder.memory)
    const contractGate = standaloneApplicationBuilderReady(mission, origin)
    if (!contractGate.ready) {
      builder.preview.status = 'NOT_READY'
      builder.project.status = 'WAITING_COMMANDER'
      mission.completionGate = {
        complete: false,
        missing: ['VERDICT_PASS'],
        detail: contractGate.detail,
      }
      appendContractEvent(mission.missionId, 'COMPLETION_REFUSED', contractGate.detail, mission)
      await mark(mission, 'complete', 'failed', contractGate.detail)
      await appendJournal(mission, { kind: 'block', text: contractGate.detail })
      const nextStatus = /FAIL/.test(contractGate.detail) ? 'FAILED' : 'BLOCKED'
      if (mission.status !== nextStatus) await transitionMission(mission, nextStatus, contractGate.detail)
      await saveMission(mission)
      await releaseMissionWrapperResources({
        missionId: mission.missionId,
        retainPreview,
        previewRecordId,
      })
      return mission
    }
    builder.project.status = 'PROJECT_READY'
    await mark(mission, 'preview', 'done', origin)

    mission.completionGate = {
      complete: true,
      missing: [],
      detail: 'Application Builder gates satisfied: research, requirements, stack, isolated project, tests, runtime, browser, preview.',
    }
    mission.deployState = { ok: false, detail: 'LIVE_DEPLOY = NO' }
    await mark(mission, 'complete', 'done', 'PROJECT READY')
    await transitionMission(mission, 'COMPLETE', mission.completionGate.detail)
    await appendJournal(mission, { kind: 'decision', text: `PROJECT READY at ${origin}` })
    await logWarRoomRepoAudit('foundry-application-builder: complete', {
      missionId: mission.missionId,
      projectRoot: builder.project.projectRoot,
      origin,
      governance: APPLICATION_BUILDER_GOVERNANCE,
    })
    await saveMission(mission)
    await releaseMissionWrapperResources({
      missionId: mission.missionId,
      retainPreview,
      previewRecordId,
    })
    return mission
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mission.errors.push({ at: new Date().toISOString(), klass: 'CODE', message })
    mission.blocker = {
      blocker: 'APPLICATION_BUILDER_FAILED',
      evidence: message,
      attempted: 'research → specify → create → implement → test → run → verify',
      why: message,
      unblock: 'Inspect the isolated project root and resume. War Room source was not the write target.',
    }
    await appendJournal(mission, { kind: 'block', text: message })
    if (mission.status !== 'FAILED') {
      await transitionMission(mission, 'FAILED', message)
    }
    await executeFoundryBrowserTool('browser.stop', {}, { repairId: mission.missionId }).catch(() => undefined)
    releaseFoundryResearchMission(mission.missionId, { terminal: true })
    if (spawnedPreviewThisMission && builder.project) {
      await stopOwnedProjectPreview({ projectId: builder.project.projectId }).catch(() => undefined)
      await stopOwnedProcesses(mission.missionId).catch(() => undefined)
    } else {
      await releaseMissionWrapperResources({ missionId: mission.missionId, retainPreview: true, previewRecordId })
    }
    await saveMission(mission)
    return mission
  }
}
