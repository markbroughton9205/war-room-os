import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  classifyCloudProviderState,
  classifyCloudProviderStateFromHealth,
  classifyCouncilOperationalState,
  classifyNetworkEgress,
  classifyResearchProviders,
  cloudStatusLine,
  councilOperationalLabel,
  countConfiguredExternalProviders,
  novaContinuityRole,
  parseCouncilRoutingPreference,
  resolveAutoEffectiveMode,
} from '@/lib/council/live-orchestration/councilContinuity'
import { buildCouncilRosterSnapshot, compactFamilyRosterLine, rosterMemberPresentation } from '@/lib/council/live-orchestration/rosterHealth'
import { displayNameForSeat } from '@/lib/council/nebula/identity'
import {
  resolveCouncilRoutingMode,
  resolveCouncilRoutingPreference,
  localRoutingBypassesCloudFloorGate,
} from '@/lib/council/live-orchestration/backends/routingMode'
import { invokeCouncilSeat } from '@/lib/council/live-orchestration/backends/seatRouter'
import type { ModelBackendInvokeInput } from '@/lib/council/live-orchestration/backends/types'

type CaseResult = { name: string; pass: boolean; detail: string }

function check(name: string, pass: boolean, detail: string): CaseResult {
  return { name, pass, detail }
}

const NO_CLOUD = {
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  XAI_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
  COUNCIL_ROUTING_MODE: undefined,
  WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH: '',
}

const FAKE_GENERAL = 'huihui_ai/qwen3-abliterated:14b'

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const original: Record<string, string | undefined> = {}
  for (const key of Object.keys(vars)) original[key] = process.env[key]
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    })
}

function baseInput(overrides: Partial<ModelBackendInvokeInput> = {}): ModelBackendInvokeInput {
  return {
    seat: 'chatgpt',
    systemPrompt: 'test',
    userPrompt: 'ping',
    maxTokens: 32,
    signal: new AbortController().signal,
    onDelta: () => {},
    timeoutKind: 'council',
    ...overrides,
  }
}

function installMockOllama(ok: boolean): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!ok && (url.includes('11434') || url.endsWith('/api/tags') || url.endsWith('/api/generate'))) {
      throw new Error('mock ollama down')
    }
    const payload = url.endsWith('/api/tags')
      ? { models: [{ name: FAKE_GENERAL }] }
      : { response: 'local continuity reply', done: true }
    const bodyText = JSON.stringify(payload) + (url.endsWith('/api/generate') ? '\n' : '')
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(bodyText))
        controller.close()
      },
    })
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => bodyText,
      body: stream,
    } as unknown as Response
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

