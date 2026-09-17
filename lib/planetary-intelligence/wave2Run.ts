import { PlanetaryRegistryStore } from './registryStore'
import { selectActivationCandidates, activateSources, defaultWave2Fetch, type Wave2Fetch } from './endpointActivate'
import { documentsToRetrieved } from './documentIngest'
import { explainPriorityCells, sourceExistenceGivesZeroCoverage, endpointExistenceGivesZeroCoverage } from './observedCoverage'
import { promptGapCells } from './gapPrompt'
import { SQLITE_EVIDENCE_LEDGER_DECISION } from './registrySchema'
import { diagnoseSearxng } from './searxngDiagnostic'
import { searxngStartPolicy } from './searxngPolicy'
import { auroraDoesNotFirstPassRetrieve } from './retrievalContracts'
import { SERIAL_GPU_FLOOR, singleGpuSerialPreserved } from './protocol'
import { visibleConcurrentFamilies } from '@/lib/council/live-orchestration/floorScheduler'
import { LOCAL_FILESYSTEM_FALLBACK } from './livePersistence'
import { resolvePlanetaryRegistryTarget } from './registryPaths'
import { WAVE2_ACTIVATION_CAP } from './registryTypes'
import { verifyCandidate } from './registryVerify'

export async function runSourceFabricWave2(input: {
  rootDir?: string
  nowIso?: string
  fetchImpl?: Wave2Fetch
  activationCap?: number
  skipSearxng?: boolean
  commanderIntent?: string
  spacingMs?: number
}): Promise<{
  classification: 'PLANETARY_SOURCE_FABRIC_WAVE2_READY' | 'PLANETARY_SOURCE_FABRIC_WAVE2_PARTIAL' | 'PLANETARY_SOURCE_FABRIC_WAVE2_BLOCKED'
  startingSources: number
  startingLiveHealth: number
  activationCandidates: number
  activation: Awaited<ReturnType<typeof activateSources>>
  explanations: ReturnType<typeof explainPriorityCells>
  gapPrompts: ReturnType<typeof promptGapCells>
  ledger: typeof SQLITE_EVIDENCE_LEDGER_DECISION
  persistence: ReturnType<typeof resolvePlanetaryRegistryTarget>
  searxng: Awaited<ReturnType<typeof diagnoseSearxng>> & { startPolicy: ReturnType<typeof searxngStartPolicy> }
  auroraNoFirstPass: boolean
  singleGpu: boolean
  missionFallback: typeof LOCAL_FILESYSTEM_FALLBACK
  hyperlocalUnprovenRejected: boolean
  sourcePresenceZeroCoverage: boolean
  endpointPresenceZeroCoverage: boolean
}> {
  const nowIso = input.nowIso ?? new Date().toISOString()
  const store = new PlanetaryRegistryStore(input.rootDir)
  const sources = store.listSources()
  const endpoints = store.listEndpoints()
  const startingLiveHealth = endpoints.filter(item => item.status === 'OK' || item.status === 'NOT_MODIFIED').length
  const candidates = selectActivationCandidates(sources, endpoints, input.activationCap ?? WAVE2_ACTIVATION_CAP)
  const missionId = `WRIM-LIVE-P0-WAVE2-${nowIso.slice(0, 19).replace(/[-:T]/g, '')}`
  store.upsertMission({
    missionId,
    commanderIntent: input.commanderIntent ?? 'What breaking news happened today on my planet?',
    complexity: 'BROAD_PLANETARY',
    protocol: 'DIVERGENT_PLANETARY',
    createdAt: nowIso,
    payload: { wave: 2, activationCap: candidates.length },
  })
  const fetchImpl = input.fetchImpl ?? defaultWave2Fetch
  const activation = await activateSources({
    store,
    sources: candidates,
    fetchImpl,
    missionId,
    nowIso,
    spacingMs: input.spacingMs ?? 250,
  })
  const allDocs = documentsToRetrieved(store.listDocuments())
  const explanations = explainPriorityCells({
    documents: allDocs,
    sources: store.listSources(),
    endpoints: store.listEndpoints(),
    nowIso,
  })
  for (const cell of explanations) {
    store.upsertCoverageCell({
      cellId: `wave2-${cell.cell.replace(/\s+/g, '_')}`,
      missionId,
      geography: cell.cell.split(' × ')[0] || '',
      topic: cell.cell.split(' × ')[1] || '',
      language: cell.cell.split(' × ')[2] || '',
      sourceType: cell.cell.split(' × ')[3] || '',
      timeWindow: 'today',
      evidenceQuality: 'PRIMARY_EVIDENCE',
      claims: cell.qualifyingDocumentCount,
      independentOrigins: cell.independentOriginCount,
      status: cell.status,
      payload: cell,
      createdAt: nowIso,
    })
  }
  const gapPrompts = promptGapCells(
    explanations.map(item => ({
      cellId: item.cell,
      geography: item.cell.split(' × ')[0] as never,
      topic: item.cell.split(' × ')[1] as never,
      language: item.cell.split(' × ')[2] || 'und',
      sourceType: item.cell.split(' × ')[3] as never,
      time: 'today',
      evidenceQuality: 'PRIMARY_EVIDENCE',
      claims: item.qualifyingDocumentCount,
      independentOrigins: item.independentOriginCount,
      freshestEvidence: null,
      qualityDistribution: {},
      verification: 'NONE',
      status: item.status,
      qualifyingDocumentCount: item.qualifyingDocumentCount,
      languageMatchedCount: item.languageMatchedCount,
      geographyMatchedCount: item.geographyMatchedCount,
      sourceClassMatchedCount: item.sourceClassMatchedCount,
      rejectionReasons: item.rejectionReasons,
      explanation: item.explanation,
    })),
    allDocs.map(doc => doc.publisher).slice(0, 12),
  )
  for (const prompt of gapPrompts) {
    store.upsertGapResearch({
      gapId: prompt.gapId,
      coverageCell: prompt.coverageCell,
      researchPrompt: prompt.researchPrompt,
      createdAt: nowIso,
      requestedLanguage: prompt.requestedLanguage,
      actualQueryLanguage: prompt.actualQueryLanguage,
      targetGeography: prompt.targetGeography,
      targetTopic: prompt.targetTopic,
      targetSourceClass: prompt.targetSourceClass,
      targetLocality: prompt.targetLocality,
      targetEvidenceClass: prompt.targetEvidenceClass,
      excluded: prompt.excluded,
      fallbackLevel: prompt.fallbackLevel,
      independentOrigins: explanations.find(item => item.cell === prompt.coverageCell)?.independentOriginCount ?? 0,
      coverageBefore: 'MISSING',
      coverageAfter: explanations.find(item => item.cell === prompt.coverageCell)?.status ?? 'MISSING',
    })
  }
  const searxng = input.skipSearxng
    ? { configured: false, category: 'NOT_CONFIGURED' as const, label: 'SEARXNG_NOT_CONFIGURED', hostKind: 'missing' as const, statusCode: null, detail: 'skipped' }
    : await diagnoseSearxng()
  const improved = explanations.filter(item => item.status === 'WEAK' || item.status === 'COVERED').length
  let classification: 'PLANETARY_SOURCE_FABRIC_WAVE2_READY' | 'PLANETARY_SOURCE_FABRIC_WAVE2_PARTIAL' | 'PLANETARY_SOURCE_FABRIC_WAVE2_BLOCKED' = 'PLANETARY_SOURCE_FABRIC_WAVE2_PARTIAL'
  if (activation.live >= 5 && activation.inserted >= 10 && gapPrompts.length >= 8 && SQLITE_EVIDENCE_LEDGER_DECISION.sufficient) {
    classification = improved > 0 ? 'PLANETARY_SOURCE_FABRIC_WAVE2_READY' : 'PLANETARY_SOURCE_FABRIC_WAVE2_PARTIAL'
  }
  if (activation.inserted < 1 && activation.live < 1) classification = 'PLANETARY_SOURCE_FABRIC_WAVE2_BLOCKED'
  const result = {
    classification,
    startingSources: sources.length,
    startingLiveHealth: startingLiveHealth,
    activationCandidates: candidates.length,
    activation,
    explanations,
    gapPrompts,
    ledger: SQLITE_EVIDENCE_LEDGER_DECISION,
    persistence: resolvePlanetaryRegistryTarget(input.rootDir),
    searxng: { ...searxng, startPolicy: searxngStartPolicy() },
    auroraNoFirstPass: auroraDoesNotFirstPassRetrieve(),
    singleGpu: singleGpuSerialPreserved() && visibleConcurrentFamilies(SERIAL_GPU_FLOOR) === 1,
    missionFallback: LOCAL_FILESYSTEM_FALLBACK,
    hyperlocalUnprovenRejected: verifyCandidate({
      canonicalName: 'Village Voice',
      homepage: 'https://village.example.ke',
      country: 'Kenya',
      region: 'EAST_AFRICA',
      continent: 'Africa',
      localityClass: 'HYPERLOCAL',
      sourceRole: 'HYPERLOCAL',
      primaryLanguage: 'sw',
      supportedLanguages: ['sw'],
      sourceType: 'COMMUNITY_SOURCE',
      ownershipType: 'INDEPENDENT',
      publisher: 'Village',
      parentCompany: null,
      discoveryMethod: 'test',
      requestedDiscoveryLanguage: 'sw',
      actualQueryLanguage: 'sw',
    }, nowIso).ok === false,
    sourcePresenceZeroCoverage: sourceExistenceGivesZeroCoverage([]),
    endpointPresenceZeroCoverage: endpointExistenceGivesZeroCoverage(Math.max(activation.live, 1), []),
  }
  store.close()
  return result
}
