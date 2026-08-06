import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { browserSafeConnectionRows } from './registry'
import { __setOpportunitySourceFetchForTests, getOpportunitySourceAdapter } from './adapters'
import { __resetSourceRefreshDedupeForTests, runSourceRefreshPipeline } from './refreshPipeline'

export type SourceValidationResult = { id: string; pass: boolean; detail: string }

function test(id: string, fn: () => boolean | string | Promise<boolean | string>): Promise<SourceValidationResult> {
  return Promise.resolve()
    .then(fn)
    .then(result => ({ id, pass: result === true, detail: result === true ? 'PASS' : String(result) }))
    .catch(error => ({ id, pass: false, detail: error instanceof Error ? error.message : String(error) }))
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}

export async function runOpportunitySourceValidation(): Promise<SourceValidationResult[]> {
  const emptyEnv = { NODE_ENV: 'test' } as NodeJS.ProcessEnv
  const results: SourceValidationResult[] = []
  const add = async (id: string, fn: () => boolean | string | Promise<boolean | string>) => results.push(await test(id, fn))

  await add('source_01_missing_env_not_connected', () => browserSafeConnectionRows(emptyEnv).every(row => row.connectionState !== 'CONNECTED') || 'env-only state returned CONNECTED')
  await add('source_02_connected_requires_server_test', async () => {
    const adapter = getOpportunitySourceAdapter('sam_gov', emptyEnv)
    const health = await adapter.testConnection()
    return health.state === 'KEY_MISSING' || `state=${health.state}`
  })
  await add('source_03_walmart_credentials_required', async () => {
    const health = await getOpportunitySourceAdapter('walmart_load_board', emptyEnv).testConnection()
    return health.state === 'ACCOUNT_REQUIRED' && health.failure === 'CARRIER_APPROVAL_AND_CREDENTIALS_REQUIRED' || `state=${health.state} failure=${health.failure}`
  })
  await add('source_04_usaspending_historical_contract', () => {
    const source = readFileSync(join(process.cwd(), 'lib/opportunity-agents/sources/adapters.ts'), 'utf8')
    return source.includes("evidenceStatus: 'HISTORICAL'") && source.includes("isActive: false") || 'USAspending is not locked to historical intelligence'
  })
  await add('source_05_sam_expired_rejected', () => {
    const source = readFileSync(join(process.cwd(), 'lib/opportunity-agents/sources/adapters.ts'), 'utf8')
    return source.includes('Expired SAM.gov notice rejected as inactive') && source.includes('if (!normalized.isActive)') || 'SAM expired notice rejection not present'
  })
  await add('source_06_no_prohibited_walmart_scrape', () => {
    const source = readFileSync(join(process.cwd(), 'lib/opportunity-agents/sources/adapters.ts'), 'utf8').toLowerCase()
    return !source.includes('walmart.com') && !source.includes('scrape') || 'Walmart adapter contains portal scraping signal'
  })
  await add('source_07_media_boundaries_no_generation', async () => {
    const health = await getOpportunitySourceAdapter('replicate', emptyEnv).testConnection()
    return health.state === 'KEY_MISSING' && /no generation|no automatic/i.test(health.failure ?? '') || `state=${health.state} failure=${health.failure}`
  })
  await add('source_08_refresh_requested_not_success', async () => {
    __resetSourceRefreshDedupeForTests()
    const result = await runSourceRefreshPipeline('walmart_load_board')
    return result.requestedRefreshIsSuccess === false && result.status === 'not_configured' || `requested=${result.requestedRefreshIsSuccess} status=${result.status}`
  })
  await add('source_09_connection_routes_server_side', () => {
    const route = readFileSync(join(process.cwd(), 'app/api/opportunity-agents/sources/route.ts'), 'utf8')
    return route.includes("runtime = 'nodejs'") && route.includes('getOpportunitySourceAdapter') && route.includes('secretsExposed: false') || 'source route is not server-side/browser-safe'
  })
  await add('source_10_refresh_pipeline_stages_complete', () => {
    const source = readFileSync(join(process.cwd(), 'lib/opportunity-agents/sources/refreshPipeline.ts'), 'utf8')
    return ['SOURCE_SELECT','CONNECTION_CHECK','RETRIEVE','NORMALIZE','DUPLICATE_CHECK','FRESHNESS_CHECK','QUALIFY','REVENUE_ANALYSIS','PERSIST','DISPLAY'].every(stage => source.includes(stage)) || 'refresh pipeline stages missing'
  })
  await add('source_11_sam_structured_fields_survive', async () => {
    const calls: string[] = []
    __setOpportunitySourceFetchForTests((async input => {
      const url = new URL(String(input))
      calls.push(url.toString())
      if (url.searchParams.get('limit') === '1' && !url.searchParams.has('offset')) return jsonResponse({ opportunitiesData: [{ title: 'health check' }] })
      return jsonResponse({
        opportunitiesData: [{
          title: 'Regional delivery support',
          description: 'Structured SAM opportunity.',
          uiLink: 'https://sam.gov/opp/notice-123/view',
          noticeId: 'NOTICE-123',
          solicitationNumber: 'SOL-456',
          responseDeadLine: '2099-12-31',
          postedDate: '2026-01-15',
          placeOfPerformance: { city: { name: 'Atlanta' }, state: { code: 'GA' }, country: { name: 'United States' } },
          naicsCode: '492110',
          classificationCode: 'R706',
          typeOfSetAside: 'SBA',
          typeOfSetAsideDescription: 'Total Small Business Set-Aside',
        }],
      })
    }) as typeof fetch)
    try {
      const result = await getOpportunitySourceAdapter('sam_gov', { NODE_ENV: 'test', SAM_GOV_API_KEY: 'test-key' } as NodeJS.ProcessEnv).refresh({ limit: 1, maxPages: 1, maxRecords: 1 })
      const record = result.records[0]
      return Boolean(record)
        && record!.noticeId === 'NOTICE-123'
        && record!.solicitationNumber === 'SOL-456'
        && record!.placeOfPerformance === 'Atlanta, GA, United States'
        && record!.naicsCodes.includes('492110')
        && record!.pscCodes.includes('R706')
        && record!.setAsideCode === 'SBA'
        && record!.setAsideDescription === 'Total Small Business Set-Aside'
        && calls.length === 2
        || `structured fields did not survive: ${JSON.stringify(record)}`
    } finally {
      __setOpportunitySourceFetchForTests(null)
    }
  })
  await add('source_12_sam_pagination_duplicate_rate_limit_partial', async () => {
    const future = '2099-12-31'
    const past = '2000-01-01'
    __setOpportunitySourceFetchForTests((async input => {
      const url = new URL(String(input))
      if (url.searchParams.get('limit') === '1' && !url.searchParams.has('offset')) return jsonResponse({ opportunitiesData: [{ title: 'health check' }] })
      const offset = Number(url.searchParams.get('offset') ?? '0')
      if (offset === 0) {
        return jsonResponse({ opportunitiesData: [
          { title: 'Page one A', uiLink: 'https://sam.gov/a', noticeId: 'N-A', solicitationNumber: 'S-A', responseDeadLine: future },
          { title: 'Page one B', uiLink: 'https://sam.gov/b', noticeId: 'N-B', solicitationNumber: 'S-B', responseDeadLine: future },
        ] })
      }
      if (offset === 2) {
        return jsonResponse({ opportunitiesData: [
          { title: 'Page one A', uiLink: 'https://sam.gov/a', noticeId: 'N-A', solicitationNumber: 'S-A', responseDeadLine: future },
          { title: 'Expired C', uiLink: 'https://sam.gov/c', noticeId: 'N-C', solicitationNumber: 'S-C', responseDeadLine: past },
        ] })
      }
      return jsonResponse({ error: 'rate limited' }, 429)
    }) as typeof fetch)
    try {
      const result = await getOpportunitySourceAdapter('sam_gov', { NODE_ENV: 'test', SAM_GOV_API_KEY: 'test-key' } as NodeJS.ProcessEnv).refresh({ limit: 2, maxPages: 3, maxRecords: 6 })
      return result.status === 'partial_success'
        && result.pagination.pagesRequested === 3
        && result.pagination.pagesSucceeded === 2
        && result.pagination.recordsReceived === 4
        && result.pagination.recordsAccepted === 2
        && result.pagination.recordsRejected === 1
        && result.pagination.duplicates === 1
        && result.pagination.partialFailure === true
        && result.rejected.some(row => row.title === 'Expired C')
        || `pagination metadata mismatch: ${JSON.stringify(result.pagination)} status=${result.status} rejected=${JSON.stringify(result.rejected)}`
    } finally {
      __setOpportunitySourceFetchForTests(null)
    }
  })
  return results
}

if (process.argv[1]?.endsWith('validation.ts')) {
  const results = await runOpportunitySourceValidation()
  for (const result of results) console.log(`${result.pass ? 'PASS' : 'FAIL'} ${result.id} ${result.detail}`)
  const failed = results.filter(result => !result.pass)
  console.log(`Opportunity Source validation: ${results.length - failed.length}/${results.length} PASS`)
  if (failed.length) process.exit(1)
}