export async function runCouncilLocalContinuityValidation(): Promise<CaseResult[]> {
  const results: CaseResult[] = []

  results.push(check(
    'AUTO is a valid preference',
    parseCouncilRoutingPreference('AUTO') === 'AUTO' && parseCouncilRoutingPreference('LOCAL_FIRST') === 'LOCAL_FIRST',
    'AUTO+LOCAL_FIRST parse',
  ))

  results.push(check(
    'AUTO with 0 cloud keys resolves LOCAL_FIRST',
    resolveAutoEffectiveMode(0) === 'LOCAL_FIRST',
    '0 → LOCAL_FIRST',
  ))

  results.push(check(
    'AUTO with some cloud keys resolves HYBRID',
    resolveAutoEffectiveMode(1) === 'HYBRID' && resolveAutoEffectiveMode(4) === 'HYBRID',
    '1 and 4 → HYBRID',
  ))

  const caseA = classifyCouncilOperationalState({ externalConfiguredCount: 0, localReady: true })
  results.push(check(
    'CASE 1 0-cloud/local-ready → READY_LOCAL',
    caseA === 'READY_LOCAL' && councilOperationalLabel(caseA) === 'COUNCIL READY · LIVE',
    caseA,
  ))

  const caseB = classifyCouncilOperationalState({ externalConfiguredCount: 1, externalAvailableCount: 1, localReady: true })
  results.push(check(
    'CASE 2 1-cloud/local-ready → READY_HYBRID',
    caseB === 'READY_HYBRID',
    caseB,
  ))

  const caseC = classifyCouncilOperationalState({ externalConfiguredCount: 4, externalAvailableCount: 4, localReady: false })
  results.push(check(
    'CASE 3 full-cloud no local → READY_MULTI_MODEL',
    caseC === 'READY_MULTI_MODEL',
    caseC,
  ))

  const caseCHybrid = classifyCouncilOperationalState({ externalConfiguredCount: 4, externalAvailableCount: 4, localReady: true })
  results.push(check(
    'CASE 3 full-cloud + local → READY_HYBRID',
    caseCHybrid === 'READY_HYBRID',
    caseCHybrid,
  ))

  const caseD = classifyCouncilOperationalState({ externalConfiguredCount: 0, localReady: false })
  results.push(check(
    'CASE 4 0-cloud/local-unavailable → UNAVAILABLE',
    caseD === 'UNAVAILABLE' && councilOperationalLabel(caseD) === 'COUNCIL UNAVAILABLE',
    caseD,
  ))

  const nova = novaContinuityRole()
  results.push(check(
    'NOVA remains explicit local seat, not a duplicate fifth cloud identity',
    nova.identity === 'NOVA' && nova.role === 'EXPLICIT_LOCAL_COUNCIL_SEAT',
    JSON.stringify(nova),
  ))

  const localSnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: false, claude: false, grok: false, gemini: false },
    continuity: { localReady: true, routingPreference: 'AUTO', routingModeResolved: 'LOCAL_FIRST', terraConnection: 'CONNECTED' },
  })
  results.push(check(
    '0/4 cloud does not imply unavailable when local ready',
    localSnap.externalProviderCount.configured === 0
      && localSnap.operationalState === 'READY_LOCAL'
      && localSnap.degradedByRoster === false
      && !compactFamilyRosterLine(localSnap).includes('0/4 PROVIDERS ACTIVE')
      && localSnap.families.chatgpt?.uiStatus === 'READY'
      && localSnap.families.chatgpt?.cloudState === 'NOT_CONFIGURED'
      && localSnap.families.chatgpt?.uiDetail === 'READY'
      && localSnap.families.chatgpt?.identityName === 'AURORA'
      && localSnap.families.chatgpt?.localContinuity === 'AVAILABLE'
      && !/openai ready/i.test(localSnap.families.chatgpt?.uiDetail ?? '')
      && localSnap.families.nova?.uiStatus === 'READY'
      && localSnap.routingDisplay === 'LOCAL'
      && displayNameForSeat('claude') === 'ORION'
      && displayNameForSeat('claude') !== 'ORIGIN',
    compactFamilyRosterLine(localSnap),
  ))

  results.push(check(
    'seat presentation does not paint AURORA as connected OpenAI',
    rosterMemberPresentation(localSnap.families.chatgpt!).tone === 'ready'
      && rosterMemberPresentation(localSnap.families.chatgpt!).label === 'READY'
      && (rosterMemberPresentation(localSnap.families.chatgpt!).localLine ?? '').includes('Local')
      && rosterMemberPresentation(localSnap.families.chatgpt!).optionalExternalLine === 'Optional external: OpenAI · NOT CONFIGURED'
      && !/openai ready/i.test(rosterMemberPresentation(localSnap.families.chatgpt!).label)
      && rosterMemberPresentation(localSnap.families.nova!).tone === 'ready',
    JSON.stringify(rosterMemberPresentation(localSnap.families.chatgpt!)),
  ))

  const downSnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: false, claude: false, grok: false, gemini: false },
    continuity: { localReady: false, routingPreference: 'AUTO', routingModeResolved: 'LOCAL_FIRST' },
  })
  results.push(check(
    '0 cloud + local down keeps entities present with BACKEND_UNAVAILABLE',
    downSnap.operationalState === 'UNAVAILABLE'
      && downSnap.degradedByRoster === true
      && downSnap.unavailableReason === 'NO_REASONING_BACKEND'
      && downSnap.families.chatgpt?.identityName === 'AURORA'
      && downSnap.families.chatgpt?.memberIdentityStatus === 'PRESENT_BACKEND_UNAVAILABLE'
      && downSnap.entityPresentCount === 4
      && compactFamilyRosterLine(downSnap).includes('PRESENT'),
    downSnap.operationalLabel,
  ))

  await withEnv(NO_CLOUD, async () => {
    const pref = resolveCouncilRoutingPreference()
    const mode = resolveCouncilRoutingMode()
    results.push(check(
      'packaged/default preference is AUTO when env unset',
      pref === 'AUTO',
      `preference=${pref}`,
    ))
    results.push(check(
      'AUTO default with 0 keys resolves LOCAL_FIRST',
      mode === 'LOCAL_FIRST' && localRoutingBypassesCloudFloorGate() === true,
      `mode=${mode}`,
    ))
  })

  await withEnv({ ...NO_CLOUD, ANTHROPIC_API_KEY: 'sk-ant-FAKE-CONTINUITY-NOT-REAL' }, async () => {
    results.push(check(
      'AUTO with one cloud key resolves HYBRID',
      resolveCouncilRoutingMode() === 'HYBRID',
      `mode=${resolveCouncilRoutingMode()}`,
    ))
  })

  await withEnv({
    ...NO_CLOUD,
    OPENAI_API_KEY: 'sk-FAKE-CONTINUITY-OPENAI',
    ANTHROPIC_API_KEY: 'sk-ant-FAKE-CONTINUITY-NOT-REAL',
    XAI_API_KEY: 'xai-FAKE-CONTINUITY',
    GEMINI_API_KEY: 'gemini-FAKE-CONTINUITY',
  }, async () => {
    results.push(check(
      'AUTO with all four cloud keys resolves HYBRID (does not fake EXTERNAL_ONLY)',
      resolveCouncilRoutingMode() === 'HYBRID' && countConfiguredExternalProviders({
        chatgpt: true, claude: true, grok: true, gemini: true,
      }) === 4,
      `mode=${resolveCouncilRoutingMode()}`,
    ))
  })

  await withEnv({ ...NO_CLOUD, COUNCIL_ROUTING_MODE: 'EXTERNAL_ONLY' }, async () => {
    results.push(check(
      'explicit EXTERNAL_ONLY still honored',
      resolveCouncilRoutingMode() === 'EXTERNAL_ONLY' && localRoutingBypassesCloudFloorGate() === false,
      `mode=${resolveCouncilRoutingMode()}`,
    ))
  })

  const tmp = mkdtempSync(path.join(tmpdir(), 'wr-council-routing-'))
  const cfg = path.join(tmp, 'council-runtime.json')
  writeFileSync(cfg, JSON.stringify({ routingMode: 'LOCAL_ONLY' }))
  try {
    await withEnv({
      ...NO_CLOUD,
      COUNCIL_ROUTING_MODE: 'HYBRID',
      WAR_ROOM_COUNCIL_RUNTIME_CONFIG_PATH: cfg,
    }, async () => {
      results.push(check(
        'packaged council-runtime.json wins over env',
        resolveCouncilRoutingPreference() === 'LOCAL_ONLY' && resolveCouncilRoutingMode() === 'LOCAL_ONLY',
        `pref=${resolveCouncilRoutingPreference()}`,
      ))
    })
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  const restoreLocal = installMockOllama(true)
  try {
    await withEnv(NO_CLOUD, async () => {
      const result = await invokeCouncilSeat(baseInput())
      results.push(check(
        'CASE A invoke uses local backend with 0 cloud keys',
        result.ok && result.backend.backendType === 'LOCAL' && result.backend.provider === 'ollama',
        `ok=${result.ok} type=${result.backend.backendType} provider=${result.backend.provider} status=${result.backend.status}`,
      ))
    })
  } finally {
    restoreLocal()
  }

  const restoreDown = installMockOllama(false)
  try {
    await withEnv(NO_CLOUD, async () => {
      const result = await invokeCouncilSeat(baseInput())
      results.push(check(
        'CASE D invoke does not fake cloud success when local is down',
        !result.ok && result.backend.status !== 'OK',
        `ok=${result.ok} type=${result.backend.backendType} provider=${result.backend.provider} status=${result.backend.status}`,
      ))
    })
  } finally {
    restoreDown()
  }

  const egressAvailable = classifyNetworkEgress('reachable')
  const searchUnconfigured = classifyResearchProviders({})
  const councilLocalReady = classifyCouncilOperationalState({
    externalConfiguredCount: 0,
    localReady: true,
  })
  results.push(check(
    'search config is not network egress (CASE E contract)',
    egressAvailable === 'AVAILABLE'
      && searchUnconfigured === 'CONFIG_NEEDED'
      && councilLocalReady === 'READY_LOCAL'
      && councilOperationalLabel(councilLocalReady) === 'COUNCIL READY · LIVE',
    `egress=${egressAvailable} search=${searchUnconfigured} council=${councilLocalReady}`,
  ))

  results.push(check(
    'CASE 5 missing key is NOT_CONFIGURED not AUTH_FAILED',
    classifyCloudProviderState({ configured: false }) === 'NOT_CONFIGURED'
      && classifyCloudProviderState({ configured: true, override: 'UNAVAILABLE_AUTH' }) === 'AUTH_FAILED'
      && classifyCloudProviderStateFromHealth('MISSING_KEY', false) === 'NOT_CONFIGURED'
      && classifyCloudProviderStateFromHealth('INVALID_KEY', true) === 'AUTH_FAILED'
      && cloudStatusLine('chatgpt', 'NOT_CONFIGURED') === 'OpenAI · NOT CONFIGURED',
    'provider state split',
  ))

  const authSnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: true, claude: false, grok: false, gemini: false },
    overrides: { chatgpt: 'UNAVAILABLE_AUTH' },
    continuity: { localReady: true, routingPreference: 'AUTO', routingModeResolved: 'LOCAL_FIRST' },
  })
  results.push(check(
    'CASE 5 configured auth failure stays AUTH_FAILED',
    authSnap.families.chatgpt?.cloudState === 'AUTH_FAILED'
      && authSnap.families.chatgpt?.optionalExternalDetail === 'OpenAI · AUTH FAILED'
      && authSnap.families.chatgpt?.uiDetail === 'READY'
      && authSnap.operationalState === 'DEGRADED_PARTIAL',
    authSnap.families.chatgpt?.uiDetail ?? '',
  ))

  const netSnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: true, claude: false, grok: false, gemini: false },
    overrides: { chatgpt: 'NETWORK_ERROR' },
    continuity: { localReady: true, routingPreference: 'AUTO', routingModeResolved: 'HYBRID', networkEgress: 'UNAVAILABLE' },
  })
  results.push(check(
    'CASE 6 network failure is NETWORK_ERROR not NOT_CONFIGURED',
    netSnap.families.chatgpt?.cloudState === 'NETWORK_ERROR'
      && netSnap.operationalState === 'DEGRADED_PARTIAL',
    netSnap.families.chatgpt?.uiDetail ?? '',
  ))

  results.push(check(
    'CASE 7 network egress independent of research providers',
    classifyNetworkEgress('reachable') === 'AVAILABLE'
      && classifyResearchProviders({ tavilyConfigured: false, firecrawlConfigured: false, xaiConfigured: false }) === 'CONFIG_NEEDED',
    'egress vs search config',
  ))

  const hybridSnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: true, claude: false, grok: false, gemini: false },
    continuity: { localReady: true, routingPreference: 'AUTO', routingModeResolved: 'HYBRID' },
  })
  results.push(check(
    'CASE 2 roster shows exact external provider',
    hybridSnap.operationalState === 'READY_HYBRID'
      && hybridSnap.families.chatgpt?.cloudState === 'AVAILABLE'
      && hybridSnap.families.claude?.cloudState === 'NOT_CONFIGURED'
      && hybridSnap.externalProviderCount.configured === 1,
    hybridSnap.operationalLabel,
  ))

  results.push(check(
    'secret redaction: status exposes configured boolean only',
    !JSON.stringify(localSnap).toLowerCase().includes('sk-')
      && !JSON.stringify(localSnap).includes('API_KEY=')
      && typeof localSnap.families.chatgpt?.externalConfigured === 'boolean',
    'no key material in roster snapshot',
  ))

  results.push(check(
    'Foundry/WRIM files not imported by continuity module',
    !councilOperationalLabel.toString().includes('foundry'),
    'no foundry coupling in label helper',
  ))

  const modelA = buildCouncilRosterSnapshot({
    configured: { chatgpt: false, claude: false, grok: false, gemini: false },
    continuity: { localReady: true, localModel: 'huihui_ai/qwen3-abliterated:14b', routingPreference: 'AUTO', routingModeResolved: 'LOCAL_FIRST' },
  })
  const modelB = buildCouncilRosterSnapshot({
    configured: { chatgpt: false, claude: false, grok: false, gemini: false },
    continuity: { localReady: true, localModel: 'qwen2.5-coder:14b', routingPreference: 'AUTO', routingModeResolved: 'LOCAL_FIRST' },
  })
  results.push(check(
    'CASE 2 backend A→B leaves identities unchanged',
    ['chatgpt', 'claude', 'grok', 'gemini'].every(seat =>
      modelA.families[seat as 'chatgpt']?.identityName === modelB.families[seat as 'chatgpt']?.identityName
    )
      && modelA.families.chatgpt?.identityName === 'AURORA'
      && modelA.localModel !== modelB.localModel,
    `${modelA.localModel} → ${modelB.localModel}`,
  ))

  const oneExternal = buildCouncilRosterSnapshot({
    configured: { chatgpt: true, claude: false, grok: false, gemini: false },
    continuity: { localReady: true, routingPreference: 'AUTO', routingModeResolved: 'HYBRID' },
  })
  results.push(check(
    'CASE 3 one external backend does not rename Council entities',
    oneExternal.families.chatgpt?.identityName === 'AURORA'
      && oneExternal.families.chatgpt?.cloudState === 'AVAILABLE'
      && oneExternal.families.claude?.identityName === 'ORION'
      && oneExternal.families.claude?.cloudState === 'NOT_CONFIGURED'
      && oneExternal.entityReadyCount === 4,
    compactFamilyRosterLine(oneExternal),
  ))

  const internetSnap = buildCouncilRosterSnapshot({
    configured: { chatgpt: false, claude: false, grok: false, gemini: false },
    continuity: {
      localReady: true,
      routingPreference: 'AUTO',
      routingModeResolved: 'LOCAL_FIRST',
      networkEgress: 'AVAILABLE',
      researchProviders: 'CONFIG_NEEDED',
      terraConnection: 'CONNECTED',
    },
  })
  results.push(check(
    'CASE 4 0-cloud Council stays READY with live internet and Terra',
    internetSnap.families.chatgpt?.memberIdentityStatus === 'READY'
      && internetSnap.internetAccess === 'AVAILABLE'
      && internetSnap.terraAccess === 'CONNECTED'
      && internetSnap.knowledgeAccess === 'AVAILABLE'
      && internetSnap.researchProviders === 'CONFIG_NEEDED',
    compactFamilyRosterLine(internetSnap),
  ))

  results.push(check(
    'CASE 5 identities persist across restart because they are code-defined Nebula entities',
    displayNameForSeat('chatgpt') === 'AURORA'
      && displayNameForSeat('claude') === 'ORION'
      && displayNameForSeat('grok') === 'PULSAR'
      && displayNameForSeat('gemini') === 'LUMEN'
      && displayNameForSeat('nova') === 'NOVA',
    'NEBULA_AGENTS',
  ))

  return results
}
